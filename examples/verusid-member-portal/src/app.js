import express from "express"
import session from "express-session"
import crypto from "node:crypto"
import { createConfig } from "@chainvue/verusid-oauth"
import { installOAuthRoutes } from "./oauth.js"

export const useCases = [
  {
    slug: "verusid-sign-in",
    title: "VerusID Sign-In",
    confidence: "Live wallet path",
    capability: "live",
    status: "live",
    ctaLabel: "Start sign-in",
    ctaHref: "/login",
    note: "Verus Mobile v1.1.0-5 supports the legacy LoginConsent deeplink used by the OAuth bridge.",
    summary: "The portal starts a real VerusID login and creates a sanitized server-side member session after wallet approval.",
    surfaces: ["Login entry point", "PKCE challenge", "State and nonce"],
  },
  {
    slug: "oauth-consent",
    title: "OAuth-Style Consent",
    confidence: "Live plus experimental",
    capability: "live",
    status: "live",
    ctaLabel: "Request consent",
    ctaHref: "/login",
    requestKind: "authentication",
    note: "The production CTA uses legacy LoginConsent. A GenericRequest authentication demo is shown only when VERUS_GENERIC_REQUESTS_ENABLED=true and requires Settings -> General -> Enable experimental deeplinks.",
    summary: "The same wallet approval is framed around scopes, consent, callback verification, token sanitization, and the newer experimental GenericRequest authentication shape.",
    surfaces: ["LoginConsent", "AuthenticationRequestDetails", "ResponseURI.TYPE_POST"],
  },
  {
    slug: "identity-gated-access",
    title: "Identity-Gated Access",
    confidence: "Live portal path",
    capability: "live",
    status: "live",
    ctaLabel: "Open studio",
    ctaHref: "/studio",
    note: "Application-boundary view of the live OAuth result: /studio checks the real Express session and redirects signed-out users to /login.",
    summary: "The verified session unlocks a protected workspace instead of starting another wallet capability.",
    surfaces: ["Session guard", "Sanitized claims", "Protected studio"],
  },
  {
    slug: "profile-fields",
    title: "Profile Field Request",
    confidence: "Locked by wallet source",
    capability: "locked",
    status: "locked",
    note: "UserDataRequestDetails exists in primitives, but Verus Mobile v1.1.0-5 blocks it as experimental and has no GenericRequestHome handler for this standalone portal flow.",
    summary: "Request selected profile attributes from the wallet without turning them into fake local form data.",
    surfaces: ["GenericRequest", "UserDataRequestDetails", "Selective field return"],
  },
  {
    slug: "veruspay-checkout",
    title: "VerusPay Checkout",
    confidence: "Live wallet path",
    capability: "live",
    status: "live",
    requestKind: "veruspay",
    note: "Verus Mobile v1.1.0-5 handles VerusPayInvoice deeplinks. This portal renders one only when VERUSPAY_DESTINATION and VERUSPAY_AMOUNT are configured.",
    summary: "Present a real payment request and verify wallet-confirmed settlement before granting purchase access.",
    surfaces: ["VerusPayInvoice", "Wallet deeplink", "QR code"],
  },
  {
    slug: "encrypted-payload-exchange",
    title: "Encrypted Payload Exchange",
    confidence: "Experimental wallet path",
    capability: "experimental",
    status: "experimental",
    requestKind: "app-encryption",
    note: "GenericRequest AppEncryptionRequestDetails handling is experimental in Verus Mobile v1.1.0-5 and requires Settings -> General -> Enable experimental deeplinks.",
    summary: "Exchange sensitive member payloads through wallet-backed encryption rather than browser-visible secrets.",
    surfaces: ["GenericRequest", "AppEncryptionRequestDetails", "ResponseURI.TYPE_POST"],
  },
  {
    slug: "identity-maintenance",
    title: "Identity Maintenance",
    confidence: "Testnet-only flag",
    capability: "testnet-flagged",
    status: "testnet-flagged",
    requestKind: "identity-maintenance",
    note: "Identity update details exist but this portal keeps the flow locked unless VERUS_IDENTITY_UPDATE_DEMO_ENABLED=true and testnet configuration is present. No mainnet default is provided.",
    summary: "Guide members through verified identity updates without pretending the portal can mutate identity state today.",
    surfaces: ["Identity update request", "Signed authorization", "State confirmation"],
  },
  {
    slug: "provisioning",
    title: "Provisioning",
    confidence: "Locked by wallet source",
    capability: "locked",
    status: "locked",
    note: "ProvisionIdentityDetails is handled only as a companion detail in Verus Mobile v1.1.0-5, not as a standalone provisioning web demo.",
    summary: "Provision access, roles, or memberships after the wallet approves a supported request format.",
    surfaces: ["Provisioning request", "Lifecycle callback", "Access issuance"],
  },
  {
    slug: "credential-presentation",
    title: "Credential Presentation",
    confidence: "Locked by wallet source",
    capability: "locked",
    status: "locked",
    note: "Verus Mobile v1.1.0-5 has identity/attestation UI storage, but no request/presentation handler for this portal verifier flow.",
    summary: "Ask a member to present a real credential and verify it before unlocking a workflow.",
    surfaces: ["Presentation request", "Credential verifier", "Policy decision"],
  },
]

const genericRequestStore = new Map()

export function createApp(options = {}) {
  const config = options.config || createMemberPortalConfig()
  const app = express()
  const requestStore = options.requestStore || createRequestStore()

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

  app.get("/use-cases", (req, res) => {
    res.type("html").send(renderPage({
      title: "Use Cases",
      active: "use-cases",
      config,
      member: req.session.member,
      body: renderUseCases(config),
    }))
  })

  app.post("/use-cases/requests/:requestId/response", express.raw({ type: "application/octet-stream", limit: "256kb" }), async (req, res) => {
    const pending = requestStore.get(req.params.requestId)
    if (!pending) {
      res.status(404).json({ ok: false, error: "Unknown request ID." })
      return
    }

    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([])
      if (body.length === 0) {
        throw new Error("Empty GenericResponse payload.")
      }
      const parsed = await parseGenericResponse(body)
      requestStore.update(req.params.requestId, {
        status: "complete",
        receivedAt: new Date().toISOString(),
        responseBytes: body.length,
        responseHash: crypto.createHash("sha256").update(body).digest("hex"),
        parsed,
      })
      res.json({ ok: true, status: "complete" })
    } catch (error) {
      requestStore.update(req.params.requestId, {
        status: "error",
        receivedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      res.status(400).json({ ok: false, error: "Malformed GenericResponse payload." })
    }
  })

  app.get("/use-cases/requests/:requestId/status", (req, res) => {
    const pending = requestStore.get(req.params.requestId)
    if (!pending) {
      res.status(404).json({ ok: false, error: "Unknown request ID." })
      return
    }
    res.json({
      ok: true,
      requestId: pending.id,
      kind: pending.kind,
      status: pending.status,
      createdAt: pending.createdAt,
      receivedAt: pending.receivedAt,
      responseBytes: pending.responseBytes,
      responseHash: pending.responseHash,
      error: pending.error,
    })
  })

  app.get("/use-cases/:slug", async (req, res, next) => {
    const useCase = useCases.find((item) => item.slug === req.params.slug)
    if (!useCase) {
      res.status(404).type("html").send(renderError("Use case not found", "That VerusID capability is not part of this showcase."))
      return
    }

    try {
      const demo = await createUseCaseDemo(useCase, config, requestStore)
      res.type("html").send(renderPage({
        title: useCase.title,
        active: "use-cases",
        config,
        member: req.session.member,
        body: renderUseCaseDetail(useCase, config, demo),
      }))
    } catch (error) {
      next(error)
    }
  })

  app.get("/studio", requireStudio((req, res) => {
    res.type("html").send(renderPage({
      title: "Studio",
      active: "studio",
      config,
      member: req.session.member,
      body: renderStudio(req.session.member),
    }))
  }))

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
  const config = createConfig({
    ...env,
    PORT: env.PORT || "5570",
    CLIENT_ID: env.CLIENT_ID || "verus-member-portal",
    CLIENT_SECRET: env.CLIENT_SECRET || "verus-member-secret",
    REDIRECT_URI: env.REDIRECT_URI || `http://${env.LOCAL_HOST || "192.168.0.160"}:5570/callback`,
    SESSION_SECRET: env.SESSION_SECRET || "local-member-portal-session-secret",
  })
  const localHost = env.LOCAL_HOST || "192.168.0.160"
  return {
    ...config,
    baseUrl: env.BASE_URL || `http://${localHost}:${config.port}`,
    genericRequestsEnabled: env.VERUS_GENERIC_REQUESTS_ENABLED === "true",
    verusPayDestination: env.VERUSPAY_DESTINATION || "",
    verusPayAmount: env.VERUSPAY_AMOUNT || "",
    verusPayCurrencyId: env.VERUSPAY_CURRENCY_ID || env.VERUS_CHAIN_ID || "",
    appEncryptionAddress: env.VERUS_APP_ENCRYPTION_ADDRESS || "",
    identityUpdateDemoEnabled: env.VERUS_IDENTITY_UPDATE_DEMO_ENABLED === "true",
    identityUpdateTestnet: env.VERUS_IDENTITY_UPDATE_TESTNET || env.VERUS_CHAIN || "",
  }
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

function requireStudio(handler) {
  return (req, res, next) => {
    if (!req.session.member) {
      res.redirect("/login")
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
        <div class="action-row">
          <a class="primary-action" href="/login">Login with VerusID</a>
          <a class="secondary-action" href="/use-cases">View use cases</a>
        </div>
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

function renderUseCases(config) {
  const counts = capabilityCounts(config)
  return `<section class="showcase-head">
      <div>
        <p class="eyebrow">Verus Mobile capability map</p>
        <h1>Nine real-only VerusID use cases</h1>
        <p class="lede">This map is based on Verus Mobile v1.1.0-5 source support: live legacy LoginConsent and VerusPay flows are actionable, experimental GenericRequest flows are gated, and unsupported cards stay locked without simulated approvals.</p>
      </div>
      <div class="status-board" aria-label="Integration status summary">
        <div><strong>${counts.live}</strong><span>Live wallet paths</span></div>
        <div><strong>${counts.locked}</strong><span>Locked capabilities</span></div>
      </div>
    </section>
    <section class="use-case-grid">
      ${useCases.map((useCase) => renderUseCaseCard(useCase, config)).join("")}
    </section>`
}

function renderUseCaseCard(useCase, config) {
  const state = resolveUseCaseState(useCase, config)
  const canNavigate = state.kind === "live" && useCase.ctaHref
  const action = canNavigate
    ? `<a class="primary-action compact" href="${escapeHtml(useCase.ctaHref)}">${escapeHtml(useCase.ctaLabel)}</a>`
    : `<span class="locked-action" aria-disabled="true">${escapeHtml(state.actionLabel)}</span>`

  return `<article class="use-card ${escapeHtml(state.kind)}" data-use-case="${escapeHtml(useCase.slug)}" data-capability="${escapeHtml(useCase.capability)}">
      <div class="card-topline">
        <span class="status-pill ${escapeHtml(state.kind)}">${escapeHtml(state.label)}</span>
        <span>${escapeHtml(useCase.confidence)}</span>
      </div>
      <h2>${escapeHtml(useCase.title)}</h2>
      <p>${escapeHtml(useCase.summary)}</p>
      <p class="implementation-note">${escapeHtml(useCase.note)}</p>
      <div class="surface-list">${useCase.surfaces.map((surface) => `<span>${escapeHtml(surface)}</span>`).join("")}</div>
      <div class="card-actions">
        ${action}
        <a class="secondary-action compact" href="/use-cases/${escapeHtml(useCase.slug)}">Details</a>
      </div>
    </article>`
}

function renderUseCaseDetail(useCase, config, demo) {
  const state = resolveUseCaseState(useCase, config)
  const isLive = state.kind === "live"
  const rows = [
    ["Slug", useCase.slug],
    ["Capability", useCase.capability],
    ["Integration status", state.detail],
    ["Confidence", useCase.confidence],
    ["Implementation note", useCase.note],
  ]

  return `<section class="detail-hero ${escapeHtml(state.kind)}">
      <div class="panel">
        <p class="eyebrow">${escapeHtml(state.heading)}</p>
        <h1>${escapeHtml(useCase.title)}</h1>
        <p class="lede">${escapeHtml(useCase.summary)}</p>
        <div class="action-row">
          ${isLive && useCase.ctaHref ? `<a class="primary-action" href="${escapeHtml(useCase.ctaHref)}">${escapeHtml(useCase.ctaLabel)}</a>` : `<span class="locked-action large" aria-disabled="true">${escapeHtml(state.actionLabel)}</span>`}
          <a class="secondary-action" href="/use-cases">All use cases</a>
        </div>
      </div>
      <aside class="panel">
        <h2>Integration contract</h2>
        ${definitionList(rows)}
      </aside>
    </section>
    <section class="panel wide">
      <h2>Required surfaces</h2>
      <div class="surface-list spacious">${useCase.surfaces.map((surface) => `<span>${escapeHtml(surface)}</span>`).join("")}</div>
      ${renderDemoPanel(useCase, state, demo)}
    </section>`
}

function renderDemoPanel(useCase, state, demo) {
  const prerequisite = useCase.capability === "experimental"
    ? `<p class="implementation-note"><strong>Wallet prerequisite:</strong> Settings -&gt; General -&gt; Enable experimental deeplinks.</p>`
    : ""

  if (demo?.error) {
    return `${prerequisite}<p>${escapeHtml(demo.error)}</p>`
  }

  if (demo?.deeplink) {
    return `${prerequisite}
      <div class="request-demo">
        <div>
          <h2>Wallet request</h2>
          ${definitionList([
            ["Request ID", demo.requestId || "not tracked"],
            ["Callback", demo.callbackUrl || "not required"],
            ["Status endpoint", demo.statusUrl || "not required"],
          ])}
          <div class="action-row">
            <a class="primary-action" href="${escapeHtml(demo.deeplink)}">Open in Verus Mobile</a>
            ${demo.statusUrl ? `<a class="secondary-action" href="${escapeHtml(demo.statusUrl)}">Check status</a>` : ""}
          </div>
        </div>
        ${demo.qrDataUrl ? `<img class="qr" alt="${escapeHtml(useCase.title)} QR code" src="${escapeHtml(demo.qrDataUrl)}">` : ""}
      </div>`
  }

  if (useCase.requestKind === "authentication" && !demo) {
    return `${prerequisite}<p>The production consent button above uses the live LoginConsent path. Set <code>VERUS_GENERIC_REQUESTS_ENABLED=true</code> to render the experimental GenericRequest authentication request and POST callback URI.</p>`
  }

  if (state.kind === "locked" || state.kind === "testnet-flagged") {
    return `<p>This page is intentionally informational. It exposes no QR code, deeplink, fake approval, simulated payment settlement, credential presentation, profile-field return, or identity update.</p>`
  }

  return `${prerequisite}<p>This page uses only real supported wallet and server surfaces. It does not mint demo wallet responses.</p>`
}

function createRequestStore(store = genericRequestStore) {
  return {
    create(kind) {
      const id = crypto.randomUUID()
      const pending = {
        id,
        kind,
        status: "pending",
        createdAt: new Date().toISOString(),
      }
      store.set(id, pending)
      return pending
    },
    get(id) {
      return store.get(id)
    },
    update(id, values) {
      const pending = store.get(id)
      if (!pending) {
        return undefined
      }
      const updated = { ...pending, ...values }
      store.set(id, updated)
      return updated
    },
  }
}

function capabilityCounts(config) {
  return useCases.reduce((counts, useCase) => {
    const state = resolveUseCaseState(useCase, config)
    if (state.kind === "live") {
      counts.live += 1
    } else if (state.kind === "locked" || state.kind === "testnet-flagged") {
      counts.locked += 1
    }
    return counts
  }, { live: 0, locked: 0 })
}

function resolveUseCaseState(useCase, config) {
  if (useCase.capability === "experimental") {
    return config.genericRequestsEnabled
      ? {
          kind: "experimental",
          label: "Experimental",
          heading: "Experimental wallet request",
          actionLabel: "Enable in wallet",
          detail: "GenericRequest support is present but gated by Verus Mobile experimental deeplinks.",
        }
      : {
          kind: "locked",
          label: "Experimental gated",
          heading: "Experimental capability",
          actionLabel: "Unavailable",
          detail: "Set VERUS_GENERIC_REQUESTS_ENABLED=true and enable experimental deeplinks in Verus Mobile.",
        }
  }

  if (useCase.capability === "testnet-flagged") {
    const enabled = config.identityUpdateDemoEnabled && hasTestnetConfig(config)
    return enabled
      ? {
          kind: "testnet-flagged",
          label: "Testnet flagged",
          heading: "Testnet-only demo",
          actionLabel: "Testnet only",
          detail: "Explicitly enabled for testnet identity-update exploration. Mainnet remains locked.",
        }
      : {
          kind: "locked",
          label: "Testnet locked",
          heading: "Locked capability",
          actionLabel: "Unavailable",
          detail: "Locked unless VERUS_IDENTITY_UPDATE_DEMO_ENABLED=true and testnet config is present.",
        }
  }

  if (useCase.capability === "locked") {
    return {
      kind: "locked",
      label: "Locked",
      heading: "Locked capability",
      actionLabel: "Unavailable",
      detail: "No handler-backed standalone Verus Mobile v1.1.0-5 flow exists for this portal use case.",
    }
  }

  return {
    kind: "live",
    label: "Live",
    heading: "Working example",
    actionLabel: "Open",
    detail: "Wired to supported wallet and portal behavior.",
  }
}

async function createUseCaseDemo(useCase, config, requestStore) {
  if (useCase.requestKind === "veruspay") {
    return createVerusPayDemo(config)
  }

  if (useCase.requestKind === "authentication" && config.genericRequestsEnabled) {
    return createGenericRequestDemo("authentication", config, requestStore)
  }

  if (useCase.requestKind === "app-encryption") {
    if (!config.genericRequestsEnabled) {
      return undefined
    }
    if (!config.appEncryptionAddress) {
      return {
        error: "Set VERUS_APP_ENCRYPTION_ADDRESS before rendering an AppEncryptionRequestDetails deeplink. The portal will display response metadata only; it does not fake decryption.",
      }
    }
    return createGenericRequestDemo("app-encryption", config, requestStore)
  }

  if (useCase.requestKind === "identity-maintenance") {
    if (!config.identityUpdateDemoEnabled || !hasTestnetConfig(config)) {
      return undefined
    }
    return {
      error: "Identity maintenance is enabled only as a testnet-flagged informational page in this showcase. No identity update transaction is built or submitted.",
    }
  }

  return undefined
}

async function createVerusPayDemo(config) {
  if (!config.verusPayDestination || !config.verusPayAmount) {
    return {
      error: "Set VERUSPAY_DESTINATION and VERUSPAY_AMOUNT to render a VerusPayInvoice deeplink and QR code. The portal does not simulate settlement when those values are missing.",
    }
  }

  const primitives = await loadOptionalModule("verus-typescript-primitives")
  if (!primitives) {
    return {
      error: "Install verus-typescript-primitives before rendering a VerusPayInvoice deeplink.",
    }
  }

  try {
    const {
      BigNumber,
      TransferDestination,
      VerusPayInvoice,
      VerusPayInvoiceDetails,
    } = primitives
    const destination = TransferDestination.fromJson(config.verusPayDestination)
    const amount = amountToSats(config.verusPayAmount, BigNumber)
    const details = new VerusPayInvoiceDetails({
      amount,
      destination,
      requestedcurrencyid: config.verusPayCurrencyId || undefined,
    })
    const invoice = new VerusPayInvoice({ details })
    const deeplink = invoice.toWalletDeeplinkUri()
    return {
      deeplink,
      qrDataUrl: await qrDataUrl(deeplink),
    }
  } catch (error) {
    return {
      error: `VERUSPAY_DESTINATION could not be encoded as a VerusPayInvoice destination: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function createGenericRequestDemo(kind, config, requestStore) {
  const primitives = await loadOptionalModule("verus-typescript-primitives")
  if (!primitives) {
    return {
      error: "Install verus-typescript-primitives before rendering GenericRequest deeplinks.",
    }
  }

  const pending = requestStore.create(kind)
  const callbackUrl = `${config.baseUrl}/use-cases/requests/${pending.id}/response`
  const statusUrl = `/use-cases/requests/${pending.id}/status`

  try {
    const {
      AppEncryptionRequestDetails,
      AuthenticationRequestDetails,
      BigNumber,
      GenericRequest,
      ResponseURI,
      VERUS_MOBILE_GENERIC_REQUEST_HANDLER_ID,
    } = primitives
    const details = kind === "app-encryption"
      ? [new AppEncryptionRequestDetails()]
      : [new AuthenticationRequestDetails()]
    const request = new GenericRequest({
      details,
      createdAt: new BigNumber(Math.floor(Date.now() / 1000)),
      responseURIs: [ResponseURI.fromUriString(callbackUrl, ResponseURI.TYPE_POST)],
      preferredHandler: VERUS_MOBILE_GENERIC_REQUEST_HANDLER_ID,
    })
    const deeplink = request.toWalletDeeplinkUri()
    requestStore.update(pending.id, {
      callbackUrl,
      requestHash: crypto.createHash("sha256").update(request.toString()).digest("hex"),
    })

    return {
      requestId: pending.id,
      callbackUrl,
      statusUrl,
      deeplink,
      qrDataUrl: await qrDataUrl(deeplink),
    }
  } catch (error) {
    requestStore.update(pending.id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      error: `GenericRequest could not be encoded: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function parseGenericResponse(body) {
  const primitives = await loadOptionalModule("verus-typescript-primitives")
  if (!primitives) {
    throw new Error("verus-typescript-primitives is not installed.")
  }
  try {
    const response = new primitives.GenericResponse()
    response.fromBuffer(body)
    return response.toJson()
  } catch (error) {
    if (body.length >= 8 && body[0] === 1) {
      return {
        parseWarning: error instanceof Error ? error.message : String(error),
        version: "1",
      }
    }
    throw error
  }
}

async function qrDataUrl(value) {
  const qr = await loadOptionalModule("qrcode")
  if (!qr) {
    return ""
  }
  return qr.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  })
}

async function loadOptionalModule(name) {
  try {
    return await import(name)
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
      return undefined
    }
    throw error
  }
}

function amountToSats(amount, BigNumber) {
  const [whole, fraction = ""] = String(amount).trim().split(".")
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > 8) {
    throw new Error("VERUSPAY_AMOUNT must be a decimal amount with at most 8 fractional digits.")
  }
  return new BigNumber(`${whole}${fraction.padEnd(8, "0")}`, 10)
}

function hasTestnetConfig(config) {
  return /test/i.test(config.identityUpdateTestnet) || /test/i.test(config.verusPayCurrencyId)
}

function renderStudio(member) {
  const displayName = member.verus.verus_id_name || member.verus.verus_id
  return `${renderPassport(member)}
    <section class="studio-layout">
      <article class="panel studio-primary">
        <p class="eyebrow">Protected studio</p>
        <h1>${escapeHtml(displayName)} workspace</h1>
        <p class="lede">This page is the real identity-gated access use case. It renders only after the VerusID OAuth callback creates a verified server session.</p>
        <div class="stats">
          <div><span>Access tier</span><strong>Operator</strong></div>
          <div><span>Spaces</span><strong>7</strong></div>
          <div><span>Reviews</span><strong>3</strong></div>
          <div><span>Session</span><strong>Live</strong></div>
        </div>
      </article>
      <article class="panel">
        <h2>Workspace queue</h2>
        ${[
          ["Approve Atlas launch role", "Requires current VerusID session"],
          ["Review billing contact", "Visible to verified members"],
          ["Export access audit", "Prepared from local session state"],
        ].map(([title, detail]) => `<div class="task-row"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`).join("")}
      </article>
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
          ${navLink("/use-cases", "Use Cases", active === "use-cases")}
          ${navLink("/studio", "Studio", active === "studio")}
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
      :root { color-scheme: light; --ink: #18202f; --muted: #627084; --line: #d8dee8; --paper: #ffffff; --soft: #f5f7fa; --brand: #0b6f70; --brand-dark: #094f51; --accent: #a83f24; --good: #177245; --warn: #7d5534; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #eef2f5; color: var(--ink); }
      a { color: var(--brand-dark); }
      a:focus-visible, button:focus-visible { outline: 3px solid #f0b75c; outline-offset: 3px; }
      .shell { min-height: 100vh; display: flex; flex-direction: column; }
      header { display: grid; grid-template-columns: max-content 1fr max-content; align-items: center; gap: 24px; padding: 18px 32px; background: var(--paper); border-bottom: 1px solid var(--line); }
      .brand { color: var(--ink); font-weight: 800; text-decoration: none; }
      nav { display: flex; flex-wrap: wrap; gap: 6px; }
      nav a, .link-button { min-height: 36px; display: inline-flex; align-items: center; border: 0; border-radius: 6px; padding: 0 12px; background: transparent; color: var(--muted); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
      nav a:hover, .link-button:hover, nav a.active { background: #e4eeee; color: var(--brand-dark); }
      main { width: min(1120px, calc(100% - 32px)); margin: 28px auto 44px; flex: 1; }
      footer { padding: 18px 32px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; background: var(--paper); overflow-wrap: anywhere; }
      .hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr); gap: 24px; align-items: stretch; }
      .hero > div, .dev-panel, .panel, .passport, .metric, .use-card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 1px 2px rgba(24, 32, 47, .04); }
      .hero > div { min-height: 360px; padding: 44px; display: flex; flex-direction: column; justify-content: center; }
      .dev-panel { padding: 28px; }
      .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
      h1 { margin: 0; font-size: 42px; line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0 0 18px; font-size: 18px; letter-spacing: 0; }
      p { color: var(--muted); line-height: 1.55; }
      .lede { max-width: 620px; font-size: 18px; }
      .primary-action, .secondary-action, .danger-action, .locked-action { width: max-content; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; padding: 0 16px; font-weight: 800; text-decoration: none; cursor: pointer; transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
      .primary-action { margin-top: 18px; background: var(--brand); color: white; }
      .secondary-action { background: #e4eeee; color: var(--brand-dark); }
      .danger-action { background: var(--accent); color: white; font: inherit; }
      .primary-action:hover, .secondary-action:hover, .danger-action:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(24, 32, 47, .12); }
      .compact { min-height: 36px; padding: 0 12px; margin-top: 0; font-size: 14px; }
      .locked-action { background: #efe8df; color: var(--warn); cursor: not-allowed; }
      .locked-action.large { min-height: 42px; }
      .action-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 18px; }
      .action-row .primary-action { margin-top: 0; }
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
      .showcase-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, .34fr); gap: 24px; padding: 6px 0 10px; align-items: end; }
      .status-board { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .status-board div { padding: 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--soft); }
      .status-board strong, .status-board span { display: block; }
      .status-board strong { font-size: 28px; }
      .status-board span { margin-top: 4px; color: var(--muted); font-weight: 700; }
      .use-case-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
      .use-card { min-height: 360px; padding: 22px; display: flex; flex-direction: column; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
      .use-card:hover { transform: translateY(-2px); border-color: #b8c6d4; box-shadow: 0 12px 30px rgba(24, 32, 47, .1); }
      .use-card h2 { margin-top: 16px; margin-bottom: 8px; }
      .use-card p { margin: 0 0 12px; }
      .implementation-note { font-size: 14px; }
      .card-topline { display: flex; gap: 10px; align-items: center; justify-content: space-between; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .status-pill { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 0 9px; }
      .status-pill.live { background: #e6f2ec; color: var(--good); }
      .status-pill.experimental, .status-pill.testnet-flagged { background: #fff3d8; color: #795300; }
      .status-pill.locked { background: #efe8df; color: var(--warn); }
      .surface-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
      .surface-list span { min-height: 28px; display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 0 10px; background: var(--soft); color: var(--muted); font-size: 12px; font-weight: 800; }
      .surface-list.spacious { margin-top: 0; margin-bottom: 14px; }
      .card-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 18px; }
      .detail-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .62fr); gap: 16px; align-items: stretch; }
      .request-demo { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 20px; align-items: start; padding-top: 8px; }
      .qr { width: 180px; height: 180px; border: 1px solid var(--line); border-radius: 6px; background: white; }
      .studio-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(300px, .9fr); gap: 16px; margin-top: 16px; }
      .studio-primary h1 { font-size: 34px; }
      .task-row { display: grid; gap: 4px; padding: 14px 0; border-top: 1px solid var(--line); }
      .task-row:first-of-type { border-top: 0; padding-top: 0; }
      .task-row span { color: var(--muted); }
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
        .hero, .passport, .grid, .band, .showcase-head, .use-case-grid, .detail-hero, .studio-layout, .request-demo { grid-template-columns: 1fr; }
        .hero > div { min-height: auto; padding: 28px; }
        h1 { font-size: 34px; }
        dl { grid-template-columns: 1fr; gap: 4px; }
        dd { margin-bottom: 8px; }
        .activity-item { grid-template-columns: 1fr; gap: 4px; }
      }
      @media (max-width: 520px) {
        .stats, .status-board, .use-case-grid { grid-template-columns: 1fr; }
        h1 { font-size: 30px; }
      }
      @media (min-width: 821px) and (max-width: 1040px) {
        .use-case-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
