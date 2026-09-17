// canivete — orquestração: spawn de subagentes (runner plugável) + mailbox + todos + meta(skills)
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, watch } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { reg, out, trimOut, CWD, HOME, sendToHost } from "./ctx.mjs";

const todo = [];

// ---- canivete: configuração universal (env) ----
// ENV: CANIVETE_RUNNER=opencode=runner (opencode|path absoluto|genérico via RUN_TEMPLATE)
// ENV: CANIVETE_RUN_TEMPLATE=""=template genérico {prompt} {model} {agent} {id} (ex: "claude -p {prompt}")
// ENV: CANIVETE_TASK_PREFIX=canivete-task-=prefixo do --title da sessão opencode
// ENV: CANIVETE_HOST_GUARD_MS=170000=clamp máx de resposta sync (resto segue em background)
// ENV: CANIVETE_MAX_MSGS=100=teto de msgs por mailbox (pushCapped fatia p/ últimas N)
// ENV: CANIVETE_MAX_MSG_CHARS=4000=teto de chars por msg (excesso trunca com ...[truncated N chars])
// ENV: CANIVETE_MAX_POLLS=8=teto de polls ativos (acima começa em POLL_MAX_MS)
// ENV: CANIVETE_AGENTS=mcp-only,explore,quick,general,reviewer=lista de subagent_type válidos
// ENV: CANIVETE_MODELS_FILE=../../config/models.json=arquivo JSON com allowlist de modelos free
// ENV: CANIVETE_SERVER_NAME=canivete=prefixo exibido das tools (n_* vs <prefixo>_n_*) no orchestrationNote
// ENV: CANIVETE_WATCH_MAIN=(unset, só "1" ativa)=observa caixa "main" p/ push 📬 (modo stdio/local)
// ENV: CANIVETE_WATCH=""=caixas extras p/ push 📬 (CSV, ex: "box1,box2")
const RUNNER = process.env.CANIVETE_RUNNER || "opencode";
const isOpencode = RUNNER === "opencode" || RUNNER.endsWith("/opencode");
// Binário real do opencode: respeita CANIVETE_RUNNER absoluto + fallbacks de PATH mínimo do host MCP.
// Dirs extras garantidos no PATH de spawn/exec (MCP roda com PATH mínimo via `node src/server.mjs --http`).
const EXTRA_BIN_DIRS = ["/home/tork/.local/bin", "/usr/local/bin"];
function augmentedPath(base) {
  const cur = String(base ?? process.env.PATH ?? "/usr/bin:/bin");
  const parts = cur.split(":").filter(Boolean);
  for (const d of [...EXTRA_BIN_DIRS].reverse()) {
    if (d && !parts.includes(d)) parts.unshift(d);
  }
  try {
    const hd = join(HOME, ".local/bin");
    if (hd && !parts.includes(hd)) parts.unshift(hd);
  } catch {}
  return parts.join(":");
}
function augmentedEnv(extra = {}) {
  return { ...process.env, ...extra, PATH: augmentedPath(process.env.PATH) };
}
const OPENCODE_BIN = (() => {
  if (RUNNER.includes("/")) return RUNNER;
  const seen = new Set();
  const cands = [];
  try {
    const hd = join(HOME, ".local/bin/opencode");
    if (!seen.has(hd)) { seen.add(hd); cands.push(hd); }
  } catch {}
  for (const d of EXTRA_BIN_DIRS) {
    const c = `${d}/opencode`;
    if (!seen.has(c)) { seen.add(c); cands.push(c); }
  }
  try {
    for (const c of cands) { if (existsSync(c)) return c; }
  } catch {}
  try {
    const found = execFileSync("sh", ["-c", "command -v opencode"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: augmentedEnv(),
    }).trim().split("\n")[0]?.trim();
    if (found) return found;
  } catch {}
  return "opencode";
})();
// Template genérico: {prompt} {model} {agent} {id} (ex: "claude -p {prompt}", "codex exec {prompt}")
const RUN_TEMPLATE = process.env.CANIVETE_RUN_TEMPLATE || "";
const TASK_TITLE_PREFIX = process.env.CANIVETE_TASK_PREFIX || "canivete-task-";
const HOST_GUARD_MS = Number(process.env.CANIVETE_HOST_GUARD_MS) || 170000;
const MAX_MSGS = Number(process.env.CANIVETE_MAX_MSGS) || 100;
const MAX_MSG_CHARS = Number(process.env.CANIVETE_MAX_MSG_CHARS) || 4000;
const KNOWN_AGENTS = (process.env.CANIVETE_AGENTS || "mcp-only,explore,quick,general,reviewer").split(",").map((s) => s.trim()).filter(Boolean);

// ---- segurança: escapes contra injeção shell/SQL (prompt/model/agent/id vêm do LLM) ----
// Shell: envolve em aspas simples; `'` interno vira `'"'"'` (fecha, aspas-duplas, reabre).
function escapeShellArg(s) {
  return `'${String(s ?? "").replace(/'/g, `'"'"'`)}'`;
}
// SQL (SQLite via `opencode db "<sql>"`): dobra `'` para não quebrar o literal nem injetar.
function escapeSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}
// Timeouts curtos: a chamada ao binário é síncrona (bloqueia o event-loop);
// 5s/8s limitam a janela — caches abaixo evitam as chamadas quentes.
const DB_QUERY_TIMEOUT_MS = Number(process.env.CANIVETE_DB_TIMEOUT_MS) || 5000;
const EXPORT_TIMEOUT_MS = Number(process.env.CANIVETE_EXPORT_TIMEOUT_MS) || 8000;
// ---- poll tuning (perf): backoff exponencial + teto de concorrência ----
const POLL_BASE_MS = 2000;
const POLL_MID_MS = 4000;
const POLL_MAX_MS = 8000;
const MAX_ACTIVE_POLLS = Number(process.env.CANIVETE_MAX_POLLS) || 8;
const activePolls = new Set();
function pollJitter(ms) { return Math.round(ms * (0.85 + Math.random() * 0.3)); }
function nextPollDelay(cur) { if (cur <= POLL_BASE_MS) return POLL_MID_MS; if (cur < POLL_MAX_MS) return POLL_MAX_MS; return POLL_MAX_MS; }
function logWarn(...a) { try { console.error("[canivete-tasks]", ...a); } catch {} }
function loadModels() {
  const defaults = ["opencode/muse-spark-1.2-contributor-free", "opencode/muse-spark-1.3-contributor-free", "opencode/big-pickle"];
  try {
    const p = process.env.CANIVETE_MODELS_FILE || new URL("../../config/models.json", import.meta.url);
    const arr = JSON.parse(readFileSync(p, "utf8"));
    if (Array.isArray(arr) && arr.length) return arr.map(String);
  } catch {}
  return defaults;
}
const FREE_MODELS = loadModels();
function runnerMissing() {
  if (isOpencode) {
    try {
      if (OPENCODE_BIN.includes("/")) { if (!existsSync(OPENCODE_BIN)) throw new Error("missing"); return null; }
      // sem shell: procura no PATH via fs (evita injeção via CANIVETE_RUNNER em `command -v ${bin}`)
      const pathDirs = augmentedPath().split(":").filter(Boolean);
      const onPath = pathDirs.some((d) => { try { return existsSync(join(d, OPENCODE_BIN)); } catch { return false; } });
      if (!onPath) throw new Error("missing");
      return null;
    }
    catch { return "binário 'opencode' não encontrado — defina CANIVETE_RUNNER + CANIVETE_RUN_TEMPLATE (modo genérico) ou instale o opencode"; }
  }
  if (!RUN_TEMPLATE) return "modo genérico sem CANIVETE_RUN_TEMPLATE — ex: CANIVETE_RUN_TEMPLATE=\"claude -p {prompt}\"";
  return null;
}

function cwdTag(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
  return h.toString(36);
}
const BROKER_DIR = process.env.MCP_BROKER_DIR || join(HOME, `.config/canivete/broker-${cwdTag(CWD)}`);
const TASKS_DIR = join(BROKER_DIR, "tasks");
const MB_DIR = join(BROKER_DIR, "mailbox");

const writeLocks = new Map();
async function writeJson(file, data) {
  const prev = writeLocks.get(file) || Promise.resolve();
  const cur = prev
    .then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
    })
    .catch((e) => { try { console.error(`[canivete-tasks] writeJson falhou ${file}: ${e?.message || e}`); } catch {} });
  writeLocks.set(file, cur);
  await cur;
  if (writeLocks.get(file) === cur) writeLocks.delete(file); // era vazamento: 1 entrada por arquivo p/ sempre
}
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function persistTask(t) {
  await writeJson(join(TASKS_DIR, `${t.id}.json`), t);
  try { evictTasks(); } catch (e) { logWarn(`evictTasks falhou: ${e?.message || e}`); }
}

function safeTaskIds() {
  try {
    return readdirSync(TASKS_DIR).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

const tasks = new Map();
const TASKS_MEM_CAP = 20; // teto do índice em memória (era 60: cada n_task ficava p/ sempre com tailRaw de 8KB)
function evictTasks() {
  if (tasks.size <= TASKS_MEM_CAP) return;
  for (const [id, t] of tasks) {
    if (tasks.size <= TASKS_MEM_CAP) break;
    if (t && t.status !== "running") tasks.delete(id); // finalizada sai da RAM; resolveTask relê do disco
  }
}
let taskSeq = 0;
const taskId = () => `t${Date.now().toString(36)}${(++taskSeq).toString(36)}`;

function parseAgentOutput(so) {
  const chunks = [];
  const toolCalls = [];
  try {
    const events = so
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    for (const e of events) {
      const parts = e.parts || (e.part ? [e.part] : []);
      if ((e.type === "tool_use" || e.type === "tool-call") && e.name) parts.push({ type: "tool", tool: e.name });
      for (const p of parts) {
        if (p.type === "text" && p.text) chunks.push(p.text);
        const toolName = p.tool || p.name;
        if ((p.type === "tool" || p.type === "tool_use" || p.type === "tool-call" || p.type === "tool_call" || p.type === "function") && toolName) {
          const t = String(toolName).startsWith("native_") ? String(toolName).slice(7) : String(toolName);
          toolCalls.push(t.startsWith("n_") ? t : `NÃO-MCP:${t}`);
        }
      }
    }
  } catch {
    /* event stream may contain non-JSON banner lines */
  }
  return { chunks, toolCalls };
}

function orchestrationNote(id) {
  const pfx = process.env.CANIVETE_SERVER_NAME || "canivete";
  return `[ORCHESTRATION] Você é o agente ${id}. OBEDIÊNCIA TOTAL às tools — o principal AUDITA n_task_status e RECUSA entrega sem tools certas.
- Nomes: tools aparecem como ${pfx}_n_* (prefixo); "n_*" é o mesmo nome. Prefira sempre n_*.
- PROIBIDO fazer na mão o que tem tool: ler=n_read (nunca cat/head), buscar=n_grep/n_glob (nunca grep/find), web=n_webfetch/n_websearch, patch=n_apply_patch/n_apply_semantic_patch. Bash SÓ p/ o que não tem tool.
- ROTEAMENTO OBRIGATÓRIO: entender projeto→n_get_architecture_summary; bug/erro→n_investigate_issue; antes de editar→n_analyze_change_impact; editar JS→n_apply_semantic_patch; depois→validar (n_execute_targeted_tests ou n_bash); página com JS→n_browser_navigate; Chrome do dono→n_ubrowser_status→tabs→read/snapshot→act→shot; dúvida→n_tools_info.
- PROIBIDO chutar path/API/versão/comportamento: VERIFIQUE com tool e cite arquivo:linha como evidência.
- Modelos: o principal escolheu este explicitamente via n_list_models. opencode-go/*, hy3-free e desconhecidos são BLOQUEADOS (isError).
- Comunicação (confie no MCP, SEM polling manual): dispare background (id em mãos = abort-safe) → UMA chamada n_task_wait com timeout longo → leia. NUNCA sleep/status em loop. Subagente: ao concluir, SEMPRE n_task_send({task_id:"main", message:"done <id> + resumo 1 linha"}) — o principal acorda pela notificação. Peers: handshake + recv com timeout. Mailbox tem teto; recv esvazia (destrutivo); delete em running mata. REGRA DE OURO: nunca termine com mailbox própria cheia — recv({timeout:30000}) até 2x vazio. Respostas trazem 📬 — leia n_task_notifications.
- Dono: acesso total QUANDO ELE PEDIR; NUNCA destrutivo sem pedido explícito; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO PROIBIDOS.
- ENTREGA = resultado + n_task_send main ("done <id>") + ## Tools usados (toda n_* invocada). Zero tools, tool improvisada ou sem evidência = RECUSADA.
- REFINE A FERRAMENTA: travou, faltou tool/capacidade ou gargalo? NUNCA improvise — registre n_report({kind,where,expected,got}) e siga pelo alternativo.\n\n`;
}

const NOTIF_DIR = join(BROKER_DIR, "notifications");
mkdirSync(NOTIF_DIR, { recursive: true });

// ---- entrega AUTOMÁTICA (modo stdio/local): observa as caixas e empurra 📬 p/ sessão ----
// Cada servidor observa sua própria caixa (TASK_ID do worker) + "main" se CANIVETE_WATCH_MAIN=1
// (+ extras em CANIVETE_WATCH, vírgula). No modo remoto (HTTP) não há push — vale o handshake.
const WATCH_BOXES = [...new Set([
  ...(process.env.TASK_ID ? [process.env.TASK_ID] : []),
  ...(process.env.CANIVETE_WATCH_MAIN === "1" ? ["main"] : []),
  ...(process.env.CANIVETE_WATCH || "").split(",").map((s) => s.trim()).filter(Boolean),
])];
if (WATCH_BOXES.length) {
  try {
    mkdirSync(MB_DIR, { recursive: true });
    const known = new Map(); // box -> "len:lastTs"
    const sigOf = (box) => (box && box.msgs && box.msgs.length ? `${box.msgs.length}:${box.msgs[box.msgs.length - 1].ts}` : "");
    for (const id of WATCH_BOXES) {
      try { known.set(id, sigOf(readJson(join(MB_DIR, `${id}.json`), null))); } catch { known.set(id, ""); }
    }
    let timer = null;
    const check = () => {
      for (const id of WATCH_BOXES) {
        let box = null;
        try { box = readJson(join(MB_DIR, `${id}.json`), null); } catch {}
        const sig = sigOf(box);
        if (sig && sig !== known.get(id)) {
          known.set(id, sig);
          const last = box.msgs[box.msgs.length - 1];
          try {
            sendToHost({ method: "notifications/message", params: { level: "info", logger: "canivete", data: `📬 ${box.msgs.length} nova(s) p/ ${id} de ${last.from}: ${String(last.message).slice(0, 200)} — leia com n_task_recv` } });
          } catch {}
        } else if (!sig) known.set(id, "");
      }
    };
    watch(MB_DIR, (ev, file) => {
      if (file && String(file).endsWith(".json")) { clearTimeout(timer); timer = setTimeout(check, 800); }
    }).on("error", () => {});
  } catch {}
}

async function notifyMain(taskId, status, description, model, summary) {
  const ts = new Date().toISOString();
  const payload = { taskId, status, description, model, ts, summary: (summary || "").slice(0, 500) };
  try {
    await writeJson(join(NOTIF_DIR, `${taskId}.json`), payload);
  } catch (e) { logWarn(`notifyMain write notif falhou ${taskId}: ${e?.message || e}`); }
  try { // poda: notificações nunca lidas cresciam sem teto no broker-shared (n_task_notifications esvazia ao ler)
    const fs2 = readdirSync(NOTIF_DIR).filter((f) => f.endsWith(".json"));
    if (fs2.length > 50) {
      const withMt = fs2.map((f) => { try { return { f, mt: statSync(join(NOTIF_DIR, f)).mtimeMs }; } catch { return { f, mt: 0 }; } });
      withMt.sort((a, b) => a.mt - b.mt);
      for (const { f } of withMt.slice(0, withMt.length - 50)) { try { await unlink(join(NOTIF_DIR, f)); } catch (e) { logWarn(`notifyMain prune falhou ${f}: ${e?.message || e}`); } }
    }
  } catch (e) { logWarn(`notifyMain prune scan falhou: ${e?.message || e}`); }
  try {
    const mainMailbox = join(MB_DIR, "main.json");
    let box;
    try { box = JSON.parse(readFileSync(mainMailbox, "utf8")); } catch { box = { msgs: [] }; }
    pushCapped(box, taskId, `[${ts}] task ${taskId} (${description}) — ${status}`);
    await writeJson(mainMailbox, box);
  } catch (e) { logWarn(`notifyMain mailbox falhou ${taskId}: ${e?.message || e}`); }
}

function procAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    if (cmd && !/opencode/.test(cmd)) return false; // pid reciclado por outro processo
  } catch {}
  return true;
}

function tryKill(t) {
  if (!t || t.status !== "running" || !t.pid || !procAlive(t.pid)) return null;
  const pid = t.pid;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return null;
  }
  setTimeout(() => { try { if (procAlive(pid)) process.kill(pid, "SIGKILL"); } catch {} }, 3000).unref?.();
  return pid;
}

async function sweepTask(t) {
  if (!t || t.status !== "running") return t;
  // devengine tasks (n_orchestrate_task) usam pollDb próprio — finalizar normalmente
  const age = Date.now() - new Date(t.startedAt).getTime();
  const deadPid = t.pid && !procAlive(t.pid);
  const staleNoPid = !t.pid && age > 60000;
  if (deadPid) {
    try {
      const finalized = await finalizeDetachedIfDead(t.id).catch((e) => { logWarn(`sweep finalize falhou ${t.id}: ${e?.message || e}`); return null; });
      if (finalized) return finalized;
    } catch (e) { logWarn(`sweep falhou ${t?.id}: ${e?.message || e}`); /* finalize failed, fall through to staleNoPid check */ }
  }
  if (staleNoPid) {
    t.status = "interrupted";
    t.finishedAt = new Date().toISOString();
    t.error = `[modelo: ${t.model || "unknown"}] interrompida — sem PID gravado após 60s (spawn interrompido)`;
    await persistTask(t);
    await notifyMain(t.id, "interrupted", t.description || "", t.model || "", t.error).catch((e) => logWarn(`sweep notify falhou ${t.id}: ${e?.message || e}`));
  }
  return t;
}

function isExpiredMsg(m) {
  return !!(m && m.expiresAt && Date.now() > m.expiresAt);
}
function msgAgeMs(m) {
  try { return Math.max(0, Date.now() - new Date(m.ts).getTime()); } catch { return 0; }
}
function pruneExpiredBox(box) {
  if (!box || !Array.isArray(box.msgs)) return box;
  const kept = box.msgs.filter((m) => !isExpiredMsg(m));
  if (kept.length !== box.msgs.length) box.msgs = kept;
  return box;
}
function pushCapped(box, from, message, ttlMs) {
  const m = String(message ?? "");
  if (!box || !Array.isArray(box.msgs)) box = { msgs: [] };
  const entry = { from, ts: new Date().toISOString(), message: m.length > MAX_MSG_CHARS ? m.slice(0, MAX_MSG_CHARS) + `...[truncated ${m.length - MAX_MSG_CHARS} chars]` : m };
  const ttl = Number(ttlMs);
  if (Number.isFinite(ttl) && ttl > 0) entry.expiresAt = Date.now() + ttl;
  box.msgs.push(entry);
  if (box.msgs.length > MAX_MSGS) box.msgs = box.msgs.slice(-MAX_MSGS);
  return box;
}

function pendingHints() {
  try {
    const n = readdirSync(NOTIF_DIR).length;
    if (n) return `\n📬 ${n} notificação(ões) pendente(s) — leia n_task_notifications`;
  } catch {}
  return "";
}

reg("n_task", {
  description: "Spawn subagente isolado (opencode ou genérico via CANIVETE_RUN_TEMPLATE). model OBRIGATÓRIO no opencode: n_list_models → passe em {model}. Tipos: mcp-only|explore|quick|general|reviewer. WORKFLOW: fan-out N× background:true → n_task_wait any/all → n_task_send. Sync bloqueia; fim notifica. Ao vivo: n_task_tail.",
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string" },
      subagent_type: { type: "string", description: "Agent: mcp-only (default), quick, explore, general ou reviewer", default: "mcp-only" },
      prompt: { type: "string", description: "Self-contained instructions" },
      model: { type: "string", description: "OBRIGATÓRIO — escolha explícita do modelo. Descubra os disponíveis com n_list_models antes de chamar." },
      timeout: { type: "number", default: 600000 },
      background: { type: "boolean", description: "Spawn without waiting (default false). Returns task_id immediately." },
      ephemeral: { type: "boolean", description: "Se true, auto-exclui task/mailbox após done (para coletores só de info)" },
      depends_on: { type: "array", items: { type: "string" }, description: "Aguarda deps done/failed/timeout antes de spawnar; se alguma falhar vira skipped." },
      label: { type: "string", description: "Apelido curto exibido no status no lugar do id." },
      items: { type: "array", items: { type: "string" }, description: "BATCH opt-in: N prompts em 1 processo opencode (1 PID). Quando presente, concatena em ÚNICO spawn com ### JOB i/N ### e o worker responde entre ### RESULT i ###; finalize fatia por item (fallback integral)." },
    },
    required: ["model"],
  },
  run: async ({ description, subagent_type, prompt, model, timeout, background, ephemeral, depends_on, label, items }) => {
    // BATCH opt-in: N jobs em 1 processo opencode (1 PID). Sem items → caminho original abaixo, inalterado.
    // Cada `opencode run` é 1 processo OS novo sem reuso (--session continua sessão mas ainda é processo novo),
    // por isso N spawns = N×~200MB-1GB; batch = 1 spawn (~200MB-1GB totais, economia (N-1)×).
    const _batchRaw = items;
    const _isBatch = Array.isArray(_batchRaw) && _batchRaw.length > 0;
    let _batchTotal = 0;
    let _batchItems = null;
    const _sliceBatch = (text, total) => {
      const src = String(text ?? "");
      const re = /###\s*RESULT\s+(\d+)\s*###/g;
      const ms = [...src.matchAll(re)];
      if (!ms.length) return Array.from({ length: total }, () => src.trim());
      const outArr = Array.from({ length: total }, () => "");
      for (let k = 0; k < ms.length; k++) {
        const idx = Number(ms[k][1]) - 1;
        const s = ms[k].index + ms[k][0].length;
        const e = k + 1 < ms.length ? ms[k + 1].index : src.length;
        const chunk = src.slice(s, e).trim();
        if (idx >= 0 && idx < total && !outArr[idx]) outArr[idx] = chunk;
      }
      return outArr;
    };
    const _buildBatchPrompt = (shared, arr) => {
      const total = arr.length;
      const head = shared && String(shared).trim() ? `${String(shared).trim()}\n\n` : "";
      return `${head}Você está em modo BATCH com ${total} jobs em 1 processo (economia ${total}×200MB→1×).\nResponda cada JOB separadamente entre marcadores ### RESULT i ### (exatamente um por job, na ordem).\nFormato obrigatório:\n### RESULT 1 ###\n<resposta do job 1>\n### RESULT 2 ###\n<resposta do job 2>\n...\nNão misture jobs no mesmo bloco. Não omita nenhum marcador.\n\n${arr.map((p, i) => `### JOB ${i + 1}/${total} ###\n${p}`).join("\n\n")}`;
    };
    if (_batchRaw !== undefined && _batchRaw !== null && !_isBatch) {
      return out(`items inválido: esperado string[] não-vazio com os N prompts do batch.`, true);
    }
    if (_isBatch) {
      if (_batchRaw.some((s) => typeof s !== "string" || !s.trim())) {
        return out(`items inválido: todo item deve ser string não-vazia (recebido ${_batchRaw.length} item(ns)).`, true);
      }
      _batchItems = _batchRaw.map((s) => String(s));
      _batchTotal = _batchItems.length;
      prompt = _buildBatchPrompt(prompt, _batchItems);
    }
    if (!model && isOpencode) {
      return out(`model é OBRIGATÓRIO — escolha explícita. Chame n_list_models para ver os disponíveis e passe um deles em n_task({model}).`, true);
    }
    if (!model && !isOpencode) model = "default";
    if (isOpencode && String(model).startsWith("opencode-go/")) {
      return out(`modelo bloqueado: "${model}" é opencode-go (pago/instável). Chame n_list_models e escolha um free zen: ${FREE_MODELS.join(", ")}`, true);
    }
    if (isOpencode && String(model) === "opencode/hy3-free") {
      return out(`modelo "${model}" quebrado (não listado em opencode models). Chame n_list_models e escolha um free zen: ${FREE_MODELS.join(", ")}`, true);
    }
    if (isOpencode && !FREE_MODELS.includes(String(model))) {
      return out(`modelo desconhecido: "${model}". Chame n_list_models e escolha um da lista: ${FREE_MODELS.join(", ")}`, true);
    }
    const agent = subagent_type || "mcp-only";
    if (!KNOWN_AGENTS.includes(agent)) {
      return out(`subagent_type desconhecido: "${agent}". Válidos: ${KNOWN_AGENTS.join(", ")}`, true);
    }
    const t = timeout || 600000;
    const shortLabel = typeof label === "string" ? label.trim().slice(0, 40) : "";
    const deps = [...new Set((Array.isArray(depends_on) ? depends_on : []).map((d) => String(d).trim()).filter(Boolean))];
    if (deps.length) {
      const unknown = deps.filter((d) => !resolveTask(d));
      if (unknown.length) return out(`depends_on inválida: task(s) não encontrada(s): ${unknown.join(", ")}`, true);
      const depWaitMs = Math.min(t, HOST_GUARD_MS);
      const depDeadline = Date.now() + depWaitMs;
      for (;;) {
        let still = [];
        let states = [];
        for (const d of deps) {
          let dt = resolveTask(d);
          if (dt && dt.status === "running") {
            try { dt = await sweepTask(dt); } catch {}
            if (dt && dt.status === "running") {
              try { dt = (await finalizeDetachedIfDead(d).catch(() => null)) || dt; } catch {}
            }
          }
          states.push(dt);
          if (dt && dt.status === "running") still.push(d);
        }
        if (!still.length) {
          const bad = states.filter((dt, i) => !dt || (dt.status !== "done"));
          if (bad.length) {
            const badIds = bad.map((dt, i) => `${deps[i]} (${dt?.status || "not found"})`).join(", ");
            const sid = taskId();
            const skipped = {
              id: sid,
              agent,
              description: ephemeral ? `[ephemeral] ${description || ""}`.trim() : description || "",
              model: String(model),
              ephemeral: !!ephemeral,
              status: "skipped",
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              exitCode: null,
              pid: null,
              lastActivityAt: null,
              tools: [],
              error: `[DAG] skipped — dependência(s) falhou(ram): ${badIds}`,
              result: null,
              depends_on: deps,
              label: shortLabel,
            };
            tasks.set(sid, skipped);
            await persistTask(skipped);
            await notifyMain(sid, "skipped", description, String(model), skipped.error).catch(() => {});
            return out(`task ${shortLabel ? `${shortLabel} (${sid})` : sid} skipped — depends_on falhou: ${badIds}`, true);
          }
          break;
        }
        if (Date.now() >= depDeadline) {
          return out(`depends_on pendente após ${Math.round(depWaitMs / 1000)}s — ainda rodando: ${still.join(", ")} (chame de novo quando deps terminarem)`, true);
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(1, depDeadline - Date.now()))));
      }
    }
    const id = taskId();
    const chosenModel = String(model);
    const entry = {
      id,
      agent,
      description: ephemeral ? `[ephemeral] ${description || ""}`.trim() : description || "",
      model: chosenModel,
      ephemeral: !!ephemeral,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      pid: null,
      lastActivityAt: null,
      tools: [],
      error: null,
      result: null,
      depends_on: deps,
      label: shortLabel,
    };
    if (_isBatch) entry.batch = { total: _batchTotal, done: 0 };
    tasks.set(id, entry);
    await persistTask(entry);
    const missing = runnerMissing();
    if (missing) return out(missing, true);
    const args = ["run"];
    args.push("--title", `${TASK_TITLE_PREFIX}${id}`);
    args.push("--agent", agent);
    args.push("--model", chosenModel);
    args.push(orchestrationNote(id) + prompt);
    const donePromise = new Promise((resolveP) => {
      const child = isOpencode
        ? spawn(OPENCODE_BIN, args, {
            cwd: CWD,
            env: { ...process.env, PATH: augmentedPath(process.env.PATH), TASK_ID: id, MCP_BROKER_DIR: BROKER_DIR },
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
          })
        // genérico: valores do LLM via escapeShellArg — sem isso `{prompt}` com `; rm -rf` executava no bash
        : spawn("bash", ["-lc", RUN_TEMPLATE.replaceAll("{prompt}", escapeShellArg(prompt)).replaceAll("{model}", escapeShellArg(chosenModel)).replaceAll("{agent}", escapeShellArg(agent)).replaceAll("{id}", escapeShellArg(id))], {
            cwd: CWD,
            env: { ...process.env, TASK_ID: id, MCP_BROKER_DIR: BROKER_DIR },
            stdio: ["ignore", "pipe", "pipe"],
          });
      // captura stdout/stderr em .out/.err (limitado): sem isso, "exit 1" vinha sem diagnóstico
      // disco full p/ debug, RAM capada: .out em disco guarda 60k (disco é barato), memória mantém enxuta (outBuf 16k / tailRaw 8k / MEM_CAP 20)
      let outBuf = "";
      let diskBuf = "";
      const appendCap = (d) => {
        outBuf += d;
        if (outBuf.length > 16000) outBuf = outBuf.slice(-16000);
        diskBuf += d;
        if (diskBuf.length > 60000) diskBuf = diskBuf.slice(-60000);
      };
      child.stdout?.on("data", appendCap);
      child.stderr?.on("data", appendCap);
      child.on("exit", () => {
        // async p/ não bloquear o event loop no hot-path (era writeFileSync)
        writeFile(join(TASKS_DIR, `${id}.out`), diskBuf).catch((e) => logWarn(`write .out falhou ${id}: ${e?.message || e}`));
      });
      if (!isOpencode) {
        // modo genérico: sem session DB — o .out acima é a única fonte do resultado
      }
      let killed = false;
      let sessionId = null;
      const timer = setTimeout(() => { killed = true; try { child.kill("SIGTERM"); } catch (e) { logWarn(`kill falhou ${id}: ${e?.message || e}`); } setTimeout(() => { try { if (child.pid && procAlive(child.pid)) child.kill("SIGKILL"); } catch {} }, 3000).unref?.(); }, t);
      entry.pid = child.pid;
      entry.lastActivityAt = entry.startedAt;
      persistTask(entry);
      child.unref();
      // poll com backoff 2s→5s→10s + jitter; teto de concorrência p/ não saturar o event loop (query síncrona bloqueante)
      let pollDelay = POLL_BASE_MS;
      let pollTimer = null;
      if (activePolls.size < MAX_ACTIVE_POLLS) { activePolls.add(id); }
      else { pollDelay = POLL_MAX_MS; logWarn(`poll teto atingido (${MAX_ACTIVE_POLLS}) — task ${id} começa em ${POLL_MAX_MS}ms`); }
      const stopPoll = () => { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } activePolls.delete(id); };
      const finalizeFromDb = async (exitCode, err) => {
        // trava: exit handler (código real) sempre vence finalizeDetachedIfDead (chute).
        // Sem isso, wait dizia done/0 e status dizia failed/1 p/ a mesma task.
        if (entry.finalizing) return;
        entry.finalizing = true;
        clearTimeout(timer);
        stopPoll();
        if (!tasks.has(id)) { entry.status = "deleted"; entry.finishedAt = new Date().toISOString(); resolveP(entry); return; }
        if (!sessionId) sessionId = findSessionByTitle(id);
        if (!sessionId) {
          // linha do session DB pode commitar com atraso após o exit — retry curto e limitado
          for (let i = 0; i < 4 && !sessionId; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            if (!tasks.has(id)) break;
            sessionId = findSessionByTitle(id);
          }
        }
        const settled = sessionId ? await settleSession(sessionId) : { text: "", parts: [] };
        let responseText = settled.text;
        if (!responseText) {
          try { responseText = readFileSync(join(TASKS_DIR, `${id}.out`), "utf8"); } catch (e) { logWarn(`read .out falhou ${id}: ${e?.message || e}`); responseText = ""; }
        }
        if (sessionId) entry.sessionId = sessionId;
        const toolCalls = sessionId ? getSessionTools(sessionId) : [];
        entry.exitCode = exitCode;
        entry.status = err ? "failed" : killed ? "timeout" : exitCode === 0 ? "done" : "failed";
        entry.finishedAt = new Date().toISOString();
        entry.tools = [...new Set(toolCalls)];
        const modelTag = `[modelo: ${chosenModel}]`;
        const errTail = (!responseText.trim() && outBuf ? `\n[stderr/stdout capturado]\n${outBuf.slice(-1500)}` : "");
        if (err) entry.error = `${modelTag} ${err}${errTail}`;
        else if (killed) entry.error = `${modelTag} timeout after ${Math.round(t / 1000)}s${errTail}`;
        else if (exitCode !== 0) entry.error = `${modelTag} falhou (exit ${exitCode})${errTail}`;
        else entry.error = responseText.trim() ? null : `${modelTag} saiu 0 sem resposta${errTail}`;
        entry.result = responseText.trim();
        entry.tailRaw = responseText.slice(-8000);
        if (_isBatch) {
          try {
            const _slices = _sliceBatch(entry.result, _batchTotal);
            entry.batch = { total: _batchTotal, done: _slices.filter((s) => String(s || "").trim()).length, results: _slices };
          } catch {}
        }
        persistTask(entry);
        const summary = entry.error || (entry.result ? entry.result.slice(0, 200) : "");
        notifyMain(id, entry.status, description, chosenModel, summary).catch((e) => logWarn(`notifyMain falhou ${id}: ${e?.message || e}`));
        try { sendToHost({ method: "notifications/message", params: { level: entry.status === "done" ? "info" : "warning", logger: "native", data: `task ${id} (${description || ""}) — ${entry.status}` } }); } catch (e) { logWarn(`sendToHost falhou ${id}: ${e?.message || e}`); }
        if (entry.ephemeral) { setTimeout(async () => { try { await unlink(join(TASKS_DIR, `${id}.json`)); await unlink(join(MB_DIR, `${id}.json`)).catch(() => {}); tasks.delete(id); } catch (e) { logWarn(`ephemeral cleanup falhou ${id}: ${e?.message || e}`); } }, 30000); }
        resolveP(entry);
      };
      let pollBusy = false;
      const schedulePoll = (ms) => {
        if (entry.finalizing || !tasks.has(id)) { stopPoll(); return; }
        pollTimer = setTimeout(tickPoll, pollJitter(ms));
      };
      const tickPoll = () => {
        pollTimer = null;
        if (entry.finalizing || !tasks.has(id)) { stopPoll(); return; }
        if (pollBusy) { schedulePoll(pollDelay); return; }
        pollBusy = true;
        let progressed = false;
        try {
          if (!sessionId) sessionId = findSessionByTitle(id);
          if (!sessionId) { pollBusy = false; pollDelay = nextPollDelay(pollDelay); schedulePoll(pollDelay); return; }
          entry.sessionId = sessionId;
          entry.lastActivityAt = new Date().toISOString();
          const partial = pollCached(`txt:${sessionId}`, 5000, () => getSessionAssistantText(sessionId));
          if (partial) {
            if (partial.length !== (entry.tailRaw || "").length) progressed = true;
            entry.tailRaw = partial.slice(-8000);
          }
          // progresso empurrado p/ sessão do dono (throttle 25s, só quando cresceu; persist só aqui — nunca a cada tick)
          try {
            const now = Date.now();
            const grown = (entry.tailRaw || "").length > (entry.lastPushLen || 0);
            if (grown && now - (entry.lastPushAt || 0) > 25000) {
              entry.lastPushAt = now;
              entry.lastPushLen = (entry.tailRaw || "").length;
              entry.tools = pollCached(`tools:${sessionId}`, 5000, () => getSessionTools(sessionId));
              persistTask(entry).catch((e) => logWarn(`persist progress falhou ${id}: ${e?.message || e}`));
              sendToHost({ method: "notifications/message", params: { level: "info", logger: "canivete", data: `task ${id} (${description || ""}) — andando [${entry.tools.slice(-4).join(", ") || "iniciando"}]\n${(entry.tailRaw || "").slice(-600)}` } });
            }
          } catch (e) { logWarn(`poll push falhou ${id}: ${e?.message || e}`); }
          if (isSessionDone(sessionId)) { pollBusy = false; finalizeFromDb(0, null).catch((e) => logWarn(`finalize poll falhou ${id}: ${e?.message || e}`)); return; }
        } catch (e) { logWarn(`poll tick falhou ${id}: ${e?.message || e}`); }
        pollBusy = false;
        pollDelay = progressed ? POLL_BASE_MS : nextPollDelay(pollDelay);
        schedulePoll(pollDelay);
      };
      schedulePoll(pollDelay);
      child.on("error", (err) => { stopPoll(); finalizeFromDb(-1, err.message).catch((e) => logWarn(`finalize error falhou ${id}: ${e?.message || e}`)); });
      child.on("exit", (code) => {
        // imediato (sem delay): o handler tem o exit code REAL e a trava finalizing
        // garante que ele vença finalizeDetachedIfDead. O flush tardio do session DB
        // já é coberto pelo retry de findSessionByTitle + settleSession em finalizeFromDb.
        if (!tasks.has(id) || tasks.get(id).status !== "running") return;
        if (!sessionId) sessionId = findSessionByTitle(id);
        if (sessionId && isSessionDone(sessionId)) { finalizeFromDb(code, null).catch((e) => logWarn(`finalize exit falhou ${id}: ${e?.message || e}`)); }
        else finalizeFromDb(code, code === 0 ? null : `exit ${code}`).catch((e) => logWarn(`finalize exit falhou ${id}: ${e?.message || e}`));
      });
    });
    entry.donePromise = donePromise;
    await persistTask(entry); // garante pid no disco (fecha race pid:null → zombie imortal)
    if (_isBatch && background) {
      const eph = ephemeral ? " [ephemeral auto-exclui em 30s]" : "";
      const tag = shortLabel ? `${shortLabel} (${id})` : id;
      return out(`task ${tag} batch ${_batchTotal} jobs em 1 PID spawned in background (${agent} | ${chosenModel})${eph} — economia ${_batchTotal}×200MB→1×\npara esperar: n_task_wait({ task_ids: ["${id}"], wait: "all" | "any", timeout })\npara comunicar: n_task_send({ task_id: "${id}", message: "..." })\npara excluir: n_task_delete({task_id:"${id}"}) ou n_task_delete({task_id:"all"})`);
    }
    if (background) {
      const eph = ephemeral ? " [ephemeral auto-exclui em 30s]" : "";
      const tag = shortLabel ? `${shortLabel} (${id})` : id;
      return out(`task ${tag} spawned in background (${agent} | ${chosenModel})${eph}\npara esperar: n_task_wait({ task_ids: ["${id}"], wait: "all" | "any", timeout })\npara comunicar: n_task_send({ task_id: "${id}", message: "..." })\npara excluir: n_task_delete({task_id:"${id}"}) ou n_task_delete({task_id:"all"})`);
    }
    let fin;
    if (t > HOST_GUARD_MS) {
      fin = await Promise.race([donePromise, new Promise((r) => setTimeout(() => r(null), HOST_GUARD_MS))]);
      if (!fin) {
        return out(`task ${shortLabel ? `${shortLabel} (${id})` : id} ainda rodando após ${Math.round(HOST_GUARD_MS / 1000)}s (limite de resposta; continua em background)\npara esperar: n_task_wait({ task_ids: ["${id}"], wait: "all" })\npara status: n_task_status({ task_id: "${id}" })`);
      }
    } else {
      fin = await donePromise;
    }
    if (fin.ephemeral) {
      setTimeout(async () => {
        try {
          await unlink(join(TASKS_DIR, `${fin.id}.json`));
          await unlink(join(MB_DIR, `${fin.id}.json`)).catch(() => {});
          tasks.delete(fin.id);
        } catch {}
      }, 5000);
    }
    const finTag = fin.label ? `${fin.label} (${fin.id})` : (shortLabel ? `${shortLabel} (${fin.id})` : fin.id);
    const header = `[${agent} ${fin.status} | ${fin.model || chosenModel}${fin.ephemeral ? " | ephemeral" : ""}, exit ${fin.exitCode}] ${finTag}\ntools usados: ${fin.tools.length ? fin.tools.join(", ") : "nenhum"}`;
    let ownMb = "";
    try {
      const box = readJson(join(MB_DIR, `${fin.id}.json`), null);
      const n = box && Array.isArray(box.msgs) ? box.msgs.length : 0;
      if (n) ownMb = `\n📬 ${n} notificação(ões) pendente(s) p/ ${fin.label || shortLabel || fin.id} — leia com n_task_recv({task_id:"${fin.id}"})`;
    } catch {}
    if (_isBatch || fin.batch) {
      const total = (fin.batch && fin.batch.total) || _batchTotal;
      const slices = (fin.batch && Array.isArray(fin.batch.results) && fin.batch.results.length === total) ? fin.batch.results : _sliceBatch(fin.result || "", total);
      const done = (fin.batch && typeof fin.batch.done === "number") ? fin.batch.done : slices.filter((s) => String(s || "").trim()).length;
      const finTagB = fin.label ? `${fin.label} (${fin.id})` : (shortLabel ? `${shortLabel} (${fin.id})` : fin.id);
      const headerB = `[${agent} ${fin.status} | ${fin.model || chosenModel}${fin.ephemeral ? " | ephemeral" : ""} | batch ${done}/${total} em 1 PID (economia ${total}×200MB→1×), exit ${fin.exitCode}] ${finTagB}\ntools usados: ${fin.tools.length ? fin.tools.join(", ") : "nenhum"}`;
      if (fin.error && !fin.result) return out(`${headerB}\n${fin.error}` + ownMb + pendingHints());
      const bodyB = slices.map((s, i) => `### RESULT ${i + 1} ###\n${String(s || "").trim() || "(sem resposta)"}`).join("\n\n");
      return out(headerB + (fin.result ? `\n\n${trimOut(bodyB, 20000)}` : "\n(sem resposta)") + ownMb + pendingHints());
    }
    return out((fin.error && !fin.result ? `${header}\n${fin.error}` : header + (fin.result ? `\n\n${trimOut(fin.result, 20000)}` : "\n(sem resposta)")) + ownMb + pendingHints());
  },
});

function resolveTask(id) {
  return tasks.get(id) || readJson(join(TASKS_DIR, `${id}.json`), null);
}

// sem shell: args array elimina injeção shell no `opencode db "<sql>"`;
// timeout curto (DB_QUERY_TIMEOUT_MS) limita a janela de event-loop bloqueado;
// caches abaixo (sessionId/done/poll) evitam as chamadas quentes.
function opencodeDbQuery(sql) {
  if (!isOpencode) return [];
  try {
    const result = execFileSync(OPENCODE_BIN, ["db", String(sql), "--format", "json"], {
      cwd: CWD, encoding: "utf8", timeout: DB_QUERY_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv(),
    });
    return JSON.parse(result);
  } catch (e) { logWarn(`opencodeDbQuery falhou: ${String(sql || "").slice(0, 80)} — ${e?.message || e}`); return []; }
}

function findSessionByTitleFresh(taskId) {
  const rows = opencodeDbQuery(`SELECT id FROM session WHERE title='${escapeSql(`${TASK_TITLE_PREFIX}${taskId}`)}' ORDER BY time_created DESC LIMIT 1`);
  return rows.length ? rows[0].id : null;
}

// session id é IMUTÁVEL após criado: memoiza para sempre; miss throttled 10s.
// Sem isso, cada pollDb (2s/task) pagava ~6s de chamada síncrona bloqueante — event loop saturado.
const sessionIdCache = new Map();
function findSessionByTitle(taskId) {
  const hit = sessionIdCache.get(taskId);
  if (hit && (hit.id || Date.now() - hit.ts < 10000)) return hit.id;
  const id = findSessionByTitleFresh(taskId);
  if (sessionIdCache.size > 500) sessionIdCache.clear();
  sessionIdCache.set(taskId, { id, ts: Date.now() });
  return id;
}

function getSessionAssistantText(sessionId) {
  if (!sessionId) return "";
  const rows = opencodeDbQuery(
    `SELECT json_extract(p.data,'$.text') as txt FROM part p WHERE p.session_id='${escapeSql(sessionId)}' AND json_extract(p.data,'$.type')='text' ORDER BY p.time_created`
  );
  const texts = rows.map((r) => {
    let t = r.txt || "";
    if (t.startsWith('"') && t.endsWith('"')) { try { t = JSON.parse(t); } catch {} }
    return t;
  }).filter((t) => t && !t.includes("[ORCHESTRATION]"));
  return texts.join("\n").trim();
}

function getSessionParts(sessionId) {
  if (!sessionId) return [];
  return opencodeDbQuery(
    `SELECT json_extract(p.data,'$.type') as ptype, json_extract(p.data,'$.text') as txt FROM part p WHERE p.session_id='${escapeSql(sessionId)}' ORDER BY p.time_created`
  );
}

// settle: o session DB do opencode commita parts/texto com atraso após o fim da sessão.
// Espera até 30s por TEXTO ou por quiescência (8s sem mudar = escrita parou).
// Reduzido de 60s/12s: segurava donePromise e estourava HOST_GUARD.
async function settleSession(sessionId, maxMs = 15000) {
  let text = "";
  let parts = [];
  if (!sessionId) return { text, parts };
  const t0 = Date.now();
  let lastSig = "", stableSince = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      text = getSessionAssistantText(sessionId);
      parts = getSessionParts(sessionId);
    } catch (e) { logWarn(`settle read falhou ${sessionId}: ${e?.message || e}`); }
    if (text) return { text, parts };
    const last = parts.length ? parts[parts.length - 1] : null;
    const sig = `${parts.length}:${String((last && (last.txt || last.text)) || "").length}`;
    if (sig !== lastSig) { lastSig = sig; stableSince = Date.now(); }
    if (Date.now() - stableSince > 8000) return { text, parts };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { text, parts };
}

function getSessionTools(sessionId) {
  if (!sessionId) return [];
  const rows = opencodeDbQuery(
    `SELECT DISTINCT json_extract(p.data,'$.tool') as tool FROM part p WHERE p.session_id='${escapeSql(sessionId)}' AND json_extract(p.data,'$.type')='tool'`
  );
  return rows.map((r) => String(r.tool || "")).filter(Boolean).map((t) => {
    const bare = t.replace(/^(native|canivete)_/, "");
    return bare.startsWith("n_") ? bare : `NÃO-MCP:${bare}`;
  });
}

function isSessionDoneFresh(sessionId) {
  const rows = opencodeDbQuery(`SELECT time_updated, time_created FROM session WHERE id='${escapeSql(sessionId)}'`);
  if (!rows.length) return false;
  const s = rows[0];
  return s.time_updated > s.time_created + 3000 && getSessionParts(sessionId).some((p) => p.ptype === "text" && p.txt);
}

// predicado MONOTÔNICO (false→true): true cacheado p/ sempre; false throttled 5s.
const doneCache = new Map();
function isSessionDone(sessionId) {
  if (!sessionId) return false;
  const hit = doneCache.get(sessionId);
  if (hit && (hit.done || Date.now() - hit.ts < 5000)) return hit.done;
  const done = isSessionDoneFresh(sessionId);
  if (doneCache.size > 500) doneCache.clear();
  doneCache.set(sessionId, { done, ts: Date.now() });
  return done;
}

// leituras quentes do pollDb (texto parcial + tools): TTL 5s. Finalize usa leitura fresca.
const pollCache = new Map();
function pollCached(key, ttlMs, fn) {
  const hit = pollCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.val;
  const val = fn();
  if (pollCache.size > 200) pollCache.clear();
  pollCache.set(key, { val, ts: Date.now() });
  return val;
}

function exportSession(sessionId) {
  if (!sessionId) return null;
  try {
    // args array: sessionId nunca passa por shell (antes: interpolado em string `opencode export "..."`)
    const result = execFileSync(OPENCODE_BIN, ["export", String(sessionId)], {
      cwd: CWD, encoding: "utf8", timeout: EXPORT_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv(),
    });
    return JSON.parse(result);
  } catch { return null; }
}

async function finalizeDetachedIfDead(id) {
  const t = resolveTask(id);
  if (!t || t.status !== "running") return null;
  if (t.finalizing) return null; // finalizeFromDb (código real) está no controle — não chutar
  const sessionId = t.sessionId || findSessionByTitle(id);
  const sessionDone = sessionId ? isSessionDone(sessionId) : false;
  const pidDead = t.pid ? !procAlive(t.pid) : true;
  if (!sessionDone && !pidDead) return null;
  const ageMs = Date.now() - new Date(t.startedAt).getTime();
  // task velha (>10min): o flush do DB já passou há muito — sem settle de 30s
  const settled = sessionId
    ? (ageMs > 600000 ? { text: getSessionAssistantText(sessionId), parts: [] } : await settleSession(sessionId))
    : { text: "", parts: [] };
  let responseText = settled.text;
  const toolCalls = sessionId ? getSessionTools(sessionId) : [];
  if (!responseText) responseText = (() => { try { return readFileSync(join(TASKS_DIR, `${id}.out`), "utf8"); } catch (e) { logWarn(`read .out falhou ${id}: ${e?.message || e}`); return ""; } })();
  responseText = (responseText || "").trim();
  // sem evidência de sucesso (sem texto) não alegar exit 0: era isso que fazia
  // wait dizer done/0 enquanto o exit real era 1 (status dizia failed/1).
  const ok = !!responseText;
  t.exitCode = ok ? 0 : (t.exitCode ?? 1);
  t.status = ok ? "done" : "failed";
  t.finishedAt = new Date().toISOString();
  t.tools = [...new Set(toolCalls)];
  t.result = responseText;
  t.error = ok ? null : `[modelo: ${t.model || "unknown"}] processo encerrou sem resposta aproveitável (sem texto no session DB nem .out)`;
  t.sessionId = sessionId;
  persistTask(t);
  notifyMain(t.id, t.status, t.description, t.model, (t.result || "").slice(0, 200)).catch((e) => logWarn(`notify finalize falhou ${t.id}: ${e?.message || e}`));
  return t;
}

async function pollDetached(ids, deadline) {
  return new Promise((resolve) => {
    let delay = POLL_BASE_MS;
    let timer = null;
    let idx = 0;
    const MAX_IDS_PER_TICK = 8; // limita burst de query síncrona bloqueante por tick
    let busy = false;
    const tick = async () => {
      timer = null;
      if (Date.now() > deadline) { resolve(null); return; }
      if (busy) { timer = setTimeout(tick, pollJitter(delay)); return; }
      busy = true;
      try {
        // round-robin quando há muitas tasks: checa no máx N por tick
        const ordered = ids.length <= MAX_IDS_PER_TICK ? ids : [...ids.slice(idx), ...ids.slice(0, idx)].slice(0, MAX_IDS_PER_TICK);
        idx = (idx + MAX_IDS_PER_TICK) % Math.max(ids.length, 1);
        let progressed = false;
        for (const id of ordered) {
          const t = resolveTask(id);
          if (!t || t.status !== "running") { resolve(t); return; }
          const sessionId = t.sessionId || findSessionByTitle(id);
          if (sessionId && isSessionDone(sessionId)) { resolve(await finalizeDetachedIfDead(id).catch((e) => { logWarn(`pollDetached finalize falhou ${id}: ${e?.message || e}`); return null; })); return; }
          if (t.pid && !procAlive(t.pid)) { resolve(await finalizeDetachedIfDead(id).catch((e) => { logWarn(`pollDetached finalize pid falhou ${id}: ${e?.message || e}`); return null; })); return; }
        }
        // sem progresso → backoff; progresso (finalize) já retornou acima
        delay = progressed ? POLL_BASE_MS : nextPollDelay(delay);
      } catch (e) { logWarn(`pollDetached tick falhou: ${e?.message || e}`); delay = nextPollDelay(delay); } finally { busy = false; }
      timer = setTimeout(tick, pollJitter(delay));
    };
    timer = setTimeout(tick, pollJitter(delay));
  });
}

reg("n_task_wait", {
  description: "Aguarda subagentes e retorna resultados. wait:'any' resolve quando O PRIMEIRO termina; 'all' espera todos. Depois de spawn em background. Responde em até ~170s (clamp do host timeout) — se ainda rodando, chame de novo. ID desconhecido → not found imediato.",
  inputSchema: {
    type: "object",
    properties: {
      task_ids: { type: "array", items: { type: "string" }, description: "Tasks to wait (default: all running)" },
      wait: { type: "string", enum: ["all", "any"], default: "all" },
      timeout: { type: "number", default: 600000 },
      summary: { type: "boolean", default: false, description: "Se true, retorna 1 bloco resumido por task (status|model|exit|tools + últimas 5 linhas) em vez do resultado completo" },
      deltas: { type: "boolean", default: false, description: "Se true, em re-waits retorna SÓ o que mudou desde o último wait com deltas (novas tasks done + ainda-rodando), omitindo dumps já vistos" },
    },
    required: [],
  },
  run: async ({ task_ids, wait, timeout, summary, deltas }) => {
    const summaryMode = summary === true;
    const deltasMode = deltas === true;
    const any = wait === "any";
    let ids = task_ids && task_ids.length ? task_ids : null;
    if (!ids) {
      ids = [...new Set([...tasks.keys(), ...safeTaskIds()])].filter((k) => {
        const t = resolveTask(k);
        return t && t.status === "running";
      });
    }
    if (!ids.length) return out("no running tasks to wait for");
    const unknown = ids.filter((i) => !resolveTask(i));
    if (unknown.length === ids.length) return out(`task(s) not found: ${unknown.join(", ")}`, true);
    const doneById = new Map();
    const ps = [];
    for (const i of ids) {
      const mem = tasks.get(i);
      let disk = readJson(join(TASKS_DIR, `${i}.json`), null);
      if (disk && disk.status === "running") disk = await sweepTask(disk);
      if (disk && disk.status !== "running") {
        doneById.set(disk.id, disk);
        if (mem) { mem.status = disk.status; mem.finishedAt = disk.finishedAt; mem.error = disk.error; mem.result = disk.result; mem.tools = disk.tools; mem.exitCode = disk.exitCode; }
      } else {
        const fin = await finalizeDetachedIfDead(i).catch(() => null);
        if (fin) { doneById.set(fin.id, fin); if (mem) { mem.status = fin.status; mem.finishedAt = fin.finishedAt; mem.error = fin.error; mem.result = fin.result; mem.tools = fin.tools; mem.exitCode = fin.exitCode; } }
        else if (mem?.donePromise && mem.status === "running") { ps.push(mem.donePromise.then((t) => { doneById.set(t.id, t); return t; })); }
      }
    }
    if (any) {
      const already = [...doneById.values()][0];
      if (already) return formatTaskResult([already], true, ids.filter((i) => i !== already.id), summaryMode, deltasMode);
      const waitMs = Math.min(timeout || 600000, HOST_GUARD_MS);
      const runningIds = ids.filter((i) => resolveTask(i)?.status === "running" && !doneById.has(i));
      const first = await Promise.race([
        ps.length ? Promise.any(ps).catch(() => null) : new Promise((r) => r(null)),
        pollDetached(runningIds, Date.now() + waitMs),
        new Promise((r) => setTimeout(() => r(null), waitMs)),
      ]);
      if (!first) {
        if (doneById.size) {
          const firstDone = [...doneById.values()][0];
          return formatTaskResult([firstDone], true, ids.filter((i) => i !== firstDone.id), summaryMode, deltasMode);
        }
        const lines = [`wait timeout after ${Math.round(waitMs / 1000)}s (clamp ${Math.round(HOST_GUARD_MS / 1000)}s = host timeout; chame de novo para continuar esperando)`];
        for (const id of ids) {
          const t = resolveTask(id);
          lines.push(`[${t?.status}] ${id} ${t?.description || ""}`.trim());
        }
        return out(lines.join("\n"));
      }
      return formatTaskResult([first], true, ids.filter((i) => i !== first.id), summaryMode, deltasMode);
    }
    let done = [...doneById.values()];
    const doneSet = new Set(done.map((t) => t.id));
    const remaining = ps;
    const deadline = Date.now() + Math.min(timeout || 600000, HOST_GUARD_MS);
    for (const p of remaining) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const t = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), left))]);
      if (t) doneSet.add(t.id);
    }
    const pendingIds = ids.filter((i) => !doneSet.has(i));
    if (pendingIds.length) {
      const pollResult = await pollDetached(pendingIds, deadline);
      if (pollResult) doneSet.add(pollResult.id);
    }
    if (doneById.size && ![...doneById.values()].some((t) => t.status === "running")) {
      return formatTaskResult([...doneById.values()], false, [], summaryMode, deltasMode);
    }
    done = ids.map((i) => resolveTask(i)).filter(Boolean);
    const running = done.filter((t) => t.status === "running");
    if (running.length) {
      return out(`wait timeout — ainda rodando: ${running.map((t) => `${t.id} (${t.status})`).join(", ")} (chame n_task_wait de novo para continuar esperando)`);
    }
    return formatTaskResult(done, false, [], summaryMode, deltasMode);
  },
});

// ---- ctx-economy opt-in: deltas (wait) + digest (recv/peek) — defaults intactos ----
// deltas: ids já entregues via wait com deltas:true (re-waits omitem re-dump).
const waitSeenDoneIds = new Set();
const WAIT_SEEN_CAP = 500;
function markWaitSeen(ids) {
  for (const rawId of ids || []) {
    const id = rawId ? String(rawId) : "";
    if (!id) continue;
    if (waitSeenDoneIds.size >= WAIT_SEEN_CAP) {
      const oldest = waitSeenDoneIds.values().next().value;
      waitSeenDoneIds.delete(oldest);
    }
    waitSeenDoneIds.add(id);
  }
}
// digest: 1ª linha não-vazia capada (1 msg = 1 linha).
function digestFirstLine(s, cap = 120) {
  const lines = String(s ?? "").split("\n");
  let first = "";
  for (const l of lines) { const t = String(l || "").trim(); if (t) { first = t; break; } }
  if (!first) return "(vazia)";
  return first.length > cap ? first.slice(0, cap) + `…[+${first.length - cap}ch]` : first;
}
function formatMsgDigest(m) {
  const from = m?.from ?? "?";
  let ageS = 0;
  try { ageS = Math.round(msgAgeMs(m) / 1000); } catch { ageS = 0; }
  return `[${from} age_${ageS}s] ${digestFirstLine(m?.message)}`;
}

function formatTaskResult(done, any, still, summary = false, deltas = false) {
  const deltasMode = deltas === true;
  const list = Array.isArray(done) ? done : [];
  const stillArr = Array.isArray(still) ? still : [];
  let fresh = list;
  let skippedOld = 0;
  if (deltasMode) {
    fresh = list.filter((raw) => {
      const id = raw?.id ? String(raw.id) : "";
      if (!id) return true;
      if (waitSeenDoneIds.has(id)) { skippedOld++; return false; }
      return true;
    });
    markWaitSeen(fresh.map((r) => r?.id));
  }
  const blocks = (deltasMode ? fresh : list).map((raw) => {
    const t = raw && typeof raw === "object" ? raw : {};
    const tools = Array.isArray(t.tools) ? t.tools : [];
    const name = t.label ? `${t.label} (${t.id || "?"})` : (t.id || "?");
    const head = `[${t.status || "unknown"}] ${name} — ${t.description || "(sem descrição)"} | ${t.model || "unknown"} (exit ${t.exitCode})\ntools: ${tools.length ? tools.join(", ") : "nenhum"}`;
    if (summary) {
      const src = t.result || t.error || "";
      const tail5 = String(src).trim().split("\n").slice(-5).join("\n");
      return tail5 ? `${head}\n\n${tail5}` : head;
    }
    return head + (t.result ? `\n\n${trimOut(t.result, 20000)}` : t.error ? `\n\n${t.error}` : "");
  });
  const joined = trimOut(blocks.join("\n\n---\n\n"), 30000);
  const effective = deltasMode ? fresh : list;
  for (const raw of effective) { // mem: libera texto pesado após consumo via wait (mantém status/tools); blocos já copiados acima
    try {
      const id = raw?.id;
      if (!id || raw.status === "running" || raw.consumed) continue;
      raw.consumed = true; raw.tailRaw = ""; raw.result = "";
      const mem = tasks.get(id);
      if (mem && mem !== raw) {
        if (mem.status !== "running") { mem.consumed = true; mem.tailRaw = ""; mem.result = ""; persistTask(mem).catch(() => {}); }
      } else if (mem) { persistTask(mem).catch(() => {}); }
      else {
        try {
          const d = readJson(join(TASKS_DIR, `${id}.json`), null);
          if (d && d.status !== "running" && !d.consumed) { d.consumed = true; d.tailRaw = ""; d.result = ""; persistTask(d).catch(() => {}); }
        } catch {}
      }
    } catch {}
  }
  if (deltasMode) {
    const base = `${fresh.length} nova(s) desde último wait (omitidas ${skippedOld} já vistas) ${any ? "(primeira)" : "(todas)"}`;
    const body = fresh.length ? `\n${joined}` : "\n(sem novidades — nada novo concluído)";
    return out(
      `${base}:${body}` +
        (stillArr.length ? `\n\nainda rodando: ${stillArr.join(", ") || "nenhum"}` : "") +
        pendingHints()
    );
  }
  return out(
    `${list.length} task(s) ${any ? "concluída(s) (primeira)" : "concluída(s) (todas)"}:\n` +
      joined +
      (stillArr.length ? `\n\nainda rodando: ${stillArr.join(", ") || "nenhum"}` : "") +
      pendingHints()
  );
}

reg("n_list_models", {
  description: "PASSO 1 antes de n_task: lista modelos disponíveis. No modo opencode a escolha é obrigatória e validada; no genérico, informativo.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    if (isOpencode) {
      return out(`Modelos (${FREE_MODELS.length}, runner opencode):\n${FREE_MODELS.join("\n")}\n\nUso: n_task({prompt, model: "${FREE_MODELS[2] || FREE_MODELS[0]}"})\nBloqueados: opencode-go/* e opencode/hy3-free\nFonte: config/models.json (ou CANIVETE_MODELS_FILE).`);
    }
    return out(`Runner genérico ativo (${RUNNER}). Sem lista fixa — use o model name do seu runner no template.\nTemplate: ${RUN_TEMPLATE}\nSugestões (modo opencode): ${FREE_MODELS.slice(0, 3).join(", ")}\nUso: n_task({prompt, model: "qualquer-nome"})`);
  },
});

reg("n_task_status", {
  description: "Lista subagentes (id|status|tools|elapsed|modelo) ou detalha 1. Nunca bloqueia. Mostra mailbox:N (msg não lida), idle:Ns e marca interrupted quando o PID morre.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
    },
    required: [],
  },
  run: async ({ task_id }) => {
    const sweep = sweepTask;
    const fmt = (t) => {
      t = t && typeof t === "object" ? t : {};
      const status = String(t.status || "unknown");
      const tools = Array.isArray(t.tools) ? t.tools : [];
      const dur = t.finishedAt ? ` (${Math.round((new Date(t.finishedAt) - new Date(t.startedAt)) / 1000)}s)` : "";
      const idle = status === "running" ? ` | idle:${Math.max(0, Math.round((Date.now() - new Date(t.lastActivityAt || t.startedAt)) / 1000))}s` : "";
      const mdl = t.model ? ` | ${t.model}` : "";
      const mb = (() => {
        try {
          const b = readJson(join(MB_DIR, `${t.id}.json`), null);
          return b && b.msgs.length ? ` | mailbox:${b.msgs.length}` : "";
        } catch {
          return "";
        }
      })();
      return `[${status.padEnd(7)}] ${t.id || "?"} ${t.description || ""}${mdl}${dur}${idle}${mb}`.trim() + (tools.length ? ` | tools: ${tools.join(", ")}` : "");
    };
    if (task_id) {
      let t = resolveTask(task_id);
      if (!t) return out(`task ${task_id} not found`, true);
      if (t.status === "running") {
        const sessionId = t.sessionId || findSessionByTitle(task_id);
        if (sessionId && isSessionDone(sessionId)) { t = (await finalizeDetachedIfDead(task_id).catch(() => null)) || t; }
      } else if (!t.result && !t.error) {
        // cura tardia: task fechou antes do flush do session DB — tenta capturar agora
        const sid = t.sessionId || findSessionByTitle(task_id);
        if (sid) {
          const s = await settleSession(sid, 30000);
          if (s.text) { t.result = s.text.trim(); t.tools = getSessionTools(sid); t.tailRaw = s.text.slice(-8000); await persistTask(t); }
        }
      }
      t = await sweep(t);
      return out(fmt(t) + (t.result ? `\n\n${trimOut(t.result, 20000)}` : t.error ? `\n\n${t.error}` : ""));
    }
    try {
      const ids = [...new Set([...tasks.keys(), ...safeTaskIds()])];
      const all = [];
      for (const i of ids) {
        try { const t = await sweep(resolveTask(i)); if (t) all.push(t); } catch { /* skip corrupted task */ }
      }
      return out(all.map(fmt).join("\n") || "(no tasks)");
    } catch (e) { return out(`(erro listando tasks: ${e.message})`, true); }
  },
});

reg("n_task_send", {
  description: "Envia msg p/ mailbox (não-bloqueante). ttl_ms opcional: msg velha some no recv/peek/notify.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Destino ou 'main'" },
      message: { type: "string", description: "Texto da msg" },
      from: { type: "string", description: "Remetente (padrão 'main')" },
      ttl_ms: { type: "number", description: "Expira após N ms (opcional)" },
    },
    required: ["task_id", "message"],
  },
  run: async ({ task_id, message, from, ttl_ms }) => {
    if (task_id !== "main" && !resolveTask(task_id)) return out(`task ${task_id} not found`, true);
    const target = task_id === "main" ? null : resolveTask(task_id);
    const file = join(MB_DIR, `${task_id}.json`);
    const box = pushCapped(readJson(file, { msgs: [] }), from || "main", message, ttl_ms);
    await writeJson(file, box);
    const dormant = target && target.status !== "running"
      ? `\nAVISO: task ${task_id} está ${target.status} — a msg pode dormir sem leitura. Prefira "main" ou re-spawne.`
      : "";
    return out(`delivered to ${task_id} (mailbox ${box.msgs.length} msg(s), cap ${MAX_MSGS})${dormant}` + pendingHints());
  },
});

reg("n_task_delete", {
  description: "Exclui task(s)+mailbox p/ organizar. Em running encerra o processo (tombstone). Use p/ coletores de info. Auto: n_task ephemeral:true exclui ~30s após done. Requer confirm:true p/ bulk all ou alvo running (sem confirm só preview). dryRun:true lista sem deletar.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID ou 'all' para todos done/failed, 'ephemeral' para só coletores" },
      delete_mailbox: { type: "boolean", description: "Também apaga mailbox (default true)" },
      confirm: { type: "boolean", description: "Obrigatório quando task_id='all' ou alvo está running; sem ele retorna preview sem deletar" },
      dryRun: { type: "boolean", description: "Se true, lista o que seria excluído sem deletar (preview, não requer confirm)" },
    },
    required: ["task_id"],
  },
  run: async ({ task_id, delete_mailbox, confirm, dryRun }) => {
    const doDelMb = delete_mailbox !== false;
    const isDry = dryRun === true;
    const isConfirmed = confirm === true;
    if (task_id === "all" || task_id === "ephemeral") {
      const ids = safeTaskIds();
      const targets = [];
      for (const id of ids) {
        const t = readJson(join(TASKS_DIR, `${id}.json`), null);
        const isEphemeral = !t || t.ephemeral === true || t.description?.startsWith("[ephemeral]");
        if (task_id === "all" ? t?.status !== "running" : isEphemeral) {
          targets.push({ id, status: t?.status || "unknown", description: t?.description || "" });
        }
      }
      const preview = targets.length
        ? targets.map((x) => `[${x.status}] ${x.id} ${x.description}`.trim()).join("\n")
        : "(nada a excluir)";
      if (isDry) {
        return out(`[dryRun] ${targets.length} task(s) seriam excluídas (${task_id}):\n${preview}`);
      }
      const needsConfirm = task_id === "all" || targets.some((x) => x.status === "running");
      if (needsConfirm && !isConfirmed) {
        return out(`confirm obrigatório para excluir ${targets.length} task(s) (${task_id}) — passe confirm:true para executar. Preview (nada foi deletado):\n${preview}`, true);
      }
      let n = 0, kills = 0;
      for (const { id } of targets) {
        const t = readJson(join(TASKS_DIR, `${id}.json`), null);
        try {
          if (tryKill(t)) kills++;
          await unlink(join(TASKS_DIR, `${id}.json`));
          await unlink(join(TASKS_DIR, `${id}.out`)).catch(() => {});
          if (doDelMb) await unlink(join(MB_DIR, `${id}.json`)).catch(() => {});
          tasks.delete(id);
          n++;
        } catch {}
      }
      return out(`excluídos ${n} task(s) (${task_id})${kills ? `, ${kills} processo(s) encerrado(s)` : ""}`);
    }
    const t = resolveTask(task_id);
    if (!t) return out(`task ${task_id} not found`, true);
    const previewOne = `[${t.status || "unknown"}] ${task_id} ${t.description || ""}`.trim() + (t.status === "running" && t.pid ? ` (pid ${t.pid} seria encerrado)` : t.status === "running" ? " (processo running seria encerrado)" : "");
    if (isDry) {
      return out(`[dryRun] task ${task_id} seria excluída (nada foi deletado):\n${previewOne}`);
    }
    if (t.status === "running" && !isConfirmed) {
      return out(`confirm obrigatório para excluir task running ${task_id} (encerra o processo) — passe confirm:true para executar. Preview (nada foi deletado):\n${previewOne}`, true);
    }
    const killedPid = tryKill(t);
    try {
      await unlink(join(TASKS_DIR, `${task_id}.json`));
      await unlink(join(TASKS_DIR, `${task_id}.out`)).catch(() => {});
      if (doDelMb) await unlink(join(MB_DIR, `${task_id}.json`)).catch(() => {});
      tasks.delete(task_id);
      return out(`task ${task_id} excluída${killedPid ? ` (processo ${killedPid} encerrado)` : t.status === "running" ? " (processo já morto)" : ""}`);
    } catch (e) {
      return out(`falha ao excluir: ${e.message}`, true);
    }
  },
});

reg("n_task_recv", {
  description: "Lê e esvazia mailbox (destrutivo). filter: só consome o que casa. Expirada (ttl) é descartada.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Caixa (padrão TASK_ID env)" },
      timeout: { type: "number", description: "Espera até N ms (máx 170s)" },
      filter: { type: "string", description: "Substring; resto fica na caixa" },
      digest: { type: "boolean", default: false, description: "Se true, retorna digest 1 linha/msg (de|idade|1ª linha) em vez do texto integral (consome igual)" },
    },
    required: [],
  },
  run: async ({ task_id, timeout, filter, digest }) => {
    const digestMode = digest === true;
    const id = task_id || process.env.TASK_ID;
    if (!id) return out("no task_id and no TASK_ID env", true);
    const file = join(MB_DIR, `${id}.json`);
    const waitMs = Math.min(Number(timeout) || 0, HOST_GUARD_MS);
    const deadline = Date.now() + waitMs;
    const want = typeof filter === "string" && filter ? String(filter) : "";
    for (;;) {
      const box = readJson(file, null);
      if (box && Array.isArray(box.msgs) && box.msgs.length) {
        const before = box.msgs.length;
        pruneExpiredBox(box);
        const pruned = box.msgs.length !== before;
        let matched = box.msgs;
        let kept = [];
        if (want) {
          matched = box.msgs.filter((m) => String(m.message ?? "").includes(want));
          kept = box.msgs.filter((m) => !String(m.message ?? "").includes(want));
        }
        if (matched.length) {
          if (!want && !pruned) {
            await unlink(file).catch(() => {});
          } else if (kept.length) {
            await writeJson(file, { msgs: kept.slice(-MAX_MSGS) });
          } else {
            await unlink(file).catch(() => {});
          }
          if (digestMode) {
            return out(matched.map(formatMsgDigest).join("\n") + `\n(${matched.length} msgs digest — full via recv sem digest)`);
          }
          return out(matched.map((m) => `[${m.from} ${m.ts}] ${m.message}`).join("\n"));
        }
        if (pruned) {
          if (box.msgs.length) await writeJson(file, box);
          else await unlink(file).catch(() => {});
        }
      }
      if (Date.now() >= deadline) {
        return out(waitMs > 0 ? `(no messages after ${Math.round(waitMs / 1000)}s — chame de novo para continuar esperando)` : "(no messages)");
      }
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(1, deadline - Date.now()))));
    }
  },
});

reg("n_task_peek", {
  description: "Espia mailbox SEM esvaziar. Retorna últimas N + idade. Expirada (ttl) é oculta. filter opcional: só mostra o que casa.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Caixa (padrão TASK_ID env)" },
      limit: { type: "number", description: "Quantas mostrar (padrão 5)", default: 5 },
      filter: { type: "string", description: "Substring; só mostra o que casa (não consome)" },
      digest: { type: "boolean", default: false, description: "Se true, retorna digest 1 linha/msg (de|idade|1ª linha) em vez do texto integral (não consome, igual)" },
    },
    required: [],
  },
  run: async ({ task_id, limit, filter, digest }) => {
    const digestMode = digest === true;
    const id = task_id || process.env.TASK_ID;
    if (!id) return out("no task_id and no TASK_ID env", true);
    const file = join(MB_DIR, `${id}.json`);
    const box = readJson(file, null);
    if (!box || !Array.isArray(box.msgs) || !box.msgs.length) return out("(no messages)");
    const before = box.msgs.length;
    pruneExpiredBox(box);
    if (box.msgs.length !== before) {
      if (box.msgs.length) await writeJson(file, box);
      else await unlink(file).catch(() => {});
    }
    if (!box.msgs.length) return out("(no messages)");
    const want = typeof filter === "string" && filter ? String(filter) : "";
    const view = want ? box.msgs.filter((m) => String(m.message ?? "").includes(want)) : box.msgs;
    if (!view.length) return out("(no messages)");
    const n = Math.min(Math.max(Number(limit) || 5, 1), MAX_MSGS);
    const slice = view.slice(-n);
    if (digestMode) {
      return out(slice.map(formatMsgDigest).join("\n") + `\n(${slice.length}/${view.length} msgs digest${want ? ` filter:"${want}"` : ""})`);
    }
    return out(slice.map((m) => `[${m.from} ${m.ts} age_${Math.round(msgAgeMs(m) / 1000)}s] ${m.message}`).join("\n") + `\n(${slice.length}/${view.length} msgs${want ? ` filter:"${want}" de ${box.msgs.length}` : ""})`);
  },
});

reg("n_task_tail", {
  description: "Mostra o que o subagente está GERANDO agora (transcrição parcial ao vivo via arquivo de saída). Quando sessions parece parado mas há tokens: revela o texto já emitido. Barato, sem interferir. Finalizada → resultado completo em n_task_status.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID da task" },
      chars: { type: "number", description: "Máx chars da transcrição (default 2000, máx 20000)" },
    },
    required: ["task_id"],
  },
  run: async ({ task_id, chars }) => {
    let t = resolveTask(task_id);
    if (!t) return out(`task ${task_id} not found`, true);
    if (t.status === "running") {
      const sessionId = t.sessionId || findSessionByTitle(task_id);
      if (sessionId && isSessionDone(sessionId)) {
        await finalizeDetachedIfDead(task_id).catch(() => {});
        t = resolveTask(task_id) || t;
      }
    }
    const cap = Math.min(Math.max(Number(chars) || 2000, 100), 20000);
    let raw = "";
    const sessionId = t.sessionId || findSessionByTitle(task_id);
    if (sessionId) {
      const parts = getSessionParts(sessionId);
      for (const p of parts) {
        if (p.ptype === "text" && p.txt) {
          let t = p.txt;
          if (t.startsWith('"') && t.endsWith('"')) { try { t = JSON.parse(t); } catch {} }
          if (!t.includes("[ORCHESTRATION]")) raw += t + "\n";
        }
      }
    }
    if (!raw) raw = t.tailRaw || "";
    const transcript = raw.slice(-cap);
    const alive = t.pid && procAlive(t.pid);
    const head = `[${t.status || "unknown"}] ${t.id}${alive ? " (gerando agora — parcial)" : t.status === "running" ? " (running, consultando DB)" : " (finalizada — completo em n_task_status)"}`;
    return out(transcript ? `${head}\n\n${transcript}` : `${head}\n(sem tokens ainda — modelo não emitiu texto ou sessão não encontrada na DB)`);
  },
});

reg("n_task_notifications", {
  description: "Lê notifs de tasks + correio dormindo. Esvazia notifs. Expirada (ttl) é oculta.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    const notifs = [];
    try {
      const files = readdirSync(NOTIF_DIR);
      for (const f of files) {
        try {
          const data = JSON.parse(readFileSync(join(NOTIF_DIR, f), "utf8"));
          notifs.push(data);
          await unlink(join(NOTIF_DIR, f)).catch(() => {});
        } catch {}
      }
    } catch {}
    let text = notifs.length ? notifs.map((n) => `[${n.ts}] ${n.taskId} (${n.description}) — ${n.status}${n.summary ? `: ${n.summary.slice(0, 150)}` : ""}`).join("\n") : "(no notifications)";
    // cartas dormidas: caixas com msg não lida (ninguém deu recv)
    try {
      const mbf = readdirSync(MB_DIR).filter((f) => f.endsWith(".json"));
      const sleeping = [];
      for (const f of mbf) {
        try {
          const b = JSON.parse(readFileSync(join(MB_DIR, f), "utf8"));
          if (!b || !Array.isArray(b.msgs) || !b.msgs.length) continue;
          const before = b.msgs.length;
          pruneExpiredBox(b);
          if (b.msgs.length !== before) {
            if (b.msgs.length) await writeJson(join(MB_DIR, f), b);
            else await unlink(join(MB_DIR, f)).catch(() => {});
          }
          if (b && b.msgs && b.msgs.length) sleeping.push(`${f.replace(/\.json$/, "")}: ${b.msgs.length} não lida(s), última ${b.msgs[b.msgs.length - 1].ts}`);
        } catch {}
      }
      if (sleeping.length) text += `\n-- correio dormindo (sem recv) --\n${sleeping.join("\n")}`;
    } catch {}
    return out(text);
  },
});

reg("n_todowrite", {
  description: "Substitui (replace, padrão) ou mescla (append por content igual) a lista in-memory. Volátil (morre com o processo).",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
            priority: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["content"],
        },
      },
      mode: { type: "string", enum: ["append", "replace"], default: "replace", description: "replace substitui tudo; append mescla por content igual atualizando status/priority" },
    },
    required: ["todos"],
  },
  run: ({ todos, mode }) => {
    const list = Array.isArray(todos) ? todos : [];
    if ((mode || "replace") === "append") {
      for (const t of list) {
        const ex = todo.find((x) => x.content === t.content);
        if (ex) {
          if (t.status) ex.status = t.status;
          if (t.priority) ex.priority = t.priority;
        } else todo.push({ content: t.content, status: t.status || "pending", priority: t.priority || "medium" });
      }
    } else {
      todo.length = 0;
      for (const t of list) todo.push({ content: t.content, status: t.status || "pending", priority: t.priority || "medium" });
    }
    return out(fmtTodo());
  },
});

function fmtTodo() {
  return todo.length
    ? todo.map((t, i) => `[${i}] ${t.status.padEnd(11)} ${t.priority.padEnd(6)} ${t.content}`).join("\n")
    : "(empty)";
}

reg("n_todo", {
  description: "Read the in-memory task list.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => out(fmtTodo()),
});

reg("n_question", {
  description: "Registra pergunta p/ o usuário. MCP não renderiza UI — o agente pergunta diretamente. multiple permite várias opções; id só ecoa p/ referência.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "Pergunta a exibir" },
      options: { type: "array", items: { type: "string" }, description: "Opções de resposta" },
      multiple: { type: "boolean", description: "Permite marcar várias opções", default: false },
      id: { type: "string", description: "Nome da pergunta; só ecoa no retorno p/ referência" },
    },
    required: ["question"],
  },
  run: ({ question, options, multiple, id }) =>
    out(
      `QUESTION${id ? ` [${id}]` : ""}${multiple ? " (múltipla escolha)" : ""}: ${question}${options?.length ? ` | options: ${options.join(" / ")}` : ""}\n(MCP não renderiza UI; o agente deve perguntar diretamente ao usuário.)`
    ),
});

reg("n_skill", {
  description: "Carrega SKILL.md por nome. refresh:true só lista skills (re-scan p/ recém-criadas).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nome da skill" },
      refresh: { type: "boolean", description: "Lista skills recarregando o scan", default: false },
    },
    required: [],
  },
  run: async ({ name, refresh }) => {
    if (refresh) {
      const known = await skillNames();
      return out(`skills (${known.length}): ${known.join(", ") || "(none)"} (scan recarregado)`);
    }
    if (!name) return out(`informe name ou use refresh:true. Disponíveis: ${(await skillNames()).join(", ") || "(none)"}`, true);
    const candidates = [
      join(CWD, ".agents", "skills", name, "SKILL.md"),
      join(CWD, ".opencode", "skills", name, "SKILL.md"),
      join(HOME, ".claude", "skills", name, "SKILL.md"),
      join(HOME, ".agents", "skills", name, "SKILL.md"),
      join(HOME, ".config", "opencode", "skills", name, "SKILL.md"),
    ];
    for (const f of candidates) {
      if (existsSync(f)) {
        return out(`# skill ${name}\nsource: ${f}\n\n${trimOut(readFileSync(f, "utf8"), 40000)}`);
      }
    }
    const known = await skillNames();
    return out(`skill "${name}" not found. Available: ${known.join(", ") || "(none)"}`, true);
  },
});

async function skillNames() {
  const roots = [
    [CWD, ".agents", "skills"],
    [CWD, ".opencode", "skills"],
    [HOME, ".claude", "skills"],
    [HOME, ".agents", "skills"],
    [HOME, ".config", "opencode", "skills"],
  ];
  const names = new Set();
  for (const r of roots) {
    const base = join(...r);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(base, d.name, "SKILL.md"))) names.add(d.name);
    }
  }
  return [...names].sort();
}

reg("n_plan", {
  description: "Plan mode cannot be toggled from an MCP server; use /plan in the TUI.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => out("To enter/exit plan mode use the TUI command /plan. No equivalent exists inside this MCP."),
});

export { tasks, taskId, persistTask, resolveTask, sweepTask, safeTaskIds, readJson, writeJson, TASKS_DIR, MB_DIR, notifyMain, taskId as newTaskId, escapeShellArg, escapeSql };
