async function refresh() {
  const s = await chrome.storage.local.get(["token", "enabled", "profileLabel"]);
  const on = s.enabled !== false && !!s.token;
  document.getElementById("dot").className = on ? "on" : "off";
  const tg = document.getElementById("toggle");
  if (tg) tg.textContent = on ? "Pausar" : "Ativar";
  document.getElementById("status").textContent = !s.token
    ? "Sem ponte. Cole o token do token.txt."
    : s.enabled !== false ? "Ligado — age no seu navegador só quando você pedir." : "Pausado — o agente não vê nem toca.";
  if (s.token) document.getElementById("token").value = s.token;
  const li = document.getElementById("label");
  if (li && document.activeElement !== li) li.value = (s.profileLabel || "").slice(0, 60);
  try {
    const st = await chrome.runtime.sendMessage({ cmd: "status" });
    document.getElementById("client").textContent = "cliente " + (st && st.clientId ? String(st.clientId).slice(0, 12) + "…" : "—");
  } catch { document.getElementById("client").textContent = "cliente — (service worker dormente)"; }
}
document.getElementById("save").onclick = async () => {
  const btn = document.getElementById("save");
  const token = document.getElementById("token").value.trim();
  await chrome.storage.local.set({ token });
  await refresh();
  // valida de verdade (Salvar sozinho aceitava qualquer texto — falso verde):
  const d = document.getElementById("diag");
  btn.disabled = true; btn.textContent = "Verificando…"; d.textContent = "";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    btn.textContent = r.ok ? "Ponte viva ✓" : "Recusado";
    d.textContent = r.ok ? "" : (r.error || r.http);
  } catch (e) { btn.textContent = "Sem resposta"; d.textContent = "service worker dormente — tente de novo em 1 min"; }
  setTimeout(() => { btn.disabled = false; btn.textContent = "Salvar token"; }, 2500);
};
document.getElementById("toggle").onclick = async () => {
  const s = await chrome.storage.local.get(["enabled"]);
  await chrome.storage.local.set({ enabled: !(s.enabled !== false) });
  refresh();
};
// marcação humana de elemento: liga o picker na aba ativa (o report vai p/ a ponte no "Marcar")
document.getElementById("mark").onclick = async () => {
  const d = document.getElementById("diag");
  d.textContent = "abrindo marcação…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) { d.textContent = "sem aba ativa"; return; }
    const r = await chrome.tabs.sendMessage(tab.id, { cmd: "elem_pick", args: {} });
    d.textContent = (r && r.ok)
      ? "clique no elemento quebrado — Esc cancela"
      : ("falha: " + ((r && r.error) || "sem resposta"));
  } catch (e) { d.textContent = "esta aba ainda não tem o canivete — recarregue (F5) e tente"; }
};
// painel de observabilidade na ponte — abre em aba nova (nunca rouba a aba ativa)
document.getElementById("painel").onclick = async () => {
  const s = await chrome.storage.local.get("url");
  chrome.tabs.create({ url: (s.url || "http://127.0.0.1:19422") + "/painel" });
};
document.getElementById("test").onclick = async () => {
  const d = document.getElementById("diag");
  d.textContent = "testando…";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    d.textContent = r.ok
      ? ("ponte viva — HTTP " + r.http + " · " + (r.clientId ? "cliente " + String(r.clientId).slice(0, 8) + "…" : "sem cliente"))
      : ("ponte recusou — " + (r.error || r.http));
  } catch (e) { d.textContent = "service worker dormente — tente de novo em 1 min"; }
};
// nome do perfil: persiste e manda hello de teste na mesma tacada (rota p/ multi-perfil)
document.getElementById("saveLabel").onclick = async () => {
  const label = document.getElementById("label").value.trim().slice(0, 60);
  await chrome.storage.local.set({ profileLabel: label });
  refresh();
  const d = document.getElementById("diag");
  d.textContent = "salvando…";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    d.textContent = r.ok
      ? ("'" + (label || "sem nome") + "' salvo · " + (r.clientId ? "cliente " + String(r.clientId).slice(0, 8) + "…" : "sem cliente"))
      : ("ponte recusou — " + (r.error || r.http));
  } catch (e) { d.textContent = "service worker dormente — tente de novo em 1 min"; }
};
(async () => {
  const s = await chrome.storage.local.get(["diag"]);
  if (s.diag) document.getElementById("diag").textContent =
    `polls:${s.diag.polls} · último ok ${s.diag.lastPollOk}${s.diag.lastError ? " · erro: " + s.diag.lastError : ""}`;
})();
refresh();
