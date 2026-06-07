# Environment Reference

Run `npm run doctor:local` after changing local OAuth settings.

| Variable | Local default | Required in production | Common failure |
| --- | --- | --- | --- |
| `LOCAL_HOST` | `192.168.0.160` | Set to the public app host or omit when explicit URLs are configured. | Phone cannot reach QR/deeplink callback; rerun with `LOCAL_HOST=<lan-ip>`. |
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

## Command-Driven Troubleshooting

Symptom: the phone cannot open the wallet approval page.

Run:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0) npm run doctor:local
```

Expected: `pass LAN host` or a warning with the current placeholder. Fix by rerunning stack/client scripts with the current LAN IP.

Symptom: login redirects to Hydra but callback fails.

Run:

```sh
npm run doctor:local
```

Expected: `pass Hydra client registration`. Fix by running:

```sh
LOCAL_HOST=192.168.0.160 ./scripts/create-verusid-express-login-client.sh
```

Symptom: Verus claims are missing.

Run:

```sh
curl -s http://127.0.0.1:4445/admin/clients/verus-express-login
```

Expected: scope contains `openid offline verusid`. Fix by rerunning the client registration script.

Symptom: wallet approval never completes.

Run:

```sh
curl -s http://192.168.0.160:3000/health
```

Expected: healthy consent node. Fix the Verus full node RPC settings in `.env.local` and confirm the consent node can sign for `VERUS_SERVICE_ID`.
