// ubWA hook — roda no MUNDO MAIN (via chrome.scripting.executeScript, func estática, sem eval).
// Expõe window.__ubWA interligando o Store interno do WhatsApp (padrão venom/wppconnect:
// fisga webpackChunkwhatsapp_web_client, fareja módulos por marcadores e opera na
// camada de dados — sem depender de clique DOM). Bridge com o content via CustomEvent.
(function ubWAHook() {
  if (window.__ubWA && window.__ubWA.ready) return;
  const api = { ready: false, found: {}, errors: [] };
  window.__ubWA = api;
  try {
    const chunkName = Object.keys(window).find(
      (k) => k.indexOf("webpackChunkwhatsapp_web_client") === 0
    );
    if (!chunkName) { api.errors.push("no-chunk"); return; }
    const chunk = window[chunkName];
    let captured = null;
    const probeId = "ubprobe" + Date.now().toString(36);
    chunk.push([[probeId], {}, function (o, e, r) { captured = { o: o, e: e, r: r }; }]);
    if (!captured || !captured.o || !captured.o.m) { api.errors.push("no-modules"); return; }
    const mods = captured.o.m;
    const ids = Object.keys(mods);
    const srcOf = (id) => { try { return mods[id].toString(); } catch (e) { return ""; } };
    const findByMarkers = (markers) => {
      for (const id of ids) {
        const s = srcOf(id);
        if (s && markers.every((m) => s.indexOf(m) !== -1)) return id;
      }
      return null;
    };
    // 1) require genérico (módulo que exporta função require-like costuma ter "call(" + "exports")
    // 2) marcadores conhecidos (várias gerações do WA Web)
    const marks = {
      chatCollection: ["ChatCollection", "getChatById"],
      msgCollection: ["MsgCollection"],
      sendMessage: ["sendTextMessage", "linkPreview"],
      openChat: ["openChatAt", "openChatBottom"],
      widFactory: ["createWid", "isWidlike"],
      contactStore: ["ContactCollection", "getContact"],
    };
    const foundIds = {};
    for (const k of Object.keys(marks)) {
      foundIds[k] = findByMarkers(marks[k]);
      if (foundIds[k]) api.found[k] = foundIds[k];
    }
    // carrega módulos encontrados via require capturado
    const req = captured.r;
    const store = {};
    try { if (foundIds.chatCollection) store.Chat = req(foundIds.chatCollection); } catch (e) { api.errors.push("chat:" + String(e && e.message || e).slice(0, 80)); }
    try { if (foundIds.msgCollection) store.Msg = req(foundIds.msgCollection); } catch (e) { api.errors.push("msg:" + String(e && e.message || e).slice(0, 80)); }
    try { if (foundIds.sendMessage) store.Send = req(foundIds.sendMessage); } catch (e) { api.errors.push("send:" + String(e && e.message || e).slice(0, 80)); }
    try { if (foundIds.openChat) store.Open = req(foundIds.openChat); } catch (e) { api.errors.push("open:" + String(e && e.message || e).slice(0, 80)); }
    try { if (foundIds.widFactory) store.Wid = req(foundIds.widFactory); } catch (e) { api.errors.push("wid:" + String(e && e.message || e).slice(0, 80)); }
    api.store = store;
    api.ready = !!(store.Chat || store.Send);
    if (!api.ready) api.errors.push("nothing-usable");
  } catch (e) {
    api.errors.push("hook:" + String((e && e.message) || e).slice(0, 120));
  }

  // ---- operações de alto nível (usam Store quando dá, senão falham claro) ----
  api.cmd = async function (op, a) {
    a = a || {};
    const S = api.store || {};
    const norm = (s) => String(s || "").toLowerCase();
    if (op === "debug") return { ready: api.ready, found: api.found, errors: api.errors.slice(-5) };
    if (op === "chats") {
      const models = S.Chat && (S.Chat.models || (S.Chat.getModelsArray && S.Chat.getModelsArray()) || []);
      const list = (models || []).slice(0, Number(a.limit) || 30).map((c) => ({
        id: (c.id && (c.id._serialized || c.id)) || "",
        name: c.formattedTitle || c.name || "",
        unread: c.unreadCount || 0,
      }));
      return { chats: list };
    }
    const findChat = (name) => {
      const models = S.Chat && (S.Chat.models || (S.Chat.getModelsArray && S.Chat.getModelsArray()) || []);
      const n = norm(name);
      return (models || []).find((c) => norm(c.formattedTitle || c.name).indexOf(n) !== -1) || null;
    };
    if (op === "open") {
      const chat = findChat(a.name);
      if (!chat) return { opened: false, reason: "chat-not-in-store" };
      const want = String(a.name || "").toLowerCase().split(" ")[0];
      const checkHead = () => {
        const head = document.querySelector('#main header span[dir="auto"]');
        const compose = document.querySelector('#main [data-testid="conversation-compose-box-input"], #main footer div[contenteditable="true"]');
        const title = ((head && head.innerText) || "").trim();
        return head && compose && title.toLowerCase().indexOf(want) !== -1 ? title.slice(0, 80) : null;
      };
      try {
        const p = (function () {
          try {
            if (S.Open && S.Open.openChatAt) return S.Open.openChatAt(chat);
            if (S.Open && S.Open.openChatBottom) return S.Open.openChatBottom(chat);
            if (chat.open) return chat.open();
          } catch (e) { return Promise.reject(e); }
          return Promise.resolve("no-open-fn");
        })();
        // corre SEM travar: 8s p/ abrir, depois verifica header (igual DOM)
        await Promise.race([Promise.resolve(p).catch(() => "err"), new Promise((r) => setTimeout(() => r("timeout"), 8000))]);
      } catch (e) { return { opened: false, reason: "open-threw:" + String((e && e.message) || e).slice(0, 120) }; }
      for (let i = 0; i < 8; i++) {
        const t = checkHead();
        if (t) return { opened: true, title: t };
        await new Promise((r) => setTimeout(r, 1000));
      }
      return { opened: false, reason: "sem-confirmacao" };
    }
    if (op === "read") {
      const chat = findChat(a.name || a.chatId || "");
      const msgs = (chat && chat.msgs && (chat.msgs.models || chat.msgs._models || [])) || [];
      const lim = Math.min(Math.max(Number(a.limit) || 20, 1), 100);
      return {
        messages: msgs.slice(-lim).map((m) => ({
          at: m.t ? new Date(m.t * 1000).toLocaleString() : "",
          from: (m.senderObj && (m.senderObj.formattedTitle || m.senderObj.name)) || (m.id && m.id.fromMe ? "Você" : ""),
          dir: m.id && m.id.fromMe ? "out" : "in",
          text: String(m.body || m.caption || "").slice(0, 500),
        })),
      };
    }
    if (op === "send") {
      const chat = findChat(a.chatName || "");
      if (!chat) return { sent: false, reason: "chat-not-in-store" };
      const text = String(a.text || "").slice(0, 2000);
      if (!text.trim()) return { sent: false, reason: "empty" };
      try {
        if (S.Send) {
          if (S.Send.sendTextMessage) await S.Send.sendTextMessage(chat, text, {});
          else if (S.Send.sendMessage) await S.Send.sendMessage(chat, text, {});
          else if (chat.sendMessage) await chat.sendMessage(text, {});
          else return { sent: false, reason: "no-send-fn" };
        } else if (chat.sendMessage) await chat.sendMessage(text, {});
        else return { sent: false, reason: "no-send-fn" };
      } catch (e) { return { sent: false, reason: "send-threw:" + String((e && e.message) || e).slice(0, 120) }; }
      return { sent: true };
    }
    return { error: "op?" };
  };

  // ---- bridge CustomEvent <-> content script ----
  document.addEventListener("ubwa-cmd", function (ev) {
    const d = (ev && ev.detail) || {};
    Promise.resolve()
      .then(() => api.cmd(d.op, d.args || {}))
      .then((res) => document.dispatchEvent(new CustomEvent("ubwa-resp", { detail: { id: d.id, ok: true, data: res } })))
      .catch((e) => document.dispatchEvent(new CustomEvent("ubwa-resp", { detail: { id: d.id, ok: false, error: String((e && e.message) || e).slice(0, 300) } })));
  });
})();
