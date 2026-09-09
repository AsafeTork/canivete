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
