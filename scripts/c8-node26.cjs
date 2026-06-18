#!/usr/bin/env node

const Module = require("node:module")

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (request === "yargs/yargs") {
    return originalLoad("yargs", parent, isMain)
  }
  return originalLoad(request, parent, isMain)
}

require("c8/bin/c8")
