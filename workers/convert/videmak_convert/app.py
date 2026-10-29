"""videmak-convert HTTP service (port 4100, internal only). Stateless: no auth, no database, no
storage. The Videmak API server owns those and calls this service. Contract: README.md."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import multiprocessing
import os
import re
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile as StarletteUploadFile

from . import __version__, config, jobs
from .process import ConvertError, soffice_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every URL it fetches; asset_fetch_base URLs may carry a signed token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("videmak_convert")

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # encrypted .docx files are OLE containers
ASSET_URL_PREFIX = re.compile(r"^(/|https?://)[^\s\"'<>\\]*$")
FORM_SLACK = 1024 * 1024


# ------------------------------------------------------------------ request size guard


def body_limit(path: str) -> int:
    """The largest request body accepted on a path (each endpoint also checks its parts)."""
    if path == "/word/import":
        return config.MAX_IMPORT_BYTES + FORM_SLACK
    if path == "/word/export":
        # JSON payload + a source .docx (as a file part, or base64 inside the JSON).
        return config.MAX_EXPORT_BYTES + (config.MAX_EXPORT_BYTES * 4) // 3 + FORM_SLACK
    if path in ("/convert/docx-to-pdf", "/pdf/text"):
        return config.MAX_EXPORT_BYTES + FORM_SLACK
    return FORM_SLACK


class RequestTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=413, detail="The request is too large.")


class BodySizeLimit:
    """Refuses bodies over the path's limit: by Content-Length up front, or while streaming."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = body_limit(scope.get("path", ""))
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                await JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)(scope, receive, send)
                return
            if too_large:
                await JSONResponse({"detail": "The request is too large."}, status_code=413)(scope, receive, send)
                return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise RequestTooLarge()
            return message

        await self.app(scope, limited_receive, send)


# ------------------------------------------------------------------ worker pool

_pool: Optional[ProcessPoolExecutor] = None
_pending = 0


def _worker_init() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s[worker]: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        os.nice(5)  # conversions yield to the API server and the other apps on the host
    except OSError:
        pass


def _warm() -> bool:
    return True


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(
            max_workers=config.WORKERS,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=_worker_init,
            max_tasks_per_child=config.MAX_TASKS_PER_WORKER,
        )
    return _pool


def _reset_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
        _pool = None


async def run_job(fn, *args):
    """Run a conversion in a worker process; map its errors to HTTP errors."""
    global _pending
    if _pending >= max(1, config.WORKERS) + config.MAX_QUEUE:
        raise HTTPException(status_code=503, detail="The converter is busy. Please try again in a moment.",
                            headers={"Retry-After": "5"})
    _pending += 1
    try:
        if config.WORKERS <= 0:
            work = asyncio.to_thread(fn, *args)
        else:
            work = asyncio.get_running_loop().run_in_executor(_get_pool(), fn, *args)
        return await asyncio.wait_for(work, timeout=config.JOB_TIMEOUT)
    except ConvertError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="The conversion took too long. Please try again.")
    except BrokenProcessPool:
        logger.error("A converter worker process died; restarting the pool")
        _reset_pool()
        raise HTTPException(status_code=500, detail="The converter restarted. Please try again.")
    finally:
        _pending -= 1


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if config.WORKERS > 0:
        try:
            _get_pool().submit(_warm)  # start a worker (imports take a second) before the first request
        except Exception:
            logger.warning("Could not warm the worker pool", exc_info=True)
    yield
    _reset_pool()


app = FastAPI(title="videmak-convert", version=__version__, docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(BodySizeLimit)


@app.exception_handler(Exception)
async def unexpected_error(_request: Request, exc: Exception):
    logger.exception("Unexpected error", exc_info=exc)
    return JSONResponse({"detail": "The converter had an unexpected error."}, status_code=500)


# ------------------------------------------------------------------ routes


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "videmak-convert",
        "version": __version__,
        "libreoffice": soffice_path() is not None,
        "workers": config.WORKERS,
        "busy": _pending,
    }


@app.post("/word/import")
async def word_import(
    file: UploadFile = File(...),
    asset_url_prefix: str = Form(config.DEFAULT_ASSET_URL_PREFIX, max_length=500),
    include_source: bool = Form(False),
):
    """Open a Word file (.docx/.docm/.dotx; .doc/.dot/.odt/.rtf through LibreOffice)."""
    name = (file.filename or "document.docx").strip() or "document.docx"
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if extension not in jobs.OPENABLE:
        raise HTTPException(status_code=400, detail="Open a Word file (.docx, .doc), .odt or .rtf")
    if not ASSET_URL_PREFIX.match(asset_url_prefix):
        raise HTTPException(status_code=400, detail="asset_url_prefix must be a path or an http(s) URL")
    data = await file.read(config.MAX_IMPORT_BYTES + 1)
    if len(data) > config.MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Files up to 50 MB can be opened")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if data[:8] == OLE_MAGIC and extension in jobs.WORD_PACKAGES:
        raise HTTPException(status_code=400,
                            detail="This file is password-protected. Remove the password in Word, then open it here.")
    body = await run_job(jobs.import_job, data, name, extension, asset_url_prefix, include_source)
    return Response(content=body, media_type="application/json")


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    document_id: Optional[str] = Field(default=None, max_length=200)  # accepted (the browser sends it), unused
    title: str = Field(default="Document", max_length=500)
    blocks: List[Dict[str, Any]] = Field(default_factory=list)
    comments: Optional[List[Dict[str, Any]]] = None
    settings: Optional[Dict[str, Any]] = None
    format: str = Field(default="docx", pattern="^(docx|pdf|latex)$")
    author: Optional[str] = Field(default=None, max_length=200)
    asset_url_prefix: str = Field(default=config.DEFAULT_ASSET_URL_PREFIX, max_length=500)
    asset_fetch_base: Optional[str] = Field(default=None, max_length=2000)
    source_base64: Optional[str] = None


async def _part_bytes(part: Any, limit: int, too_large: str) -> bytes:
    if isinstance(part, StarletteUploadFile):
        data = await part.read(limit + 1)
    else:
        data = str(part).encode("utf-8")
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=too_large)
    return data


@app.post("/word/export")
async def word_export(request: Request):
    """Editor blocks -> .docx / PDF / LaTeX zip. JSON body, or multipart with `payload` (+ `source`)."""
    too_large = "Editor exports must be 50 MB or smaller"
    source: Optional[bytes] = None
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form(max_files=2, max_fields=10, max_part_size=config.MAX_EXPORT_BYTES + 1)
        if form.get("payload") is None:
            raise HTTPException(status_code=400, detail="Send the export as a `payload` part (JSON).")
        raw = await _part_bytes(form.get("payload"), config.MAX_EXPORT_BYTES, too_large)
        part = form.get("source")
        if part is not None:
            if not isinstance(part, StarletteUploadFile):
                raise HTTPException(status_code=400, detail="`source` must be a file part (.docx).")
            source = await _part_bytes(part, config.MAX_EXPORT_BYTES, "The source Word file must be 50 MB or smaller")
    else:
        raw = await request.body()
    try:
        payload = json.loads(raw or b"{}")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="The export request is not valid JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="The export request must be a JSON object.")
    try:
        export = ExportRequest.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False))
    if export.source_base64 and source is None:
        try:
            source = base64.b64decode(export.source_base64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="source_base64 is not valid base64.")
        if len(source) > config.MAX_EXPORT_BYTES:
            raise HTTPException(status_code=413, detail="The source Word file must be 50 MB or smaller")
    if len(raw) - len(export.source_base64 or "") > config.MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail=too_large)
    if not ASSET_URL_PREFIX.match(export.asset_url_prefix):
        raise HTTPException(status_code=400, detail="asset_url_prefix must be a path or an http(s) URL")
    if export.asset_fetch_base:
        base = export.asset_fetch_base
        if urlparse(base).scheme not in ("http", "https") or not urlparse(base).hostname:
            raise HTTPException(status_code=400, detail="asset_fetch_base must be an http(s) URL")
        if config.ASSET_FETCH_BASES and not any(base.startswith(allowed) for allowed in config.ASSET_FETCH_BASES):
            raise HTTPException(status_code=400, detail="asset_fetch_base is not allowed here")
    job = export.model_dump(exclude={"source_base64"})
    data, media_type, disposition, template = await run_job(jobs.export_job, job, source or None)
    return Response(content=data, media_type=media_type,
                    headers={"Content-Disposition": disposition, "X-Word-Template": template})


@app.post("/convert/docx-to-pdf")
async def docx_to_pdf(file: UploadFile = File(...)):
    """A .docx/.doc file -> PDF (LibreOffice)."""
    filename = file.filename or ""
    lower = filename.lower()
    if not (lower.endswith(".docx") or lower.endswith(".doc")):
        raise HTTPException(status_code=400, detail="Only .docx/.doc files are accepted")
    content = await file.read(config.MAX_EXPORT_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The editor document is empty")
    if len(content) > config.MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="Editor exports must be 50 MB or smaller")
    pdf = await run_job(jobs.docx_to_pdf_job, content, "docx" if lower.endswith(".docx") else "doc")
    name = jobs.filename_for(filename.rsplit(".", 1)[0], "pdf")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": jobs.content_disposition(name, "document.pdf")})


@app.post("/pdf/text")
async def pdf_text(file: UploadFile = File(...)):
    """A PDF -> its text, page by page (pypdfium2, no OCR)."""
    data = await file.read(config.MAX_EXPORT_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(data) > config.MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="PDFs up to 50 MB can be read")
    if b"%PDF-" not in data[:1024]:
        raise HTTPException(status_code=400, detail="Upload a PDF file.")
    body = await run_job(jobs.pdf_text_job, data)
    return Response(content=body, media_type="application/json")
