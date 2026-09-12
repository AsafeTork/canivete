// canivete — WhatsApp Web dedicado (seletores data-testid estáveis).
// Ações de leitura/navegação: low. Envio: medium e SÓ com texto explícito do dono
// (conteúdo da mensagem NÃO passa na trava — quem ordena o envio é o dono).
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubSend, ubConnected, UB_OFF } from "./ubridge.mjs";

const WA_GW = process.env.WA_GW_URL || "http://127.0.0.1:19424";
const WA_TOKEN = () =>
  (process.env.CANIVETE_TOKEN || "").trim() ||
  (() => { try { return readFileSync(`${process.env.HOME || "/root"}/.config/canivete/token.txt`, "utf8").trim(); } catch { return ""; } })();
import { readFileSync } from "node:fs";
async function waGw(path, method = "GET", body = null, timeoutMs = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${WA_GW}${path}`, {
      method, signal: ac.signal,
      headers: { "content-type": "application/json", "x-token": WA_TOKEN() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

reg("n_whatsapp", {
  description: "WhatsApp DEDICADO: via gateway Baileys (WebSocket, sem browser) com fallback p/ Chrome logado. state|chats|open|read|send|pair. Envio só com texto explícito do dono. Ex: {action:\"open\", name:\"Projeto II\"} {action:\"pair\", phone:\"5591999999999\"}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["state", "chats", "open", "read", "send", "pair"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho título/URL (default: acha web.whatsapp.com)" },
      name: { type: "string", description: "nome do chat/grupo p/ open (browser) " },
      to: { type: "string", description: "JID, número ou nome do grupo p/ gateway" },
      phone: { type: "string", description: "número E.164 p/ pair (ex: 5591999999999)" },
      text: { type: "string", description: "mensagem p/ send (obrigatória, explícita do dono)" },
      limit: { type: "number", default: 20, description: "N chats/mensagens (máx 100 p/ read)" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    const ms = () => Date.now() - t0;
    // via gateway primeiro (rápido, sem browser) p/ state/chats/read/send/pair
    if (["state", "chats", "read", "send", "pair"].includes(a.action)) {
      try {
        if (a.action === "state") {
          const h = await waGw("/health");
          return devOut({ summary: `gateway Baileys: ${h.wa || "?"}`, data: { via: "gateway", state: h.wa }, telemetry: { execution_time_ms: ms() } });
        }
        if (a.action === "pair") {
          if (!a.phone) return devOut({ status: "error", summary: "pair exige phone E.164 (ex: 5591999999999)", data: {}, telemetry: { execution_time_ms: ms() } });
          const p = await waGw("/wa/pair", "POST", { phone: a.phone }, 60000);
          if (!p.ok) return devOut({ status: "error", summary: `pair: ${p.error}`, data: {}, telemetry: { execution_time_ms: ms() } });
          return devOut({ summary: p.already ? "Já pareado ✓" : `CÓDIGO: ${p.code} — ${p.how}`, data: { via: "gateway", ...p }, telemetry: { execution_time_ms: ms() } });
        }
        if (a.action === "chats") {
          const c = await waGw("/wa/chats");
          if (c.ok) return devOut({ summary: `${c.groups.length} grupo(s) via gateway`, data: { via: "gateway", groups: c.groups }, telemetry: { execution_time_ms: ms() } });
        }
        if (a.action === "read") {
          const c = await waGw("/wa/read", "POST", { jid: a.to, name: a.name, limit: a.limit || 20 });
          if (c.ok && (c.messages || []).length) {
            const msgs = c.messages || [];
            return devOut({ summary: `${msgs.length} mensagem(ns) via gateway` + (msgs.length ? ` — última: ${(msgs[msgs.length - 1].text || "").slice(0, 100)}` : ""), data: { via: "gateway", messages: msgs }, telemetry: { execution_time_ms: ms() } });
          }
          // vazio/falha → cai p/ browser abaixo
        }
        if (a.action === "send") {
          if (!(a.text && String(a.text).trim())) return devOut({ status: "error", summary: "send exige text explícito do dono", data: {}, telemetry: { execution_time_ms: ms() } });
          const c = await waGw("/wa/send", "POST", { to: a.to || a.name, text: a.text });
          if (c.ok) return devOut({ summary: `Mensagem enviada via gateway ✓ (id ${c.id || "?"})`, data: { via: "gateway", risk: "medium", ...c }, telemetry: { execution_time_ms: ms() } });
          if (!/desconectado|não achado|404/.test(c.error || "")) return devOut({ status: "error", summary: `gateway: ${c.error}`, data: { via: "gateway" }, telemetry: { execution_time_ms: ms() } });
          // cai p/ browser abaixo
        }
      } catch (e) {
        if (a.action === "state") return devOut({ status: "error", summary: `gateway fora do ar (${String(e.message || e).slice(0, 100)}) — tentando browser`, data: {}, telemetry: { execution_time_ms: ms() } });
      }
    }
    const map = { state: "tab.wa_state", chats: "tab.wa_chats", open: "tab.wa_open", read: "tab.wa_read", send: "tab.wa_send" };
    if (!map[a.action]) return devOut({ status: "error", summary: `action inválida: ${a.action}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "send" && !(a.text && String(a.text).trim())) return devOut({ status: "error", summary: "send exige text explícito do dono", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend(map[a.action], { ...a }, 90000);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 90s (WhatsApp pesado/sincronizando)", data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = r.data || {};
    const msgs = Array.isArray(d) ? d : d.messages || [];
    const summary = a.action === "read"
      ? `${msgs.length} mensagem(ns)` + (msgs.length ? ` — última de ${msgs[msgs.length - 1].from}: ${(msgs[msgs.length - 1].text || "").slice(0, 100)}` : "")
      : a.action === "open" ? (d.opened ? `Chat aberto: ${d.title || a.name}` : `NÃO abriu (${d.reason || "?"})`)
      : a.action === "send" ? (d.sent ? "Mensagem enviada ✓ (confira no telefone)" : `NÃO enviada (${d.reason || "?"})`)
      : a.action === "chats" ? `${(Array.isArray(d) ? d.length : (d.chats || []).length)} conversa(s)`
      : `state: ${d.logged ? "logado" : d.qr ? "QR (parear no telefone)" : "carregando"}`;
    return devOut({ summary, data: { action: "whatsapp_" + a.action, risk: a.action === "send" ? "medium" : "low", result: d }, telemetry: { execution_time_ms: Date.now() - t0 }, next: a.action === "open" && d.opened ? [{ tool: "n_whatsapp", reason: "Ler mensagens (read)" }] : [] });
  },
});
