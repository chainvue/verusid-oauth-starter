import app from "./app"

const listenOn = Number(process.env.PORT || 3000)

app.listen(listenOn, () => {
  console.log(`Consent app listening on http://0.0.0.0:${listenOn}`)
})
