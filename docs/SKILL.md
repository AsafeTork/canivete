---
name: canivete
description: Use as ferramentas MCP do Canivete para arquivos, web, browser, Android, desenvolvimento e serviços locais. Comece por cv_help para descobrir a operação e os parâmetros sem memorizar o catálogo.
---

# Canivete — guia rápido para agentes

O Canivete oferece um catálogo MCP enxuto com modos explícitos. A lista autoritativa é [TOOLS.md](TOOLS.md); nomes antigos ainda funcionam como aliases por compatibilidade, mas agentes devem escolher entre as tools públicas atuais.

## Descoberta

- `cv_help {}` lista capacidades por categoria.
- `cv_help {query:"texto da intenção", detail:true}` busca a operação e mostra o schema.
- Não memorize dezenas de nomes nem invente argumentos: consulte `cv_help` quando o modo ou campo não estiver claro.

## Rotas comuns

| Intenção | Ferramentas |
|---|---|
| Ler arquivo, árvore ou buscar texto/nomes | `cv_file_read` (`action`: `read`, `tree`, `search_files`, `search_text`) |
| Criar/substituir conteúdo de arquivo | `cv_file_write` (`action`: `write`, `replace`) |
| Consultar informação pública | `cv_lookup` (`source`: moeda, CEP, CNPJ, IP, clima, GitHub, npm) |
| Buscar na web / baixar página sem JS | `cv_websearch` / `cv_webfetch` |
| Ler página pública renderizada | `cv_browser_read` (`detail`: `summary` ou `full`) |
| Captura de página ou contraste | `cv_browser_capture` (`action`: `screenshot`, `pdf`, `contrast`) |
| Navegar/agir em browser headless | `cv_browser_snapshot`, `cv_browser_act`, `cv_browser_screencast` |
| Chrome logado do dono | `cv_owner_inspect` para consultar; `cv_owner_act` para agir; `cv_owner_alerts` para alertas |
| Android | `cv_android_inspect`, `cv_android_connect`, `cv_android_act` |
| Código | `cv_code_inspect`, `cv_code_edit`, `cv_code_verify` |
| Codespaces | `cv_codespace_status`, `cv_codespace_lifecycle`, `cv_codespace_exec`, `cv_codespace_login` |
| Ajuda, contexto e feedback | `cv_help`, `cv_ctx_status`, `cv_report` |

Para processos longos use `cv_manage_background_process`; para tarefas shell curtas, `cv_bash`. `cv_report` registra bugs, ajustes e capacidades ausentes do Canivete. Tools opcionais de tarefa são habilitadas por `CANIVETE_TASK_ENABLE=1`.

## Regras operacionais

- Prefira a menor operação que resolve o pedido: leitura textual antes de screenshot, resumo antes de extração completa, e confirmação do estado antes de agir.
- Chrome autenticado: `cv_owner_inspect` consulta e `cv_owner_act` opera em qualquer guia escolhida. Guias novas do agente ficam no grupo “Canivete · agente”; ativar/interagir traz a janela à frente por padrão (`focus:false` preserva o foco). Use CDP quando a página exigir. Android mantém inspeção e ação em modos próprios.
- Comece por `cv_owner_inspect {action:"overview"}` para obter mapa compacto e seletores. `companion` vincula o painel à sessão MCP atual; mensagens chegam no retorno de qualquer tool dessa sessão, sem serem consumidas por outras sessões. Hosts que multiplexam vários agentes numa sessão não permitem distingui-los. `flow` pausa após cada etapa e devolve `remainingSteps`. Responda pelo painel antes de retomar. Se o turno terminou, a mensagem aguarda a próxima chamada da mesma sessão; MCP não acorda um modelo ocioso. `checkInbox:false` desliga interrupções de fluxo; `showProgress:false` esconde o progresso.
- Preserve confirmações exigidas para exclusão, envio e ações destrutivas. Nunca invente consentimento.
- Para código, entenda o contexto, faça a edição solicitada e valide de acordo com o pedido. Não execute uma suíte de testes sem solicitação.
- Use `cv_help` em vez de despejar schemas e descrições no contexto; isso reduz tokens e evita exigir treinamento específico do Canivete.

## Referências

- Catálogo completo e parâmetros: [TOOLS.md](TOOLS.md)
- Estudo para redução e agrupamento: [../pesquisa/2026-11-20-reducao-tools.md](../pesquisa/2026-11-20-reducao-tools.md)
- Benchmark: [BENCH.md](BENCH.md)
