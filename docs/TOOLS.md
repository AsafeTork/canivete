# TOOLS — catálogo MCP público do Canivete

> GERADO AUTOMATICAMENTE por `node scripts/gen-catalog.mjs` — NÃO EDITE MANUALMENTE.
> Fonte: `tools/list` construído pelo registro real do servidor (`node src/server.mjs --catalog`). Executores antigos podem continuar como aliases ocultos para compatibilidade.
> Total: 36 tools ativas; 40 com a família opcional de tarefas habilitada. Gerado em 2026-11-23.

| nome | grupo | descrição | modos/parâmetros |
|---|---|---|---|
| `cv_android_act` | Android | Age no Android conectado: toque, texto, teclas e operações de app. | serial, action, x, y, x2, y2, ms, text, key, pkg, local, remote |
| `cv_android_connect` | Android | Pareia/conecta ADB e salva o perfil Wi-Fi do Android. | ip, port, pairPort, code |
| `cv_android_inspect` | Android | Consulta o Android conectado: estado, hierarquia da tela ou captura. Escolha action. Para parear use cv_android_connect; para tocar ou digitar use cv_android_act. | action, serial, max, fields |
| `cv_audio_analyze` | Mídia local | Analisa áudio LOCAL p/ montagem de vídeo (ffprobe+ffmpeg no disco — NADA sai da máquina): duração, codec/canais, loudness LUFS (ebur128) e mapa de silêncios = pontos de corte naturais. | path, silenceDb, minSilence |
| `cv_bash` | Arquivos e comandos | Executa shell (bash -lc) no repo root: git, npm, node, curl. | command, cwd, workdir, env, retries, timeout, maxOutput |
| `cv_browser_act` | Browser headless | Interage via CDP: goto/back/forward/reload/click/fill/press/scroll/wait/wait_selector/evaluate. | action, url, selector, text, ref, key, js, ms, direction, submit, waitMs, console |
| `cv_browser_capture` | Browser headless | Captura a página headless como imagem/PDF ou mede contraste. Escolha action; screencast com sequência de ações continua em cv_browser_screencast. | action, url, width, height, fullPage, selector, scale, output, points |
| `cv_browser_read` | Browser headless | Abre uma página no Chrome headless e lê seu conteúdo. detail=summary retorna texto e links; detail=full extrai tabelas, formulários, listas e metadados. Use snapshot para achar controles e cv_browser_act para agir. | detail, url, waitMs, cookies, selector, maxChars, maxTables, maxLinks, maxImages, maxForms |
| `cv_browser_screencast` | Browser headless | Grava a página headless DURANTE uma interação (Page.startScreencast + ações input-trusted): frames com timestamps reais → WebM/MP4 via ffmpeg (sem ffmpeg = só frames) + meta.json. | url, width, height, scale, format, actions |
| `cv_browser_snapshot` | Browser headless | Lista elementos interativos da página (ref, tag, texto, selector) para usar em cv_browser_act. compact:true retorna só ref\|tag\|texto sem selector (~60% menos tokens). Ex: {compact:true}. | url, max, compact |
| `cv_code_edit` | Desenvolvimento | Altera código. Escolha action=diff para unified diff ou action=semantic para patch AST validado. | action, patch, reverse, check, stat, file_path, dry_run, create_if_missing, edits |
| `cv_code_inspect` | Desenvolvimento | Entende o código do projeto: arquitetura, causa provável ou impacto de uma mudança. Escolha action. | action, depth, focus_module, symptom, stack_trace, max_depth, include, exclude_dirs, context_lines, symbol_id, file_path, top, direction |
| `cv_code_verify` | Desenvolvimento | Verifica o projeto ou uma UI. Escolha action=tests para executar testes direcionados ou action=ui para inspecionar estado HTTP. | action, scope, target_path, url, viewport, actions, expect, retries |
| `cv_codespace_exec` | Codespaces | Roda comando bash DENTRO do codespace (build, npm test, smoke, git): gh codespace ssh. | name, cmd, timeoutSec, account |
| `cv_codespace_lifecycle` | Codespaces | Cria, para ou apaga um Codespace. Escolha action; para comandos use cv_codespace_exec. | action, repo, branch, machine, idleMin, devcontainerPath, account, name, all |
| `cv_codespace_login` | Codespaces | Gera Agora um LINK de 1 clique p/ logar/adicionar conta gh (scopes incl. | user, scopes, profile, manual |
| `cv_codespace_status` | Codespaces | Consulta contas e Codespaces ou confere o resultado de um login. Escolha action=list ou action=login_status. | action, account, loginId, cancel |
| `cv_ctx_status` | Meta | A LLM manipula o próprio contexto: mostra gasto da sessão (calls, chars, ~tokens por tool) vs orçamento CANIVETE_CTX_BUDGET. Quando usar: antes de dumps grandes; se estourar, prefira destilados/compact/max menores. | sem parâmetros |
| `cv_elemreports_list` | Reports de elemento | Reports persistentes de ELEMENTO de um site (marcações que o dono fez na página viva via extensão, com anotação do que está errado). | base_url, status, area, grupo, q, limit, full |
| `cv_elemreports_resolve` | Reports de elemento | Move UM report de elemento no ciclo de vida com PROVA: "em_resolução" (trabalho iniciado) ou "resolvido" (default; exige proof = antes/depois) — resolvido some do highlight na página (a extensão re-synca sozinha) e vira… | id, status, proof, por |
| `cv_file_read` | Arquivos e comandos | Lê um arquivo, lista uma árvore ou encontra arquivos/trechos. Escolha action; para alterar conteúdo use cv_file_write; para comandos use cv_bash. | action, offset, limit, raw, maxChars, tail, grep, symbols, mode, path, depth, maxLines, sort, pattern, cwd, maxResults, ignore, only_files, include, ignoreCase, context, files_with_matches |
| `cv_file_write` | Arquivos e comandos | Cria ou troca o conteúdo de um arquivo. Escolha action=write para criar/sobrescrever ou action=replace para uma troca textual. Para patch de código use cv_code_edit. | action, content, mkdirs, append, backup, dryRun, owner, path, oldString, newString, replaceAll, regex |
| `cv_help` | Meta | Ajuda do Canivete. Sem query lista capacidades por categoria; com query encontra a tool certa. detail=true mostra parâmetros e schema. | query, limit, detail |
| `cv_lookup` | Web e consultas | Consulta uma fonte pública. Escolha source; os campos necessários mudam conforme a fonte (câmbio, CEP, CNPJ, IP, clima, GitHub ou npm). | source, from, to, amount, invert, cep, cnpj, ip, latitude, longitude, days, alert, owner, repo, kind, limit, user, path, q, scope, account, package |
| `cv_manage_background_process` | Desenvolvimento | DevEngine: start/stop/restart/status/read_logs de servidores sem bloquear. | action, command, process_id, env, cwd, tail |
| `cv_orchestrate_task` | Desenvolvimento | DevEngine: DAG de tarefas com checkpoint/resume/rollback (git stash). Quando usar: multi-step com rollback garantido. Ex: {action:"init", plan:{steps:[...]}}. rollback restaura o stash mais recente. | action, task_id, plan |
| `cv_owner_act` | Chrome logado do dono | Age sem roubar foco: goto {url,snap:true,goal} retorna alvos; click/fill mostram efeito. | action, off, tabId, tab, url, selector, text, profile, ref, name, container, value, timeoutMs, steps, showProgress, progressTitle, progressMessage, mode, message, annotations, key, js, ms, method, params, x, y, click, trusted, hover, hoverMs, force, noEscalate, direction, submit, waitMs, snap, goal, filter, limit, clear, pages, offset, durationMs, intervalMs, urlPrefix, expectUrl, expectText, expectGone, focused, focus, windowId, active |
| `cv_owner_alerts` | Chrome logado do dono | Lê e consome alertas pendentes da sessão Chrome do dono. | since |
| `cv_owner_inspect` | Chrome logado do dono | Chrome logado: overview {tab,goal} acha alvos; read lê texto; snapshot {find} detalha; tabs/status só se necessário. | action, open, profile, wait, filter, max, offset, tabId, tab, maxChars, maxLinks, mode, outline, settle, selector, compact, find, pages, layer, goal, order, detail, headingsMax, scale |
| `cv_report` | Meta | Reporta refinação p/ a ferramenta (inbox global). | kind, where, expected, got, repro, blockedBy, suggestedCapability, dryRun |
| `cv_skill` | Meta | Carrega SKILL.md por nome. refresh:true só lista skills (re-scan p/ recém-criadas). | name, refresh |
| `cv_todo` | Orquestração | Read the in-memory task list. | sem parâmetros |
| `cv_todowrite` | Orquestração | Substitui (replace, padrão) ou mescla (append por content igual) a lista in-memory. Volátil (morre com o processo). | todos, mode |
| `cv_webfetch` | Web e consultas | Baixa URL SEM JS e extrai texto principal + og:price/JSON-LD (tenta <article>/<main>). | url, format, maxChars, timeout, links |
| `cv_websearch` | Web e consultas | Busca web multi-backend (News, DDG, Wikipedia, HN, GitHub, GitHub-novos, Lemmy/fediverso, npm, arXiv; cache 10min, dedupe por URL). | query, numResults, site, since, fresh, page, perPage |
| `cv_whatsapp` | WhatsApp | WhatsApp DEDICADO: via gateway Baileys (WebSocket, sem browser) com fallback p/ Chrome logado. | action, tabId, tab, name, to, phone, text, pages, limit, data-testid |

Os modos usam enums explícitos e campos específicos por operação. Para a descrição completa, use `cv_help {query, detail:true}`.

_Regenerar: `node scripts/gen-catalog.mjs` · Validar: `node --check scripts/gen-catalog.mjs`_
