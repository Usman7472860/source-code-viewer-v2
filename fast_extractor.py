#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
US MODS Fast Python Source & Hardcoded API Extractor (v2.1)
High-speed multi-threaded source code inspector, JS asset crawler,
hardcoded API endpoint finder, and live API response extractor.
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

API_PATTERNS = [
    re.compile(r'https?://[^"\'\s<>]+\.(?:m3u8|mpd)(?:\?[^"\'\s<>]*)?', re.I),
    re.compile(r'https?://(?:api\.[a-zA-Z0-9_\-\.]+|[a-zA-Z0-9_\-\.]+(?:/[a-zA-Z0-9_\-\.]+)*(?:/api|/v\d+|/graphql|/rest|/ajax|/wp-json|/trpc))[a-zA-Z0-9_\-\/\?&=%#\.]*', re.I),
    re.compile(r"""["'](/(?:api|v\d+|graphql|rest|ajax|wp-json|trpc)/[a-zA-Z0-9_\-\/\?&=%#\.]*)["']""", re.I),
    re.compile(r"""\bfetch\s*\(\s*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\baxios(?:\.(?:get|post|put|delete|patch))?\s*\(\s*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\$\s*\.\s*(?:get|post|getJSON|ajax)\s*\([^"']*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""\.open\s*\(\s*["'](?:GET|POST|PUT|DELETE|PATCH)["']\s*,\s*["']([^"'\)\s,]+)""", re.I),
    re.compile(r"""(?:endpoint|apiUrl|baseURL|api_url|api_endpoint)\s*[:=]\s*["']([^"'\)\s,;]+)""", re.I)
]

SECRET_PATTERNS = [
    ("Google API Key", re.compile(r'\bAIza[0-9A-Za-z-_]{35}\b')),
    ("AWS Access Key ID", re.compile(r'\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b')),
    ("GitHub Personal Token", re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-zA-Z]{36}\b')),
    ("Stripe Secret Key", re.compile(r'\b(?:sk|rk)_live_[0-9a-zA-Z]{24}\b')),
    ("Stripe Publishable Key", re.compile(r'\bpk_live_[0-9a-zA-Z]{24}\b')),
    ("OpenAI API Key", re.compile(r'\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,64}\b')),
    ("Slack Token", re.compile(r'\bxox[baprs]-[0-9a-zA-Z]{10,48}\b')),
    ("JWT Token", re.compile(r'\beyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b')),
    ("Bearer Token", re.compile(r'\bBearer\s+[a-zA-Z0-9_\-\.]{20,}\b', re.I)),
    ("Generic Secret Key", re.compile(r"""(?:api_key|apikey|secret_key|client_secret|auth_token)\s*[:=]\s*["']([a-zA-Z0-9_\-\.]{16,})["']""", re.I))
]

def fetch_url(url, timeout=7):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9"
    })
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = response.read()
            elapsed_ms = round((time.time() - t0) * 1000)
            charset = response.headers.get_content_charset() or "utf-8"
            try:
                body_text = data.decode(charset, errors="replace")
            except Exception:
                body_text = data.decode("utf-8", errors="replace")
            return {
                "ok": True,
                "url": response.geturl(),
                "status": response.status,
                "headers": dict(response.headers),
                "contentType": response.headers.get("Content-Type", ""),
                "body": body_text,
                "size": len(data),
                "ms": elapsed_ms
            }
    except urllib.error.HTTPError as e:
        elapsed_ms = round((time.time() - t0) * 1000)
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = ""
        return {
            "ok": False,
            "url": url,
            "status": e.code,
            "error": str(e),
            "body": err_body,
            "ms": elapsed_ms
        }
    except Exception as e:
        elapsed_ms = round((time.time() - t0) * 1000)
        return {
            "ok": False,
            "url": url,
            "status": 0,
            "error": str(e),
            "body": "",
            "ms": elapsed_ms
        }

def extract_js_links(html, base_url):
    script_re = re.compile(r"""<script[^>]+src=["']([^"']+)["']""", re.I)
    matches = script_re.findall(html)
    js_urls = []
    seen = set()
    for m in matches:
        full = urllib.parse.urljoin(base_url, m.strip())
        if full.startswith(("http://", "https://")) and full not in seen:
            seen.add(full)
            js_urls.append(full)
    return js_urls

def extract_inline_scripts(html):
    inline_re = re.compile(r"<script(?![^>]*src=)[^>]*>(.*?)</script>", re.I | re.S)
    return inline_re.findall(html)

def scan_text_for_apis_and_secrets(text, source_name, base_url=""):
    endpoints = []
    secrets = []
    seen_ep = set()
    seen_sec = set()

    for pat in API_PATTERNS:
        for match in pat.findall(text):
            ep = match if isinstance(match, str) else match[0]
            ep = ep.strip().strip("\"'\\")
            if len(ep) < 4 or re.match(r'^\.+(?:js|css|png|jpg|svg|woff2?)$', ep, re.I):
                continue
            if not (ep.startswith("/") or ep.startswith("http://") or ep.startswith("https://")):
                continue
            full_url = urllib.parse.urljoin(base_url, ep) if base_url else ep
            if full_url not in seen_ep:
                seen_ep.add(full_url)
                endpoints.append({
                    "endpoint": ep,
                    "full_url": full_url,
                    "source": source_name,
                    "method": "POST" if any(k in ep.lower() for k in ["post", "auth", "login", "create", "submit"]) else "GET"
                })

    for sec_name, sec_pat in SECRET_PATTERNS:
        for match in sec_pat.findall(text):
            key_val = match if isinstance(match, str) else match[0]
            key_val = key_val.strip()
            if key_val not in seen_sec:
                seen_sec.add(key_val)
                secrets.append({
                    "type": sec_name,
                    "value": key_val,
                    "masked": key_val[:8] + "..." + key_val[-4:] if len(key_val) > 12 else "***",
                    "source": source_name
                })

    return endpoints, secrets

def test_api_endpoint(ep_info):
    url = ep_info["full_url"]
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    res = fetch_url(url, timeout=4)
    preview = res.get("body", "")[:300].strip()
    return {
        "url": url,
        "endpoint": ep_info["endpoint"],
        "status": res["status"],
        "ms": res["ms"],
        "contentType": res.get("contentType", ""),
        "snippet": preview,
        "source": ep_info["source"]
    }

def run_extraction(target_url, test_apis=False, max_workers=8):
    t_start = time.time()
    page_res = fetch_url(target_url)
    if not page_res["ok"]:
        return {"ok": False, "error": f"Failed to fetch {target_url}: {page_res.get('error', 'Unknown')}"}

    html = page_res["body"]
    final_url = page_res["url"]
    js_urls = extract_js_links(html, final_url)
    inline_scripts = extract_inline_scripts(html)

    all_sources = [{"name": "HTML Source", "text": html, "url": final_url}]
    for idx, sc in enumerate(inline_scripts):
        all_sources.append({"name": f"Inline Script #{idx+1}", "text": sc, "url": final_url})

    if js_urls:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_url = {executor.submit(fetch_url, u): u for u in js_urls[:35]}
            for future in as_completed(future_to_url):
                u = future_to_url[future]
                try:
                    r = future.result()
                    if r["ok"]:
                        file_name = u.split("/")[-1].split("?")[0] or "script.js"
                        all_sources.append({"name": file_name, "text": r["body"], "url": u})
                except Exception:
                    pass

    total_endpoints = []
    total_secrets = []
    seen_endpoints = set()

    for src in all_sources:
        eps, secs = scan_text_for_apis_and_secrets(src["text"], src["name"], final_url)
        for ep in eps:
            if ep["full_url"] not in seen_endpoints:
                seen_endpoints.add(ep["full_url"])
                total_endpoints.append(ep)
        total_secrets.extend(secs)

    tested_responses = []
    if test_apis and total_endpoints:
        test_targets = [ep for ep in total_endpoints if ep["full_url"].startswith("http")][:20]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(test_api_endpoint, ep) for ep in test_targets]
            for f in as_completed(futures):
                try:
                    res = f.result()
                    if res:
                        tested_responses.append(res)
                except Exception:
                    pass

    elapsed = round(time.time() - t_start, 2)
    return {
        "ok": True,
        "target": target_url,
        "finalUrl": final_url,
        "duration": elapsed,
        "files_analyzed": len(all_sources),
        "endpoints_count": len(total_endpoints),
        "secrets_count": len(total_secrets),
        "endpoints": total_endpoints,
        "secrets": total_secrets,
        "tested_responses": tested_responses
    }

def main():
    parser = argparse.ArgumentParser(description="US MODS Fast Python Source & Hardcoded API Extractor")
    parser.add_argument("url", nargs="?", help="Target website URL (e.g. https://example.com)")
    parser.add_argument("--test-apis", "-t", action="store_true", help="Speed test discovered GET endpoints and pull live responses")
    parser.add_argument("--json", "-j", action="store_true", help="Output results in raw JSON format")
    parser.add_argument("--output", "-o", help="Save output to file (JSON or TXT)")
    parser.add_argument("--concurrency", "-c", type=int, default=8, help="Number of concurrent worker threads")

    args = parser.parse_args()
    if not args.url:
        parser.print_help()
        print("\nExample:")
        print("  python3 fast_extractor.py https://example.com --test-apis")
        return

    url = args.url
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    result = run_extraction(url, test_apis=args.test_apis, max_workers=args.concurrency)

    if args.json:
        out = json.dumps(result, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(out)
            print(f"[+] Output saved to {args.output}")
        else:
            print(out)
        return

    print("\n" + "=" * 65)
    print(f"  🚀 EXTRACTION COMPLETE ({result.get('duration', 0)}s)")
    print(f"  🔗 Target:   {result.get('finalUrl', url)}")
    print(f"  📁 Analyzed: {result.get('files_analyzed', 0)} files")
    print(f"  🎯 APIs:     {result.get('endpoints_count', 0)} endpoints discovered")
    print(f"  🔑 Secrets:  {result.get('secrets_count', 0)} keys / tokens detected")
    print("=" * 65)

    if result.get("secrets"):
        print("\n🔑 DETECTED SECRETS & KEYS:")
        for s in result["secrets"][:10]:
            print(f"  - [{s['type']}] {s['masked']} (found in {s['source']})")

    print("\n🎯 HARDCODED API ENDPOINTS:")
    for ep in result.get("endpoints", [])[:15]:
        print(f"  - [{ep['method']}] {ep['endpoint']}  (in {ep['source']})")

    if result.get("tested_responses"):
        print("\n⚡ LIVE API RESPONSES:")
        for tr in result["tested_responses"]:
            print(f"  - [{tr['status']}] {tr['url'][:60]} ({tr['ms']}ms)")
            if tr.get("snippet"):
                print(f"    Body: {tr['snippet'][:120]}...")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"\n[+] Full report saved to {args.output}")

if __name__ == "__main__":
    main()
