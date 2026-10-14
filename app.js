/**
 * WebSource Inspector Pro
 * Features:
 * - Multi-website history & URL management
 * - Interactive Button Inspector (Click any button to view its code, attributes, and GET/POST action)
 * - GET / POST Request & Form Analyzer (Detects forms, action URLs, methods, input payloads, & API fetch calls)
 * - Live Sandboxed Web Preview (Desktop/Tablet/Mobile responsive preview)
 * - Source Code Viewer & Heavy Print Engine
 */

const state = {
  currentUrl: '',
  rawHtml: '',
  parsedDoc: null,
  savedSites: [],
  buttonsList: [],
  requestsList: [],
  selectedButtonIndex: -1,
  metaTags: [],
  cssLinks: [],
  inlineStyles: [],
  jsScripts: [],
  inlineScripts: [],
  headings: []
};

document.addEventListener('DOMContentLoaded', () => {
  loadSavedSites();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('fetchForm').addEventListener('submit', handleFetch);
  document.getElementById('clearSitesBtn').addEventListener('click', clearSavedSites);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Sample Chips
  document.querySelectorAll('.sample-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('urlInput').value = chip.dataset.url;
      document.getElementById('fetchForm').dispatchEvent(new Event('submit'));
    });
  });

  // Button Inspector Filter
  document.getElementById('btnFilterInput').addEventListener('input', (e) => {
    filterButtons(e.target.value.toLowerCase().trim());
  });

  // Responsive Preview Device Toggles
  document.querySelectorAll('.preview-controls button[data-device]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preview-controls button[data-device]').forEach(b => b.classList.remove('active-device'));
      btn.classList.add('active-device');
      const wrapper = document.getElementById('previewWrapper');
      wrapper.className = `live-preview-wrapper ${btn.dataset.device}`;
    });
  });

  // Copy selected element code
  document.getElementById('copyElementCodeBtn').addEventListener('click', () => {
    const code = document.getElementById('detOuterHtmlCode').textContent;
    navigator.clipboard.writeText(code);
    alert('Element HTML code copied to clipboard!');
  });

  // Source code controls
  document.getElementById('codeSearchInput').addEventListener('input', handleCodeSearch);
  document.getElementById('wrapCodeBtn').addEventListener('click', () => {
    document.getElementById('htmlCodeDisplay').classList.toggle('wrap');
  });
  document.getElementById('copyCodeBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(state.rawHtml);
    alert('Full source code copied to clipboard!');
  });
  document.getElementById('downloadHtmlBtn').addEventListener('click', downloadSource);

  // Heavy Print Task controls
  document.getElementById('heavyPrintBtn').addEventListener('click', () => window.print());
  document.querySelectorAll('.menu-item[data-print-mode]').forEach(item => {
    item.addEventListener('click', () => {
      const mode = item.dataset.printMode;
      const panes = document.querySelectorAll('.tab-pane');
      panes.forEach(p => p.style.display = 'none');
      if (mode === 'buttons') {
        document.getElementById('tab-buttons').style.display = 'block';
      } else if (mode === 'requests') {
        document.getElementById('tab-requests').style.display = 'block';
      } else if (mode === 'code') {
        document.getElementById('tab-html').style.display = 'block';
      } else {
        // Full
        panes.forEach(p => p.style.display = p.id !== 'tab-preview' ? 'block' : 'none');
      }
      window.print();
      panes.forEach(p => p.style.display = ''); // Reset
    });
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
}

function loadSavedSites() {
  const saved = localStorage.getItem('websource_saved_sites');
  state.savedSites = saved ? JSON.parse(saved) : ['https://example.com', 'https://httpbin.org/forms/post'];
  renderSavedSites();
}

function saveSite(url) {
  if (!state.savedSites.includes(url)) {
    state.savedSites.unshift(url);
    if (state.savedSites.length > 8) state.savedSites.pop();
    localStorage.setItem('websource_saved_sites', JSON.stringify(state.savedSites));
    renderSavedSites();
  }
}

function clearSavedSites() {
  state.savedSites = [];
  localStorage.removeItem('websource_saved_sites');
  renderSavedSites();
}

function renderSavedSites() {
  const container = document.getElementById('savedSitesList');
  container.innerHTML = '';
  state.savedSites.forEach(url => {
    const chip = document.createElement('span');
    chip.className = 'site-chip';
    try {
      chip.textContent = new URL(url).hostname;
    } catch (e) {
      chip.textContent = url;
    }
    chip.title = url;
    chip.addEventListener('click', () => {
      document.getElementById('urlInput').value = url;
      document.getElementById('fetchForm').dispatchEvent(new Event('submit'));
    });
    container.appendChild(chip);
  });
}

/**
 * Handle URL Fetch
 */
async function handleFetch(e) {
  e.preventDefault();
  let url = document.getElementById('urlInput').value.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  state.currentUrl = url;
  saveSite(url);

  const btn = document.getElementById('fetchBtn');
  btn.disabled = true;
  document.getElementById('fetchSpinner').style.display = 'inline-block';
  hideAlert();

  const start = performance.now();

  try {
    const html = await fetchTargetWebsite(url);
    const duration = Math.round(performance.now() - start);
    state.rawHtml = html;
    
    // Parse everything
    parseWebsite(html, url);

    // Update Live Web Preview
    updateLivePreview(html, url);

    // Render All Views
    renderAll(duration);

    document.getElementById('welcomeState').style.display = 'none';
    document.getElementById('metricsSection').style.display = 'grid';
    document.getElementById('actionToolbar').style.display = 'flex';
    document.getElementById('inspectorContent').style.display = 'block';

    showAlert(`Website successfully fetched & parsed in ${duration}ms!`, 'success');
  } catch (err) {
    showAlert('Fetch Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    document.getElementById('fetchSpinner').style.display = 'none';
  }
}

async function fetchTargetWebsite(targetUrl) {
  const mode = document.getElementById('proxyMode').value;
  // 1. Vercel Serverless Function
  if (mode === 'vercel' || mode === 'auto') {
    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(targetUrl)}`);
      if (res.ok) return await res.text();
    } catch (e) {
      if (mode === 'vercel') throw e;
    }
  }

  // 2. CORS Proxy Fallback
  const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`);
  if (!res.ok) throw new Error('CORS Proxy request failed');
  return await res.text();
}

/**
 * Comprehensive Parsing Logic
 */
function parseWebsite(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  state.parsedDoc = doc;

  // 1. Buttons & Clickable Elements Extraction
  state.buttonsList = [];
  const candidateElements = doc.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"], a[role="button"], [onclick]');
  
  candidateElements.forEach((el, index) => {
    const tagName = el.tagName.toUpperCase();
    const type = el.getAttribute('type') || '';
    const text = el.innerText?.trim() || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || `Element #${index + 1}`;
    const outerHtml = el.outerHTML;

    // Attributes list
    const attrs = [];
    for (let attr of el.attributes) {
      attrs.push({ name: attr.name, value: attr.value });
    }

    // Check parent or associated form
    const parentForm = el.closest('form');
    let formAction = 'None';
    let formMethod = 'GET';
    let formInputs = [];

    if (parentForm) {
      formAction = resolveUrl(parentForm.getAttribute('action') || baseUrl, baseUrl);
      formMethod = (parentForm.getAttribute('method') || 'GET').toUpperCase();
      parentForm.querySelectorAll('input, select, textarea').forEach(inp => {
        formInputs.push({
          name: inp.getAttribute('name') || '(unnamed)',
          type: inp.getAttribute('type') || inp.tagName.toLowerCase(),
          value: inp.value || inp.getAttribute('value') || ''
        });
      });
    }

    state.buttonsList.push({
      id: index,
      tagName,
      type,
      text: text.slice(0, 50),
      outerHtml,
      attrs,
      hasForm: !!parentForm,
      formAction,
      formMethod,
      formInputs
    });
  });

  // 2. GET / POST Forms & API Requests Extraction
  state.requestsList = [];
  // Scan all <form> tags
  doc.querySelectorAll('form').forEach((form, i) => {
    const method = (form.getAttribute('method') || 'GET').toUpperCase();
    const action = resolveUrl(form.getAttribute('action') || baseUrl, baseUrl);
    const id = form.getAttribute('id') || form.getAttribute('name') || `Form #${i + 1}`;
    
    const inputs = [];
    form.querySelectorAll('input, select, textarea').forEach(inp => {
      inputs.push({
        name: inp.getAttribute('name') || '(unnamed)',
        type: inp.getAttribute('type') || inp.tagName.toLowerCase(),
        value: inp.value || inp.getAttribute('value') || ''
      });
    });

    state.requestsList.push({
      type: 'HTML Form',
      id,
      method,
      endpoint: action,
      paramsCount: inputs.length,
      inputs,
      rawHtml: form.outerHTML
    });
  });

  // Scan inline scripts for fetch/ajax patterns (GET/POST endpoints)
  const scriptTexts = Array.from(doc.querySelectorAll('script')).map(s => s.textContent).join('\n');
  const fetchRegex = /fetch\s*\(\s*['"`](.*?)['"`](\s*,\s*\{[\s\S]*?method\s*:\s*['"`](GET|POST|PUT|DELETE)['"`])?/gi;
  let match;
  let apiIndex = 1;
  while ((match = fetchRegex.exec(scriptTexts)) !== null) {
    const endpoint = resolveUrl(match[1], baseUrl);
    const method = (match[3] || 'GET').toUpperCase();
    state.requestsList.push({
      type: 'Script API Call (fetch)',
      id: `API Request #${apiIndex++}`,
      method,
      endpoint,
      paramsCount: 0,
      inputs: [],
      rawHtml: match[0].slice(0, 300)
    });
  }

  // 3. CSS, JS, Meta, Headings
  state.metaTags = [];
  doc.querySelectorAll('meta').forEach(m => {
    const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('charset') || 'meta';
    const content = m.getAttribute('content') || m.getAttribute('charset') || '';
    state.metaTags.push({ name, content });
  });

  state.cssLinks = [];
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
    const href = l.getAttribute('href');
    if (href) state.cssLinks.push(resolveUrl(href, baseUrl));
  });

  state.jsScripts = [];
  doc.querySelectorAll('script[src]').forEach(sc => {
    const src = sc.getAttribute('src');
    if (src) state.jsScripts.push(resolveUrl(src, baseUrl));
  });

  state.headings = [];
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    state.headings.push({ tag: h.tagName, text: h.textContent.trim() });
  });
}

function resolveUrl(rel, base) {
  try {
    return new URL(rel, base).href;
  } catch (e) {
    return rel;
  }
}

/**
 * Update Live Web Preview (नीचे लाइव वेब भी हो)
 */
function updateLivePreview(html, baseUrl) {
  const iframe = document.getElementById('livePreviewFrame');
  const openNewTabBtn = document.getElementById('openNewTabBtn');
  if (openNewTabBtn) openNewTabBtn.href = baseUrl;

  // Inject <base href="..."> so relative stylesheets, fonts, and images load correctly inside iframe!
  let previewHtml = html;
  if (!/<base\s/i.test(previewHtml)) {
    previewHtml = previewHtml.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}">`);
  }
  iframe.srcdoc = previewHtml;
}

/**
 * Render All Inspector Views
 */
function renderAll(responseTimeMs) {
  document.getElementById('printTargetUrl').textContent = `Target: ${state.currentUrl}`;
  document.getElementById('printDate').textContent = `Date: ${new Date().toLocaleString()}`;

  // Metrics
  const sizeKb = (new Blob([state.rawHtml]).size / 1024).toFixed(1);
  const lines = state.rawHtml.split('\n').length;
  document.getElementById('statHtmlSize').textContent = `${sizeKb} KB / ${lines} L`;
  document.getElementById('statBtnCount').textContent = `${state.buttonsList.length} Buttons`;
  document.getElementById('statRequestCount').textContent = `${state.requestsList.length} Endpoints`;
  document.getElementById('statResourcesCount').textContent = `${state.cssLinks.length} CSS / ${state.jsScripts.length} JS`;
  document.getElementById('statResponseTime').textContent = `200 OK (${responseTimeMs}ms)`;

  // 1. Buttons Inspector
  renderButtonsList(state.buttonsList);
  if (state.buttonsList.length > 0) {
    inspectButton(0); // Auto-inspect first button
  }

  // 2. GET / POST Requests Tab
  renderRequestsTab();

  // 3. Code Viewer
  document.getElementById('htmlStatsDesc').textContent = `${lines} Lines, ${state.rawHtml.length} Characters, ${sizeKb} KB`;
  renderCode(state.rawHtml);

  // 4. CSS & JS Lists
  renderResourceLists();

  // 5. Meta & Headings
  renderMetaAndHeadings();
}

/**
 * Render Interactive Buttons List
 */
function renderButtonsList(list) {
  const container = document.getElementById('buttonsListContainer');
  container.innerHTML = '';
  document.getElementById('buttonsFoundBadge').textContent = `${list.length} Found`;

  if (list.length === 0) {
    container.innerHTML = '<p class="pane-desc">Page par koi buttons nahi mile.</p>';
    return;
  }

  list.forEach(btn => {
    const item = document.createElement('div');
    item.className = `interactive-btn-item ${state.selectedButtonIndex === btn.id ? 'active-inspected' : ''}`;
    item.id = `btn-item-${btn.id}`;
    item.innerHTML = `
      <div class="btn-item-left">
        <span class="btn-tag-pill">&lt;${btn.tagName.toLowerCase()}&gt;</span>
        <span class="btn-text-content">${escapeHtml(btn.text)}</span>
      </div>
      <div>
        <span class="badge ${btn.formMethod === 'POST' ? 'badge-post' : 'badge-get'}">${btn.formMethod}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      inspectButton(btn.id);
    });

    container.appendChild(item);
  });
}

function filterButtons(query) {
  if (!query) {
    renderButtonsList(state.buttonsList);
    return;
  }
  const filtered = state.buttonsList.filter(b => 
    b.text.toLowerCase().includes(query) || 
    b.tagName.toLowerCase().includes(query) || 
    b.outerHtml.toLowerCase().includes(query)
  );
  renderButtonsList(filtered);
}

/**
 * Click Button to Inspect its Code & GET/POST Details
 */
function inspectButton(id) {
  const btn = state.buttonsList.find(b => b.id === id);
  if (!btn) return;
  state.selectedButtonIndex = id;

  // Highlight in list
  document.querySelectorAll('.interactive-btn-item').forEach(el => el.classList.remove('active-inspected'));
  const activeEl = document.getElementById(`btn-item-${id}`);
  if (activeEl) activeEl.classList.add('active-inspected');

  // Display detail card
  document.getElementById('buttonDetailPlaceholder').style.display = 'none';
  const detailCard = document.getElementById('buttonDetailCard');
  detailCard.style.display = 'block';

  document.getElementById('detElementType').textContent = btn.tagName;
  document.getElementById('detElementText').textContent = btn.text || '(Unnamed Element)';

  // Method & Action
  const methodBadge = document.getElementById('detMethodBadge');
  methodBadge.textContent = btn.formMethod;
  methodBadge.className = `badge badge-method ${btn.formMethod === 'POST' ? 'badge-post' : 'badge-get'}`;
  document.getElementById('detActionUrl').textContent = `Target Action: ${btn.formAction}`;

  // Outer HTML Code
  document.getElementById('detOuterHtmlCode').textContent = btn.outerHtml;

  // Attributes Table
  const attrTbody = document.querySelector('#detAttributesTable tbody');
  attrTbody.innerHTML = '';
  btn.attrs.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><code>${escapeHtml(a.name)}</code></td><td><code>${escapeHtml(a.value)}</code></td>`;
    attrTbody.appendChild(tr);
  });

  // Form Inputs / Payload
  const formSection = document.getElementById('detFormInputsSection');
  const inputsTbody = document.querySelector('#detFormInputsTable tbody');
  if (btn.formInputs.length > 0) {
    formSection.style.display = 'block';
    inputsTbody.innerHTML = '';
    btn.formInputs.forEach(inp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>${escapeHtml(inp.name)}</b></td><td>${escapeHtml(inp.type)}</td><td>${escapeHtml(inp.value)}</td>`;
      inputsTbody.appendChild(tr);
    });
  } else {
    formSection.style.display = 'none';
  }
}

/**
 * Render GET / POST Requests Tab
 */
function renderRequestsTab() {
  const container = document.getElementById('requestsContainer');
  container.innerHTML = '';

  if (state.requestsList.length === 0) {
    container.innerHTML = '<p class="pane-desc">Koi Form ya API Endpoints nahi mile.</p>';
    return;
  }

  state.requestsList.forEach((req, idx) => {
    const card = document.createElement('div');
    card.className = 'request-card';
    card.innerHTML = `
      <div class="req-card-header">
        <div class="req-header-left">
          <span class="badge ${req.method === 'POST' ? 'badge-post' : 'badge-get'}">${req.method}</span>
          <strong style="font-family: monospace;">${escapeHtml(req.endpoint)}</strong>
        </div>
        <div>
          <span class="badge badge-primary">${req.type}</span>
        </div>
      </div>
      <div class="req-card-body">
        ${req.inputs.length > 0 ? `
          <h4 style="font-size: 0.85rem; margin-bottom: 0.5rem;">Form Fields & Parameters (${req.inputs.length}):</h4>
          <table class="data-table" style="margin-bottom: 0.75rem;">
            <thead><tr><th>Field Name</th><th>Input Type</th><th>Default Value</th></tr></thead>
            <tbody>
              ${req.inputs.map(i => `<tr><td><code>${escapeHtml(i.name)}</code></td><td>${escapeHtml(i.type)}</td><td>${escapeHtml(i.value)}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : ''}
        <h4 style="font-size: 0.85rem; margin-bottom: 0.5rem;">Source Code Snippet:</h4>
        <div class="code-snippet-box">
          <pre><code>${escapeHtml(req.rawHtml)}</code></pre>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderCode(code) {
  const lines = code.split('\n');
  document.getElementById('htmlLineNumbers').innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  let escaped = escapeHtml(code);
  escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="syn-comment">$1</span>');
  escaped = escaped.replace(/(&lt;\/?)([a-zA-Z0-9\-]+)([\s\S]*?)(&gt;)/g, (_, p1, tag, attrs, p4) => {
    const a = attrs.replace(/([a-zA-Z0-9\-]+)(=)(&quot;.*?&quot;|&#39;.*?&#39;|[^\s&>]+)/g, '<span class="syn-attr">$1</span>$2<span class="syn-val">$3</span>');
    return `${p1}<span class="syn-tag">${tag}</span>${a}${p4}`;
  });
  document.querySelector('#htmlCodeDisplay code').innerHTML = escaped;
}

function handleCodeSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    document.getElementById('searchMatchesCount').textContent = '';
    return renderCode(state.rawHtml);
  }
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
  let count = 0;
  const res = escapeHtml(state.rawHtml).replace(regex, (m) => { count++; return `<span class="syn-highlight">${m}</span>`; });
  document.getElementById('searchMatchesCount').textContent = `${count} matches`;
  document.querySelector('#htmlCodeDisplay code').innerHTML = res;
}

function renderResourceLists() {
  document.getElementById('cssListContainer').innerHTML = state.cssLinks.map((url, i) => `
    <div class="resource-item">
      <span>Stylesheet #${i+1}: <code>${escapeHtml(url)}</code></span>
      <a href="${escapeHtml(url)}" target="_blank" class="btn btn-sm btn-outline">Open ↗</a>
    </div>
  `).join('') || '<p class="pane-desc">No external stylesheets found.</p>';

  document.getElementById('jsListContainer').innerHTML = state.jsScripts.map((url, i) => `
    <div class="resource-item">
      <span>Script #${i+1}: <code>${escapeHtml(url)}</code></span>
      <a href="${escapeHtml(url)}" target="_blank" class="btn btn-sm btn-outline">Open ↗</a>
    </div>
  `).join('') || '<p class="pane-desc">No external scripts found.</p>';
}

function renderMetaAndHeadings() {
  document.getElementById('metaCountBadge').textContent = state.metaTags.length;
  document.querySelector('#metaTable tbody').innerHTML = state.metaTags.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.content)}</td></tr>`).join('');
  document.getElementById('headingsCountBadge').textContent = state.headings.length;
  document.getElementById('headingsList').innerHTML = state.headings.map(h => `<div style="padding: 0.25rem 0;"><b>${h.tag}:</b> ${escapeHtml(h.text)}</div>`).join('');
}

function downloadSource() {
  const blob = new Blob([state.rawHtml], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `source_${new URL(state.currentUrl).hostname}.html`;
  a.click();
}

function showAlert(msg, type) {
  const el = document.getElementById('statusAlert');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.style.display = 'block';
}

function hideAlert() {
  document.getElementById('statusAlert').style.display = 'none';
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
