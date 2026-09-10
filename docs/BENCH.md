# BENCH canivete — 2026-09-10T17:26:22.868Z

Gerado por `node test/bench.mjs` no deployment real (http 19423).
Limite razoável: 1500ms. Acima disso = rede/página/modelo (física) ou código (culpa do dev).

| tool | ms | resultado |
|---|---|---|
| n_tools_info | 271 | == CANIVETE (src/server.mjs, 1.0.0, 52 tools — MCP universal, qualquer CLI) == Runner atua |
| n_read | 15 | /tmp/bench/a.txt (3 lines)     1: linha um     2: linha dois     3:  |
| n_list | 65 | a.txt 20B s.js 53B |
| n_write | 10 | wrote /tmp/bench/b.txt (1 bytes) |
| n_edit | 8 | edited /tmp/bench/b.txt (1 occurrence) |
| n_bash | 382 | exit=0 --- stdout --- ok  --- stderr ---  |
| n_glob | 11 | a.txt b.txt |
| n_grep | 4 | a.txt:1: linha um a.txt:2: linha dois |
| n_apply_patch | 49 | isError: git apply failed (exit 128): error: No valid patches in input (allow with "--allo |
| n_webfetch | 386 | URL https://example.com (200) — Example Domain Example Domain Example Domain Example Domai |
| n_websearch | 1263 | 14 results for "vite pwa" (cached 10min, sources: google-news, wikipedia-resumo, wikipedia |
| n_currency | 3047 | BRL source: https://api.frankfurter.app (ECB daily rates) USD: 1 BRL = 0.19514 USD  |  10  |
| n_cep | 1020 | CEP: 01001-000 Logradouro: Praça da Sé Bairro: Sé Cidade: São Paulo/SP IBGE: 3550308 Compl |
| n_cnpj | 694 | CNPJ: 11.444.777/0001-61 Razao social: Z R DE BRITO EMPREITEIRA Nome fantasia: - Status: O |
| n_ipinfo | 416 | IP: 200.129.134.2 País: Brasil (BR) Região: Pará Cidade: Belém ISP: Rede Nacional de Ensin |
| n_weather | 1208 | Previsão 2026-09-10..2026-09-11 (2 dias) 2026-09-10: 17.4°C..21.9°C | chuva 100% | pancada |
| n_github | 582 | vitejs/vite — Next generation frontend tooling. It's fast! stars: 82779 | forks: 8733 | op |
| n_npm | 1047 | vite@8.3.0 description: Native-ESM powered web dev build tool license: MIT | deps: 5 | bin |
| n_todowrite | 5 | [0] pending     low    b |
| n_todo | 3 | [0] pending     low    b |
| n_list_models | 3 | Modelos (7, runner opencode): opencode/muse-spark-1.2-contributor-free opencode/muse-spark |
| n_question | 3 | QUESTION: q? (The main agent must ask the user directly; no interactive prompt exists insi |
| n_skill | 9 | isError: skill "zz-inexistente" not found. Available: ubrowser |
| n_plan | 2 | To enter/exit plan mode use the TUI command /plan. No equivalent exists inside this MCP. |
| n_get_architecture_summary | 7 | {   "status": "success",   "summary": "Arquitetura canivete v1.0.0: 0 features, 0 edge fun |
| n_investigate_issue | 12 | {   "status": "success",   "summary": "Nenhum candidato para \"bench soma\"",   "data": {  |
| n_analyze_change_impact | 31 | {   "status": "success",   "summary": "4 referência(s) a \"soma\" | 0 teste(s) afetado(s)" |
| n_apply_semantic_patch | 273 | {   "status": "success",   "summary": "Patch semântico aplicado em /tmp/bench/s.js (1 hunk |
| n_execute_targeted_tests | 2019 | {   "status": "success",   "summary": "Testes OK (? pass)",   "data": {     "scope": "diff |
| n_manage_background_process | 12 | {   "status": "success",   "summary": "Processo bgmtvssjg3 iniciado: sleep 30 (PID 4623)", |
| n_inspect_ui_state | 365 | {   "status": "success",   "summary": "UI http://localhost:5173 offline (curl 000) — inici |
| n_orchestrate_task | 7 | {   "status": "success",   "summary": "DAG tmtvssjqk1 iniciado",   "data": {     "task_id" |
| n_browser_navigate | 3691 | {   "status": "success",   "summary": "Example Domain — https://example.com/ (129 chars)", |
| n_browser_snapshot | 50 | {   "status": "success",   "summary": "1 elemento(s) interativo(s)",   "data": {     "coun |
| n_browser_act | 67 | {   "status": "success",   "summary": "evaluate ok",   "data": {     "action": "evaluate", |
| n_browser_screenshot | 441 | {   "status": "success",   "summary": "Screenshot 800x600 — Example Domain → /tmp/opencode |
| n_browser_pdf | 7913 | {   "status": "success",   "summary": "PDF 15.4K → /tmp/opencode-page-mtvssn1d.pdf",   "da |
| n_ubrowser_status | 61 | {   "status": "success",   "summary": "UBrowser pronto (extensão conectada)",   "data": {  |
| n_ubrowser_tabs | 229 | {   "status": "success",   "summary": "2 aba(s) em 1 janela(s)",   "data": {     "tabs": [ |
| n_ubrowser_read | 431 | {   "status": "success",   "summary": "(2) Conjunto Gabinete Moveis Joia 80cm Cuba Espelhe |
| n_ubrowser_snapshot | 251 | {   "status": "success",   "summary": "50 elemento(s)",   "data": {     "elements": [      |
| n_ubrowser_act | 18 | isError: {   "status": "error",   "summary": "BLOQUEADO (alto risco: pagamento/senha/exclu |
| n_ubrowser_shot | 343 | Screenshot (2) Conjunto Gabinete Moveis Joia 80cm Cuba Espelheira | Mercado Livre — https: |
| n_report | 6 | isError: kind inválido: zzz (use bug|missing|bottleneck) |
| n_task | 57 | task tmtvssu9r2 spawned in background (quick | opencode/big-pickle) [ephemeral auto-exclui |
| n_task_wait | 58665 | task bench |

## Lentas (>1500ms): 5
- n_currency: 3047ms
- n_execute_targeted_tests: 2019ms
- n_browser_navigate: 3691ms
- n_browser_pdf: 7913ms
- n_task_wait: 58665ms
