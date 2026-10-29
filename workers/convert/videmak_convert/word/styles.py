"""Effective formatting from a Word package: document defaults, style chains, theme fonts
and list numbering definitions."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Dict, Optional

from .ooxml import NS, W, on_off, parse_xml, to_number, wattr


@dataclass
class RunFormat:
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    strike: Optional[bool] = None
    caps: Optional[bool] = None
    small_caps: Optional[bool] = None
    color: Optional[str] = None
    highlight: Optional[str] = None
    font: Optional[str] = None
    size_pt: Optional[float] = None
    vertical: Optional[str] = None  # "super" | "sub"

    def merged(self, other: "RunFormat") -> "RunFormat":
        result = copy.copy(self)
        for name, value in other.__dict__.items():
            if value is not None:
                setattr(result, name, value)
        return result


@dataclass
class ParaFormat:
    align: Optional[str] = None
    space_before: Optional[float] = None  # pt
    space_after: Optional[float] = None  # pt
    line: Optional[str] = None  # "1.5" (multiple) or "exact:14" / "atLeast:14" (pt)
    indent_left: Optional[float] = None  # pt
    indent_right: Optional[float] = None
    indent_first: Optional[float] = None  # pt; negative = hanging
    shading: Optional[str] = None
    page_break_before: Optional[bool] = None
    outline_level: Optional[int] = None
    num_id: Optional[str] = None
    ilvl: Optional[int] = None

    def merged(self, other: "ParaFormat") -> "ParaFormat":
        result = copy.copy(self)
        for name, value in other.__dict__.items():
            if value is not None:
                setattr(result, name, value)
        return result


@dataclass
class Style:
    style_id: str
    name: str
    kind: str
    based_on: Optional[str]
    para: ParaFormat
    run: RunFormat


@dataclass
class ListLevel:
    fmt: str
    text: str
    start: int
    indent_left: Optional[float] = None  # pt


@dataclass
class Numbering:
    levels: Dict[str, Dict[int, ListLevel]] = field(default_factory=dict)  # numId -> ilvl -> level

    def level(self, num_id: Optional[str], ilvl: int) -> Optional[ListLevel]:
        if not num_id:
            return None
        return self.levels.get(num_id, {}).get(ilvl) or self.levels.get(num_id, {}).get(0)


ALIGN = {"left": "left", "start": "left", "center": "center", "right": "right", "end": "right", "both": "justify", "distribute": "justify", "justify": "justify"}


def parse_run_format(rpr, theme_fonts: Dict[str, str]) -> RunFormat:
    fmt = RunFormat()
    if rpr is None:
        return fmt
    fmt.bold = on_off(rpr.find(W + "b"))
    fmt.italic = on_off(rpr.find(W + "i"))
    underline = rpr.find(W + "u")
    if underline is not None:
        fmt.underline = (wattr(underline, "val") or "single") != "none"
    strike = rpr.find(W + "strike")
    dstrike = rpr.find(W + "dstrike")
    if strike is not None or dstrike is not None:
        fmt.strike = bool(on_off(strike)) or bool(on_off(dstrike))
    fmt.caps = on_off(rpr.find(W + "caps"))
    fmt.small_caps = on_off(rpr.find(W + "smallCaps"))
    color = rpr.find(W + "color")
    if color is not None:
        value = wattr(color, "val")
        fmt.color = None if not value or value == "auto" else "#" + value.upper()
        if value == "auto":
            fmt.color = "auto"
    highlight = rpr.find(W + "highlight")
    if highlight is not None and wattr(highlight, "val") not in (None, "none"):
        from .ooxml import HIGHLIGHT_HEX

        fmt.highlight = HIGHLIGHT_HEX.get(wattr(highlight, "val"), None)
    shading = rpr.find(W + "shd")
    if fmt.highlight is None and shading is not None:
        fill = wattr(shading, "fill")
        if fill and fill not in ("auto", "FFFFFF"):
            fmt.highlight = "#" + fill.upper()
    fonts = rpr.find(W + "rFonts")
    if fonts is not None:
        name = wattr(fonts, "ascii") or wattr(fonts, "hAnsi")
        theme = wattr(fonts, "asciiTheme") or wattr(fonts, "hAnsiTheme")
        if not name and theme:
            name = theme_fonts.get("major" if theme.startswith("major") else "minor")
        if name:
            fmt.font = name
    size = rpr.find(W + "sz")
    if size is not None and to_number(wattr(size, "val")):
        fmt.size_pt = to_number(wattr(size, "val")) / 2
    vertical = rpr.find(W + "vertAlign")
    if vertical is not None:
        value = wattr(vertical, "val")
        fmt.vertical = "super" if value == "superscript" else "sub" if value == "subscript" else "baseline"
    return fmt


def parse_para_format(ppr) -> ParaFormat:
    fmt = ParaFormat()
    if ppr is None:
        return fmt
    jc = ppr.find(W + "jc")
    if jc is not None:
        fmt.align = ALIGN.get(wattr(jc, "val") or "", None)
    spacing = ppr.find(W + "spacing")
    if spacing is not None:
        before, after = to_number(wattr(spacing, "before")), to_number(wattr(spacing, "after"))
        if before is not None:
            fmt.space_before = before / 20
        if after is not None:
            fmt.space_after = after / 20
        line = to_number(wattr(spacing, "line"))
        rule = wattr(spacing, "lineRule") or "auto"
        if line:
            fmt.line = f"{round(line / 240, 2):g}" if rule == "auto" else f"{rule}:{line / 20:g}"
    ind = ppr.find(W + "ind")
    if ind is not None:
        left = to_number(wattr(ind, "left") or wattr(ind, "start"))
        right = to_number(wattr(ind, "right") or wattr(ind, "end"))
        first = to_number(wattr(ind, "firstLine"))
        hanging = to_number(wattr(ind, "hanging"))
        if left is not None:
            fmt.indent_left = left / 20
        if right is not None:
            fmt.indent_right = right / 20
        if hanging:
            fmt.indent_first = -hanging / 20
        elif first is not None:
            fmt.indent_first = first / 20
    shading = ppr.find(W + "shd")
    if shading is not None:
        fill = wattr(shading, "fill")
        if fill and fill not in ("auto",):
            fmt.shading = "#" + fill.upper()
    fmt.page_break_before = on_off(ppr.find(W + "pageBreakBefore"))
    outline = ppr.find(W + "outlineLvl")
    if outline is not None and to_number(wattr(outline, "val")) is not None:
        fmt.outline_level = int(to_number(wattr(outline, "val")))
    numpr = ppr.find(W + "numPr")
    if numpr is not None:
        num_id = numpr.find(W + "numId")
        ilvl = numpr.find(W + "ilvl")
        fmt.num_id = wattr(num_id, "val") if num_id is not None else None
        fmt.ilvl = int(to_number(wattr(ilvl, "val")) or 0) if ilvl is not None else 0
    return fmt


class StyleSheet:
    """Styles, defaults and numbering of one Word package."""

    def __init__(self, styles_xml: Optional[bytes], numbering_xml: Optional[bytes], theme_xml: Optional[bytes]):
        self.theme_fonts = self._theme_fonts(theme_xml)
        self.styles: Dict[str, Style] = {}
        self.default_para = ParaFormat()
        self.default_run = RunFormat()
        self.default_paragraph_style: Optional[str] = None
        self.default_character_style: Optional[str] = None
        if styles_xml:
            self._load_styles(parse_xml(styles_xml))
        self.numbering = self._load_numbering(parse_xml(numbering_xml)) if numbering_xml else Numbering()
        self._para_cache: Dict[str, ParaFormat] = {}
        self._run_cache: Dict[str, RunFormat] = {}

    @staticmethod
    def _theme_fonts(theme_xml: Optional[bytes]) -> Dict[str, str]:
        fonts = {"major": "Calibri Light", "minor": "Calibri"}
        if not theme_xml:
            return fonts
        try:
            root = parse_xml(theme_xml)
            for key in ("major", "minor"):
                latin = root.find(".//{%s}%sFont/{%s}latin" % (NS["a"], key, NS["a"]))
                if latin is not None and latin.get("typeface"):
                    fonts[key] = latin.get("typeface")
        except Exception:
            pass
        return fonts

    def _load_styles(self, root) -> None:
        defaults = root.find(W + "docDefaults")
        if defaults is not None:
            self.default_run = parse_run_format(defaults.find(f"{W}rPrDefault/{W}rPr"), self.theme_fonts)
            self.default_para = parse_para_format(defaults.find(f"{W}pPrDefault/{W}pPr"))
        for node in root.findall(W + "style"):
            style_id = wattr(node, "styleId") or ""
            name_node = node.find(W + "name")
            based = node.find(W + "basedOn")
            kind = wattr(node, "type") or "paragraph"
            style = Style(
                style_id=style_id,
                name=(wattr(name_node, "val") or style_id) if name_node is not None else style_id,
                kind=kind,
                based_on=wattr(based, "val") if based is not None else None,
                para=parse_para_format(node.find(W + "pPr")),
                run=parse_run_format(node.find(W + "rPr"), self.theme_fonts),
            )
            self.styles[style_id] = style
            if wattr(node, "default") in ("1", "true"):
                if kind == "paragraph":
                    self.default_paragraph_style = style_id
                elif kind == "character":
                    self.default_character_style = style_id

    @staticmethod
    def _load_numbering(root) -> Numbering:
        abstract: Dict[str, Dict[int, ListLevel]] = {}
        for node in root.findall(W + "abstractNum"):
            levels: Dict[int, ListLevel] = {}
            for lvl in node.findall(W + "lvl"):
                ilvl = int(to_number(wattr(lvl, "ilvl")) or 0)
                fmt = lvl.find(W + "numFmt")
                text = lvl.find(W + "lvlText")
                start = lvl.find(W + "start")
                levels[ilvl] = ListLevel(
                    fmt=wattr(fmt, "val") if fmt is not None else "decimal",
                    text=wattr(text, "val") if text is not None else "",
                    start=int(to_number(wattr(start, "val")) or 1) if start is not None else 1,
                    indent_left=parse_para_format(lvl.find(W + "pPr")).indent_left,
                )
            abstract[wattr(node, "abstractNumId") or ""] = levels
        numbering = Numbering()
        for node in root.findall(W + "num"):
            ref = node.find(W + "abstractNumId")
            levels = dict(abstract.get(wattr(ref, "val") if ref is not None else "", {}))
            for override in node.findall(W + "lvlOverride"):
                ilvl = int(to_number(wattr(override, "ilvl")) or 0)
                start = override.find(W + "startOverride")
                if start is not None and ilvl in levels:
                    levels[ilvl] = ListLevel(levels[ilvl].fmt, levels[ilvl].text, int(to_number(wattr(start, "val")) or 1), levels[ilvl].indent_left)
            numbering.levels[wattr(node, "numId") or ""] = levels
        return numbering

    def _chain(self, style_id: Optional[str]):
        seen, chain = set(), []
        while style_id and style_id in self.styles and style_id not in seen:
            seen.add(style_id)
            chain.append(self.styles[style_id])
            style_id = self.styles[style_id].based_on
        return list(reversed(chain))

    def paragraph_format(self, style_id: Optional[str]) -> ParaFormat:
        key = style_id or ""
        if key not in self._para_cache:
            fmt = self.default_para
            for style in self._chain(style_id or self.default_paragraph_style):
                fmt = fmt.merged(style.para)
            self._para_cache[key] = fmt
        return self._para_cache[key]

    def paragraph_run_format(self, style_id: Optional[str]) -> RunFormat:
        key = style_id or ""
        if key not in self._run_cache:
            fmt = self.default_run
            for style in self._chain(style_id or self.default_paragraph_style):
                fmt = fmt.merged(style.run)
            self._run_cache[key] = fmt
        return self._run_cache[key]

    def character_format(self, style_id: Optional[str]) -> RunFormat:
        fmt = RunFormat()
        for style in self._chain(style_id):
            fmt = fmt.merged(style.run)
        return fmt

    def name(self, style_id: Optional[str]) -> str:
        style = self.styles.get(style_id or "")
        return (style.name if style else style_id or "").strip()

    def heading_level(self, style_id: Optional[str], para: ParaFormat) -> Optional[int]:
        """1-6 for Heading 1..6 (by name or outline level), 1 for Title."""
        for style in reversed(self._chain(style_id)):
            name = style.name.lower()
            if name.startswith("heading ") and name[8:].strip().isdigit():
                return max(1, min(6, int(name[8:].strip())))
            if name == "title":
                return 1
        if para.outline_level is not None and 0 <= para.outline_level <= 5:
            return para.outline_level + 1
        return None

    def is_title(self, style_id: Optional[str]) -> bool:
        return any(style.name.lower() in {"title", "subtitle"} for style in self._chain(style_id))

    def is_quote(self, style_id: Optional[str]) -> bool:
        return any(style.name.lower() in {"quote", "intense quote"} for style in self._chain(style_id))
