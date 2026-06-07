import {
  createVerusOAuthClient,
  VerusOAuthError,
  VerusOAuthErrorCode,
} from "@chainvue/verusid-oauth"

export function installVerusRoutes(app, options) {
  const { config, renderError } = options
  const client = options.client || createVerusOAuthClient(config)

  app.get("/login", (req, res) => {
    const loginRequest = client.createLoginRequest()
    req.session.oauth = {
      state: loginRequest.state,
      nonce: loginRequest.nonce,
    }
    res.redirect(loginRequest.authorizationUrl.toString())
  })

  app.get("/callback", async (req, res, next) => {
    try {
      const savedOAuth = req.session.oauth || {}
      delete req.session.oauth

      const session = await client.completeLogin({
        code: req.query.code,
        returnedState: req.query.state,
        expectedState: savedOAuth.state,
        expectedNonce: savedOAuth.nonce,
        includeRawTokens: config.showDebugTokens,
      })

      req.session.login = config.showDebugTokens
        ? withDebugTokens(session)
        : client.toPublicSession(session)
      res.redirect("/")
    } catch (error) {
      if (error instanceof VerusOAuthError) {
        res.status(400).type("html").send(renderError(errorTitle(error), error.message))
        return
      }
      next(error)
    }
  })

  app.get("/me", (req, res) => {
    if (!req.session.login) {
      res.status(401).json({ authenticated: false })
      return
    }
    res.json({ authenticated: true, ...req.session.login })
  })

  app.post("/logout", (req, res) => {
    req.session.login = null
    res.redirect("/")
  })
}

export function errorTitle(error) {
  switch (error.code) {
    case VerusOAuthErrorCode.STATE_MISMATCH:
      return "State validation failed"
    case VerusOAuthErrorCode.MISSING_CODE:
      return "Missing authorization code"
    case VerusOAuthErrorCode.TOKEN_EXCHANGE_FAILED:
      return "Token exchange failed"
    default:
      return "VerusID verification failed"
  }
}

export function withDebugTokens(session) {
  const publicSession = {
    subject: session.subject,
    verus: session.verus,
    grantedScope: session.grantedScope,
    refreshTokenPresent: session.refreshTokenPresent,
  }

  if (session.tokens) {
    publicSession.debugTokens = session.tokens
  }

  return publicSession
}
