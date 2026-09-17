# canivete — MCP universal em um arquivo de ideia, vários arquivos de verdade

Toolkit MCP completo (55 tools `n_*`, **zero dependências**, Node 22+) que funciona em **qualquer CLI com suporte a MCP** (opencode, Claude Code, etc.) e em **qualquer projeto**:

- **Filesystem + execução (8):** ler/listar/criar/editar/patch/shell/glob/grep — com truncamento explícito e edição segura.
- **Web sem chave (2+7):** fetch enxuto (`<article>/<main>`) + search em 7 backends públicos + câmbio/CEP/CNPJ/IP/clima/GitHub/npm (com cache TTL).
- **Orquestração (12):** spawn de subagentes em paralelo + mailbox em disco + todos + modelos. Runner plugável.
- **DevEngine (8):** resumo de arquitetura sem varrer, investigação de bug (12→1), impacto de mudança, patch validado por AST, testes afetados, processos em fundo, estado da UI, DAG com rollback.
- **Browsers (11):** Chrome headless próprio via CDP (navegar com JS, snapshot, agir, screenshot, PDF) + **seu Chrome logado** via extensão local (ler, snapshot, agir, print, cursor independente, aba em fundo).
  - `n_ubrowser_act`: `select selector text → escolhe opção; highlight selector → destaca elemento; waittext text → aguarda texto aparecer; type selector text → digita`.
- **Meta (6):** catálogo, pergunta ao humano, skills, plan, report, contexto.
- **WhatsApp (1):** gateway Baileys + fallback no Chrome logado.

## Tools (55) — tabela por categoria

> Nomes conferidos via `rg 'reg\("n_' src/` (55 matches). Descubra em runtime com `n_tools_info`.

### Filesystem + execução (8)

| Tool | Para que (1 linha) |
|---|---|
| `n_read` | Lê arquivo com linhas numeradas (`offset/limit/maxChars`); binário/ausente vira `isError`. |
| `n_list` | Árvore do diretório com tamanhos (`depth` 1–6); mapear pasta antes de `glob/read`. |
| `n_write` | Cria/sobrescreve arquivo (cria pastas, `append` opcional); p/ troca pontual prefira `n_edit`. |
| `n_edit` | Troca texto exato `oldString→newString` (falha segura: 0 matches ou ambíguo falha). |
| `n_apply_patch` | Aplica unified diff via `git apply` no repo root (`check`/`stat`/`reverse`). |
| `n_bash` | Shell `bash -lc` no repo root (exit+stdout/stderr truncados; `timeout` até 600s). |
| `n_glob` | Acha arquivos por glob (`**`, até 500); descobrir arquivos antes de `n_read`. |
| `n_grep` | Busca regex `path:line:trecho` (até 100); localizar símbolo antes de `n_analyze_change_impact`. |

### Web sem JS + busca (2)

| Tool | Para que (1 linha) |
|---|---|
| `n_webfetch` | Baixa URL **SEM JS** (`<article>/<main>`); SPA shell avisa p/ usar `n_browser_navigate`. |
| `n_websearch` | Busca em 7 backends públicos (cache 10min, `fresh:true` força ao vivo). |

### APIs públicas sem chave (7)

| Tool | Para que (1 linha) |
|---|---|
| `n_currency` | Câmbio/conversão ECB/Frankfurter (cache 1h; `from/to/amount/invert`). |
| `n_cep` | Endereço por CEP ViaCEP (cache 24h; 8 dígitos). |
| `n_cnpj` | Empresa por CNPJ ReceitaWS (cache 24h, rate-limited; 14 dígitos). |
| `n_ipinfo` | Geolocalização de IP ip-api.com (45 req/min, cache 10min). |
| `n_weather` | Previsão Open-Meteo lat/lon 1–7 dias (cache 30min, `alert:true` p/ chuva/calor). |
| `n_github` | Repo/releases/commits/issues (60 req/h sem token, cache 10min). |
| `n_npm` | Info de pacote npm (versão, licença, deps, downloads do último mês; cache 1h). |

### Orquestração — subagentes + mailbox (12)

| Tool | Para que (1 linha) |
|---|---|
| `n_task` | Spawn subagente (`model` obrigatório no modo opencode; `background:true` não bloqueia). |
| `n_task_wait` | Espera tasks (`any` = 1º que terminar, `all` = todas; clamp ~170s — chame de novo). |
| `n_list_models` | **PASSO 1** antes de `n_task`: lista modelos válidos (modo opencode exige escolha). |
| `n_task_status` | Lista/detalha subagentes (status, modelo, `mailbox:N`, `idle`, `interrupted`); nunca bloqueia. |
| `n_task_send` | Envia msg p/ mailbox (`main` ou task; `ttl_ms` opcional); não-bloqueante. |
| `n_task_recv` | Lê e **esvazia** mailbox (destrutivo; `filter`/`timeout` até 170s). |
| `n_task_peek` | Espia mailbox **sem** esvaziar (últimas N + idade). |
| `n_task_tail` | Transcrição parcial ao vivo do subagente (o que está gerando agora). |
| `n_task_notifications` | Notifs de tasks + correio dormindo (esvazia notifs). |
| `n_task_delete` | Exclui task/mailbox; em `running` mata o processo. |
| `n_todowrite` | Cria/substitui lista de tarefas in-memory (`replace`/`append`). |
| `n_todo` | Lê a lista de tarefas in-memory. |

### DevEngine (8)

| Tool | Para que (1 linha) |
|---|---|
| `n_get_architecture_summary` | Topologia leve do projeto sem varrer arquivos (stack, entrypoints, features). |
| `n_investigate_issue` | Causa raiz por keyword OR ranqueada (12→8; `stack_trace` salta direto). |
| `n_analyze_change_impact` | Callers + testes afetados **antes** de editar (`callers`/`callees`, `top` até 50). |
| `n_apply_semantic_patch` | Edição validada por `node --check` (`dry_run` valida sem escrever). |
| `n_execute_targeted_tests` | Roda testes do runner detectado (`diff_only`/`module`/`full`; vitest/jest/mocha). |
| `n_manage_background_process` | `start/stop/restart/status/read_logs` de dev server sem bloquear (ver tarefas longas). |
| `n_inspect_ui_state` | Checagem HTTP da UI (status + `expect` FOUND/MISSING, `retries` 0–3). |
| `n_orchestrate_task` | DAG com checkpoint/resume/rollback via `git stash` (rollback exige `confirm:true`). |

### Browser headless próprio via CDP (5)

| Tool | Para que (1 linha) |
|---|---|
| `n_browser_navigate` | Navega renderizando JS/SPA; retorna título+texto+links (`waitMs`, `cookies`). |
| `n_browser_snapshot` | Elementos interativos da página (`compact:true` economiza ~60% tokens). |
| `n_browser_act` | Interage via CDP: goto/click/fill/press/scroll/wait/`evaluate` (+ `console:true` p/ logs). |
| `n_browser_screenshot` | PNG da página ou de um elemento (`selector`, `fullPage`, `scale`). |
| `n_browser_pdf` | PDF da página em `/tmp` (exportar relatório/evidência). |

### Chrome LOGADO do dono via extensão (6)

| Tool | Para que (1 linha) |
|---|---|
| `n_ubrowser_status` | **Antes de tudo**: ponte/extensão conectada? (offline → janela normal + popup ATIVO). |
| `n_ubrowser_tabs` | Abas do dono (id, janela, título, url; IDs mudam — prefira `tab:"trecho"`). |
| `n_ubrowser_read` | Lê aba com login (default `distill` enxuto; `raw` = texto integral + links). |
| `n_ubrowser_snapshot` | Clicáveis da aba (`max` até 120 + `offset`; `scan` antes p/ lista virtualizada). |
| `n_ubrowser_act` | Automação no Chrome logado (goto/click/fill/type/select/scroll/`flow`; alto risco exige `confirm`). |
| `n_ubrowser_shot` | Print só da aba **VISÍVEL** (fundo não imprime — use `n_browser_screenshot` p/ fundo). |

### WhatsApp dedicado (1)

| Tool | Para que (1 linha) |
|---|---|
| `n_whatsapp` | `state\|chats\|open\|read\|send\|pair` via gateway Baileys (send só com texto explícito do dono). |

### Meta (6)

| Tool | Para que (1 linha) |
|---|---|
| `n_tools_info` | Catálogo agrupado das 55 tools (descubra o que chamar). |
| `n_question` | Registra pergunta p/ o humano (o agente pergunta diretamente). |
| `n_skill` | Carrega `SKILL.md` por nome (`refresh:true` lista/recarrega). |
| `n_plan` | Aviso: plan mode só via `/plan` na TUI (não alternável pelo MCP). |
| `n_report` | Reporta erro/falta/gargalo p/ refinar a tool (**obrigatório** em vez de improvisar). |
| `n_ctx_status` | Gasto da sessão (calls/chars/~tokens) vs `CANIVETE_CTX_BUDGET`; estouro → `distill/compact`. |

## Tarefas longas (com progresso, sem sleep cego)

Regra: **nunca sleep em loop** — 1 espera longa com teto + erro acionável no estouro.

- **Shell até 10min:** `n_bash({command, timeout})` — default 120s, **máx 600000ms (600s)**.
  Acima disso ou p/ processo que não deve bloquear, vá de background.
- **Servidor/watcher em fundo:** `n_manage_background_process({action:"start", command:"npm run dev", env:{PORT:"3001"}})`
  → `read_logs` (progresso, últimos 4k chars) → `status` → `stop`/`restart`.
  `send` NÃO escreve stdin por design (use `restart` com `env`). Cheque a UI com
  `n_inspect_ui_state({url, expect, retries})`.
- **Subagentes em fundo:** `n_task({prompt, model, background:true, subagent_type})`
  → **UMA** chamada `n_task_wait({task_ids, wait:"all"|"any", timeout:600000})`.
  O servidor espera por você até o clamp do host (~170s, `CANIVETE_HOST_GUARD_MS`);
  se ainda estiver rodando, **chame `n_task_wait` de novo** (não é erro).
  Progresso ao vivo: `n_task_tail({task_id})`; estado sem bloquear: `n_task_status`.
  Limites: sem teto de quantidade de tasks (spawn nunca recusa por carga); `CANIVETE_MAX_POLLS` (8 polls ativos).
- **Mailbox acorda:** subagente sempre finaliza com `n_task_send({task_id:"main", message:"done <id> + resumo"})`;
  o principal lê via `n_task_notifications` / `n_task_recv({timeout})`. Nunca termine com mailbox cheia.
- **Modelo obrigatório (modo opencode):** `n_list_models` → escolha → passe `model` em `n_task`.
  Sem o binário do runner, `n_task` devolve erro claro (o resto funciona).

## Erros comuns (mensagem → causa → o que fazer)

| Erro / sintoma | Causa provável | O que fazer |
|---|---|---|
| `n_webfetch` retorna shell vazio / "SPA" | Site 100% JS, login-wall ou preço dinâmico (`n_webfetch` é **SEM JS**) | Use `n_browser_navigate({url})` (renderiza JS) ou `n_ubrowser_*` (sessão logada). |
| `no results — 429 received` / `GitHub rate limit` / `ReceitaWS failed (429)` | Rate-limit do backend (GitHub 60 req/h sem token; search com retry 2×2s p/ 429) | Aguarde ~60s e tente de novo; search: `fresh:false` (lê cache 10min) em vez de `fresh:true`; GitHub: defina `GITHUB_TOKEN`/`GH_TOKEN`. |
| `EXTENSAO_OFFLINE` / `TIMEOUT_EXTENSAO` / `timeout 60s aguardando extensão` | Chrome fechado, janela anônima, popup pausado ou token divergente | `n_ubrowser_status` diagnostica: Chrome aberto, **janela normal** (anônima é invisível), popup **ATIVO**, token igual a `~/.config/canivete/token.txt`; SW dormente acorda em ~1min (popup → Testar conexão). |
| `SSRF bloqueado: host privado/intranet` | `n_browser_*` bloqueia intranet por padrão | Use URL pública ou `CANIVETE_BROWSER_ALLOW_PRIVATE=1` p/ permitir intranet. |
| `chrome://…` / Web Store sem ação | Chrome bloqueia content script nessas páginas | Limite do Chrome — automatize só páginas web normais. |
| Aba sumiu / `NOTFOUND` / snapshot vazio | IDs de aba mudam a cada restart/navegação; lista virtualizada só tem visíveis no DOM | Reliste `n_ubrowser_tabs`; prefira `tab:"trecho título/URL"` a `tabId`; `scan {pages:4}` antes de `snapshot`; F5 + `ping` se versão velha. |
| `evaluate` devolve `undefined` / CSP | Falta `return ...` no JS ou CSP bloqueou | Retorne valor (`return ...`); CSP bloqueado não tem workaround via extensão. |
| `Chrome só imprime aba VISÍVEL` | Print de aba em fundo | Traga p/ frente ou use `n_browser_screenshot` headless. |
| `n_bash` timeout / `exit=timeout` | Comando passou do `timeout` | Aumente `timeout` até 600000 ou rode em background (`n_manage_background_process` + `read_logs`). |
| `n_task sem runner` / `binário 'opencode' não encontrado` | Runner ausente | Instale o binário ou modo genérico: `CANIVETE_RUNNER` + `CANIVETE_RUN_TEMPLATE="claude -p {prompt}"`. |
| `patch check failed` / `oldString not found` | Diff com paths errados ou trecho inexato | `stat:true` p/ ver arquivos; paths relativos ao repo; `n_read` + copiar trecho exato (espaços/quebras). |
| `body > N bytes` (modo remoto) | POST acima de `CANIVETE_MAX_BODY` (default 2MB) | Reduza o payload ou eleve `CANIVETE_MAX_BODY`. |
| `wait timeout — ainda rodando` | `n_task_wait` bateu no clamp ~170s | **Não é falha**: chame `n_task_wait` de novo; acompanhe com `n_task_tail`/`n_task_status`. |
| Erro/falta/gargalo em qualquer tool | Comportamento inesperado ou capacidade ausente | Use `n_report({kind, where, expected, got})` em vez de improvisar. |

## Quickstart (5 min)

```bash
git clone https://github.com/AsafeTork/canivete.git
cd canivete
node src/server.mjs   # fala MCP via stdio; o token da extensão é gerado sozinho em ~/.config/canivete/token.txt
```

**Extensão (pro seu Chrome logado):** `chrome://extensions` → modo desenvolvedor → carregar `extension/` → colar o token → ATIVO. Janela normal (anônima é invisível).

## Config por CLI

**opencode** (`~/.config/opencode/opencode.json` ou do projeto):

```json
{ "mcp": { "canivete": { "type": "local", "command": ["node", "/caminho/canivete/src/server.mjs"], "enabled": true } } }
```

**Claude Code:**

```bash
claude mcp add canivete -- node /caminho/canivete/src/server.mjs
```

**Genérico (qualquer cliente MCP stdio):** comando `node`, args `["/caminho/canivete/src/server.mjs"]`, cwd = seu projeto.

## Modo remoto (recomendado: zero restart do host)

```bash
node src/server.mjs --http 19423   # Streamable HTTP em 127.0.0.1:19423/mcp
```

```json
{ "mcp": { "canivete": { "type": "remote", "url": "http://127.0.0.1:19423/mcp", "oauth": false, "headers": { "X-Token": "{file:/home/voce/.config/canivete/token.txt}" } } } }
```

O host reconecta por chamada: trocar **código** do canivete nunca exige restart do opencode
(só reinicie o processo do canivete). Trocar **config** exige 1 restart (opencode lê config só no boot).

## Persistência (sobrevive ao reboot)

```bash
# service user systemd (já instalado nesta máquina):
systemctl --user enable --now canivete   # sobe no login, reinicia sozinho (Restart=always)
loginctl enable-linger tork              # sobe mesmo sem login gráfico
```

Sem isso, todo reboot derruba a ponte e o opencode mostra `SSE error: Unable to connect`.
Broker em `~/.config/canivete/` (persiste; `/tmp` apagava tudo no reboot).

Exemplos prontos em `examples/`.

## Runner de subagentes (`n_task`)

- Padrão: `opencode` (fidelidade total: monitora a session via DB).
- Qualquer CLI: `CANIVETE_RUNNER` + `CANIVETE_RUN_TEMPLATE` com `{prompt} {model} {agent} {id}`.

```bash
CANIVETE_RUNNER=claude CANIVETE_RUN_TEMPLATE="claude -p {prompt}" node src/server.mjs
```

Sem o binário do runner, `n_task` devolve erro claro (o resto funciona).

## Correio que acorda (mailbox push)

`send` grava em disco compartilhado (`MCP_BROKER_DIR`, padrão por projeto; fixe
`MCP_BROKER_DIR=/tmp/canivete-shared` para um correio único entre projetos).
Cada servidor observa `TASK_ID` próprio + `main` (se `CANIVETE_WATCH_MAIN=1`) e
empurra 📬 automático na sessão — ninguém dorme sem ler. Extras via `CANIVETE_WATCH`
(vírgula). No modo remoto o push não atravessa HTTP: vale o handshake
(`recv` com timeout + regra de ouro no prompt do agente) e o scan de
"correio dormindo" em `n_task_notifications` + aviso ao enviar p/ task parada.

## Segurança (doutrina do dono)

- O agente só age **quando o dono pede**. Fechar abas e roubar foco **não existem** no código.
- Alto risco (pagamento, senha/2FA, excluir conta, apagar tudo) exige `confirm="<frase do dono>"`.
- Ponte local (`127.0.0.1:19422`) + token (`~/.config/canivete/token.txt`, gerado sozinho, `0600`, no `.gitignore`).
- Kill switch: pause na extensão = acesso zero.

## Variáveis de ambiente

| Var | Default | O quê |
|---|---|---|
| `CANIVETE_CWD` | `process.cwd()` | raiz do projeto (fs/shell) |
| `CANIVETE_RUNNER` | `opencode` | binário de subagentes |
| `CANIVETE_RUN_TEMPLATE` | — | template genérico `{prompt} {model} {agent} {id}` |
| `CANIVETE_MODELS_FILE` | `config/models.json` | lista de modelos |
| `CANIVETE_AGENTS` | lista padrão | tipos de subagente |
| `CANIVETE_HOST_GUARD_MS` | `170000` | teto de resposta (antes do timeout do host) |
| `CANIVETE_TOKEN` / `CANIVETE_TOKEN_FILE` | `~/.config/canivete/token.txt` (autogerado) | auth da extensão |
| `CANIVETE_BRIDGE_PORT` | `19422` | ponte da extensão |
| `CANIVETE_CDP_PORT` | `19322` | Chrome headless (CDP) |
| `CANIVETE_CHROME_BIN` | auto-detect | binário do Chrome |
| `CANIVETE_CHROME_PROFILE` | `/tmp/canivete-chrome-profile` | perfil headless |
| `CANIVETE_MAX_POLLS` | `8` | teto de polls ativos aguardando subagente |
| `CANIVETE_BROWSER_TIMEOUT_MS` | `40000` | timeout do Chrome headless (`n_browser_*`; PDF usa `CANIVETE_BROWSER_PDF_TIMEOUT_MS` ou este, default 60s) |
| `CANIVETE_BROWSER_ALLOW_PRIVATE` | — | `1` libera intranet nos `n_browser_*` (default bloqueia SSRF) |
| `CANIVETE_CDP_TIMEOUT` | `25000` (WS open `10000`) | timeout CDP/WS do headless |
| `CANIVETE_MAX_BODY` | `2MB` | teto do POST no modo remoto `--http` (excedeu → `body > N bytes`) |
| `CANIVETE_CHROME_BIN` (`CHROME_BIN`) | auto-detect | binário do Chrome headless |
| `CANIVETE_CTX_BUDGET` | `200000` | orçamento de chars da sessão (ver `n_ctx_status`) |
| `CANIVETE_MAX_MSGS` / `CANIVETE_MAX_MSG_CHARS` | `100` / `4000` | teto da mailbox (qtd/tamanho por msg) |
| `CANIVETE_DB_TIMEOUT_MS` / `CANIVETE_EXPORT_TIMEOUT_MS` | `5000` / `8000` | timeouts internos de tasks (DB/export) |
| `CANIVETE_WALK_CAP` / `CANIVETE_WALK_DEPTH` | `8000` / `8` | teto de arquivos/profundidade nas varreduras |
| `CANIVETE_TASK_PREFIX` | `canivete-task-` | prefixo dos ids de task |
| `CANIVETE_SERVER_NAME` | `canivete` | nome do servidor (mailbox/persistência) |
| `CANIVETE_SKILLS_PATHS` | — | dirs extras de skills (`:`) |

## Solução de problemas

- **Porta ocupada** (`EADDRINUSE`): duas sessões no mesmo projeto — o segundo loga e tenta de novo no primeiro uso, ou mude `CANIVETE_BRIDGE_PORT`/`CANIVETE_CDP_PORT`.
- **Extensão offline**: Chrome aberto, janela normal, popup ATIVO, token igual ao arquivo. `n_ubrowser_status` diagnostica.
- **SW dormente**: popup → Testar conexão; alarms reacordam em ~1min.
- **`chrome://`**: Chrome bloqueia automação nessas páginas (limite dele).
- **`n_task` sem runner**: instale o binário ou configure o template genérico.

## Layout

```
src/server.mjs          entrada MCP (protocolo + n_tools_info)
src/lib/ctx.mjs         config/env, registro, helpers compartilhados
src/lib/fs.mjs          filesystem + shell
src/lib/web.mjs         fetch + search + cache
src/lib/apis.mjs        APIs públicas sem chave
src/lib/tasks.mjs       orquestração + mailbox + meta(skills)
src/lib/devengine.mjs   análise estática + validação + DAG
src/lib/cdp.mjs         núcleo CDP (headless)
src/lib/tools-browser.mjs   browser_* (headless)
src/lib/ubridge.mjs     ponte da extensão (HTTP + token + /exec)
src/lib/tools-owner.mjs     ubrowser_* (Chrome do dono)
src/lib/risk.mjs        trava anti-destrutiva (compartilhada)
config/models.json      modelos (modo opencode)
extension/              extensão MV3 do Chrome do dono
examples/               configs prontas por CLI
docs/                   skill global de referência
test/smoke.mjs          fumaça offline-segura
```
