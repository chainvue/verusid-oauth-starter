import { createConfig } from "@chainvue/verusid-oauth"
import { createApp } from "./app.js"
import { printStartupWarnings } from "./startup.js"

const config = createConfig()
const app = createApp({ config })

app.listen(config.port, "0.0.0.0", () => {
  printStartupWarnings(config)
  console.log(`VerusID Express Login listening on http://0.0.0.0:${config.port}`)
})
