// canivete — Android via ADB: conexão WiFi rápida (perfil persistente + reconexão automática)
// e EXTRAÇÃO INTELIGENTE da tela em 1 RTT (uiautomator + dumpsys com marcadores — 1 call =
// o que está na tela do celular, tudo estruturado), controle (tap por texto, teclado, swipe)
// e screenshot. Doutrina: o input do adb É o toque do usuário real no Android (não há "CDP"
// aqui — shell input é o input sintético confiável); destrutivo (install/uninstall/clear)
// exige confirm ≥4 chars. Sem device? erro acionável com os passos de pareamento.
// ENV: CANIVETE_ADB_BIN (binário; padrão "adb" no PATH), CANIVETE_ADB_TMO (timeout base ms,
// 3000-60000, padrão 15000), CANIVETE_CONFIG_DIR (perfil WiFi em <config>/adb.json).
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { reg, devOut, exec } from "./ctx.mjs";

const ADB_BIN = () => process.env.CANIVETE_ADB_BIN || "adb";
const ADB_TMO = () => Math.min(Math.max(Number(process.env.CANIVETE_ADB_TMO) || 15000, 3000), 60000);
const ADB_CFG = () => join(process.env.CANIVETE_CONFIG_DIR || join(homedir(), ".config/canivete"), "adb.json");

const DESTRUCTIVE = /uninstall|clear|wipe|factory|format|reboot|remount/i;

function loadProfile() {
  try { const p = JSON.parse(readFileSync(ADB_CFG(), "utf8")); return p && typeof p === "object" ? p : {}; } catch { return {}; }
}
function saveProfile(prof) {
  try { mkdirSync(dirname(ADB_CFG()), { recursive: true }); writeFileSync(ADB_CFG(), JSON.stringify(prof, null, 1)); } catch {}
}

async function adbRun(args, tmo) {
  const r = await exec(ADB_BIN(), args, { timeout: Math.min(tmo || ADB_TMO(), 300000) });
  return { code: r.code, so: (r.so || "").trim(), se: (r.se || "").trim(), killed: r.killed };
}

// devices: parse de `adb devices -l` → [{serial, state, model, usb}]
async function adbDevices() {
  const r = await adbRun(["devices", "-l"], 10000);
  if (r.code !== 0 && !r.so) return [];
  return r.so.split("\n").slice(1).map((l) => {
    const m = l.trim().match(/^(\S+)\s+(\S+)(.*)$/);
    if (!m) return null;
    const mo = (m[3] || "").match(/model:([^\s]+)/);
    return { serial: m[1], state: m[2], model: mo ? mo[1] : "", usb: /usb:/.test(m[3] || "") };
  }).filter(Boolean);
}

// entrada comum: garante device; sem device → 1 tentativa de reconexão WiFi pelo perfil
// ("ficar conectado rapidamente": o cabo pode sair, a conexão volta sozinha na próxima call).
async function ensureDevice(serial) {
  let devs = await adbDevices();
  let reconnected = false;
  if (!devs.length) {
    const prof = loadProfile();
    if (prof.ip) {
      const c = await adbRun(["connect", `${prof.ip}:${prof.port || 5555}`], 12000);
      devs = await adbDevices();
      if (devs.length) reconnected = true;
      else return { ok: false, summary: `sem device e reconexão WiFi falhou (${c.se || c.so || "timeout"} em ${prof.ip}:${prof.port || 5555}) — ${PAIR_HINT}`, data: { profile: prof } };
    } else {
      return { ok: false, summary: `nenhum device ADB — ${PAIR_HINT}`, data: {} };
    }
  }
  const hit = serial ? devs.find((d) => d.serial === serial || (d.model && d.model.toLowerCase().includes(String(serial).toLowerCase()))) : devs[0];
  if (!hit) return { ok: false, summary: `device "${serial}" não está entre: ${devs.map((d) => d.serial).join(", ")} — passe o serial certo ou omita p/ usar o primeiro`, data: { devices: devs } };
  return { ok: true, dev: hit, devs, reconnected };
}

const PAIR_HINT = "conecte: (a) cabo USB com depuração USB ativa (Opções do desenvolvedor) OU (b) WiFi: Opções do desenvolvedor → Depuração por WiFi → Parear dispositivo com código → n_adb_connect {ip, pairPort, code} (o pairPort é o do diálogo de PAREAMENTO, ≠ porta de conexão) OU cabo→WiFi com n_adb_connect {} (sem args: converte USB→WiFi sozinho)";

// uiautomator XML → elementos [{t,d,cls,id,b:[x,y,w,h],cx,cy,click,scroll,focus}] (cap por max)
function parseUiXml(xml, max) {
  const els = [];
  if (!xml) return els;
  const re = /<node[^>]*>/g;
  let m;
  while ((m = re.exec(xml)) && els.length < (max || 150)) {
    const a = m[0];
    const attr = (k) => { const r = a.match(new RegExp(`${k}="([^"]*)"`)); return r ? r[1] : ""; };
    const b = attr("bounds").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const x1 = +b[1], y1 = +b[2], w = +b[3] - x1, h = +b[4] - y1;
    const t = attr("text"), d = attr("content-desc");
    if (!t && !d && attr("NAF") !== "true" && attr("clickable") !== "true" && attr("scrollable") !== "true") continue;
    els.push({
      t: t.slice(0, 120) || undefined, d: d.slice(0, 120) || undefined,
      cls: attr("class").replace(/^android\.widget\./, "").slice(0, 30),
      id: attr("resource-id").replace(/^.*?:id\//, "") || undefined,
      b: [x1, y1, w, h], cx: x1 + Math.floor(w / 2), cy: y1 + Math.floor(h / 2),
      click: attr("clickable") === "true" || undefined, scroll: attr("scrollable") === "true" || undefined,
    });
  }
  return els;
}

// ---- n_adb_status: devices + versão + perfil WiFi + estado de conexão ----
reg("n_adb_status", {
  description: "Android: devices ADB (USB/WiFi), versão do adb, perfil WiFi salvo e estado de conexão — reconecta sozinho se o perfil existir. Sem device? erro traz os passos de pareamento. Antes de n_adb_extract/act/screen; pareamento WiFi novo via n_adb_connect.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    const t0 = Date.now();
    const g = await ensureDevice();
    const prof = loadProfile();
    const ver = await adbRun(["version"], 8000).catch(() => ({ so: "" }));
    if (!g.ok) return devOut({ status: "error", summary: g.summary, data: { profile: prof.ip ? prof : null, version: (ver.so || "").split("\n")[0] || null }, telemetry: { execution_time_ms: Date.now() - t0 } });
    return devOut({ summary: `${g.devs.length} device(s): ${g.devs.map((d) => `${d.model || "?"}(${d.serial.slice(0, 12)}, ${d.state}${d.usb ? ", usb" : ""})`).join(" · ")}${g.reconnected ? " — reconectado pelo perfil WiFi" : ""}${prof.ip ? ` · perfil: ${prof.ip}:${prof.port || 5555}` : " · sem perfil WiFi"}`, data: { devices: g.devs, profile: prof.ip ? prof : null, version: (ver.so || "").split("\n")[0] || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_extract", reason: "Extrair TUDO da tela em 1 call" }] });
  },
});

// ---- n_adb_connect: USB→WiFi (sem args), pareamento com código, ou reconnect manual ----
reg("n_adb_connect", {
  description: "Conecta ADB por WiFi e SALVA o perfil (reconexão automática dali em diante). {} sem args: device em USB → tcpip 5555 → conecta pelo WiFi da rede (desligue o cabo depois). {ip, port}: conecta direto (port padrão 5555). {ip, pairPort, code}: pareamento com código do diálogo Depuração WiFi (pairPort ≠ port de conexão). Destrutivo não — tcpip reinicia o adbd, tela pisca.",
  inputSchema: { type: "object", properties: { ip: { type: "string", description: "IP do celular na rede (aparece no diálogo Depuração WiFi)" }, port: { type: "number", description: "porta de CONEXÃO (5555 após tcpip; a do diálogo de pareamento NÃO serve aqui)" }, pairPort: { type: "number", description: "porta de PAREAMENTO (diálogo 'Parear dispositivo com código', ex: 37xxx) — só com code" }, code: { type: "string", description: "código de pareamento de 6 dígitos" } }, required: [] },
  run: async ({ ip, port, pairPort, code }) => {
    const t0 = Date.now();
    const prof = loadProfile();
    // 1) pareamento com código (Android 11+)
    if (code) {
      if (!ip || !pairPort) return devOut({ status: "error", summary: `pareamento por código exige ip + pairPort (a porta do diálogo de PAREAMENTO, ex 37xxx — a de conexão é outra) — veja o diálogo "Depuração WiFi" no celular`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const pr = await adbRun(["pair", `${ip}:${pairPort}`, String(code)], 20000);
      if (!/success|paread|paired/i.test(`${pr.so} ${pr.se}`)) return devOut({ status: "error", summary: `adb pair falhou: ${pr.se || pr.so || "sem resposta"} — código expira rápido; refaça o diálogo e tente de novo`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // 2) ip dado (com ou sem code): conecta e salva
    if (ip) {
      const c = await adbRun(["connect", `${ip}:${port || 5555}`], 15000);
      const okMsg = /connected|conectad/i.test(`${c.so} ${c.se}`);
      const devs = await adbDevices();
      if (okMsg && devs.some((d) => d.state === "device")) {
        saveProfile({ ip, port: port || 5555, ts: new Date().toISOString() });
        return devOut({ summary: `conectado por WiFi em ${ip}:${port || 5555} — perfil salvo (reconexão automática nas próximas calls)`, data: { ip, port: port || 5555, devices: devs }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_extract", reason: "Extrair a tela inteira em 1 call" }] });
      }
      return devOut({ status: "error", summary: `connect falhou: ${c.so || c.se || "timeout"} — celular e máquina na MESMA rede? depuração por WiFi ligada? firewall?`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // 3) sem ip: USB→WiFi — tcpip 5555 + descobre IP do wlan0
    const g = await ensureDevice();
    if (!g.ok) return devOut({ status: "error", summary: g.summary, data: { profile: prof.ip ? prof : null }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const S = ["-s", g.dev.serial];
    if (prof.ip) { // perfil existe: tenta conectar direto primeiro
      const c = await adbRun(["connect", `${prof.ip}:${prof.port || 5555}`], 12000);
      const devs = await adbDevices();
      if (devs.some((d) => d.state === "device" && !d.usb)) return devOut({ summary: `reconectado por WiFi em ${prof.ip}:${prof.port || 5555} (perfil salvo)`, data: { devices: devs, profile: prof }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const tcp = await adbRun([...S, "tcpip", "5555"], 15000);
    if (!/restarting|reiniciad/i.test(`${tcp.so} ${tcp.se}`)) return devOut({ status: "error", summary: `tcpip falhou: ${tcp.se || tcp.so || "sem resposta"} — precisa de device em USB p/ ativar a porta WiFi (ou use {ip, port} direto)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const ipr = await adbRun([...S, "shell", "ip -f inet addr show wlan0"], 10000);
    const mip = (ipr.so.match(/inet (\d+\.\d+\.\d+\.\d+)/) || [])[1];
    if (!mip) return devOut({ status: "error", summary: `não achei o IP do wlan0 (${ipr.so || ipr.se || "vazio"}) — celular na rede WiFi? passe {ip} manualmente`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const c = await adbRun(["connect", `${mip}:5555`], 15000);
    const devs = await adbDevices();
    if (devs.some((d) => d.state === "device" && d.serial.includes(":"))) {
      saveProfile({ ip: mip, port: 5555, ts: new Date().toISOString() });
      return devOut({ summary: `USB→WiFi pronto: ${mip}:5555 conectado, perfil salvo — pode DESCONECTAR o cabo (reconexão automática dali em diante)`, data: { ip: mip, port: 5555, devices: devs }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_extract", reason: "Extrair a tela inteira em 1 call" }] });
    }
    return devOut({ status: "error", summary: `tcpip ok mas connect ${mip}:5555 falhou (${c.so || c.se || "timeout"}) — rede bloqueando? espere 2s e repita {ip:"${mip}"}`, data: { ip: mip }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// ---- n_adb_extract: 1 RTT = tela inteira (uiautomator + dumpsys) ----
reg("n_adb_extract", {
  description: "EXTRAÇÃO COMPLETA do Android em 1 call (o n_browser_extract do celular): hierarquia da TELA ATUAL (elementos com texto/desc/coords/centro/clickable — pronto p/ n_adb_act tap), app em foco, resolução, bateria/plugado, apps de usuário, notificações; extras opt-in: media (galeria), files (Downloads), logcat (erros recentes), clipboard (API 29+). Navega? open no act. O toque do adb É o input de usuário real.",
  inputSchema: { type: "object", properties: { serial: { type: "string", description: "serial/modelo do device (vários conectados? padrão = primeiro)" }, max: { type: "number", default: 150, description: "cap de elementos de UI (30-400)" }, fields: { type: "string", description: "csv de extras: media,files,logcat,clipboard (ui+status+apps+notifications sempre vêm)" } }, required: [] },
  run: async ({ serial, max, fields }) => {
    const t0 = Date.now();
    const g = await ensureDevice(serial);
    if (!g.ok) return devOut({ status: "error", summary: g.summary, data: g.data || {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const S = ["-s", g.dev.serial];
    const want = String(fields || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const extra = [];
    if (want.includes("media")) extra.push("echo __MEDIA__; content query --uri content://media/external/images/media --projection _display_name,_size 2>/dev/null | head -14");
    if (want.includes("files")) extra.push("echo __FILES__; ls -t /sdcard/Download 2>/dev/null | head -14");
    if (want.includes("logcat")) extra.push("echo __LOG__; logcat -d -t 150 2>/dev/null | grep -E ' [EF] ' | tail -30");
    if (want.includes("clipboard")) extra.push("echo __CLIP__; cmd clipboard get 2>/dev/null");
    const cmd = [
      "uiautomator dump /sdcard/.cv-ui.xml >/dev/null 2>&1",
      "echo __CUI__; cat /sdcard/.cv-ui.xml 2>/dev/null",
      "rm /sdcard/.cv-ui.xml 2>/dev/null",
      "echo __SIZE__; wm size 2>/dev/null",
      "echo __FOCUS__; dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedWindow' | head -2",
      "echo __BATT__; dumpsys battery 2>/dev/null | grep -E 'level|status|powered|temperature' | head -5",
      "echo __PKG__; pm list packages -3 2>/dev/null | head -250",
      "echo __NOTIF__; dumpsys notification 2>/dev/null | grep -E 'android.title|android.text' | head -40",
      ...extra,
    ].join("; ");
    const r = await adbRun([...S, "shell", cmd], ADB_TMO() + 15000);
    if (!r.so) return devOut({ status: "error", summary: `adb shell sem resposta: ${r.se || r.killed ? "timeout" : "device sumiu?"} — n_adb_status p/ conferir conexão`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const pegar = (tag) => { const mk = "__" + tag + "__"; const i = r.so.indexOf(mk); if (i < 0) return ""; const j = r.so.indexOf("__", i + mk.length); return r.so.slice(i + mk.length, j < 0 ? undefined : j); };
    const xml = pegar("CUI");
    const els = parseUiXml(xml, Math.min(Math.max(Number(max) || 150, 30), 400));
    const size = ((pegar("SIZE").match(/(\d+)x(\d+)/) || []).slice(1).map(Number)) || [null, null];
    const focus = (pegar("FOCUS").match(/(?:mCurrentFocus|mFocusedWindow)=?([^\n]+)/) || [])[1] || "";
    const batt = {};
    for (const l of pegar("BATT").split("\n")) { const kv = l.trim().match(/^(\w+):\s*(\d+)/); if (kv) batt[kv[1]] = +kv[2]; }
    const apps = pegar("PKG").split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean);
    const notif = pegar("NOTIF").split("\n").map((l) => l.trim().replace(/^.*?android\.(title|text)=/, (mm, k) => `${k}: `)).filter((l) => l && !/^null/.test(l)).slice(0, 20);
    const out = { serial: g.dev.serial, model: g.dev.model || null, reconnected: g.reconnected || undefined, screen: { w: size[0], h: size[1], app: focus.slice(0, 120) }, battery: { level: batt.level ?? null, plugged: batt.powered ?? null, temp: batt.temperature ? batt.temperature / 10 : null }, ui: els, apps, notifications: notif, note: els.length ? null : "ui vazio — tela bloqueada? desbloqueie e repita (uiautomator não lê lockscreen)" };
    if (want.includes("media")) out.media = pegar("MEDIA").split("\n").map((l) => l.replace(/^Row: \d+ /, "").trim()).filter(Boolean).slice(0, 14);
    if (want.includes("files")) out.files = pegar("FILES").split("\n").filter(Boolean).slice(0, 14);
    if (want.includes("logcat")) out.logcat = pegar("LOG").split("\n").filter(Boolean).slice(0, 30);
    if (want.includes("clipboard")) out.clipboard = pegar("CLIP").slice(0, 400) || null;
    return devOut({ summary: `${out.model || g.dev.serial} · ${out.screen.app || "app?"} · ${els.length} elemento(s) na tela${out.battery.level != null ? ` · bateria ${out.battery.level}%` : ""}${apps.length ? ` · ${apps.length} apps` : ""}${notif.length ? ` · ${notif.length} notificações` : ""}${g.reconnected ? " (reconectado WiFi)" : ""} — extraído em 1 call`, data: out, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_act", reason: "tocar por texto/coords na tela extraída" }] });
  },
});

// ---- n_adb_act: controle (tap por texto!, text, key, swipe, open, pull/push, install...) ----
reg("n_adb_act", {
  description: "AGE no Android: tap (por x/y OU text=\"rótulo\" — acha na tela e toca o centro, 1 call), text (digita, espaços viram %s), key (BACK/HOME/ENTER/DEL/VOLUP/…), swipe {x,y,x2,y2,ms}, open {pkg}, install/uninstall/clear {pkg, confirm:\"<frase>\"} (DESTRUTIVO exige confirm ≥4 chars), pull/push {local, remote}, wake. Depois: n_adb_extract p/ ver o efeito (delta). O toque do adb É o input de usuário real.",
  inputSchema: { type: "object", properties: { serial: { type: "string" }, action: { type: "string", enum: ["tap", "text", "key", "swipe", "open", "install", "uninstall", "clear", "pull", "push", "wake"], description: "tap x/y ou text=\"rótulo\" · text {text} · key {key: BACK|HOME|ENTER|DEL|TAB|VOLUP|VOLDOWN|POWER} · swipe {x,y,x2,y2,ms} · open {pkg} · install {local, confirm} · uninstall/clear {pkg, confirm} · pull/push {local, remote} · wake" }, x: { type: "number" }, y: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, ms: { type: "number", description: "duração do swipe (padrão 300)" }, text: { type: "string", description: "tap: rótulo na tela (texto ou content-desc) · text: string a digitar" }, key: { type: "string" }, pkg: { type: "string" }, local: { type: "string" }, remote: { type: "string" }, confirm: { type: "string", description: "frase ≥4 chars p/ destrutivo (install/uninstall/clear)" } }, required: ["action"] },
  run: async (a) => {
    const t0 = Date.now();
    if (DESTRUCTIVE.test(a.action) && !(a.confirm && String(a.confirm).trim().length >= 4))
      return devOut({ status: "error", summary: `action "${a.action}" mexe com dados/apps do celular — exige confirm:"<frase ≥4 chars>" (doutrina do dono: destrutivo só com confirmação)`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const g = await ensureDevice(a.serial);
    if (!g.ok) return devOut({ status: "error", summary: g.summary, data: g.data || {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const S = ["-s", g.dev.serial];
    const sh = (c, tmo) => adbRun([...S, "shell", c], tmo);
    let summary = "", data = { action: a.action };
    try {
      if (a.action === "tap") {
        if (a.x == null && a.text) { // acha por texto/desc na tela ATUAL e toca o centro
          const d = await sh("uiautomator dump /sdcard/.cv-ui.xml >/dev/null 2>&1; cat /sdcard/.cv-ui.xml 2>/dev/null; rm /sdcard/.cv-ui.xml 2>/dev/null", 15000);
          const els = parseUiXml(d.so, 300);
          const alvo = a.text.toLowerCase();
          const hit = els.find((e) => (e.t || "").toLowerCase().includes(alvo) || (e.d || "").toLowerCase().includes(alvo));
          if (!hit) return devOut({ status: "error", summary: `nenhum elemento com "${a.text}" na tela — n_adb_extract lista o que existe (texto pode mudar após scroll; content-desc às vezes é o rótulo)`, data: { elementos: els.length }, telemetry: { execution_time_ms: Date.now() - t0 } });
          a.x = hit.cx; a.y = hit.cy;
          data.hit = { t: hit.t || hit.d, b: hit.b, cls: hit.cls };
        }
        if (a.x == null || a.y == null) return devOut({ status: "error", summary: "tap precisa {x,y} OU {text:\"rótulo na tela\"}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await sh(`input tap ${Math.round(a.x)} ${Math.round(a.y)}`);
        summary = `tap ${Math.round(a.x)},${Math.round(a.y)}${data.hit ? ` (alvo "${data.hit.t}")` : ""} — ${r.code === 0 ? "enviado" : `falhou: ${r.se || "rc " + r.code}`}`;
      } else if (a.action === "text") {
        if (!a.text) return devOut({ status: "error", summary: "text precisa {text}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        // shell do device é outra camada de shell: allowlist de caracteres seguros (espaço → %s,
        // resto fora da lista descartado) — aspas/backtick/$/; etc. nunca chegam ao device.
        const txt = String(a.text).replace(/ /g, "%s").replace(/[^A-Za-z0-9%.,:!?@#*+=_/-]/g, "");
        const r = await sh(`input text ${txt}`);
        summary = `texto digitado (${String(a.text).length} chars) — ${r.code === 0 ? "enviado (campo em foco? confira no extract)" : `falhou: ${r.se || "rc " + r.code}`}`;
      } else if (a.action === "key") {
        const KEY = { back: 4, home: 3, enter: 66, del: 67, tab: 61, up: 19, down: 20, left: 21, right: 22, volup: 24, voldown: 25, power: 26, menu: 82, recents: 187 };
        const kc = KEY[String(a.key || "").toLowerCase()] ?? (Number.isInteger(+a.key) ? +a.key : null);
        if (kc == null) return devOut({ status: "error", summary: `key "${a.key}" desconhecida — use ${Object.keys(KEY).join("|")} ou keyevent numérico`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await sh(`input keyevent ${kc}`);
        summary = `keyevent ${a.key}(${kc}) — ${r.code === 0 ? "enviado" : `falhou: ${r.se || "rc " + r.code}`}`;
      } else if (a.action === "swipe") {
        if ([a.x, a.y, a.x2, a.y2].some((v) => v == null)) return devOut({ status: "error", summary: "swipe precisa {x,y,x2,y2[,ms]}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        await sh(`input swipe ${Math.round(a.x)} ${Math.round(a.y)} ${Math.round(a.x2)} ${Math.round(a.y2)} ${Math.round(Number(a.ms) || 300)}`);
        summary = `swipe ${Math.round(a.x)},${Math.round(a.y)} → ${Math.round(a.x2)},${Math.round(a.y2)} enviado`;
      } else if (a.action === "open") {
        if (!a.pkg) return devOut({ status: "error", summary: "open precisa {pkg} — lista em n_adb_extract (apps)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await sh(`monkey -p ${String(a.pkg).replace(/[^A-Za-z0-9._]/g, "")} -c android.intent.category.LAUNCHER 1`, 20000);
        summary = `open ${a.pkg} — ${/Events injected: 1/i.test(r.so) ? "aberto" : `falhou: ${(r.so || r.se).split("\n")[0] || "rc " + r.code}`}`;
      } else if (a.action === "install") {
        if (!a.local) return devOut({ status: "error", summary: "install precisa {local: caminho do .apk, confirm}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await adbRun([...S, "install", "-r", a.local], 120000);
        summary = `install ${a.local} — ${/Success|sucesso/i.test(r.so) ? "OK" : r.se || r.so || "falhou"}`;
      } else if (a.action === "uninstall") {
        if (!a.pkg) return devOut({ status: "error", summary: "uninstall precisa {pkg, confirm}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await adbRun([...S, "uninstall", String(a.pkg).replace(/[^A-Za-z0-9._]/g, "")], 60000);
        summary = `uninstall ${a.pkg} — ${/Success/i.test(r.so) ? "OK" : r.se || r.so || "falhou"}`;
      } else if (a.action === "clear") {
        if (!a.pkg) return devOut({ status: "error", summary: "clear precisa {pkg, confirm}", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await sh(`pm clear ${String(a.pkg).replace(/[^A-Za-z0-9._]/g, "")}`);
        summary = `pm clear ${a.pkg} — ${/Success/i.test(r.so) ? "dados apagados" : r.se || r.so || "falhou"}`;
      } else if (a.action === "pull" || a.action === "push") {
        if (!a.local || !a.remote) return devOut({ status: "error", summary: `${a.action} precisa {local, remote}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        const r = await adbRun(a.action === "pull" ? [...S, "pull", a.remote, a.local] : [...S, "push", a.local, a.remote], 120000);
        summary = `${a.action} — ${r.code === 0 ? `${r.so.split("\n")[0] || "OK"}` : r.se || "falhou"}`;
      } else if (a.action === "wake") {
        await sh("input keyevent KEYCODE_WAKEUP");
        summary = "wake enviado (tela acordada)";
      } else return devOut({ status: "error", summary: `action "${a.action}" desconhecida`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    } finally {
      try { await adbRun([...S, "shell", "rm -f /sdcard/.cv-ui.xml"], 5000); } catch {}
    }
    return devOut({ summary, data, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_extract", reason: "Ver o efeito na tela (delta)" }] });
  },
});

// ---- n_adb_screen: screenshot → PNG no disco (agente lê a imagem e VÊ a tela) ----
reg("n_adb_screen", {
  description: "Screenshot do Android → PNG no disco (leia o arquivo p/ VER a tela; o extract dá a estrutura, a imagem dá o visual). Ex: {} · {serial}. Destrutivo não — cria arquivo só nosso em /sdcard e remove em seguida.",
  inputSchema: { type: "object", properties: { serial: { type: "string" } }, required: [] },
  run: async ({ serial }) => {
    const t0 = Date.now();
    const g = await ensureDevice(serial);
    if (!g.ok) return devOut({ status: "error", summary: g.summary, data: g.data || {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const S = ["-s", g.dev.serial];
    const rem = "/sdcard/.cv-shot.png";
    const f = join(tmpdir(), `opencode-adb-${Date.now().toString(36)}.png`);
    const cap = await adbRun([...S, "shell", `screencap -p ${rem}`], 20000);
    if (cap.code !== 0) return devOut({ status: "error", summary: `screencap falhou: ${cap.se || "sem resposta"} — tela bloqueada não impede, mas device sumido sim (n_adb_status)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const pull = await adbRun([...S, "pull", rem, f], 30000);
    try { await adbRun([...S, "shell", `rm -f ${rem}`], 5000); } catch {}
    if (pull.code !== 0) return devOut({ status: "error", summary: `pull falhou: ${pull.se || pull.so || "timeout"} — tente de novo (WiFi lento?)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const bytes = (await import("node:fs")).statSync(f).size;
    return devOut({ summary: `screenshot ${bytes}B → ${f} — leia o arquivo p/ ver a tela`, data: { file: f, bytes, serial: g.dev.serial }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_adb_extract", reason: "Estrutura dos elementos da tela" }] });
  },
});
