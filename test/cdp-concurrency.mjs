// Regressão: duas leituras headless paralelas não podem trocar URL/conteúdo.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = mkdtempSync(join(tmpdir(), "canivete-cdp-race-"));
process.env.CANIVETE_CHROME_PROFILE = profile;
process.env.CANIVETE_CDP_PORT = String(24000 + process.pid % 10000);
const { withCdp, cdpGoto, cdpState } = await import("../src/lib/cdp.mjs");
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>${req.url === "/a" ? "Página A" : "Página B"}</title><main>${req.url === "/a" ? "conteúdo A" : "conteúdo B"}</main>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const read = (path, delay) => withCdp(async ({ send }) => {
    await cdpGoto(send, base + path, 1500);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return cdpState(send);
  }, { url: base + path });
  const [a, b] = await Promise.all([read("/a", 500), read("/b", 0)]);
  assert.equal(new URL(a.url).pathname, "/a");
  assert.equal(new URL(b.url).pathname, "/b");
  assert.equal(a.title, "Página A");
  assert.equal(b.title, "Página B");
  console.log("PASS: chamadas paralelas mantiveram URL e título próprios");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const name of readdirSync("/proc").filter((v) => /^\d+$/.test(v))) {
    try {
      const cmd = readFileSync(`/proc/${name}/cmdline`, "utf8");
      if (cmd.includes("chrome") && cmd.includes(`--user-data-dir=${profile}`)) process.kill(Number(name), "SIGTERM");
    } catch {}
  }
}
