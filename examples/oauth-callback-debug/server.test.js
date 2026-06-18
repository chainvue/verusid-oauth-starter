const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const test = require("node:test")

const {
  buildAuthorizationUrl,
  buildSignInResult,
  buildVerificationChecklist,
  computeAtHash,
  createPkceChallenge,
  createPkceVerifier,
  exchangeCode,
  introspectAccessToken,
  parseCookies,
  renderClaimsSection,
  renderIdentitySummary,
  renderIntegrationSection,
  renderIntrospectionSection,
  renderResultSummary,
  renderTokenSection,
  serializeCookie,
  validateState,
  verifyIdToken,
  verifyJwtSignature,
} = require("./server")

const verusClaims = {
  verus_id_name: "user@",
  verus_id: "iUserAddress",
  verus_chain: "VRSCTEST",
  verus_auth_method: "verus_login_consent",
  verus_login_at: 1780828245,
}

test("PKCE verifier meets required length bounds", () => {
  const verifier = createPkceVerifier()

  assert.ok(verifier.length >= 43)
  assert.ok(verifier.length <= 128)
})

test("PKCE verifier uses only base64url-safe characters without padding", () => {
  const verifier = createPkceVerifier()

  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(verifier, /=/)
})

test("authorization URL includes PKCE challenge when verifier is provided", () => {
  const url = buildAuthorizationUrl("state-123", "nonce-123", "verifier-123")

  assert.equal(url.searchParams.get("state"), "state-123")
  assert.equal(url.searchParams.get("nonce"), "nonce-123")
  assert.equal(url.searchParams.get("prompt"), "login")
  assert.equal(url.searchParams.get("code_challenge"), createPkceChallenge("verifier-123"))
  assert.equal(url.searchParams.get("code_challenge_method"), "S256")
})

test("authorization URL omits PKCE challenge when verifier is missing", () => {
  const url = buildAuthorizationUrl("state-123", "nonce-123")

  assert.equal(url.searchParams.get("state"), "state-123")
  assert.equal(url.searchParams.get("nonce"), "nonce-123")
  assert.equal(url.searchParams.get("code_challenge"), null)
  assert.equal(url.searchParams.get("code_challenge_method"), null)
})

test("state validation reports missing, mismatched, and matched state", () => {
  assert.deepEqual(validateState("", "returned"), {
    ok: false,
    message: "Missing saved state cookie",
  })
  assert.deepEqual(validateState("saved", ""), {
    ok: false,
    message: "Missing returned state",
  })
  assert.deepEqual(validateState("saved", "tampered"), {
    ok: false,
    message: "Returned state does not match saved state",
  })
  assert.deepEqual(validateState("saved", "saved"), {
    ok: true,
    message: "Returned state matches saved state",
  })
})

test("cookie helpers parse encoded values and serialize OAuth session cookies", () => {
  assert.deepEqual(parseCookies("verus_oauth_state=state%201; ignored; empty=; name=value%3D1"), {
    verus_oauth_state: "state 1",
    empty: "",
    name: "value=1",
  })

  assert.equal(
    serializeCookie("verus_oauth_state", "state 1", {
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 600,
      path: "/callback",
    }),
    "verus_oauth_state=state%201; Max-Age=600; Path=/callback; HttpOnly; SameSite=Lax",
  )
})

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

test("callback token debug output hides raw tokens by default", () => {
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
  assert.match(html, /Refresh token present/)
  assert.match(html, />yes</)
  assert.match(html, /Raw token JSON is hidden/)
  assert.doesNotMatch(html, /secret-access-token/)
  assert.doesNotMatch(html, /secret-refresh-token/)
  assert.doesNotMatch(html, /secret-id-token/)
})

test("callback token debug output displays raw tokens when explicitly enabled", () => {
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

  const html = renderTokenSection(tokenResult, null, true)
  assert.match(html, /Debug: raw token response JSON/)
  assert.match(html, /secret-access-token/)
  assert.match(html, /secret-refresh-token/)
  assert.match(html, /secret-id-token/)
})

test("token debug output renders exchange errors, raw responses, and introspection JSON", () => {
  const tokenResult = {
    ok: false,
    status: 400,
    statusText: "Bad Request",
    body: {
      error: "invalid_grant",
      error_description: "Authorization code was already used.",
      raw: "not-json",
      scope: "openid",
    },
  }
  const introspectionResult = {
    ok: false,
    body: {
      active: false,
      error: "invalid_token",
    },
  }

  const html = renderTokenSection(tokenResult, introspectionResult, true)

  assert.match(html, /Token Exchange Failed/)
  assert.match(html, /400 Bad Request/)
  assert.match(html, /invalid_grant/)
  assert.match(html, /Authorization code was already used/)
  assert.match(html, /Raw response/)
  assert.match(html, /Debug: access-token introspection JSON/)
  assert.match(html, /invalid_token/)
})

test("identity and introspection sections render absent and error states", () => {
  const absentIdentity = renderIdentitySummary(null)
  const noIntrospection = renderIntrospectionSection(null)
  const failedIntrospection = renderIntrospectionSection({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    error: "Hydra admin unavailable",
    body: {
      active: false,
      scope: "openid",
      sub: "iUserAddress",
    },
  })

  assert.match(absentIdentity, /No Verus identity claims/)
  assert.match(noIntrospection, /No access token was available/)
  assert.match(failedIntrospection, /503 Service Unavailable/)
  assert.match(failedIntrospection, /Active/)
  assert.match(failedIntrospection, /false/)
  assert.match(failedIntrospection, /Hydra admin unavailable/)
  assert.match(failedIntrospection, /No Verus identity claims/)
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

test("verifyIdToken reports malformed tokens and missing JWKS keys", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = publicKey.export({ format: "jwk" })
  jwk.kid = "other-key"
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
    const malformed = await verifyIdToken("not-a-jwt", "access-token", "expected-nonce")
    const missingKey = await verifyIdToken(token, "access-token", "expected-nonce")

    assert.equal(malformed.verified, false)
    assert.match(malformed.error, /complete signed JWT/)
    assert.equal(missingKey.verified, false)
    assert.equal(missingKey.checks.find((check) => check.label === "JWKS key")?.ok, false)
    assert.match(missingKey.error, /No matching Hydra JWKS key/)
  } finally {
    global.fetch = originalFetch
  }
})

test("verifyJwtSignature and at_hash reject unsupported algorithms", () => {
  assert.equal(verifyJwtSignature("a.b.c", { alg: "HS256" }, {}), false)
  assert.equal(computeAtHash("access-token", "HS256"), null)
})

test("token exchange and introspection helpers return redacted failure objects", async () => {
  const originalFetch = global.fetch
  global.fetch = async (url) => {
    if (String(url).endsWith("/oauth2/token")) {
      return textResponse({
        error: "invalid_grant",
        error_description: "Bad code",
      }, false, 400, "Bad Request")
    }
    if (String(url).endsWith("/admin/oauth2/introspect")) {
      throw new Error("admin offline")
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const tokenResult = await exchangeCode("bad-code", "verifier")
    const introspectionResult = await introspectAccessToken("access-token")

    assert.equal(tokenResult.ok, false)
    assert.equal(tokenResult.status, 400)
    assert.equal(tokenResult.error, "invalid_grant")
    assert.equal(tokenResult.body.error_description, "Bad code")
    assert.equal(introspectionResult.ok, false)
    assert.equal(introspectionResult.statusText, "Introspection request failed")
    assert.equal(introspectionResult.error, "admin offline")
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

function textResponse(body, ok = true, status = 200, statusText = "OK") {
  return {
    ok,
    status,
    statusText,
    text: async () => JSON.stringify(body),
  }
}
