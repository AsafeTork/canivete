// canivete — mídia LOCAL (ffprobe/ffmpeg no disco; nada sai da máquina — report rmvzvs4n2)
// Análise de áudio p/ montagem de vídeo: duração, codec, loudness LUFS (ebur128) e mapa de
// silêncios (pontos de corte). Proveniência explícita: leitura local, zero upload.
import { statSync } from "node:fs";
import { reg, devOut, fpath, exec, humanSize } from "./ctx.mjs";

// Summary do ebur128 (stderr): "I:  -19.5 LUFS", "Threshold: -29.6 LUFS", "True peak: -1.2 dBTP"
function parseLoudness(se) {
  const grab = (re) => {
    let m, last = null;
    while ((m = re.exec(se))) last = m[1];
    return last == null ? null : Number(last);
  };
  const integrado = grab(/I:\s+(-?\d+(?:\.\d+)?)\s*LUFS/g);
  const limiar = grab(/Threshold:\s+(-?\d+(?:\.\d+)?)\s*LUFS/g);
  const pico = grab(/True peak:\s+(-?\d+(?:\.\d+)?)\s*dBTP/gi);
  return { integrado_lufs: integrado, limiar_lufs: limiar, pico_true_dbtp: pico };
}

reg("n_audio_analyze", {
  description: "Analisa áudio LOCAL p/ montagem de vídeo (ffprobe+ffmpeg no disco — NADA sai da máquina): duração, codec/canais, loudness LUFS (ebur128) e mapa de silêncios = pontos de corte naturais. Aceita mp3/wav/m4a/ogg/flac ou vídeo (usa a trilha). Ex: {path:\"narração.mp3\", silenceDb:-35}.",
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
    if (!sugestoes.length) sugestoes.push("arquivo compacto: silêncios dentro do normal e loudness no padrão — pronto pra montagem");
    return devOut({
      status: "success",
      summary: `áudio ${dur.toFixed(1)}s — ${silencios.length} silêncio(s) >= ${mind}s @ ${db}dB, ${loud.integrado_lufs ?? "?"} LUFS, ${formato.codec} ${formato.sample_rate || "?"}Hz ${formato.canais || "?"}ch — processado LOCAL (nada enviado) → ${file}`,
      data: { file, duracao_s: Number(dur.toFixed(2)), formato, loudness: loud, total_silencio_s: Number(totalSil.toFixed(2)), fala_s: Number((dur - totalSil).toFixed(2)), silencios: silencios.slice(0, 60), silencios_ocultos: Math.max(0, silencios.length - 60), sugestoes, processamento: "local (ffprobe+ffmpeg) — proveniência: nenhum byte saiu da máquina" },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_bash", reason: "Cortar nos pontos sugeridos (ffmpeg -ss/-to) ou normalizar (loudnorm)" }, { tool: "n_browser_screencast", reason: "Gravar a tela da demo pra juntar com o áudio na montagem" }],
    });
  },
});
