// canivete — tools do Chrome headless (browser_*)
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { reg, devOut, trimOut, fpath, humanSize, exec } from "./ctx.mjs";
import { probeMeta, mainContent } from "./web.mjs";
import { withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, cdpSetTextFirst, cdpSetFullRender, cdpSetViewport, cdpClearViewport, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN as CHROME_BIN_CDP } from "./cdp.mjs";

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
  // Playwright cache DEPOIS dos paths de sistema (prioridade preservada; env sempre vence acima).
  try {
    const pwBase = join(homedir(), ".cache", "ms-playwright");
    const dirs = readdirSync(pwBase).filter((d) => d.startsWith("chromium-")).sort().reverse();
    for (const d of dirs) {
      const p = join(pwBase, d, "chrome-linux", "chrome");
      try { if (existsSync(p)) return p; } catch {}
    }
  } catch {}
  return CHROME_BIN_CDP || "google-chrome";
})();

// 5) #62: cache ref→selector do snapshot headless — MESMO padrão do ubrowser
// (ubSnapCacheStore/ubSnapCacheResolve em tools-owner.mjs), com chave por URL
// (aba headless é única). Refs morrem na navegação — sem detector barato, miss
// vira erro acionável (re-snapshot).
const BR_SNAP_CACHE = new Map();
export function brSnapCacheKey(url) {
  return `url:${String(url || "about:blank")}`;
}
export function brSnapCacheStore(key, elements) {
  try {
    BR_SNAP_CACHE.set(key, (Array.isArray(elements) ? elements : []).map((el) => ({ ref: el.ref, selector: el.selector })).filter((e) => e.ref !== undefined && e.selector));
    if (BR_SNAP_CACHE.size > 5) BR_SNAP_CACHE.delete(BR_SNAP_CACHE.keys().next().value);
  } catch {}
}
export function brSnapCacheResolve(key, ref) {
  const box = BR_SNAP_CACHE.get(key);
  if (!box) return { ok: false, error: "sem snapshot em cache p/ esta URL — rode n_browser_snapshot antes de usar ref" };
  const hit = box.find((e) => String(e.ref) === String(ref));
  if (!hit) return { ok: false, error: `ref ${ref} expirada (snapshot mudou/navegou) — re-snapshot e use a ref nova` };
  return { ok: true, selector: hit.selector };
}

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
  const hint = `dica acionável: confira CHROME_BIN (CANIVETE_CHROME_BIN/CHROME_BIN) [bin=${CHROME_BIN}], porta CDP livre e tente com waitMs menor; se persistir, rode n_browser_snapshot p/ validar a aba`;
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
// #58: divergência viewport PEDIDO vs REAL (medido innerWidth/innerHeight) — puro, testável.
// >2px de diferença = WARN (não é mais sucesso cego: render/layout forçou outro tamanho).
export function viewportMismatch(real = {}, width, height) {
  const rw = Number(real?.width), rh = Number(real?.height);
  const req = { width: Number(width), height: Number(height) };
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) return { off: false, real: req, measured: false };
  const off = Math.abs(rw - req.width) > 2 || Math.abs(rh - req.height) > 2;
  return { off, real: { width: rw, height: rh }, measured: true };
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
      const { base, geoms, url: pageUrl } = await withCdpRetry(async ({ send }) => {
        await cdpSetTextFirst(send);
        if (url) await cdpGoto(send, url);
        const r = await send("Runtime.evaluate", { expression: PAGE_SNAPSHOT_JS, returnByValue: true }, 15000);
        const base = r.result?.value || [];
        let geoms = [];
        try {
          const g = await send("Runtime.evaluate", { expression: SNAPSHOT_GEOM_JS, returnByValue: true }, 15000);
          if (Array.isArray(g.result?.value)) geoms = g.result.value;
        } catch {}
        const u = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
        return { base, geoms, url: u.result?.value || "" };
      }, { url }, "n_browser_snapshot");
      const { ranked, omitted } = rankSnapshotElements(base, geoms);
      const list = ranked.slice(0, Math.min(Number(max) || 60, 120));
      brSnapCacheStore(brSnapCacheKey(pageUrl || url), list); // #62: ref→selector p/ act por ref
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
  description: "Interage via CDP: goto/back/forward/reload/click/fill/press/scroll/wait/wait_selector/evaluate. ref:<n> do n_browser_snapshot vira selector (refs expiram ao navegar — re-snapshot). console:true anexa últimos 30 logs (só pós-enable, ~1.5s). Ex: {action:\"wait_selector\", selector:\"#app\"}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "press", "scroll", "wait", "wait_selector", "evaluate"] },
      url: { type: "string" }, selector: { type: "string", description: "CSS (wait_selector só CSS; evaluate: pré-valida e lança 'elemento não encontrado' se ausente)" }, text: { type: "string" },
      ref: { type: "number", description: "ref do n_browser_snapshot (resolve p/ selector via cache por URL; expira se navegar — re-snapshot)" },
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
        // #62: ref do snapshot → selector (mesmo padrão do ubrowser; cache por URL da aba).
        // Resolve com a URL REAL da aba (não a intenção) p/ miss em navegação JS também.
        if (a.ref !== undefined && a.ref !== null && String(a.ref) !== "" && !a.selector) {
          let curUrl = a.url || "";
          try {
            const cur = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
            curUrl = cur.result?.value || curUrl;
          } catch {}
          const res = brSnapCacheResolve(brSnapCacheKey(curUrl), a.ref);
          if (!res.ok) throw new Error(`${res.error} — passe selector CSS ou rode n_browser_snapshot p/ refs novos da URL atual`);
          a = { ...a, selector: res.selector, refUsed: a.ref };
        }
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
          if (a.selector) {
            const chk = await send("Runtime.evaluate", { expression: RESOLVE_JS(a.selector), returnByValue: true }, 5000);
            if (String(chk.result?.value).startsWith("NOTFOUND")) throw new Error(`elemento não encontrado: ${a.selector} — rode n_browser_snapshot`);
          }
          const r = await send("Runtime.evaluate", { expression: a.js, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true }, 15000);
          if (r.exceptionDetails) throw new Error(`evaluate threw: ${r.exceptionDetails.text || r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
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
          // #60: estado pré-click (dialog[open], alvo, url, titulo) p/ verificar depósito
          const clickStateExpr = `(() => {
            const s = ${JSON.stringify(a.selector)};
            let el = null;
            try {
              if (s.startsWith('text=')) { const t = s.slice(5).toLowerCase(); el = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].find(e => (e.innerText || e.value || '').toLowerCase().includes(t)) || null; }
              else el = document.querySelector(s);
            } catch {}
            return { url: location.href, title: document.title,
              dialog: !!document.querySelector('a.dialog[open],dialog[open],[role="dialog"][open]'),
              target: !!el,
              targetState: el ? [(el.getAttribute('aria-expanded') || ''), (el.getAttribute('aria-checked') || ''), (el.getAttribute('aria-selected') || '')].join('|') : null };
          })()`;
          let beforeUrl = "";
          const beforeSnap = {};
          try {
            const b = await send("Runtime.evaluate", { expression: clickStateExpr, returnByValue: true }, 5000);
            Object.assign(beforeSnap, b.result?.value || {});
            beforeUrl = beforeSnap.url || "";
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
          // #60: verificação limitada — "click ok" só se ALGO mudou de verdade
          const afterSnap = {};
          try {
            const af = await send("Runtime.evaluate", { expression: clickStateExpr, returnByValue: true }, 5000);
            Object.assign(afterSnap, af.result?.value || {});
          } catch {}
          const evidence = [];
          if ((beforeSnap.dialog === true) !== (afterSnap.dialog === true)) evidence.push(`dialog[open]: ${beforeSnap.dialog ? "aberto" : "fechado"} → ${afterSnap.dialog ? "aberto" : "fechado"}`);
          if ((beforeSnap.target === true) !== (afterSnap.target === true)) evidence.push(`alvo ${a.selector}: ${beforeSnap.target ? "presente" : "ausente"} → ${afterSnap.target ? "presente" : "ausente"}`);
          if ((beforeSnap.url || "") !== (afterSnap.url || "")) evidence.push(`url: ${beforeSnap.url || "?"} → ${afterSnap.url || "?"}`);
          if ((beforeSnap.title || "") !== (afterSnap.title || "")) evidence.push(`titulo: ${JSON.stringify(beforeSnap.title || "")} → ${JSON.stringify(afterSnap.title || "")}`);
          if ((beforeSnap.targetState ?? "") !== (afterSnap.targetState ?? "")) evidence.push(`estado do alvo: ${JSON.stringify(beforeSnap.targetState)} → ${JSON.stringify(afterSnap.targetState)}`);
          const verified = evidence.length > 0;
          return await withConsole({ ...(await cdpState(send)), verified, evidence, verify: { before: beforeSnap, after: afterSnap } });
        }
        if (act === "fill") {
          if (!a.selector || !String(a.selector).trim()) throw new Error("selector vazio p/ fill (CSS obrigatório) — rode n_browser_snapshot p/ obter selector válido");
          if (a.text === undefined) throw new Error("text obrigatório p/ fill");
          // #61: setter NATIVO + input+change bubbles (caminho que o React enxerga;
          // value= direto não atualiza o estado do app e submit segue disabled).
          const fillRes = String((await send("Runtime.evaluate", { expression: `(() => {
            const s = ${JSON.stringify(a.selector)};
            const v = ${JSON.stringify(String(a.text))};
            const el = s.startsWith('text=') ? null : document.querySelector(s);
            if (!el) return 'NOTFOUND';
            el.focus();
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) {
              setter.call(el, v);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return 'NATIVA:' + el.tagName + ':' + String(el.value).slice(0, 40);
            }
            return 'SEM-SETTER:' + el.tagName;
          })()`, returnByValue: true }, 10000)).result?.value || "");
          if (fillRes.startsWith("NOTFOUND")) throw new Error(`fill: elemento não encontrado: ${a.selector} — selector stale (a página mudou)? rode n_browser_snapshot p/ obter selector válido`);
          if (fillRes.startsWith("SEM-SETTER")) {
            // sem setter nativo (contenteditable etc.): caminho antigo preservado
            await send("Input.insertText", { text: String(a.text) });
            await send("Runtime.evaluate", { expression: `(() => { const a=document.activeElement; if(a){ a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true})); } return 'ok'; })()`, returnByValue: true });
          }
          if (a.submit) {
            for (const t of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t === "rawKeyDown" ? "rawKeyDown" : "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
            await new Promise((r) => setTimeout(r, 1500));
          }
          return await withConsole({ ...(await cdpState(send)), value: true, stateAware: fillRes.startsWith("NATIVA") ? "setter-nativo+input+change" : "insertText+input+change" });
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
      // #60: click sem nada verificável = WARN (não sucesso cego)
      const unverifiedClick = a.action === "click" && result?.verified === false;
      return devOut({
        ...(unverifiedClick ? { status: "warn" } : {}),
        summary: unverifiedClick ? "click ok (NAO CONFIRMADO: nada mudou)" : summary,
        data: {
          action: a.action, ...result,
          text: result?.text ? trimOut(result.text, 3000) : (typeof result?.value === "string" ? result.value : ""),
          after: { url: afterUrl, title: afterTitle }, changed: { url: urlChanged, title: titleChanged }, ms: msAct,
          ...(a.action === "click" ? { verified: !!result?.verified, evidence: result?.evidence || [] } : {}),
          ...(unverifiedClick ? { hint: "nada mudou em dialog[open]/alvo/url/titulo após o click — confira evidence; re-snapshot (a página pode ter mudado) e tente de novo" } : {}),
          ...(a.refUsed !== undefined ? { refUsed: a.refUsed } : {}),
        },
        telemetry: { execution_time_ms: msAct },
        next: [{ tool: "n_browser_snapshot", reason: unverifiedClick ? "Re-snapshot: o click não confirmou mudança" : "Confirmar visualmente a ação" }],
      });
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
      const { b64, state, vp } = await withCdpRetry(async ({ send }) => {
        await cdpSetFullRender(send);
        if (url) await cdpGoto(send, url);
        // #58: viewport REAL via Emulation.setDeviceMetricsOverride (não --window-size)
        const vp = await cdpSetViewport(send, w, h, dsf);
        try {
          if (selector) {
            const clip = await cdpElementClip(send, selector);
            const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true, fromSurface: true }, 20000);
            return { b64: shot.data, state: { ...(await cdpState(send)), clip }, vp };
          }
          const shot = await send("Page.captureScreenshot", fullPage ? { format: "png", captureBeyondViewport: true, fromSurface: true } : { format: "png", fromSurface: true }, 20000);
          return { b64: shot.data, state: await cdpState(send), vp };
        } finally {
          await cdpClearViewport(send); // override não vaza p/ atos seguintes na mesma aba
        }
      }, { url }, "n_browser_screenshot");
      const file = shotFile();
      await writeFile(file, Buffer.from(b64, "base64"));
      // #58: viewport EFETIVO vs pedido — divergência >2px = WARN (não é mais sucesso cego)
      const vpCheck = viewportMismatch(vp?.real, w, h);
      const vpWarn = vpCheck.off ? ` — WARN: viewport real ${vpCheck.real.width}x${vpCheck.real.height} != pedido ${w}x${h} (>2px; render/layout da página forçou outro tamanho)` : "";
      const payload = { status: "success", summary: `Screenshot ${w}x${h}@${dsf}x${selector ? ` [${selector}]` : ""} — ${state.title || state.url || url || "aba atual"}${vpWarn} → ${file}`, data: { file, width: w, height: h, scale: dsf, viewportReal: vpCheck.real, viewportMatch: !vpCheck.off, title: state.title, url: state.url, selector: selector || null, clip: state.clip || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [{ tool: "n_browser_act", reason: "Interagir após ver o layout" }], context_refs: [] };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
    } catch (e) {
      // fallback: --screenshot single-shot
      const file = shotFile();
      const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${w},${h}`, `--force-device-scale-factor=${dsf}`, `--screenshot=${file}`, url || "about:blank"], { timeout: BROWSER_TIMEOUT_MS });
      try {
        const st = await stat(file);
        if (st.size > 1000) {
          const b64 = readFileSync(file).toString("base64");
          // fallback single-shot (--window-size é knob aproximado: viewport real NÃO medido aqui)
          const payload = { status: "success", summary: `Screenshot (fallback, página cheia — selector ignorado: ${selector || "n/a"}) ${w}x${h}@${dsf}x → ${file} — dica: caminho CDP falhou (${(e.message || "").slice(0, 120)}); viewport real não medido no fallback (--window-size é aproximado) — confira CANIVETE_CHROME_BIN/porta CDP`, data: { file, width: w, height: h, scale: dsf, viewportReal: null, viewportMatch: null, fallback: true, selectorIgnored: selector || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [], context_refs: [] };
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
    return devOut({ status: "error", summary: `pdf falhou: ${(r.se || r.so || "arquivo vazio").trim().slice(0, 200)} — confira CHROME_BIN (CANIVETE_CHROME_BIN/CHROME_BIN) [bin=${CHROME_BIN}]`, data: { url }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// Mesma ponte do MCP "ubrowser" separado (agora fundido aqui): extensão MV3 em
// ~/Downloads/ubrowser-extension fala HTTP long-poll em 127.0.0.1:19422 com token
// (~/.config/opencode/ubrowser/token.txt). Doutrina: acesso TOTAL quando o dono pedir,
// NUNCA destrutivo/idiota sem pedido explícito; alto risco exige `confirm`.


// --- n_browser_contrast: contraste REAL por pixel (FIX #12) ---
// O DOM media errado 2x: (1) só convertia rgb() e a cor computada volta oklch()
// → tratava texto e fundo como iguais; (2) gradiente deixa background-color transparente
// → ratio 1.0. Aqui: Page.captureScreenshot do CLIP do elemento → PNG decodificado em JS
// puro (node:zlib + unfilter, zero deps) → mediana do anel da borda vs. miolo → razao
// WCAG 2.1 dos pixels de verdade. Aditivo: nenhuma tool existente muda de comportamento.
// FIX #13: o que eu ESCREVO passa por latin1Clean (só summary).
import { inflateSync } from "node:zlib";

// FIX #13 — saneamento final do texto que eu escrevo (só summary desta tool).
export function latin1Clean(s) {
  return String(s ?? "").replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2192\u2022]/g, "").replace(/\s{2,}/g, " ").trim();
}
const contrastHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

// PNG 8-bit RGBA/RGB nao-interlacado (o que o Chrome emite) -> {width,height,channels,pixels}.
export function pngPixels(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG invalido: assinatura");
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("latin1", off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12]; } else if (type === "IDAT") idat.push(Buffer.from(d)); else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || (ctype !== 6 && ctype !== 2) || inter !== 0) throw new Error(`PNG nao suportado: depth=${depth} color=${ctype} interlace=${inter} — o Chrome emite 8-bit RGBA nao-interlacado`);
  if (w * h > 8388608) throw new Error(`PNG grande demais p/ medir (${w}x${h}) — passe selector p/ recortar`);
  const ch = ctype === 6 ? 4 : 3, stride = w * ch, out = Buffer.alloc(h * stride), raw = inflateSync(Buffer.concat(idat));
  if (raw.length < h * (stride + 1)) throw new Error("PNG truncado: IDAT nao cobre todas as scanlines");
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1), f = raw[base], line = raw.subarray(base + 1, base + 1 + stride), cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;                    // Sub / Up / Average
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } // Paeth
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return { width: w, height: h, channels: ch, pixels: out };
}
const srgbLin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export function relLuminance(c) { return 0.2126 * srgbLin(c.r) + 0.7152 * srgbLin(c.g) + 0.0722 * srgbLin(c.b); } // luminancia relativa WCAG 2.1
export function wcagRatio(fg, bg) { const a = relLuminance(fg), b = relLuminance(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; }

// oklch -> oklab -> lms -> sRGB linear -> 8-bit (a cor computada volta oklch()).
export function oklchToSrgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (v) => { const e = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, e)) * 255); };
  return { r: enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: enc(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) };
}
// dE oklab: detecta "cor == fundo" de verdade (era o falso-negativo do DOM).
export function oklabDelta(c1, c2) {
  const oklab = (c) => { const r = srgbLin(c.r), g = srgbLin(c.g), b = srgbLin(c.b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
  const [l1, a1, b1] = oklab(c1), [l2, a2, b2] = oklab(c2);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 10000) / 10000;
}

// rgb()/rgba()/#hex/oklch()/oklab() -> {r,g,b,a}; getComputedStyle pode devolver oklch().
export function cssColorToSrgb(t) {
  const s = String(t || "").trim();
  let m;
  if ((m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) { const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/i))) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 }; }
  if ((m = s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i))) return { ...oklchToSrgb(Number(m[1]) / (m[2] ? 100 : 1), Number(m[3]), Number(m[4])), a: 1 };
  if ((m = s.match(/^oklab\(\s*([\d.-]+)(%?)\s+([\d.-]+)\s+([\d.-]+)/i))) return { ...oklchToSrgb(Number(m[1]) / (m[2] ? 100 : 1), Math.hypot(Number(m[3]), Number(m[4])), Math.atan2(Number(m[4]), Number(m[3])) * 180 / Math.PI), a: 1 };
  return null;
}

// Amostragem em fracoes 0-1 do clip: anel da borda (inseto 6%) vs. miolo 3x3.
export function contrastPoints(img, cx = 0.5, cy = 0.5) {
  const ring = [], center = [], ix = Math.max(1, Math.round(img.width * 0.06)), iy = Math.max(1, Math.round(img.height * 0.06)), n = 12;
  for (let i = 0; i <= n; i++) {
    const x = (ix + ((img.width - 1 - 2 * ix) * i) / n) / img.width, y = (iy + ((img.height - 1 - 2 * iy) * i) / n) / img.height;
    ring.push([x, iy / img.height], [x, (img.height - 1 - iy) / img.height], [ix / img.width, y], [(img.width - 1 - ix) / img.width, y]);
  }
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) center.push([cx + dx * 0.12, cy + dy * 0.12]);
  return { ring, center };
}
// Mediana por canal (robusta a texto/anti-serrilado) dos pontos sorteados.
export function medianColor(img, pts) {
  const px = (fx, fy) => {
    const x = Math.min(img.width - 1, Math.max(0, Math.round(fx * img.width))), y = Math.min(img.height - 1, Math.max(0, Math.round(fy * img.height))), i = (y * img.width + x) * img.channels;
    return { r: img.pixels[i], g: img.pixels[i + 1], b: img.pixels[i + 2], a: img.channels === 4 ? img.pixels[i + 3] : 255 };
  };
  const rs = [], gs = [], bs = [], as = [];
  for (const [fx, fy] of pts) { const c = px(fx, fy); rs.push(c.r); gs.push(c.g); bs.push(c.b); as.push(c.a); }
  if (!rs.length) return null;
  const med = (arr) => { arr.sort((p, q) => p - q); const m = arr.length >> 1; return arr.length % 2 ? arr[m] : Math.round((arr[m - 1] + arr[m]) / 2); };
  return { r: med(rs), g: med(gs), b: med(bs), a: med(as), samples: rs.length };
}

// Sonda read-only: cor/fonte computadas + fundo ancestral (cruzamento pixel x DOM e gradiente).
export const CONTRAST_PROBE_JS = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const cs = getComputedStyle(el), out = (bg, img, grad) => ({ color: cs.color, font: cs.fontSize + "/" + cs.fontWeight, background: bg, backgroundImage: img, gradient: grad });
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const c = getComputedStyle(n);
    if (c.backgroundImage !== "none") return out(c.backgroundColor, c.backgroundImage, true);
    if (c.backgroundColor !== "rgba(0, 0, 0, 0)") return out(c.backgroundColor, "none", false); }
  return out("rgb(255, 255, 255)", "none", false); })()`;
reg("n_browser_contrast", {
  description: "Contraste REAL medido em PIXEL (nao no DOM): captura o clip do elemento, decodifica o PNG em JS puro e compara a mediana do anel da borda com a do miolo -> razao WCAG 2.1. Conserta os 2 furos do DOM: cor computada em oklch() (achava texto==fundo) e background-color transparente em gradiente (ratio 1.0). Gradiente devolve ratio:null + warning. Ex: {url:\"http://localhost:5173\", selector:\"button.cta\"}. Sem selector = viewport.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, selector: { type: "string", description: "CSS do elemento a recortar; sem selector mede o viewport inteiro" }, points: { type: "array", description: "Pares [fx,fy] em fracoes 0-1 do clip, amostrados no miolo (substitui a grade 3x3 do centro)" } }, required: [] },
  run: async ({ url, selector, points }) => {
    const t0 = Date.now();
    const fail = (summary, extra = {}) => devOut({ status: "error", summary: latin1Clean(summary), data: { selector: selector || null, ...extra }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (url) { try { assertSafeUrl(url); } catch (e) { return fail(e.message); } }
    if (points !== undefined && (!Array.isArray(points) || !points.every((p) => Array.isArray(p) && p.length >= 2 && p.every((n) => Number.isFinite(Number(n)))))) return fail("points deve ser array de pares [fx,fy] em fracoes 0-1. Ex: {points:[[0.5,0.4]]}");
    const norm = (p) => [Math.min(1, Math.max(0, Number(p[0]))), Math.min(1, Math.max(0, Number(p[1])))];
    try {
      const m = await withCdpRetry(async ({ send }) => {
        await cdpSetFullRender(send);
        if (url) await cdpGoto(send, url);
        let probe = null, clip = null;
        if (selector) {
          try { const pr = await send("Runtime.evaluate", { expression: CONTRAST_PROBE_JS(selector), returnByValue: true }, 10000); probe = pr.result?.value || null; } catch {}
          clip = await cdpElementClip(send, selector);
        }
        const shot = await send("Page.captureScreenshot", clip ? { format: "png", clip, captureBeyondViewport: true, fromSurface: true } : { format: "png", fromSurface: true }, 20000);
        return { img: pngPixels(Buffer.from(shot.data, "base64")), probe, clip };
      }, { url }, "n_browser_contrast");
      const img = m.img, warnings = [], gradient = m.probe?.gradient === true;
      const { ring, center } = contrastPoints(img, 0.5, 0.5);
      const outer = medianColor(img, ring), inner = medianColor(img, Array.isArray(points) && points.length ? points.map(norm) : center);
      if (!outer || !inner) return fail("nenhum pixel amostravel — clip fora da viewport? confira com n_browser_screenshot", { clip: m.clip || null });
      const ratio = gradient ? null : wcagRatio(outer, inner), delta = oklabDelta(outer, inner);
      if (gradient) warnings.push("fundo em gradiente — medir por pixel nao e valido aqui, use n_browser_screenshot");
      if (delta < 0.005) warnings.push(`cor do anel e do miolo praticamente identicas (deltaE oklab ${delta}) — o pixel nao diferencia texto de fundo; confira com n_browser_screenshot`);
      if (Math.min(outer.a, inner.a) < 250) warnings.push(`pixels translucidos (alpha ${Math.min(outer.a, inner.a)}/255) — a mediana pode incluir o que esta atras`);
      let domCheck = null; // cruzamento pixel x DOM: oklch()/oklab() -> sRGB antes de comparar
      try {
        const fg = cssColorToSrgb(m.probe?.color), bg = cssColorToSrgb(m.probe?.background);
        if (fg && bg && !gradient) {
          const dd = oklabDelta(fg, bg), dr = wcagRatio(fg, bg);
          domCheck = { fg: contrastHex(fg), bg: contrastHex(bg), ratio: dr, deltaE: dd, concordaComPixel: ratio == null ? null : Math.abs(dr - ratio) < 2 };
          if (dd < 0.005 && delta >= 0.005) warnings.push("DOM (apos oklch->sRGB) diria cor==fundo — o pixel discorda: use a medicao por pixel");
        }
      } catch {}
      const level = ratio == null ? "n/a (gradiente)" : ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "FAIL";
      return devOut({ status: "success", summary: latin1Clean(`Contraste por pixel ${ratio == null ? "indisponivel (gradiente)" : `${ratio}:1 (${level})`} — ${selector ? `[${selector}] ` : "viewport "}${contrastHex(outer)} x ${contrastHex(inner)} (deltaE ${delta}, ${outer.samples}+${inner.samples} px${warnings.length ? `, ${warnings.length} aviso(s)` : ""})`), data: { ratio, level, limiares: { AA: 4.5, AAA: 7 }, anel: { hex: contrastHex(outer), amostras: outer.samples, alpha: outer.a }, miolo: { hex: contrastHex(inner), amostras: inner.samples, alpha: inner.a }, deltaE_oklab: delta, clip: m.clip || null, imagem: { width: img.width, height: img.height, channels: img.channels }, domCheck, warnings }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_browser_screenshot", reason: "Confirmar o que foi medido" }] });
    } catch (e) { return fail(`contrast falhou: ${/dica acionavel/.test(String(e?.message || "")) ? e.message : `${e.message} — dica acionavel: confira o selector com n_browser_snapshot, CHROME_BIN/porta CDP, ou meça sem selector`}`); }
  },
});
