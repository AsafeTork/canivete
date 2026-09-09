#!/usr/bin/env node
// canivete serve: supervisor da ponte HTTP — reinicia sozinho em queda (gargalo zero).
// Uso: node src/serve.mjs [port]   (default 19423; env como no server.mjs)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const port = Number(process.argv[2]) || 19423;
const server = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");
let backoff = 1000;
for (;;) {
  const t0 = Date.now();
  const code = await new Promise((res) => {
    const c = spawn(process.execPath, [server, "--http", String(port)], { stdio: "inherit" });
    c.on("exit", res);
    c.on("error", () => res(-1));
  });
  const lived = Date.now() - t0;
  process.stderr.write(`[canivete-serve] saiu (exit ${code}, viveu ${Math.round(lived / 1000)}s) — reiniciando em ${backoff}ms\n`);
  await new Promise((r) => setTimeout(r, backoff));
  backoff = Math.min(backoff * 2, 30000);
  if (lived > 60000) backoff = 1000;
}
