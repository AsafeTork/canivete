# Estudo aplicado: instruções enxutas e atuação no Chrome

**Decisão:** orientar o agente com poucas regras de encaminhamento e nomes públicos estáveis (`cv_*`), permitindo que escolha parâmetros conforme a tarefa. No Chrome autenticado, agrupar guias criadas pelo Canivete, manter todas as guias existentes selecionáveis e focar a janela ao agir. Deixar `focus:false` como opção explícita. CDP deve estar disponível quando a interação DOM comum não cobrir a página. Pedir confirmação só nos casos de alto risco, incluindo fechamento em lote.

## Pergunta e hipóteses

- **H1 — instruções menores reduzem tokens sem degradar o uso:** descrições diretas, estrutura legível e exemplos apenas quando resolvem ambiguidade devem reduzir repetição e carga cognitiva.
- **H2 — modos claros batem listas de proibições:** ensinar o agente a escolher inspect, act, browser, arquivos ou código por intenção é mais transferível que memorizar dezenas de sequências obrigatórias.
- **H3 — separar guias do agente melhora a relação com o usuário sem limitar o alcance:** novas guias recebem o grupo “Canivete · agente”; o agente ainda pode escolher qualquer guia existente.
- **H4 — profundidade precisa ser real:** CDP amplia a automação dentro das permissões do Chrome; políticas, páginas protegidas e domínios CDP indisponíveis continuam limites da plataforma.

## Evidência atual

1. **OpenAI, Prompt engineering e Reasoning best practices, consultados em 20 nov. 2026.** A orientação atual favorece instruções breves e claras, títulos/delimitadores para separar contexto e regras, e exemplos só onde tragam precisão. O guia sugere reutilizar instruções estáveis num prefixo comum, o que também pode favorecer cache em clientes que o suportem. [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) · [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices).
2. **Chrome Extensions APIs, consultadas em 20 nov. 2026.** `chrome.tabs` ativa uma guia, mas isso não foca por si só a janela; a API de janelas controla o foco separadamente. `chrome.tabGroups` possibilita grupos nomeados e requer permissão declarada. [Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [Windows](https://developer.chrome.com/docs/extensions/reference/api/windows) · [Tab Groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).
3. **Chrome Debugger API, consultada em 20 nov. 2026.** A permissão `debugger` fornece transporte de comandos CDP por target/guia; Chrome também documenta domínios restritos e bloqueio por políticas empresariais. Portanto, “CDP completo” significa superfície CDP disponibilizada pela extensão, não acesso irrestrito ao sistema operacional ou ao Chrome. [Debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger).

## Cruzamento (ACH)

| Observação | H1 | H2 | H3 | H4 |
|---|---|---|---|---|
| OpenAI recomenda concisão, instruções específicas e estrutura clara | apoia | apoia | — | — |
| APIs separam ativar guia e focar janela | — | — | apoia a implementação em duas etapas | limita o que “foco” quer dizer |
| API de grupos existe e tem permissão própria | — | — | apoia agrupamento sem reclassificar guias antigas | — |
| CDP opera em targets, com domínios e políticas restritos | — | — | — | apoia: ampliar capacidade sem prometer acesso impossível |

**Surpresa e implicação:** o foco da janela não acompanha automaticamente a ativação da guia. Por isso o caminho precisa fazer as duas operações, e o parâmetro de opt-out precisa estar disponível no schema e no prompt. A separação visual pode existir sem “propriedade” exclusiva: agrupar só as guias criadas pelo agente mantém as demais acessíveis.

## Mudanças aplicadas nesta PR

- Prompt de orquestração e agente MCP reescritos em instruções curtas por intenção, sem regras repetidas de proibição e sem sequência obrigatória de chamadas.
- `cv_owner_act` explica o escopo de guia, foco padrão/opt-out, grupo novo, cursor e CDP.
- Guias novas ficam no grupo “Canivete · agente”; ativar e interagir foca a janela-alvo por padrão. `focus:false` preserva o foco atual.
- Lista de guias aceita paginação sem limite artificial e a paginação é global também entre perfis conectados.
- Cursor tem movimento animado configurável e eventos de mouse CDP ao mover sem clicar; tempos de hover/movimento e de espera não têm teto artificial no Canivete.
- `flow` executa toda a sequência recebida, sem truncar em 12 passos; `catchup` respeita a janela e o intervalo solicitados, sem teto artificial de duração/amostras.
- Operações de CDP e tooltip também ativam a janela-alvo por padrão.
- Fechamento por prefixo pode atingir guias escolhidas pelo prefixo, mas passa a confirmação de alto risco para operação em lote.

## Limites e avaliação

Os comandos `chrome://`, páginas bloqueadas por política e domínios CDP não expostos pela extensão continuam sujeitos às regras do Chrome. O cursor desenhado na página e os eventos de mouse do CDP não equivalem a mover o ponteiro físico do sistema operacional. Essa diferença deve ser reportada sem apresentar a capacidade como controle do desktop.

A pesquisa sustenta o desenho das instruções e o uso das APIs; ainda não prova ganho de acerto. Para medir o efeito dos prompts, usar tarefas reais e comparar seleção correta de modo, número de chamadas, argumentos inválidos e tokens de schema/resposta antes/depois, mantendo modelo e tarefas constantes.
