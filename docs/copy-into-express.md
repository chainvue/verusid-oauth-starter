# Copy Into Express

This is the smallest production-shaped route setup from `examples/verusid-express-login`. It keeps OAuth tokens server-side, stores only a sanitized app session, and uses the SDK client as the integration boundary.

## Install The Route Pattern

```js
import express from "express"
import session from "express-session"
import {
  createConfig,
  createVerusOAuthClient,
  VerusOAuthError,
} from "@chainvue/verusid-oauth"

const app = express()
const config = createConfig(process.env)
const verusOAuth = createVerusOAuthClient(config)

app.use(session({
  name: "sid",
  secret: process.env.SESSION_SECRET,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
}))

app.get("/login", (req, res) => {
  const login = verusOAuth.createLoginRequest()
  req.session.oauth = { state: login.state, nonce: login.nonce }
  res.redirect(login.authorizationUrl.toString())
})

app.get("/callback", async (req, res, next) => {
  try {
    const saved = req.session.oauth || {}
    delete req.session.oauth

    req.session.login = await verusOAuth.completeLogin({
      code: req.query.code,
      returnedState: req.query.state,
      expectedState: saved.state,
      expectedNonce: saved.nonce,
    })

    res.redirect("/")
  } catch (error) {
    if (error instanceof VerusOAuthError) {
      res.status(400).json({ error: error.code, message: error.message })
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
```

## Required OAuth Setup

Register the confidential Hydra client with:

- Redirect URI: your exact `/callback` URL.
- Scope: `openid offline verusid`.
- Grant types: authorization code and refresh token.
- Response type: code.

For the local example:

```sh
LOCAL_HOST=$(ipconfig getifaddr en0)
LOCAL_HOST=$LOCAL_HOST ./scripts/create-verusid-express-login-client.sh
LOCAL_HOST=$LOCAL_HOST npm run doctor:local
```

## Session Rules

Keep raw access, ID, and refresh tokens out of browser-readable storage. `completeLogin()` returns a sanitized `PublicVerusSession` by default. Raw tokens are returned only with `includeRawTokens: true`; use that only for local debugging or encrypted server-side token storage.

The consent node needs a Verus full node plus a consent-node signing VerusID so it can sign wallet login requests. The person logging in needs Verus Mobile with a VerusID.
