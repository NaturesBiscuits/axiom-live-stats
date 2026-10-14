// Two separate Chromium launches share only this run's unique temporary profile.
"use strict";
const {existsSync, mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join, resolve} = require("node:path");
const {pathToFileURL} = require("node:url");
const {runPage} = require("./chromium-harness.js");
const browser = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
if (!browser) throw new Error("Set CHROME_PATH to a Chromium executable.");
const profile = mkdtempSync(join(tmpdir(), "axiom-indexeddb-tests-"));
(async () => { try {
  for (const phase of ["write", "restart"]) {
    const url = pathToFileURL(resolve(__dirname, "storage-tests.html")); url.searchParams.set("phase", phase);
    const output = await runPage(profile, url.href);
    console.log(output.result);
    if (output.status !== "passed") { process.exitCode = 1; break; }
  }
} finally {
  if (resolve(profile).startsWith(resolve(tmpdir()) + "\\axiom-indexeddb-tests-") ||
      resolve(profile).startsWith(resolve(tmpdir()) + "/axiom-indexeddb-tests-")) rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
} })().catch(error => { console.error(error); process.exitCode = 1; });
