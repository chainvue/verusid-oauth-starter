# VerusID OAuth Starter

Starter and local reference stack for server-side VerusID OAuth/OIDC login.

The reusable SDK lives in [`@chainvue/verusid-oauth`](https://github.com/chainvue/verusid-oauth). This repo contains the local Hydra/Postgres/consent-node stack, docs, and a copy-ready Express example that consumes the SDK package the same way an application developer will.

## Quickstart

Prerequisites:

- Node.js 20 or newer.
- Docker for the local Hydra/Postgres stack.
- A LAN host IP that both your browser and phone can reach.
- Verus Mobile with a VerusID for wallet approval testing.
- Consent-node health, Verus full-node RPC access, and consent-node signing for the configured `VERUS_SERVICE_ID`.

Automated checks can verify the local OAuth stack without approving a wallet prompt. A complete end-to-end login requires Verus Mobile approval from a phone that can reach this laptop on the LAN.

Clone and enter the starter:

```sh
git clone https://github.com/chainvue/verusid-oauth-starter.git
cd verusid-oauth-starter
```

Discover your LAN host and install dependencies:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
npm ci
cp .env.example .env.local
```

Start the local stack and register the Express example client with the same LAN host:

```sh
LOCAL_HOST=$LOCAL_HOST ./scripts/start-stack.sh
LOCAL_HOST=$LOCAL_HOST ./scripts/create-verusid-express-login-client.sh
```

The Docker stack includes a packaged copy of the Express example on port `5560`. Stop only that service before running the cloned example locally on the same port:

```sh
docker compose stop verusid-express-login
cd examples/verusid-express-login
npm ci
LOCAL_HOST=$LOCAL_HOST npm start
```

In another terminal from the repo root, run the preflight after the stack and client are ready:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST npm run doctor:local
```

Open:

```text
http://$LOCAL_HOST:5560/
```

If your phone cannot open the QR/deeplink target, re-check `LOCAL_HOST` and confirm the phone is on a network that can reach the browser host.

## SDK Install

Use the SDK in your own server-side Node app:

```sh
npm install @chainvue/verusid-oauth
```

```js
import {
  createConfig,
  createVerusOAuthClient,
} from "@chainvue/verusid-oauth"

const config = createConfig(process.env)
const verusOAuth = createVerusOAuthClient(config)
```

See [docs/copy-into-express.md](docs/copy-into-express.md), [docs/integration-guide.md](docs/integration-guide.md), and [docs/env-reference.md](docs/env-reference.md).

## Local Stack

The stack includes:

- Ory Hydra public/admin endpoints.
- Postgres persistence for Hydra.
- Editable TypeScript/Express consent node under `consent-node/`.
- Callback dashboard under `oauth-callback/`.
- Copy-ready Express login app under `examples/verusid-express-login/`, using `express-session` with an HTTP-only, lax same-site cookie.

The Express example stores OAuth `state`, `nonce`, and PKCE `codeVerifier` in
the server-side session during `/login`; `/callback` passes the saved verifier
to the SDK. Missing verifiers are rejected before token exchange.

Common commands:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST ./scripts/start-stack.sh
LOCAL_HOST=$LOCAL_HOST ./scripts/status-stack.sh
LOCAL_HOST=$LOCAL_HOST ./scripts/verify-local-flow.sh
./scripts/stop-stack.sh
```

## License

MIT
