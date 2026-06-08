import csrf from "csurf"

export const csrfProtection = csrf({
  cookie: {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
})
