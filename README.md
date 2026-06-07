# VerusID OAuth Starter

Starter and local reference stack for server-side VerusID OAuth/OIDC login.

The reusable SDK lives in [`@chainvue/verusid-oauth`](https://github.com/chainvue/verusid-oauth). This repo contains the local Hydra/Postgres/consent-node stack, docs, and a copy-ready Express example that consumes the SDK package the same way an application developer will.

## Quickstart

Prerequisites:

- Node.js 20 or newer.
- Docker for the local Hydra/Postgres stack.
- Verus Mobile with a VerusID for wallet approval testing.
- A consent node backed by a Verus full node that can sign for the configured consent-node VerusID.

Clone and enter the starter:

```sh
git clone https://github.com/chainvue/verusid-oauth-starter.git
cd verusid-oauth-starter
```

Install the starter dependency and run the preflight:

```sh
npm install
npm run doctor:local
```

Start the local stack and register the Express example client:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/start-stack.sh
LOCAL_HOST=192.168.0.160 ./scripts/create-verusid-express-login-client.sh
```

Run the Express example:

```sh
cd examples/verusid-express-login
npm install
npm start
```

Open:

```text
http://192.168.0.160:5560/
```

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
- Copy-ready Express login app under `examples/verusid-express-login/`.

Common commands:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/start-stack.sh
LOCAL_HOST=192.168.0.160 ./scripts/status-stack.sh
LOCAL_HOST=192.168.0.160 ./scripts/verify-local-flow.sh
./scripts/stop-stack.sh
```

## License

MIT
