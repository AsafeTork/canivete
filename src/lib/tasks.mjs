// canivete — orquestração: spawn de subagentes (runner plugável) + mailbox + todos + meta(skills)
import { spawn, execSync } from "node:child_process";
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { reg, out, trimOut, CWD, HOME, sendToHost } from "./ctx.mjs";

const todo = [];

// ---- canivete: configuração universal (env) ----
const RUNNER = process.env.CANIVETE_RUNNER || "opencode";
const isOpencode = RUNNER === "opencode" || RUNNER.endsWith("/opencode");
// Template genérico: {prompt} {model} {agent} {id} (ex: "claude -p {prompt}", "codex exec {prompt}")
const RUN_TEMPLATE = process.env.CANIVETE_RUN_TEMPLATE || "";
const TASK_TITLE_PREFIX = process.env.CANIVETE_TASK_PREFIX || "canivete-task-";
const HOST_GUARD_MS = Number(process.env.CANIVETE_HOST_GUARD_MS) || 170000;
const MAX_MSGS = Number(process.env.CANIVETE_MAX_MSGS) || 100;
const MAX_MSG_CHARS = Number(process.env.CANIVETE_MAX_MSG_CHARS) || 4000;
const KNOWN_AGENTS = (process.env.CANIVETE_AGENTS || "mcp-only,explore,quick,general,reviewer").split(",").map((s) => s.trim()).filter(Boolean);
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
    try { execSync("command -v opencode", { stdio: ["ignore", "pipe", "pipe"] }); return null; }
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
const BROKER_DIR = process.env.MCP_BROKER_DIR || join(tmpdir(), `opencode-mcp-broker-${cwdTag(CWD)}`);
const TASKS_DIR = join(BROKER_DIR, "tasks");
const MB_DIR = join(BROKER_DIR, "mailbox");

const writeLocks = new Map();
async function writeJson(file, data) {
  const prev = writeLocks.get(file) || Promise.resolve();
  const next = prev
    .then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
    })
    .catch(() => {});
  writeLocks.set(file, next);
  await next;
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
}

function safeTaskIds() {
  try {
    return readdirSync(TASKS_DIR).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

const tasks = new Map();
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
  return `[ORCHESTRATION] Você é o agente ${id}. Regras MCP DevEngine:
- Nomes: as tools aparecem aqui como native_n_* (prefixo do servidor); "n_*" é o mesmo nome sem prefixo. Prefira sempre n_*: saída truncada e uso auditável em ## Tools usados.
- Modelos: o principal escolheu este explicitamente via n_list_models. opencode-go/*, hy3-free e desconhecidos são BLOQUEADOS (isError).
- DevEngine preferir: n_get_architecture_summary, n_investigate_issue, n_analyze_change_impact, n_apply_semantic_patch, n_execute_targeted_tests
- Comunicação (contrato, sem preempção): send é staging em arquivo — ninguém é interrompido; o receptor só vê a msg se chamar recv/status. Para ESPERAR sem gastar tokens: n_task_recv({timeout:ms}) espera até 170s no servidor. Para AVISAR o principal no meio da task: n_task_send({task_id:"main", message}). Para COORDENAR peers: o principal injeta os task_ids nos prompts + handshake explícito (ex: "após etapa 1 faça recv com timeout; enviarei GO"). Mailbox tem teto (100 msgs/4000 chars); recv esvazia (destrutivo); delete em running encerra o processo. Respostas trazem 📬 quando há notificações pendentes — leia n_task_notifications então. O principal pode ver sua geração ao vivo via n_task_tail.
- Ao terminar, responda com resultado + ## Tools usados.\n\n`;
}

const NOTIF_DIR = join(BROKER_DIR, "notifications");
mkdirSync(NOTIF_DIR, { recursive: true });

async function notifyMain(taskId, status, description, model, summary) {
  const ts = new Date().toISOString();
  const payload = { taskId, status, description, model, ts, summary: (summary || "").slice(0, 500) };
  try {
    await writeJson(join(NOTIF_DIR, `${taskId}.json`), payload);
  } catch {}
  try {
    const mainMailbox = join(MB_DIR, "main.json");
    let box;
    try { box = JSON.parse(readFileSync(mainMailbox, "utf8")); } catch { box = { msgs: [] }; }
    pushCapped(box, taskId, `[${ts}] task ${taskId} (${description}) — ${status}`);
    await writeJson(mainMailbox, box);
  } catch {}
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
  try {
    process.kill(t.pid, "SIGTERM");
    return t.pid;
  } catch {
    return null;
  }
}

async function sweepTask(t) {
  if (!t || t.status !== "running" || t.agent === "devengine") return t;
  const age = Date.now() - new Date(t.startedAt).getTime();
  const deadPid = t.pid && !procAlive(t.pid);
  const staleNoPid = !t.pid && age > 60000;
  if (deadPid) {
    try {
      const finalized = await finalizeDetachedIfDead(t.id).catch(() => null);
      if (finalized) return finalized;
    } catch { /* finalize failed, fall through to staleNoPid check */ }
  }
  if (staleNoPid) {
    t.status = "interrupted";
    t.finishedAt = new Date().toISOString();
    t.error = `[modelo: ${t.model || "unknown"}] interrompida — sem PID gravado após 60s (spawn interrompido)`;
    await persistTask(t);
    await notifyMain(t.id, "interrupted", t.description || "", t.model || "", t.error).catch(() => {});
  }
  return t;
}

function pushCapped(box, from, message) {
  const m = String(message ?? "");
  box.msgs.push({ from, ts: new Date().toISOString(), message: m.length > MAX_MSG_CHARS ? m.slice(0, MAX_MSG_CHARS) + `...[truncated ${m.length - MAX_MSG_CHARS} chars]` : m });
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
  description: "Spawn subagente isolado (runner: opencode ou genérico via CANIVETE_RUN_TEMPLATE). model OBRIGATÓRIO no modo opencode: n_list_models → escolha → passe em {model}. TIPOS (subagent_type): mcp-only (default, só n_*) | explore | quick | general | reviewer. WORKFLOW: decomponha, fan-out N× background:true, n_task_wait any/all, n_task_send (+n_task_send p/ 'main'). Sync bloqueia. Fim gera notificação. Ao vivo: n_task_tail. Delete em running mata o processo.",
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
    },
    required: ["prompt", "model"],
  },
  run: async ({ description, subagent_type, prompt, model, timeout, background, ephemeral }) => {
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
    };
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
        ? spawn("opencode", args, {
            cwd: CWD,
            env: { ...process.env, TASK_ID: id, MCP_BROKER_DIR: BROKER_DIR },
            stdio: "ignore",
            detached: true,
          })
        : spawn("bash", ["-lc", RUN_TEMPLATE.replaceAll("{prompt}", prompt).replaceAll("{model}", chosenModel).replaceAll("{agent}", agent).replaceAll("{id}", id)], {
            cwd: CWD,
            env: { ...process.env, TASK_ID: id, MCP_BROKER_DIR: BROKER_DIR },
            stdio: ["ignore", "pipe", "pipe"],
          });
      if (!isOpencode) {
        // modo genérico: captura stdout/stderr em .out (sem session DB)
        let outBuf = "";
        child.stdout?.on("data", (d) => { outBuf += d; if (outBuf.length > 100000) outBuf = outBuf.slice(-100000); });
        child.stderr?.on("data", (d) => { outBuf += d; if (outBuf.length > 100000) outBuf = outBuf.slice(-100000); });
        child.on("exit", (code) => {
          try { writeFileSync(join(TASKS_DIR, `${id}.out`), outBuf); } catch {}
        });
      }
      let killed = false;
      let sessionId = null;
      const timer = setTimeout(() => { killed = true; try { child.kill("SIGKILL"); } catch {} }, t);
      entry.pid = child.pid;
      entry.lastActivityAt = entry.startedAt;
      persistTask(entry);
      child.unref();
      const finalizeFromDb = async (exitCode, err) => {
        clearTimeout(timer);
        clearInterval(pollDb);
        if (!tasks.has(id)) { entry.status = "deleted"; entry.finishedAt = new Date().toISOString(); resolveP(entry); return; }
        if (!sessionId) sessionId = findSessionByTitle(id);
        const settled = sessionId ? await settleSession(sessionId) : { text: "", parts: [] };
        let responseText = settled.text;
        let toolCalls = [];
        if (sessionId) {
          for (const p of settled.parts) {
            if (p.ptype && p.ptype !== "text" && p.ptype !== "step-start") toolCalls.push(p.ptype);
          }
          entry.sessionId = sessionId;
        }
        entry.exitCode = exitCode;
        entry.status = err ? "failed" : killed ? "timeout" : exitCode === 0 ? "done" : "failed";
        entry.finishedAt = new Date().toISOString();
        entry.tools = [...new Set(toolCalls)];
        const modelTag = `[modelo: ${chosenModel}]`;
        if (err) entry.error = `${modelTag} ${err}`;
        else if (killed) entry.error = `${modelTag} timeout after ${Math.round(t / 1000)}s`;
        else if (exitCode !== 0) entry.error = `${modelTag} falhou (exit ${exitCode})`;
        else entry.error = null;
        entry.result = responseText.trim();
        entry.tailRaw = responseText.slice(-30000);
        persistTask(entry);
        const summary = entry.error || (entry.result ? entry.result.slice(0, 200) : "");
        notifyMain(id, entry.status, description, chosenModel, summary).catch(() => {});
        try { sendToHost({ method: "notifications/message", params: { level: entry.status === "done" ? "info" : "warning", logger: "native", data: `task ${id} (${description || ""}) — ${entry.status}` } }); } catch {}
        if (entry.ephemeral) { setTimeout(async () => { try { await unlink(join(TASKS_DIR, `${id}.json`)); await unlink(join(MB_DIR, `${id}.json`)).catch(() => {}); tasks.delete(id); } catch {} }, 30000); }
        resolveP(entry);
      };
      const pollDb = setInterval(() => {
        if (!tasks.has(id)) { clearInterval(pollDb); return; }
        if (!sessionId) sessionId = findSessionByTitle(id);
        if (!sessionId) return;
        entry.sessionId = sessionId;
        entry.lastActivityAt = new Date().toISOString();
        const partial = getSessionAssistantText(sessionId);
        if (partial) entry.tailRaw = partial.slice(-30000);
        if (isSessionDone(sessionId)) { finalizeFromDb(0, null).catch(() => {}); }
      }, 2000);
      child.on("error", (err) => { clearInterval(pollDb); finalizeFromDb(-1, err.message).catch(() => {}); });
      child.on("exit", (code) => {
        setTimeout(() => {
          if (!tasks.has(id) || tasks.get(id).status !== "running") return;
          if (!sessionId) sessionId = findSessionByTitle(id);
          if (sessionId && isSessionDone(sessionId)) { finalizeFromDb(code, null).catch(() => {}); }
          else finalizeFromDb(code, code === 0 ? null : `exit ${code}`).catch(() => {});
        }, 2000);
      });
    });
    entry.donePromise = donePromise;
    await persistTask(entry); // garante pid no disco (fecha race pid:null → zombie imortal)
    if (background) {
      const eph = ephemeral ? " [ephemeral auto-exclui em 30s]" : "";
      return out(`task ${id} spawned in background (${agent} | ${chosenModel})${eph}\npara esperar: n_task_wait({ task_ids: ["${id}"], wait: "all" | "any", timeout })\npara comunicar: n_task_send({ task_id: "${id}", message: "..." })\npara excluir: n_task_delete({task_id:"${id}"}) ou n_task_delete({task_id:"all"})`);
    }
    let fin;
    if (t > HOST_GUARD_MS) {
      fin = await Promise.race([donePromise, new Promise((r) => setTimeout(() => r(null), HOST_GUARD_MS))]);
      if (!fin) {
        return out(`task ${id} ainda rodando após ${Math.round(HOST_GUARD_MS / 1000)}s (limite de resposta; continua em background)\npara esperar: n_task_wait({ task_ids: ["${id}"], wait: "all" })\npara status: n_task_status({ task_id: "${id}" })`);
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
    const header = `[${agent} ${fin.status} | ${fin.model || chosenModel}${fin.ephemeral ? " | ephemeral" : ""}, exit ${fin.exitCode}]\ntools usados: ${fin.tools.length ? fin.tools.join(", ") : "nenhum"}`;
    return out((fin.error && !fin.result ? `${header}\n${fin.error}` : header + (fin.result ? `\n\n${trimOut(fin.result, 20000)}` : "\n(sem resposta)")) + pendingHints());
  },
});

function resolveTask(id) {
  return tasks.get(id) || readJson(join(TASKS_DIR, `${id}.json`), null);
}

function opencodeDbQuery(sql) {
  if (!isOpencode) return [];
  try {
    const result = execSync(`opencode db "${sql.replace(/"/g, '\\"')}" --format json`, {
      cwd: CWD, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch { return []; }
}

function findSessionByTitle(taskId) {
  const rows = opencodeDbQuery(`SELECT id FROM session WHERE title='${TASK_TITLE_PREFIX}${taskId}' ORDER BY time_created DESC LIMIT 1`);
  return rows.length ? rows[0].id : null;
}

function getSessionAssistantText(sessionId) {
  if (!sessionId) return "";
  const rows = opencodeDbQuery(
    `SELECT json_extract(p.data,'$.text') as txt FROM part p WHERE p.session_id='${sessionId}' AND json_extract(p.data,'$.type')='text' ORDER BY p.time_created`
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
    `SELECT json_extract(p.data,'$.type') as ptype, json_extract(p.data,'$.text') as txt FROM part p WHERE p.session_id='${sessionId}' ORDER BY p.time_created`
  );
}

// Race fix: o session DB do opencode commita parts/texto assincronamente após o fim da sessão;
// ler cedo demais devolve result/tools vazios. settleSession repete a leitura até texto
// não-vazio ou esgotar tries (3s sleep entre tentativas).
async function settleSession(sessionId, tries = 4) {
  let text = "";
  let parts = [];
  if (!sessionId) return { text, parts };
  for (let attempt = 1; attempt <= tries; attempt++) {
    text = getSessionAssistantText(sessionId);
    parts = getSessionParts(sessionId);
    if (text) return { text, parts };
    if (attempt < tries) await new Promise((r) => setTimeout(r, 3000));
  }
  return { text, parts };
}

function isSessionDone(sessionId) {
  if (!sessionId) return false;
  const rows = opencodeDbQuery(`SELECT time_updated, time_created FROM session WHERE id='${sessionId}'`);
  if (!rows.length) return false;
  const s = rows[0];
  return s.time_updated > s.time_created + 3000 && getSessionParts(sessionId).some((p) => p.ptype === "text" && p.txt);
}

function exportSession(sessionId) {
  if (!sessionId) return null;
  try {
    const result = execSync(`opencode export "${sessionId}"`, {
      cwd: CWD, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch { return null; }
}

async function finalizeDetachedIfDead(id) {
  const t = resolveTask(id);
  if (!t || t.status !== "running") return null;
  const sessionId = t.sessionId || findSessionByTitle(id);
  const sessionDone = sessionId ? isSessionDone(sessionId) : false;
  const pidDead = t.pid ? !procAlive(t.pid) : true;
  if (!sessionDone && !pidDead) return null;
  const settled = sessionId ? await settleSession(sessionId) : { text: "", parts: [] };
  let responseText = settled.text;
  let toolCalls = [];
  if (sessionId) {
    for (const p of settled.parts) {
      if (p.ptype && p.ptype !== "text" && p.ptype !== "step-start") toolCalls.push(p.ptype);
    }
  }
  if (!responseText) responseText = (() => { try { return readFileSync(join(TASKS_DIR, `${id}.out`), "utf8"); } catch { return ""; } })();
  t.exitCode = 0;
  t.status = "done";
  t.finishedAt = new Date().toISOString();
  t.tools = [...new Set(toolCalls)];
  t.result = responseText.trim();
  t.error = null;
  t.sessionId = sessionId;
  persistTask(t);
  notifyMain(t.id, t.status, t.description, t.model, (t.result || "").slice(0, 200)).catch(() => {});
  return t;
}

async function pollDetached(ids, deadline) {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (Date.now() > deadline) { clearInterval(interval); resolve(null); return; }
      for (const id of ids) {
        const t = resolveTask(id);
        if (!t || t.status !== "running") { clearInterval(interval); resolve(t); return; }
        const sessionId = t.sessionId || findSessionByTitle(id);
        if (sessionId && isSessionDone(sessionId)) { clearInterval(interval); resolve(await finalizeDetachedIfDead(id).catch(() => null)); return; }
        if (t.pid && !procAlive(t.pid)) { clearInterval(interval); resolve(await finalizeDetachedIfDead(id).catch(() => null)); return; }
      }
    }, 2000);
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
    },
    required: [],
  },
  run: async ({ task_ids, wait, timeout }) => {
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
      if (already) return formatTaskResult([already], true, ids.filter((i) => i !== already.id));
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
          return formatTaskResult([firstDone], true, ids.filter((i) => i !== firstDone.id));
        }
        const lines = [`wait timeout after ${Math.round(waitMs / 1000)}s (clamp ${Math.round(HOST_GUARD_MS / 1000)}s = host timeout; chame de novo para continuar esperando)`];
        for (const id of ids) {
          const t = resolveTask(id);
          lines.push(`[${t?.status}] ${id} ${t?.description || ""}`.trim());
        }
        return out(lines.join("\n"));
      }
      return formatTaskResult([first], true, ids.filter((i) => i !== first.id));
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
      return formatTaskResult([...doneById.values()], false, []);
    }
    done = ids.map((i) => resolveTask(i)).filter(Boolean);
    const running = done.filter((t) => t.status === "running");
    if (running.length) {
      return out(`wait timeout — ainda rodando: ${running.map((t) => `${t.id} (${t.status})`).join(", ")} (chame n_task_wait de novo para continuar esperando)`);
    }
    return formatTaskResult(done, false, []);
  },
});

function formatTaskResult(done, any, still) {
  const blocks = done.map((raw) => {
    const t = raw && typeof raw === "object" ? raw : {};
    const tools = Array.isArray(t.tools) ? t.tools : [];
    const head = `[${t.status || "unknown"}] ${t.id || "?"} — ${t.description || "(sem descrição)"} | ${t.model || "unknown"} (exit ${t.exitCode})\ntools: ${tools.length ? tools.join(", ") : "nenhum"}`;
    return head + (t.result ? `\n\n${trimOut(t.result, 20000)}` : t.error ? `\n\n${t.error}` : "");
  });
  return out(
    `${done.length} task(s) ${any ? "concluída(s) (primeira)" : "concluída(s) (todas)"}:\n` +
      blocks.join("\n\n---\n\n") +
      (still.length ? `\n\nainda rodando: ${still.join(", ") || "nenhum"}` : "") +
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
  description: "Envia mensagem para mailbox (disco compartilhado, NÃO-bloqueante, sem preempção: o receptor só vê ao chamar n_task_recv/n_task_status). task_id pode ser outra task ou 'main' (worker→principal). Sem ACK e sem resposta automática.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      message: { type: "string" },
      from: { type: "string", description: "Sender id (default 'main')" },
    },
    required: ["task_id", "message"],
  },
  run: async ({ task_id, message, from }) => {
    if (task_id !== "main" && !resolveTask(task_id)) return out(`task ${task_id} not found`, true);
    const file = join(MB_DIR, `${task_id}.json`);
    const box = pushCapped(readJson(file, { msgs: [] }), from || "main", message);
    await writeJson(file, box);
    return out(`delivered to ${task_id} (mailbox ${box.msgs.length} msg(s), cap ${MAX_MSGS})` + pendingHints());
  },
});

reg("n_task_delete", {
  description: "Exclui task(s) e mailbox para organizar. Em running: encerra o processo (tombstone, sem ressuscitar). Use para coletores de informação ou quando o principal não for usar mais. Auto: n_task com ephemeral:true já exclui após done.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID ou 'all' para todos done/failed, 'ephemeral' para só coletores" },
      delete_mailbox: { type: "boolean", description: "Também apaga mailbox (default true)" },
    },
    required: ["task_id"],
  },
  run: async ({ task_id, delete_mailbox }) => {
    const doDelMb = delete_mailbox !== false;
    if (task_id === "all" || task_id === "ephemeral") {
      const ids = safeTaskIds();
      let n = 0, kills = 0;
      for (const id of ids) {
        const t = readJson(join(TASKS_DIR, `${id}.json`), null);
        const isEphemeral = !t || t.ephemeral === true || t.description?.startsWith("[ephemeral]");
        if (task_id === "all" ? t?.status !== "running" : isEphemeral) {
          try {
            if (tryKill(t)) kills++;
            await unlink(join(TASKS_DIR, `${id}.json`));
            if (doDelMb) await unlink(join(MB_DIR, `${id}.json`)).catch(() => {});
            tasks.delete(id);
            n++;
          } catch {}
        }
      }
      return out(`excluídos ${n} task(s) (${task_id})${kills ? `, ${kills} processo(s) encerrado(s)` : ""}`);
    }
    const t = resolveTask(task_id);
    if (!t) return out(`task ${task_id} not found`, true);
    const killedPid = tryKill(t);
    try {
      await unlink(join(TASKS_DIR, `${task_id}.json`));
      if (doDelMb) await unlink(join(MB_DIR, `${task_id}.json`)).catch(() => {});
      tasks.delete(task_id);
      return out(`task ${task_id} excluída${killedPid ? ` (processo ${killedPid} encerrado)` : t.status === "running" ? " (processo já morto)" : ""}`);
    } catch (e) {
      return out(`falha ao excluir: ${e.message}`, true);
    }
  },
});

reg("n_task_recv", {
  description: "Lê e esvazia a mailbox (leitura destrutiva; espiada não-destrutiva só via n_task_status mailbox:N). Usa TASK_ID env se task_id omitido. timeout opcional (ms) espera até chegar msg — poll 1s no servidor, sem gastar tokens; sem timeout retorna imediato. Sem preempção: ninguém é interrompido.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      timeout: { type: "number", description: "Espera até N ms por mensagem (máx 170s). Omitido = retorno imediato." },
    },
    required: [],
  },
  run: async ({ task_id, timeout }) => {
    const id = task_id || process.env.TASK_ID;
    if (!id) return out("no task_id and no TASK_ID env", true);
    const file = join(MB_DIR, `${id}.json`);
    const waitMs = Math.min(Number(timeout) || 0, HOST_GUARD_MS);
    const deadline = Date.now() + waitMs;
    for (;;) {
      const box = readJson(file, null);
      if (box && box.msgs.length) {
        await unlink(file).catch(() => {});
        return out(box.msgs.map((m) => `[${m.from} ${m.ts}] ${m.message}`).join("\n"));
      }
      if (Date.now() >= deadline) {
        return out(waitMs > 0 ? `(no messages after ${Math.round(waitMs / 1000)}s — chame de novo para continuar esperando)` : "(no messages)");
      }
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(1, deadline - Date.now()))));
    }
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
  description: "Lê notificações de tasks que terminaram (done/failed/timeout/interrompida). Esvazia após ler. Use para saber quando subagentes concluíram sem polling.",
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
    if (!notifs.length) return out("(no notifications)");
    return out(notifs.map((n) => `[${n.ts}] ${n.taskId} (${n.description}) — ${n.status}${n.summary ? `: ${n.summary.slice(0, 150)}` : ""}`).join("\n"));
  },
});

reg("n_todowrite", {
  description: "Replace the server-side task list (in-memory).",
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
    },
    required: ["todos"],
  },
  run: ({ todos }) => {
    todo.length = 0;
    for (const t of todos) todo.push({ content: t.content, status: t.status || "pending", priority: t.priority || "medium" });
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
  description: "Register a question for the user (MCP cannot render interactive options).",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array", items: { type: "string" } },
    },
    required: ["question"],
  },
  run: ({ question, options }) =>
    out(
      `QUESTION: ${question}${options?.length ? ` | options: ${options.join(" / ")}` : ""}\n(The main agent must ask the user directly; no interactive prompt exists inside MCP.)`
    ),
});

reg("n_skill", {
  description: "Load a skill's SKILL.md by name from all local skill directories.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
  run: async ({ name }) => {
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

export { tasks, taskId, persistTask, resolveTask, sweepTask, safeTaskIds, readJson, writeJson, TASKS_DIR, MB_DIR, notifyMain, taskId as newTaskId };
