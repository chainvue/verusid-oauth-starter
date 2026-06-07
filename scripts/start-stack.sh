#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

wait_for_command() {
  label="$1"
  log_service="$2"
  shift
  shift

  printf 'Waiting for %s' "$label"
  tries=0
  while [ "$tries" -lt 60 ]; do
    if "$@" >/dev/null 2>&1; then
      printf '\n'
      return 0
    fi
    printf '.'
    tries=$((tries + 1))
    sleep 2
  done

  printf '\nTimed out waiting for %s\n' "$label" >&2
  printf 'Run ./scripts/status-stack.sh for current status.\n' >&2
  if [ -n "$log_service" ]; then
    printf 'Inspect logs with: docker compose logs %s\n' "$log_service" >&2
  fi
  return 1
}

wait_for_url() {
  label="$1"
  url="$2"
  log_service="$3"
  wait_for_command "$label" "$log_service" curl -fsS "$url"
}

docker compose up -d postgres
wait_for_command "Postgres readiness" "postgres" docker compose exec -T postgres pg_isready -U hydra -d hydra

docker compose run --rm hydra migrate sql up -e --yes
docker compose up -d hydra consent-node oauth-callback verusid-express-login

wait_for_url "Hydra discovery" "$HYDRA_PUBLIC_URL/.well-known/openid-configuration" "hydra"
./scripts/create-client.sh
./scripts/create-verusid-express-login-client.sh
wait_for_url "consent-node /health" "$CONSENT_NODE_URL/health" "consent-node"
wait_for_url "OAuth callback home" "$CALLBACK_URL/" "oauth-callback"
wait_for_url "VerusID Express Login home" "$EXPRESS_LOGIN_URL/" "verusid-express-login"

cat <<EOF

Local Verus OAuth stack is ready.

Service URLs:
  Hydra public:         $HYDRA_PUBLIC_URL
  Hydra admin:          $HYDRA_ADMIN_URL
  Consent node:         $CONSENT_NODE_URL
  OAuth callback home:  $CALLBACK_URL/
  OAuth redirect URI:   $REDIRECT_URI
  Express login home:   $EXPRESS_LOGIN_URL/

Automated verification:
  ./scripts/verify-local-flow.sh

Manual wallet checklist:
  QR flow:
    1. Open $CALLBACK_URL/ on the laptop.
    2. Click "Login with VerusID".
    3. Scan the QR code with Verus Mobile.
    4. Approve the request.
    5. Confirm /callback displays the VerusID result and exact granted scope.

  Same-device flow:
    1. Open $CALLBACK_URL/ on the phone.
    2. Click "Login with VerusID".
    3. Tap "Open Wallet".
    4. Approve the request in Verus Mobile.
    5. Confirm /callback displays the VerusID result and exact granted scope.
EOF
