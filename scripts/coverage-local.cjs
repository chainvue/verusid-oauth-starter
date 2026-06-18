#!/usr/bin/env node

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const minimumWeightedLineCoverage = 70

const packages = [
  {
    label: "OAuth callback dashboard",
    cwd: "examples/oauth-callback-debug",
    command: "npm",
    args: ["run", "coverage"],
    summaryPath: "coverage/coverage-summary.json",
  },
  {
    label: "Express example",
    cwd: "examples/verusid-express-login",
    command: "npm",
    args: ["run", "coverage"],
    summaryPath: "coverage/coverage-summary.json",
  },
  {
    label: "Member portal example",
    cwd: "examples/verusid-member-portal",
    command: "npm",
    args: ["run", "coverage"],
    summaryPath: "coverage/coverage-summary.json",
  },
  {
    label: "Consent node",
    cwd: "consent-node",
    command: "pnpm",
    args: ["coverage"],
    summaryPath: "coverage/coverage-summary.json",
  },
]

let failed = false
let totalLines = 0
let coveredLines = 0
const summaries = []

for (const pkg of packages) {
  console.log(`\n> ${pkg.label} coverage`)
  const result = spawnSync(pkg.command, pkg.args, {
    cwd: path.join(root, pkg.cwd),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  })

  process.stdout.write(result.stdout || "")
  process.stderr.write(result.stderr || "")

  if (result.status !== 0) {
    failed = true
    console.error(`${pkg.label} coverage failed with exit ${result.status}`)
    continue
  }

  const summaryFile = path.join(root, pkg.cwd, pkg.summaryPath)
  const summary = readJson(summaryFile)
  if (!summary?.total?.lines) {
    failed = true
    console.error(`${pkg.label} did not write a readable line coverage summary at ${summaryFile}`)
    continue
  }

  const lines = summary.total.lines
  totalLines += lines.total
  coveredLines += lines.covered
  summaries.push({
    label: pkg.label,
    covered: lines.covered,
    total: lines.total,
    pct: lines.pct,
  })
}

if (summaries.length > 0) {
  console.log("\nCoverage summary")
  for (const summary of summaries) {
    console.log(`- ${summary.label}: ${summary.pct.toFixed(2)}% lines (${summary.covered}/${summary.total})`)
  }
}

const weightedLineCoverage = totalLines === 0 ? 0 : coveredLines / totalLines * 100
console.log(`Weighted line coverage: ${weightedLineCoverage.toFixed(2)}% (${coveredLines}/${totalLines})`)

if (weightedLineCoverage < minimumWeightedLineCoverage) {
  failed = true
  console.error(`Weighted line coverage must be at least ${minimumWeightedLineCoverage}%.`)
}

process.exitCode = failed ? 1 : 0

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}
