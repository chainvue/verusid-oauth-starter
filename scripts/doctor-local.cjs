#!/usr/bin/env node

const fs = require("node:fs")

const PLACEHOLDER_HOST = "<LAN-IP>"
const COMPAT_LOCAL_HOST = "192.168.0.160"

async function main() {
  const { createConfig, DEFAULT_SCOPE } = await import("@chainvue/verusid-oauth")
  const requiredScopes = DEFAULT_SCOPE.split(/\s+/)
  const config = createConfig(process.env)
  const results = []

  results.push(checkNodeVersion())
  results.push(checkEnvFile())
  results.push(checkLanHost(config))
  results.push(await checkDiscovery(config))
  results.push(await checkTokenEndpoint(config))
  results.push(await checkAdminEndpoint(config))
  results.push(await checkClientRegistration(config, requiredScopes))
  results.push(await checkConsentNode(config))

  for (const result of results) {
    printResult(result)
  }

  const failed = results.some((result) => result.status === "fail")
  process.exitCode = failed ? 1 : 0
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0])
  return major >= 18
    ? pass("Node.js version", `v${process.versions.node}`)
    : fail("Node.js version", `Found v${process.versions.node}`, "Install Node.js 18 or newer.")
}

function checkEnvFile() {
  if (fs.existsSync(".env.local") || fs.existsSync(".env")) {
    return pass("Environment file", "Found .env.local or .env.")
  }
  return warn("Environment file", "No .env.local or .env found.", "cp .env.example .env.local")
}

function checkLanHost(config) {
  if (config.localHost === PLACEHOLDER_HOST || config.redirectUri.includes(PLACEHOLDER_HOST)) {
    return warn(
      "LAN host",
      "LOCAL_HOST still contains <LAN-IP>.",
      "LOCAL_HOST=$(ipconfig getifaddr en0) npm run doctor:local",
    )
  }
  if (config.localHost === COMPAT_LOCAL_HOST || config.redirectUri.includes(COMPAT_LOCAL_HOST)) {
    return warn(
      "LAN host",
      "LOCAL_HOST is using the bundled compatibility default.",
      "Set LOCAL_HOST explicitly to the current LAN IP for phone testing.",
    )
  }
  return pass("LAN host", config.localHost)
}

async function checkDiscovery(config) {
  const url = `${trimSlash(config.hydraPublicUrl)}/.well-known/openid-configuration`
  const response = await fetchJson(url)
  if (!response.ok) {
    return fail("Hydra discovery", `${url} returned ${response.status || response.error}.`, "./scripts/start-stack.sh")
  }
  if (!response.body.issuer || !response.body.jwks_uri) {
    return fail("Hydra discovery", "Discovery document is missing issuer or jwks_uri.", "Restart Hydra: ./scripts/start-stack.sh")
  }
  return pass("Hydra discovery", response.body.issuer)
}

async function checkTokenEndpoint(config) {
  const response = await fetch(`${trimSlash(config.hydraPublicUrl)}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: "doctor", redirect_uri: config.redirectUri }),
    signal: AbortSignal.timeout(5000),
  }).catch((error) => ({ ok: false, status: error.message }))

  if (response.status === 400 || response.status === 401) {
    return pass("Hydra token endpoint", "Reachable.")
  }
  return fail("Hydra token endpoint", `Unexpected response ${response.status}.`, "./scripts/start-stack.sh")
}

async function checkAdminEndpoint(config) {
  const response = await fetchJson(`${trimSlash(config.hydraAdminUrl)}/admin/clients/${encodeURIComponent(config.clientId)}`)
  if (response.ok || response.status === 404) {
    return pass("Hydra admin endpoint", "Reachable.")
  }
  return fail("Hydra admin endpoint", `Unexpected response ${response.status || response.error}.`, "HYDRA_ADMIN_URL=http://127.0.0.1:4445 npm run doctor:local")
}

async function checkClientRegistration(config, requiredScopes) {
  const response = await fetchJson(`${trimSlash(config.hydraAdminUrl)}/admin/clients/${encodeURIComponent(config.clientId)}`)
  if (response.status === 404) {
    return fail("Hydra client registration", `Client ${config.clientId} was not found.`, "./scripts/create-verusid-express-login-client.sh")
  }
  if (!response.ok) {
    return fail("Hydra client registration", `Could not read ${config.clientId}: ${response.status || response.error}.`, "Start Hydra admin, then rerun npm run doctor:local.")
  }

  const client = response.body
  const redirectUris = client.redirect_uris || []
  const scopes = String(client.scope || "").split(/\s+/).filter(Boolean)
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope))

  if (!redirectUris.includes(config.redirectUri)) {
    return fail(
      "Hydra client redirect URI",
      `Missing ${config.redirectUri}.`,
      `REDIRECT_URI=${config.redirectUri} ./scripts/create-verusid-express-login-client.sh`,
    )
  }

  if (missingScopes.length > 0) {
    return fail(
      "Hydra client scopes",
      `Missing ${missingScopes.join(" ")}.`,
      "./scripts/create-verusid-express-login-client.sh",
    )
  }

  return pass("Hydra client registration", `${config.clientId} has redirect URI and scopes.`)
}

async function checkConsentNode(config) {
  const url = process.env.CONSENT_NODE_URL || `http://${config.localHost}:3000`
  const response = await fetchJson(`${trimSlash(url)}/health`)
  if (response.ok) {
    return pass("Consent node health", `${url}/health`)
  }
  const status = process.env.CONSENT_NODE_URL ? "fail" : "warn"
  return {
    status,
    label: "Consent node health",
    detail: `${url}/health returned ${response.status || response.error}.`,
    fix: "Start the consent node with a Verus full node and consent-node signing VerusID, then rerun npm run doctor:local.",
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    const text = await response.text()
    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : {},
    }
  } catch (error) {
    return { ok: false, status: null, error: error.message, body: null }
  }
}

function pass(label, detail) {
  return { status: "pass", label, detail }
}

function warn(label, detail, fix) {
  return { status: "warn", label, detail, fix }
}

function fail(label, detail, fix) {
  return { status: "fail", label, detail, fix }
}

function printResult(result) {
  console.log(`${result.status} ${result.label}: ${result.detail}`)
  if (result.fix) {
    console.log(`  fix: ${result.fix}`)
  }
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, "")
}

main().catch((error) => {
  console.error(`fail doctor: ${error.message}`)
  process.exitCode = 1
})
