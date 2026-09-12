---
name: canivete
description: Use for full local dev via canivete MCP tools (filesystem, shell, web, subagents, DevEngine, headless browser, owner's logged-in Chrome). Global, works in any project or CLI.
---

# Canivete — toolkit MCP universal (51 tools `n_*`)

Servidor: `src/server.mjs` (zero deps, Node 22+). Registro por CLI em `examples/`.
Runner de subagentes: opencode (total) ou genérico (`CANIVETE_RUN_TEMPLATE`).

## Camadas

1. **Filesystem + execução (8):** `n_read` (linhas numeradas, `offset/limit/maxChars`), `n_list` (árvore+tamanhos), `n_write`/`n_edit` (texto exato, falha segura)/`n_apply_patch` (git apply), `n_bash` (exit+stdout/stderr truncados), `n_glob`, `n_grep`.
2. **Web sem chave (2+7):** `n_webfetch` (só `<article>/<main>`, `maxChars`; SEM JS — SPA vai no browser), `n_websearch` (7 backends, cache 10min), `n_currency/n_cep/n_cnpj/n_ipinfo/n_weather/n_github/n_npm` (TTL).
3. **Orquestração (10+2):** `n_task({prompt, model, subagent_type, background, ephemeral})` → `n_task_wait(any/all)` → `n_task_status/send/recv/tail/delete/notifications` + `n_list_models`, `n_todowrite/n_todo`. Model obrigatório no modo opencode.
4. **DevEngine (8):** `n_get_architecture_summary` (topologia sem varrer) → `n_investigate_issue` (ranking) → `n_analyze_change_impact` → `n_apply_semantic_patch` (node --check) → `n_execute_targeted_tests` → `n_manage_background_process`, `n_inspect_ui_state`, `n_orchestrate_task` (DAG git-stash).
5. **Browsers (11):** headless `n_browser_navigate/snapshot/act/screenshot/pdf` (CDP próprio) + dono `n_ubrowser_status/tabs/read/snapshot/act/shot` (extensão `extension/`, token `~/.config/canivete/token.txt`). `n_ubrowser_read` modo distill default (destilado enxuto; raw opt-out); cursor teleporte sem trajetória (só representa a ação); aba de fundo via `tabId`/`new`; fechar abas e roubar foco NÃO existem.
6. **Meta (4):** `n_tools_info`, `n_question`, `n_skill`, `n_plan`.

## Doutrina

- Ozônio: só age quando o dono pede. Destrutivo/idiota nunca sem pedido explícito; alto risco exige `confirm`.
- Obediência auditável: nunca faça na mão o que tem tool; siga o roteamento (arch→investigate→impact→patch→test); sem evidência arquivo:linha = recusado. Principal confere `n_task_status`.
- Confie no MCP (sem polling manual): 1 wait longo em vez de sleep loops; subagente sempre avisa `main` ao concluir; notificações acordam quem espera.
- Refine em produção: `n_report` p/ todo erro/falta/gargalo em vez de improvisar.

## Troubleshooting ubrowser
- Lista virtualizada (só visíveis no DOM) → `tab.scan` antes de `snapshot`.
- `chrome://`, `edge://`, Chrome Web Store = bloqueado pelo Chrome (content script não injeta).
- Aba sumiu / NOTFOUND → reliste `tabs` (IDs mudam a cada restart/navegação).
- Snapshot vazio ou `v` antiga → F5 na página e `ping` (versão desatualizada).
- Login agora permitido; só troca de senha/pagamento bloqueia (alto risco exige `confirm`).
- `evaluate` precisa retornar valor (`return ...`); sem return vem `undefined`.
- `n_ubrowser_act scan {pages:4, container?}` p/ listas virtualizadas (rola e coleta antes do `snapshot`).
- `tab:"trecho título/URL"` em read/snapshot/act/shot/scan (IDs mudam — prefira nome a `tabId`).

## Regra sem-sleep
- Nunca sleep cego (tempo fixo esperando processo/render/rede); esperar = ouvir evento/notificação com teto e erro imediato no estouro.
- Follow-up retorna assim que possível (poll curto + saída antecipada); sem `setTimeout` pós-ação p/ "assentar DOM".
- Onde vale: content (MutationObserver), background (tabs.onUpdated), server/CDP (readyState/WS/long-poll com timeout).
