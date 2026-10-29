"""Bounded subprocesses and LibreOffice conversions.

`subprocess.run(..., timeout=...)` kills only the immediate process. LibreOffice starts
`soffice.bin` children, so a timed-out conversion could otherwise leave an orphan using a full
CPU. Every command here owns a new process group and the whole group is ended on timeout.
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class ConvertError(Exception):
    """A failure to report to the caller: HTTP status and a message for the user.

    Raised in worker processes, so it must pickle: the constructor takes exactly `args`.
    """

    def __init__(self, status: int, detail: str):
        super().__init__(status, detail)
        self.status = status
        self.detail = detail


class LibreOfficeTimeout(Exception):
    pass


class LibreOfficeFailed(Exception):
    pass


def _terminate_process_group(process: subprocess.Popen, grace_seconds: float = 5.0) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=max(0.1, grace_seconds))
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait()


def run_bounded_process(
    command: Sequence[str],
    *,
    timeout: float,
    cwd: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
    **popen_kwargs: Any,
) -> subprocess.CompletedProcess:
    """Run a command with captured output; on timeout end its whole process group and re-raise."""
    process = subprocess.Popen(
        list(command),
        cwd=cwd,
        env=dict(env) if env is not None else None,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        **popen_kwargs,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        _terminate_process_group(process)
        stdout, stderr = process.communicate()
        exc.output = stdout
        exc.stderr = stderr
        raise
    return subprocess.CompletedProcess(list(command), process.returncode, stdout, stderr)


def soffice_path() -> Optional[str]:
    return shutil.which("soffice") or shutil.which("libreoffice")


# LibreOffice --convert-to targets. "pdf" lets LibreOffice pick the export filter for the input.
FILTERS = {
    "docx": "docx:MS Word 2007 XML",
    "pdf": "pdf",
    "png": "png",
    "odt": "odt",
    "doc": "doc:MS Word 97",
}


def libreoffice_convert(data: bytes, source_ext: str, target: str, timeout: float) -> bytes:
    """Convert bytes with headless LibreOffice, at low CPU priority, with a throwaway profile."""
    soffice = soffice_path()
    if not soffice:
        raise LibreOfficeFailed("LibreOffice is not installed")
    source_ext = "".join(ch for ch in source_ext.lower() if ch.isalnum())[:8] or "bin"
    with tempfile.TemporaryDirectory(prefix="videmak-convert-") as tmp:
        source = os.path.join(tmp, f"input.{source_ext}")
        with open(source, "wb") as handle:
            handle.write(data)
        profile = os.path.join(tmp, "profile")
        out_dir = os.path.join(tmp, "out")
        os.makedirs(profile)
        os.makedirs(out_dir)
        command = [
            soffice, "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck", "--nofirststartwizard",
            f"-env:UserInstallation={Path(profile).as_uri()}",
            "--convert-to", FILTERS[target], "--outdir", out_dir, source,
        ]
        nice = shutil.which("nice")
        if nice:
            command = [nice, "-n", "10", *command]
        try:
            result = run_bounded_process(command, timeout=timeout, env={**os.environ, "HOME": tmp, "TMPDIR": tmp})
        except subprocess.TimeoutExpired as exc:
            raise LibreOfficeTimeout(f"LibreOffice {source_ext} -> {target} timed out after {timeout}s") from exc
        output = os.path.join(out_dir, f"input.{target}")
        if result.returncode != 0 or not os.path.exists(output):
            tail = (result.stderr or b"").decode(errors="replace")[-500:].strip()
            logger.warning("LibreOffice %s -> %s failed (exit %s): %s", source_ext, target, result.returncode, tail)
            raise LibreOfficeFailed(f"LibreOffice could not convert {source_ext} to {target}")
        with open(output, "rb") as handle:
            return handle.read()
