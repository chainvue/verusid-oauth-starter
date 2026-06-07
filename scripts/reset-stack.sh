#!/usr/bin/env sh
set -eu

cat <<EOF
Resetting the local Docker Compose stack.
This removes local Hydra/Postgres state and the consent-node node_modules volume.
EOF

docker compose down -v --remove-orphans

cat <<EOF

Local stack reset complete.
Hydra/Postgres local state and the consent-node node_modules volume were removed.
Run ./scripts/start-stack.sh to recreate the stack and register the local Hydra client.
EOF
