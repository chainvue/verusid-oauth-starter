import bodyParser from "body-parser"
import express from "express"

import {
  completePendingLogin,
  getPendingLogin,
  parseLoginConsentResponse,
  removePendingLogin,
} from "../verusLogin"

const router = express.Router()

async function handleCallback(
  input: Record<string, unknown> | string | Buffer,
  res: express.Response,
  redirectOnComplete: boolean,
) {
  let session

  try {
    const response = parseLoginConsentResponse(input)
    session = await completePendingLogin(response)
  } catch (error) {
    console.error("Verus callback failed", {
      error: error instanceof Error ? error.message : String(error),
      inputType: Buffer.isBuffer(input) ? "buffer" : typeof input,
      inputKeys:
        input && typeof input === "object" && !Buffer.isBuffer(input)
          ? Object.keys(input)
          : undefined,
    })
    res.status(400).json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (redirectOnComplete && session.redirectTo) {
    res.redirect(session.redirectTo)
    await removePendingLogin(session.id)
    return
  }

  if (session.status === "complete") {
    res.status(200).json({
      status: session.status,
      verusId: session.verusId,
      verusIdName: session.verusIdName,
    })
    await removePendingLogin(session.id)
    return
  }

  res.status(session.status === "rejected" ? 403 : 400).json({
    status: session.status,
    error: session.error,
  })
  await removePendingLogin(session.id)
}

const parseTextCallback = bodyParser.text({
  type: ["text/*", "application/octet-stream"],
})

router.post("/callback", parseTextCallback, (req, res, next) => {
  handleCallback(req.body, res, false).catch(next)
})

router.get("/callback", (req, res, next) => {
  handleCallback(req.query, res, true).catch(next)
})

router.get("/status/:id", async (req, res, next) => {
  let session

  try {
    session = await getPendingLogin(req.params.id)
  } catch (error) {
    next(error)
    return
  }

  res.set("Cache-Control", "no-store")

  if (!session) {
    res.status(404).json({
      status: "error",
      error: "Unknown Verus login request.",
    })
    return
  }

  res.json({
    status: session.status,
    error: session.error,
    redirectTo: session.redirectTo,
    verusId: session.verusId,
    verusIdName: session.verusIdName,
  })
  if (session.status !== "pending") {
    await removePendingLogin(session.id)
  }
})

export default router
