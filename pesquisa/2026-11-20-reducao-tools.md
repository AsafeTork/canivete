# Estudo: reduzir tools sem tirar a precisão do Canivete

**Data:** 2026-11-20
**Pergunta original → decisão operacional:** “Como reduzir as tools e retirar as redundantes?” → quais capacidades devem virar modos de uma mesma tool, quais precisam continuar separadas por intenção ou risco, e qual redução testar sem piorar a taxa de acerto da IA.

## Decisão recomendada

A implementação inicial reduziu o catálogo anunciado de **65 para 36 tools ativas**. Agrupou operações do mesmo recurso e nível de risco, preservando os executores antigos como aliases internos. Esta contagem é uma decisão de interface, não prova de maior acerto da IA; a comparação com tarefas reais ainda está pendente.

O princípio do dono para este estudo é: **um canivete com lâmina precisa, não uma caixa de máquinas**. A IA deve dizer o que quer fazer em palavras comuns e escolher uma opção explícita; os parâmetros específicos fazem o trabalho fino. A simplicidade fica na escolha da ferramenta; a precisão fica nos parâmetros, validação e resultado.

## Hipóteses registradas

O inventário local já existia antes deste estudo; por isso, estas hipóteses foram registradas após a leitura inicial do catálogo, e não antes dela. As hipóteses foram registradas após a leitura inicial do catálogo e antes da implementação; a validação com tarefas reais continua pendente:

| # | Hipótese | O que a derruba | Confiança inicial | Resultado da leitura |
|---|---|---|---|---|
| H1 | Agrupar modos pelo mesmo recurso pode reduzir o catálogo sem reduzir a precisão. | A IA erra mais os modos/parâmetros ou conclui menos tarefas que com o catálogo atual. | provável (75±12%) | implementada no catálogo; acerto com usuários/IA ainda não medido. |
| H2 | Diferenças de permissão/risco devem continuar visíveis na fronteira entre tools. | Um schema por modo e validação explícita preservam a mesma compreensão de segurança numa tool única. | provável (75±12%) | apoiada: as anotações MCP são aplicadas por tool, não por modo. |
| H3 | Há redundâncias reais no Canivete além de “muitas tools”. | As operações em questão têm contratos, alvos e decisões diferentes e não podem ser escolhidas por um modo simples. | provável (75±12%) | as redundâncias mapeadas foram agrupadas em `cv_file_read`, `cv_browser_read` e `cv_help`. |
| H4 | Remover ou consolidar só pelo número pode piorar a experiência. | Uma contagem menor melhora o acerto sem aumentar erros, parâmetros inválidos ou chamadas extras. | provável (75±12%) | apoiada; falta avaliação comparativa do Canivete. |

## Evidências coletadas

### Fatos do repositório

- O catálogo anterior tinha **65 tools ativas**; o catálogo implementado declara 36 e chega a 40 quando a família opcional de tarefas está ativa ([docs/TOOLS.md](../docs/TOOLS.md)).
- O benchmark atual mede **24.298 bytes** no catálogo MCP (46,1% abaixo dos 45.098 bytes anteriores), executa 21/36 tools e omite 15 por privacidade, estado ou risco. É tamanho serializado em bytes, não contagem exata de tokens ([docs/BENCH.md](../docs/BENCH.md)).
- Há agrupamentos candidatos visíveis no próprio código:
  - `cv_read` já lista diretórios; `cv_list` acrescenta árvore, profundidade e ordenação.
  - `cv_browser_navigate` e `cv_browser_extract` navegam para uma URL e retornam conteúdo da página; `extract` é mais completo.
  - `cv_tools_info` lista categorias e `cv_find_tools` pesquisa o mesmo catálogo.
  - `cv_plan` informa que o modo é acionado pelo comando `/plan` do host e que a tool não tem equivalente MCP.
  - `cv_question` devolve instrução para o agente perguntar ao usuário diretamente; não abre um formulário nem obtém a resposta.
  - `cv_currency`, `cv_cep`, `cv_cnpj`, `cv_ipinfo`, `cv_weather`, `cv_github` e `cv_npm` são sete consultas públicas sob um padrão comum, mas com parâmetros e validações diferentes.
- Hoje `tools/list` entrega as definições registradas, com schema de entrada, para o cliente MCP; `cv_find_tools` melhora a descoberta, mas não reduz por si só esse catálogo já entregue ([src/core/rpc.mjs](../src/core/rpc.mjs), [spec MCP: Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).

### Evidências externas

1. **11 set. 2025 — Anthropic, “Writing effective tools for AI agents”.** Recomenda escolher deliberadamente quais tools implementar, combinar operações que formam uma tarefa, manter propósitos distintos e medir acerto, número de chamadas, tokens e erros. A passagem “More tools don’t always lead to better outcomes” sustenta a poda; não determina um número ideal para o Canivete. [Fonte e data de acesso: 20 nov. 2026](https://www.anthropic.com/research/writing-tools-for-agents).
2. **29 set. 2025 — Anthropic, “Effective context engineering for AI agents”.** Recomenda contexto de alto sinal, schemas sem sobreposição e ferramentas claras. Também alerta que generalizar demais pode criar decisões ambíguas. Isso sustenta a fronteira entre modos de uma mesma capacidade e uma ferramenta universal sem foco. [Fonte e data de acesso: 20 nov. 2026](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).
3. **Spec MCP, versão 2025-11-25 — seção Tools.** Define nome, descrição e `inputSchema` como partes da definição exposta ao modelo e permite schemas JSON para parâmetros. As anotações descrevem o comportamento da tool inteira; portanto, agrupar leitura e ação destrutiva na mesma tool enfraquece essa indicação de risco. [Fonte e data de acesso: 20 nov. 2026](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
4. **24 nov. 2025 — Anthropic, “Advanced tool use”.** Tool Search com carregamento sob demanda pode reduzir definições carregadas, mas é um recurso próprio da plataforma Anthropic; não deve ser tratado como comportamento garantido em todo cliente MCP. A direção geral é manter poucas capacidades essenciais no contexto e descobrir as restantes quando necessário. [Fonte e data de acesso: 20 nov. 2026](https://www.anthropic.com/research/advanced-tool-use).

## Cruzamento das hipóteses (ACH)

| Evidência | H1: agrupar ajuda | H2: preservar risco | H3: há redundância real | H4: contar tools não basta |
|---|---|---|---|---|
| `cv_read` já trata diretório; `cv_list` oferece árvore mais profunda | apoia: um modo `tree` pode cobrir os dois | neutra | apoia parcialmente; há sobreposição com diferença útil | alerta: não remover a opção de árvore |
| `navigate` e `extract` compartilham navegação e leitura; extração tem profundidade maior | apoia: `summary/full` representa a diferença | neutra | apoia | alerta: verificar custo/tempo da extração completa |
| `tools_info` e `find_tools` expõem o mesmo catálogo | apoia: `query` opcional cobre lista ou busca | neutra | apoia fortemente | pouco efeito no restante do catálogo |
| APIs públicas têm destinos relacionados, mas entradas distintas | apoia com schema por `source` | neutra | não prova redundância funcional; prova repetição de interface | alerta forte: união pode inflar o schema |
| Browser do dono, ADB, Codespaces e shell podem alterar estado; seus modos variam de leitura a ação | neutra | apoia manter separação de permissão | não apoia fusão irrestrita | apoia poda por grupo e modo com validação |
| Anthropic recomenda avaliação de tarefas, chamadas, tokens e erros | apoia condicionalmente | apoia medir risco/usabilidade | apoia selecionar, não acumular wrappers | apoia: número sem desempenho não decide |

**Leitura:** as evidências não favorecem “uma tool para tudo”. Favorecem modos simples dentro de um mesmo recurso, enquanto leitura, escrita, automação logada e operações destrutivas continuam distinguíveis.

## Proposta de catálogo

| Grupo atual | Hoje | Proposta | Meta | Observação de precisão/segurança |
|---|---:|---|---:|---|
| Filesystem | 8 | `cv_file_read` (`read`, `tree`, `search_files`, `search_text`), `cv_file_write` (`write`, `replace`) e `cv_bash` | 3 | Separa leitura de alteração e mantém o shell como escape hatch. |
| Web + APIs | 9 | manter `cv_websearch` e `cv_webfetch`; reunir sete consultas em `cv_lookup` com `source` explícito e campos por serviço | 3 | testar um schema `oneOf` por fonte; se clientes/IA falharem com ele, manter consultas de alto uso separadas. |
| Browser headless | 8 | `cv_browser_read` (`summary`/`full`), `cv_browser_snapshot`, `cv_browser_act`, `cv_browser_capture` (`screenshot`/`pdf`/`contrast`), `cv_browser_screencast` | 5 | snapshot e ação formam um ciclo e devem continuar fáceis de escolher. Gravação continua separada por envolver sequência temporal de ações. |
| Chrome logado do dono | 7 | `cv_owner_inspect`, `cv_owner_act`, `cv_owner_alerts` | 3 | conta e página logada são fronteira de confiança; manter ações numa tool própria. Alertas drenam uma fila e merecem modo/chamada explícitos. |
| Android | 5 | `cv_android_inspect` (`status`/`extract`/`screen`), `cv_android_connect`, `cv_android_act` | 3 | pareamento, leitura de tela e toque/desinstalação não devem virar uma única tool sem fronteiras claras. |
| Codespaces | 7 | `cv_codespace_status` (`list`/`login_status`), `cv_codespace_lifecycle` (`create`/`stop`/`delete`), `cv_codespace_login`, `cv_codespace_exec` | 4 | ciclo de vida agrupado com confirmação explícita; execução de shell permanece isolada. |
| DevEngine | 8 | `cv_code_inspect` (`architecture`/`issue`/`impact`), `cv_code_edit` (`diff`/`semantic`), `cv_code_verify` (`tests`/`ui`), `cv_manage_background_process`, `cv_orchestrate_task` | 5 | cada modo pede entradas específicas e validação. Checkpoint/rollback continua explícito. |
| Meta e orquestração ativa | 9 | `cv_help` combina listagem/busca; remover `cv_plan` e `cv_question`; manter `todo`, `todowrite`, `skill`, `report`, `ctx_status` | 6 | `cv_plan` e `cv_question` são candidatos a remoção: hoje apenas encaminham instruções que o agente já consegue executar no chat/host. |
| Media, WhatsApp e reports de elemento | 4 | manter as tools especializadas | 4 | são capacidades diferentes; fundir só para baixar a contagem não deixa a interface mais simples. |
| **Total ativo** | **65** |  | **36** | **Implementado.** Com `cv_task*` habilitado, o catálogo chega a 40 tools (quatro operações consolidadas). |

### Como manter a “caneta” precisa

- O campo de escolha usa um verbo conhecido (`action`, `source` ou `detail`) com enum curto.
- Cada modo tem descrição em linguagem comum e só pede os campos daquele modo; entradas impossíveis devem falhar com dica acionável.
- Exemplos curtos cobrem as escolhas menos óbvias (`cv_lookup` com `cep`, `weather`, `currency`; `cv_browser_read` com `summary` e `full`).
- O resultado padrão é conciso; `detail:true`/`format:"full"` abre dados adicionais só quando necessários.
- Modo que altera site logado, aparelho, código ou recurso remoto mantém confirmação e tool própria quando a anotação de risco não puder ser preservada.

## Plano de avaliação antes de substituir as tools

1. Montar 40 tarefas reais, cinco por domínio: arquivo, web/API, browser público, Chrome logado, Android, Codespaces, desenvolvimento e meta/orquestração. Separar tarefas somente leitura das que alteram estado.
2. Rodar as mesmas tarefas com o catálogo atual e o protótipo, no mesmo modelo e parâmetros. Não exigir uma sequência fixa; validar resultado correto e ações seguras.
3. Registrar: conclusão correta, escolha do modo no primeiro chamado, argumentos inválidos, chamadas totais, tokens de definições e respostas, e erros/ações de risco.
4. Aprovar a redução se: o acerto geral não cair mais que 2 pontos percentuais; nenhuma tarefa destrutiva ficar menos segura; erros de parâmetros não aumentarem; e o catálogo MCP diminuir pelo menos 20% em bytes. Se o ganho não atingir o limite, reter as tools originais daquele grupo.
5. Manter um conjunto de tarefas reservado, não usado para desenhar schemas, como verificação contra ajustes excessivos aos exemplos conhecidos.

## Premortem e sinal de reversão

**Daqui a um ano, a redução falhou:** o catálogo virou várias tools “coringa”; cada uma ganhou tantos modos e parâmetros opcionais que a IA escolhe o modo errado ou mistura campos de operações diferentes. O total de chamadas e o contexto crescem por tentativas e erros, apesar da lista menor.

- **Risco:** schema `oneOf` ou parâmetros opcionais não são interpretados de forma consistente pelos clientes MCP usados pelo dono.
  **Indicador:** taxa de argumentos inválidos acima do baseline em qualquer grupo; medir durante o piloto e revisar semanalmente na primeira versão.
- **Risco:** mistura de leitura com ação esconde a possibilidade de efeitos externos.
  **Indicador:** qualquer ação não autorizada ou perda de confirmação; interromper a fusão daquele grupo imediatamente.
- **Risco:** modos com nomes vagos exigem aprender o Canivete.
  **Indicador:** em teste cego, a pessoa/IA precisa consultar documentação para escolher o modo em mais de 1 de 10 tarefas.
- **Linchpin:** clientes e modelos conseguem selecionar um modo enum com campos condicionais com a mesma confiabilidade de tools separadas. O schema por fonte está implementado em `cv_lookup`; compatibilidade passou pela validação sintática e benchmark, mas seleção correta pela IA ainda requer avaliação cega.

## Surpresa e implicação

- **Esperava:** a maior economia viria de juntar muitos verbos semelhantes.
- **Achado:** algumas redundâncias já estão demonstradas pelo comportamento implementado: leitura de diretório dentro de `cv_read`, extração completa que também navega, e dois modos de descoberta do mesmo catálogo. Além disso, `cv_plan` e `cv_question` não executam a ação sugerida: encaminham o agente para recursos do host/chat.
- **Implicação:** comece com fusões de intenção comprovada e remoções de encaminhadores sem execução; deixe a consolidação das APIs e das superfícies de risco para protótipos comparados.
- **Decisão que muda:** em vez de eliminar funções por frequência ou contagem, eliminar definições repetidas e agrupar apenas operações que a IA entende como a mesma tarefa.

## Lacunas e alternativas

- O benchmark anterior mede tempo e bytes de resposta, não mede quantos tokens de tool schema o modelo de fato cobra nem se escolhe a tool certa.
- Não há ainda transcrições agregadas de uso para saber quais ferramentas são raras, quais confundem o modelo e quais formam chamadas em sequência. Frequência de uso não foi inferida.
- Os conselhos externos citados vêm de pesquisa de fornecedor, não de avaliação independente do Canivete. A interface está implementada; ganho de acerto continua hipótese até passar pelo conjunto de tarefas.
- Manter todas as tools como estavam conserva os 45 KB medidos e as sobreposições encontradas. Uma tool universal teria menor contagem nominal e maior risco de schema ambíguo.
- **Desvio do método:** o inventário e o benchmark existiam antes das hipóteses deste dossiê. Registrei essa limitação; as hipóteses devem ser congeladas antes de começar o próximo ciclo de prototipagem.

## Fontes e rastreabilidade

- Repositório local, catálogo gerado em 2026-11-21 UTC: [docs/TOOLS.md](../docs/TOOLS.md), [src/core/taxonomy.mjs](../src/core/taxonomy.mjs), [src/server.mjs](../src/server.mjs), [src/core/rpc.mjs](../src/core/rpc.mjs), [test/bench.mjs](../test/bench.mjs), [docs/BENCH.md](../docs/BENCH.md). Acesso: 2026-11-20 (America/Belem).
- Anthropic. “Writing effective tools for AI agents — with agents”. Publicado em 2025-09-11. [URL](https://www.anthropic.com/research/writing-tools-for-agents). Acesso: 2026-11-20.
- Anthropic. “Effective context engineering for AI agents”. Publicado em 2025-09-29. [URL](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents). Acesso: 2026-11-20.
- Anthropic. “Introducing advanced tool use on the Claude Developer Platform”. Publicado em 2025-11-24. [URL](https://www.anthropic.com/research/advanced-tool-use). Acesso: 2026-11-20.
- Model Context Protocol. Especificação 2025-11-25, “Tools”. [URL](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). Acesso: 2026-11-20.
