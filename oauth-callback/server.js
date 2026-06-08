const crypto = require("node:crypto")
const http = require("node:http")

const port = Number(process.env.PORT || 5555)

const localHost = process.env.LOCAL_HOST || "192.168.0.160"
const hydraPublicUrl = process.env.HYDRA_PUBLIC_URL || `http://${localHost}:4444`
const hydraAdminUrl = process.env.HYDRA_ADMIN_URL || "http://127.0.0.1:4445"
const clientId = process.env.CLIENT_ID || "verus-local-client"
const clientSecret = process.env.CLIENT_SECRET || "verus-local-secret"
const redirectUri = process.env.REDIRECT_URI || `http://${localHost}:5555/callback`
const scopes = process.env.SCOPES || "openid offline verusid"
const showDebugTokens = process.env.SHOW_DEBUG_TOKENS === "1"
const stateCookieName = "verus_oauth_state"
const nonceCookieName = "verus_oauth_nonce"
const codeVerifierCookieName = "verus_oauth_code_verifier"
const verusClaimNames = [
  "verus_id_name",
  "verus_id",
  "verus_chain",
  "verus_auth_method",
  "verus_login_at",
]

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)

    if (req.method !== "GET") {
      sendPlain(res, 405, "Method not allowed")
      return
    }

    if (url.pathname === "/") {
      renderHome(res)
      return
    }

    if (url.pathname === "/login") {
      redirectToHydra(res)
      return
    }

    if (url.pathname === "/callback") {
      await renderCallback(req, res, url)
      return
    }

    sendPlain(res, 404, "Not found")
  } catch (error) {
    console.error(error)
    sendPlain(res, 500, "Internal server error")
  }
})

function renderHome(res) {
  const scopeItems = scopes
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => `<li>${escapeHtml(scope)}</li>`)
    .join("")

  sendHtml(res, 200, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Login with VerusID</title>
    ${styles()}
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">Sample relying-party app</p>
        <h1>Sign in to the local VerusID demo</h1>
        <p>This app uses Hydra for OAuth and the Verus consent node for wallet approval. It requests only the minimal local-demo contract.</p>
        <div class="meta-grid">
          <div>
            <h2>Requested scopes</h2>
            <ul class="scope-list">${scopeItems}</ul>
          </div>
          <div>
            <h2>Callback URL</h2>
            <p class="mono">${escapeHtml(redirectUri)}</p>
          </div>
        </div>
        <a class="button" href="/login">Login with VerusID</a>
      </section>
      ${renderFlowSection(0)}
    </main>
  </body>
</html>`)
}

function redirectToHydra(res) {
  const state = randomValue()
  const nonce = randomValue()
  const codeVerifier = randomValue()
  const authUrl = buildAuthorizationUrl(state, nonce, codeVerifier)

  res.writeHead(302, {
    location: authUrl.toString(),
    "set-cookie": [
      serializeCookie(stateCookieName, state, {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 600,
        path: "/callback",
      }),
      serializeCookie(nonceCookieName, nonce, {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 600,
        path: "/callback",
      }),
      serializeCookie(codeVerifierCookieName, codeVerifier, {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: 600,
        path: "/callback",
      }),
    ],
  })
  res.end()
}

async function renderCallback(req, res, url) {
  const cookies = parseCookies(req.headers.cookie || "")
  const expectedState = cookies[stateCookieName]
  const expectedNonce = cookies[nonceCookieName]
  const codeVerifier = cookies[codeVerifierCookieName]
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")
  const stateValidation = validateState(expectedState, state)
  const authorizationUrl = expectedState && expectedNonce ? buildAuthorizationUrl(expectedState, expectedNonce, codeVerifier || "CODE_VERIFIER_FROM_SESSION").toString() : buildAuthorizationUrl("STATE_FROM_SESSION", "NONCE_FROM_SESSION", "CODE_VERIFIER_FROM_SESSION").toString()
  let tokenResult = null
  let idTokenDisplay = { ok: false, verified: false, claims: null, header: null, checks: [], error: "No ID token returned" }
  let introspectionResult = null

  if (code && stateValidation.ok && codeVerifier) {
    tokenResult = await exchangeCode(code, codeVerifier)
    if (tokenResult.ok) {
      idTokenDisplay = await verifyIdToken(tokenResult.body?.id_token, tokenResult.body?.access_token, expectedNonce)
      if (tokenResult.body?.access_token) {
        introspectionResult = await introspectAccessToken(tokenResult.body.access_token)
      }
    }
  }

  const hasCallbackError = Boolean(
    error ||
      !code ||
      !codeVerifier ||
      !stateValidation.ok ||
      tokenResult?.error ||
      (tokenResult?.ok && !idTokenDisplay.verified) ||
      introspectionResult?.error,
  )
  const status = hasCallbackError ? 400 : 200
  const checklist = buildVerificationChecklist(stateValidation, tokenResult, idTokenDisplay, introspectionResult)
  const summaryClaims = extractVerusClaims(idTokenDisplay.claims) || extractVerusClaims(introspectionResult?.body?.ext)
  const result = buildSignInResult(summaryClaims, tokenResult, idTokenDisplay, introspectionResult)

  sendHtml(
    res,
    status,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OAuth Callback</title>
    ${styles()}
  </head>
  <body>
    <main>
      <section class="status-panel ${hasCallbackError ? "status-error" : "status-success"}">
        <p class="eyebrow">${hasCallbackError ? "OAuth callback" : "Signed in with VerusID"}</p>
        <h1>${hasCallbackError ? "OAuth Error" : `Signed in as ${escapeHtml(result.displayName)}`}</h1>
        <p>${hasCallbackError ? "The callback was received, but the local client could not complete the full sign-in flow." : "The wallet-approved VerusID identity is now represented in the OAuth tokens returned to this sample app."}</p>
        ${renderResultSummary(result)}
      </section>
      <nav class="tabs" aria-label="Callback sections">
        <a href="#result">Result</a>
        <a href="#integration">Integration</a>
        <a href="#verification">Verification</a>
        <a href="#debug">Debug</a>
      </nav>
      <section id="result">
        <h2>Result</h2>
        ${renderFlowSection(hasCallbackError ? 3 : 5)}
        <h3>Verus Identity</h3>
        ${renderIdentitySummary(summaryClaims)}
        ${renderStoreSection(result)}
      </section>
      ${renderIntegrationSection(authorizationUrl, code)}
      <section id="verification">
        <h2>Verification</h2>
        <h3>What this demo proves</h3>
        ${renderChecklist(checklist)}
        ${renderClaimsSection("ID Token Verification", "The callback client verifies the ID token signature with Hydra JWKS, then checks issuer, audience, nonce, expiry, and at_hash when Hydra returns it.", idTokenDisplay)}
        ${renderIntrospectionSection(introspectionResult)}
      </section>
      <section id="debug">
        <h2>Debug</h2>
        <p class="warning">Sensitive local-demo output. Raw tokens are shown so developers can inspect the complete OAuth response; do not expose this in a production app.</p>
        <dl>
          ${error ? renderField("Error", error) : ""}
          ${errorDescription ? renderField("Description", errorDescription) : ""}
          ${state ? renderField("Returned state", state) : ""}
          ${renderField("PKCE verifier", codeVerifier ? "present" : "missing", codeVerifier ? "success" : "error")}
          ${renderField("State validation", stateValidation.message, stateValidation.ok ? "success" : "error")}
        </dl>
        ${renderTokenSection(tokenResult, introspectionResult, showDebugTokens)}
      </section>
      <p><a href="/">Start another login</a></p>
    </main>
  </body>
</html>`,
    {
      "set-cookie": [
        serializeCookie(stateCookieName, "", {
          httpOnly: true,
          sameSite: "Lax",
          maxAge: 0,
          path: "/callback",
        }),
        serializeCookie(nonceCookieName, "", {
          httpOnly: true,
          sameSite: "Lax",
          maxAge: 0,
          path: "/callback",
        }),
        serializeCookie(codeVerifierCookieName, "", {
          httpOnly: true,
          sameSite: "Lax",
          maxAge: 0,
          path: "/callback",
        }),
      ],
    },
  )
}

function buildAuthorizationUrl(state, nonce, codeVerifier) {
  const authUrl = new URL("/oauth2/auth", hydraPublicUrl)
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", scopes)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("state", state)
  authUrl.searchParams.set("nonce", nonce)
  if (codeVerifier) {
    authUrl.searchParams.set("code_challenge", createPkceChallenge(codeVerifier))
    authUrl.searchParams.set("code_challenge_method", "S256")
  }
  return authUrl
}

async function exchangeCode(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  })
  if (codeVerifier) {
    body.set("code_verifier", codeVerifier)
  }

  try {
    const response = await fetch(`${hydraPublicUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    const parsed = parseJson(text)

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parsed || { raw: text },
      error: response.ok ? null : parsed?.error || response.statusText,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: "Token request failed",
      body: { error: error.message },
      error: error.message,
    }
  }
}

async function introspectAccessToken(accessToken) {
  const body = new URLSearchParams({ token: accessToken })

  try {
    const response = await fetch(`${hydraAdminUrl}/admin/oauth2/introspect`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    const parsed = parseJson(text)

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parsed || { raw: text },
      error: response.ok ? null : parsed?.error || response.statusText,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: "Introspection request failed",
      body: { error: error.message },
      error: error.message,
    }
  }
}

function renderTokenSection(tokenResult, introspectionResult, includeRawTokens = false) {
  if (!tokenResult) {
    return ""
  }

  const body = tokenResult.body || {}
  const title = tokenResult.ok ? "Token Response" : "Token Exchange Failed"

  return `<div class="debug-block">
        <h3>${title}</h3>
        <dl>
          ${renderField("HTTP status", tokenResult.status ? `${tokenResult.status} ${tokenResult.statusText}` : tokenResult.statusText, tokenResult.ok ? "success" : "error")}
          ${body.token_type ? renderField("Token type", body.token_type) : ""}
          ${body.expires_in ? renderField("Expires in", String(body.expires_in)) : ""}
          ${renderField("Granted scope", body.scope || "Not returned", body.scope === scopes ? "success" : "error")}
          ${renderField("Refresh token present", body.refresh_token ? "yes" : "no", body.refresh_token ? "success" : "error")}
          ${body.error ? renderField("Error", body.error, "error") : ""}
          ${body.error_description ? renderField("Description", body.error_description, "error") : ""}
          ${body.raw ? renderField("Raw response", body.raw, "error") : ""}
        </dl>
        ${includeRawTokens ? `<details>
          <summary>Debug: raw token response JSON</summary>
          <pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>
        </details>` : `<p class="muted">Raw token JSON is hidden. Set SHOW_DEBUG_TOKENS=1 for local inspection.</p>`}
        ${includeRawTokens && introspectionResult ? `<details>
          <summary>Debug: access-token introspection JSON</summary>
          <pre>${escapeHtml(JSON.stringify(introspectionResult.body, null, 2))}</pre>
        </details>` : ""}
      </div>`
}

function buildSignInResult(claims, tokenResult, idTokenDisplay, introspectionResult) {
  const idClaims = extractVerusClaims(idTokenDisplay.claims)
  const accessClaims = extractVerusClaims(introspectionResult?.body?.ext)
  const claimsMatch = Boolean(idClaims && accessClaims && verusClaimsMatch(idClaims, accessClaims))

  return {
    displayName: claims?.verus_id_name || claims?.verus_id || "VerusID",
    verusIdName: claims?.verus_id_name || "Not present",
    verusId: claims?.verus_id || "Not present",
    grantedScope: tokenResult?.body?.scope || "Not returned",
    refreshTokenPresent: Boolean(tokenResult?.body?.refresh_token),
    claimsMatch,
  }
}

function renderResultSummary(result) {
  return `<dl class="result-grid">
          ${renderField("VerusID name", result.verusIdName, result.verusIdName === "Not present" ? "muted" : "success")}
          ${renderField("VerusID address", result.verusId, result.verusId === "Not present" ? "muted" : "success")}
          ${renderField("Granted scope", result.grantedScope, result.grantedScope === scopes ? "success" : "error")}
          ${renderField("Refresh token present", result.refreshTokenPresent ? "yes" : "no", result.refreshTokenPresent ? "success" : "error")}
          ${renderField("ID and access claims match", result.claimsMatch ? "yes" : "no", result.claimsMatch ? "success" : "error")}
        </dl>`
}

function renderStoreSection(result) {
  return `<h3>What your app should store</h3>
        <dl>
          ${renderField("Subject", result.verusId, result.verusId === "Not present" ? "muted" : "success")}
          ${renderField("verus_id", result.verusId, result.verusId === "Not present" ? "muted" : "success")}
          ${renderField("Optional display name", result.verusIdName, result.verusIdName === "Not present" ? "muted" : undefined)}
          ${renderField("Granted scope", result.grantedScope, result.grantedScope === scopes ? "success" : "error")}
          ${renderField("Refresh token", result.refreshTokenPresent ? "Store encrypted server-side or in your normal confidential-token store." : "Not issued; request and grant offline scope for refresh.", result.refreshTokenPresent ? "success" : "error")}
        </dl>`
}

function renderFlowSection(activeStep) {
  const steps = [
    "App redirects to Hydra",
    "Hydra redirects to Verus consent node",
    "Wallet approves VerusID",
    "App receives OAuth callback",
    "Tokens contain Verus claims",
  ]

  return `<div>
        <h3>Flow Status</h3>
        <ol class="flow">
          ${steps.map((step, index) => `<li class="${index < activeStep ? "success" : "muted"}"><span>${index + 1}</span>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>`
}

function renderIntegrationSection(authorizationUrl, code) {
  return `<section id="integration">
        <h2>Integration</h2>
        <p class="muted">Copy the route sequence below into your own relying party. Keep the client secret and refresh token on the server.</p>
        ${renderSnippet("Authorization URL", authorizationUrl)}
        ${renderSnippet("Token exchange request", tokenExchangeSnippet(code || "AUTHORIZATION_CODE"))}
        ${renderSnippet("Introspection request", introspectionSnippet("ACCESS_TOKEN"))}
        ${renderSnippet("Minimal expected Verus claims", JSON.stringify(expectedVerusClaims(), null, 2))}
      </section>`
}

function renderSnippet(title, value) {
  return `<article class="snippet">
          <div class="snippet-head">
            <h3>${escapeHtml(title)}</h3>
            <button type="button" onclick="navigator.clipboard?.writeText(this.closest('.snippet').querySelector('code').innerText)">Copy</button>
          </div>
          <pre><code>${escapeHtml(value)}</code></pre>
        </article>`
}

function tokenExchangeSnippet(code) {
  return `POST ${hydraPublicUrl}/oauth2/token
Authorization: Basic base64(${clientId}:${clientSecret})
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_verifier=CODE_VERIFIER_FROM_SESSION`
}

function introspectionSnippet(token) {
  return `POST ${hydraAdminUrl}/admin/oauth2/introspect
Content-Type: application/x-www-form-urlencoded

token=${encodeURIComponent(token)}`
}

function expectedVerusClaims() {
  return {
    sub: "OAuth subject; same Verus i-address used for verus_id",
    verus_id: "Wallet signing i-address",
    verus_id_name: "Optional resolved VerusID name",
    verus_chain: "VRSCTEST",
    verus_auth_method: "verus_login_consent",
    verus_login_at: "Unix timestamp in seconds",
  }
}

function renderIdentitySummary(claims) {
  if (!claims) {
    return `<p class="muted">No Verus identity claims were available.</p>`
  }

  return `<dl>
          ${verusClaimNames.map((name) => renderField(formatClaimName(name), claims[name] ?? "Not present", claims[name] === undefined ? "muted" : undefined)).join("")}
        </dl>`
}

function renderChecklist(items) {
  return `<ul class="checklist">
          ${items.map((item) => `<li class="${item.ok ? "success" : "error"}"><span>${item.ok ? "OK" : "Fail"}</span>${escapeHtml(item.label)}</li>`).join("")}
        </ul>`
}

function renderClaimsSection(title, note, displayResult) {
  if (!displayResult.claims) {
    return `<div class="subsection">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(note)}</p>
        <p class="error">${escapeHtml(displayResult.error || "Claims were not available.")}</p>
      </div>`
  }

  return `<div class="subsection">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(note)}</p>
        ${renderVerificationStatus(displayResult)}
        ${renderClaimsTable(displayResult.claims)}
      </div>`
}

function renderVerificationStatus(displayResult) {
  const checks = displayResult.checks || []
  return `<dl>
          ${renderField("Status", displayResult.verified ? "verified" : "unverified", displayResult.verified ? "success" : "error")}
          ${displayResult.issuer ? renderField("Issuer", displayResult.issuer) : ""}
          ${checks.map((check) => renderField(check.label, check.ok ? "ok" : check.message || "failed", check.ok ? "success" : "error")).join("")}
        </dl>`
}

function renderIntrospectionSection(introspectionResult) {
  if (!introspectionResult) {
    return `<div class="subsection">
        <h3>Access Token Introspection</h3>
        <p class="muted">No access token was available to introspect.</p>
      </div>`
  }

  const body = introspectionResult.body || {}
  const extClaims = extractVerusClaims(body.ext)

  return `<div class="subsection">
        <h3>Access Token Introspection</h3>
        <dl>
          ${renderField("HTTP status", introspectionResult.status ? `${introspectionResult.status} ${introspectionResult.statusText}` : introspectionResult.statusText, introspectionResult.ok ? "success" : "error")}
          ${renderField("Active", String(Boolean(body.active)), body.active === true ? "success" : "error")}
          ${body.scope ? renderField("Scope", body.scope) : ""}
          ${body.sub ? renderField("Subject", body.sub) : ""}
          ${introspectionResult.error ? renderField("Error", introspectionResult.error, "error") : ""}
        </dl>
        <h3>Verus claims from ext</h3>
        ${renderIdentitySummary(extClaims)}
      </div>`
}

function renderClaimsTable(claims) {
  const entries = Object.entries(claims || {})
  if (!entries.length) {
    return `<p class="muted">No claims were present.</p>`
  }

  return `<dl>
          ${entries.map(([key, value]) => renderField(key, formatClaimValue(value))).join("")}
        </dl>`
}

function buildVerificationChecklist(stateValidation, tokenResult, idTokenDisplay, introspectionResult) {
  const idClaims = extractVerusClaims(idTokenDisplay.claims)
  const accessClaims = extractVerusClaims(introspectionResult?.body?.ext)
  const matchingClaims = Boolean(idClaims && accessClaims && verusClaimsMatch(idClaims, accessClaims))

  return [
    { label: "State matched", ok: stateValidation.ok },
    { label: "Token exchange OK", ok: Boolean(tokenResult?.ok) },
    { label: "ID token signature and standard claims verified", ok: Boolean(idTokenDisplay.verified) },
    { label: `Granted scope is ${scopes}`, ok: tokenResult?.body?.scope === scopes },
    { label: "Refresh token present", ok: Boolean(tokenResult?.body?.refresh_token) },
    { label: "ID token has Verus claims", ok: Boolean(idClaims) },
    { label: "Access token introspection active", ok: Boolean(introspectionResult?.ok && introspectionResult.body?.active === true) },
    { label: "Access token has matching Verus claims", ok: matchingClaims },
  ]
}

async function verifyIdToken(token, accessToken, expectedNonce) {
  const decoded = decodeJwt(token)
  if (!decoded.ok) {
    return { ok: false, verified: false, claims: null, header: null, checks: [], error: decoded.error }
  }

  const result = {
    ok: false,
    verified: false,
    claims: decoded.claims,
    header: decoded.header,
    checks: [],
    issuer: null,
    error: null,
  }

  try {
    const discovery = await fetchOidcDiscovery()
    result.issuer = discovery.issuer
    const jwks = await fetchJwks(discovery.jwks_uri)
    const key = findJwk(jwks, decoded.header)

    if (!key) {
      result.error = "No matching Hydra JWKS key was found for the ID token"
      result.checks.push({ label: "JWKS key", ok: false, message: "not found" })
      return result
    }

    result.checks.push({ label: "JWKS key", ok: true })
    result.checks.push({
      label: "Signature",
      ok: verifyJwtSignature(token, decoded.header, key),
    })
    result.checks.push({
      label: "Issuer",
      ok: decoded.claims.iss === discovery.issuer,
      message: decoded.claims.iss || "missing",
    })
    result.checks.push({
      label: "Audience",
      ok: audienceIncludes(decoded.claims.aud, clientId),
      message: formatClaimValue(decoded.claims.aud || "missing"),
    })
    result.checks.push({
      label: "Nonce",
      ok: Boolean(expectedNonce && decoded.claims.nonce === expectedNonce),
      message: decoded.claims.nonce ? "mismatch" : "missing",
    })
    result.checks.push({
      label: "Expiry",
      ok: typeof decoded.claims.exp === "number" && decoded.claims.exp > Math.floor(Date.now() / 1000),
      message: decoded.claims.exp ? String(decoded.claims.exp) : "missing",
    })

    if (decoded.claims.at_hash !== undefined) {
      result.checks.push({
        label: "at_hash",
        ok: Boolean(accessToken && computeAtHash(accessToken, decoded.header.alg) === decoded.claims.at_hash),
        message: accessToken ? "mismatch" : "missing access token",
      })
    }

    result.verified = result.checks.every((check) => check.ok)
    result.ok = result.verified
    result.error = result.verified ? null : "ID token verification failed"
    return result
  } catch (error) {
    return {
      ...result,
      error: `ID token verification failed: ${error.message}`,
    }
  }
}

async function fetchOidcDiscovery() {
  const response = await fetch(`${hydraPublicUrl}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error || response.statusText)
  }
  if (!body?.issuer || !body?.jwks_uri) {
    throw new Error("Hydra discovery did not include issuer and jwks_uri")
  }
  return body
}

async function fetchJwks(jwksUri) {
  const response = await fetch(jwksUri, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error || response.statusText)
  }
  if (!Array.isArray(body?.keys)) {
    throw new Error("Hydra JWKS did not include keys")
  }
  return body
}

function findJwk(jwks, header) {
  return jwks.keys.find((key) => {
    if (header.kid && key.kid !== header.kid) {
      return false
    }
    return key.use === undefined || key.use === "sig"
  })
}

function verifyJwtSignature(token, header, jwk) {
  if (header.alg !== "RS256") {
    return false
  }

  const parts = String(token).split(".")
  if (parts.length !== 3) {
    return false
  }

  const verifier = crypto.createVerify("RSA-SHA256")
  verifier.update(`${parts[0]}.${parts[1]}`)
  verifier.end()
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" })
  return verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))
}

function computeAtHash(accessToken, alg) {
  if (alg !== "RS256") {
    return null
  }
  const digest = crypto.createHash("sha256").update(accessToken).digest()
  return digest.subarray(0, digest.length / 2).toString("base64url")
}

function audienceIncludes(audience, expectedAudience) {
  return Array.isArray(audience)
    ? audience.includes(expectedAudience)
    : audience === expectedAudience
}

function decodeJwt(token) {
  if (!token) {
    return { ok: false, claims: null, header: null, error: "No ID token returned" }
  }

  const parts = String(token).split(".")
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, claims: null, header: null, error: "ID token is not a complete signed JWT" }
  }

  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
    const payload = Buffer.from(parts[1], "base64url").toString("utf8")
    const claims = JSON.parse(payload)
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      return { ok: false, claims: null, header: null, error: "ID token header is not a JSON object" }
    }
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      return { ok: false, claims: null, header: null, error: "ID token payload is not a JSON object" }
    }
    return { ok: true, claims, header, error: null }
  } catch (error) {
    return { ok: false, claims: null, header: null, error: `Could not decode ID token: ${error.message}` }
  }
}

function extractVerusClaims(source) {
  if (!source || typeof source !== "object") {
    return null
  }

  const claims = {}
  for (const name of verusClaimNames) {
    if (source[name] !== undefined && source[name] !== null && source[name] !== "") {
      claims[name] = source[name]
    }
  }

  return claims.verus_id && claims.verus_chain && claims.verus_auth_method ? claims : null
}

function verusClaimsMatch(idClaims, accessClaims) {
  return verusClaimNames.every((name) => {
    const idValue = idClaims[name]
    const accessValue = accessClaims[name]
    return idValue === undefined || accessValue === undefined || String(idValue) === String(accessValue)
  })
}

function formatClaimName(name) {
  return name.replaceAll("_", " ")
}

function formatClaimValue(value) {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function validateState(expectedState, returnedState) {
  if (!expectedState) {
    return { ok: false, message: "Missing saved state cookie" }
  }
  if (!returnedState) {
    return { ok: false, message: "Missing returned state" }
  }
  const expectedBuffer = Buffer.from(expectedState)
  const returnedBuffer = Buffer.from(returnedState)
  if (
    expectedBuffer.length !== returnedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, returnedBuffer)
  ) {
    return { ok: false, message: "Returned state does not match saved state" }
  }
  return { ok: true, message: "Returned state matches saved state" }
}

function parseCookies(header) {
  return header.split(";").reduce((cookies, pair) => {
    const index = pair.indexOf("=")
    if (index === -1) {
      return cookies
    }
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (name) {
      cookies[name] = decodeURIComponent(value)
    }
    return cookies
  }, {})
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`)
  }
  if (options.path) {
    parts.push(`Path=${options.path}`)
  }
  if (options.httpOnly) {
    parts.push("HttpOnly")
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`)
  }
  return parts.join("; ")
}

function renderField(label, value, status) {
  return `<dt>${escapeHtml(label)}</dt><dd${status ? ` class="${status}"` : ""}>${escapeHtml(value)}</dd>`
}

function randomValue() {
  return crypto.randomBytes(24).toString("base64url")
}

function createPkceChallenge(codeVerifier) {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url")
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sendPlain(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  res.end(body)
}

function sendHtml(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers })
  res.end(body)
}

function styles() {
  return `<style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #1d2430; }
      main { max-width: 920px; margin: 7vh auto; padding: 0 20px; }
      section { background: white; border: 1px solid #d9dee7; border-radius: 8px; padding: 28px; box-shadow: 0 12px 30px rgb(29 36 48 / 8%); }
      section + section { margin-top: 18px; }
      h1 { margin: 0 0 18px; font-size: 24px; }
      h2 { margin: 0 0 18px; font-size: 20px; }
      h3 { margin: 22px 0 14px; font-size: 16px; }
      p { color: #465568; line-height: 1.5; }
      a { color: #1b5fc1; }
      .button { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 6px; background: #1b5fc1; color: white; font-weight: 700; text-decoration: none; }
      .tabs { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; padding: 10px 0; background: #f6f7f9; }
      .tabs a { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid #cdd5e1; border-radius: 6px; background: white; color: #1d2430; font-weight: 700; text-decoration: none; }
      .meta-grid { display: grid; grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr); gap: 18px; margin: 22px 0; }
      .meta-grid h2 { margin-bottom: 10px; font-size: 15px; }
      .scope-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .scope-list li { border: 1px solid #cdd5e1; border-radius: 999px; padding: 4px 9px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #334155; }
      .mono { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .muted { color: #667085; }
      .warning { color: #854d0e; }
      .eyebrow { margin: 0 0 8px; color: #465568; font-size: 13px; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
      .status-panel { border-left: 6px solid #7a8799; }
      .status-panel p:last-child { margin-bottom: 0; }
      .status-success { border-left-color: #166534; }
      .status-error { border-left-color: #b42318; }
      .result-grid { margin-top: 22px; }
      .subsection, .debug-block, .snippet { margin-top: 22px; }
      .snippet { border-top: 1px solid #e4e7ec; padding-top: 16px; }
      .snippet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .snippet-head h3 { margin: 0; }
      button { min-height: 34px; border: 1px solid #b6c2d2; border-radius: 6px; background: #ffffff; color: #1d2430; font-weight: 700; cursor: pointer; }
      .flow { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .flow li { display: flex; align-items: center; gap: 10px; }
      .flow span { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid currentColor; border-radius: 999px; font-size: 12px; font-weight: 700; }
      .checklist { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .checklist li { display: flex; align-items: center; gap: 10px; }
      .checklist span { display: inline-flex; justify-content: center; min-width: 42px; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
      dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 12px 18px; }
      dt { font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      details { margin-top: 18px; border-top: 1px solid #e4e7ec; padding-top: 14px; }
      summary { cursor: pointer; font-weight: 700; }
      pre { overflow: auto; margin: 12px 0 0; padding: 14px; border-radius: 6px; background: #111827; color: #f9fafb; font-size: 12px; line-height: 1.45; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .success { color: #166534; }
      .error { color: #b42318; }
      @media (max-width: 640px) {
        main { margin: 28px auto; }
        section { padding: 22px; }
        .tabs { position: static; }
        .meta-grid { grid-template-columns: 1fr; }
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

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`OAuth test client listening on http://0.0.0.0:${port}`)
  })
}

module.exports = {
  buildAuthorizationUrl,
  buildSignInResult,
  buildVerificationChecklist,
  createPkceChallenge,
  computeAtHash,
  renderClaimsSection,
  renderIntegrationSection,
  renderResultSummary,
  renderTokenSection,
  verifyIdToken,
  verifyJwtSignature,
}
