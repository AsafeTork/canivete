// canivete — web: fetch enxuto + search multi-backend + cache TTL
import { reg, out, trimOut, httpJson, escapeRe, UA } from "./ctx.mjs";

const ttlCache = new Map();
function cached(key, ttlMs, fn, ok) {
  const hit = ttlCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(fn)
    .then((val) => {
      if (!ok || ok(val)) {
        if (ttlCache.size > 300) ttlCache.delete(ttlCache.keys().next().value);
        ttlCache.set(key, { ts: Date.now(), val });
      }
      return val;
    });
}

const S = (s, n = 240) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : "");
function probeMeta(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  return S(og?.[1] || t?.[1] || "", 160);
}

function mainContent(html) {
  const clean = html.replace(/<(script|style|noscript|header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const m = clean.match(/<(?:article|main)[\s\S]*?<\/(?:article|main)>/i);
  return m ? m[0] : clean;
}

reg("n_webfetch", {
  description: "Baixa URL e retorna só conteúdo principal (<article>/<main>, sem header/nav/footer/script, maxChars default 12k). Quando usar: ler página achada no n_websearch; docs/API sem chave. Erro HTTP>=400 NÃO cacheia. Ex: {url:\"https://...\", maxChars:8000}. ~80% menos tokens que HTML inteiro.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      format: { type: "string", enum: ["markdown", "text", "html"], default: "text" },
      maxChars: { type: "number", description: "Max chars of extracted text (default 12000)" },
      timeout: { type: "number", default: 60000 },
    },
    required: ["url"],
  },
  run: async ({ url, format, maxChars, timeout }) => {
    const cap = Math.min(Math.max(Number(maxChars) || 12000, 500), 60000);
    const key = `fetch:${url}:${format}:${cap}`;
    const result = await cached(
      key,
      15 * 60 * 1000,
      async () => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeout || 60000);
        try {
          const res = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA } });
          const raw = await res.text();
          if (res.status >= 400) return { err: `HTTP ${res.status} from ${url}\n${raw.slice(0, 1500)}` };
        const isHtml = /html/i.test(res.headers.get("content-type") || "");
        if (!isHtml) return { text: trimOut(raw, cap) };
        const core = mainContent(raw);
        const body = core
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/&(?:rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|middot|bull|apos);/g, (m) => ({ "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-", "&hellip;": "...", "&middot;": "·", "&bull;": "•", "&apos;": "'" })[m.toLowerCase()])
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter((l) => l.length > 1)
          .join("\n");
        return { text: `${probeMeta(raw) ? probeMeta(raw) + "\n" : ""}${format === "html" ? core : body}`.slice(0, cap), title: probeMeta(raw) };
      } catch (e) {
        return { err: `fetch failed: ${e.message}` };
      } finally {
        clearTimeout(t);
      }
      },
      (v) => !v.err
    );
    if (result.err) return out(result.err, true);
    return out(`URL ${url} (200)${result.title ? ` — ${result.title}` : ""}\n${trimOut(result.text, cap)}`);
  },
});

async function searchNews(q, n) {
  const r = await httpJson(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt`, { timeout: 12000 });
  if (r.status !== 200) return null;
  const out = [];
  for (const b of r.text.split("<item>").slice(1)) {
    const t = b.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
    const l = b.match(/<link>(.*?)<\/link>/s);
    const src = b.match(/<source[^>]*>(.*?)<\/source>/s);
    if (!t || !l) continue;
    out.push({ title: collapseHtml(t[1]), url: l[1].trim(), snippet: src ? `fonte: ${collapseHtml(src[1])}` : "" });
    if (out.length >= n) break;
  }
  return out.length ? { source: "google-news", items: out } : null;
}

async function searchDdgInstant(q) {
  const r = await httpJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { timeout: 10000 });
  if (r.status !== 200) return null;
  const d = r.data || {};
  const items = [];
  if (d.AbstractText) items.push({ title: d.Heading || "DuckDuckGo", url: d.AbstractURL || "", snippet: S(d.AbstractText, 400) });
  for (const t of d.RelatedTopics || []) {
    if (t.Topics) for (const s of t.Topics) if (s.Text) items.push({ title: t.Name || "", url: s.FirstURL || "", snippet: S(s.Text, 260) });
    else if (t.Text) items.push({ title: t.Name || "", url: t.FirstURL || "", snippet: S(t.Text, 260) });
  }
  return items.length ? { source: "ddg-instant-answer", items } : null;
}

async function searchWikiExtract(q) {
  const r = await httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=extracts&exintro&explaintext&redirects=1&format=json&utf8=1`,
    { timeout: 12000 }
  );
  if (r.status !== 200 || !r.data?.query?.pages) return null;
  const page = r.data.query.pages[Object.keys(r.data.query.pages)[0]];
  if (!page?.extract) return null;
  return { source: "wikipedia-resumo", items: [{ title: page.title, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, snippet: S(page.extract, 500) }] };
}

async function searchWiki(q, n) {
  const r = await httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&utf8=1`,
    { timeout: 12000 }
  );
  if (r.status !== 200 || !r.data?.query?.search?.length) return null;
  return {
    source: "wikipedia-pt",
    items: r.data.query.search.map((s) => ({
      title: s.title,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
      snippet: collapseHtml(s.snippet),
    })),
  };
}

async function searchHn(q, n) {
  const r = await httpJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${n}`, { timeout: 12000 });
  if (r.status !== 200 || !Array.isArray(r.data?.hits)) return null;
  return {
    source: "hacker-news",
    items: r.data.hits.map((h) => ({
      title: S(h.title),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · ${h.author || ""}`.trim(),
    })),
  };
}

async function searchGithub(q, n) {
  const r = await httpJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${n}`, { timeout: 10000 });
  if (r.status !== 200 || !Array.isArray(r.data?.items)) return null;
  return {
    source: "github",
    items: r.data.items.map((it) => ({ title: it.full_name, url: it.html_url, snippet: `${S(it.description, 180)} | stars: ${it.stargazers_count}`.trimStart() })),
  };
}

reg("n_websearch", {
  description: "Busca web gratuita (7 backends paralelos: Google News RSS, DDG Instant Answer, Wikipedia pt resumo+títulos, HN, GitHub, DDG HTML; fusão por fonte, cache 10min). Quando usar: pesquisar doc/bug/biblioteca; depois n_webfetch para ler. Retorna título+URL+snippet agrupado por fonte. Ex: {query:\"vite 5 pwa config\", numResults:8}.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      numResults: { type: "number", default: 8 },
    },
    required: ["query"],
  },
  run: async ({ query, numResults }) => {
    const q = String(query || "").trim();
    if (!q) return out("query is required", true);
    const n = Math.min(Math.max(Number(numResults) || 8, 1), 20);
    const qClean = q.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
    const key = `search:${qClean}:${n}`;
    const groups = await cached(key, 10 * 60 * 1000, async () => {
      const attempt = async (qq) => {
        const settled = await Promise.allSettled([
          searchNews(qq, 4),
          searchDdgInstant(qq),
          searchWikiExtract(qq),
          searchWiki(qq, n),
          searchHn(qq, 4),
          searchGithub(qq, 4),
          httpJson(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(qq)}`, { timeout: 12000 }).then((r) =>
            r.status === 200 ? { source: "duckduckgo", items: parseDdg(r.text).slice(0, n) } : null
          ),
        ]);
        return settled.filter((s) => s.status === "fulfilled" && s.value?.items?.length).map((s) => s.value);
      };
      let list = await attempt(qClean);
      if (!list.length) {
        const short = qClean.split(/\s+/).slice(0, 4).join(" ");
        if (short && short !== qClean) list = await attempt(short);
      }
      return list;
    });
    if (!groups.length) return out(`no results for "${q}"`);
    const blocks = groups.map((g) => `── ${g.source} ──\n` + g.items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.url}\n   ${it.snippet}\n`).join(""));
    return out(`${groups.reduce((t, g) => t + g.items.length, 0)} results for "${q}" (cached 10min, sources: ${groups.map((g) => g.source).join(", ")})\n` + blocks.join("\n") + `\nTip: use n_webfetch to read a page's main content (maxChars caps token cost).`);
  },
});

function parseDdg(html) {
  const items = [];
  const blocks = html.split('class="result__a"');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const title = b.match(/>([^<]*)<\/a>/);
    const href = b.match(/href="([^"]+)"/);
    const snippet = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!href) continue;
    const uddg = href[1].match(/uddg=([^&]+)/);
    items.push({
      title: title ? title[1].trim() : "",
      url: uddg ? decodeURIComponent(uddg[1]) : href[1],
      snippet: snippet ? collapseHtml(snippet[1]) : "",
    });
  }
  return items;
}

function collapseHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

export { probeMeta, mainContent, cached };
