import express from "express"

import { hydraAdmin } from "../config"
import { createPendingLogin } from "../verusLogin"
import { csrfProtection } from "./csrf"

const router = express.Router()

router.get("/", csrfProtection, (req, res, next) => {
  const challenge = new URL(req.originalUrl, "http://localhost").searchParams.get("login_challenge") || ""

  if (!challenge) {
    next(new Error("Expected a login challenge to be set but received none."))
    return
  }

  hydraAdmin
    .getOAuth2LoginRequest({ loginChallenge: challenge })
    .then(async (loginRequest) => {
      if (loginRequest.skip) {
        return hydraAdmin
          .acceptOAuth2LoginRequest({
            loginChallenge: challenge,
            acceptOAuth2LoginRequest: {
              subject: String(loginRequest.subject),
            },
          })
          .then(({ redirect_to }) => res.redirect(String(redirect_to)))
      }

      const pending = await createPendingLogin(challenge)

      res.render("login", {
        csrfToken: req.csrfToken(),
        challenge,
        action: "/login",
        hint: loginRequest.oidc_context?.login_hint || "",
        pendingId: pending.id,
        qrDataUrl: pending.qrDataUrl,
        deeplink: pending.deeplink,
        statusUrl: `/verus/status/${pending.id}`,
        retryUrl: `/login?login_challenge=${encodeURIComponent(challenge)}`,
      })
    })
    .catch(next)
})

router.post("/", csrfProtection, (req, res, next) => {
  const challenge = req.body.challenge

  if (req.body.submit !== "Deny access") {
    res.redirect(`/login?login_challenge=${encodeURIComponent(challenge)}`)
    return
  }

  hydraAdmin
    .rejectOAuth2LoginRequest({
      loginChallenge: challenge,
      rejectOAuth2Request: {
        error: "access_denied",
        error_description: "The resource owner denied the request",
      },
    })
    .then(({ redirect_to }) => res.redirect(String(redirect_to)))
    .catch(next)
})

export default router
