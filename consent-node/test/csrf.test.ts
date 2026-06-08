import cookieParser from "cookie-parser"
import express, { Request, Response } from "express"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"

type CsrfRequest = Request & {
  csrfToken: () => string
}

describe("csrfProtection", () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    vi.resetModules()
  })

  it("marks CSRF cookies secure in production", async () => {
    process.env.NODE_ENV = "production"
    vi.resetModules()
    const { csrfProtection } = await import("../src/routes/csrf")
    const app = express()
    app.use(cookieParser())
    app.get("/", csrfProtection, (req: CsrfRequest, res: Response) => {
      res.status(200).json({ token: req.csrfToken() })
    })

    const response = await request(app).get("/").expect(200)

    expect(response.headers["set-cookie"].join("; ")).toContain("Secure")
  })

  it("keeps CSRF cookies usable over local HTTP outside production", async () => {
    process.env.NODE_ENV = "development"
    vi.resetModules()
    const { csrfProtection } = await import("../src/routes/csrf")
    const app = express()
    app.use(cookieParser())
    app.get("/", csrfProtection, (req: CsrfRequest, res: Response) => {
      res.status(200).json({ token: req.csrfToken() })
    })

    const response = await request(app).get("/").expect(200)

    expect(response.headers["set-cookie"].join("; ")).not.toContain("Secure")
  })
})
