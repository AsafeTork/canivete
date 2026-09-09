# canivete — MCP universal em um arquivo de ideia, vários arquivos de verdade

Toolkit MCP completo (51 tools `n_*`, **zero dependências**, Node 22+) que funciona em **qualquer CLI com suporte a MCP** (opencode, Claude Code, etc.) e em **qualquer projeto**:

- **Filesystem + execução (8):** ler/listar/criar/editar/patch/shell/glob/grep — com truncamento explícito e edição segura.
- **Web sem chave (2+7):** fetch enxuto (`<article>/<main>`) + search em 7 backends públicos + câmbio/CEP/CNPJ/IP/clima/GitHub/npm (com cache TTL).
- **Orquestração (10):** spawn de subagentes em paralelo + mailbox em disco + todos + modelos. Runner plugável.
- **DevEngine (8):** resumo de arquitetura sem varrer, investigação de bug (12→1), impacto de mudança, patch validado por AST, testes afetados, processos em fundo, estado da UI, DAG com rollback.
- **Browsers (11):** Chrome headless próprio via CDP (navegar com JS, snapshot, agir, screenshot, PDF) + **seu Chrome logado** via extensão local (ler, snapshot, agir, print, cursor independente, aba em fundo).
- **Meta (4):** catálogo, pergunta ao humano, skills, plan.

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

Exemplos prontos em `examples/`.

## Runner de subagentes (`n_task`)

- Padrão: `opencode` (fidelidade total: monitora a session via DB).
- Qualquer CLI: `CANIVETE_RUNNER` + `CANIVETE_RUN_TEMPLATE` com `{prompt} {model} {agent} {id}`.

```bash
CANIVETE_RUNNER=claude CANIVETE_RUN_TEMPLATE="claude -p {prompt}" node src/server.mjs
```

Sem o binário do runner, `n_task` devolve erro claro (o resto funciona).

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
