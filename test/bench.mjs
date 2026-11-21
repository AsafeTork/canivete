// Benchmark das tools ativas no daemon Canivete.
// Mede MCP + execução real, sem iniciar subagentes, alterar resources externos,
// acessar o Chrome logado ou enviar comandos ao Android.
// Uso: CANIVETE_TOKEN_FILE=~/.config/canivete/token.txt node test/bench.mjs
import { writeFileSync, rmSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.CANIVETE_URL || "http://127.0.0.1:19423/mcp";
const TOKEN = process.env.CANIVETE_TOKEN || (() => {
  try {
    const path = process.env.CANIVETE_TOKEN_FILE || `${process.env.HOME || "/root"}/.config/canivete/token.txt`;
    return readFileSync(path, "utf8").trim();
  } catch { return ""; }
})();

const BENCH_PREFIX = `.canivete-bench-${process.pid}`;
const SANDBOX = process.cwd();
const benchFile = (name) => join(SANDBOX, `${BENCH_PREFIX}-${name}`);
const PAGE = "https://example.com";
const headers = { "content-type": "application/json", "x-token": TOKEN };
const call = async (id, name, args, timeoutMs = 90000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(BASE, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { ms: Math.round(performance.now() - started), httpStatus: response.status, json };
  } catch (error) {
    return { ms: Math.round(performance.now() - started), error: String(error?.message || error).slice(0, 100) };
  } finally { clearTimeout(timer); }
};

function resultStats(json) {
  const result = json?.result;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((item) => item.type === "text").map((item) => item.text || "").join("\n");
  let status = result?.isError ? "error" : /^ERRO\s/m.test(text) ? "error" : "ok";
  const match = text.match(/\{"status":"(success|error|warn)"/);
  if (match) status = match[1];
  return { status, chars: text.length, bytes: Buffer.byteLength(text), items: content.length };
}

function collectTempArtifacts(value, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && ["file", "dir", "video"].includes(key) && item.startsWith("/tmp/")) out.add(item);
    else collectTempArtifacts(item, out);
  }
  return out;
}

const safeArgs = new Map([
  ["cv_file_read", { action: "read", path: "README.md", maxChars: 120 }],
  ["cv_file_write", { action: "write", path: benchFile("write.txt"), content: "benchmark canivete\n" }],
  ["cv_bash", { command: "node -e \"process.stdout.write('bench-ok')\"" }],
  ["cv_webfetch", { url: PAGE, maxChars: 700 }],
  ["cv_lookup", { source: "currency", from: "BRL", to: "USD", amount: 10 }],
  ["cv_code_inspect", { action: "architecture", depth: 1 }],
  ["cv_code_edit", { action: "diff", patch: "patch inválido do benchmark", check: true }],
  ["cv_code_verify", { action: "ui", url: PAGE, expect: "Example Domain", retries: 0 }],
  ["cv_manage_background_process", { action: "status" }],
  ["cv_orchestrate_task", { action: "__benchmark_invalid__" }],
  ["cv_browser_read", { detail: "summary", url: PAGE, waitMs: 1000 }],
  ["cv_browser_snapshot", {}],
  ["cv_browser_act", { action: "evaluate", js: "document.title" }],
  ["cv_browser_capture", { action: "screenshot", url: PAGE, width: 640, height: 480, scale: 0.5 }],
  ["cv_browser_screencast", { url: PAGE, width: 640, height: 480, scale: 0.5, actions: [{ wait: 10 }] }],
  ["cv_codespace_lifecycle", { action: "create", repo: "benchmark invalido" }],
  ["cv_codespace_exec", {}],
  ["cv_whatsapp", { action: "__benchmark_invalid__" }],
  ["cv_audio_analyze", { path: join(SANDBOX, "nao-existe.wav") }],
  ["cv_report", { kind: "aprimoramento", where: "benchmark", expected: "medir sem persistir", got: "dry-run", dryRun: true }],
  ["cv_help", { query: "browser", limit: 5 }],
  ["cv_ctx_status", {}],
  ["cv_elemreports_resolve", { id: "bench-nao-existe", proof: "benchmark: nenhum report foi alterado" }],
]);

// Ferramentas stateful, que expõem dados privados ou exigem recurso do dono:
// não são executadas; entram no relatório com motivo explícito.
const skipped = new Map([
  ["cv_todo", "lê conteúdo privado do usuário"],
  ["cv_todowrite", "altera a lista de tarefas em memória do daemon"],
  ["cv_skill", "refresh altera arquivos de configuração do usuário"],
  ["cv_elemreports_list", "lê reports privados persistidos pelo usuário"],
  ["cv_websearch", "consulta provedores externos e consome cota"],
  ["cv_codespace_status", "lê estado privado de autenticação e recursos GitHub"],
  ["cv_codespace_lifecycle", "pode criar/alterar recursos da conta GitHub"],
  ["cv_codespace_exec", "executa comandos em um recurso privado da conta"],
  ["cv_codespace_login", "inicia um fluxo OAuth externo"],
  ["cv_owner_inspect", "lê estado ou dados da sessão Chrome do dono"],
  ["cv_owner_act", "pode agir em uma sessão Chrome privada"],
  ["cv_owner_alerts", "drena alertas da sessão Chrome do dono"],
  ["cv_android_inspect", "pode ler/reconectar ao aparelho privado do dono"],
  ["cv_android_connect", "pode parear ou reconectar um aparelho do dono"],
  ["cv_android_act", "pode enviar toque/tecla ao aparelho conectado"],
]);

if (!TOKEN) throw new Error("token ausente; defina CANIVETE_TOKEN ou CANIVETE_TOKEN_FILE");

const ctl = new AbortController();
const healthTimer = setTimeout(() => ctl.abort(), 3000);
let list;
try {
  const response = await fetch(BASE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} }), signal: ctl.signal });
  const json = await response.json();
  if (!response.ok || !Array.isArray(json.result?.tools)) throw new Error(`tools/list HTTP ${response.status}`);
  list = json.result.tools;
} finally { clearTimeout(healthTimer); }

const rows = [];
const artifacts = new Set();
let id = 1;
for (const tool of list) {
  const name = tool.name;
  if (skipped.has(name)) {
    rows.push({ tool: name, ms: null, status: "SKIP", chars: 0, reason: skipped.get(name) });
    console.log(`${name}: SKIP — ${skipped.get(name)}`);
    continue;
  }
  if (!safeArgs.has(name)) {
    rows.push({ tool: name, ms: null, status: "SEM CASO", chars: 0, reason: "sem fixture segura" });
    console.log(`${name}: SEM CASO`);
    continue;
  }
  const timeout = name.startsWith("cv_browser_") ? 60000 : 90000;
  const measured = await call(id++, name, safeArgs.get(name), timeout);
  const stats = resultStats(measured.json);
  collectTempArtifacts(measured.json?.result, artifacts);
  const row = { tool: name, ms: measured.ms, status: measured.error ? "transport-error" : stats.status, chars: stats.chars, bytes: stats.bytes, items: stats.items, ...(measured.httpStatus ? { httpStatus: measured.httpStatus } : {}), ...(measured.error ? { reason: measured.error } : {}) };
  rows.push(row);
  console.log(`${name}: ${row.ms}ms ${row.status} ${row.bytes}B`);
}

// Limpa somente artefatos de benchmark ou arquivos temporários que as tools geraram.
for (const file of artifacts) {
  const base = file.split("/").pop() || "";
  if (/^(page\.pdf|screencast\.(webm|mp4)|frame-\d+\.(png|jpg|jpeg)|meta\.json|opencode-(shot|page|screencast|adb)-)/.test(base)) {
    try { rmSync(file, { recursive: true, force: true }); } catch {}
  }
}
// O daemon MCP pode estar em outro namespace de filesystem que o processo Node.
// Remove pelo próprio daemon apenas os nomes exclusivos que este benchmark criou.
await call(id++, "cv_bash", { command: `node -e 'try{require("node:fs").unlinkSync("${BENCH_PREFIX}-write.txt")}catch{}'` }, 5000);
for (const file of [benchFile("a.txt"), benchFile("s.js"), benchFile("write.txt"), benchFile("page.pdf")]) {
  try { unlinkSync(file); } catch {}
}

const measuredRows = rows.filter((row) => Number.isFinite(row.ms));
const sorted = [...measuredRows].sort((a, b) => b.ms - a.ms);
const ascending = [...measuredRows].sort((a, b) => a.ms - b.ms);
const report = {
  generatedAt: new Date().toISOString(),
  endpoint: BASE.replace(/:\/\/[^/]+/, "://<local>"),
  availableTools: list.length,
  measuredTools: measuredRows.length,
  skippedTools: rows.length - measuredRows.length,
  catalogBytes: Buffer.byteLength(JSON.stringify(list)),
  p50Ms: measuredRows.length ? ascending[Math.floor((measuredRows.length - 1) * 0.5)].ms : 0,
  p95Ms: measuredRows.length ? ascending[Math.ceil(measuredRows.length * 0.95) - 1].ms : 0,
  rows,
};
const md = `# Benchmark Canivete — ${report.generatedAt}\n\n` +
  `Medição do endpoint MCP ativo. Tools disponíveis: ${report.availableTools}; medidas: ${report.measuredTools}; ignoradas com motivo: ${report.skippedTools}. Catálogo: ${report.catalogBytes} bytes. Latência p50: ${report.p50Ms} ms; p95: ${report.p95Ms} ms.\n\n` +
  `O tempo inclui rede/serviços externos quando a tool os usa. Respostas são descartadas; o relatório guarda apenas estado, tamanho e tempo. Tools que poderiam alterar dados externos, consumir cota ou ler tela privada ficam de fora.\n\n` +
  `| Tool | ms | estado | resposta (bytes) | nota |\n|---|---:|---|---:|---|\n` +
  rows.map((row) => `| ${row.tool} | ${row.ms ?? "—"} | ${row.status} | ${row.bytes ?? 0} | ${row.reason || ""} |`).join("\n") +
  `\n\n## Mais lentas\n\n` + (sorted.slice(0, 10).map((row) => `- ${row.tool}: ${row.ms} ms (${row.bytes} bytes, ${row.status})`).join("\n") || "- Nenhuma medida") + "\n";
writeFileSync(new URL("../docs/BENCH.md", import.meta.url), md);
console.log(`\nBENCH-DONE ${report.measuredTools}/${report.availableTools} medidas; ${report.skippedTools} omitidas. p50=${report.p50Ms}ms p95=${report.p95Ms}ms. docs/BENCH.md atualizado.`);
