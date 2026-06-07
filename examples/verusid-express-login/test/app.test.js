import assert from "node:assert/strict"
import crypto from "node:crypto"
import test from "node:test"
import request from "supertest"

import {
  clearOidcCache,
  computeAtHash,
  createConfig,
  VerusOAuthError,
  VerusOAuthErrorCode,
} from "@chainvue/verusid-oauth"
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
  const response = await request(createApp({ config: baseConfig })).get("/")

  assert.equal(response.status, 200)
  assert.match(response.text, /VerusID Express Login/)
  assert.match(response.text, /Login with VerusID/)
  assert.match(response.text, /openid offline verusid/)
})

test("/login sets session cookie and redirects to Hydra authorization URL", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/login")

  assert.equal(response.status, 302)
  const location = new URL(response.headers.location)
  assert.equal(location.origin, "http://192.168.0.160:4444")
  assert.equal(location.pathname, "/oauth2/auth")
  assert.equal(location.searchParams.get("client_id"), "verus-express-login")
  assert.equal(location.searchParams.get("scope"), "openid offline verusid")
  assert.ok(location.searchParams.get("state"))
  assert.ok(location.searchParams.get("nonce"))
  assert.ok(location.searchParams.get("code_challenge"))
  assert.equal(location.searchParams.get("code_challenge_method"), "S256")
  assert.match(String(response.headers["set-cookie"]), /verusid_login_session=/)
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/)
  assert.match(String(response.headers["set-cookie"]), /SameSite=Lax/)
})

test("/callback rejects missing saved state before token exchange", async () => {
  const response = await request(createApp({ config: baseConfig }))
    .get("/callback?code=fake-code&state=returned-state")

  assert.equal(response.status, 400)
  assert.match(response.text, /State validation failed/)
  assert.match(response.text, /Missing saved state/)
})

test("/callback creates sanitized session after verified VerusID OAuth response", async () => {
  clearOidcCache()
  const app = createApp({ config: baseConfig })
  const agent = request.agent(app)
  const login = await agent.get("/login")
  const location = new URL(login.headers.location)
  const nonce = location.searchParams.get("nonce")
  const state = location.searchParams.get("state")
  const { token, accessToken, jwk } = createSignedIdToken({
    nonce,
    atHashAccessToken: "access-token-value",
  })
  const fetchMock = installFetchMock({ token, accessToken, jwk })

  try {
    const callback = await agent.get(`/callback?code=returned-code&state=${encodeURIComponent(state)}`)

    assert.equal(callback.status, 302)
    assert.equal(callback.headers.location, "/")
    assert.ok(fetchMock.tokenBodies[0].get("code_verifier"))

    const me = await agent.get("/me")
    const body = me.body

    assert.equal(me.status, 200)
    assert.equal(body.authenticated, true)
    assert.equal(body.subject, "iUserAddress")
    assert.equal(body.verus.verus_id, "iUserAddress")
    assert.equal(body.grantedScope, "openid offline verusid")
    assert.equal(body.refreshTokenPresent, true)
    assert.equal(body.debugTokens, undefined)
  } finally {
    global.fetch = fetchMock.originalFetch
    clearOidcCache()
  }
})

test("/me includes raw tokens only when SHOW_DEBUG_TOKENS is enabled", async () => {
  clearOidcCache()
  const config = { ...baseConfig, showDebugTokens: true }
  const app = createApp({ config })
  const agent = request.agent(app)
  const login = await agent.get("/login")
  const location = new URL(login.headers.location)
  const nonce = location.searchParams.get("nonce")
  const state = location.searchParams.get("state")
  const { token, accessToken, jwk } = createSignedIdToken({
    nonce,
    atHashAccessToken: "access-token-value",
  })
  const fetchMock = installFetchMock({ token, accessToken, jwk })

  try {
    const callback = await agent.get(`/callback?code=returned-code&state=${encodeURIComponent(state)}`)

    assert.equal(callback.status, 302)
    const me = await agent.get("/me")
    const body = me.body

    assert.equal(me.status, 200)
    assert.equal(body.debugTokens.access_token, "access-token-value")
    assert.equal(body.debugTokens.refresh_token, "refresh-token-value")
    assert.equal(body.debugTokens.id_token, token)
  } finally {
    global.fetch = fetchMock.originalFetch
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
  assert.ok(warnings.some((warning) => warning.includes("express-session")))
  assert.ok(warnings.some((warning) => warning.includes("LOCAL_HOST")))
})

test("/logout clears the local app session", async () => {
  clearOidcCache()
  const app = createApp({ config: baseConfig })
  const agent = request.agent(app)
  const login = await agent.get("/login")
  const location = new URL(login.headers.location)
  const { token, accessToken, jwk } = createSignedIdToken({
    nonce: location.searchParams.get("nonce"),
    atHashAccessToken: "access-token-value",
  })
  const fetchMock = installFetchMock({ token, accessToken, jwk })

  try {
    const callback = await agent.get(`/callback?code=returned-code&state=${encodeURIComponent(location.searchParams.get("state"))}`)
    assert.equal(callback.status, 302)
  } finally {
    global.fetch = fetchMock.originalFetch
    clearOidcCache()
  }

  const logout = await agent.post("/logout")

  assert.equal(logout.status, 302)

  const me = await agent.get("/me")
  assert.equal(me.status, 401)
  assert.deepEqual(me.body, { authenticated: false })
})

test("/callback reports missing saved PKCE verifier", async () => {
  const client = {
    createLoginRequest() {
      return {
        authorizationUrl: new URL("http://192.168.0.160:4444/oauth2/auth?state=saved-state&nonce=saved-nonce"),
        state: "saved-state",
        nonce: "saved-nonce",
      }
    },
    completeLogin(options) {
      assert.equal(options.codeVerifier, undefined)
      throw new VerusOAuthError(
        VerusOAuthErrorCode.MISSING_CODE_VERIFIER,
        "Missing saved PKCE code verifier.",
      )
    },
    toPublicSession(session) {
      return session
    },
  }
  const app = createApp({ config: baseConfig, client })
  const agent = request.agent(app)
  await agent.get("/login")
  const callback = await agent.get("/callback?code=returned-code&state=saved-state")

  assert.equal(callback.status, 400)
  assert.match(callback.text, /Missing PKCE verifier/)
  assert.match(callback.text, /Missing saved PKCE code verifier/)
})

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
  const tokenBodies = []
  global.fetch = async (url, init) => {
    const value = String(url)
    if (value.endsWith("/oauth2/token")) {
      tokenBodies.push(init.body)
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
  return { originalFetch, tokenBodies }
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
