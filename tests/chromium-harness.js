"use strict";
const {spawn} = require("node:child_process");
const {existsSync} = require("node:fs");
const {readFile} = require("node:fs/promises");
const {join} = require("node:path");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runPage(profile, url) {
  const browser = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  if (!browser) throw new Error("Set CHROME_PATH to a Chromium executable.");
  const child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--disable-background-networking",
    "--no-default-browser-check", "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`],
  {windowsHide: true, stdio: ["ignore", "ignore", "ignore"]});
  let socket;
  try {
    let portInfo;
    // Chrome overwrites this file for each new launch of the unique test profile.
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const lines = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
        const candidate = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
        await new Promise((resolve, reject) => { candidate.addEventListener("open", resolve, {once: true}); candidate.addEventListener("error", reject, {once: true}); });
        socket = candidate; portInfo = lines; break;
      } catch { await pause(50); }
    }
    if (!portInfo) throw new Error("Local Chromium DevTools did not start.");
    let id = 0; const calls = new Map();
    socket.addEventListener("message", event => {
      const response = JSON.parse(event.data);
      const pending = calls.get(response.id);
      if (!pending) return;
      calls.delete(response.id); clearTimeout(pending.timer);
      response.error ? pending.reject(new Error(response.error.message)) : pending.resolve(response.result);
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { calls.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 20000);
      calls.set(requestId, {resolve, reject, timer});
      socket.send(JSON.stringify({id: requestId, method, params, sessionId}));
    });
    const target = await call("Target.createTarget", {url});
    const attached = await call("Target.attachToTarget", {targetId: target.targetId, flatten: true});
    let result;
    try { result = await call("Runtime.evaluate", {expression: `new Promise(resolve => {
      const check = () => document.body?.dataset.testStatus ? resolve({status: document.body.dataset.testStatus,
        result: document.getElementById('results').textContent}) : setTimeout(check, 25); check();
    })`, awaitPromise: true, returnByValue: true}, attached.sessionId); }
    catch (error) {
      const state = await call("Runtime.evaluate", {expression: `JSON.stringify({url: location.href, ready: document.readyState,
        status: document.body?.dataset.testStatus, result: document.getElementById('results')?.textContent})`, returnByValue: true}, attached.sessionId).catch(() => null);
      throw new Error(`${error.message}; page state: ${state?.result?.value ?? "unavailable"}`);
    }
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    await call("Browser.close").catch(() => {});
    return result.result.value;
  } finally {
    socket?.close();
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
module.exports = {runPage};
