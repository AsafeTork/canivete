// canivete — tools do Chrome headless (browser_*)
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { reg, devOut, trimOut, fpath, humanSize, exec } from "./ctx.mjs";
import { probeMeta, mainContent } from "./web.mjs";
import { withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, cdpSetTextFirst, cdpSetFullRender, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN as CHROME_BIN_CDP } from "./cdp.mjs";

// --- Otimizações locais (sem tocar cdp.mjs) ---
// 1) CHROME_BIN autodetect: env > candidatos comuns > export do cdp.mjs > PATH.
const CHROME_BIN = (() => {
  const fromEnv = (process.env.CANIVETE_CHROME_BIN || process.env.CHROME_BIN || "").trim();
  if (fromEnv) return fromEnv;
  for (const p of [
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return CHROME_BIN_CDP || "google-chrome";
})();

// 2) Timeouts configuráveis (evita 40-60s fixos).
const BROWSER_TIMEOUT_MS = Number(process.env.CANIVETE_BROWSER_TIMEOUT_MS) || 40000;
const BROWSER_PDF_TIMEOUT_MS =
  Number(process.env.CANIVETE_BROWSER_PDF_TIMEOUT_MS) ||
  Number(process.env.CANIVETE_BROWSER_TIMEOUT_MS) || 60000;

// 3) Guarda SSRF: só http(s); bloqueia file:// e hosts privados/intranet.
//    Loopback (localhost/127.0.0.1/::1) permitido p/ dev (ex.: http://localhost:5173);
//    demais privados exigem CANIVETE_BROWSER_ALLOW_PRIVATE=1.
const ALLOW_PRIVATE = /^(1|true|yes)$/i.test(String(process.env.CANIVETE_BROWSER_ALLOW_PRIVATE || ""));
function isPrivateIPv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}
function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost") return false; // loopback p/ dev
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "::1" || bare === "::") return true;
  if (isPrivateIPv4(bare)) return true;
  if (/^(fc|fd)[0-9a-f]{0,4}:/i.test(bare) || /^fe80:/i.test(bare)) return true;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
  return false;
}
function assertSafeUrl(raw) {
  if (!raw || typeof raw !== "string") throw new Error("URL inválida/bloqueada: use http(s):// pública (file:// e intranet bloqueados p/ SSRF)");
  let u;
  try { u = new URL(raw); } catch { throw new Error(`URL inválida/bloqueada: ${raw} — use http(s):// pública (file:// e intranet bloqueados p/ SSRF)`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`SSRF bloqueado: esquema ${u.protocol} não permitido (${raw}) — use http(s)://; file://, data:, javascript: bloqueados`);
  if (u.username || u.password) throw new Error(`SSRF bloqueado: credenciais na URL não permitidas (${u.hostname}) — remova userinfo`);
  const host = u.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (isLoopback) return u; // dev local permitido
  if (!ALLOW_PRIVATE && isBlockedHost(host)) throw new Error(`SSRF bloqueado: host privado/intranet (${u.hostname}) — use URL pública ou defina CANIVETE_BROWSER_ALLOW_PRIVATE=1 p/ permitir intranet`);
  return u;
}

// 4) Retry 1x em falha CDP transitória, com erro acionável.
function isRetryableCdpError(e) {
  return /timeout|closed|econn|epipe|socket|ws\b|target|session|cdp|enable|navigate/i.test(String(e?.message || ""));
}
function actionableCdpError(e, label, retried) {
  const hint = "dica acionável: confira CHROME_BIN (CANIVETE_CHROME_BIN/CHROME_BIN), porta CDP livre e tente com waitMs menor; se persistir, rode n_browser_snapshot p/ validar a aba";
  const err = new Error(`${label} falhou${retried ? " (após 1 retry)" : ""}: ${e?.message || e} — ${hint}`);
  err.cause = e;
  return err;
}
async function withCdpRetry(fn, opts, label = "CDP") {
  try {
    return await withCdp(fn, opts);
  } catch (e1) {
    if (!isRetryableCdpError(e1)) throw e1;
    try {
      return await withCdp(fn, opts);
    } catch (e2) {
      throw actionableCdpError(e2, label, true);
    }
  }
}

reg("n_browser_navigate", {
  description: "Navega com Chrome headless (renderiza JS/SPA) e retorna título+texto+links. cookies:true inclui cookies da página. Ex: {url:\"http://localhost:5173\", waitMs:5000, cookies:true}.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, waitMs: { type: "number", default: 4000 }, cookies: { type: "boolean", description: "Retorna cookies da página via CDP" } }, required: ["url"] },
  run: async ({ url, waitMs, cookies }) => {
    const t0 = Date.now();
    if (!url) return devOut({ status: "error", summary: "url obrigatória — chame n_browser_navigate com {url:\"https://exemplo.com\", waitMs:5000}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    try { assertSafeUrl(url); } catch (e) { return devOut({ status: "error", summary: e.message, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    try {
      const state = await withCdpRetry(async ({ send }) => { await cdpSetTextFirst(send); await cdpGoto(send, url, waitMs); const st = await cdpState(send); if (cookies) { try { st.cookies = await cdpCookies(send); } catch (e) { st.cookiesError = e.message; } } return st; }, { url }, "n_browser_navigate");
      const ms = Date.now() - t0;
      return devOut({ summary: `${state.title || "(sem título)"} — ${state.url || url} (${(state.text || "").length} chars)`, data: { ...state, text: trimOut(state.text || "", 6000), ms }, telemetry: { execution_time_ms: ms }, next: [{ tool: "n_browser_snapshot", reason: "Mapear elementos clicáveis" }, { tool: "n_browser_screenshot", reason: "Evidência visual" }], refs: [] });
    } catch (e) {
      // fallback: dump-dom single-shot (sem CDP)
      const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--virtual-time-budget=5000", "--dump-dom", url], { timeout: BROWSER_TIMEOUT_MS });
      if (!r.so) return devOut({ status: "error", summary: `falha: ${e.message} ${(r.se || "").slice(0, 300)}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const core = mainContent(r.so);
      const text = core.replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1).join("\n").slice(0, 6000);
      const msFb = Date.now() - t0;
      return devOut({ summary: `${probeMeta(r.so)} — ${url} (fallback dump-dom)`, data: { title: probeMeta(r.so), url, text, ms: msFb }, telemetry: { execution_time_ms: msFb } });
    }
  },
});

// --- n_browser_snapshot: rank por importância (lógica pura, sem Chrome) ---
// Score = viewport (acima-da-dobra) + área clicável + tem nome + papel interativo-real.
// Descarte vai p/ `omitted` com motivo (display:none, oculto, zero-area, genérico-sem-nome).
// REGRA DURA: sem nerf — max default 60 / cap 120 intactos; rank só reordena + filtra junk.
const SNAPSHOT_GEOM_JS = `(() => {
  const SEL = 'a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="button"],[role="link"],[role="heading"],[role="checkbox"],[role="radio"],[role="switch"],[onclick]';
  const els = [...document.querySelectorAll(SEL)].slice(0,120);
  const vh = window.innerHeight || 800;
  return els.map((el) => {
    try {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const w = Math.max(0, r.width || 0), h = Math.max(0, r.height || 0);
      return { display: cs.display || "", visibility: cs.visibility || "", opacity: cs.opacity ?? "1", w: Math.round(w*10)/10, h: Math.round(h*10)/10, top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.bottom > 0 && r.top < vh, area: Math.round(w*h) };
    } catch (e) { return {}; }
  });
})()`;
const SNAPSHOT_REAL_TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const SNAPSHOT_REAL_ROLES = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "searchbox"]);
export function snapshotScore(el = {}, g = {}) {
  const tag = String(el.tag || "").toLowerCase();
  const role = String(el.role || "").toLowerCase();
  const name = String(el.name ?? "").trim();
  const text = String(el.text ?? "").trim();
  const state = String(el.state || "");
  const measured = g && typeof g === "object" && ("display" in g || "w" in g || "area" in g);
  if (measured) {
    if (String(g.display || "").toLowerCase() === "none") return { score: -Infinity, omit: "display:none" };
    const vis = String(g.visibility || "").toLowerCase();
    if (vis === "hidden" || vis === "collapse") return { score: -Infinity, omit: `hidden:${vis}` };
    const op = Number.parseFloat(g.opacity);
    if (String(g.opacity ?? "") !== "" && !Number.isNaN(op) && op <= 0) return { score: -Infinity, omit: "hidden:opacity:0" };
    const w = Number(g.w), h = Number(g.h), area = Number(g.area ?? (Number(g.w) * Number(g.h)));
    if ((Number.isFinite(w) && Number.isFinite(h) && (w <= 1 || h <= 1)) || (Number.isFinite(area) && area <= 1)) return { score: -Infinity, omit: "zero-area" };
  }
  const isReal = SNAPSHOT_REAL_TAGS.has(tag) || SNAPSHOT_REAL_ROLES.has(role);
  const isHeading = /^h[1-6]$/.test(tag) || role === "heading";
  const hasName = name.length > 0;
  const hasText = text.length > 0;
  if (!isReal && !hasName && !hasText) return { score: -Infinity, omit: "unnamed-generic" };
  let score = 0;
  if (g.inViewport === true) score += 50;
  else if (g.inViewport === false) score -= 20;
  if (measured) {
    const area = Number(g.area ?? (Number(g.w) * Number(g.h))) || 0;
    if (area >= 20000) score += 20;
    else if (area >= 5000) score += 15;
    else if (area >= 1000) score += 12;
    else if (area >= 200) score += 8;
    else if (area >= 16) score += 4;
    else score -= 5;
  }
  if (hasName) score += 30;
  else if (hasText) score += 12;
  else if (isReal) score -= 10;
  if (isReal) score += 40;
  else if (isHeading) score -= 10;
  else score += 5;
  if (/(^|\s)disabled(\s|$)/.test(state)) score -= 30;
  return { score, omit: null };
}
export function rankSnapshotElements(els = [], geoms = []) {
  const ranked = [];
  const omitted = [];
  (els || []).forEach((el, i) => {
    const g = (geoms || [])[i] || {};
    const { score, omit } = snapshotScore(el, g);
    if (omit) omitted.push({ ref: el?.ref ?? i, tag: el?.tag || "", reason: omit });
    else ranked.push({ el, score, idx: i, inVp: g.inViewport === true });
  });
  ranked.sort((a, b) => (b.score - a.score) || (Number(b.inVp) - Number(a.inVp)) || (a.idx - b.idx));
  return { ranked: ranked.map((s) => ({ ...s.el, score: s.score })), omitted };
}

reg("n_browser_snapshot", {
  description: "Lista elementos interativos da página (ref, tag, texto, selector) para usar em n_browser_act. compact:true retorna só ref|tag|texto sem selector (~60% menos tokens). Ex: {compact:true}.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, max: { type: "number", default: 60 }, compact: { type: "boolean", default: false, description: "Compacto: só ref|tag|texto, sem selector (~60% menos tokens)" } }, required: [] },
  run: async ({ url, max, compact }) => {
    const t0 = Date.now();
    if (url) { try { assertSafeUrl(url); } catch (e) { return devOut({ status: "error", summary: e.message, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); } }
    try {
      const { base, geoms } = await withCdpRetry(async ({ send }) => {
        await cdpSetTextFirst(send);
        if (url) await cdpGoto(send, url);
        const r = await send("Runtime.evaluate", { expression: PAGE_SNAPSHOT_JS, returnByValue: true }, 15000);
        const base = r.result?.value || [];
        let geoms = [];
        try {
          const g = await send("Runtime.evaluate", { expression: SNAPSHOT_GEOM_JS, returnByValue: true }, 15000);
          if (Array.isArray(g.result?.value)) geoms = g.result.value;
        } catch {}
        return { base, geoms };
      }, { url }, "n_browser_snapshot");
      const { ranked, omitted } = rankSnapshotElements(base, geoms);
      const list = ranked.slice(0, Math.min(Number(max) || 60, 120));
      const omittedOut = { count: omitted.length, items: omitted.slice(0, 30) };
      const isCompact = compact === true;
      const elements = isCompact ? list.map((e) => ({ ref: e.ref, tag: e.tag, text: e.text })) : list;
      const txt = isCompact
        ? list.map((e) => `[${e.ref}] <${e.tag}> ${e.text || "(sem texto)"}`).join("\n") || "(nenhum elemento interativo)"
        : list.map((e) => `[${e.ref}] <${e.tag}> ${e.text || "(sem texto)"} :: ${e.selector}`).join("\n") || "(nenhum elemento interativo)";
      if (list.length === 0) return devOut({ summary: `0 elemento(s) interativo(s) — (nenhum elemento interativo)${omitted.length ? ` — ${omitted.length} junk omitido(s)` : ""}`, data: { count: 0, elements, compact: isCompact, empty: true, ranked: true, omitted: omittedOut, recovery: "wait/reload ou n_browser_navigate {url} ou {max:120}" }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [] });
      return devOut({ summary: `${list.length} elemento(s) interativo(s)${isCompact ? " (compact)" : ""}${omitted.length ? ` — ${omitted.length} junk omitido(s)` : ""}`, data: { count: list.length, elements, compact: isCompact, ranked: true, omitted: omittedOut }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_browser_act", reason: "Clicar/preencher com selector do snapshot" }] });
    } catch (e) { const msg = /dica acionável/.test(String(e?.message || "")) ? e.message : `${e.message} — dica acionável: confira CHROME_BIN/porta CDP e tente de novo`; return devOut({ status: "error", summary: `snapshot falhou: ${msg}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); }
  },
});

reg("n_browser_act", {
  description: "Interage via CDP: goto/back/forward/reload/click/fill/press/scroll/wait/wait_selector/evaluate. console:true anexa últimos 30 logs (só pós-enable, ~1.5s). Ex: {action:\"wait_selector\", selector:\"#app\"}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "press", "scroll", "wait", "wait_selector", "evaluate"] },
      url: { type: "string" }, selector: { type: "string", description: "CSS (wait_selector só CSS)" }, text: { type: "string" },
      key: { type: "string", description: "Enter|Tab|Escape|ArrowDown..." }, js: { type: "string" },
      ms: { type: "number" }, direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      console: { type: "boolean", description: "Anexa últimos 30 logs console via CDP Log/Runtime (só pós-enable)" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    const VALID_ACTS = ["goto", "back", "forward", "reload", "click", "fill", "press", "scroll", "wait", "wait_selector", "evaluate"];
    if (!a?.action) return devOut({ status: "error", summary: `action obrigatória — ações válidas: ${VALID_ACTS.join(", ")}. Ex: {action:"goto", url:"https://...", waitMs:5000}`, data: { action: a?.action ?? null }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!VALID_ACTS.includes(a.action)) return devOut({ status: "error", summary: `action desconhecida: ${a.action} — ações válidas: ${VALID_ACTS.join(", ")}. Ex: {action:"goto", url:"https://...", waitMs:5000}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "goto" && a.url) { try { assertSafeUrl(a.url); } catch (e) { return devOut({ status: "error", summary: e.message, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } }); } }
    try {
      let beforeClickUrl = null; // URL pré-click já coletada (sem roundtrip extra)
      const result = await withCdpRetry(async ({ send, ws }) => {
        await cdpSetTextFirst(send);
        const withConsole = async (base) => {
          if (!a.console) return base;
          try {
            const logs = await cdpDrainConsole(send, ws, { timeoutMs: 1500, limit: 30 });
            return { ...base, console: logs };
          } catch (e) { return { ...base, console: [], consoleError: `console indisponível: ${e.message} (limite: só logs pós Log/Runtime.enable)` }; }
        };
        const act = a.action;
        if (act === "wait_selector") {
          if (!a.selector) throw new Error("selector obrigatório p/ wait_selector (CSS)");
          const deadline = Date.now() + 15000;
          let found = false;
          while (Date.now() < deadline) {
            const r = await send("Runtime.evaluate", { expression: `!!document.querySelector(${JSON.stringify(a.selector)})`, returnByValue: true }, 5000);
            if (r.result?.value) { found = true; break; }
            await new Promise((r2) => setTimeout(r2, 500));
          }
          if (!found) throw new Error(`timeout 15s esperando: ${a.selector}`);
          return await withConsole({ ...(await cdpState(send)), waited_selector: a.selector });
        }
        if (act === "goto") { if (!a.url) throw new Error("url obrigatória p/ goto"); await cdpGoto(send, a.url, a.waitMs); return await withConsole(await cdpState(send)); }
        if (act === "back" || act === "forward") { const hist = await send("Page.getNavigationHistory"); const i = hist.currentIndex + (act === "back" ? -1 : 1); const e = hist.entries?.[i]; if (!e) throw new Error(`sem histórico p/ ${act}`); await send("Page.navigateToHistoryEntry", { entryId: e.id }); await new Promise((r) => setTimeout(r, 1500)); return await withConsole(await cdpState(send)); }
        if (act === "reload") { await send("Page.reload"); await new Promise((r) => setTimeout(r, 2000)); return await withConsole(await cdpState(send)); }
        if (act === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 2000, 15000))); return await withConsole(await cdpState(send)); }
        if (act === "evaluate") {
          if (!a.js) throw new Error("js obrigatório p/ evaluate");
          const r = await send("Runtime.evaluate", { expression: a.js, returnByValue: true, awaitPromise: true }, 15000);
          const v = r.result?.value ?? r.result?.description;
          if (v == null) return await withConsole({ value: v ?? null, empty: true, note: "seletor não casou ou JS sem return — confira n_browser_snapshot", type: r.result?.type });
          return await withConsole({ value: v, type: r.result?.type });
        }
        if (act === "press") {
          const keyMap = { Enter: { key: "Enter", code: "Enter", winCode: 13 }, Tab: { key: "Tab", code: "Tab", winCode: 9 }, Escape: { key: "Escape", code: "Escape", winCode: 27 } };
          const k = keyMap[a.key] || { key: a.key || "Enter", code: a.key || "Enter", winCode: 13 };
          for (const t of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t === "rawKeyDown" ? "rawKeyDown" : "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.winCode, nativeVirtualKeyCode: k.winCode });
          await new Promise((r) => setTimeout(r, 800));
          return await withConsole(await cdpState(send));
        }
        if (act === "scroll") {
          const dir = a.direction || "down";
          const expr = a.selector
            ? `document.querySelector(${JSON.stringify(a.selector)})?.scrollIntoView({block:'center'})`
            : dir === "top" ? "scrollTo(0,0)" : dir === "bottom" ? "scrollTo(0,document.body.scrollHeight)" : dir === "up" ? "scrollBy(0,-innerHeight*0.8)" : "scrollBy(0,innerHeight*0.8)";
          await send("Runtime.evaluate", { expression: expr, returnByValue: true });
          await new Promise((r) => setTimeout(r, 600));
          return await withConsole(await cdpState(send));
        }
        if (act === "click") {
          if (!a.selector || !String(a.selector).trim()) throw new Error("selector vazio p/ click (CSS ou text=... obrigatório) — rode n_browser_snapshot p/ obter selector válido");
          let beforeUrl = "";
          try {
            const b = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
            beforeUrl = b.result?.value || "";
          } catch {}
          beforeClickUrl = beforeUrl || null;
          const chk = await send("Runtime.evaluate", { expression: RESOLVE_JS(a.selector), returnByValue: true });
          if (String(chk.result?.value).startsWith("NOTFOUND")) throw new Error(`elemento não encontrado: ${a.selector} — rode n_browser_snapshot`);
          await send("Runtime.evaluate", { expression: `({
            s: ${JSON.stringify(a.selector)},
            el: null,
            find() { const s=this.s; if (s.startsWith('text=')) { const t=s.slice(5).toLowerCase(); return [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].find(e=>(e.innerText||e.value||'').toLowerCase().includes(t)); } return document.querySelector(s); }
          }.find()?.click(), 'clicked')`, returnByValue: true });
          // Aguarda navegação eventual: poll url até 3s, sai cedo se mudou (sem sleep cego).
          if (beforeUrl) {
            const tEnd = Date.now() + 3000;
            while (Date.now() < tEnd) {
              await new Promise((r) => setTimeout(r, 150));
              try {
                const cur = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
                if (cur.result?.value && cur.result.value !== beforeUrl) break;
              } catch {}
            }
          }
          return await withConsole(await cdpState(send));
        }
        if (act === "fill") {
          if (!a.selector || !String(a.selector).trim()) throw new Error("selector vazio p/ fill (CSS obrigatório) — rode n_browser_snapshot p/ obter selector válido");
          if (a.text === undefined) throw new Error("text obrigatório p/ fill");
          await send("Runtime.evaluate", { expression: `(() => { const s=${JSON.stringify(a.selector)}; const el = s.startsWith('text=') ? null : document.querySelector(s); if(!el) return 'NOTFOUND'; el.focus(); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); return 'FOCUSED:'+el.tagName; })()`, returnByValue: true });
          await send("Input.insertText", { text: String(a.text) });
          await send("Runtime.evaluate", { expression: `(() => { const a=document.activeElement; if(a){ a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true})); } return 'ok'; })()`, returnByValue: true });
          if (a.submit) {
            for (const t of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t === "rawKeyDown" ? "rawKeyDown" : "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
            await new Promise((r) => setTimeout(r, 1500));
          }
          return await withConsole(await cdpState(send));
        }
        throw new Error(`action desconhecida: ${act} — ações válidas: goto, back, forward, reload, click, fill, press, scroll, wait, wait_selector, evaluate. Ex: {action:"goto", url:"https://...", waitMs:5000}`);
      }, { url: a.action === "goto" ? a.url : undefined }, "n_browser_act");
      // state-diff barato (sem round-trip extra, mesmo padrão do n_ubrowser_act): antes = intenção (a.url p/ goto) ou URL pré-click já coletada; depois = cdpState já coletado (result.url/title, fallback p/ a.url).
      const afterUrl = result?.url ?? a.url ?? null;
      const afterTitle = result?.title ?? null;
      const beforeUrl = (a.action === "goto" && a.url) ? String(a.url) : (beforeClickUrl || null);
      const urlChanged = !!beforeUrl && !!afterUrl && beforeUrl !== afterUrl;
      const navNewDoc = ["goto", "back", "forward", "reload"].includes(a.action);
      const titleChanged = !!afterTitle && (urlChanged || navNewDoc);
      const afterLabel = String(afterTitle ? `${afterTitle} — ${afterUrl || ""}` : (afterUrl || `${a.action} ok`)).slice(0, 120);
      const diff = urlChanged ? `${beforeUrl}→${afterUrl}` : (navNewDoc && afterUrl ? `navegou para ${afterLabel}` : `mesma página: ${afterLabel}`);
      const summary = `${a.action} ok — ${diff}`;
      const msAct = Date.now() - t0;
      return devOut({ summary, data: { action: a.action, ...result, text: result?.text ? trimOut(result.text, 3000) : result?.value ?? "", after: { url: afterUrl, title: afterTitle }, changed: { url: urlChanged, title: titleChanged }, ms: msAct }, telemetry: { execution_time_ms: msAct }, next: [{ tool: "n_browser_screenshot", reason: "Confirmar visualmente a ação" }] });
    } catch (e) { const msErr = Date.now() - t0; const msg = /dica acionável/.test(String(e?.message || "")) ? e.message : `${e.message} — dica acionável: rode n_browser_snapshot p/ validar seletores e confira CHROME_BIN/porta CDP`; return devOut({ status: "error", summary: `act falhou: ${msg}`, data: { action: a.action, ms: msErr }, telemetry: { execution_time_ms: msErr } }); }
  },
});

reg("n_browser_screenshot", {
  description: "Captura PNG da página ou só de um elemento (selector CSS via clip). Ex: {url:\"http://localhost:5173\", selector:\"#app\"}. Sem url = aba atual.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, width: { type: "number", default: 1280 }, height: { type: "number", default: 800 }, fullPage: { type: "boolean", default: false }, selector: { type: "string", description: "CSS do elemento p/ screenshot recortado (clip via DOM.getBoxModel)" }, scale: { type: "number", enum: [0.5, 1], default: 1, description: "deviceScaleFactor: 0.5 = metade dos bytes" } }, required: [] },
  run: async ({ url, width, height, fullPage, selector, scale }) => {
    const t0 = Date.now();
    // scale opcional: undefined => 1; 0.5 => metade dos bytes (screenshots pesados).
    const w = Math.min(Math.max(Number(width) || 1280, 320), 2560);
    const h = Math.min(Math.max(Number(height) || 800, 320), 2560);
    const dsf = Number(scale) === 0.5 ? 0.5 : 1;
    if (selector && fullPage) return devOut({ status: "error", summary: "use selector ou fullPage, não ambos — passe só um: {selector:\"#app\"} OU {fullPage:true}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (url) { try { assertSafeUrl(url); } catch (e) { return devOut({ status: "error", summary: e.message, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); } }
    try {
      const { b64, state } = await withCdpRetry(async ({ send }) => {
        await cdpSetFullRender(send);
        if (url) await cdpGoto(send, url);
        await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
        if (selector) {
          const clip = await cdpElementClip(send, selector);
          const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true, fromSurface: true }, 20000);
          return { b64: shot.data, state: { ...(await cdpState(send)), clip } };
        }
        const shot = await send("Page.captureScreenshot", fullPage ? { format: "png", captureBeyondViewport: true, fromSurface: true } : { format: "png", fromSurface: true }, 20000);
        return { b64: shot.data, state: await cdpState(send) };
      }, { url }, "n_browser_screenshot");
      const file = shotFile();
      await writeFile(file, Buffer.from(b64, "base64"));
      const payload = { status: "success", summary: `Screenshot ${w}x${h}@${dsf}x${selector ? ` [${selector}]` : ""} — ${state.title || state.url || url || "aba atual"} → ${file}`, data: { file, width: w, height: h, scale: dsf, title: state.title, url: state.url, selector: selector || null, clip: state.clip || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [{ tool: "n_browser_act", reason: "Interagir após ver o layout" }], context_refs: [] };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
    } catch (e) {
      // fallback: --screenshot single-shot
      const file = shotFile();
      const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${w},${h}`, `--force-device-scale-factor=${dsf}`, `--screenshot=${file}`, url || "about:blank"], { timeout: BROWSER_TIMEOUT_MS });
      try {
        const st = await stat(file);
        if (st.size > 1000) {
          const b64 = readFileSync(file).toString("base64");
          const payload = { status: "success", summary: `Screenshot (fallback, página cheia — selector ignorado: ${selector || "n/a"}) ${w}x${h}@${dsf}x → ${file}`, data: { file, width: w, height: h, scale: dsf, selectorIgnored: selector || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [], context_refs: [] };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
        }
      } catch {}
      return devOut({ status: "error", summary: `screenshot falhou: ${e.message} ${(r.se || "").slice(0, 300)}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
  },
});

reg("n_browser_pdf", {
  description: "Gera PDF da página via Chrome headless. Quando usar: exportar relatório/página, arquivar evidência. Ex: {url:\"https://example.com\"}. Retorna caminho em /tmp.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, output: { type: "string" } }, required: ["url"] },
  run: async ({ url, output }) => {
    const t0 = Date.now();
    if (!url) return devOut({ status: "error", summary: "url obrigatória — chame n_browser_navigate com {url:\"https://exemplo.com\", waitMs:5000}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    try { assertSafeUrl(url); } catch (e) { return devOut({ status: "error", summary: e.message, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const file = output ? fpath(output) : join(tmpdir(), `opencode-page-${Date.now().toString(36)}.pdf`);
    // TEXT-FIRST: pdf é full render — single-shot sem flags de economia (sem imagesEnabled=false / sem setBlockedURLs).
    const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-pdf-header-footer", `--print-to-pdf=${file}`, url], { timeout: BROWSER_PDF_TIMEOUT_MS });
    try {
      const st = await stat(file);
      if (st.size > 1000) return devOut({ summary: `PDF ${humanSize(st.size)} → ${file}`, data: { file, size: st.size, url }, telemetry: { execution_time_ms: Date.now() - t0 } });
    } catch {}
    return devOut({ status: "error", summary: `pdf falhou: ${(r.se || r.so || "arquivo vazio").trim().slice(0, 200)} — confira CHROME_BIN (CANIVETE_CHROME_BIN/CHROME_BIN)`, data: { url }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// Mesma ponte do MCP "ubrowser" separado (agora fundido aqui): extensão MV3 em
// ~/Downloads/ubrowser-extension fala HTTP long-poll em 127.0.0.1:19422 com token
// (~/.config/opencode/ubrowser/token.txt). Doutrina: acesso TOTAL quando o dono pedir,
// NUNCA destrutivo/idiota sem pedido explícito; alto risco exige `confirm`.

