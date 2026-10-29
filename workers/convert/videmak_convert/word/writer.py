"""AI Editor document -> Word (.docx).

When the document came from a Word file, that file is the template: its styles, theme,
numbering, headers, footers and settings are kept and only the body, footnotes and
comments are written anew, so the round trip comes back looking the same. Otherwise a
template with the editor's look (Times New Roman 12 pt) is used.

Citations become Zotero fields (Word + Zotero, LibreOffice and Mendeley read them),
suggestions become tracked changes, footnotes and comments become Word's own, equations
become Word equations and the table of contents becomes a TOC field.
"""

from __future__ import annotations

import base64
import copy
import io
import json
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

from lxml import etree

from .math import latex_to_omml
from .ooxml import HEX_HIGHLIGHT, NS, R, W, order_properties, parse_xml, q, to_number, wattr

ImageLoader = Callable[[str], Optional[Tuple[bytes, str]]]  # url -> (data, content_type)

DOCUMENT_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg", "image/webp": "png"}

DEFAULT_STYLES = {
    "normal": {"fontFamily": "Times New Roman", "fontSize": "12", "lineSpacing": "1.35", "spaceAfter": "2"},
    "headings": {
        "1": {"fontSize": "18.5", "bold": True, "spaceBefore": "12", "spaceAfter": "4"},
        "2": {"fontSize": "15.5", "bold": True, "spaceBefore": "10", "spaceAfter": "4"},
        "3": {"fontSize": "13.5", "bold": True, "spaceBefore": "10", "spaceAfter": "3"},
        "4": {"fontSize": "12", "bold": True, "spaceBefore": "8", "spaceAfter": "2"},
        "5": {"fontSize": "11.5", "bold": True, "spaceBefore": "8", "spaceAfter": "2"},
        "6": {"fontSize": "11.5", "bold": True, "italic": True, "spaceBefore": "8", "spaceAfter": "2"},
    },
}


def w(tag: str, attrs: Optional[Dict[str, str]] = None, *children):
    element = etree.Element(q("w:" + tag) if ":" not in tag else q(tag))
    for key, value in (attrs or {}).items():
        element.set(q("w:" + key) if ":" not in key else q(key), str(value))
    for child in children:
        if child is not None:
            element.append(child)
    return element


def pt_to_twips(value) -> int:
    return int(round(float(value) * 20))


def size_to_half_points(value: str) -> Optional[int]:
    match = re.match(r"\s*([\d.]+)\s*(pt|px|em|rem)?", str(value or ""))
    if not match:
        return None
    number, unit = float(match.group(1)), (match.group(2) or "pt")
    points = number * 0.75 if unit == "px" else number * 12 if unit in ("em", "rem") else number
    return max(2, int(round(points * 2)))


def css_color_hex(value: str) -> Optional[str]:
    value = (value or "").strip()
    if not value or value == "default":
        return None
    named = {"red": "E03E3E", "orange": "D9730D", "yellow": "DFAB01", "green": "4D6461", "blue": "0B6E99", "purple": "6940A5",
             "pink": "AD1A72", "brown": "64473A", "gray": "9B9A97", "black": "000000", "white": "FFFFFF"}
    if value.lower() in named:
        return named[value.lower()]
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value)
    if match:
        return match.group(1).upper()
    match = re.fullmatch(r"#?([0-9a-fA-F]{3})", value)
    if match:
        return "".join(c * 2 for c in match.group(1)).upper()
    match = re.fullmatch(r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)", value)
    if match:
        return "".join(f"{int(part):02X}" for part in match.groups())
    return None


def parse_bibtex(bibtex: str) -> dict:
    """Minimal BibTeX -> CSL-JSON item, for citation field codes."""
    fields = {key.lower(): value.strip().strip("{}").strip() for key, value in
              re.findall(r"(\w+)\s*=\s*[{\"](.*?)[}\"]\s*(?:,\s*(?=\w+\s*=)|,?\s*}\s*$|\n)", bibtex, re.S)}
    kind_match = re.match(r"\s*@(\w+)", bibtex)
    kind = {"article": "article-journal", "book": "book", "incollection": "chapter", "inproceedings": "paper-conference",
            "phdthesis": "thesis", "mastersthesis": "thesis", "techreport": "report"}.get((kind_match.group(1) if kind_match else "").lower(), "article-journal")
    authors = []
    for name in re.split(r"\s+and\s+", fields.get("author", "")):
        name = name.strip()
        if not name:
            continue
        if "," in name:
            family, given = [part.strip() for part in name.split(",", 1)]
        else:
            parts = name.split()
            family, given = parts[-1], " ".join(parts[:-1])
        authors.append({"family": family, "given": given})
    item = {"type": kind, "title": fields.get("title", "Untitled"), "author": authors}
    if fields.get("year", "").isdigit():
        item["issued"] = {"date-parts": [[int(fields["year"])]]}
    for source, target in (("journal", "container-title"), ("booktitle", "container-title"), ("volume", "volume"),
                           ("number", "issue"), ("pages", "page"), ("publisher", "publisher"), ("doi", "DOI"), ("url", "URL")):
        if fields.get(source):
            item[target] = fields[source]
    return item


class WordWriter:
    def __init__(self, blocks: List[dict], settings: Optional[dict], comments: Optional[List[dict]], title: str,
                 source: Optional[bytes], image_loader: Optional[ImageLoader] = None, author: str = "Videmak"):
        self.blocks = blocks or []
        self.settings = settings or {}
        self.comments = [c for c in (comments or []) if c.get("text")]
        self.title = title or "Document"
        self.author = author
        self.image_loader = image_loader
        self.source = source
        self.parts: Dict[str, bytes] = {}
        if source:
            with zipfile.ZipFile(io.BytesIO(source)) as package:
                for name in package.namelist():
                    self.parts[name] = package.read(name)
        else:
            self.parts = self._template_parts()
        self.document = parse_xml(self.parts["word/document.xml"])
        self.rels = parse_xml(self.parts["word/_rels/document.xml.rels"])
        self.content_types = parse_xml(self.parts["[Content_Types].xml"])
        styles = self.parts.get("word/styles.xml")
        self.style_ids = set(re.findall(rb'w:styleId="([^"]+)"', styles or b""))
        self.style_names = {name.lower(): sid for sid, name in re.findall(rb'w:styleId="([^"]+)"[^>]*>\s*<w:name w:val="([^"]+)"', styles or b"")} if styles else {}
        self.rel_counter = 0
        self.footnotes: List[Tuple[int, str]] = []
        self.media_counter = 0
        self.change_id = 9000
        self.bookmark_id = 9000
        self.numbering = parse_xml(self.parts["word/numbering.xml"]) if "word/numbering.xml" in self.parts else None
        self.existing_num_ids = set(n.get(W + "numId") for n in self.numbering.findall(W + "num")) if self.numbering is not None else set()
        self.bullet_num: Optional[str] = None
        self.list_runs: Dict[str, str] = {}
        self.current_numbered: Optional[str] = None
        self.comment_by_block: Dict[str, List[dict]] = {}
        for comment in self.comments:
            if comment.get("blockId"):
                self.comment_by_block.setdefault(comment["blockId"], []).append(comment)
        self.comment_ids: Dict[str, int] = {}
        self.sections = {s.get("endsAfterBlockId"): s for s in self.settings.get("sections") or [] if s.get("endsAfterBlockId")}

    # ------------------------------------------------------------ template

    def _template_parts(self) -> Dict[str, bytes]:
        from docx import Document
        from docx.oxml.ns import qn
        from docx.shared import Pt

        document = Document()
        styles = self.settings.get("styles") or DEFAULT_STYLES
        normal_info = styles.get("normal") or DEFAULT_STYLES["normal"]
        normal = document.styles["Normal"]
        normal.font.name = normal_info.get("fontFamily", "Times New Roman")
        normal.font.size = Pt(float(normal_info.get("fontSize", 12)))
        fonts = normal.element.get_or_add_rPr().get_or_add_rFonts()
        for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            fonts.set(qn(attribute), normal.font.name)
        normal.paragraph_format.space_after = Pt(float(normal_info.get("spaceAfter", 0)))
        normal.paragraph_format.space_before = Pt(float(normal_info.get("spaceBefore", 0)))
        line = str(normal_info.get("lineSpacing", "1.35"))
        if ":" not in line:
            normal.paragraph_format.line_spacing = float(line)
        for level in range(1, 7):
            info = (styles.get("headings") or {}).get(str(level)) or DEFAULT_STYLES["headings"][str(level)]
            style = document.styles[f"Heading {level}"]
            style.font.name = info.get("fontFamily", normal.font.name)
            heading_fonts = style.element.get_or_add_rPr().get_or_add_rFonts()
            for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
                heading_fonts.set(qn(attribute), style.font.name)
            for theme_attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
                if heading_fonts.get(qn(theme_attr)) is not None:
                    del heading_fonts.attrib[qn(theme_attr)]
            style.font.size = Pt(float(info.get("fontSize", 12)))
            style.font.bold = bool(info.get("bold", True))
            style.font.italic = bool(info.get("italic", False))
            color = css_color_hex(info.get("color", "")) or "000000"
            from docx.shared import RGBColor

            style.font.color.rgb = RGBColor.from_string(color)
            style.paragraph_format.space_before = Pt(float(info.get("spaceBefore", 10)))
            style.paragraph_format.space_after = Pt(float(info.get("spaceAfter", 4)))
        buffer = io.BytesIO()
        document.save(buffer)
        with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as package:
            return {name: package.read(name) for name in package.namelist()}

    # ------------------------------------------------------------ package plumbing

    def _rel(self, rel_type: str, target: str, external: bool = False) -> str:
        if not external:
            for rel in self.rels:
                if rel.get("Type") == f"{REL}/{rel_type}" and rel.get("Target") == target:
                    return rel.get("Id")
        self.rel_counter += 1
        rel_id = f"rIdVdm{self.rel_counter}"
        node = etree.SubElement(self.rels, "{%s}Relationship" % NS["rel"])
        node.set("Id", rel_id)
        node.set("Type", f"{REL}/{rel_type}")
        node.set("Target", target)
        if external:
            node.set("TargetMode", "External")
        return rel_id

    def _override(self, part: str, content_type: str) -> None:
        for node in self.content_types:
            if node.get("PartName") == part:
                return
        node = etree.SubElement(self.content_types, "{%s}Override" % NS["ct"])
        node.set("PartName", part)
        node.set("ContentType", content_type)

    def _default(self, extension: str, content_type: str) -> None:
        for node in self.content_types:
            if node.get("Extension", "").lower() == extension:
                return
        node = etree.Element("{%s}Default" % NS["ct"])
        node.set("Extension", extension)
        node.set("ContentType", content_type)
        self.content_types.insert(0, node)

    def _style(self, *candidates: str) -> Optional[str]:
        for candidate in candidates:
            if not candidate:
                continue
            if candidate.encode() in self.style_ids:
                return candidate
            by_name = self.style_names.get(candidate.lower().encode())
            if by_name:
                return by_name.decode()
        return None

    # ------------------------------------------------------------ numbering

    def _ensure_numbering(self) -> None:
        if self.numbering is None:
            self.numbering = etree.fromstring(f'<w:numbering xmlns:w="{NS["w"]}"/>'.encode())
            self.parts["word/numbering.xml"] = b""
            self._rel("numbering", "numbering.xml")
            self._override("/word/numbering.xml", f"{DOCUMENT_CT}.numbering+xml")

    def _abstract(self, kind: str) -> str:
        self._ensure_numbering()
        abstract_ids = [int(n.get(W + "abstractNumId")) for n in self.numbering.findall(W + "abstractNum")] or [0]
        new_id = str(max(abstract_ids) + 1)
        abstract = w("abstractNum", {"abstractNumId": new_id}, w("multiLevelType", {"val": "hybridMultilevel"}))
        bullets = ["•", "◦", "▪"]
        number_formats = ["decimal", "lowerLetter", "lowerRoman"]
        for level in range(9):
            if kind == "bullet":
                fmt, text = "bullet", bullets[level % 3]
            else:
                fmt, text = number_formats[level % 3], f"%{level + 1}."
            abstract.append(w("lvl", {"ilvl": str(level)},
                              w("start", {"val": "1"}), w("numFmt", {"val": fmt}), w("lvlText", {"val": text}),
                              w("lvlJc", {"val": "left"}),
                              w("pPr", None, w("ind", {"left": str(720 + 360 * level), "hanging": "360"}))))
        # abstractNum elements must come before num elements.
        first_num = self.numbering.find(W + "num")
        if first_num is not None:
            first_num.addprevious(abstract)
        else:
            self.numbering.append(abstract)
        return new_id

    def _new_num(self, abstract_id: str, start: Optional[int] = None) -> str:
        num_ids = [int(n) for n in self.existing_num_ids if n and n.isdigit()] or [0]
        new_id = str(max(num_ids) + 1)
        self.existing_num_ids.add(new_id)
        num = w("num", {"numId": new_id}, w("abstractNumId", {"val": abstract_id}))
        if start and start != 1:
            num.append(w("lvlOverride", {"ilvl": "0"}, w("startOverride", {"val": str(start)})))
        self.numbering.append(num)
        return new_id

    def _num_for(self, block: dict, depth: int) -> Tuple[str, int]:
        word_num = str(block.get("props", {}).get("wordNumId") or "")
        num_id, _, stored_level = word_num.partition(":")
        if num_id and num_id in self.existing_num_ids and self.source:
            # The source's own list keeps its own level (nesting may come from the style's indent).
            return num_id, int(stored_level) if stored_level.isdigit() else depth
        if block["type"] == "bulletListItem" or block["type"] == "checkListItem":
            if not self.bullet_num:
                self.bullet_num = self._new_num(self._abstract("bullet"))
            return self.bullet_num, depth
        if depth == 0 and self.current_numbered is None:
            if not hasattr(self, "_decimal_abstract"):
                self._decimal_abstract = self._abstract("decimal")
            self.current_numbered = self._new_num(self._decimal_abstract, block.get("props", {}).get("start"))
        if self.current_numbered is None:
            if not hasattr(self, "_decimal_abstract"):
                self._decimal_abstract = self._abstract("decimal")
            self.current_numbered = self._new_num(self._decimal_abstract)
        return self.current_numbered, depth

    # ------------------------------------------------------------ runs

    def _rpr(self, styles: dict):
        rpr = w("rPr")
        font = styles.get("fontFamily")
        if font:
            font = font.split(",")[0].strip().strip("'\"")
            rpr.append(w("rFonts", {"ascii": font, "hAnsi": font, "cs": font, "eastAsia": font}))
        if styles.get("bold") or str(styles.get("fontWeight", "")) in ("bold", "700", "800", "900"):
            rpr.append(w("b"))
        if styles.get("italic"):
            rpr.append(w("i"))
        if styles.get("strike"):
            rpr.append(w("strike"))
        color = css_color_hex(styles.get("textColor", ""))
        if color:
            rpr.append(w("color", {"val": color}))
        size = size_to_half_points(styles.get("fontSize", "")) if styles.get("fontSize") else None
        if size:
            rpr.append(w("sz", {"val": str(size)}))
            rpr.append(w("szCs", {"val": str(size)}))
        background = css_color_hex(styles.get("backgroundColor", ""))
        if background:
            named = HEX_HIGHLIGHT.get("#" + background)
            if named:
                rpr.append(w("highlight", {"val": named}))
            else:
                rpr.append(w("shd", {"val": "clear", "color": "auto", "fill": background}))
        if styles.get("underline"):
            rpr.append(w("u", {"val": "single"}))
        vertical = styles.get("verticalAlign")
        if vertical in ("super", "sub"):
            rpr.append(w("vertAlign", {"val": "superscript" if vertical == "super" else "subscript"}))
        if styles.get("code"):
            rpr.insert(0, w("rFonts", {"ascii": "Consolas", "hAnsi": "Consolas"}))
        return rpr if len(rpr) else None

    def _text_runs(self, text: str, styles: dict, deleted: bool = False) -> List:
        runs = []
        rpr = self._rpr(styles)
        parts = re.split(r"(\n|\t)", text)
        run = w("r", None, copy.deepcopy(rpr) if rpr is not None else None)
        for part in parts:
            if part == "\n":
                run.append(w("br"))
            elif part == "\t":
                run.append(w("tab"))
            elif part:
                node = w("delText" if deleted else "t")
                node.text = part
                node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                run.append(node)
        runs.append(run)
        return runs

    def _change(self, kind: str, marker: str, runs: List):
        change_id, author, date = (marker.split("|") + ["", "", ""])[:3]
        self.change_id += 1
        attrs = {"id": str(self.change_id), "author": author or self.author}
        if date:
            attrs["date"] = date
        element = w(kind, attrs)
        for run in runs:
            element.append(run)
        return element

    def _field(self, instruction: str, result_runs: List) -> List:
        begin = w("r", None, w("fldChar", {"fldCharType": "begin"}))
        instr = w("instrText")
        instr.text = f" {instruction} "
        instr.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        return [begin, w("r", None, instr), w("r", None, w("fldChar", {"fldCharType": "separate"})), *result_runs,
                w("r", None, w("fldChar", {"fldCharType": "end"}))]

    def _citation(self, props: dict) -> List:
        shown = props.get("displayText") or "(Citation)"
        payload = {}
        try:
            payload = json.loads(base64.b64decode(props.get("base64") or "").decode("utf-8", "ignore") or "{}")
        except Exception:
            try:
                payload = {"bibtex": base64.b64decode(props.get("base64") or "").decode("utf-8", "ignore")}
            except Exception:
                payload = {}
        if not isinstance(payload, dict):
            payload = {}
        code = payload.get("fieldCode")
        if code and code.strip().upper().startswith("ADDIN"):
            instruction = code.strip()
        else:
            bibtex = payload.get("bibtex") or ""
            entries = [entry for entry in re.split(r"\n\s*\n(?=\s*@)", bibtex) if entry.strip().startswith("@")]
            items = [{"id": index + 1, "uris": [], "itemData": parse_bibtex(entry)} for index, entry in enumerate(entries)]
            citation = {
                "citationID": props.get("citationId") or uuid.uuid4().hex[:8],
                "properties": {"formattedCitation": shown, "plainCitation": shown, "noteIndex": 0},
                "citationItems": items,
                "schema": "https://github.com/citation-style-language/schema/raw/master/csl-citation.json",
            }
            instruction = "ADDIN ZOTERO_ITEM CSL_CITATION " + json.dumps(citation, ensure_ascii=False)
        return self._field(instruction, self._text_runs(shown, {}))

    def _footnote(self, props: dict) -> List:
        note_id = len(self.footnotes) + 1
        self.footnotes.append((note_id, props.get("text") or ""))
        rpr = w("rPr", None, w("vertAlign", {"val": "superscript"}))
        style = self._style("FootnoteReference", "footnote reference")
        if style:
            rpr.insert(0, w("rStyle", {"val": style}))
        return [w("r", None, rpr, w("footnoteReference", {"id": str(note_id)}))]

    def _inline(self, items: List, base_styles: Optional[dict] = None) -> List:
        out: List = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            if kind == "text":
                styles = {**(base_styles or {}), **(item.get("styles") or {})}
                insert_marker = styles.pop("suggestionInsert", None)
                delete_marker = styles.pop("suggestionDelete", None)
                if delete_marker:
                    out.append(self._change("del", delete_marker, self._text_runs(item.get("text", ""), styles, deleted=True)))
                elif insert_marker:
                    out.append(self._change("ins", insert_marker, self._text_runs(item.get("text", ""), styles)))
                else:
                    out.extend(self._text_runs(item.get("text", ""), styles))
            elif kind == "link":
                href = item.get("href") or ""
                runs = self._inline(item.get("content") or [], {"underline": True, "textColor": "#0563C1", **(base_styles or {})})
                if href.startswith(("http://", "https://", "mailto:")):
                    link = w("hyperlink", {"r:id": self._rel("hyperlink", href, external=True)})
                    for run in runs:
                        link.append(run)
                    out.append(link)
                else:
                    out.extend(runs)
            elif kind == "aiCitation":
                out.extend(self._citation(item.get("props") or {}))
            elif kind == "aiMath":
                props = item.get("props") or {}
                out.append(latex_to_omml(props.get("latex") or "", display=props.get("displayMode") == "true"))
            elif kind == "footnote":
                out.extend(self._footnote(item.get("props") or {}))
            elif kind == "mention":
                out.extend(self._text_runs("@" + str((item.get("props") or {}).get("user") or (item.get("props") or {}).get("displayName") or ""), base_styles or {}))
            else:
                text = item.get("text") or (item.get("props") or {}).get("text") or ""
                if text:
                    out.extend(self._text_runs(text, base_styles or {}))
        return out

    # ------------------------------------------------------------ paragraphs

    def _ppr(self, block: dict, style_id: Optional[str] = None, num: Optional[Tuple[str, int]] = None):
        props = block.get("props") or {}
        ppr = w("pPr")
        if style_id:
            ppr.append(w("pStyle", {"val": style_id}))
        if num:
            ppr.append(w("numPr", None, w("ilvl", {"val": str(num[1])}), w("numId", {"val": num[0]})))
        background = css_color_hex(props.get("backgroundColor", ""))
        if background:
            ppr.append(w("shd", {"val": "clear", "color": "auto", "fill": background}))
        spacing = {}
        if props.get("spaceBefore") not in (None, ""):
            spacing["before"] = str(pt_to_twips(props["spaceBefore"]))
        if props.get("spaceAfter") not in (None, ""):
            spacing["after"] = str(pt_to_twips(props["spaceAfter"]))
        line = str(props.get("lineSpacing") or "")
        if line:
            if ":" in line:
                rule, value = line.split(":", 1)
                spacing["line"], spacing["lineRule"] = str(pt_to_twips(value)), rule
            elif to_number(line):
                spacing["line"], spacing["lineRule"] = str(int(round(float(line) * 240))), "auto"
        if spacing:
            ppr.append(w("spacing", spacing))
        indent = {}
        if props.get("indentLeft") not in (None, ""):
            indent["left"] = str(pt_to_twips(props["indentLeft"]))
        if props.get("indentRight") not in (None, ""):
            indent["right"] = str(pt_to_twips(props["indentRight"]))
        first = props.get("indentFirst")
        if first not in (None, "") and to_number(str(first)) is not None:
            value = pt_to_twips(first)
            indent["hanging" if value < 0 else "firstLine"] = str(abs(value))
        if indent:
            ppr.append(w("ind", indent))
        alignment = props.get("textAlignment")
        if alignment in ("center", "right", "justify"):
            ppr.append(w("jc", {"val": "both" if alignment == "justify" else alignment}))
        return ppr

    def _paragraph(self, block: dict, style_id: Optional[str] = None, num=None, prefix_runs: Optional[List] = None,
                   base_styles: Optional[dict] = None):
        paragraph = w("p", None, self._ppr(block, style_id, num))
        for run in prefix_runs or []:
            paragraph.append(run)
        for node in self._inline(block.get("content") or [], base_styles):
            paragraph.append(node)
        self._attach_comments(block, paragraph)
        return paragraph

    def _attach_comments(self, block: dict, paragraph) -> None:
        for comment in self.comment_by_block.get(block.get("id") or "", []):
            comment_id = len(self.comment_ids)
            self.comment_ids[comment["id"]] = comment_id
            ppr = paragraph.find(W + "pPr")
            start, end = w("commentRangeStart", {"id": str(comment_id)}), w("commentRangeEnd", {"id": str(comment_id)})
            if ppr is not None:
                ppr.addnext(start)
            else:
                paragraph.insert(0, start)
            paragraph.append(end)
            paragraph.append(w("r", None, w("rPr", None, w("rStyle", {"val": self._style("CommentReference") or "CommentReference"})),
                               w("commentReference", {"id": str(comment_id)})))

    def _heading_style(self, level: int, block: dict) -> Optional[str]:
        word_style = (block.get("props") or {}).get("wordStyle")
        if word_style and self._style(word_style):
            return self._style(word_style)
        configured = ((self.settings.get("styles") or {}).get("headings") or {}).get(str(level), {}).get("styleId")
        return self._style(configured, f"Heading{level}", f"heading {level}")

    def _image(self, block: dict) -> List:
        props = block.get("props") or {}
        url = props.get("url") or ""
        loaded = self.image_loader(url) if self.image_loader and url else None
        if not loaded and url.startswith("data:"):
            match = re.match(r"data:([\w/+.-]+);base64,(.*)", url, re.S)
            if match:
                loaded = (base64.b64decode(match.group(2)), match.group(1))
        if not loaded:
            caption = props.get("caption") or props.get("name") or "Image"
            return [w("p", None, *self._text_runs(f"[{caption}]", {"italic": True}))]
        data, content_type = loaded
        if content_type in ("image/webp", "image/svg+xml") or content_type not in EXTENSIONS:
            try:
                from PIL import Image

                with Image.open(io.BytesIO(data)) as image:
                    buffer = io.BytesIO()
                    image.convert("RGBA").save(buffer, "PNG")
                    data, content_type = buffer.getvalue(), "image/png"
            except Exception:
                return []
        extension = EXTENSIONS.get(content_type, "png")
        self.media_counter += 1
        name = f"media/vdm_image{self.media_counter}.{extension}"
        self.parts["word/" + name] = data
        self._default(extension, content_type if content_type != "image/webp" else "image/png")
        rel_id = self._rel("image", name)
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data)) as image:
                natural_w, natural_h = image.size
        except Exception:
            natural_w, natural_h = 800, 600
        width_px = int(props.get("previewWidth") or natural_w or 600)
        content_width_px = self._content_width_px()
        width_px = max(16, min(width_px, content_width_px))
        height_px = int(width_px * (natural_h / natural_w if natural_w else 0.66))
        cx, cy = width_px * 9525, height_px * 9525
        drawing = etree.fromstring(f'''<w:drawing xmlns:w="{NS['w']}" xmlns:wp="{NS['wp']}" xmlns:a="{NS['a']}" xmlns:pic="{NS['pic']}" xmlns:r="{NS['r']}">
<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{1000 + self.media_counter}" name="Picture {self.media_counter}" descr=""/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="{1000 + self.media_counter}" name="Picture {self.media_counter}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'''.encode())
        doc_pr = drawing.find(".//{%s}docPr" % NS["wp"])
        doc_pr.set("descr", (props.get("name") or props.get("caption") or "")[:200])
        paragraph = w("p", None, self._ppr({"props": {"textAlignment": props.get("textAlignment")}}), w("r", None, drawing))
        out = [paragraph]
        if props.get("caption"):
            caption = w("p", None, w("pPr", None, w("pStyle", {"val": self._style("Caption") or "Caption"}) if self._style("Caption") else None,
                                     w("jc", {"val": "center"})))
            for run in self._text_runs(props["caption"], {} if self._style("Caption") else {"italic": True}):
                caption.append(run)
            out.append(caption)
        return out

    def _content_width_px(self) -> int:
        page = self.settings.get("page") or {}
        width = float(page.get("widthPt") or 595.3)
        margins = page.get("margins") or {}
        content_pt = width - float(margins.get("left") or 72) - float(margins.get("right") or 72)
        return max(100, int(content_pt / 0.75))

    def _table(self, block: dict) -> List:
        content = block.get("content") or {}
        rows = content.get("rows") or []
        columns = max((sum(int((cell.get("props") or {}).get("colspan") or 1) for cell in row.get("cells") or []) for row in rows), default=1)
        widths_px = content.get("columnWidths") or []
        total_twips = int(self._content_width_px() * 15)
        if widths_px and len(widths_px) == columns and all(isinstance(value, (int, float)) and value for value in widths_px):
            grid = [int(value * 15) for value in widths_px]
            scale = total_twips / sum(grid) if sum(grid) > total_twips else 1
            grid = [int(value * scale) for value in grid]
        else:
            grid = [total_twips // columns] * columns
        table_style = self._style("TableGrid", "Table Grid")
        tblpr = w("tblPr", None, w("tblStyle", {"val": table_style}) if table_style else None, w("tblW", {"w": str(sum(grid)), "type": "dxa"}))
        if not table_style:
            borders = w("tblBorders")
            for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
                borders.append(w(side, {"val": "single", "sz": "4", "space": "0", "color": "auto"}))
            tblpr.append(borders)
        table = w("tbl", None, tblpr, w("tblGrid", None, *[w("gridCol", {"w": str(value)}) for value in grid]))
        header_rows = int(content.get("headerRows") or 0)
        pending: Dict[int, int] = {}  # grid column -> rows still covered by a vertical merge
        pending_span: Dict[int, int] = {}
        for row_index, row in enumerate(rows):
            tr = w("tr")
            if row_index < header_rows:
                tr.append(w("trPr", None, w("tblHeader")))
            column = 0
            cells = list(row.get("cells") or [])
            while column < columns:
                if pending.get(column, 0) > 0:
                    span = pending_span.get(column, 1)
                    tr.append(w("tc", None, w("tcPr", None, w("tcW", {"w": str(sum(grid[column:column + span])), "type": "dxa"}),
                                                w("gridSpan", {"val": str(span)}) if span > 1 else None, w("vMerge")), w("p")))
                    pending[column] -= 1
                    column += span
                    continue
                if not cells:
                    tr.append(w("tc", None, w("tcPr", None, w("tcW", {"w": str(grid[column]), "type": "dxa"})), w("p")))
                    column += 1
                    continue
                cell = cells.pop(0)
                props = cell.get("props") or {}
                span = max(1, int(props.get("colspan") or 1))
                rowspan = max(1, int(props.get("rowspan") or 1))
                tcpr = w("tcPr", None, w("tcW", {"w": str(sum(grid[column:column + span])), "type": "dxa"}))
                if span > 1:
                    tcpr.append(w("gridSpan", {"val": str(span)}))
                if rowspan > 1:
                    tcpr.append(w("vMerge", {"val": "restart"}))
                    pending[column] = rowspan - 1
                    pending_span[column] = span
                fill = css_color_hex(props.get("backgroundColor", ""))
                if fill:
                    tcpr.append(w("shd", {"val": "clear", "color": "auto", "fill": fill}))
                tc = w("tc", None, tcpr)
                lines = self._split_lines(cell.get("content") or [])
                for line in lines or [[]]:
                    paragraph = w("p", None, self._ppr({"props": {"textAlignment": props.get("textAlignment")}}))
                    for node in self._inline(line, {"bold": True} if row_index < header_rows else None):
                        paragraph.append(node)
                    tc.append(paragraph)
                tr.append(tc)
                column += span
            table.append(tr)
        return [table]

    @staticmethod
    def _split_lines(items: List) -> List[List]:
        """Cell content with \\n separating its paragraphs."""
        lines: List[List] = [[]]
        for item in items:
            if isinstance(item, dict) and item.get("type") == "text" and "\n" in item.get("text", ""):
                pieces = item["text"].split("\n")
                for index, piece in enumerate(pieces):
                    if index:
                        lines.append([])
                    if piece:
                        lines[-1].append({**item, "text": piece})
            else:
                lines[-1].append(item)
        return lines

    def _toc(self) -> List:
        entries = []

        def collect(blocks):
            for block in blocks:
                if block.get("type") == "heading" and int((block.get("props") or {}).get("level") or 1) <= 3:
                    text = "".join(i.get("text", "") for i in block.get("content") or [] if isinstance(i, dict))
                    if text.strip():
                        entries.append((int(block["props"].get("level") or 1), text.strip()))
                collect(block.get("children") or [])

        collect(self.blocks)
        paragraphs = []
        begin = [w("r", None, w("fldChar", {"fldCharType": "begin"})), w("r", None, self._instr(' TOC \\o "1-3" \\h \\z \\u ')),
                 w("r", None, w("fldChar", {"fldCharType": "separate"}))]
        for index, (level, text) in enumerate(entries or [(1, "Update the table of contents to see the headings.")]):
            style = self._style(f"TOC{level}", f"toc {level}")
            paragraph = w("p", None, w("pPr", None, w("pStyle", {"val": style}) if style else None,
                                       None if style else w("ind", {"left": str(240 * (level - 1))})))
            if index == 0:
                for run in begin:
                    paragraph.append(run)
            for run in self._text_runs(text, {}):
                paragraph.append(run)
            paragraphs.append(paragraph)
        paragraphs[-1].append(w("r", None, w("fldChar", {"fldCharType": "end"})))
        return paragraphs

    @staticmethod
    def _instr(text: str):
        node = w("instrText")
        node.text = text
        node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        return node

    def _blocks(self, blocks: List[dict], depth: int = 0) -> List:
        out: List = []
        for position, block in enumerate(blocks):
            kind = block.get("type")
            props = block.get("props") or {}
            if kind not in ("numberedListItem",) and depth == 0:
                self.current_numbered = None
            if kind == "heading":
                level = max(1, min(6, int(props.get("level") or 1)))
                out.append(self._paragraph(block, self._heading_style(level, block)))
            elif kind in ("bulletListItem", "numberedListItem", "checkListItem"):
                word_style = props.get("wordStyle")
                style = (self._style(word_style) if word_style and self.source else None) or self._style("ListParagraph", "List Paragraph")
                prefix = self._text_runs("☒ " if props.get("checked") else "☐ ", {}) if kind == "checkListItem" else None
                out.append(self._paragraph(block, style, self._num_for(block, depth), prefix))
                out.extend(self._blocks(block.get("children") or [], depth + 1))
                if depth == 0 and kind != "numberedListItem":
                    self.current_numbered = None
                continue
            elif kind == "quote":
                style = self._style(props.get("wordStyle") or "", "Quote")
                block_copy = block if style else {**block, "props": {**props, "indentLeft": props.get("indentLeft") or "36"}}
                out.append(self._paragraph(block_copy, style, base_styles=None if style else {"italic": True}))
            elif kind == "codeBlock":
                text = "".join(i.get("text", "") for i in block.get("content") or [] if isinstance(i, dict))
                for line in text.split("\n"):
                    paragraph = w("p", None, w("pPr", None, w("shd", {"val": "clear", "color": "auto", "fill": "F3F4F6"}), w("spacing", {"after": "0"})))
                    for run in self._text_runs(line, {"fontFamily": "Consolas", "fontSize": "10pt"}):
                        paragraph.append(run)
                    out.append(paragraph)
            elif kind == "table":
                out.extend(self._table(block))
            elif kind == "image":
                out.extend(self._image(block))
            elif kind == "pageBreak":
                previous_id = blocks[position - 1].get("id") if position > 0 else None
                section = self.sections.get(previous_id)
                if section and out and out[-1].tag == W + "p":
                    ppr = out[-1].find(W + "pPr")
                    if ppr is None:
                        ppr = w("pPr")
                        out[-1].insert(0, ppr)
                    ppr.append(self._sectpr(section, final=False))
                else:
                    out.append(w("p", None, w("r", None, w("br", {"type": "page"}))))
            elif kind == "equation":
                paragraph = w("p")
                paragraph.append(latex_to_omml(props.get("latex") or "", display=True))
                out.append(paragraph)
            elif kind == "divider":
                out.append(w("p", None, w("pPr", None, w("pBdr", None, w("bottom", {"val": "single", "sz": "6", "space": "1", "color": "auto"})))))
            elif kind == "tableOfContents":
                out.extend(self._toc())
            elif kind in ("file", "audio", "video"):
                url = props.get("url") or ""
                label = props.get("name") or props.get("caption") or url or "Attachment"
                paragraph = w("p")
                if url.startswith(("http://", "https://")):
                    link = w("hyperlink", {"r:id": self._rel("hyperlink", url, external=True)})
                    for run in self._text_runs(label, {"underline": True, "textColor": "#0563C1"}):
                        link.append(run)
                    paragraph.append(link)
                else:
                    for run in self._text_runs(label, {}):
                        paragraph.append(run)
                out.append(paragraph)
            else:
                style = props.get("wordStyle")
                out.append(self._paragraph(block, self._style(style) if style else None))
            out.extend(self._blocks(block.get("children") or [], depth + 1))
        return out

    # ------------------------------------------------------------ sections, notes, comments

    def _sectpr(self, section: dict, final: bool, template=None):
        sectpr = copy.deepcopy(template) if template is not None else w("sectPr")
        for tag in ("pgSz", "pgMar", "cols"):
            for node in sectpr.findall(W + tag):
                sectpr.remove(node)
        width = pt_to_twips(section.get("widthPt") or 595.3)
        height = pt_to_twips(section.get("heightPt") or 841.9)
        size_attrs = {"w": str(width), "h": str(height)}
        if section.get("orientation") == "landscape":
            size_attrs["orient"] = "landscape"
        margins = section.get("margins") or {}
        margin_attrs = {key: str(pt_to_twips(margins.get(key) or default)) for key, default in
                        (("top", 72), ("right", 72), ("bottom", 72), ("left", 72), ("header", 36), ("footer", 36))}
        margin_attrs["gutter"] = "0"
        # Schema order: header/footer references first, then pgSz, pgMar, ..., cols.
        refs = [node for node in sectpr if node.tag in (W + "headerReference", W + "footerReference", W + "footnotePr", W + "endnotePr", W + "type")]
        insert_at = len(refs)
        sectpr.insert(insert_at, w("pgSz", size_attrs))
        sectpr.insert(insert_at + 1, w("pgMar", margin_attrs))
        columns = int(section.get("columns") or 1)
        cols = w("cols", {"space": "720", **({"num": str(columns)} if columns > 1 else {})})
        docgrid = sectpr.find(W + "docGrid")
        if docgrid is not None:
            docgrid.addprevious(cols)
        else:
            sectpr.append(cols)
        return sectpr

    def _header_footer_parts(self, sectpr) -> None:
        """Headers/footers from settings when the source has none (or for new documents)."""
        for kind in ("header", "footer"):
            wanted = self.settings.get(kind) or {}
            existing = {wattr(node, "type"): node for node in sectpr.findall(W + f"{kind}Reference")}
            for variant, info in wanted.items():
                text = (info or {}).get("text") or ""
                if not text:
                    continue
                if variant in existing and self.source:
                    rel_id = existing[variant].get(R + "id")
                    target = next((rel.get("Target") for rel in self.rels if rel.get("Id") == rel_id), None)
                    if target and self._header_text_matches(target, text):
                        continue
                part_name = f"{kind}_vdm_{variant}.xml"
                root = etree.fromstring(f'<w:{"hdr" if kind == "header" else "ftr"} xmlns:w="{NS["w"]}" xmlns:r="{NS["r"]}"/>'.encode())
                for line in text.split("\n"):
                    paragraph = w("p", None, w("pPr", None, w("jc", {"val": (info or {}).get("align") or "left"}) if (info or {}).get("align") in ("center", "right") else None))
                    for piece in re.split(r"(\{PAGE\}|\{PAGES\})", line):
                        if piece == "{PAGE}":
                            for run in self._field("PAGE", self._text_runs("1", {})):
                                paragraph.append(run)
                        elif piece == "{PAGES}":
                            for run in self._field("NUMPAGES", self._text_runs("1", {})):
                                paragraph.append(run)
                        elif piece:
                            for run in self._text_runs(piece, {}):
                                paragraph.append(run)
                    root.append(paragraph)
                order_properties(root)
                self.parts["word/" + part_name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
                self._override(f"/word/{part_name}", f"{DOCUMENT_CT}.{kind}+xml")
                rel_id = self._rel(kind, part_name)
                if variant in existing:
                    existing[variant].set(R + "id", rel_id)
                else:
                    sectpr.insert(0, w(f"{kind}Reference", {"type": variant, "r:id": rel_id}))
        if self.settings.get("differentFirstPage") and sectpr.find(W + "titlePg") is None:
            sectpr.append(w("titlePg"))

    def _header_text_matches(self, target: str, text: str) -> bool:
        data = self.parts.get("word/" + target.lstrip("/").replace("word/", ""))
        if not data:
            return False
        from .reader import WordReader

        found, _align = WordReader._header_footer_text(None, parse_xml(data))  # type: ignore[arg-type]
        return found.strip() == text.strip()

    def _footnotes_part(self) -> None:
        if not self.footnotes and "word/footnotes.xml" not in self.parts:
            return
        existing = self.parts.get("word/footnotes.xml")
        if existing:
            root = parse_xml(existing)
            for note in list(root.findall(W + "footnote")):
                if wattr(note, "type") not in ("separator", "continuationSeparator", "continuationNotice"):
                    root.remove(note)
        else:
            root = etree.fromstring(f'<w:footnotes xmlns:w="{NS["w"]}"/>'.encode())
            root.append(w("footnote", {"type": "separator", "id": "-1"}, w("p", None, w("r", None, w("separator")))))
            root.append(w("footnote", {"type": "continuationSeparator", "id": "0"}, w("p", None, w("r", None, w("continuationSeparator")))))
        text_style = self._style("FootnoteText", "footnote text")
        ref_style = self._style("FootnoteReference", "footnote reference")
        for note_id, text in self.footnotes:
            note = w("footnote", {"id": str(note_id)})
            for index, line in enumerate(text.split("\n") or [""]):
                paragraph = w("p", None, w("pPr", None, w("pStyle", {"val": text_style}) if text_style else None))
                if index == 0:
                    rpr = w("rPr", None, w("rStyle", {"val": ref_style}) if ref_style else None, w("vertAlign", {"val": "superscript"}))
                    paragraph.append(w("r", None, rpr, w("footnoteRef")))
                    paragraph.append(self._text_runs(" ", {})[0])
                for run in self._text_runs(line, {} if text_style else {"fontSize": "10pt"}):
                    paragraph.append(run)
                note.append(paragraph)
            root.append(note)
        order_properties(root)
        self.parts["word/footnotes.xml"] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        self._override("/word/footnotes.xml", f"{DOCUMENT_CT}.footnotes+xml")
        self._rel("footnotes", "footnotes.xml")

    def _comments_part(self) -> None:
        if not self.comment_ids:
            for name in ("word/comments.xml", "word/commentsExtended.xml"):
                if name in self.parts and self.source:
                    # Comments were removed in the editor: empty the parts, keep their relationships valid.
                    root_tag = "comments" if name.endswith("comments.xml") else None
                    if root_tag:
                        self.parts[name] = etree.tostring(etree.fromstring(f'<w:comments xmlns:w="{NS["w"]}"/>'.encode()),
                                                          xml_declaration=True, encoding="UTF-8", standalone=True)
            return
        w14 = NS["w14"]
        root = etree.fromstring(f'<w:comments xmlns:w="{NS["w"]}" xmlns:w14="{w14}"/>'.encode())
        extended = etree.fromstring(f'<w15:commentsEx xmlns:w15="{NS["w15"]}" xmlns:mc="{NS["mc"]}"/>'.encode())
        next_id = len(self.comment_ids)
        comments_by_id = {c["id"]: c for c in self.comments}

        def para_id(seed: str) -> str:
            return f"{abs(hash(seed)) % 0x7FFFFFFF:08X}"

        def add(comment_id: int, author: str, created: Optional[int], text: str, parent_para: Optional[str], done: bool, seed: str) -> str:
            date = datetime.fromtimestamp((created or 0) / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if created else None
            attrs = {"id": str(comment_id), "author": author or "Reviewer", "initials": "".join(p[0] for p in (author or "R").split()[:2]).upper()}
            if date:
                attrs["date"] = date
            node = w("comment", attrs)
            pid = para_id(seed)
            lines = (text or "").split("\n")
            for index, line in enumerate(lines):
                paragraph = w("p")
                if index == len(lines) - 1:
                    paragraph.set("{%s}paraId" % w14, pid)
                if index == 0:
                    paragraph.append(w("r", None, w("annotationRef")))
                for run in self._text_runs(line, {}):
                    paragraph.append(run)
                node.append(paragraph)
            root.append(node)
            entry = etree.SubElement(extended, "{%s}commentEx" % NS["w15"])
            entry.set("{%s}paraId" % NS["w15"], pid)
            if parent_para:
                entry.set("{%s}paraIdParent" % NS["w15"], parent_para)
            entry.set("{%s}done" % NS["w15"], "1" if done else "0")
            return pid

        for key, comment_id in list(self.comment_ids.items()):
            comment = comments_by_id[key]
            parent_pid = add(comment_id, comment.get("actorDisplayName") or "", comment.get("createdAt"), comment.get("text") or "",
                             None, comment.get("status") == "resolved", f"{key}-root")
            for reply in comment.get("replies") or []:
                add(next_id, reply.get("actorDisplayName") or "", reply.get("createdAt"), reply.get("text") or "", parent_pid,
                    comment.get("status") == "resolved", f"{key}-{reply.get('id')}")
                next_id += 1
        order_properties(root)
        self.parts["word/comments.xml"] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        self.parts["word/commentsExtended.xml"] = etree.tostring(extended, xml_declaration=True, encoding="UTF-8", standalone=True)
        self._override("/word/comments.xml", f"{DOCUMENT_CT}.comments+xml")
        self._override("/word/commentsExtended.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml")
        self._rel("comments", "comments.xml")
        rel_type = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended"
        if not any(rel.get("Type") == rel_type for rel in self.rels):
            self.rel_counter += 1
            node = etree.SubElement(self.rels, "{%s}Relationship" % NS["rel"])
            node.set("Id", f"rIdVdm{self.rel_counter}")
            node.set("Type", rel_type)
            node.set("Target", "commentsExtended.xml")

    def _core_title(self) -> None:
        data = self.parts.get("docProps/core.xml")
        if not data:
            return
        root = parse_xml(data)
        title = root.find("{%s}title" % NS["dc"])
        if title is None:
            title = etree.SubElement(root, "{%s}title" % NS["dc"])
        title.text = self.title[:255]
        self.parts["docProps/core.xml"] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    # ------------------------------------------------------------ entry point

    def write(self) -> bytes:
        body = self.document.find(W + "body")
        final_template = body.find(W + "sectPr")
        for child in list(body):
            body.remove(child)
        for element in self._blocks(self.blocks):
            body.append(element)
        if len(body) and body[-1].tag != W + "p":
            body.append(w("p"))  # Word ends the body with a paragraph.
        page = self.settings.get("page") or {"widthPt": "595.3", "heightPt": "841.9", "orientation": "portrait",
                                             "margins": {"top": "72", "right": "72", "bottom": "72", "left": "72", "header": "36", "footer": "36"}}
        sectpr = self._sectpr(page, final=True, template=final_template)
        start = self.settings.get("pageNumberStart")
        if start:
            for node in sectpr.findall(W + "pgNumType"):
                sectpr.remove(node)
            sectpr.find(W + "pgMar").addnext(w("pgNumType", {"start": str(start)}))
        self._header_footer_parts(sectpr)
        body.append(sectpr)
        self._footnotes_part()
        self._comments_part()
        self._core_title()
        if self.numbering is not None:
            order_properties(self.numbering)
            self.parts["word/numbering.xml"] = etree.tostring(self.numbering, xml_declaration=True, encoding="UTF-8", standalone=True)
        order_properties(self.document)
        self.parts["word/document.xml"] = etree.tostring(self.document, xml_declaration=True, encoding="UTF-8", standalone=True)
        self.parts["word/_rels/document.xml.rels"] = etree.tostring(self.rels, xml_declaration=True, encoding="UTF-8", standalone=True)
        self.parts["[Content_Types].xml"] = etree.tostring(self.content_types, xml_declaration=True, encoding="UTF-8", standalone=True)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
            order = ["[Content_Types].xml"] + [name for name in self.parts if name != "[Content_Types].xml"]
            for name in order:
                package.writestr(name, self.parts[name])
        return output.getvalue()


def write_docx(blocks: List[dict], settings: Optional[dict] = None, comments: Optional[List[dict]] = None, title: str = "Document",
               source: Optional[bytes] = None, image_loader: Optional[ImageLoader] = None, author: str = "Videmak") -> bytes:
    return WordWriter(blocks, settings, comments, title, source, image_loader, author).write()
