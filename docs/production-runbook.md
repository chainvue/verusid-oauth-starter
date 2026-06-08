# Production Runbook Notes

This starter is still a reference stack, but the consent node exposes a few
production-oriented hooks for deployments that adapt it.

## Request Correlation

Every consent-node response includes `X-Request-Id`. If a trusted proxy sends an
`X-Request-Id` value of 128 characters or fewer, the consent node reuses it;
otherwise it generates one. The same value is included in HTTP access logs as
`request_id=...`.

## Metrics Snapshot

`GET /metrics` returns a no-store JSON snapshot:

```json
{
  "status": "ok",
  "uptimeSeconds": 123,
  "counters": {
    "httpRequests": 10,
    "pendingLoginsCreated": 2,
    "pendingLoginsCompleted": 1,
    "pendingLoginsErrored": 0,
    "pendingLoginsRejected": 0,
    "rateLimitRejections": 0
  }
}
```

Use this endpoint for lightweight smoke checks or as the source for an adapter
to your metrics system. It is intentionally simple and does not replace
Prometheus, OpenTelemetry, or platform-native metrics.

## Pending Login Store

Use `PENDING_LOGIN_STORE=redis` plus `PENDING_LOGIN_REDIS_URL` or `REDIS_URL` for
restart-tolerant or multi-instance deployments. Keep the default `memory` store
for local development and single-instance trials only; production memory mode
requires `ALLOW_MEMORY_PENDING_LOGIN_STORE=1`.

## Health And Local Diagnostics

`GET /health` returns `{ "status": "ok" }` when the process is running. Run
`npm run doctor:local` for local-stack diagnostics; failures against Hydra and
consent-node endpoints are expected before the local stack is started.
