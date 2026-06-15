#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

MEMBER_PORTAL_CLIENT_ID="${MEMBER_PORTAL_CLIENT_ID:-verus-member-portal}"
MEMBER_PORTAL_CLIENT_SECRET="${MEMBER_PORTAL_CLIENT_SECRET:-verus-member-secret}"
MEMBER_PORTAL_REDIRECT_URI="${MEMBER_PORTAL_REDIRECT_URI:-$MEMBER_PORTAL_URL/callback}"

if docker compose exec -T hydra hydra get oauth2-client "$MEMBER_PORTAL_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then
  docker compose exec -T hydra hydra update oauth2-client "$MEMBER_PORTAL_CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$MEMBER_PORTAL_CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$MEMBER_PORTAL_REDIRECT_URI"
else
  docker compose exec -T hydra hydra create oauth2-client \
    --id "$MEMBER_PORTAL_CLIENT_ID" \
    --endpoint "$HYDRA_ADMIN_URL" \
    --secret "$MEMBER_PORTAL_CLIENT_SECRET" \
    --grant-type authorization_code \
    --grant-type refresh_token \
    --response-type code \
    --scope openid \
    --scope offline \
    --scope verusid \
    --redirect-uri "$MEMBER_PORTAL_REDIRECT_URI"
fi
