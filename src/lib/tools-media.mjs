// canivete — mídia LOCAL (ffprobe/ffmpeg no disco; nada sai da máquina — report rmvzvs4n2)
// Análise de áudio p/ montagem de vídeo: duração, codec, loudness LUFS (ebur128) e mapa de
// silêncios (pontos de corte). Proveniência explícita: leitura local, zero upload.
import { statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reg, devOut, fpath, exec, humanSize } from "./ctx.mjs";

// Summary do ebur128 (stderr): "I:  -19.5 LUFS", "Threshold: -29.6 LUFS", "True peak: -1.2 dBTP".
// Formato novo (ffmpeg 5+): bloco "True peak:\n  Peak: -2.9 dBFS" — o valor NÃO fica na mesma linha.
function parseLoudness(se) {
  const grab = (re) => {
    let m, last = null;
    while ((m = re.exec(se))) last = m[1];
    return last == null ? null : Number(last);
  };
  const integrado = grab(/I:\s+(-?\d+(?:\.\d+)?)\s*LUFS/g);
  const limiar = grab(/Threshold:\s+(-?\d+(?:\.\d+)?)\s*LUFS/g);
  let pico = grab(/True peak:\s+(-?\d+(?:\.\d+)?)\s*dBTP/gi);
  if (pico == null) pico = grab(/True peak:\s*\n\s*Peak:\s+(-?\d+(?:\.\d+)?)\s*dBFS/gi);
  if (pico == null) pico = grab(/TPK:\s+(-?\d+(?:\.\d+)?)\s*dBFS/gi);
  return { integrado_lufs: integrado, limiar_lufs: limiar, pico_true_dbtp: pico };
}

reg("cv_audio_analyze", {
  description: "Analisa áudio LOCAL p/ montagem de vídeo (ffprobe+ffmpeg no disco — NADA sai da máquina): duração, codec/canais, loudness LUFS (ebur128) e mapa de silêncios = pontos de corte naturais. O silêncio é da MIXAGEM: música pode mascarar pausas de fala. Aceita mp3/wav/m4a/ogg/flac ou vídeo (usa a trilha). Ex: {path:\"narração.mp3\", silenceDb:-35}.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "arquivo de áudio (ou vídeo com trilha) — absoluto, ~/ ou relativo ao cwd" },
      silenceDb: { type: "number", default: -35, description: "limiar de silêncio em dB (mais negativo = só conta silêncio bem mudo)" },
      minSilence: { type: "number", default: 0.35, description: "duração mínima do silêncio em segundos (cortes menores que isso nem aparecem)" },
    },
    required: ["path"],
  },
  run: async ({ path: p, silenceDb, minSilence } = {}) => {
    const t0 = Date.now();
    let file;
    try {
      file = fpath(p);
      const st = statSync(file);
      if (!st.isFile()) throw new Error("não é arquivo");
    } catch (e) {
      return devOut({ status: "error", summary: `arquivo não encontrado: ${file || p} (${e.message}) — use path absoluto, ~/ ou relativo`, data: { path: String(p) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const db = Math.min(Math.max(Number(silenceDb) || -35, -90), -5);
    const mind = Math.max(Number(minSilence) || 0.35, 0.05);
    // 1) metadados (ffprobe)
    const pr = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeout: 30000 });
    if (pr.code !== 0) return devOut({ status: "error", summary: `ffprobe falhou: ${(pr.se || pr.error || "").slice(0, 200)}`, data: { file }, telemetry: { execution_time_ms: Date.now() - t0 } });
    let j;
    try { j = JSON.parse(pr.so || "{}"); } catch { return devOut({ status: "error", summary: "ffprobe devolveu JSON inválido", data: { file }, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const a = (j.streams || []).find((s) => s.codec_type === "audio");
    if (!a) return devOut({ status: "error", summary: "sem stream de ÁUDIO nesse arquivo — é imagem/pdf? aponte o arquivo que contém a trilha", data: { file, streams: (j.streams || []).map((s) => s.codec_type) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const dur = Number(j.format?.duration || a.duration) || 0;
    const formato = {
      codec: a.codec_name || null,
      sample_rate: a.sample_rate ? Number(a.sample_rate) : null,
      canais: a.channels || null,
      bitrate: Number(j.format?.bit_rate || a.bit_rate) || null,
      tamanho: humanSize(Number(j.format?.size) || 0),
      container: j.format?.format_name || null,
    };
    // 2) mapa de silêncios (ffmpeg silencedetect — stderr)
    const sil = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${db}dB:d=${mind}`, "-f", "null", "-"], { timeout: 180000 });
    const starts = [], ends = [];
    let m;
    const reS = /silence_start:\s*(-?\d+(?:\.\d+)?)/g, reE = /silence_end:\s*(-?\d+(?:\.\d+)?)\s*(?:\|\s*silence_duration:\s*(\d+(?:\.\d+)?))?/g;
    while ((m = reS.exec(sil.se))) starts.push(Number(m[1]));
    while ((m = reE.exec(sil.se))) ends.push(Number(m[1]));
    const silencios = [];
    for (let i = 0; i < starts.length; i++) {
      const ini = Math.max(starts[i], 0);
      const fim = ends[i] != null ? ends[i] : dur; // start sem end = silêncio vai até o fim
      silencios.push({ inicio_s: Number(ini.toFixed(2)), fim_s: Number(fim.toFixed(2)), duracao_s: Number((fim - ini).toFixed(2)) });
    }
    const totalSil = silencios.reduce((s, x) => s + x.duracao_s, 0);
    // 3) loudness (ebur128 — padrão de mixagem p/ vídeo)
    const eb = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { timeout: 180000 });
    const loud = parseLoudness(eb.se || "");
    // 4) sugestões de corte (proveniência: tudo derivado dos 3 passos acima, local)
    const sugestoes = [];
    if (silencios.length >= 2) {
      const cortes = silencios.slice(0, 4).map((s) => `${s.inicio_s.toFixed(1)}s`);
      sugestoes.push(`cortes naturais nos silêncios: ${cortes.join(", ")} — ffmpeg -ss/-to ou trim por trecho`);
    }
    if (loud.integrado_lufs != null && loud.integrado_lufs > -14) sugestoes.push(`loudness ${loud.integrado_lufs} LUFS acima do padrão de vídeo (-14 LUFS) — normalize: ffmpeg -af loudnorm=I=-14:TP=-1.5`);
    if (loud.integrado_lufs != null && loud.integrado_lufs < -20) sugestoes.push(`loudness ${loud.integrado_lufs} LUFS abaixo do padrão de vídeo (-14 LUFS) — ganho: ffmpeg -af loudnorm=I=-14:TP=-1.5`);
    if (dur > 0 && totalSil / dur > 0.35) sugestoes.push(`${Math.round((totalSil / dur) * 100)}% do arquivo é silêncio (${totalSil.toFixed(1)}s) — considere remover os longos (>= ${mind}s listados)`);
    // silencedetect mede a MIXAGEM: trilha/música mantém o nível acima do limiar mesmo
    // quando não há fala. dur - silêncio NÃO é duração de fala (report rmwt6u9v3).
    if (!sugestoes.length) sugestoes.push("sem cortes por silêncio detectados e loudness no padrão — NÃO declare pronto: trilha pode mascarar pausas de fala; confirme por transcrição/escuta");
    if (silencios.length === 0 && dur > 0) sugestoes.push(`nenhum silêncio >= ${mind}s @ ${db}dB na MIXAGEM — isso NÃO prova fala contínua (música/efeitos contam como áudio)`);
    return devOut({
      status: "success",
      summary: `áudio ${dur.toFixed(1)}s — ${silencios.length} silêncio(s) >= ${mind}s @ ${db}dB, ${loud.integrado_lufs ?? "?"} LUFS, ${formato.codec} ${formato.sample_rate || "?"}Hz ${formato.canais || "?"}ch — processado LOCAL (nada enviado) → ${file}`,
      data: { file, duracao_s: Number(dur.toFixed(2)), formato, loudness: loud, total_silencio_s: Number(totalSil.toFixed(2)), duracao_sem_silencio_da_mixagem_s: Number((dur - totalSil).toFixed(2)), medida: "silêncio e loudness são da MIXAGEM (voz + música + efeitos); não há detecção de atividade vocal — não use para afirmar duração de fala", silencios: silencios.slice(0, 60), silencios_ocultos: Math.max(0, silencios.length - 60), sugestoes, processamento: "local (ffprobe+ffmpeg) — proveniência: nenhum byte saiu da máquina" },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "cv_bash", reason: "Cortar nos pontos sugeridos (ffmpeg -ss/-to) ou normalizar (loudnorm)" }, { tool: "cv_browser_screencast", reason: "Gravar a tela da demo pra juntar com o áudio na montagem" }],
    });
  },
});

//Locução LOCAL (report rmwt6q2w5): eSpeak roda no disco, zero custo, nenhum byte
//sai da máquina. A voz é ROBÓTICA — serve p/ rascunho, timing e CTA provisório;
//para locução final é preciso modelo neural (piper/coqui), indisponível aqui.
//Cada frase é sintetizada separadamente e concatenada: isso dá timestamps reais.
reg("cv_audio_synthesize", {
  description: "Gera locução LOCAL com eSpeak (GPL-2+, roda no disco — NADA é enviado, custo R$ 0). Voz ROBÓTICA: use p/ rascunho/timing/CTA provisório, não locução final. Ex: {text:\"Olá, veja o diagnóstico\", voice:\"pt-br\", format:\"wav\"}.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "texto falado (até 4000 chars; quebrado em frases para timestamps)" },
      voice: { type: "string", default: "pt-br", description: "voz eSpeak (pt-br, pt-pt, en-us, ...)" },
      rate: { type: "number", default: 160, description: "palavras por minuto (80-300)" },
      pitch: { type: "number", default: 50, description: "tom da voz (0-99)" },
      format: { type: "string", enum: ["wav", "mp3"], default: "wav" },
      out: { type: "string", description: "arquivo de saída .wav/.mp3 (default: /tmp/opencode/locucao-<id>.<format>)" },
    },
    required: ["text"],
  },
  run: async ({ text, voice, rate, pitch, format, out } = {}) => {
    const t0 = Date.now();
    const txt = String(text || "").trim();
    if (!txt) return devOut({ status: "error", summary: "text vazio — passe text com a locução desejada", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (txt.length > 4000) return devOut({ status: "error", summary: `text com ${txt.length} chars (teto 4000) — divida a locução em chamadas`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const fmt = format === "mp3" ? "mp3" : "wav";
    const v = String(voice || "pt-br").slice(0, 40);
    const spd = Math.min(Math.max(Math.round(Number(rate) || 160), 80), 300);
    const pit = Math.min(Math.max(Math.round(Number(pitch) || 50), 0), 99);
    let file;
    try { file = out ? fpath(String(out)) : join(tmpdir(), `locucao-${Date.now().toString(36)}.${fmt}`); }
    catch (e) { return devOut({ status: "error", summary: `out inválido: ${e.message}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const tmp = mkdtempSync(join(tmpdir(), "canivete-tts-"));
    try {
      // quebra em frases curtas; cada uma vira um WAV com duração medida via ffprobe.
      const frases = txt.split(/(?<=[.!?;:])\s+|\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 80);
      const partes = [];
      let acc = 0;
      for (let i = 0; i < frases.length; i++) {
        const wav = join(tmp, `p${i}.wav`);
        const r = await exec("espeak", ["-v", v, "-s", String(spd), "-p", String(pit), "-w", wav, frases[i]], { timeout: 30000 });
        if (r.code !== 0) return devOut({ status: "error", summary: `espeak falhou na frase ${i + 1}: ${(r.se || r.error || "").slice(0, 200)}`, data: { voice: v, frase: frases[i].slice(0, 80) }, telemetry: { execution_time_ms: Date.now() - t0 } });
        const pr = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", wav], { timeout: 15000 });
        let d = 0;
        try { d = Number(JSON.parse(pr.so || "{}").format?.duration) || 0; } catch {}
        partes.push({ frase: frases[i].slice(0, 200), arquivo: wav, inicio_s: Number(acc.toFixed(2)), fim_s: Number((acc + d).toFixed(2)), duracao_s: Number(d.toFixed(2)) });
        acc += d;
      }
      const lista = join(tmp, "lista.txt");
      writeFileSync(lista, partes.map((p) => `file '${p.arquivo}'`).join("\n"));
      const ff = ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista];
      const fc = fmt === "mp3"
        ? await exec("ffmpeg", [...ff, "-c:a", "libmp3lame", "-q:a", "4", "-y", file], { timeout: 60000 })
        : await exec("ffmpeg", [...ff, "-c", "copy", "-y", file], { timeout: 60000 });
      if (fc.code !== 0) return devOut({ status: "error", summary: `ffmpeg falhou ao montar ${fmt}: ${(fc.se || fc.error || "").slice(0, 240)}`, data: { file, frases: partes.length }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const st = statSync(file);
      return devOut({
        status: "success",
        summary: `locução local: ${partes.length} frase(s), ${acc.toFixed(1)}s, ${v} ${spd}wpm — ${fmt} ${humanSize(st.size)} em ${file} (custo R$ 0; voz robótica)`,
        data: {
          file, formato: fmt, voz: v, rate_wpm: spd, pitch: pit, duracao_s: Number(acc.toFixed(2)), bytes: st.size,
          custo: { moeda: "BRL", valor: 0, motivo: "síntese local (eSpeak) — nenhum byte saiu da máquina" },
          proveniencia: { motor: "eSpeak 1.48.15", licenca: "GPL-2+ (/usr/share/doc/espeak/copyright)", rede: "nenhuma" },
          limitacao: "voz robótica; piper/coqui (neural) não instalados — use p/ rascunho/timing, não locução final",
          frases: partes.map(({ frase, inicio_s, fim_s, duracao_s }) => ({ frase, inicio_s, fim_s, duracao_s })),
        },
        telemetry: { execution_time_ms: Date.now() - t0 },
        next: [{ tool: "cv_audio_analyze", reason: "Conferir duração/loudness do WAV gerado antes de montar no vídeo" }],
      });
    } catch (e) {
      return devOut({ status: "error", summary: `síntese falhou: ${String(e.message || e).slice(0, 200)}`, data: { text: txt.slice(0, 80) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  },
});
