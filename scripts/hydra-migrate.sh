#!/usr/bin/env sh
set -eu

docker compose up -d postgres
docker compose run --rm hydra migrate sql up -e --yes
