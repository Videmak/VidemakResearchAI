"""Shared fixtures: the service under TestClient (with its real worker pool) and a small HTTP
server standing in for the Videmak API's internal asset endpoint."""

import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from videmak_convert.app import app

needs_libreoffice = pytest.mark.skipif(not shutil.which("soffice"), reason="LibreOffice is not installed here")


def walk(blocks):
    for block in blocks:
        yield block
        yield from walk(block.get("children") or [])


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


class AssetServer:
    """Serves {name: (bytes, content type)} at http://127.0.0.1:<port>/assets/<name>."""

    def __init__(self):
        self.files = {}
        self.requests = []
        files, requests = self.files, self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                requests.append(self.path)
                name = self.path.rsplit("/", 1)[-1]
                if not self.path.startswith("/assets/") or name not in files:
                    self.send_response(404)
                    self.end_headers()
                    return
                data, content_type = files[name]
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}/assets/"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def asset_server():
    server = AssetServer()
    yield server
    server.close()
