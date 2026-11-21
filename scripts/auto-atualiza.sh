#!/usr/bin/env bash
# Atualiza a cópia limpa para origin/main e reinicia quando o commit avança.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '[canivete:auto] %s\n' "$*"; }
skip() { log "$* — mantendo o serviço atual"; exit 0; }

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  skip "cópia de trabalho tem alterações locais"
fi

BRANCH="$(git branch --show-current)"
git fetch --quiet origin main || skip "fetch de origin/main falhou"
REMOTE_MAIN="$(git rev-parse --verify origin/main 2>/dev/null)" || skip "origin/main indisponível"
OLD_COMMIT="$(git rev-parse HEAD)"

# Depois que uma branch de PR mesclada fica ativa, avance para main. Branches
# ainda não mescladas nunca são descartadas nem atualizadas por este serviço.
if [[ "$BRANCH" != "main" ]]; then
  git merge-base --is-ancestor HEAD "$REMOTE_MAIN" || skip "branch $BRANCH ainda não foi mesclada em main"
  if git show-ref --verify --quiet refs/heads/main; then
    git merge-base --is-ancestor main "$REMOTE_MAIN" || skip "branch local main divergiu do remoto"
    git switch --quiet main || skip "não foi possível mudar para main"
  else
    git switch --quiet --create main --track origin/main || skip "não foi possível criar a branch main"
  fi
fi

git merge-base --is-ancestor HEAD "$REMOTE_MAIN" || skip "main local divergiu do remoto"
git merge --ff-only --quiet "$REMOTE_MAIN" || skip "fast-forward para origin/main falhou"
NEW_COMMIT="$(git rev-parse HEAD)"
[[ "$OLD_COMMIT" == "$NEW_COMMIT" ]] && exit 0

log "código novo em origin/main — aguardando chamadas ativas e reiniciando o daemon"
systemctl --user restart canivete
sleep 2
curl -fsS --max-time 5 http://127.0.0.1:19423/health >/dev/null 2>&1 \
  && log "daemon atualizado e saudável" \
  || log "daemon reiniciando; confira systemctl --user status canivete"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/canivete"
mkdir -p "$CONFIG_DIR"
date -Is > "$CONFIG_DIR/last-update"
