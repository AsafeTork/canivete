// canivete smoke: offline-seguro, rápido (<30s). Falha != quebrou tudo: mostra PASS/FAIL por grupo.
// OFFLINE: sem rede real, sem spawn opencode (n_task). Só stdio local + fs + risk local.
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
// tools/list offline (sem rede): valida sync n_tools_info == TOOLS sem importar server (pesado: duplo registro) nem /health (rede).
const list = (id, ms = 25000) =>
  new Promise((res, rej) => {
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: {} }) + "\n");
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (const l of buf.split("\n")) {
        try { const m = JSON.parse(l); if (m.id === id) { clearInterval(iv); res({ m, ms: Date.now() - t0 }); return; } } catch {}
      }
      if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout tools/list")); }
    }, 100);
  });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) + "\n");
let pass = 0, fail = 0;
// filtro manutenção rápida: node test/smoke.mjs --grep <re> (sem deps) — só roda t() cujo label casa; resto SKIP.
const _grepPat = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--grep" && i + 1 < a.length) return a[i + 1];
    if (a[i].startsWith("--grep=")) return a[i].slice("--grep=".length);
  }
  return null;
})();
const _grepRe = _grepPat ? new RegExp(_grepPat) : null;
if (_grepPat) console.log(`FILTER --grep /${_grepPat}/`);
const t = async (label, id, name, args, expect = /./, allowError = null) => {
  if (_grepRe && !_grepRe.test(label)) { console.log(`SKIP ${label} (filtro --grep)`); return; }
  try {
    const { m, ms } = await call(id, name, args);
    const txt = m.result.content.map((c) => c.text || "").join("\n");
    const ok = allowError ? allowError.test(txt) : !m.result.isError && expect.test(txt);
    console.log(`${ok ? "PASS" : "FAIL"} ${label} (${ms}ms) :: ${txt.slice(0, 90).replace(/\n/g, " | ")}`);
    ok ? pass++ : fail++;
  } catch (e) { console.log(`FAIL ${label} :: ${e.message}`); fail++; }
};
await t("tools_info conta 56", 1, "n_tools_info", {}, /56 tools/);
await t("read self", 2, "n_read", { filePath: "package.json", limit: 5 });
await t("bash echo", 3, "n_bash", { command: "echo smoke-ok" });
await t("glob", 4, "n_glob", { pattern: "src/lib/*.mjs" });
await t("ubrowser offline claro", 5, "n_ubrowser_status", {}, /./, /EXTENSÃO OFFLINE/);
await t("risk bloqueia", 6, "n_ubrowser_act", { action: "click", selector: "text=excluir conta" }, /./, /BLOQUEADO/);
await t("exec fatura risk", 7, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({action:'fill',selector:'#senha'})))\"" });
await t("grep acha", 8, "n_grep", { pattern: "riskOf", path: "src/lib" });
await t("investigate roda", 9, "n_investigate_issue", { symptom: "risk bloqueia pagamento" });
// risk: informativo permite (Pix Total=low) vs transacional/destrutivo bloqueia (rm -rf=high). Via risk.mjs local, sem rede.
await t("risk permite Pix Total informativo", 10, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({text:'Pix Total'})))\"" }, /low/);
await t("risk bloqueia rm -rf", 11, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({cmd:'rm -rf /',action:'n_bash'})))\"" }, /\bhigh\b/);
// ubrowser offline claro (sem rede, sem extensão): tabs também deve responder OFFLINE, não travar.
await t("ubrowser tabs offline claro", 12, "n_ubrowser_tabs", {}, /./, /EXTENSÃO OFFLINE/);
// risk permit via tool real: Pix Total NÃO pode BLOQUEAR — deve passar do risk e cair no OFFLINE.
await t("risk permite Pix Total via ubrowser (offline, sem BLOQUEIO)", 13, "n_ubrowser_act", { action: "click", text: "Pix Total" }, /./, /EXTENSÃO OFFLINE/);
// TIME S5 (offline, sem browser): snapshot contém role — trava compreensão sem importar CDP.
// snapshot headless+dono descobríveis via n_find_tools; ubrowser snapshot responde OFFLINE claro;
// campos novos (compact) e receita docs verificados via fs local (node -e, sem CDP).
await t("ubrowser snapshot offline claro", 14, "n_ubrowser_snapshot", {}, /./, /EXTENSÃO OFFLINE/);
await t("find snapshot acha headless", 15, "n_find_tools", { query: "snapshot" }, /n_browser_snapshot/);
await t("find snapshot acha dono", 16, "n_find_tools", { query: "snapshot" }, /n_ubrowser_snapshot/);
await t("snapshot compact registrado (tools-owner, sem CDP)", 17, "n_bash", { command: "node -e \"import('node:fs').then(fs=>console.log(fs.readFileSync('src/lib/tools-owner.mjs','utf8').includes('compact')?'has-compact':'no-compact'))\"" }, /has-compact/);
await t("docs receita onde-clicar (snapshot+compact+role)", 18, "n_bash", { command: "node -e \"import('node:fs').then(fs=>{const s=fs.readFileSync('docs/SKILL.md','utf8');console.log(/snapshot/.test(s)&&/compact/.test(s)&&/role/.test(s)?'receita-ok':'receita-falta')})\"" }, /receita-ok/);
// mailbox send/peek/recv roundtrip (leve, filesystem local, sem spawn opencode, sem rede). Filter isola sem limpar caixa alheia.
const mbTag = `smoke-mb-${Date.now()}`;
await t("mailbox send main", 20, "n_task_send", { task_id: "main", message: mbTag }, /delivered to main/);
await t("mailbox peek ve msg", 21, "n_task_peek", { task_id: "main", limit: 5 }, new RegExp(mbTag));
await t("mailbox recv roundtrip", 22, "n_task_recv", { task_id: "main", filter: mbTag }, new RegExp(mbTag));
// tools_info sync == TOOLS: compara número no texto n_tools_info com tools/list (stdio offline). Sem import (pesado) nem /health (rede).
if (_grepRe && !_grepRe.test("tools_info sync == tools/list")) { console.log(`SKIP tools_info sync == tools/list (filtro --grep)`); }
else try {
  const { m: infoM, ms: infoMs } = await call(30, "n_tools_info", {});
  const infoTxt = infoM.result.content.map((c) => c.text || "").join("\n");
  const { m: listM } = await list(31);
  const count = listM.result.tools ? listM.result.tools.length : 0;
  const mInfo = infoTxt.match(/(\d+)\s*tools/);
  const nInfo = mInfo ? Number(mInfo[1]) : NaN;
  const ok = !infoM.result.isError && nInfo === count && count > 0;
  console.log(`${ok ? "PASS" : "FAIL"} tools_info sync == tools/list (${infoMs}ms) :: info=${nInfo} list=${count}`);
  ok ? pass++ : fail++;
} catch (e) { console.log(`FAIL tools_info sync :: ${e.message}`); fail++; }
console.log(`\nSMOKE: ${pass} pass, ${fail} fail`);
srv.kill("SIGKILL");
setTimeout(() => process.exit(fail ? 1 : 0), 300);
