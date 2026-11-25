# Canivete — extensão local para o Chrome (MV3, sem loja, sem nuvem)

Ponte entre o MCP `canivete` e ESTE Chrome (perfil logado).

## Instalar (1 vez)

1. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → esta pasta.
2. Clique no ícone → cole o token (gerado em `~/.config/canivete/token.txt` na primeira execução do servidor) → **Salvar**.
3. Status **ATIVO**. Janela **normal** (anônima é invisível para a extensão).

## Atualizar

A extensão se atualiza **sozinha**: o worker compara o `manifest.json` do disco com o
carregado a cada ~60s idle e se recarrega quando a versão muda (content script já se
auto-reinjeta; `mon-hook.js` lê do disco a cada injeção). **Convenção: bump na
`version` do manifest a cada mudança na extensão** — é o gatilho do auto-update.
`cv_owner_inspect {action:"status"}` mostra as versões `bg`/`ub` em execução; se diferirem dos arquivos, a extensão recarrega sozinha.
Manual só em 2 casos: migração de pasta (esta seção) ou `act {action:"reload-extension"}` p/ forçar na hora.

## Arquivos

| Arquivo | Papel |
|---|---|
| `background.js` | Service worker: ponte HTTP `127.0.0.1:19422`, fila de comandos, CDP, grupos de guias, foco da janela, relay de mensagens do painel e auto-reload remoto. |
| `content.js` | Content script (mundo isolado): leitura, overview, snapshot, ações DOM, progresso e marcações visuais isoladas, shadow DOM, delta pós-ação e cursor animado. |
| `mon-hook.js` | Hook de observabilidade (mundo MAIN): console + erros JS + fetch/XHR; erros sobem sozinhos via push. |
| `popup.html` / `popup.js` | Popup: colar token, status ATIVO/pausado, testar conexão. |
| `manifest.json` | MV3 (`debugger` para CDP, `tabGroups`, `scripting`, `tabs`, `storage`, `alarms`). |

## Painel de progresso na página

`cv_owner_act {action:"panel",mode:"open",message:"Conferindo a página"}` exibe status, etapas e marcações visuais. `action:"flow"` atualiza cada etapa; `showProgress:false` oculta o painel. As marcações ficam numa camada isolada e não alteram os atributos do site. `cv_owner_inspect {action:"overview"}` retorna um mapa compacto com regiões, títulos, formulários e seletores prontos para as ações.

## Segurança

- **Pausar** no popup = o modelo não enxerga nem toca em nada.
- Guias novas abertas pelo agente entram no grupo “Canivete · agente”; qualquer guia escolhida continua acessível. As ações preservam o foco e o cursor atuais; `focus:true` traz o Chrome à frente. Guias novas abrem em segundo plano; `active:true` seleciona a nova guia.
- O painel de progresso oferece status, plano e marcações numa camada visual isolada. Ele continua na mesma guia entre sites. As anotações não alteram atributos do site.
- O cursor animado e o `mousemove` CDP atuam na página; não deslocam o ponteiro físico do sistema operacional.
- O alcance configurado no popup controla quais ações e sites a extensão atende; não há confirmação por chamada no Canivete.
- Tudo via `localhost` + token. Nunca compartilhe o token.
- A depuração CDP é mantida por aba e reutilizada entre cliques, movimentos e leituras; o aviso amarelo do Chrome aparece uma vez e pode ser ocultado pelo usuário. Para encerrar a sessão e remover o aviso, use `cv_owner_act {action:"cdp", off:true, tabId}`.
