# VerusID Express Login

Copy-ready Express example for adding VerusID OAuth/OIDC login to a server-side Node app.

This example is intentionally smaller than the main callback dashboard. It shows the integration code developers should copy:

- Start OAuth login with `state`, `nonce`, and `scope=openid offline verusid`.
- Exchange the authorization code server-side.
- Verify the ID token with Hydra discovery and JWKS.
- Check issuer, audience, nonce, expiry, and `at_hash` when present.
- Introspect the access token for the local demo.
- Store a sanitized app session with the VerusID subject and claims.

## Run With The Local Stack

From the repo root:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST ./scripts/start-stack.sh
LOCAL_HOST=$LOCAL_HOST ./scripts/create-verusid-express-login-client.sh
```

The Docker stack includes a `verusid-express-login` service bound to port `5560`. Stop only that service before running this cloned example locally on the same port:

```sh
docker compose stop verusid-express-login
cd examples/verusid-express-login
npm install
LOCAL_HOST=$LOCAL_HOST npm start
```

In another terminal from the repo root, run the preflight after Hydra and the example client are ready:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST npm run doctor:local
```

Then open:

```text
http://$LOCAL_HOST:5560/
```

The phone running Verus Mobile and the browser must both be able to reach `http://$LOCAL_HOST` on the LAN.

The stack registers this example as a separate Hydra client:

- Client ID: `verus-express-login`
- Client secret: `verus-express-secret`
- Redirect URI: `http://<LAN-IP>:5560/callback`
- Scope: `openid offline verusid`

## Run Standalone

Install dependencies inside this example if you copy it elsewhere:

```sh
cp .env.example .env
npm install
npm start
```

When used inside this repo with the local stack, the app can run from its local defaults. For copied or standalone usage, copy `.env.example` to `.env` and edit the host, Hydra URLs, client credentials, redirect URI, and session secret for your environment.

In this repo, tests build and consume the local SDK package:

```sh
npm test
```

## Environment

- `LOCAL_HOST`, default `192.168.0.160` for local compatibility; set this explicitly to your LAN IP for phone testing.
- `PORT`, default `5560`
- `HYDRA_PUBLIC_URL`, default `http://$LOCAL_HOST:4444`
- `HYDRA_ADMIN_URL`, default `http://127.0.0.1:4445`
- `CLIENT_ID`, default `verus-express-login`
- `CLIENT_SECRET`, default `verus-express-secret`
- `REDIRECT_URI`, default `http://$LOCAL_HOST:5560/callback`
- `SCOPES`, default `openid offline verusid`
- `SESSION_SECRET`, local fallback only; set a strong value outside local development
- `SHOW_DEBUG_TOKENS=1`, local-only raw token display

## Wallet Prerequisites

Automated checks can pass without wallet approval. A full end-to-end approval requires Verus Mobile, a phone that can reach the LAN host, a healthy consent node, Verus full-node RPC access, and consent-node signing for the configured `VERUS_SERVICE_ID`.

## Copy Targets

- `src/verus-routes.js`: minimal OAuth routes to copy into another Express app.
- `src/app.js`: UI rendering and app-session handling.
- `src/server.js`: local server entrypoint.

Keep raw OAuth tokens on the server. The default `/me` response intentionally excludes access, ID, and refresh tokens.

The local default uses private Hydra admin introspection. Keep `HYDRA_ADMIN_URL`
reachable only by trusted backend services. For production copies that should
verify access tokens through a different private service, configure the SDK
`accessTokenVerifier` hook instead of exposing Hydra admin.

## License

MIT License. Copyright (c) 2026 Robert Lech.
