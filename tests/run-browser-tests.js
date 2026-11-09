// Real wall-clock Chrome fixture; no third-party test packages required.
"use strict";
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join, resolve} = require("node:path");
const {pathToFileURL} = require("node:url");
const {runPage} = require("./chromium-harness.js");
const profile = mkdtempSync(join(tmpdir(), "axiom-holder-tests-"));
(async () => { try {
  for (const page of ["bundler-browser-tests.html", "browser-tests.html", "trading-browser-tests.html", "historical-browser-tests.html", "supply-browser-tests.html", "recording-browser-tests.html", "live-signals-browser-tests.html"]) {
    const output = await runPage(profile, pathToFileURL(resolve(__dirname, page)).href);
    console.log(output.result);
    if (output.status !== "passed") { process.exitCode = 1; break; }
  }
} finally {
  // Only remove the exact unique temporary directory created by this test run.
  if (profile.startsWith(join(tmpdir(), "axiom-holder-tests-"))) {
    try { rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}); }
    catch (error) { console.error(`Temporary browser profile cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
} })().catch(error => { console.error(error); process.exitCode = 1; });
