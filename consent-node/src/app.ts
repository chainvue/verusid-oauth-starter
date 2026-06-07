import bodyParser from "body-parser"
import cookieParser from "cookie-parser"
import express, { NextFunction, Request, Response } from "express"
import logger from "morgan"
import path from "path"

import consent from "./routes/consent"
import login from "./routes/login"
import logout from "./routes/logout"
import verus from "./routes/verus"

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

  app.use("/login", login)
  app.use("/consent", consent)
  app.use("/logout", logout)
  app.use("/verus", verus)

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
