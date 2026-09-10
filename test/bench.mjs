// canivete bench: tempo de TODAS as tools no deployment real (http 19423).
// Uso: CANIVETE_TOKEN=$(cat ~/.config/canivete/token.txt) node test/bench.mjs
// Gera docs/BENCH.md. Sem nada destrutivo; sandbox /tmp/bench.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const BASE = process.env.CANIVETE_URL || "http://127.0.0.1:19423/mcp";
const TOKEN = process.env.CANIVETE_TOKEN || "";
const H = { "content-type": "application/json", "X-Token": TOKEN };
const call = (id, name, args, ms = 120000) => {
  const t0 = Date.now();
  return fetch(BASE, { method: "POST", headers: H, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) })
    .then(async (r) => ({ ms: Date.now() - t0, j: await r.json() }))
    .catch((e) => ({ ms: Date.now() - t0, err: String(e.message || e).slice(0, 100) }));
};
const txt = (m) => (m?.result?.content || []).map((c) => c.text || `[${c.type}]`).join("\n");

mkdirSync("/tmp/bench", { recursive: true });
writeFileSync("/tmp/bench/a.txt", "linha um\nlinha dois\n");
writeFileSync("/tmp/bench/s.js", "function soma(a,b){return a+b}\nmodule.exports={soma}\n");

const CASES = [
  ["n_tools_info", {}], ["n_read", { filePath: "/tmp/bench/a.txt" }], ["n_list", { path: "/tmp/bench", depth: 1 }],
  ["n_write", { filePath: "/tmp/bench/b.txt", content: "x" }], ["n_edit", { filePath: "/tmp/bench/b.txt", oldString: "x", newString: "y" }],
  ["n_bash", { command: "echo ok" }], ["n_glob", { pattern: "*.txt", cwd: "/tmp/bench" }], ["n_grep", { pattern: "linha", path: "/tmp/bench" }],
  ["n_apply_patch", { patch: "invalido" }],
  ["n_webfetch", { url: "https://example.com", maxChars: 500 }], ["n_websearch", { query: "vite pwa", numResults: 3 }],
  ["n_currency", { from: "BRL", to: "USD", amount: 10 }], ["n_cep", { cep: "01001000" }], ["n_cnpj", { cnpj: "11444777000161" }],
  ["n_ipinfo", {}], ["n_weather", { latitude: -23.55, longitude: -46.63, days: 2 }], ["n_github", { owner: "vitejs", repo: "vite", kind: "repo" }], ["n_npm", { package: "vite" }],
  ["n_todowrite", { todos: [{ content: "b", priority: "low", status: "pending" }] }], ["n_todo", {}], ["n_list_models", {}],
  ["n_question", { question: "q?" }], ["n_skill", { name: "zz-inexistente" }], ["n_plan", {}],
  ["n_get_architecture_summary", { depth: 1 }], ["n_investigate_issue", { symptom: "bench soma" }],
  ["n_analyze_change_impact", { symbol_id: "soma" }], ["n_apply_semantic_patch", { file_path: "/tmp/bench/s.js", edits: [{ oldString: "a+b", new_code: "a + b" }] }],
  ["n_execute_targeted_tests", { scope: "diff_only" }],
  ["n_manage_background_process", { action: "start", command: "sleep 30" }],
  ["n_inspect_ui_state", {}], ["n_orchestrate_task", { action: "init", plan: { title: "bench" } }],
  ["n_browser_navigate", { url: "https://example.com", waitMs: 4000 }], ["n_browser_snapshot", {}],
  ["n_browser_act", { action: "evaluate", js: "document.title" }], ["n_browser_screenshot", { width: 800, height: 600 }],
  ["n_browser_pdf", { url: "https://example.com" }],
  ["n_ubrowser_status", {}], ["n_ubrowser_tabs", {}], ["n_ubrowser_read", {}], ["n_ubrowser_snapshot", {}],
  ["n_ubrowser_act", { action: "click", selector: "text=excluir conta" }], ["n_ubrowser_shot", {}],
  ["n_report", { kind: "zzz", where: "bench", expected: "x", got: "y" }],
  ["n_task", { description: "bench", prompt: "Responda BENCH-OK", model: "opencode/big-pickle", background: true, ephemeral: true, subagent_type: "quick" }],
];
const rows = [];
let id = 1, taskId = null;
for (const [name, args] of CASES) {
  const t = name === "n_task" ? 200000 : 120000;
  const { ms, j, err } = await call(id++, name, args, t).catch((e) => ({ ms: -1, err: String(e).slice(0, 80) }));
  let out = err || "";
  if (j) {
    const r = j.result;
    out = r?.isError ? "isError: " + txt({ result: r }).slice(0, 100) : txt({ result: r }).slice(0, 100);
    const m = txt({ result: r }).match(/task (\w+) spawned/);
    if (m) taskId = m[1];
  }
  rows.push({ tool: name, ms, out: out.replace(/\n/g, " ") });
  console.log(`${name}: ${ms}ms :: ${rows[rows.length - 1].out.slice(0, 80)}`);
}
if (taskId) {
  const t0 = Date.now();
  const w = await call(999, "n_task_wait", { task_ids: [taskId], wait: "all", timeout: 150000 }, 170000).catch((e) => ({ ms: -1 }));
  rows.push({ tool: "n_task_wait", ms: w.ms ?? -1, out: "task bench" });
  console.log(`n_task_wait: ${w.ms}ms`);
}
const slow = rows.filter((r) => r.ms > 1500);
const md = `# BENCH canivete — ${new Date().toISOString()}\n\nGerado por \`node test/bench.mjs\` no deployment real (http 19423).\nLimite razoável: 1500ms. Acima disso = rede/página/modelo (física) ou código (culpa do dev).\n\n| tool | ms | resultado |\n|---|---|---|\n` +
  rows.map((r) => `| ${r.tool} | ${r.ms} | ${r.out.slice(0, 90)} |`).join("\n") +
  `\n\n## Lentas (>1500ms): ${slow.length}\n` + slow.map((r) => `- ${r.tool}: ${r.ms}ms`.slice(0, 120)).join("\n") + "\n";
writeFileSync(new URL("../docs/BENCH.md", import.meta.url).pathname, md);
console.log(`\nBENCH-DONE ${rows.length} tools, ${slow.length} lentas. docs/BENCH.md escrito.`);
rmSync("/tmp/bench", { recursive: true, force: true });
process.exit(0);
