const $ = (id) => document.getElementById(id);
const modeHints = {
  observe: "O agente pode consultar abas e páginas, sem alterá-las.",
  navigate: "Pode ler, abrir e navegar entre páginas, sem clicar ou preencher.",
  full: "Pode ler, navegar e interagir com as páginas permitidas."
};
let currentHost = "";
let refreshing = false;
const msg = (value) => { $("feedback").textContent = value; };
function hostname(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ""; } catch { return ""; } }
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [s, tab, d] = await Promise.all([
      chrome.storage.local.get(["token", "enabled", "profileLabel", "actionMode", "accessMode", "allowedSites", "telemetryMode"]),
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((v) => v[0]).catch(() => null),
      chrome.runtime.sendMessage({ cmd: "diag" }).catch(() => null)
    ]);
    const sites = Array.isArray(s.allowedSites) ? s.allowedSites : [];
    const enabled = s.enabled !== false;
    currentHost = hostname(tab?.url);
    $("profile").textContent = s.profileLabel || "perfil sem nome";
    if (document.activeElement !== $("token")) $("token").value = s.token || "";
    if (document.activeElement !== $("label")) $("label").value = s.profileLabel || "";
    $("toggle").textContent = enabled ? "Pausar" : "Ativar";
    $("toggle").classList.toggle("off", !enabled);
    const state = !enabled ? "Pausado" : !s.token ? "Token necessário" : d?.online ? "Conectado" : "Ponte indisponível";
    $("status").textContent = state;
    $("dot").className = "dot " + (!enabled ? "warn" : d?.online && s.token ? "good" : "bad");
    $("statusDetail").textContent = !enabled ? "O agente não recebe comandos neste perfil." : !s.token ? "Abra Conexão e perfil para conectar." : d?.online ? "Comandos do agente chegam a este Chrome." : "Verifique se o serviço local está ativo.";
    $("queue").textContent = d?.online ? "Última resposta " + (d.lastPollOk || "agora") : "Sem resposta recente";
    const mode = ["observe", "navigate", "full"].includes(s.actionMode) ? s.actionMode : "full";
    document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    $("modeHint").textContent = modeHints[mode];
    $("accessMode").value = s.accessMode === "selected" ? "selected" : "all";
    $("telemetryMode").value = s.telemetryMode === "diagnostic" ? "diagnostic" : "fast";
    $("currentSite").firstChild.textContent = currentHost || "Esta aba";
    $("siteState").textContent = !currentHost ? "Abra um site HTTP(S) para permitir" : s.accessMode !== "selected" ? "Incluído em todos os sites" : sites.includes(currentHost) ? "Permitido" : "Fora da lista";
    $("siteButton").disabled = !currentHost;
    $("siteButton").textContent = s.accessMode !== "selected" ? "Só este site" : sites.includes(currentHost) ? "Remover" : "Permitir site";
    $("sites").replaceChildren();
    if (s.accessMode === "selected" && !sites.length) {
      const p = document.createElement("span"); p.className = "empty"; p.textContent = "Nenhum site permitido. O agente não acessa abas."; $("sites").append(p);
    }
    if (s.accessMode === "selected") for (const site of sites) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = site + " ×"; b.title = "Remover " + site;
      b.onclick = async () => { await chrome.storage.local.set({ allowedSites: sites.filter((x) => x !== site) }); await refresh(); };
      $("sites").append(b);
    }
    $("diag").textContent = "polls " + (d?.polls ?? "—") + " · último " + (d?.lastPollOk || "—") + (d?.lastError && d.lastError !== "-" ? " · " + d.lastError : "");
  } finally { refreshing = false; }
}
async function update(patch, notice) { await chrome.storage.local.set(patch); msg(notice); await refresh(); }
document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => update({ actionMode: b.dataset.mode }, "Modo atualizado."));
$("toggle").onclick = async () => { const s = await chrome.storage.local.get("enabled"); await update({ enabled: s.enabled === false }, s.enabled === false ? "Canivete ativado." : "Canivete pausado."); };
$("accessMode").onchange = (e) => update({ accessMode: e.target.value }, e.target.value === "selected" ? "Agora só os sites escolhidos estão disponíveis." : "Todos os sites estão disponíveis.");
$("telemetryMode").onchange = (e) => update({ telemetryMode: e.target.value }, "Captura de diagnóstico atualizada.");
$("siteButton").onclick = async () => {
  if (!currentHost) return;
  const s = await chrome.storage.local.get(["allowedSites", "accessMode"]);
  const sites = Array.isArray(s.allowedSites) ? s.allowedSites : [];
  const has = s.accessMode === "selected" && sites.includes(currentHost);
  await update({ accessMode: "selected", allowedSites: s.accessMode !== "selected" ? [currentHost] : has ? sites.filter((x) => x !== currentHost) : [...sites, currentHost] }, has ? "Site removido." : "Site permitido.");
};
$("addSite").onclick = async () => {
  const raw = $("newSite").value.trim().toLowerCase();
  const site = hostname(/^https?:\/\//.test(raw) ? raw : "https://" + raw);
  if (!site || !/^[a-z0-9.-]+$/.test(site) || site.startsWith(".") || site.endsWith(".")) return msg("Digite um domínio válido, como exemplo.com.");
  const s = await chrome.storage.local.get("allowedSites");
  const sites = Array.isArray(s.allowedSites) ? s.allowedSites : [];
  $("newSite").value = "";
  await update({ accessMode: "selected", allowedSites: [...new Set([...sites, site])] }, site + " permitido.");
};
$("newSite").onkeydown = (e) => { if (e.key === "Enter") $("addSite").click(); };
$("panel").onclick = async () => { const s = await chrome.storage.local.get("url"); await chrome.tabs.create({ url: (s.url || "http://127.0.0.1:19422") + "/painel", active: false }); };
$("mark").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return msg("Abra a página que deseja marcar.");
    const r = await chrome.tabs.sendMessage(tab.id, { cmd: "elem_pick", args: {} });
    msg(r?.ok ? "Clique no elemento quebrado. Esc cancela." : "Não foi possível marcar nesta aba.");
  } catch { msg("Recarregue esta página e tente marcar novamente."); }
};
async function test() {
  msg("Testando conexão…");
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    msg(r?.ok ? "Ponte conectada." : "Ponte recusou: " + (r?.error || r?.http || "sem resposta"));
  } catch { msg("Serviço da extensão sem resposta."); }
  await refresh();
}
$("test").onclick = test;
$("saveToken").onclick = async () => { await chrome.storage.local.set({ token: $("token").value.trim() }); await test(); };
$("saveLabel").onclick = async () => { await update({ profileLabel: $("label").value.trim().slice(0, 60) }, "Nome salvo."); };
$("permissions").onclick = () => chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") refresh().catch(() => {}); });
refresh().catch(() => msg("Não foi possível carregar as configurações."));
