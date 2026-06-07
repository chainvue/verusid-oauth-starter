const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const test = require("node:test")

const {
  buildSignInResult,
  buildVerificationChecklist,
  computeAtHash,
  renderClaimsSection,
  renderIntegrationSection,
  renderResultSummary,
  renderTokenSection,
  verifyIdToken,
} = require("./server")

const verusClaims = {
  verus_id_name: "user@",
  verus_id: "iUserAddress",
  verus_chain: "VRSCTEST",
  verus_auth_method: "verus_login_consent",
  verus_login_at: 1780828245,
}

test("callback summary reports exact granted scope and refresh-token presence", () => {
  const tokenResult = {
    ok: true,
    body: {
      scope: "openid offline verusid",
      refresh_token: "secret-refresh-token",
    },
  }
  const idTokenDisplay = { ok: true, claims: verusClaims }
  const introspectionResult = { ok: true, body: { active: true, ext: verusClaims } }
  const result = buildSignInResult(
    verusClaims,
    tokenResult,
    idTokenDisplay,
    introspectionResult,
  )

  assert.equal(result.grantedScope, "openid offline verusid")
  assert.equal(result.refreshTokenPresent, true)
  assert.equal(result.claimsMatch, true)

  const html = renderResultSummary(result)
  assert.match(html, /Granted scope/)
  assert.match(html, /openid offline verusid/)
  assert.match(html, /Refresh token present/)
  assert.match(html, />yes</)
})

test("claim match reports success only when ID token and introspection Verus claims match", () => {
  const tokenResult = {
    ok: true,
    body: {
      scope: "openid offline verusid",
      refresh_token: "secret-refresh-token",
    },
  }
  const introspectionResult = {
    ok: true,
    body: { active: true, ext: { ...verusClaims, verus_id: "iDifferentAddress" } },
  }
  const result = buildSignInResult(
    verusClaims,
    tokenResult,
    { ok: true, claims: verusClaims },
    introspectionResult,
  )

  assert.equal(result.claimsMatch, false)
})

test("callback token debug output displays access, refresh, and ID tokens for the demo", () => {
  const tokenResult = {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      id_token: "secret-id-token",
      token_type: "bearer",
      expires_in: 3600,
      scope: "openid offline verusid",
    },
  }

  const html = renderTokenSection(tokenResult, null)
  assert.match(html, /Debug: raw token response JSON/)
  assert.match(html, /Refresh token present/)
  assert.match(html, />yes</)
  assert.match(html, /secret-access-token/)
  assert.match(html, /secret-refresh-token/)
  assert.match(html, /secret-id-token/)
})

test("copyable integration snippets include token exchange and introspection examples", () => {
  const html = renderIntegrationSection(
    "http://192.168.0.160:4444/oauth2/auth?client_id=verus-local-client",
    "returned-code",
  )

  assert.match(html, /Authorization URL/)
  assert.match(html, /Token exchange request/)
  assert.match(html, /POST http:\/\/192\.168\.0\.160:4444\/oauth2\/token/)
  assert.match(html, /grant_type=authorization_code/)
  assert.match(html, /code=returned-code/)
  assert.match(html, /Introspection request/)
  assert.match(html, /POST http:\/\/127\.0\.0\.1:4445\/admin\/oauth2\/introspect/)
  assert.match(html, /Minimal expected Verus claims/)
  assert.match(html, /verus_id/)
})

test("ID token verification section displays verified and unverified status", () => {
  const verifiedHtml = renderClaimsSection(
    "ID Token Verification",
    "note",
    {
      ok: true,
      verified: true,
      issuer: "http://192.168.0.160:4444",
      claims: verusClaims,
      checks: [{ label: "Signature", ok: true }],
    },
  )
  const unverifiedHtml = renderClaimsSection(
    "ID Token Verification",
    "note",
    {
      ok: false,
      verified: false,
      claims: verusClaims,
      checks: [{ label: "Signature", ok: false, message: "failed" }],
      error: "ID token verification failed",
    },
  )

  assert.match(verifiedHtml, />verified</)
  assert.match(verifiedHtml, /Signature/)
  assert.match(unverifiedHtml, />unverified</)
  assert.match(unverifiedHtml, /failed/)
  assert.match(unverifiedHtml, /iUserAddress/)
})

test("verification checklist requires exact granted scope", () => {
  const good = buildVerificationChecklist(
    { ok: true },
    { ok: true, body: { scope: "openid offline verusid", refresh_token: "present" } },
    { claims: verusClaims },
    { ok: true, body: { active: true, ext: verusClaims } },
  )
  const bad = buildVerificationChecklist(
    { ok: true },
    { ok: true, body: { scope: "openid verusid", refresh_token: "present" } },
    { claims: verusClaims },
    { ok: true, body: { active: true, ext: verusClaims } },
  )

  assert.equal(
    good.find((item) => item.label === "Granted scope is openid offline verusid")?.ok,
    true,
  )
  assert.equal(
    bad.find((item) => item.label === "Granted scope is openid offline verusid")?.ok,
    false,
  )
})

test("verification checklist requires verified ID token", () => {
  const checklist = buildVerificationChecklist(
    { ok: true },
    { ok: true, body: { scope: "openid offline verusid", refresh_token: "present" } },
    { verified: false, claims: verusClaims },
    { ok: true, body: { active: true, ext: verusClaims } },
  )

  assert.equal(
    checklist.find((item) => item.label === "ID token signature and standard claims verified")?.ok,
    false,
  )
})

test("verifyIdToken validates signature, issuer, audience, nonce, expiry, and at_hash", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const accessToken = "access-token-value"
  const jwk = publicKey.export({ format: "jwk" })
  jwk.kid = "test-key"
  jwk.use = "sig"
  const token = signJwt(privateKey, {
    alg: "RS256",
    kid: "test-key",
    typ: "JWT",
  }, {
    iss: "http://192.168.0.160:4444",
    aud: "verus-local-client",
    nonce: "expected-nonce",
    exp: Math.floor(Date.now() / 1000) + 300,
    at_hash: computeAtHash(accessToken, "RS256"),
    ...verusClaims,
  })

  const originalFetch = global.fetch
  global.fetch = async (url) => {
    if (String(url).endsWith("/.well-known/openid-configuration")) {
      return jsonResponse({
        issuer: "http://192.168.0.160:4444",
        jwks_uri: "http://192.168.0.160:4444/.well-known/jwks.json",
      })
    }
    if (String(url).endsWith("/.well-known/jwks.json")) {
      return jsonResponse({ keys: [jwk] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const verified = await verifyIdToken(token, accessToken, "expected-nonce")
    const badNonce = await verifyIdToken(token, accessToken, "wrong-nonce")

    assert.equal(verified.verified, true)
    assert.equal(verified.ok, true)
    assert.equal(verified.claims.verus_id, "iUserAddress")
    assert.equal(badNonce.verified, false)
    assert.equal(
      badNonce.checks.find((check) => check.label === "Nonce")?.ok,
      false,
    )
  } finally {
    global.fetch = originalFetch
  }
})

function signJwt(privateKey, header, claims) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url")
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const signer = crypto.createSign("RSA-SHA256")
  signer.update(`${encodedHeader}.${encodedClaims}`)
  signer.end()
  const signature = signer.sign(privateKey).toString("base64url")
  return `${encodedHeader}.${encodedClaims}.${signature}`
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  }
}
