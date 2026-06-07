# Local Verus OAuth Verification Checklist

This checklist records the local-dev milestone verified on 2026-06-07 with `LOCAL_HOST=192.168.0.160`.

## Preconditions

- `.env.local` contains working Verus testnet RPC settings for the consent node.
- The configured Verus RPC daemon can sign for `VERUS_SERVICE_ID` through `signdata`.
- Verus Mobile testnet is installed.
- A VerusID and z-address are available in Verus Mobile for approval testing.
- The laptop and phone can reach `http://192.168.0.160` on the local network.

## Start And Automated Verification

Start the local stack:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/start-stack.sh
```

Register or refresh the local Hydra client. Run this twice when checking idempotency:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/create-client.sh
LOCAL_HOST=192.168.0.160 ./scripts/create-client.sh
```

Run the local OAuth stack checks:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/status-stack.sh
LOCAL_HOST=192.168.0.160 ./scripts/verify-local-flow.sh
```

Run consent-node tests and type checks:

```sh
cd consent-node
pnpm test:run
pnpm typecheck
```

## Laptop QR Flow

1. Open `http://192.168.0.160:5555/` on the laptop.
2. Click **Login with VerusID**.
3. Scan the displayed QR code with Verus Mobile.
4. Approve the request in Verus Mobile.
5. Confirm the laptop browser returns to `/callback`.

Acceptance criteria:

- The callback state matches the saved browser state.
- The callback page reports HTTP `200 OK`.
- The token exchange result includes an access token.
- The token exchange result includes an ID token.
- The token exchange result includes a refresh token.
- The access token and ID token sessions include the minimal Verus claims: `verus_id`, `verus_id_name` when resolved, `verus_chain`, `verus_auth_method`, and `verus_login_at`.
- The granted scopes include `openid`, `offline`, and `verusid`.
- Optional starter check: open `http://192.168.0.160:5560/` and confirm the VerusID Express Login app can complete the same wallet approval with client ID `verus-express-login`.

## Phone Same-Device Flow

1. Open `http://192.168.0.160:5555/` on the phone.
2. Click **Login with VerusID**.
3. Tap **Open Wallet**.
4. Approve the request in Verus Mobile.
5. Confirm the phone browser returns to `/callback`.

Acceptance criteria:

- The callback state matches the saved browser state.
- The callback page reports HTTP `200 OK`.
- The token exchange result includes an access token.
- The token exchange result includes an ID token.
- The token exchange result includes a refresh token.
- The access token and ID token sessions include the minimal Verus claims: `verus_id`, `verus_id_name` when resolved, `verus_chain`, `verus_auth_method`, and `verus_login_at`.
- The granted scopes include `openid`, `offline`, and `verusid`.

## Manual Smoke Test Record

Passed on 2026-06-07 with the local wallet flow:

- Callback returned HTTP `200 OK`.
- Token response included a refresh token.
- Granted scope was `openid offline verusid`.
- ID token claims and access token introspection contained matching Verus claims: `verus_id`, `verus_id_name`, `verus_chain`, `verus_auth_method`, and `verus_login_at`.

If token output from the manual run was shared outside the local test environment, reset the local Hydra state or otherwise invalidate the issued refresh token before continuing.

## Troubleshooting

- LAN host changed: rerun commands with `LOCAL_HOST=<current-ip>`, then rerun `./scripts/start-stack.sh` or `./scripts/create-client.sh` so Hydra redirects match the browser host.
- Hydra client mismatch: rerun `LOCAL_HOST=<current-ip> ./scripts/create-client.sh` and confirm the redirect URI is `http://<current-ip>:5555/callback`.
- Hydra admin URL failures: use `HYDRA_ADMIN_URL=http://127.0.0.1:4445` from the host and `HYDRA_ADMIN_URL=http://hydra:4445` inside Docker Compose services.
- Verus RPC signing failures: confirm `.env.local` has working `VERUS_RPC_*` credentials and that the daemon can sign for `VERUS_SERVICE_ID` through `signdata`.
- Wallet callback expired: restart the login from the callback app; pending Verus login requests expire after `VERUS_LOGIN_TTL_MS`.
- Stack status: run `LOCAL_HOST=192.168.0.160 ./scripts/status-stack.sh`.
- Wallet QR or deeplink transient Verus API failures: retry the login request.
- Docker service state: inspect with `docker compose ps` and the relevant service logs.
- Preserve local state while stopping services: run `./scripts/stop-stack.sh`.
- Clean local Docker state: run `./scripts/reset-stack.sh`, then rerun `LOCAL_HOST=192.168.0.160 ./scripts/start-stack.sh`.

`reset-stack.sh` is destructive for this Compose project. It removes the Hydra/Postgres local state volume and the consent-node `node_modules` volume, so Hydra migrations, dependency installation, and local client registration run again on the next start.
