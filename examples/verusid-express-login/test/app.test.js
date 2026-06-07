import assert from "node:assert/strict"
import crypto from "node:crypto"
import { Readable, Writable } from "node:stream"
import test from "node:test"

import { clearOidcCache, computeAtHash, createConfig } from "@chainvue/verusid-oauth"
import { createApp } from "../src/app.js"
import { getStartupWarnings } from "../src/startup.js"

const baseConfig = createConfig({
  LOCAL_HOST: "192.168.0.160",
  HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
  HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
  CLIENT_ID: "verus-express-login",
  CLIENT_SECRET: "secret",
  REDIRECT_URI: "http://192.168.0.160:5560/callback",
  SESSION_SECRET: "test-secret",
})

const verusClaims = {
  verus_id: "iUserAddress",
  verus_id_name: "user@",
  verus_chain: "VRSCTEST",
  verus_auth_method: "verus_login_consent",
  verus_login_at: 1780828245,
}

test("home page describes the VerusID Express Login starter", async () => {
  const response = await invoke(createApp({ config: baseConfig }), "GET", "/")

  assert.equal(response.status, 200)
  assert.match(response.body, /VerusID Express Login/)
  assert.match(response.body, /Login with VerusID/)
  assert.match(response.body, /openid offline verusid/)
})

test("/login sets session cookie and redirects to Hydra authorization URL", async () => {
  const response = await invoke(createApp({ config: baseConfig }), "GET", "/login")

  assert.equal(response.status, 302)
  const location = new URL(response.headers.location)
  assert.equal(location.origin, "http://192.168.0.160:4444")
  assert.equal(location.pathname, "/oauth2/auth")
  assert.equal(location.searchParams.get("client_id"), "verus-express-login")
  assert.equal(location.searchParams.get("scope"), "openid offline verusid")
  assert.ok(location.searchParams.get("state"))
  assert.ok(location.searchParams.get("nonce"))
  assert.match(String(response.headers["set-cookie"]), /verusid_login_session=/)
})

test("/callback rejects missing saved state before token exchange", async () => {
  const response = await invoke(
    createApp({ config: baseConfig }),
    "GET",
    "/callback?code=fake-code&state=returned-state",
  )

  assert.equal(response.status, 400)
  assert.match(response.body, /State validation failed/)
  assert.match(response.body, /Missing saved state/)
})

test("/callback creates sanitized session after verified VerusID OAuth response", async () => {
  clearOidcCache()
  const sessions = new Map([
    ["session-123", { oauth: { state: "saved-state", nonce: "saved-nonce" } }],
  ])
  const { token, accessToken, jwk } = createSignedIdToken({
    nonce: "saved-nonce",
    atHashAccessToken: "access-token-value",
  })
  const originalFetch = installFetchMock({ token, accessToken, jwk })

  try {
    const app = createApp({ config: baseConfig, sessions })
    const callback = await invoke(
      app,
      "GET",
      "/callback?code=returned-code&state=saved-state",
      { cookie: "verusid_login_session=session-123" },
    )

    assert.equal(callback.status, 302)
    assert.equal(callback.headers.location, "/")

    const me = await invoke(app, "GET", "/me", {
      cookie: "verusid_login_session=session-123",
    })
    const body = JSON.parse(me.body)

    assert.equal(me.status, 200)
    assert.equal(body.authenticated, true)
    assert.equal(body.subject, "iUserAddress")
    assert.equal(body.verus.verus_id, "iUserAddress")
    assert.equal(body.grantedScope, "openid offline verusid")
    assert.equal(body.refreshTokenPresent, true)
    assert.equal(body.debugTokens, undefined)
  } finally {
    global.fetch = originalFetch
    clearOidcCache()
  }
})

test("/me includes raw tokens only when SHOW_DEBUG_TOKENS is enabled", async () => {
  clearOidcCache()
  const sessions = new Map([
    ["debug-session", { oauth: { state: "saved-state", nonce: "saved-nonce" } }],
  ])
  const config = { ...baseConfig, showDebugTokens: true }
  const { token, accessToken, jwk } = createSignedIdToken({
    nonce: "saved-nonce",
    atHashAccessToken: "access-token-value",
  })
  const originalFetch = installFetchMock({ token, accessToken, jwk })

  try {
    const app = createApp({ config, sessions })
    const callback = await invoke(
      app,
      "GET",
      "/callback?code=returned-code&state=saved-state",
      { cookie: "verusid_login_session=debug-session" },
    )

    assert.equal(callback.status, 302)
    const me = await invoke(app, "GET", "/me", {
      cookie: "verusid_login_session=debug-session",
    })
    const body = JSON.parse(me.body)

    assert.equal(me.status, 200)
    assert.equal(body.debugTokens.access_token, "access-token-value")
    assert.equal(body.debugTokens.refresh_token, "refresh-token-value")
    assert.equal(body.debugTokens.id_token, token)
  } finally {
    global.fetch = originalFetch
    clearOidcCache()
  }
})

test("startup warnings catch placeholder and unsafe production env", () => {
  const warnings = getStartupWarnings(
    {
      ...baseConfig,
      sessionSecret: "change-me",
      redirectUri: "http://192.168.0.160:5560/callback",
      localHost: "192.168.0.160",
    },
    { NODE_ENV: "production" },
  )

  assert.ok(warnings.some((warning) => warning.includes("SESSION_SECRET")))
  assert.ok(warnings.some((warning) => warning.includes("HTTPS REDIRECT_URI")))
  assert.ok(warnings.some((warning) => warning.includes("in-memory session Map")))
  assert.ok(warnings.some((warning) => warning.includes("LOCAL_HOST")))
})

test("/logout clears the local app session", async () => {
  const sessions = new Map([
    ["session-123", { login: { subject: "iUserAddress", verus: verusClaims } }],
  ])
  const app = createApp({ config: baseConfig, sessions })

  const logout = await invoke(app, "POST", "/logout", {
    cookie: "verusid_login_session=session-123",
  })

  assert.equal(logout.status, 302)

  const me = await invoke(app, "GET", "/me", {
    cookie: "verusid_login_session=session-123",
  })
  assert.equal(me.status, 401)
  assert.deepEqual(JSON.parse(me.body), { authenticated: false })
})

function invoke(app, method, url, headers = {}, body = "") {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(body || null)
      },
    })
    req.method = method
    req.url = url
    req.headers = headers
    req.connection = { encrypted: false, remoteAddress: "127.0.0.1" }
    req.socket = req.connection

    const chunks = []
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    })
    res.statusCode = 200
    res.headers = {}
    res.setHeader = (name, value) => {
      res.headers[name.toLowerCase()] = value
    }
    res.getHeader = (name) => res.headers[name.toLowerCase()]
    res.removeHeader = (name) => {
      delete res.headers[name.toLowerCase()]
    }
    res.writeHead = (statusCode, headersToSet = {}) => {
      res.statusCode = statusCode
      for (const [name, value] of Object.entries(headersToSet)) {
        res.setHeader(name, value)
      }
      return res
    }
    res.end = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.from(chunk))
      }
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      })
    }

    app.handle(req, res, reject)
  })
}

function createSignedIdToken({ nonce, atHashAccessToken }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const accessToken = "access-token-value"
  const jwk = publicKey.export({ format: "jwk" })
  jwk.kid = "test-key"
  jwk.use = "sig"

  return {
    accessToken,
    jwk,
    token: signJwt(privateKey, {
      alg: "RS256",
      kid: "test-key",
      typ: "JWT",
    }, {
      iss: "http://192.168.0.160:4444",
      aud: "verus-express-login",
      sub: "iUserAddress",
      nonce,
      exp: Math.floor(Date.now() / 1000) + 300,
      at_hash: computeAtHash(atHashAccessToken, "RS256"),
      ...verusClaims,
    }),
  }
}

function installFetchMock({ token, accessToken, jwk }) {
  const originalFetch = global.fetch
  global.fetch = async (url) => {
    const value = String(url)
    if (value.endsWith("/oauth2/token")) {
      return textJsonResponse({
        access_token: accessToken,
        id_token: token,
        refresh_token: "refresh-token-value",
        token_type: "bearer",
        expires_in: 3600,
        scope: "openid offline verusid",
      })
    }
    if (value.endsWith("/.well-known/openid-configuration")) {
      return jsonResponse({
        issuer: "http://192.168.0.160:4444",
        jwks_uri: "http://192.168.0.160:4444/.well-known/jwks.json",
      })
    }
    if (value.endsWith("/.well-known/jwks.json")) {
      return jsonResponse({ keys: [jwk] })
    }
    if (value.endsWith("/admin/oauth2/introspect")) {
      return textJsonResponse({
        active: true,
        sub: "iUserAddress",
        scope: "openid offline verusid",
        ext: verusClaims,
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  return originalFetch
}

function signJwt(privateKey, header, claims) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url")
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const signer = crypto.createSign("RSA-SHA256")
  signer.update(`${encodedHeader}.${encodedClaims}`)
  signer.end()
  return `${encodedHeader}.${encodedClaims}.${signer.sign(privateKey).toString("base64url")}`
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  }
}

function textJsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(body),
  }
}
