// canivete simulate: suite intensiva SIMULADA — tudo além de código, sem rede externa, sem spawn opencode.
// Padrão smoke.mjs: spawn stdio local + helpers call/t. RAM limitada: só stdio local + fs + risk local.
// Cobre: mailbox roundtrip/ttl/filter, risk matriz, doom-guard, paginação next exato,
// erros acionáveis, ubrowser offline, task_delete preview, find_tools. OFFLINE por construção.
import { spawn } from "node:child_process";

const srv = spawn("node", ["src/server.mjs"], { cwd: new URL("..", import.meta.url).pathname, stdio: ["pipe", "pipe", "pipe"] });
srv.stderr.on("data", () => {});
await new Promise((r) => setTimeout(r, 1500));
let buf = "";
srv.stdout.on("data", (d) => (buf += d));
const call = (id, name, args, ms = 25000) =>
  new Promise((res, rej) => {
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (const l of buf.split("\n")) {
        try { const m = JSON.parse(l); if (m.id === id) { clearInterval(iv); res({ m, ms: Date.now() - t0 }); return; } } catch {}
      }
      if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout " + name)); }
    }, 100);
  });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) + "\n");
let pass = 0, fail = 0;
const t = async (label, id, name, args, expect = /./, allowError = null) => {
  try {
    const { m, ms } = await call(id, name, args);
    const txt = m.result.content.map((c) => c.text || "").join("\n");
    const ok = allowError ? allowError.test(txt) : !m.result.isError && expect.test(txt);
    console.log(`${ok ? "PASS" : "FAIL"} ${label} (${ms}ms) :: ${txt.slice(0, 90).replace(/\n/g, " | ")}`);
    ok ? pass++ : fail++;
  } catch (e) { console.log(`FAIL ${label} :: ${e.message}`); fail++; }
};

// 1) catálogo
await t("tools_info conta 56", 1, "n_tools_info", {}, /56 tools/);

// 2-4) risk matriz via risk.mjs local (sem rede)
await t("risk Pix Total=low", 2, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({text:'Pix Total'})))\"" }, /low/);
await t("risk rm -rf=high", 3, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({cmd:'rm -rf /',action:'n_bash'})))\"" }, /\bhigh\b/);
await t("risk Entrar sem senha≠high (medium)", 4, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({text:'Entrar sem senha',action:'click'})))\"" }, /medium/);

// 5-6) risk via guard real do ubrowser (offline, sem rede)
await t("risk permite Pix Total via ubrowser (offline, sem BLOQUEIO)", 5, "n_ubrowser_act", { action: "click", text: "Pix Total" }, /./, /EXTENSÃO OFFLINE/);
await t("doom-guard risk bloqueia excluir conta", 6, "n_ubrowser_act", { action: "click", selector: "text=excluir conta" }, /./, /BLOQUEADO/);

// 7-11) mailbox roundtrip + ttl + filter (filesystem local, sem spawn, sem rede)
const simBase = `sim-${Date.now()}`;
const mainTag = `${simBase}-main`;
await t("mailbox send main", 20, "n_task_send", { task_id: "main", message: mainTag }, /delivered to main/);
await t("mailbox peek ve msg", 21, "n_task_peek", { task_id: "main", filter: mainTag }, new RegExp(mainTag));
await t("mailbox recv roundtrip", 22, "n_task_recv", { task_id: "main", filter: mainTag }, new RegExp(mainTag));
// ttl: msg expira e some do peek
const ttlTag = `${simBase}-ttl`;
await t("mailbox ttl send", 23, "n_task_send", { task_id: "main", message: ttlTag, ttl_ms: 400 }, /delivered to main/);
await new Promise((r) => setTimeout(r, 900));
await t("mailbox ttl expira (peek vazio)", 24, "n_task_peek", { task_id: "main", filter: ttlTag }, /no messages/);
// filter isola: A consumido, B permanece
const tagA = `${simBase}-A`;
const tagB = `${simBase}-B`;
await t("mailbox filter send A", 25, "n_task_send", { task_id: "main", message: tagA }, /delivered to main/);
await t("mailbox filter send B", 26, "n_task_send", { task_id: "main", message: tagB }, /delivered to main/);
await t("mailbox filter recv A", 27, "n_task_recv", { task_id: "main", filter: tagA }, new RegExp(tagA));
await t("mailbox filter peek B permanece", 28, "n_task_peek", { task_id: "main", filter: tagB }, new RegExp(tagB));
await t("mailbox filter recv B cleanup", 29, "n_task_recv", { task_id: "main", filter: tagB }, new RegExp(tagB));

// 12) doom-guard: 3 calls idênticas consecutivas → [REPETITION GUARD] (arquivo exclusivo, sem reuso anterior)
try {
  const doomArgs = { filePath: "config/models.json" };
  const r1 = await call(30, "n_read", doomArgs);
  const t1 = r1.m.result.content.map((c) => c.text || "").join("\n");
  const r2 = await call(31, "n_read", doomArgs);
  const t2 = r2.m.result.content.map((c) => c.text || "").join("\n");
  const r3 = await call(32, "n_read", doomArgs);
  const t3 = r3.m.result.content.map((c) => c.text || "").join("\n");
  const ok = !t1.includes("[REPETITION GUARD]") && !t2.includes("[REPETITION GUARD]") && /\[REPETITION GUARD\]/.test(t3);
  console.log(`${ok ? "PASS" : "FAIL"} doom-guard 3x idênticas → [REPETITION GUARD] :: ${t3.slice(0, 90).replace(/\n/g, " | ")}`);
  ok ? pass++ : fail++;
} catch (e) { console.log(`FAIL doom-guard 3x idênticas :: ${e.message}`); fail++; }

// 13-14) paginação read offset/limit next exato (src/lib/risk.mjs — nunca editado)
await t("paginacao p1 next exato offset:4", 40, "n_read", { filePath: "src/lib/risk.mjs", offset: 1, limit: 3 }, /next: n_read\(\{filePath:.*offset:4.*limit:3/);
await t("paginacao p2 exata lines 4-6", 41, "n_read", { filePath: "src/lib/risk.mjs", offset: 4, limit: 3 }, /lines 4-6 of/);

// 15-18) erros acionáveis (sem rede, sem escrita)
await t("erro simbolo ausente impact", 50, "n_analyze_change_impact", {}, /./, /symbol_id ou file_path obrigatório/);
await t("erro oldString n_edit", 51, "n_edit", { filePath: "package.json", oldString: "__SIM_BOGUS_9f8a__", newString: "x" }, /./, /oldString not found/);
await t("erro oldString semantic dry_run", 52, "n_apply_semantic_patch", { file_path: "package.json", edits: [{ oldString: "__SIM_BOGUS_9f8a__", new_code: "x" }], dry_run: true }, /./, /oldString não encontrado/);
await t("erro url obrigatoria browser", 53, "n_browser_navigate", {}, /./, /url obrigatória/);

// 19-21) ubrowser offline paths (sem extensão, sem rede)
await t("ubrowser status offline", 60, "n_ubrowser_status", {}, /./, /EXTENSÃO OFFLINE/);
await t("ubrowser tabs offline", 61, "n_ubrowser_tabs", {}, /./, /EXTENSÃO OFFLINE/);
await t("ubrowser read offline", 62, "n_ubrowser_read", {}, /./, /EXTENSÃO OFFLINE/);

// 19b-19e) ubrowser economia dentro de n_task (offline, sem extensão, sem rede, sem spawn)
// Motivo: subagente com browser = 500MB filho + snapshots gigantes retidos em tailRaw.
await t("ubrowser snapshot compact registrado no schema (offline, sem CDP)", 63, "n_bash", { command: "node -e \"import('node:fs').then(fs=>console.log(fs.readFileSync('src/lib/tools-owner.mjs','utf8').includes('compact')?'has-compact':'no-compact'))\"" }, /has-compact/);
await t("ubrowser act changed/after no código (state-diff, sem round-trip)", 64, "n_bash", { command: "node -e \"import('node:fs').then(fs=>{const s=fs.readFileSync('src/lib/tools-owner.mjs','utf8');console.log(s.includes('changed')&&s.includes('after')?'has-diff':'no-diff')})\"" }, /has-diff/);
await t("ubrowser shot scale param offline (aceito, economia metade bytes)", 65, "n_ubrowser_shot", { scale: 0.5 }, /./, /EXTENSÃO OFFLINE/);
await t("ubrowser error inclui fallback headless", 66, "n_ubrowser_snapshot", {}, /./, /fallback headless/);

// 22-24) task_delete preview (sem deletar nada real, sem spawn)
await t("task_delete dryRun preview", 70, "n_task_delete", { task_id: "all", dryRun: true }, /\[dryRun\]/);
await t("task_delete confirm preview all", 71, "n_task_delete", { task_id: "all" }, /./, /confirm obrigatório/);
await t("task_delete unknown not found", 72, "n_task_delete", { task_id: "sim-nao-existe-xyz" }, /./, /not found/);

// 25-27) find_tools query (local, sem rede)
await t("find_tools mailbox", 80, "n_find_tools", { query: "mailbox" }, /n_task_send/);
await t("find_tools read", 81, "n_find_tools", { query: "read" }, /n_read/);
await t("find_tools query vazia", 82, "n_find_tools", { query: "" }, /query vazia/);

console.log(`\nSIMULATE: ${pass} pass, ${fail} fail`);
srv.kill("SIGKILL");
setTimeout(() => process.exit(fail ? 1 : 0), 300);
