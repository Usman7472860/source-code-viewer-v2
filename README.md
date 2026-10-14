# US MODS Source Viewer · Heavy Pro Developer Suite v2.1

Kisi bhi website ka source code dekhein, reverse engineering karein, live preview chalaein, network requests intercept karein, security secrets dhoondein, tech stack detect karein, aur **High-Speed Python Engine** se hardcoded API endpoints aur unke live responses nikalein!

---

## 🐍 Naya Feature: High-Speed Python Hardcoded API Extractor (`fast_extractor.py`)

Aapke kehne par **Python Engine** add kar diya hai jo super speed (multi-threaded concurrent requests) ke sath:
1. Target website ka source code fetch karta hai.
2. Saari linked JavaScript (.js) aur inline script files ko parallel threads mein download karta hai.
3. Code ke andar se **Hardcoded API Endpoints**, REST routes, GraphQL, fetch/axios/ajax calls dhoondta hai.
4. Hardcoded **API Keys aur Secrets** extract karta hai (Google, AWS, Stripe, OpenAI, JWT, Bearer tokens).
5. Discovered GET endpoints ko **speed test** karke unke **Live Status Code, Latency (ms) aur Response Body/JSON** extract karke console ya JSON file mein print kar deta hai!

### Terminal Command:
```bash
# 1. Fast extraction & Hardcoded APIs scan:
python3 fast_extractor.py https://example.com

# 2. Live API Responses bhi nikalne ke liye (--test-apis):
python3 fast_extractor.py https://example.com --test-apis

# 3. JSON dump file mein save karne ke liye:
python3 fast_extractor.py https://example.com --test-apis --json -o results.json
```

---

## ⚡ Standalone Python Server (`server.py`)

Agar aap PC par Node.js ke bajaye **Python** use karna chahte hain:
```bash
python3 server.py
# (Browser mein kholein: http://localhost:3000)
```
- Zero external dependencies (pure Python 3 standard library).
- `/api/fetch`, `/api/proxy`, aur `/api/fast-scan` built-in endpoints provide karta hai.

---

## 🚀 Node.js Ya Direct Browser Se Chalana

- **Node.js**: `npm start` ya `node server.js`
- **Direct Double Click**: `index.html` par double click karein (public CORS proxy mode).
- **Vercel Deploy**: GitHub repo bana kar Vercel par 1-click import karein.

---

## 📂 Project Structure

```
├── fast_extractor.py   # 🐍 High-Speed Python CLI & Hardcoded API Response Extractor
├── server.py           # 🐍 Standalone Python Web Server (Zero dependencies)
├── server.js           # 🚀 Standalone Node.js Web Server
├── index.html          # 💻 Heavy Pro Developer UI
├── live.js             # 🔍 Deep Network Spy, Console Interceptor & API Replayer
├── assets.js           # 🛡️ Asset Extractor, Security Scanner, Tech Detector & SEO
├── api/
│   ├── fetch.js        # Serverless GET Function (CORS bypass)
│   └── proxy.js        # Serverless POST Proxy
├── lib/
│   └── net.js          # Shared networking helpers & SSRF guard
├── package.json        # NPM scripts (npm start, npm run python, npm run scan)
└── vercel.json         # Vercel deployment configuration
```

---

## 🛡️ Security & Privacy
- Built-in SSRF protection (localhost aur private IP ranges blocked).
- Sandboxed iframe preview.
