---
name: canivete
description: Use for full local dev via canivete MCP tools (filesystem, shell, web, subagents, DevEngine, headless browser, owner's logged-in Chrome). Global, works in any project or CLI.
---

# Canivete — toolkit MCP universal (55 tools `n_*`)

Servidor: `src/server.mjs` (zero deps, Node 22+). Registro por CLI em `examples/`.
Runner de subagentes: opencode (total) ou genérico (`CANIVETE_RUN_TEMPLATE`).

## Tools (55) — 1 linha cada (nomes conferidos via `rg 'reg\("n_' src/`)

### Filesystem + execução (8)

| Tool | Uso |
|---|---|
| `n_read` | Ler arquivo numerado (`offset/limit/maxChars`); inspecionar antes de editar. |
| `n_list` | Árvore+tamanhos (`depth` 1–6); mapear pasta antes de `glob/read`. |
| `n_write` | Criar/sobrescrever (novo ou rewrite total); pontual → `n_edit`. |
| `n_edit` | Troca exata `oldString→newString` (0 matches/ambíguo falha). |
| `n_apply_patch` | Unified diff via `git apply` no repo root (`check`/`stat`/`reverse`). |
| `n_bash` | Shell no repo root (`timeout` até 600s; acima → background). |
| `n_glob` | Achar arquivos por glob (até 500); antes de `n_read`. |
| `n_grep` | Regex `path:line:trecho`; localizar símbolo antes de `n_analyze_change_impact`. |

### Web + APIs sem chave (2+7)

| Tool | Uso |
|---|---|
| `n_webfetch` | URL **SEM JS** (`<article>/<main>`); SPA → `n_browser_navigate`. |
| `n_websearch` | 7 backends, cache 10min; `fresh:true` força ao vivo. |
| `n_currency` | Câmbio ECB/Frankfurter (cache 1h). |
| `n_cep` | CEP→endereço ViaCEP (24h). |
| `n_cnpj` | CNPJ→empresa ReceitaWS (24h, rate-limited). |
| `n_ipinfo` | IP→geo ip-api.com (45 req/min, 10min). |
| `n_weather` | Previsão Open-Meteo lat/lon 1–7d (30min). |
| `n_github` | repo/releases/commits/issues (60 req/h, 10min). |
| `n_npm` | Pacote npm (versão/licença/deps/downloads mês; 1h). |

### Orquestração (12)

| Tool | Uso |
|---|---|
| `n_task` | Spawn (`model` obrigatório opencode; `background:true` + `depends_on`/`label`/`ephemeral`). Tipos: `mcp-only` (só `n_*`) `explore` `quick` `general` `reviewer`. |
| `n_task_wait` | `any` (1º) / `all` (todas); clamp ~170s — **chame de novo** se rodando. |
| `n_list_models` | **PASSO 1** antes de `n_task` (escolha obrigatória no modo opencode). |
| `n_task_status` | Estado sem bloquear (modelo, `mailbox:N`, `idle`, `interrupted`). |
| `n_task_send` | Msg p/ mailbox (`main`/task, `ttl_ms`); conclusão sempre avisa `main`. |
| `n_task_recv` | Lê+esvazia (destrutivo; `timeout` máx 170s). |
| `n_task_peek` | Espia sem esvaziar. |
| `n_task_tail` | Transcrição parcial ao vivo (progresso). |
| `n_task_notifications` | Notifs + correio dormindo (esvazia notifs). |
| `n_task_delete` | Exclui; `running` mata; `all`/`ephemeral` p/ limpeza. |
| `n_todowrite` | Lista in-memory (`replace`/`append`); volátil. |
| `n_todo` | Lê lista in-memory. |

### DevEngine (8) — roteamento: arch→investigate→impact→patch→test

| Tool | Uso |
|---|---|
| `n_get_architecture_summary` | Topologia sem varrer (`depth` 1–3, `focus_module`). |
| `n_investigate_issue` | Keyword OR ranqueada 12→8 (`symptom` + `stack_trace` opcional). |
| `n_analyze_change_impact` | Callers+testes **antes** de editar (`callers`/`callees`, `top` ≤50). |
| `n_apply_semantic_patch` | Edição `node --check` (`dry_run` sem escrever; `create_if_missing`). |
| `n_execute_targeted_tests` | `diff_only`/`module`+`target_path`/`full` (vitest/jest/mocha). |
| `n_manage_background_process` | `start/stop/restart/status/read_logs` (sem bloquear; `send` indisponível). |
| `n_inspect_ui_state` | HTTP da UI + `expect` FOUND/MISSING (`retries` 0–3). |
| `n_orchestrate_task` | DAG `init/checkpoint/resume/rollback` (`confirm:true` p/ executar). |

### Browsers (5 headless + 6 dono)

| Tool | Uso |
|---|---|
| `n_browser_navigate` | SPA com JS (título+texto+links; `waitMs`, `cookies`). |
| `n_browser_snapshot` | Interativos (`compact:true` −60% tokens). |
| `n_browser_act` | goto/click/fill/press/scroll/wait/`evaluate` (`console:true` = 30 logs). |
| `n_browser_screenshot` | PNG página/elemento (`selector`, `fullPage`). |
| `n_browser_pdf` | PDF em `/tmp`. |
| `n_ubrowser_status` | **Antes de tudo** no Chrome do dono (offline → janela normal + popup ATIVO). |
| `n_ubrowser_tabs` | Abas (IDs mudam; prefira `tab:"trecho"`). |
| `n_ubrowser_read` | Aba logada (`distill` default; `raw` integral+links). |
| `n_ubrowser_snapshot` | Clicáveis (`max` ≤120 + `offset`; `scan` antes p/ virtualizada). |
| `n_ubrowser_act` | goto/click/fill/type/select/scroll/highlight/waittext/evaluate/cursor/new/scan/flow (alto risco exige `confirm`; fechar abas e roubar foco NÃO existem). |
| `n_ubrowser_shot` | Print só aba **VISÍVEL** (fundo → `n_browser_screenshot`). |

### Meta (6) + WhatsApp (1)

| Tool | Uso |
|---|---|
| `n_tools_info` | Catálogo agrupado (descobrir o que chamar). |
| `n_question` | Pergunta ao humano (agente pergunta direto). |
| `n_skill` | Carrega SKILL (`refresh:true` lista). |
| `n_plan` | Só via `/plan` na TUI (não alternável pelo MCP). |
| `n_report` | Erro/falta/gargalo **obrigatório** em vez de improvisar (`kind/where/expected/got`). |
| `n_ctx_status` | Calls/chars/~tokens vs `CANIVETE_CTX_BUDGET` (estouro → `distill/compact`). |
| `n_whatsapp` | `state\|chats\|open\|read\|send\|pair` (send só com texto explícito do dono). |

## Tarefas longas (progresso sem sleep cego)

- `n_bash`: `timeout` default 120s, **máx 600000 (10min)**. Passou → `n_manage_background_process({action:"start", command})` + `read_logs`/`status`/`stop`.
- `n_task background:true` → **1×** `n_task_wait({task_ids, wait:"all"|"any", timeout:600000})`; clamp ~170s (`CANIVETE_HOST_GUARD_MS`) → **chame de novo**, não é erro. Ao vivo: `n_task_tail`; sem bloquear: `n_task_status`.
- Workflow: fan-out N× `background:true` → `wait any/all` → `send/recv/peek`. Subagente sempre `send({task_id:"main", message:"done <id> + resumo"})`. Limites: `CANIVETE_MAX_TASKS=3`, `CANIVETE_MAX_POLLS=8`.
- Modelo obrigatório (opencode): `n_list_models` → `model` em `n_task`. Tipos: `mcp-only|explore|quick|general|reviewer`.

## Erros comuns

| Sintoma | Ação |
|---|---|
| `n_webfetch` vazio/"SPA shell" | `n_browser_navigate({url})` (JS) ou `n_ubrowser_*` (login). |
| `429` / `no results — 429` / `GitHub rate limit` | Aguarde ~60s; search `fresh:false` (cache 10min); GitHub com `GITHUB_TOKEN`. |
| `websearch` externo 429 (parallel.ai MCP, não é nosso) | Cadeia de fallback: externo → `n_websearch` (`fresh:false`, cache 10min) → `n_browser_navigate`. |
| Fallback só após 429/zero do externo | Aguarde ~60s; não force `fresh:true` em loop (agrava 429); confirme página/preço via browser. |
| `EXTENSAO_OFFLINE` / `timeout 60s` extensão | `n_ubrowser_status`: janela NORMAL, popup ATIVO, token `~/.config/canivete/token.txt`. |
| `SSRF bloqueado: host privado` | URL pública ou `CANIVETE_BROWSER_ALLOW_PRIVATE=1`. |
| `chrome://` sem ação | Bloqueio do Chrome (só páginas web). |
| Aba `NOTFOUND` / snapshot vazio | Reliste `tabs`; use `tab:"trecho"`; `scan {pages:4}` antes de `snapshot`. |
| `evaluate → undefined` | Falta `return ...`; CSP bloqueado não tem workaround. |
| `shot` fundo sem print | Traga p/ frente ou `n_browser_screenshot`. |
| `n_bash` timeout | `timeout` até 600000 ou background + `read_logs`. |
| `n_task` sem runner | `CANIVETE_RUNNER` + `CANIVETE_RUN_TEMPLATE="{prompt} {model} {agent} {id}"`. |
| `wait timeout — ainda rodando` | Chame `n_task_wait` de novo (`tail`/`status` p/ progresso). |
| Qualquer erro/falta/gargalo | `n_report` em vez de improvisar. |

## Env (`CANIVETE_*`)

Execução/limites: `CANIVETE_CWD` (repo), `CANIVETE_RUNNER` (`opencode`) + `CANIVETE_RUN_TEMPLATE`, `CANIVETE_HOST_GUARD_MS` (170000), `CANIVETE_MAX_TASKS` (3), `CANIVETE_MAX_POLLS` (8), `CANIVETE_MAX_BODY` (2MB remoto), `CANIVETE_CTX_BUDGET` (200000), `CANIVETE_MAX_MSGS` (100)/`CANIVETE_MAX_MSG_CHARS` (4000), `CANIVETE_WALK_CAP` (8000)/`CANIVETE_WALK_DEPTH` (8).
Browser: `CANIVETE_CHROME_BIN` (auto-detect), `CANIVETE_CDP_PORT` (19322), `CANIVETE_CDP_TIMEOUT` (25000, WS open 10000), `CANIVETE_BROWSER_TIMEOUT_MS` (40000; PDF 60000), `CANIVETE_BROWSER_ALLOW_PRIVATE` (`1` libera intranet), `CANIVETE_CHROME_PROFILE`, `CANIVETE_BRIDGE_PORT` (19422), `CANIVETE_TOKEN`/`CANIVETE_TOKEN_FILE` (`~/.config/canivete/token.txt`).
Tasks/skills: `CANIVETE_AGENTS`, `CANIVETE_MODELS_FILE` (`config/models.json`), `CANIVETE_TASK_PREFIX`, `CANIVETE_DB_TIMEOUT_MS` (5000)/`CANIVETE_EXPORT_TIMEOUT_MS` (8000), `CANIVETE_SKILLS_PATHS`, `CANIVETE_WATCH_MAIN`/`CANIVETE_WATCH`, `CANIVETE_SERVER_NAME`, `MCP_BROKER_DIR` (mailbox).

## Doutrina

- Ozônio: só age quando o dono pede. Destrutivo/idiota nunca sem pedido explícito; alto risco exige `confirm`.
- Obediência auditável: nunca faça na mão o que tem tool; siga o roteamento (arch→investigate→impact→patch→test); sem evidência arquivo:linha = recusado. Principal confere `n_task_status`.
- Confie no MCP (sem polling manual): 1 wait longo em vez de sleep loops; subagente sempre avisa `main` ao concluir; notificações acordam quem espera.
- Refine em produção: `n_report` p/ todo erro/falta/gargalo em vez de improvisar.

## ubrowser em 30s

1. Ler página logada:
`n_ubrowser_status` → `n_ubrowser_tabs` → `n_ubrowser_read({"tab":"trecho título/URL"})`
2. Clicar com snapshot compact:
`n_ubrowser_snapshot({"tab":"trecho","compact":true})` → `n_ubrowser_act({"action":"click","selector":"SELETOR"})`
### Onde clicar (snapshot compact → role+name → act)
1. `n_ubrowser_snapshot({"tab":"trecho","compact":true})` → linhas `ref|tag|text` com `role+name` (ex. `button "Entrar"`).
2. Escolha pelo `role+name`, não por `tabId`/`ref` (IDs mudam a cada restart/navegação — use `tab:"trecho"`).
3. `n_ubrowser_act({"action":"click","tab":"trecho","selector":"SELETOR"})` com o `selector` da linha escolhida.
4. Lista virtualizada? `act({action:"scan",pages:4})` antes do `snapshot`; vazio? `tabs` + F5 e `snapshot` de novo.
5. Aba de fundo? `read`/`snapshot` funcionam; `shot` só imprime a aba VISÍVEL (detalhe: `compact:false` traz `selector+x/y`).
3. WhatsApp abrir chat:
`n_whatsapp({"action":"open","name":"Nome do chat"})` → `n_whatsapp({"action":"read","name":"Nome do chat"})`

## ubrowser dentro de n_task (economia)

Subagente com browser = 500MB filho + snapshots gigantes retidos em `tailRaw`. Sem economia o pai estoura `CANIVETE_CTX_BUDGET`.

1. `compact:true` sempre — `n_ubrowser_snapshot({"tab":"trecho","compact":true})` (~60% menos tokens; auto-compact acima de 30 elementos; `compact:false` só p/ detalhe `selector+x/y`).
2. `max:30` — nunca default 50/120 em subagente; pagine com `offset` (`max:30 offset:0/30/...`) até o fim.
3. Nunca screenshot salvo em `result` — `n_ubrowser_shot` (e `n_browser_screenshot` com `scale:0.5`) SÓ quando o dono pedir evidência visual; imagem nunca vai p/ `result`/mailbox/`tail`, só confirmação textual.
4. `read` distill — `n_ubrowser_read({"tab":"trecho","mode":"distill"})` default (~4000 chars, `maxChars:2500`/`maxLinks:15`); `mode:"raw"` só opt-out.
5. 1 snapshot por decisão, não loop — 1 `snapshot` → 1 `act` (`changed`/`after` confirma sem re-ler); nunca `snapshot` em loop; virtualizada faz `scan {pages:4}` antes, vazio relista `tabs` + F5.

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
