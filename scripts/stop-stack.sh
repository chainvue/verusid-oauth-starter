#!/usr/bin/env sh
set -eu

docker compose stop

cat <<EOF

Local stack stopped.
Docker volumes are preserved, including Hydra/Postgres state and consent-node node_modules.
EOF
