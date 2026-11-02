#!/usr/bin/env bash
# canivete — atualização em 1 comando: bash scripts/atualizar.sh (ou npm run atualizar)
# Pode vir de: terminal do dono (tork), root (cai pro tork) ou n_bash de qualquer CLI
# (roda dentro do daemon — por isso o restart é agendado via systemd-run, fora do cgroup
# do serviço: reiniciar o daemon de dentro dele mataria a própria chamada).
set -e
cd "$(dirname "$0")/.."
if [ "$(id -un)" = "root" ]; then
  exec runuser -u tork -- env HOME=/home/tork XDG_RUNTIME_DIR=/run/user/1000 bash "$0"
fi
echo "── git pull --ff-only:"
git pull --ff-only
echo "── reinício do daemon (agendado p/ daqui 1s, fora do cgroup):"
systemd-run --user --on-active=1 --unit=canivete-restart systemctl --user restart canivete 2>/dev/null \
  || { (sleep 1; systemctl --user restart canivete) & disown; }
sleep 4
curl -fsS --max-time 5 http://127.0.0.1:19423/health && echo " — canivete atualizado ✔" \
  || echo "daemon ainda recarregando — confira: systemctl --user status canivete"
