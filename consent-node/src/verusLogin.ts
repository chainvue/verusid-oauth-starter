import crypto from "crypto"

import Redis from "ioredis"
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
  maxPendingLogins,
  pendingLoginRedisUrl,
  pendingLoginStore,
  verusChain,
  verusId,
  verusLoginTtlMs,
  verusRpcTimeoutMs,
  verusServiceId,
} from "./config"
import {
  recordPendingLoginCompleted,
  recordPendingLoginCreated,
  recordPendingLoginErrored,
  recordPendingLoginRejected,
} from "./observability"

type ResolvedIdentity = NonNullable<
  Awaited<ReturnType<typeof verusId.interface.getIdentity>>["result"]
>

export type PendingVerusLogin = {
  id: string
  loginChallenge: string
  verusChallengeId: string
  createdAt: number
  qrRequest?: LoginConsentRequest
  deeplinkRequest?: LoginConsentRequest
  qrRequestValue: string
  deeplinkRequestValue: string
  deeplink: string
  qrDataUrl: string
  status: "pending" | "complete" | "expired" | "rejected" | "error"
  error?: string
  redirectTo?: string
  verusId?: string
  verusIdName?: string
}

interface PendingLoginStore {
  hasCapacity(): Promise<boolean>
  set(session: PendingVerusLogin): Promise<void>
  getById(id: string): Promise<PendingVerusLogin | undefined>
  getPendingByChallengeId(challengeId: string | undefined): Promise<PendingVerusLogin | undefined>
  delete(id: string): Promise<void>
  cleanupExpired(ttlMs: number): Promise<void>
}

class MemoryPendingLoginStore implements PendingLoginStore {
  private readonly byId = new Map<string, PendingVerusLogin>()
  private readonly byChallengeId = new Map<string, string>()

  constructor(private readonly maxEntries: number) {}

  async hasCapacity() {
    return this.byId.size < this.maxEntries
  }

  async set(session: PendingVerusLogin) {
    if (this.byId.size >= this.maxEntries && !this.byId.has(session.id)) {
      throw new Error(`Too many pending Verus login requests. Try again after an existing request expires.`)
    }
    this.byId.set(session.id, session)
    this.byChallengeId.set(session.verusChallengeId, session.id)
  }

  async getById(id: string) {
    return this.byId.get(id)
  }

  async getPendingByChallengeId(challengeId: string | undefined) {
    if (!challengeId) {
      return undefined
    }
    const id = this.byChallengeId.get(challengeId)
    const session = id ? this.byId.get(id) : undefined
    return session?.status === "pending" ? session : undefined
  }

  async delete(id: string) {
    const session = this.byId.get(id)
    if (session) {
      this.byChallengeId.delete(session.verusChallengeId)
    }
    this.byId.delete(id)
  }

  async cleanupExpired(ttlMs: number) {
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

class RedisPendingLoginStore implements PendingLoginStore {
  private readonly client: Redis
  private readonly prefix = "verusid-oauth:pending-login"

  constructor(redisUrl: string, private readonly maxEntries: number) {
    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
  }

  async hasCapacity() {
    await this.cleanupExpired(verusLoginTtlMs)
    return await this.client.scard(this.activeKey()) < this.maxEntries
  }

  async set(session: PendingVerusLogin) {
    const existing = await this.getById(session.id)
    if (!existing && !await this.hasCapacity()) {
      throw new Error(`Too many pending Verus login requests. Try again after an existing request expires.`)
    }

    const ttlSeconds = Math.ceil(verusLoginTtlMs / 1000)
    await this.client
      .multi()
      .set(this.sessionKey(session.id), JSON.stringify(serializePendingLogin(session)), "EX", ttlSeconds)
      .set(this.challengeKey(session.verusChallengeId), session.id, "EX", ttlSeconds)
      .sadd(this.activeKey(), session.id)
      .exec()
  }

  async getById(id: string) {
    const value = await this.client.get(this.sessionKey(id))
    return value ? deserializePendingLogin(value) : undefined
  }

  async getPendingByChallengeId(challengeId: string | undefined) {
    if (!challengeId) {
      return undefined
    }
    const id = await this.client.get(this.challengeKey(challengeId))
    const session = id ? await this.getById(id) : undefined
    return session?.status === "pending" ? session : undefined
  }

  async delete(id: string) {
    const session = await this.getById(id)
    const multi = this.client.multi()
      .del(this.sessionKey(id))
      .srem(this.activeKey(), id)
    if (session) {
      multi.del(this.challengeKey(session.verusChallengeId))
    }
    await multi.exec()
  }

  async cleanupExpired(_ttlMs: number) {
    const ids = await this.client.smembers(this.activeKey())
    if (ids.length === 0) {
      return
    }

    const exists = await this.client.mget(ids.map((id) => this.sessionKey(id)))
    const staleIds = ids.filter((_id, index) => !exists[index])
    if (staleIds.length > 0) {
      await this.client.srem(this.activeKey(), ...staleIds)
    }
  }

  private activeKey() {
    return `${this.prefix}:active`
  }

  private sessionKey(id: string) {
    return `${this.prefix}:session:${id}`
  }

  private challengeKey(challengeId: string) {
    return `${this.prefix}:challenge:${challengeId}`
  }
}

function createPendingLoginStore(): PendingLoginStore {
  if (pendingLoginStore === "redis") {
    if (!pendingLoginRedisUrl) {
      throw new Error("PENDING_LOGIN_REDIS_URL or REDIS_URL is required when PENDING_LOGIN_STORE=redis.")
    }
    return new RedisPendingLoginStore(pendingLoginRedisUrl, maxPendingLogins)
  }
  return new MemoryPendingLoginStore(maxPendingLogins)
}

function serializePendingLogin(session: PendingVerusLogin) {
  const {
    qrRequest: _qrRequest,
    deeplinkRequest: _deeplinkRequest,
    ...serializable
  } = session
  return serializable
}

function deserializePendingLogin(value: string): PendingVerusLogin {
  return JSON.parse(value) as PendingVerusLogin
}

const pendingStore = createPendingLoginStore()
const I_ADDR_VERSION = 102

function randomIAddressLikeId() {
  return toBase58Check(crypto.randomBytes(20), I_ADDR_VERSION)
}

function cleanupExpired() {
  return pendingStore.cleanupExpired(verusLoginTtlMs)
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

async function withRpcTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${verusRpcTimeoutMs}ms.`))
    }, verusRpcTimeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    clearTimeout(timeout!)
  }
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
  const signature = await withRpcTimeout(
    verusId.interface.signData({
      address: serviceIAddress,
      datahash: challenge.toSha256().toString("hex"),
    }),
    "Verus login consent signing",
  )

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

  const requestVerified = await withRpcTimeout(
    verusId.verifyLoginConsentRequest(
      request,
      serviceIdentity,
      systemId,
      Math.floor(Date.now() / 1000),
    ),
    "Verus login consent request verification",
  )

  if (!requestVerified) {
    throw new Error("Verus RPC returned an unverifiable login consent signature.")
  }

  return request
}

export async function getPendingLogin(id: string) {
  await cleanupExpired()
  return pendingStore.getById(id)
}

export function removePendingLogin(id: string) {
  return pendingStore.delete(id)
}

export async function createPendingLogin(loginChallenge: string) {
  await cleanupExpired()
  if (!await pendingStore.hasCapacity()) {
    throw new Error(`Too many pending Verus login requests. Try again after an existing request expires.`)
  }

  const serviceIdentity = await withRpcTimeout(
    verusId.interface.getIdentity(verusServiceId),
    "Verus service identity lookup",
  )
  if (serviceIdentity.error) {
    throw new Error(serviceIdentity.error.message)
  }

  const serviceIAddress = serviceIdentity.result?.identity?.identityaddress
  if (!serviceIAddress) {
    throw new Error(`Unable to resolve service VerusID ${verusServiceId}.`)
  }
  const callbackUrl = `${baseUrl}/verus/callback`
  const challengeId = randomIAddressLikeId()
  const systemId = await withRpcTimeout(
    verusId.getChainId(),
    "Verus chain ID lookup",
  )
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
  const qrRequestValue = qrRequest.toString()
  const deeplinkRequestValue = deeplinkRequest.toString()
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
    qrRequestValue,
    deeplinkRequestValue,
    deeplink,
    qrDataUrl,
    status: "pending",
  }

  await pendingStore.set(session)
  recordPendingLoginCreated()
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
  await cleanupExpired()

  const session = await pendingStore.getPendingByChallengeId(response.decision?.decision_id)

  if (!session) {
    throw new Error("No pending login matches this Verus response.")
  }

  try {
    if (response.decision?.skipped) {
      session.status = "rejected"
      session.error = "The wallet rejected the Verus login request."
      await pendingStore.set(session)
      recordPendingLoginRejected()
      return session
    }

    const responseRequest = response.decision.request.toString()
    const acceptedRequest = [
      session.qrRequestValue,
      session.deeplinkRequestValue,
    ].includes(responseRequest)

    if (!acceptedRequest) {
      throw new Error("The wallet response does not match the pending request.")
    }

    const verified = await withRpcTimeout(
      verusId.verifyLoginConsentResponse(response),
      "Verus login consent response verification",
    )
    if (!verified) {
      throw new Error("The Verus login response signature is invalid.")
    }

    const userIAddress = response.signing_id
    const identity = await withRpcTimeout(
      verusId.interface.getIdentity(userIAddress),
      "Verus wallet identity lookup",
    )
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
    await pendingStore.set(session)
    recordPendingLoginCompleted()
    return session
  } catch (error) {
    session.status = "error"
    session.error = error instanceof Error ? error.message : String(error)
    await pendingStore.set(session)
    recordPendingLoginErrored()
    return session
  }
}
