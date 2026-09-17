# TOOLS — catálogo gerado a partir do código

> GERADO AUTOMATICAMENTE por `node scripts/gen-catalog.mjs` — NÃO EDITE MANUALMENTE.
> Fonte: parse estático de `reg("n_*", { description: ... })` em `src/lib/*.mjs` + `src/server.mjs` (sem importar o servidor — importar `src/server.mjs` registra tudo e mantém o processo vivo via watch/readline).
> Total: 56 tools. Gerado em 2026-09-17.

| nome | arquivo | descrição (1ª frase) |
|---|---|---|
| `n_analyze_change_impact` | `src/lib/devengine.mjs` | DevEngine: impacto de editar símbolo — callers + tests_affected. |
| `n_apply_patch` | `src/lib/fs.mjs` | Aplica unified diff via `git apply` NO REPO ROOT (multi-arquivo, reverse opcional). |
| `n_apply_semantic_patch` | `src/lib/devengine.mjs` | DevEngine: edição AST-validada (node --check, skip JSX). |
| `n_bash` | `src/lib/fs.mjs` | Executa shell (bash -lc) no repo root: git, npm, node, curl. |
| `n_browser_act` | `src/lib/tools-browser.mjs` | Interage via CDP: goto/back/forward/reload/click/fill/press/scroll/wait/wait_selector/evaluate. |
| `n_browser_navigate` | `src/lib/tools-browser.mjs` | Navega com Chrome headless (renderiza JS/SPA) e retorna título+texto+links. |
| `n_browser_pdf` | `src/lib/tools-browser.mjs` | Gera PDF da página via Chrome headless. |
| `n_browser_screenshot` | `src/lib/tools-browser.mjs` | Captura PNG da página ou só de um elemento (selector CSS via clip). |
| `n_browser_snapshot` | `src/lib/tools-browser.mjs` | Lista elementos interativos da página (ref, tag, texto, selector) para usar em n_browser_act. |
| `n_cep` | `src/lib/apis.mjs` | Busca CEP brasileiro (ViaCEP, cache 7 dias, com retry). |
| `n_cnpj` | `src/lib/apis.mjs` | Consulta CNPJ (ReceitaWS, cache 7 dias, rate-limited, com retry). |
| `n_ctx_status` | `src/server.mjs` | A LLM manipula o próprio contexto: mostra gasto da sessão (calls, chars, ~tokens por tool) vs orçamento CANIVETE_CTX_BUDGET. |
| `n_currency` | `src/lib/apis.mjs` | Taxa de câmbio/conversão (ECB/Frankfurter, diário, cache 1h). |
| `n_edit` | `src/lib/fs.mjs` | Troca texto exato (oldString→newString, replaceAll default true, dryRun conta matches). |
| `n_execute_targeted_tests` | `src/lib/devengine.mjs` | DevEngine: executa testes com detecção de runner (vitest/jest/mocha via devDependencies). |
| `n_find_tools` | `src/server.mjs` | Busca local de tools por keyword (tool-search enxuto). |
| `n_get_architecture_summary` | `src/lib/devengine.mjs` | DevEngine: topologia leve do projeto (package.json + scans de features/functions, sem ler arquivos inteiros). |
| `n_github` | `src/lib/apis.mjs` | API do GitHub (60 req/h sem token, cache 10min, com retry). |
| `n_glob` | `src/lib/fs.mjs` | Acha arquivos por glob (** suportado, até 500). |
| `n_grep` | `src/lib/fs.mjs` | Busca regex no conteúdo (path:line:trecho ≤300 chars, maxResults 100, include glob, ignoreCase). |
| `n_inspect_ui_state` | `src/lib/devengine.mjs` | DevEngine: checagem HTTP da UI (status + conteúdo). |
| `n_investigate_issue` | `src/lib/devengine.mjs` | DevEngine: busca keyword OR (12 hits→3) com score por proximidade (mesma linha > mesmo arquivo) + bônus nome-arquivo/símbolo + penalidade vendor + porquê 1 linha. |
| `n_ipinfo` | `src/lib/apis.mjs` | Geolocalização de IP (ip-api.com, 45 req/min, cache 10min, com retry). |
| `n_list` | `src/lib/fs.mjs` | Lista árvore de diretório com tamanhos (depth 1-6, maxLines 1500). |
| `n_list_models` | `src/lib/tasks.mjs` | PASSO 1 antes de n_task: lista modelos disponíveis. |
| `n_manage_background_process` | `src/lib/devengine.mjs` | DevEngine: start/stop/restart/status/read_logs de servidores sem bloquear. |
| `n_npm` | `src/lib/apis.mjs` | Info do pacote npm (cache 1h, com retry). |
| `n_orchestrate_task` | `src/lib/devengine.mjs` | DevEngine: DAG de tarefas com checkpoint/resume/rollback (git stash). |
| `n_plan` | `src/lib/tasks.mjs` | Plan mode cannot be toggled from an MCP server; use /plan in the TUI. |
| `n_question` | `src/lib/tasks.mjs` | Registra pergunta p/ o usuário. |
| `n_read` | `src/lib/fs.mjs` | Lê arquivo texto com números de linha (offset/limit, raw, maxChars até 100k) ou lista diretório simples. |
| `n_report` | `src/lib/feedback.mjs` | Reporta erro/falta/gargalo p/ refinar a ferramenta (inbox global). |
| `n_skill` | `src/lib/tasks.mjs` | Carrega SKILL.md por nome. |
| `n_task` | `src/lib/tasks.mjs` | Spawn subagente isolado (opencode ou genérico via CANIVETE_RUN_TEMPLATE). |
| `n_task_delete` | `src/lib/tasks.mjs` | Exclui task(s)+mailbox p/ organizar. |
| `n_task_notifications` | `src/lib/tasks.mjs` | Lê notifs de tasks + correio dormindo. |
| `n_task_peek` | `src/lib/tasks.mjs` | Espia mailbox SEM esvaziar. |
| `n_task_recv` | `src/lib/tasks.mjs` | Lê e esvazia mailbox (destrutivo). |
| `n_task_send` | `src/lib/tasks.mjs` | Envia msg p/ mailbox (não-bloqueante). |
| `n_task_status` | `src/lib/tasks.mjs` | Lista subagentes (id\|status\|tools\|elapsed\|modelo) ou detalha 1. |
| `n_task_tail` | `src/lib/tasks.mjs` | Mostra o que o subagente está GERANDO agora (transcrição parcial ao vivo via arquivo de saída). |
| `n_task_wait` | `src/lib/tasks.mjs` | Aguarda subagentes e retorna resultados. |
| `n_todo` | `src/lib/tasks.mjs` | Read the in-memory task list. |
| `n_todowrite` | `src/lib/tasks.mjs` | Substitui (replace, padrão) ou mescla (append por content igual) a lista in-memory. |
| `n_tools_info` | `src/server.mjs` | Catálogo agrupado do canivete: filesystem+exec, web/APIs sem chave, orquestração, DevEngine, browsers e meta. |
| `n_ubrowser_act` | `src/lib/tools-owner.mjs` | AUTOMAÇÃO no Chrome LOGADO do dono (só quando ele pedir; NUNCA destrutivo sem pedido; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO PROIBIDOS). |
| `n_ubrowser_read` | `src/lib/tools-owner.mjs` | Lê aba do dono COM login. |
| `n_ubrowser_shot` | `src/lib/tools-owner.mjs` | Print da aba VISÍVEL do dono (imagem + arquivo). |
| `n_ubrowser_snapshot` | `src/lib/tools-owner.mjs` | Elementos clicáveis da aba do dono (ref/tag/texto/selector). |
| `n_ubrowser_status` | `src/lib/tools-owner.mjs` | Status da ponte com o Chrome LOGADO do dono (extensão local). |
| `n_ubrowser_tabs` | `src/lib/tools-owner.mjs` | Abas do Chrome do dono (id, janela, anônima?, título, url). |
| `n_weather` | `src/lib/apis.mjs` | Previsão do tempo (Open-Meteo, cache 30min, lat/lon, 1-7 dias, com retry). |
| `n_webfetch` | `src/lib/web.mjs` | Baixa URL SEM JS e extrai texto principal + og:price/JSON-LD (tenta <article>/<main>). |
| `n_websearch` | `src/lib/web.mjs` | Busca web multi-backend (News, DDG, Wikipedia, HN, GitHub; cache 10min, dedupe por URL). |
| `n_whatsapp` | `src/lib/tools-whatsapp.mjs` | WhatsApp DEDICADO: via gateway Baileys (WebSocket, sem browser) com fallback p/ Chrome logado. |
| `n_write` | `src/lib/fs.mjs` | Cria/sobrescreve arquivo (cria pastas). |

_Regenerar: `node scripts/gen-catalog.mjs` · Validar: `node --check scripts/gen-catalog.mjs`_
