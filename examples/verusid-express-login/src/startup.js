const PLACEHOLDER_HOST = "<LAN-IP>"
const COMPAT_LOCAL_HOST = "192.168.0.160"

export function getStartupWarnings(config, env = process.env) {
  const warnings = []
  const isProduction = env.NODE_ENV === "production"

  if (!config.sessionSecret || config.sessionSecret === "change-me" || config.sessionSecret === "local-express-login-session-secret") {
    warnings.push("Set SESSION_SECRET to a long random value before sharing this service.")
  }

  if (isProduction && !String(config.redirectUri).startsWith("https://")) {
    warnings.push("Use an HTTPS REDIRECT_URI and secure cookies in production.")
  }

  warnings.push("The example uses express-session's MemoryStore; configure a durable production session store before deployment.")

  if (config.localHost === PLACEHOLDER_HOST || String(config.redirectUri).includes(PLACEHOLDER_HOST)) {
    warnings.push("Replace <LAN-IP> with a LAN-reachable LOCAL_HOST before phone testing.")
  } else if (config.localHost === COMPAT_LOCAL_HOST || String(config.redirectUri).includes(COMPAT_LOCAL_HOST)) {
    warnings.push("LOCAL_HOST is using the bundled compatibility default; set LOCAL_HOST explicitly to your current LAN IP for phone testing.")
  }

  return warnings
}

export function printStartupWarnings(config, env = process.env, logger = console) {
  for (const warning of getStartupWarnings(config, env)) {
    logger.warn(`[verusid-express-login] ${warning}`)
  }
}
