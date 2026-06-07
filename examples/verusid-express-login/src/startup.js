const PLACEHOLDER_HOST = "192.168.0.160"

export function getStartupWarnings(config, env = process.env) {
  const warnings = []
  const isProduction = env.NODE_ENV === "production"

  if (!config.sessionSecret || config.sessionSecret === "change-me" || config.sessionSecret === "local-express-login-session-secret") {
    warnings.push("Set SESSION_SECRET to a long random value before sharing this service.")
  }

  if (isProduction && !String(config.redirectUri).startsWith("https://")) {
    warnings.push("Use an HTTPS REDIRECT_URI and secure cookies in production.")
  }

  warnings.push("The example uses an in-memory session Map; replace it with your production session store.")

  if (config.localHost === PLACEHOLDER_HOST || String(config.redirectUri).includes(PLACEHOLDER_HOST)) {
    warnings.push(`LOCAL_HOST is still ${PLACEHOLDER_HOST}; set LOCAL_HOST to a LAN-reachable address for phone testing.`)
  }

  return warnings
}

export function printStartupWarnings(config, env = process.env, logger = console) {
  for (const warning of getStartupWarnings(config, env)) {
    logger.warn(`[verusid-express-login] ${warning}`)
  }
}
