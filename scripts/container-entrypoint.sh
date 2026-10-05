#!/bin/sh
set -eu
umask 077

# A missing mount must not silently create a database on Fly's ephemeral root.
if ! mountpoint -q /data; then
  echo 'Distributor requires a persistent volume mounted at /data.' >&2
  exit 1
fi

# Fly mounts a new volume as root. Change only its root directory, then drop
# privilege before application code or an operator command runs.
if [ "$(id -u)" = 0 ]; then
  chown node:node /data
  chmod 700 /data
  exec gosu node "$@"
fi
exec "$@"
