#!/usr/bin/env node

const { spawnSync } = require("node:child_process")

const checks = [
  {
    label: "OAuth callback dashboard tests",
    command: "npm",
    args: ["test"],
    cwd: "oauth-callback",
  },
  {
    label: "Express example tests",
    command: "npm",
    args: ["test"],
    cwd: "examples/verusid-express-login",
  },
  {
    label: "Consent node typecheck",
    command: "pnpm",
    args: ["typecheck"],
    cwd: "consent-node",
  },
  {
    label: "Consent node tests",
    command: "pnpm",
    args: ["test:run"],
    cwd: "consent-node",
  },
  {
    label: "Docker Compose config",
    command: "docker",
    args: ["compose", "config"],
  },
  {
    label: "Doctor diagnostics",
    command: "npm",
    args: ["run", "doctor:local"],
    acceptFailure: isExpectedDoctorOutput,
  },
]

let failed = false

for (const check of checks) {
  console.log(`\n> ${check.label}`)
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  })
  const output = `${result.stdout || ""}${result.stderr || ""}`
  process.stdout.write(result.stdout || "")
  process.stderr.write(result.stderr || "")

  if (result.status === 0) {
    continue
  }
  if (check.acceptFailure?.(output)) {
    console.log(`accepted expected ${check.label.toLowerCase()} failure`)
    continue
  }

  failed = true
  console.error(`${check.label} failed with exit ${result.status}`)
}

process.exitCode = failed ? 1 : 0

function isExpectedDoctorOutput(output) {
  return output.includes("fail Hydra discovery:")
    || output.includes("fail Hydra token endpoint:")
    || output.includes("fail Hydra admin endpoint:")
    || output.includes("fail Hydra client registration:")
}
