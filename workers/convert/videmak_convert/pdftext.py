"""PDF -> text per page with pypdfium2 (no OCR).

Run as a subprocess (`python -m videmak_convert.pdftext <file.pdf>`) so that a PDF which hangs
or crashes PDFium can be timed out and killed like a LibreOffice conversion. Prints JSON on
stdout; exit code 3 = password-protected, 2 = not a readable PDF.
"""

from __future__ import annotations

import json
import sys
from typing import Optional

EXIT_UNREADABLE = 2
EXIT_PASSWORD = 3
# pypdfium2's error code for a document that needs a password (FPDF_ERR_PASSWORD).
PDFIUM_ERR_PASSWORD = 4


def _clean(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").replace("￾", "").replace("￿", "")


def extract(path: str) -> dict:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(path)
    try:
        metadata = {key: value for key, value in (document.get_metadata_dict(skip_empty=True) or {}).items()
                    if isinstance(value, str)}
        pages = []
        for index in range(len(document)):
            page = document[index]
            try:
                textpage = page.get_textpage()
                try:
                    text = textpage.get_text_bounded()
                finally:
                    textpage.close()
            finally:
                page.close()
            pages.append({"page": index + 1, "text": _clean(text or "")})
    finally:
        document.close()
    title: Optional[str] = (metadata.get("Title") or "").strip() or None
    return {"pages": pages, "page_count": len(pages), "title": title, "metadata": metadata}


def main(argv: list) -> int:
    import pypdfium2 as pdfium

    try:
        result = extract(argv[1])
    except pdfium.PdfiumError as exc:
        return EXIT_PASSWORD if getattr(exc, "err_code", None) == PDFIUM_ERR_PASSWORD else EXIT_UNREADABLE
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
