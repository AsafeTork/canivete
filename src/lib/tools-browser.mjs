// canivete — tools do Chrome headless (browser_*)
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { reg, devOut, trimOut, fpath, humanSize, exec } from "./ctx.mjs";
import { probeMeta, mainContent } from "./web.mjs";
import { withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN } from "./cdp.mjs";

reg("n_browser_navigate", {
  description: "Navega com Chrome headless (renderiza JS/SPA) e retorna título+texto+links. cookies:true inclui cookies da página. Ex: {url:\"http://localhost:5173\", waitMs:5000, cookies:true}.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, waitMs: { type: "number", default: 4000 }, cookies: { type: "boolean", description: "Retorna cookies da página via CDP" } }, required: ["url"] },
  run: async ({ url, waitMs, cookies }) => {
    const t0 = Date.now();
    if (!url) return devOut({ status: "error", summary: "url obrigatória", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    try {
      const state = await withCdp(async ({ send }) => { await cdpGoto(send, url, waitMs); const st = await cdpState(send); if (cookies) { try { st.cookies = await cdpCookies(send); } catch (e) { st.cookiesError = e.message; } } return st; }, { url });
      const ms = Date.now() - t0;
      return devOut({ summary: `${state.title || "(sem título)"} — ${state.url || url} (${(state.text || "").length} chars)`, data: { ...state, text: trimOut(state.text || "", 6000), ms }, telemetry: { execution_time_ms: ms }, next: [{ tool: "n_browser_snapshot", reason: "Mapear elementos clicáveis" }, { tool: "n_browser_screenshot", reason: "Evidência visual" }], refs: [] });
    } catch (e) {
      // fallback: dump-dom single-shot (sem CDP)
      const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--virtual-time-budget=5000", "--dump-dom", url], { timeout: 40000 });
      if (!r.so) return devOut({ status: "error", summary: `falha: ${e.message} ${(r.se || "").slice(0, 300)}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const core = mainContent(r.so);
      const text = core.replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1).join("\n").slice(0, 6000);
      const msFb = Date.now() - t0;
      return devOut({ summary: `${probeMeta(r.so)} — ${url} (fallback dump-dom)`, data: { title: probeMeta(r.so), url, text, ms: msFb }, telemetry: { execution_time_ms: msFb } });
    }
  },
});

reg("n_browser_snapshot", {
  description: "Lista elementos interativos da página (ref, tag, texto, selector) para usar em n_browser_act. compact:true retorna só ref|tag|texto sem selector (~60% menos tokens). Ex: {compact:true}.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, max: { type: "number", default: 60 }, compact: { type: "boolean", default: false, description: "Compacto: só ref|tag|texto, sem selector (~60% menos tokens)" } }, required: [] },
  run: async ({ url, max, compact }) => {
    const t0 = Date.now();
    try {
      const els = await withCdp(async ({ send }) => {
        if (url) await cdpGoto(send, url);
        const r = await send("Runtime.evaluate", { expression: PAGE_SNAPSHOT_JS, returnByValue: true }, 15000);
        return r.result?.value || [];
      }, { url });
      const list = els.slice(0, Math.min(Number(max) || 60, 120));
      const isCompact = compact === true;
      const elements = isCompact ? list.map((e) => ({ ref: e.ref, tag: e.tag, text: e.text })) : list;
      const txt = isCompact
        ? list.map((e) => `[${e.ref}] <${e.tag}> ${e.text || "(sem texto)"}`).join("\n") || "(nenhum elemento interativo)"
        : list.map((e) => `[${e.ref}] <${e.tag}> ${e.text || "(sem texto)"} :: ${e.selector}`).join("\n") || "(nenhum elemento interativo)";
      return devOut({ summary: `${list.length} elemento(s) interativo(s)${isCompact ? " (compact)" : ""}`, data: { count: list.length, elements, compact: isCompact }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_browser_act", reason: "Clicar/preencher com selector do snapshot" }] });
    } catch (e) { return devOut({ status: "error", summary: `snapshot falhou: ${e.message}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); }
  },
});

reg("n_browser_act", {
  description: "Interage via CDP: goto/back/forward/reload/click/fill/press/scroll/wait/wait_selector/evaluate. console:true anexa últimos 30 logs (só pós-enable, ~1.5s). Ex: {action:\"wait_selector\", selector:\"#app\"}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "press", "scroll", "wait", "wait_selector", "evaluate"] },
      url: { type: "string" }, selector: { type: "string", description: "CSS (wait_selector só CSS)" }, text: { type: "string" },
      key: { type: "string", description: "Enter|Tab|Escape|ArrowDown..." }, js: { type: "string" },
      ms: { type: "number" }, direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      console: { type: "boolean", description: "Anexa últimos 30 logs console via CDP Log/Runtime (só pós-enable)" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    try {
      const result = await withCdp(async ({ send, ws }) => {
        const withConsole = async (base) => {
          if (!a.console) return base;
          try {
            const logs = await cdpDrainConsole(send, ws, { timeoutMs: 1500, limit: 30 });
            return { ...base, console: logs };
          } catch (e) { return { ...base, console: [], consoleError: `console indisponível: ${e.message} (limite: só logs pós Log/Runtime.enable)` }; }
        };
        const act = a.action;
        if (act === "wait_selector") {
          if (!a.selector) throw new Error("selector obrigatório p/ wait_selector (CSS)");
          const deadline = Date.now() + 15000;
          let found = false;
          while (Date.now() < deadline) {
            const r = await send("Runtime.evaluate", { expression: `!!document.querySelector(${JSON.stringify(a.selector)})`, returnByValue: true }, 5000);
            if (r.result?.value) { found = true; break; }
            await new Promise((r2) => setTimeout(r2, 500));
          }
          if (!found) throw new Error(`timeout 15s esperando: ${a.selector}`);
          return await withConsole({ ...(await cdpState(send)), waited_selector: a.selector });
        }
        if (act === "goto") { if (!a.url) throw new Error("url obrigatória p/ goto"); await cdpGoto(send, a.url, a.waitMs); return await withConsole(await cdpState(send)); }
        if (act === "back" || act === "forward") { const hist = await send("Page.getNavigationHistory"); const i = hist.currentIndex + (act === "back" ? -1 : 1); const e = hist.entries?.[i]; if (!e) throw new Error(`sem histórico p/ ${act}`); await send("Page.navigateToHistoryEntry", { entryId: e.id }); await new Promise((r) => setTimeout(r, 1500)); return await withConsole(await cdpState(send)); }
        if (act === "reload") { await send("Page.reload"); await new Promise((r) => setTimeout(r, 2000)); return await withConsole(await cdpState(send)); }
        if (act === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 2000, 15000))); return await withConsole(await cdpState(send)); }
        if (act === "evaluate") {
          if (!a.js) throw new Error("js obrigatório p/ evaluate");
          const r = await send("Runtime.evaluate", { expression: a.js, returnByValue: true, awaitPromise: true }, 15000);
          return await withConsole({ value: r.result?.value ?? r.result?.description ?? "(ok)", type: r.result?.type });
        }
        if (act === "press") {
          const keyMap = { Enter: { key: "Enter", code: "Enter", winCode: 13 }, Tab: { key: "Tab", code: "Tab", winCode: 9 }, Escape: { key: "Escape", code: "Escape", winCode: 27 } };
          const k = keyMap[a.key] || { key: a.key || "Enter", code: a.key || "Enter", winCode: 13 };
          for (const t of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t === "rawKeyDown" ? "rawKeyDown" : "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.winCode, nativeVirtualKeyCode: k.winCode });
          await new Promise((r) => setTimeout(r, 800));
          return await withConsole(await cdpState(send));
        }
        if (act === "scroll") {
          const dir = a.direction || "down";
          const expr = a.selector
            ? `document.querySelector(${JSON.stringify(a.selector)})?.scrollIntoView({block:'center'})`
            : dir === "top" ? "scrollTo(0,0)" : dir === "bottom" ? "scrollTo(0,document.body.scrollHeight)" : dir === "up" ? "scrollBy(0,-innerHeight*0.8)" : "scrollBy(0,innerHeight*0.8)";
          await send("Runtime.evaluate", { expression: expr, returnByValue: true });
          await new Promise((r) => setTimeout(r, 600));
          return await withConsole(await cdpState(send));
        }
        if (act === "click") {
          if (!a.selector || !String(a.selector).trim()) throw new Error("selector vazio p/ click (CSS ou text=... obrigatório) — rode n_browser_snapshot p/ obter selector válido");
          let beforeUrl = "";
          try {
            const b = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
            beforeUrl = b.result?.value || "";
          } catch {}
          const chk = await send("Runtime.evaluate", { expression: RESOLVE_JS(a.selector), returnByValue: true });
          if (String(chk.result?.value).startsWith("NOTFOUND")) throw new Error(`elemento não encontrado: ${a.selector} — rode n_browser_snapshot`);
          await send("Runtime.evaluate", { expression: `({
            s: ${JSON.stringify(a.selector)},
            el: null,
            find() { const s=this.s; if (s.startsWith('text=')) { const t=s.slice(5).toLowerCase(); return [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')].find(e=>(e.innerText||e.value||'').toLowerCase().includes(t)); } return document.querySelector(s); }
          }.find()?.click(), 'clicked')`, returnByValue: true });
          // Aguarda navegação eventual: poll url até 3s, sai cedo se mudou (sem sleep cego).
          if (beforeUrl) {
            const tEnd = Date.now() + 3000;
            while (Date.now() < tEnd) {
              await new Promise((r) => setTimeout(r, 150));
              try {
                const cur = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
                if (cur.result?.value && cur.result.value !== beforeUrl) break;
              } catch {}
            }
          }
          return await withConsole(await cdpState(send));
        }
        if (act === "fill") {
          if (!a.selector || !String(a.selector).trim()) throw new Error("selector vazio p/ fill (CSS obrigatório) — rode n_browser_snapshot p/ obter selector válido");
          if (a.text === undefined) throw new Error("text obrigatório p/ fill");
          await send("Runtime.evaluate", { expression: `(() => { const s=${JSON.stringify(a.selector)}; const el = s.startsWith('text=') ? null : document.querySelector(s); if(!el) return 'NOTFOUND'; el.focus(); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); return 'FOCUSED:'+el.tagName; })()`, returnByValue: true });
          await send("Input.insertText", { text: String(a.text) });
          await send("Runtime.evaluate", { expression: `(() => { const a=document.activeElement; if(a){ a.dispatchEvent(new Event('input',{bubbles:true})); a.dispatchEvent(new Event('change',{bubbles:true})); } return 'ok'; })()`, returnByValue: true });
          if (a.submit) {
            for (const t of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: t === "rawKeyDown" ? "rawKeyDown" : "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
            await new Promise((r) => setTimeout(r, 1500));
          }
          return await withConsole(await cdpState(send));
        }
        throw new Error(`action desconhecida: ${act}`);
      }, { url: a.action === "goto" ? a.url : undefined });
      const summary = result?.title ? `${result.title} — ${result.url || ""}` : `${a.action} ok${result?.url ? " — " + result.url : ""}`;
      const msAct = Date.now() - t0;
      return devOut({ summary, data: { action: a.action, ...result, text: result?.text ? trimOut(result.text, 3000) : result?.value ?? "", ms: msAct }, telemetry: { execution_time_ms: msAct }, next: [{ tool: "n_browser_screenshot", reason: "Confirmar visualmente a ação" }] });
    } catch (e) { const msErr = Date.now() - t0; return devOut({ status: "error", summary: `act falhou: ${e.message}`, data: { action: a.action, ms: msErr }, telemetry: { execution_time_ms: msErr } }); }
  },
});

reg("n_browser_screenshot", {
  description: "Captura PNG da página ou só de um elemento (selector CSS via clip). Ex: {url:\"http://localhost:5173\", selector:\"#app\"}. Sem url = aba atual.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, width: { type: "number", default: 1280 }, height: { type: "number", default: 800 }, fullPage: { type: "boolean", default: false }, selector: { type: "string", description: "CSS do elemento p/ screenshot recortado (clip via DOM.getBoxModel)" }, scale: { type: "number", enum: [0.5, 1], default: 1, description: "deviceScaleFactor: 0.5 = metade dos bytes" } }, required: [] },
  run: async ({ url, width, height, fullPage, selector, scale }) => {
    const t0 = Date.now();
    const w = Math.min(Math.max(Number(width) || 1280, 320), 2560);
    const h = Math.min(Math.max(Number(height) || 800, 320), 2560);
    const dsf = Number(scale) === 0.5 ? 0.5 : 1;
    if (selector && fullPage) return devOut({ status: "error", summary: "use selector ou fullPage, não ambos", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    try {
      const { b64, state } = await withCdp(async ({ send }) => {
        if (url) await cdpGoto(send, url);
        await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
        if (selector) {
          const clip = await cdpElementClip(send, selector);
          const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true, fromSurface: true }, 20000);
          return { b64: shot.data, state: { ...(await cdpState(send)), clip } };
        }
        const shot = await send("Page.captureScreenshot", fullPage ? { format: "png", captureBeyondViewport: true, fromSurface: true } : { format: "png", fromSurface: true }, 20000);
        return { b64: shot.data, state: await cdpState(send) };
      }, { url });
      const file = shotFile();
      await writeFile(file, Buffer.from(b64, "base64"));
      const payload = { status: "success", summary: `Screenshot ${w}x${h}@${dsf}x${selector ? ` [${selector}]` : ""} — ${state.title || state.url || url || "aba atual"} → ${file}`, data: { file, width: w, height: h, scale: dsf, title: state.title, url: state.url, selector: selector || null, clip: state.clip || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [{ tool: "n_browser_act", reason: "Interagir após ver o layout" }], context_refs: [] };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
    } catch (e) {
      // fallback: --screenshot single-shot
      const file = shotFile();
      const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--window-size=${w},${h}`, `--force-device-scale-factor=${dsf}`, `--screenshot=${file}`, url || "about:blank"], { timeout: 40000 });
      try {
        const st = await stat(file);
        if (st.size > 1000) {
          const b64 = readFileSync(file).toString("base64");
          const payload = { status: "success", summary: `Screenshot (fallback, página cheia — selector ignorado: ${selector || "n/a"}) ${w}x${h}@${dsf}x → ${file}`, data: { file, width: w, height: h, scale: dsf, selectorIgnored: selector || null }, telemetry: { execution_time_ms: Date.now() - t0 }, next_suggested_actions: [], context_refs: [] };
          return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
        }
      } catch {}
      return devOut({ status: "error", summary: `screenshot falhou: ${e.message} ${(r.se || "").slice(0, 300)}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
  },
});

reg("n_browser_pdf", {
  description: "Gera PDF da página via Chrome headless. Quando usar: exportar relatório/página, arquivar evidência. Ex: {url:\"https://example.com\"}. Retorna caminho em /tmp.",
  inputSchema: { type: "object", properties: { url: { type: "string" }, output: { type: "string" } }, required: ["url"] },
  run: async ({ url, output }) => {
    const t0 = Date.now();
    if (!url) return devOut({ status: "error", summary: "url obrigatória", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const file = output ? fpath(output) : join(tmpdir(), `opencode-page-${Date.now().toString(36)}.pdf`);
    const r = await exec(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-pdf-header-footer", `--print-to-pdf=${file}`, url], { timeout: 60000 });
    try {
      const st = await stat(file);
      if (st.size > 1000) return devOut({ summary: `PDF ${humanSize(st.size)} → ${file}`, data: { file, size: st.size, url }, telemetry: { execution_time_ms: Date.now() - t0 } });
    } catch {}
    return devOut({ status: "error", summary: `pdf falhou: ${(r.se || r.so || "arquivo vazio").slice(0, 500)}`, data: { url }, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

// Mesma ponte do MCP "ubrowser" separado (agora fundido aqui): extensão MV3 em
// ~/Downloads/ubrowser-extension fala HTTP long-poll em 127.0.0.1:19422 com token
// (~/.config/opencode/ubrowser/token.txt). Doutrina: acesso TOTAL quando o dono pedir,
// NUNCA destrutivo/idiota sem pedido explícito; alto risco exige `confirm`.

