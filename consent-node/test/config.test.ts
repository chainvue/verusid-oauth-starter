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
      VERUS_RPC_TIMEOUT_MS: "0",
      VERUS_RPC_USER: "user",
      MAX_PENDING_LOGINS: "0",
      RATE_LIMIT_WINDOW_MS: "0",
      RATE_LIMIT_MAX: "0",
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("BASE_URL"),
      expect.stringContaining("HYDRA_ADMIN_URL"),
      expect.stringContaining("VERUS_SERVICE_ID"),
      expect.stringContaining("VERUS_LOGIN_TTL_MS"),
      expect.stringContaining("VERUS_RPC_TIMEOUT_MS"),
      expect.stringContaining("VERUS_RPC_USER"),
      expect.stringContaining("PENDING_LOGIN_STORE=memory"),
      expect.stringContaining("MAX_PENDING_LOGINS"),
      expect.stringContaining("RATE_LIMIT_WINDOW_MS"),
      expect.stringContaining("RATE_LIMIT_MAX"),
    ]))
  })

  it("accepts HTTPS base URL, private Hydra admin URL, explicit service ID, and acknowledged memory store", () => {
    const errors = getProductionConfigErrors({
      BASE_URL: "https://consent.example.com",
      HYDRA_ADMIN_URL: "http://hydra:4445",
      VERUS_SERVICE_ID: "service@",
      VERUS_LOGIN_TTL_MS: "300000",
      VERUS_RPC_TIMEOUT_MS: "10000",
      VERUS_RPC_USER: "user",
      VERUS_RPC_PASSWORD: "password",
      PENDING_LOGIN_STORE: "memory",
      ALLOW_MEMORY_PENDING_LOGIN_STORE: "1",
      MAX_PENDING_LOGINS: "1000",
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "120",
    })

    expect(errors).toEqual([])
  })

  it("throws a startup error with all production config failures", () => {
    expect(() => assertConsentNodeProductionConfig({
      BASE_URL: "not a url",
      HYDRA_ADMIN_URL: "not a url",
      VERUS_SERVICE_ID: "fum@",
      VERUS_LOGIN_TTL_MS: "NaN",
      VERUS_RPC_TIMEOUT_MS: "NaN",
    })).toThrow(/Invalid production consent-node config/)
  })
})
