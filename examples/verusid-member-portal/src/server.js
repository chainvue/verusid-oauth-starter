import { assertProductionConfig, createConfig } from "@chainvue/verusid-oauth"
import { createApp } from "./app.js"

const config = createConfig({
  PORT: process.env.PORT || "5570",
  CLIENT_ID: process.env.CLIENT_ID || "verus-member-portal",
  CLIENT_SECRET: process.env.CLIENT_SECRET || "verus-member-secret",
  REDIRECT_URI: process.env.REDIRECT_URI || `http://${process.env.LOCAL_HOST || "192.168.0.160"}:5570/callback`,
  SESSION_SECRET: process.env.SESSION_SECRET || "local-member-portal-session-secret",
})

if (process.env.NODE_ENV === "production") {
  assertProductionConfig(config)
}

const app = createApp({ config })

app.listen(config.port, "0.0.0.0", () => {
  console.log(`VerusID Member Portal listening on http://0.0.0.0:${config.port}`)
})
