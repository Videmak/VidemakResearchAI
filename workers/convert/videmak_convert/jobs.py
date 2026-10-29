"""The conversions. Each runs in a worker process (see app.run_job) and returns bytes or plain
data, raising ConvertError (HTTP status + message for the user) when it can't finish."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from typing import Optional, Tuple
from urllib.parse import quote

from . import config
from .images import AssetCollector, make_image_loader
from .process import ConvertError, LibreOfficeFailed, LibreOfficeTimeout, libreoffice_convert, run_bounded_process
from .word.latex import write_latex
from .word.reader import read_docx
from .word.writer import write_docx

logger = logging.getLogger(__name__)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
WORD_PACKAGES = {"docx", "docm", "dotx"}  # read directly; other formats go through LibreOffice first
OPENABLE = WORD_PACKAGES | {"doc", "dot", "odt", "rtf"}
UNREADABLE = "This file could not be read as a Word document."


def filename_for(title: str, extension: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|\r\n]+', " ", title or "Document").strip()[:150] or "Document"
    return safe + "." + extension


def content_disposition(filename: str, fallback: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode() or fallback
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


def check_package(data: bytes, max_unpacked: Optional[int] = None) -> None:
    """A readable Word package (zip with word/document.xml) that doesn't unpack to something huge."""
    max_unpacked = config.MAX_UNPACKED_BYTES if max_unpacked is None else max_unpacked
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            infos = package.infolist()
            names = {info.filename for info in infos}
    except (zipfile.BadZipFile, ValueError, OSError):
        raise ConvertError(400, UNREADABLE)
    if len(infos) > config.MAX_PACKAGE_ENTRIES or sum(info.file_size for info in infos) > max_unpacked:
        raise ConvertError(413, "This file is too large once unpacked.")
    if "word/document.xml" not in names:
        raise ConvertError(400, UNREADABLE)


# ------------------------------------------------------------------ import


def import_job(data: bytes, filename: str, extension: str, asset_url_prefix: str, include_source: bool) -> bytes:
    """A Word (or .doc/.odt/.rtf) file -> the editor's JSON (see README: POST /word/import)."""
    started = time.monotonic()
    warnings: list = []
    converted = extension not in WORD_PACKAGES
    try:
        if converted:
            data = libreoffice_convert(data, extension, "docx", timeout=config.IMPORT_CONVERT_TIMEOUT)
        check_package(data)
        collector = AssetCollector(asset_url_prefix, warnings)
        result = read_docx(data, collector)
    except ConvertError:
        raise
    except LibreOfficeTimeout:
        raise ConvertError(504, "Opening this file took too long. Save it as .docx in Word, then try again.")
    except Exception as exc:  # malformed XML, unexpected structure, LibreOffice failures
        logger.warning("Word import of %s failed: %s", extension, exc, exc_info=not isinstance(exc, LibreOfficeFailed))
        raise ConvertError(400, UNREADABLE)

    title = filename.rsplit(".", 1)[0][:300] or "Untitled document"
    settings = {
        **result["settings"],
        "source": {"fileName": filename[:200], "importedAt": datetime.now(timezone.utc).isoformat()},
    }
    source = {
        "fileName": filename[:200],
        "format": extension,
        "converted": converted,
        "contentType": DOCX_MIME,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    if converted or include_source:
        source["data"] = base64.b64encode(data).decode("ascii")
    body = {
        "blocks": result["blocks"],
        "comments": result["comments"],
        "settings": settings,
        "warnings": list(dict.fromkeys([*result.get("warnings", []), *warnings])),
        "stats": result["stats"],
        "title": title,
        "assets": list(collector.assets.values()),
        "sourceDocx": source,
    }
    logger.info("Word import (%s): %s, %d assets in %.1fs", extension, result["stats"], len(collector.assets),
                time.monotonic() - started)
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


# ------------------------------------------------------------------ export


def export_job(request: dict, source: Optional[bytes]) -> Tuple[bytes, str, str, str]:
    """Editor blocks -> .docx / PDF / LaTeX zip. Returns (bytes, media type, Content-Disposition, template)."""
    started = time.monotonic()
    fmt = request.get("format") or "docx"
    title = request.get("title") or "Document"
    settings = dict(request.get("settings") or {})
    loader = make_image_loader(request.get("asset_url_prefix") or config.DEFAULT_ASSET_URL_PREFIX,
                               request.get("asset_fetch_base"))
    template = "default"
    if source is not None and fmt != "latex":
        try:
            check_package(source)
            template = "source"
        except ConvertError as exc:
            logger.warning("Export source .docx ignored (%s); using the default template", exc.detail)
            source = None
    else:
        source = None
    author = (request.get("author") or "").strip()
    try:
        if fmt == "latex":
            data = write_latex(request.get("blocks") or [], settings, title, author or None, loader)
        else:
            data = write_docx(request.get("blocks") or [], settings, request.get("comments"), title, source, loader,
                              author or "Videmak")
        if fmt == "pdf":
            data = libreoffice_convert(data, "docx", "pdf", timeout=config.PDF_EXPORT_TIMEOUT)
    except LibreOfficeTimeout:
        raise ConvertError(504, "The PDF took too long to make. Please try again.")
    except Exception as exc:
        logger.exception("Word export (%s) failed", fmt)
        raise ConvertError(500, "The document could not be exported. Please try again.") from exc
    if fmt == "latex":
        filename = filename_for(f"{filename_for(title, '')[:-1]}-latex", "zip")
        media_type, fallback = "application/zip", "document-latex.zip"
    else:
        filename = filename_for(title, fmt)
        media_type, fallback = (DOCX_MIME if fmt == "docx" else "application/pdf"), "document." + fmt
    logger.info("Word export (%s, %s template): %d bytes in %.1fs", fmt, template, len(data), time.monotonic() - started)
    return data, media_type, content_disposition(filename, fallback), template


# ------------------------------------------------------------------ PDF


def docx_to_pdf_job(data: bytes, extension: str) -> bytes:
    if extension == "docx":
        check_package(data)  # LibreOffice would otherwise print any non-Word file as plain text
    try:
        return libreoffice_convert(data, extension, "pdf", timeout=config.DOCX_TO_PDF_TIMEOUT)
    except LibreOfficeTimeout:
        raise ConvertError(504, "PDF conversion timed out")
    except LibreOfficeFailed:
        raise ConvertError(500, "PDF conversion failed")


def pdf_text_job(data: bytes) -> bytes:
    """PDF -> {"pages": [...], "page_count", "title", "metadata"} as JSON bytes, via a bounded subprocess."""
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="videmak-convert-") as tmp:
        path = os.path.join(tmp, "input.pdf")
        with open(path, "wb") as handle:
            handle.write(data)
        # -P: don't put the working directory on sys.path.
        command = [sys.executable, "-P", "-m", "videmak_convert.pdftext", path]
        nice = shutil.which("nice")
        if nice:
            command = [nice, "-n", "10", *command]
        package_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        env = {**os.environ, "HOME": tmp, "TMPDIR": tmp,
               "PYTHONPATH": os.pathsep.join(filter(None, [package_root, os.environ.get("PYTHONPATH", "")]))}
        try:
            result = run_bounded_process(command, timeout=config.PDF_TEXT_TIMEOUT, cwd=tmp, env=env)
        except subprocess.TimeoutExpired:
            raise ConvertError(504, "Reading this PDF took too long.")
    if result.returncode == 3:
        raise ConvertError(400, "This PDF is password-protected. Remove the password, then try again.")
    if result.returncode != 0:
        tail = (result.stderr or b"").decode(errors="replace")[-500:].strip()
        logger.warning("PDF text extraction failed (exit %s): %s", result.returncode, tail)
        raise ConvertError(400, "This file could not be read as a PDF.")
    logger.info("PDF text: %d bytes of JSON in %.1fs", len(result.stdout), time.monotonic() - started)
    return result.stdout
