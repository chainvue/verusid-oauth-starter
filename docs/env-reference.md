# Environment Reference

Run `npm run doctor:local` after changing local OAuth settings and after the local stack/client registration are ready. When services are not running yet, network checks are expected to fail.

| Variable | Local default | Required in production | Common failure |
| --- | --- | --- | --- |
| `LOCAL_HOST` | `192.168.0.160` | Set to the public app host or omit when explicit URLs are configured. | Phone cannot reach QR/deeplink callback; rerun stack and client scripts with `LOCAL_HOST=<LAN-IP>`. |
| `PORT` | `5560` | App-specific. | Server starts on an unexpected port. |
| `HYDRA_PUBLIC_URL` | `http://$LOCAL_HOST:4444` | HTTPS issuer URL for your OAuth deployment. | Discovery fails; run `curl -s $HYDRA_PUBLIC_URL/.well-known/openid-configuration`. |
| `HYDRA_ADMIN_URL` | `http://127.0.0.1:4445` | Private admin URL reachable only by trusted backend services. | Access-token introspection fails; never expose this publicly. |
| `CLIENT_ID` | `verus-express-login` | Registered confidential client ID. | Hydra callback returns invalid client or token exchange fails. |
| `CLIENT_SECRET` | `verus-express-secret` | Strong registered client secret from your OAuth deployment. | Token exchange returns `invalid_client`. |
| `REDIRECT_URI` | `http://$LOCAL_HOST:5560/callback` | Exact HTTPS callback URI registered on the client. | Token exchange or authorization redirect fails with redirect URI mismatch. |
| `SCOPES` | `openid offline verusid` | Usually exactly `openid offline verusid`. | Missing Verus claims or refresh token; rerun client registration with this scope. |
| `SESSION_SECRET` | Local fallback only | Long random value from a secret manager. | Sessions can be forged or invalidated unexpectedly. |
| `SHOW_DEBUG_TOKENS` | unset | Keep unset. | `SHOW_DEBUG_TOKENS=1` exposes raw tokens in `/me`; use only locally. |
| `CONSENT_NODE_URL` | `http://$LOCAL_HOST:3000` in doctor | Internal or public consent-node URL depending on deployment. | Doctor warns or fails on `/health`; start consent node and Verus RPC signer. |
| `OAUTH_HTTP_TIMEOUT_MS` | `10000` | App-specific. | Slow network calls abort too early or hang too long. |
| `MAX_PENDING_LOGINS` | `1000` | Set to the maximum in-flight wallet approvals this deployment can hold safely. | Consent node rejects new login requests when the pending store is full. |
| `PENDING_LOGIN_STORE` | `memory` | Use `redis` for restart-tolerant or multi-instance deployments. | Production startup rejects memory mode unless `ALLOW_MEMORY_PENDING_LOGIN_STORE=1` is set. |
| `PENDING_LOGIN_REDIS_URL` / `REDIS_URL` | unset | Required when `PENDING_LOGIN_STORE=redis`. | Production startup fails if Redis mode is selected without a valid Redis URL. |
| `ALLOW_MEMORY_PENDING_LOGIN_STORE` | unset | Set to `1` only for single-instance deployments that accept process-local pending state. | Production consent-node startup fails closed to avoid accidental multi-instance state loss. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Tune per deployment or fronting proxy policy. | Too low can reject legitimate wallet/browser retries; too high weakens abuse controls. |
| `RATE_LIMIT_MAX` | `120` | Tune per deployment or fronting proxy policy. | Repeated `/login`, `/consent`, and `/verus` requests receive `429`. |

The hardcoded local default is retained for compatibility with the verified local setup. For phone testing, explicitly set `LOCAL_HOST` to the current LAN IP and use the same value when starting the stack, registering clients, running doctor, and opening the example app.

Production config validation expects HTTPS `REDIRECT_URI` and `HYDRA_PUBLIC_URL`,
valid URL values, finite positive `PORT` and `OAUTH_HTTP_TIMEOUT_MS`, private
Hydra admin access, non-local secrets, and the default `openid offline verusid`
scope unless your app deliberately owns a different scope contract.

The consent node keeps pending wallet approvals in process memory by default.
That is appropriate for the local stack and single-instance trials, but
production startup requires explicit acknowledgement with
`ALLOW_MEMORY_PENDING_LOGIN_STORE=1`. Use `PENDING_LOGIN_STORE=redis` with
`PENDING_LOGIN_REDIS_URL` or `REDIS_URL` for restart-tolerant or multi-instance
deployments.

The Express example uses `express-session` and stores `state`, `nonce`, and the
PKCE `codeVerifier` server-side during `/login`. `/callback` must pass the saved
verifier to `completeLogin()`; missing verifiers are rejected before token
exchange.

`HYDRA_ADMIN_URL` is a local/private backend endpoint. Do not expose Hydra admin
publicly. Production deployments that verify access tokens through another
trusted backend should configure the SDK `accessTokenVerifier` hook so the app
can receive the active state and Verus claims without publishing Hydra admin.

## Command-Driven Troubleshooting

Symptom: the phone cannot open the wallet approval page.

Run after the stack and client registration have been run with the same LAN IP:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST npm run doctor:local
```

Expected: `pass LAN host` or a warning that `LOCAL_HOST` was not explicitly set for your LAN. Fix by rerunning stack/client scripts with the current LAN IP.

Symptom: login redirects to Hydra but callback fails.

Run after Hydra is started:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST npm run doctor:local
```

Expected: `pass Hydra client registration`. Fix by running:

```sh
LOCAL_HOST=$LOCAL_HOST ./scripts/create-verusid-express-login-client.sh
```

Symptom: Verus claims are missing.

Run:

```sh
curl -s http://127.0.0.1:4445/admin/clients/verus-express-login
```

Expected: scope contains `openid offline verusid`. Fix by rerunning the client registration script.

Symptom: the cloned example cannot bind port `5560`.

Run from the repo root:

```sh
docker compose stop verusid-express-login
```

Expected: only the Docker-hosted Express example stops; Hydra, Postgres, consent-node, and the callback dashboard keep running.

Symptom: wallet approval never completes.

Run with the current LAN IP:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
curl -s http://$LOCAL_HOST:3000/health
```

Expected: healthy consent node. Fix the Verus full-node RPC settings in `.env.local` and confirm the consent node can sign for `VERUS_SERVICE_ID`.

Automated doctor and flow checks can pass without approving a wallet prompt. Complete wallet approval requires Verus Mobile, a LAN-reachable host, consent-node health, Verus full-node RPC access, and consent-node signing for the configured `VERUS_SERVICE_ID`.
