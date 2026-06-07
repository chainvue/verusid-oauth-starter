import { describe, expect, it } from "vitest"

import {
  assertConsentNodeProductionConfig,
  getProductionConfigErrors,
} from "../src/config"

describe("consent-node production config", () => {
  it("rejects local defaults and malformed numeric settings", () => {
    const errors = getProductionConfigErrors({
      BASE_URL: "http://192.168.0.160:3000",
      HYDRA_ADMIN_URL: "http://hydra-admin.example.com:4445",
      VERUS_SERVICE_ID: "fum@",
      VERUS_LOGIN_TTL_MS: "0",
      VERUS_RPC_USER: "user",
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("BASE_URL"),
      expect.stringContaining("HYDRA_ADMIN_URL"),
      expect.stringContaining("VERUS_SERVICE_ID"),
      expect.stringContaining("VERUS_LOGIN_TTL_MS"),
      expect.stringContaining("VERUS_RPC_USER"),
    ]))
  })

  it("accepts HTTPS base URL, private Hydra admin URL, and explicit service ID", () => {
    const errors = getProductionConfigErrors({
      BASE_URL: "https://consent.example.com",
      HYDRA_ADMIN_URL: "http://hydra:4445",
      VERUS_SERVICE_ID: "service@",
      VERUS_LOGIN_TTL_MS: "300000",
      VERUS_RPC_USER: "user",
      VERUS_RPC_PASSWORD: "password",
    })

    expect(errors).toEqual([])
  })

  it("throws a startup error with all production config failures", () => {
    expect(() => assertConsentNodeProductionConfig({
      BASE_URL: "not a url",
      HYDRA_ADMIN_URL: "not a url",
      VERUS_SERVICE_ID: "fum@",
      VERUS_LOGIN_TTL_MS: "NaN",
    })).toThrow(/Invalid production consent-node config/)
  })
})
