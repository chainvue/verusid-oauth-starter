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
