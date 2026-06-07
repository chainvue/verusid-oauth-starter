import { AcceptOAuth2ConsentRequestSession } from "@ory/hydra-client-fetch"
import express from "express"

import { hydraAdmin, verusChain } from "../config"
import { csrfProtection } from "./csrf"

const router = express.Router()
const VERUS_AUTH_METHOD = "verus_login_consent"
const GRANTABLE_SCOPES = new Set(["openid", "offline", "verusid"])

type VerusTokenClaims = {
  verus_id: string
  verus_id_name?: string
  verus_chain: string
  verus_auth_method: string
  verus_login_at?: number
}

type ConsentRequestWithVerusContext = {
  subject?: string
  context?: Record<string, unknown> | null
}

function buildVerusTokenClaims(
  consentRequest: ConsentRequestWithVerusContext,
): VerusTokenClaims {
  const context = consentRequest.context || {}
  const claims: VerusTokenClaims = {
    verus_id: String(context.verus_id || consentRequest.subject || ""),
    verus_chain: String(context.verus_chain || verusChain),
    verus_auth_method: String(context.verus_auth_method || VERUS_AUTH_METHOD),
  }

  if (context.verus_id_name) {
    claims.verus_id_name = String(context.verus_id_name)
  }

  if (typeof context.verus_login_at === "number") {
    claims.verus_login_at = context.verus_login_at
  }

  return claims
}

function buildVerusTokenSession(
  consentRequest: ConsentRequestWithVerusContext,
): AcceptOAuth2ConsentRequestSession {
  const claims = buildVerusTokenClaims(consentRequest)

  return {
    access_token: { ...claims },
    id_token: { ...claims },
  }
}

function filterGrantableScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) {
    return []
  }

  return scopes
    .map((scope) => String(scope))
    .filter((scope) => GRANTABLE_SCOPES.has(scope))
}

function filterRequestedGrantableScopes(submittedScopes: unknown, requestedScopes: unknown): string[] {
  const requested = new Set(filterGrantableScopes(requestedScopes))
  return filterGrantableScopes(submittedScopes)
    .filter((scope) => requested.has(scope))
}

router.get("/", csrfProtection, (req, res, next) => {
  const challenge = new URL(req.originalUrl, "http://localhost").searchParams.get("consent_challenge") || ""

  if (!challenge) {
    next(new Error("Expected a consent challenge to be set but received none."))
    return
  }

  hydraAdmin
    .getOAuth2ConsentRequest({ consentChallenge: challenge })
    .then((consentRequest) => {
      if (consentRequest.skip || consentRequest.client?.skip_consent) {
        return hydraAdmin
          .acceptOAuth2ConsentRequest({
            consentChallenge: challenge,
            acceptOAuth2ConsentRequest: {
              grant_scope: filterGrantableScopes(consentRequest.requested_scope),
              grant_access_token_audience:
                consentRequest.requested_access_token_audience,
              session: buildVerusTokenSession(consentRequest),
            },
          })
          .then(({ redirect_to }) => res.redirect(String(redirect_to)))
      }

      res.render("consent", {
        csrfToken: req.csrfToken(),
        challenge,
        requested_scope: filterGrantableScopes(consentRequest.requested_scope),
        user: consentRequest.subject,
        verusName: consentRequest.context?.verus_id_name,
        client: consentRequest.client,
        action: "/consent",
      })
    })
    .catch(next)
})

router.post("/", csrfProtection, (req, res, next) => {
  const challenge = req.body.challenge

  if (req.body.submit === "Deny access") {
    hydraAdmin
      .rejectOAuth2ConsentRequest({
        consentChallenge: challenge,
        rejectOAuth2Request: {
          error: "access_denied",
          error_description: "The resource owner denied the request",
        },
      })
      .then(({ redirect_to }) => res.redirect(String(redirect_to)))
      .catch(next)
    return
  }

  const grantScope = Array.isArray(req.body.grant_scope)
    ? req.body.grant_scope
    : [req.body.grant_scope].filter(Boolean)

  hydraAdmin
    .getOAuth2ConsentRequest({ consentChallenge: challenge })
    .then((consentRequest) => {
      return hydraAdmin.acceptOAuth2ConsentRequest({
        consentChallenge: challenge,
        acceptOAuth2ConsentRequest: {
          grant_scope: filterRequestedGrantableScopes(grantScope, consentRequest.requested_scope),
          grant_access_token_audience:
            consentRequest.requested_access_token_audience,
          session: buildVerusTokenSession(consentRequest),
          remember: Boolean(req.body.remember),
          remember_for: 3600,
        },
      })
    })
    .then(({ redirect_to }) => res.redirect(String(redirect_to)))
    .catch(next)
})

export default router
