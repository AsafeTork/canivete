# Canivete UBrowser — extensão local (MV3, sem loja, sem nuvem)

Ponte entre o MCP `canivete` e ESTE Chrome (perfil logado).

## Instalar (1 vez)

1. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → esta pasta.
2. Clique no ícone → cole o token (gerado em `~/.config/canivete/token.txt` na primeira execução do servidor) → **Salvar**.
3. Status **ATIVO**. Janela **normal** (anônima é invisível para a extensão).

## Segurança

- **Pausar** no popup = o modelo não enxerga nem toca em nada.
- O modelo só age quando o dono pede. Fechar abas e roubar foco são proibidos no código.
- Ações de alto risco (pagamento, senha, excluir conta, apagar tudo) exigem `confirm` com frase do dono.
- Tudo via `localhost` + token. Nunca compartilhe o token.
