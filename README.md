# Canivete — MCP universal com ferramentas simples e precisas

Toolkit MCP para qualquer cliente compatível, Node 22+ e zero dependências. O catálogo principal expõe **36 tools**, agrupadas por intenção; cada tool aceita um `action`, `source` ou `detail` para especializar a operação. A família opcional de tarefas adiciona quatro tools quando `CANIVETE_TASK_ENABLE=1`.

O catálogo é gerado do registro real em [docs/TOOLS.md](docs/TOOLS.md). Em runtime, comece por `cv_help {}` para ver capacidades ou `cv_help {query:"...", detail:true}` para escolher e entender uma operação. Os antigos nomes `cv_*` continuam aceitos como aliases internos, mas não aparecem no catálogo anunciado ao modelo.

## Escolha rápida

| Quero… | Tool | Como especificar |
|---|---|---|
| Ler, listar ou buscar no projeto | `cv_file_read` | `action`: `read`, `tree`, `search_files`, `search_text` |
| Criar ou alterar arquivo | `cv_file_write` | `action`: `write` ou `replace`; alterações de código podem usar `cv_code_edit` |
| Consultar dados públicos | `cv_lookup` | `source`: `currency`, `cep`, `cnpj`, `ipinfo`, `weather`, `github`, `npm` |
| Ler uma página pública com JS | `cv_browser_read` | `detail`: `summary` ou `full` |
| Capturar página/medir contraste | `cv_browser_capture` | `action`: `screenshot`, `pdf`, `contrast` |
| Usar o Chrome autenticado do dono | `cv_owner_inspect` e `cv_owner_act` | consulta e ação têm modos próprios; o agente pode operar em qualquer guia escolhida |
| Inspecionar/agir em Android | `cv_android_inspect`, `cv_android_act` | parear com `cv_android_connect` |
| Consultar e editar código | `cv_code_inspect`, `cv_code_edit`, `cv_code_verify` | use o `action` descrito por `cv_help` |
| Entender o próprio Canivete | `cv_help`, `cv_ctx_status`, `cv_report` | descoberta, consumo de contexto e relato de falha |

As tools especializadas restantes cobrem shell, web search/fetch, Codespaces, mídia, WhatsApp, reports de elementos, skills e processos em segundo plano. Consulte `docs/TOOLS.md` para a lista completa e modos. Operações com efeitos continuam separadas das consultas, e ações destrutivas preservam suas confirmações.

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
`CANIVETE_MCP_HTTP_PORT` (default 19423). Os `cv_report` de TODAS as CLIs caem na MESMA inbox
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

Funciona do terminal do dono OU via `cv_bash` de qualquer CLI (root cai pro tork sozinho; o
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

## Subagentes (`cv_task` — desativado)

Spawn de subagentes **desativado por padrão**: cada spawn é um processo `opencode`
(~700MB) e a caixa não tem RAM. O código está intacto — reative com
`CANIVETE_TASK_ENABLE=1` no ambiente do serviço. Docs históricas da família
`cv_task*` + mailbox + runner/serve foram removidas desta página nessa versão.

## Segurança (doutrina do dono)

- O agente pode atuar nas guias incluídas no pedido. Guias criadas por ele ficam no grupo “Canivete · agente”; guias existentes continuam acessíveis.
- A janela do Chrome alvo ganha foco ao ativar uma guia ou interagir; `focus:false` preserva o foco atual.
- Alto risco (pagamento, senha/2FA, excluir conta, apagar tudo, fechar guias em lote) exige `confirm="<frase do dono>"`.
- Ponte local (`127.0.0.1:19422`) + token (`~/.config/canivete/token.txt`, gerado sozinho, `0600`, no `.gitignore`).
- Kill switch: pause na extensão = acesso zero.

## Variáveis de ambiente

| Var | Default | O quê |
|---|---|---|
| `CANIVETE_CWD` | `process.cwd()` | raiz do projeto (fs/shell) |
| `CANIVETE_TASK_ENABLE` | — | `1` reativa a família `cv_task*` (subagentes; desligado por RAM) |
| `CANIVETE_HOST_GUARD_MS` | `170000` | teto de resposta (antes do timeout do host) |
| `CANIVETE_TOKEN` / `CANIVETE_TOKEN_FILE` | `~/.config/canivete/token.txt` (autogerado) | auth da extensão |
| `CANIVETE_BRIDGE_PORT` | `19422` | ponte da extensão (aliases: `UBROWSER_PORT`, `UB_PORT`) |
| `CANIVETE_UB_TIMEOUT` | `60000` | timeout único da ponte ubrowser (clamp 1s–300s; mensagens mostram o valor real) |
| `CANIVETE_UB_DISPLAY` / `CANIVETE_UB_XAUTH` | — | display/Xauthority fixos pro `status {open:true}` abrir o Chrome (auto: detecta X com WM via wmctrl; console real antes do virtual do CRD) |
| `CANIVETE_UB_CHROME_DIR` | `~/.config/google-chrome` | diretório de perfis do Chrome do dono (valida `profile` e limpa Singleton de crash) |
| `CANIVETE_ISSUES_FILE` | `~/.config/canivete/issues.jsonl` | inbox única de `cv_report` — aponte pro MESMO arquivo em toda instalação/usuário (ex.: `sudo -u tork` vs root) |
| `CANIVETE_CONFIG_DIR` | `~/.config/canivete` | estado da ponte (issues-state, mon-log, tools-off, replays, elemreports) — unificar multi-instalação |
| `CANIVETE_UB_MON_QUIET` | `1` | `0` reativa o wrap de `console.*` da página no mon-hook (captura `ErrorUtils`/pixels; mais ruído no inspector da extensão — default `1` = quiet, Inspector limpo) |
| `CANIVETE_CS_EXEC_TMO` | `120000` | timeout default do `cv_codespace_exec` (clamp 5s–165s; por chamada: `timeoutSec`) |
| `CANIVETE_GH_CONFIG_DIR` | — | perfil gh multi-conta do serviço (ex.: `/etc/canivete/gh`) |
| `CANIVETE_CDP_PORT` | `19322` | Chrome headless (CDP) |
| `CANIVETE_CHROME_BIN` | auto-detect | binário do Chrome |
| `CANIVETE_CHROME_PROFILE` | `/tmp/canivete-chrome-profile` | perfil headless |
| `CANIVETE_MAX_POLLS` | `8` | teto de polls ativos (só com `CANIVETE_TASK_ENABLE=1`) |
| `CANIVETE_BROWSER_TIMEOUT_MS` | `40000` | timeout do Chrome headless (`cv_browser_*`; PDF usa `CANIVETE_BROWSER_PDF_TIMEOUT_MS` ou este, default 60s) |
| `CANIVETE_BROWSER_ALLOW_PRIVATE` | — | `1` libera intranet nos `cv_browser_*` (default bloqueia SSRF) |
| `CANIVETE_CDP_TIMEOUT` | `25000` (WS open `10000`) | timeout CDP/WS do headless |
| `CANIVETE_MAX_BODY` | `2MB` | teto do POST no modo remoto `--http` (excedeu → `body > N bytes`) |
| `CANIVETE_CTX_BUDGET` | `200000` | orçamento de chars da sessão (ver `cv_ctx_status`) |
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
a ponte guarda os clipes e um painel local mostra tudo junto do inbox `cv_report`:

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

Como o agente usa (Chrome do dono, via `cv_owner_act`):

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
- **Extensão offline**: Chrome aberto, janela normal, popup ATIVO, token igual ao arquivo. `cv_owner_inspect {action:"status"}` diagnostica.
- **SW dormente**: popup → Testar conexão; alarms reacordam em ~1min.
- **`chrome://`**: Chrome bloqueia automação nessas páginas (limite dele).

## Layout

```
src/server.mjs          entrada MCP (protocolo + cv_help; dispatch em core/rpc.mjs)
src/remote.mjs          modo --http (mesmo dispatch via core/rpc.mjs)
src/core/cache.mjs      cache TTL único (web + apis; hit/miss + negative-cache)
src/core/retry.mjs      sleep + fetchRetry únicos (web 2x + apis 3x preservados)
src/core/symbols.mjs    extração de símbolos (fs p/ cv_file_read + devengine p/ índice)
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
src/lib/elemreports.mjs reports de elemento (marcação humana: store jsonl + cv_elemreports_*)
src/lib/feedback.mjs    cv_report (inbox jsonl com rotação atômica)
src/lib/gh.mjs          gh (cv_lookup source=github + contas gh p/ Codespace)
src/lib/llm.mjs         slots LLM (fallbacks 2-5, presets)
src/lib/tools-codespace.mjs  cv_codespace_* (ambiente de teste na nuvem gh)
src/lib/risk.mjs        trava anti-destrutiva (compartilhada)
config/models.json      modelos (modo opencode)
extension/              extensão MV3 do Chrome do dono (background.js ponte+cursor trusted, content.js DOM+overlay de marcação, mon-hook.js console+rede, wa-hook.js WhatsApp, popup)
examples/               configs prontas por CLI
docs/                   skill global de referência
test/smoke.mjs          fumaça offline-segura
```
