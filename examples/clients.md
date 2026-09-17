# Claude Code — registrar o canivete (rode no terminal):
claude mcp add canivete -- node /caminho/para/canivete/src/server.mjs

# Com variáveis (runner genérico + projeto fixo):
# CANIVETE_CWD=/meu/projeto CANIVETE_RUNNER=claude \
#   CANIVETE_RUN_TEMPLATE="claude -p {prompt}" \
#   claude mcp add canivete --env CANIVETE_CWD=/meu/projeto \
#   --env CANIVETE_RUNNER=claude \
#   --env CANIVETE_RUN_TEMPLATE="claude -p {prompt}" \
#   -- node /caminho/para/canivete/src/server.mjs

# Genérico (qualquer cliente MCP stdio):
#   command: node
#   args: ["/caminho/para/canivete/src/server.mjs"]
#   cwd: /meu/projeto
#   env: { "CANIVETE_CWD": "/meu/projeto" }

# Com limites de tarefas longas + browser (todos opcionais, defaults entre parênteses):
#   env: {
#     "CANIVETE_MAX_TASKS": "3",          # teto de tasks ativas (foreground)
#     "CANIVETE_MAX_POLLS": "8",          # polls ativos aguardando subagente
#     "CANIVETE_HOST_GUARD_MS": "170000", # clamp do n_task_wait (~170s; chame de novo)
#     "CANIVETE_CHROME_BIN": "/usr/bin/google-chrome",
#     "CANIVETE_BROWSER_TIMEOUT_MS": "40000",
#     "CANIVETE_CDP_TIMEOUT": "25000",
#     "CANIVETE_MAX_BODY": "2097152",     # teto do POST no modo remoto --http
#     "CANIVETE_CTX_BUDGET": "200000"     # orçamento p/ n_ctx_status
#   }

# Tarefas longas (com progresso, sem sleep cego):
#   shell ≤10min:   n_bash({command:"npm install", timeout:600000})
#   servidor fundo: n_manage_background_process({action:"start", command:"npm run dev"})
#                   n_manage_background_process({action:"read_logs", process_id:"bg..."})
#                   n_inspect_ui_state({url:"http://localhost:5173", expect:"<texto>", retries:3})
#   subagentes:     n_list_models
#                   n_task({prompt:"...", model:"<da lista>", background:true})
#                   n_task_wait({task_ids:["..."], wait:"all", timeout:600000})  # clamp ~170s: chame de novo
#                   n_task_tail({task_id:"..."})  # progresso ao vivo

# Erros comuns (ver README "Erros comuns"):
#   SPA vazio (n_webfetch é SEM JS) → n_browser_navigate
#   429 / no results → aguarde 60s; search com fresh:false (cache 10min)
#   EXTENSAO_OFFLINE → n_ubrowser_status (janela normal + popup ATIVO + token)
#   SSRF intranet → CANIVETE_BROWSER_ALLOW_PRIVATE=1
