// canivete — elemreports: reports persistentes de ELEMENTO (marcação humana na página viva).
// O humano marca 1..N elementos no overlay da extensão e escreve o que está errado; o report
// fica VINCULADO AO SITE (base_url = origem normalizada, vale p/ o site inteiro) e só some do
// highlight quando EXPLICITAMENTE resolvido — histórico nunca apaga.
// Fluxo do agente: frase-gatilho ("no nosso site https://ex.com tem erros que reportei") →
// n_elemreports_list (prioriza) → resolve um a um → n_elemreports_resolve com prova (antes/depois).
//
// Fonte canônica: ~/.config/canivete/reports-elementos.jsonl (append-only; a ÚLTIMA linha por id
// é o estado corrente — versões antigas = histórico). Screenshot opcional: reports-elementos/<id>.png.
// Robustez a prompt ruim: cada report carrega snapshot estático (seletor estável + fingerprint
// texto/papel + role/data-testid + outerHTML + rect) — o agente entende o problema sozinho.
// Doutrina do mon-hook: SÓ leitura de DOM visível + anotação humana — nunca cookie, header,
// armazenamento da página nem valor de senha (erStripSecrets re-age aqui por garantia).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { reg, out } from "./ctx.mjs";

export const ER_STATUSES = ["aberto", "em_resolução", "resolvido"];
const ER_MAX_LINES = 1500; // prune reescreve o arquivo no estado corrente (versões antigas bounded)
const ER_KEEP_RESOLVED = 300; // resolvidos retidos no arquivo (histórico nunca zera de uma vez)
const ER_SHOT_MAX_B64 = 2500000; // screenshot: ~1,8MB binários — acima disso segue sem print

const erPath = () => process.env.CANIVETE_ELEMREPORTS_FILE || join(homedir(), ".config/canivete/reports-elementos.jsonl");
const erShotDir = () => join(dirname(erPath()), "reports-elementos");

// ---- hook de mudança (ubridge registra p/ avisar a extensão: re-sincroniza cache + highlight)
let erChangeFn = null;
export function erOnChange(fn) { try { erChangeFn = typeof fn === "function" ? fn : null; } catch {} }
function erNotify(base) { try { if (erChangeFn) erChangeFn(base); } catch {} }

// ---- puros (testáveis sem fs)
// base_url = origem normalizada (https://ex.com, sem path/barra): o report vale p/ o site inteiro.
export function erNormalizeBase(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch { return null; }
}
function erNorm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
// Levenshtein com teto de tamanho: nota "parecida" = mesma ideia escrita torto (prompt ruim é a regra).
function erLev(a, b) {
  const s = String(a || "").slice(0, 120), t = String(b || "").slice(0, 120);
  if (s === t) return 0;
  const m = s.length, n = t.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function erNoteClose(a, b) {
  const x = erNorm(a), y = erNorm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return erLev(x, y) <= Math.max(2, Math.floor(Math.max(x.length, y.length) * 0.15));
}
// doutrina: valor de senha nunca sai do browser nem entra no report (nem por outerHTML)
export function erStripSecrets(html) {
  try {
    let s = String(html || "");
    if (/type\s*=\s*["']?password/i.test(s)) s = s.replace(/(\svalue\s*=\s*)"[^"]*"/gi, '$1""');
    return s.replace(/\s(autocomplete|data-unmasked-value)\s*=\s*"[^"]*"/gi, " $1");
  } catch { return String(html || "").slice(0, 2000); }
}

// ---- persistência (JSONL append-only + reduce por id; espelha o desenho do feedback.mjs)
function erReadState() {
  const map = new Map(); // id -> versão mais nova (estado corrente)
  try {
    const p = erPath();
    if (!existsSync(p)) return map;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== "object" || !o.id) continue;
      map.set(o.id, o);
    }
  } catch {}
  return map;
}
// Rotação estilo pruneInbox: acima do teto, reescreve SÓ o estado corrente (abertos intocáveis
// + os resolvidos mais recentes). Barato e raro; histórico vivo continua no arquivo entre rotações.
function erPrune(p) {
  try {
    if (!existsSync(p)) return;
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
    if (lines.length < ER_MAX_LINES) return;
    const state = [...erReadState().values()];
    const keepOpen = state.filter((r) => r.status !== "resolvido");
    const keepDone = state.filter((r) => r.status === "resolvido")
      .sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")))
      .slice(0, ER_KEEP_RESOLVED);
    const keep = [...keepOpen, ...keepDone].sort((a, b) => String(a.atualizado_em || "").localeCompare(String(b.atualizado_em || "")));
    writeFileSync(p, keep.map((r) => JSON.stringify(r)).join("\n") + "\n");
  } catch {}
}
function erAppend(entry) {
  const p = erPath();
  mkdirSync(dirname(p), { recursive: true });
  try { if (existsSync(p)) erPrune(p); } catch {}
  appendFileSync(p, JSON.stringify(entry) + "\n");
  return entry;
}
function erSaveShot(id, dataUrl) {
  try {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m || m[2].length > ER_SHOT_MAX_B64) return null;
    const dir = erShotDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id + ".png"), Buffer.from(m[2], "base64"));
    return "reports-elementos/" + id + ".png";
  } catch { return null; }
}
export function erShotPath(id) {
  try {
    if (!/^er[a-z0-9]+$/.test(String(id || ""))) return null;
    const f = join(erShotDir(), id + ".png");
    return existsSync(f) ? f : null;
  } catch { return null; }
}

// Sanitiza 1 elemento descrito pela extensão (seletor obrigatório; resto truncado; sem segredos)
function erSanEl(e) {
  try {
    if (!e || typeof e !== "object") return null;
    const selector = String(e.selector || "").trim().slice(0, 300);
    if (!selector) return null;
    return {
      selector,
      tag: String(e.tag || "").toLowerCase().slice(0, 30),
      role: String(e.role || "").slice(0, 60),
      testid: String(e.testid || "").slice(0, 120),
      text: String(e.text || "").replace(/\s+/g, " ").trim().slice(0, 400),
      html: erStripSecrets(String(e.html || "").slice(0, 2000)),
      fingerprint: (e.fingerprint && typeof e.fingerprint === "object")
        ? { sel: String(e.fingerprint.sel || "").slice(0, 300), text: String(e.fingerprint.text || "").slice(0, 80), role: String(e.fingerprint.role || "").slice(0, 40), tag: String(e.fingerprint.tag || "").slice(0, 30) }
        : null,
      rect: (e.rect && typeof e.rect === "object")
        ? { x: Math.round(Number(e.rect.x) || 0), y: Math.round(Number(e.rect.y) || 0), w: Math.round(Number(e.rect.w) || 0), h: Math.round(Number(e.rect.h) || 0) }
        : null,
    };
  } catch { return null; }
}

// ---- add (extensão via ponte ou tool): dedupe por seletor primário + nota parecida
export function erAdd(p) {
  try {
    p = p && typeof p === "object" ? p : {};
    const base = erNormalizeBase(p.base_url);
    if (!base) return { ok: false, error: "base_url inválida — passe a URL do site (ex: https://exemplo.com)" };
    const nota = String(p.nota || "").trim().slice(0, 2000);
    if (nota.length < 3) return { ok: false, error: "nota muito curta — descreva o que está errado (≥3 chars)" };
    // grupo = escopo digitado pelo dono na hora da marcação (texto livre, sem registry):
    // serve p/ o agente filtrar SÓ o escopo dele em n_elemreports_list {grupo}
    const grupo = String(p.grupo || "").trim().slice(0, 60);
    const rawEls = Array.isArray(p.elements) ? p.elements.slice(0, 10) : [];
    const elements = [];
    for (const e of rawEls) { const s = erSanEl(e); if (s) elements.push(s); }
    if (!elements.length) return { ok: false, error: "sem elementos válidos — cada elemento precisa de selector (a extensão gera cssPath sozinha)" };
    const now = new Date().toISOString();
    // dedupe: mesmo site + mesmo seletor primário + nota parecida = MESMO report (1..N cliques repetidos)
    const state = erReadState();
    for (const r of state.values()) {
      try {
        if (r.status === "resolvido") continue;
        if (r.base_url !== base) continue;
        if (!Array.isArray(r.elements) || !r.elements.length) continue;
        if (String(r.elements[0].selector) !== elements[0].selector) continue;
        if (String(r.grupo || "") !== grupo) continue; // mesmo botão em outro grupo = outro escopo = report novo
        if (!erNoteClose(r.nota, nota)) continue;
        const upd = { ...r, elements, page: (p.page && typeof p.page === "object") ? { url: String(p.page.url || "").slice(0, 300), title: String(p.page.title || "").slice(0, 120) } : r.page, ocorrencias: (Number(r.ocorrencias) || 1) + 1, atualizado_em: now };
        erAppend(upd);
        erNotify(base);
        return { ok: true, report: upd, deduped: true };
      } catch {}
    }
    const shot = (typeof p.shotDataUrl === "string") ? p.shotDataUrl : null;
    const entry = {
      id: "er" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      base_url: base,
      status: "aberto",
      seletor: elements[0].selector, // conveniência: seletor primário (o 1º marcado)
      elements,
      nota,
      grupo,
      prompt: String(p.prompt || "").trim().slice(0, 500),
      area: String(p.area || "").trim().slice(0, 40),
      page: (p.page && typeof p.page === "object") ? { url: String(p.page.url || "").slice(0, 300), title: String(p.page.title || "").slice(0, 120) } : null,
      ocorrencias: 1,
      resolucao: null,
      shot: null, // screenshot (se veio) é salvo já com o id definitivo, logo abaixo
      criado_em: now,
      atualizado_em: now,
    };
    if (shot) entry.shot = erSaveShot(entry.id, shot);
    erAppend(entry);
    erNotify(base);
    return { ok: true, report: entry, deduped: false };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200) }; }
}

// ---- update (pack editável): editar nota/prompt, adicionar/remover elementos, apagar grupo
export function erUpdate(f) {
  try {
    f = f && typeof f === "object" ? f : {};
    const id = String(f.id || "").trim();
    if (!/^er[a-z0-9]+$/.test(id)) return { ok: false, error: "id inválido — use o id de n_elemreports_list (formato er…)" };
    const state = erReadState();
    const cur = state.get(id);
    if (!cur) return { ok: false, error: `report ${id} não existe — reliste com n_elemreports_list` };
    if (f.apagar === true) {
      const upd = { ...cur, apagado: true, status: "resolvido", resolucao: { proof: "apagado pelo dono na marcação", por: "dono", em: new Date().toISOString() }, atualizado_em: new Date().toISOString() };
      erAppend(upd);
      erNotify(upd.base_url);
      return { ok: true, report: upd, apagado: true };
    }
    const upd = { ...cur, atualizado_em: new Date().toISOString() };
    if (typeof f.nota === "string") {
      const nota = f.nota.trim().slice(0, 2000);
      if (nota.length < 3) return { ok: false, error: "nota muito curta — descreva o que está errado (≥3 chars)" };
      upd.nota = nota;
    }
    if (typeof f.prompt === "string") upd.prompt = f.prompt.trim().slice(0, 500);
    if (typeof f.grupo === "string") upd.grupo = f.grupo.trim().slice(0, 60); // escopo editável (texto livre)
    if (Array.isArray(f.elements_add)) {
      const sels = new Set((upd.elements || []).map((e) => e.selector));
      for (const e of f.elements_add.slice(0, 10)) {
        const s = erSanEl(e);
        if (s && !sels.has(s.selector)) { (upd.elements = upd.elements || []).push(s); sels.add(s.selector); }
      }
      if (!(upd.elements || []).length) return { ok: false, error: "sem elementos válidos em elements_add" };
      upd.seletor = upd.elements[0].selector;
    }
    if (Array.isArray(f.elements_remove) && f.elements_remove.length) {
      const rm = new Set(f.elements_remove.map((s) => String(s || "").slice(0, 300)));
      const els = (upd.elements || []).filter((e) => !rm.has(e.selector));
      if (!els.length) return { ok: false, error: "não dá para remover o último elemento — apague o report (group vazio não existe)" };
      upd.elements = els;
      upd.seletor = els[0].selector;
    }
    erAppend(upd);
    erNotify(upd.base_url);
    return { ok: true, report: upd };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200) }; }
}

// ---- list (MCP + ponte): estado corrente, filtros por base/status/área/texto
export function erListPublic(f = {}) {
  try {
    f = f || {};
    const base = f.base_url ? erNormalizeBase(f.base_url) : null;
    if (f.base_url && !base) return { ok: false, error: "base_url inválida — ex: https://exemplo.com", count: 0, items: [] };
    const st = String(f.status || "").trim();
    const q = erNorm(f.q);
    const area = String(f.area || "").trim();
    const grupo = String(f.grupo || "").trim().slice(0, 60); // escopo: igualdade case-insensitive (dono digita livre)
    const lim = Math.min(Math.max(Number(f.limit) || 200, 1), 500);
    const full = f.full === true;
    const items = [];
    for (const r of erReadState().values()) {
      try {
        if (r.apagado) continue;
        if (base && r.base_url !== base) continue;
        if (st && st !== "todos" && String(r.status) !== st) continue;
        if (!st && String(r.status) === "resolvido") continue; // default: só pendentes (o highlight vive)
        if (area && String(r.area || "") !== area) continue;
        if (grupo && String(r.grupo || "").trim().toLowerCase() !== grupo.toLowerCase()) continue;
        if (q) {
          const hay = erNorm([r.nota, r.prompt, r.seletor, r.page && r.page.url, (r.elements || []).map((e) => e.text + " " + e.selector + " " + e.testid).join(" ")].join("\n"));
          if (!hay.includes(q)) continue;
        }
        // slim p/ ponte/painel: outerHTML só com full=true (payload leve p/ o content re-aplicar mark)
        items.push({ ...r, elements: (r.elements || []).map((e) => (full ? e : { ...e, html: undefined })) });
      } catch {}
    }
    items.sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")));
    return { ok: true, count: Math.min(items.length, lim), total: items.length, items: items.slice(0, lim) };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200), count: 0, items: [] }; }
}

// ---- status (ciclo de vida): aberto → em_resolução → resolvido (resolvido só some do highlight)
export function erSetStatus(f) {
  try {
    f = f && typeof f === "object" ? f : {};
    const id = String(f.id || "").trim();
    if (!/^er[a-z0-9]+$/.test(id)) return { ok: false, error: "id inválido — use o id de n_elemreports_list (formato er…)" };
    const status = String(f.status || "resolvido").trim();
    if (!ER_STATUSES.includes(status)) return { ok: false, error: `status inválido: ${status} (use ${ER_STATUSES.join("|")})` };
    const state = erReadState();
    const cur = state.get(id);
    if (!cur) return { ok: false, error: `report ${id} não existe em ~/.config/canivete/reports-elementos.jsonl — reliste com n_elemreports_list` };
    if (cur.status === status) return { ok: false, error: `report ${id} já está "${status}"` };
    if (cur.status === "resolvido" && status === "em_resolução") return { ok: false, error: `report ${id} já resolvido — reabra (status:"aberto") antes de voltar a em_resolução` };
    const proof = String(f.proof || "").trim().slice(0, 2000);
    if (status === "resolvido" && proof.length < 10) return { ok: false, error: "resolvido exige proof ≥10 chars (antes/depois: o que mudou e onde — arquivo/commit/print)" };
    const now = new Date().toISOString();
    const upd = {
      ...cur,
      status,
      atualizado_em: now,
      resolucao: status === "resolvido"
        ? { proof, por: String(f.por || "agente").slice(0, 60), em: now }
        : (status === "aberto" ? null : (cur.resolucao || { proof: proof || "em resolução", por: String(f.por || "agente").slice(0, 60), em: now })),
    };
    erAppend(upd);
    erNotify(upd.base_url);
    return { ok: true, report: upd };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200) }; }
}

// ---- fonte p/ o painel (/api/issues funde issues + mon-log + elem): estado corrente, sem html
export function erForPainel() {
  try {
    const items = [];
    for (const r of erReadState().values()) {
      try {
        if (r.apagado) continue;
        items.push({
          id: r.id, ts: r.atualizado_em || r.criado_em, kind: "elem", status: r.status,
          text: String(r.nota || "").slice(0, 300), got: String(r.seletor || "").slice(0, 200),
          grupo: String(r.grupo || "").slice(0, 60) || null,
          where: `${r.base_url}${r.page && r.page.url ? " · " + String(r.page.url).slice(0, 120) : ""}`,
          url: String((r.page && r.page.url) || r.base_url || "").slice(0, 300),
          area: r.area || null, agent: (r.resolucao && r.resolucao.por) || null, elem: r.id,
          shot: erShotPath(r.id) ? true : false, // painel mostra a captura da marcação (report gráfico)
        });
      } catch {}
    }
    return items;
  } catch { return []; }
}

const erOneLine = (r) => {
  const n = (r.elements || []).length;
  return `#${String(r.id).slice(2, 10)} ${r.status} · ${n} elemento(s) · ${r.ocorrencias}× · "${String(r.nota || "").slice(0, 120)}"`;
};

reg("n_elemreports_list", {
  description: "Reports persistentes de ELEMENTO de um site (marcações que o dono fez na página viva via extensão, com anotação do que está errado). Use QUANDO o dono disser algo como \"no nosso site https://exemplo.com tem erros que reportei\" / \"nesse site que estou desenvolvendo\": normalize a URL (aceita com path), liste os ABERTOS e resolva um a um. Cada report traz snapshot estático (seletor estável, fingerprint texto/papel, role/data-testid, outerHTML, rect) — o prompt ruim do humano não trava: o snapshot dá contexto. Sem filtro de status, só pendentes (resolvido = histórico).",
  inputSchema: {
    type: "object",
    properties: {
      base_url: { type: "string", description: "URL do site (aceita com path — vira origem normalizada: https://exemplo.com). OBRIGATÓRIO." },
      status: { type: "string", enum: [...ER_STATUSES, "todos"], description: "filtro por estado; omitir = aberto + em_resolução (pendentes)" },
      area: { type: "string", description: "filtro por área/tag (ex: checkout, auth)" },
      grupo: { type: "string", description: "filtro por GRUPO/escopo que o dono digitou na marcação (ex: \"checkout\") — use quando ele disser \"só o escopo X\"; igualdade case-insensitive" },
      q: { type: "string", description: "busca em nota/prompt/seletor/texto do elemento" },
      limit: { type: "number", default: 25, description: "máx de reports no texto (1-500)" },
      full: { type: "boolean", default: false, description: "true inclui outerHTML completo de cada elemento (mais tokens)" },
    },
    required: ["base_url"],
  },
  run: async ({ base_url, status, area, grupo, q, limit, full }) => {
    if (!base_url || !String(base_url).trim()) return out("base_url OBRIGATÓRIO — informe a URL do site (ex: https://exemplo.com); aceita com path (vira origem normalizada)", true);
    const r = erListPublic({ base_url, status, area, grupo, q, limit: Math.min(Math.max(Number(limit) || 25, 1), 500), full });
    if (!r.ok) return out(`${r.error} — AÇÃO: passe base_url com esquema+host (ex: https://exemplo.com)`, true);
    const base = erNormalizeBase(base_url);
    if (!r.count) return out(`sem reports ${status && status !== "todos" ? `"${status}"` : "pendentes"} para ${base} — se o dono marcou agora, peça para repetir a marcação (extensão: popup → Marcar problema, ou n_ubrowser_act {action:"elem_pick"})`);
    const lines = [`reports de ${base} — ${r.total} no total, ${r.count} no filtro:`, ""];
    let i = 0;
    for (const rep of r.items) {
      i++;
      lines.push(`#${i} ${rep.id} · ${rep.status} · ${rep.ocorrencias} ocorrência(s) · criado ${rep.criado_em} · atualizado ${rep.atualizado_em}${rep.grupo ? ` · grupo ${rep.grupo}` : ""}${rep.area ? ` · área ${rep.area}` : ""}${rep.shot ? ` · screenshot ${rep.shot}` : ""}`);
      if (rep.page && rep.page.url) lines.push(`   página: ${rep.page.url}${rep.page.title ? ` (${rep.page.title})` : ""}`);
      lines.push(`   nota do dono: "${rep.nota}"`);
      if (rep.prompt) lines.push(`   prompt: "${rep.prompt}"`);
      for (const e of (rep.elements || [])) {
        lines.push(`   elemento: ${e.selector} [tag=${e.tag || "?"} role=${e.role || "-"} testid=${e.testid || "-"}]`);
        if (e.text) lines.push(`      texto: "${e.text}"`);
        if (e.rect) lines.push(`      rect: ${e.rect.w}×${e.rect.h} @ ${e.rect.x},${e.rect.y}`);
        if (e.html) lines.push(`      html: ${String(e.html).slice(0, full ? 2000 : 400)}`);
      }
      if (rep.resolucao && rep.resolucao.proof) lines.push(`   resolução: ${rep.resolucao.proof} (${rep.resolucao.por}, ${rep.resolucao.em})`);
      lines.push("");
    }
    lines.push(`→ fluxo: ataque um a um; ao iniciar cada um: n_elemreports_resolve {id:"<id>", status:"em_resolução"} · ao terminar: n_elemreports_resolve {id:"<id>", proof:"antes→depois: o que mudou e onde"}. Resolvido some do highlight da página e vira histórico.`);
    return out(lines.join("\n"));
  },
});

reg("n_elemreports_resolve", {
  description: "Move UM report de elemento no ciclo de vida com PROVA: \"em_resolução\" (trabalho iniciado) ou \"resolvido\" (default; exige proof = antes/depois) — resolvido some do highlight na página (a extensão re-synca sozinha) e vira histórico, nunca apaga. Reabrir: status:\"aberto\". Use depois de n_elemreports_list; marque resolvido SÓ com a correção verificada na página.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "id do report (er…) de n_elemreports_list" },
      status: { type: "string", enum: ER_STATUSES, default: "resolvido", description: "estado de destino" },
      proof: { type: "string", description: "OBRIGATÓRIO p/ resolvido: antes/depois (o que mudou, onde — arquivo:linha/commit/print). ≥10 chars." },
      por: { type: "string", description: "quem resolveu (default: agente)" },
    },
    required: ["id"],
  },
  run: async ({ id, status, proof, por }) => {
    const r = erSetStatus({ id, status, proof, por });
    if (!r.ok) return out(`${r.error}`, true);
    const rep = r.report;
    const shotNote = rep.shot ? ` · screenshot ${rep.shot}` : "";
    if (rep.status === "resolvido") return out(`report ${rep.id} RESOLVIDO — some do highlight e vira histórico${shotNote}. prova: "${String(rep.resolucao?.proof || "").slice(0, 300)}". Se a página ainda mostra o contorno, a extensão re-synca sozinha em ≤60s (ou n_ubrowser_act {action:"elem_pick", off:true} + recarregue).`);
    if (rep.status === "em_resolução") return out(`report ${rep.id} em resolução — termine e marque resolvido com prova (antes/depois). ${erOneLine(rep)}`);
    return out(`report ${rep.id} reaberto — volte ao trabalho e resolva com prova. ${erOneLine(rep)}`);
  },
});
