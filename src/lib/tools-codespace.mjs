// canivete — tools de CODESPACE (gh CLI logado do dono): ambiente de testes universal grátis.
// 120 core-h/mês grátis (2-core = 60h) + 15 GB storage; sem cartão. Sem repo = template blank oficial.
// Multi-conta: account="user" usa o token DESSE usuário (gh auth token -u) sem trocar a conta ativa global.
// Login de contas novas: n_codespace_login dispara o device flow E tenta INSERIR o código automaticamente
// via ubrowser (aba de fundo no Chrome logado: link com ?user_code= já pré-preenchido + clicar Continue/Authorize).
import { reg, devOut, fallbackHint, exec, trimOut } from "./ctx.mjs";
import { ubSend, ubConnected, ubListExtensions } from "./ubridge.mjs";
// infra gh (conta/token/runGh/parse) vive em gh.mjs — single source of truth compartilhada c/ n_github (apis.mjs):
import { csScopeIssue, accLine, listAccounts, runGh, ghError } from "./gh.mjs";
// exports públicos aqui NÃO mudam: re-export dos nomes que passaram a morar em gh.mjs p/ compat.
export { parseAuth as csParseAuth, csScopeIssue, accLine, listAccounts } from "./gh.mjs";

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const BLANK_REPO = "github/codespaces-blank"; // codespace SEM vínculo com projeto (template oficial)
const DEFAULT_MACHINE = "basicLinux32gb"; // 2-core/8GB — melhor cota grátis (120 core-h = 60h reais)
const SCOPE_HINT = "gh auth refresh -h github.com -s codespace"; // scope 'codespace' faltando no token
// Guard de resposta do host (#50): sync nunca volta acima de ~170s.
const EXEC_TMO = Math.min(Math.max(Number(process.env.CANIVETE_CS_EXEC_TMO) || 120000, 5000), 165000);
// timeout POR CHAMADA (n_codespace_exec timeoutSec, opcional): clampado DENTRO do guard do host (5s..165s hard cap).
export const execTmo = (sec) => Math.min(Math.max((Number(sec) || 0) * 1000 || EXEC_TMO, 5000), 165000);

// states reais da API (gh codespace list): Available | Starting | ShuttingDown | Shutdown | Archived | ... — rótulo pt-BR no summary.
const STATE_PT = { Available: "ativa", Starting: "iniciando", ShuttingDown: "parando", Shutdown: "parada", Archived: "arquivada", Deleted: "apagada", Removing: "removendo", Unavailable: "indisponível" };
export function csStateLabel(state) { const k = String(state || "").trim(); return STATE_PT[k] || k || "?"; }
const RUNNING_STATES = new Set(["Available", "Starting"]); // "Active" NÃO existe na API — parado/arquivado nunca entra no stop all:true

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
    gitStatus: c.gitStatus || null,
  })).filter((c) => c.name);
}


// SKUs válidos p/ validar machine ANTES de tocar a cota (2-core = 60h/mês free; maiores comem 2x/4x).
const MACHINE_KNOWN = {
  basicLinux32gb: "2-core/8GB — 60h/mês",
  standardLinux32gb: "4-core/16GB — 30h/mês",
  premiumLinux32gb: "4-core/8GB — 30h/mês",
  largeLinux32gb: "8-core/32GB — 15h/mês",
};
export function csNormRepo(input) {
  return String(input || "").trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/i, "");
}
export const csIdleMin = (m) => Math.min(Math.max(Number(m) || 30, 5), 240); // 5min..4h — mata ócio (economiza cota)
export function csCreateArgs({ repo, branch, machine, idleMin, devcontainerPath }) {
  const args = ["gh", "codespace", "create", "--repo", repo || BLANK_REPO, "--machine", machine || DEFAULT_MACHINE, "--default-permissions"];
  if (branch) args.push("--branch", branch);
  if (devcontainerPath) args.push("--devcontainer-path", devcontainerPath);
  args.push("--idle-timeout", `${csIdleMin(idleMin)}m`);
  return args;
}

function scopeWrap(r) {
  return csScopeIssue(r.se || r.so)
    ? { ...fallbackHint("login sem codespace: rode n_codespace_login (gera o LINK de 1 clique na resposta e guarda o job; confira com n_codespace_login_status)") }
    : {};
}
// runGh/listAccounts podem throw (conta errada, gh fora): guard converte em resposta de ERRO do protocolo
// (devOut pt-BR c/ contas em data) — nunca mais "tool error:" cru na raia.
const guard = (fn) => async (p = {}) => {
  const t0 = Date.now();
  try { return await fn(p); } catch (e) {
    return devOut({ status: "error", summary: `falhou: ${String((e && e.message) || e).slice(0, 300)}`, data: e && e.accounts ? { accounts: e.accounts } : {}, telemetry: { execution_time_ms: Date.now() - t0 } });
  }
};
// token ruim (401/scope) tem UM cura: logar de novo — next espalhado nos ramos de erro das tools.
const errNext = (r) => /HTTP 401|Bad credentials/i.test(`${r.se || ""}${r.so || ""}`) || csScopeIssue(r.se || r.so)
  ? [{ tool: "n_codespace_login", reason: "Token inválido/expirado ou sem scope — link de 1 clique" }]
  : undefined;

// ---- login de contas novas: link de 1 clique gerado NA RESPOSTA da tool ----
// job setsid sobrevive entre chamadas (filho do serviço, grupo próprio); log em /tmp com o loginId no nome.
const LOGIN_SCOPES = () => (process.env.CANIVETE_CS_SCOPES || "repo,workflow,codespace,read:org,gist");
function accSummary(auth) {
  return `${auth.accounts.filter((a) => a.valid).length} conta(s) válida(s), ativa: ${auth.active || "?"}`;
}


// ---- 1) LIST: contas + codespaces (passo 1 sempre) ----
reg("n_codespace_list", {
  description: "Lista contas gh logadas + codespaces do ambiente de testes universal (2-core/8GB grátis 60h/mês via cota GitHub). SEMPRE o passo 1: pega o name p/ exec/stop/delete, mostra a conta ATIVA e o ESTADO de cada cs (parada ≠ gasta cota). account é case-insensitive. Erro de scope → rode gh auth refresh -h github.com -s codespace (one-time code no browser).",
  inputSchema: { type: "object", properties: { account: { type: "string", description: "listar codespaces DESTA conta gh (case-insensitive; default: conta ativa)" } }, required: [] },
  run: guard(async ({ account } = {}) => {
    const t0 = Date.now();
    const acct = account ? String(account).trim() : "";
    const auth = await listAccounts();
    let r = await runGh(["gh", "codespace", "list", "--json", "name,displayName,state,repository,machineName,gitStatus"], { account: acct || undefined, timeoutMs: 60000 });
    // gh antigo ("Unknown JSON field"): refaz sem gitStatus em vez de matar o list inteiro (portabilidade).
    if (!r.killed && r.code !== 0 && /unknown json field/i.test(`${r.se || ""}${r.so || ""}`))
      r = await runGh(["gh", "codespace", "list", "--json", "name,displayName,state,repository,machineName"], { account: acct || undefined, timeoutMs: 60000 });
    if (r.killed || r.code !== 0)
      return devOut({ status: "error", summary: `list falhou: ${ghError(r)} — contas: ${auth.accounts.map(accLine).join(", ") || "(nenhuma)"}`, data: { accounts: auth.accounts }, next: errNext(r), ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } });
    const cs = csParseList(r.so);
    const counts = {};
    for (const c of cs) { const k = csStateLabel(c.state); counts[k] = (counts[k] || 0) + 1; }
    const stateTxt = cs.length ? Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(", ") : "nenhum";
    const note = acct && acct.toLowerCase() !== (auth.active || "").toLowerCase() ? ` (conta "${acct}")` : "";
    const bad = auth.accounts.filter((a) => !a.valid);
    const badNote = bad.length ? ` | sem token: ${bad.map((b) => b.user).join(", ")}` : "";
    return devOut({
      summary: `${cs.length} codespace(s) — ${stateTxt}${note} | ativa: ${auth.active || "?"} | contas: ${auth.accounts.map((a) => a.user).join(", ")}${badNote} — cota: parado não consome os 60h/mês`,
      data: { activeAccount: auth.active, accounts: auth.accounts, codespaces: cs, defaultRepo_sem_projetos: BLANK_REPO, default_machine: DEFAULT_MACHINE },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: bad.length
        ? [{ tool: "n_codespace_login", reason: `Acumular/religar ${bad.length} conta(s) sem token válido (${bad.map((b) => b.user).join(", ")}) — link de 1 clique` }]
        : cs.length ? [{ tool: "n_codespace_exec", reason: "Rodar comando no codespace" }] : [{ tool: "n_codespace_create", reason: "Criar ambiente (sem repo = blank)" }],
    });
  }),
});

// ---- 2) CREATE: dispara server-side, não trava sync (postCreate de devcontainer pode levar minutos) ----
// Valida repo/machine/conta ANTES de tocar a cota; gh que falha RÁPIDO (code!=0, sem kill) é erro REAL (não "disparada").
reg("n_codespace_create", {
  description: "Cria codespace do ambiente de testes (default basicLinux32gb 2-core/8GB; idle-timeout mata ócio e economiza cota). repo omitido = github/codespaces-blank (VAZIO, sem vínculo — teste universal); aceita owner/repo ou URL do github. Falha ANTES de gastar cota se repo/machine/account forem inválidos. Volta rápido: a criação continua no servidor — confirme com n_codespace_list em ~2-3min (postCreate com install pode demorar).",
  inputSchema: { type: "object", properties: { repo: { type: "string", description: "owner/repo ou URL github (omitir = blank sem projeto)" }, branch: { type: "string" }, machine: { type: "string", default: DEFAULT_MACHINE, description: "basicLinux32gb (default, 2-core/60h-mês) | standardLinux32gb | premiumLinux32gb | largeLinux32gb — maiores comem a cota mais rápido" }, idleMin: { type: "number", default: 30, description: "min de ócio antes do auto-stop (5-240; default 30)" }, devcontainerPath: { type: "string" }, account: { type: "string", description: "conta gh que paga a cota (default: ativa; case-insensitive)" } }, required: [] },
  run: guard(async (a = {}) => {
    const t0 = Date.now();
    const repo = csNormRepo(a.repo);
    const machine = String(a.machine || DEFAULT_MACHINE).trim();
    const idle = csIdleMin(a.idleMin);
    if (repo && !/^[\w.\-]+\/[\w.\-]+$/.test(repo))
      return devOut({ status: "error", summary: `repo inválido: "${a.repo}" — use owner/repo (ex: AsafeTork/canivete) ou omita p/ blank ${BLANK_REPO}`, data: { repo: a.repo }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // machine fora do catálogo local: passa adiante (gh valida server-side; falha rápida não gasta cota) — só avisa no data.
    const machineWarn = machine && !MACHINE_KNOWN[machine]
      ? `machine "${machine}" fora do catálogo local (${Object.keys(MACHINE_KNOWN).join(", ")}) — gh valida no server-side`
      : undefined;
    const args = csCreateArgs({ ...a, repo, machine });
    // 25s chega p/ API aceitar a criação (server-side continua); mata o gh (que só ESPERA) => nunca trava sync
    const r = await runGh(args, { account: a.account, timeoutMs: 25000 });
    if (r.killed || r.code === 0)
      return devOut({ summary: `criação ${r.code === 0 ? "aceita" : "disparada"}: ${repo}${a.branch ? ` @${a.branch}` : ""} — machine ${machine} (${MACHINE_KNOWN[machine] || "custo de cota a conferir"}), idle ${idle}m, conta ${a.account || "(ativa)"} — confirme com n_codespace_list em ~2-3 min`, data: { repo, machine, idleMin: idle, ...(machineWarn ? { machineWarn } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_list", reason: "Pegar o name do codespace criado" }] });
    const quota = /HTTP 402|out of monthly|payment required/i.test(`${r.se || ""}${r.so || ""}`);
    return devOut({ status: "error", summary: `criação falhou: ${ghError(r)}${quota ? " — acumule outra conta (n_codespace_login gera link de 1 clique) e depois account:\"<user>\"" : ""}`, data: { repo, machine }, next: errNext(r), ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } });
  }),
});

// ---- 3) EXEC: comando no codespace (o teste em si) ----
reg("n_codespace_exec", {
  description: "Roda comando bash DENTRO do codespace (build, npm test, smoke, git): gh codespace ssh. name EXATO do n_codespace_list (trecho do displayName aceita? NÃO — precisa name exato). Teto sync 165s (host corta resposta) — timeoutSec (5-165, default 120) p/ comandos curtos; tarefa longa: rode com nohup dentro (ex: bash -lc \"nohup npm test > out.log 2>&1 &\") e depois leia out.log em outra exec. stdout/stderr até 12k/3k (nota no summary se cortado).",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "name exato do codespace (n_codespace_list)" }, cmd: { type: "string", description: "comando bash; ex: \"npm run check && node test/smoke.mjs | tail -3\"" }, timeoutSec: { type: "number", description: "timeout DESTA exec em segundos (5-165; default 120 — clampado dentro do guard de resposta do host)" }, account: { type: "string", description: "conta gh dona do codespace (default: ativa; case-insensitive)" } }, required: ["name", "cmd"] },
  run: guard(async ({ name, cmd, account, timeoutSec } = {}) => {
    const t0 = Date.now();
    if (!name || !cmd) return devOut({ status: "error", summary: "name e cmd são obrigatórios (name vem do n_codespace_list)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tmo = execTmo(timeoutSec);
    const r = await runGh(["gh", "codespace", "ssh", "-c", String(name), "--", "bash", "-lc", String(cmd)], { account, timeoutMs: tmo });
    const so = (r.so || "").trim(), se = (r.se || "").trim();
    const secs = Math.round((Date.now() - t0) / 1000);
    const cut = { stdout: so.length > 12000, stderr: se.length > 3000 };
    const cutNote = `${cut.stdout ? ` | stdout cortado p/ 12k (${so.length} chars em data.stdout)` : ""}${cut.stderr ? ` | stderr cortado p/ 3k (${se.length} chars em data.stderr)` : ""}`;
    const outData = { exit: r.killed ? "timeout" : r.code, timeoutMs: tmo, stdout: trimOut(so, 12000), stderr: trimOut(se, 3000), truncated: cut };
    if (r.killed)
      return devOut({
        status: so ? "warn" : "error",
        summary: `timeout ${Math.round(tmo / 1000)}s sem fechar (${secs}s, conta ${account || "ativa"}${so ? `, stdout parcial: ${so.length} chars em data.stdout` : ", sem saída"})${cutNote} — tarefa longa: nohup + leia o log em exec nova; feche com n_codespace_stop`,
        data: outData,
        telemetry: { execution_time_ms: Date.now() - t0 },
        next: so ? [{ tool: "n_codespace_exec", reason: "Ler o resto do log (tail -200 out.log ou o log do seu nohup)" }, { tool: "n_codespace_stop", reason: "Fechar o cs acordado (economiza os 60h/mês)" }] : [{ tool: "n_codespace_stop", reason: "Fechar o cs acordado (economiza os 60h/mês)" }],
        ...fallbackHint('tarefa longa: rode subprocesso com nohup dentro do codespace (bash -lc "nohup <cmd> > out.log 2>&1 &") e leia out.log numa exec nova (sync max 165s)'),
      });
    if (r.code !== 0) {
      const errLine = se.split(/\r?\n/)[0].trim();
      const loginCure = csScopeIssue(`${se} ${so}`) || /HTTP 401|Bad credentials/i.test(se);
      const notFound = /HTTP 404|failed to get codespace|error fetching codespace/i.test(se);
      return devOut({
        status: "error",
        summary: `exit=${r.code} (${secs}s, conta ${account || "ativa"}) — ${errLine ? errLine.slice(0, 220) : ghError(r)} (stderr completo em data.stderr)${cutNote}`,
        data: outData,
        telemetry: { execution_time_ms: Date.now() - t0 },
        next: loginCure
          ? [{ tool: "n_codespace_login", reason: "Token inválido/expirado ou sem scope codespace — link de 1 clique" }]
          : notFound
          ? [{ tool: "n_codespace_list", reason: "404: name errado ou conta errada — conferir names/estados" }]
          : [{ tool: "n_codespace_stop", reason: "Fechar o cs acordado (economiza os 60h/mês)" }],
      });
    }
    return devOut({
      summary: `exit=0 — ok (${secs}s, conta ${account || "ativa"})${cutNote}`,
      data: outData,
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_codespace_stop", reason: "Economizar cota: 60h/mês no free" }],
    });
  }),
});

// ---- 4) STOP ----
reg("n_codespace_stop", {
  description: "Para codespace (congela; storage continua a contar, compute parado de grátis). Economiza os 60h/mês grátis. Passe name do n_codespace_list. all=true para TODOS os codespaces RODANDO da conta (states reais: Available/Starting). cs já parado conta como ok (\"já estava parado\").",
  inputSchema: { type: "object", properties: { name: { type: "string" }, all: { type: "boolean", description: "para todos os codespaces RODANDO da conta" }, account: { type: "string", description: "case-insensitive" } }, required: [] },
  run: guard(async ({ name, all, account } = {}) => {
    const t0 = Date.now();
    if (!name && !all) return devOut({ status: "error", summary: "passe name (do n_codespace_list) ou all:true", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    let names;
    if (all) {
      const lst = await runGh(["gh", "codespace", "list", "--json", "name,state"], { account, timeoutMs: 60000 });
      names = csParseList(lst.so).filter((c) => RUNNING_STATES.has(c.state)).map((c) => c.name);
      if (!names.length) return devOut({ summary: "nada rodando nesta conta — cota preservada", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    } else names = [String(name)];
    const results = [];
    for (const n of names) {
      const r = await runGh(["gh", "codespace", "stop", "-c", n], { account, timeoutMs: 30000 }); // 30s/item: all:true com vários cs não estoura o guard de sync do host
      const already = !r.killed && /is not running/i.test(`${r.so || ""}${r.se || ""}`);
      const ok = already || (r.code === 0 && !r.killed);
      results.push({ name: n, ok, note: already ? "já estava parado" : undefined, error: ok ? undefined : ghError(r) });
    }
    const nOk = results.filter((x) => x.ok).length;
    const fail = results.filter((x) => !x.ok);
    const failTxt = fail.slice(0, 3).map((f) => `${f.name}: ${String(f.error).slice(0, 130)}`).join(" | ");
    return devOut({
      status: !fail.length ? "success" : nOk ? "warn" : "error",
      summary: `${nOk}/${results.length} codespace(s) parado(s)${failTxt ? ` — falha: ${failTxt}` : ""} — compute parado não consome os 60h/mês`,
      data: { results },
      ...scopeWrap(rz(results)),
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: errNext(rz(results)) || (nOk === results.length
        ? [{ tool: "n_codespace_delete", reason: "Liberar os 15GB/mês de storage (se não precisar mais)" }]
        : [{ tool: "n_codespace_list", reason: "Conferir name/conta do que falhou (pode já estar parado ou conta errada)" }]),
    });
  }),
});
const rz = (results) => ({ se: results.filter((x) => x.error).map((x) => x.error).join("; ") });

// ---- 5) DELETE (destrutivo: confirm exigido) ----
reg("n_codespace_delete", {
  description: "APAGA codespace (estado+arquivos não commitados somem — commit antes!). exige confirm com a frase \"apagar\" (proteção do dono). Libera os 15GB/mês de storage (código se salva: push do repo antes). name errado → devolve os names que EXISTEM na conta c/ sugestão de n_codespace_list.",
  inputSchema: { type: "object", properties: { name: { type: "string" }, confirm: { type: "string", description: "exatamente: apagar" }, account: { type: "string", description: "case-insensitive" } }, required: ["name", "confirm"] },
  run: guard(async ({ name, confirm, account } = {}) => {
    const t0 = Date.now();
    if (!name) return devOut({ status: "error", summary: "name obrigatório (n_codespace_list)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (String(confirm || "").trim() !== "apagar") return devOut({ status: "error", summary: `destrutivo bloqueado — passe confirm:"apagar" (estado não commitado VAI SER PERDIDO; faça push primeiro)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const nm = String(name).trim();
    const r = await runGh(["gh", "codespace", "delete", "-c", nm, "--force"], { account, timeoutMs: 60000 });
    if (!(r.killed || r.code !== 0))
      return devOut({ summary: `codespace ${nm} apagado — storage liberado`, data: { name: nm }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (/HTTP 404|failed to get codespace|error fetching codespace/i.test(`${r.se || ""}${r.so || ""}`)) {
      let existing = [];
      try {
        const lst = await runGh(["gh", "codespace", "list", "--json", "name,state"], { account, timeoutMs: 45000 });
        existing = csParseList(lst.so).slice(0, 5).map((c) => c.name);
      } catch {}
      return devOut({ status: "error", summary: `404: "${nm}" não existe nesta conta${account ? ` ("${account}")` : ""} — pode já ter sido apagado; existentes: ${existing.join(", ") || "(nenhum)"} — pegue o name/certa conta em n_codespace_list`, data: { name: nm, existing }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_list", reason: "Names/contas antes de apagar" }] });
    }
    return devOut({ status: "error", summary: `delete falhou: ${ghError(r)} — codespace não apagado`, data: { name: nm }, next: errNext(r), ...scopeWrap(r), telemetry: { execution_time_ms: Date.now() - t0 } });
  }),
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
  description: "Gera Agora um LINK de 1 clique p/ logar/adicionar conta gh (scopes incl. codespace): job background emite o device code e a tool devolve github.com/login/device?user_code=CODE — o dono SÓ CLICA (e entra com a conta desejada no browser); a conta entra no catálogo do gh sozinha (multi-conta via account:\"user\"). Confira depois com n_codespace_login_status (loginId vem Aqui). Conta informada que JÁ é válida → resposta curta sem gerar job (renovar: manual:true). Só gerar link de novo se uma chamada estiver pendente (mesma conta) → devolve o loginId do job vivo. Uso: quando n_codespace_list mostrar conta inválida/sem scope, OU para acumular outro usuário.",
  inputSchema: { type: "object", properties: { user: { type: "string", description: "conta que o dono VAI logar (ex:\"Financia-Brasil\") — opcional, só p/ o status conferir a conta certa" }, scopes: { type: "string", default: "repo,workflow,codespace,read:org,gist", description: "scopes pedidos no login" }, profile: { type: "string", description: "clientId de um perfil ubrowser conectado (n_ubrowser_status) p/ dirigir o auto-insert — default: heurística pelo nome do usuário" }, manual: { type: "boolean", description: "true = NÃO tenta auto-insert; só gera o código/link p/ o dono autorizar (use quando o GitHub bloquear o clique automático; também serve p/ RENOVAR token de conta já válida)" } }, required: [] },
  run: guard(async ({ user, scopes, profile, manual } = {}) => {
    const t0 = Date.now();
    const auth = await listAccounts();
    const want = user ? String(user).trim() : "";
    if (want) {
      const hit = auth.accounts.find((x) => x.user.toLowerCase() === want.toLowerCase());
      const pend = [...LOGIN_JOBS.entries()].find(([, j]) => j.user && j.user.toLowerCase() === want.toLowerCase());
      const alive = pend ? await jobRunning(pend[0], pend[1].log).catch(() => false) : false;
      if (alive)
        return devOut({ status: "warn", summary: `já existe job pendente p/ ${pend[1].user}: ${pend[0]} — NÃO dispare outro; confira com n_codespace_login_status loginId:"${pend[0]}" (cancel:true remove)`, data: { accounts: auth.accounts, loginId: pend[0], user: pend[1].user }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_login_status", reason: "Verificar autorização do job pendente" }] });
      if (hit && hit.valid && !manual)
        return devOut({ status: "success", summary: `conta ${hit.user} JÁ logada/válida no gh — use account:"${hit.user}" nas tools | RENOVAR token/scopes: manual:true`, data: { accounts: auth.accounts, user: hit.user, alreadyValid: true }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_codespace_list", reason: "Codespaces/cota desta conta" }] });
    }
    const scope = String(scopes || LOGIN_SCOPES()).replace(/[^a-z:,_-]/gi, "");
    const loginId = `cs${Date.now().toString(36)}`;
    const log = `/tmp/canivete-gh-login-${loginId}.log`;
    const prevActive = auth.active; // login -w troca a ativa p/ a conta nova; restauramos no status
    // wrapper setsid: pipeline em background + meta com o PID do gh (backing: órfão sobrevive UIColor restart)
    await exec("setsid", ["bash", "-c", `( printf "\\n" | GH_CONFIG_DIR=\${CANIVETE_GH_CONFIG_DIR:-/etc/canivete/gh} gh auth login -h github.com -p https -s ${scope} -w ) > ${log} 2>&1 & echo "ghpid=$!" > ${log}.meta`], { timeout: 20000 }).catch(() => {});
    // espera o device code aparecer no log (até ~10s — gh às vezes demora p/ flushar)
    let code = null;
    const { readFile } = await import("node:fs/promises");
    for (let i = 0; i < 20 && !code; i++) {
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
    // AUTO-INSERT: aba de fundo no Chrome logado do dono. Driver: /login/device → codeInputs? digita+authorize;
    // senão card da conta (button/a/input[type=submit] "Continue as X") → form do código; senão "Use a different account" + usuário (senha fica com o dono).
    const auto = { tried: false, steps: [], error: "" };
    const snapOf = async (tabId, tgt) => {
      const s = await ubSend("tab.snapshot", { tabId }, undefined, tgt).catch(() => null);
      return ((s && s.ok && s.data && s.data.elements) || (s && s.elements) || []);
    };
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const tryCodeForm = async (tabId, els, tgt) => {
      const codeInputs = els.filter((e) => e && e.tag === "input" && /user-code-\d/.test(String(e.selector || "")));
      if (codeInputs.length < 8) return { ok: 0, found: false };
      auto.steps.push("sessão-ok");
      const chars = String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      let filled = 0;
      for (const inp of codeInputs) {
        const m = String(inp.selector).match(/user-code-(\d)/) || [];
        const k = Number(m[1]);
        if (!Number.isFinite(k)) continue;
        const ch = k < 4 ? chars[k] : chars[k - 1];
        if (!ch) continue;
        const fr = await ubSend("tab.fill", { tabId, selector: inp.selector, text: ch }, undefined, tgt);
        if (fr && fr.ok) filled++; else auto.steps.push(`fill${k}:${(fr && fr.error) || "fail"}`);
      }
      auto.steps.push(`fill:${filled}/8`);
      await sleepMs(1200);
      const cc = await ubSend("tab.click", { tabId, selector: 'input[name="commit"]' }, undefined, tgt);
      auto.steps.push(`continue:${cc && cc.ok ? "ok" : (cc && cc.error) || "fail"}`);
      await sleepMs(4500);
      let c2 = await ubSend("tab.click", { tabId, text: "Authorize" }, undefined, tgt);
      if (!c2 || !c2.ok) c2 = await ubSend("tab.click", { tabId, selector: 'button[name="authorize"]' }, undefined, tgt);
      auto.steps.push(`authorize:${c2 && c2.ok ? "ok" : "skip"}`);
      return { ok: (cc && cc.ok ? 1 : 0) + (c2 && c2.ok ? 1 : 0), found: true };
    };
    try {
      if (ubConnected() && !manual) {
        auto.tried = true;
        const pickExt = () => {
          const exts = ubListExtensions().filter((e) => e.connected);
          if (!exts.length) return null;
          if (profile) {
            const p = String(profile).toLowerCase().replace(/[^a-z0-9]/g, "");
            const exact = exts.find((e) => e.id.toLowerCase() === String(profile).toLowerCase());
            if (exact) return exact.id;
            const fuzzy = exts.find((e) => {
              const hay = [e.id, ...((e.info && Array.isArray(e.info.tabUrls)) ? e.info.tabUrls : []), (e.info && e.info.ua) || ""].join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
              return p && hay.includes(p);
            });
            if (fuzzy) return fuzzy.id;
          }
          if (exts.length === 1) return exts[0].id;
          const key = String(user || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const hit = exts.find((e) => {
            const hay = [e.id, ...((e.info && Array.isArray(e.info.tabUrls)) ? e.info.tabUrls : []), (e.info && e.info.ua) || ""].join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
            return key && hay.includes(key.slice(0, 6));
          });
          if (hit) return hit.id;
          return exts.sort((a, b) => a.lastPollAgoMs - b.lastPollAgoMs)[0].id;
        };
        const target = pickExt();
        auto.steps.push(target ? `perfil:${target.slice(0, 8)}` : "perfil:auto");
        const nr = await ubSend("tab.new", { url: "https://github.com/login/device" }, undefined, target);
        const tabId = Number(nr?.data?.id ?? nr?.id ?? nr?.data?.tabId ?? 0) || 0;
        if (!tabId) throw new Error("tab.new não devolveu id");
        auto.steps.push(`tab:${tabId}`);
        await sleepMs(6000);
        let okSteps = 0;
        let els = await snapOf(tabId, target);
        const r1 = await tryCodeForm(tabId, els, target);
        okSteps += r1.ok;
        if (!r1.found) {
          const cands = els.filter((e) => e && ((e.tag === "button" || e.tag === "a") || (e.tag === "input" && e.type === "submit")) && (e.name || e.text));
          const card = user && cands.find((e) => !/useadifferent/.test(norm(e.name) + norm(e.text)) && (norm(e.name).includes(norm(user)) || norm(e.text).includes(norm(user))));
          if (card) {
            const cc = await ubSend("tab.click", { tabId, selector: card.selector || `text=${(card.text || card.name || "").trim().slice(0, 60)}` }, undefined, target);
            auto.steps.push(`card(${user}):${cc && cc.ok ? "ok" : "fail"}`);
            if (cc && cc.ok) {
              await sleepMs(5000);
              els = await snapOf(tabId, target);
              const r2 = await tryCodeForm(tabId, els, target);
              okSteps += r2.ok;
            }
          } else {
            auto.steps.push("card:não-achou");
            const diff = cands.find((e) => /useadifferent/.test(norm(e.name) + norm(e.text)));
            if (diff) {
              const dc = await ubSend("tab.click", { tabId, selector: diff.selector || "text=Use a different account" }, undefined, target);
              auto.steps.push(`different-account:${dc && dc.ok ? "ok" : "fail"}`);
              await sleepMs(5000);
              const fu = await ubSend("tab.fill", { tabId, selector: "input[name='login']", text: user || "" }, undefined, target);
              auto.steps.push(`usuário-preenchido:${fu && fu.ok ? "ok" : "fail"}`);
              auto.error = "form aberto com o usuário — digite só a senha e Sign in; depois rode n_codespace_login de novo (código novo, ~15 min de vida)";
            }
          }
        }
        if (okSteps >= 2) auto.steps.push("autorizado ✅");
        else if (okSteps === 0 && !auto.error) auto.error = "não consegui inserir sozinho — preencha pelo link manual (senha/captcha podem pedir você)";
      }
    } catch (e) {
      auto.error = String(e && e.message ? e.message : e);
    }
    const autoNote = auto.tried
      ? `auto: ${auto.steps.join(" → ")}${auto.error ? ` | erro: ${auto.error}` : ""}`
      : manual ? "modo manual (auto desligado)" : "auto indisponível (extensão offline)";
    return devOut({
      status: auto.tried && auto.error ? "warn" : auto.tried ? "success" : "warn",
      summary: code,
      data: { loginId, link, code, log, user: user || null, scopes: scope, prevActive, autoNote, auto: { tried: auto.tried, steps: auto.steps, error: auto.error || undefined } },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_codespace_login_status", reason: "Confirmar a conta autorizada" }],
    });
  }),
});

// ---- 7) LOGIN STATUS: autorizou? acumulou? ----
reg("n_codespace_login_status", {
  description: "Confere o job do n_codespace_login: a conta esperada virou válida? Também limpa job concluído (e restaura a conta ativa anterior quando o login trocou). Se der \"code expirado\", rode n_codespace_login de novo. cancel=true mata o job pendente sem logar.",
  inputSchema: { type: "object", properties: { loginId: { type: "string", description: "id devolvido por n_codespace_login" }, cancel: { type: "boolean" } }, required: [] },
  run: guard(async ({ loginId, cancel } = {}) => {
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
  }),
});
