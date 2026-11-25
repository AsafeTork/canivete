// canivete — auto-atualização SEM comando do dono: a única dependência é a internet.
// Roda dentro do daemon MCP (--http): consulta origin/main, faz fast-forward só com
// árvore limpa e agenda o restart FORA do cgroup do serviço (restart de dentro mataria
// a própria chamada). A extensão é recarregada pela ponte no mesmo ciclo.
import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ubListExtensions, ubSend } from "./ubridge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CFG = process.env.CANIVETE_CONFIG_DIR || join(homedir(), ".config/canivete");
const STATUS_FILE = join(CFG, "auto-update.json");
const INTERVAL = Math.min(Math.max(Number(process.env.CANIVETE_AUTOUPDATE_MS) || 300000, 60000), 3600000);
const ENABLED = String(process.env.CANIVETE_NO_AUTOUPDATE || "") !== "1";

let status = { at: null, state: "inativo", detail: "daemon iniciado", commit: null };
function setStatus(state, detail, commit) {
  status = { at: new Date().toISOString(), state, detail: String(detail || "").slice(0, 240), commit: commit || status.commit };
  try {
    mkdirSync(CFG, { recursive: true });
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch {}
}
export function autoUpdateStatus() { return { ...status, intervalMs: INTERVAL, enabled: ENABLED }; }

const git = (args) => new Promise((ok, fail) => {
  execFile("git", args, { cwd: ROOT, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (e, so, se) => {
    if (e) fail(new Error(String(se || e.message || e).trim().slice(0, 200)));
    else ok(String(so).trim());
  });
});

async function tick() {
  try {
    const branch = await git(["branch", "--show-current"]);
    if (branch !== "main") { setStatus("skip", `branch ${branch || "detached"} — auto-update só em main`); return; }
    const dirty = await git(["status", "--porcelain"]);
    if (dirty) { setStatus("skip", "árvore com alterações locais — update adiado"); return; }
    await git(["fetch", "--quiet", "origin", "main"]); // aqui está a dependência da internet
    const remote = await git(["rev-parse", "origin/main"]);
    const local = await git(["rev-parse", "HEAD"]);
    if (local === remote) { setStatus("ok", "já está em origin/main", local.slice(0, 12)); return; }
    await git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
    await git(["merge", "--ff-only", "--quiet", "origin/main"]);
    const now = await git(["rev-parse", "HEAD"]);
    setStatus("atualizado", `${local.slice(0, 12)} → ${now.slice(0, 12)}`, now.slice(0, 12));
    try {
      for (const ext of ubListExtensions().filter((e) => e.connected)) {
        ubSend("tab.reload-extension", {}, 15000, ext.id).catch(() => {});
      }
    } catch {}
    // systemd-run cria o restart FORA do cgroup do daemon; se indisponível, detach.
    let scheduled = false;
    try {
      const child = spawn("systemd-run", ["--user", "--on-active=2", "--unit=canivete-autoupdate-restart", "systemctl", "--user", "restart", "canivete"], { stdio: "ignore", detached: true });
      child.once("error", () => {});
      child.unref();
      scheduled = true;
    } catch {}
    if (!scheduled) {
      const t = setTimeout(() => {
        try { spawn("systemctl", ["--user", "restart", "canivete"], { stdio: "ignore", detached: true }).unref(); } catch {}
      }, 2000);
      t.unref();
    }
  } catch (e) {
    setStatus("erro", String(e && e.message ? e.message : e).slice(0, 240));
  }
}

let running = false;
export function startAutoUpdate() {
  if (!ENABLED) { setStatus("desligado", "CANIVETE_NO_AUTOUPDATE=1"); return; }
  setStatus("verificando", "_primeira checagem em 15s_");
  const timer = setTimeout(tick, 15000);
  timer.unref();
  const loop = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } finally { running = false; }
  }, INTERVAL);
  loop.unref();
}
