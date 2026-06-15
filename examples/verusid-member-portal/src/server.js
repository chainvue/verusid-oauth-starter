import { assertProductionConfig } from "@chainvue/verusid-oauth"
import { createApp, createMemberPortalConfig } from "./app.js"

const config = createMemberPortalConfig()

if (process.env.NODE_ENV === "production") {
  assertProductionConfig(config)
}

const app = createApp({ config })

app.listen(config.port, "0.0.0.0", () => {
  console.log(`VerusID Member Portal listening on http://0.0.0.0:${config.port}`)
})
