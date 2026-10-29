"""LaTeX export: editor blocks -> a pdfLaTeX project (main.tex, references.bib, figures/).

Ported from the editor's original server tests. When pdflatex and bibtex are installed, the
representative document is also compiled.
"""
import base64
import io
import json
import shutil
import subprocess
import zipfile

import pytest

from videmak_convert.word.latex import escape, escape_url, write_latex

# ------------------------------------------------------------------ a representative document


def png_bytes(color=(30, 90, 200), size=(40, 20)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def png_data_uri() -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes()).decode()


def gif_data_uri() -> str:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("P", (10, 10), 3).save(buffer, "GIF")
    return "data:image/gif;base64," + base64.b64encode(buffer.getvalue()).decode()


def text(value, **styles):
    return {"type": "text", "text": value, "styles": styles}


def block(kind, content=None, children=None, **props):
    return {"id": f"{kind}-{id(props)}", "type": kind, "props": props, "content": content if content is not None else [],
            "children": children or []}


def citation(bibtex, shown, raw=False, **extra):
    data = bibtex.encode() if raw else json.dumps({"bibtex": bibtex, **extra}).encode()
    return {"type": "aiCitation", "props": {"citationId": "c", "base64": base64.b64encode(data).decode(),
                                            "displayText": shown, "bibliography": "", "style": "apa", "url": ""}}


def cell(content, **props):
    return {"type": "tableCell", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left",
                                           "colspan": 1, "rowspan": 1, **props}, "content": content}


SMITH = """@article{Smith2020,
  title = {Malaria \\& adherence: a 50% problem},
  author = {Smith, John and Doe, Jane},
  year = {2020},
  journal = {Social Science & Medicine},
  doi = {10.1000/xyz_1}
}"""
SMITH_AGAIN = SMITH.replace("Smith2020", "smith-doe-copy").replace("  year", "  pages = {1--9},\n  year")
SMITH_OTHER = """@article{Smith2020,
  title = {A different paper by Smith},
  author = {Smith, Anna},
  year = {2020},
  journal = {Lancet}
}"""
NO_KEY = """@book{,
  title = {Statistics for Everyone},
  author = {M{\\"u}ller, Hans},
  year = "2018",
  publisher = {Springer}
}"""

SETTINGS = {"page": {"widthPt": "612", "heightPt": "792", "margins": {"top": "72", "bottom": "72", "left": "90", "right": "90"}}}


def document():
    return [
        block("heading", [text("Treatment adherence in Gulu: 100% of {cases} & more")], level=1, wordStyle="Title"),
        block("heading", [text("Introduction")], level=1),
        block("paragraph", [
            text("Specials: \\ { } $ & # ^ _ % ~ and α ≤ β → done. "),
            text("bold", bold=True), text(", "), text("italic", italic=True), text(", "),
            text("under", underline=True), text(", "), text("struck", strike=True), text(", "),
            text("red", textColor="#C01C28"), text(", "), text("marked", backgroundColor="#FFFF00"), text(", "),
            text("both", backgroundColor="#FFFF00", underline=True), text(", "),
            text("x2", superscript=True), text(" H"), text("2", verticalAlign="sub"), text("O, "),
            text("code_snippet()", code=True), text(", "),
            {"type": "link", "href": "https://example.org/a_b?x=1&y=2#frag%20", "content": [text("a link", bold=True)]},
            text(". Kept "), text("inserted", suggestionInsert="1|Ada|"), text(" and "),
            text("deleted ", suggestionDelete="2|Ada|"), text("text. Cited "),
            citation(SMITH, "(Smith & Doe, 2020)"), text(" and narratively "),
            citation(SMITH, "Smith and Doe (2020)"), text(", with a page "),
            citation(SMITH_OTHER, "(Smith, 2020, p. 12)"), text(", "),
            citation(NO_KEY, "(Müller, 2018)", raw=True), text(" and "),
            citation(SMITH_AGAIN, "(Smith & Doe, 2020)"),
            text(". A note"), {"type": "footnote", "props": {"text": "World Malaria Report 2023 & 50% cases.", "kind": "footnote"}},
            text(" and inline math "), {"type": "aiMath", "props": {"latex": "\\frac{a}{b}", "displayMode": "false"}},
            text(" with a mention of "), {"type": "aiMention", "props": {"displayName": "Dr. Okello", "email": "o@x.test"}},
            text(".\nSecond line after a break."),
        ], textAlignment="justify"),
        block("paragraph", [{"type": "aiMath", "props": {"latex": "E = mc^2", "displayMode": "true"}}]),
        block("paragraph", [text("Centered line")], textAlignment="center"),
        block("heading", [text("Methods"), {"type": "footnote", "props": {"text": "Approved by the board."}}], level=2),
        block("bulletListItem", [text("First bullet")], children=[
            block("bulletListItem", [text("Nested bullet")], children=[
                block("numberedListItem", [text("Nested number")]),
            ]),
        ]),
        block("bulletListItem", [text("[Bracketed] bullet")]),
        block("numberedListItem", [text("Step three")], start=3),
        block("numberedListItem", [text("Step four")]),
        block("checkListItem", [text("Done")], checked=True),
        block("checkListItem", [text("Open")], checked=False),
        block("quote", [text("A quoted passage.")]),
        block("codeBlock", [text("def f(x):\n    return x_1 % 2  # \\end{verbatim}")], language="python"),
        block("equation", [], latex="\\int_0^\\infty e^{-x}\\,dx = 1"),
        block("paragraph", [text("Table 1")]),
        block("paragraph", [text("Participant characteristics", italic=True)]),
        {"id": "t1", "type": "table", "props": {"textColor": "default"}, "content": {
            "type": "tableContent", "headerRows": 1, "columnWidths": [150, 120, 120, 100],
            "rows": [
                {"cells": [cell([text("Group")], backgroundColor="#D9E2F3"), cell([text("Measure & unit")], colspan=2),
                           cell([text("n")], textAlignment="center")]},
                {"cells": [cell([text("Adults")], rowspan=2), cell([text("Age")]), cell([text("34.2")]),
                           cell([text("120"), {"type": "footnote", "props": {"text": "Two missing.", "kind": "footnote"}}])]},
                {"cells": [cell([text("Weight")]), cell([text("70\nkg")]), cell([text("118")])]},
                {"cells": [cell([text("Children")], rowspan=2, backgroundColor="#FCE4D6"), cell([text("Age")]),
                           cell([text("9.1")]), cell([text("80")])]},
                {"cells": [cell([text("Weight")]), cell([text("30")]), cell([text("79")])]},
            ]}, "children": []},
        {"id": "t2", "type": "table", "props": {}, "content": {"type": "tableContent", "rows": [
            {"cells": [cell([text("a")]), cell([text("b\n[c]")])]},
            {"cells": [cell([text("d")]), cell([text("e")])]},
        ]}, "children": []},
        block("image", [], url=png_data_uri(), caption="", previewWidth=300, name="chart.png"),
        block("paragraph", [text("Figure 1. Weekly adherence by group.")]),
        block("image", [], url=gif_data_uri(), caption="An animated chart", previewWidth=900),
        block("image", [], url="/api/ai-editor/assets/" + "a" * 32 + ".png", caption="", name="stored.png"),
        block("image", [], url="https://unreachable.invalid/x.png", caption="", name="remote.png"),
        block("divider"),
        block("pageBreak"),
        block("tableOfContents"),
        block("heading", [text("References")], level=2, ceRole="bibliography"),
        block("paragraph", [text("Smith, J., & Doe, J. (2020). Malaria & adherence.")], ceRole="bibliography-entry"),
        block("heading", [text("Appendix")], level=1),
        block("paragraph", [text("After the references.")]),
    ]


def stored_images(url):
    return (png_bytes((0, 128, 0)), "image/png") if url.endswith("a" * 32 + ".png") else None


def export(blocks=None, settings=SETTINGS, title="Thesis", author="Ada Writer", loader=stored_images):
    data = write_latex(document() if blocks is None else blocks, settings, title, author, loader)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        return {name: package.read(name) for name in package.namelist()}


@pytest.fixture(scope="module")
def project():
    return export()


@pytest.fixture(scope="module")
def tex(project):
    return project["main.tex"].decode()


def body_of(tex: str) -> str:
    return tex.split("\\begin{document}", 1)[1]


# ------------------------------------------------------------------ text


def test_latex_specials_are_escaped():
    assert escape("\\ { } $ & # ^ _ % ~") == r"\textbackslash{} \{ \} \$ \& \# \^{} \_ \% \textasciitilde{}"
    assert escape("α ≤ β\u00a0x\u200b") == r"\ensuremath{\alpha} \ensuremath{\leq} \ensuremath{\beta}~x"
    assert escape("tab\tand\nline") == "tab and line"
    assert escape_url("https://x.org/~u/a b?q=1&r=2#f%20") == r"https://x.org/\%7Eu/a\%20b?q=1&r=2\#f\%20"


def test_paragraph_formatting(tex):
    body = body_of(tex)
    assert r"Specials: \textbackslash{} \{ \} \$ \& \# \^{} \_ \% \textasciitilde{} and \ensuremath{\alpha}" in body
    for expected in (r"\textbf{bold}", r"\textit{italic}", r"\uline{under}", r"\sout{struck}",
                     r"\textcolor[HTML]{C01C28}{red}", r"{\sethlcolor{vdmHighlight1}\hl{marked}}",
                     r"\uline{{\setlength{\fboxsep}{0pt}\colorbox{vdmHighlight1}{\strut both}}}",
                     r"\textsuperscript{x2}", r"H\textsubscript{2}O", r"\texttt{code\_snippet()}",
                     r"\href{https://example.org/a_b?x=1&y=2\#frag\%20}{\textbf{a link}}",
                     r"\newline Second line after a break.", r"with a mention of Dr. Okello."):
        assert expected in body, expected
    assert r"\definecolor{vdmHighlight1}{HTML}{FFFF00}" in tex
    # Suggestions are exported accepted.
    assert "Kept inserted and text." in body and "deleted" not in body
    assert "\\begin{center}\nCentered line\n\\end{center}" in body


def test_title_page_and_headings(tex):
    assert r"\title{Treatment adherence in Gulu: 100\% of \{cases\} \& more}" in tex
    assert r"\author{Ada Writer}" in tex and r"\date{}" in tex and r"\maketitle" in tex
    assert r"\section{Treatment" not in tex
    assert r"\section{Introduction}" in tex and r"\section{Appendix}" in tex
    assert r"\subsection{\texorpdfstring{Methods\protect\footnote{Approved by the board.}}{Methods}}" in tex
    assert r"\usepackage[paperwidth=612pt,paperheight=792pt,top=72pt,bottom=72pt,left=90pt,right=90pt]{geometry}" in tex
    levels = export([block("heading", [text(f"H{level}")], level=level) for level in range(1, 6)], settings=None, title="")["main.tex"].decode()
    for command, level in (("section", 1), ("subsection", 2), ("subsubsection", 3), ("paragraph", 4), ("subparagraph", 5)):
        assert f"\\{command}{{H{level}}}" in levels
    assert r"\maketitle" not in levels and "a4paper" not in levels and "paperwidth=595.3pt" in levels


def test_document_name_is_the_title_without_a_title_heading():
    named = export([block("heading", [text("My Thesis")], level=1), block("paragraph", [text("Body")])], title="My thesis")["main.tex"].decode()
    assert r"\title{My Thesis}" in named and r"\section{My Thesis}" not in named
    untitled = export([block("paragraph", [text("Body")])], title="Untitled document")["main.tex"].decode()
    assert r"\title" not in untitled and r"\maketitle" not in untitled


def test_citations_use_natbib_and_one_bibtex_entry_per_work(project, tex):
    body = body_of(tex)
    assert r"Cited \citep{Smith2020} and narratively \citet{Smith2020}" in body
    assert r"with a page \citep[p. 12]{smith2020a}" in body
    assert r"\citep{muller2018} and \citep{Smith2020}" in body  # same DOI under another key
    assert r"\bibliographystyle{apalike}" in tex and r"\usepackage{natbib}" in tex
    bib = project["references.bib"].decode()
    assert bib.count("@article{Smith2020,") == 1 and bib.count("@") == 3
    assert "@article{smith2020a,\n  title = {A different paper by Smith}" in bib
    assert "@book{muller2018,\n  title = {Statistics for Everyone},\n  author = {M{\\\"u}ller, Hans},\n  year = {2018}" in bib
    assert r"title = {Malaria \& adherence: a 50\% problem}" in bib and r"journal = {Social Science \& Medicine}" in bib
    assert "doi = {10.1000/xyz_1}" in bib


def test_citation_without_bibtex_keeps_its_text():
    tex = export([block("paragraph", [citation("", "(Okello, 2019)")])])
    assert "references.bib" not in tex and r"(Okello, 2019)" in tex["main.tex"].decode()
    assert r"\bibliography" not in tex["main.tex"].decode()


def test_footnotes_and_math(tex):
    body = body_of(tex)
    assert r"A note\footnote{World Malaria Report 2023 \& 50\% cases.}" in body
    assert r"inline math $\frac{a}{b}$" in body
    assert "\n\\[ E = mc^2 \\]\n" in body
    assert "\\begin{equation*}\n\\int_0^\\infty e^{-x}\\,dx = 1\n\\end{equation*}" in body
    display_in_heading = export([block("heading", [text("On "), {"type": "aiMath", "props": {"latex": "x^2", "displayMode": "true"}}], level=1)])
    assert r"\section{\texorpdfstring{On $\displaystyle x^2$}{On}}" in display_in_heading["main.tex"].decode()
    lines = export([block("equation", [], latex="a = b \\\\ c = d")])["main.tex"].decode()
    assert "\\begin{gather*}\na = b \\\\ c = d\n\\end{gather*}" in lines


def test_nested_lists(tex):
    body = body_of(tex)
    assert ("\\begin{itemize}\n\\item First bullet\n\n\\begin{itemize}\n\\item Nested bullet\n\n"
            "\\begin{enumerate}\n\\item Nested number\n\\end{enumerate}\n\\end{itemize}\n\\item {}[Bracketed] bullet\n"
            "\\end{itemize}") in body
    assert "\\begin{enumerate}\n\\setcounter{enumi}{2}\n\\item Step three\n\\item Step four\n\\end{enumerate}" in body
    assert "\\item[$\\boxtimes$] Done\n\\item[$\\square$] Open" in body
    assert "\\begin{quote}\nA quoted passage.\n\\end{quote}" in body
    assert "\\begin{verbatim}\ndef f(x):\n    return x_1 % 2  # \\end {verbatim}\n\\end{verbatim}" in body


def test_deep_lists_stay_within_latex_limits():
    node = block("bulletListItem", [text("level 7")])
    for level in range(6, 0, -1):
        node = block("bulletListItem", [text(f"level {level}")], children=[node])
    tex = export([node])["main.tex"].decode()
    assert tex.count("\\begin{itemize}") == 4 and "\\item level 7" in tex


def test_table_spans_shading_caption_and_notes(tex):
    body = body_of(tex)
    assert "\\begin{table}[htbp]\n\\centering\n\\caption{Participant characteristics}\n\\begin{tabular}{|p{" in body
    assert "Table 1\n" not in body and "\nParticipant characteristics\n" not in body
    assert (r"\cellcolor[HTML]{D9E2F3}\textbf{Group} & \multicolumn{2}{p{\dimexpr 0.412\linewidth-2\tabcolsep\relax}|}"
            r"{\textbf{Measure \& unit}}") in body
    assert r"\multicolumn{1}{>{\centering\arraybackslash}p{" in body
    assert "\\multirow{2}{=}{Adults} & Age & 34.2 & 120\\footnotemark{} \\\\\n\\cline{2-4}\n & Weight & 70 \\newline kg & 118 \\\\\n\\hline" in body
    # A shaded merged cell is written in its last row (negative \multirow).
    assert "\\cellcolor[HTML]{FCE4D6} & Age & 9.1 & 80 \\\\\n\\cline{2-4}\n\\cellcolor[HTML]{FCE4D6}\\multirow{-2}{=}{Children} & Weight" in body
    assert "\\addtocounter{footnote}{-1}\\stepcounter{footnote}\\footnotetext{Two missing.}" in body
    # Short table without known widths: natural-width columns; a cell with lines is a small tabular.
    assert "\\begin{center}\n\\begin{tabular}{|l|l|}\n\\hline\na & \\begin{tabular}[t]{@{}l@{}}b \\\\ {}[c]\\end{tabular} \\\\" in body


def test_images_go_to_figures(project, tex):
    body = body_of(tex)
    assert project["figures/fig-1.png"] == png_bytes()
    assert project["figures/fig-2.png"].startswith(b"\x89PNG")  # GIF converted
    assert project["figures/fig-3.png"] == png_bytes((0, 128, 0))  # loaded through the image loader
    assert "figures/fig-4.png" not in project
    assert ("\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.52\\linewidth,height=0.85\\textheight,"
            "keepaspectratio]{figures/fig-1.png}\n\\caption{Weekly adherence by group.}\n\\end{figure}") in body
    assert "Figure 1. Weekly" not in body
    assert "\\includegraphics[width=\\linewidth,height=0.85\\textheight,keepaspectratio]{figures/fig-2.png}\n\\caption{An animated chart}" in body
    assert "\\textit{[remote.png]}" in body


def test_managed_references_become_the_bibliography(tex):
    body = body_of(tex)
    assert "\\tableofcontents\n\n\\bibliography{references}\n\n\\section{Appendix}" in body
    assert "Smith, J., \\& Doe" not in body and body.count("\\bibliography{references}") == 1
    # Without a References section, the bibliography ends the document.
    end = export([block("paragraph", [citation(SMITH, "(Smith & Doe, 2020)")])])["main.tex"].decode()
    assert end.rstrip().endswith("\\bibliography{references}\n\n\\end{document}")
    # Without citations the section stays as written.
    plain = export([block("heading", [text("References")], level=2, ceRole="bibliography"),
                    block("paragraph", [text("A typed reference.")], ceRole="bibliography-entry")])
    assert "references.bib" not in plain
    assert "\\subsection{References}\n\nA typed reference." in plain["main.tex"].decode()


def test_export_api_returns_a_latex_zip(client):
    response = client.post("/word/export", json={
        "document_id": "doc-1", "title": "Thesis: draft/2", "format": "latex", "author": "Ada Writer",
        "settings": {"page": SETTINGS["page"], "source": {"fileName": "thesis.docx"}},
        # A LaTeX export never needs the Word template, even when one is sent.
        "source_base64": base64.b64encode(b"not a zip").decode(),
        "blocks": [block("paragraph", [text("Hello "), citation(SMITH, "(Smith & Doe, 2020)")])],
    })
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert 'filename="Thesis  draft 2-latex.zip"' in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as package:
        assert sorted(package.namelist()) == ["main.tex", "references.bib"]
        main = package.read("main.tex").decode()
    assert r"Hello \citep{Smith2020}" in main and "paperwidth=612pt" in main and r"\author{Ada Writer}" in main
    assert "% Exported from the Videmak editor." in main
    assert client.post("/word/export", json={"format": "tex", "blocks": []}).status_code == 422


@pytest.mark.skipif(not (shutil.which("pdflatex") and shutil.which("bibtex")), reason="pdflatex is not installed here")
def test_the_project_compiles_with_pdflatex(project, tmp_path):
    for name, data in project.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    run = lambda *command: subprocess.run(command, cwd=tmp_path, capture_output=True, timeout=120)
    first = run("pdflatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex")
    assert first.returncode == 0, first.stdout.decode(errors="replace")[-3000:]
    assert run("bibtex", "main").returncode == 0
    run("pdflatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex")
    last = run("pdflatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex")
    assert last.returncode == 0 and (tmp_path / "main.pdf").exists()
    log = (tmp_path / "main.log").read_text(errors="replace")
    assert "Citation" not in log or "undefined" not in log


def test_image_caption_number_is_left_to_latex():
    blocks = [block("image", [], url=png_data_uri(), caption="Figure 1. Mean sleep by group.", previewWidth=300, name="chart.png")]
    main = export(blocks)["main.tex"].decode()
    assert "\\caption{Mean sleep by group.}" in main
