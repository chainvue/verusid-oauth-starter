#!/usr/bin/env sh
set -eu

. "$(dirname "$0")/local-stack-env.sh"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

pass() {
  printf 'ok - %s\n' "$1"
}

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

diagnostic_hint() {
  printf 'hint - rerun ./scripts/create-client.sh, inspect docker compose ps, or restart with ./scripts/start-stack.sh\n' >&2
}

fetch() {
  url="$1"
  outfile="$2"
  statusfile="$3"
  if ! curl -sS -o "$outfile" -w '%{http_code}' "$url" >"$statusfile"; then
    fail "Unable to connect to $url"
  fi
}

assert_status() {
  actual="$(cat "$1")"
  expected="$2"
  label="$3"
  [ "$actual" = "$expected" ] || fail "$label returned HTTP $actual, expected $expected"
  pass "$label"
}

assert_contains() {
  file="$1"
  needle="$2"
  label="$3"
  grep -F "$needle" "$file" >/dev/null || fail "$label did not contain: $needle"
  pass "$label"
}

body="$tmpdir/body"
status="$tmpdir/status"

fetch "$HYDRA_PUBLIC_URL/.well-known/openid-configuration" "$body" "$status"
assert_status "$status" "200" "Hydra discovery endpoint"
assert_contains "$body" "$HYDRA_PUBLIC_URL/oauth2/auth" "Hydra discovery authorization endpoint"

fetch "$CONSENT_NODE_URL/health" "$body" "$status"
assert_status "$status" "200" "consent-node /health"
assert_contains "$body" '"status":"ok"' "consent-node health body"

fetch "$CALLBACK_URL/" "$body" "$status"
assert_status "$status" "200" "OAuth callback home page"
assert_contains "$body" "Sign in to the local VerusID demo" "OAuth callback home content"

fetch "$EXPRESS_LOGIN_URL/" "$body" "$status"
assert_status "$status" "200" "VerusID Express Login home page"
assert_contains "$body" "VerusID Express Login" "VerusID Express Login home content"

if ! docker compose ps >/dev/null 2>"$tmpdir/docker.err"; then
  cat "$tmpdir/docker.err" >&2
  diagnostic_hint
  fail "Docker Compose is unavailable or the local stack cannot be inspected"
fi

if ! docker compose exec -T hydra hydra get oauth2-client "$CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >"$body" 2>"$tmpdir/client.err"; then
  cat "$tmpdir/client.err" >&2
  diagnostic_hint
  fail "Hydra client $CLIENT_ID is not registered"
fi
assert_contains "$body" "$CLIENT_ID" "Hydra client id"
assert_contains "$body" "$REDIRECT_URI" "Hydra client redirect URI"
assert_contains "$body" "authorization_code" "Hydra client authorization_code grant"
assert_contains "$body" "refresh_token" "Hydra client refresh_token grant"
assert_contains "$body" "code" "Hydra client code response type"
for scope in $SCOPES; do
  assert_contains "$body" "$scope" "Hydra client scope $scope"
done

EXPRESS_LOGIN_CLIENT_ID="${EXPRESS_LOGIN_CLIENT_ID:-verus-express-login}"
EXPRESS_LOGIN_REDIRECT_URI="${EXPRESS_LOGIN_REDIRECT_URI:-$EXPRESS_LOGIN_URL/callback}"
if ! docker compose exec -T hydra hydra get oauth2-client "$EXPRESS_LOGIN_CLIENT_ID" --endpoint "$HYDRA_ADMIN_URL" >"$body" 2>"$tmpdir/express-client.err"; then
  cat "$tmpdir/express-client.err" >&2
  diagnostic_hint
  fail "Hydra client $EXPRESS_LOGIN_CLIENT_ID is not registered"
fi
assert_contains "$body" "$EXPRESS_LOGIN_CLIENT_ID" "VerusID Express Login client id"
assert_contains "$body" "$EXPRESS_LOGIN_REDIRECT_URI" "VerusID Express Login redirect URI"
assert_contains "$body" "authorization_code" "VerusID Express Login authorization_code grant"
assert_contains "$body" "refresh_token" "VerusID Express Login refresh_token grant"
for scope in $SCOPES; do
  assert_contains "$body" "$scope" "VerusID Express Login scope $scope"
done

fetch "$CALLBACK_URL/callback?code=fake-code&state=returned-state" "$body" "$status"
assert_status "$status" "400" "callback missing state cookie"
assert_contains "$body" "Missing saved state cookie" "callback missing state message"

curl -sS -o "$body" -w '%{http_code}' \
  -H 'Cookie: verus_oauth_state=saved-state' \
  "$CALLBACK_URL/callback?code=fake-code&state=tampered-state" >"$status"
assert_status "$status" "400" "callback tampered state"
assert_contains "$body" "Returned state does not match saved state" "callback tampered state message"

curl -sS -o "$body" -w '%{http_code}' \
  -H 'Cookie: verus_oauth_state=valid-state' \
  "$CALLBACK_URL/callback?code=fake-code&state=valid-state" >"$status"
assert_status "$status" "400" "callback fake code with valid state"
assert_contains "$body" "Token Exchange Failed" "callback fake code token failure"
assert_contains "$body" "invalid_grant" "callback fake code invalid_grant"

cat <<EOF

Local flow checks passed.

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
