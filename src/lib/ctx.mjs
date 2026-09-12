// canivete — contexto compartilhado: config universal (env), registro, helpers.
// Universal: sem fallback de projeto; CWD = CANIVETE_CWD || cwd().
import { spawn, execSync } from "node:child_process";
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";

const HOME = homedir();
let CWD = process.env.CANIVETE_CWD || process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".next", ".cache"]);
const MAX_OUT = 30000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) FinanciaNative/1.0";

const TOOLS = new Map();

const CTX = { calls: 0, chars: 0, byTool: new Map(), t0: Date.now() };
const CTX_BUDGET = Number(process.env.CANIVETE_CTX_BUDGET) || 200000; // chars de saída nesta sessão
function reg(name, definition) {
  const orig = definition.run;
  definition.run = async (args) => {
    const r = await orig(args);
    try {
      CTX.calls++;
      CTX.chars += JSON.stringify(r).length;
      CTX.byTool.set(name, (CTX.byTool.get(name) || 0) + 1);
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

function fpath(p) {
  if (typeof p !== "string" || !p) throw new Error("path is required (string)");
  if (p.startsWith("/")) return p;
  if (p.startsWith("~")) return join(HOME, p.slice(1));
  return join(CWD, p);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WALK_CAP = Number(process.env.CANIVETE_WALK_CAP) || 8000; // culpa do dev se varrer o disco (era ilimitado)
// binários/mídias que nunca contêm símbolo pesquisável (culpa do dev se ler lixo)
const BIN_EXT = new Set("png,jpg,jpeg,gif,bmp,ico,webp,mp4,mkv,webm,mp3,ogg,wav,flac,ttf,otf,woff,woff2,zip,tar,gz,xz,7z,bz2,deb,rpm,exe,msi,dmg,iso,img,so,dll,dylib,a,o,class,pyc,pyo,db,sqlite,sqlite-journal,dat,bin,pdf,doc,docx,xls,xlsx,ppt,pptx,epub,torrent,lock,map".split(","));
function isSkippable(f) {
  const i = String(f).toLowerCase().lastIndexOf(".");
  return i >= 0 && BIN_EXT.has(String(f).toLowerCase().slice(i + 1));
}
function walkFiles(root, outArr, rel = "") {
  if (outArr.length >= WALK_CAP) return;
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
      walkFiles(root, outArr, rel ? join(rel, e.name) : e.name);
    } else if (e.isFile()) {
      outArr.push(rel ? join(rel, e.name) : e.name);
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

function sendToHost(obj) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
}

export { HOME, CWD, SKIP_DIRS, MAX_OUT, UA, TOOLS, reg, out, trimOut, fpath, escapeRe, walkFiles, humanSize, exec, httpJson, sendToHost, devOut, estTokens, WALK_CAP, isSkippable, CTX, CTX_BUDGET };
