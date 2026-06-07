# VerusID Express Login

Copy-ready Express example for adding VerusID OAuth/OIDC login to a server-side Node app.

This example is intentionally smaller than the main callback dashboard. It shows the integration code developers should copy:

- Start OAuth login with `state`, `nonce`, and `scope=openid offline verusid`.
- Exchange the authorization code server-side.
- Verify the ID token with Hydra discovery and JWKS.
- Check issuer, audience, nonce, expiry, and `at_hash` when present.
- Introspect the access token for the local demo.
- Store a sanitized app session with the VerusID subject and claims.

## License

MIT License. Copyright (c) 2026 Robert Lech.

## Run With The Local Stack

From the repo root:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/start-stack.sh
LOCAL_HOST=192.168.0.160 ./scripts/create-verusid-express-login-client.sh
npm run doctor:local
```

Then open:

```text
http://192.168.0.160:5560/
```

The stack registers this example as a separate Hydra client:

- Client ID: `verus-express-login`
- Client secret: `verus-express-secret`
- Redirect URI: `http://192.168.0.160:5560/callback`
- Scope: `openid offline verusid`

## Run Standalone

Install dependencies inside this example if you copy it elsewhere:

```sh
npm install
npm start
```

In this repo, tests build and consume the local SDK package:

```sh
npm test
```

## Environment

- `LOCAL_HOST`, default `192.168.0.160`
- `PORT`, default `5560`
- `HYDRA_PUBLIC_URL`, default `http://$LOCAL_HOST:4444`
- `HYDRA_ADMIN_URL`, default `http://127.0.0.1:4445`
- `CLIENT_ID`, default `verus-express-login`
- `CLIENT_SECRET`, default `verus-express-secret`
- `REDIRECT_URI`, default `http://$LOCAL_HOST:5560/callback`
- `SCOPES`, default `openid offline verusid`
- `SESSION_SECRET`, local fallback only; set a strong value outside local development
- `SHOW_DEBUG_TOKENS=1`, local-only raw token display

## Copy Targets

- `src/verus-routes.js`: minimal OAuth routes to copy into another Express app.
- `src/app.js`: UI rendering and app-session handling.
- `src/server.js`: local server entrypoint.

Keep raw OAuth tokens on the server. The default `/me` response intentionally excludes access, ID, and refresh tokens.
