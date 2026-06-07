#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

EXPRESS_LOGIN_CLIENT_ID="${EXPRESS_LOGIN_CLIENT_ID:-verus-express-login}"
EXPRESS_LOGIN_CLIENT_SECRET="${EXPRESS_LOGIN_CLIENT_SECRET:-verus-express-secret}"
EXPRESS_LOGIN_REDIRECT_URI="${EXPRESS_LOGIN_REDIRECT_URI:-$EXPRESS_LOGIN_URL/callback}"

if docker compose exec -T hydra hydra get oauth2-client "$EXPRESS_LOGIN_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then
  docker compose exec -T hydra hydra update oauth2-client "$EXPRESS_LOGIN_CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$EXPRESS_LOGIN_CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$EXPRESS_LOGIN_REDIRECT_URI"
else
  docker compose exec -T hydra hydra create oauth2-client \
    --id "$EXPRESS_LOGIN_CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$EXPRESS_LOGIN_CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$EXPRESS_LOGIN_REDIRECT_URI"
fi
