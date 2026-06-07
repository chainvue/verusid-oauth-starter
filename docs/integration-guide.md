# VerusID OAuth Integration Guide

This guide describes the local relying-party pattern shown by `oauth-callback/server.js`. It is a developer demo for integrating VerusID login through Hydra and the editable consent node.

Use `oauth-callback/` when you want the rich proof dashboard. Use `examples/verusid-express-login/` when you want a smaller MIT-licensed Express app to copy into another server-side Node project.

## Requested Scope

Request exactly:

```text
openid offline verusid
```

- `openid` issues an ID token.
- `offline` allows Hydra to issue a refresh token when consent grants it.
- `verusid` grants the minimal Verus-specific claim contract.

The consent node intentionally grants only `openid`, `offline`, and `verusid`. It does not grant `email`, `profile`, or other rich identity scopes.

## Route Sequence

1. Start login from your relying party.
2. Generate random `state` and `nonce` values.
3. Store both values in an HTTP-only browser session or equivalent server-side session.
4. Redirect to Hydra `/oauth2/auth` with `response_type=code`, the registered `client_id`, exact `redirect_uri`, `scope=openid offline verusid`, `state`, and `nonce`.
5. On `/callback`, reject the request unless returned `state` matches the saved value.
6. Exchange the authorization code server-side at Hydra `/oauth2/token`.
7. Verify the ID token through Hydra discovery and JWKS.
8. Introspect the access token through Hydra admin for this local demo.
9. Compare the Verus claims in the ID token with the Verus claims returned by introspection.
10. Create or update the app session for the OAuth subject.

The `@chainvue/verusid-oauth` SDK implements this route sequence for server-side Node.js apps. The `examples/verusid-express-login` app shows how to wire it into Express.

## Expected Claims

The OAuth subject `sub` is the selected VerusID i-address. The `verusid` scope maps only these custom claims:

```json
{
  "verus_id": "Wallet signing i-address",
  "verus_id_name": "Optional resolved VerusID name",
  "verus_chain": "VRSCTEST",
  "verus_auth_method": "verus_login_consent",
  "verus_login_at": "Unix timestamp in seconds"
}
```

No `email`, `email_verified`, `name`, or `preferred_username` claims are part of this demo contract.

## Token Verification

Fetch Hydra discovery from:

```text
http://<LOCAL_HOST>:4444/.well-known/openid-configuration
```

Then fetch the `jwks_uri` from discovery and verify the ID token:

- Signature matches a Hydra JWKS signing key.
- `iss` equals the discovery issuer.
- `aud` contains your client ID.
- `nonce` equals the value saved before redirecting to Hydra.
- `exp` is in the future.
- `at_hash` matches the access token when the claim is present.

The demo callback also introspects the access token through Hydra admin:

```text
POST http://127.0.0.1:4445/admin/oauth2/introspect
```

For this local stack, introspection is useful because it shows the access-token session `ext` claims and proves they match the ID token Verus claims.

## What To Store

Store only what your app needs:

- OAuth subject `sub`.
- `verus_id`, which should match `sub` in this demo.
- Optional `verus_id_name` for display.
- Granted scope, expected to be `openid offline verusid`.
- Refresh token, encrypted and stored server-side according to your confidential-token policy.

Do not put raw access tokens, ID tokens, or refresh tokens into browser-readable storage.

The Express starter's `/me` route returns only sanitized session data by default. Raw token output is available only with `SHOW_DEBUG_TOKENS=1` for local inspection.

## Refresh Tokens

Hydra returns a refresh token when the client supports the refresh-token grant and the consent flow grants `offline`. Treat the refresh token as a server-side credential. Rotate, revoke, and expire it according to the policy of the production OAuth deployment you use.

The callback demo shows the raw refresh token only to make the local flow inspectable.

## Local-Only Caveats

- `hydra.yml` uses local development secrets and `--dev` mode.
- The demo uses HTTP URLs on a LAN host for wallet testing.
- Hydra admin introspection is reachable from the host at `http://127.0.0.1:4445`; do not expose Hydra admin publicly.
- Raw token JSON is intentionally visible in the callback Debug section.
- The Verus Mobile QR/deeplink request can expire; start a new login if approval takes longer than `VERUS_LOGIN_TTL_MS`.
- Replace local secrets, salts, URLs, and token handling before using this pattern outside local development.
