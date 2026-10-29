"""Word equations (OMML) <-> LaTeX, for the editor's math (rendered with KaTeX).

Covers what academic writing uses: fractions, scripts, roots, n-ary operators (sums,
integrals, products), delimiters, functions, accents, limits and matrices. Anything
else falls back to its text, so an equation is never dropped.
"""

from __future__ import annotations

import re
from typing import List

from lxml import etree

from .ooxml import NS, M, local

SYMBOLS = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\epsilon", "ϵ": r"\epsilon",
    "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta", "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda",
    "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho", "σ": r"\sigma", "τ": r"\tau",
    "υ": r"\upsilon", "φ": r"\phi", "ϕ": r"\phi", "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega",
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda", "Ξ": r"\Xi", "Π": r"\Pi",
    "Σ": r"\Sigma", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
    "×": r"\times", "÷": r"\div", "±": r"\pm", "∓": r"\mp", "≤": r"\leq", "≥": r"\geq", "≠": r"\neq",
    "≈": r"\approx", "≡": r"\equiv", "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "·": r"\cdot",
    "→": r"\rightarrow", "←": r"\leftarrow", "⇒": r"\Rightarrow", "⇔": r"\Leftrightarrow",
    "∈": r"\in", "∉": r"\notin", "⊂": r"\subset", "⊆": r"\subseteq", "∪": r"\cup", "∩": r"\cap",
    "∀": r"\forall", "∃": r"\exists", "∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∮": r"\oint",
    "√": r"\surd", "…": r"\ldots", "⋯": r"\cdots", "°": r"^{\circ}", "′": "'", "∝": r"\propto",
}
NARY = {"∑": r"\sum", "∏": r"\prod", "∫": r"\int", "∬": r"\iint", "∭": r"\iiint", "∮": r"\oint", "⋃": r"\bigcup", "⋂": r"\bigcap"}
ACCENTS = {"̂": r"\hat", "^": r"\hat", "̃": r"\tilde", "~": r"\tilde", "̄": r"\bar", "¯": r"\bar", "̇": r"\dot", "̈": r"\ddot", "⃗": r"\vec", "→": r"\vec"}
FUNCTIONS = {"sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "max", "min", "sup", "inf", "det", "arg", "sinh", "cosh", "tanh"}


def _m(name: str) -> str:
    return M + name


def _child(element, name: str):
    return element.find(_m(name)) if element is not None else None


def _prop(element, container: str, name: str):
    pr = _child(element, container)
    node = _child(pr, name) if pr is not None else None
    return node.get(_m("val")) if node is not None else None


def _text(value: str) -> str:
    out = []
    for char in value:
        out.append(SYMBOLS.get(char, char) + (" " if char in SYMBOLS and SYMBOLS[char].startswith("\\") else ""))
    text = "".join(out)
    return re.sub(r"(\\[a-zA-Z]+) (?=[^a-zA-Z])", r"\1", text).rstrip()


def _group(value: str) -> str:
    value = value.strip()
    return value if len(value) == 1 else "{" + value + "}"


def omml_to_latex(element) -> str:
    """LaTeX for an m:oMath / m:oMathPara element (or any OMML subtree)."""
    return re.sub(r"\s+", " ", _convert(element)).strip()


def _children(element) -> str:
    return "".join(_convert(child) for child in element)


def _convert(element) -> str:
    if not isinstance(element.tag, str):
        return ""
    name = local(element)
    if element.tag.startswith("{%s}" % NS["w"]):
        # Word runs inside math (rare): take their text.
        return _text("".join(element.itertext()))
    if name in {"oMathPara", "oMath", "e", "num", "den", "sub", "sup", "deg", "lim", "fName", "mr", "box", "borderBox"}:
        if name == "oMathPara":
            return " \\\\ ".join(_convert(child) for child in element.findall(_m("oMath")))
        return _children(element)
    if name == "r":
        text = "".join(t.text or "" for t in element.findall(_m("t")))
        if text in FUNCTIONS:
            return "\\" + text + " "
        return _text(text)
    if name == "f":
        num, den = _convert(_child(element, "num")), _convert(_child(element, "den"))
        if _prop(element, "fPr", "type") == "lin":
            return f"{_group(num)}/{_group(den)}"
        return f"\\frac{{{num}}}{{{den}}}"
    if name == "sSup":
        return f"{_group(_convert(_child(element, 'e')))}^{{{_convert(_child(element, 'sup'))}}}"
    if name == "sSub":
        return f"{_group(_convert(_child(element, 'e')))}_{{{_convert(_child(element, 'sub'))}}}"
    if name == "sSubSup":
        return f"{_group(_convert(_child(element, 'e')))}_{{{_convert(_child(element, 'sub'))}}}^{{{_convert(_child(element, 'sup'))}}}"
    if name == "sPre":
        return f"{{}}_{{{_convert(_child(element, 'sub'))}}}^{{{_convert(_child(element, 'sup'))}}}{_group(_convert(_child(element, 'e')))}"
    if name == "rad":
        degree = _child(element, "deg")
        degree_text = _convert(degree) if degree is not None else ""
        body = _convert(_child(element, "e"))
        return f"\\sqrt[{degree_text}]{{{body}}}" if degree_text.strip() else f"\\sqrt{{{body}}}"
    if name == "nary":
        char = _prop(element, "naryPr", "chr") or "∫"
        operator = NARY.get(char, SYMBOLS.get(char, char))
        sub, sup = _child(element, "sub"), _child(element, "sup")
        out = operator
        if sub is not None and _convert(sub).strip():
            out += f"_{{{_convert(sub)}}}"
        if sup is not None and _convert(sup).strip():
            out += f"^{{{_convert(sup)}}}"
        return out + " " + _convert(_child(element, "e"))
    if name == "d":
        begin = _prop(element, "dPr", "begChr")
        end = _prop(element, "dPr", "endChr")
        sep = _prop(element, "dPr", "sepChr") or ","
        begin = "(" if begin is None else begin
        end = ")" if end is None else end
        inner = sep.join(_convert(e) for e in element.findall(_m("e")))
        fence = {"{": r"\{", "}": r"\}", "": ".", "⟨": r"\langle", "⟩": r"\rangle", "|": "|", "‖": r"\|"}
        return f"\\left{fence.get(begin, begin)}{inner}\\right{fence.get(end, end)}"
    if name == "func":
        fname = _convert(_child(element, "fName")).strip()
        if fname.lstrip("\\") in FUNCTIONS and not fname.startswith("\\"):
            fname = "\\" + fname
        return f"{fname}{{{_convert(_child(element, 'e'))}}}"
    if name == "acc":
        char = _prop(element, "accPr", "chr") or "̂"
        return f"{ACCENTS.get(char, r'\hat')}{{{_convert(_child(element, 'e'))}}}"
    if name == "bar":
        position = _prop(element, "barPr", "pos")
        command = r"\underline" if position == "bot" else r"\overline"
        return f"{command}{{{_convert(_child(element, 'e'))}}}"
    if name == "limLow":
        return f"{_group(_convert(_child(element, 'e')))}_{{{_convert(_child(element, 'lim'))}}}"
    if name == "limUpp":
        return f"\\overset{{{_convert(_child(element, 'lim'))}}}{{{_convert(_child(element, 'e'))}}}"
    if name == "groupChr":
        position = _prop(element, "groupChrPr", "pos")
        command = r"\overbrace" if position == "top" else r"\underbrace"
        return f"{command}{{{_convert(_child(element, 'e'))}}}"
    if name == "m":
        rows = [" & ".join(_convert(cell) for cell in row.findall(_m("e"))) for row in element.findall(_m("mr"))]
        return "\\begin{matrix}" + " \\\\ ".join(rows) + "\\end{matrix}"
    if name == "eqArr":
        rows = [_convert(cell) for cell in element.findall(_m("e"))]
        return "\\begin{aligned}" + " \\\\ ".join(rows) + "\\end{aligned}"
    if name.endswith("Pr") or name in {"ctrlPr", "argPr"}:
        return ""
    return _children(element)


# ---------------------------------------------------------------- LaTeX -> OMML

MATHML = "{http://www.w3.org/1998/Math/MathML}"
LARGE_OPERATORS = {"∑", "∏", "∫", "∬", "∭", "∮", "⋃", "⋂"}


def _mel(name: str, *children, **attrs):
    element = etree.Element(_m(name))
    for key, value in attrs.items():
        element.set(_m(key), value)
    for child in children:
        if child is not None:
            element.append(child)
    return element


def _run(text: str, plain: bool = False):
    run = _mel("r")
    if plain:
        rpr = _mel("rPr")
        rpr.append(_mel("sty", val="p"))
        run.append(rpr)
    t = etree.SubElement(run, _m("t"))
    t.text = text
    if text != text.strip():
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return run


def _wrap(name: str, nodes: List) -> etree._Element:
    container = _mel(name)
    for node in nodes:
        container.append(node)
    return container


# Where the body of a sum or integral ends: the next term starts after one of these.
_TERM_BREAKS = {"+", "-", "−", "=", "<", ">", "≤", "≥", "≠", "≈", "±", "∓", ","}


def _attach_nary_bodies(nodes: List) -> List:
    """latex2mathml puts the summand after the operator (\\sum_{i=1}^{n} x_i → ∑, then x_i);
    Word wants it inside m:nary's m:e, or it shows an empty placeholder box next to the ∑."""
    out = []
    index = 0
    while index < len(nodes):
        node = nodes[index]
        out.append(node)
        index += 1
        body = node.find(_m("e")) if etree.QName(node).localname == "nary" else None
        if body is None or len(body):
            continue
        taken = []
        while index < len(nodes):
            following = nodes[index]
            if etree.QName(following).localname == "r" and "".join(following.itertext()).strip() in _TERM_BREAKS:
                break
            taken.append(following)
            index += 1
        for child in _attach_nary_bodies(taken):
            body.append(child)
    return out


def _mathml_nodes(element) -> List:
    tag = etree.QName(element).localname if isinstance(element.tag, str) else ""
    kids = [child for child in element if isinstance(child.tag, str)]
    if tag in {"math", "mrow", "mstyle", "mpadded", "mphantom", "menclose"}:
        return _attach_nary_bodies([node for child in kids for node in _mathml_nodes(child)])
    if tag == "semantics":
        return _mathml_nodes(kids[0]) if kids else []
    if tag in {"mi", "mn", "mtext", "ms"}:
        text = element.text or ""
        plain = tag != "mi" or len(text) > 1 or element.get("mathvariant") == "normal"
        return [_run(text, plain=plain)]
    if tag == "mo":
        return [_run(element.text or "", plain=True)]
    if tag == "mspace":
        return [_run(" ", plain=True)]
    if tag == "mfrac" and len(kids) == 2:
        return [_mel("f", _wrap("num", _mathml_nodes(kids[0])), _wrap("den", _mathml_nodes(kids[1])))]
    if tag == "msqrt":
        rad = _mel("rad", _mel("radPr", _mel("degHide", val="1")), _mel("deg"))
        rad.append(_wrap("e", [node for child in kids for node in _mathml_nodes(child)]))
        return [rad]
    if tag == "mroot" and len(kids) == 2:
        return [_mel("rad", _mel("radPr"), _wrap("deg", _mathml_nodes(kids[1])), _wrap("e", _mathml_nodes(kids[0])))]
    if tag in {"msup", "msub", "msubsup", "munder", "mover", "munderover"} and kids:
        base = kids[0]
        base_text = (base.text or "").strip() if etree.QName(base).localname == "mo" else ""
        if base_text in LARGE_OPERATORS:
            sub = kids[1] if tag in {"msub", "msubsup", "munder", "munderover"} and len(kids) > 1 else None
            sup = kids[-1] if tag in {"msup", "msubsup", "mover", "munderover"} and len(kids) > 1 else None
            if tag in {"msup", "mover"}:
                sub = None
            props = _mel("naryPr", _mel("chr", val=base_text), _mel("limLoc", val="undOvr" if tag.startswith("mu") else "subSup"))
            if sub is None:
                props.append(_mel("subHide", val="1"))
            if sup is None:
                props.append(_mel("supHide", val="1"))
            nary = _mel("nary", props, _wrap("sub", _mathml_nodes(sub) if sub is not None else []),
                        _wrap("sup", _mathml_nodes(sup) if sup is not None else []), _mel("e"))
            return [nary]
        if tag in {"msup", "mover"} and len(kids) == 2:
            if tag == "mover" and (kids[1].text or "").strip() in {"^", "ˆ", "~", "˜", "¯", "‾", "→", "⃗", "˙"}:
                return [_mel("acc", _mel("accPr", _mel("chr", val=(kids[1].text or "").strip())), _wrap("e", _mathml_nodes(base)))]
            return [_mel("sSup", _wrap("e", _mathml_nodes(base)), _wrap("sup", _mathml_nodes(kids[1])))]
        if tag in {"msub", "munder"} and len(kids) == 2:
            return [_mel("sSub", _wrap("e", _mathml_nodes(base)), _wrap("sub", _mathml_nodes(kids[1])))]
        if len(kids) == 3:
            return [_mel("sSubSup", _wrap("e", _mathml_nodes(base)), _wrap("sub", _mathml_nodes(kids[1])), _wrap("sup", _mathml_nodes(kids[2])))]
    if tag == "mtable":
        matrix = _mel("m")
        for row in kids:
            mr = _mel("mr")
            for cell in row:
                if isinstance(cell.tag, str):
                    mr.append(_wrap("e", _mathml_nodes(cell)))
            matrix.append(mr)
        return [matrix]
    if tag == "mfenced":
        open_char, close_char = element.get("open", "("), element.get("close", ")")
        inner = [node for child in kids for node in _mathml_nodes(child)]
        return [_mel("d", _mel("dPr", _mel("begChr", val=open_char), _mel("endChr", val=close_char)), _wrap("e", inner))]
    nodes = [node for child in kids for node in _mathml_nodes(child)]
    if not nodes and (element.text or "").strip():
        nodes = [_run(element.text.strip(), plain=True)]
    return nodes


def latex_to_omml(latex: str, display: bool = False):
    """An m:oMath (or m:oMathPara for display equations) element; plain text if it can't be parsed."""
    try:
        from latex2mathml.converter import convert

        mathml = etree.fromstring(convert(latex).encode())
        nodes = _mathml_nodes(mathml)
    except Exception:
        nodes = [_run(latex, plain=True)]
    omath = _wrap("oMath", nodes or [_run(latex, plain=True)])
    return _wrap("oMathPara", [omath]) if display else omath
