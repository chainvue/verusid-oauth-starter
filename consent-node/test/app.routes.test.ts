import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

const hydraAdmin = vi.hoisted(() => ({
  getOAuth2LoginRequest: vi.fn(),
  acceptOAuth2LoginRequest: vi.fn(),
  rejectOAuth2LoginRequest: vi.fn(),
  getOAuth2ConsentRequest: vi.fn(),
  acceptOAuth2ConsentRequest: vi.fn(),
  rejectOAuth2ConsentRequest: vi.fn(),
}))

const verusLogin = vi.hoisted(() => ({
  createPendingLogin: vi.fn(),
  parseLoginConsentResponse: vi.fn(),
  completePendingLogin: vi.fn(),
  getPendingLogin: vi.fn(),
  removePendingLogin: vi.fn(),
}))

vi.mock("../src/config", () => ({
  hydraAdmin,
  baseUrl: "http://192.168.0.160:3000",
  verusChain: "VRSCTEST",
  verusId: {},
  verusLoginTtlMs: 300000,
  verusServiceId: "fum@",
}))

vi.mock("../src/routes/csrf", () => ({
  csrfProtection: (
    req: request.Request & { csrfToken?: () => string },
    _res: unknown,
    next: () => void,
  ) => {
    req.csrfToken = () => "test-csrf"
    next()
  },
}))

vi.mock("../src/verusLogin", () => verusLogin)

describe("consent-node routes", () => {
  let app: import("express").Express

  beforeEach(async () => {
    vi.clearAllMocks()
    app = (await import("../src/app")).createApp()
  })

  it("returns health status", async () => {
    await request(app).get("/health").expect(200, { status: "ok" })
  })

  it("requires a Hydra login challenge", async () => {
    const response = await request(app).get("/login").expect(500)

    expect(response.text).toContain(
      "Expected a login challenge to be set but received none.",
    )
  })

  it("renders QR, deeplink, retry, polling status URL, and CSRF fields", async () => {
    hydraAdmin.getOAuth2LoginRequest.mockResolvedValue({
      skip: false,
      oidc_context: { login_hint: "fum@" },
    })
    verusLogin.createPendingLogin.mockResolvedValue({
      id: "pending-123",
      qrDataUrl: "data:image/png;base64,abc123",
      deeplink: "verus://login-consent/request",
    })

    const response = await request(app)
      .get("/login?login_challenge=login-123")
      .expect(200)

    expect(response.text).toContain("data:image/png;base64,abc123")
    expect(response.text).toContain("Open Wallet")
    expect(response.text).toContain("verus://login-consent/request")
    expect(response.text).toContain("Retry")
    expect(response.text).toContain("/verus/status/pending-123")
    expect(response.text).toContain('name="_csrf" value="test-csrf"')
    expect(response.text).toContain('name="challenge" value="login-123"')
  })

  it.each([
    ["missing", new Error("Missing login consent response.")],
    ["malformed", new Error("Unable to decode login consent response.")],
    ["unknown", new Error("No pending login matches this Verus response.")],
  ])("rejects %s Verus callbacks with a clear error", async (_name, error) => {
    verusLogin.parseLoginConsentResponse.mockImplementation(() => {
      throw error
    })

    const response = await request(app)
      .post("/verus/callback")
      .type("text/plain")
      .send("")
      .expect(400)

    expect(response.body).toEqual({
      status: "error",
      error: error.message,
    })
  })

  it("rejects wallet-denied Verus callbacks", async () => {
    verusLogin.parseLoginConsentResponse.mockReturnValue({ decision: {} })
    verusLogin.completePendingLogin.mockResolvedValue({
      status: "rejected",
      error: "The wallet rejected the Verus login request.",
    })

    await request(app)
      .post("/verus/callback")
      .send({ response: "accepted-shape" })
      .expect(403, {
        status: "rejected",
        error: "The wallet rejected the Verus login request.",
      })
  })

  it("rejects invalid Verus responses", async () => {
    verusLogin.parseLoginConsentResponse.mockReturnValue({ decision: {} })
    verusLogin.completePendingLogin.mockResolvedValue({
      status: "error",
      error: "The Verus login response signature is invalid.",
    })

    await request(app)
      .post("/verus/callback")
      .send({ response: "invalid-signature" })
      .expect(400, {
        status: "error",
        error: "The Verus login response signature is invalid.",
      })
  })

  it("returns completed Verus callback details", async () => {
    verusLogin.parseLoginConsentResponse.mockReturnValue({ decision: {} })
    verusLogin.completePendingLogin.mockResolvedValue({
      id: "pending-123",
      status: "complete",
      verusId: "iUserAddress",
      verusIdName: "user@",
    })

    await request(app).post("/verus/callback").send({ response: "ok" }).expect(200, {
      status: "complete",
      verusId: "iUserAddress",
      verusIdName: "user@",
    })
    expect(verusLogin.removePendingLogin).toHaveBeenCalledWith("pending-123")
  })

  it("returns terminal status once and then prunes it", async () => {
    verusLogin.getPendingLogin.mockReturnValue({
      id: "pending-123",
      status: "complete",
      redirectTo: "http://192.168.0.160:4444/continue",
      verusId: "iUserAddress",
      verusIdName: "user@",
    })

    await request(app).get("/verus/status/pending-123").expect(200, {
      status: "complete",
      redirectTo: "http://192.168.0.160:4444/continue",
      verusId: "iUserAddress",
      verusIdName: "user@",
    })

    expect(verusLogin.removePendingLogin).toHaveBeenCalledWith("pending-123")
  })

  it("copies Verus claims into accepted consent token sessions", async () => {
    const expectedClaims = {
      verus_id: "iUserAddress",
      verus_id_name: "user@",
      verus_chain: "VRSCTEST",
      verus_auth_method: "verus_login_consent",
      verus_login_at: 1780828245,
    }

    hydraAdmin.getOAuth2ConsentRequest.mockResolvedValue({
      subject: "iUserAddress",
      requested_scope: ["openid", "offline", "verusid", "email", "profile"],
      requested_access_token_audience: ["api"],
      context: {
        ...expectedClaims,
        email: "user@example.com",
        email_verified: true,
        name: "User Example",
        preferred_username: "user",
      },
    })
    hydraAdmin.acceptOAuth2ConsentRequest.mockResolvedValue({
      redirect_to: "http://192.168.0.160:4444/continue",
    })

    await request(app)
      .post("/consent")
      .type("form")
      .send({
        challenge: "consent-123",
        grant_scope: ["openid", "verusid"],
        remember: "1",
        _csrf: "test-csrf",
      })
      .expect(302)

    expect(hydraAdmin.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: "consent-123",
      acceptOAuth2ConsentRequest: expect.objectContaining({
        grant_scope: ["openid", "verusid"],
        grant_access_token_audience: ["api"],
        session: {
          access_token: expectedClaims,
          id_token: expectedClaims,
        },
      }),
    })
    const acceptRequest =
      hydraAdmin.acceptOAuth2ConsentRequest.mock.calls[0][0]
        .acceptOAuth2ConsentRequest
    expect(Object.keys(acceptRequest.session.access_token).sort()).toEqual(
      Object.keys(expectedClaims).sort(),
    )
    expect(Object.keys(acceptRequest.session.id_token).sort()).toEqual(
      Object.keys(expectedClaims).sort(),
    )
    expect(acceptRequest.session.access_token).not.toHaveProperty("email")
    expect(acceptRequest.session.access_token).not.toHaveProperty(
      "email_verified",
    )
    expect(acceptRequest.session.access_token).not.toHaveProperty("name")
    expect(acceptRequest.session.access_token).not.toHaveProperty(
      "preferred_username",
    )
  })

  it("filters accepted consent grants to local demo scopes", async () => {
    hydraAdmin.getOAuth2ConsentRequest.mockResolvedValue({
      subject: "iUserAddress",
      requested_scope: ["openid", "offline", "verusid", "email", "profile"],
      requested_access_token_audience: ["api"],
      context: {
        verus_id: "iUserAddress",
        verus_id_name: "user@",
        verus_chain: "VRSCTEST",
        verus_auth_method: "verus_login_consent",
      },
    })
    hydraAdmin.acceptOAuth2ConsentRequest.mockResolvedValue({
      redirect_to: "http://192.168.0.160:4444/continue",
    })

    await request(app)
      .post("/consent")
      .type("form")
      .send({
        challenge: "consent-123",
        grant_scope: ["openid", "offline", "verusid", "email", "profile"],
        remember: "1",
        _csrf: "test-csrf",
      })
      .expect(302)

    expect(hydraAdmin.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: "consent-123",
      acceptOAuth2ConsentRequest: expect.objectContaining({
        grant_scope: ["openid", "offline", "verusid"],
      }),
    })
  })

  it("does not grant local demo scopes that Hydra did not request", async () => {
    hydraAdmin.getOAuth2ConsentRequest.mockResolvedValue({
      subject: "iUserAddress",
      requested_scope: ["openid"],
      requested_access_token_audience: ["api"],
      context: {
        verus_id: "iUserAddress",
        verus_id_name: "user@",
        verus_chain: "VRSCTEST",
        verus_auth_method: "verus_login_consent",
      },
    })
    hydraAdmin.acceptOAuth2ConsentRequest.mockResolvedValue({
      redirect_to: "http://192.168.0.160:4444/continue",
    })

    await request(app)
      .post("/consent")
      .type("form")
      .send({
        challenge: "consent-123",
        grant_scope: ["openid", "offline", "verusid"],
        remember: "1",
        _csrf: "test-csrf",
      })
      .expect(302)

    expect(hydraAdmin.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: "consent-123",
      acceptOAuth2ConsentRequest: expect.objectContaining({
        grant_scope: ["openid"],
      }),
    })
  })

  it("copies Verus claims into skipped consent token sessions", async () => {
    const expectedClaims = {
      verus_id: "iUserAddress",
      verus_id_name: "user@",
      verus_chain: "VRSCTEST",
      verus_auth_method: "verus_login_consent",
      verus_login_at: 1780828245,
    }

    hydraAdmin.getOAuth2ConsentRequest.mockResolvedValue({
      skip: true,
      subject: "iUserAddress",
      requested_scope: ["openid", "offline", "verusid", "email", "profile"],
      requested_access_token_audience: ["api"],
      context: {
        ...expectedClaims,
        email: "user@example.com",
        email_verified: true,
        name: "User Example",
        preferred_username: "user",
      },
    })
    hydraAdmin.acceptOAuth2ConsentRequest.mockResolvedValue({
      redirect_to: "http://192.168.0.160:4444/continue",
    })

    await request(app)
      .get("/consent?consent_challenge=consent-123")
      .expect(302)

    expect(hydraAdmin.acceptOAuth2ConsentRequest).toHaveBeenCalledWith({
      consentChallenge: "consent-123",
      acceptOAuth2ConsentRequest: expect.objectContaining({
        grant_scope: ["openid", "offline", "verusid"],
        grant_access_token_audience: ["api"],
        session: {
          access_token: expectedClaims,
          id_token: expectedClaims,
        },
      }),
    })
  })

  it("renders only local demo consent scopes", async () => {
    hydraAdmin.getOAuth2ConsentRequest.mockResolvedValue({
      subject: "iUserAddress",
      requested_scope: ["openid", "offline", "verusid", "email", "profile"],
      context: {
        verus_id_name: "user@",
      },
      client: {
        client_id: "verus-local-client",
      },
    })

    const response = await request(app)
      .get("/consent?consent_challenge=consent-123")
      .expect(200)

    expect(response.text).toContain('value="openid"')
    expect(response.text).toContain('value="offline"')
    expect(response.text).toContain('value="verusid"')
    expect(response.text).not.toContain('value="email"')
    expect(response.text).not.toContain('value="profile"')
  })
})
