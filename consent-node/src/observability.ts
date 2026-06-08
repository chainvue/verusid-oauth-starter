import crypto from "crypto"

import { NextFunction, Request, Response } from "express"

const startedAt = Date.now()

const counters = {
  httpRequests: 0,
  pendingLoginsCreated: 0,
  pendingLoginsCompleted: 0,
  pendingLoginsErrored: 0,
  pendingLoginsRejected: 0,
  rateLimitRejections: 0,
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = req.header("x-request-id")
  const requestId = incomingRequestId && incomingRequestId.length <= 128
    ? incomingRequestId
    : crypto.randomUUID()

  res.locals.requestId = requestId
  res.set("X-Request-Id", requestId)
  counters.httpRequests += 1
  next()
}

export function recordPendingLoginCreated() {
  counters.pendingLoginsCreated += 1
}

export function recordPendingLoginCompleted() {
  counters.pendingLoginsCompleted += 1
}

export function recordPendingLoginErrored() {
  counters.pendingLoginsErrored += 1
}

export function recordPendingLoginRejected() {
  counters.pendingLoginsRejected += 1
}

export function recordRateLimitRejected() {
  counters.rateLimitRejections += 1
}

export function snapshotMetrics() {
  return {
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    counters: { ...counters },
  }
}
