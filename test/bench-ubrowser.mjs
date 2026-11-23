// canivete — benchmark do ubrowser (tokens + latência).
// Uso: node test/bench-ubrowser.mjs [--json] [--runs=3] [--tool=cv_ubrowser_read]
// Mede o custo REAL de cada chamada (texto JSON devolvido ao modelo) e o custo fixo
// dos schemas em tools/list. Não altera a página: só leitura + evaluate de título.
// Requer daemon vivo (19423) e token em ~/.config/canivete/token.txt.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const runs = Math.max(1, Number((args.find((a) => a.startsWith("--runs=")) || "").split("=")[1]) || 3);
const only = (args.find((a) => a.startsWith("--tool=")) || "").split("=")[1] || null;
const tabNeedle = (args.find((a) => a.startsWith("--tab=")) || "").split("=")[1] || "bench-page";
const PORT = Number(process.env.CANIVETE_MCP_PORT) || 19423;
const TOKEN = (process.env.CANIVETE_TOKEN || readFileSync(join(homedir(), ".config", "canivete", "token.txt"), "utf8")).trim();
const URL = `http://127.0.0.1:${PORT}/mcp`;

async function rpc(method, params, timeoutMs = 90000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctl.signal,
    });
    const j = await r.json();
    return { ms: Math.round(performance.now() - t0), j };
  } finally { clearTimeout(t); }
}

async function call(name, args = {}, timeoutMs = 90000) {
  const { ms, j } = await rpc("tools/call", { name, arguments: args }, timeoutMs);
  const content = j?.result?.content || [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const images = content.filter((c) => c.type === "image");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return {
    ms,
    bytes: Buffer.byteLength(text, "utf8"),
    tokens: Math.ceil(Buffer.byteLength(text, "utf8") / 4),
    images: images.length,
    status: parsed?.status || (j?.error ? "rpc-error" : "?"),
    summary: String(parsed?.summary || j?.error?.message || "").slice(0, 110),
    text,
  };
}

const calls = [
  ["cv_ubrowser_status", {}],
  ["cv_ubrowser_tabs", { max: 30 }],
  ["cv_ubrowser_overview", { max: 35 }],
  ["cv_ubrowser_overview", { goal: "Ferramentas" }, "overview-goal"],
  ["cv_ubrowser_read", { maxChars: 2500, maxLinks: 15 }],
  ["cv_ubrowser_read", { outline: true }, "read-outline"],
  ["cv_ubrowser_snapshot", { max: 30 }],
  ["cv_ubrowser_snapshot", { max: 120 }, "snapshot-120"],
  ["cv_ubrowser_act", { action: "evaluate", js: "document.title.length" }, "act-evaluate"],
  ["cv_ubrowser_act", { action: "wait", waitMs: 0 }, "act-wait0"],
];

const out = { generatedAt: new Date().toISOString(), runs, schemas: {}, calls: [] };

// custo fixo: todo schema entra no contexto do modelo em cada sessão
try {
  const { j } = await rpc("tools/list", {}, 20000);
  const tools = j?.result?.tools || [];
  for (const t of tools) {
    const s = JSON.stringify(t);
    out.schemas[t.name] = { bytes: Buffer.byteLength(s), tokens: Math.ceil(Buffer.byteLength(s) / 4), descBytes: Buffer.byteLength(t.description || "") };
  }
  out.schemaTotals = {
    tools: tools.length,
    bytes: Object.values(out.schemas).reduce((a, s) => a + s.bytes, 0),
    tokens: Object.values(out.schemas).reduce((a, s) => a + s.tokens, 0),
    ubrowserBytes: Object.entries(out.schemas).filter(([n]) => n.startsWith("cv_owner_") || n.startsWith("cv_ubrowser_")).reduce((a, [, s]) => a + s.bytes, 0),
    ubrowserTokens: Object.entries(out.schemas).filter(([n]) => n.startsWith("cv_owner_") || n.startsWith("cv_ubrowser_")).reduce((a, [, s]) => a + s.tokens, 0),
  };
} catch (e) { out.schemaError = String(e); }

// aba alvo: por padrão a página local de bench (grupo do agente, segundo plano)
try {
  const r = await call("cv_ubrowser_tabs", { filter: tabNeedle, max: 5 });
  const d = JSON.parse(r.text);
  out.tabId = d?.data?.tabs?.[0]?.id ?? null;
  out.tabUrl = d?.data?.tabs?.[0]?.url ?? null;
  out.tabProfile = d?.data?.tabs?.[0]?.profile ?? d?.data?.profiles?.[0]?.id ?? null;
} catch (e) { out.tabError = String(e); }

for (const [name, a, label] of calls) {
  if (only && !name.includes(only) && label !== only) continue;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    // _bench=i evita o guard de repetição (mesma tool+args+resultado vira "REPETIÇÃO 3×"
    // a partir da 3ª chamada) — sem isso a mediana mede o atalho, não o payload real.
    const base = name === "cv_ubrowser_status" || name === "cv_ubrowser_tabs" ? a : { ...(out.tabId ? { tabId: out.tabId } : {}), ...(out.tabProfile ? { profile: out.tabProfile } : {}), ...a };
    const r = await call(name, { ...base, _bench: i });
    samples.push(r);
    if (r.status === "error" && /offline|EXTENS/i.test(r.summary)) break;
  }
  const ok = samples.filter((s) => s.status !== "rpc-error");
  const med = (arr) => arr.slice().sort((x, y) => x - y)[Math.floor(arr.length / 2)] || 0;
  out.calls.push({
    label: label || name,
    tool: name,
    args: a,
    runs: ok.length,
    ms: med(ok.map((s) => s.ms)),
    bytes: med(ok.map((s) => s.bytes)),
    tokens: med(ok.map((s) => s.tokens)),
    images: med(ok.map((s) => s.images)),
    status: ok[0]?.status || "?",
    summary: ok[0]?.summary || "",
    samples: ok.map((s) => ({ ms: s.ms, bytes: s.bytes, status: s.status })),
  });
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`# ubrowser bench — ${out.generatedAt} (${runs} runs, mediana)\n`);
  if (out.schemaTotals) {
    const st = out.schemaTotals;
    console.log(`schemas: ${st.tools} tools · ${st.bytes}B (~${st.tokens} tok) · ubrowser ${st.ubrowserBytes}B (~${st.ubrowserTokens} tok)\n`);
    const top = Object.entries(out.schemas).filter(([n]) => n.startsWith("cv_owner_") || n.startsWith("cv_ubrowser_")).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8);
    for (const [n, s] of top) console.log(`  schema ${n}: ${s.bytes}B (~${s.tokens} tok)`);
    console.log(`  aba alvo: ${out.tabId ?? "?"} ${out.tabUrl || ""}\n`);
  }
  console.log("| chamada | ms | bytes | ~tok | status | summary |");
  console.log("|---|---:|---:|---:|---|---|");
  for (const c of out.calls) console.log(`| ${c.label} | ${c.ms} | ${c.bytes} | ${c.tokens} | ${c.status} | ${c.summary.replace(/\|/g, "/")} |`);
}
