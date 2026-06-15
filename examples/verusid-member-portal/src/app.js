import express from "express"
import session from "express-session"
import { createConfig } from "@chainvue/verusid-oauth"
import { installOAuthRoutes } from "./oauth.js"

export function createApp(options = {}) {
  const config = options.config || createMemberPortalConfig()
  const app = express()

  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())
  app.use(session({
    name: "verusid_member_portal",
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
    res.type("html").send(renderPage({
      title: "Member Portal",
      active: "dashboard",
      config,
      member: req.session.member,
      body: req.session.member ? renderDashboard(req.session.member) : renderSignedOut(config),
    }))
  })

  app.get("/account", requireMemberPage((req, res) => {
    res.type("html").send(renderPage({
      title: "Account",
      active: "account",
      config,
      member: req.session.member,
      body: renderAccount(req.session.member),
    }))
  }))

  app.get("/activity", requireMemberPage((req, res) => {
    res.type("html").send(renderPage({
      title: "Activity",
      active: "activity",
      config,
      member: req.session.member,
      body: renderActivity(req.session.member),
    }))
  }))

  app.get("/settings", requireMemberPage((req, res) => {
    res.type("html").send(renderPage({
      title: "Settings",
      active: "settings",
      config,
      member: req.session.member,
      body: renderSettings(req.session.member),
    }))
  }))

  app.get("/me", (req, res) => {
    if (!req.session.member) {
      res.status(401).json({ authenticated: false })
      return
    }
    res.json({ authenticated: true, ...req.session.member })
  })

  installOAuthRoutes(app, { config, renderError, client: options.client })

  app.use((error, _req, res, _next) => {
    res.status(500).type("html").send(renderError("Application error", error.message))
  })

  return app
}

export function createMemberPortalConfig(env = process.env) {
  return createConfig({
    ...env,
    PORT: env.PORT || "5570",
    CLIENT_ID: env.CLIENT_ID || "verus-member-portal",
    CLIENT_SECRET: env.CLIENT_SECRET || "verus-member-secret",
    REDIRECT_URI: env.REDIRECT_URI || `http://${env.LOCAL_HOST || "192.168.0.160"}:5570/callback`,
    SESSION_SECRET: env.SESSION_SECRET || "local-member-portal-session-secret",
  })
}

function requireMemberPage(handler) {
  return (req, res, next) => {
    if (!req.session.member) {
      res.redirect("/?login=required")
      return
    }
    handler(req, res, next)
  }
}

function renderSignedOut(config) {
  return `<section class="hero">
      <div>
        <p class="eyebrow">VerusID member access</p>
        <h1>Sign in to your member workspace</h1>
        <p class="lede">A server-rendered Express showcase for protected product screens that trust a verified VerusID login.</p>
        <a class="primary-action" href="/login">Login with VerusID</a>
      </div>
      <aside class="dev-panel" aria-label="OAuth configuration">
        <h2>Developer panel</h2>
        ${definitionList([
          ["Client ID", config.clientId],
          ["Required scope", config.scope],
          ["Redirect URI", config.redirectUri],
          ["Issuer", config.hydraPublicUrl],
        ])}
      </aside>
    </section>
    <section class="band">
      <div class="metric"><strong>Private projects</strong><span>12 active spaces</span></div>
      <div class="metric"><strong>Member status</strong><span>Verified at sign-in</span></div>
      <div class="metric"><strong>Session storage</strong><span>Sanitized identity only</span></div>
    </section>`
}

function renderDashboard(member) {
  return `${renderPassport(member)}
    <section class="grid">
      <article class="panel">
        <h2>Member Overview</h2>
        <div class="stats">
          <div><span>Account status</span><strong>Verified</strong></div>
          <div><span>Open projects</span><strong>7</strong></div>
          <div><span>Team seats</span><strong>18</strong></div>
          <div><span>Pending reviews</span><strong>3</strong></div>
        </div>
      </article>
      <article class="panel">
        <h2>Recent Activity</h2>
        ${activityList(member).slice(0, 4).map(renderActivityItem).join("")}
      </article>
      <article class="panel span">
        <h2>Session Safety</h2>
        <p>This showcase stores the sanitized OAuth subject, Verus claims, granted scope, refresh-token presence, and login timestamp in the server-side session. Raw access, ID, and refresh tokens are not stored in the member session or returned by <code>/me</code>.</p>
      </article>
    </section>`
}

function renderAccount(member) {
  return `${renderPassport(member)}
    <section class="panel wide">
      <h2>Identity Summary</h2>
      ${definitionList([
        ["Display name", member.verus.verus_id_name || "Not provided"],
        ["VerusID", member.verus.verus_id],
        ["Subject", member.subject],
        ["Chain", member.verus.verus_chain || "Not provided"],
        ["Granted scope", member.grantedScope],
        ["Refresh token present", member.refreshTokenPresent ? "yes" : "no"],
      ])}
    </section>`
}

function renderActivity(member) {
  return `<section class="panel wide">
      <h2>Audit Activity</h2>
      ${activityList(member).map(renderActivityItem).join("")}
    </section>`
}

function renderSettings(member) {
  return `<section class="panel wide">
      <h2>Session Controls</h2>
      <p>Session started ${escapeHtml(formatDate(member.loginTime))}. Use logout to clear this Express session cookie and remove the stored sanitized member profile.</p>
      <div class="settings-row">
        <a class="secondary-action" href="/me">View /me JSON</a>
        <form method="post" action="/logout"><button class="danger-action" type="submit">Logout</button></form>
      </div>
    </section>`
}

function renderPassport(member) {
  const displayName = member.verus.verus_id_name || member.verus.verus_id
  return `<section class="passport">
      <div>
        <p class="eyebrow">VerusID Passport</p>
        <h1>${escapeHtml(displayName)}</h1>
        <p>${escapeHtml(member.verus.verus_id)}</p>
      </div>
      ${definitionList([
        ["Chain", member.verus.verus_chain || "Not provided"],
        ["Auth method", member.verus.verus_auth_method || "Not provided"],
        ["Login time", formatDate(member.loginTime)],
        ["Subject", member.subject],
      ])}
    </section>`
}

function activityList(member) {
  return [
    ["Signed in with VerusID", `${member.verus.verus_id_name || member.verus.verus_id} completed OAuth consent`, member.loginTime],
    ["Member workspace opened", "Dashboard data loaded from the local showcase session", minutesAgo(3)],
    ["Project role refreshed", "Maintainer access confirmed for Atlas Launch", minutesAgo(18)],
    ["Billing contact viewed", "Account profile page opened from this device", hoursAgo(2)],
    ["Security review queued", "Quarterly access review added to pending tasks", hoursAgo(5)],
  ]
}

function renderActivityItem([title, detail, timestamp]) {
  return `<div class="activity-item">
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>
      <time>${escapeHtml(formatDate(timestamp))}</time>
    </div>`
}

function renderPage({ title, active, config, member, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | VerusID Member Portal</title>
    ${styles()}
  </head>
  <body>
    <div class="shell">
      <header>
        <a class="brand" href="/">Member Portal</a>
        <nav>
          ${navLink("/", "Dashboard", active === "dashboard")}
          ${navLink("/account", "Account", active === "account")}
          ${navLink("/activity", "Activity", active === "activity")}
          ${navLink("/settings", "Settings", active === "settings")}
        </nav>
        ${member ? `<form method="post" action="/logout"><button class="link-button" type="submit">Logout</button></form>` : `<a class="link-button" href="/login">Login</a>`}
      </header>
      <main>${body}</main>
      <footer>Client ${escapeHtml(config.clientId)} | ${escapeHtml(config.scope)}</footer>
    </div>
  </body>
</html>`
}

function navLink(href, label, active) {
  return `<a class="${active ? "active" : ""}" href="${href}">${label}</a>`
}

function definitionList(rows) {
  return `<dl>${rows.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`
}

export function renderError(title, message) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles()}</head>
  <body><main class="error-panel"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back home</a></p></main></body>
</html>`
}

function styles() {
  return `<style>
      :root { color-scheme: light; --ink: #18202f; --muted: #627084; --line: #d8dee8; --paper: #ffffff; --soft: #f5f7fa; --brand: #0b6f70; --brand-dark: #094f51; --accent: #a83f24; --good: #177245; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f5; color: var(--ink); }
      a { color: var(--brand-dark); }
      .shell { min-height: 100vh; display: flex; flex-direction: column; }
      header { display: grid; grid-template-columns: max-content 1fr max-content; align-items: center; gap: 24px; padding: 18px 32px; background: var(--paper); border-bottom: 1px solid var(--line); }
      .brand { color: var(--ink); font-weight: 800; text-decoration: none; }
      nav { display: flex; flex-wrap: wrap; gap: 6px; }
      nav a, .link-button { min-height: 36px; display: inline-flex; align-items: center; border: 0; border-radius: 6px; padding: 0 12px; background: transparent; color: var(--muted); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
      nav a.active { background: #e4eeee; color: var(--brand-dark); }
      main { width: min(1120px, calc(100% - 32px)); margin: 28px auto 44px; flex: 1; }
      footer { padding: 18px 32px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; background: var(--paper); overflow-wrap: anywhere; }
      .hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); gap: 24px; align-items: stretch; }
      .hero > div, .dev-panel, .panel, .passport, .metric { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }
      .hero > div { min-height: 360px; padding: 44px; display: flex; flex-direction: column; justify-content: center; }
      .dev-panel { padding: 28px; }
      .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
      h1 { margin: 0; font-size: 42px; line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0 0 18px; font-size: 18px; letter-spacing: 0; }
      p { color: var(--muted); line-height: 1.55; }
      .lede { max-width: 620px; font-size: 18px; }
      .primary-action, .secondary-action, .danger-action { width: max-content; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; padding: 0 16px; font-weight: 800; text-decoration: none; cursor: pointer; }
      .primary-action { margin-top: 18px; background: var(--brand); color: white; }
      .secondary-action { background: #e4eeee; color: var(--brand-dark); }
      .danger-action { background: var(--accent); color: white; font: inherit; }
      .band { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
      .metric { padding: 22px; }
      .metric strong, .metric span { display: block; }
      .metric span { margin-top: 8px; color: var(--muted); }
      .passport { display: grid; grid-template-columns: minmax(0, .9fr) minmax(360px, 1.1fr); gap: 24px; padding: 28px; background: linear-gradient(135deg, #ffffff 0%, #edf6f4 100%); }
      .passport h1 { font-size: 32px; overflow-wrap: anywhere; }
      .passport p { overflow-wrap: anywhere; }
      dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 10px 16px; margin: 0; }
      dt { color: var(--muted); font-weight: 800; }
      dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
      .panel { padding: 24px; }
      .panel.span, .panel.wide { grid-column: 1 / -1; }
      .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .stats div { padding: 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--soft); }
      .stats span, .stats strong { display: block; }
      .stats span { color: var(--muted); font-size: 13px; font-weight: 700; }
      .stats strong { margin-top: 8px; font-size: 24px; }
      .activity-item { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 16px; align-items: start; padding: 14px 0; border-top: 1px solid var(--line); }
      .activity-item:first-of-type { border-top: 0; padding-top: 0; }
      .activity-item strong, .activity-item span { display: block; }
      .activity-item span, time { margin-top: 4px; color: var(--muted); }
      time { white-space: nowrap; font-size: 13px; }
      .settings-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
      code { padding: 2px 5px; border-radius: 4px; background: var(--soft); color: var(--ink); }
      .error-panel { width: min(760px, calc(100% - 32px)); margin: 8vh auto; padding: 28px; border: 1px solid var(--line); border-left: 6px solid var(--accent); border-radius: 8px; background: var(--paper); }
      @media (max-width: 820px) {
        header { grid-template-columns: 1fr; gap: 10px; padding: 16px; }
        main { margin-top: 16px; }
        .hero, .passport, .grid, .band { grid-template-columns: 1fr; }
        .hero > div { min-height: auto; padding: 28px; }
        h1 { font-size: 34px; }
        dl { grid-template-columns: 1fr; gap: 4px; }
        dd { margin-bottom: 8px; }
        .activity-item { grid-template-columns: 1fr; gap: 4px; }
      }
      @media (max-width: 520px) {
        .stats { grid-template-columns: 1fr; }
        h1 { font-size: 30px; }
      }
    </style>`
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
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
