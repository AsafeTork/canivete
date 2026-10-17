// canivete — tools de CODESPACE (gh CLI logado do dono): ambiente de testes universal grátis.
// 120 core-h/mês grátis (2-core = 60h) + 15 GB storage; sem cartão. Sem repo = template blank oficial.
// Multi-conta: account="user" usa o token DESSE usuário (gh auth token -u) sem trocar a conta ativa global.
// Login de contas novas: n_codespace_login gera LINK de 1 clique (device flow com user_code na URL) na hora do pedido.
import { reg, devOut, fallbackHint, exec, trimOut } from "./ctx.mjs";

const BLANK_REPO = "github/codespaces-blank"; // codespace SEM vínculo com projeto (template oficial)
const DEFAULT_MACHINE = "basicLinux32gb"; // 2-core/8GB — melhor cota grátis (120 core-h = 60h reais)
const SCOPE_HINT = "gh auth refresh -h github.com -s codespace"; // scope 'codespace' faltando no token
// Guard de resposta do host (#50): sync nunca volta acima de ~170s.
const EXEC_TMO = Math.min(Math.max(Number(process.env.CANIVETE_CS_EXEC_TMO) || 120000, 5000), 165000);

// ---- helpers puros (exportados p/ teste sem gh) ----
export function csParseAuth(text) {
  const accounts = [];
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    let m = line.match(/Logged in to \S+ account (\S+)/);
    if (m) { cur = { user: m[1], valid: true, active: false }; accounts.push(cur); continue; }
    m = line.match(/Failed to log in to \S+ account (\S+)/);
    if (m) { cur = { user: m[1], valid: false, active: false }; accounts.push(cur); continue; }
    if (cur && /Active account:\s*true/.test(line)) cur.active = true;
    if (cur && /is invalid\./.test(line)) cur.valid = false;
  }
  return { accounts, active: (accounts.find((a) => a.active) || {}).user || null };
}

export function csParseList(jsonText) {
  let arr = [];
  try { arr = JSON.parse(String(jsonText || "[]")); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => ({
    name: c.name || c.codespace || "",
    displayName: c.displayName || c.name || "",
    state: c.state || "",
    repository: c.repository || "",
    branch: c.branch || "",
    machine: c.machineName || (c.machine && (c.machine.displayName || c.machine.name)) || "",
  })).filter((c) => c.name);
}

export function csScopeIssue(text) {
  return /codespace["\s]*(scope|operation)|needs? the ["']?codespace|Requires? the ["']?codespace/i.test(String(text || ""));
}

export function csCreateArgs({ repo, branch, machine, idleMin, devcontainerPath }) {
  const args = ["gh", "codespace", "create", "--repo", repo || BLANK_REPO, "--machine", machine || DEFAULT_MACHINE, "--default-permissions"];
  if (branch) args.push("--branch", branch);
  if (devcontainerPath) args.push("--devcontainer-path", devcontainerPath);
  const idle = Math.min(Math.max(Number(idleMin) || 30, 5), 240); // 5min..4h — mata ócio (economiza cota)
  args.push("--idle-timeout", `${idle}m`);
  return args;
}

// ---- exec gh com conta opcional (não expõe token nunca) ----
// CANIVETE_GH_CONFIG_DIR: perfil gh compartilhado (multi-conta do serviço, ex /etc/canivete/gh)
const GH_CFG = () => (process.env.CANIVETE_GH_CONFIG_DIR ? { GH_CONFIG_DIR: process.env.CANIVETE_GH_CONFIG_DIR } : {});
async function runGh(args, { account, timeoutMs, cwd } = {}) {
  const env = { ...GH_CFG() };
  if (account) {
    const t = await exec("gh", ["auth", "token", "--user", String(account)], { env: { ...GH_CFG() }, timeout: 15000 });
    const tok = (t.so || "").trim().split(/\r?\n/)[0];
    if (t.code !== 0 || !tok || !tok.startsWith("gh")) {
      const { accounts } = await listAccounts();
      throw new Error(`conta gh "${account}" não está logada/ativa (token não obtido) — contas válidas: ${accounts.filter((a) => a.valid).map((a) => a.user).join(", ") || "(nenhuma)"} | acumule: n_codespace_login gera link de 1 clique`);
    }
    env.GH_TOKEN = tok;
  }
  return exec(args[0], args.slice(1), { timeout: timeoutMs || EXEC_TMO, cwd, env });
}
const ghError = (r) => `${/the codespace|Must have|scope|403|402/i.test(r.se) && !r.se.includes("is invalid") ? `gh: ${(r.se.split("\n")[0] || "").slice(0, 300)}` : (r.killed ? "timeout" : `exit ${r.code ?? "?"}`)}`;

export async function listAccounts() {
  const r = await runGh(["gh", "auth", "status"], { timeoutMs: 15000 });
  return csParseAuth(r.so || r.se || "");
}
function scopeWrap(r) {
  return csScopeIssue(r.se || r.so)
    ? { ...fallbackHint("login sem codespace: rode n_codespace_login (gera o LINK de 1 clique na resposta e guarda o job; confira com n_codespace_login_status)") }
    : {};
}

// ---- login de contas novas: link de 1 clique gerado NA RESPOSTA da tool ----
// job setsid sobrevive entre chamadas (filho do serviço, grupo próprio); log em /tmp com o loginId no nome.
const LOGIN_SCOPES = () => (process.env.CANIVETE_CS_SCOPES || "repo,workflow,codespace,read:org,gist");
function accSummary(auth) {
  return `${auth.accounts.filter((a) => a.valid).length} conta(s) válida(s), ativa: ${auth.active || "?"}`;
}


// ---- 1) LIST: contas + codespaces (passo 1 sempre) ----
reg("n_codespace_list", {
  description: "Lista contas gh logadas + codespaces do ambiente de testes universal (2-core/8GB grátis 60h/mês via cota GitHub). SEMPRE o passo 1: pega o name p/ exec/stop, mostra quem é a conta ATIVA (ou passe account:\"user\" nas demais tools p/ usar outra conta que tenha cota). Erro de scope → rode gh auth refresh -h github.com -s codespace (one-time code no browser).",
  inputSchema: { type: "object", properties: { account: { type: "string", description: "listar codespaces DESTA conta gh (default: conta ativa)" } }, required: [] },
  run: async ({ account } = {}) => {
    const t0 = Date.now();
    const auth = await listAccounts();
    const r = await runGh(["gh", "codespace", "list", "--json", "name,displayName,state,repository,machineName"], { account, timeoutMs: 60000 });
    if (r.killed || r.code !== 0)
      return devOut({ status: "error", summary: `${ghError(r)} — contas gh: ${auth.accounts.map((a) => `${a.user}${a.active ? " [ativa]" : a.valid ? "" : " (token inválido)"}`).join(", ") || "(nenhuma — gh auth login)"}`, data: { accounts: auth.accounts }, ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } });
    const cs = csParseList(r.so);
    const note = account && account !== auth.active ? ` (conta "${account}")` : "";
    const bad = auth.accounts.filter((a) => !a.valid);
    return devOut({
      summary: `${cs.length} código(s) de espaço${note} | conta ativa: ${auth.active || "?"} | contas: ${auth.accounts.map((a) => a.user).join(", ")}`,
      data: { activeAccount: auth.active, accounts: auth.accounts, codespaces: cs, defaultRepo_sem_projetos: BLANK_REPO, default_machine: DEFAULT_MACHINE },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: bad.length
        ? [{ tool: "n_codespace_login", reason: `Acumular/religar ${bad.length} conta(s) sem token válido (${bad.map((b) => b.user).join(", ")}) — link de 1 clique` }]
        : cs.length ? [{ tool: "n_codespace_exec", reason: "Rodar comando no codespace" }] : [{ tool: "n_codespace_create", reason: "Criar ambiente (sem repo = blank)" }],
    });
  },
});

// ---- 2) CREATE: dispara server-side, não trava sync (postCreate de devcontainer pode levar minutos) ----
reg("n_codespace_create", {
  description: "Cria codespace do ambiente de testes (default basicLinux32gb 2-core/8GB; idle-timeout mata ócio e economiza cota). repo omitido = github/codespaces-blank (codespace VAZIO, sem vínculo — teste universal). Volta rápido: a criação continua no servidor — confirme com n_codespace_list em ~2-3min (postCreate com install pode demorar). devcontainerPath: p/ repo com .devcontainer/devcontainer.json próprio.",
  inputSchema: { type: "object", properties: { repo: { type: "string", description: "owner/repo (omitir = blank sem projeto)" }, branch: { type: "string" }, machine: { type: "string", default: DEFAULT_MACHINE, description: "basicLinux32gb (default, melhor cota) | premiumLinux32gb (4-core) — cada um consome 2x/4x core-h" }, idleMin: { type: "number", default: 30, description: "min de ócio antes do auto-stop (5-240; default 30)" }, devcontainerPath: { type: "string" }, account: { type: "string", description: "conta gh que paga a cota (default: ativa)" } }, required: [] },
  run: async (a = {}) => {
    const t0 = Date.now();
    const args = csCreateArgs(a);
    // 25s chega p/ API aceitar a criação (server-side continua); mata o gh (que só ESPERA) => nunca trava sync
    const r = await runGh(args, { account: a.account, timeoutMs: 25000 });
    const started = !r.killed;
    if (r.killed || r.code === 0)
      return devOut({ summary: `criação ${started ? "disparada" : "aceita"}: ${a.repo || BLANK_REPO}${a.branch ? ` @${a.branch}` : ""} — machine ${a.machine || DEFAULT_MACHINE}, idle ${Math.min(Math.max(Number(a.idleMin) || 30, 5), 240)}m, conta ${a.account || "(ativa)"} — confirme com n_codespace_list em ~2-3 min`, data: { repo: a.repo || BLANK_REPO }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_list", reason: "Pegar o name do codespace criado" }] });
    return devOut({ status: "error", summary: `${ghError(r)} — ${/out of monthly free usage|HTTP 402/i.test(r.se || "") ? "cota/budget desta conta esgotado para codespace → acumule outra conta: n_codespace_login gera link de 1 clique, depois account:\"<user>\"" : "tente account de outra conta (n_codespace_list lista as contas)"}`, data: {}, ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// ---- 3) EXEC: comando no codespace (o teste em si) ----
reg("n_codespace_exec", {
  description: "Roda comando bash DENTRO do codespace (build, npm test, smoke, git): gh codespace ssh. Passe name do n_codespace_list (trecho do displayName aceita? NÃO — precisa name exato da list). Teto sync 165s (host corta resposta acima) — tarefa longa: rode com nohup dentro (ex: bash -lc \"nohup npm test > out.log 2>&1 &\") e depois leia out.log em outra exec. Use p/ teste universal; código do repo via git sync.",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "name exato do codespace (n_codespace_list)" }, cmd: { type: "string", description: "comando bash; ex: \"npm run check && node test/smoke.mjs | tail -3\"" }, account: { type: "string", description: "conta gh dona do codespace (default: ativa)" } }, required: ["name", "cmd"] },
  run: async ({ name, cmd, account } = {}) => {
    const t0 = Date.now();
    if (!name || !cmd) return devOut({ status: "error", summary: "name e cmd são obrigatórios (name vem do n_codespace_list)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await runGh(["gh", "codespace", "ssh", "-c", String(name), "--", "bash", "-lc", String(cmd)], { account, timeoutMs: EXEC_TMO });
    const so = (r.so || "").trim(), se = (r.se || "").trim();
    if (r.killed) so && (se = se || "");
    const err = !!(r.killed || r.code !== 0);
    return devOut({
      status: err ? (r.killed && so ? "warn" : "error") : "success",
      summary: `exit=${r.killed ? "timeout" : r.code} (conta ${account || "ativa"}, ${Math.round((Date.now() - t0) / 1000)}s)${err ? "" : " ok"}`,
      data: { exit: r.killed ? "timeout" : r.code, stdout: trimOut(so, 12000), stderr: trimOut(se, 3000) },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_codespace_stop", reason: "Economizar cota: 60h/mês no free" }],
      ...(err ? fallbackHint(r.killed ? "tarefa longa: rode com nohup dentro + leia out.log em outra exec (sync max 165s)" : "confira name em n_codespace_list; erro do comando está em stderr") : {}),
    });
  },
});

// ---- 4) STOP ----
reg("n_codespace_stop", {
  description: "Para codespace (congela; storage continua a contar, compute parado de grátis). Economiza os 60h/mês grátis. Passe name do n_codespace_list. all=true para TODOS os codespaces da conta (ghosts incluídos).",
  inputSchema: { type: "object", properties: { name: { type: "string" }, all: { type: "boolean", description: "para todos os codespaces da conta" }, account: { type: "string" } }, required: [] },
  run: async ({ name, all, account } = {}) => {
    const t0 = Date.now();
    if (!name && !all) return devOut({ status: "error", summary: "passe name (do n_codespace_list) ou all:true", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    let names = ["..."];
    if (all) {
      const lst = await runGh(["gh", "codespace", "list", "--json", "name,state"], { account, timeoutMs: 60000 });
      names = csParseList(lst.so).filter((c) => c.state === "Active").map((c) => c.name);
      if (!names.length) return devOut({ summary: "nada rodando", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const results = [];
    for (const n of names) {
      const r = await runGh(["gh", "codespace", "stop", "-c", n], { account, timeoutMs: 60000 });
      results.push({ name: n, ok: r.code === 0 && !r.killed, error: r.code === 0 && !r.killed ? undefined : ghError(r) });
    }
    const ok = results.filter((x) => x.ok).length;
    return devOut({ summary: `${ok}/${results.length} codespace(s) parado(s) — compute parado não consome os 60h/mês`, data: { results }, ...scopeWrap(rz(results)), telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_delete", reason: "Liberar os 15GB/mês de storage (se não precisar mais)" }] });
  },
});
const rz = (results) => ({ se: results.filter((x) => x.error).map((x) => x.error).join("; ") });

// ---- 5) DELETE (destrutivo: confirm exigido) ----
reg("n_codespace_delete", {
  description: "APAGA codespace (estado+arquivos não commitados somem — commit antes!). exige confirm com a frase \"apagar\" (proteção do dono). Libera os 15GB/mês de storage (código se salva: push do repo antes).",
  inputSchema: { type: "object", properties: { name: { type: "string" }, confirm: { type: "string", description: "exatamente: apagar" }, account: { type: "string" } }, required: ["name", "confirm"] },
  run: async ({ name, confirm, account } = {}) => {
    const t0 = Date.now();
    if (!name) return devOut({ status: "error", summary: "name obrigatório (n_codespace_list)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (String(confirm || "").trim() !== "apagar") return devOut({ status: "error", summary: `destrutivo bloqueado — passe confirm:"apagar" (estado não commitado VAI SER PERDIDO; faça push primeiro)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await runGh(["gh", "codespace", "delete", "-c", String(name), "--force", "--yes"], { account, timeoutMs: 60000 });
    return r.killed || r.code !== 0
      ? devOut({ status: "error", summary: `${ghError(r)} — codespace não apagado`, data: { name }, ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } })
      : devOut({ summary: `codespace ${name} apagado — storage liberado`, data: { name }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// ---- 6) LOGIN: gera LINK de 1 clique na resposta (device flow com user_code na URL) ----
// to: 1) dispara gh auth login -w em job setsid (sobrevive entre chamadas) 2) extrai o user_code do log
// 3) monta https://github.com/login/device?user_code=CODE (302 confirmado — preenche o código sozinho)
export function csLoginCode(text) {
  const m = /one-time code:\s*([A-Z0-9]{4})-([A-Z0-9]{4})/.exec(String(text || ""));
  return m ? `${m[1]}-${m[2]}` : null;
}
const LOGIN_JOBS = new Map(); // loginId -> { user, log, prevActive, startedAt }
async function csJobPid(loginId, log) {
  // meta: "ghpid=N" gravado pelo wrapper; exec: N vivo E cmdline é gh auth login
  try {
    const { readFile, readlink } = await import("node:fs/promises");
    const meta = await readFile(`${log}.meta`, "utf8");
    const pid = Number(/ghpid=(\d+)/.exec(meta)?.[1]) || 0;
    if (!pid) return 0;
    const r = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    return r.includes("auth") && r.includes("login") ? pid : 0;
  } catch { return 0; }
}
async function jobRunning(loginId, log) {
  return (await csJobPid(loginId, log)) > 0;
}
reg("n_codespace_login", {
  description: "Gera Agora um LINK de 1 clique p/ logar/adicionar conta gh (scopes incl. codespace): job background emite o device code e a tool devolve github.com/login/device?user_code=CODE — o dono SÓ CLICA (e entra com a conta desejada no browser); a conta entra no catálogo do gh sozinha (multi-conta via account:\"user\"). Confira depois com n_codespace_login_status (loginId vem Aqui). Uso: quando n_codespace_list mostrar conta inválida/sem scope, OU para acumular outro usuário.",
  inputSchema: { type: "object", properties: { user: { type: "string", description: "conta que o dono VAI logar (ex:\"Financia-Brasil\") — opcional, só p/ o status conferir a conta certa" }, scopes: { type: "string", default: "repo,workflow,codespace,read:org,gist", description: "scopes pedidos no login" } }, required: [] },
  run: async ({ user, scopes } = {}) => {
    const t0 = Date.now();
    const auth = await listAccounts();
    const scope = String(scopes || LOGIN_SCOPES()).replace(/[^a-z:,_-]/gi, "");
    const loginId = `cs${Date.now().toString(36)}`;
    const log = `/tmp/canivete-gh-login-${loginId}.log`;
    const prevActive = auth.active; // login -w troca a ativa p/ a conta nova; restauramos no status
    // wrapper setsid: pipeline em background + meta com o PID do gh (backing: órfão sobrevive UIColor restart)
    await exec("setsid", ["bash", "-c", `( printf "\\n" | GH_CONFIG_DIR=\${CANIVETE_GH_CONFIG_DIR:-/etc/canivete/gh} gh auth login -h github.com -p https -s ${scope} -w ) > ${log} 2>&1 & echo "ghpid=$!" > ${log}.meta`], { timeout: 20000 }).catch(() => {});
    // espera o device code aparecer no log (até ~8s)
    let code = null;
    const { readFile } = await import("node:fs/promises");
    for (let i = 0; i < 16 && !code; i++) {
      try { code = csLoginCode(await readFile(log, "utf8")); } catch {}
      if (!code) await new Promise((r2) => setTimeout(r2, 500));
    }
    if (!code) {
      let tail = "";
      try { tail = (await readFile(log, "utf8")).slice(-200); } catch {}
      return devOut({ status: "error", summary: `device code não apareceu no log — job ${loginId} pode não ter iniciado (tail: ${tail.replace(/\n/g, " | ")})`, data: { loginId, log }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    LOGIN_JOBS.set(loginId, { user: user || null, log, prevActive, startedAt: Date.now() });
    const link = `https://github.com/login/device?user_code=${code}`;
    return devOut({
      status: "warn",
      summary: `1 CLIQUE p/ logar${user ? ` ${user}` : " (com a conta certa no browser)"}: ${link} — (job ${loginId} guardado; ${accSummary(auth)})`,
      data: { loginId, link, code, log, user: user || null, scopes: scope, prevActive },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_codespace_login_status", reason: "Confirmar a conta autorizada" }],
    });
  },
});

// ---- 7) LOGIN STATUS: autorizou? acumulou? ----
reg("n_codespace_login_status", {
  description: "Confere o job do n_codespace_login: a conta esperada virou válida? Também limpa job concluído (e restaura a conta ativa anterior quando o login trocou). Se der \"code expirado\", rode n_codespace_login de novo. cancel=true mata o job pendente sem logar.",
  inputSchema: { type: "object", properties: { loginId: { type: "string", description: "id devolvido por n_codespace_login" }, cancel: { type: "boolean" } }, required: [] },
  run: async ({ loginId, cancel } = {}) => {
    const t0 = Date.now();
    const auth = await listAccounts();
    if (cancel && loginId) {
      const j = LOGIN_JOBS.get(loginId);
      if (j) {
        const pid = await csJobPid(loginId, j.log);
        if (pid) await exec("kill", [String(pid)], { timeout: 8000 }).catch(() => {});
        await exec("pkill", ["-f", `canivete-gh-login-${loginId}`], { timeout: 8000 }).catch(() => {});
        await exec("rm", ["-f", j.log, `${j.log}.meta`], { timeout: 8000 }).catch(() => {});
        LOGIN_JOBS.delete(loginId);
      }
      return devOut({ summary: `job ${loginId} cancelado — ${accSummary(auth)}`, data: { accounts: auth.accounts }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (!loginId || !LOGIN_JOBS.has(loginId)) {
      const pend = [...LOGIN_JOBS.keys()];
      return devOut({ status: pend.length ? "warn" : "error", summary: pend.length ? `loginId desconhecido — jobs pendentes: ${pend.join(", ")}` : "nenhum job de login ativo — rode n_codespace_login p/ gerar link", data: { accounts: auth.accounts }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const j = LOGIN_JOBS.get(loginId);
    const me = j.user ? auth.accounts.find((a) => a.user === j.user) : null;
    if (me && me.valid) {
      // login -w trocou a ativa p/ a conta nova: restaura a corrente de trabalho anterior (ex.: AsafeTork)
      if (j.prevActive && auth.active !== j.prevActive)
        await exec("gh", ["auth", "switch", "-u", j.prevActive], { timeout: 15000 }).catch(() => {});
      const auth2 = await listAccounts();
      LOGIN_JOBS.delete(loginId);
      await exec("rm", ["-f", j.log], { timeout: 8000 });
      return devOut({ summary: `conta ${j.user} AUTORIZADA e acumulada no gh ✔ (ativa restaurada p/ ${auth2.active})`, data: { accounts: auth2.accounts, loginId, user: j.user }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_list", reason: "Codespaces da nova conta" }] });
    }
    const running = await jobRunning(loginId, j.log).catch(() => false);
    if (!running) {
      let tail = "";
      try { tail = ((await (await import("node:fs/promises")).readFile(j.log, "utf8")) || "").slice(-300).replace(/\n/g, " | "); } catch {}
      const mismatch = /credentials for (\S+), received credentials for (\S+)/.exec(tail);
      LOGIN_JOBS.delete(loginId);
      return devOut({ status: "error", summary: `job ${loginId} encerrou SEM logar${mismatch ? ` — espera "${mismatch[1]}", browser estava "${mismatch[2]}" (refaça na janela/com a conta certa)` : " — prob. code expirado/refusado; rode n_codespace_login de novo"}`, data: { tail: tail.slice(-200), accounts: auth.accounts }, telemetry: { execution_time_ms: Date.now() - t0 }, next: mismatch ? [] : [{ tool: "n_codespace_login", reason: "Gerar link novo" }] });
    }
    const mins = Math.round((Date.now() - j.startedAt) / 60000);
    return devOut({ status: "warn", summary: `aguardando o CLIQUE (${mins}min) — ${accSummary(auth)}${j.user ? ` | esperando: ${j.user}` : ""} — code/device flow expira em ~15min; cancel:true aborta`, data: { loginId, accounts: auth.accounts, user: j.user }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});
