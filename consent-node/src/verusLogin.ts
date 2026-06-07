import crypto from "crypto"

import QRCode from "qrcode"
import {
  IDENTITY_VIEW,
  IDENTITY_AUTH_SIG_VDXF_KEY,
  LOGIN_CONSENT_REDIRECT_VDXF_KEY,
  LOGIN_CONSENT_RESPONSE_VDXF_KEY,
  LOGIN_CONSENT_WEBHOOK_VDXF_KEY,
  LoginConsentChallenge,
  LoginConsentRequest,
  LoginConsentResponse,
  RedirectUri,
  RequestedPermission,
  toBase58Check,
  VerusIDSignature,
} from "verus-typescript-primitives"

import {
  baseUrl,
  hydraAdmin,
  verusChain,
  verusId,
  verusLoginTtlMs,
  verusServiceId,
} from "./config"

type ResolvedIdentity = NonNullable<
  Awaited<ReturnType<typeof verusId.interface.getIdentity>>["result"]
>

export type PendingVerusLogin = {
  id: string
  loginChallenge: string
  verusChallengeId: string
  createdAt: number
  qrRequest: LoginConsentRequest
  deeplinkRequest: LoginConsentRequest
  deeplink: string
  qrDataUrl: string
  status: "pending" | "complete" | "expired" | "rejected" | "error"
  error?: string
  redirectTo?: string
  verusId?: string
  verusIdName?: string
}

class MemoryPendingLoginStore {
  private readonly byId = new Map<string, PendingVerusLogin>()
  private readonly byChallengeId = new Map<string, string>()

  set(session: PendingVerusLogin) {
    this.byId.set(session.id, session)
    this.byChallengeId.set(session.verusChallengeId, session.id)
  }

  getById(id: string) {
    return this.byId.get(id)
  }

  getPendingByChallengeId(challengeId: string | undefined) {
    if (!challengeId) {
      return undefined
    }
    const id = this.byChallengeId.get(challengeId)
    const session = id ? this.byId.get(id) : undefined
    return session?.status === "pending" ? session : undefined
  }

  delete(id: string) {
    const session = this.byId.get(id)
    if (session) {
      this.byChallengeId.delete(session.verusChallengeId)
    }
    this.byId.delete(id)
  }

  cleanupExpired(ttlMs: number) {
    const now = Date.now()

    for (const [id, session] of this.byId.entries()) {
      if (
        session.status === "pending" &&
        now - session.createdAt > ttlMs
      ) {
        this.delete(id)
      }
    }
  }
}

const pendingStore = new MemoryPendingLoginStore()
const I_ADDR_VERSION = 102

function randomIAddressLikeId() {
  return toBase58Check(crypto.randomBytes(20), I_ADDR_VERSION)
}

function cleanupExpired() {
  pendingStore.cleanupExpired(verusLoginTtlMs)
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padding = normalized.length % 4
  return Buffer.from(
    padding ? normalized + "=".repeat(4 - padding) : normalized,
    "base64",
  )
}

function parseResponseValue(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Missing login consent response.")
  }

  const withoutDeeplink = value.includes(`${LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid}=`)
    ? value.split(`${LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid}=`).pop() || ""
    : value

  const response = new LoginConsentResponse()
  response.fromBuffer(decodeBase64Url(decodeURIComponent(withoutDeeplink)))
  return response
}

async function createSignedLoginConsentRequest(
  serviceIAddress: string,
  systemId: string,
  challengeId: string,
  callbackUrl: string,
  returnMode: string,
  serviceIdentity: ResolvedIdentity,
) {
  const challenge = new LoginConsentChallenge({
    challenge_id: challengeId,
    requested_access: [new RequestedPermission(IDENTITY_VIEW.vdxfid)],
    redirect_uris: [new RedirectUri(callbackUrl, returnMode)],
    created_at: Math.floor(Date.now() / 1000),
  })
  const request = new LoginConsentRequest({
    system_id: systemId,
    signing_id: serviceIAddress,
    challenge,
  })
  const signature = await verusId.interface.signData({
    address: serviceIAddress,
    datahash: challenge.toSha256().toString("hex"),
  })

  if (signature.error) {
    throw new Error(signature.error.message)
  }

  const signatureValue = signature.result?.signature
  if (!signatureValue) {
    throw new Error("Verus RPC did not return a login consent signature.")
  }

  request.signature = new VerusIDSignature(
    { signature: signatureValue },
    IDENTITY_AUTH_SIG_VDXF_KEY,
  )

  const requestVerified = await verusId.verifyLoginConsentRequest(
    request,
    serviceIdentity,
    systemId,
    Math.floor(Date.now() / 1000),
  )

  if (!requestVerified) {
    throw new Error("Verus RPC returned an unverifiable login consent signature.")
  }

  return request
}

export function getPendingLogin(id: string) {
  cleanupExpired()
  return pendingStore.getById(id)
}

export function removePendingLogin(id: string) {
  pendingStore.delete(id)
}

export async function createPendingLogin(loginChallenge: string) {
  cleanupExpired()

  const serviceIdentity = await verusId.interface.getIdentity(verusServiceId)
  if (serviceIdentity.error) {
    throw new Error(serviceIdentity.error.message)
  }

  const serviceIAddress = serviceIdentity.result?.identity?.identityaddress
  if (!serviceIAddress) {
    throw new Error(`Unable to resolve service VerusID ${verusServiceId}.`)
  }
  const callbackUrl = `${baseUrl}/verus/callback`
  const challengeId = randomIAddressLikeId()
  const systemId = await verusId.getChainId()
  const qrRequest = await createSignedLoginConsentRequest(
    serviceIAddress,
    systemId,
    challengeId,
    callbackUrl,
    LOGIN_CONSENT_WEBHOOK_VDXF_KEY.vdxfid,
    serviceIdentity.result,
  )
  const deeplinkRequest = await createSignedLoginConsentRequest(
    serviceIAddress,
    systemId,
    challengeId,
    callbackUrl,
    LOGIN_CONSENT_REDIRECT_VDXF_KEY.vdxfid,
    serviceIdentity.result,
  )

  const qrDeeplink = qrRequest.toWalletDeeplinkUri()
  const deeplink = deeplinkRequest.toWalletDeeplinkUri()
  const qrDataUrl = await QRCode.toDataURL(qrDeeplink, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  })
  const session: PendingVerusLogin = {
    id: crypto.randomUUID(),
    loginChallenge,
    verusChallengeId: challengeId,
    createdAt: Date.now(),
    qrRequest,
    deeplinkRequest,
    deeplink,
    qrDataUrl,
    status: "pending",
  }

  pendingStore.set(session)
  return session
}

export function parseLoginConsentResponse(
  input: Record<string, unknown> | string | Buffer,
) {
  if (typeof input === "string") {
    return parseResponseValue(input)
  }

  if (Buffer.isBuffer(input)) {
    return parseResponseValue(input.toString("utf8"))
  }

  if (input.system_id && input.signing_id && input.decision) {
    return new LoginConsentResponse(input as unknown as ConstructorParameters<
      typeof LoginConsentResponse
    >[0])
  }

  const fallbackValue = Object.values(input).find(
    (value) => typeof value === "string" && value,
  )

  return parseResponseValue(
    input.response ||
      input.login_consent_response ||
      input[LOGIN_CONSENT_RESPONSE_VDXF_KEY.vdxfid] ||
      fallbackValue,
  )
}

export async function completePendingLogin(response: LoginConsentResponse) {
  cleanupExpired()

  const session = pendingStore.getPendingByChallengeId(response.decision?.decision_id)

  if (!session) {
    throw new Error("No pending login matches this Verus response.")
  }

  try {
    if (response.decision?.skipped) {
      session.status = "rejected"
      session.error = "The wallet rejected the Verus login request."
      return session
    }

    const responseRequest = response.decision.request.toString()
    const acceptedRequest = [
      session.qrRequest.toString(),
      session.deeplinkRequest.toString(),
    ].includes(responseRequest)

    if (!acceptedRequest) {
      throw new Error("The wallet response does not match the pending request.")
    }

    const verified = await verusId.verifyLoginConsentResponse(response)
    if (!verified) {
      throw new Error("The Verus login response signature is invalid.")
    }

    const userIAddress = response.signing_id
    const identity = await verusId.interface.getIdentity(userIAddress)
    const friendlyName = identity.error
      ? undefined
      : identity.result.identity.name || undefined
    const loginAt = Math.floor(Date.now() / 1000)

    const { redirect_to } = await hydraAdmin.acceptOAuth2LoginRequest({
      loginChallenge: session.loginChallenge,
      acceptOAuth2LoginRequest: {
        subject: userIAddress,
        remember: true,
        remember_for: 3600,
        acr: "0",
        amr: ["verus_login_consent"],
        context: {
          verus_id: userIAddress,
          verus_id_name: friendlyName,
          verus_chain: verusChain,
          verus_auth_method: "verus_login_consent",
          verus_login_at: loginAt,
        },
      },
    })

    session.status = "complete"
    session.redirectTo = String(redirect_to)
    session.verusId = userIAddress
    session.verusIdName = friendlyName
    return session
  } catch (error) {
    session.status = "error"
    session.error = error instanceof Error ? error.message : String(error)
    return session
  }
}
