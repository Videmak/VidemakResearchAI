"""Word (.docx) -> AI Editor document: BlockNote blocks, document settings and comments.

Paragraph formatting the editor shows as block props (alignment, spacing, indents, line
spacing), run formatting as text styles (only what differs from the paragraph's style),
lists with nesting, tables with merged cells, images, citations from Zotero/Mendeley as
live citations, footnotes, comments with replies, tracked changes as suggestions,
equations as LaTeX and the table of contents as a block. Page size, margins, headers,
footers and the document's base styles go into the settings.
"""

from __future__ import annotations

import base64
import io
import json
import posixpath
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional

from lxml import etree

from .math import omml_to_latex
from .ooxml import EMU_PER_PX, M, NS, R, W, fmt_pt, local, parse_xml, q, to_number, wattr
from .styles import ParaFormat, RunFormat, StyleSheet, parse_para_format, parse_run_format

ImageSink = Callable[[bytes, str, str], str]  # (data, content_type, name) -> url

CITATION_MARKERS = ("ZOTERO_ITEM", "CSL_CITATION", "MENDELEY CITATION", "EN.CITE", "CITAVI")
BIBLIOGRAPHY_MARKERS = ("ZOTERO_BIBL", "CSL_BIBLIOGRAPHY", "MENDELEY BIBLIOGRAPHY", "EN.REFLIST", "BIBLIOGRAPHY")
CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
                 "tif": "image/tiff", "tiff": "image/tiff", "svg": "image/svg+xml", "webp": "image/webp", "emf": "image/emf", "wmf": "image/wmf"}
PAGE_CONTENT_WIDTH_PX = 624  # 6.5 in at 96 dpi


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class Field:
    instr: str = ""
    phase: str = "instr"  # instr | result
    kind: str = "plain"  # plain | citation | toc | hyperlink | page
    result: List[dict] = field(default_factory=list)


def classify_field(instr: str) -> str:
    upper = instr.strip().upper()
    if upper.startswith("ADDIN") and any(marker in upper for marker in CITATION_MARKERS):
        return "citation"
    if upper.startswith("TOC"):
        return "toc"
    if upper.startswith("HYPERLINK"):
        return "hyperlink"
    if upper.startswith(("PAGE", "NUMPAGES", "SECTIONPAGES")):
        return "page"
    return "plain"


def csl_to_bibtex(item: dict) -> str:
    """BibTeX from CSL-JSON item data (enough for the editor's citation formatter)."""
    kind = {"article-journal": "article", "book": "book", "chapter": "incollection", "paper-conference": "inproceedings",
            "thesis": "phdthesis", "report": "techreport", "webpage": "misc"}.get(item.get("type", ""), "article")
    authors = item.get("author") or []
    names = [" ".join(filter(None, [a.get("given"), a.get("family")])) if not a.get("literal") else a["literal"] for a in authors]
    first = (authors[0].get("family") or authors[0].get("literal") or "ref") if authors else "ref"
    year = ""
    issued = item.get("issued") or {}
    parts = issued.get("date-parts") or []
    if parts and parts[0]:
        year = str(parts[0][0])
    elif issued.get("raw"):
        match = re.search(r"\d{4}", str(issued["raw"]))
        year = match.group(0) if match else ""
    key = re.sub(r"[^A-Za-z0-9]", "", f"{first}{year}") or "ref"
    clean = lambda value: str(value).replace("{", "").replace("}", "")
    fields = [("title", item.get("title")), ("author", " and ".join(names) if names else None), ("year", year or None),
              ("journal", item.get("container-title")), ("volume", item.get("volume")), ("number", item.get("issue")),
              ("pages", item.get("page")), ("publisher", item.get("publisher")), ("doi", item.get("DOI")), ("url", item.get("URL"))]
    body = ",\n".join(f"  {name} = {{{clean(value)}}}" for name, value in fields if value)
    return f"@{kind}{{{key},\n{body}\n}}"


class WordReader:
    def __init__(self, data: bytes, image_sink: Optional[ImageSink] = None):
        self.package = zipfile.ZipFile(io.BytesIO(data))
        self.names = set(self.package.namelist())
        self.image_sink = image_sink
        self.document = parse_xml(self.package.read("word/document.xml"))
        self.rels = self._rels("word/_rels/document.xml.rels")
        self.sheet = StyleSheet(self._read("word/styles.xml"), self._read("word/numbering.xml"), self._read("word/theme/theme1.xml"))
        self.normal_style = self.sheet.default_paragraph_style
        self.normal_para = self.sheet.paragraph_format(self.normal_style)
        self.normal_run = self.sheet.paragraph_run_format(self.normal_style)
        self.footnotes = self._notes("word/footnotes.xml", "footnote")
        self.endnotes = self._notes("word/endnotes.xml", "endnote")
        self.comment_meta = self._comments()
        self.comment_anchor: Dict[str, dict] = {}
        self.open_comments: List[str] = []
        self.fields: List[Field] = []
        self.list_stack: List[tuple] = []
        self.numbered_seen: Dict[str, bool] = {}
        self.blocks: List[dict] = []
        self.sections: List[dict] = []
        self.warnings: List[str] = []
        self.stats = {"paragraphs": 0, "headings": 0, "tables": 0, "images": 0, "citations": 0, "footnotes": 0,
                      "comments": 0, "equations": 0, "trackedChanges": 0, "listItems": 0, "pageBreaks": 0}
        self.toc_emitted = False

    # ------------------------------------------------------------ package

    def _read(self, name: str) -> Optional[bytes]:
        return self.package.read(name) if name in self.names else None

    def _rels(self, name: str) -> Dict[str, dict]:
        data = self._read(name)
        if not data:
            return {}
        rels = {}
        for rel in parse_xml(data).findall("{%s}Relationship" % NS["rel"]):
            rels[rel.get("Id")] = {"target": rel.get("Target") or "", "type": rel.get("Type") or "", "mode": rel.get("TargetMode")}
        return rels

    def _part_path(self, target: str, base: str = "word") -> str:
        return target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))

    def _warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    # ------------------------------------------------------------ notes and comments

    def _paragraph_texts(self, root) -> List[str]:
        out = []
        for paragraph in root.iter(W + "p"):
            pieces = []
            for node in paragraph.iter(W + "t", W + "tab", W + "br"):
                if node.tag == W + "t":
                    pieces.append(node.text or "")
                elif node.tag == W + "tab":
                    pieces.append("\t")
                else:
                    pieces.append("\n")
            out.append("".join(pieces))
        return out

    def _notes(self, name: str, tag: str) -> Dict[str, str]:
        data = self._read(name)
        if not data:
            return {}
        notes = {}
        for note in parse_xml(data).findall(W + tag):
            note_type = wattr(note, "type")
            if note_type in ("separator", "continuationSeparator", "continuationNotice"):
                continue
            notes[wattr(note, "id") or ""] = "\n".join(text.strip() for text in self._paragraph_texts(note)).strip()
        return notes

    def _comments(self) -> Dict[str, dict]:
        data = self._read("word/comments.xml")
        if not data:
            return {}
        extended = {}
        ext_data = self._read("word/commentsExtended.xml")
        if ext_data:
            for item in parse_xml(ext_data).iter("{%s}commentEx" % NS["w15"]):
                extended[item.get("{%s}paraId" % NS["w15"])] = {
                    "parent": item.get("{%s}paraIdParent" % NS["w15"]),
                    "done": item.get("{%s}done" % NS["w15"]) in ("1", "true"),
                }
        comments = {}
        for comment in parse_xml(data).findall(W + "comment"):
            paragraphs = comment.findall(W + "p")
            para_id = paragraphs[-1].get("{%s}paraId" % NS["w14"]) if paragraphs else None
            date = wattr(comment, "date")
            try:
                created = int(datetime.fromisoformat((date or "").replace("Z", "+00:00")).timestamp() * 1000)
            except ValueError:
                created = int(datetime.utcnow().timestamp() * 1000)
            ext = extended.get(para_id or "", {})
            comments[wattr(comment, "id") or ""] = {
                "author": wattr(comment, "author") or "Word",
                "created": created,
                "text": "\n".join(t.strip() for t in self._paragraph_texts(comment)).strip(),
                "paraId": para_id,
                "parent": ext.get("parent"),
                "done": ext.get("done", False),
            }
        return comments

    # ------------------------------------------------------------ settings

    def _style_summary(self) -> dict:
        def run_info(fmt: RunFormat) -> dict:
            info = {}
            if fmt.font:
                info["fontFamily"] = fmt.font
            if fmt.size_pt:
                info["fontSize"] = fmt_pt(fmt.size_pt)
            if fmt.bold:
                info["bold"] = True
            if fmt.italic:
                info["italic"] = True
            if fmt.color and fmt.color != "auto":
                info["color"] = fmt.color
            return info

        def para_info(fmt: ParaFormat) -> dict:
            info = {}
            if fmt.space_before is not None:
                info["spaceBefore"] = fmt_pt(fmt.space_before)
            if fmt.space_after is not None:
                info["spaceAfter"] = fmt_pt(fmt.space_after)
            if fmt.line:
                info["lineSpacing"] = fmt.line
            if fmt.align and fmt.align != "left":
                info["textAlignment"] = fmt.align
            return info

        summary = {"normal": {**run_info(self.normal_run), **para_info(self.normal_para)}, "headings": {}}
        for style_id, style in self.sheet.styles.items():
            name = style.name.lower()
            level = None
            if name.startswith("heading ") and name[8:].strip().isdigit():
                level = name[8:].strip()
            elif name == "title":
                level = "title"
            elif name == "subtitle":
                level = "subtitle"
            if level and style.kind == "paragraph":
                summary["headings"][level] = {
                    "styleId": style_id,
                    **run_info(self.sheet.paragraph_run_format(style_id)),
                    **para_info(self.sheet.paragraph_format(style_id)),
                }
        return summary

    def _header_footer_text(self, root) -> tuple:
        """Text of a header/footer part, with {PAGE} / {PAGES} where page fields are."""
        lines, align = [], "left"
        for paragraph in root.iter(W + "p"):
            pieces: List[str] = []
            depth, instr, in_result = 0, "", False
            for node in paragraph.iter():
                tag = local(node)
                if tag == "fldChar":
                    state = wattr(node, "fldCharType")
                    if state == "begin":
                        depth, instr, in_result = depth + 1, "", False
                    elif state == "separate":
                        upper = instr.strip().upper()
                        pieces.append("{PAGE}" if upper.startswith("PAGE") else "{PAGES}" if upper.startswith(("NUMPAGES", "SECTIONPAGES")) else "")
                        in_result = True
                    elif state == "end":
                        if not in_result:
                            upper = instr.strip().upper()
                            pieces.append("{PAGE}" if upper.startswith("PAGE") else "{PAGES}" if upper.startswith(("NUMPAGES", "SECTIONPAGES")) else "")
                        depth, in_result = max(0, depth - 1), False
                elif tag == "instrText" and depth:
                    instr += node.text or ""
                elif tag == "fldSimple":
                    upper = (wattr(node, "instr") or "").strip().upper()
                    pieces.append("{PAGE}" if upper.startswith("PAGE") else "{PAGES}" if upper.startswith(("NUMPAGES", "SECTIONPAGES")) else "")
                elif tag == "t":
                    inside_simple = any(local(parent) == "fldSimple" for parent in node.iterancestors())
                    if not depth and not inside_simple:
                        pieces.append(node.text or "")
                elif tag == "tab" and not depth:
                    pieces.append("\t")
            value = "".join(pieces).strip()
            if value:
                lines.append(value)
                jc = paragraph.find(f"{W}pPr/{W}jc")
                if jc is not None:
                    align = {"center": "center", "right": "right", "end": "right"}.get(wattr(jc, "val") or "", "left")
        return "\n".join(lines), align

    def _header_footer(self, sectprs: List, kind: str) -> dict:
        """Headers or footers by type; a section without its own inherits the previous one's."""
        result: Dict[str, dict] = {}
        for sectpr in sectprs:
            for ref in sectpr.findall(W + f"{kind}Reference"):
                rel = self.rels.get(ref.get(R + "id") or "")
                data = self._read(self._part_path(rel["target"])) if rel else None
                if not data:
                    continue
                text, align = self._header_footer_text(parse_xml(data))
                kind_key = wattr(ref, "type") or "default"
                if text:
                    result[kind_key] = {"text": text, "align": align}
                else:
                    result.pop(kind_key, None)
        return result

    def _section(self, sectpr) -> dict:
        size = sectpr.find(W + "pgSz")
        margins = sectpr.find(W + "pgMar")
        # Take the largest column count (some files carry more than one w:cols).
        cols_nodes = sectpr.findall(W + "cols")
        cols = max(cols_nodes, key=lambda node: to_number(wattr(node, "num")) or 1) if cols_nodes else None
        width = to_number(wattr(size, "w")) or 11906
        height = to_number(wattr(size, "h")) or 16838
        orientation = wattr(size, "orient") or ("landscape" if width > height else "portrait")
        section = {
            "widthPt": fmt_pt(width / 20),
            "heightPt": fmt_pt(height / 20),
            "orientation": orientation,
            "columns": int(to_number(wattr(cols, "num")) or 1) if cols is not None else 1,
        }
        if margins is not None:
            section["margins"] = {key: fmt_pt((to_number(wattr(margins, key)) or 0) / 20)
                                  for key in ("top", "right", "bottom", "left", "header", "footer")}
        return section

    # ------------------------------------------------------------ inline content

    def _text_item(self, text: str, styles: dict) -> dict:
        return {"type": "text", "text": text, "styles": dict(styles)}

    def _run_styles(self, effective: RunFormat, base: RunFormat) -> dict:
        styles = {}
        for name in ("bold", "italic", "underline", "strike"):
            value = getattr(effective, name)
            if value and not getattr(base, name):
                styles[name] = True
        if effective.color and effective.color != "auto" and effective.color != (base.color or "auto"):
            styles["textColor"] = effective.color
        if effective.highlight and effective.highlight != base.highlight:
            styles["backgroundColor"] = effective.highlight
        if effective.font and effective.font != base.font:
            styles["fontFamily"] = effective.font
        if effective.size_pt and effective.size_pt != base.size_pt:
            styles["fontSize"] = f"{fmt_pt(effective.size_pt)}pt"
        if effective.vertical in ("super", "sub"):
            styles["verticalAlign"] = effective.vertical
        return styles

    def _capturing(self) -> Optional[Field]:
        """The innermost field whose result replaces its text (a citation)."""
        for item in reversed(self.fields):
            if item.kind == "citation" and item.phase == "result":
                return item
        return None

    def _skipping(self) -> bool:
        return any(item.kind == "toc" for item in self.fields) or any(item.phase == "instr" for item in self.fields)

    def _emit(self, out: List, item) -> None:
        if self._skipping():
            return
        capture = self._capturing()
        if capture is not None:
            if isinstance(item, dict) and item.get("type") == "text":
                capture.result.append(item)
            return
        for comment_id in self.open_comments:
            if isinstance(item, dict) and item.get("type") == "text":
                self.comment_anchor[comment_id]["text"].append(item["text"])
        out.append(item)

    def _citation_item(self, instr: str, result: List[dict]) -> dict:
        shown = "".join(item.get("text", "") for item in result).strip() or "(Citation)"
        payload = {}
        brace = instr.find("{")
        if brace >= 0:
            try:
                payload = json.loads(instr[brace:instr.rfind("}") + 1])
            except ValueError:
                payload = {}
        items = payload.get("citationItems") or []
        bibtex_entries = [csl_to_bibtex(entry.get("itemData") or {}) for entry in items if entry.get("itemData")]
        data = {"bibtex": "\n\n".join(bibtex_entries), "source": "word", "fieldCode": instr.strip()[:20000]}
        if items:
            first = items[0].get("itemData") or {}
            data["title"] = first.get("title")
            data["doi"] = first.get("DOI")
        self.stats["citations"] += 1
        return {
            "type": "aiCitation",
            "props": {
                "citationId": payload.get("citationID") or new_id(),
                "base64": base64.b64encode(json.dumps(data).encode()).decode(),
                "displayText": shown,
                "bibliography": "",
                "style": "apa",
                "url": f"https://doi.org/{data['doi']}" if data.get("doi") else "",
            },
        }

    def _field_begin(self) -> None:
        self.fields.append(Field())

    def _field_separate(self, out: List) -> None:
        if not self.fields:
            return
        current = self.fields[-1]
        current.phase = "result"
        current.kind = classify_field(current.instr)
        if current.kind == "toc" and not self.toc_emitted:
            self.toc_emitted = True
            self._pending_blocks.append({"id": new_id(), "type": "tableOfContents", "props": {}, "children": []})

    def _field_end(self, out: List) -> None:
        if not self.fields:
            return
        current = self.fields.pop()
        if current.phase == "instr":
            # A field without a separate (no cached result).
            current.kind = classify_field(current.instr)
            if current.kind == "toc" and not self.toc_emitted:
                self.toc_emitted = True
                self._pending_blocks.append({"id": new_id(), "type": "tableOfContents", "props": {}, "children": []})
            return
        if current.kind == "citation":
            self._emit(out, self._citation_item(current.instr, current.result))

    def _image(self, drawing, out: List, para_props: dict) -> None:
        blip = drawing.find(".//{%s}blip" % NS["a"])
        rel_id = blip.get(R + "embed") if blip is not None else None
        if rel_id is None:
            imagedata = drawing.find(".//{%s}imagedata" % NS["v"])
            rel_id = imagedata.get(R + "id") if imagedata is not None else None
        text_box = drawing.find(".//{%s}txbxContent" % NS["w"])
        if rel_id is None:
            if text_box is not None:
                self._warn("Text boxes were turned into normal paragraphs.")
                self._pending_text_boxes.append(text_box)
            elif drawing.find(".//{http://schemas.openxmlformats.org/drawingml/2006/chart}chart") is not None:
                self._warn("Charts were kept as a placeholder; insert them again as images.")
                self._emit(out, self._text_item("[Chart]", {"italic": True}))
            elif drawing.find(".//{http://schemas.openxmlformats.org/drawingml/2006/diagram}relIds") is not None:
                self._warn("SmartArt was kept as a placeholder.")
                self._emit(out, self._text_item("[Diagram]", {"italic": True}))
            return
        rel = self.rels.get(rel_id)
        if not rel:
            return
        path = self._part_path(rel["target"])
        data = self._read(path)
        if not data:
            return
        extension = path.rsplit(".", 1)[-1].lower()
        content_type = CONTENT_TYPES.get(extension, "application/octet-stream")
        extent = drawing.find(".//{%s}extent" % NS["wp"])
        width_px = int(int(extent.get("cx", "0")) / EMU_PER_PX) if extent is not None else 0
        name = ""
        doc_pr = drawing.find(".//{%s}docPr" % NS["wp"])
        if doc_pr is not None:
            name = doc_pr.get("descr") or doc_pr.get("title") or doc_pr.get("name") or ""
        if extension in ("emf", "wmf"):
            self._warn("Some images are in an old Windows format (EMF/WMF) and may not show.")
        url = self.image_sink(data, content_type, posixpath.basename(path)) if self.image_sink else \
            f"data:{content_type};base64,{base64.b64encode(data).decode()}"
        self.stats["images"] += 1
        self._split_block = {
            "id": new_id(),
            "type": "image",
            "props": {
                "url": url,
                "caption": "",
                "name": name[:200],
                "showPreview": True,
                "previewWidth": max(24, min(width_px or PAGE_CONTENT_WIDTH_PX, PAGE_CONTENT_WIDTH_PX)),
                "textAlignment": para_props.get("textAlignment", "left"),
                "backgroundColor": "default",
            },
            "children": [],
        }

    def _runs(self, element, out: List, base: RunFormat, para_style: Optional[str], para_props: dict, suggestion: Optional[str] = None) -> None:
        """Inline content of a paragraph (or a container inside it) into `out`."""
        for child in element:
            if not isinstance(child.tag, str):
                continue
            tag = child.tag
            name = local(child)
            if tag == W + "r":
                self._run(child, out, base, para_style, para_props, suggestion)
            elif tag == W + "hyperlink":
                rel = self.rels.get(child.get(R + "id") or "")
                inner: List = []
                self._runs(child, inner, base, para_style, para_props, suggestion)
                texts = [item for item in inner if isinstance(item, dict) and item.get("type") == "text"]
                if rel and rel.get("mode") == "External" and texts:
                    link = {"type": "link", "href": rel["target"], "content": texts}
                    others = [item for item in inner if item not in texts]
                    out.append(link)
                    out.extend(others)
                else:
                    out.extend(inner)
            elif tag in (W + "ins", W + "moveTo"):
                self.stats["trackedChanges"] += 1
                marker = f"{wattr(child, 'id') or new_id()}|{wattr(child, 'author') or ''}|{wattr(child, 'date') or ''}"
                self._runs(child, out, base, para_style, para_props, "ins:" + marker)
            elif tag in (W + "del", W + "moveFrom"):
                self.stats["trackedChanges"] += 1
                marker = f"{wattr(child, 'id') or new_id()}|{wattr(child, 'author') or ''}|{wattr(child, 'date') or ''}"
                self._runs(child, out, base, para_style, para_props, "del:" + marker)
            elif tag == W + "fldSimple":
                instr = wattr(child, "instr") or ""
                kind = classify_field(instr)
                inner = []
                self._runs(child, inner, base, para_style, para_props, suggestion)
                if kind == "citation":
                    self._emit(out, self._citation_item(instr, [i for i in inner if isinstance(i, dict) and i.get("type") == "text"]))
                elif kind == "hyperlink":
                    match = re.search(r'HYPERLINK\s+"([^"]+)"', instr, re.IGNORECASE)
                    texts = [i for i in inner if isinstance(i, dict) and i.get("type") == "text"]
                    out.append({"type": "link", "href": match.group(1), "content": texts} if match and texts else None)
                    out[:] = [item for item in out if item is not None]
                elif kind == "toc":
                    if not self.toc_emitted:
                        self.toc_emitted = True
                        self._pending_blocks.append({"id": new_id(), "type": "tableOfContents", "props": {}, "children": []})
                else:
                    out.extend(inner)
            elif tag in (W + "smartTag", W + "customXml", W + "dir", W + "bdo"):
                self._runs(child, out, base, para_style, para_props, suggestion)
            elif tag == W + "sdt":
                content = child.find(W + "sdtContent")
                if content is not None:
                    self._runs(content, out, base, para_style, para_props, suggestion)
            elif tag in (M + "oMath", M + "oMathPara"):
                latex = omml_to_latex(child)
                if latex:
                    self.stats["equations"] += 1
                    self._emit(out, {"type": "aiMath", "props": {"latex": latex, "displayMode": "true" if name == "oMathPara" else "false"}})
            elif tag == W + "commentRangeStart":
                comment_id = wattr(child, "id") or ""
                self.open_comments.append(comment_id)
                self.comment_anchor.setdefault(comment_id, {"blockId": self._current_block_id, "text": []})
            elif tag == W + "commentRangeEnd":
                comment_id = wattr(child, "id") or ""
                if comment_id in self.open_comments:
                    self.open_comments.remove(comment_id)
            elif name == "AlternateContent":
                choice = child.find("{%s}Choice" % NS["mc"])
                fallback = child.find("{%s}Fallback" % NS["mc"])
                before = len(out)
                if choice is not None:
                    self._runs(choice, out, base, para_style, para_props, suggestion)
                if len(out) == before and self._split_block is None and fallback is not None:
                    self._runs(fallback, out, base, para_style, para_props, suggestion)

    def _run(self, run, out: List, base: RunFormat, para_style: Optional[str], para_props: dict, suggestion: Optional[str]) -> None:
        rpr = run.find(W + "rPr")
        char_style = wattr(rpr.find(W + "rStyle"), "val") if rpr is not None and rpr.find(W + "rStyle") is not None else None
        effective = self.sheet.paragraph_run_format(para_style).merged(self.sheet.character_format(char_style)).merged(
            parse_run_format(rpr, self.sheet.theme_fonts))
        styles = self._run_styles(effective, base)
        if suggestion:
            kind, marker = suggestion.split(":", 1)
            styles["suggestionInsert" if kind == "ins" else "suggestionDelete"] = marker
        caps = effective.caps
        for node in run:
            if not isinstance(node.tag, str):
                continue
            tag = node.tag
            if tag in (W + "t", W + "delText"):
                if self.fields and self.fields[-1].phase == "instr":
                    continue
                text = node.text or ""
                if caps:
                    text = text.upper()
                if text:
                    self._emit(out, self._text_item(text, styles))
            elif tag == W + "instrText":
                if self.fields:
                    self.fields[-1].instr += node.text or ""
            elif tag == W + "fldChar":
                state = wattr(node, "fldCharType")
                if state == "begin":
                    self._field_begin()
                elif state == "separate":
                    self._field_separate(out)
                elif state == "end":
                    self._field_end(out)
            elif tag == W + "tab":
                self._emit(out, self._text_item("\t", styles))
            elif tag in (W + "br", W + "cr"):
                if wattr(node, "type") == "page":
                    self.stats["pageBreaks"] += 1
                    self._split_block = {"id": new_id(), "type": "pageBreak", "props": {}, "children": []}
                    self._flush_split(out, para_props)
                elif wattr(node, "type") != "column":
                    self._emit(out, self._text_item("\n", styles))
            elif tag == W + "noBreakHyphen":
                self._emit(out, self._text_item("‑", styles))
            elif tag == W + "sym":
                code = wattr(node, "char") or ""
                try:
                    value = int(code, 16)
                    if value >= 0xF000:
                        value -= 0xF000
                    self._emit(out, self._text_item(chr(value), styles))
                except ValueError:
                    pass
            elif tag in (W + "footnoteReference", W + "endnoteReference"):
                kind = "footnote" if tag == W + "footnoteReference" else "endnote"
                notes = self.footnotes if kind == "footnote" else self.endnotes
                self.stats["footnotes"] += 1
                self._emit(out, {"type": "footnote", "props": {"text": notes.get(wattr(node, "id") or "", ""), "kind": kind}})
            elif tag in (W + "drawing", W + "pict", W + "object"):
                self._image(node, out, para_props)
                self._flush_split(out, para_props)
            elif local(node) == "AlternateContent":
                self._runs(node, out, base, para_style, para_props, suggestion)
                self._flush_split(out, para_props)

    # ------------------------------------------------------------ blocks

    def _flush_split(self, out: List, para_props: dict) -> None:
        """An image or page break inside a paragraph splits it: text before, the block, text after."""
        if self._split_block is None:
            return
        self._split_points.append((len(out), self._split_block))
        self._split_block = None

    def _para_props(self, effective: ParaFormat, base: ParaFormat, style_id: Optional[str], keep_style: bool) -> dict:
        props: Dict[str, object] = {}
        if effective.align and effective.align != "left":
            props["textAlignment"] = effective.align
        if effective.shading and effective.shading not in ("#FFFFFF",):
            props["backgroundColor"] = effective.shading
        if effective.space_before is not None and effective.space_before != base.space_before:
            props["spaceBefore"] = fmt_pt(effective.space_before)
        if effective.space_after is not None and effective.space_after != base.space_after:
            props["spaceAfter"] = fmt_pt(effective.space_after)
        if effective.line and effective.line != base.line:
            props["lineSpacing"] = effective.line
        if effective.indent_left and effective.indent_left != (base.indent_left or 0):
            props["indentLeft"] = fmt_pt(effective.indent_left)
        if effective.indent_right and effective.indent_right != (base.indent_right or 0):
            props["indentRight"] = fmt_pt(effective.indent_right)
        if effective.indent_first and effective.indent_first != (base.indent_first or 0):
            props["indentFirst"] = fmt_pt(effective.indent_first)
        if keep_style and style_id and style_id != self.normal_style:
            props["wordStyle"] = style_id
        return props

    def _paragraph(self, paragraph, container: List[dict]) -> None:
        ppr = paragraph.find(W + "pPr")
        style_node = ppr.find(W + "pStyle") if ppr is not None else None
        style_id = wattr(style_node, "val") if style_node is not None else self.normal_style
        direct = parse_para_format(ppr)
        effective = self.sheet.paragraph_format(style_id).merged(direct)
        self._current_block_id = new_id()
        in_toc = any(item.kind == "toc" for item in self.fields)

        heading_level = self.sheet.heading_level(style_id, direct if direct.outline_level is not None else effective)
        level = self.sheet.numbering.level(effective.num_id, effective.ilvl or 0) if effective.num_id not in (None, "0") else None
        if heading_level:
            block_type, base_para, base_run = "heading", self.sheet.paragraph_format(style_id), self.sheet.paragraph_run_format(style_id)
        elif level is not None:
            block_type = "bulletListItem" if level.fmt in ("bullet", "none") else "numberedListItem"
            base_para, base_run = self.normal_para, self.normal_run
        elif self.sheet.is_quote(style_id):
            block_type, base_para, base_run = "quote", self.sheet.paragraph_format(style_id), self.sheet.paragraph_run_format(style_id)
        else:
            block_type, base_para, base_run = "paragraph", self.normal_para, self.normal_run

        if effective.page_break_before:
            container.append({"id": new_id(), "type": "pageBreak", "props": {}, "children": []})
            self.stats["pageBreaks"] += 1

        props = self._para_props(effective, base_para, style_id,
                                 keep_style=block_type in ("paragraph", "quote", "bulletListItem", "numberedListItem")
                                 or self.sheet.is_title(style_id))
        if block_type == "heading":
            props["level"] = heading_level
        if block_type in ("bulletListItem", "numberedListItem"):
            # List indentation is the editor's own; keep only the numbering reference.
            for key in ("indentLeft", "indentFirst"):
                props.pop(key, None)
            props["wordNumId"] = f"{effective.num_id}:{effective.ilvl or 0}"
            if block_type == "numberedListItem" and not self.numbered_seen.get(effective.num_id or ""):
                self.numbered_seen[effective.num_id or ""] = True
                if level and level.start != 1:
                    props["start"] = level.start

        self._split_block = None
        self._split_points: List[tuple] = []
        self._pending_blocks: List[dict] = []
        self._pending_text_boxes: List = []
        content: List = []
        self._runs(paragraph, content, base_run, style_id, props)

        for item in self._pending_blocks:
            container.append(item)
        if in_toc and any(item.kind == "toc" for item in self.fields):
            return

        # Pieces split by images/page breaks: [text][image][text]...
        pieces: List[tuple] = []
        start = 0
        for index, block in self._split_points:
            pieces.append(("content", content[start:index]))
            pieces.append(("block", block))
            start = index
        pieces.append(("content", content[start:]))

        first_content = True
        for kind, value in pieces:
            if kind == "block":
                self._close_list_if_needed(block_type)
                container.append(value)
                continue
            has_text = any(not (isinstance(item, dict) and item.get("type") == "text" and not item["text"].strip()) for item in value)
            if not value and not first_content:
                continue
            if not has_text and len(pieces) > 1 and not first_content:
                continue
            block = {"id": self._current_block_id if first_content else new_id(), "type": block_type, "props": dict(props),
                     "content": self._merge_text(value), "children": []}
            math = [item for item in block["content"] if not (item.get("type") == "text" and not item.get("text", "").strip())]
            if block_type == "paragraph" and len(math) == 1 and math[0].get("type") == "aiMath" \
                    and math[0]["props"].get("displayMode") == "true":
                # A display equation on its own line is an equation block in the editor.
                block = {"id": block["id"], "type": "equation", "props": {"latex": math[0]["props"].get("latex", ""), "autoOpen": "false"},
                         "children": []}
            first_content = False
            depth = None
            if block_type.endswith("ListItem"):
                # Word nests lists by level and/or indentation (e.g. "List Bullet 2"). As in Word,
                # the paragraph's own indent wins, then the numbering level's, then the style's
                # ("List Paragraph" indents every level alike, which flattened nested lists).
                indent = direct.indent_left
                if indent is None and level is not None:
                    indent = level.indent_left
                if indent is None:
                    indent = self.sheet.paragraph_format(style_id).indent_left
                depth = (indent if indent is not None else 36 * ((effective.ilvl or 0) + 1)) + (effective.ilvl or 0) * 0.01
            self._place(block, container, depth)

        for text_box in self._pending_text_boxes:
            for inner in text_box.findall(W + "p"):
                self._paragraph(inner, container)

        if ppr is not None and ppr.find(W + "sectPr") is not None:
            section = self._section(ppr.find(W + "sectPr"))
            section["endsAfterBlockId"] = self._last_block_id(container)
            self.sections.append(section)
            container.append({"id": new_id(), "type": "pageBreak", "props": {}, "children": []})

    @staticmethod
    def _last_block_id(container: List[dict]) -> Optional[str]:
        return container[-1]["id"] if container else None

    @staticmethod
    def _merge_text(items: List) -> List:
        merged: List = []
        for item in items:
            if isinstance(item, dict) and item.get("type") == "text" and merged and isinstance(merged[-1], dict) \
                    and merged[-1].get("type") == "text" and merged[-1]["styles"] == item["styles"]:
                merged[-1]["text"] += item["text"]
            else:
                merged.append(item)
        return merged

    def _close_list_if_needed(self, block_type: str) -> None:
        if not block_type.endswith("ListItem"):
            self.list_stack = []

    def _place(self, block: dict, container: List[dict], depth: Optional[float]) -> None:
        self._checklist_from_glyph(block)
        if block["type"] == "heading":
            self.stats["headings"] += 1
        elif block["type"].endswith("ListItem"):
            self.stats["listItems"] += 1
        else:
            self.stats["paragraphs"] += 1
        if depth is None:
            self.list_stack = []
            container.append(block)
            return
        while self.list_stack and self.list_stack[-1][0] >= depth - 1:
            self.list_stack.pop()
        if self.list_stack:
            self.list_stack[-1][1]["children"].append(block)
        else:
            container.append(block)
        self.list_stack.append((depth, block))

    @staticmethod
    def _checklist_from_glyph(block: dict) -> None:
        """Checklists exported as "☒ Done" / "☐ Open" bullets come back as checklist items."""
        content = block.get("content")
        if block.get("type") != "bulletListItem" or not isinstance(content, list) or not content:
            return
        first = content[0]
        if not isinstance(first, dict) or first.get("type") != "text":
            return
        text = first.get("text") or ""
        if text[:1] not in ("☒", "☑", "☐") or text[1:2] not in (" ", "\u00a0"):
            return
        first["text"] = text[2:]
        if not first["text"]:
            content.pop(0)
        props = {key: value for key, value in (block.get("props") or {}).items() if key != "wordNumId"}
        block["type"] = "checkListItem"
        block["props"] = {**props, "checked": text[0] != "☐"}

    def _table(self, table, container: List[dict]) -> None:
        self.list_stack = []
        self.stats["tables"] += 1
        grid = [to_number(wattr(col, "w")) or 0 for col in table.findall(f"{W}tblGrid/{W}gridCol")]
        rows_out: List[dict] = []
        header_rows = 0
        vertical: Dict[int, dict] = {}  # grid column -> cell that started a vertical merge
        for row_index, row in enumerate(table.findall(W + "tr")):
            trpr = row.find(W + "trPr")
            if trpr is not None and trpr.find(W + "tblHeader") is not None and header_rows == row_index:
                header_rows += 1
            cells_out: List[dict] = []
            column = 0
            for cell in row.findall(W + "tc"):
                tcpr = cell.find(W + "tcPr")
                span = int(to_number(wattr(tcpr.find(W + "gridSpan"), "val")) or 1) if tcpr is not None and tcpr.find(W + "gridSpan") is not None else 1
                vmerge = tcpr.find(W + "vMerge") if tcpr is not None else None
                if vmerge is not None and (wattr(vmerge, "val") or "continue") == "continue" and column in vertical:
                    vertical[column]["props"]["rowspan"] += 1
                    column += span
                    continue
                shading = tcpr.find(W + "shd") if tcpr is not None else None
                fill = wattr(shading, "fill") if shading is not None else None
                content: List = []
                alignment = "left"
                paragraphs = cell.findall(".//" + W + "p")
                for index, paragraph in enumerate(paragraphs):
                    ppr = paragraph.find(W + "pPr")
                    style = wattr(ppr.find(W + "pStyle"), "val") if ppr is not None and ppr.find(W + "pStyle") is not None else self.normal_style
                    fmt = self.sheet.paragraph_format(style).merged(parse_para_format(ppr))
                    if index == 0 and fmt.align:
                        alignment = fmt.align
                    if index > 0:
                        content.append(self._text_item("\n", {}))
                    self._split_block = None
                    self._split_points = []
                    self._pending_blocks = []
                    self._pending_text_boxes = []
                    self._current_block_id = new_id()
                    self._runs(paragraph, content, self.normal_run, style, {})
                cell_out = {
                    "type": "tableCell",
                    "props": {
                        "backgroundColor": "#" + fill.upper() if fill and fill not in ("auto", "FFFFFF") else "default",
                        "textColor": "default",
                        "textAlignment": alignment if alignment in ("left", "center", "right", "justify") else "left",
                        "colspan": span,
                        "rowspan": 1,
                    },
                    "content": self._merge_text([item for item in content if isinstance(item, dict) and item.get("type") in ("text", "link", "aiCitation", "aiMath", "footnote")]),
                }
                if vmerge is not None and wattr(vmerge, "val") == "restart":
                    vertical[column] = cell_out
                else:
                    vertical.pop(column, None)
                cells_out.append(cell_out)
                column += span
            rows_out.append({"cells": cells_out})
        widths = [round(width / 15) for width in grid] if grid else None
        block = {"id": new_id(), "type": "table", "props": {"textColor": "default"},
                 "content": {"type": "tableContent", "rows": rows_out}, "children": []}
        if widths and all(widths):
            block["content"]["columnWidths"] = widths
        if header_rows:
            block["content"]["headerRows"] = header_rows
        container.append(block)

    def _body(self, element, container: List[dict]) -> None:
        for child in element:
            if not isinstance(child.tag, str):
                continue
            if child.tag == W + "p":
                self._paragraph(child, container)
            elif child.tag == W + "tbl":
                self._table(child, container)
            elif child.tag == W + "sdt":
                gallery = child.find(f".//{W}docPartGallery")
                content = child.find(W + "sdtContent")
                if gallery is not None and "Table of Contents" in (wattr(gallery, "val") or ""):
                    if not self.toc_emitted:
                        self.toc_emitted = True
                        container.append({"id": new_id(), "type": "tableOfContents", "props": {}, "children": []})
                    continue
                if content is not None:
                    self._body(content, container)
            elif child.tag in (W + "customXml",):
                self._body(child, container)

    # ------------------------------------------------------------ entry point

    def read(self) -> dict:
        body = self.document.find(W + "body")
        self._split_block = None
        self._split_points = []
        self._pending_blocks = []
        self._pending_text_boxes = []
        self._current_block_id = new_id()
        self._body(body, self.blocks)
        if not self.blocks:
            self.blocks.append({"id": new_id(), "type": "paragraph", "props": {}, "content": [], "children": []})

        final = body.find(W + "sectPr")
        settings: Dict[str, object] = {"version": 1, "styles": self._style_summary()}
        if final is not None:
            page = self._section(final)
            settings["page"] = page
            all_sections = [node for node in body.iter(W + "sectPr")]
            header = self._header_footer(all_sections, "header")
            footer = self._header_footer(all_sections, "footer")
            if header:
                settings["header"] = header
            if footer:
                settings["footer"] = footer
            settings["differentFirstPage"] = final.find(W + "titlePg") is not None and on(final.find(W + "titlePg"))
            numbering = final.find(W + "pgNumType")
            if numbering is not None and to_number(wattr(numbering, "start")):
                settings["pageNumberStart"] = int(to_number(wattr(numbering, "start")))
        if self.sections:
            settings["sections"] = self.sections

        comments = self._comment_threads()
        self.stats["comments"] = len(comments)
        return {"blocks": self.blocks, "settings": settings, "comments": comments, "warnings": self.warnings, "stats": self.stats}

    def _comment_threads(self) -> List[dict]:
        by_para = {meta["paraId"]: comment_id for comment_id, meta in self.comment_meta.items() if meta.get("paraId")}
        roots: Dict[str, dict] = {}
        replies: List[tuple] = []
        for comment_id, meta in self.comment_meta.items():
            parent = by_para.get(meta.get("parent") or "")
            if parent and parent != comment_id:
                replies.append((parent, meta))
                continue
            anchor = self.comment_anchor.get(comment_id, {})
            roots[comment_id] = {
                "id": new_id(),
                "actorSessionId": "word-import",
                "actorDisplayName": meta["author"],
                "text": meta["text"],
                "selectedText": "".join(anchor.get("text", [])).strip()[:1000],
                "blockId": anchor.get("blockId"),
                "createdAt": meta["created"],
                "status": "resolved" if meta.get("done") else "open",
                "replies": [],
            }
        for parent, meta in replies:
            if parent in roots:
                roots[parent]["replies"].append({
                    "id": new_id(), "actorSessionId": "word-import", "actorDisplayName": meta["author"],
                    "text": meta["text"], "createdAt": meta["created"],
                })
        return list(roots.values())


def on(element) -> bool:
    value = wattr(element, "val")
    return value is None or value.lower() not in {"0", "false", "off"}


def read_docx(data: bytes, image_sink: Optional[ImageSink] = None) -> dict:
    return WordReader(data, image_sink).read()
