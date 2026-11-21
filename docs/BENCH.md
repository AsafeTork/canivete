# Benchmark Canivete — 2026-11-21T01:26:07.843Z

Medição do endpoint MCP ativo. Tools disponíveis: 36; medidas: 21; ignoradas com motivo: 15. Catálogo: 24298 bytes. Latência p50: 16 ms; p95: 573 ms.

O tempo inclui rede/serviços externos quando a tool os usa. Respostas são descartadas; o relatório guarda apenas estado, tamanho e tempo. Tools que poderiam alterar dados externos, consumir cota ou ler tela privada ficam de fora.

| Tool | ms | estado | resposta (bytes) | nota |
|---|---:|---|---:|---|
| cv_todowrite | — | SKIP | 0 | altera a lista de tarefas em memória do daemon |
| cv_todo | — | SKIP | 0 | lê conteúdo privado do usuário |
| cv_skill | — | SKIP | 0 | refresh altera arquivos de configuração do usuário |
| cv_elemreports_list | — | SKIP | 0 | lê reports privados persistidos pelo usuário |
| cv_elemreports_resolve | 10 | error | 64 |  |
| cv_bash | 219 | ok | 76 |  |
| cv_webfetch | 238 | ok | 372 |  |
| cv_websearch | — | SKIP | 0 | consulta provedores externos e consome cota |
| cv_manage_background_process | 9 | success | 84 |  |
| cv_orchestrate_task | 7 | error | 86 |  |
| cv_browser_snapshot | 52 | success | 392 |  |
| cv_browser_act | 32 | success | 458 |  |
| cv_browser_screencast | 905 | success | 687 |  |
| cv_codespace_exec | — | SKIP | 0 | executa comandos em um recurso privado da conta |
| cv_codespace_login | — | SKIP | 0 | inicia um fluxo OAuth externo |
| cv_whatsapp | 7 | error | 70 |  |
| cv_audio_analyze | 4 | error | 287 |  |
| cv_report | 3 | ok | 261 |  |
| cv_ctx_status | 3 | ok | 266 |  |
| cv_file_read | 10 | ok | 1067 |  |
| cv_file_write | 16 | ok | 87 |  |
| cv_lookup | 330 | ok | 183 |  |
| cv_browser_read | 188 | success | 1714 |  |
| cv_browser_capture | 247 | ok | 639 |  |
| cv_owner_inspect | — | SKIP | 0 | lê estado ou dados da sessão Chrome do dono |
| cv_owner_act | — | SKIP | 0 | pode agir em uma sessão Chrome privada |
| cv_owner_alerts | — | SKIP | 0 | drena alertas da sessão Chrome do dono |
| cv_android_inspect | — | SKIP | 0 | pode ler/reconectar ao aparelho privado do dono |
| cv_android_connect | — | SKIP | 0 | pode parear ou reconectar um aparelho do dono |
| cv_android_act | — | SKIP | 0 | pode enviar toque/tecla ao aparelho conectado |
| cv_codespace_status | — | SKIP | 0 | lê estado privado de autenticação e recursos GitHub |
| cv_codespace_lifecycle | — | SKIP | 0 | pode criar/alterar recursos da conta GitHub |
| cv_code_inspect | 5 | success | 522 |  |
| cv_code_edit | 11 | error | 188 |  |
| cv_code_verify | 573 | success | 561 |  |
| cv_help | 49 | ok | 736 |  |

## Mais lentas

- cv_browser_screencast: 905 ms (687 bytes, success)
- cv_code_verify: 573 ms (561 bytes, success)
- cv_lookup: 330 ms (183 bytes, ok)
- cv_browser_capture: 247 ms (639 bytes, ok)
- cv_webfetch: 238 ms (372 bytes, ok)
- cv_bash: 219 ms (76 bytes, ok)
- cv_browser_read: 188 ms (1714 bytes, success)
- cv_browser_snapshot: 52 ms (392 bytes, success)
- cv_help: 49 ms (736 bytes, ok)
- cv_browser_act: 32 ms (458 bytes, success)
