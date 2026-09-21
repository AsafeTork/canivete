// canivete — contexto compartilhado: config universal (env), registro, helpers.
// Universal: sem fallback de projeto; CWD = CANIVETE_CWD || cwd().
import { spawn, execSync } from "node:child_process";
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";

const HOME = homedir();
function envStr(name, def) {
  return process.env[name] || def;
}
function envNum(name, def) {
  return Number(process.env[name]) || def;
}
function envBool(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return def;
}
const KNOWN_CANIVETE_ENVS = new Set([
  "CANIVETE_CWD",
  "CANIVETE_CTX_BUDGET",
  "CANIVETE_WALK_CAP",
  "CANIVETE_WALK_DEPTH",
  "CANIVETE_SERVE_PORT",
  "CANIVETE_SERVE_URL",
  "CANIVETE_TASK_MODE",
  "CANIVETE_RUNNER",
  "CANIVETE_RUN_TEMPLATE",
  "CANIVETE_SERVER_NAME",
  "CANIVETE_LLM_BASE_URL",
  "CANIVETE_LLM_API_KEY",
  "CANIVETE_LLM_MODEL",
  "CANIVETE_LLM_PROVIDER",
  "CANIVETE_LLM_2_BASE_URL",
  "CANIVETE_LLM_2_API_KEY",
  "CANIVETE_LLM_2_MODEL",
  "CANIVETE_LLM_3_BASE_URL",
  "CANIVETE_LLM_3_API_KEY",
  "CANIVETE_LLM_3_MODEL",
  "CANIVETE_LLM_4_BASE_URL",
  "CANIVETE_LLM_4_API_KEY",
  "CANIVETE_LLM_4_MODEL",
  "CANIVETE_LLM_5_BASE_URL",
  "CANIVETE_LLM_5_API_KEY",
  "CANIVETE_LLM_5_MODEL",
  "CANIVETE_LLM_TIMEOUT",
  "CANIVETE_LLM_MAX_TOKENS",
]);
try {
  const unknown = Object.keys(process.env).filter((k) => k.startsWith("CANIVETE_") && !KNOWN_CANIVETE_ENVS.has(k));
  if (unknown.length) console.error(`[canivete] unknown CANIVETE_* env var(s) (possible typo): ${unknown.join(", ")}`);
} catch {}
let CWD = envStr("CANIVETE_CWD", process.cwd());
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".next", ".cache"]);
const MAX_OUT = 30000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) FinanciaNative/1.0";

const TOOLS = new Map();

const CTX = { calls: 0, chars: 0, byTool: new Map(), t0: Date.now() };
const CTX_BUDGET = envNum("CANIVETE_CTX_BUDGET", 200000); // chars de saída nesta sessão
// DOOM-GUARD: mesma signature (nome + hash(args) + hash(result.slice(0,500))) 3x consecutivas → prefixe guard.
// Base: OpenRouter doom-loop (observe@2/block@3), NiteAgent ToolCallSignature, PraisonAI poll_no_progress. Leve: Map cap 50.
const DOOM_POLL = new Set(["n_task_wait", "n_task_status", "n_task_tail", "n_task_recv"]);
const DOOM_SEEN = new Map(); // sig -> streak consecutiva
let DOOM_LAST = "";
function doomHash(s) {
  s = String(s ?? "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h.toString(36);
}
function doomSig(name, args, resultText) {
  return `${name}:${doomHash(JSON.stringify(args ?? null))}:${doomHash(String(resultText ?? "").slice(0, 500))}`;
}
function isDoomPoll(name, args) {
  if (DOOM_POLL.has(name)) return true;
  if (name === "n_manage_background_process" && args?.action === "read_logs") return true;
  return false;
}
function reg(name, definition) {
  const orig = definition.run;
  definition.run = async (args) => {
    const r = await orig(args);
    try {
      if (name === "n_tools_info" && r?.content?.[0] && typeof r.content[0].text === "string") {
        r.content[0].text = capOut(r.content[0].text);
      }
    } catch {}
    try {
      CTX.calls++;
      CTX.chars += JSON.stringify(r).length;
      CTX.byTool.set(name, (CTX.byTool.get(name) || 0) + 1);
    } catch {}
    try {
      if (!isDoomPoll(name, args)) {
        let resultText = "";
        try {
          resultText = r?.content?.[0]?.text ?? JSON.stringify(r);
        } catch {
          resultText = String(r ?? "");
        }
        const sig = doomSig(name, args, resultText);
        const streak = sig === DOOM_LAST ? (DOOM_SEEN.get(sig) || 1) + 1 : 1;
        DOOM_SEEN.set(sig, streak);
        DOOM_LAST = sig;
        if (DOOM_SEEN.size > 50) {
          for (const k of DOOM_SEEN.keys()) {
            if (k !== sig) {
              DOOM_SEEN.delete(k);
              break;
            }
          }
        }
        if (streak >= 3 && r?.content?.[0] && typeof r.content[0].text === "string") {
          r.content[0].text = `[REPETITION GUARD] mesma chamada 3x com mesmo resultado — PARE, mude args ou abordagem\n${r.content[0].text}`;
        }
      }
    } catch {}
    return r;
  };
  TOOLS.set(name, { name, ...definition });
}

function out(text, error) {
  const result = { content: [{ type: "text", text: String(text) }] };
  if (error) result.isError = true;
  return result;
}

function trimOut(s, n = MAX_OUT) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} chars]` : s;
}

function capOut(s) {
  return trimOut(s, 8000);
}

function fpath(p) {
  if (typeof p !== "string" || !p) throw new Error("path is required (string)");
  if (p.startsWith("/")) return p;
  if (p.startsWith("~")) return join(HOME, p.slice(1));
  return join(CWD, p);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WALK_CAP = envNum("CANIVETE_WALK_CAP", 8000); // culpa do dev se varrer o disco (era ilimitado)
const WALK_MAX_DEPTH = envNum("CANIVETE_WALK_DEPTH", 8); // teto de profundidade: evita varrer disco no hot-path (sync readdir por nível)
// binários/mídias que nunca contêm símbolo pesquisável (culpa do dev se ler lixo)
const BIN_EXT = new Set("png,jpg,jpeg,gif,bmp,ico,webp,mp4,mkv,webm,mp3,ogg,wav,flac,ttf,otf,woff,woff2,zip,tar,gz,xz,7z,bz2,deb,rpm,exe,msi,dmg,iso,img,so,dll,dylib,a,o,class,pyc,pyo,db,sqlite,sqlite-journal,dat,bin,pdf,doc,docx,xls,xlsx,ppt,pptx,epub,torrent,lock,map".split(","));
function isSkippable(f) {
  const i = String(f).toLowerCase().lastIndexOf(".");
  return i >= 0 && BIN_EXT.has(String(f).toLowerCase().slice(i + 1));
}
function walkFiles(root, outArr, rel = "", depth = 0) {
  if (outArr.length >= WALK_CAP) return;
  if (depth > WALK_MAX_DEPTH) return; // hot-path: readdirSync recursivo limitado
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (outArr.length >= WALK_CAP) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (rel && e.name.startsWith(".")) continue; // ocultas aninhadas (top-level explícito passa)
      walkFiles(root, outArr, rel ? join(rel, e.name) : e.name, depth + 1);
    } else if (e.isFile()) {
      const fname = rel ? join(rel, e.name) : e.name;
      if (isSkippable(fname)) continue; // binário nunca tem símbolo pesquisável — poupa readFileSync a jusante
      outArr.push(fname);
    }
  }
}

function humanSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1048576).toFixed(1)}M`;
}

async function exec(cmd, args, { timeout = 120000, cwd = CWD, env = {} } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let so = "";
    let se = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => (so += d));
    child.stderr.on("data", (d) => (se += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code, so, se, killed, error: null });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({ code: -1, so, se, killed, error: err.message });
    });
  });
}

async function httpJson(url, { timeout = 30000, headers = {}, method, body } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      method: method || "GET",
      headers: { "user-agent": UA, ...headers },
      body: body || undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  } catch (e) {
    return { status: 0, data: null, text: e.message };
  } finally {
    clearTimeout(t);
  }
}

function devOut({ status = "success", summary = "", data = {}, telemetry = {}, next = [], refs = [] }) {
  const payload = {
    status,
    summary,
    data,
    telemetry: { tokens_saved: telemetry.tokens_saved || 0, execution_time_ms: telemetry.execution_time_ms || 0, ...telemetry },
    next_suggested_actions: next,
    context_refs: refs,
  };
  return out(JSON.stringify(payload, null, 2), status === "error");
}
function estTokens(s) {
  return Math.ceil(String(s || "").length / 4);
}
function ctxStatusText() {
  const pct = CTX_BUDGET ? (CTX.chars / CTX_BUDGET) * 100 : 0;
  const base = `ctx: ${CTX.calls} calls, ${CTX.chars}/${CTX_BUDGET} chars (${pct.toFixed(1)}%)`;
  return pct > 80 ? `${base} — dica: uso >80%, prefira mode:distill/compact` : base;
}

function sendToHost(obj) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
}

export { HOME, CWD, SKIP_DIRS, MAX_OUT, UA, TOOLS, reg, out, trimOut, capOut, fpath, escapeRe, walkFiles, humanSize, exec, httpJson, sendToHost, devOut, estTokens, ctxStatusText, WALK_CAP, WALK_MAX_DEPTH, isSkippable, CTX, CTX_BUDGET };
