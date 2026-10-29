"""AI Editor document -> LaTeX project (.zip) for Overleaf or any pdfLaTeX + BibTeX setup.

The zip holds main.tex, references.bib (the BibTeX entries of the document's citations,
cited with natbib's \\citep / \\citet and the apalike style) and figures/ (the images).
LaTeX decides the look (fonts, spacing, heading styles), as LaTeX users expect; page size
and margins come from the document's page setup. Headings are unnumbered, as in the editor
(one line in the preamble turns numbering on). Suggestions are exported accepted: suggested
insertions are kept, suggested deletions dropped.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import re
import unicodedata
import zipfile
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import quote

from .writer import ImageLoader, WordWriter, css_color_hex

LIST_TYPES = {"bulletListItem": "itemize", "checkListItem": "itemize", "numberedListItem": "enumerate"}
HEADING_COMMANDS = {1: "section", 2: "subsection", 3: "subsubsection", 4: "paragraph", 5: "subparagraph", 6: "subparagraph"}
PLACEHOLDER_TITLES = {"", "untitled", "untitled document", "document"}
BIBLIOGRAPHY_MARKER = "%%VDM-BIBLIOGRAPHY%%"
TABLE_CAPTION = re.compile(r"^\s*Table\s+(?:\d+|[IVXLC]+)(?:\s*[.:\u2013\u2014-]\s*|\s*$)", re.I)
FIGURE_CAPTION = re.compile(r"^\s*(?:Figure|Fig\.)\s+(?:\d+|[IVXLC]+)(?:\s*[.:\u2013\u2014-]\s*|\s*$)", re.I)
CAPTION_MAX = 400
# Average character width of 12 pt Latin Modern, for estimating table column widths.
CHARACTER_PT = 5.5
# LaTeX allows 4 nested itemize / enumerate and 6 nested list-like environments in all.
MAX_LIST_DEPTH = 4
MAX_ENV_DEPTH = 5

# ------------------------------------------------------------------ text

SPECIALS = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&", "#": r"\#",
            "^": r"\^{}", "_": r"\_", "%": r"\%", "~": r"\textasciitilde{}"}

_MATH = {
    # Greek (the capitals that look Latin are Latin letters in LaTeX)
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\varepsilon", "ϵ": r"\epsilon",
    "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta", "ϑ": r"\vartheta", "ι": r"\iota", "κ": r"\kappa",
    "λ": r"\lambda", "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho", "σ": r"\sigma",
    "ς": r"\varsigma", "τ": r"\tau", "υ": r"\upsilon", "φ": r"\varphi", "ϕ": r"\phi", "χ": r"\chi",
    "ψ": r"\psi", "ω": r"\omega", "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda",
    "Ξ": r"\Xi", "Π": r"\Pi", "Σ": r"\Sigma", "Υ": r"\Upsilon", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
    # Mathematical symbols common in academic prose
    "≤": r"\leq", "≥": r"\geq", "≠": r"\neq", "≈": r"\approx", "≡": r"\equiv", "∼": r"\sim", "≃": r"\simeq",
    "≅": r"\cong", "∝": r"\propto", "∞": r"\infty", "∑": r"\sum", "∏": r"\prod", "√": r"\surd",
    "∂": r"\partial", "∆": r"\Delta", "∇": r"\nabla", "∈": r"\in", "∉": r"\notin", "∋": r"\ni",
    "⊂": r"\subset", "⊃": r"\supset", "⊆": r"\subseteq", "⊇": r"\supseteq", "∩": r"\cap", "∪": r"\cup",
    "∀": r"\forall", "∃": r"\exists", "∅": r"\emptyset", "∧": r"\wedge", "∨": r"\vee", "⊕": r"\oplus",
    "⊗": r"\otimes", "→": r"\rightarrow", "←": r"\leftarrow", "↔": r"\leftrightarrow", "⇒": r"\Rightarrow",
    "⇐": r"\Leftarrow", "⇔": r"\Leftrightarrow", "↑": r"\uparrow", "↓": r"\downarrow", "−": "-",
    "∓": r"\mp", "⋅": r"\cdot", "∘": r"\circ", "∗": r"\ast", "≪": r"\ll", "≫": r"\gg", "⊥": r"\perp",
    "∠": r"\angle", "′": r"^{\prime}", "″": r"^{\prime\prime}", "∫": r"\int", "ℓ": r"\ell",
    "ℝ": r"\mathbb{R}", "ℕ": r"\mathbb{N}", "ℤ": r"\mathbb{Z}", "ℚ": r"\mathbb{Q}", "ℂ": r"\mathbb{C}",
    "✓": r"\checkmark", "✔": r"\checkmark", "★": r"\star", "☆": r"\star", "□": r"\square", "☐": r"\square",
    "☑": r"\boxtimes", "☒": r"\boxtimes", "■": r"\blacksquare", "▪": r"\blacksquare",
}
UNICODE = {char: rf"\ensuremath{{{command}}}" for char, command in _MATH.items()}
UNICODE.update({
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O",
    "Ρ": "P", "Τ": "T", "Χ": "X", "ο": "o",
    "\u00a0": "~", "\u2009": r"\,", "\u202f": r"\,", "\u2002": r"\enskip{}", "\u2003": r"\quad{}",
    "\u200b": "", "\u200c": "", "\u200d": "", "\u2060": "", "\ufeff": "", "\u00ad": r"\-",
    "\u2010": "-", "\u2011": "-", "\u2012": "--", "\u2015": "---",
})
UNICODE.update({char: rf"\textsuperscript{{{plain}}}" for char, plain in zip("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ", "0123456789+-=()ni")})
UNICODE.update({char: rf"\textsubscript{{{plain}}}" for char, plain in zip("₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎", "0123456789+-=()")})

_TEXT_MAP = {**SPECIALS, **UNICODE, "\t": " ", "\n": " "}
_NEEDS_ESCAPE = re.compile("[" + re.escape("".join(_TEXT_MAP)) + r"\x00-\x1f]")
_UNICODE_ONLY = re.compile("[" + re.escape("".join(UNICODE)) + "]")


def escape(text: str) -> str:
    """Plain text -> LaTeX text (pdfLaTeX, T1): specials escaped, common symbols as commands."""
    return _NEEDS_ESCAPE.sub(lambda match: _TEXT_MAP.get(match.group(), ""), text or "")


def escape_url(url: str) -> str:
    """A URL for \\href: anything TeX could misread is percent-encoded, then % and # escaped."""
    encoded = quote(url, safe="!&'()*+,-./:;=?@_[]%#")
    return encoded.replace("~", "%7E").replace("%", r"\%").replace("#", r"\#")


def plain_text(items) -> str:
    parts: List[str] = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            if item.get("type") == "text" and not (item.get("styles") or {}).get("suggestionDelete"):
                parts.append(item.get("text") or "")
            elif item.get("type") == "link":
                parts.append(plain_text(item.get("content")))
            elif item.get("type") == "aiCitation":
                parts.append((item.get("props") or {}).get("displayText") or "")
    return "".join(parts)


def _trim_breaks(text: str) -> str:
    """No line break at the start or end of a paragraph (LaTeX: "There's no line here to end")."""
    text = re.sub(r"^(?:\s|\\newline\b)+", "", text)
    return re.sub(r"(?:\s|\\newline\b)+$", "", text)


# ------------------------------------------------------------------ BibTeX


def _bibtex_entries(text: str) -> List[str]:
    """The @entries of a BibTeX string (braces counted, so '@' inside a field is fine)."""
    entries = []
    position = 0
    start = re.compile(r"@\s*(\w+)\s*[{(]")
    while True:
        match = start.search(text, position)
        if not match:
            return entries
        depth, index = 0, match.end() - 1
        opener = text[index]
        closer = "}" if opener == "{" else ")"
        end = None
        while index < len(text):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            if (opener == "{" and depth == 0) or (opener == "(" and char == closer and depth == 0):
                end = index
                break
            index += 1
        if end is None:
            entries.append(text[match.start():])
            return entries
        entries.append(text[match.start():end + 1])
        position = end + 1


def parse_bibtex_entry(entry: str) -> Optional[Tuple[str, str, List[Tuple[str, str, bool]]]]:
    """(type, key, [(field, value, braced)]) of one entry; None when it cannot be read (or is
    @string / @comment / @preamble). Quoted values come back as braced ones."""
    head = re.match(r"\s*@\s*(\w+)\s*([{(])", entry)
    if not head or head.group(1).lower() in ("string", "comment", "preamble"):
        return None
    closer = "}" if head.group(2) == "{" else ")"
    index = head.end()
    key_end = index
    while key_end < len(entry) and entry[key_end] not in ",}" + closer:
        key_end += 1
    key = entry[index:key_end].strip()
    fields: List[Tuple[str, str, bool]] = []
    index = key_end + 1 if key_end < len(entry) and entry[key_end] == "," else len(entry)
    length = len(entry)
    while index < length:
        while index < length and (entry[index].isspace() or entry[index] == ","):
            index += 1
        if index >= length or entry[index] == closer:
            break
        name = re.match(r"[A-Za-z][\w\-:.+]*", entry[index:])
        if not name:
            return None
        index += name.end()
        while index < length and entry[index].isspace():
            index += 1
        if index >= length or entry[index] != "=":
            return None
        index += 1
        while index < length and entry[index].isspace():
            index += 1
        if index >= length:
            return None
        if entry[index] in "{\"":
            quoted = entry[index] == "\""
            depth, start = 0, index + 1
            index += 1
            while index < length:
                char = entry[index]
                if char == "{":
                    depth += 1
                elif char == "}":
                    if depth == 0 and not quoted:
                        break
                    depth -= 1
                elif char == "\"" and quoted and depth == 0:
                    break
                index += 1
            if index >= length:
                return None
            fields.append((name.group(0).lower(), entry[start:index], True))
            index += 1
        else:
            bare = re.match(r"[^,\s{}()\"#]+", entry[index:])
            if not bare:
                return None
            fields.append((name.group(0).lower(), bare.group(0), False))
            index += bare.end()
        while index < length and entry[index].isspace():
            index += 1
        if index < length and entry[index] == "#":
            return None  # string concatenation: kept as written instead
    return head.group(1).lower(), key, fields


_VERBATIM_FIELDS = {"url", "doi", "eprint", "file", "pdf", "isbn", "issn"}


def _bib_value(value: str) -> str:
    """A field value that LaTeX can typeset: unescaped & % # _ ^ outside $math$ escaped and
    common Unicode symbols written as commands; everything else (braces, accents) as written."""
    pieces = re.split(r"(?<!\\)(\$[^$]*(?<!\\)\$)", value)
    out = []
    for index, piece in enumerate(pieces):
        if index % 2:
            out.append(piece)
            continue
        piece = re.sub(r"(?<!\\)([&%#_])", r"\\\1", piece)
        piece = re.sub(r"(?<!\\)\^", r"\\^{}", piece)
        piece = re.sub(r"(?<!\\)\$", r"\\$", piece)
        out.append(_UNICODE_ONLY.sub(lambda match: UNICODE[match.group()], piece))
    return "".join(out)


def _normal(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value or "").lower())


VALID_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_:.+/-]*$")


class Bibliography:
    """The document's BibTeX entries, one per work: entries are matched by DOI, by title and
    year, or by their text; a key that is missing, malformed or already taken by a different
    work is replaced by one made from the first author and year (smith2020, smith2020a)."""

    def __init__(self) -> None:
        self.entries: Dict[str, str] = {}
        self.taken: Set[str] = set()
        self.by_identity: Dict[str, str] = {}

    def add(self, entry: str) -> Optional[str]:
        parsed = parse_bibtex_entry(entry)
        if parsed is None:
            return self._add_raw(entry)
        kind, key, fields = parsed
        values = {name: value for name, value, _ in fields}
        if not fields:
            return None
        identities = self._identities(values, " ".join(f"{name}={_normal(value)}" for name, value, _ in sorted(fields)))
        for identity in identities:
            if identity in self.by_identity:
                return self.by_identity[identity]
        key = key if VALID_KEY.match(key or "") and key.lower() not in self.taken else self._new_key(values)
        lines = []
        for name, value, braced in fields:
            text = value if name in _VERBATIM_FIELDS else _bib_value(value)
            lines.append(f"  {name} = {{{text}}}" if braced else f"  {name} = {text}")
        self._keep(key, f"@{kind}{{{key},\n" + ",\n".join(lines) + "\n}", identities)
        return key

    def add_fields(self, kind: str, values: Dict[str, str]) -> Optional[str]:
        fields = {name: value for name, value in values.items() if value}
        if not fields:
            return None
        body = ",\n".join(f"  {name} = {{{value.replace('{', '').replace('}', '')}}}" for name, value in fields.items())
        return self.add(f"@{kind}{{,\n{body}\n}}")

    def _add_raw(self, entry: str) -> Optional[str]:
        """An entry this parser cannot read (string concatenation ...): kept as written."""
        match = re.match(r"\s*@\s*(\w+)\s*([{(])\s*([^,\s]*)\s*,", entry)
        if not match or match.group(1).lower() in ("string", "comment", "preamble"):
            return None
        identity = "text:" + _normal(entry[match.end():])
        if identity in self.by_identity:
            return self.by_identity[identity]
        key = match.group(3)
        if not VALID_KEY.match(key) or key.lower() in self.taken:
            key = self._new_key({})
            entry = entry[:match.start(3)] + key + entry[match.end(3):]
        self._keep(key, entry.strip(), [identity])
        return key

    @staticmethod
    def _identities(values: Dict[str, str], text: str) -> List[str]:
        identities = []
        doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", (values.get("doi") or "").strip().lower())
        if doi:
            identities.append("doi:" + doi)
        title = _normal(values.get("title") or "")
        if title:
            identities.append(f"title:{title}:{(values.get('year') or '').strip()}")
        identities.append("text:" + text)
        return identities

    def _new_key(self, values: Dict[str, str]) -> str:
        first = re.split(r"\s+and\s+", values.get("author") or values.get("editor") or "")[0].strip()
        family = first.split(",")[0] if "," in first else (first.split() or [""])[-1]
        family = re.sub(r"\\[a-zA-Z]+|[{}\\'\"`^~]", "", family)
        family = re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", family).encode("ascii", "ignore").decode().lower())
        year = re.search(r"\d{4}", values.get("year") or values.get("date") or "")
        base = (family or "ref") + (year.group(0) if year else "")
        if base.lower() not in self.taken:
            return base
        suffix = 0
        while True:
            letters, number = "", suffix
            while True:
                letters = chr(ord("a") + number % 26) + letters
                number = number // 26 - 1
                if number < 0:
                    break
            if (base + letters).lower() not in self.taken:
                return base + letters
            suffix += 1

    def _keep(self, key: str, text: str, identities: List[str]) -> None:
        self.entries[key] = text
        self.taken.add(key.lower())
        for identity in identities:
            self.by_identity.setdefault(identity, key)

    def text(self) -> str:
        return "\n\n".join(self.entries.values()) + "\n"


def _citation_payload(value: str) -> dict:
    """The aiCitation payload: base64 JSON {bibtex, fieldCode, title, doi} or base64 BibTeX."""
    try:
        decoded = base64.b64decode(value or "").decode("utf-8", "ignore")
    except (binascii.Error, ValueError):
        return {}
    try:
        payload = json.loads(decoded or "{}")
    except ValueError:
        return {"bibtex": decoded}
    return payload if isinstance(payload, dict) else {}


# ------------------------------------------------------------------ writer


def _number(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if low <= number <= high else default


class LatexWriter:
    def __init__(self, blocks: List[dict], settings: Optional[dict], title: Optional[str], author: Optional[str] = None,
                 image_loader: Optional[ImageLoader] = None):
        self.blocks = [block for block in blocks or [] if isinstance(block, dict)]
        self.settings = settings or {}
        self.title = (title or "").strip()
        self.author = (author or "").strip()
        self.image_loader = image_loader
        self.bibliography = Bibliography()
        self.figures: List[Tuple[str, bytes]] = []
        self.highlight_colors: Dict[str, str] = {}
        self.skip: Set[int] = set()
        self.list_depth = 0
        self.enumerate_depth = 0
        self.env_depth = 0
        self.fragile = False  # inside a heading or the title: moving arguments
        self.inline_only = False  # heading, title or table cell: no display math
        self.deferred_notes: Optional[List[str]] = None  # footnotes in table cells
        self.bibliography_placed = False
        self.bibliography_fallback: List[str] = []
        page = self.settings.get("page") or {}
        margins = page.get("margins") or {}
        self.page = {
            "width": _number(page.get("widthPt"), 595.3, 144, 5000),
            "height": _number(page.get("heightPt"), 841.9, 144, 5000),
            **{side: _number(margins.get(side), 72, 0, 1000) for side in ("top", "bottom", "left", "right")},
        }
        self.content_width_px = max(100.0, (self.page["width"] - self.page["left"] - self.page["right"]) / 0.75)

    # ------------------------------------------------------------ inline

    def _styled(self, text: str, styles: dict) -> str:
        body = escape(text)
        core = body.strip()
        if not core:
            return body
        lead, trail = body[:len(body) - len(body.lstrip())], body[len(body.rstrip()):]
        if not self.fragile:
            background = css_color_hex(str(styles.get("backgroundColor") or ""))
            if background:
                name = self.highlight_colors.setdefault(background, f"vdmHighlight{len(self.highlight_colors) + 1}")
                if styles.get("strike") or styles.get("underline"):
                    # soul's \hl cannot sit inside ulem's \uline / \sout: a box per word instead.
                    core = " ".join(rf"\colorbox{{{name}}}{{\strut {word}}}" for word in core.split(" ") if word)
                    core = rf"{{\setlength{{\fboxsep}}{{0pt}}{core}}}"
                else:
                    core = rf"{{\sethlcolor{{{name}}}\hl{{{core}}}}}"
            if styles.get("strike"):
                core = rf"\sout{{{core}}}"
            if styles.get("underline"):
                core = rf"\uline{{{core}}}"
        color = css_color_hex(str(styles.get("textColor") or ""))
        if color:
            core = rf"\textcolor[HTML]{{{color}}}{{{core}}}"
        vertical = styles.get("verticalAlign")
        if styles.get("superscript") or vertical == "super":
            core = rf"\textsuperscript{{{core}}}"
        elif styles.get("subscript") or vertical == "sub":
            core = rf"\textsubscript{{{core}}}"
        if styles.get("code"):
            core = rf"\texttt{{{core}}}"
        if styles.get("italic"):
            core = rf"\textit{{{core}}}"
        if styles.get("bold") or str(styles.get("fontWeight", "")) in ("bold", "700", "800", "900"):
            core = rf"\textbf{{{core}}}"
        return lead + core + trail

    def _text(self, text: str, styles: dict, newline: str) -> str:
        return newline.join(self._styled(piece, styles) for piece in (text or "").replace("\r", "").split("\n"))

    def _footnote(self, text: str) -> str:
        body = escape(" ".join((text or "").split()))
        if not body:
            return ""
        if self.deferred_notes is not None:
            self.deferred_notes.append(body)
            return r"\footnotemark{}"
        return (r"\protect" if self.fragile else "") + rf"\footnote{{{body}}}"

    def _citation(self, props: dict) -> str:
        shown = str(props.get("displayText") or "").strip()
        payload = _citation_payload(str(props.get("base64") or ""))
        keys = [key for key in (self.bibliography.add(entry) for entry in _bibtex_entries(str(payload.get("bibtex") or ""))) if key]
        if not keys and (payload.get("title") or payload.get("doi")):
            key = self.bibliography.add_fields("misc", {"title": str(payload.get("title") or ""), "doi": str(payload.get("doi") or "")})
            keys = [key] if key else []
        if not keys:
            return escape(shown or "(Citation)")
        keys = list(dict.fromkeys(keys))
        narrative = any(str(source.get(name) or "").lower() in ("true", "1", "narrative")
                        for source in (props, payload) for name in ("narrative", "citeMode"))
        narrative = narrative or bool(re.match(r"^[^\s(\[]", shown) and re.search(r"\(\s*\d{4}", shown))
        note = re.search(r",\s*((?:pp?|para|paras|ch|chap|sec)\.\s*[^,;()]+?)\s*\)\s*$", shown)
        option = f"[{escape(note.group(1))}]" if note and len(keys) == 1 else ""
        return rf"\{'citet' if narrative else 'citep'}{option}{{{','.join(keys)}}}"

    def _inline(self, items, base: Optional[dict] = None, newline: str = r"\newline ") -> str:
        out: List[str] = []
        for item in items if isinstance(items, list) else []:
            if isinstance(item, str):
                out.append(self._text(item, base or {}, newline))
                continue
            if not isinstance(item, dict):
                continue
            kind = item.get("type")
            props = item.get("props") or {}
            if kind == "text":
                styles = {**(base or {}), **(item.get("styles") or {})}
                if styles.pop("suggestionDelete", None):
                    continue
                styles.pop("suggestionInsert", None)
                out.append(self._text(item.get("text") or "", styles, newline))
            elif kind == "link":
                href = str(item.get("href") or "")
                inner = self._inline(item.get("content") or [], base, " ")
                if href.startswith(("http://", "https://", "mailto:")):
                    out.append(rf"\href{{{escape_url(href)}}}{{{inner or escape(href)}}}")
                else:
                    out.append(inner)
            elif kind == "aiCitation":
                out.append(self._citation(props))
            elif kind == "aiMath":
                latex = str(props.get("latex") or "").strip()
                if latex:
                    display = props.get("displayMode") == "true"
                    if display and not self.inline_only:
                        out.append(rf"\[ {latex} \]")
                    else:
                        out.append(f"$\\displaystyle {latex}$" if display else f"${latex}$")
            elif kind == "footnote":
                out.append(self._footnote(str(props.get("text") or "")))
            elif kind in ("aiMention", "mention"):
                out.append(escape(str(props.get("displayName") or props.get("email") or props.get("user") or "")))
            else:
                text = item.get("text") or props.get("text") or ""
                if isinstance(text, str) and text:
                    out.append(self._text(text, base or {}, newline))
        return "".join(out)

    def _inline_fragile(self, items) -> str:
        saved = self.fragile, self.inline_only
        self.fragile, self.inline_only = True, True
        try:
            return _trim_breaks(self._inline(items, newline=" "))
        finally:
            self.fragile, self.inline_only = saved

    # ------------------------------------------------------------ blocks

    def _captions(self, blocks: List[dict]) -> Tuple[Dict[int, str], Set[int]]:
        """Caption paragraphs next to tables ("Table 1. ..." above) and images ("Figure 1. ..."
        below, or APA's "Figure 1" and title above); those paragraphs become the captions."""
        captions: Dict[int, str] = {}
        used: Set[int] = set()

        def text_at(index: int) -> Optional[str]:
            if 0 <= index < len(blocks) and index not in used and blocks[index].get("type") == "paragraph":
                text = plain_text(blocks[index].get("content")).strip()
                return text if 0 < len(text) <= CAPTION_MAX else None
            return None

        def above(index: int, pattern) -> Optional[Tuple[str, Set[int]]]:
            first, second = text_at(index - 1), text_at(index - 2)
            if first is not None and pattern.match(first):
                return pattern.sub("", first, count=1).strip(), {index - 1}
            if first is not None and second is not None and pattern.match(second) and not pattern.sub("", second, count=1).strip():
                return first, {index - 2, index - 1}
            return None

        for index, block in enumerate(blocks):
            kind = block.get("type")
            found = None
            if kind == "table":
                found = above(index, TABLE_CAPTION)
            elif kind == "image" and not str((block.get("props") or {}).get("caption") or "").strip():
                below = text_at(index + 1)
                if below is not None and FIGURE_CAPTION.match(below):
                    found = FIGURE_CAPTION.sub("", below, count=1).strip(), {index + 1}
                else:
                    found = above(index, FIGURE_CAPTION)
            if found:
                captions[index] = found[0]
                used |= found[1]
        return captions, used

    def _blocks(self, blocks: List[dict]) -> List[str]:
        blocks = [block for block in blocks or [] if isinstance(block, dict)]
        captions, used = self._captions(blocks)
        out: List[str] = []
        index = 0
        while index < len(blocks):
            block = blocks[index]
            kind = block.get("type")
            props = block.get("props") or {}
            if index in used or id(block) in self.skip:
                index += 1
                continue
            if props.get("ceRole") == "bibliography" and kind == "heading":
                if not self.bibliography_placed:
                    out.append(BIBLIOGRAPHY_MARKER)
                    self.bibliography_placed = True
                self.bibliography_fallback.extend(self._block(block, None))
                self.bibliography_fallback.extend(self._blocks(block.get("children") or []))
                index += 1
                continue
            if props.get("ceRole") == "bibliography-entry":
                self.bibliography_fallback.extend(self._block(block, None))
                index += 1
                continue
            if kind in LIST_TYPES:
                environment = LIST_TYPES[kind]
                run = [block]
                index += 1
                while (index < len(blocks) and LIST_TYPES.get(blocks[index].get("type")) == environment
                       and index not in used and not (blocks[index].get("props") or {}).get("ceRole")):
                    run.append(blocks[index])
                    index += 1
                out.append(self._list(environment, run))
                continue
            out.extend(self._block(block, captions.get(index)))
            out.extend(self._blocks(block.get("children") or []))
            index += 1
        return [chunk for chunk in out if chunk]

    def _paragraph(self, block: dict) -> List[str]:
        body = _trim_breaks(self._inline(block.get("content")))
        if not body:
            return []
        alignment = (block.get("props") or {}).get("textAlignment")
        environment = {"center": "center", "right": "flushright"}.get(alignment)
        if environment and self.env_depth < MAX_ENV_DEPTH:
            return [f"\\begin{{{environment}}}\n{body}\n\\end{{{environment}}}"]
        return [body]

    def _block(self, block: dict, caption: Optional[str]) -> List[str]:
        kind = block.get("type")
        props = block.get("props") or {}
        if kind == "heading":
            text = self._inline_fragile(block.get("content"))
            if not text:
                return []
            level = max(1, min(6, int(_number(props.get("level"), 1, 1, 6))))
            plain = escape(" ".join(plain_text(block.get("content")).split()))
            if text != plain:
                # PDF bookmarks take plain text (hyperref warns about notes, citations, math).
                text = f"\\texorpdfstring{{{text}}}{{{plain}}}"
            return [f"\\{HEADING_COMMANDS[level]}{{{text}}}"]
        if kind == "quote":
            body = _trim_breaks(self._inline(block.get("content")))
            return [f"\\begin{{quote}}\n{body}\n\\end{{quote}}"] if body else []
        if kind == "codeBlock":
            text = "".join(item.get("text", "") for item in block.get("content") or [] if isinstance(item, dict))
            text = text.replace("\t", "    ").replace("\\end{verbatim}", "\\end {verbatim}").rstrip("\n")
            return [f"\\begin{{verbatim}}\n{text}\n\\end{{verbatim}}"] if text.strip() else []
        if kind == "equation":
            latex = str(props.get("latex") or "").strip()
            if not latex:
                return []
            environment = "gather*" if "\\\\" in latex and "\\begin" not in latex else "equation*"
            return [f"\\begin{{{environment}}}\n{latex}\n\\end{{{environment}}}"]
        if kind == "table":
            return self._table(block, caption)
        if kind == "image":
            return self._image(block, caption)
        if kind == "pageBreak":
            return ["\\newpage"]
        if kind == "divider":
            return ["\\noindent\\rule{\\linewidth}{0.4pt}"]
        if kind == "tableOfContents":
            return ["\\tableofcontents"]
        if kind in ("file", "audio", "video"):
            url = str(props.get("url") or "")
            label = escape(str(props.get("name") or props.get("caption") or url or "Attachment"))
            return [rf"\href{{{escape_url(url)}}}{{{label}}}" if url.startswith(("http://", "https://")) else label]
        if isinstance(block.get("content"), list):
            return self._paragraph(block)
        return []

    def _list(self, environment: str, items: List[dict]) -> str:
        nested = self.list_depth < MAX_LIST_DEPTH and self.env_depth < MAX_ENV_DEPTH and (
            environment != "enumerate" or self.enumerate_depth < MAX_LIST_DEPTH)
        if not nested and self.list_depth == 0:
            return "\n\n".join(chunk for item in items for chunk in [_trim_breaks(self._inline(item.get("content")))] if chunk)
        lines: List[str] = []
        if nested:
            lines.append(f"\\begin{{{environment}}}")
            start = int(_number((items[0].get("props") or {}).get("start"), 1, 1, 100000))
            if environment == "enumerate" and start > 1:
                lines.append(f"\\setcounter{{enum{'i' * (self.enumerate_depth + 1) if self.enumerate_depth < 3 else 'iv'}}}{{{start - 1}}}")
            self.list_depth += 1
            self.env_depth += 1
            self.enumerate_depth += environment == "enumerate"
        try:
            for item in items:
                lines.append(self._item(item))
        finally:
            if nested:
                self.list_depth -= 1
                self.env_depth -= 1
                self.enumerate_depth -= environment == "enumerate"
        if nested:
            lines.append(f"\\end{{{environment}}}")
        return "\n".join(lines)

    def _item(self, block: dict) -> str:
        props = block.get("props") or {}
        body = _trim_breaks(self._inline(block.get("content")))
        if block.get("type") == "checkListItem":
            head = ("\\item[$\\boxtimes$] " if props.get("checked") in (True, "true") else "\\item[$\\square$] ") + body
        else:
            head = "\\item " + ("{}" if body.startswith("[") else "") + body
        children = self._blocks(block.get("children") or [])
        return "\n\n".join([head.rstrip(), *children])

    # ------------------------------------------------------------ tables

    @staticmethod
    def _rows(block: dict) -> List[List[dict]]:
        content = block.get("content") or {}
        rows = content.get("rows") if isinstance(content, dict) else None
        out = []
        for row in rows or []:
            cells = row.get("cells") if isinstance(row, dict) else row
            normal = []
            for cell in cells or []:
                if isinstance(cell, dict) and cell.get("type") == "tableCell":
                    normal.append({"props": cell.get("props") or {}, "content": cell.get("content") or []})
                elif isinstance(cell, dict):
                    normal.append({"props": {}, "content": [cell]})
                else:
                    normal.append({"props": {}, "content": cell if isinstance(cell, list) else []})
            out.append(normal)
        return out

    def _column_shares(self, widths, rows: List[List[dict]], columns: int) -> Optional[List[float]]:
        """Each column's share of the line width (p columns), or None for natural-width l
        columns (short tables whose widths the editor does not know)."""
        if isinstance(widths, list) and len(widths) == columns and all(
                isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 for value in widths):
            total = max(float(sum(widths)), self.content_width_px)
            return [0.99 * value / total for value in widths]
        # Estimated from the text: short columns get their natural width, long ones share the rest.
        needed = [2.0] * columns  # characters, cell padding included
        for row in rows:
            column = 0
            for cell in row:
                span = max(1, int(_number((cell["props"] or {}).get("colspan"), 1, 1, columns)))
                if span == 1 and column < columns:
                    lines = plain_text(cell["content"]).split("\n")
                    needed[column] = max(needed[column], 2.0 + max(len(line) for line in lines))
                column += span
        line = self.content_width_px * 0.75 / CHARACTER_PT
        if sum(needed) <= line:
            return None
        widths: Dict[int, float] = {}
        remaining = line
        while True:
            open_columns = [column for column in range(columns) if column not in widths]
            if not open_columns:
                break
            fair = remaining / len(open_columns)
            narrow = [column for column in open_columns if needed[column] <= fair]
            if not narrow:
                total = sum(needed[column] for column in open_columns)
                for column in open_columns:
                    widths[column] = remaining * needed[column] / total
                break
            for column in narrow:
                widths[column] = needed[column]
                remaining -= needed[column]
        return [0.99 * widths[column] / line for column in range(columns)]

    @staticmethod
    def _column_spec(column: int, span: int, alignment: Optional[str], shares: Optional[List[float]]) -> str:
        if shares:
            width = f"p{{\\dimexpr {sum(shares[column:column + span]):.3f}\\linewidth-2\\tabcolsep\\relax}}"
            prefix = {"center": ">{\\centering\\arraybackslash}", "right": ">{\\raggedleft\\arraybackslash}"}.get(alignment or "", "")
            spec = prefix + width
        else:
            spec = {"center": "c", "right": "r"}.get(alignment or "", "l")
        return ("|" if column == 0 else "") + spec + "|"

    def _cell_body(self, items: List, header: bool, shares: Optional[List[float]], alignment: Optional[str]) -> str:
        lines = [_trim_breaks(self._inline(line, {"bold": True} if header else None, " "))
                 for line in WordWriter._split_lines(items)]
        while len(lines) > 1 and not lines[-1]:
            lines.pop()
        if len(lines) <= 1:
            return lines[0] if lines else ""
        if shares:
            return " \\newline ".join(lines)
        column = {"center": "c", "right": "r"}.get(alignment or "", "l")
        return (f"\\begin{{tabular}}[t]{{@{{}}{column}@{{}}}}"
                + " \\\\ ".join(("{}" + line if line.startswith(("[", "*")) else line) for line in lines)
                + "\\end{tabular}")

    def _table(self, block: dict, caption: Optional[str]) -> List[str]:
        rows = self._rows(block)
        if not rows:
            return []
        content = block.get("content") or {}
        columns = max((sum(max(1, int(_number(cell["props"].get("colspan"), 1, 1, 1000))) for cell in row) for row in rows), default=1)
        columns = max(1, columns)
        header_rows = int(_number(content.get("headerRows"), 0, 0, len(rows)))
        shares = self._column_shares(content.get("columnWidths"), rows, columns)

        def wrap(text: str, column: int, span: int, alignment: Optional[str]) -> str:
            if span > 1 or alignment in ("center", "right"):
                return f"\\multicolumn{{{span}}}{{{self._column_spec(column, span, alignment, shares)}}}{{{text}}}"
            return text

        self.deferred_notes, self.inline_only = [], True
        try:
            preamble = "|" + "".join(self._column_spec(column, 1, None, shares).lstrip("|") for column in range(columns))
            lines = [f"\\begin{{tabular}}{{{preamble}}}", "\\hline"]
            pending: Dict[int, dict] = {}  # grid column -> a cell spanning rows below
            for row_index, row in enumerate(rows):
                cells = list(row)
                parts: List[str] = []
                column = 0
                while column < columns:
                    covering = pending.get(column)
                    if covering and covering["left"] > 0:
                        covering["left"] -= 1
                        text = f"\\cellcolor[HTML]{{{covering['color']}}}" if covering["color"] else ""
                        if covering["left"] == 0:
                            text += covering["late"]
                        parts.append(wrap(text, column, covering["span"], covering["alignment"]))
                        column += covering["span"]
                        continue
                    if not cells:
                        parts.append("")
                        column += 1
                        continue
                    cell = cells.pop(0)
                    props = cell["props"]
                    span = max(1, min(columns - column, int(_number(props.get("colspan"), 1, 1, 1000))))
                    rowspan = max(1, min(len(rows) - row_index, int(_number(props.get("rowspan"), 1, 1, 1000))))
                    alignment = props.get("textAlignment")
                    color = css_color_hex(str(props.get("backgroundColor") or ""))
                    body = self._cell_body(cell["content"], row_index < header_rows, shares, alignment)
                    shade = f"\\cellcolor[HTML]{{{color}}}" if color else ""
                    if rowspan > 1:
                        width = "=" if shares else "*"
                        # A shaded merged cell is written in its last row (negative \multirow):
                        # the shading of the rows below would otherwise paint over its text.
                        late = f"\\multirow{{-{rowspan}}}{{{width}}}{{{body}}}" if color else ""
                        text = shade + ("" if color else f"\\multirow{{{rowspan}}}{{{width}}}{{{body}}}")
                        pending[column] = {"left": rowspan - 1, "span": span, "color": color, "late": late, "alignment": alignment}
                    else:
                        text = shade + body
                    parts.append(wrap(text, column, span, alignment))
                    column += span
                lines.append(" & ".join(parts) + " \\\\")
                covered: Set[int] = set()
                for start, covering in pending.items():
                    if covering["left"] > 0:
                        covered |= set(range(start, start + covering["span"]))
                if not covered:
                    lines.append("\\hline")
                else:
                    ranges, start = [], None
                    for column in range(columns + 1):
                        free = column < columns and column not in covered
                        if free and start is None:
                            start = column
                        elif not free and start is not None:
                            ranges.append(f"\\cline{{{start + 1}-{column}}}")
                            start = None
                    if ranges:
                        lines.append(" ".join(ranges))
            lines.append("\\end{tabular}")
            notes = self.deferred_notes
        finally:
            self.deferred_notes, self.inline_only = None, False
        tabular = "\n".join(lines)
        if caption is not None and self.env_depth == 0:
            chunk = f"\\begin{{table}}[htbp]\n\\centering\n\\caption{{{escape(caption)}}}\n{tabular}\n\\end{{table}}"
        elif caption is not None:
            chunk = f"\\begin{{center}}\n{escape(caption)}\n\n{tabular}\n\\end{{center}}"
        else:
            chunk = f"\\begin{{center}}\n{tabular}\n\\end{{center}}"
        out = [chunk]
        if notes:
            # \footnote does not work in a tabular: marks in the cells, texts after the table.
            out.append(f"\\addtocounter{{footnote}}{{-{len(notes)}}}"
                       + "".join(f"\\stepcounter{{footnote}}\\footnotetext{{{note}}}" for note in notes))
        return out

    # ------------------------------------------------------------ images

    def _load_image(self, url: str) -> Optional[Tuple[bytes, str]]:
        if url.startswith("data:"):
            match = re.match(r"data:([\w/+.-]+);base64,(.*)", url, re.S)
            if not match:
                return None
            try:
                return base64.b64decode(match.group(2)), match.group(1).lower()
            except (binascii.Error, ValueError):
                return None
        if self.image_loader and url:
            try:
                return self.image_loader(url)
            except Exception:
                return None
        return None

    @staticmethod
    def _figure_file(data: bytes, content_type: str) -> Optional[Tuple[bytes, str, Tuple[int, int]]]:
        """PNG and JPEG as they are; other formats (GIF, WebP, BMP, TIFF) as PNG for pdfLaTeX.
        SVG cannot be drawn here (no SVG renderer is installed)."""
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data)) as image:
                size = image.size
                if content_type in ("image/png", "image/jpeg", "image/jpg") and image.format in ("PNG", "JPEG"):
                    return data, "png" if image.format == "PNG" else "jpg", size
                buffer = io.BytesIO()
                image.convert("RGBA").save(buffer, "PNG")
                return buffer.getvalue(), "png", size
        except Exception:
            return None

    def _image(self, block: dict, caption: Optional[str]) -> List[str]:
        props = block.get("props") or {}
        url = str(props.get("url") or "")
        own = str(props.get("caption") or "").strip()
        # LaTeX numbers figures itself: "Figure 1. Mean sleep" would print "Figure 1: Figure 1. Mean sleep".
        caption = (FIGURE_CAPTION.sub("", own, count=1).strip() or own) if own else caption
        loaded = self._load_image(url)
        figure = self._figure_file(*loaded) if loaded else None
        if not figure:
            name = escape(caption or str(props.get("name") or "") or "Image")
            return [f"\\begin{{center}}\n\\textit{{[{name}]}}\n\\end{{center}}"]
        data, extension, (natural_width, _height) = figure
        path = f"figures/fig-{len(self.figures) + 1}.{extension}"
        self.figures.append((path, data))
        width_px = _number(props.get("previewWidth"), float(natural_width or self.content_width_px), 1, 100000)
        ratio = min(1.0, width_px / self.content_width_px)
        width = "\\linewidth" if ratio >= 0.995 else f"{ratio:.2f}\\linewidth"
        graphic = f"\\includegraphics[width={width},height=0.85\\textheight,keepaspectratio]{{{path}}}"
        if caption and self.env_depth == 0:
            return [f"\\begin{{figure}}[htbp]\n\\centering\n{graphic}\n\\caption{{{escape(caption)}}}\n\\end{{figure}}"]
        if caption:
            return [f"\\begin{{center}}\n{graphic}\n\n{escape(caption)}\n\\end{{center}}"]
        return [f"\\begin{{center}}\n{graphic}\n\\end{{center}}"]

    # ------------------------------------------------------------ document

    def _title(self) -> Optional[str]:
        """The Title-styled heading (and a Subtitle after it), or the document's name: then a
        first heading that repeats the name is the title instead of a section."""
        for index, block in enumerate(self.blocks):
            if (block.get("props") or {}).get("wordStyle") == "Title" and block.get("type") in ("heading", "paragraph"):
                self.skip.add(id(block))
                title = self._inline_fragile(block.get("content"))
                following = self.blocks[index + 1] if index + 1 < len(self.blocks) else None
                if following and (following.get("props") or {}).get("wordStyle") == "Subtitle":
                    subtitle = self._inline_fragile(following.get("content"))
                    if subtitle:
                        self.skip.add(id(following))
                        title = f"{title}\\\\[0.5em]\\large {subtitle}"
                return title or None
        if self.title.lower() in PLACEHOLDER_TITLES:
            return None
        first = self.blocks[0] if self.blocks else None
        if first and first.get("type") == "heading" and int(_number((first.get("props") or {}).get("level"), 1, 1, 6)) == 1:
            if " ".join(plain_text(first.get("content")).split()).lower() == " ".join(self.title.split()).lower():
                self.skip.add(id(first))
                return self._inline_fragile(first.get("content")) or escape(self.title)
        return escape(self.title)

    def write(self) -> bytes:
        title = self._title()
        body = "\n\n".join(self._blocks(self.blocks))
        cited = bool(self.bibliography.entries)
        if cited:
            if BIBLIOGRAPHY_MARKER in body:
                body = body.replace(BIBLIOGRAPHY_MARKER, "\\bibliography{references}", 1)
            else:
                body = body + "\n\n\\bibliography{references}"
        elif BIBLIOGRAPHY_MARKER in body:
            body = body.replace(BIBLIOGRAPHY_MARKER, "\n\n".join(self.bibliography_fallback), 1)

        page = self.page
        geometry = ",".join(f"{name}={page[key]:g}pt" for name, key in (
            ("paperwidth", "width"), ("paperheight", "height"), ("top", "top"), ("bottom", "bottom"),
            ("left", "left"), ("right", "right")))
        pdf_title = re.sub(r"\\\\\[0\.5em\]\\large ", ": ", title) if title else ""
        lines = [
            "% Exported from the Videmak editor.",
            "% Compile with pdfLaTeX and BibTeX (Overleaf's defaults).",
            "\\documentclass[12pt]{article}",
            "\\usepackage[utf8]{inputenc}",
            "\\usepackage[T1]{fontenc}",
            "\\usepackage{lmodern}",
            f"\\usepackage[{geometry}]{{geometry}}",
            "\\usepackage{amsmath}",
            "\\usepackage{amssymb}",
            "\\usepackage{graphicx}",
            "\\usepackage[table]{xcolor}",
            "\\usepackage[normalem]{ulem}",
            "\\usepackage{soul}",
            "\\usepackage{booktabs}",
            "\\usepackage{multirow}",
            "\\usepackage{array}",
            "\\usepackage{natbib}",
            "\\usepackage{hyperref}",
            "\\hypersetup{colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue"
            + (f",pdftitle={{{pdf_title}}}" if pdf_title else "")
            + (f",pdfauthor={{{escape(self.author)}}}" if self.author else "") + "}",
            "% Headings are unnumbered, as in the editor; delete this line to number them.",
            "\\setcounter{secnumdepth}{0}",
            # Shorthands the editor's equation renderer (KaTeX) knows and LaTeX does not.
            "\\providecommand{\\R}{\\mathbb{R}}",
            "\\providecommand{\\N}{\\mathbb{N}}",
            "\\providecommand{\\Z}{\\mathbb{Z}}",
            "\\providecommand{\\Q}{\\mathbb{Q}}",
        ]
        lines += [f"\\definecolor{{{name}}}{{HTML}}{{{color}}}" for color, name in self.highlight_colors.items()]
        if cited:
            lines.append("\\bibliographystyle{apalike}")
        if title:
            lines.append(f"\\title{{{title}}}")
            if self.author:
                lines.append(f"\\author{{{escape(self.author)}}}")
            lines.append("\\date{}")
        lines += ["", "\\begin{document}", ""]
        if title:
            lines += ["\\maketitle", ""]
        tex = "\n".join(lines) + body + "\n\n\\end{document}\n"

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
            package.writestr("main.tex", tex.encode("utf-8"))
            if cited:
                package.writestr("references.bib", self.bibliography.text().encode("utf-8"))
            for path, data in self.figures:
                package.writestr(path, data)
        return output.getvalue()


def write_latex(blocks: List[dict], settings: Optional[dict] = None, title: Optional[str] = None,
                author: Optional[str] = None, image_loader: Optional[ImageLoader] = None) -> bytes:
    """The document as a LaTeX project: a zip with main.tex, references.bib (when it cites
    anything) and figures/fig-N.<ext>."""
    return LatexWriter(blocks, settings, title, author, image_loader).write()
