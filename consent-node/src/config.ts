import { Configuration, OAuth2Api } from "@ory/hydra-client-fetch"
import { VerusIdInterface } from "verusid-ts-client"

const hydraAdminUrl = process.env.HYDRA_ADMIN_URL || "http://127.0.0.1:4445"

export const hydraAdmin = new OAuth2Api(
  new Configuration({
    basePath: hydraAdminUrl,
    accessToken: process.env.ORY_API_KEY || process.env.ORY_PAT,
  }),
)

const verusRpcHost = process.env.VERUS_RPC_HOST || "127.0.0.1"
const verusRpcPort = process.env.VERUS_RPC_PORT || "18843"
const verusRpcUser = process.env.VERUS_RPC_USER || ""
const verusRpcPassword = process.env.VERUS_RPC_PASSWORD || ""

export const baseUrl = process.env.BASE_URL || "http://192.168.0.160:3000"

export const verusServiceId = process.env.VERUS_SERVICE_ID || "fum@"
export const verusLoginTtlMs = Number(process.env.VERUS_LOGIN_TTL_MS || 300000)
export const verusRpcTimeoutMs = Number(process.env.VERUS_RPC_TIMEOUT_MS || 10000)
export const verusChain = process.env.VERUS_CHAIN || "VRSCTEST"
export const pendingLoginStore = process.env.PENDING_LOGIN_STORE || "memory"
export const pendingLoginRedisUrl = process.env.PENDING_LOGIN_REDIS_URL || process.env.REDIS_URL || ""
export const maxPendingLogins = Number(process.env.MAX_PENDING_LOGINS || 1000)
export const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000)
export const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 120)

export const verusId = new VerusIdInterface(
  verusChain,
  `http://${verusRpcHost}:${verusRpcPort}`,
  verusRpcUser && verusRpcPassword
    ? {
        auth: {
          username: verusRpcUser,
          password: verusRpcPassword,
        },
      }
    : {},
)

export function getProductionConfigErrors(env: Record<string, string | undefined> = process.env): string[] {
  const errors: string[] = []
  const configuredBaseUrl = env.BASE_URL || "http://192.168.0.160:3000"
  const configuredHydraAdminUrl = env.HYDRA_ADMIN_URL || "http://127.0.0.1:4445"
  const configuredServiceId = env.VERUS_SERVICE_ID || "fum@"
  const configuredTtl = Number(env.VERUS_LOGIN_TTL_MS || 300000)
  const configuredRpcTimeout = Number(env.VERUS_RPC_TIMEOUT_MS || 10000)
  const configuredRpcUser = env.VERUS_RPC_USER || ""
  const configuredRpcPassword = env.VERUS_RPC_PASSWORD || ""
  const configuredPendingStore = env.PENDING_LOGIN_STORE || "memory"
  const configuredPendingRedisUrl = env.PENDING_LOGIN_REDIS_URL || env.REDIS_URL || ""
  const configuredMaxPendingLogins = Number(env.MAX_PENDING_LOGINS || 1000)
  const configuredRateLimitWindowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60000)
  const configuredRateLimitMax = Number(env.RATE_LIMIT_MAX || 120)

  const parsedBaseUrl = parseUrl(configuredBaseUrl)
  const parsedHydraAdminUrl = parseUrl(configuredHydraAdminUrl)

  if (!parsedBaseUrl) {
    errors.push("Production BASE_URL must be a valid URL.")
  } else if (parsedBaseUrl.protocol !== "https:") {
    errors.push("Production BASE_URL must use HTTPS.")
  }

  if (!parsedHydraAdminUrl) {
    errors.push("Production HYDRA_ADMIN_URL must be a valid URL.")
  } else if (isPublicHttpParsedUrl(parsedHydraAdminUrl)) {
    errors.push("Production HYDRA_ADMIN_URL must not be a public-looking HTTP URL.")
  }

  if (!configuredServiceId || configuredServiceId === "fum@") {
    errors.push("Production VERUS_SERVICE_ID must not use the bundled local example VerusID.")
  }

  if (!Number.isInteger(configuredTtl) || !Number.isFinite(configuredTtl) || configuredTtl <= 0) {
    errors.push("Production VERUS_LOGIN_TTL_MS must be a finite positive integer.")
  }

  if (!Number.isInteger(configuredRpcTimeout) || !Number.isFinite(configuredRpcTimeout) || configuredRpcTimeout <= 0) {
    errors.push("Production VERUS_RPC_TIMEOUT_MS must be a finite positive integer.")
  }

  if (Boolean(configuredRpcUser) !== Boolean(configuredRpcPassword)) {
    errors.push("Production VERUS_RPC_USER and VERUS_RPC_PASSWORD must be configured together.")
  }

  if (!["memory", "redis"].includes(configuredPendingStore)) {
    errors.push("Production PENDING_LOGIN_STORE must be \"memory\" or \"redis\".")
  } else if (configuredPendingStore === "redis" && !parseUrl(configuredPendingRedisUrl)) {
    errors.push("Production PENDING_LOGIN_REDIS_URL or REDIS_URL must be a valid URL when PENDING_LOGIN_STORE=redis.")
  } else if (configuredPendingStore === "memory" && env.ALLOW_MEMORY_PENDING_LOGIN_STORE !== "1") {
    errors.push("Production PENDING_LOGIN_STORE=memory is process-local; set ALLOW_MEMORY_PENDING_LOGIN_STORE=1 only for single-instance deployments.")
  }

  if (!Number.isInteger(configuredMaxPendingLogins) || !Number.isFinite(configuredMaxPendingLogins) || configuredMaxPendingLogins <= 0) {
    errors.push("Production MAX_PENDING_LOGINS must be a finite positive integer.")
  }

  if (!Number.isInteger(configuredRateLimitWindowMs) || !Number.isFinite(configuredRateLimitWindowMs) || configuredRateLimitWindowMs <= 0) {
    errors.push("Production RATE_LIMIT_WINDOW_MS must be a finite positive integer.")
  }

  if (!Number.isInteger(configuredRateLimitMax) || !Number.isFinite(configuredRateLimitMax) || configuredRateLimitMax <= 0) {
    errors.push("Production RATE_LIMIT_MAX must be a finite positive integer.")
  }

  return errors
}

export function assertConsentNodeProductionConfig(env: Record<string, string | undefined> = process.env): void {
  const errors = getProductionConfigErrors(env)
  if (errors.length > 0) {
    throw new Error(`Invalid production consent-node config:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isPublicHttpParsedUrl(url: URL): boolean {
  return url.protocol === "http:" && !isLoopbackHost(url.hostname) && url.hostname.includes(".")
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
}
