// canivete — ponte do navegador LOGADO do dono (extensão local, long-poll localhost + token)
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, statSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS, CTX, CTX_BUDGET } from "./ctx.mjs"; // aba Ferramentas do painel (mesmo processo do MCP)
import { TOOL_GROUPS, firstSentence } from "../core/taxonomy.mjs";
import { homedir } from "node:os";
import { pruneJsonl } from "./ctx.mjs";
// elemreports (reports persistentes de elemento): store carregado aqui p/ as rotas da ponte
// (POST /elemreport, GET /elemreports) e p/ a fusão do /api/issues. Sem ciclo: elemreports
// NÃO importa este módulo — ele expõe erOnChange(fn) e a ponte registra o notifier abaixo.
import { erListPublic, erAdd, erUpdate, erForPainel, erShotPath, erSetStatus } from "./elemreports.mjs";

const UB_PORT = Number(process.env.CANIVETE_BRIDGE_PORT || process.env.UBROWSER_PORT || process.env.UB_PORT) || 19422;
const UB_TOKEN_FILE = process.env.CANIVETE_TOKEN_FILE || join(homedir(), ".config/canivete/token.txt");
const UB_MAXPAY = Number(process.env.CANIVETE_UB_MAXPAY) || 500 * 1024;
const UB_CHUNK = Number(process.env.CANIVETE_UB_CHUNK) || 400 * 1024;
// painel local + observabilidade: assets do pacote (src/lib → ../assets) e logs em ~/.config/canivete
const UB_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../assets");
const UB_CONFIG_DIR = () => process.env.CANIVETE_CONFIG_DIR || join(homedir(), ".config/canivete");
const UB_MONLOG_MAX = 2000, UB_REPLAY_MAXPAY = 12 * 1024 * 1024;
// Timeout de transporte ÚNICO do ubrowser: default 60s, piso 1s, teto 300s (env respeitado).
// tools-owner usa p/ mensagem fiel ("timeout Xs"); ubSend clampa qualquer caller por aqui.
export const UB_TIMEOUT_MS = Math.min(Math.max(Number(process.env.CANIVETE_UB_TIMEOUT) || 60000, 1000), 300000);
const UB_WARNPAY = 100 * 1024;
// cache em memória: era readFileSync a cada request (hot-path HTTP) — agora lê 1x
let ubTokenCache = (process.env.CANIVETE_TOKEN || "").trim() || null;
const ubToken = () => {
  if (ubTokenCache) return ubTokenCache;
  if (process.env.CANIVETE_TOKEN) { ubTokenCache = process.env.CANIVETE_TOKEN.trim(); return ubTokenCache; }
  try {
    const t = (readFileSync(UB_TOKEN_FILE, "utf8") || "").trim();
    if (t) { ubTokenCache = t; return t; }
  } catch (e) { process.stderr.write(`[canivete] token read falhou (${e?.message || e})\n`); }
  // auto-gera na primeira execução (E4: sem token manual)
  try {
    const t = randomBytes(24).toString("hex");
    mkdirSync(dirname(UB_TOKEN_FILE), { recursive: true });
    writeFileSync(UB_TOKEN_FILE, t, { mode: 0o600 });
    process.stderr.write(`[canivete] token gerado em ${UB_TOKEN_FILE} — cole na extensão\n`);
    ubTokenCache = t;
    return t;
  } catch (e) {
    process.stderr.write(`[canivete] sem token (${e.message}) — extensão não conecta\n`);
    return "";
  }
};

const ubExtensions = new Map(); // clientId -> { lastPoll, info }
let ubLastPoll = 0;
let ubExtInfo = null;
const ubQueue = [], ubWaiters = [], ubPending = new Map();
let ubSeq = 0, ubHttp = false;
// TTL da fila: cada msg carrega exp (= ida do caller, ms). Expirada = caller já desistiu —
// executar atrasado faria efeito fantasma (clique tardio na aba errada) e a resposta
// voltaria p/ ninguém. Prune em push/poll/flush; contador p/ diagnóstico (ubStats).
let ubExpired = 0;
function ubPrune() {
  const now = Date.now();
  for (let i = ubQueue.length - 1; i >= 0; i--) {
    const q = ubQueue[i];
    if (q.exp && q.exp <= now) { ubQueue.splice(i, 1); ubExpired++; }
  }
}
function ubNextIdx(extId) {
  const now = Date.now();
  return ubQueue.findIndex((q) => (!q.exp || q.exp > now) && (q.target === null || q.target === extId));
}
// alertas proativos do mon-hook (/ubpush): erros de console/rede empurrados pela extensão.
// Ring global (cap 30) + contador não-lidos; `console` marca lido; hint nas respostas.
const ubAlerts = [];
let ubAlertsUnread = 0;
function ubAlertsPush(tabId, title, url, entries) {
  try {
    for (const e of (Array.isArray(entries) ? entries : []).slice(0, 3)) {
      ubAlerts.push({ at: new Date().toISOString(), tabId, title: String(title || "").slice(0, 80), url: String(url || "").slice(0, 120), kind: e.kind, level: e.level, text: String(e.text || e.url || "").slice(0, 220), status: e.status ?? null });
    }
    while (ubAlerts.length > 30) ubAlerts.shift();
    ubAlertsUnread++;
  } catch {}
}
function ubAlertsPending() { return ubAlertsUnread; }
function ubAlertsRead() { const n = ubAlertsUnread; ubAlertsUnread = 0; return n; }
function ubAlertsHint() {
  return ubAlertsUnread > 0 ? ` 📬 ${ubAlertsUnread} alerta(s) novo(s) do console — leia com n_ubrowser_act {action:"console", filter:"errors"}` : "";
}

// rotação do mon-log (source:"auto"): cap UB_MONLOG_MAX, mantém as mais novas —
// delega ao pruneJsonl único (ctx.mjs), atômico.
function ubPruneMonLog(p) { pruneJsonl(p, UB_MONLOG_MAX); }
// saneamento de nome de arquivo/asset servido à mão: só [A-Za-z0-9._-]; ".." = recusa
function ubSafeName(name) {
  const s = String(name || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!s || s.includes("..")) return null;
  return s;
}
// mime por ext p/ os assets do painel (default: octet-stream)
function ubMime(name) {
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}
// log de erro automático (mon-hook v4 via /replay): 1 linha JSON em mon-log.jsonl
// com metadados + referência ao arquivo do replay — o painel lê junto do inbox n_report.
function ubMonLogAppend(entry) {
  try {
    const p = join(UB_CONFIG_DIR(), "mon-log.jsonl");
    mkdirSync(dirname(p), { recursive: true });
    ubPruneMonLog(p);
    appendFileSync(p, JSON.stringify(entry) + "\n");
  } catch {}
}
// /api/issues funde os dois canais: inbox n_report (source:"report") + mon-log (source:"auto").
// Linha inválida pula sem quebrar a leitura; filtro q/area/agent/kind/source; ts desc.
// ---- gestão de reports do inbox n_report (append-only) — overlay do dono por cima ----
// issues.jsonl nunca é reescrito; estado/edições vivem em issues-state.json por id.
const UB_ISS_STATUS = ["aberto", "em_resolução", "resolvido", "wontfix", "externo", "ruido"];
const ubIssStatePath = () => join(UB_CONFIG_DIR(), "issues-state.json");
function ubIssuesStateLoad() {
  try { const o = JSON.parse(readFileSync(ubIssStatePath(), "utf8")); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function ubIssuesStateSet(id, patch) {
  const cur = ubIssuesStateLoad();
  const next = { ...(cur[id] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = String(v); }
  if (Object.keys(next).length) cur[id] = next; else delete cur[id];
  writeFileSync(ubIssStatePath(), JSON.stringify(cur, null, 1));
  return next;
}
// ferramentas desligadas pelo dono (persiste; reaplica no boot): name -> def guardada
const UB_TOOLS_OFF = new Map();
const ubToolsOffPath = () => join(UB_CONFIG_DIR(), "tools-off.json");
function ubToolsOffApply() {
  let arr = [];
  try { arr = JSON.parse(readFileSync(ubToolsOffPath(), "utf8")); } catch { return; }
  for (const n of Array.isArray(arr) ? arr : []) { const d = TOOLS.get(n); if (d) { UB_TOOLS_OFF.set(n, d); TOOLS.delete(n); } }
}
function ubToolsOffPersist() { try { writeFileSync(ubToolsOffPath(), JSON.stringify([...UB_TOOLS_OFF.keys()], null, 1)); } catch {} }

function ubIssuesLista(filtros) {
  const q = filtros.q.toLowerCase(), fArea = filtros.area, fAgent = filtros.agent, fKind = filtros.kind, fSrc = filtros.source;
  const items = [];
  const stateOv = ubIssuesStateLoad(); // overlay do dono (lido 1x por consulta)
  const ubIssuesCache = new Map(); // path -> {mtimeMs, rows} — painel polla a cada 30s: re-parse SÓ quando o arquivo mudou
  const coleta = (f, src) => {
    try {
      if (!existsSync(f)) return;
      const mtimeMs = statSync(f).mtimeMs;
      let cache = ubIssuesCache.get(f);
      if (!cache || cache.mtimeMs !== mtimeMs) {
        const rows = [];
        for (const line of readFileSync(f, "utf8").split("\n")) {
          if (!line) continue;
          try { const o = JSON.parse(line); if (o && typeof o === "object") rows.push(o); } catch {}
        }
        cache = { mtimeMs, rows };
        ubIssuesCache.set(f, cache);
      }
      for (const o of cache.rows) {
        const c = { ...o, source: src };
        if (src === "report" && stateOv[o.id]) Object.assign(c, stateOv[o.id]);
        if (q) {
          const hay = [c.text, c.got, c.where, c.url, c.nota].map((v) => String(v || "").toLowerCase()).join("\n");
          if (!hay.includes(q)) continue;
        }
        if (fArea && String(c.area || "") !== fArea) continue;
        if (fAgent && String(c.agent || "") !== fAgent) continue;
        if (fKind && String(c.kind || "") !== fKind) continue;
        if (fSrc && String(c.source) !== fSrc) continue;
        items.push(c);
      }
    } catch {}
  };
  coleta(join(UB_CONFIG_DIR(), "issues.jsonl"), "report");
  coleta(join(UB_CONFIG_DIR(), "mon-log.jsonl"), "auto");
  // 3ª fonte: reports de ELEMENTO (marcação humana na página) — estado corrente por id,
  // mesmos filtros do coleta; source "elem" no painel (fonte nova p/ o <select>).
  try {
    for (const o of erForPainel()) {
      if (!o || typeof o !== "object") continue;
      o.source = "elem";
      if (q) {
        const hay = [o.text, o.got, o.where, o.url].map((v) => String(v || "").toLowerCase()).join("\n");
        if (!hay.includes(q)) continue;
      }
      if (fArea && String(o.area || "") !== fArea) continue;
      if (fAgent && String(o.agent || "") !== fAgent) continue;
      if (fKind && String(o.kind || "") !== fKind) continue;
      if (fSrc && String(o.source) !== fSrc) continue;
      items.push(o);
    }
  } catch {}
  items.sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))); // ISO: compare lexicográfico = cronológico
  return items;
}

function ubFlush() {
  ubPrune();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let wi = 0; wi < ubWaiters.length; wi++) {
      const w = ubWaiters[wi];
      const qi = ubNextIdx(w.extId);
      if (qi >= 0) {
        ubWaiters.splice(wi, 1);
        const q = ubQueue.splice(qi, 1)[0];
        clearTimeout(w.t);
        try { w.res.writeHead(200, { "content-type": "application/json" }); w.res.end(JSON.stringify(q)); } catch (e) { process.stderr.write(`[canivete] ubFlush falhou (${e?.message || e})\n`); }
        progressed = true;
        break;
      }
    }
  }
}

function ubEnsure() {
  if (ubHttp) return;
  ubHttp = true;
  ubToolsOffApply(); // tools-off.json do dono → reapply (boot é o único ponto com as defs todas vivas)
  const ubLat = []; // ring de latências das rotas da ponte (ms) — gráfico de velocidade do painel
  const ubHttpSrv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      const t0 = process.hrtime.bigint();
      res.on("finish", () => {
        if (!u.pathname.startsWith("/api/") && u.pathname !== "/health") return;
        ubLat.push({ p: u.pathname, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6 * 10) / 10 });
        if (ubLat.length > 120) ubLat.shift();
      });
      if (u.pathname === "/health") { const now = Date.now(); let nconn = 0; for (const [, e] of ubExtensions) if (now - e.lastPoll < 45000) nconn++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, queue: ubQueue.length, connected: nconn })); return; }
      // painel local — servidor em 127.0.0.1: rotas de leitura ficam públicas pro painel no browser
      if (req.method === "GET") {
        const pth = u.pathname;
        if (pth === "/painel" || pth === "/uierr.js") {
          const f = join(UB_ASSETS_DIR, pth === "/painel" ? "painel.html" : "uierr.js");
          if (!existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": pth === "/painel" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8" });
          res.end(readFileSync(f));
          return;
        }
        if (pth.startsWith("/assets/fonts/")) { // fontes self-hosted do painel (Ácido-Noir)
          const name = ubSafeName(pth.slice("/assets/fonts/".length));
          const f = name ? join(UB_ASSETS_DIR, "fonts", name) : null;
          if (!f || !existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": "font/woff2" });
          res.end(readFileSync(f));
          return;
        }
        if (pth.startsWith("/assets/")) {
          const name = ubSafeName(pth.slice("/assets/".length));
          if (!name) { res.writeHead(404); res.end("not found"); return; }
          const f = join(UB_ASSETS_DIR, name);
          if (!existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": ubMime(name) });
          res.end(readFileSync(f));
          return;
        }
        if (pth.startsWith("/replays/")) {
          const id = ubSafeName(pth.slice("/replays/".length));
          if (!id || !id.startsWith("rp")) { res.writeHead(404); res.end("not found"); return; }
          const f = join(UB_CONFIG_DIR(), "replays", id + ".json");
          if (!existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(readFileSync(f));
          return;
        }
        if (pth === "/api/issues") {
          const items = ubIssuesLista({
            q: String(u.searchParams.get("q") || "").slice(0, 200),
            area: String(u.searchParams.get("area") || "").slice(0, 60),
            agent: String(u.searchParams.get("agent") || "").slice(0, 60),
            kind: String(u.searchParams.get("kind") || "").slice(0, 30),
            source: String(u.searchParams.get("source") || "").slice(0, 10),
          });
          const lim = Math.min(Math.max(Number(u.searchParams.get("limit")) || 150, 1), 500);
          const page = items.slice(0, lim);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, count: page.length, items: page }));
          return;
        }
        // status de TUDO p/ o painel (humano analisa sem SSH): ponte + extensões + arquivos
        // + captura por fonte/kind + último smoke. Público só em 127.0.0.1 (bind do servidor).
        if (pth === "/api/status") {
          const cfg = UB_CONFIG_DIR();
          const fstat = (p) => { try { const s = statSync(p); return { bytes: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };
          const nlines = (p) => { try { const s = statSync(p); if (s.size > 8 * 1024 * 1024) return -1; let n = 0; for (const ch of readFileSync(p, "utf8")) if (ch === "\n") n++; return n; } catch { return 0; } };
          const arq = (nome) => { const f = fstat(join(cfg, nome)); return f ? { bytes: f.bytes, mtimeMs: f.mtimeMs, linhas: nlines(join(cfg, nome)) } : null; };
          const stats = ubStats();
          const issues = ubIssuesLista({ q: "", area: "", agent: "", kind: "", source: "" });
          const porFonte = {}, porKind = {};
          const repEstado = { aberto: 0, em_resolução: 0, resolvido: 0, wontfix: 0 };
          for (const it of issues) {
            porFonte[it.source] = (porFonte[it.source] || 0) + 1;
            const k = String(it.kind || "?"); porKind[k] = (porKind[k] || 0) + 1;
            if (it.source === "report") { const s = String(it.status || "aberto"); repEstado[s] = (repEstado[s] || 0) + 1; }
          }
          const elem = { aberto: 0, "em_resolução": 0, resolvido: 0 };
          for (const it of erForPainel()) if (elem[it.status] != null) elem[it.status]++;
          let replaysN = 0;
          try { replaysN = readdirSync(join(cfg, "replays")).filter((f) => f.endsWith(".json")).length; } catch {}
          let smoke = null;
          try { smoke = JSON.parse(readFileSync(join(cfg, "smoke-last.json"), "utf8")); } catch {}
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            ponte: { port: stats.port, uptimeS: Math.round(process.uptime()), queue: stats.queued, pending: stats.pending, expiredDropped: stats.expiredDropped, lastPollAgoMs: stats.lastPollAgoMs },
            extensoes: stats.extensions.map((e) => ({ id: String(e.id).slice(0, 12) + "…", label: e.profileLabel || null, extId: e.info && e.info.extId ? String(e.info.extId) : null, connected: !!e.connected, lastPollAgoMs: e.lastPollAgoMs, queued: e.queued })),
            arquivos: { issues: arq("issues.jsonl"), monlog: arq("mon-log.jsonl"), elemreports: arq("reports-elementos.jsonl"), replays: { count: replaysN } },
            captura: { total: issues.length, porFonte, porKind, elem, report: repEstado },
            lat: ubLat, // últimas ≤120 respostas da ponte (ms) — gráfico de velocidade
            smoke,
          }));
          return;
        }
        // aba Ferramentas do painel: catálogo agrupado (mesma taxonomia do n_tools_info) +
        // uso do contexto (CTX vivo) + configuração do processo — números, não prosa.
        if (pth === "/api/tools") {
          const slim = (n) => { const t = TOOLS.get(n); return { name: n, on: !!t, desc: t ? firstSentence(t.description).slice(0, 110) : "", calls: CTX.byTool.get(n) || 0 }; };
          const listed = new Set(TOOL_GROUPS.flatMap((gr) => gr.names));
          const groups = TOOL_GROUPS.map((gr) => ({
            title: gr.dynamicTitle && !TOOLS.has("n_task") ? "Todos (subagentes desativados)" : gr.title,
            hint: gr.hint,
            tools: gr.names.map(slim),
          }));
          const outras = [...new Set([...TOOLS.keys(), ...UB_TOOLS_OFF.keys()])].filter((n) => !listed.has(n)).map(slim);
          const top = [...CTX.byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, calls]) => ({ name, calls }));
          const ai = process.argv.indexOf("--http");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            config: {
              bridgePort: UB_PORT,
              mcpPort: ai >= 0 ? Number(process.argv[ai + 1]) || null : null,
              runner: process.env.CANIVETE_RUNNER || "opencode",
              task: TOOLS.has("n_task"),
              node: process.version,
              dir: UB_CONFIG_DIR(),
              rede: "127.0.0.1",
            },
            groups, outras,
            ctx: { calls: CTX.calls, chars: CTX.chars, budget: CTX_BUDGET, top },
            total: TOOLS.size + UB_TOOLS_OFF.size,
          }));
          return;
        }
        // reports de elemento por site (estado corrente, slim = sem outerHTML): a extensão
        // sincroniza o cache da origin por aqui (e debug humano via curl no localhost).
        if (pth === "/elemreports") {
          const r = erListPublic({
            base_url: String(u.searchParams.get("base_url") || ""),
            status: String(u.searchParams.get("status") || ""),
            area: String(u.searchParams.get("area") || ""),
            grupo: String(u.searchParams.get("grupo") || ""),
            q: String(u.searchParams.get("q") || ""),
            limit: Number(u.searchParams.get("limit")) || 200,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(r));
          return;
        }
        // screenshot opcional de um report (png salvo no commit da marcação)
        if (pth.startsWith("/elemshots/")) {
          const id = ubSafeName(pth.slice("/elemshots/".length));
          const f = id ? erShotPath(id) : null;
          if (!f) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": "image/png" });
          res.end(readFileSync(f));
          return;
        }
      }
      // ---- gestão pelo painel (127.0.0.1, mesmo nível das rotas GET de leitura) ----
      // update = overlay do dono p/ reports do n_report · locate = leva o dono até a página
      // numa aba NOVA em fundo (tab.new) elevada sem roubar foco de SO (tab.activate) ·
      // toggle = liga/desliga tool do catálogo (persiste em tools-off.json).
      const pth = u.pathname;
      if (req.method === "POST" && (pth === "/api/tools/toggle" || /^\/api\/issues\/[A-Za-z0-9_-]+\/(update|locate)$/.test(pth))) {
        let body = "";
        await new Promise((ok, fail) => { const ch = []; let n = 0; req.on("data", (c) => { n += c.length; if (n > 20 * 1024 * 1024) fail(new Error("body > 20MB")); else ch.push(c); }); req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); }); req.on("error", fail); });
        let p = {}; try { p = JSON.parse(body); } catch {}
        if (!p || typeof p !== "object") { res.writeHead(400, { "content-type": "application/json" }); res.end('{"ok":false,"error":"bad json"}'); return; }
        const j422 = (e) => { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e })); };

        if (pth === "/api/tools/toggle") {
          const name = String(p.name || "").slice(0, 80);
          const on = p.on === true;
          const def = on ? UB_TOOLS_OFF.get(name) : TOOLS.get(name);
          if (!def) return j422(on ? "tool não está desligada" : "tool não existe");
          if (on) { TOOLS.set(name, def); UB_TOOLS_OFF.delete(name); } else { UB_TOOLS_OFF.set(name, def); TOOLS.delete(name); }
          ubToolsOffPersist();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, name, on, total: TOOLS.size, off: UB_TOOLS_OFF.size }));
          return;
        }

        const m = pth.match(/^\/api\/issues\/([A-Za-z0-9_-]+)\/(update|locate)$/);
        const id = m[1], acao = m[2];
        const item = ubIssuesLista({ q: "", area: "", agent: "", kind: "", source: "" }).find((x) => String(x.id) === id);
        if (!item) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "id não encontrado" })); return; }

        if (acao === "update") {
          // elem: o painel muda o ciclo aberto → em_resolução → resolvido (proof documenta a ação)
          if (item.source === "elem") {
            const r = erSetStatus({ id, status: String(p.status || "resolvido"), proof: String(p.proof || "estado mudado pelo dono no painel").slice(0, 2000), por: "painel" });
            if (!r.ok) return j422(r.error);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, id, item: r.report }));
            return;
          }
          if (item.source !== "report") return j422("este item é automático (mon-hook) — estado não editável");
          const allowed = ["nota", "kind", "got", "expected", "where", "repro", "blockedBy", "suggestedCapability"];
          const patch = {};
          if (p.status !== undefined) {
            if (!UB_ISS_STATUS.includes(String(p.status))) return j422(`status inválido (use ${UB_ISS_STATUS.join("|")})`);
            patch.status = String(p.status);
          }
          for (const k of allowed) if (p[k] === null) patch[k] = null; else if (typeof p[k] === "string") patch[k] = p[k].slice(0, k === "got" ? 1000 : 500);
          if (!Object.keys(patch).length) return j422("nada para atualizar");
          const next = ubIssuesStateSet(id, patch);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, id, estado: next, item: { ...item, ...next, source: item.source } }));
          return;
        }

        // locate: leva até a página p/ revisar — aba nova em fundo + eleva (sem foco de SO)
        if (!item.url || !/^https?:\/\//i.test(String(item.url))) return j422("este item não tem url p/ abrir");
        const nova = await ubSend("tab.new", { url: String(item.url) }, 15000);
        if (nova && nova.__offline) { res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: UB_OFF })); return; }
        if (nova && nova.__timeout) { res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "extensão não respondeu em 15s — confira o popup" })); return; }
        if (nova && nova.id) await ubSend("tab.activate", { tabId: nova.id }, 8000);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, id, url: item.url, aba: nova && nova.id }));
        return;
      }
      const token = u.searchParams.get("token") || req.headers["x-token"];
      const good = ubToken();
      if (!good || token !== good) { process.stderr.write(`[native-mcp] ubrowser 401 ${u.pathname} token=${String(token || "").slice(0, 8)}...\n`); res.writeHead(401); res.end("bad token"); return; }
      if (req.method === "GET" && u.pathname === "/poll") {
        const extId = u.searchParams.get("ext") || "anon";
        const ext = ubExtensions.get(extId) || { lastPoll: 0, info: null };
        ext.lastPoll = Date.now();
        ubExtensions.set(extId, ext);
        ubLastPoll = Date.now();
        ubPrune(); // sem isto, msg expirada entregue a um poll tardio = efeito fantasma no Chrome
        const qi = ubNextIdx(extId);
        if (qi >= 0) { const q = ubQueue.splice(qi, 1)[0]; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(q)); return; }
        const t = setTimeout(() => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) ubWaiters.splice(i, 1); try { res.writeHead(204); res.end(); } catch (e) { process.stderr.write(`[canivete] ub poll 204 falhou (${e?.message || e})\n`); } }, 25000);
        ubWaiters.push({ res, t, extId });
        try { req.on("close", () => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) { ubWaiters.splice(i, 1); clearTimeout(t); } }); } catch (e) { process.stderr.write(`[canivete] ub poll close-hook falhou (${e?.message || e})\n`); }
        return;
      }
      if (req.method === "POST" && (u.pathname === "/hello" || u.pathname === "/result" || u.pathname === "/exec" || u.pathname === "/ubpush" || u.pathname === "/replay" || u.pathname === "/elemreport" || u.pathname === "/elemreport-update")) {
        let body = "";
        await new Promise((ok, fail) => { const ch = []; let n = 0; req.on("data", (c) => { n += c.length; if (n > 20 * 1024 * 1024) fail(new Error("body > 20MB")); else ch.push(c); }); req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); }); req.on("error", fail); });
        if (u.pathname === "/replay") {
          // clipe de replay (mon-hook v4 → content → background): JSON {t,url,tags,err,rrweb[]}.
          // Grava o body RAW p/ alimentar o Replayer sem re-parse/re-stringify; índice vira
          // 1 linha JSON em mon-log.jsonl (source:"auto") com referência ao arquivo.
          let p = {};
          try { p = JSON.parse(body); } catch (e) { process.stderr.write(`[canivete] ub /replay json inválido (${e?.message || e})\n`); }
          if (!p || typeof p !== "object") { res.writeHead(400, { "content-type": "application/json" }); res.end('{"ok":false,"error":"bad json"}'); return; }
          if (Buffer.byteLength(body || "", "utf8") > UB_REPLAY_MAXPAY) { res.writeHead(413, { "content-type": "application/json" }); res.end('{"ok":false,"error":"clip > 12MB"}'); return; }
          const id = "rp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const dir = join(UB_CONFIG_DIR(), "replays");
          try { mkdirSync(dir, { recursive: true }); } catch (e) { process.stderr.write(`[canivete] ub /replay mkdir falhou (${e?.message || e})\n`); }
          try { writeFileSync(join(dir, id + ".json"), body); } catch (e) { process.stderr.write(`[canivete] ub /replay write falhou (${e?.message || e})\n`); }
          const errStatus = p.err?.status;
          ubMonLogAppend({
            id, ts: new Date().toISOString(), source: "auto",
            kind: String((p.err && p.err.kind) || "js-error").slice(0, 20),
            text: String((p.err && (p.err.text || p.err.error)) || "").slice(0, 300),
            status: errStatus ?? null,
            url: String(p.url || "").slice(0, 300),
            area: (p.tags && p.tags.area) || null,
            agent: (p.tags && p.tags.agent) || null,
            app: (p.tags && p.tags.app) || null,
            replay: id,
            bytes: Buffer.byteLength(body || "", "utf8"),
          });
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, id }));
          return;
        }
        if (u.pathname === "/ubpush") {
          // push proativo de erro (mon-hook → content → background): buffer + avisa host.
          let p = {};
          try { p = JSON.parse(body); } catch {}
          ubAlertsPush(p.tabId, p.title, p.url, p.entries);
          try {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "warning", logger: "canivete", data: `📬 console: erro novo em ${String(p.title || p.url || "aba").slice(0, 60)} — leia com n_ubrowser_act {action:"console", filter:"errors"}` } }) + "\n");
          } catch {}
          res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
          return;
        }
        if (u.pathname === "/elemreport" || u.pathname === "/elemreport-update") {
          // marcação humana de elemento (overlay da extensão → ponte → reports-elementos.jsonl).
          // /elemreport cria (dedupe por seletor+nota); /elemreport-update edita pack existente
          // (nota, elements_add/remove, apagar) ou MUDA O STATUS (erSetStatus — ciclo aberto →
          // em_resolução → resolvido). Traz o report persistido de volta p/ a aba.
          let p = {};
          try { p = JSON.parse(body); } catch (e) { process.stderr.write(`[canivete] ub ${u.pathname} json inválido (${e?.message || e})\n`); }
          if (!p || typeof p !== "object") { res.writeHead(400, { "content-type": "application/json" }); res.end('{"ok":false,"error":"bad json"}'); return; }
          const r = u.pathname === "/elemreport-update" ? (p.status !== undefined ? erSetStatus(p) : erUpdate(p)) : erAdd(p);
          if (!r.ok) { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: r.error })); return; }
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, report: r.report, deduped: !!r.deduped, apagado: !!r.apagado }));
          return;
        }
        if (u.pathname === "/hello") {
          let hi = null;
          try { hi = JSON.parse(body).info || null; } catch (e) { process.stderr.write(`[canivete] ub /hello json inválido (${e?.message || e})\n`); }
          if (hi && hi.probe) { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"probe":true}'); return; }
          const clientId = (hi && hi.clientId) || `anon-${Date.now().toString(36)}`;
          const ext = ubExtensions.get(clientId) || { lastPoll: Date.now(), info: null };
          ext.info = hi;
          ext.lastPoll = Date.now();
          ubExtensions.set(clientId, ext);
          if (ubExtensions.size > 50) { // cap: clientId trocado/anon por boot não cresce forever
            let oldest = null;
            for (const [oid, oe] of ubExtensions) if (!oldest || oe.lastPoll < ubExtensions.get(oldest).lastPoll) oldest = oid;
            if (oldest && oldest !== clientId) ubExtensions.delete(oldest);
          }
          ubLastPoll = Date.now();
          ubExtInfo = hi;
          // cfg no hello: mon-hook quiet (sem wrap de console.* da página — inspector limpo).
          // CANIVETE_UB_MON_QUIET=0 reativa a captura (com dedupe 60s/assinatura).
          const MON_QUIET = (process.env.CANIVETE_UB_MON_QUIET ?? "1") !== "0";
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, cfg: { monQuiet: MON_QUIET } }));
          return;
        }
        else if (u.pathname === "/result") { let p = {}; try { p = JSON.parse(body); } catch (e) { process.stderr.write(`[canivete] ub /result json inválido (${e?.message || e})\n`); } const payBytes = Buffer.byteLength(body || "", "utf8"); if (payBytes > UB_WARNPAY) process.stderr.write(`[canivete] ub /result grande (${payBytes}B id=${p?.id || "?"})\n`); const q = ubPending.get(p.id); if (q) { ubPending.delete(p.id); clearTimeout(q.timer); if (payBytes > UB_MAXPAY) { const s = body || ""; const chunks = []; for (let i = 0; i < s.length; i += UB_CHUNK) chunks.push(s.slice(i, i + UB_CHUNK)); q.resolve({ id: p.id, ok: true, chunks, chunked: true, bytes: payBytes, note: "resposta fatiada em chunks; use max/compact/offset p/ refinar" }); } else q.resolve(p); } }
        else {
          // /exec: drive local (localhost+token) sem MCP stdio — mesma trava anti-destrutiva
          let p = {};
          try { p = JSON.parse(body); } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"ok":false,"error":"bad json"}'); return; }
          const a = p.args || {};
          if (ubRisk({ action: p.cmd, ...a }) === "high" && !(a.confirm && String(a.confirm).trim().length >= 4)) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: `BLOQUEADO (alto risco). Só com pedido EXPLÍCITO + confirm. Ação: ${p.cmd}` }));
            return;
          }
          const map = { status: null, diag: "tab.diag", tabs: "tabs.list", read: "tab.read", snapshot: "tab.snapshot", scan: "tab.scan", shot: "tab.shot", goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", press: "tab.press", scroll: "tab.scroll", wait: "tab.wait", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new", close: "tab.close", select: "tab.select", highlight: "tab.highlight", waittext: "tab.waittext", type: "tab.type", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow" };
          // fallthrough: qualquer tab.* futuro encaminha cru (a extensão valida e responde)
          const bridged = map[p.cmd] || (String(p.cmd || "").startsWith("tab.") ? p.cmd : null);
          if (p.cmd === "status") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, data: { connected: ubConnected(), lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1, queued: ubQueue.length, ext: ubExtInfo } })); return; }
          if (!bridged && p.cmd !== "wait") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "cmd: status|diag|tabs|read|snapshot|scan|shot|goto|back|forward|reload|click|fill|press|scroll|wait|evaluate|cursor|select|highlight|waittext|type|new|close|flow (close só aba about:blank do agente; roubar foco: PROIBIDO pelo dono)" })); return; }
          if (p.cmd === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.waitMs ?? a.ms) || 2000, 15000))); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"data":{"waited":true}}'); return; }
          const r2 = await ubSend(bridged, { ...a }, Math.min(Number(p.timeoutMs) || UB_TIMEOUT_MS, 120000));
          if (r2.__offline || r2.__timeout) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: r2.__offline ? "EXTENSAO_OFFLINE" : "TIMEOUT_EXTENSAO" })); return; }
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: !!r2.ok, data: r2.data, error: r2.error, ...(r2.chunks ? { chunks: r2.chunks, chunked: true, bytes: r2.bytes, note: r2.note } : {}) }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
        return;
      }
      res.writeHead(404); res.end("not found");
    } catch (e) { try { res.writeHead(500); res.end(String(e.message)); } catch (e2) { process.stderr.write(`[canivete] ub 500 falhou (${e2?.message || e2}) causa: ${e?.message || e}\n`); } }
  }).listen(UB_PORT, "127.0.0.1", () => process.stderr.write(`[native-mcp] ubrowser bridge em http://127.0.0.1:${UB_PORT}\n`));
  ubHttpSrv.on("error", (e) => { ubHttp = false; process.stderr.write(`[native-mcp] ubrowser porta ${UB_PORT} ocupada (${e.code}) — tentando de novo no primeiro uso\n`); });
}

ubToken(); // warm: lê/gera 1x no startup (fora do hot-path HTTP)
try { ubEnsure(); } catch (e) { process.stderr.write(`[native-mcp] ubrowser adiado: ${e.message}\n`); }

// Reports de elemento mudaram (humano marcou / agente resolveu): avisa AS extensões
// conectadas p/ re-sincronizar o cache da origin e re-aplicar os highlights — job curto
// na fila long-poll existente (sem transporte novo; sem extensão = content busca no boot).
export function ubElemNotify(origin) {
  try {
    const base = String(origin || "");
    if (!base) return;
    const now = Date.now();
    for (const [cid, e] of ubExtensions) {
      try {
        if (!e || now - e.lastPoll >= 45000) continue;
        ubQueue.push({ id: `ue${now.toString(36)}${(ubSeq++).toString(36)}`, cmd: "elem.changed", args: { origin: base }, target: cid, exp: now + 15000 });
      } catch {}
    }
    ubFlush();
  } catch {}
}
// registra o notifier no store (late-bound: sem import circular em cima do ubridge)
import("./elemreports.mjs").then((m) => { try { m.erOnChange((origin) => ubElemNotify(origin)); } catch {} }).catch(() => {});

const ubConnected = () => {
  const now = Date.now();
  if (ubExtensions.size > 0) {
    for (const [, e] of ubExtensions) if (now - e.lastPoll < 45000) return true;
    return false;
  }
  return ubLastPoll ? (now - ubLastPoll < 45000) : false;
};
const UB_OFF = "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, sem anônimo) com a extensão UBrowser ATIVA no popup, e peça de novo.";

function ubSend(cmd, args = {}, timeoutMs = UB_TIMEOUT_MS, target = null) {
  ubEnsure();
  return new Promise((resolve) => {
    if (!ubConnected()) { resolve({ __offline: true }); return; }
    const to = Math.min(Math.max(Number(timeoutMs) || UB_TIMEOUT_MS, 1000), 300000);
    const id = `u${Date.now().toString(36)}${(ubSeq++).toString(36)}`;
    const timer = setTimeout(() => { ubPending.delete(id); resolve({ __timeout: true }); }, to);
    ubPending.set(id, { resolve, timer });
    ubQueue.push({ id, cmd, args, target, exp: Date.now() + to });
    ubPrune();
    if (ubQueue.length > 50) ubQueue.splice(0, ubQueue.length - 50);
    ubFlush();
  });
}

export function ubResolveProfile(profile) {
  if (!profile) return null;
  const p = String(profile).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [id, e] of ubExtensions) {
    if (id.toLowerCase() === String(profile).toLowerCase()) return id;
    const info = e.info || {};
    const haystack = [id, info.ua || "", ...(Array.isArray(info.tabUrls) ? info.tabUrls : []), info.profileLabel || ""].join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (p && haystack.includes(p)) return id;
  }
  return null;
}

export function ubListExtensions() {
  ubPrune(); // leitura auto-saneadora: stats/erros nunca contam msg expirada como pendente
  const now = Date.now();
  return [...ubExtensions.entries()].map(([id, e]) => {
    let queued = 0;
    for (const q of ubQueue) if (q.target === null || q.target === id) queued++;
    const info = e.info;
    return {
      id,
      lastPollAgoMs: now - e.lastPoll,
      connected: now - e.lastPoll < 45000,
      ...(info && info.profileLabel ? { profileLabel: String(info.profileLabel).slice(0, 60) } : {}),
      queued, // msgs na fila dirigidas a este cliente (ou broadcast) — 0 na fila vazia
      info,
    };
  });
}

import { riskOf as ubRisk } from "./risk.mjs";

export { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubAlertsPush, ubAlertsPending, ubAlertsRead, ubAlertsHint };
export function ubStats() {
  // reutiliza ubListExtensions (fonte única): id/idade/connected/profileLabel/queued/info por cliente
  const extensions = ubListExtensions();
  return {
    queued: ubQueue.length, // fila pendente agora
    pending: ubPending.size, // idas-voltas aguardando /result (timeout/resposta pendente)
    expiredDropped: ubExpired, // acumulado: msgs descartadas por TTL (caller desistiu antes do poll)
    extensions,
    ext: ubExtInfo,
    port: UB_PORT,
    lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1,
  };
}
