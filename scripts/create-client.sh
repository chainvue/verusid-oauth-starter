#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

if docker compose exec -T hydra hydra get oauth2-client "$CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then
  # Hydra's update command replaces the complete client, so keep all local fields here.
  docker compose exec -T hydra hydra update oauth2-client "$CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$REDIRECT_URI"
else
  docker compose exec -T hydra hydra create oauth2-client \
    --id "$CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$REDIRECT_URI"
fi
