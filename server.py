#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
US MODS Source Viewer - Standalone Multi-Threaded Python Server (Heavy Pro v2.3)
Full Python HTTP server providing web UI, API proxy, Cookie Jar & CSRF forwarding,
base64 binary streaming, and high-speed hardcoded API extraction.
Zero external dependencies required (uses Python standard library).
"""

import sys
import os
import re
import json
import time
import base64
import urllib.request
import urllib.error
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

from fast_extractor import run_extraction, extract_set_cookies

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get("PORT", 3000))
ROOT = os.path.dirname(os.path.abspath(__file__))

UA_MAP = {
    "desktop": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "mobile": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "bot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
}

PRIVATE_HOST_RE = re.compile(
    r'^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1?\]?)$',
    re.I
)

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
}

TEXT_MIME_RE = re.compile(
    r'^(text/|application/(json|javascript|x-javascript|ecmascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql|ld\+json|manifest\+json|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|audio/(mpegurl|x-mpegurl))|\+(json|xml)$|^image/svg\+xml$',
    re.I
)

def is_text_content(ct, url=""):
    if url and re.search(r'\.(m3u8|mpd|vtt|srt|json|xml|txt|css|m?js)(?:$|[?#])', url, re.I):
        return True
    if url and re.search(r'\.(ts|m4s|mp4|webm|aac|mp3|png|jpe?g|webp|gif|ico|woff2?)(?:$|[?#])', url, re.I):
        return False
    clean_ct = str(ct or "").split(";")[0].strip()
    return not clean_ct or bool(TEXT_MIME_RE.search(clean_ct))


class USVHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[USV-PyServer] %s - %s\n" % (self.address_string(), fmt % args))

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, User-Agent, Authorization, X-Requested-With")

    def send_json(self, status_code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Health Endpoint
        if path == "/api/health":
            self.send_json(200, {"status": "ok", "server": "US-MODS-Python-v2.3", "time": time.time()})
            return

        # 2. Fast Scan Endpoint (/api/fast-scan)
        if path == "/api/fast-scan":
            target = query.get("url", [""])[0].strip()
            test_apis = query.get("test", ["0"])[0] in ("1", "true")
            auth = query.get("auth", [""])[0].strip()
            cookies = query.get("cookies", [""])[0].strip()
            if not target:
                self.send_json(400, {"ok": False, "error": "URL missing"})
                return
            if not target.startswith(("http://", "https://")):
                target = "https://" + target
            p = urllib.parse.urlparse(target)
            if PRIVATE_HOST_RE.match(p.hostname or ""):
                self.send_json(400, {"ok": False, "error": "Private addresses not allowed"})
                return
            res = run_extraction(target, test_apis=test_apis, auth=auth, cookies=cookies)
            self.send_json(200, res)
            return

        # 3. Remote HTML/Asset Fetch (/api/fetch)
        if path == "/api/fetch":
            target = query.get("url", [""])[0].strip()
            ua_choice = query.get("ua", ["desktop"])[0]
            cookies = query.get("cookies", [""])[0].strip()
            if not target:
                self.send_json(400, {"ok": False, "error": "URL sahi nahi hai."})
                return
            if not target.startswith(("http://", "https://")):
                target = "https://" + target
            p = urllib.parse.urlparse(target)
            if p.scheme not in ("http", "https") or PRIVATE_HOST_RE.match(p.hostname or ""):
                self.send_json(400, {"ok": False, "error": "Invalid or private address."})
                return

            ua_str = UA_MAP.get(ua_choice, UA_MAP["desktop"])
            hdrs = {
                "User-Agent": ua_str,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": f"{p.scheme}://{p.netloc}/"
            }
            if cookies:
                hdrs["Cookie"] = cookies

            req = urllib.request.Request(target, headers=hdrs)
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    raw_data = response.read(3670016)
                    elapsed = round((time.time() - t0) * 1000)
                    charset = response.headers.get_content_charset() or "utf-8"
                    body_text = raw_data.decode(charset, errors="replace")
                    out_headers = {k.lower(): v for k, v in response.headers.items() if k.lower() != "set-cookie"}
                    set_ck = extract_set_cookies(response.headers)
                    self.send_json(200, {
                        "ok": True,
                        "status": response.status,
                        "statusText": getattr(response, "reason", "OK") or "OK",
                        "finalUrl": response.geturl(),
                        "contentType": response.headers.get("Content-Type", ""),
                        "headers": out_headers,
                        "cookies": set_ck,
                        "body": body_text,
                        "ms": elapsed,
                        "size": len(raw_data)
                    })
                    return
            except urllib.error.HTTPError as e:
                elapsed = round((time.time() - t0) * 1000)
                raw_data = e.read(3670016) if hasattr(e, "read") else b""
                body_text = raw_data.decode("utf-8", errors="replace")
                out_headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else []) if k.lower() != "set-cookie"}
                set_ck = extract_set_cookies(e.headers)
                self.send_json(200, {
                    "ok": True,
                    "status": e.code,
                    "statusText": str(e.reason or ""),
                    "finalUrl": e.geturl() if hasattr(e, "geturl") else target,
                    "contentType": e.headers.get("Content-Type", "") if e.headers else "",
                    "headers": out_headers,
                    "cookies": set_ck,
                    "body": body_text,
                    "ms": elapsed,
                    "size": len(raw_data)
                })
                return
            except Exception as e:
                self.send_json(502, {"ok": False, "error": str(e)})
                return

        # 4. Static Web UI Files
        rel_path = "index.html" if path in ("/", "") else path.lstrip("/")
        safe_rel = os.path.normpath(rel_path)
        if safe_rel.startswith("..") or os.path.isabs(safe_rel):
            self.send_error(403, "Forbidden")
            return

        file_path = os.path.join(ROOT, safe_rel)
        if not os.path.isfile(file_path):
            self.send_error(404, f"File Not Found: {path}")
            return

        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(os.path.getsize(file_path)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                self.wfile.write(chunk)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/proxy":
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                spec = json.loads(body_bytes.decode("utf-8", errors="replace"))
            except Exception:
                self.send_json(400, {"ok": False, "error": "Invalid JSON body"})
                return

            target = str(spec.get("url") or "").strip()
            method = str(spec.get("method") or "GET").upper()
            req_headers = spec.get("headers") or {}
            payload = spec.get("body")
            page = str(spec.get("page") or target).strip()
            cookies = str(spec.get("cookies") or "").strip()

            p = urllib.parse.urlparse(target)
            if p.scheme not in ("http", "https") or PRIVATE_HOST_RE.match(p.hostname or ""):
                self.send_json(400, {"ok": False, "error": "Invalid or private URL"})
                return

            headers = {
                k: str(v)
                for k, v in req_headers.items()
                if k.lower() not in ("host", "connection", "content-length", "accept-encoding")
            }
            lower_keys = {k.lower() for k in headers}
            if "user-agent" not in lower_keys:
                headers["User-Agent"] = UA_MAP["desktop"]
            if cookies and "cookie" not in lower_keys:
                headers["Cookie"] = cookies
            if page:
                try:
                    pp = urllib.parse.urlparse(page)
                    if "referer" not in lower_keys:
                        headers["Referer"] = page
                    if "origin" not in lower_keys and pp.scheme and pp.netloc:
                        headers["Origin"] = f"{pp.scheme}://{pp.netloc}"
                except Exception:
                    pass

            data_bytes = payload.encode("utf-8") if isinstance(payload, str) and payload and method not in ("GET", "HEAD") else None
            req = urllib.request.Request(target, data=data_bytes, headers=headers, method=method)

            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    raw_data = response.read(3670016)
                    elapsed = round((time.time() - t0) * 1000)
                    ct = response.headers.get("Content-Type", "")
                    final_url = response.geturl()
                    text_mode = is_text_content(ct, final_url)
                    charset = response.headers.get_content_charset() or "utf-8"
                    body_val = raw_data.decode(charset, errors="replace") if text_mode else base64.b64encode(raw_data).decode("ascii")
                    out_headers = {k.lower(): v for k, v in response.headers.items() if k.lower() != "set-cookie"}
                    set_ck = extract_set_cookies(response.headers)

                    self.send_json(200, {
                        "ok": True,
                        "status": response.status,
                        "statusText": getattr(response, "reason", "OK") or "OK",
                        "finalUrl": final_url,
                        "contentType": ct,
                        "headers": out_headers,
                        "cookies": set_ck,
                        "encoding": "text" if text_mode else "base64",
                        "body": body_val,
                        "size": len(raw_data),
                        "ms": elapsed
                    })
                    return
            except urllib.error.HTTPError as e:
                elapsed = round((time.time() - t0) * 1000)
                raw_data = e.read(3670016) if hasattr(e, "read") else b""
                ct = e.headers.get("Content-Type", "") if e.headers else "text/plain"
                final_url = e.geturl() if hasattr(e, "geturl") else target
                text_mode = is_text_content(ct, final_url)
                body_val = raw_data.decode("utf-8", errors="replace") if text_mode else base64.b64encode(raw_data).decode("ascii")
                out_headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else []) if k.lower() != "set-cookie"}
                set_ck = extract_set_cookies(e.headers)

                self.send_json(200, {
                    "ok": True,
                    "status": e.code,
                    "statusText": str(e.reason or ""),
                    "finalUrl": final_url,
                    "contentType": ct,
                    "headers": out_headers,
                    "cookies": set_ck,
                    "encoding": "text" if text_mode else "base64",
                    "body": body_val,
                    "size": len(raw_data),
                    "ms": elapsed
                })
                return
            except Exception as e:
                self.send_json(502, {"ok": False, "error": str(e)})
                return

        self.send_error(404, "Not Found")


def run():
    server_address = ("", PORT)
    httpd = ThreadingHTTPServer(server_address, USVHandler)
    print("=" * 62)
    print(f"  🐍 US MODS Multi-Threaded Python Server v2.3 Running on port {PORT}")
    print(f"  🔗 Local URL:     http://localhost:{PORT}")
    print(f"  ⚡ Fast Scan API: /api/fast-scan?url=<URL>&test=1")
    print(f"  🛡️ Proxy Engine:  /api/proxy & /api/fetch (Cookie Jar + Base64 Ready)")
    print("=" * 62)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Python server...")
        httpd.server_close()


if __name__ == "__main__":
    run()
