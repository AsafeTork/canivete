# BENCH canivete — 2026-09-09T23:48:54.115Z

Gerado por `node test/bench.mjs` no deployment real (http 19423).
Limite razoável: 1500ms. Acima disso = rede/página/modelo (física) ou código (culpa do dev).

| tool | ms | resultado |
|---|---|---|
| n_tools_info | 618 | == CANIVETE (src/server.mjs, 1.0.0, 52 tools — MCP universal, qualquer CLI) == Runner atua |
| n_read | 73 | /tmp/bench/a.txt (3 lines)     1: linha um     2: linha dois     3:  |
| n_list | 110 | a.txt 20B s.js 53B |
| n_write | 66 | isError: write failed: EACCES: permission denied, open '/tmp/bench/b.txt' |
| n_edit | 37 | isError: edit failed: ENOENT: no such file or directory, open '/tmp/bench/b.txt' |
| n_bash | 944 | exit=0 --- stdout --- ok  --- stderr ---  |
| n_glob | 17 | a.txt |
| n_grep | 22 | a.txt:1: linha um a.txt:2: linha dois |
| n_apply_patch | 46 | isError: git apply failed (exit 128): error: No valid patches in input (allow with "--allo |
| n_webfetch | 10425 | isError: fetch failed: fetch failed |
| n_websearch | 6905 | 14 results for "vite pwa" (cached 10min, sources: google-news, wikipedia-resumo, wikipedia |
| n_currency | 1150 | BRL source: https://api.frankfurter.app (ECB daily rates) USD: 1 BRL = 0.19651 USD  |  10  |
| n_cep | 913 | CEP: 01001-000 Logradouro: Praça da Sé Bairro: Sé Cidade: São Paulo/SP IBGE: 3550308 Compl |
| n_cnpj | 541 | CNPJ: 11.444.777/0001-61 Razao social: Z R DE BRITO EMPREITEIRA Nome fantasia: - Status: O |
| n_ipinfo | 491 | IP: 186.216.29.122 País: Brasil (BR) Região: Pará Cidade: Bragança ISP: Metroflex Telecomu |
| n_weather | 979 | Previsão 2026-09-09..2026-09-10 (2 dias) 2026-09-09: 15.4°C..23.8°C | chuva 100% | pancada |
| n_github | 936 | vitejs/vite — Next generation frontend tooling. It's fast! stars: 82772 | forks: 8730 | op |
| n_npm | 1071 | vite@8.2.2 description: Native-ESM powered web dev build tool license: MIT | deps: 5 | bin |
| n_todowrite | 7 | [0] pending     low    b |
| n_todo | 4 | [0] pending     low    b |
| n_list_models | 14 | Modelos (7, runner opencode): opencode/muse-spark-1.2-contributor-free opencode/muse-spark |
| n_question | 6 | QUESTION: q? (The main agent must ask the user directly; no interactive prompt exists insi |
| n_skill | 10 | isError: skill "zz-inexistente" not found. Available: ubrowser |
| n_plan | 2 | To enter/exit plan mode use the TUI command /plan. No equivalent exists inside this MCP. |
| n_get_architecture_summary | 5 | isError: {   "status": "error",   "summary": "CWD inválido: /home/tork — sem package.json" |
| n_investigate_issue | 5840 | {   "status": "success",   "summary": "Causa provável em .config/google-chrome/Default/Ext |
| n_analyze_change_impact | 158750 | {   "status": "success",   "summary": "30 referência(s) a \"soma\" | 1 teste(s) afetado(s) |
| n_apply_semantic_patch | 432 | isError: {   "status": "error",   "summary": "write failed: EACCES: permission denied, ope |
| n_execute_targeted_tests | 8 | isError: {   "status": "error",   "summary": "sem package.json em /home/tork — este projet |
| n_manage_background_process | 31 | {   "status": "success",   "summary": "Processo bgmtuqz4vf iniciado: sleep 30 (PID 14118)" |
| n_inspect_ui_state | 500 | {   "status": "success",   "summary": "UI http://localhost:5173 offline (curl 000) — inici |
| n_orchestrate_task | 11 | {   "status": "success",   "summary": "DAG tmtuqz5aj1 iniciado",   "data": {     "task_id" |
| n_browser_navigate | 59289 | {   "status": "success",   "summary": "example.com — https://example.com (fallback dump-do |
| n_browser_snapshot | 40 | {   "status": "success",   "summary": "1 elemento(s) interativo(s)",   "data": {     "coun |
| n_browser_act | 33 | {   "status": "success",   "summary": "evaluate ok",   "data": {     "action": "evaluate", |
| n_browser_screenshot | 110 | {   "status": "success",   "summary": "Screenshot 800x600 — example.com → /tmp/opencode-sh |
| n_browser_pdf | 30381 | {   "status": "success",   "summary": "PDF 33.1K → /tmp/opencode-page-mtur0f6v.pdf",   "da |
| n_ubrowser_status | 10 | {   "status": "success",   "summary": "UBrowser pronto (extensão conectada)",   "data": {  |
| n_ubrowser_tabs | 31 | {   "status": "success",   "summary": "1 aba(s) em 1 janela(s)",   "data": {     "tabs": [ |
| n_ubrowser_read | 52 | {   "status": "success",   "summary": "Professor · Informática 25 — https://infor25-ifpa-b |
| n_ubrowser_snapshot | 84 | {   "status": "success",   "summary": "50 elemento(s)",   "data": {     "elements": [      |
| n_ubrowser_act | 23 | isError: {   "status": "error",   "summary": "BLOQUEADO (alto risco: pagamento/senha/exclu |
| n_ubrowser_shot | 152 | Screenshot Professor · Informática 25 — https://infor25-ifpa-braganca-m.onrender.com/profe |
| n_report | 3 | isError: kind inválido: zzz (use bug|missing|bottleneck) |
| n_task | 47 | task tmtur12xo2 spawned in background (quick | opencode/big-pickle) [ephemeral auto-exclui |
| n_task_wait | 50839 | task bench |

## Lentas (>1500ms): 7
- n_webfetch: 10425ms
- n_websearch: 6905ms
- n_investigate_issue: 5840ms
- n_analyze_change_impact: 158750ms
- n_browser_navigate: 59289ms
- n_browser_pdf: 30381ms
- n_task_wait: 50839ms
