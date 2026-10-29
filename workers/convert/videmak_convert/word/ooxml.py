"""OOXML namespaces, units and small helpers shared by the Word reader and writer."""

from __future__ import annotations

from typing import Optional

from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "v": "urn:schemas-microsoft-com:vml",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
}

W = "{%s}" % NS["w"]
R = "{%s}" % NS["r"]
M = "{%s}" % NS["m"]

EMU_PER_PX = 9525
TWIPS_PER_PT = 20


def q(tag: str) -> str:
    """'w:p' -> '{namespace}p'."""
    prefix, local = tag.split(":")
    return "{%s}%s" % (NS[prefix], local)


def local(element) -> str:
    return etree.QName(element).localname if isinstance(element.tag, str) else ""


def wattr(element, name: str) -> Optional[str]:
    if element is None:
        return None
    return element.get(W + name)


def parse_xml(data: bytes):
    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=True, remove_blank_text=False)
    return etree.fromstring(data, parser)


def to_number(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def on_off(element) -> Optional[bool]:
    """w:b, w:i ... are on unless val is false/0/off."""
    if element is None:
        return None
    value = wattr(element, "val")
    return value is None or value.lower() not in {"0", "false", "off", "none"}


def fmt_pt(value: float) -> str:
    """Compact point value: 12.0 -> '12', 10.5 -> '10.5'."""
    rounded = round(value, 2)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


HIGHLIGHT_HEX = {
    "yellow": "#FFFF00", "green": "#00FF00", "cyan": "#00FFFF", "magenta": "#FF00FF",
    "blue": "#0000FF", "red": "#FF0000", "darkBlue": "#000080", "darkCyan": "#008080",
    "darkGreen": "#008000", "darkMagenta": "#800080", "darkRed": "#800000",
    "darkYellow": "#808000", "darkGray": "#808080", "lightGray": "#C0C0C0", "black": "#000000",
    "white": "#FFFFFF",
}
HEX_HIGHLIGHT = {value: key for key, value in HIGHLIGHT_HEX.items()}


# The order Word's schema requires inside paragraph and run properties (ECMA-376 CT_PPr,
# CT_RPr). Word reports "unreadable content" when, say, w:shd comes after w:spacing.
PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers",
    "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
    "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle",
    "rPr", "sectPr", "pPrChange",
]
RPR_ORDER = [
    "ins", "del", "moveFrom", "moveTo", "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
    "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color",
    "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
    "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange",
]
_RANKS = {"pPr": {name: index for index, name in enumerate(PPR_ORDER)}, "rPr": {name: index for index, name in enumerate(RPR_ORDER)}}


def order_properties(root) -> None:
    """Puts the children of every w:pPr and w:rPr in schema order (others keep their place, last)."""
    for kind, ranks in _RANKS.items():
        for props in root.iter(W + kind):
            children = list(props)
            ordered = sorted(
                children,
                key=lambda child: ranks.get(local(child), len(ranks)) if child.tag.startswith(W) else len(ranks),
            )
            if ordered != children:
                for child in children:
                    props.remove(child)
                props.extend(ordered)
