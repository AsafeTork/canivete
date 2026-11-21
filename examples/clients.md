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
#     "CANIVETE_HOST_GUARD_MS": "170000", # clamp de resposta (~170s)
#     "CANIVETE_CHROME_BIN": "/usr/bin/google-chrome",
#     "CANIVETE_BROWSER_TIMEOUT_MS": "40000",
#     "CANIVETE_CDP_TIMEOUT": "25000",
#     "CANIVETE_MAX_BODY": "2097152",     # teto do POST no modo remoto --http
#     "CANIVETE_CTX_BUDGET": "200000"     # orçamento p/ cv_ctx_status
#   }
#   NOTA: subagentes (cv_task*) desativados por RAM — reative com CANIVETE_TASK_ENABLE=1.
#   Runner legado (só vale com a família task ativa): CANIVETE_RUNNER + CANIVETE_RUN_TEMPLATE.

# Tarefas longas (com progresso, sem sleep cego):
#   shell ≤10min:   cv_bash({command:"npm install", timeout:600000})
#   servidor fundo: cv_manage_background_process({action:"start", command:"npm run dev"})
#                   cv_manage_background_process({action:"read_logs", process_id:"bg..."})
#                   cv_code_verify {action:"ui"}({url:"http://localhost:5173", expect:"<texto>", retries:3})

# Erros comuns (ver README "Erros comuns"):
#   SPA vazio (cv_webfetch é SEM JS) → cv_browser_read
#   429 / no results → aguarde 60s; search com fresh:false (cache 10min)
#   EXTENSAO_OFFLINE → cv_owner_inspect {action:"status"} (janela normal + popup ATIVO + token)
#   SSRF intranet → CANIVETE_BROWSER_ALLOW_PRIVATE=1
