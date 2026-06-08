import bodyParser from "body-parser"
import cookieParser from "cookie-parser"
import express, { NextFunction, Request, Response } from "express"
import logger from "morgan"
import path from "path"

import { rateLimitMax, rateLimitWindowMs } from "./config"
import consent from "./routes/consent"
import login from "./routes/login"
import logout from "./routes/logout"
import verus from "./routes/verus"

type RateLimitOptions = {
  windowMs: number
  max: number
  maxClients?: number
}

export function createRateLimit(options: RateLimitOptions) {
  const entries = new Map<string, { count: number; resetAt: number }>()
  const maxClients = options.maxClients ?? Math.max(options.max * 10, 1000)

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = req.ip || req.socket.remoteAddress || "unknown"
    pruneExpiredRateLimitEntries(entries, now)

    if (!entries.has(key) && entries.size >= maxClients) {
      res.set("Retry-After", String(Math.ceil(options.windowMs / 1000)))
      res.status(429).json({ error: "Too many clients" })
      return
    }

    const current = entries.get(key)
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + options.windowMs }

    entry.count += 1
    entries.set(key, entry)

    if (entry.count > options.max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)))
      res.status(429).json({ error: "Too many requests" })
      return
    }

    next()
  }
}

function pruneExpiredRateLimitEntries(
  entries: Map<string, { count: number; resetAt: number }>,
  now: number,
) {
  for (const [key, entry] of entries.entries()) {
    if (entry.resetAt <= now) {
      entries.delete(key)
    }
  }
}

export function createApp() {
  const app = express()

  app.set("views", path.join(__dirname, "..", "views"))
  app.set("view engine", "pug")

  app.use(logger("dev"))
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded({ extended: false }))
  app.use(cookieParser())

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" })
  })

  app.get("/", (_req, res) => {
    res.render("index")
  })

  const authRateLimit = createRateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
  })

  app.use("/login", authRateLimit, login)
  app.use("/consent", authRateLimit, consent)
  app.use("/logout", logout)
  app.use("/verus", authRateLimit, verus)

  app.use((_req, _res, next) => {
    next(new Error("Not Found"))
  })

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const status = err.message === "Not Found" ? 404 : 500
    res.status(status)
    res.render("error", {
      message: err.message,
      error: req.app.get("env") === "development" ? err : {},
    })
  })

  return app
}

const app = createApp()

export default app
