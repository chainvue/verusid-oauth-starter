import app from "./app"
import { assertConsentNodeProductionConfig } from "./config"

const listenOn = Number(process.env.PORT || 3000)

if (process.env.NODE_ENV === "production") {
  assertConsentNodeProductionConfig()
}

app.listen(listenOn, () => {
  console.log(`Consent app listening on http://0.0.0.0:${listenOn}`)
})
