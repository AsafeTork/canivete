# Canivete — extensão local para o Chrome (MV3, sem loja, sem nuvem)

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
`cv_owner_inspect {action:"status"}` mostra as versões `bg`/`ub` em execução; se diferirem dos arquivos, a extensão recarrega sozinha.
Manual só em 2 casos: migração de pasta (esta seção) ou `act {action:"reload-extension"}` p/ forçar na hora.

## Arquivos

| Arquivo | Papel |
|---|---|
| `background.js` | Service worker: ponte HTTP `127.0.0.1:19422`, fila de comandos, CDP, grupos de guias, foco da janela, relay de mensagens do painel e auto-reload remoto. |
| `content.js` | Content script (mundo isolado): leitura, overview, snapshot, ações DOM, progresso, chat e marcações visuais isoladas, shadow DOM, delta pós-ação e cursor animado. |
| `mon-hook.js` | Hook de observabilidade (mundo MAIN): console + erros JS + fetch/XHR; erros sobem sozinhos via push. |
| `wa-hook.js` | Hook do WhatsApp Web (mundo MAIN): `state/chats/open/read/send/ids`. |
| `popup.html` / `popup.js` | Popup: colar token, status ATIVO/pausado, testar conexão. |
| `manifest.json` | MV3 (`debugger` para CDP, `tabGroups`, `scripting`, `tabs`, `storage`, `alarms`). |

## Conversa e passo a passo na página

O agente abre o painel lateral de foco com `cv_owner_act {action:"companion",mode:"open",tab:"Gmail"}`. Ele ocupa a altura da página, escurece o fundo sem bloquear as áreas livres e pode ser minimizado ou fechado. O painel é montado com APIs DOM, então funciona em páginas com Trusted Types sem inserir HTML no site. O agente pode enviar uma mensagem inicial, mostrar uma lista de passos e destacar controles por seletor com `annotations:[{selector:"button[type=submit]",label:"Enviar formulário"}]`. A anotação é desenhada no shadow root da extensão; não altera atributos nem estilos do site.

O usuário pode escrever enquanto o agente trabalha. O painel fica vinculado à sessão MCP que o abriu, e a mensagem chega no retorno de qualquer tool do Canivete nessa sessão; outras sessões não consomem a fila. Se o host multiplexa agentes numa sessão única, eles são indistinguíveis. Em `flow`, o agente pausa após a ação atual e devolve `remainingSteps`; responde com `mode:"update"` e retoma o que falta. `checkInbox:false` desliga as interrupções. Também pode ler com `mode:"read"` ou esperar com `mode:"wait",waitMs:60000`. A fila mantém até 100 mensagens e não sobrevive ao reinício do servidor. Se o turno do agente encerrou e nenhuma chamada está aguardando, MCP não consegue reativar esse turno: a mensagem fica enfileirada até a próxima chamada da mesma sessão. O histórico, a sessão do agente e o painel persistem no armazenamento de sessão da extensão ao recarregar ou navegar na mesma guia; fechar a guia ou o Chrome encerra essa sessão.

`cv_owner_act {action:"flow",steps:[{cmd:"tab.overview",label:"Entender a página"},{cmd:"tab.click",selector:"button"}]}` mostra progresso e verifica o chat entre etapas. `showProgress:false` esconde o plano; `checkInbox:false` impede que mensagens pausem a sequência. `cv_owner_inspect {action:"overview"}` retorna um mapa compacto com regiões, títulos, formulários e seletores prontos para as ações.

`cv_owner_act {action:"goto",tab:"Gmail",url:"https://example.com"}` troca a página na guia escolhida. O agente pode selecionar guias existentes de qualquer grupo; novas guias criadas por `action:"new"` entram em **Canivete · agente**. Ativar a guia ou interagir foca a janela do Chrome; passe `focus:false` para preservar o foco atual.

## Segurança

- **Pausar** no popup = o modelo não enxerga nem toca em nada.
- Guias novas abertas pelo agente entram no grupo “Canivete · agente”; qualquer guia escolhida continua acessível. Ativação traz a janela do Chrome à frente; `focus:false` preserva o foco atual. Ações sensíveis de alto risco continuam exigindo confirmação.
- O painel `companion` oferece chat, plano/progresso e marcações numa camada visual isolada. O histórico dura a sessão do Chrome e continua na mesma guia entre sites. As anotações não alteram atributos do site; mensagens chegam pela ponte local autenticada.
- O cursor animado e o `mousemove` CDP atuam na página; não deslocam o ponteiro físico do sistema operacional.
- Ações de alto risco (pagamento, senha, excluir conta, apagar tudo, fechar guias em lote) exigem `confirm` com frase do dono.
- Tudo via `localhost` + token. Nunca compartilhe o token.
- Clique trusted mostra o banner amarelo "depurando" do Chrome durante o clique (some sozinho).
