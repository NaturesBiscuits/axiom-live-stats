// Real wall-clock Chrome fixture; no third-party test packages required.
"use strict";
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join, resolve} = require("node:path");
const {pathToFileURL} = require("node:url");
const {runPage} = require("./chromium-harness.js");
const profile = mkdtempSync(join(tmpdir(), "axiom-holder-tests-"));
(async () => { try {
  const output = await runPage(profile, pathToFileURL(resolve(__dirname, "browser-tests.html")).href);
  console.log(output.result);
  if (output.status !== "passed") process.exitCode = 1;
} finally {
  // Only remove the exact unique temporary directory created by this test run.
  if (profile.startsWith(join(tmpdir(), "axiom-holder-tests-"))) rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
} })().catch(error => { console.error(error); process.exitCode = 1; });
