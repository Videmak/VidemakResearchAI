"""Word compatibility: Word -> editor blocks -> Word keeps the formatting.

Ported from the editor's original server tests. Generated test documents only (word_fixtures.py).
"""
import base64
import hashlib
import io
import json
import os
import re
import tempfile
import zipfile

import pytest

import word_fixtures as fixtures
from conftest import walk
from videmak_convert.images import make_image_loader
from videmak_convert.jobs import DOCX_MIME
from videmak_convert.word.math import latex_to_omml, omml_to_latex
from videmak_convert.word.reader import read_docx
from videmak_convert.word.writer import write_docx


def facts_of(data: bytes, facts) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as handle:
        handle.write(data)
        path = handle.name
    try:
        return facts(path)
    finally:
        os.unlink(path)


@pytest.fixture(scope="module")
def compat():
    return fixtures.compat_docx()


@pytest.fixture(scope="module")
def hard():
    return fixtures.hard_docx()


# ------------------------------------------------------------------ reading


def test_reader_maps_word_formatting_to_editor_blocks(compat):
    result = read_docx(compat)
    blocks = list(walk(result["blocks"]))
    title = blocks[0]
    assert title["type"] == "heading" and title["props"]["wordStyle"] == "Title"
    abstract = next(b for b in blocks if b["type"] == "paragraph" and "Background" in json.dumps(b["content"]))
    assert abstract["props"]["lineSpacing"] == "2" and abstract["props"]["indentFirst"] == "36"
    styles = [item["styles"] for item in abstract["content"]]
    assert {"bold": True} in styles and {"italic": True} in styles
    assert any(s.get("textColor") == "#C01C28" and s.get("fontFamily") == "Arial" and s.get("fontSize") == "11pt" for s in styles)
    assert any(s.get("backgroundColor") == "#FFFF00" for s in styles)
    nested = next(b for b in blocks if b["type"] == "bulletListItem" and b["children"])
    assert nested["children"][0]["content"][0]["text"] == "Nested bullet"
    table = next(b for b in blocks if b["type"] == "table")
    first_column = [row["cells"][0]["props"]["rowspan"] for row in table["content"]["rows"] if len(row["cells"]) == 4]
    assert first_column[:3] == [1, 3, 2] and table["content"]["rows"][0]["cells"][0]["props"]["backgroundColor"] == "#D9E2F3"
    assert any(b["type"] == "image" for b in blocks) and any(b["type"] == "pageBreak" for b in blocks)
    settings = result["settings"]
    assert settings["page"]["widthPt"] == "595.3" and settings["page"]["margins"]["left"] == "72"
    assert settings["header"]["default"]["text"] == "Running head: TREATMENT ADHERENCE"
    assert settings["footer"]["default"]["text"] == "Page {PAGE}"
    assert settings["styles"]["normal"]["fontFamily"] == "Times New Roman"


def test_reader_keeps_footnotes_comments_tracked_changes_citations_and_math(hard):
    result = read_docx(hard)
    content = [item for block in walk(result["blocks"]) if isinstance(block.get("content"), list) for item in block["content"]]
    footnote = next(item for item in content if item.get("type") == "footnote")
    assert "World Malaria Report" in footnote["props"]["text"]
    citation = next(item for item in content if item.get("type") == "aiCitation")
    assert citation["props"]["displayText"] == "(Smith, 2020)"
    assert any("suggestionInsert" in item.get("styles", {}) for item in content)
    assert any("suggestionDelete" in item.get("styles", {}) for item in content)
    assert any(block["type"] == "equation" and block["props"]["latex"] for block in walk(result["blocks"])) or \
        any(item.get("type") == "aiMath" and item["props"]["displayMode"] == "true" for item in content)
    assert any(block["type"] == "tableOfContents" for block in result["blocks"])
    comment = result["comments"][0]
    assert comment["actorDisplayName"] == "Supervisor" and comment["selectedText"] == "This sentence carries a comment."
    assert result["settings"]["header"]["first"]["text"] == "FIRST PAGE HEADER"
    assert result["settings"]["differentFirstPage"] is True


# ------------------------------------------------------------------ round trips


@pytest.mark.parametrize("use_source", [True, False])
def test_round_trip_keeps_all_compatibility_checks(compat, use_source):
    result = read_docx(compat)
    output = write_docx(result["blocks"], result["settings"], result["comments"], "Round trip", source=compat if use_source else None)
    assert facts_of(output, fixtures.compat_facts) == facts_of(compat, fixtures.compat_facts)


def test_round_trip_keeps_notes_comments_changes_fields_and_sections(hard):
    result = read_docx(hard)
    output = write_docx(result["blocks"], result["settings"], result["comments"], "Round trip", source=hard)
    before, after = facts_of(hard, fixtures.hard_facts), facts_of(output, fixtures.hard_facts)
    for key in ("footnote references", "footnote text kept", "comments", "comment author", "tracked insertions",
                "tracked deletions", "tracked change author", "equations", "sections", "two-column sections",
                "different first-page header", "TOC field", "Zotero citation field"):
        assert after[key] == before[key], key


def test_new_document_exports_with_the_editor_look():
    blocks = [
        {"id": "h", "type": "heading", "props": {"level": 1}, "content": [{"type": "text", "text": "Introduction", "styles": {}}], "children": []},
        {"id": "p", "type": "paragraph", "props": {"textAlignment": "justify", "lineSpacing": "2"},
         "content": [{"type": "text", "text": "Body text ", "styles": {}},
                     {"type": "footnote", "props": {"text": "A note.", "kind": "footnote"}},
                     {"type": "aiMath", "props": {"latex": "\\frac{a}{b}", "displayMode": "false"}}], "children": []},
        {"id": "l", "type": "numberedListItem", "props": {}, "content": [{"type": "text", "text": "One", "styles": {}}],
         "children": [{"id": "l2", "type": "numberedListItem", "props": {}, "content": [{"type": "text", "text": "One a", "styles": {}}], "children": []}]},
    ]
    comments = [{"id": "c1", "text": "Check this", "actorDisplayName": "Ada", "blockId": "p", "createdAt": 1700000000000,
                 "replies": [{"id": "r1", "text": "Done", "actorDisplayName": "Bob", "createdAt": 1700000100000}]}]
    data = write_docx(blocks, {"header": {"default": {"text": "Short title", "align": "left"}},
                               "footer": {"default": {"text": "{PAGE}", "align": "center"}}}, comments, "New doc")
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        document = package.read("word/document.xml").decode()
        styles = package.read("word/styles.xml").decode()
        assert "Times New Roman" in styles
        assert 'w:jc w:val="both"' in document and 'w:line="480"' in document
        assert "footnoteReference" in document and "World" not in document
        assert "<m:f>" in document or "m:f>" in document
        assert document.count('w:ilvl w:val="1"') == 1
        assert "Check this" in package.read("word/comments.xml").decode()
        assert "Done" in package.read("word/comments.xml").decode()
        assert "paraIdParent" in package.read("word/commentsExtended.xml").decode()
        footers = [name for name in package.namelist() if name.startswith("word/footer")]
        assert footers and "PAGE" in package.read(footers[0]).decode()
    # And it reads back.
    again = read_docx(data)
    assert again["settings"]["header"]["default"]["text"] == "Short title"
    assert any(item.get("type") == "footnote" for block in walk(again["blocks"]) for item in (block.get("content") or []) if isinstance(block.get("content"), list))


def test_equation_block_exports_as_word_display_math_and_reads_back():
    blocks = [{"id": "e", "type": "equation", "props": {"latex": "\\frac{a}{b}"}, "children": []}]
    data = write_docx(blocks, {}, [], "Equation")
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        assert "oMathPara" in package.read("word/document.xml").decode()
    again = read_docx(data)
    assert any(block["type"] == "equation" and "frac" in block["props"]["latex"] for block in again["blocks"])


def test_equations_round_trip_through_word_math():
    for latex in [r"\frac{a+b}{c}", r"\sum_{i=1}^{n} x_i^2", r"\sqrt{x^2+y^2}", r"\int_0^\infty e^{-x}dx", r"\alpha \leq \beta"]:
        back = omml_to_latex(latex_to_omml(latex))
        assert back.replace(" ", "").replace("{", "").replace("}", "")[:3] == latex.replace(" ", "").replace("{", "").replace("}", "")[:3]


# ------------------------------------------------------------------ HTTP: import -> export round trip


def test_import_returns_blocks_assets_and_template_and_export_round_trips(client, compat, asset_server):
    response = client.post("/word/import", files={"file": ("thesis.docx", compat, DOCX_MIME)},
                           data={"document_id": "ignored-by-the-converter"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "thesis" and body["stats"]["tables"] == 2
    assert body["settings"]["source"] == {"fileName": "thesis.docx", "importedAt": body["settings"]["source"]["importedAt"]}
    assert "document" not in body  # the API server builds the document record

    image = next(b for b in walk(body["blocks"]) if b["type"] == "image")
    assert image["props"]["url"].startswith("/api/ai-editor/assets/")
    (asset,) = body["assets"]
    picture = fixtures.png()
    assert asset["url"] == image["props"]["url"] and asset["url"] == "/api/ai-editor/assets/" + asset["name"]
    assert re.fullmatch(r"[0-9a-f]{32}\.png", asset["name"]) and asset["contentType"] == "image/png"
    assert base64.b64decode(asset["data"]) == picture and asset["size"] == len(picture)
    assert asset["sha256"] == hashlib.sha256(picture).hexdigest() and asset["name"].startswith(asset["sha256"][:32])

    # A .docx upload is its own template: no copy comes back unless asked for.
    assert body["sourceDocx"] == {"fileName": "thesis.docx", "format": "docx", "converted": False, "contentType": DOCX_MIME,
                                  "size": len(compat), "sha256": hashlib.sha256(compat).hexdigest()}
    again = client.post("/word/import", files={"file": ("thesis.docx", compat, DOCX_MIME)}, data={"include_source": "true"}).json()
    assert base64.b64decode(again["sourceDocx"]["data"]) == compat

    # Export with the original file as template; the image comes from the API server's asset endpoint.
    asset_server.files[asset["name"]] = (picture, "image/png")
    payload = {"document_id": "doc-1", "title": "thesis", "blocks": body["blocks"], "comments": body["comments"],
               "settings": body["settings"], "format": "docx", "asset_fetch_base": asset_server.base}
    export = client.post("/word/export", data={"payload": json.dumps(payload)},
                         files={"source": ("thesis.docx", compat, DOCX_MIME)})
    assert export.status_code == 200, export.text
    assert export.headers["content-type"] == DOCX_MIME and export.headers["x-word-template"] == "source"
    assert 'filename="thesis.docx"' in export.headers["content-disposition"]
    assert asset_server.requests == ["/assets/" + asset["name"]]
    assert facts_of(export.content, fixtures.compat_facts) == facts_of(compat, fixtures.compat_facts)
    with zipfile.ZipFile(io.BytesIO(export.content)) as package:
        assert picture in [package.read(name) for name in package.namelist() if name.startswith("word/media/vdm_image")]

    # The same export as JSON with the template in base64.
    as_json = client.post("/word/export", json={**payload, "source_base64": base64.b64encode(compat).decode()})
    assert as_json.status_code == 200 and as_json.headers["x-word-template"] == "source"
    assert facts_of(as_json.content, fixtures.compat_facts) == facts_of(compat, fixtures.compat_facts)


def test_export_without_template_or_images_uses_the_editor_look(client, compat):
    body = client.post("/word/import", files={"file": ("thesis.docx", compat, DOCX_MIME)}).json()
    export = client.post("/word/export", json={"title": "Thesis", "blocks": body["blocks"], "settings": body["settings"]})
    assert export.status_code == 200 and export.headers["x-word-template"] == "default"
    with zipfile.ZipFile(io.BytesIO(export.content)) as package:
        document = package.read("word/document.xml").decode()
        styles = package.read("word/styles.xml").decode()
    # Without an asset endpoint the image can't be loaded: its name stands in for it.
    image = next(b for b in walk(body["blocks"]) if b["type"] == "image")
    assert "w:drawing" not in document and f"[{image['props']['name'] or 'Image'}]" in document
    assert "Times New Roman" in styles and "Treatment Adherence" in document
    # A broken template is ignored rather than failing the export.
    broken = client.post("/word/export", json={"title": "T", "blocks": body["blocks"],
                                                "source_base64": base64.b64encode(b"not a zip").decode()})
    assert broken.status_code == 200 and broken.headers["x-word-template"] == "default"


def test_import_rejects_other_files(client):
    assert client.post("/word/import", files={"file": ("notes.pdf", b"%PDF-1.4", "application/pdf")}).status_code == 400
    broken = client.post("/word/import", files={"file": ("broken.docx", b"not a zip", DOCX_MIME)})
    assert broken.status_code == 400 and broken.json()["detail"] == "This file could not be read as a Word document."
    assert client.post("/word/import", files={"file": ("empty.docx", b"", DOCX_MIME)}).status_code == 400
    locked = client.post("/word/import", files={"file": ("locked.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600, DOCX_MIME)})
    assert locked.status_code == 400 and "password-protected" in locked.json()["detail"]
    bad_prefix = client.post("/word/import", files={"file": ("a.docx", b"x", DOCX_MIME)}, data={"asset_url_prefix": "javascript:alert(1)"})
    assert bad_prefix.status_code == 400


def test_exported_images_are_only_fetched_from_safe_places(asset_server):
    load = make_image_loader("/api/ai-editor/assets/", None, allow_public=True)
    assert load("http://127.0.0.1:18000/secret.png") is None
    assert load("https://169.254.169.254/latest/meta-data") is None
    assert load("https://127.0.0.1/x.png") is None
    assert load("https://localhost/x.png") is None
    assert load("file:///etc/passwd") is None
    assert load("/api/ai-editor/assets/" + "a" * 32 + ".png") is None  # no asset endpoint given
    # Asset names can't climb out of the asset endpoint.
    asset_server.files["ok.png"] = (fixtures.png(), "image/png")
    load = make_image_loader("/api/ai-editor/assets/", asset_server.base, allow_public=False)
    assert load("/api/ai-editor/assets/..%2Fsecret.png") is None
    assert load("/api/ai-editor/assets/../secret.png") is None
    assert load("/api/ai-editor/assets/ok.png") == (fixtures.png(), "image/png")
    assert load("https://videmak.example/api/ai-editor/assets/ok.png") == (fixtures.png(), "image/png")
    assert asset_server.requests == ["/assets/ok.png", "/assets/ok.png"]


def test_paragraph_and_run_properties_are_in_word_schema_order():
    """Word refuses (or offers to repair) files whose w:pPr / w:rPr children are out of order."""
    from lxml import etree
    from videmak_convert.word.ooxml import PPR_ORDER, RPR_ORDER, W, local

    blocks = [
        {"id": "c", "type": "codeBlock", "props": {"language": "r"},
         "content": [{"type": "text", "text": "x <- 1\nprint(x)", "styles": {}}], "children": []},
        {"id": "p", "type": "paragraph",
         "props": {"backgroundColor": "#D9E2F3", "lineSpacing": "2", "indentLeft": "36", "textAlignment": "center"},
         "content": [{"type": "text", "text": "Shaded", "styles": {
             "backgroundColor": "#D9E2F3", "underline": True, "verticalAlign": "super", "bold": True}}], "children": []},
    ]
    with zipfile.ZipFile(io.BytesIO(write_docx(blocks))) as package:
        root = etree.fromstring(package.read("word/document.xml"))
    checked = 0
    for kind, order in (("pPr", PPR_ORDER), ("rPr", RPR_ORDER)):
        for props in root.iter(W + kind):
            ranks = [order.index(local(child)) for child in props if local(child) in order]
            assert ranks == sorted(ranks), (kind, [local(child) for child in props])
            checked += 1
    assert checked >= 4


def test_sum_and_integral_bodies_sit_inside_the_operator():
    """Word shows an empty placeholder box when the summand follows m:nary instead of filling m:e."""
    from videmak_convert.word.ooxml import M

    def body_text(latex):
        nary = latex_to_omml(latex).find(".//" + M + "nary")
        return "".join(nary.find(M + "e").itertext())

    assert body_text(r"\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i") == "xi"
    assert body_text(r"\int_0^\infty e^{-x}\,dx = 1").replace(" ", "").replace(" ", "") == "e\u2212xdx"
    outer = latex_to_omml(r"\sum_{i} \sum_{j} a_{ij} + b").find(".//" + M + "nary")
    assert outer.find(M + "e").find(M + "nary") is not None  # the inner sum is the outer one's body
    assert "b" not in "".join(outer.itertext())


def test_exported_nested_lists_and_checklists_read_back():
    """Word levels come back as nesting (not flattened by "List Paragraph"), checklists as checklists."""
    def item(kind, value, children=(), **props):
        return {"id": value, "type": kind, "props": props, "content": [{"type": "text", "text": value, "styles": {}}], "children": list(children)}

    blocks = [
        item("bulletListItem", "First bullet", [item("bulletListItem", "Nested bullet", [item("numberedListItem", "Nested number")])]),
        item("bulletListItem", "Second bullet"),
        item("checkListItem", "Ethics approved", checked=True),
        item("checkListItem", "Data collected", checked=False),
    ]
    result = read_docx(write_docx(blocks))["blocks"]
    first = next(b for b in result if b["content"] and b["content"][0].get("text") == "First bullet")
    assert first["children"][0]["content"][0]["text"] == "Nested bullet"
    assert first["children"][0]["children"][0]["type"] == "numberedListItem"
    checks = [b for b in result if b["type"] == "checkListItem"]
    assert [(b["content"][0]["text"], b["props"]["checked"]) for b in checks] == [("Ethics approved", True), ("Data collected", False)]
