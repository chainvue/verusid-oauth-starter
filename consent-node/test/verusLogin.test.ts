import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hydraAdmin = vi.hoisted(() => ({
  acceptOAuth2LoginRequest: vi.fn(),
}))

const verusId = vi.hoisted(() => ({
  interface: {
    getIdentity: vi.fn(),
    signData: vi.fn(),
  },
  getChainId: vi.fn(),
  getCurrentHeight: vi.fn(),
  verifyLoginConsentRequest: vi.fn(),
  verifyLoginConsentResponse: vi.fn(),
}))

vi.mock("../src/config", () => ({
  baseUrl: "http://192.168.0.160:3000",
  hydraAdmin,
  verusChain: "VRSCTEST",
  verusId,
  verusLoginTtlMs: 300000,
  verusRpcTimeoutMs: 10000,
  verusServiceId: "fum@",
  pendingLoginStore: "memory",
  pendingLoginRedisUrl: "",
  maxPendingLogins: 1,
}))

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  },
}))

vi.mock("verus-typescript-primitives", async () => {
  class LoginConsentChallenge {
    challenge_id: string
    mode?: string

    constructor(input: { challenge_id: string, redirect_uris?: Array<{ mode: string }> }) {
      this.challenge_id = input.challenge_id
      this.mode = input.redirect_uris?.[0]?.mode
    }

    toSha256() {
      return Buffer.from(`challenge-hash:${this.challenge_id}`)
    }
  }

  class LoginConsentRequest {
    challenge: LoginConsentChallenge
    signature?: unknown

    constructor(input: { challenge: LoginConsentChallenge }) {
      this.challenge = input.challenge
    }

    toWalletDeeplinkUri() {
      return `verus://request/${this.challenge.challenge_id}/${this.challenge.mode}`
    }

    toQrString() {
      return `qr:${this.challenge.challenge_id}`
    }

    getChallengeHash(height: number) {
      return Buffer.from(`request-hash:${this.challenge.challenge_id}:${height}`)
    }

    toString() {
      return `request:${this.challenge.challenge_id}:${this.challenge.mode}`
    }
  }

  class LoginConsentResponse {
    decoded?: string

    constructor(input?: { decoded?: string }) {
      this.decoded = input?.decoded
    }

    fromBuffer(buffer: Buffer) {
      this.decoded = buffer.toString("utf8")
    }
  }

  class RequestedPermission {
    constructor(public vdxfid: string) {}
  }

  class RedirectUri {
    constructor(
      public uri: string,
      public mode: string,
    ) {}
  }

  class VerusIDSignature {
    constructor(
      public value: unknown,
      public key: unknown,
    ) {}
  }

  return {
    IDENTITY_VIEW: { vdxfid: "identity.view" },
    IDENTITY_AUTH_SIG_VDXF_KEY: { vdxfid: "auth.sig" },
    LOGIN_CONSENT_REDIRECT_VDXF_KEY: { vdxfid: "redirect" },
    LOGIN_CONSENT_RESPONSE_VDXF_KEY: { vdxfid: "response" },
    LOGIN_CONSENT_WEBHOOK_VDXF_KEY: { vdxfid: "webhook" },
    LoginConsentChallenge,
    LoginConsentRequest,
    LoginConsentResponse,
    RedirectUri,
    RequestedPermission,
    VerusIDSignature,
    toBase58Check: () => "iChallengeAddress",
  }
})

describe("completePendingLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-07T10:30:45Z"))
    verusId.interface.getIdentity.mockReset()
    verusId.interface.signData.mockResolvedValue({
      result: { signature: "service-signature" },
    })
    verusId.getChainId.mockResolvedValue("VRSCTEST")
    verusId.getCurrentHeight.mockResolvedValue(123456)
    verusId.verifyLoginConsentRequest.mockResolvedValue(true)
    verusId.verifyLoginConsentResponse.mockResolvedValue(true)
    hydraAdmin.acceptOAuth2LoginRequest.mockResolvedValue({
      redirect_to: "http://192.168.0.160:4444/continue",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("accepts Hydra login with Verus i-address subject and context", async () => {
    vi.resetModules()
    const { createPendingLogin, completePendingLogin } = await import(
      "../src/verusLogin"
    )

    verusId.interface.getIdentity
      .mockResolvedValueOnce({
        result: { identity: { identityaddress: "iServiceAddress" } },
      })
      .mockResolvedValueOnce({
        result: { identity: { name: "user@" } },
      })

    const pending = await createPendingLogin("login-123")
    const response = {
      signing_id: "iUserAddress",
      decision: {
        decision_id: pending.verusChallengeId,
        request: {
          toString: () => pending.qrRequestValue,
        },
      },
    }

    const session = await completePendingLogin(response)

    expect(session.status).toBe("complete")
    expect(session.verusId).toBe("iUserAddress")
    expect(session.verusIdName).toBe("user@")
    expect(hydraAdmin.acceptOAuth2LoginRequest).toHaveBeenCalledWith({
      loginChallenge: "login-123",
      acceptOAuth2LoginRequest: {
        subject: "iUserAddress",
        remember: true,
        remember_for: 3600,
        acr: "0",
        amr: ["verus_login_consent"],
        context: {
          verus_id: "iUserAddress",
          verus_id_name: "user@",
          verus_chain: "VRSCTEST",
          verus_auth_method: "verus_login_consent",
          verus_login_at: 1780828245,
        },
      },
    })
  })

  it("removes expired pending login sessions during lookup", async () => {
    vi.resetModules()
    const { createPendingLogin, getPendingLogin } = await import(
      "../src/verusLogin"
    )

    verusId.interface.getIdentity.mockResolvedValueOnce({
      result: { identity: { identityaddress: "iServiceAddress" } },
    })

    const pending = await createPendingLogin("login-123")

    expect((await getPendingLogin(pending.id))?.status).toBe("pending")

    vi.setSystemTime(new Date("2026-06-07T10:35:46Z"))

    expect(await getPendingLogin(pending.id)).toBeUndefined()
  })

  it("rejects new pending login sessions when the memory store is full", async () => {
    vi.resetModules()
    const { createPendingLogin } = await import("../src/verusLogin")

    verusId.interface.getIdentity.mockResolvedValue({
      result: { identity: { identityaddress: "iServiceAddress" } },
    })

    await createPendingLogin("login-123")

    vi.clearAllMocks()
    await expect(createPendingLogin("login-456")).rejects.toThrow(
      "Too many pending Verus login requests",
    )
    expect(verusId.interface.getIdentity).not.toHaveBeenCalled()
    expect(verusId.getChainId).not.toHaveBeenCalled()
    expect(verusId.interface.signData).not.toHaveBeenCalled()
  })

  it("signs login consent requests with the challenge hash RPC signData wraps", async () => {
    vi.resetModules()
    const { createPendingLogin } = await import("../src/verusLogin")

    verusId.interface.getIdentity.mockResolvedValueOnce({
      result: { identity: { identityaddress: "iServiceAddress" } },
    })

    await createPendingLogin("login-123")

    expect(verusId.getCurrentHeight).not.toHaveBeenCalled()
    expect(verusId.interface.signData).toHaveBeenNthCalledWith(1, {
      address: "iServiceAddress",
      datahash: Buffer.from("challenge-hash:iChallengeAddress").toString("hex"),
    })
    expect(verusId.interface.signData).toHaveBeenNthCalledWith(2, {
      address: "iServiceAddress",
      datahash: Buffer.from("challenge-hash:iChallengeAddress").toString("hex"),
    })
  })

  it("renders QR codes from wallet deeplinks while keeping redirect-mode deeplinks for the button", async () => {
    vi.resetModules()
    const QRCode = (await import("qrcode")).default
    const { createPendingLogin } = await import("../src/verusLogin")

    verusId.interface.getIdentity.mockResolvedValueOnce({
      result: { identity: { identityaddress: "iServiceAddress" } },
    })

    const pending = await createPendingLogin("login-123")

    expect(QRCode.toDataURL).toHaveBeenCalledWith("verus://request/iChallengeAddress/webhook", {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    })
    expect(pending.deeplink).toBe("verus://request/iChallengeAddress/redirect")
  })

  it("parses raw, VDXF-keyed, named, camelCase, and deeplink login consent responses", async () => {
    vi.resetModules()
    const { parseLoginConsentResponse } = await import("../src/verusLogin")
    const encoded = Buffer.from("wallet-response").toString("base64url")
    const parse = (input: Parameters<typeof parseLoginConsentResponse>[0]) =>
      parseLoginConsentResponse(input) as unknown as { decoded?: string }

    expect(parse(encoded).decoded).toBe("wallet-response")
    expect(parse({ response: encoded }).decoded).toBe("wallet-response")
    expect(parse({ login_consent_response: encoded }).decoded).toBe("wallet-response")
    expect(parse({ loginConsentResponse: encoded }).decoded).toBe("wallet-response")
    expect(parse({ response: undefined, other: encoded }).decoded).toBe("wallet-response")
    expect(parse({
      response: `verus://x-callback-url/login?response=${encoded}`,
    }).decoded).toBe("wallet-response")
    expect(parse({
      response: `verus://x-callback-url/login?response=${encodeURIComponent(encoded)}`,
    }).decoded).toBe("wallet-response")
  })

  it("removes pending login sessions from challenge lookup", async () => {
    vi.resetModules()
    const { createPendingLogin, completePendingLogin, removePendingLogin } = await import(
      "../src/verusLogin"
    )

    verusId.interface.getIdentity.mockResolvedValueOnce({
      result: { identity: { identityaddress: "iServiceAddress" } },
    })

    const pending = await createPendingLogin("login-123")
    await removePendingLogin(pending.id)

    await expect(completePendingLogin({
      signing_id: "iUserAddress",
      decision: {
        decision_id: pending.verusChallengeId,
        request: {
          toString: () => pending.qrRequestValue,
        },
      },
    })).rejects.toThrow("No pending login matches this Verus response.")
  })

  it("times out stalled Verus RPC calls during login creation", async () => {
    vi.resetModules()
    const { createPendingLogin } = await import("../src/verusLogin")

    verusId.interface.getIdentity.mockReturnValueOnce(new Promise(() => {}))

    const pending = createPendingLogin("login-123")
    const rejection = expect(pending).rejects.toThrow("Verus service identity lookup timed out")
    await vi.advanceTimersByTimeAsync(10001)

    await rejection
  })
})
