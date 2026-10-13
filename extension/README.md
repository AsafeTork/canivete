# Canivete UBrowser — extensão local (MV3, sem loja, sem nuvem)

Ponte entre o MCP `canivete` e ESTE Chrome (perfil logado).

## Instalar (1 vez)

1. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → esta pasta.
2. Clique no ícone → cole o token (gerado em `~/.config/canivete/token.txt` na primeira execução do servidor) → **Salvar**.
3. Status **ATIVO**. Janela **normal** (anônima é invisível para a extensão).

## Atualizar

A extensão se atualiza **sozinha**: o worker compara o `manifest.json` do disco com o
carregado a cada ~60s idle e se recarrega quando a versão muda (content script já se
auto-reinjeta; `mon/wa-hook.js` lêem do disco a cada injeção). **Convenção: bump na
`version` do manifest a cada mudança na extensão** — é o gatilho do auto-update.
`n_ubrowser_status` mostra `bg`/`ub` rodando (se diferente do disco, o reload vem sozinho).
Manual só em 2 casos: migração de pasta (esta seção) ou `act {action:"reload-extension"}` p/ forçar na hora.

## Arquivos

| Arquivo | Papel |
|---|---|
| `background.js` | Service worker: ponte HTTP `127.0.0.1:19422`, fila de comandos, cursor-remoto (clique TRUSTED via CDP com fallback sintético), escalada de clique com verificação, relay de alertas p/ `/ubpush`, auto-reload remoto (`tab.reload-extension`). |
| `content.js` | Content script (mundo isolado): leitura, snapshot, ações DOM, shadow DOM, delta pós-ação, estética, cursor visual. |
| `mon-hook.js` | Hook de observabilidade (mundo MAIN): console + erros JS + fetch/XHR; erros sobem sozinhos via push. |
| `wa-hook.js` | Hook do WhatsApp Web (mundo MAIN): `state/chats/open/read/send/ids`. |
| `popup.html` / `popup.js` | Popup: colar token, status ATIVO/pausado, testar conexão. |
| `manifest.json` | MV3 (`debugger` p/ clique trusted, `scripting`, `tabs`, `storage`, `alarms`). |

## Segurança

- **Pausar** no popup = o modelo não enxerga nem toca em nada.
- O modelo só age quando o dono pede. Fechar abas e roubar foco são proibidos no código.
- Ações de alto risco (pagamento, senha, excluir conta, apagar tudo) exigem `confirm` com frase do dono.
- Tudo via `localhost` + token. Nunca compartilhe o token.
- Clique trusted mostra o banner amarelo "depurando" do Chrome durante o clique (some sozinho).
