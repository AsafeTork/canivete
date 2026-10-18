// canivete — infra gh (CLI autenticado do dono, multi-conta): single source of truth,
// extraído 1:1 de tools-codespace.mjs (git cf2715c) p/ ser compartilhado também pelo
// n_github (src/lib/apis.mjs) — conta gh logada = 5000 req/h na API do GitHub.
// Assinaturas e mensagens idênticas às da extração (compat garantida). NUNCA ecoa token
// (stdout de gh auth token só vive em memória). Zero deps novas: só `exec` do ctx.mjs.
import { exec } from "./ctx.mjs";

// Fallback de timeout p/ runGh sem timeoutMs (todos os call sites reais passam timeoutMs
// explícito; domínio exec/EXEC_TMO fica em tools-codespace.mjs — mesma fórmula/clamp aqui
// apenas p/ não importar de lá — evita ciclo).
const GH_TMO_DEF = Math.min(Math.max(Number(process.env.CANIVETE_CS_EXEC_TMO) || 120000, 5000), 165000);

// CANIVETE_GH_CONFIG_DIR: perfil gh compartilhado (multi-conta do serviço, ex /etc/canivete/gh)
export const GH_CFG = () => (process.env.CANIVETE_GH_CONFIG_DIR ? { GH_CONFIG_DIR: process.env.CANIVETE_GH_CONFIG_DIR } : {});

// ---- helpers puros (exportados p/ teste sem gh) ----
// parse de `gh auth status`: nome novo parseAuth; csParseAuth é alias p/ imports/agentes antigos.
export function parseAuth(text) {
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
export { parseAuth as csParseAuth };

// scope codespace faltando no token? (texto no stderr/stdout — testável sem gh)
export function csScopeIssue(text) {
  return /codespace["\s]*(scope|operation)|needs? the ["']?codespace|Requires? the ["']?codespace/i.test(String(text || ""));
}

// rótulo 1-linha de conta p/ mensagens de erro (nunca mostra token)
export const accLine = (a) => `${a.user}${a.active ? " [ativa]" : a.valid ? " (válida)" : " (token inválido)"}`;
export function accFail(want, accounts, kind) {
  const why = kind === "unknown" ? "não está logada no gh" : kind === "invalid" ? "token inválido/expirado" : "token não obtido";
  const e = new Error(`conta gh "${want}": ${why} — contas: ${accounts.map(accLine).join(", ") || "(nenhuma)"} | logar/religar: n_codespace_login (link de 1 clique)`);
  e.accounts = accounts;
  return e;
}

// token do usuário (gh auth token --user; só stdout; nunca ecoado em log/erro/resposta)
export async function ghTok(user) {
  const t = await exec("gh", ["auth", "token", "--user", user], { env: { ...GH_CFG() }, timeout: 15000 });
  const tok = (t.so || "").trim().split(/\r?\n/)[0];
  return t.code === 0 && tok.startsWith("gh") ? tok : null;
}

// resolve conta gh (case-insensitive, via lista do `gh auth status`) → { token, user } —
// user: fast-path devolve o input cru (igual ao do gh, que é case-sensitive); fallback resolve pelo CANÔNICO da lista.
// account vazio → null (caller usa auth própria); erro → THROW accFail com e.accounts listadas.
export async function ghTokenFor(account) {
  const want = account ? String(account).trim() : "";
  if (!want) return null;
  let tok = await ghTok(want); // fast path: nome exato
  if (tok) return { token: tok, user: want };
  const { accounts } = await listAccounts();
  const hit = accounts.find((a) => a.user.toLowerCase() === want.toLowerCase());
  if (!hit) throw accFail(want, accounts, "unknown");
  if (!hit.valid) throw accFail(want, accounts, "invalid");
  tok = await ghTok(hit.user); // resolve pelo nome canônico
  if (!tok) throw accFail(want, accounts, "notokens");
  return { token: tok, user: hit.user };
}

// ---- exec gh com conta opcional (não expõe token nunca) ----
export async function runGh(args, { account, timeoutMs, cwd } = {}) {
  const env = { ...GH_CFG() };
  const hit = await ghTokenFor(account);
  if (hit) env.GH_TOKEN = hit.token;
  return exec(args[0], args.slice(1), { timeout: timeoutMs || GH_TMO_DEF, cwd, env });
}

// motivo (pt-BR, 1 linha) do erro do gh — mapeia cota/rate/scope/404/machine/repo; nunca ecoa tokens.
export function ghReason(r) {
  const txt = `${(r.se || "").slice(0, 400)} ${(r.so || "").slice(0, 300)}`;
  if (r.killed) return "timeout";
  if (r.error === "sleep-denied") return "sleep PROIBIDO (regra do dono, global) — não espere, monitore";
  if (r.error) return `gh indisponível: ${r.error}`;
  if (/HTTP 401|Bad credentials/i.test(txt)) return "HTTP 401 — token inválido/expirado";
  if (/HTTP 402|out of monthly|payment required/i.test(txt)) return "HTTP 402 — cota free/budget desta conta esgotada";
  if (/HTTP 429|rate limit/i.test(txt)) return "HTTP 429 — rate limit do GitHub, espere ~1 min";
  if (/HTTP 403|not authorized|must have|has not been granted|forbidden/i.test(txt)) return "HTTP 403 — sem permissão/scope no token";
  if (/HTTP 404|not found|failed to get codespace|error fetching codespace/i.test(txt)) return "HTTP 404 — não achou (name errado, conta errada ou coisa apagada)";
  if (/invalid machine|machine type/i.test(txt)) return "machine inválida";
  if (/repository not found|cannot find repository/i.test(txt)) return "repo inacessível p/ esta conta";
  if (csScopeIssue(txt)) return "token sem scope codespace";
  return `exit ${r.code ?? "?"}`;
}
export const ghError = (r) => {
  const line = (r.se || "").split(/\r?\n/)[0].trim();
  const reason = ghReason(r);
  return /HTTP|scope|machine|repo inac/.test(reason) && line ? `${reason} | ${line.slice(0, 200)}` : line ? `${reason}: ${line.slice(0, 200)}` : reason;
};

export async function listAccounts() {
  const r = await runGh(["gh", "auth", "status"], { timeoutMs: 15000 });
  return parseAuth(r.so || r.se || "");
}
