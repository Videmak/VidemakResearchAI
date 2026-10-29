"""Limits and settings. Code reads them as `config.NAME` at call time, so tests can change them."""

from __future__ import annotations

import os

MB = 1024 * 1024


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# Size limits (the same as the editor's original server).
MAX_IMPORT_BYTES = 50 * MB  # a Word file to open
MAX_EXPORT_BYTES = 50 * MB  # an export request's JSON, its source .docx, a .docx sent for PDF conversion
MAX_ASSET_BYTES = 15 * MB  # one image, imported or fetched for an export
# A Word file is a zip: refuse ones that unpack to more than this (zip bombs).
MAX_UNPACKED_BYTES = 512 * MB
MAX_PACKAGE_ENTRIES = 20_000
# Images fetched over the network for one export.
MAX_FETCHED_IMAGES = 300

# LibreOffice timeouts (seconds).
IMPORT_CONVERT_TIMEOUT = _int("CONVERT_IMPORT_TIMEOUT", 120)  # .doc/.odt/.rtf -> .docx
PDF_EXPORT_TIMEOUT = _int("CONVERT_PDF_TIMEOUT", 120)  # generated .docx -> PDF
DOCX_TO_PDF_TIMEOUT = _int("CONVERT_DOCX_TO_PDF_TIMEOUT", 60)  # uploaded .docx/.doc -> PDF
PDF_TEXT_TIMEOUT = _int("CONVERT_PDF_TEXT_TIMEOUT", 120)  # PDF -> text (pypdfium2 subprocess)
METAFILE_TIMEOUT = 60  # one EMF/WMF image -> PNG
METAFILE_BUDGET_SECONDS = 90  # all EMF/WMF images of one import
MAX_METAFILES = 20

# Conversions run in a pool of worker processes (0 = threads in the server process).
WORKERS = _int("CONVERT_WORKERS", 2)
# Requests waiting for a worker beyond the busy ones; more get 503 + Retry-After.
MAX_QUEUE = _int("CONVERT_MAX_QUEUE", 16)
# A worker process is replaced after this many jobs (keeps memory in check).
MAX_TASKS_PER_WORKER = _int("CONVERT_MAX_TASKS_PER_WORKER", 50)
# The longest one request may wait for its job, queueing included.
JOB_TIMEOUT = _int("CONVERT_JOB_TIMEOUT", 600)

# Image URLs in imported blocks are <asset_url_prefix><name>; the default matches the editor.
DEFAULT_ASSET_URL_PREFIX = "/api/ai-editor/assets/"
# Fetch public https images named in an export (with private/loopback addresses refused).
ALLOW_PUBLIC_IMAGES = os.environ.get("CONVERT_ALLOW_PUBLIC_IMAGES", "1") != "0"
# When set (comma-separated URL prefixes), an export's asset_fetch_base must start with one of them.
ASSET_FETCH_BASES = [item.strip() for item in os.environ.get("CONVERT_ASSET_FETCH_BASES", "").split(",") if item.strip()]
