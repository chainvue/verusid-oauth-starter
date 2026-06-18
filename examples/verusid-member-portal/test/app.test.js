import assert from "node:assert/strict"
import crypto from "node:crypto"
import test from "node:test"
import request from "supertest"

import { createConfig } from "@chainvue/verusid-oauth"
import { createApp, createMemberPortalConfig, useCases } from "../src/app.js"
import {
  createLoginRequest,
  createPkceVerifier,
} from "../src/oauth.js"

const baseConfig = createConfig({
  LOCAL_HOST: "192.168.0.160",
  HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
  HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
  CLIENT_ID: "verus-member-portal",
  CLIENT_SECRET: "verus-member-secret",
  REDIRECT_URI: "http://192.168.0.160:5570/callback",
  SESSION_SECRET: "test-secret",
})

const verusClaims = {
  verus_id: "iUserAddress",
  verus_id_name: "member@",
  verus_chain: "VRSCTEST",
  verus_auth_method: "verus_login_consent",
  verus_login_at: 1780828245,
}

test("home renders the signed-out member portal state", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/")

  assert.equal(response.status, 200)
  assert.match(response.text, /VerusID member access/)
  assert.match(response.text, /Login with VerusID/)
  assert.match(response.text, /Developer panel/)
  assert.match(response.text, /openid offline verusid/)
  assert.match(response.text, /http:\/\/192\.168\.0\.160:5570\/callback/)
})

test("/use-cases renders all nine real-only use-case examples", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/use-cases")

  assert.equal(response.status, 200)
  assert.match(response.text, /Nine real-only VerusID use cases/)
  assert.match(response.text, /Verus Mobile v1\.1\.0-5 source support/)
  assert.equal(useCases.length, 9)

  for (const useCase of useCases) {
    assert.match(response.text, new RegExp(escapeRegExp(useCase.title)))
    assert.match(response.text, new RegExp(`data-use-case="${escapeRegExp(useCase.slug)}"`))
  }
})

test("/use-cases classifies live, experimental, testnet-flagged, and locked examples", async () => {
  assert.equal(useCases.filter((useCase) => useCase.capability === "live").length, 4)
  assert.equal(useCases.filter((useCase) => useCase.capability === "experimental").length, 1)
  assert.equal(useCases.filter((useCase) => useCase.capability === "testnet-flagged").length, 1)
  assert.equal(useCases.filter((useCase) => useCase.capability === "locked").length, 3)
})

test("/use-cases exposes real CTAs for live OAuth/session examples", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/use-cases")

  assert.equal(response.status, 200)
  assert.match(response.text, /href="\/login">Start sign-in/)
  assert.match(response.text, /href="\/login">Request consent/)
  assert.match(response.text, /href="\/studio">Open studio/)
})

test("/use-cases renders unsupported examples as unavailable without fake wallet links", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/use-cases")
  const unavailableCases = useCases.filter((useCase) => useCase.capability !== "live")

  assert.equal(response.status, 200)
  assert.ok(unavailableCases.length > 0)
  assert.match(response.text, /Experimental gated/)
  assert.match(response.text, /Testnet locked/)
  assert.match(response.text, /Unavailable/)
  assert.match(response.text, /UserDataRequestDetails exists in primitives/i)
  assert.doesNotMatch(response.text, /href="verus:\/\//)
  assert.doesNotMatch(response.text, /data:image\/png/)

  for (const useCase of unavailableCases) {
    const cardStart = response.text.indexOf(`data-use-case="${useCase.slug}"`)
    const nextCard = response.text.indexOf("data-use-case=", cardStart + 1)
    const card = response.text.slice(cardStart, nextCard === -1 ? undefined : nextCard)
    if (useCase.capability !== "experimental") {
      assert.match(card, /Unavailable/)
      assert.doesNotMatch(card, /href="\/login"/)
      assert.doesNotMatch(card, /href="\/studio"/)
    }
  }
})

test("/use-cases/:slug renders focused live and locked details", async () => {
  const app = createApp({ config: baseConfig })

  const wired = await request(app).get("/use-cases/identity-gated-access")
  assert.equal(wired.status, 200)
  assert.match(wired.text, /Working example/)
  assert.match(wired.text, /href="\/studio">Open studio/)
  assert.match(wired.text, /Wired to supported wallet and portal behavior/)

  const locked = await request(app).get("/use-cases/profile-fields")
  assert.equal(locked.status, 200)
  assert.match(locked.text, /Locked capability/)
  assert.match(locked.text, /Unavailable/)
  assert.match(locked.text, /no QR code, deeplink, fake approval/)
  assert.doesNotMatch(locked.text, /href="verus:\/\//)
})

test("VerusPay renders no deeplink or QR until payment config is present", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/use-cases/veruspay-checkout")

  assert.equal(response.status, 200)
  assert.match(response.text, /Set VERUSPAY_DESTINATION and VERUSPAY_AMOUNT/)
  assert.doesNotMatch(response.text, /href="verus:\/\//)
  assert.doesNotMatch(response.text, /data:image\/png/)
})

test("experimental GenericRequest demo shows wallet prerequisite and request status", async () => {
  const config = createMemberPortalConfig({
    LOCAL_HOST: "192.168.0.160",
    PORT: "5570",
    HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
    HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
    CLIENT_ID: "verus-member-portal",
    CLIENT_SECRET: "verus-member-secret",
    REDIRECT_URI: "http://192.168.0.160:5570/callback",
    SESSION_SECRET: "test-secret",
    VERUS_GENERIC_REQUESTS_ENABLED: "true",
  })
  const app = createApp({ config })
  const response = await request(app).get("/use-cases/oauth-consent")

  assert.equal(response.status, 200)
  assert.match(response.text, /Settings -&gt; General -&gt; Enable experimental deeplinks/)
  assert.match(response.text, /href="verus:\/\//)
  assert.match(response.text, /data:image\/png/)

  const statusPath = response.text.match(/\/use-cases\/requests\/[0-9a-f-]+\/status/)?.[0]
  assert.ok(statusPath)
  const status = await request(app).get(statusPath)
  assert.equal(status.status, 200)
  assert.equal(status.body.status, "pending")
})

test("app encryption remains explicit about required encryption config", async () => {
  const config = createMemberPortalConfig({
    LOCAL_HOST: "192.168.0.160",
    PORT: "5570",
    HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
    HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
    CLIENT_ID: "verus-member-portal",
    CLIENT_SECRET: "verus-member-secret",
    REDIRECT_URI: "http://192.168.0.160:5570/callback",
    SESSION_SECRET: "test-secret",
    VERUS_GENERIC_REQUESTS_ENABLED: "true",
  })
  const response = await request(createApp({ config })).get("/use-cases/encrypted-payload-exchange")

  assert.equal(response.status, 200)
  assert.match(response.text, /VERUS_APP_ENCRYPTION_ADDRESS/)
  assert.match(response.text, /does not fake decryption/)
  assert.doesNotMatch(response.text, /href="verus:\/\//)
})

test("GenericResponse POST endpoint records valid binary metadata and rejects malformed payloads", async () => {
  const config = createMemberPortalConfig({
    LOCAL_HOST: "192.168.0.160",
    PORT: "5570",
    HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
    HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
    CLIENT_ID: "verus-member-portal",
    CLIENT_SECRET: "verus-member-secret",
    REDIRECT_URI: "http://192.168.0.160:5570/callback",
    SESSION_SECRET: "test-secret",
    VERUS_GENERIC_REQUESTS_ENABLED: "true",
  })
  const app = createApp({ config })
  const page = await request(app).get("/use-cases/oauth-consent")
  const statusPath = page.text.match(/\/use-cases\/requests\/[0-9a-f-]+\/status/)?.[0]
  assert.ok(statusPath)
  const responsePath = statusPath.replace(/\/status$/, "/response")

  const malformed = await request(app)
    .post(responsePath)
    .set("content-type", "application/octet-stream")
    .send(Buffer.from("not-a-generic-response"))
  assert.equal(malformed.status, 400)

  const errored = await request(app).get(statusPath)
  assert.equal(errored.body.status, "error")

  const secondPage = await request(app).get("/use-cases/oauth-consent")
  const secondStatusPath = secondPage.text.match(/\/use-cases\/requests\/[0-9a-f-]+\/status/)?.[0]
  assert.ok(secondStatusPath)
  const secondResponsePath = secondStatusPath.replace(/\/status$/, "/response")
  const accepted = await request(app)
    .post(secondResponsePath)
    .set("content-type", "application/octet-stream")
    .send(Buffer.from([1, 4, 254, 40, 101, 48, 106, 0]))
  assert.equal(accepted.status, 200)

  const complete = await request(app).get(secondStatusPath)
  assert.equal(complete.body.status, "complete")
  assert.equal(complete.body.responseBytes, 8)
  assert.match(complete.body.responseHash, /^[0-9a-f]{64}$/)
})

test("identity update stays locked unless explicit testnet flag and config are present", async () => {
  const locked = await request(createApp({ config: baseConfig })).get("/use-cases/identity-maintenance")
  assert.equal(locked.status, 200)
  assert.match(locked.text, /Locked capability/)
  assert.match(locked.text, /VERUS_IDENTITY_UPDATE_DEMO_ENABLED=true/)

  const config = createMemberPortalConfig({
    LOCAL_HOST: "192.168.0.160",
    PORT: "5570",
    HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
    HYDRA_ADMIN_URL: "http://127.0.0.1:4445",
    CLIENT_ID: "verus-member-portal",
    CLIENT_SECRET: "verus-member-secret",
    REDIRECT_URI: "http://192.168.0.160:5570/callback",
    SESSION_SECRET: "test-secret",
    VERUS_IDENTITY_UPDATE_DEMO_ENABLED: "true",
    VERUS_IDENTITY_UPDATE_TESTNET: "VRSCTEST",
  })
  const enabled = await request(createApp({ config })).get("/use-cases/identity-maintenance")
  assert.equal(enabled.status, 200)
  assert.match(enabled.text, /Testnet-only demo/)
  assert.match(enabled.text, /No identity update transaction is built or submitted/)
  assert.doesNotMatch(enabled.text, /href="verus:\/\//)
})

test("/login redirects to Hydra with prompt=login and S256 PKCE", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/login")

  assert.equal(response.status, 302)
  const location = new URL(response.headers.location)
  assert.equal(location.origin, "http://192.168.0.160:4444")
  assert.equal(location.pathname, "/oauth2/auth")
  assert.equal(location.searchParams.get("client_id"), "verus-member-portal")
  assert.equal(location.searchParams.get("scope"), "openid offline verusid")
  assert.equal(location.searchParams.get("redirect_uri"), "http://192.168.0.160:5570/callback")
  assert.equal(location.searchParams.get("prompt"), "login")
  assert.ok(location.searchParams.get("state"))
  assert.ok(location.searchParams.get("nonce"))
  assert.ok(location.searchParams.get("code_challenge"))
  assert.equal(location.searchParams.get("code_challenge_method"), "S256")
  assert.match(String(response.headers["set-cookie"]), /verusid_member_portal=/)
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/)
  assert.match(String(response.headers["set-cookie"]), /SameSite=Lax/)
})

test("login request uses a compliant 32-byte PKCE verifier", () => {
  const verifier = createPkceVerifier()
  const loginRequest = createLoginRequest(baseConfig)

  assert.ok(verifier.length >= 43)
  assert.ok(verifier.length <= 128)
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(verifier, /=/)
  assert.ok(loginRequest.codeVerifier.length >= 43)
  assert.ok(loginRequest.codeVerifier.length <= 128)
  assert.equal(
    loginRequest.authorizationUrl.searchParams.get("code_challenge"),
    crypto.createHash("sha256").update(loginRequest.codeVerifier).digest("base64url"),
  )
  assert.equal(loginRequest.authorizationUrl.searchParams.get("code_challenge_method"), "S256")
  assert.equal(loginRequest.authorizationUrl.searchParams.get("prompt"), "login")
})

test("member portal config preserves Docker Hydra environment overrides", () => {
  const config = createMemberPortalConfig({
    LOCAL_HOST: "192.168.0.160",
    PORT: "5570",
    HYDRA_PUBLIC_URL: "http://192.168.0.160:4444",
    HYDRA_ADMIN_URL: "http://hydra:4445",
    CLIENT_ID: "verus-member-portal",
    CLIENT_SECRET: "verus-member-secret",
    REDIRECT_URI: "http://192.168.0.160:5570/callback",
    SCOPES: "openid offline verusid",
    SESSION_SECRET: "test-secret",
  })

  assert.equal(config.port, 5570)
  assert.equal(config.hydraPublicUrl, "http://192.168.0.160:4444")
  assert.equal(config.hydraAdminUrl, "http://hydra:4445")
  assert.equal(config.clientId, "verus-member-portal")
  assert.equal(config.redirectUri, "http://192.168.0.160:5570/callback")
})

test("/callback creates a sanitized member session after verification", async () => {
  const client = {
    async completeLogin(options) {
      assert.equal(options.code, "returned-code")
      assert.equal(options.returnedState, options.expectedState)
      assert.ok(options.expectedNonce)
      assert.ok(options.codeVerifier)
      assert.equal(options.includeRawTokens, undefined)
      return {
        subject: "iUserAddress",
        verus: verusClaims,
        grantedScope: "openid offline verusid",
        refreshTokenPresent: true,
        tokens: {
          access_token: "raw-access-token",
          id_token: "raw-id-token",
          refresh_token: "raw-refresh-token",
        },
      }
    },
    toPublicSession(session) {
      return {
        subject: session.subject,
        verus: session.verus,
        grantedScope: session.grantedScope,
        refreshTokenPresent: session.refreshTokenPresent,
      }
    },
  }
  const app = createApp({ config: baseConfig, client })
  const agent = request.agent(app)
  const login = await agent.get("/login")
  const location = new URL(login.headers.location)
  const state = location.searchParams.get("state")

  const callback = await agent.get(`/callback?code=returned-code&state=${encodeURIComponent(state)}`)

  assert.equal(callback.status, 302)
  assert.equal(callback.headers.location, "/")

  const home = await agent.get("/")
  assert.equal(home.status, 200)
  assert.match(home.text, /VerusID Passport/)
  assert.match(home.text, /member@/)

  const me = await agent.get("/me")
  assert.equal(me.status, 200)
  assert.equal(me.body.authenticated, true)
  assert.equal(me.body.subject, "iUserAddress")
  assert.equal(me.body.verus.verus_id, "iUserAddress")
  assert.equal(me.body.grantedScope, "openid offline verusid")
  assert.equal(me.body.refreshTokenPresent, true)
  assert.ok(me.body.loginTime)
  assert.equal(me.body.tokens, undefined)
  assert.equal(me.body.debugTokens, undefined)
})

test("/callback explains missing OAuth session state", async () => {
  const response = await request(createApp({ config: baseConfig })).get("/callback?code=returned-code&state=missing")

  assert.equal(response.status, 400)
  assert.match(response.text, /OAuth session not found/)
  assert.match(response.text, /same browser host and port/)
  assert.match(response.text, /http:\/\/192\.168\.0\.160:5570\/callback/)
})

test("protected pages redirect or reject when unauthenticated", async () => {
  const app = createApp({ config: baseConfig })

  for (const path of ["/account", "/activity", "/settings"]) {
    const response = await request(app).get(path)
    assert.equal(response.status, 302)
    assert.equal(response.headers.location, "/?login=required")
  }

  const me = await request(app).get("/me")
  assert.equal(me.status, 401)
  assert.deepEqual(me.body, { authenticated: false })
})

test("/studio redirects when signed out and renders when signed in", async () => {
  const signedOut = await request(createApp({ config: baseConfig })).get("/studio")
  assert.equal(signedOut.status, 302)
  assert.equal(signedOut.headers.location, "/login")

  const agent = await signedInAgent()
  const signedIn = await agent.get("/studio")
  assert.equal(signedIn.status, 200)
  assert.match(signedIn.text, /Protected studio/)
  assert.match(signedIn.text, /member@ workspace/)
  assert.match(signedIn.text, /real identity-gated access use case/)
})

test("/me excludes raw tokens by default", async () => {
  const agent = await signedInAgent()
  const response = await agent.get("/me")

  assert.equal(response.status, 200)
  assert.equal(response.body.tokens, undefined)
  assert.equal(response.body.access_token, undefined)
  assert.equal(response.body.id_token, undefined)
  assert.equal(response.body.refresh_token, undefined)
  assert.equal(response.text.includes("raw-access-token"), false)
})

test("/logout clears the member session", async () => {
  const agent = await signedInAgent()

  const before = await agent.get("/me")
  assert.equal(before.status, 200)

  const logout = await agent.post("/logout")
  assert.equal(logout.status, 302)
  assert.equal(logout.headers.location, "/")

  const after = await agent.get("/me")
  assert.equal(after.status, 401)
  assert.deepEqual(after.body, { authenticated: false })
})

async function signedInAgent() {
  const client = {
    async completeLogin() {
      return {
        subject: "iUserAddress",
        verus: verusClaims,
        grantedScope: "openid offline verusid",
        refreshTokenPresent: true,
        tokens: {
          access_token: "raw-access-token",
          id_token: "raw-id-token",
          refresh_token: "raw-refresh-token",
        },
      }
    },
    toPublicSession(session) {
      return {
        subject: session.subject,
        verus: session.verus,
        grantedScope: session.grantedScope,
        refreshTokenPresent: session.refreshTokenPresent,
      }
    },
  }
  const app = createApp({ config: baseConfig, client })
  const agent = request.agent(app)
  const login = await agent.get("/login")
  const location = new URL(login.headers.location)
  await agent.get(`/callback?code=returned-code&state=${encodeURIComponent(location.searchParams.get("state"))}`)
  return agent
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
