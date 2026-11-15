# Ciclo 2 — Gestão de reports, edição, locate, toggles (2026-10-30)

## Escopo
- Itens: chips de estado (6 p/ report, 3 p/ elem, auto read-only), nota + Salvar, form Editar (kind/got/expected), "Ir até ↗" (locate), "⛓ copiar link".
- Deep-link `#itens/<id>`: abre a aba Itens, destaca e rola até o item (flash 1,5s); setTab preserva o sufixo do hash.
- Ferramentas: chips viraram `<button aria-pressed>` (liga/desliga por tool, persiste em tools-off.json) + "desligar/ligar grupo" + feedback no cabeçalho.
- Visão: card "Reports" (stack 6 estados + % resolvido). Gráficos: "Reports por estado" (barras).
- Backend: rotas POST /api/issues/:id/update (overlay por id; nota:null limpa; elem → erSetStatus com proof padrão), /locate (tab.new em fundo + tab.activate, nunca rouba foco), /api/tools/toggle; /api/status expõe extensoes[].extId (background.js envia extId no /hello).

## Método (E2E no navegador real do dono)
Cliques reais via extensão (aba 667026409) + verificação server-side (`/api/issues` + issues-state.json):
- chip wontfix→aberto persistiu no overlay ✓ · nota digitada + salvar → "nota salva" persistiu ✓ · form campos salvos ✓ · deep-link → hash+open+flash ✓ · locate abriu aba demo.local em 2º plano ✓ · toggle n_whatsapp off/on ✓ · toggle grupo ✓.
- Backend curl: nota:null limpa ✓ · status externo ✓ · 422 em status inválido ✓ · elem aberto→em_resolução→aberto ✓.

## Bugs encontrados e corrigidos
1. `.edform{display:grid}` vencia `[hidden]` da UA → `.edform[hidden]{display:none}`.
2. fb morto pelo refresh (re-render destrói o elemento) → `fbPendente(id,msg)` reaplicado no renderItens.
3. Toggle stale: clique rápido durante o voo usava state.tools antigo (alvo invertido) → guarda `state.toggling` + fetchTools retorna Promise.
4. `pth` declarado fora do bloco GET → 500 "pth is not defined" → movido para fora do if.
5. extId derivado do path estava errado → agora real via /hello: onggagcakmjccmapfhhmgkofhhfghbnl.

## Verificações
- Contraste (8 pares novos): todos ≥6.52:1 (muted/card 6.52 · erro 6.59 · aviso 10.80 · ok 10.66 · texto 17.49 · acento 15.50).
- Smoke: 30 pass / 0 fail.
- Console da aba painel: sem erros.

## Evidências (arquivos)
- 16-visao-1280 · 17-itens-1280 · 18-graficos-1280 · 19-ferramentas-1280
- 20-visao-375 · 21-itens-375 · 22-graficos-375 · 23-ferramentas-375
- 24-popup-estrutural-headless.png — render do popup.html via headless (SEM-ARQUIVO do render real)

## Lacuna declarada
- `24-popup-painel.png` (render real no Chrome do dono) = **SEM-ARQUIVO**: `tab.shot` só fotografa a aba visível da janela focada e o dono estava em outra janela (arena.ai); roubar foco de SO é proibido. O render real foi verificado 2× na sessão (23 e 25 kB, relógio datado 2026-10-30T13:19:40Z no canto) — botão "Painel" presente e funcional (chrome.tabs.create) — mas os bytes não chegaram a disco. Fallback estrutural gravado (24-popup-estrutural-headless.png): botão renderiza, linhas de status degradadas ("carregando…" / "cliente: _") por falta da extensão no headless.

captura 10:29 > última edição 10:13 ✓
