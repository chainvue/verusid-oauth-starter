import crypto from "node:crypto"
import {
  buildAuthorizationUrl,
  createVerusOAuthClient,
  VerusOAuthError,
  VerusOAuthErrorCode,
} from "@chainvue/verusid-oauth"

export function installOAuthRoutes(app, options) {
  const { config, renderError } = options
  const client = options.client || createVerusOAuthClient(config)

  app.get("/login", (req, res) => {
    const loginRequest = createLoginRequest(config, options.client)
    req.session.oauth = {
      state: loginRequest.state,
      nonce: loginRequest.nonce,
      codeVerifier: loginRequest.codeVerifier,
    }
    res.redirect(loginRequest.authorizationUrl.toString())
  })

  app.get("/callback", async (req, res, next) => {
    try {
      const savedOAuth = req.session.oauth || {}
      delete req.session.oauth
      if (!savedOAuth.state) {
        res.status(400).type("html").send(renderError(
          "OAuth session not found",
          `The callback reached this app without the session created by /login. Start again from the same browser host and port as the configured redirect URI: ${config.redirectUri}`,
        ))
        return
      }

      const verifiedSession = await client.completeLogin({
        code: req.query.code,
        codeVerifier: savedOAuth.codeVerifier,
        returnedState: req.query.state,
        expectedState: savedOAuth.state,
        expectedNonce: savedOAuth.nonce,
      })

      req.session.member = toMemberSession(client.toPublicSession(verifiedSession))
      res.redirect("/")
    } catch (error) {
      if (error instanceof VerusOAuthError) {
        res.status(400).type("html").send(renderError(errorTitle(error), error.message))
        return
      }
      next(error)
    }
  })

  app.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("verusid_member_portal")
      res.redirect("/")
    })
  })
}

export function createLoginRequest(config) {
  const state = randomValue()
  const nonce = randomValue()
  const codeVerifier = createPkceVerifier()
  const authorizationUrl = buildAuthorizationUrl(config, state, nonce, codeVerifier)
  authorizationUrl.searchParams.set("prompt", "login")

  return {
    authorizationUrl,
    state,
    nonce,
    codeVerifier,
  }
}

export function createPkceVerifier() {
  return crypto.randomBytes(32).toString("base64url")
}

export function toMemberSession(publicSession) {
  return {
    subject: publicSession.subject,
    verus: publicSession.verus,
    grantedScope: publicSession.grantedScope,
    refreshTokenPresent: publicSession.refreshTokenPresent,
    loginTime: new Date().toISOString(),
  }
}

function randomValue() {
  return crypto.randomBytes(24).toString("base64url")
}

function errorTitle(error) {
  switch (error.code) {
    case VerusOAuthErrorCode.STATE_MISMATCH:
      return "State validation failed"
    case VerusOAuthErrorCode.MISSING_CODE:
      return "Missing authorization code"
    case VerusOAuthErrorCode.MISSING_CODE_VERIFIER:
      return "Missing PKCE verifier"
    case VerusOAuthErrorCode.TOKEN_EXCHANGE_FAILED:
      return "Token exchange failed"
    default:
      return "VerusID verification failed"
  }
}
