#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

failed=0

pass() {
  printf 'ok - %s\n' "$1"
}

fail_check() {
  printf 'not ok - %s\n' "$1" >&2
  failed=1
}

check_url() {
  label="$1"
  url="$2"
  if curl -fsS "$url" >/dev/null 2>&1; then
    pass "$label"
  else
    fail_check "$label ($url)"
  fi
}

printf 'Docker Compose services:\n'
if ! docker compose ps; then
  fail_check "docker compose ps"
fi

printf '\nEndpoint and client checks:\n'
check_url "Hydra discovery" "$HYDRA_PUBLIC_URL/.well-known/openid-configuration"
check_url "consent-node /health" "$CONSENT_NODE_URL/health"
check_url "OAuth callback home" "$CALLBACK_URL/"
check_url "VerusID Express Login home" "$EXPRESS_LOGIN_URL/"

if docker compose exec -T hydra hydra get oauth2-client "$CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then
  pass "Hydra client $CLIENT_ID registered"
else
  fail_check "Hydra client $CLIENT_ID registered"
fi

EXPRESS_LOGIN_CLIENT_ID="${EXPRESS_LOGIN_CLIENT_ID:-verus-express-login}"
if docker compose exec -T hydra hydra get oauth2-client "$EXPRESS_LOGIN_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >/dev/null 2>&1; then
  pass "Hydra client $EXPRESS_LOGIN_CLIENT_ID registered"
else
  fail_check "Hydra client $EXPRESS_LOGIN_CLIENT_ID registered"
fi

if [ "$failed" -ne 0 ]; then
  cat <<EOF >&2

Diagnostics:
  Refresh the local client: ./scripts/create-client.sh
  Inspect service logs:     docker compose logs <service>
  Restart the stack:        ./scripts/start-stack.sh
EOF
  exit 1
fi

printf '\nLocal stack status checks passed.\n'
