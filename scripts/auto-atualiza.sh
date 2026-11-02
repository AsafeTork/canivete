#!/usr/bin/env bash
# canivete — auto-atualização (timer canivete-updater.timer): pull discreto; reinicia SÓ se mudou.
# Falha de pull (divergência/posse) NUNCA derruba o código em execução — segue no atual.
set -e
cd /home/tork/Projetos/canivete
OLD=$(git rev-parse HEAD)
git pull --ff-only >/dev/null 2>&1 || { echo "[canivete:auto] pull falhou (divergência/posse?) — seguindo no código atual"; exit 0; }
NEW=$(git rev-parse HEAD)
[ "$OLD" = "$NEW" ] && exit 0
echo "[canivete:auto] ${OLD:0:7} → ${NEW:0:7} — reiniciando daemon"
systemctl --user restart canivete
sleep 2
curl -fsS --max-time 5 http://127.0.0.1:19423/health >/dev/null 2>&1 && echo "[canivete:auto] saúde OK" || echo "[canivete:auto] daemon recarregando (confira systemctl --user status canivete)"
date -Is > /home/tork/.config/canivete/last-update
