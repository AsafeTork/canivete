// canivete — Chrome headless próprio via CDP (zero deps, WebSocket nativo)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UA } from "./ctx.mjs";

const CHROME_BIN = process.env.CANIVETE_CHROME_BIN || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p)) || "google-chrome";
const CDP_PORT = Number(process.env.CANIVETE_CDP_PORT || process.env.OPENCODE_CDP_PORT) || 19322;
const CHROME_PROFILE = process.env.CANIVETE_CHROME_PROFILE || join(tmpdir(), "canivete-chrome-profile");
let chromeChild = null;

async function cdpVersion() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: ac.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function ensureBrowser() {
  if (await cdpVersion()) return;
  if (chromeChild && !chromeChild.killed) {
    try { process.kill(chromeChild.pid, 0); } catch { chromeChild = null; }
    if (chromeChild) { await new Promise((r) => setTimeout(r, 1500)); if (await cdpVersion()) return; }
  }
  try { mkdirSync(CHROME_PROFILE, { recursive: true }); } catch {}
  chromeChild = spawn(CHROME_BIN, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`, "about:blank",
  ], { stdio: "ignore", detached: true });
  chromeChild.unref?.();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpVersion()) return;
  }
  throw new Error(`chrome não respondeu na porta ${CDP_PORT} (${CHROME_BIN})`);
}

async function cdpTargets() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!r.ok) throw new Error(`CDP /json/list HTTP ${r.status}`);
  return await r.json();
}

async function cdpNewPage(url = "about:blank") {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${new URLSearchParams({ url })}`, { method: "PUT" });
  if (!r.ok) throw new Error(`CDP new page HTTP ${r.status}`);
  return await r.json();
}

function cdpSend(ws, id, method, params = {}, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeout);
    const onMsg = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.id === id) { clearTimeout(timer); ws.removeEventListener("message", onMsg); m.error ? reject(new Error(`CDP ${method}: ${m.error.message || JSON.stringify(m.error)}`)) : resolve(m.result || {}); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Abre WS na aba ativa (ou cria uma), habilita Page/Runtime e executa fn({send, target}).

async function withCdp(fn, { url } = {}) {
  await ensureBrowser();
  let targets = await cdpTargets();
  let page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (url && page) {
    // reutiliza a aba; navegação é feita pelo caller via Page.navigate
  }
  if (!page) page = await cdpNewPage(url || "about:blank");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("WS CDP falhou")); setTimeout(() => rej(new Error("WS CDP timeout")), 10000); });
  let seq = 0;
  const send = (m, p, t) => cdpSend(ws, ++seq, m, p, t);
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    return await fn({ send, target: page });
  } finally { try { ws.close(); } catch {} }
}

const PAGE_SNAPSHOT_JS = `(() => {
  const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[onclick]')].slice(0,120);
  const path = (el) => {
    if (el.id) return '#' + el.id;
    const parts = [];
    let n = el;
    for (let d = 0; d < 4 && n && n !== document.body; d++) {
      let s = n.tagName.toLowerCase();
      if (n.className && typeof n.className === 'string') { const c = n.className.trim().split(/\\s+/)[0]; if (c) s += '.' + c.replace(/[^a-zA-Z0-9_-]/g,''); }
      const sib = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n)+1) + ')';
      parts.unshift(s); n = n.parentElement;
    }
    return parts.join(' > ');
  };
  return els.map((el, i) => ({
    ref: i,
    tag: el.tagName.toLowerCase(),
    type: el.type || el.getAttribute('role') || '',
    text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0,100),
    selector: path(el),
  }));
})()`;

const RESOLVE_JS = (sel) => `(() => {
  const sel = ${JSON.stringify(sel)};
  if (sel.startsWith('text=')) {
    const t = sel.slice(5).toLowerCase();
    const all = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')];
    const el = all.find(e => (e.innerText || e.value || '').toLowerCase().includes(t));
    return el ? 'FOUND:' + (el.id ? '#'+el.id : el.tagName.toLowerCase()) : 'NOTFOUND';
  }
  const el = document.querySelector(sel);
  if (!el) return 'NOTFOUND';
  el.scrollIntoView({block:'center'});
  return 'FOUND:' + sel;
})()`;

async function cdpGoto(send, url, waitMs = 4000) {
  await send("Page.navigate", { url });
  const wait = Math.min(Math.max(Number(waitMs) || 4000, 500), 25000);
  try {
    await new Promise((resolve) => {
      const done = () => resolve();
      const t = setTimeout(done, wait);
      // aguarda load via evento avaliado por polling simples
      (async () => {
        for (let i = 0; i < wait / 400; i++) {
          await new Promise((r) => setTimeout(r, 400));
          try {
            const s = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, 5000);
            if (s.result?.value === "complete") { clearTimeout(t); resolve(); break; }
          } catch {}
        }
      })();
    });
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
}

async function cdpState(send) {
  const r = await send("Runtime.evaluate", {
    expression: `({title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0,6000) : '', links: [...document.querySelectorAll('a[href]')].slice(0,40).map(a=>({text: a.innerText.replace(/\\s+/g,' ').trim().slice(0,80), href: a.href}))})`,
    returnByValue: true,
  }, 15000);
  return r.result?.value || {};
}

function shotFile() { return join(tmpdir(), `opencode-shot-${Date.now().toString(36)}.png`); }

export { ensureBrowser, withCdp, cdpGoto, cdpState, shotFile, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN, CDP_PORT };
