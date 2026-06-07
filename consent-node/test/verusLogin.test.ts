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
  verifyLoginConsentRequest: vi.fn(),
  verifyLoginConsentResponse: vi.fn(),
}))

vi.mock("../src/config", () => ({
  baseUrl: "http://192.168.0.160:3000",
  hydraAdmin,
  verusChain: "VRSCTEST",
  verusId,
  verusLoginTtlMs: 300000,
  verusServiceId: "fum@",
}))

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  },
}))

vi.mock("verus-typescript-primitives", async () => {
  class LoginConsentChallenge {
    challenge_id: string

    constructor(input: { challenge_id: string }) {
      this.challenge_id = input.challenge_id
    }

    toSha256() {
      return Buffer.from("challenge-hash")
    }
  }

  class LoginConsentRequest {
    challenge: LoginConsentChallenge
    signature?: unknown

    constructor(input: { challenge: LoginConsentChallenge }) {
      this.challenge = input.challenge
    }

    toWalletDeeplinkUri() {
      return `verus://request/${this.challenge.challenge_id}`
    }

    toString() {
      return `request:${this.challenge.challenge_id}`
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
    LoginConsentResponse: class {},
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
          toString: () => pending.qrRequest.toString(),
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

    expect(getPendingLogin(pending.id)?.status).toBe("pending")

    vi.setSystemTime(new Date("2026-06-07T10:35:46Z"))

    expect(getPendingLogin(pending.id)).toBeUndefined()
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
    removePendingLogin(pending.id)

    await expect(completePendingLogin({
      signing_id: "iUserAddress",
      decision: {
        decision_id: pending.verusChallengeId,
        request: {
          toString: () => pending.qrRequest.toString(),
        },
      },
    })).rejects.toThrow("No pending login matches this Verus response.")
  })
})
