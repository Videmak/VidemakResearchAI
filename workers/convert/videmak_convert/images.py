"""Images in and out of Word files.

Import: the reader hands every image to an `AssetCollector`, which keeps each distinct image
once (named by its SHA-256) and puts `<asset_url_prefix><name>` in the blocks. The images go back
to the caller in the response; the converter stores nothing.

Export: images named in the blocks are loaded from data: URIs (by the writers themselves), from
the caller's asset endpoint (`asset_fetch_base` + name, for URLs under `asset_url_prefix`), or from
public https URLs (private, loopback and link-local addresses refused, no redirects).
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import logging
import re
import socket
import time
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import quote, urlparse

from . import config
from .process import LibreOfficeFailed, LibreOfficeTimeout, libreoffice_convert

logger = logging.getLogger(__name__)

ImageLoader = Callable[[str], Optional[Tuple[bytes, str]]]

ASSET_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp",
               "svg": "image/svg+xml", "webp": "image/webp", "tif": "image/tiff", "tiff": "image/tiff"}
EXTENSION_FOR = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp",
                 "image/svg+xml": "svg", "image/webp": "webp", "image/tiff": "tiff"}
# The last path segment of an asset URL: no slashes, no "..", no percent-escapes.
ASSET_NAME = r"([A-Za-z0-9][A-Za-z0-9_-]{0,127}\.[A-Za-z0-9]{1,8})"


class AssetCollector:
    """The Word reader's image sink: (data, content_type, part name) -> URL for the block."""

    def __init__(self, url_prefix: str, warnings: List[str]):
        self.url_prefix = url_prefix
        self.warnings = warnings
        self.assets: Dict[str, dict] = {}
        self.metafiles = 0
        self.metafile_seconds = 0.0

    def _warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def _metafile_to_png(self, data: bytes, extension: str) -> Optional[bytes]:
        """Browsers can't show Windows metafiles (EMF/WMF); draw them as PNG."""
        if self.metafiles >= config.MAX_METAFILES or self.metafile_seconds >= config.METAFILE_BUDGET_SECONDS:
            self._warn("Some old-format (EMF/WMF) images could not be shown.")
            return None
        self.metafiles += 1
        started = time.monotonic()
        try:
            return libreoffice_convert(data, extension, "png", timeout=config.METAFILE_TIMEOUT)
        except (LibreOfficeFailed, LibreOfficeTimeout, OSError):
            self._warn("Some old-format (EMF/WMF) images could not be shown.")
            return None
        finally:
            self.metafile_seconds += time.monotonic() - started

    def __call__(self, data: bytes, content_type: str, name: str) -> str:
        extension = name.rsplit(".", 1)[-1].lower()
        if extension in ("emf", "wmf"):
            converted = self._metafile_to_png(data, extension)
            if converted is not None:
                data, content_type = converted, "image/png"
        if len(data) > config.MAX_ASSET_BYTES:
            self._warn("An image larger than 15 MB was left out.")
            return ""
        if content_type not in EXTENSION_FOR:
            content_type = "image/png"
        digest = hashlib.sha256(data).hexdigest()
        asset_name = f"{digest[:32]}.{EXTENSION_FOR[content_type]}"
        if asset_name not in self.assets:
            self.assets[asset_name] = {
                "name": asset_name,
                "url": self.url_prefix + asset_name,
                "contentType": content_type,
                "size": len(data),
                "sha256": digest,
                "data": base64.b64encode(data).decode("ascii"),
            }
        return self.assets[asset_name]["url"]


# ------------------------------------------------------------------ export


def is_public_host(host: str) -> bool:
    """Every address the host resolves to is a public (global) one."""
    try:
        infos = socket.getaddrinfo(host, None)
    except (OSError, UnicodeError):
        return False
    if not infos:
        return False
    for info in infos:
        try:
            address = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        except ValueError:
            return False
        if not address.is_global or address.is_multicast:
            return False
    return True


def _fetch(url: str, *, require_image_type: bool) -> Optional[Tuple[bytes, str]]:
    import httpx

    try:
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            with client.stream("GET", url, headers={"Accept": "image/*"}) as response:
                if response.status_code != 200:
                    return None
                content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if require_image_type and not content_type.startswith("image/"):
                    return None
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > config.MAX_ASSET_BYTES:
                    return None
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > config.MAX_ASSET_BYTES:
                        return None
                    chunks.append(chunk)
                return b"".join(chunks), content_type
    except (httpx.HTTPError, OSError, ValueError):
        return None


def make_image_loader(url_prefix: str, fetch_base: Optional[str], allow_public: Optional[bool] = None) -> ImageLoader:
    """The writers' image loader for one export (at most MAX_FETCHED_IMAGES network fetches)."""
    allow_public = config.ALLOW_PUBLIC_IMAGES if allow_public is None else allow_public
    prefix_path = urlparse(url_prefix).path or url_prefix
    asset_pattern = re.compile(re.escape(prefix_path) + ASSET_NAME + "$")
    fetches = {"count": 0}

    def load(url: str) -> Optional[Tuple[bytes, str]]:
        if not url or url.startswith("data:") or fetches["count"] >= config.MAX_FETCHED_IMAGES:
            return None
        try:
            parsed = urlparse(url)
        except ValueError:
            return None
        match = asset_pattern.search(parsed.path or "")
        if match and fetch_base:
            name = match.group(1)
            fetches["count"] += 1
            loaded = _fetch(fetch_base + quote(name), require_image_type=False)
            if loaded:
                data, content_type = loaded
                if not content_type.startswith("image/"):
                    content_type = ASSET_TYPES.get(name.rsplit(".", 1)[-1].lower(), "image/png")
                return data, content_type
            if not parsed.scheme:
                return None
        if not allow_public or parsed.scheme != "https" or not parsed.hostname or not is_public_host(parsed.hostname):
            return None
        fetches["count"] += 1
        return _fetch(url, require_image_type=True)

    return load
