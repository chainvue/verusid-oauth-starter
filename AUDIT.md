# Codebase Audit: verusid-oauth-starter

Audit date: 2026-06-08

Scope: end-to-end audit of the starter repository, including Docker/Hydra config, consent-node, callback dashboard, Express example, scripts, tests, docs, and CI. This file records repository-specific findings, commands, results, and remediation roadmap.

## Repository Understanding

- Stack: local OAuth/OIDC reference stack with Docker Compose, Ory Hydra, Postgres, TypeScript Express consent node, Node callback dashboard, and Express relying-party example.
- Package managers: npm at root and example app; pnpm for `consent-node`.
- Runtime entry points:
  - `docker-compose.yml`
  - `consent-node/src/server.ts`
  - `oauth-callback/server.js`
  - `examples/verusid-express-login/src/server.js`
- Test setup:
  - Root `npm test` runs `scripts/test-local.cjs`.
  - Express example uses Node test runner.
  - Consent node uses Vitest, but CI currently does not run it.
- External services: Hydra public/admin APIs, Verus full-node RPC/signing via `verusid-ts-client`, Verus Mobile wallet callback/deeplink flow.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `git -C verusid-oauth-starter status --short --branch` | Pass | Clean, on `main...origin/main` before audit file creation. |
| `rg --files verusid-oauth-starter` | Pass | Mapped repository files. |
| `sed` / `nl` / `find` read-only inspections | Pass | Reviewed source, tests, docs, scripts, Docker config, Hydra config, CI. |
| `test -d` for root/example/consent-node `node_modules` | Exit 1 | Dependencies were not installed in the fresh clone. |
| `npm test` at repo root | Fail expected | Example tests failed due missing `supertest` and `@chainvue/verusid-oauth`; Docker config subcheck passed; doctor failed due missing SDK package. |
| `docker compose config` | Pass | Compose config rendered successfully. |
| `npm audit --package-lock-only` at root | Pass | `found 0 vulnerabilities`. |
| `npm audit --package-lock-only` in example app | Pass | `found 0 vulnerabilities`. |
| `pnpm audit --prod` in `consent-node` | Pass | `No known vulnerabilities found`. |
| `rg -n "secret|password|token|debug|..."` | Pass | Static risk search; found expected local-demo secrets/debug token surfaces and hardening targets. |

## Executive Summary

Overall risk: Medium.

The repository is clear about being a local starter and has useful docs, scripts, and tests for the Express example. The biggest risks are in the consent-node and local stack boundary: consent POST grants are not intersected with Hydra's requested scopes, pending Verus login state is process-local memory, production config validation is weaker than the SDK/example, and the Docker/Hydra config is intentionally local but easy to copy into unsafe environments.

## Prioritized Findings

| Priority | Category | Finding | Evidence | Impact | Effort | Confidence |
|---|---|---|---|---|---|---|
| P1 | Authorization | Consent POST can grant allowed demo scopes that were not requested by Hydra. | `consent-node/src/routes/consent.ts` builds `grantableScope` from submitted form scopes only. | High | S | High |
| P1 | Reliability | Pending Verus login state is in-memory only. | `consent-node/src/verusLogin.ts` module-level `pending` map. | High | M | High |
| P1 | Production Safety | Local Hydra admin/dev stack is exposed on host ports with static local secrets. | `docker-compose.yml`, `hydra.yml`. | High | M | High |
| P2 | Reliability | Consent-node lacks production config validation and explicit Verus RPC timeout policy. | `consent-node/src/config.ts`, `consent-node/src/verusLogin.ts`. | Medium | M | High |
| P2 | Security/DX | Callback dashboard is intentionally unsafe but copyable: raw tokens, no PKCE, non-secure cookies. | `oauth-callback/server.js`. | Medium | M | High |
| P2 | CI/Test Coverage | CI does not install, typecheck, or test `consent-node`. | `.github/workflows/ci.yml`. | Medium | S | High |
| P2 | Supply Chain | Consent-node uses GitHub dependencies and alpha Hydra client. | `consent-node/package.json`. | Medium | M | High |
| P3 | Developer Experience | No lint/format scripts. | Root and package `package.json` files. | Low | S | High |

## Detailed Findings

### Intersect Consent Grants With Requested Scopes

- Category: Authorization
- Priority: P1
- Impact: High
- Effort: S
- Confidence: High
- Evidence: `consent-node/src/routes/consent.ts` accepts POSTed `grant_scope`, filters only against `GRANTABLE_SCOPES`, then passes it to Hydra. It does not intersect the submitted scopes with `consentRequest.requested_scope`.
- Why it matters: A crafted consent form can request `offline` or `verusid` even if the current OAuth request did not ask for those scopes. The allowlist prevents arbitrary scopes, but not unrequested allowed scopes.
- Recommended fix: On POST, fetch the consent request first and compute `submittedScopes intersect requestedScopes intersect GRANTABLE_SCOPES`.
- Suggested tests: If Hydra requested only `["openid"]` and the submitted form includes `["openid", "offline", "verusid"]`, accepted grant scope must be `["openid"]`.
- Risks / migration notes: This may change behavior for malformed/local manual forms; correct OAuth behavior should win.

### Replace In-Memory Pending Login State For Production

- Category: Reliability/Architecture
- Priority: P1
- Impact: High
- Effort: M
- Confidence: High
- Evidence: `consent-node/src/verusLogin.ts` stores pending sessions in `const pending = new Map()`. Wallet callbacks find sessions by scanning that map. Expiry cleanup happens only during create/get/complete calls.
- Why it matters: Restart, multiple consent-node instances, or memory pressure can lose active wallet approvals. A multi-instance deployment cannot route callbacks reliably.
- Recommended fix: Introduce a `PendingLoginStore` abstraction with a local memory implementation and Redis/Postgres-backed implementation for production. Store by both pending ID and Verus challenge ID. Add max pending count and periodic cleanup for the memory store.
- Suggested tests: Expiry behavior, lookup by challenge, replay of completed callback, callback after store rehydrate, and concurrent callback handling.
- Risks / migration notes: Store serialization must avoid keeping large non-serializable request objects unless they can be reconstructed or safely serialized.

### Harden Local Stack Boundaries

- Category: Production Readiness/Security
- Priority: P1
- Impact: High
- Effort: M
- Confidence: High
- Evidence: `docker-compose.yml` runs Hydra with `serve all --dev`, exposes `4444` and `4445`, and configures local static secrets. `hydra.yml` includes `local-development-system-secret-change-me` and `local-development-pairwise-salt-change-me`.
- Why it matters: This is fine as a local demo, but unsafe if copied into an internet-facing deployment or a shared environment.
- Recommended fix: Split local config from any production template. Bind Hydra admin to private network only. Require secrets from environment or secret manager. Add a production-mode guard that refuses `--dev`, HTTP issuer, public admin, and default secrets.
- Suggested tests: Config validation rejects local defaults in production mode and passes with non-default secrets/private admin URL.
- Risks / migration notes: Keep the current local quickstart simple by naming files clearly, for example `docker-compose.local.yml`.

### Add Consent-Node Production Config Validation And RPC Timeouts

- Category: Reliability/Security
- Priority: P2
- Impact: Medium
- Effort: M
- Confidence: High
- Evidence: `consent-node/src/config.ts` defaults Hydra admin, base URL, service ID, RPC host, and chain without a production guard. `verusLogin.ts` calls Verus RPC methods during login creation/completion without explicit timeout handling.
- Why it matters: Misconfiguration can produce unsafe callbacks or hung login flows, and failures are surfaced late in request handlers.
- Recommended fix: Add config parsing/validation at startup. Validate `BASE_URL`, `HYDRA_ADMIN_URL`, `VERUS_SERVICE_ID`, `VERUS_LOGIN_TTL_MS`, RPC credentials, and production HTTP/secret defaults. Wrap RPC calls with timeout/error classification if the Verus client does not provide one.
- Suggested tests: invalid TTL, placeholder base URL, missing production service ID, RPC timeout during `createPendingLogin()`, and RPC timeout during identity lookup after wallet response.
- Risks / migration notes: Do not break local default flow; gate strict checks on `NODE_ENV=production` or explicit `CONSENT_NODE_STRICT_CONFIG=1`.

### Isolate Or Rewrite The Callback Dashboard As Demo-Only

- Category: Security/DX
- Priority: P2
- Impact: Medium
- Effort: M
- Confidence: High
- Evidence: `oauth-callback/server.js` uses state/nonce cookies but no PKCE, displays raw token JSON, includes copy snippets with client secret, and does not set `secure` cookies. The page warns that this is sensitive local-demo output, but the file is copyable.
- Why it matters: Developers may copy the dashboard flow instead of the safer SDK-backed Express example.
- Recommended fix: Either rewrite it to use `@chainvue/verusid-oauth` with PKCE and debug-token gating, or move it under an explicitly named `local-debug-callback` folder with stronger README warnings and no production-looking snippets.
- Suggested tests: callback auth URL includes PKCE; raw tokens are hidden unless debug mode is explicitly enabled; cookies are secure when production mode is set.
- Risks / migration notes: If the dashboard is intentionally educational, keep raw-token display but require a local-only flag.

### Add Consent-Node CI Coverage

- Category: Test Coverage/CI
- Priority: P2
- Impact: Medium
- Effort: S
- Confidence: High
- Evidence: `.github/workflows/ci.yml` installs root and Express example dependencies and tests the example, but does not install or run `consent-node` typecheck/tests.
- Why it matters: The highest-risk code path, the consent node, is not protected by CI.
- Recommended fix: Add pnpm setup, `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test:run` under `consent-node`.
- Suggested tests: Existing Vitest suite should run in CI; add the scope-intersection regression before or with the CI update.
- Risks / migration notes: GitHub dependencies may make CI slower or less deterministic; pin or cache carefully.

### Review Consent-Node Supply Chain

- Category: Dependency/Supply Chain
- Priority: P2
- Impact: Medium
- Effort: M
- Confidence: High
- Evidence: `consent-node/package.json` depends on `@ory/hydra-client-fetch@^2.4.0-alpha.1` and GitHub dependencies `verus-typescript-primitives` and `verusid-ts-client`.
- Why it matters: Alpha and GitHub dependencies can change unexpectedly or be harder to audit, reproduce, and patch.
- Recommended fix: Pin exact commits or published immutable versions; document why each override/patch exists; periodically verify with lockfile diff and audits.
- Suggested tests: CI lockfile integrity check; dependency update smoke test.
- Risks / migration notes: Upstream Verus packages may only be available from GitHub today; exact commit pins are still better than floating refs.

## Architecture Assessment

The starter has three separate concerns in one repo:

- local infrastructure orchestration,
- consent-node identity/auth bridge,
- relying-party examples and debug tools.

That is acceptable for a starter, but production boundaries should be explicit. The consent-node should be treated as the core service and given stronger config validation, storage boundaries, tests, and CI. The callback dashboard should be clearly non-production or be refactored to use the SDK to avoid drift.

## Security Assessment

Confirmed strengths:

- Consent-node verifies Verus login consent request signatures and wallet responses.
- Consent-node compares wallet response request to the pending QR/deeplink request.
- CSRF protection is present on login and consent pages.
- Express example uses server-side sessions, PKCE through the SDK, state/nonce checks, sanitized sessions by default, and production config guard in `src/server.js`.
- Lockfile audits reported no known vulnerabilities.

Confirmed issues:

- Consent POST can grant unrequested allowed scopes.
- Local Docker/Hydra config exposes admin and local secrets.
- Callback dashboard displays raw tokens and lacks PKCE.

Recommended hardening:

- Scope intersection fix.
- Production config guard for consent-node and stack config.
- Durable pending-login store.
- Consent-node CI coverage.

## Performance Assessment

Confirmed bottlenecks were not measured dynamically. Likely bottlenecks:

- Verus RPC calls in login creation/completion can hold HTTP requests without explicit timeout handling.
- Pending login lookup scans all pending sessions by challenge ID.
- Docker services install dependencies at startup, slowing local feedback.

Quick wins:

- Index pending sessions by challenge ID.
- Add RPC timeout wrappers.
- Add optional prebuilt local images or document dependency cache behavior.

## Test Strategy

Highest-value tests:

- Consent POST cannot grant scopes outside `requested_scope`.
- Completed/rejected/error pending sessions are pruned once and cannot be replayed.
- Production config guard rejects local defaults.
- Verus RPC timeout during request creation surfaces a user-safe error.
- Callback dashboard, if retained, requires PKCE and hides tokens unless explicitly local debug.
- CI runs consent-node Vitest and TypeScript checks.

## Master Roadmap

| Order | Task | Why | Impact | Effort | Dependencies |
|---|---|---|---|---|---|
| 1 | Fix consent POST scope intersection. | Prevent scope overgrant. | High | S | None. |
| 2 | Add regression test for unrequested scopes. | Lock the auth behavior. | High | S | Task 1. |
| 3 | Add consent-node CI install/typecheck/tests. | Protect the highest-risk service. | Medium | S | pnpm setup in CI. |
| 4 | Add consent-node production config validation. | Stop unsafe deployment defaults. | High | M | Define strict/local modes. |
| 5 | Split or label local-only Docker/Hydra config. | Reduce copy-paste production risk. | High | M | Task 4. |
| 6 | Add pending-login store abstraction. | Support restart and scale. | High | M | Store choice. |
| 7 | Add Verus RPC timeout/error policy. | Prevent hung login flows. | Medium | M | Client capability review. |
| 8 | Refactor or isolate callback dashboard. | Reduce unsafe copy risk and SDK drift. | Medium | M | Decide dashboard role. |
| 9 | Pin/review GitHub and alpha dependencies. | Improve reproducibility and supply-chain posture. | Medium | M | Upstream packaging decision. |
| 10 | Add lint/format scripts. | Improve maintainability. | Low | S | Tool choice. |

## Concrete Refactor Proposals

- Change consent POST grant computation to:
  - fetch `consentRequest`,
  - normalize submitted scopes,
  - compute requested scopes from `consentRequest.requested_scope`,
  - grant only scopes present in both sets and `GRANTABLE_SCOPES`.
- Extract pending login persistence behind:
  - `createPendingLogin(session)`,
  - `getPendingLoginById(id)`,
  - `getPendingLoginByChallenge(challengeId)`,
  - `completeAndRemove(id)`,
  - `cleanupExpired()`.
- Add `loadConsentNodeConfig(env)` that returns typed config plus warnings/errors; call it before starting the server.

## Open Questions

- Is this starter intended to have a supported production deployment path, or should it remain explicitly local-only?
- Which durable store should back pending Verus login state in production: Redis, Postgres, or another existing service?
- Should the callback dashboard remain as an educational raw-token viewer, or should all examples route through the SDK?
