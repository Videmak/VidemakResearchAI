"""Word test documents for the Word compatibility tests (generated, no real files)."""
# flake8: noqa
# shaded header row, image, page break, header/footer with page number, landscape-free A4 page setup.
import io, struct, zlib
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm, Inches

def png(w=320, h=120):
    row = b'\x00' + b''.join(bytes([30 + x * 200 // w, 120, 200 - x * 150 // w]) for x in range(w))
    raw = row * h
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

def page_number(paragraph):
    run = paragraph.add_run()
    for tag, text in (('begin', None), (None, 'PAGE'), ('end', None)):
        if tag:
            el = OxmlElement('w:fldChar'); el.set(qn('w:fldCharType'), tag)
        else:
            el = OxmlElement('w:instrText'); el.set(qn('xml:space'), 'preserve'); el.text = text
        run._r.append(el)

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr(); shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), fill); tcPr.append(shd)



def compat_docx() -> bytes:
    """Fonts, colours, highlight, alignment, spacing, indents, lists, merged/shaded table cells,
    an image, a page break, header and footer with a page number."""
    d = Document()
    s = d.sections[0]
    s.page_width, s.page_height = Cm(21), Cm(29.7)
    s.left_margin = s.right_margin = Cm(2.54); s.top_margin = s.bottom_margin = Cm(2.54)
    s.header.paragraphs[0].text = 'Running head: TREATMENT ADHERENCE'
    fp = s.footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER; fp.add_run('Page '); page_number(fp)
    normal = d.styles['Normal']; normal.font.name = 'Times New Roman'; normal.font.size = Pt(12)

    t = d.add_heading('Treatment Adherence Among Adult Outpatients: A Compatibility Test', level=0)
    p = d.add_paragraph('Jane Researcher¹, Sam Author²'); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    d.add_heading('Abstract', level=1)
    p = d.add_paragraph(); p.paragraph_format.line_spacing = 2.0; p.paragraph_format.first_line_indent = Cm(1.27)
    p.add_run('Background: ').bold = True
    p.add_run('Adherence to long-term therapy remains low in many settings. ')
    r = p.add_run('This sentence is italic. '); r.italic = True
    r = p.add_run('This one is red Arial 11. '); r.font.color.rgb = RGBColor(0xC0, 0x1C, 0x28); r.font.name = 'Arial'; r.font.size = Pt(11)
    r = p.add_run('Highlighted text.'); r.font.highlight_color = 7
    p = d.add_paragraph('Right-aligned paragraph with 1.5 spacing.'); p.alignment = WD_ALIGN_PARAGRAPH.RIGHT; p.paragraph_format.line_spacing = 1.5
    p = d.add_paragraph('Justified paragraph. ' * 12); p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    d.add_heading('Methods', level=1)
    d.add_heading('Study design', level=2)
    for item in ('First bullet', 'Second bullet'):
        d.add_paragraph(item, style='List Bullet')
    d.add_paragraph('Nested bullet', style='List Bullet 2')
    for item in ('Step one', 'Step two', 'Step three'):
        d.add_paragraph(item, style='List Number')
    cap = d.add_paragraph('Table 1. Socio-demographic characteristics (n = 426)'); cap.runs[0].bold = True
    tb = d.add_table(rows=6, cols=4); tb.style = 'Table Grid'
    for i, h in enumerate(('Variable', 'Attribute', 'Frequency (n)', 'Percentage (%)')):
        c = tb.cell(0, i); c.text = h; c.paragraphs[0].runs[0].bold = True; shade(c, 'D9E2F3')
    rows = [('Age (years)', '18–30', '154', '36.1'), ('', '31–50', '201', '47.2'), ('', '51+', '71', '16.7'), ('Sex', 'Female', '219', '51.4'), ('', 'Male', '207', '48.6')]
    for r_i, row in enumerate(rows, start=1):
        for c_i, v in enumerate(row):
            tb.cell(r_i, c_i).text = v
    tb.cell(1, 0).merge(tb.cell(3, 0)).text = 'Age (years)'
    tb.cell(4, 0).merge(tb.cell(5, 0)).text = 'Sex'
    tb2 = d.add_table(rows=2, cols=3); tb2.style = 'Table Grid'
    tb2.cell(0, 0).merge(tb2.cell(0, 2)).text = 'Merged across three columns'
    for i, v in enumerate(('a', 'b', 'c')): tb2.cell(1, i).text = v
    d.add_paragraph().add_run().add_picture(io.BytesIO(png()), width=Inches(3))
    d.add_paragraph('Figure 1. Test image.').runs[0].italic = True
    d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    d.add_heading('Results', level=1)
    d.add_paragraph('This paragraph should start on page 2 after a page break (Smith et al., 2021).')
    d.add_heading('References', level=1)
    p = d.add_paragraph('Smith, J., Doe, A., & Lee, K. (2021). Adherence to therapy. Journal of Health, 12(3), 45–67. https://doi.org/10.1000/xyz')
    p.paragraph_format.left_indent = Cm(1.27); p.paragraph_format.first_line_indent = Cm(-1.27)
    out = io.BytesIO(); d.save(out); return out.getvalue()

import io, zipfile
from docx import Document as _Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt, Cm


def hard_docx() -> bytes:
    """TOC field, footnote, Zotero citation field, tracked changes, comment, content control,
    bookmark, internal link, equation, landscape two-column section, first-page header."""
    Document = _Document
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    d = Document()
    st = d.styles['Normal']; st.font.name = 'Times New Roman'; st.font.size = Pt(12)
    sec = d.sections[0]; sec.different_first_page_header_footer = True
    sec.first_page_header.paragraphs[0].text = 'FIRST PAGE HEADER'; sec.header.paragraphs[0].text = 'Running head: HARD TEST'
    d.add_heading('Hard Compatibility Test', 0)
    # Table of contents as a real Word field with a cached result.
    p = d.add_paragraph()
    p._p.append(parse_xml(f'<w:r {W}><w:fldChar w:fldCharType="begin"/></w:r>'))
    p._p.append(parse_xml(f'<w:r {W}><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'))
    p._p.append(parse_xml(f'<w:r {W}><w:fldChar w:fldCharType="separate"/></w:r>'))
    p._p.append(parse_xml(f'<w:r {W}><w:t>Introduction 1</w:t></w:r>'))
    p._p.append(parse_xml(f'<w:r {W}><w:fldChar w:fldCharType="end"/></w:r>'))
    d.add_heading('Introduction', 1)
    p = d.add_paragraph('Malaria remains a leading cause of morbidity')
    p._p.append(parse_xml(f'<w:r {W}><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'))
    r = p.add_run(' in pregnancy, as shown by ')
    # Zotero-style citation field.
    for xml in ['<w:r {W}><w:fldChar w:fldCharType="begin"/></w:r>',
                '<w:r {W}><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {{"citationID":"a1","citationItems":[{{"id":1,"itemData":{{"title":"Malaria in pregnancy","author":[{{"family":"Smith","given":"J"}}],"issued":{{"date-parts":[[2020]]}}}}}}]}} </w:instrText></w:r>',
                '<w:r {W}><w:fldChar w:fldCharType="separate"/></w:r>', '<w:r {W}><w:t>(Smith, 2020)</w:t></w:r>', '<w:r {W}><w:fldChar w:fldCharType="end"/></w:r>']:
        p._p.append(parse_xml(xml.format(W=W)))
    p.add_run('.')
    # Tracked changes: one insertion and one deletion.
    p = d.add_paragraph('Tracked: ')
    p._p.append(parse_xml(f'<w:ins {W} w:id="101" w:author="Reviewer A" w:date="2026-10-01T10:00:00Z"><w:r><w:t>inserted words</w:t></w:r></w:ins>'))
    p._p.append(parse_xml(f'<w:del {W} w:id="102" w:author="Reviewer A" w:date="2026-10-01T10:01:00Z"><w:r><w:delText> deleted words</w:delText></w:r></w:del>'))
    # A comment with a reply-style second comment.
    p = d.add_paragraph()
    run = p.add_run('This sentence carries a comment.')
    d.add_comment(run, text='Please cite a source here.', author='Supervisor', initials='SV')
    # Content control with a tag, bookmark and internal hyperlink.
    p = d.add_paragraph()
    p._p.append(parse_xml(f'<w:sdt {W}><w:sdtPr><w:tag w:val="ce-cite:abc123"/><w:alias w:val="Citation"/></w:sdtPr><w:sdtContent><w:r><w:t>(Doe et al., 2021)</w:t></w:r></w:sdtContent></w:sdt>'))
    p._p.append(parse_xml(f'<w:bookmarkStart {W} w:id="0" w:name="_Ref_methods"/>'))
    p.add_run(' Bookmarked text.')
    p._p.append(parse_xml(f'<w:bookmarkEnd {W} w:id="0"/>'))
    p._p.append(parse_xml(f'<w:hyperlink {W} w:anchor="_Ref_methods"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t> Jump to bookmark</w:t></w:r></w:hyperlink>'))
    # Display equation (Office Math).
    p = d.add_paragraph()
    p._p.append(parse_xml('<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara>'))
    # Landscape two-column section.
    new = d.add_section(WD_SECTION.NEW_PAGE); new.orientation = WD_ORIENT.LANDSCAPE
    new.page_width, new.page_height = sec.page_height, sec.page_width
    new._sectPr.append(parse_xml(f'<w:cols {W} w:num="2" w:space="720"/>'))
    d.add_heading('Appendix (landscape, two columns)', 1)
    for i in range(6): d.add_paragraph(f'Column text {i}. ' * 12)
    # Back to portrait.
    last = d.add_section(WD_SECTION.NEW_PAGE); last.orientation = WD_ORIENT.PORTRAIT
    last.page_width, last.page_height = sec.page_width, sec.page_height
    d.add_paragraph('Final portrait section.')
    buf = io.BytesIO(); d.save(buf)
    # Add the footnotes part, which python-docx cannot create.
    zin = zipfile.ZipFile(io.BytesIO(buf.getvalue())); target = io.BytesIO(); out = zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED)
    foot = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes {W}>
    <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
    <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
    <w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> World Health Organization, World Malaria Report 2025.</w:t></w:r></w:p></w:footnote></w:footnotes>'''
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == '[Content_Types].xml':
            data = data.replace(b'</Types>', b'<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>')
        if item.filename == 'word/_rels/document.xml.rels':
            data = data.replace(b'</Relationships>', b'<Relationship Id="rIdFoot1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>')
        out.writestr(item, data)
    out.writestr('word/footnotes.xml', foot); out.close()
    return target.getvalue()

from docx import Document
from docx.oxml.ns import qn
def compat_facts(path):
    d = Document(path); body = d.element.body; s = d.sections[0]
    runs = [r for p in d.paragraphs for r in p.runs]
    tcs = body.iter(qn('w:tc'))
    merged = sum(1 for tc in body.iter(qn('w:tc')) if tc.find(qn('w:tcPr')) is not None and (tc.find(qn('w:tcPr')).find(qn('w:gridSpan')) is not None or tc.find(qn('w:tcPr')).find(qn('w:vMerge')) is not None))
    shaded = sum(1 for tc in body.iter(qn('w:tc')) if tc.find(qn('w:tcPr')) is not None and tc.find(qn('w:tcPr')).find(qn('w:shd')) is not None)
    return {
        'page size (cm)': f"{round(s.page_width.cm,1)} x {round(s.page_height.cm,1)}" if s.page_width else None,
        'margins (cm)': round(s.left_margin.cm, 2) if s.left_margin else None,
        'header text': (s.header.paragraphs[0].text if s.header.paragraphs else '') or '(none)',
        'footer page number': any('PAGE' in (el.text or '') for el in s.footer._element.iter(qn('w:instrText'))),
        'headings': sum(1 for p in d.paragraphs if p.style.name.lower().startswith(('heading', 'title'))),
        'tables': len(d.tables), 'merged cells': merged, 'shaded cells': shaded,
        'images': len(body.findall('.//' + qn('w:drawing'))),
        'page breaks': sum(1 for br in body.iter(qn('w:br')) if br.get(qn('w:type')) == 'page'),
        'coloured runs': sum(1 for r in runs if r.font.color is not None and r.font.color.rgb not in (None,)),
        'highlighted runs': sum(1 for r in runs if r.font.highlight_color),
        'non-Times fonts': sorted({r.font.name for r in runs if r.font.name and r.font.name != 'Times New Roman'}),
        'right/centre/justify paragraphs': sum(1 for p in d.paragraphs if p.alignment is not None and int(p.alignment) in (1, 2, 3)),
        'double/1.5 spacing paragraphs': sum(1 for p in d.paragraphs if p.paragraph_format.line_spacing in (1.5, 2.0)),
        'first-line/hanging indents': sum(1 for p in d.paragraphs if p.paragraph_format.first_line_indent),
        'bullet/numbered paragraphs': sum(1 for p in d.paragraphs if p._p.pPr is not None and p._p.pPr.numPr is not None or p.style.name.startswith('List')),
        'normal font': f"{d.styles['Normal'].font.name} {d.styles['Normal'].font.size.pt if d.styles['Normal'].font.size else ''}",
    }

import re, zipfile
from lxml import etree
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math'}
def hard_facts(path):
    z = zipfile.ZipFile(path); names = set(z.namelist())
    doc = etree.fromstring(z.read('word/document.xml'))
    x = lambda q, root=doc: root.xpath(q, namespaces=NS)
    instr = ' '.join(t.text or '' for t in x('//w:instrText'))
    simple = ' '.join(f.get(f'{{{NS["w"]}}}instr') or '' for f in x('//w:fldSimple'))
    allinstr = instr + ' ' + simple
    foot = etree.fromstring(z.read('word/footnotes.xml')) if 'word/footnotes.xml' in names else None
    com = etree.fromstring(z.read('word/comments.xml')) if 'word/comments.xml' in names else None
    text = re.sub(r'\s+', ' ', ''.join(x('//w:body//w:t/text()'))).strip()
    sect = x('//w:sectPr')
    return {
        'footnote references': len(x('//w:footnoteReference')),
        'footnote text kept': bool(foot is not None and 'World Malaria Report' in ''.join(foot.xpath('//w:t/text()', namespaces=NS))),
        'comments': len(com.xpath('//w:comment', namespaces=NS)) if com is not None else 0,
        'comment author': sorted(set(com.xpath('//w:comment/@w:author', namespaces=NS))) if com is not None else [],
        'tracked insertions': len(x('//w:ins')), 'tracked deletions': len(x('//w:del')),
        'tracked change author': sorted(set(x('//w:ins/@w:author') + x('//w:del/@w:author'))),
        'equations': len(x('//m:oMath')),
        'sections': len(sect), 'landscape sections': len(x('//w:sectPr/w:pgSz[@w:orient="landscape"]')),
        'two-column sections': len(x('//w:sectPr/w:cols[@w:num="2"]')),
        'different first-page header': len(x('//w:sectPr/w:titlePg')) > 0,
        'TOC field': 'TOC' in allinstr, 'Zotero citation field': 'ZOTERO_ITEM' in allinstr,
        'content controls (tags)': sorted(x('//w:sdt/w:sdtPr/w:tag/@w:val')),
        'bookmark': '_Ref_methods' in x('//w:bookmarkStart/@w:name'),
        'internal hyperlink': len(x('//w:hyperlink[@w:anchor]')),
        'body text identical': text,
    }
