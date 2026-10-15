#!/usr/bin/env python3
"""
US MODS Source Viewer - Standalone Python Server (v2.0)
Full Python HTTP server providing web UI, API proxy, CORS bypass,
and high-speed hardcoded API extraction.
Zero external dependencies required (uses standard library).
"""

import sys
import os
import re
import json
import time
import socket
import gzip
import io
import signal
import urllib.request
import urllib.error
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from concurrent.futures import ThreadPoolExecutor, as_completed

PORT = int(os.environ.get("PORT", 3000))
ROOT = os.path.dirname(os.path.abspath(__file__))

# --- Heavy-load tuning ---------------------------------------------------
# How many concurrent client connections the OS will queue before refusing
# new ones (separate from in-flight request handling, which is threaded).
LISTEN_BACKLOG = int(os.environ.get("LISTEN_BACKLOG", 256))
# Per-request socket timeout so one slow/stalled client can't pin a thread
# forever under heavy concurrent load.
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", 20))
# Cap on simultaneous outbound fetches this process will issue at once
# (across /api/fetch, /api/proxy, and page-level crawling), so a burst of
# heavy requests can't exhaust outbound sockets or memory.
MAX_CONCURRENT_FETCHES = int(os.environ.get("MAX_CONCURRENT_FETCHES", 24))
_fetch_semaphore = __import__("threading").BoundedSemaphore(MAX_CONCURRENT_FETCHES)
FETCH_RETRIES = int(os.environ.get("FETCH_RETRIES", 2))

UA_MAP = {
    "desktop": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "mobile": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "bot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
}

PRIVATE_HOST_RE = re.compile(r'^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1?\]?)$', re.I)

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
}

API_PATTERNS = [
    re.compile(r'https?://[a-zA-Z0-9_\-\.]+(?:/[a-zA-Z0-9_\-\.]+)*(?:/api|/v\d+|/graphql|/rest|/ajax|/wp-json|/trpc)[a-zA-Z0-9_\-\/\?&=%#\.]*', re.I),
    re.compile(r"""["'](/(?:api|v\d+|graphql|rest|ajax|wp-json|trpc)/[a-zA-Z0-9_\-\/\?&=%#\.]*)["']""", re.I),
    re.compile(r"""\bfetch\s*\(\s*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\baxios(?:\.(?:get|post|put|delete|patch))?\s*\(\s*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\$\s*\.\s*(?:get|post|getJSON|ajax)\s*\([^"']*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\.open\s*\(\s*["'](?:GET|POST|PUT|DELETE|PATCH)["']\s*,\s*["']([^"'\)\s,]+)""", re.I),
]

SECRET_PATTERNS = [
    ("Google API Key", re.compile(r'\bAIza[0-9A-Za-z-_]{35}\b')),
    ("AWS Access Key ID", re.compile(r'\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b')),
    ("Stripe Secret Key", re.compile(r'\b(?:sk|rk)_live_[0-9a-zA-Z]{24}\b')),
    ("OpenAI API Key", re.compile(r'\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,64}\b')),
    ("JWT Token", re.compile(r'\beyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b'))
]

def fast_fetch(url, timeout=7, retries=None):
    """Fetch with a bounded concurrency gate and transient-error retries.

    The semaphore keeps a burst of heavy requests (many JS files, many
    concurrent users) from opening unbounded sockets at once. Retries only
    kick in for network-level failures / timeouts / 5xx, never for 4xx,
    so a bad URL still fails fast instead of being retried pointlessly.
    """
    if retries is None:
        retries = FETCH_RETRIES
    req = urllib.request.Request(url, headers={"User-Agent": UA_MAP["desktop"], "Accept": "*/*"})
    t0 = time.time()
    last_err = None
    with _fetch_semaphore:
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as res:
                    data = res.read(3670016)
                    elapsed = round((time.time() - t0) * 1000)
                    charset = res.headers.get_content_charset() or "utf-8"
                    return {"ok": True, "status": res.status, "body": data.decode(charset, errors="replace"), "url": res.geturl(), "contentType": res.headers.get("Content-Type", ""), "ms": elapsed, "size": len(data)}
            except urllib.error.HTTPError as e:
                # 4xx/5xx reached the server. Retry 5xx only.
                if 500 <= e.code < 600 and attempt < retries:
                    last_err = e
                    time.sleep(0.2 * (2 ** attempt))
                    continue
                return {"ok": False, "status": e.code, "error": str(e), "body": "", "ms": round((time.time() - t0) * 1000)}
            except Exception as e:
                last_err = e
                if attempt < retries:
                    time.sleep(0.2 * (2 ** attempt))
                    continue
                return {"ok": False, "status": getattr(e, "code", 0), "error": str(e), "body": "", "ms": round((time.time() - t0) * 1000)}
    return {"ok": False, "status": 0, "error": str(last_err) if last_err else "unknown", "body": "", "ms": round((time.time() - t0) * 1000)}

def fast_scan_url(target_url, test_apis=False):
    t0 = time.time()
    res = fast_fetch(target_url)
    if not res["ok"]:
        return {"ok": False, "error": f"Failed to fetch {target_url}: {res.get('error', 'unknown')}"}

    html = res["body"]
    base_url = res["url"]
    script_re = re.compile(r"""<script[^>]+src=["']([^"']+)["']""", re.I)
    js_urls = [urllib.parse.urljoin(base_url, u.strip()) for u in script_re.findall(html)]
    js_urls = [u for u in set(js_urls) if u.startswith(("http://", "https://"))][:25]

    sources = [{"name": "HTML Source", "text": html}]
    if js_urls:
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(fast_fetch, u): u for u in js_urls}
            for fut in as_completed(futs):
                u = futs[fut]
                try:
                    r = fut.result()
                    if r["ok"]:
                        sources.append({"name": u.split("/")[-1].split("?")[0] or "script.js", "text": r["body"]})
                except Exception:
                    pass

    endpoints = []
    secrets = []
    seen_ep = set()
    for s in sources:
        t = s["text"]
        for pat in API_PATTERNS:
            for match in pat.findall(t):
                ep = match if isinstance(match, str) else match[0]
                ep = ep.strip().strip("\"'\\")
                if len(ep) >= 4 and (ep.startswith("/") or ep.startswith("http")):
                    full = urllib.parse.urljoin(base_url, ep)
                    if full not in seen_ep:
                        seen_ep.add(full)
                        endpoints.append({"endpoint": ep, "full_url": full, "source": s["name"]})
        for sec_name, sec_pat in SECRET_PATTERNS:
            for m in sec_pat.findall(t):
                k = m if isinstance(m, str) else m[0]
                secrets.append({"type": sec_name, "value": k[:8] + "..." + k[-4:], "source": s["name"]})

    tested = []
    if test_apis and endpoints:
        test_eps = [e for e in endpoints if e["full_url"].startswith("http")][:15]
        with ThreadPoolExecutor(max_workers=6) as ex:
            futs = [ex.submit(fast_fetch, e["full_url"]) for e in test_eps]
            for f in as_completed(futs):
                try:
                    r = f.result()
                    tested.append({"url": r.get("url", ""), "status": r.get("status", 0), "ms": r.get("ms", 0), "snippet": r.get("body", "")[:200].strip()})
                except Exception:
                    pass

    return {
        "ok": True,
        "target": target_url,
        "finalUrl": base_url,
        "duration": round(time.time() - t0, 2),
        "files_analyzed": len(sources),
        "endpoints_count": len(endpoints),
        "secrets_count": len(secrets),
        "endpoints": endpoints,
        "secrets": secrets,
        "tested_responses": tested
    }

class USVHandler(BaseHTTPRequestHandler):
    # ThreadingHTTPServer already runs each request on its own thread;
    # this just bounds how long a single slow/idle client can hold one.
    timeout = REQUEST_TIMEOUT
    # Note: staying on HTTP/1.0 semantics (connection closes per request)
    # rather than enabling keep-alive, since several handlers below don't
    # set Content-Length on every path — upgrading to 1.1 without auditing
    # every response would make non-compliant clients hang on keep-alive.

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, User-Agent")

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        accept_enc = self.headers.get("Accept-Encoding", "")
        if "gzip" in accept_enc and len(body) > 1024:
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
                gz.write(body)
            body = buf.getvalue()
            self.send_response(status)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(status)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Health
        if path == "/api/health":
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "server": "US-MODS-Python", "time": time.time()}).encode("utf-8"))
            return

        # Fast Scan
        if path == "/api/fast-scan":
            target = query.get("url", [""])[0].strip()
            test_apis = query.get("test", ["0"])[0] in ("1", "true")
            if not target:
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "URL missing"}).encode("utf-8"))
                return

            if not target.startswith(("http://", "https://")):
                target = "https://" + target

            if PRIVATE_HOST_RE.match(urllib.parse.urlparse(target).hostname or ""):
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Private addresses not allowed"}).encode("utf-8"))
                return

            res = fast_scan_url(target, test_apis=test_apis)
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        # GET /api/fetch
        if path == "/api/fetch":
            target = query.get("url", [""])[0].strip()
            ua_choice = query.get("ua", ["desktop"])[0]
            if not target:
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "URL sahi nahi hai."}).encode("utf-8"))
                return

            p = urllib.parse.urlparse(target)
            if p.scheme not in ("http", "https") or PRIVATE_HOST_RE.match(p.hostname or ""):
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Invalid or private address."}).encode("utf-8"))
                return

            ua_str = UA_MAP.get(ua_choice, UA_MAP["desktop"])
            req = urllib.request.Request(target, headers={"User-Agent": ua_str, "Accept": "*/*"})
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=8) as response:
                    raw_data = response.read(3670016)
                    elapsed = round((time.time() - t0) * 1000)
                    charset = response.headers.get_content_charset() or "utf-8"
                    body_text = raw_data.decode(charset, errors="replace")
                    out_headers = {k.lower(): v for k, v in response.headers.items() if k.lower() != "set-cookie"}
                    
                    self.send_response(200)
                    self.send_cors_headers()
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": True,
                        "status": response.status,
                        "statusText": "OK",
                        "finalUrl": response.geturl(),
                        "contentType": response.headers.get("Content-Type", ""),
                        "headers": out_headers,
                        "body": body_text,
                        "ms": elapsed,
                        "size": len(raw_data)
                    }).encode("utf-8"))
                    return
            except Exception as e:
                self.send_response(502)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
                return

        # Static files
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
        stat = os.stat(file_path)
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'

        # Conditional GET — lets browsers/proxies skip re-downloading
        # unchanged assets, which matters a lot once many clients are
        # repeatedly loading the same large JS bundles.
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return

        range_header = self.headers.get("Range")
        file_size = stat.st_size

        if range_header and range_header.startswith("bytes="):
            try:
                start_s, end_s = range_header.split("=", 1)[1].split("-", 1)
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else file_size - 1
                end = min(end, file_size - 1)
                if start > end or start >= file_size:
                    raise ValueError("bad range")
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(length))
                self.send_header("ETag", etag)
                self.end_headers()
                with open(file_path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                return
            except (ValueError, IndexError):
                pass  # fall through to a normal full response

        accept_enc = self.headers.get("Accept-Encoding", "")
        compressible = ext in (".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt")

        if compressible and "gzip" in accept_enc and file_size > 1024:
            with open(file_path, "rb") as f:
                raw = f.read()
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
                gz.write(raw)
            body = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache" if ext == ".html" else "public, max-age=3600")
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", "no-cache" if ext == ".html" else "public, max-age=3600")
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
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Invalid body"}).encode("utf-8"))
                return

            target = spec.get("url", "")
            method = spec.get("method", "GET").upper()
            req_headers = spec.get("headers", {})
            payload = spec.get("body", "")

            p = urllib.parse.urlparse(target)
            if p.scheme not in ("http", "https") or PRIVATE_HOST_RE.match(p.hostname or ""):
                self.send_response(400)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Invalid URL"}).encode("utf-8"))
                return

            headers = {k: str(v) for k, v in req_headers.items() if k.lower() not in ("host", "cookie", "connection")}
            if "user-agent" not in [k.lower() for k in headers]:
                headers["User-Agent"] = UA_MAP["desktop"]

            data_bytes = payload.encode("utf-8") if payload and method not in ("GET", "HEAD") else None
            req = urllib.request.Request(target, data=data_bytes, headers=headers, method=method)

            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=8) as response:
                    raw_data = response.read(3670016)
                    elapsed = round((time.time() - t0) * 1000)
                    charset = response.headers.get_content_charset() or "utf-8"
                    is_text = any(t in response.headers.get("Content-Type", "").lower() for t in ["text", "json", "javascript", "xml"])
                    body_val = raw_data.decode(charset, errors="replace") if is_text else raw_data.hex()
                    
                    self.send_response(200)
                    self.send_cors_headers()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": True,
                        "status": response.status,
                        "statusText": "OK",
                        "finalUrl": response.geturl(),
                        "contentType": response.headers.get("Content-Type", ""),
                        "headers": {k.lower(): v for k, v in response.headers.items() if k.lower() != "set-cookie"},
                        "encoding": "text" if is_text else "hex",
                        "body": body_val,
                        "size": len(raw_data),
                        "ms": elapsed
                    }).encode("utf-8"))
                    return
            except Exception as e:
                self.send_response(502)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
                return

        self.send_error(404, "Not Found")

class HeavyLoadServer(ThreadingHTTPServer):
    # Each client connection gets its own thread (ThreadingHTTPServer),
    # daemon threads so a stuck request can't block process shutdown,
    # and a larger accept backlog so a burst of simultaneous connections
    # queues at the OS level instead of being refused outright.
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = LISTEN_BACKLOG

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()


def run():
    server_address = ("", PORT)
    httpd = HeavyLoadServer(server_address, USVHandler)

    def _shutdown(signum, frame):
        print("\nShutting down gracefully...")
        httpd.server_close()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    print("=" * 60)
    print(f"  🐍 US MODS Python Server Running on port {PORT} (threaded)")
    print(f"  🔗 Local URL: http://localhost:{PORT}")
    print(f"  ⚡ Fast Scan API: /api/fast-scan?url=<URL>&test=1")
    print(f"  🧵 Max concurrent outbound fetches: {MAX_CONCURRENT_FETCHES}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _shutdown(None, None)

if __name__ == "__main__":
    run()
