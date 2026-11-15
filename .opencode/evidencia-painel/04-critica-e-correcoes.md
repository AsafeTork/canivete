# Crítica adversarial (ciclo ≤4) — painel 4 abas

Referências ao vivo: Grafana dashboard best-practices (cada painel responde uma
pergunta; golden signals; critical KPI no olho) + Vercel Geist/Linear via SPEC.

## Rodada 1 — captura inicial v1
1. **ALTO (regressão)**: navegação por `#hash` não trocava a aba (goto de fragmento
   não recarrega; sem listener) — as 8 fichas saíram todas na Visão.
   → **corrigido**: `window.addEventListener("hashchange", …)` + capturas com
   `?v=<epoch>` (também expôs cache do browser headless).
2. **ALTO**: aba Ferramentas com "Contexto"/"Catálogo" estreitos (~290px) e ~600px
   de espaço morto à direita (auto-fit minmax 260px).
   → **corrigido**: `.ferr { grid-template-columns: minmax(260px,1fr) minmax(320px,2fr); }`
   (1 col no ≤720px).
3. **MÉDIO**: anéis/stack capturados no meio da animação de load (transição roda no
   1º paint) — evidência instável.
   → **corrigido**: flag `.noanim` no 1º render (animação só em updates ao vivo).
4. **Baixo (aceito)**: grid da Visão 4+2 cards com espaço morto à direita (padrão
   de dashboard, Grafana faz igual) · CTX `836%` é dado real do orçamento da sessão
   (barra vermelha capada em100% é a semântica correta).

## Rodada 2 — re-captura pós-correções (fichas 01–08)
- Hash/abas corretos nas 8 · anéis cheios no paint · Ferramentas 1fr/2fr sem
  espaço morto · Itens agrupado com share-bar legível · Gráficos completos ·
  375px 1-coluna sem overflow → **barra visual fechada**.

Evidências: `01-indice-capturas.md` · `02-contraste.md` · `03-e2e.md`.
