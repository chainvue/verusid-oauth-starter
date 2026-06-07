import express from "express"
import session from "express-session"

import {
  createConfig,
  toPublicSession,
} from "@chainvue/verusid-oauth"
import { installVerusRoutes, withDebugTokens } from "./verus-routes.js"

export function createApp(options = {}) {
  const config = options.config || createConfig()
  const app = express()

  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())
  app.use(session({
    name: "verusid_login_session",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: options.sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
    },
  }))

  app.get("/", (req, res) => {
    const login = req.session.login
    res.type("html").send(renderHome(login, config))
  })

  installVerusRoutes(app, { config, renderError, client: options.client })

  app.use((error, _req, res, _next) => {
    res.status(500).type("html").send(renderError("Application error", error.message))
  })

  return app
}

export function sanitizeLogin(verifiedSession, config) {
  return config.showDebugTokens ? withDebugTokens(verifiedSession) : toPublicSession(verifiedSession)
}

export function renderHome(login, config) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VerusID Express Login</title>
    ${styles()}
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">Copy-ready Express example</p>
        <h1>VerusID Express Login</h1>
        ${login ? renderSignedIn(login, config) : renderSignedOut(config)}
      </section>
    </main>
  </body>
</html>`
}

function renderSignedOut(config) {
  return `<p>This minimal app shows the server-side VerusID login pattern developers can copy into an Express service.</p>
        <dl>
          <dt>Hydra issuer</dt><dd>${escapeHtml(config.hydraPublicUrl)}</dd>
          <dt>Client ID</dt><dd>${escapeHtml(config.clientId)}</dd>
          <dt>Scope</dt><dd>${escapeHtml(config.scope)}</dd>
          <dt>Redirect URI</dt><dd>${escapeHtml(config.redirectUri)}</dd>
        </dl>
        <a class="button" href="/login">Login with VerusID</a>`
}

function renderSignedIn(login, config) {
  return `<p class="success">Signed in as ${escapeHtml(login.verus.verus_id_name || login.verus.verus_id)}.</p>
        <dl>
          <dt>Subject</dt><dd>${escapeHtml(login.subject)}</dd>
          <dt>verus_id</dt><dd>${escapeHtml(login.verus.verus_id)}</dd>
          <dt>verus_id_name</dt><dd>${escapeHtml(login.verus.verus_id_name || "Not present")}</dd>
          <dt>Granted scope</dt><dd>${escapeHtml(login.grantedScope)}</dd>
          <dt>Refresh token present</dt><dd>${login.refreshTokenPresent ? "yes" : "no"}</dd>
        </dl>
        <p><a href="/me">View sanitized /me JSON</a></p>
        ${config.showDebugTokens ? `<details><summary>Local debug tokens</summary><pre>${escapeHtml(JSON.stringify(login.debugTokens, null, 2))}</pre></details>` : ""}
        <form method="post" action="/logout"><button type="submit">Logout</button></form>`
}

export function renderError(title, message) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles()}</head>
  <body><main><section class="error-panel"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back home</a></p></section></main></body>
</html>`
}

function styles() {
  return `<style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fb; color: #1f2937; }
      main { max-width: 760px; margin: 8vh auto; padding: 0 20px; }
      section { background: white; border: 1px solid #d8dee9; border-radius: 8px; padding: 28px; box-shadow: 0 12px 30px rgb(31 41 55 / 8%); }
      h1 { margin: 0 0 16px; font-size: 28px; }
      p { color: #4b5563; line-height: 1.5; }
      a { color: #1b5fc1; }
      .button, button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border: 0; border-radius: 6px; background: #1b5fc1; color: white; font-weight: 700; text-decoration: none; cursor: pointer; }
      .eyebrow { margin: 0 0 8px; color: #526173; font-size: 13px; font-weight: 700; text-transform: uppercase; }
      .success { color: #166534; }
      .error-panel { border-left: 6px solid #b42318; }
      dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 18px; margin: 22px 0; }
      dt { font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre { overflow: auto; padding: 14px; border-radius: 6px; background: #111827; color: #f9fafb; font-size: 12px; }
      @media (max-width: 640px) {
        main { margin: 28px auto; }
        dl { grid-template-columns: 1fr; gap: 6px; }
        dd { margin-bottom: 8px; }
      }
    </style>`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}
