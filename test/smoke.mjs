// canivete smoke: offline-seguro, rápido (<30s). Falha != quebrou tudo: mostra PASS/FAIL por grupo.
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
await t("tools_info conta 51", 1, "n_tools_info", {});
await t("read self", 2, "n_read", { filePath: "package.json", limit: 5 });
await t("bash echo", 3, "n_bash", { command: "echo smoke-ok" });
await t("glob", 4, "n_glob", { pattern: "src/lib/*.mjs" });
await t("ubrowser offline claro", 5, "n_ubrowser_status", {}, /./, /EXTENSÃO OFFLINE/);
await t("risk bloqueia", 6, "n_ubrowser_act", { action: "click", selector: "text=excluir conta" }, /./, /BLOQUEADO/);
await t("exec fatura risk", 7, "n_bash", { command: "node -e \"import('./src/lib/risk.mjs').then(m=>console.log(m.riskOf({action:'fill',selector:'#senha'})))\"" });
await t("grep acha", 8, "n_grep", { pattern: "riskOf", path: "src/lib" });
await t("investigate roda", 9, "n_investigate_issue", { symptom: "risk bloqueia pagamento" });
console.log(`\nSMOKE: ${pass} pass, ${fail} fail`);
srv.kill("SIGKILL");
setTimeout(() => process.exit(fail ? 1 : 0), 300);
