---
name: canivete
description: Toolkit MCP universal com 56 tools n_* — inclui ubrowser, os tools do Chrome LOGADO do dono (n_ubrowser_tabs/act/read/snapshot/shot: abrir/editar abas, clicar, digitar, console da página, scroll+screenshot, navegar) e reports de elemento (o dono marca o problema na página viva, o agente resolve: n_elemreports_list/resolve). Também filesystem/shell/web fetch/CEP/CNPJ/DevEngine/n_report. Ativa em qualquer pedido de browser do dono, automação de aba, screenshot, leitura de página ou dev local. Global — vale em qualquer projeto ou CLI.
---

# Canivete — toolkit MCP universal (56 tools `n_*`)

Servidor: `src/server.mjs` (zero deps, Node 22+). Registro por CLI em `examples/`.
MCP universal sem spawn: filesystem, web, browser do dono, DevEngine, meta.

## Tools — 1 linha cada (nomes conferidos via `rg 'reg\("n_' src/`; contagem exata no `n_tools_info`)

### Filesystem + execução (8)

| Tool | Uso |
|---|---|
| `n_read` | Ler arquivo numerado (`offset/limit/maxChars`); inspecionar antes de editar. |
| `n_list` | Árvore+tamanhos (`depth` 1–6); mapear pasta antes de `glob/read`. |
| `n_write` | Criar/sobrescrever (novo ou rewrite total); pontual → `n_edit`. |
| `n_edit` | Troca exata `oldString→newString` (0 matches/ambíguo falha). |
| `n_apply_patch` | Unified diff via `git apply` no repo root (`check`/`stat`/`reverse`). |
| `n_bash` | Shell no repo root (`timeout` até 600s; acima → background; `sleep` proibido — monitore). |
| `n_glob` | Achar arquivos por glob (até 500); antes de `n_read`. |
| `n_grep` | Regex `path:line:trecho`; localizar símbolo antes de `n_analyze_change_impact`. |

### Web + APIs sem chave (2+7)

| Tool | Uso |
|---|---|
| `n_webfetch` | URL **SEM JS** (`<article>/<main>`); SPA → `n_browser_navigate`. |
| `n_websearch` | 7 backends, cache 10min; `fresh:true` força ao vivo. |
| `n_currency` | Câmbio ECB/Frankfurter (cache 1h). |
| `n_cep` | CEP→endereço ViaCEP (24h). |
| `n_cnpj` | CNPJ→empresa ReceitaWS (24h, rate-limited). |
| `n_ipinfo` | IP→geo ip-api.com (45 req/min, 10min). |
| `n_weather` | Previsão Open-Meteo lat/lon 1–7d (30min). |
| `n_github` | repo/releases/commits/issues/branches/user/**file** (`path`)/ **search** (`q`) — `account`=conta gh → 5000 req/h (10min/search 3min). |
| `n_npm` | Pacote npm (versão/licença/deps/downloads mês; 1h). |

### Tarefas (2) — subagentes desativados

`n_task` + família (`wait/status/send/recv/peek/tail/notifications/delete/models`) **não registradas** (RAM; reative com `CANIVETE_TASK_ENABLE=1`).

### DevEngine (8) — roteamento: arch→investigate→impact→patch→test

| Tool | Uso |
|---|---|
| `n_get_architecture_summary` | Topologia sem varrer (`depth` 1–3, `focus_module`). |
| `n_investigate_issue` | Keyword OR ranqueada 12→8 (`symptom` + `stack_trace` opcional). |
| `n_analyze_change_impact` | Callers+testes **antes** de editar (`callers`/`callees`, `top` ≤50). |
| `n_apply_semantic_patch` | Edição `node --check` (`dry_run` sem escrever; `create_if_missing`). |
| `n_execute_targeted_tests` | `diff_only`/`module`+`target_path`/`full` (vitest/jest/mocha). |
| `n_manage_background_process` | `start/stop/restart/status/read_logs` (sem bloquear; `send` indisponível). |
| `n_inspect_ui_state` | HTTP da UI + `expect` FOUND/MISSING (`retries` 0–3). |
| `n_orchestrate_task` | DAG `init/checkpoint/resume/rollback` (`confirm:true` p/ executar). |

### Browsers (6 headless + 6 dono)

| Tool | Uso |
|---|---|
| `n_browser_navigate` | SPA com JS (título+texto+links; `waitMs`, `cookies`). |
| `n_browser_snapshot` | Interativos (`compact:true` −60% tokens). |
| `n_browser_act` | goto/click/fill/press/scroll/wait/`evaluate` (`console:true` = 30 logs). |
| `n_browser_screenshot` | PNG página/elemento (`selector`, `fullPage`). |
| `n_browser_pdf` | PDF em `/tmp`. |
| `n_browser_contrast` | Contraste REAL em pixel (clip → PNG → mediana borda vs miolo → razão WCAG 2.1) — a11y sem screenshot. |
| `n_ubrowser_status` | **Antes de tudo** no Chrome do dono (offline → **`open:true` abre o Chrome sozinho, qualquer perfil** — ou janela normal + popup ATIVO). |
| `n_ubrowser_tabs` | Abas (IDs mudam; prefira `tab:"trecho"`). |
| `n_ubrowser_read` | Aba logada (`distill` default; `raw` integral+links; `outline:true` só estrutura; `selector:"#app"` escopa a leitura). Texto curto em página grande → WARN no summary (tente `raw`/`snapshot`). |
| `n_ubrowser_snapshot` | Clicáveis (`max` ≤120 + `offset`; `find` ±3 contexto; `layer:"modal\|menu\|popover\|tooltip"` foca a camada; `scan` antes p/ virtualizada). |
| `n_ubrowser_act` | goto/click(`ref`/selector/`text=`)/fill(type anexa)/select/scroll/highlight/waittext(`wait`=waitMs)/evaluate(retry+nota)/`monstate`(estado do mon-hook: v/quiet/count — func, imune a CSP)/`cdp`(CDP cru na aba — **qualquer limitação sobe pra ele**: CSP, clique/fill sintético ignorado, shadow DOM/iframe, drag; Runtime.evaluate **imune a CSP**, DOM edit, Input trusted; padrão = chrome.debugger da extensão, **zero cliques**, banner fica, só http(s)/file; dono armou o toggle do chrome://inspect? a porta 9222 dele assume — sem banner, alcança chrome://, 1 "Permitir" por sessão; `off:true` desanexa)/cursor(trusted)/tooltip/catchup/aesthetic/new/`activate` (eleva aba sem roubar foco; `focused:true` + `confirm` = foco de SO p/ device-flow)/scan/count/attr/html/flow/`console`(erros+rede; chegam sozinhos via push)/`expectUrl/Text/Gone`/`snap:true` (alto risco exige `confirm`; `close` só fecha aba `about:blank` do agente — aba do dono em http(s) exige `confirm`, e `mode:"close_by_prefix"` limpa todas as `about:blank`). |
| `n_ubrowser_shot` | Print da aba VISÍVEL; aba em **FUNDO** fotografa via CDP sozinho (banner de debug pisca na 1ª vez — attach fica preso). |

### Reports de elemento (2) — o dono marca na página, o agente resolve

| Tool | Uso |
|---|---|
| `n_elemreports_list` | Reports de um site por `base_url` (aceita com path → origem normalizada; default = pendentes). Cada um traz snapshot estático: seletor estável, fingerprint texto/papel, role/data-testid, outerHTML, rect — prompt ruim do humano não trava o agente. |
| `n_elemreports_resolve` | Ciclo de vida com PROVA: `status:"em_resolução"` ao iniciar; `resolvido` (default) exige `proof` = antes/depois — some do highlight e vira histórico (nunca apaga). `status:"aberto"` reabre. |

**Fluxo-gatilho:** dono diz *"no nosso site https://exemplo.com tem erros que reportei"* → `n_elemreports_list {base_url}` (ou com `grupo:"<escopo>"` quando ele disser "só o X") → ataque um a um (`em_resolução` antes, `resolvido` com prova) → o highlight some sozinho (extensão re-synca ≤60s via notify, ou no próximo alarme de 1 min). Marcação (overlay Ácido-Noir, extensão 1.9.2+): popup → "Marcar o que está quebrado" (ou `n_ubrowser_act {action:"elem_pick"}`, `off:true` desliga) — o clique usa hit-test por camadas (`elementsFromPoint`): alcança overlays, shadow DOM e elementos gerados por JS; **Tab cicla a pilha** (seleciona por baixo de modal/banner; inclui camadas `pointer-events:none` que o cursor atravessa; Shift+Tab volta; a tag mostra "camada i/N"). A caixa acoplada à margem do contorno traz **grupo** (escopo digitado na hora — texto livre, sem registry, o agente filtra por ele) + prompt; **Enter salva** (em qualquer dos dois campos), Cancelar/Esc abortam. Cada seleção pendente tem um **✕ no canto** (desmarcar sem sair do gesto). Chip numerado junto ao contorno = pack vivo; clicar abre o editor (nota, grupo, remover elemento, "+ elemento", "Apagar" em 2 toques). Armazenamento: `~/.config/canivete/reports-elementos.jsonl` (append-only, dedupe por seletor+nota+grupo; só DOM visível + anotação humana — nunca cookie/header/senha). Sem reports = diga ao dono para marcar (não invente problema).

### Codespace (7) — ambiente de teste na nuvem (gh, 2-core/8GB grátis, cota da conta)

| Tool | Uso |
|---|---|
| `n_codespace_list` | Codespaces da conta (case-insensitive; default: conta ativa). |
| `n_codespace_create` | Cria codespace p/ testar sem sujar o host. |
| `n_codespace_exec` | Comando no codespace (timeout via `CANIVETE_CS_EXEC_TMO`). |
| `n_codespace_stop` / `n_codespace_delete` | Pausa / apaga — delete exige `confirm:"apagar"` (estado+arquivos não commitados somem). |
| `n_codespace_login` / `n_codespace_login_status` | Login de conta gh + conferência do job (caso multi-conta). |

### Meta (7) + WhatsApp (1)

| Tool | Uso |
|---|---|
| `n_tools_info` | Catálogo agrupado (descobrir o que chamar). |
| `n_find_tools` | Busca local no catálogo por palavra-chave (achar a tool certa sem varrer). |
| `n_question` | Pergunta ao humano (agente pergunta direto). |
| `n_skill` | Carrega SKILL (`refresh:true` lista). |
| `n_plan` | Só via `/plan` na TUI (não alternável pelo MCP). |
| `n_report` | Erro/falta/gargalo **obrigatório** em vez de improvisar (`kind`: `bug`\|`ajuste`\|`aprimoramento`\|`sugestao`, aliases `missing`/`bottleneck`; + `where/expected/got`). Inbox aceita `status` de triagem (`resolvido`\|`externo`\|`wontfix`\|`ruido`\|`aberto`) + `resolucao` — o painel exibe via `/api/issues`. |
| `n_ctx_status` | Calls/chars/~tokens vs `CANIVETE_CTX_BUDGET` (estouro → `distill/compact`). |
| `n_whatsapp` | `state\|chats\|open\|read\|send\|pair` (send só com texto explícito do dono). |

## Decisão por situação (quando usar o quê)

A tabela de cima diz **o que** cada tool faz. Esta diz **quando escolher qual** — por situação, não por nome.

| Situação | Caminho | Por quê |
|---|---|---|
| Ler página pública/estática | `n_webfetch` | barato, sem browser, sem render |
| Página com JS/SPA pública | `n_browser_navigate` + snapshot/act headless | renderiza sem tocar no Chrome do dono |
| Página logada / aba real do dono | `n_ubrowser_status` → `tabs` → `read/snapshot/act` | sessão viva do dono; login JAMAIS por iniciativa própria; Chrome fechado? `status {open:true}` abre sozinho |
| Evidência visual | headless `n_browser_screenshot` · dono `n_ubrowser_shot` (visível ou fundo via CDP) | screenshot custa tokens — texto/`verified`/`delta` primeiro |
| Erro na aba do dono (console/rede) | chega sozinho (push 📬) → `act console {filter:"errors"}` → `monstate` → painel `/painel` | escada: evento → buffer → estado do hook → histórico |
| Dono marcou problema visual na página | `n_elemreports_list {base_url}` → um a um → `n_elemreports_resolve` com prova antes/depois | fila humana priorizada; NÃO confunda com `n_report` |
| Bug/falta da própria ferramenta | `n_report` (+ `status` de triagem existe no inbox) | nunca improvise em silêncio |
| Rodar código fora do host (ambiente limpo/isolado) | `n_codespace_create` → `exec` → `stop`/`delete` | deps pesadas, risco de sujar, cota gh grátis |
| Comando longo | escada: `n_bash` ≤600s → `n_manage_background_process` → `n_orchestrate_task` (DAG multi-passos) | nunca sleep; polling com teto |

Escadas de escala — escolha o degrau mínimo que resolve:
- **Ler**: `webfetch` → headless → ubrowser logado.
- **Agir**: `selector`/`ref` → `evaluate` (corpo com `return …`) → **limitação bateu (CSP, clique/fill sintético ignorado, shadow DOM/iframe, drag)? `cdp` é a resposta, não o fim**: `cdp {method:"Runtime.evaluate"}` (nível debugger — **imune a CSP**, Input trusted). Só diga "não dá" DEPOIS do cdp.
- **Diagnosticar**: push 📬 (chegou sozinho) → `console` (buffer) → `monstate` (v/quiet/count) → painel/API (histórico fundido) → replay (vídeo do erro); erro de **produção** com Sentry MCP configurado → `find_organizations` → `analyze_issue_with_seer` (fora do canivete).
- **Homolog**: `__ubTags={area,agent}` ANTES de navegar; `__ubReplay=true` só quando o erro é visual; `uierr.js` mostra o erro real na UI.

Pergunte antes de agir: "isso é problema da **página** (elemreport/console), da **ferramenta** (`n_report`) ou do **meu método** (trocar de tool)?" — o erro mais caro é usar ubrowser onde `webfetch` bastava.

Gatilhos do dono — a fala já nomeia a tool:

- "reportei/marquei **na página**" → `n_elemreports_list` (fila humana priorizada — NÃO é `n_report`).
- "olha o que apareceu no console" → o push 📬 já chegou; `act {action:"console", filter:"errors"}` só lê.
- "por que quebrou?" → `monstate` → painel `/painel` → replay (nessa ordem).
- "testa fora daqui / isso é pesado" → `n_codespace_create` → `exec` → `stop`.
- "deixa rodando" → `n_manage_background_process {action:"start"}` + `read_logs` (nunca sleep).
- "vê o que tem no site X" → `n_webfetch` (estático) → headless (JS) → ubrowser (logado) — suba só quando o de baixo falhar.

Pares confusos — regra de 1 linha:

- `n_webfetch` × `n_browser_navigate` × `n_ubrowser_read`: sem JS → com JS → com login. Ordem de custo; subir degrau exige motivo.
- `n_report` × `n_elemreports_list`: falta da **ferramenta** → report; problema **visual** que o dono marcou na página → elemreports.
- `n_bash` × background × `n_orchestrate_task`: um comando → servidor/watch → multi-passos com rollback.
- `n_read` × `n_grep`: já sei ONDE está → `n_read`; não sei onde está → `n_grep`.
- `snapshot` × `read`: vou CLICAR → snapshot (ganha `ref`); vou LER conteúdo → read (distill).

Armadilhas que custam caro (nomeadas — se pegou, pare e troque):

- **ubrowser em página pública** — gasta aba do dono + tokens; `webfetch`/headless resolve.
- **snapshot em loop** — 1 snapshot → 1 act com `verified`/`delta`; re-ler é derrota.
- **screenshot como confirmação** — confirmação é textual; imagem só com pedido do dono.
- **improvisar em silêncio** — travou → `n_report`; a fila de triagem existe pra isso.

## Tarefas longas (progresso sem sleep cego)

- `n_bash`: `timeout` default 120s, **máx 600000 (10min)**. Passou → `n_manage_background_process({action:"start", command})` + `read_logs`/`status`/`stop`.
- Todos in-memory: `n_todowrite` / `n_todo` p/ planejar.

## Erros comuns

| Sintoma | Ação |
|---|---|
| `n_webfetch` vazio/"SPA shell" | `n_browser_navigate({url})` (JS) ou `n_ubrowser_*` (login). |
| `429` / `no results — 429` / `GitHub rate limit` | Aguarde ~60s; search `fresh:false` (cache 10min); GitHub com `GITHUB_TOKEN`. |
| `websearch` externo 429 (parallel.ai MCP, não é nosso) | Cadeia de fallback: externo → `n_websearch` (`fresh:false`, cache 10min) → `n_browser_navigate`. |
| Fallback só após 429/zero do externo | Aguarde ~60s; não force `fresh:true` em loop (agrava 429); confirme página/preço via browser. |
| `EXTENSAO_OFFLINE` / `timeout 60s` extensão | `n_ubrowser_status {open:true}` — o agente abre o Chrome sozinho (display com WM, perfil pedido) e espera a ponte; se o Chrome JÁ roda: janela NORMAL, popup ATIVO, token `~/.config/canivete/token.txt`. |
| `SSRF bloqueado: host privado` | URL pública ou `CANIVETE_BROWSER_ALLOW_PRIVATE=1`. |
| `chrome://` sem ação | Bloqueio do Chrome (só páginas web). |
| Aba `NOTFOUND` / snapshot vazio | Reliste `tabs`; use `tab:"trecho"`; `scan {pages:4}` antes de `snapshot`; `find`/`layer` p/ localizar sem despejar. Alvo que sumiu volta com WHERE (`removed\|hidden\|scrolled-out\|recycled`); `resolve=moved\|recycled` = re-resolvido sozinho. |
| Extensão desatualizada (erro esquisito após update do repo) | `n_ubrowser_status` mostra `bg`/`ub` RODANDO aí — versão nova no disco se aplica sozinha em ~1-2min (auto-update); `act {action:"reload-extension"}` força na hora. Manual só na migração de pasta. |
| `evaluate → undefined`/null | Sem `return ...`/valor no final; há 1 retry automático e a `note` diz o motivo; CSP bloqueou? **suba pra `cdp`** (`act {action:"cdp", method:"Runtime.evaluate"}` — imune a CSP; `read`/`snapshot` dão o dado sem JS). |
| Erro novo no console/rede | Chega sozinho: push na hora + 📬 nas respostas — leia com `act {action:"console", filter:"errors"}`. |
| `shot` fundo sem print | Automático agora: `n_ubrowser_shot` fotografa aba em fundo via CDP (attach permanente, banner "depurando" fica; `act {action:"cdp", off:true}` desliga). |
| Dialog "Permitir a depuração remota" | Consentimento do Chrome 156 é **POR CONEXÃO e não tem como desligar** (issue 825 do chrome-devtools-mcp: "não há solução simples"; a política `RemoteDebuggingAllowed` NÃO o suprime e a flag `--remote-debugging-port` é recusada no perfil default — "requires a non-default data directory"). **Modo em efeito (escolha do dono): toggle OFF** — zero dialogs pra sempre; CDP da extensão cobre http(s)/file. Se um dia precisar de chrome:// via 9222, o dono arma o toggle naquele dia e permite 1× por sessão (a conexão do serviço é persistente). |
| 2 CLIs juntas (ex. opencode remoto + codex stdio) | Daemon único (`serve.mjs`, :19423) é dono de TODAS as portas — o stdio das outras CLIs detecta o daemon no boot e vira **proxy** (POST /mcp), sem EADDRINUSE e sem cópia defasada | stderr do stdio diz "modo proxy"; porta via `CANIVETE_MCP_HTTP_PORT`; cada CLI aponta pro MESMO repo (symlink). |
| `n_bash` timeout | `timeout` até 600000 ou background + `read_logs`. |
| Qualquer erro/falta/gargalo | `n_report` em vez de improvisar. |

## Env (`CANIVETE_*`)

Execução/limites: `CANIVETE_CWD` (repo), `CANIVETE_RUNNER` (`opencode`) + `CANIVETE_RUN_TEMPLATE`, `CANIVETE_HOST_GUARD_MS` (170000), `CANIVETE_MAX_POLLS` (8), `CANIVETE_MAX_BODY` (2MB remoto), `CANIVETE_CTX_BUDGET` (200000), `CANIVETE_MAX_MSGS` (100)/`CANIVETE_MAX_MSG_CHARS` (4000), `CANIVETE_WALK_CAP` (8000)/`CANIVETE_WALK_DEPTH` (8).
Browser: `CANIVETE_CHROME_BIN` (auto-detect), `CANIVETE_CDP_PORT` (19322), `CANIVETE_CDP_TIMEOUT` (25000, WS open 10000), `CANIVETE_BROWSER_TIMEOUT_MS` (40000; PDF 60000), `CANIVETE_BROWSER_ALLOW_PRIVATE` (`1` libera intranet), `CANIVETE_CHROME_PROFILE`, `CANIVETE_BRIDGE_PORT` (19422), `CANIVETE_TOKEN`/`CANIVETE_TOKEN_FILE` (`~/.config/canivete/token.txt`).
Tasks/skills: `CANIVETE_TASK_ENABLE` (`1` reativa `n_task*`), `CANIVETE_SERVER_NAME`.

## Doutrina

- Dono: só age quando o dono pede. Destrutivo/idiota nunca sem pedido explícito; alto risco exige `confirm`.
- Obediência auditável: nunca faça na mão o que tem tool; siga o roteamento (arch→investigate→impact→patch→test); sem evidência arquivo:linha = recusado.
- Confie no MCP (sem polling manual): 1 espera longa com teto em vez de sleep loops.
- Refine em produção: `n_report` p/ todo erro/falta/gargalo em vez de improvisar.

## ubrowser em 30s

1. Ler página logada:
`n_ubrowser_status` → `n_ubrowser_tabs` → `n_ubrowser_read({"tab":"trecho título/URL"})`
2. Clicar com snapshot compact:
`n_ubrowser_snapshot({"tab":"trecho","compact":true})` → `n_ubrowser_act({"action":"click","ref":N})` (ou `selector`/`text="trecho"`)
### Onde clicar (snapshot compact → role+name → act)
1. `n_ubrowser_snapshot({"tab":"trecho","compact":true})` → linhas `ref|tag|text` com `role+name` (ex. `button "Entrar"`).
2. Escolha pelo `role+name`, mire por `ref` (válido até a próxima navegação) ou `selector`; nunca `tabId` (IDs mudam — use `tab:"trecho"`).
3. Modal aberto com 2 botões? `snapshot({"layer":"modal"})` — só a camada, sem ler a página.
4. Lista virtualizada? `act({action:"scan",pages:4})` antes do `snapshot`; vazio? `tabs` + F5 e `snapshot` de novo.
5. Aba de fundo? `read`/`snapshot` funcionam; `shot` só imprime a aba VISÍVEL (detalhe: `compact:false` traz `selector+x/y`).
3. WhatsApp abrir chat:
`n_whatsapp({"action":"open","name":"Nome do chat"})` → `n_whatsapp({"action":"read","name":"Nome do chat"})`

## Economia no ubrowser (tokens)

Snapshot gigante estoura `CANIVETE_CTX_BUDGET`. Regras (valem p/ qualquer agente):

1. `compact:true` sempre — `n_ubrowser_snapshot({"tab":"trecho","compact":true})` (~60% menos tokens; auto-compact acima de 30 elementos; `compact:false` só p/ detalhe `selector+x/y`).
2. `max:30` — nunca default 50/120 em subagente; pagine com `offset` (`max:30 offset:0/30/...`) até o fim.
3. Nunca screenshot gigante no contexto — `n_ubrowser_shot` (e `n_browser_screenshot` com `scale:0.5`) SÓ quando o dono pedir evidência visual; fora isso, confirmação textual.
4. `read` distill — `n_ubrowser_read({"tab":"trecho","mode":"distill"})` default (~4000 chars, `maxChars:2500`/`maxLinks:15`); `mode:"raw"` só opt-out.
5. 1 snapshot por decisão, não loop — 1 `snapshot` → 1 `act` (`verified`/`delta`/`changed` confirmam sem re-ler); nunca `snapshot` em loop; virtualizada faz `scan {pages:4}` antes, vazio relista `tabs` + F5.
6. Avisos efêmeros (toast que some no clique) vêm no `delta` (`🔔 aviso:`) — sem call extra; erros de console/rede chegam via push + 📬.

## Troubleshooting ubrowser
- Lista virtualizada (só visíveis no DOM) → `tab.scan` antes de `snapshot`.
- `chrome://`, `edge://`, Chrome Web Store = bloqueado pelo Chrome (content script não injeta).
- Aba sumiu / NOTFOUND → reliste `tabs` (IDs mudam a cada restart/navegação).
- Snapshot vazio ou `v` antiga → F5 na página e `ping` (versão desatualizada).
- Login **só com pedido explícito do dono** (nunca por iniciativa própria; device-flow com `confirm`); senha/pagamento = alto risco exige `confirm` sempre.
- `evaluate` aceita expressão (`document.title`) ou corpo-de-função (`return document.title`); sem valor de retorno vem `undefined`.
- `n_ubrowser_act scan {pages:4, container?}` p/ listas virtualizadas (rola e coleta antes do `snapshot`).
- `read` voltou curto em página grande (WARN `texto curto (N chars) p/ pagina grande`) → `mode:"raw"`, `selector:"#app"`/`"table"` p/ escopar, ou `n_ubrowser_snapshot` (conteúdo virtualizado/aria-hidden).
- Abas `about:blank` fantasmas do agente acumulando → `n_ubrowser_act {action:"close", mode:"close_by_prefix"}` (limpa todas as blank; aba do dono em http(s) é RECUSADA sem `confirm`).
- `tab:"trecho título/URL"` em read/snapshot/act/shot/scan (IDs mudam — prefira nome a `tabId`).

## Regra sem-sleep
- Nunca sleep cego (tempo fixo esperando processo/render/rede); esperar = ouvir evento/notificação com teto e erro imediato no estouro.
- Follow-up retorna assim que possível (poll curto + saída antecipada); sem `setTimeout` pós-ação p/ "assentar DOM".
- Onde vale: content (MutationObserver), background (tabs.onUpdated), server/CDP (readyState/WS/long-poll com timeout).

## Observabilidade (painel + replay) no fluxo de agentes

- Nomear a sessão na página: `n_ubrowser_act {action:"evaluate", js:"window.__ubTags={area:'autenticacao',agent:'agente-x'}"}` — replay opt-in: `window.__ubReplay=true;dispatchEvent(new Event("ub-replay-on"))`.
- Ler o acumulado: painel `http://127.0.0.1:19422/painel` ou API `GET /api/issues?source=auto&q=<trecho>` (report + mon-log fundidos, filtro por kind/area/agent, ts desc).
- Replay: o clipe sai sozinho no erro → `~/.config/canivete/replays/<id>.json`; `GET /replays/<id>` p/ o Replayer (rrweb vend em `/assets/rrweb.umd.min.js`).
- Shim visual em app homolog: `<script src="http://127.0.0.1:19422/uierr.js"></script>` + `window.__ubTags` — badge mostra o último erro; sem POST (quem envia é o mon-hook).
