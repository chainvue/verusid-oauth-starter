import express from "express"
import url from "url"

import { hydraAdmin } from "../config"

const router = express.Router()

router.get("/", (req, res, next) => {
  const query = url.parse(req.url, true).query
  const challenge = String(query.logout_challenge || "")

  if (!challenge) {
    next(new Error("Expected a logout challenge to be set but received none."))
    return
  }

  hydraAdmin
    .acceptOAuth2LogoutRequest({ logoutChallenge: challenge })
    .then(({ redirect_to }) => res.redirect(String(redirect_to)))
    .catch(next)
})

export default router
