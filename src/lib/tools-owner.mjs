// canivete — tools do navegador LOGADO do dono (ubrowser_*)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sleep } from "../core/retry.mjs";
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubStats, ubAlertsPending, ubAlertsRead, ubAlertsList, ubAlertsHint, ubResolveProfile, ubListExtensions, UB_TIMEOUT_MS } from "./ubridge.mjs";
import { ownerCdpSend } from "./cdp.mjs";
import { snapLabel as ubSnapLabel, snapRole as ubSnapRole, snapHasBox as ubSnapHasBox, snapInViewport as ubSnapInViewport, snapIsEditable as ubSnapIsEditable, snapBytes as ubSnapBytes, snapFoldKey as ubSnapFoldKey, snapFold as ubSnapFold, snapDedupLinks as ubSnapDedupLinks, ubOverviewSlim } from "../core/snapshot.mjs";
// recovery sem mudar protocolo: só texto de erro acionável (janela NORMAL, popup, token) + fallback headless
const UB_REC = "Recovery: 0) sem Chrome? cv_ubrowser_status {open:true} abre sozinho (qualquer perfil) 1) Chrome janela NORMAL mesmo perfil (sem anonimo) 2) popup extensao UBrowser ATIVO 3) token ~/.config/canivete/token.txt igual na extensao 4) rode cv_ubrowser_status p/ confirmar";
const UB_FB = "Sem login? fallback headless: cv_browser_navigate / cv_browser_screenshot";
const UB_OFF_FULL = `${UB_OFF} | ${UB_REC} | ${UB_FB}`;
// timeout de transporte ÚNICO (const UB_TIMEOUT_MS do ubridge): mensagem mostra o valor REAL
// (env CANIVETE_UB_TIMEOUT, piso 1s teto 300s) — antes dizia "60s" fixo mesmo com env mudado.
const ubTimeoutMsg = (ms = UB_TIMEOUT_MS) => `timeout ${Math.round(ms / 1000)}s — extensao nao respondeu: tente de novo ou cheque cv_ubrowser_status`;

// ---- Abrir o Chrome do dono SOZINHO (doutrina: agente pode lançar em qualquer perfil) ----
// EXTENSAO_OFFLINE não é mais beco: cv_ubrowser_status {open:true} resolve o display com WM
// (console real primeiro — CRD :20 não tem WM), limpa Singleton de crash e lança o Chrome
// (renderer-limit 3 do dono + restore-last-session) no perfil pedido, esperando a ponte (poll
// com teto — sleep cego é proibido). Perfil precisa ter a extensão UBrowser carregada.
const UB_CHROME_DIR = process.env.CANIVETE_UB_CHROME_DIR || join(homedir(), ".config", "google-chrome");
const UB_CHROME_BIN = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p)) || "google-chrome";
const UB_PROC_CMD = (pid) => { try { return readFileSync(join("/proc", String(pid), "cmdline"), "utf8").replace(/\0/g, " "); } catch { return ""; } };
const UB_OWNER_PIDS = () => {
  const pids = [];
  try {
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      const cmd = UB_PROC_CMD(d);
      // Chrome do DONO: processo principal sem --type=; exclui headless do canivete (outro perfil) e crashpad
      if (!/google-chrome|chromium/.test(cmd) || cmd.includes("--type=") || cmd.includes("--headless") || cmd.includes("canivete-chrome-profile") || cmd.includes("crashpad")) continue;
      pids.push({ pid: Number(d), cmd: cmd.trim().slice(0, 100) });
    }
  } catch {}
  return pids;
};
function ubResolveDisplay() {
  const cands = [];
  if (process.env.DISPLAY) cands.push({ display: process.env.DISPLAY, auth: process.env.XAUTHORITY || "" });
  if (process.env.CANIVETE_UB_DISPLAY) cands.push({ display: process.env.CANIVETE_UB_DISPLAY, auth: process.env.CANIVETE_UB_XAUTH || "" });
  try { // X servers vivos: console real (-seat/vt) primeiro; virtual do chrome-remote-desktop por último
    const xs = [];
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      const m = UB_PROC_CMD(d).match(/(?:^|\/)(?:Xorg|Xvnc|Xvfb)\s+:(\d+)/);
      if (m) xs.push({ display: `:${m[1]}`, console: /-seat\s|vt\d+/.test(UB_PROC_CMD(d)) });
    }
    xs.sort((a, b) => (b.console ? 1 : 0) - (a.console ? 1 : 0));
    for (const x of xs) for (const auth of [process.env.XAUTHORITY || "", `/var/run/lightdm/root/${x.display}`, join(homedir(), ".Xauthority")]) {
      if (!cands.some((c) => c.display === x.display && c.auth === auth)) cands.push({ display: x.display, auth });
    }
  } catch {}
  for (const c of cands) {
    try { // exit 0 do wmctrl = display com gerenciador de janelas = mesa do dono (CRD :20 falha)
      if (spawnSync("wmctrl", ["-l"], { env: { ...process.env, DISPLAY: c.display, ...(c.auth ? { XAUTHORITY: c.auth } : {}) }, timeout: 3000 }).status === 0) return c;
    } catch {}
  }
  return cands[0] || { display: ":0", auth: "" };
}
function ubProfileNames() { // dir → rótulo humano (Local State > profile.info_cache) — report rmvzvi0hy
  try {
    const ls = JSON.parse(readFileSync(join(UB_CHROME_DIR, "Local State"), "utf8"));
    const ic = ls && ls.profile && ls.profile.info_cache;
    const m = {};
    if (ic && typeof ic === "object") for (const [d, v] of Object.entries(ic)) m[d] = String((v && v.name) || "").trim();
    return m;
  } catch { return {}; }
}
const ubConnectedLabels = () => { // rótulos dos perfis conectados agora (p/ saber SE o pedido é o conectado)
  try {
    const st = ubStats();
    const exts = Array.isArray(st.extensions) ? st.extensions : [];
    return exts.filter((e) => e.connected).map((e) => String(e.profileLabel || "").trim()).filter(Boolean);
  } catch { return []; }
};
const UB_LABELS_FILE = () => join(process.env.CANIVETE_CONFIG_DIR || join(homedir(), ".config", "canivete"), "ub-profile-labels.json");
function ubLabelMap() { // rótulo do popup → dir, aprendido em wake (popup label não vive no Local State)
  try { return JSON.parse(readFileSync(UB_LABELS_FILE(), "utf8")) || {}; } catch { return {}; }
}
function ubSaveLabel(label, dir) {
  try {
    const m = ubLabelMap();
    if (m[label] !== dir) { m[label] = dir; writeFileSync(UB_LABELS_FILE(), JSON.stringify(m, null, 2) + "\n"); }
  } catch {}
}
function ubNormProfile(p) {
  if (!p) return "Default";
  const s = String(p).trim();
  let dirs = [];
  try { dirs = readdirSync(UB_CHROME_DIR).filter((d) => d === "Default" || /^Profile/.test(d)); } catch {}
  if (!dirs.length) return "Default";
  const norm = (x) => x.toLowerCase().replace(/[\s_-]/g, "");
  const nomes = ubProfileNames();
  const m = ubLabelMap();
  return dirs.find((d) => norm(d) === norm(s)) || (/^\d+$/.test(s) ? dirs.find((d) => d === `Profile ${s}`) : null) || dirs.find((d) => nomes[d] && norm(nomes[d]) === norm(s)) || Object.entries(m).find(([l, d]) => dirs.includes(d) && norm(l) === norm(s))?.[1] || null;
}
async function ubOpenAndWait(profileDir, waitMs, wake = false, checkOk = null) { // checkOk: esperar O PERFIL pedido, não "qualquer conexão" (report rmvzvlp3r)
  const disp = ubResolveDisplay();
  if (wake) { // Chrome vivo mas OUTRO perfil conectado (report rmvzvlp3r): janela nova do perfil pedido acorda o SW da extensão dele
    const env = { ...process.env, DISPLAY: disp.display, ...(disp.auth ? { XAUTHORITY: disp.auth } : {}) };
    spawn(UB_CHROME_BIN, [`--profile-directory=${profileDir}`], { detached: true, stdio: "ignore", env }).unref();
  } else if (!UB_OWNER_PIDS().length) { // sem Chrome vivo: Singleton de crash atrapalha o boot limpo
    for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) { try { unlinkSync(join(UB_CHROME_DIR, f)); } catch {} }
    const env = { ...process.env, DISPLAY: disp.display, ...(disp.auth ? { XAUTHORITY: disp.auth } : {}), ...(process.env.DBUS_SESSION_BUS_ADDRESS ? {} : { DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus` }) };
    spawn(UB_CHROME_BIN, ["--renderer-process-limit=3", "--restore-last-session", `--profile-directory=${profileDir}`], { detached: true, stdio: "ignore", env }).unref();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { // poll com teto (sleep cego proibido)
    ubEnsure();
    if (checkOk ? checkOk() : ubConnected()) return { ok: true, ms: Date.now() - t0, display: disp.display, wake };
    await sleep(700);
  }
  return { ok: false, ms: Date.now() - t0, display: disp.display, wake };
}

// Roteamento por perfil: SE o caller pediu `profile` e ele não casa com nenhuma extensão,
// NÃO roteia em silêncio p/ "qualquer" (comando no perfil ERRADO é pior que erro) —
// devolve erro acionável listando os conectados (clientId/label/idade do último poll).
// Sem profile = comportamento de sempre (broadcast p/ o mais recente).
// plural sem "(s)": summaries legíveis e menores ("1 perfil conectado" / "2 perfis conectados").
function ubPlural(n, one, many) {
  const v = Number(n) || 0;
  return `${v} ${v === 1 ? one : many}`;
}
function ubTarget(profile) {
  if (!profile) return { ok: true, id: null };
  const id = ubResolveProfile(profile);
  if (id) return { ok: true, id };
  const exts = ubListExtensions();
  if (!exts.length) return { ok: false, summary: `profile "${String(profile).slice(0, 60)}" não conectado — NENHUMA extensão conectada | ${UB_OFF_FULL}` };
  const list = exts.map((e) => `${e.id}${e.profileLabel ? ` (${e.profileLabel})` : ""} — último poll há ${Math.round(Math.max(0, e.lastPollAgoMs) / 1000)}s${e.connected ? "" : " (DESCONECTADO)"}`).join("; ");
  return { ok: false, summary: `profile "${String(profile).slice(0, 60)}" não corresponde a NENHUMA extensão — conectados: ${list} | use clientId exato (cv_ubrowser_status → extensions[].id), trecho de URL/label, ou omita profile p/ o mais recente | ${UB_FB}` };
}

reg("cv_ubrowser_status", {
  description: "Status da ponte com o Chrome LOGADO do dono (extensão local). SEMPRE o passo 1: offline → open:true (o agente ABRE o Chrome sozinho, em qualquer perfil — sem refém do dono). Fluxo: status→tabs→read|snapshot→act→shot. IDs de aba mudam — nas tools prefira tab:\"trecho do título/URL\".",
  inputSchema: { type: "object", properties: { open: { type: "boolean", description: "ponte offline? abre o Chrome do dono sozinho (display com WM detectado, perfil abaixo) e espera a ponte conectar (teto 25s)" }, profile: { type: "string", description: "com open: perfil do Chrome — \"Default\", \"Profile 1\"…, só o número (1, 2…) ou o RÓTULO do perfil (nome em Local State, ex: \"Financia\"); o perfil precisa ter a extensão UBrowser carregada" }, wait: { type: "number", description: "teto de espera pós-launch em ms (default 25000, teto 60000)" } }, required: [] },
  run: async ({ open, profile, wait } = {}) => {
    const t0 = Date.now();
    ubEnsure();
    let c = ubConnected();
    let launchNote = "";
    if (open) { // open:true SEMPRE mira o perfil pedido — ponte conectada a OUTRO perfil não é "ok" (report rmvzvlp3r)
      const pdir = ubNormProfile(profile);
      const nomes = ubProfileNames();
      if (!pdir) {
        let dirs = [];
        try { dirs = readdirSync(UB_CHROME_DIR).filter((d) => d === "Default" || /^Profile/.test(d)); } catch {}
        const rot = dirs.map((d) => (nomes[d] ? `${d} (${nomes[d]})` : d)).join(", ");
        return devOut({ status: "error", summary: `perfil "${profile}" não existe em ${UB_CHROME_DIR} — disponíveis: ${rot || "nenhum (Chrome nunca rodou?)"}`, data: { open: true, profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
      }
      const rotulo = nomes[pdir] ? ` (${nomes[pdir]})` : "";
      const normL = (x) => String(x).toLowerCase().replace(/[\s_-]/g, "");
      const quero = [pdir, nomes[pdir]].filter(Boolean).map(normL);
      const mLabels = ubLabelMap();
      const casado = (ls) => ls.some((l) => quero.includes(normL(l)) || mLabels[l] === pdir); // rótulo do popup aprendido também casa (report rmvzvlp3r)
      const antes = new Set(ubConnectedLabels().map(normL));
      if (c && casado(ubConnectedLabels())) launchNote = ` · open ok — perfil ${pdir}${rotulo} já conectado`;
      else {
        const wake = !!c && !casado([...antes]); // Chrome vivo mas perfil pedido não é o conectado
        const r = await ubOpenAndWait(pdir, Math.min(Number(wait) || 25000, 60000), wake, () => {
          const ls = ubConnectedLabels();
          return ubConnected() && (casado(ls) || ls.some((l) => !antes.has(normL(l)))); // match OU conexão NOVA surgida no nosso wait (é o perfil pedido)
        });
        c = ubConnected();
        const ls = ubConnectedLabels();
        const novo = ls.find((l) => !antes.has(normL(l))) || null; // conexão que SÓ pode ser o perfil que acordamos
        if (wake && novo && !casado(ls)) ubSaveLabel(novo, pdir); // aprende rótulo-do-popup → dir (próximas chamadas por rótulo)
        if (!c || (!casado(ls) && !(wake && novo))) return devOut({ status: "error", summary: `perfil ${pdir}${rotulo} não conectou em ${Math.round(r.ms / 1000)}s (ponte: ${ls.join(", ") || "offline"}) — o perfil tem a extensão UBrowser carregada? ${UB_REC}`, data: { open: true, display: r.display, profile: pdir, connected: c, connectedProfiles: ls }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_status", reason: "Re-checar: SW da extensão pode acordar 1 ciclo depois" }] });
        launchNote = r.wake ? ` · perfil ${pdir}${rotulo} acordado pelo agente (${r.display})${novo && !casado(ls) ? ` — conectou com o rótulo "${novo}" do popup (aprendido)` : ""} — ponte em ${r.ms}ms` : ` · Chrome aberto pelo agente (${r.display}, ${pdir}) — ponte em ${r.ms}ms`;
      }
    }
    const st = ubStats();
    const exts = Array.isArray(st.extensions) ? st.extensions : [];
    const conns = exts.filter((e) => e.connected);
    const newest = conns.slice().sort((a, b) => (a.lastPollAgoMs || 0) - (b.lastPollAgoMs || 0))[0] || null;
    const version = newest?.info?.bg ? String(newest.info.bg) : undefined;
    const noLabel = conns.length > 0 && conns.every((e) => !e.profileLabel);
    const noInfo = conns.length > 0 && conns.every((e) => !e.info);
    const oldVer = conns.map((e) => (e.info?.bg ? String(e.info.bg) : "")).find((v) => v && ubVerLt(v, UB_VER_ACT));
    // dicas de roteamento: cada uma existe p/ evitar erro depois (profile errado, activate antigo)
    const hints = [];
    if (oldVer) hints.push(`extensão rodando ${oldVer} (< ${UB_VER_ACT}) — tab.activate indisponível: {action:"reload-extension"} aplica o código novo, depois re-status (data.version)`);
    if (conns.length > 1) hints.push(`${conns.length} perfis conectados — alvo por profile:"<clientId>" (extensions[].id), trecho de label/URL; omitir = ext mais recente`);
    if (noInfo) hints.push("hello do perfil ausente após restart (label/versão/tabs) — {action:\"reload-extension\"} reenvia sem fechar abas");
    else if (noLabel) hints.push("profileLabel ausente — configure o nome do perfil no popup da extensão p/ alvo por nome legível");
    // status enxuto: o info cru da extensão (UA/tabUrls/accessMode…) duplicava dados e inflava
    // a resposta em ~3x. Fica o que decide roteamento/versão; o resto vive em cv_owner_alerts/act.
    const slimExts = exts.map((e) => ({ id: e.id, ...(e.profileLabel ? { label: e.profileLabel } : {}), connected: !!e.connected, lastPollAgoMs: e.lastPollAgoMs, queued: e.queued, ...(e.info?.bg ? { version: String(e.info.bg) } : {}), ...(e.info?.tabs != null ? { tabs: e.info.tabs } : {}) }));
    return devOut({ status: c ? "success" : "error", summary: c ? `UBrowser pronto — ${ubPlural(conns.length, "perfil conectado", "perfis conectados")}${launchNote}` : `EXTENSÃO OFFLINE — abra sozinho: cv_ubrowser_status {open:true} (Chrome em qualquer perfil) | dono: janela NORMAL + popup ATIVO`, data: { connected: c, ...(version ? { version } : {}), ...(hints.length ? { hint: hints.join(" | ") } : {}), extensions: slimExts, bridge: { port: st.port, ...(st.queued ? { queued: st.queued } : {}), ...(st.pending ? { pending: st.pending } : {}), ...(conns.length ? {} : { lastPollAgoMs: st.lastPollAgoMs }), ...(st.expiredDropped ? { expiredDropped: st.expiredDropped } : {}) } }, telemetry: { execution_time_ms: Date.now() - t0 }, next: !c ? [{ tool: "cv_ubrowser_status", reason: "Re-checar com open:true — o agente abre o Chrome sozinho" }] : [] });
  },
});

// vigia de avisos: drena o ring de erros de console/rede empurrados pela extensão (/ubpush)
// — o piggyback 📬 nas respostas aponta pra cá. since = ISO ou ms; drain marca lido.
reg("cv_ubrowser_alerts", {
  description: "AVISOS do Chrome do dono (vigia): erros de console/rede que a extensão empurrou desde a última leitura (ring 30, persistido no painel). Chame quando vir o hint 📬 ou periodicamente após agir numa aba; since=ISO/ms traz só o novo. Não toca no Chrome — só lê o buffer da ponte. Console COMPLETO da aba: cv_ubrowser_act {action:\"console\"}.",
  inputSchema: { type: "object", properties: { since: { type: "string", description: "só alertas a partir de: ISO (\"2026-11-15T10:00:00Z\") ou epoch ms — p/ drenar apenas o novo entre duas leituras" } }, required: [] },
  run: async ({ since } = {}) => {
    const t0 = Date.now();
    const list = ubAlertsList(since);
    if (!list.length) return devOut({ summary: `sem alertas${since ? " desde " + String(since) : " desde o boot do daemon"} — aba(s) sem erros de console/rede empurrados`, data: { drained: true }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const err = list.filter((a) => a.kind !== "net").length, net = list.length - err;
    return devOut({ summary: `${ubPlural(list.length, "alerta", "alertas")}${since ? " desde " + String(since) : ""} (${err} console · ${net} rede) — mais novo: ${list[list.length - 1].text.slice(0, 90)}`, data: { alerts: list, drained: true }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_read", reason: "Ver a aba que errou (tab = trecho do url dos alertas)" }] });
  },
});

reg("cv_ubrowser_tabs", {
  description: "Leitura: lista até 30 abas (filtro por título/URL) do Chrome. profile limita a um perfil; sem ele, consolida perfis conectados. Use offset para paginar. Não ativa abas nem muda o foco.",
  inputSchema: { type: "object", properties: { filter: { type: "string", description: "substring em título+url (case-insensitive)" }, max: { type: "number", default: 30, description: "abas nesta página (default 30)" }, offset: { type: "number", default: 0, description: "posição inicial para paginação" }, profile: { type: "string", description: "clientId de um perfil conectado; omitir consolida os perfis" } }, required: [] },
  run: async ({ filter, max = 30, offset = 0, profile } = {}) => {
    const t0 = Date.now();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // Fetch the complete matching set so pagination remains global across profiles.
    const args = filter ? { filter } : {};
    const res = await ubTabsFetch(args, tgt, UB_TIMEOUT_MS);
    const isBad = (r) => r && (r.__offline || r.__timeout);
    if (res.multi) {
      const goods = [], bads = [];
      res.all.forEach((r, i) => (isBad(r) ? bads.push({ e: res.exts[i], r }) : goods.push({ e: res.exts[i], r })));
      if (!goods.length) return devOut({ status: "error", summary: res.all[0].__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const tabs = [];
      const profiles = goods.map(({ e, r }) => {
        const d = r.data || {};
        const ta = Array.isArray(d.tabs) ? d.tabs : Array.isArray(d) ? d : [];
        const ws = Array.isArray(d.windows) ? d.windows : [];
        for (const t of ta) tabs.push(ubTabsSlim(t, ubProfTag(e)));
        return { id: e.id, ...(e.profileLabel ? { label: e.profileLabel } : {}), windows: ws.length, tabs: ta.length };
      });
      for (const b of bads) profiles.push({ id: b.e.id, ...(b.e.profileLabel ? { label: b.e.profileLabel } : {}), error: b.r.__offline ? "offline" : "timeout" });
      const f = ubTabsFilterMax(tabs, filter, max, offset);
      const c = ubTabsCompact(f.tabs, { singleProfile: goods.length <= 1 });
      const omitNote = f.omitted ? ` (${f.omitted} restantes; offset=${offset + f.tabs.length} para continuar)` : "";
      const badNote = bads.length ? ` (${bads.length} perfil sem resposta: ${bads.map((b) => b.e.profileLabel || b.e.id).join(", ")})` : "";
      return devOut({ summary: `${ubPlural(f.tabs.length, "aba", "abas")} em ${ubPlural(profiles.length, "perfil", "perfis")}${omitNote}${badNote}`, data: { tabs: c.tabs, ...c.hoist, profiles, total: f.total, offset, ...(f.omitted ? { omitted: f.omitted, nextOffset: offset + f.tabs.length } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const r = res.single;
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tabs = r.data.tabs || r.data || [];
    const wins = r.data.windows || [];
    const ext0 = res.exts[0] || null;
    const slim = (Array.isArray(tabs) ? tabs : []).map((t) => ubTabsSlim(t, ubProfTag(ext0)));
    const f = ubTabsFilterMax(slim, filter, max, offset);
    const c = ubTabsCompact(f.tabs, { singleProfile: true });
    const omitNote = f.omitted ? ` (${f.omitted} restantes; offset=${offset + f.tabs.length} para continuar)` : "";
    return devOut({ summary: `${ubPlural(f.tabs.length, "aba", "abas")} em ${wins.length ? ubPlural(wins.length, "janela", "janelas") : "? janelas"}${omitNote}`, data: { tabs: c.tabs, ...c.hoist, profiles: ext0 ? [{ id: ext0.id, ...(ext0.profileLabel ? { label: ext0.profileLabel } : {}), windows: wins.length, tabs: (Array.isArray(tabs) ? tabs : []).length }] : [], total: f.total, offset, ...(f.omitted ? { omitted: f.omitted, nextOffset: offset + f.tabs.length } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

reg("cv_ubrowser_overview", {
  description: "Mapa compacto da aba: estrutura, títulos, formulários e controles com seletores prontos para agir. Reduz chamadas de reconhecimento; use snapshot/read só para aprofundar a região. detail=\"compact\" (padrão) corta campos redundantes (~60% menos tokens); detail=\"full\" traz o payload cru.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL" }, max: { type: "number", default: 35, description: "quantidade de controles por página" }, offset: { type: "number", default: 0, description: "paginação de controles (use nextOffset)" }, order: { type: "string", enum: ["action", "dom"], default: "action", description: "action=campos/botões antes de links (default); dom=ordem da página" }, detail: { type: "string", enum: ["compact", "full"], default: "compact", description: "compact=corta campos redundantes (default); full=payload cru" }, headingsMax: { type: "number", default: 30, description: "máximo de títulos no compact (default 30; use full p/ todos)" }, profile: { type: "string" } }, required: [] },
  run: async ({ tabId, tab, max = 35, offset = 0, order = "action", detail = "compact", headingsMax = 30, profile } = {}) => {
    const t0 = Date.now(), tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tBridge = Date.now();
    const r = await ubSend("tab.overview", { tabId, tab, max, offset, order }, UB_TIMEOUT_MS, tgt.id);
    const bridgeMs = Date.now() - tBridge;
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = ubOverviewSlim(r.data || {}, { detail, headingsMax });
    const hOmit = d.headingsOmitted ? ` (+${d.headingsOmitted} títulos omitidos)` : "";
    const nextNote = d.nextOffset != null ? ` (mais: offset=${d.nextOffset})` : "";
    return devOut({ summary: `${d.page?.title || "Página"}: ${d.controls?.length || 0}/${d.controlsTotal || 0} controles · ${d.headings?.length || 0} títulos${hOmit} · ${ubPlural(d.forms?.length || 0, "formulário", "formulários")}${nextNote}${detail === "compact" ? "" : " [full]"}`, data: d, telemetry: { execution_time_ms: Date.now() - t0, bridge_ms: bridgeMs } });
  },
});

reg("cv_ubrowser_read", {
  description: "Lê aba do dono COM login (texto+links). Mire com tab:\"trecho\" ou tabId. Página pública (sem login)? NÃO use este — cv_webfetch (estática) ou cv_browser_navigate (JS); não gasta a aba do dono. mode=distill (default, enxuto) | raw (integral + links). outline=true: só estrutura (h1-h6 + contagens) p/ triagem. maxChars/maxLinks dão teto. AUTOMÁTICO: espera a página aquietar (SPA), perfura shadow DOM, inputs mostram value separado (`[campo text Nome] = \"João\"`). Pra JS use evaluate no act; pra erros/rede use act console. selector=\"CSS\" escopa a leitura a um container (#app, table, ...); texto curto em página grande ganha WARN no summary (tente mode:\"raw\" ou snapshot).",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 }, mode: { type: "string", enum: ["distill", "raw"], default: "distill", description: "distill=destilado enxuto (default); raw=texto integral opt-out" }, outline: { type: "boolean", description: "outline=true: só estrutura (h1-h6 + contagens) p/ triagem rápida" }, settle: { type: "boolean", description: "auto (padrão): pula espera em página completa; true força settle p/ SPA que ainda hidrata" }, selector: { type: "string", description: "CSS p/ escopar a leitura a um container (ex: \"#app\", \"table.turmas\") — erro \"seletor não encontrado\" se não achar" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — obrigatório quando a aba é de outro perfil (tabs traz profile)" } }, required: [] },
  run: async ({ tabId, tab, mode, maxChars, maxLinks, outline, settle, selector, profile }) => {
    const t0 = Date.now();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // outline=true: força mode raw — o background intercepta distill e ignora o outline
    // (devolvia 4KB de texto em vez de estrutura). Content lê a.outline e responde só headings.
    const effMode = outline ? "raw" : (mode || "distill");
    const tBridge = Date.now();
    const r = await ubSend("tab.read", { tabId, tab, mode: effMode, maxChars, maxLinks, ...(outline ? { outline: true } : {}), ...(settle !== undefined ? { settle } : {}), ...(selector ? { selector } : {}) }, UB_TIMEOUT_MS, tgt.id);
    const bridgeMs = Date.now() - tBridge;
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}${ubErrHint(r.error) || ""} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const body = r.data.markdown || r.data.text || "";
    const allLinks = r.data.links || [];
    const links = allLinks.slice(0, 15);
    const omitted = allLinks.length > links.length ? allLinks.length - links.length : 0;
    const omitNote = omitted ? ` (+${omitted} links omitidos)` : "";
    const warnNote = r.data.warn ? ` | ${r.data.warn}` : "";
    const kindNote = outline ? `outline ${r.data.stats?.chars ?? body.length} chars` : (r.data.markdown ? `destilado ${r.data.stats?.chars ?? body.length} chars` : "");
    // "mapear cliques" é o óbvio da descrição; só orienta quando há links truncados.
    const nxt = omitted > 0 ? [{ tool: "cv_ubrowser_read", reason: "mode:\"raw\" traz o texto integral e links completos" }] : [];
    // stats: ms/total_ms são ruído (bridge_ms já cobre); chars/linhas/descartadas dizem a qualidade.
    const st = r.data.stats && typeof r.data.stats === "object"
      ? { chars: r.data.stats.chars, linhas: r.data.stats.linhas, descartadas: r.data.stats.descartadas, ...(r.data.stats.settle_ms ? { settle_ms: r.data.stats.settle_ms } : {}) }
      : undefined;
    return devOut({ summary: `${r.data.title} — ${r.data.url}${kindNote ? ` (${kindNote})` : ""}${omitNote}${warnNote}${ubAlertsHint()}`, data: { title: r.data.title, url: r.data.url, text: trimOut(body, outline ? 3000 : 6000), ...(links.length ? { links } : {}), ...(omitted ? { linksOmitted: omitted } : {}), ...(r.data.warn ? { warn: r.data.warn } : {}), ...(st ? { stats: st } : {}), ...(outline ? { outline: true } : {}) }, telemetry: { execution_time_ms: Date.now() - t0, bridge_ms: bridgeMs }, next: nxt });
  },
});

// UB_SNAP_PURE_START — lógica pura do cv_ubrowser_snapshot (rank/junk/auto-compact-por-campos). Sem I/O: testável via node -e sem extensão.
// Rank: viewport → nome → papel (editáveis por último, como antes). Junk: sem nome descartado com `omitted`. Auto-compact: corta CAMPOS por nível, nunca elementos.
// Fold: runs ≥6 consecutivos com mesmo role+head viram 1 marcador com refs preservadas (mcprune-style).
// DedupLinks: mesmo (texto+href) mantém o primeiro.
const UB_SNAP_ROLE_SCORE = { button: 3, link: 3, textbox: 3, combobox: 3, checkbox: 3, radio: 3, switch: 3, slider: 3, searchbox: 3, spinbutton: 2, menuitem: 2, menuitemcheckbox: 2, menuitemradio: 2, tab: 2, option: 1, listitem: 1, row: 1, heading: 0, img: -2, generic: -2, "": -2 };
const UB_SNAP_KEEP_NAMELESS = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "slider", "searchbox", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option"]);
const UB_SNAP_BYTE_BUDGET = 12000; // ~3k tokens: acima disso corta CAMPOS (nunca elementos — contagem intacta)
// Primitivos puros (label/role/box/viewport/editable/bytes/fold/dedup): ver core/snapshot.mjs — fonte única.
// Mantidos aqui: junk/score/rank/auto-compact (regras específicas do ubrowser: layer boost, editáveis por último).
function ubSnapIsJunk(el) {
  if (!el || typeof el !== "object") return true;
  if (ubSnapLabel(el)) return false; // com nome/texto nunca é junk
  if (String(el.type || "").toLowerCase() === "hidden") return true; // input hidden
  if (typeof el.layer === "string" && el.layer) return false; // v11: em overlay (modal/menu/popover) nunca é junk — o LLM precisa ver a camada
  if (!ubSnapHasBox(el)) return true; // invisível e sem nome
  if (!UB_SNAP_KEEP_NAMELESS.has(ubSnapRole(el))) return true; // genérico/heading/img sem nome
  return false; // botão/link/campo visível sem nome: mantém (acionável via selector)
}
function ubSnapScore(el) {
  let s = 0;
  if (ubSnapInViewport(el)) s += (Number(el?.y) || 0) >= 0 ? 2 : 1; // viewport primeiro
  else s -= 3;
  s += ubSnapLabel(el) ? 2 : -2; // com nome primeiro
  s += UB_SNAP_ROLE_SCORE[ubSnapRole(el)] ?? 0; // papel: ação > leitura > genérico
  try { if (el && el.layer === "modal") s += 2; else if (el && el.layer) s += 1; } catch {} // v11: camada de overlay primeiro (modal bloqueia a página)
  if (ubSnapIsEditable(el)) s -= 5; // editáveis por último (comportamento histórico)
  if (String(el?.state || "").includes("disabled")) s -= 2;
  return s;
}
function ubSnapRank(els) {
  return [...els]
    .map((el, i) => ({ el, i, s: ubSnapScore(el) }))
    .sort((a, b) => (b.s - a.s) || ((a.el?.y || 0) - (b.el?.y || 0)) || ((a.el?.x || 0) - (b.el?.x || 0)) || (a.i - b.i))
    .map((r) => r.el);
}
// auto-compact-por-campos: N1 path/state/level/type/href → N2 x/y/w/h (layout; cursor re-mede via selector) → N3 name/text 60→40 → N4 shape compact+selector (ação intacta). depth e layer/layerLabel NUNCA caem — hierarquia e camada p/ o LLM. Contagem SEMPRE intacta.
function ubSnapAutoCompactFields(els, budget = UB_SNAP_BYTE_BUDGET) {
  const bytes0 = ubSnapBytes(els);
  if (bytes0 <= budget) return { elements: els, autoCompact: false, dropped: [], bytes: bytes0 };
  const drop = (o, ks) => { const c = { ...o }; for (const k of ks) delete c[k]; return c; };
  let out = els.map((el) => drop(el, ["path", "state", "level", "type", "href"]));
  let dropped = ["path", "state", "level", "type", "href"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => drop(el, ["x", "y", "w", "h"]));
  dropped = [...dropped, "x", "y", "w", "h"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => ({ ...el, ...(el.name ? { name: String(el.name).slice(0, 40) } : {}), ...(el.text ? { text: String(el.text).slice(0, 40) } : {}) }));
  dropped = [...dropped, "text>40", "name>40"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map(({ ref, tag, text, role, name, selector, depth, layer, layerLabel, folded, foldRefs }) => ({ ref, tag, text, role, ...(name ? { name } : {}), ...(selector ? { selector } : {}), ...(depth ? { depth } : {}), ...(layer ? { layer, ...(layerLabel ? { layerLabel } : {}) } : {}), ...(folded ? { folded, foldRefs } : {}) }));
  dropped = [...dropped, "shape=compact+selector"];
  return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
}
// UB_SNAP_PURE_END

// Cache ref→selector (#48: click por ref). Chave = tabId ?? tab ?? "active".
// Refs morrem na navegação — sem detector barato, miss vira erro acionável (re-snapshot).
const UB_SNAP_CACHE = new Map();
function ubSnapCacheKey({ tabId, tab }) {
  if (tabId !== undefined && tabId !== null && String(tabId) !== "") return `id:${tabId}`;
  if (tab) return `tab:${String(tab).toLowerCase()}`;
  return "active";
}
function ubSnapCacheStore(key, elements) {
  try {
    UB_SNAP_CACHE.set(key, (Array.isArray(elements) ? elements : []).map((el) => ({ ref: el.ref, selector: el.selector })).filter((e) => e.ref !== undefined && e.selector));
    if (UB_SNAP_CACHE.size > 5) UB_SNAP_CACHE.delete(UB_SNAP_CACHE.keys().next().value);
  } catch {}
}
function ubSnapCacheResolve(key, ref) {
  const box = UB_SNAP_CACHE.get(key);
  if (!box) return { ok: false, error: `sem snapshot em cache p/ esta aba — rode cv_ubrowser_snapshot antes de usar ref` };
  const hit = box.find((e) => String(e.ref) === String(ref));
  if (!hit) return { ok: false, error: `ref ${ref} expirada (snapshot mudou/navegou) — re-snapshot e use a ref nova` };
  return { ok: true, selector: hit.selector };
}

// UB_OWNER_PURE_START — puros do tools-owner (tabs filter/max, retry do evaluate,
// undefined-vs-null, remontagem chunked, chave do shot). Sem I/O: testáveis via node.
function ubTabsFilterMax(tabs, filter, max, offset = 0) {
  try {
    const list = Array.isArray(tabs) ? tabs : [];
    const needle = String(filter || "").trim().toLowerCase();
    const cap = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : Infinity;
    const kept = needle
      ? list.filter((t) => { try { return (((t.title || "") + " " + (t.url || "")).toLowerCase().includes(needle)); } catch { return false; } })
      : list.slice();
    const start = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
    const page = kept.slice(start, start + cap);
    const omitted = Math.max(kept.length - start - page.length, 0);
    return { tabs: page, omitted, total: kept.length, offset: start };
  } catch { return { tabs: Array.isArray(tabs) ? tabs.slice(0, 50) : [], omitted: 0 }; }
}
// Retry do evaluate: vale a VERDADE MAIS NOVA — adota r2 seja ok ou erro;
// pendings (__timeout/__offline, sem resposta) mantêm o comportamento antigo.
function ubEvalPickRetry(r, r2) {
  try {
    if (r2 && (("ok" in r2) || r2.__timeout || r2.__offline)) return r2;
    return r;
  } catch { return r; }
}
// undefined-vs-null: "undefined" = rodou e retornou undefined; "null" = null ou
// falha de transporte; "value" = tem valor (inclui 0/false/"").
function ubEvalNullKind(d) {
  try {
    if (d && typeof d === "object" && d.undefined === true) return "undefined";
    const v = d ? d.value ?? null : null;
    if (v === null) return "null";
    return "value";
  } catch { return "null"; }
}
// Chunked (>500kB fatiado pelo bridge): remonta chunks.join("") → JSON → data;
// falha → erro acionável em vez de degradar p/ null-warn.
function ubReassembleChunks(r) {
  try {
    if (!r || !r.chunked || !Array.isArray(r.chunks)) return { ok: false, error: "not-chunked" };
    const full = r.chunks.join("");
    const parsed = JSON.parse(full);
    if (parsed && typeof parsed === "object" && ("data" in parsed)) return { ok: true, data: parsed.data };
    return { ok: true, data: parsed };
  } catch { return { ok: false, error: "resposta grande — refine com max/compact/offset" }; }
}
function ubShotCacheKey({ tabId, tab }, data) {
  try {
    if (data && data.tab && data.tab.id !== undefined && data.tab.id !== null) return `id:${data.tab.id}`;
    if (tabId !== undefined && tabId !== null && String(tabId) !== "") return `id:${tabId}`;
    if (tab) return `tab:${String(tab).toLowerCase()}`;
    return "active";
  } catch { return "active"; }
}
// UB_OWNER_PURE_END

// UB_OWNER_POWER_START — ganhos de PODER/usabilidade (verções, erros que instruem, tabs
// multi-perfil, timeout de ações pesadas, activate). Puros: testáveis via node sem extensão.
const UB_VER_ACT = "1.7.3"; // tab.activate exige extensão ≥ 1.7.3 (contrato c/ background)
const UB_VER_ELEM = "1.9.0"; // elem_pick (marcação humana de elemento) exige extensão ≥ 1.9.0
function ubVerNum(v) {
  try {
    const m = String(v || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  } catch { return null; }
}
function ubVerLt(a, b) {
  const x = ubVerNum(a), y = ubVerNum(b);
  if (!x || !y) return false; // "?" / versão desconhecida: NUNCA bloqueia por versão
  return x[0] !== y[0] ? x[0] < y[0] : (x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2]);
}
// Erro da extensão/ponte → instrução de recovery (cada caso é um erro REAL já visto no protocolo).
function ubErrHint(error) {
  const s = String(error || "");
  if (/seletor|SELECTOR/i.test(s)) return " — rode cv_ubrowser_snapshot (ou find com trecho de texto) p/ ver seletores atuais";
  if (/não encontrada|nao encontrada|not found|NOTFOUND|nenhuma aba/i.test(s)) return " — mire de novo: cv_ubrowser_tabs lista as abas/atuais (tabId ou trecho de título/URL)";
  if (/aba fechou/i.test(s)) return " — a aba morreu OU o tabId é de OUTRO perfil conectado: reliste com cv_owner_inspect {action:'tabs'} (cada aba traz profile) e repita passando profile:<clientId>";
  if (/sem histórico/i.test(s)) return " — back/forward precisam de historico do Chrome: navegue (goto) antes";
  if (/CSP|eval/i.test(s)) return " — suba pra CDP: act {action:'cdp', method:'Runtime.evaluate'} é imune a CSP (read/snapshot dão o dado sem JS)";
  if (/401|403|token/i.test(s)) return " — token divergente: confira o campo token no popup da extensão";
  return null;
}
// scan/flow varrem N passos/páginas: transporte com env baixo (ex: 10s) mata a varredura no meio —
// pesadas ganham piso de 90s (teto próprio 165s = guard do host #50; nada acima disso volta sync vivo). Default global intacto.
// Lista virtual em aba de fundo: o Chrome pausa rAF e não despacha scroll (frame-aligned).
// O shim enfileira rAF e o content dispara 'ub-flush' após cada rolagem (ubRafKick), o que
// renderiza a janela sob demanda sem trazer a aba à frente. Instalado só no scan; restaurado
// no finally. Marca data-ub-rafshim p/ o content saber que pode kickar.
const UB_RAF_SHIM = "window.__ubRAForig=window.__ubRAForig||window.requestAnimationFrame;window.__ubRAFq=window.__ubRAFq||[];window.__ubRAFid=window.__ubRAFid||0;window.__ubFlush=function(){var q=window.__ubRAFq.splice(0);for(var i=0;i<q.length;i++){try{q[i].cb(performance.now())}catch(e){}}return q.length};window.__ubFlushH=function(){window.__ubFlush()};document.removeEventListener('ub-flush',window.__ubFlushH);document.addEventListener('ub-flush',window.__ubFlushH);window.requestAnimationFrame=function(cb){var id=++window.__ubRAFid;window.__ubRAFq.push({id:id,cb:cb});return id};document.documentElement.setAttribute('data-ub-rafshim','1');return 'patched';";
const UB_RAF_RESTORE = "if(window.__ubRAForig)window.requestAnimationFrame=window.__ubRAForig;document.removeEventListener('ub-flush',window.__ubFlushH);delete window.__ubFlush;delete window.__ubFlushH;delete window.__ubRAFq;delete window.__ubRAForig;document.documentElement.removeAttribute('data-ub-rafshim');return 'restored';";
// Instala/restaura o shim de rAF numa aba (evaluate cai no MAIN world sozinho).
async function ubRafShimOn(tgt, a) {
  try {
    const sh = await ubSend("tab.evaluate", { tabId: a.tabId, tab: a.tab, js: UB_RAF_SHIM }, 8000, tgt.id);
    return !!(sh && sh.ok && sh.data && sh.data.value === "patched");
  } catch { return false; }
}
async function ubRafShimOff(tgt, a) {
  try { await ubSend("tab.evaluate", { tabId: a.tabId, tab: a.tab, js: UB_RAF_RESTORE }, 8000, tgt.id); } catch {}
}
const UB_HEAVY_ACTIONS = new Set(["scan", "flow"]);
const ubHeavyMs = () => Math.min(Math.max(UB_TIMEOUT_MS, 90000), 165000);
// Param obrigatório por ação (espelha o que a extensão joga como throw) + exemplo pronto p/ colar.
const UB_REQ = {
  goto: ["url", '{action:"goto", tab:"trecho", url:"https://…"}'],
  evaluate: ["js", '{action:"evaluate", tab:"trecho", js:"location.href"}'],
  cdp: ["method", '{action:"cdp", tab:"trecho", method:"Runtime.evaluate", params:{expression:"document.title", returnByValue:true}}'],
  flow: ["steps", '{action:"flow", tab:"trecho", steps:[{cmd:"tab.read"},{cmd:"tab.click", selector:"a"}]}'],
  count: ["selector", '{action:"count", selector:".item"}'],
  attr: ["selector+name", '{action:"attr", selector:"a", name:"href"}'],
};
function ubReqMiss(action, a) {
  try {
    const spec = UB_REQ[action];
    if (!spec) return null;
    const keys = spec[0] === "selector+name" ? ["selector", "name"] : [spec[0]];
    const missing = keys.filter((k) => {
      const v = a[k];
      if (k === "steps") return !Array.isArray(v) || !v.length;
      return v === undefined || v === null || (typeof v === "string" && !v.trim());
    });
    return missing.length ? { keys: spec[0], example: spec[1] } : null;
  } catch { return null; }
}
// shape da aba p/ o agente: título 70 chars, flags true-only (bytes), profile quando vem de fan-out
function ubTabsSlim(t, prof) {
  try {
    const p = prof || {};
    return {
      id: t.id, window: t.windowId ?? t.window ?? t.win,
      ...(t.active ? { active: true } : {}),
      ...(t.incognito ? { incognito: true } : {}),
      ...(t.group ? { group: t.group } : {}),
      ...(t.agentOwned ? { agentOwned: true } : {}),
      title: String(t.title || "").slice(0, 70), url: t.url,
      ...(p.id ? { profile: p.id } : {}), ...(p.label ? { label: p.label } : {}),
    };
  } catch { return { id: t && t.id, title: "", url: "" }; }
}
// profile/label/window repetidos em cada aba custam ~40% do payload em listas grandes.
// Uniforme → sobe uma vez (window) ou some (profile/label, já no array profiles).
function ubTabsCompact(tabs, { singleProfile = false } = {}) {
  const out = tabs.map((t) => ({ ...t }));
  const hoist = {};
  const same = (key) => {
    const vals = new Set(out.map((t) => t[key]).filter((v) => v !== undefined));
    return vals.size === 1 ? [...vals][0] : undefined;
  };
  if (singleProfile) {
    if (same("profile") !== undefined) for (const t of out) delete t.profile;
    if (same("label") !== undefined) for (const t of out) delete t.label;
  }
  const win = same("window");
  if (win !== undefined) { for (const t of out) delete t.window; hoist.window = win; }
  return { tabs: out, hoist };
}
const ubProfTag = (e) => {
  const x = e || {};
  return { ...(x.id ? { id: x.id } : {}), ...(x.profileLabel ? { label: x.profileLabel } : {}) };
};
// tabs multi-perfil: SEM profile e 2+ conectadas = consolida TODAS (Promise.all, params iguais).
// 1 conectada (ou profile pedido) = 1 ida-volta — protocolo antigo intocado.
async function ubTabsFetch(args, tgt, timeoutMs) {
  const exts = tgt.id
    ? ubListExtensions().filter((e) => e.id === tgt.id)
    : ubListExtensions().filter((e) => e.connected);
  if (exts.length <= 1) {
    return { multi: false, single: await ubSend("tabs.list", args, timeoutMs, tgt.id), exts };
  }
  const all = await Promise.all(exts.map((e) => ubSend("tabs.list", args, timeoutMs, e.id)));
  return { multi: true, all, exts };
}
// UB_OWNER_POWER_END
const UB_SHOT_LAST = new Map(); // hash do último shot por aba (frescor v14)

reg("cv_ubrowser_snapshot", {
  description: "Clicáveis da aba → aja com SELECTOR ou ref (refs válidas até a próxima navegação — SEMPRE re-snapshot após goto/click que navega). find=\"texto\": localiza com ±3 contexto sem despejar tudo. layer=\"modal|menu|popover|tooltip\": foca SÓ na camada. Listas grandes dobram sozinhas; links duplicados são removidos. compact (padrão) retorna só ref/tag/texto/role e reduz tokens; max=30 por padrão. Lista virtualizada: já rola e varre sozinho (5 páginas, até 120 itens) — act scan é alias rápido p/ paginar. Rank: viewport→nome→papel.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, max: { type: "number", default: 30, description: "máximo de elementos por página (default 30, máx 120)" }, offset: { type: "number", default: 0, description: "pula N primeiros (paginação)" }, compact: { type: "boolean", default: true, description: "padrão true: só ref|tag|texto|role; false inclui mais campos por elemento" }, find: { type: "string", description: "busca texto no snapshot e devolve matches ±3 contexto (sem despejar tudo)" }, pages: { type: "number", default: 100, description: "find em lista virtual: janelas de rolagem (1-100, default 100; orçamento 6s)" }, layer: { type: "string", enum: ["modal", "menu", "popover", "tooltip"], description: "foco SÓ na camada (ex: modal de 2 botões sem ler a página inteira)" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — obrigatório quando a aba é de outro perfil (tabs traz profile)" } }, required: [] },
  run: async ({ tabId, tab, max, offset, compact = true, find, layer, profile, pages }) => {
    const t0 = Date.now();
    const cappedMax = Math.min(Number(max) || 30, 120);
    const needle = String(find || "").trim().toLowerCase();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // pool adaptativo: a extensão fatiava ANTES do dedup/rank do servidor (40 links de
    // fragmentos distintos viravam 2). Paginamos DEPOIS; o pool só precisa cobrir a página
    // pedida com folga p/ fold/dedup — max=8 não baixa 120 elementos à toa.
    const startGuess = Math.max(0, Math.floor(Number(offset) || 0));
    const poolSize = needle ? 120 : Math.min(120, Math.max(40, Math.ceil((startGuess + cappedMax) * 2.5)));
    const tBridge = Date.now();
    const pg = Math.min(Math.max(Number(pages) || 100, 1), 100);
    let r = await ubSend("tab.snapshot", { tabId, tab, max: poolSize, ...(needle ? { match: needle, pages: pg } : {}) }, UB_TIMEOUT_MS, tgt.id);
    // lista virtual em aba de fundo: rAF pausado → 1ª passada só vê a dobra. Instala o shim
    // (fila de rAF + flush no scroll sintético) e repete UMA vez; restaura sempre.
    let shimmed = false;
    const needsShim = !!(r && r.ok && r.data && (r.data.needsShim || (r.data.overlay && r.data.overlay.needsShim)));
    if (needsShim) {
      shimmed = await ubRafShimOn(tgt, { tabId, tab });
      if (shimmed) {
        try {
          r = await ubSend("tab.snapshot", { tabId, tab, max: poolSize, ...(needle ? { match: needle, pages: pg } : {}) }, UB_TIMEOUT_MS, tgt.id);
        } finally { await ubRafShimOff(tgt, { tabId, tab }); }
      }
    }
    const bridgeMs = Date.now() - tBridge;
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const elements = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []);
    const overlay = (!Array.isArray(r.data) && r.data && typeof r.data.overlay === "object" && r.data.overlay) ? r.data.overlay : null;
    const overlayNote = (overlay && overlay.open) ? ` | OVERLAY OPEN (${overlay.kind || "?"}${overlay.label ? ` "${String(overlay.label).slice(0, 60)}"` : ""}) — página bloqueada atrás` : "";
    const fallbackNote = overlay && overlay.fallback ? ` | FALLBACK: ${String(overlay.fallbackError || "erro").slice(0, 120)}` : "";
    const shimNote = needsShim && !shimmed ? " | lista virtual em aba de fundo: não rolou (ative a aba p/ varrer tudo)" : "";
    const overlayData = overlay && overlay.open ? { overlay } : {};
    const ranked = ubSnapRank(elements);
    const kept = [];
    let junk = 0;
    for (const el of ranked) { if (ubSnapIsJunk(el)) junk++; else kept.push(el); }
    ubSnapCacheStore(ubSnapCacheKey({ tabId, tab }), kept); // ref→selector p/ click por ref (#48)
    const omitNote = junk ? ` (+${junk} junk omitidos)` : "";
    // FOCO NA CAMADA: layer="modal" mostra SÓ a camada (modal de 2 botões sem ler a página);
    // sem filtro e com overlay aberto, a camada do modal vai PRIMEIRO (partição estável).
    let pool = kept, focusNote = "";
    const layerFilter = String(layer || "").trim().toLowerCase();
    if (layerFilter) {
      pool = kept.filter((el) => String(el.layer || "").toLowerCase() === layerFilter);
      if (!pool.length) return devOut({ summary: `layer "${layer}": vazio (overlay: ${overlay && overlay.open ? `${overlay.kind || "?"}${overlay.label ? ` "${String(overlay.label).slice(0, 60)}"` : ""}` : "nenhum aberto"}) em ${ubPlural(kept.length, "elemento", "elementos")}${omitNote}${overlayNote}`, data: { layer, found: false, elements: [], ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
      focusNote = ` (foco: layer=${layerFilter}, ${pool.length}/${kept.length})`;
    } else if (overlay && overlay.open) {
      const want = String(overlay.kind || "modal").toLowerCase();
      const isTop = (el) => { const l = String(el.layer || "").toLowerCase(); return l === want || (want !== "modal" && l === "modal"); };
      const top = pool.filter(isTop), rest = pool.filter((el) => !isTop(el));
      if (top.length && top.length < pool.length) { pool = [...top, ...rest]; focusNote = ` (foco: ${top.length} da camada "${overlay.kind || "modal"}" primeiro)`; }
    }
    // projeção compacta única (find e compact): tag redundante some; ref continua agindo via cache.
    const slimEl = ({ ref, tag, text, role, name, layer, layerLabel }) => {
      const t = (!tag || !role || tag === role || (tag === "a" && role === "link")) ? undefined : tag;
      return { ref, ...(t ? { tag: t } : {}), text: text || name || "", role, ...(layer ? { layer, ...(layerLabel ? { layerLabel } : {}) } : {}) };
    };
    // find: matches ±3 contexto, sem fold/dedup (previsível); resto do pipeline pula.
    if (needle) {
      const hits = [];
      pool.forEach((el, i) => {
        const hay = `${el.text || ""} ${el.name || ""}`.toLowerCase();
        if (hay.includes(needle)) hits.push(i);
      });
      if (!hits.length) return devOut({ summary: `find "${find}": nada (varri a página${junk ? `, ${ubPlural(junk, "junk", "junk")} fora` : ""}) — tente trecho menor${overlay && overlay.findTruncated ? `; lista virtual: varredura parcial (teto de ${pg} janelas); abra a aba ou use scan paginado` : " ou act scan em lista virtualizada"}${overlayNote}${focusNote}`, data: { find, found: false, elements: [], ...(overlay && overlay.findTruncated ? { truncated: true } : {}), ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const win = new Set();
      for (const h of hits) for (let k = Math.max(0, h - 3); k <= Math.min(pool.length - 1, h + 3); k++) win.add(k);
      const hitSet = new Set(hits);
      const lines = [...win].sort((a, b) => a - b).map((i) => {
        const el = pool[i];
        const tag = `[${el.ref ?? i}] ${el.role || el.tag} "${(el.text || el.name || "").slice(0, 80)}"`;
        return hitSet.has(i) ? `→ ${tag}  ← MATCH` : `  ${tag}`;
      });
      return devOut({ summary: `find "${find}": ${ubPlural(hits.length, "match", "matches")} em ${ubPlural(pool.length, "elemento", "elementos")}${omitNote}${overlayNote}${focusNote}`, data: { find, found: true, matches: hits.map((i) => pool[i].ref ?? i), elements: [...win].sort((a, b) => a - b).map((i) => slimEl(pool[i])), ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const folded = ubSnapFold(pool);
    const foldedNote = folded.folded ? ` (dobra: ${pool.length}→${folded.elements.length})` : "";
    const dd = ubSnapDedupLinks(folded.elements);
    const dupeNote = dd.dupes ? ` (+${dd.dupes} links duplicados)` : "";
    // paginação DEPOIS de rank/junk/fold/dedup: max=30 mostra 30 elementos úteis, não 30 brutos
    const start = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
    const total = dd.elements.length;
    const paged = dd.elements.slice(start, start + cappedMax);
    const nextOffset = start + paged.length < total ? start + paged.length : null;
    const pageNote = total > paged.length || start > 0 ? ` (${start + 1}-${start + paged.length}${nextOffset != null ? `; nextOffset=${nextOffset}` : ""})` : "";
    const pageData = { total, offset: start, ...(nextOffset != null ? { nextOffset } : {}) };
    if (compact) {
      // #42: text||name — img com alt/src ganha nome na extensão; compact não o esconde.
      const compactOut = paged.map(slimEl);
      return devOut({ summary: `${compactOut.length}/${total} ${total === 1 ? "elemento" : "elementos"} (compact)${pageNote}${omitNote}${foldedNote}${dupeNote}${overlayNote}${fallbackNote}${shimNote}${focusNote}${shimmed ? " (lista virtual rolada em aba de fundo)" : ""}${ubAlertsHint()}`, data: { elements: compactOut, compact: true, omitted: junk, ...pageData, ...overlayData, ...(shimmed ? { virtualScanned: true } : {}) }, telemetry: { execution_time_ms: Date.now() - t0, bridge_ms: bridgeMs } });
    }
    const ac = ubSnapAutoCompactFields(paged);
    const autoNote = ac.autoCompact ? ` (auto-compact campos: -${ac.dropped.join(",")})` : "";
    return devOut({ summary: `${ac.elements.length}/${total} ${total === 1 ? "elemento" : "elementos"}${ac.autoCompact ? " (compact-campos)" : ""}${pageNote}${omitNote}${foldedNote}${dupeNote}${autoNote}${overlayNote}${fallbackNote}${focusNote}${ubAlertsHint()}`, data: { elements: ac.elements, compact: ac.autoCompact, compactFields: ac.dropped, omitted: junk, bytes: ac.bytes, ...pageData, ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

reg("cv_ubrowser_act", {
  description: "Opera o Chrome autenticado sem tirar o foco do usuário por padrão; use `focus:true` só quando quiser trazer o Chrome à frente. Guias novas são abertas em segundo plano (`active:true` para selecionar). `goto` troca o site na guia escolhida. Use CDP quando necessário. `panel` exibe progresso e marcações; `flow` atualiza cada passo. Alto risco requer confirmação.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "reload-extension", "reinject", "click", "fill", "type", "select", "press", "scroll", "highlight", "waittext", "wait", "evaluate", "monstate", "cdp", "cursor", "tooltip", "catchup", "aesthetic", "new", "scan", "count", "attr", "html", "flow", "panel", "console", "close", "activate", "elem_pick"] },
      off: { type: "boolean", description: "p/ elem_pick: desliga o modo de marcação" },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — omitir = mais recente" },
      ref: { type: "number", description: "ref do snapshot (resolve p/ selector via cache; expira se navegar — re-snapshot)" },
      name: { type: "string", description: "atributo p/ attr (href/src/value/text/html)" },
      container: { type: "string", description: "selector do container p/ scan/scroll (listas virtualizadas, opcional)" },
      value: { type: "string", description: "valor p/ select (match por texto ou value da option)" },
      timeoutMs: { type: "number", description: "tempo de espera para waittext/evaluate" },
      steps: { type: "array", description: "p/ flow: sequência de comandos [{cmd, ...args}] em uma ida-volta", items: { type: "object" } },
      showProgress: { type: "boolean", description: "p/ flow: exibe o passo a passo no painel da página (default true)" },
      progressTitle: { type: "string" }, progressMessage: { type: "string" },
      mode: { type: "string", enum: ["close_by_prefix", "open", "update", "close"] },
      message: { type: "string", description: "texto de status mostrado no painel de progresso" },
      annotations: { type: "array", description: "marcações visuais independentes do DOM do site: [{selector,label,color}]", items: { type: "object" } },
      key: { type: "string" }, js: { type: "string" }, ms: { type: "number" },
      method: { type: "string", description: "p/ cdp: método CDP (ex: Runtime.evaluate, DOM.getDocument, Input.insertText)" },
      params: { type: "object", description: "p/ cdp: parâmetros do método (ex: {expression:'document.title', returnByValue:true})" },
      x: { type: "number", description: "viewport X p/ cursor|tooltip" }, y: { type: "number", description: "viewport Y p/ cursor|tooltip" },
      click: { type: "boolean", description: "cursor clica ao chegar (TRUSTED via CDP por padrão; trusted:false = sintético)" },
      trusted: { type: "boolean", description: "cursor: false desliga o clique trusted (usa sintético direto)" },
      hover: { type: "boolean", description: "click/cursor: mouseover antes do clique p/ menus/linhas que exigem :hover" },
      hoverMs: { type: "number", description: "duração do hover em ms p/ click/cursor/tooltip" },
      force: { type: "boolean", description: "click/cursor_sel: clica mesmo com overlay por cima (padrão: falha COVERED)" },
      noEscalate: { type: "boolean", description: "click/cursor: desliga duplo-clique automático (default: escala sozinho)" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      snap: { type: "boolean", description: "p/ goto/new/back/forward/reload: volta top-10 do snapshot junto (economiza 1 call)" },
      filter: { type: "string", enum: ["all", "errors", "net", "console"], default: "all", description: "p/ console: all|errors|net|console" },
      limit: { type: "number", default: 30, description: "p/ console: máx entradas (1-120)" },
      clear: { type: "boolean", description: "p/ console: limpa o buffer após ler" },
      pages: { type: "number", default: 5, description: "páginas de rolagem p/ scan (listas virtualizadas; 1-5)" },
      offset: { type: "number", description: "p/ scan: pula N itens (paginação via nextOffset)" },
      durationMs: { type: "number", description: "duração do movimento do cursor; janela do catchup quando action=catchup" },
      intervalMs: { type: "number", description: "intervalo entre amostras do catchup (ms)" },
      urlPrefix: { type: "string", description: "prefixo para fechar guias correspondentes; operação em lote exige confirm" },
      expectUrl: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer na URL após settle" },
      expectText: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer no texto após settle" },
      expectGone: { type: "string", description: "p/ click/fill/type/select: selector que deve SUMIR após settle" },
      focused: { type: "boolean", default: false, description: "p/ activate: focar a janela (padrão false; true traz o Chrome à frente)" },
      confirm: { type: "string", description: "Confirmação de ações sensíveis de alto risco" },
      focus: { type: "boolean", default: false, description: "opcionalmente traz o Chrome à frente (padrão false; preserva o foco e o cursor atuais)" },
      windowId: { type: "number", description: "janela em que criar uma nova guia" },
      active: { type: "boolean", default: false, description: "para action=new: abre a guia ativa (padrão false; mantém a guia atual)" },
    },
    required: ["action"],
  },
  run: async (a, context = {}) => {
    const t0 = Date.now();
    if (!a.action) return devOut({ status: "error", summary: `action ausente — ações válidas: goto|back|forward|reload|reload-extension|reinject|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|tooltip|catchup|aesthetic|new|scan|count|attr|html|flow|console|close|activate|elem_pick | exemplos: {action:"goto", tab:"trecho", url:"https://..."} / {action:"click", ref:3} / {action:"activate", tab:"Gmail"}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // roteamento multi-perfil: profile pedido SEM match = erro acionável (lista conectados),
    // nunca despacha em silêncio p/ outro perfil. Um só resolve vale p/ ida e retry.
    const tgt = ubTarget(a.profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { action: a.action, profile: String(a.profile ?? "") }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // #48: ref do snapshot resolve p/ selector (cache por aba); selector explícito vence.
    if (a.ref !== undefined && a.ref !== null && String(a.ref) !== "" && !a.selector) {
      const res = ubSnapCacheResolve(ubSnapCacheKey({ tabId: a.tabId, tab: a.tab }), a.ref);
      if (!res.ok) return devOut({ status: "error", summary: `${res.error} | ${UB_FB}`, data: { action: a.action, ref: a.ref }, telemetry: { execution_time_ms: Date.now() - t0 } });
      a = { ...a, selector: res.selector };
    }
    // cdp: method+params viram texto ANTES da trava — mesma régua de risco do evaluate
    // (pagamento/senha/rm em Runtime.evaluate NÃO passam sem confirm do dono).
    if (a.action === "cdp") a = { ...a, text: String(a.method || "") + " " + JSON.stringify(a.params || {}).slice(0, 1500) };
    const risk = ubRisk(a);
    if (risk === "high" && !(a.confirm && a.confirm.trim().length >= 4))
      return devOut({ status: "error", summary: `BLOQUEADO (alto risco). Só com pedido EXPLÍCITO + confirm="<frase do dono>". Ação: ${a.action} ${a.selector || a.url || ""}`, data: { action: a.action, risk }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // CDP do dono (porta 9222, WS persistente): tenta PRIMEIRO se o toggle estiver armado —
    // sem banner e alcança chrome://. Modo em efeito (escolha do dono): toggle OFF → o fast-fail
    // do ownerConnect recusa em ms e a extensão abaixo responde tudo (zero cliques). tab:"trecho" casa URL/título; indisponível
    // (toggle off, consentimento pendente, trecho ambíguo) → cai p/ tab.cdp da extensão abaixo.
    if (a.action === "cdp" && !a.off && a.method) {
      try {
        const oc = await ownerCdpSend(String(a.tab ?? ""), String(a.method), a.params || {});
        const res = oc.result ?? null;
        const isEval = /Runtime\.evaluate/i.test(String(a.method));
        const val = isEval && res && typeof res === "object" && res.result ? res.result.value : undefined;
        const preview = val === undefined ? undefined : JSON.stringify(val)?.slice(0, 200);
        const resSlim = res && typeof res === "object" && typeof res.data === "string" && res.data.length > 300
          ? { ...res, data: `(base64 ${res.data.length}B omitido — evidência visual vai por cv_ubrowser_shot)` } : res;
        return devOut({ summary: `[cdp·9222] ${a.method} ok (${oc.ms}ms)${preview !== undefined ? ` · valor: ${preview}` : ""}`, data: { action: "cdp", via: "9222", method: a.method, value: val, result: resSlim }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_act", reason: "Conexão CDP do dono é persistente — próximos cdp respondem sem dialog" }] });
      } catch (e) {
        if (!e || !e.__ownerDown) // erro do COMANDO (sintaxe/domínio CDP) — caminho ok, não cai p/ extensão
          return devOut({ status: "warn", summary: `[cdp·9222] ${a.method}: ${String((e && e.message) || e).slice(0, 180)}`, data: { action: "cdp", via: "9222", method: a.method, error: String((e && e.message) || e).slice(0, 200) }, telemetry: { execution_time_ms: Date.now() - t0 } });
        // indisponível/matching → segue p/ extensão (banner, mas funciona e resolve por tabId)
      }
    }
    if (a.action === "wait") {
      const requested = Number(a.waitMs ?? a.ms), waitMs = Number.isFinite(requested) && requested >= 0 ? requested : 2000;
      await new Promise((r) => setTimeout(r, waitMs));
      return devOut({ summary: "wait ok", data: { action: "wait", waitedMs: waitMs }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", "reload-extension": "tab.reload-extension", reinject: "tab.reinject", click: "tab.click", fill: "tab.fill", type: "tab.type", select: "tab.select", press: "tab.press", scroll: "tab.scroll", highlight: "tab.highlight", waittext: "tab.waittext", evaluate: "tab.evaluate", monstate: "tab.monstate", cdp: "tab.cdp", cursor: "tab.cursor", tooltip: "tab.tooltip", catchup: "tab.catchup", aesthetic: "tab.aesthetic", new: "tab.new", scan: "tab.scan", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow", panel: "tab.panel", console: "tab.console", close: "tab.close", activate: "tab.activate", elem_pick: "tab.elem_pick" };
    if (!map[a.action]) return devOut({ status: "error", summary: `action "${a.action}" desconhecida — ações válidas: goto|back|forward|reload|reload-extension|reinject|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|tooltip|catchup|aesthetic|new|scan|count|attr|html|flow|console|close|activate|elem_pick | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // valida antes da ida-volta: param que a extensão joga como throw vira erro AQUI com exemplo pronto p/ colar.
    {
      const req = ubReqMiss(a.action, a);
      if (req) return devOut({ status: "error", summary: `${a.action} exige ${req.keys} — exemplo: ${req.example} | ${UB_FB}`, data: { action: a.action, missing: req.keys }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // Extensão antiga sem suporte a activate: erro local com hint; versão desconhecida é despachada.
    if (a.action === "activate") {
      const extAct = ubListExtensions().find((e) => e.id === tgt.id);
      const verAct = extAct?.info?.bg ? String(extAct.info.bg) : null;
      if (verAct && ubVerLt(verAct, UB_VER_ACT))
        return devOut({ status: "error", summary: `tab.activate requer extensão ${UB_VER_ACT}+ (rodando ${verAct}) — rode {action:"reload-extension"} e confirme versão com cv_ubrowser_status (data.version) | ${UB_FB}`, data: { action: "activate", version: verAct, required: UB_VER_ACT }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // tooltip exige alvo (selector vence; senão x+y) — falha local, sem ida-volta.
    if (a.action === "tooltip" && !a.selector && (a.x === undefined || a.y === undefined))
      return devOut({ status: "error", summary: `tooltip exige selector OU x+y — exemplo: {action:"tooltip", selector:"button[aria-label]"} ou {action:"tooltip", x:120, y:300} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // elem_pick (marcação humana de elemento): só ≥ 1.9.0 — antiga = erro com hint de reload.
    if (a.action === "elem_pick") {
      const extEl = ubListExtensions().find((e) => e.id === tgt.id);
      const verEl = extEl?.info?.bg ? String(extEl.info.bg) : null;
      if (verEl && ubVerLt(verEl, UB_VER_ELEM))
        return devOut({ status: "error", summary: `elem_pick requer extensão ${UB_VER_ELEM}+ (rodando ${verEl}) — rode {action:"reload-extension"} e confirme versão com cv_ubrowser_status (data.version) | ${UB_FB}`, data: { action: "elem_pick", version: verEl, required: UB_VER_ELEM }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // console zera os alertas push ANTES da ida-volta: vale mesmo se a extensão falhar
    // (o hint já cumpriu o papel de levar o agente até aqui).
    if (a.action === "console") ubAlertsRead();
    // timeout adaptativo: scan/flow varrem muitas páginas — env baixo não mata a varredura (piso 90s, teto 180s).
    const cursorWaitMs = Number(a.durationMs || 0) + Number(a.hoverMs || 0) + 15000;
    const flowWaitMs = Array.isArray(a.steps) ? a.steps.reduce((sum, step) => {
      const explicit = Number(step?.waitMs ?? step?.ms ?? 0);
      const movement = Number(step?.durationMs ?? 0) + Number(step?.hoverMs ?? 0);
      return sum + Math.max(Number.isFinite(explicit) ? explicit : 0, Number.isFinite(movement) ? movement : 0) + 15000;
    }, 0) : 0;
    const durationWaitMs = a.action === "flow" ? flowWaitMs : (a.action === "catchup" || a.action === "cursor" || a.action === "click" ? cursorWaitMs : 0);
    const ubTo = Math.max(UB_HEAVY_ACTIONS.has(a.action) ? ubHeavyMs() : UB_TIMEOUT_MS, Number.isFinite(durationWaitMs) ? durationWaitMs : UB_TIMEOUT_MS);
    // scan de lista virtual: instala o shim de rAF antes e restaura depois (sempre).
    const rafShim = a.action === "scan" ? await ubRafShimOn(tgt, a) : false;
    let r;
    try {
      if (a.action === "scan") {
        // scan = snapshot que já rola listas virtuais (5 páginas) numa só ida. O tab.scan
        // antigo repetia a varredura 4× (8s → ~2s) e devolvia menos itens.
        const pages = Math.min(Math.max(Number(a.pages) || 5, 1), 5);
        const snap = await ubSend("tab.snapshot", { tabId: a.tabId, tab: a.tab, max: 120, pages, ...(a.container ? { container: a.container } : {}) }, ubTo, tgt.id);
        if (snap && snap.ok && snap.data && Array.isArray(snap.data.items) && snap.data.items.length) {
          const items = snap.data.items.map((it, i) => ({ ref: it.ref ?? i, ...it }));
          r = { ok: true, data: { items, pages, reachedEnd: items.length < 120 } };
        } else r = await ubSend("tab.scan", { ...a }, ubTo, tgt.id); // fallback: página sem itens p/ snapshot
      } else r = await ubSend(map[a.action], { ...a }, ubTo, tgt.id);
    }
    finally { if (rafShim) await ubRafShimOff(tgt, a); }
    // #43a: evaluate null intermitente (race com JS da página) — 1 retry após 800ms antes de declarar null.
    // v14: vale a verdade mais nova — adota r2 seja ok ou erro (só pendings mantêm o antigo).
    if (a.action === "evaluate" && r && r.ok && (r.data?.value ?? null) === null && !r.data?.error) {
      await new Promise((res) => setTimeout(res, 800));
      const r2 = await ubSend(map[a.action], { ...a }, UB_TIMEOUT_MS, tgt.id);
      r = ubEvalPickRetry(r, r2);
    }
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg(ubTo)} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) {
      // BFCache (report rmvzh2gx8): o efeito JÁ FOI, a página migrou p/ cache e fechou o canal —
      // resposta perdida ≠ ação falhou. Volta warn acionável (confirme na aba nova) em vez de erro seco.
      if (/back\/forward cache|message channel is closed/i.test(String(r.error || "")))
        return devOut({ status: "warn", summary: `efeito aplicado, resposta perdida no BFCache (${String(r.error).slice(0, 90)}) — re-attach é automático; confirme o efeito na aba nova`, data: { action: a.action, bfCache: true, error: r.error }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_tabs", reason: "Ver a aba aberta/navegada e confirmar o efeito" }] });
      // extensão antiga (<1.7.3) sem tab.activate: "cmd desconhecido"/"unknown action" → hint de versão/reload
      const unknownAct = a.action === "activate" && /desconhecido|unknown/i.test(String(r.error || ""));
      return devOut({ status: "error", summary: `extensão: ${r.error}${ubErrHint(r.error) || ""}${unknownAct ? ` — tab.activate precisa extensão ${UB_VER_ACT}+ (cv_ubrowser_status → data.version); rode {action:"reload-extension"}` : ""} | ${UB_FB}`, data: { action: a.action, ...(unknownAct ? { versionHint: UB_VER_ACT } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const d = r.data || {};
    if (a.action === "activate") {
      // aba à frente NO Chrome (contrato u Melhora): tolera d.tab{} (futuro), {tabId,title,url,focused} (bg 1.7.3) ou d plano.
      const tb = (d.tab && typeof d.tab === "object") ? d.tab : d;
      const focused = typeof d.focused === "boolean" ? d.focused : a.focused !== false && a.focus !== false;
      const where = (tb.title || tb.url) ? `${String(tb.title || "").slice(0, 60)} — ${String(tb.url || "").slice(0, 80)}` : ((tb.tabId ?? tb.id) !== undefined ? `tabId ${tb.tabId ?? tb.id}` : (a.tab ? `"${String(a.tab).slice(0, 40)}"` : "aba alvo"));
      const actNext = [{ tool: "cv_ubrowser_snapshot", reason: "Janela em foco — mapeie controles atualizados" }];
      return devOut({ summary: `[activate] ok — aba à frente NO Chrome: ${where}${focused ? " + janela em foco" : " (foco preservado por solicitação)"}`, data: { action: "activate", risk, focused, tabId: tb.tabId ?? tb.id ?? d.id, ...(tb.title ? { title: String(tb.title).slice(0, 100) } : {}), ...(tb.url ? { url: String(tb.url).slice(0, 200) } : {}), ...(d.window ? { window: d.window } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: actNext });
    }
    if (a.action === "panel") {
      const open = d.open !== false;
      return devOut({ summary: open ? `[panel] painel de progresso aberto · ${d.steps || 0} passo(s) · ${d.annotations || 0} marcação(ões)` : "[panel] painel fechado", data: { action: "panel", ...d }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "reload-extension") {
      // auto-reload remoto da extensão (aplica código novo do disco).
      return devOut({ summary: `[reload-extension] ok — extensão recarregando, ponte reconecta sozinha em segundos (confira versões com cv_ubrowser_status)`, data: { action: a.action, risk, reloading: true, bg: d.bg || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "elem_pick") {
      // modo de marcação do dono: report chega DEPOIS via /elemreport (push da extensão).
      if (a.off) return devOut({ summary: `[elem_pick] modo de marcação DESLIGADO na aba${d.marks !== undefined ? ` · ${d.marks} marcação(ões) viva(s) na página` : ""}`, data: { action: "elem_pick", off: true, ...d }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `[elem_pick] modo de marcação ATIVO — o dono clica nos elementos (1..N) e escreve o que está errado; o report fica persistente por site. O report chega sozinho: depois de ele marcar, rode cv_elemreports_list {base_url:"<url da aba>"}.`, data: { action: "elem_pick", ...d }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_elemreports_list", reason: "Listar reports da base_url (o dono já marcou?)" }] });
    }
    if (a.action === "evaluate") {
      // v14 chunked (>500kB): remonta em vez de degradar p/ null-warn.
      if (r.chunked && Array.isArray(r.chunks)) {
        const re = ubReassembleChunks(r);
        if (!re.ok) return devOut({ status: "error", summary: `${re.error} (${r.bytes || "?"} bytes) | ${UB_FB}`, data: { action: a.action, risk, value: null, chunked: true }, telemetry: { execution_time_ms: Date.now() - t0 } });
        return devOut({ summary: "[evaluate] ok (chunked)", data: { action: a.action, risk, value: (re.data && typeof re.data === "object" && ("value" in re.data)) ? re.data.value : re.data, cspBlocked: false, chunked: true }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_shot", reason: "Confirmar visualmente" }] });
      }
      const value = d.value ?? null;
      const errStr = String(d.error ?? d.message ?? d.details ?? "");
      const cspBlocked = /CSP|Content-Security|blocked|eval/i.test(errStr);
      const pageLoaded = d.pageLoaded ?? true;
      const selFound = a.selector ? (value !== null && value !== undefined && value !== "") : undefined;
      if (!pageLoaded) return devOut({ status: "error", summary: `página não carregou — recovery: reload via cv_ubrowser_act + waittext e tente de novo | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false, pageLoaded: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (cspBlocked) return devOut({ status: "error", summary: `CSP bloqueou evaluate — suba pra cdp: {action:"cdp", method:"Runtime.evaluate"} é imune a CSP (read/snapshot dão o dado sem JS) | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: true, selectorFound: selFound, error: d.error }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_act", reason: "cdp Runtime.evaluate passa por cima da CSP" }] });
      if (a.selector && !selFound) return devOut({ status: "error", summary: `seletor não achou elemento — recovery: rode cv_ubrowser_snapshot p/ selector atual + confira aba ativa | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      // v14: undefined (rodou, sem valor) ≠ null/falha de transporte — mensagens distintas.
      if (!a.selector && ubEvalNullKind(d) === "undefined") return devOut({ status: "warn", summary: `evaluate executou e retornou undefined — termine o JS com o valor desejado | ${UB_FB}`, data: { action: a.action, risk, value: null, undefined: true, cspBlocked: false, selectorFound: selFound, note: d.note || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (!a.selector && value === null) return devOut({ status: "warn", summary: `evaluate retornou null${d.note ? ` — ${String(d.note).slice(0, 160)}` : " — termine JS com valor + confira cv_ubrowser_snapshot/read"} | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: selFound, note: d.note || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: "[evaluate] ok", data: { action: a.action, risk, value, cspBlocked: false, selectorFound: selFound }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "monstate") {
      // estado do mon-hook (v/quiet/count/hasFlag) — func-based, imune à CSP da página.
      const mv = d && typeof d === "object" ? d.value || d : {};
      const vOut = Number(mv.v) || 0, qOut = mv.quiet;
      const st = vOut === 0 ? "sem-hook (mon-hook ainda não injetado nesta página)" : `mon-hook v${vOut}, quiet: ${qOut === null ? "?" : (qOut ? "true" : "false")}${vOut < 4 ? ` (obsoleto — o próximo ensure monta v4)` : ""}`;
      return devOut({ summary: `[monstate] ${st} · buffer: ${Number(mv.count) || 0} entradas · __ubMonQuiet: ${mv.hasFlag === true}`, data: { action: "monstate", ...mv }, telemetry: { execution_time_ms: Date.now() - t0 }, next: qOut === false ? [{ tool: "cv_ubrowser_act", reason: "quiet falso ao vivo: rode qualquer act nesta aba p/ re-ensure (extensão ≥1.8.2 corrige sem F5)" }] : [] });
    }
    if (a.action === "cdp") {
      // CDP permanente: executa command de debugger na aba (ver/editar/ler — imune a CSP).
      if (a.off) return devOut({ summary: "[cdp] detach ok — banner de debug some; próximo cdp re-atacha sozinho", data: { action: "cdp", off: true }, telemetry: { execution_time_ms: Date.now() - t0 } });
      // shape da ponte: resposta da extensão vem em d.value ({ok, method, result, ms}); tolera d plano.
      const cv = d && typeof d === "object" ? d.value : null;
      const cd = (cv && typeof cv === "object" && ("method" in cv || "ok" in cv || "result" in cv)) ? cv : ((d && typeof d === "object") ? d : {});
      if (cd.ok === false) return devOut({ status: "warn", summary: `[cdp·ext] ${cd.method}: ${cd.error} — re-attach é automático no retry; DevTools aberto na aba também bloqueia attach | ${UB_FB}`, data: { action: "cdp", via: "extensão", ...cd }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const res = cd.result ?? null;
      const isEval = /Runtime\.evaluate/i.test(String(cd.method || ""));
      const val = isEval && res && typeof res === "object" && res.result ? res.result.value : undefined;
      const preview = val === undefined ? undefined : JSON.stringify(val)?.slice(0, 200);
      const resSlim = res && typeof res === "object" && typeof res.data === "string" && res.data.length > 300
        ? { ...res, data: `(base64 ${res.data.length}B omitido — cv_ubrowser_shot salva imagem; CDP de fundo já vem no shot automaticamente)` }
        : res;
      return devOut({ summary: `[cdp·ext] ${cd.method} ok (${cd.ms}ms)${preview !== undefined ? ` · valor: ${preview}` : ""}`, data: { action: "cdp", via: "extensão", method: cd.method, value: val, result: resSlim }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_act", reason: "Attach é permanente por aba — próximos cdp não mostram banner novo" }] });
    }
    if (a.action === "console") {
      // #47: console+erros+rede da aba (hook MAIN; só vê o que aconteceu após a 1ª injeção).
      if (d.hooked === false) return devOut({ status: "warn", summary: `${d.note || "hook de console ainda não ativo nesta página"} | ${UB_FB}`, data: { action: "console", hooked: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const entries = Array.isArray(d.entries) ? d.entries : [];
      const lines = entries.map((e) => {
        e = e && typeof e === "object" ? e : {};
        if (e.kind === "net") return `[net ${e.method || "?"} ${e.status ?? "?"} ${e.ms ?? "?"}ms] ${e.url || ""}${e.error ? ` ERRO: ${e.error}` : ""}${e.body ? ` :: ${String(e.body).slice(0, 200)}` : ""}`;
        if (e.kind === "js-error") return `[js-error] ${e.text || ""}${e.src ? ` @ ${e.src}:${e.line || 0}` : ""}`;
        if (e.kind === "promise") return `[unhandled] ${e.text || ""}`;
        return `[${e.level || e.kind || "?"}] ${e.text || ""}`;
      });
      const body = lines.join("\n").slice(0, 6000);
      return devOut({ summary: `[console ${d.filter || "all"}] ${entries.length} entrada(s)${d.total > entries.length ? ` (de ${d.total})` : ""}`, data: { action: "console", hooked: true, filter: d.filter, count: entries.length, text: body, entries: entries.slice(0, 30) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "tooltip") {
      // hover-to-reveal (só-leitura, sem clique): tooltip string ou null.
      const tip = (d && typeof d.tooltip === "string" && d.tooltip) ? d.tooltip : null;
      const where = a.selector || ((a.x !== undefined && a.y !== undefined) ? `${a.x},${a.y}` : "?");
      if (tip) return devOut({ summary: `[tooltip] "${String(tip).slice(0, 120)}" em ${where} (via ${d.source || "?"})`, data: { action: "tooltip", risk, tooltip: tip, source: d.source || "", x: d.x, y: d.y }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `[tooltip] sem tooltip em ${where} — sem hover-text nem title/aria (nada para ler)`, data: { action: "tooltip", risk, tooltip: null, x: d.x, y: d.y }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "catchup") {
      // pesca de transientes: apareceu/sumiu + texto (sem snapshot — toast morre antes).
      const ap = Array.isArray(d.appeared) ? d.appeared : [];
      const dis = Array.isArray(d.disappeared) ? d.disappeared : [];
      const fmt = (n) => `"${String((n && n.text) || "").slice(0, 100)}"`;
      if (!ap.length && !dis.length) return devOut({ summary: `[catchup] nada transitório em ${d.durationMs ?? "?"}ms (${d.samples ?? 0} amostra(s)) — sem toast/alerta nesse intervalo`, data: { action: "catchup", risk, appeared: [], disappeared: [], samples: d.samples ?? 0 }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `[catchup] +${ap.length} apareceu(ram)${ap.length ? ": " + ap.map(fmt).join(" | ").slice(0, 200) : ""} | -${dis.length} sumiu(ram)${dis.length ? ": " + dis.map(fmt).join(" | ").slice(0, 200) : ""}`, data: { action: "catchup", risk, appeared: ap, disappeared: dis, samples: d.samples ?? 0 }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "aesthetic") {
      // veredito visual bounded: score 0-100 + issues (kind/where/detail, teto 12).
      const score = (d && typeof d.score === "number") ? d.score : null;
      const issues = Array.isArray(d?.issues) ? d.issues : [];
      const stats = (d && typeof d.stats === "object" && d.stats) ? d.stats : {};
      if (score === null) return devOut({ status: "warn", summary: `[aesthetic] sem score — página sem elementos visíveis? | ${UB_FB}`, data: { action: "aesthetic", risk, score: null, issues: [], stats }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const kinds = {};
      for (const it of issues) { try { const k = String(it?.kind || "?"); kinds[k] = (kinds[k] || 0) + 1; } catch {} }
      const kindNote = Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(", ");
      const top = issues.slice(0, 6).map((it) => `${it.kind}@${it.where}: ${it.detail}`).join(" | ").slice(0, 400);
      return devOut({ summary: `[aesthetic] score ${score}/100 — ${issues.length} issue(s)${kindNote ? ` (${kindNote})` : " (limpo)"}${top ? `: ${top}` : ""}`, data: { action: "aesthetic", risk, score, issues, stats }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_shot", reason: "Confirmar visualmente" }] });
    }
    if (a.action === "close") {
      // #67: fechar aba-fantasma (about:blank) do agente. Aba do dono com http(s) ativo
      // é RECUSADA pela extensão sem confirm explícito — recai aqui como erro do bridge.
      if (a.mode === "close_by_prefix") {
        const n = Number(d.closed) || 0;
        const pfx = String(d.prefix || a.urlPrefix || "about:blank");
        if (!n) return devOut({ status: "warn", summary: `[close] nenhuma aba com prefixo "${pfx}" — nada a limpar (prefixo solicitado aceito)`, data: { action: "close", mode: "close_by_prefix", risk, closed: 0, prefix: pfx }, telemetry: { execution_time_ms: Date.now() - t0 } });
        return devOut({ summary: `[close risk=${risk}] ok — ${n} aba(s) com prefixo ${pfx} fechada(s)`, data: { action: "close", mode: "close_by_prefix", risk, closed: n, tabIds: Array.isArray(d.tabIds) ? d.tabIds : [], prefix: pfx }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_tabs", reason: "Conferir abas restantes" }] });
      }
      const where = d.url ? String(d.url).slice(0, 80) : (a.tabId ? `tabId ${a.tabId}` : "aba ativa");
      return devOut({ summary: `[close risk=${risk}] ok — fechei ${where}`, data: { action: "close", risk, closed: d.closed ?? 1, tabId: d.tabId, url: d.url, title: d.title }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "cv_ubrowser_tabs", reason: "Conferir abas restantes" }] });
    }
    if (a.action === "scan") {
      // scan coleta até 150 itens de lista virtualizada; sem este handler o payload era
      // descartado e a resposta virava só "ok". Compacto + paginação: o agente age por sel.
      const all = Array.isArray(d.items) ? d.items : [];
      const total = all.length;
      const off = Math.max(0, Math.floor(Number(a.offset) || 0));
      const cap = Math.min(Math.max(Number(a.limit) || 30, 1), 150);
      const page = all.slice(off, off + cap);
      const nextOffset = off + page.length < total ? off + page.length : null;
      const items = page.map(({ tag, role, text, name, selector, layer, layerLabel }) => ({
        sel: String(selector || "").slice(0, 120),
        text: String(text || name || "").slice(0, 80),
        ...(role ? { role } : {}),
        ...(tag && tag !== role ? { tag } : {}),
        ...(layer ? { layer, ...(layerLabel ? { layerLabel } : {}) } : {}),
      }));
      return devOut({
        summary: `[scan] ${page.length}/${total} itens em ${d.pages ?? "?"} página(s)${nextOffset == null && d.reachedEnd ? " (fim da lista)" : ""}${nextOffset != null ? ` — mais: offset=${nextOffset}` : ""}`,
        data: { action: "scan", items, total, offset: off, ...(nextOffset != null ? { nextOffset } : {}), pages: d.pages ?? null, reachedEnd: !!d.reachedEnd },
        telemetry: { execution_time_ms: Date.now() - t0 },
        next: nextOffset != null ? [{ tool: "cv_ubrowser_act", reason: `scan offset=${nextOffset} p/ continuar a lista` }] : [],
      });
    }
    const afterUrl = d.url ?? a.url ?? null;
    const afterTitle = d.title ?? null;
    const beforeUrl = (a.action === "goto" || a.action === "new") && a.url ? String(a.url) : null;
    const urlChanged = !!beforeUrl && !!afterUrl && beforeUrl !== afterUrl;
    const navNewDoc = ["goto", "back", "forward", "new"].includes(a.action);
    const titleChanged = !!afterTitle && (urlChanged || navNewDoc);
    const afterLabel = String(afterTitle ? `${afterTitle} — ${afterUrl || ""}` : (afterUrl || d.selector || d.value || d.text || "ok")).slice(0, 120);
    const diff = urlChanged ? `navegou ${beforeUrl}→${afterUrl}` : (navNewDoc && afterUrl ? `navegou para ${afterLabel}` : `mesma página: ${afterLabel}`);
    // delta pós-ação: o que mudou no DOM (sem re-snapshot). Vazio = sem efeito visível.
    // transients (toast/aviso efêmero) em destaque: o agente vê o aviso sem call extra.
    let deltaNote = "";
    try {
      const dl = d.delta;
      if (dl && typeof dl === "object" && (dl.total > 0 || (Array.isArray(dl.added) && dl.added.length))) {
        const parts = [];
        if (Array.isArray(dl.transients) && dl.transients.length) parts.push(`🔔 aviso: ${dl.transients.slice(0, 3).join(" | ").slice(0, 240)}`);
        if (dl.added && dl.added.length) parts.push(`+${dl.added.length} ${dl.added.slice(0, 3).join(" | ").slice(0, 160)}`);
        if (dl.removed) parts.push(`~${dl.removed} removido(s)`);
        if (dl.txts) parts.push(`${dl.txts} texto(s)`);
        if (dl.attrs) parts.push(`${dl.attrs} attr(s)`);
        if (parts.length) deltaNote = ` | mudou: ${parts.join(", ")}`;
      } else if (dl && typeof dl === "object") {
        deltaNote = " | sem mudança no DOM";
      }
    } catch {}
    // Verificação de clique (content+background): verified/whatChanged/method — o LLM
    // confia sem re-snapshot quando verified:true; quando false, NÃO confia e tenta outro alvo.
    let clickNote = "";
    let verifyFields = {};
    try {
      if ((a.action === "click" || a.action === "cursor") && d && typeof d === "object" && typeof d.verified === "boolean") {
        const wc = Array.isArray(d.whatChanged) ? d.whatChanged : [];
        const meth = d.method || d.via || "?";
        verifyFields = { verified: d.verified, whatChanged: wc, ...(d.method || d.via ? { method: d.method || d.via } : {}), ...(Array.isArray(d.escalations) ? { escalations: d.escalations } : {}) };
        if (d.verified) clickNote = ` | click verified (${wc.join(",") || "?"} via ${meth})`;
        else {
          const esc = Array.isArray(d.escalations) && d.escalations.length ? ` após ${d.escalations.join("→")}` : "";
          clickNote = ` | click UNVERIFIED${esc} — NÃO confie: re-snapshot e tente outro selector/ponto`;
        }
        if (d.childHit) clickNote += ` | aviso: ponto cai em filho (${String(d.childHit).slice(0, 80)} — ex: avatar abre perfil, não o chat)`;
        if (d.trustedFallback) clickNote += ` | trusted falhou (${String(d.trustedFallback).slice(0, 80)}) → sintético`;
        if (d.trustedError) clickNote += ` | trusted errou (${String(d.trustedError).slice(0, 80)})`;
        if (d.resolve) clickNote += ` | resolve=${String(d.resolve).slice(0, 20)} (nó moveu/reciclou — re-snapshot se for agir de novo)`;
      }
    } catch {}
    // expects pós-ação (click/fill/type/select): PASS/FAIL 1 checagem cada, pós-settle.
    // pass = confie sem re-ler; fail = NÃO confie (re-snapshot e ajuste o alvo).
    let expectNote = "";
    let expectFields = {};
    try {
      const ex = d && d.expect;
      if ((a.action === "click" || a.action === "fill" || a.action === "type" || a.action === "select" || a.action === "cursor") && ex && typeof ex === "object") {
        const cks = Array.isArray(ex.checks) ? ex.checks : [];
        expectFields = { expect: ex };
        if (cks.length) {
          if (ex.passed) expectNote = ` | expect PASS (${cks.map((c) => c.name).join(",")})`;
          else {
            const fails = cks.filter((c) => !c.ok).map((c) => c.name + (c.detail ? `: ${String(c.detail).slice(0, 100)}` : "")).join("; ");
            expectNote = ` | expect FAIL — ${fails} — NÃO confie: re-snapshot e ajuste`;
          }
        }
      }
    } catch {}
    // snap:true pós-navegação: top-10 rankeado junto (refs frescas sem call extra).
    let snapNote = "", snapTop = null;
    if (navNewDoc && a.snap && afterUrl) {
      try {
        const sr = await ubSend("tab.snapshot", { tabId: a.tabId, tab: a.tab, max: 40 }, UB_TIMEOUT_MS, tgt.id); // mesmo perfil da ação (multi-perfil)
        const sels = Array.isArray(sr?.data) ? sr.data : (Array.isArray(sr?.data?.items) ? sr.data.items : []);
        if (sr?.ok && sels.length) {
          const ranked = ubSnapRank(sels).slice(0, 10);
          snapTop = ranked.map((el) => `[${el.ref ?? "?"}] ${el.role || el.tag} "${String(el.text || el.name || "").slice(0, 60)}"`);
          snapNote = ` | snap: ${sels.length} interativos (top 10 abaixo)`;
        }
      } catch {}
    }
    // next[] utile: URL mudou = domínio novo → snapshot (refs frescas) vale mais que print.
    const nxtGen = urlChanged
      ? [{ tool: "cv_ubrowser_snapshot", reason: "URL mudou — refs antigas expiraram; mapeie só se precisar agir de novo" }]
      : [];
    const compactExpect = expectFields.expect ? {
      expect: {
        passed: expectFields.expect.passed,
        checks: (expectFields.expect.checks || []).map(({ name, ok }) => ({ name, ok })),
      },
    } : {};
    return devOut({ summary: `[${a.action}] ${diff}${deltaNote}${snapNote}${clickNote}${expectNote}${ubAlertsHint()}`, data: { action: a.action, ok: true, ...(d.title ? { title: d.title } : {}), ...(d.url ? { url: d.url } : {}), ...(d.text || d.value ? { result: trimOut(d.text ?? d.value, 240) } : {}), ...verifyFields, ...compactExpect, ...(snapTop ? { snapshotTop: snapTop } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: nxtGen });
  },
});

reg("cv_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Aba em fundo NÃO imprime — use cv_browser_screenshot headless. Nunca troca de aba. scale:0.5 = metade dos bytes. Confirme visualmente após click/fill importantes. O texto da resposta traz tabId + título/url — aja na mesma aba com act/read sem re-listar tabs.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, scale: { type: "number", enum: [0.5, 1], default: 1, description: "deviceScaleFactor: 0.5 = metade dos bytes" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — obrigatório quando a aba é de outro perfil (tabs traz profile)" } }, required: [] },
  run: async ({ tabId, tab, scale, profile }) => {
    const t0 = Date.now();
    const dsf = Number(scale) === 0.5 ? 0.5 : 1;
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend("tab.shot", { tabId, tab, scale: dsf }, UB_TIMEOUT_MS, tgt.id);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (r.data?.background) return devOut({ status: "error", summary: "Chrome só imprime aba VISÍVEL — traga p/ frente ou use cv_browser_screenshot headless", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // v14 frescor: hash do shot por aba — imagem idêntica à anterior vira aviso, não verde falso.
    try {
      const h = r.data?.hash || null;
      if (h) {
        const key = ubShotCacheKey({ tabId, tab }, r.data);
        const prev = UB_SHOT_LAST.get(key);
        UB_SHOT_LAST.set(key, h);
        if (UB_SHOT_LAST.size > 20) UB_SHOT_LAST.delete(UB_SHOT_LAST.keys().next().value);
        if (prev && prev === h) return devOut({ status: "warn", summary: `imagem idêntica à anterior (hash ${h}) — repita após settle (página pode não ter aquietado) | ${UB_FB}`, data: { hash: h, capturedAt: r.data?.capturedAt || null, tab: r.data?.tab || null }, telemetry: { execution_time_ms: Date.now() - t0 } });
      }
    } catch {}
    const b64 = String(r.data.dataUrl || "").split(",")[1] || "";
    if (!b64) return devOut({ status: "error", summary: `screenshot vazio — traga aba p/ frente e tente de novo | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const kb = Math.round((b64.length * 0.75) / 1024);
    const truncated = b64.length > 1500000;
    const tip = (truncated || kb > 500) ? " — dica: scale:0.5 = metade dos bytes" : "";
    const mime = String(r.data?.mime || "").startsWith("image/") ? String(r.data.mime) : "image/png";
    const tb = (r.data?.tab && typeof r.data.tab === "object") ? r.data.tab : {};
    const tbId = tb.id !== undefined && tb.id !== null ? `tabId ${tb.id} — aja nesta aba (act/read aceitam tabId:${tb.id})` : "";
    return { content: [{ type: "text", text: `Screenshot ${tb.title || ""} — ${tb.url || ""} (${kb} kB base64${truncated ? ", truncado em 1500k chars" : ""})${tip}${tbId ? ` | ${tbId}` : ""}` }, { type: "image", data: truncated ? b64.slice(0, 1500000) : b64, mimeType: mime }] };
  },
});

