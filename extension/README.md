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

O agente abre o painel flutuante com `cv_owner_act {action:"companion",mode:"open",tab:"Gmail"}`. Ele pode enviar uma mensagem inicial, mostrar uma lista de passos e destacar controles por selector com `annotations:[{selector:"button[type=submit]",label:"Enviar formulário"}]`. A anotação é desenhada no shadow root da extensão; não altera atributos nem estilos do site.

O usuário digita no campo **Escreva para o agente**. O texto vai pela extensão ao endpoint local autenticado e fica numa fila de memória. O agente lê com `mode:"read"` ou espera uma nova mensagem com `mode:"wait",waitMs:60000`; pode responder visivelmente com `mode:"update",message:"Recebi; vou verificar…"`. A fila mantém até 100 mensagens e não sobrevive ao reinício do processo. O histórico visual e o painel pertencem ao documento atual; ao navegar para outro site na mesma guia, o agente pode reabrir o painel, mas as mensagens anteriores não são restauradas na página.

`cv_owner_act {action:"flow",steps:[{cmd:"tab.overview",label:"Entender a página"},{cmd:"tab.click",selector:"button"}]}` mostra progresso enquanto executa. O padrão é visível; `showProgress:false` desliga o painel para aquela sequência. `cv_owner_inspect {action:"overview"}` retorna um mapa compacto com regiões, títulos, formulários e selectors prontos para as ações.

`cv_owner_act {action:"goto",tab:"Gmail",url:"https://example.com"}` troca a página na guia escolhida. O agente pode selecionar guias existentes de qualquer grupo; novas guias criadas por `action:"new"` entram em **Canivete · agente**. Ativar a guia ou interagir foca a janela do Chrome; passe `focus:false` para preservar o foco atual.

## Segurança

- **Pausar** no popup = o modelo não enxerga nem toca em nada.
- Guias novas abertas pelo agente entram no grupo “Canivete · agente”; qualquer guia escolhida continua acessível. Ativação traz a janela do Chrome à frente; `focus:false` preserva o foco atual. Ações sensíveis de alto risco continuam exigindo confirmação.
- O painel `companion` oferece chat, plano/progresso e marcações numa camada visual isolada. As anotações não alteram atributos do site; mensagens do usuário chegam ao agente pela ponte local autenticada.
- O cursor animado e o `mousemove` CDP atuam na página; não deslocam o ponteiro físico do sistema operacional.
- Ações de alto risco (pagamento, senha, excluir conta, apagar tudo, fechar guias em lote) exigem `confirm` com frase do dono.
- Tudo via `localhost` + token. Nunca compartilhe o token.
- Clique trusted mostra o banner amarelo "depurando" do Chrome durante o clique (some sozinho).
