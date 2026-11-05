# canivete — MCP universal em um arquivo de ideia, vários arquivos de verdade

Toolkit MCP completo (56 tools `n_*`, **zero dependências**, Node 22+) que funciona em **qualquer CLI com suporte a MCP** (opencode, Claude Code, etc.) e em **qualquer projeto**:

- **Filesystem + execução (8):** ler/listar/criar/editar/patch/shell/glob/grep — com truncamento explícito e edição segura.
- **Web sem chave (2+7):** fetch enxuto (`<article>/<main>`) + search em 7 backends públicos + câmbio/CEP/CNPJ/IP/clima/GitHub/npm (com cache TTL).
- **Tarefas (2):** todos in-memory. Subagentes **desativados** (RAM; reative com `CANIVETE_TASK_ENABLE=1`).
- **DevEngine (8):** resumo de arquitetura sem varrer, investigação de bug (12→1), impacto de mudança, patch validado por AST, testes afetados, processos em fundo, estado da UI, DAG com rollback.
- **Browsers (11):** Chrome headless próprio via CDP (navegar com JS, snapshot, agir, screenshot, PDF) + **seu Chrome logado** via extensão local (ler, snapshot, agir, print, cursor independente, aba em fundo).
  - `n_ubrowser_act`: `select selector text → escolhe opção; highlight selector → destaca elemento; waittext text → aguarda texto aparecer; type selector text → digita`.
- **Meta (6):** catálogo, pergunta ao humano, skills, plan, report, contexto.
- **WhatsApp (1):** gateway Baileys + fallback no Chrome logado.

## Tools — tabela por categoria (contagem exata via `n_tools_info`)

> Nomes conferidos via `rg 'reg\("n_' src/`. Descubra em runtime com `n_tools_info`.

### Filesystem + execução (8)

| Tool | Para que (1 linha) |
|---|---|
| `n_read` | Lê arquivo com linhas numeradas (`offset/limit/maxChars`); binário/ausente vira `isError`. |
| `n_list` | Árvore do diretório com tamanhos (`depth` 1–6); mapear pasta antes de `glob/read`. |
| `n_write` | Cria/sobrescreve arquivo (cria pastas, `append` opcional); p/ troca pontual prefira `n_edit`. |
| `n_edit` | Troca texto exato `oldString→newString` (falha segura: 0 matches ou ambíguo falha). |
| `n_apply_patch` | Aplica unified diff via `git apply` no repo root (`check`/`stat`/`reverse`). |
| `n_bash` | Shell `bash -lc` no repo root (exit+stdout/stderr truncados; `timeout` até 600s). `sleep` PROIBIDO — não espere, monitore (polling de status/log). |
| `n_glob` | Acha arquivos por glob (`**`, até 500); descobrir arquivos antes de `n_read`. |
| `n_grep` | Busca regex `path:line:trecho` (até 100); localizar símbolo antes de `n_analyze_change_impact`. |

### Web sem JS + busca (2)

| Tool | Para que (1 linha) |
|---|---|
| `n_webfetch` | Baixa URL **SEM JS** (`<article>/<main>`); **PDF** é detectado e o texto extraído **local** (pdftotext — nenhum byte enviado); SPA shell avisa p/ usar `n_browser_navigate`. |
| `n_websearch` | Busca em 10 backends públicos (News, DDG×2, Wikipedia×2, HN, **GitHub**, **GitHub-novos** (repos de até 90d por stars — o que acabou de lançar), **Lemmy**, **npm**, **arXiv**; cache 10min, `fresh:true` força ao vivo). |

### APIs públicas sem chave (7)

| Tool | Para que (1 linha) |
|---|---|
| `n_currency` | Câmbio/conversão ECB/Frankfurter (cache 1h; `from/to/amount/invert`). |
| `n_cep` | Endereço por CEP ViaCEP (cache 24h; 8 dígitos). |
| `n_cnpj` | Empresa por CNPJ ReceitaWS (cache 24h, rate-limited; 14 dígitos). |
| `n_ipinfo` | Geolocalização de IP ip-api.com (45 req/min, cache 10min). |
| `n_weather` | Previsão Open-Meteo lat/lon 1–7 dias (cache 30min, `alert:true` p/ chuva/calor). |
| `n_github` | repo/releases/commits/issues/branches/user/file/search (`account`=conta gh → 5000 req/h; 60 anônimo; cache 10min). |
| `n_npm` | Info de pacote npm (versão, licença, deps, downloads do último mês; cache 1h). |

### Tarefas (2)

Subagentes (`n_task` + mailbox) **desativados** — spawn consome RAM que a caixa não tem.
Reative com `CANIVETE_TASK_ENABLE=1` no ambiente do serviço.

| Tool | Para que (1 linha) |
|---|---|
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
| `n_browser_screencast` | Grava a página **durante interação**: `actions:[{click:"#btn"},{wait:600}…]` → frames com timestamps + WebM/MP4 via ffmpeg (tudo local). |
| `n_audio_analyze` | Análise de áudio LOCAL (ffprobe/ffmpeg no disco): duração, codec, loudness LUFS (ebur128) e mapa de silêncios = pontos de corte pra montagem de vídeo — zero upload. |
| `n_browser_pdf` | PDF da página em `/tmp` (exportar relatório/evidência). |

### Chrome LOGADO do dono via extensão (6)

| Tool | Para que (1 linha) |
|---|---|
| `n_ubrowser_status` | **Antes de tudo**: ponte/extensão conectada? Offline → `open:true` **abre o Chrome sozinho** (display com WM detectado, `profile` qualquer — "Default", "1", "Profile 1"…), espera a ponte (teto 25s) e devolve o que aconteceu; se o Chrome já roda, diagnostica janela normal + popup ATIVO. |
| `n_ubrowser_tabs` | Abas do dono (id, janela, título, url; IDs mudam — prefira `tab:"trecho"`). |
| `n_ubrowser_read` | Lê aba com login (`distill` enxuto; `raw` integral + links; `outline:true` só estrutura; value separado do placeholder). |
| `n_ubrowser_snapshot` | Clicáveis (`max`+`offset`; `find` localiza ±3 contexto; `layer:"modal\|menu\|popover\|tooltip"` foca só a camada; `scan` antes p/ virtualizada; `shadow:` p/ web components; refs morrem na navegação). |
| `n_ubrowser_act` | Automação no Chrome logado (mira: selector, `ref` do snapshot ou `text:"trecho"`; `fill` substitui, `type` anexa; `wait`=waitMs; `console` lê erros+rede — erros chegam sozinhos via push; `tooltip`/`catchup`/`aesthetic` sem clique; `expectUrl/Text/Gone` afirma sem reler; `snap:true` pós-navegação economiza 1 call; clique retorna `verified`; `elem_pick` abre o modo de marcação do dono na página; **limitação (CSP, clique/fill sintético ignorado, shadow DOM/iframe) → `cdp` dentro do act** (Runtime.evaluate imune a CSP, Input trusted; em TESTE fique no clique sintético de usuário real — cdp é escalada pós-falha, não atalho); alto risco exige `confirm`). |
| `n_ubrowser_shot` | Print só da aba **VISÍVEL** (fundo não imprime — use `n_browser_screenshot` p/ fundo; confirme ação via `verified`/`delta` antes de printar). |

### Reports de elemento (2) — o dono marca na página, o agente resolve

| Tool | Para que (1 linha) |
|---|---|
| `n_elemreports_list` | Reports de um site por `base_url` (origem normalizada; default = pendentes) com snapshot estático por elemento (seletor estável, fingerprint texto/papel, role/data-testid, outerHTML, rect). |
| `n_elemreports_resolve` | Ciclo de vida com prova: `em_resolução` → `resolvido` (`proof` = antes/depois; some do highlight e vira histórico; `aberto` reabre). |

Fluxo: *"no nosso site https://exemplo.com tem erros que reportei"* → `n_elemreports_list {base_url}` (filtro `grupo` = escopo que o dono digitou) → resolva um a um com prova. Marcação: popup → "Marcar o que está quebrado" (ou `act {action:"elem_pick"}`) — hit-test por camadas com **Tab ciclando** (alcança sob modal/banner e `pointer-events:none`), 1..N elementos por pack, ✕ no canto de cada seleção, caixa acoplada ao contorno com **grupo + prompt**, Enter salva / Cancelar aborta; chip numerado clicável abre o editor do pack (nota, grupo, ±elementos, apagar). Store: `~/.config/canivete/reports-elementos.jsonl` (append-only + dedupe por seletor+nota+grupo; nunca cookie/header/senha).

### WhatsApp dedicado (1)

| Tool | Para que (1 linha) |
|---|---|
| `n_whatsapp` | `state\|chats\|open\|read\|send\|pair` via gateway Baileys (send só com texto explícito do dono). |

### Meta (6)

| Tool | Para que (1 linha) |
|---|---|
| `n_tools_info` | Catálogo agrupado das tools (descubra o que chamar). |
| `n_question` | Registra pergunta p/ o humano (o agente pergunta diretamente). |
| `n_skill` | Carrega `SKILL.md` por nome (`refresh:true` lista/recarrega). |
| `n_plan` | Aviso: plan mode só via `/plan` na TUI (não alternável pelo MCP). |
| `n_report` | Reporta refinação p/ a tool (**obrigatório** em vez de improvisar; `kind`: `bug`\|`ajuste`\|`aprimoramento`\|`sugestao`, aliases `missing`/`bottleneck`; inbox com rotação em 500; triagem via `status` + `resolucao`). |
| `n_ctx_status` | Gasto da sessão (calls/chars/~tokens) vs `CANIVETE_CTX_BUDGET`; estouro → `distill/compact`. |

## Tarefas longas (com progresso, sem sleep cego)

Regra: **nunca sleep em loop** — 1 espera longa com teto + erro acionável no estouro.

- **Shell até 10min:** `n_bash({command, timeout})` — default 120s, **máx 600000ms (600s)**.
  Acima disso ou p/ processo que não deve bloquear, vá de background.
- **Servidor/watcher em fundo:** `n_manage_background_process({action:"start", command:"npm run dev", env:{PORT:"3001"}})`
  → `read_logs` (progresso, últimos 4k chars) → `status` → `stop`/`restart`.
  `send` NÃO escreve stdin por design (use `restart` com `env`). Cheque a UI com
  `n_inspect_ui_state({url, expect, retries})`.
- **Subagentes:** desativados (RAM) — `n_task` e família não registradas. Reative com `CANIVETE_TASK_ENABLE=1`.
- **Todos in-memory:** `n_todowrite` / `n_todo` p/ planejar a sessão.

## Erros comuns (mensagem → causa → o que fazer)

| Erro / sintoma | Causa provável | O que fazer |
|---|---|---|
| `n_webfetch` retorna shell vazio / "SPA" | Site 100% JS, login-wall ou preço dinâmico (`n_webfetch` é **SEM JS**) | Use `n_browser_navigate({url})` (renderiza JS) ou `n_ubrowser_*` (sessão logada). |
| `no results — 429 received` / `GitHub rate limit` / `ReceitaWS failed (429)` | Rate-limit do backend (GitHub 60 req/h sem token; search com retry 2×2s p/ 429) | Aguarde ~60s e tente de novo; search: `fresh:false` (lê cache 10min) em vez de `fresh:true`; GitHub: defina `GITHUB_TOKEN`/`GH_TOKEN`. |
| `EXTENSAO_OFFLINE` / `TIMEOUT_EXTENSAO` / `timeout 60s aguardando extensão` | Chrome fechado, janela anônima, popup pausado ou token divergente | `n_ubrowser_status {open:true}` **resolve sozinho**: abre o Chrome (qualquer perfil, display com WM) e espera a ponte conectar; se o Chrome JÁ roda: **janela normal** (anônima é invisível), popup **ATIVO**, token igual a `~/.config/canivete/token.txt`; SW dormente acorda em ~1min (popup → Testar conexão). Timeout único configurável: `CANIVETE_UB_TIMEOUT` (1s–300s). |
| `SSRF bloqueado: host privado/intranet` | `n_browser_*` bloqueia intranet por padrão | Use URL pública ou `CANIVETE_BROWSER_ALLOW_PRIVATE=1` p/ permitir intranet. |
| `chrome://…` / Web Store sem ação | Chrome bloqueia content script nessas páginas | Limite do Chrome — automatize só páginas web normais. |
| Aba sumiu / `NOTFOUND` / snapshot vazio | IDs de aba mudam a cada restart/navegação; lista virtualizada só tem visíveis no DOM | Reliste `n_ubrowser_tabs`; prefira `tab:"trecho título/URL"` a `tabId`; `scan {pages:4}` antes de `snapshot`; `find:"texto"` p/ localizar sem despejar; `shadow:` no selector p/ web components; F5 + `ping` se versão velha. |
| `evaluate` syntax error / `undefined` | Formas aceitas: **expressão** (`document.title`) OU **corpo** (`return document.title`) — sem `return` vem `undefined` | Nos dois mundos (isolado primeiro, MAIN de fallback). CSP bloqueando? suba pra `n_ubrowser_act {action:"cdp", method:"Runtime.evaluate"}` (imune a CSP); `read`/`snapshot` dão o dado sem JS. |
| canivete funciona em UMA CLI e não na outra | 2ª instância brigando pelas portas do daemon (EADDRINUSE 19422/19423) ou cópia defasada do repo | Resolvido: stdio detecta o daemon (:19423) e vira **proxy** (mesma pilha p/ todas as CLIs — o stderr diz "modo proxy"); aponte cada CLI pro MESMO repo (symlink, ex. `ln -sfn /caminho/canivete ~/.codex/mcp/canivete`); porta via `CANIVETE_MCP_HTTP_PORT`. |
| `Chrome só imprime aba VISÍVEL` | Print de aba em fundo | Traga p/ frente ou use `n_browser_screenshot` headless. |
| `n_bash` timeout / `exit=timeout` | Comando passou do `timeout` | Aumente `timeout` até 600000 ou rode em background (`n_manage_background_process` + `read_logs`). |
| `sleep PROIBIDO` em `n_bash`/exec | Regra do dono: sem espera cega | Dispare a ação e monitore com polling curto de status/log; tarefas longas → `nohup cmd > log 2>&1 &` + `tail`; buscar a palavra "sleep" no código → `n_grep` |
| `patch check failed` / `oldString not found` | Diff com paths errados ou trecho inexato | `stat:true` p/ ver arquivos; paths relativos ao repo; `n_read` + copiar trecho exato (espaços/quebras). |
| `body > N bytes` (modo remoto) | POST acima de `CANIVETE_MAX_BODY` (default 2MB) | Reduza o payload ou eleve `CANIVETE_MAX_BODY`. |
| `comm: o arquivo N não está em ordem` | `sort`/`comm` em locale default (ordem ≠ byte) | Re-sort com `LC_ALL=C` antes do `comm`; o stdout plausível continua saindo — **nunca** confie no diff vendo só o stderr. |
| `gh run view --job <id> --log` vazio (exit 0) | limitação do gh com `--job` sem run id | Use `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`; valide não-vazio antes de citar como evidência (`grep` em saída vazia = falso negativo). |
| Inspector `chrome://extensions/?errors=…` lista erros de PÁGINAS (Instagram/Medium/etc.) com stack `mon-hook.js` | wrap de `console.*` no mundo MAIN re-emite erros da página; Chrome atribui à extensão | **Quiet é o default** (`CANIVETE_UB_MON_QUIET=1`): mon-hook não toca console (v2), only `error` real + `unhandledrejection` + fetch/XHR; `=0` reativa com dedupe 60s/assinatura |
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

**opencode v2** (config `mcp.servers`, `enabled` virou `disabled` invertido):

```json
{ "mcp": { "servers": { "canivete": { "type": "local", "command": ["node", "/caminho/canivete/src/server.mjs"] } } } }
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

## Multi-CLI (opencode + codex + claude na mesma máquina)

Uma única pilha de serviços: o daemon (`serve.mjs`) é dono das portas (MCP HTTP 19423 · ponte
ubrowser 19422 · headless CDP 19322). CLI remota fala com o daemon direto; CLI **stdio detecta o
daemon no boot e vira proxy** (cada linha JSON-RPC vira POST `/mcp`, resposta volta pro CLI) —
zero disputa de porta. O bug "funciona numa CLI e não na outra" era exatamente isso: a 2ª
instância re-bindava 19422/19423 já ocupados (EADDRINUSE). Se o daemon NÃO estiver no ar, o stdio
assume as portas ele mesmo (comportamento solo de sempre). Porta configurável via
`CANIVETE_MCP_HTTP_PORT` (default 19423). Os `n_report` de TODAS as CLIs caem na MESMA inbox
(`~/.config/canivete/issues.jsonl` do usuário do daemon) — via proxy, não há ilha por usuário;
várias instalações/usuarios → aponte `CANIVETE_ISSUES_FILE` pro mesmo arquivo em todas.

**codex** (`~/.codex/config.toml`) — aponte pro REPO via symlink (fonte única: cópia defasada era
a outra metade do problema):

```toml
[mcp_servers.canivete]
command = "node"
args = ["/home/voce/.codex/mcp/canivete/src/server.mjs"]
```

```bash
ln -sfn /caminho/canivete ~/.codex/mcp/canivete   # o caminho do args resolve pro repo
```

## Atualizar o canivete (qualquer CLI) — 1 comando

```bash
npm run atualizar        # ou: bash scripts/atualizar.sh
```

Funciona do terminal do dono OU via `n_bash` de qualquer CLI (root cai pro tork sozinho; o
reinício é agendado via `systemd-run` — sobrevive mesmo executando de dentro do daemon).
Detalhes do fluxo:

- **Remote (opencode)**: sem restart do cliente — o daemon atende código novo por chamada.
- **stdio (codex/claude)**: sessão nova spawna o proxy atualizado; sessão aberta segue no código antigo até fechar.
- **Pegadinha**: se alguém editou arquivos como **root**, o `git pull` do tork falha (arquivo root-owned). Conserte com `sudo chown -R tork:tork /caminho/canivete` e rode de novo.
- **Auto (padrão)**: timer `canivete-updater` a cada 2h + 5min pós-boot — pull discreto e reinício SÓ se veio código novo (log: `journalctl --user -u canivete-updater`; carimbo: `~/.config/canivete/last-update`). Desligar: `systemctl --user disable --now canivete-updater.timer`. Quer aplicar agora sem esperar o ciclo? `npm run atualizar`.

## Persistência (sobrevive ao reboot)

```bash
# service user systemd (já instalado nesta máquina):
systemctl --user enable --now canivete   # sobe no login, reinicia sozinho (Restart=always)
loginctl enable-linger tork              # sobe mesmo sem login gráfico
```

Sem isso, todo reboot derruba a ponte e o opencode mostra `SSE error: Unable to connect`.
Broker em `~/.config/canivete/` (persiste; `/tmp` apagava tudo no reboot).

Exemplos prontos em `examples/`.

## Subagentes (`n_task` — desativado)

Spawn de subagentes **desativado por padrão**: cada spawn é um processo `opencode`
(~700MB) e a caixa não tem RAM. O código está intacto — reative com
`CANIVETE_TASK_ENABLE=1` no ambiente do serviço. Docs históricas da família
`n_task*` + mailbox + runner/serve foram removidas desta página nessa versão.

## Segurança (doutrina do dono)

- O agente só age **quando o dono pede**. Fechar abas e roubar foco **existem mas exigem `confirm`** (fechamento de aba do dono em http(s), foco de SO) — recusados sem.
- Alto risco (pagamento, senha/2FA, excluir conta, apagar tudo) exige `confirm="<frase do dono>"`.
- Ponte local (`127.0.0.1:19422`) + token (`~/.config/canivete/token.txt`, gerado sozinho, `0600`, no `.gitignore`).
- Kill switch: pause na extensão = acesso zero.

## Variáveis de ambiente

| Var | Default | O quê |
|---|---|---|
| `CANIVETE_CWD` | `process.cwd()` | raiz do projeto (fs/shell) |
| `CANIVETE_TASK_ENABLE` | — | `1` reativa a família `n_task*` (subagentes; desligado por RAM) |
| `CANIVETE_HOST_GUARD_MS` | `170000` | teto de resposta (antes do timeout do host) |
| `CANIVETE_TOKEN` / `CANIVETE_TOKEN_FILE` | `~/.config/canivete/token.txt` (autogerado) | auth da extensão |
| `CANIVETE_BRIDGE_PORT` | `19422` | ponte da extensão (aliases: `UBROWSER_PORT`, `UB_PORT`) |
| `CANIVETE_UB_TIMEOUT` | `60000` | timeout único da ponte ubrowser (clamp 1s–300s; mensagens mostram o valor real) |
| `CANIVETE_UB_DISPLAY` / `CANIVETE_UB_XAUTH` | — | display/Xauthority fixos pro `status {open:true}` abrir o Chrome (auto: detecta X com WM via wmctrl; console real antes do virtual do CRD) |
| `CANIVETE_UB_CHROME_DIR` | `~/.config/google-chrome` | diretório de perfis do Chrome do dono (valida `profile` e limpa Singleton de crash) |
| `CANIVETE_ISSUES_FILE` | `~/.config/canivete/issues.jsonl` | inbox única de `n_report` — aponte pro MESMO arquivo em toda instalação/usuário (ex.: `sudo -u tork` vs root) |
| `CANIVETE_CONFIG_DIR` | `~/.config/canivete` | estado da ponte (issues-state, mon-log, tools-off, replays, elemreports) — unificar multi-instalação |
| `CANIVETE_UB_MON_QUIET` | `1` | `0` reativa o wrap de `console.*` da página no mon-hook (captura `ErrorUtils`/pixels; mais ruído no inspector da extensão — default `1` = quiet, Inspector limpo) |
| `CANIVETE_CS_EXEC_TMO` | `120000` | timeout default do `n_codespace_exec` (clamp 5s–165s; por chamada: `timeoutSec`) |
| `CANIVETE_GH_CONFIG_DIR` | — | perfil gh multi-conta do serviço (ex.: `/etc/canivete/gh`) |
| `CANIVETE_CDP_PORT` | `19322` | Chrome headless (CDP) |
| `CANIVETE_CHROME_BIN` | auto-detect | binário do Chrome |
| `CANIVETE_CHROME_PROFILE` | `/tmp/canivete-chrome-profile` | perfil headless |
| `CANIVETE_MAX_POLLS` | `8` | teto de polls ativos (só com `CANIVETE_TASK_ENABLE=1`) |
| `CANIVETE_BROWSER_TIMEOUT_MS` | `40000` | timeout do Chrome headless (`n_browser_*`; PDF usa `CANIVETE_BROWSER_PDF_TIMEOUT_MS` ou este, default 60s) |
| `CANIVETE_BROWSER_ALLOW_PRIVATE` | — | `1` libera intranet nos `n_browser_*` (default bloqueia SSRF) |
| `CANIVETE_CDP_TIMEOUT` | `25000` (WS open `10000`) | timeout CDP/WS do headless |
| `CANIVETE_MAX_BODY` | `2MB` | teto do POST no modo remoto `--http` (excedeu → `body > N bytes`) |
| `CANIVETE_CTX_BUDGET` | `200000` | orçamento de chars da sessão (ver `n_ctx_status`) |
| `CANIVETE_WALK_CAP` / `CANIVETE_WALK_DEPTH` | `8000` / `8` | teto de arquivos/profundidade nas varreduras |
| `CANIVETE_TASK_PREFIX` | `canivete-task-` | prefixo dos ids de task (só com `CANIVETE_TASK_ENABLE=1`) |
| `CANIVETE_SERVER_NAME` | `canivete` | nome do servidor (persistência) |
| `CANIVETE_SKILLS_PATHS` | — | dirs extras de skills (`:`) |
| `CANIVETE_TASK_MODE` / `CANIVETE_SERVE_PORT` / `CANIVETE_SERVE_URL` | `auto` / `19425` / `http://127.0.0.1:<porta>` | runner opencode legado (só com `CANIVETE_TASK_ENABLE=1`) |
| `CANIVETE_RUNNER` / `CANIVETE_RUN_TEMPLATE` | `opencode` / — | runner legado (`{prompt} {model} {agent} {id}`; só com `CANIVETE_TASK_ENABLE=1`) |
| `CANIVETE_LLM_PROVIDER` + `CANIVETE_LLM_API_KEY` + `CANIVETE_LLM_MODEL` | — | LLM direto OpenAI-compatível (`groq\|cerebras\|gemini\|openrouter\|deepseek\|openai\|ollama` + fallbacks `_2.._5`) |
| `CANIVETE_LLM_TIMEOUT` / `CANIVETE_LLM_MAX_TOKENS` | — | teto de espera / resposta do LLM direto |

## Observabilidade universal (painel local, sem SaaS)

mon-hook (extensão, mundo MAIN) captura console/erros/rede e, com opt-in, o replay rrweb;
a ponte guarda os clipes e um painel local mostra tudo junto do inbox `n_report`:

| Rota (127.0.0.1:19422) | Auth | O quê |
|---|---|---|
| `GET /painel` | público | painel web (Ledger) — erros/reports/replays |
| `GET /uierr.js` | público | shim de evidência visual p/ sobrepor em app homolog |
| `GET /assets/<arquivo>` | público | assets servidos (ex.: `rrweb.umd.min.js` vend) |
| `GET /replays/<id>` | público | JSON do clipe rrweb gravado |
| `GET /api/issues?source=&kind=&area=&agent=&q=&limit=` | público | issues fundidos: inbox (`source=report`) + mon-log (`source=auto`) + reports de elemento (`source=elem`) |
| `GET /elemreports?base_url=&status=&area=&q=&limit=` | público | reports de elemento de um site (estado corrente; a extensão sincroniza o highlight por aqui) |
| `GET /elemshots/<id>.png` | público | screenshot opcional de um report |
| `POST /replay?token=` | token | grava clipe rrweb + 1 linha em `~/.config/canivete/mon-log.jsonl` |
| `POST /elemreport?token=` | token | cria report de elemento vindo do overlay (dedupe por seletor+nota; devolve o report persistido) |
| `POST /elemreport-update?token=` | token | edita pack existente (nota, `elements_add`/`elements_remove`, `apagar:true`) e devolve o report atualizado |

Como o agente usa (Chrome do dono, via `n_ubrowser_act`):

```
act {action:"evaluate", js:"window.__ubTags={area:'autenticacao',agent:'agente-x'}"}   // nomeia a sessão
act {action:"evaluate", js:"window.__ubReplay=true;dispatchEvent(new Event('ub-replay-on'))"}  // liga o replay (opt-in)
```

- Painel: `http://127.0.0.1:19422/painel` — clique numa linha expande in place; "Olhar replay" monta o player rrweb.
- Shim em app de teste: `<script src="http://127.0.0.1:19422/uierr.js"></script>` + `window.__ubTags` + `window.__ubReplay=true` (badge visual do último erro; NENHUM POST — quem envia é o mon-hook).
- Replay grava janela de 2400 eventos (mousemove/scroll/input amostrados) e manda o clipe no erro (1 por 45s) → `~/.config/canivete/replays/<id>.json`.
- NOTA de segurança: ponte escuta **só em 127.0.0.1**; rotas de leitura do painel são públicas na máquina local, escritas (POST) continuam token-only. Extensions v1.9.0+, mon-hook v4.

## Solução de problemas

- **Porta ocupada** (`EADDRINUSE`): duas sessões no mesmo projeto — o segundo loga e tenta de novo no primeiro uso, ou mude `CANIVETE_BRIDGE_PORT`/`CANIVETE_CDP_PORT`.
- **Extensão offline**: Chrome aberto, janela normal, popup ATIVO, token igual ao arquivo. `n_ubrowser_status` diagnostica.
- **SW dormente**: popup → Testar conexão; alarms reacordam em ~1min.
- **`chrome://`**: Chrome bloqueia automação nessas páginas (limite dele).

## Layout

```
src/server.mjs          entrada MCP (protocolo + n_tools_info; dispatch em core/rpc.mjs)
src/remote.mjs          modo --http (mesmo dispatch via core/rpc.mjs)
src/core/cache.mjs      cache TTL único (web + apis; hit/miss + negative-cache)
src/core/retry.mjs      sleep + fetchRetry únicos (web 2x + apis 3x preservados)
src/core/symbols.mjs    extração de símbolos (fs p/ n_read + devengine p/ índice)
src/core/snapshot.mjs   primitivos de ranking (label/role/box/fold/dedup compartilhados)
src/core/taxonomy.mjs   grupos do catálogo — fonte única (info + find)
src/core/rpc.mjs        dispatch JSON-RPC + annotations (stdio + http)
src/lib/ctx.mjs         config/env, registro, helpers compartilhados
src/lib/fs.mjs          filesystem + shell (symbols via core)
src/lib/web.mjs         fetch + search + cache (cache/retry via core)
src/lib/apis.mjs        APIs públicas sem chave (cache/retry via core)
src/lib/tasks.mjs       todos in-memory (+ orquestração/mailbox dormentes atrás de CANIVETE_TASK_ENABLE=1) + meta(skills)
src/lib/devengine.mjs   análise estática + validação + DAG (symbols via core)
src/lib/cdp.mjs         núcleo CDP (headless)
src/lib/tools-browser.mjs   browser_* (headless)
src/lib/ubridge.mjs     ponte da extensão (HTTP + token + /exec)
src/lib/tools-owner.mjs     ubrowser_* (Chrome do dono)
src/lib/elemreports.mjs reports de elemento (marcação humana: store jsonl + n_elemreports_*)
src/lib/feedback.mjs    n_report (inbox jsonl com rotação atômica)
src/lib/gh.mjs          gh (n_github + contas gh p/ codespace)
src/lib/llm.mjs         slots LLM (fallbacks 2-5, presets)
src/lib/tools-codespace.mjs  n_codespace_* (ambiente de teste na nuvem gh)
src/lib/risk.mjs        trava anti-destrutiva (compartilhada)
config/models.json      modelos (modo opencode)
extension/              extensão MV3 do Chrome do dono (background.js ponte+cursor trusted, content.js DOM+overlay de marcação, mon-hook.js console+rede, wa-hook.js WhatsApp, popup)
examples/               configs prontas por CLI
docs/                   skill global de referência
test/smoke.mjs          fumaça offline-segura
```
