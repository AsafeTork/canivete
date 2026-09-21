// canivete — LLM direto via API OpenAI-compatível (zero deps, fetch nativo).
// Sem opencode, sem spawn, sem serve: 1 POST HTTPS por task. Provedores configuráveis
// (primário + fallbacks), qualquer um com endpoint /chat/completions (Groq, Cerebras,
// Gemini via adapter OpenAI, OpenRouter, DeepSeek, OpenAI, Ollama local, etc.).
// ENV (chaves NUNCA no git — use ~/.config/canivete/llm.env 0600 via EnvironmentFile):
//   CANIVETE_LLM_BASE_URL=https://api.groq.com/openai/v1 (obrigatório)
//   CANIVETE_LLM_API_KEY=...                              (obrigatório)
//   CANIVETE_LLM_MODEL=llama-3.3-70b-versatile            (obrigatório; qualquer id do provedor)
//   CANIVETE_LLM_PROVIDER=groq                            (opt: preset que preenche base+modelo padrão)
//   CANIVETE_LLM_TIMEOUT=120000                           (timeout ms por tentativa)
//   CANIVETE_LLM_MAX_TOKENS=2000                          (teto de completion por call)
//   Fallbacks (tentados em ordem após o primário): CANIVETE_LLM_2_BASE_URL/_KEY/_MODEL (+_PROVIDER),
//   _3_, _4_, _5_.
// Presets (só defaults; explícito sempre vence):
const PRESETS = {
  groq: { base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  cerebras: { base: "https://api.cerebras.ai/v1", model: "llama-3.3-70b" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.0-flash" },
  openrouter: { base: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
  deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  ollama: { base: "http://127.0.0.1:11434/v1", model: "llama3.1" },
};

function readSlot(sfx) {
  const g = (n) => (process.env[n] || "").trim();
  const provider = (g(`CANIVETE_LLM${sfx}_PROVIDER`) || g(sfx ? "" : "CANIVETE_LLM_PROVIDER") || "").toLowerCase();
  const preset = PRESETS[provider] || {};
  const base = (g(`CANIVETE_LLM${sfx}_BASE_URL`) || (!sfx ? g("CANIVETE_LLM_BASE_URL") : "") || preset.base || "").replace(/\/$/, "");
  const key = g(`CANIVETE_LLM${sfx}_API_KEY`) || (!sfx ? g("CANIVETE_LLM_API_KEY") : "");
  const model = g(`CANIVETE_LLM${sfx}_MODEL`) || (!sfx ? g("CANIVETE_LLM_MODEL") : "") || preset.model || "";
  if (!key || !base || !model) return null;
  return { name: provider || `slot${sfx || 1}`, base, key, model };
}

function llmProviders() {
  const out = [];
  for (const sfx of ["", "_2", "_3", "_4", "_5"]) {
    try {
      const p = readSlot(sfx);
      if (p) out.push(p);
    } catch {}
  }
  return out;
}

function llmModels() {
  return llmProviders().map((p, i) => ({ provider: p.name, model: p.model, base: p.base, primary: i === 0 }));
}

function llmMissing() {
  if (llmProviders().length) return null;
  return "LLM direto sem chave: defina CANIVETE_LLM_BASE_URL + CANIVETE_LLM_API_KEY + CANIVETE_LLM_MODEL "
    + "(ou CANIVETE_LLM_PROVIDER=groq|cerebras|gemini|openrouter|deepseek|openai|ollama + key). "
    + "Chaves em ~/.config/canivete/llm.env (0600, fora do git) via EnvironmentFile do serviço. "
    + "Fallbacks opt: CANIVETE_LLM_2_BASE_URL/_API_KEY/_MODEL (até _5). "
    + "Modos legados opencode (spawn/serve): CANIVETE_TASK_MODE=spawn|serve|auto|attach.";
}

async function chatOne(p, messages, { maxTokens, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, Math.max(5000, timeoutMs || 120000));
  try {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: p.model,
        messages,
        max_tokens: Math.max(16, maxTokens || 2000),
        stream: false,
      }),
    });
    const text = await res.text().catch(() => "");
    if (res.status >= 400) return { ok: false, error: `${p.name}/${p.model}: HTTP ${res.status} ${text.slice(0, 300)}` };
    let data = null;
    try { data = JSON.parse(text); } catch { return { ok: false, error: `${p.name}/${p.model}: resposta não-JSON ${text.slice(0, 200)}` }; }
    const content = data?.choices?.[0]?.message?.content;
    const str = Array.isArray(content) ? content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : String(content ?? "");
    if (!str.trim()) return { ok: false, error: `${p.name}/${p.model}: completion vazia (finish=${data?.choices?.[0]?.finish_reason || "?"})` };
    return { ok: true, text: str.trim(), provider: p.name, model: p.model };
  } catch (e) {
    const msg = String(e?.message || e);
    const isAbort = e?.name === "AbortError" || /abort/i.test(msg);
    return { ok: false, error: `${p.name}/${p.model}: ${isAbort ? `timeout após ${timeoutMs}ms` : msg.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function llmChat(messages, opts = {}) {
  const providers = llmProviders();
  if (!providers.length) return { ok: false, error: llmMissing() };
  const timeoutMs = Number(process.env.CANIVETE_LLM_TIMEOUT) || 120000;
  const maxTokens = Number(process.env.CANIVETE_LLM_MAX_TOKENS) || 2000;
  const errors = [];
  for (const p of providers) {
    const r = await chatOne(p, messages, { maxTokens: opts.maxTokens || maxTokens, timeoutMs: opts.timeoutMs || timeoutMs });
    if (r.ok) return r;
    errors.push(r.error);
  }
  return { ok: false, error: `todos os provedores falharam (${providers.length}): ${errors.join(" | ").slice(0, 800)}` };
}

export { PRESETS, llmProviders, llmModels, llmMissing, llmChat };
