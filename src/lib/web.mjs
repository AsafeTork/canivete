// canivete — web: fetch enxuto + search multi-backend + cache TTL
// ENV: nenhum CANIVETE_* lido neste arquivo — knobs são args/valores fixos abaixo.
//   - CANIVETE_SEARCH_MAX: NÃO existe (removido após paginação page/perPage; ver n_websearch).
//   - cache TTLs: n_webfetch 15min (15*60*1000, só ok sem err); n_websearch 10min (10*60*1000); fresh:true pula leitura mas regrava.
//   - ttlCache cap: size>300 → poda expirados até <=200, senão evict FIFO (keys().next()).
//   - timeouts: n_webfetch arg timeout default 60000 clamp 5000-120000 (AbortController); httpJson default 30000 (ctx.mjs), overrides: News 12000 / DDG-instant 10000 / WikiExtract 12000 / Wiki 12000 / HN 12000 / GitHub 10000 / DDG-html 12000.
//   - retry: n_webfetch 2 tentativas sleep 1000 (429/5xx/rede); fetchRetry(tries=2, delays 1000+2000) p/ status 0/429/5xx, httpJson nunca lança (rede=status 0).
//   - paginação: numResults POR FONTE default 8 clamp 1-20 (News/HN/GitHub fixos em 4, Wiki/DDG-html usam n); page default 1 clamp 1..totalPages; perPage default 30 clamp 1-200 (pós-dedupe).
//   - caps texto: n_webfetch maxChars default 12000 clamp 500-60000; links máx 40; S()=240 / probeMeta=160 / desc=300 / h1=200; trimOut default MAX_OUT=30000 (ctx.mjs).
import { reg, out, trimOut, httpJson, escapeRe, UA } from "./ctx.mjs";

const ttlCache = new Map();
function cached(key, ttlMs, fn, ok) {
  const hit = ttlCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(fn)
    .then((val) => {
      if (!ok || ok(val)) {
        // evita crescimento descontrolado: remove entradas expiradas primeiro
        if (ttlCache.size > 300) {
          const now = Date.now();
          for (const [k, v] of ttlCache) {
            if (now - v.ts >= ttlMs) ttlCache.delete(k);
            if (ttlCache.size <= 200) break;
          }
          if (ttlCache.size > 300) ttlCache.delete(ttlCache.keys().next().value);
        }
        ttlCache.set(key, { ts: Date.now(), val });
      }
      return val;
    });
}

// ── helpers webfetch: trunc/extrato (S/probeMeta/mainContent/extractPrice) ──
const S = (s, n = 240) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : "");
function probeMeta(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  return S(og?.[1] || t?.[1] || "", 160);
}

const stripLen = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
function mainContent(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|canvas)[\s\S]*?<\/\1>/gi, " ").replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ").replace(/<(div|section|aside|figure|span)[^>]*(?:class|id)=["'][^"']*(?:ad[s-]?|banner|sponsor|popup|cookie|newsletter|sidebar|widget|social|share|related|recommen|comment|promo|subscribe)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  const arts = [...clean.matchAll(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[0]);
  if (arts.length) {
    arts.sort((a, b) => stripLen(b) - stripLen(a));
    return arts[0];
  }
  const scored = clean.split(/<\/(?:p|div|section|li|h[1-6]|blockquote|tr|title)>/i).map((p) => ({ p, t: p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })).filter((b) => b.t.length >= 40).map((b) => ({ t: b.t, d: b.t.length / (b.p.length || 1) })).sort((a, b) => b.d - a.d || b.t.length - a.t.length);
  return scored.length ? scored.map((b) => b.t).join("\n") : clean;
}

function extractPriceAndJsonld(html) {
  // og:price + variações (og:price:amount, product:price:amount) — ambas ordens de atributos
  const ogRes = [
    /property=["'](?:og:price(?::amount)?|product:price:amount)["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*property=["'](?:og:price(?::amount)?|product:price:amount)["']/i,
  ];
  let price = null;
  let currency = null;
  for (const re of ogRes) {
    const m = html.match(re);
    if (m?.[1]) { price = m[1].trim(); break; }
  }
  const curM = html.match(/property=["'](?:og:price:currency|product:price:currency)["'][^>]*content=["']([^"']+)/i);
  if (curM?.[1]) currency = curM[1].trim();
  const jsonldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  let offers = null;
  const pickFromNode = (node) => {
    if (!node || typeof node !== "object") return null;
    const off = node.offers;
    const list = Array.isArray(off) ? off : off ? [off] : [];
    for (const o of list) {
      if (o && typeof o === "object" && (o.price ?? o.lowPrice ?? o?.priceSpecification?.price) != null) {
        return { price: String(o.price ?? o.lowPrice ?? o.priceSpecification.price), offers: o };
      }
    }
    if (node.price != null && typeof node.price !== "object") return { price: String(node.price), offers: off || null };
    if (node?.priceSpecification?.price != null) return { price: String(node.priceSpecification.price), offers: off || null };
    return null;
  };
  for (const block of jsonldBlocks) {
    try {
      const json = block.replace(/<script[^>]*>|<\/script>/gi, "").trim();
      const data = JSON.parse(json);
      const nodes = Array.isArray(data) ? data : Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
      for (const node of nodes) {
        const hit = pickFromNode(node);
        if (hit) { if (!price) price = hit.price; offers = hit.offers; break; }
      }
      if (price && offers) break;
    } catch {}
  }
  if (price) price = String(price).trim();
  return { price, offers, currency };
}

// ── webfetch: n_webfetch (cache 15min, timeout 60s, retry 2x) ──
reg("n_webfetch", {
  description: "Baixa URL SEM JS e extrai texto principal + og:price/JSON-LD (tenta <article>/<main>). Retorna título, preço e links. SPA shell/vazio/JS/login-wall/preço dinâmico? NÃO use este — vá de n_browser_navigate (renderiza JS) ou n_ubrowser_* (logado). Erro/DNS vira isError; HTTP>=400 não cacheia.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL a baixar" },
      format: { type: "string", enum: ["markdown", "text", "html"], default: "text", description: "Formato de saída" },
      maxChars: { type: "number", description: "Máx. caracteres do texto (500-60000, padrão 12000)" },
      timeout: { type: "number", default: 60000, description: "Timeout em ms (padrão 60000)" },
      links: { type: "boolean", default: true, description: "Extrair links (padrão true; false economiza)" },
    },
    required: ["url"],
  },
  run: async ({ url, format, maxChars, timeout, links }) => {
    const fmt = format === "html" ? "html" : format === "markdown" ? "markdown" : "text";
    const cap = Math.min(Math.max(Number(maxChars) || 12000, 500), 60000);
    const timeoutMs = Math.min(Math.max(Number(timeout) || 60000, 5000), 120000);
    const withLinks = links !== false;
    const key = `fetch:${url}:${fmt}:${cap}:${withLinks ? "links" : "nolinks"}`;
    const result = await cached(
      key,
      15 * 60 * 1000,
      async () => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        try {
          let res = null;
          let raw = "";
          let lastErr = "";
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              res = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA } });
              raw = await res.text();
              if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt === 0) {
                await sleep(1000);
                continue;
              }
              break;
            } catch (e) {
              lastErr = e?.message || "fetch error";
              if (attempt === 0) {
                await sleep(1000);
                continue;
              }
              return { err: `fetch failed: ${lastErr}` };
            }
          }
          if (!res) return { err: `fetch failed: ${lastErr || "unknown"}` };
          if (res.status === 429) return { err: `HTTP 429 from ${url} — rate-limit. Aguarde 60s ou reduza frequência. Alternativa: use n_browser_navigate ${url}.\n${String(raw).slice(0, 1500)}` };
          if (res.status >= 400) return { err: `HTTP ${res.status} from ${url} — verifique a URL ou autenticação. Alternativa: use n_browser_navigate ${url} para conteúdo JS-renderizado.\n${String(raw).slice(0, 1500)}` };
        const isHtml = /html/i.test(res.headers.get("content-type") || "");
        if (!isHtml) return { text: trimOut(raw, cap) };
        const core = mainContent(raw);
        const inArticle = /<(article|main)[\s>]/i.test(raw);
        let lines = core
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/&(?:rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|middot|bull|apos);/g, (m) => ({ "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-", "&hellip;": "...", "&middot;": "·", "&bull;": "•", "&apos;": "'" })[m.toLowerCase()])
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim());
        lines = inArticle ? lines.filter((l) => l.length > 1) : lines.filter((l) => l.length >= 40);
        if (!inArticle) lines.sort((a, b) => b.length - a.length);
        const body = lines.join("\n");
        const descM = raw.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || raw.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        const ogDescM = raw.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i);
        const h1M = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1 = h1M ? h1M[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : "";
        const desc = S(descM?.[1] || ogDescM?.[1] || "", 300);
        const header = [h1, desc].filter(Boolean).join(" | ");
        const scriptCount = (raw.match(/<script\b/gi) || []).length;
        const bodyTextLen = body.replace(/\s+/g, "").length;
        const spa = bodyTextLen < 500 && scriptCount > 5;
        const empty = bodyTextLen < 200;
        const { price, offers, currency } = extractPriceAndJsonld(raw);
        const priceStr = price ? `\nPreço: ${price}${currency ? ` ${currency}` : ""}` : "";
        const offersStr = offers && typeof offers === "object" && offers.seller ? `\nVendedor: ${offers.seller.name || offers.seller}` : "";
        let linksTxt = "";
        if (withLinks) {
          const seen = new Set();
          const items = [];
          const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let m;
          while ((m = re.exec(raw)) && items.length < 40) {
            let href = m[1].trim();
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
            try { href = new URL(href, url).toString(); } catch {}
            if (seen.has(href)) continue;
            seen.add(href);
            const txt = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || href;
            items.push(fmt === "markdown" ? `- [${txt}](${href})` : `- ${txt} → ${href}`);
          }
          if (items.length) linksTxt = `\nLinks (${items.length}):\n${items.join("\n")}`;
        }
        const title = probeMeta(raw);
        const head = `${title ? title + "\n" : ""}${header ? header + "\n" : ""}${priceStr}${offersStr}${empty ? `página vazia/JS/login-wall — use n_browser_navigate ${url}\n` : spa ? `página 100% JS — use n_browser_navigate ${url}\n` : ""}`;
        return { text: `${head}${fmt === "html" ? core : body}${linksTxt}`.slice(0, cap), title, header, price, currency, spa, empty };
      } catch (e) {
        return { err: `fetch failed: ${e.message}` };
      } finally {
        clearTimeout(t);
      }
      },
      (v) => !v.err
    );
    if (result.err) return out(result.err, true);
    return out(`URL ${url} (200)${result.title ? ` — ${result.title}` : ""}${result.header ? `\nHeader: ${result.header}` : ""}${result.price ? `\nPreço: ${result.price}${result.currency ? ` ${result.currency}` : ""}` : ""}${result.empty ? `\npágina vazia/JS/login-wall — use n_browser_navigate ${url}` : result.spa ? `\npágina 100% JS — use n_browser_navigate ${url}` : ""}\n${trimOut(result.text, cap)}`);
  },
});

// ── websearch: backends (News/DDG-instant/Wiki/HN/GitHub, timeouts 10-12s) ──
async function searchNews(q, n, sinceDate) {
  // since: repassado como operador after:YYYY-MM-DD (suportado pelo Google News RSS).
  const qq = sinceDate ? `${q} after:${sinceDate}` : q;
  const r = await fetchRetry(() => httpJson(`https://news.google.com/rss/search?q=${encodeURIComponent(qq)}&hl=pt-BR&gl=BR&ceid=BR:pt`, { timeout: 12000 }), 2);
  if (r.status !== 200) return null;
  const out = [];
  for (const b of r.text.split("<item>").slice(1)) {
    const t = b.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
    const l = b.match(/<link>(.*?)<\/link>/s);
    const src = b.match(/<source[^>]*>(.*?)<\/source>/s);
    const pub = b.match(/<pubDate>(.*?)<\/pubDate>/s);
    if (!t || !l) continue;
    const bits = [];
    if (src) bits.push(`fonte: ${collapseHtml(src[1])}`);
    if (pub) bits.push(collapseHtml(pub[1]));
    out.push({ title: collapseHtml(t[1]), url: l[1].trim(), snippet: bits.join(" · ") });
    if (out.length >= n) break;
  }
  return out.length ? { source: "google-news", items: out } : null;
}

async function searchDdgInstant(q) {
  const r = await fetchRetry(() => httpJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { timeout: 10000 }), 2);
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
  const r = await fetchRetry(() => httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=extracts&exintro&explaintext&redirects=1&format=json&utf8=1`,
    { timeout: 12000 }
  ), 2);
  if (r.status !== 200 || !r.data?.query?.pages) return null;
  const page = r.data.query.pages[Object.keys(r.data.query.pages)[0]];
  if (!page?.extract) return null;
  return { source: "wikipedia-resumo", items: [{ title: page.title, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, snippet: S(page.extract, 500) }] };
}

async function searchWiki(q, n) {
  const r = await fetchRetry(() => httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&utf8=1`,
    { timeout: 12000 }
  ), 2);
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

async function searchHn(q, n, sinceMs) {
  // since: repassado via numericFilters=created_at_i> (suportado pela API Algolia HN).
  let url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${n}`;
  if (sinceMs) url += `&numericFilters=created_at_i>${Math.floor(sinceMs / 1000)}`;
  const r = await fetchRetry(() => httpJson(url, { timeout: 12000 }), 2);
  if (r.status !== 200 || !Array.isArray(r.data?.hits)) return null;
  return {
    source: "hacker-news",
    items: r.data.hits.map((h) => ({
      title: S(h.title),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · ${h.author || ""}${h.created_at ? ` · ${String(h.created_at).slice(0, 10)}` : ""}`.trim(),
    })),
  };
}

async function searchGithub(q, n, sinceDate) {
  // since: repassado como qualificador pushed:>YYYY-MM-DD (suportado pela Search API do GitHub).
  const qq = sinceDate ? `${q} pushed:>${sinceDate}` : q;
  const r = await fetchRetry(() => httpJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(qq)}&per_page=${n}`, { timeout: 10000 }), 2);
  if (r.status !== 200 || !Array.isArray(r.data?.items)) return null;
  return {
    source: "github",
    items: r.data.items.map((it) => ({ title: it.full_name, url: it.html_url, snippet: `${S(it.description, 180)} | stars: ${it.stargazers_count}${it.pushed_at ? ` · ${String(it.pushed_at).slice(0, 10)}` : ""}`.trimStart() })),
  };
}

// ── helpers search: norm/dedupe/site/since/fetchRetry (puro, sem ENV) ──
// Helpers de search: normalização de URL (dedupe), filtros site:/since:.
function normUrl(u) {
  try {
    const url = new URL(String(u || "").trim());
    let host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/+$/, "") || "";
    // ignora query de tracking e fragmento p/ dedupe entre backends
    url.searchParams.forEach((_, k) => {
      if (/^(utm_|fbclid|gclid|mc_|igsh)/i.test(k)) url.searchParams.delete(k);
    });
    const qs = url.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`.toLowerCase();
  } catch {
    return String(u || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function normSite(s) {
  return String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function siteMatches(url, site) {
  if (!site) return true;
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
    return host === site || host.endsWith(`.${site}`) || host.includes(site);
  } catch {
    return String(url || "").toLowerCase().includes(site);
  }
}

// Aceita "YYYY-MM-DD" ou ISO; retorna { ms, date } ou { ms: null, date: null }.
function parseSince(v) {
  if (v == null || v === "") return { ms: null, date: null };
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  const t = Date.parse(m ? m[1] : s);
  if (Number.isNaN(t)) return { ms: null, date: null, invalid: true };
  return { ms: t, date: m ? m[1] : new Date(t).toISOString().slice(0, 10) };
}

// Tenta extrair data do snippet (ISO, BR DD/MM/YYYY, "12 Jan 2024", pubDate RFC). Null = sem data detectável.
function snippetDateMs(snippet) {
  const s = String(snippet || "");
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}`);
    if (!Number.isNaN(t)) return t;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const t = Date.parse(`${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`);
    if (!Number.isNaN(t)) return t;
  }
  m = s.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (m) {
    const t = Date.parse(`${m[1]} ${m[2]} ${m[3]}`);
    if (!Number.isNaN(t)) return t;
  }
  const t = Date.parse(s);
  // Date.parse no snippet inteiro só vale se o snippet for quase só data (evita falso-positivo em números soltos)
  if (!Number.isNaN(t) && s.trim().length < 40) return t;
  return null;
}

// ── helpers puros: dedupe excerpts / rank por query / resumo extrativo / cap domínio (sem rede, sem ENV) ──
// Normaliza p/ comparação: lower + sem acento + sem pontuação + espaços colapsados.
function normExcerpt(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
// Trigramas de palavras (shingles, n=3) sobre o texto normalizado.
function excerptTrigrams(s) {
  const toks = normExcerpt(s).split(" ").filter(Boolean);
  if (!toks.length) return new Set();
  if (toks.length < 3) return new Set([toks.join(" ")]);
  const set = new Set();
  for (let i = 0; i + 2 < toks.length; i++) set.add(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`);
  return set;
}
function jaccardSets(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
// Duplicado se normalizado igual OU Jaccard(trigramas) >= threshold (default 0.8).
function excerptSimilar(a, b, threshold = 0.8) {
  const na = normExcerpt(a);
  const nb = normExcerpt(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // fast-path: bloco de instalação repetido com prefixo/sufixo distinto (um contém ~90% do outro)
  if (na.length > 80 && nb.length > 80) {
    const short = na.length <= nb.length ? na : nb;
    const long = na.length <= nb.length ? nb : na;
    if (long.includes(short.slice(0, Math.floor(short.length * 0.9)))) return true;
  }
  const ta = excerptTrigrams(a);
  const tb = excerptTrigrams(b);
  if (!ta.size || !tb.size) return false;
  return jaccardSets(ta, tb) >= threshold;
}
// Termos distintos da query (lower, >=2 chars) p/ rank por cobertura.
function queryTerms(q) {
  return [...new Set(String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map((s) => s.trim()).filter((s) => s.length >= 2))];
}
// Cobertura: nº de termos distintos da query presentes no snippet (case-insensitive).
function excerptScore(snippet, terms) {
  if (!terms || !terms.length) return 0;
  const low = String(snippet || "").toLowerCase();
  let hit = 0;
  for (const t of terms) if (low.includes(t)) hit++;
  return hit;
}
// Melhor excerpt: maior cobertura; empate => mais longo (sem query cai no comportamento antigo).
function bestSnippet(current, candidate, terms) {
  if (!candidate) return current || "";
  if (!current) return candidate;
  const sc = excerptScore(current, terms);
  const sn = excerptScore(candidate, terms);
  if (sn !== sc) return sn > sc ? candidate : current;
  return candidate.length > current.length ? candidate : current;
}
function splitSentences(text) {
  return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 400);
}
// Resumo extrativo: top N frases (de títulos+snippets, dedupadas por norm/Jaccard>=0.8), rank por cobertura da query.
function buildQuickSummary(items, query, max = 5) {
  const terms = queryTerms(query);
  const seen = [];
  for (const it of items || []) {
    const cands = [...splitSentences(it.title), ...splitSentences(it.snippet)];
    for (const sent of cands) {
      const n = normExcerpt(sent);
      if (!n) continue;
      const tri = excerptTrigrams(sent);
      let dup = false;
      for (const s of seen) {
        if (s.norm === n || jaccardSets(tri, s.tri) >= 0.8) { dup = true; break; }
      }
      if (dup) continue;
      seen.push({ sent, norm: n, tri, score: excerptScore(sent, terms), len: sent.length });
      if (seen.length > 200) break;
    }
    if (seen.length > 200) break;
  }
  seen.sort((a, b) => b.score - a.score || b.len - a.len);
  return seen.slice(0, max).map((s) => s.sent);
}
function domainOf(u) {
  try {
    return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normSite(u);
  }
}
// Cap por domínio: máx N por domínio (preserva ordem, conta omitidos).
function capByDomain(items, maxPerDomain = 3) {
  const per = new Map();
  const kept = [];
  let omitted = 0;
  for (const it of items || []) {
    const d = domainOf(it.url) || "-";
    const c = per.get(d) || 0;
    if (c < maxPerDomain) { per.set(d, c + 1); kept.push(it); }
    else omitted++;
  }
  return { kept, omitted };
}
// Dedupe de excerpts ENTRE resultados: O(n²) com cap (só os top 60 entram no pairwise; resto passa intacto).
// Mantém o 1º, troca duplicado por placeholder curto e conta omitted.
function dedupeExcerpts(items, threshold = 0.8, cap = 60) {
  const list = items || [];
  const keptIdx = [];
  const outItems = [];
  let omitted = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (i >= cap) { outItems.push(it); continue; }
    let dupOf = -1;
    for (const k of keptIdx) {
      if (excerptSimilar(it.snippet, list[k].snippet, threshold)) { dupOf = k; break; }
    }
    if (dupOf >= 0) {
      omitted++;
      outItems.push({ ...it, snippet: `(similar ao #${dupOf + 1} omitido)`, _dupOf: dupOf + 1 });
    } else {
      keptIdx.push(i);
      outItems.push(it);
    }
  }
  return { items: outItems, omitted };
}
function publishDateStr(snippet) {
  const ms = snippetDateMs(snippet);
  if (ms == null) return null;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function dedupeItems(groups, query = "") {
  const terms = queryTerms(query);
  const map = new Map();
  for (const g of groups) {
    for (const it of g.items || []) {
      const key = normUrl(it.url);
      if (!key) continue;
      const hit = map.get(key);
      if (!hit) {
        map.set(key, { title: it.title, url: it.url, snippet: it.snippet || "", fontes: [g.source] });
      } else {
        if (!hit.fontes.includes(g.source)) hit.fontes.push(g.source);
        // rank por cobertura dos termos da query: snippet exibido = melhor excerpt, não o primeiro (empate => mais longo)
        hit.snippet = bestSnippet(hit.snippet, it.snippet || "", terms);
        if (!hit.title && it.title) hit.title = it.title;
      }
    }
  }
  return [...map.values()];
}

// Retry com backoff p/ 429/5xx/rede (status 0): 2 tentativas, 1s+2s. httpJson nunca lança (rede=status 0).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(fn, tries = 2) {
  const delays = [1000, 2000];
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fn();
    } catch (e) {
      last = { status: 0, data: null, text: e?.message || "fetch error" };
      if (i === tries - 1) return last;
      await sleep(delays[i] ?? 2000);
      continue;
    }
    if (last && typeof last.status === "number") {
      const s = last.status;
      const transient = s === 0 || s === 429 || (s >= 500 && s < 600);
      if (transient && i < tries - 1) {
        await sleep(delays[i] ?? 2000);
        continue;
      }
    }
    return last;
  }
  return last;
}

// ── websearch: n_websearch (cache 10min, numResults/fonte + page/perPage pós-dedupe) ──
reg("n_websearch", {
  description: "Busca web multi-backend (News, DDG, Wikipedia, HN, GitHub; cache 10min, dedupe por URL). Quando usar: pesquisar doc/bug/biblioteca. Filtros: site, since (YYYY-MM-DD), fresh (pula cache). Limite: numResults é por fonte; paginação page/perPage sobre o total pós-dedupe; preço pode estar desatualizado — confirme com n_browser_navigate.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Termos da busca (obrigatório)." },
      numResults: { type: "number", default: 8, description: "Teto de resultados POR FONTE (1-20, padrão 8)." },
      site: { type: "string", description: "Filtra resultados cujo URL contém este domínio. Ex: github.com, pt.wikipedia.org. Vazio = sem filtro." },
      since: { type: "string", description: "Só resultados desde esta data (YYYY-MM-DD ou ISO). Repassado a News/HN/GitHub; nos demais backends filtra pelo snippet quando houver data, senão mantém. Formato inválido = erro." },
      fresh: { type: "boolean", default: false, description: "Se true, pula o cache de 10min e força re-busca ao vivo." },
      page: { type: "number", default: 1, description: "Página (1-based) sobre os itens pós-dedupe (padrão 1)." },
      perPage: { type: "number", default: 30, description: "Itens por página pós-dedupe (1-200, padrão 30)." },
    },
    required: ["query"],
  },
  run: async ({ query, numResults, site, since, fresh, page, perPage }) => {
    const q = String(query || "").trim();
    if (!q) return out("query is required", true);
    const n = Math.min(Math.max(Number(numResults) || 8, 1), 20);
    const qClean = q.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
    const siteNorm = normSite(site);
    const parsedSince = parseSince(since);
    if (since != null && String(since).trim() !== "" && (parsedSince.invalid || parsedSince.ms == null))
      return out("since inválido: use YYYY-MM-DD ou data ISO (ex: 2024-01-01)", true);
    const sinceMs = parsedSince.ms;
    const sinceDate = parsedSince.date;
    const key = `search:${qClean}:${n}:${siteNorm || "-"}:${sinceDate || "-"}`;
    const fetchGroups = async () => {
      let had429 = false;
      const attempt = async (qq) => {
        const settled = await Promise.allSettled([
          searchNews(qq, 4, sinceDate),
          searchDdgInstant(qq),
          searchWikiExtract(qq),
          searchWiki(qq, n),
          searchHn(qq, 4, sinceMs),
          searchGithub(qq, 4, sinceDate),
          fetchRetry(() => httpJson(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(qq)}`, { timeout: 12000 }), 2).then((r) => {
            if (r.status === 429) had429 = true;
            return r.status === 200 ? { source: "duckduckgo", items: parseDdg(r.text).slice(0, n) } : null;
          }),
        ]);
        return settled.filter((s) => s.status === "fulfilled" && s.value?.items?.length).map((s) => s.value);
      };
      let list = await attempt(qClean);
      if (!list.length) {
        const short = qClean.split(/\s+/).slice(0, 4).join(" ");
        if (short && short !== qClean) list = await attempt(short);
      }
      return { list, had429 };
    };
    // fresh:true pula a leitura do cache (força re-busca) mas atualiza o cache p/ próximas chamadas.
    let groups;
    let had429 = false;
    if (fresh) {
      const result = await fetchGroups();
      groups = result.list;
      had429 = result.had429;
      if (groups.length) ttlCache.set(key, { ts: Date.now(), val: result });
    } else {
      const result = await cached(key, 10 * 60 * 1000, fetchGroups);
      groups = result.list;
      had429 = result.had429;
    }
    if (!groups.length) return out(had429 ? `no results for "${q}" — 429 received: aguarde 60s ou use fresh:false` : `no results for "${q}"`);
    // 1) site: filtra por domínio (URL contém o domínio normalizado)
    let filtered = siteNorm
      ? groups.map((g) => ({ source: g.source, items: (g.items || []).filter((it) => siteMatches(it.url, siteNorm)) })).filter((g) => g.items.length)
      : groups;
    // 2) since (fallback): onde o backend não suporta, filtra pelo snippet quando há data reconhecível;
    // sem data detectável o item é mantido (limite documentado na description).
    if (sinceMs) {
      filtered = filtered
        .map((g) => {
          // backends com repasse nativo já filtram no servidor: google-news, hacker-news, github
          if (g.source === "google-news" || g.source === "hacker-news" || g.source === "github") return g;
          return { source: g.source, items: (g.items || []).filter((it) => {
            const d = snippetDateMs(it.snippet);
            return d == null || d >= sinceMs;
          }) };
        })
        .filter((g) => g.items.length);
    }
    if (!filtered.length) return out(`no results for "${q}"${siteNorm ? ` (site:${siteNorm})` : ""}${sinceDate ? ` (since:${sinceDate})` : ""}`);
    // 3) dedupe por URL normalizada entre backends (mesma URL em 2 fontes => 1 item com fontes:[...]);
    //    em conflito o snippet exibido = melhor excerpt por cobertura da query (nao o primeiro; empate => mais longo)
    const deduped = dedupeItems(filtered, qClean);
    if (!deduped.length) return out(`no results for "${q}"`);
    // 3b) cap por dominio (max 3 por dominio, preserva ordem) + dedupe de excerpts entre resultados
    //     (normalize lower/sem pontuacao/espacos + Jaccard trigramas>=0.8; mantem 1o, conta omitidos; O(n2) cap top 60)
    const { kept: capped, omitted: domainOmitted } = capByDomain(deduped, 3);
    const { items, omitted: excerptOmitted } = dedupeExcerpts(capped, 0.8, 60);
    if (!items.length) return out(`no results for "${q}"`);
    // 3c) resumo extrativo no topo: top 5 frases (de todos os excerpts, dedupadas) como resposta rapida
    const quick = buildQuickSummary(capped, qClean, 5);
    // 4) PAGINAÇÃO REAL pós-dedupe (numResults segue POR FONTE; total preservado, acesso a tudo via page/perPage)
    const total = items.length;
    const pp = Math.min(Math.max(Number(perPage) || 30, 1), 200);
    const totalPages = Math.max(1, Math.ceil(total / pp));
    const pg = Math.min(Math.max(Number(page) || 1, 1), totalPages);
    const startIdx = (pg - 1) * pp;
    const shown = items.slice(startIdx, startIdx + pp);
    const counts = filtered.map((g) => `${g.source}: ${(g.items || []).length}`).join(", ");
    const srcs = [...new Set(filtered.map((g) => g.source))].join(", ");
    const cacheTag = fresh ? "fresh" : "cached 10min";
    const omitTag = `${excerptOmitted ? ` +${excerptOmitted} similares omitidos` : ""}${domainOmitted ? ` +${domainOmitted} além do cap 3/domínio` : ""}`;
    const quickBlock = quick.length ? `Resposta rápida (extrativo, top 5 frases dedupadas):\n${quick.map((s) => `- ${s}`).join("\n")}\n` : "";
    const blocks = shown.map((it, i) => {
      const pub = publishDateStr(it.snippet) || publishDateStr(it.title);
      return `${startIdx + i + 1}. ${it.title}\n   ${it.url}\n   ${it.snippet}${pub ? `\n   publish_date: ${pub}` : ""}\n   fontes: [${it.fontes.join(", ")}]\n`;
    }).join("");
    const nextLine = pg < totalPages ? `...[página ${pg}/${totalPages} — next: n_websearch({query:${JSON.stringify(q)}, page:${pg + 1}, perPage:${pp}})]\n` : "";
    return out(`${total} results for "${q}" (${cacheTag}, sources: ${srcs}${siteNorm ? `, site:${siteNorm}` : ""}${sinceDate ? `, since:${sinceDate}` : ""}${omitTag})\npor backend: ${counts} | mostrando ${shown.length}/${total} (página ${pg}/${totalPages}, perPage ${pp})\n` + quickBlock + blocks + nextLine + `\nAviso: preço em snippet pode estar desatualizado, confirme com n_browser_navigate.\nTip: use n_webfetch to read a page's main content (maxChars caps token cost).`);
  },
});

// ── helpers gerais: parseDdg/collapseHtml (parse sem rede) ──
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

export { probeMeta, mainContent, cached, extractPriceAndJsonld, fetchRetry, normUrl, dedupeItems, normExcerpt, excerptTrigrams, jaccardSets, excerptSimilar, queryTerms, excerptScore, bestSnippet, splitSentences, buildQuickSummary, domainOf, capByDomain, dedupeExcerpts, publishDateStr };
