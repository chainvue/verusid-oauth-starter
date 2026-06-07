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
