"use strict";
const {spawn} = require("node:child_process");
const {existsSync} = require("node:fs");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runPage(profile, url) {
  const browser = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  if (!browser) throw new Error("Set CHROME_PATH to a Chromium executable.");
  const child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--disable-background-networking",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
    "--no-default-browser-check", "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`],
  {windowsHide: true, stdio: ["ignore", "ignore", "pipe"]});
  let diagnostics = "", endpoint = null;
  child.stderr.on("data", chunk => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
    endpoint = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] ?? endpoint;
  });
  let socket;
  let launchError;
  let closedNormally = false;
  child.on("error", error => { launchError = error; });
  try {
    let portInfo;
    // Read this launch's endpoint from stderr. Polling DevToolsActivePort can lock
    // Chrome's rewrite on Windows and can connect a restart to the previous port.
    for (let attempt = 0; attempt < 200; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Chromium exited during startup (${child.exitCode}).`);
      try {
        if (!endpoint) { await pause(50); continue; }
        const candidate = new WebSocket(endpoint);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { candidate.close(); reject(new Error("DevTools startup socket timed out.")); }, 1000);
          candidate.addEventListener("open", () => { clearTimeout(timer); resolve(); }, {once: true});
          candidate.addEventListener("error", error => { clearTimeout(timer); reject(error); }, {once: true});
        });
        socket = candidate; portInfo = endpoint; break;
      } catch { await pause(50); }
    }
    if (!portInfo) throw new Error("Local Chromium DevTools did not start.");
    let id = 0; const calls = new Map(), events = new Map();
    socket.addEventListener("message", event => {
      const response = JSON.parse(event.data);
      if (response.method) events.get(`${response.sessionId}:${response.method}`)?.(response.params);
      const pending = calls.get(response.id);
      if (!pending) return;
      calls.delete(response.id); clearTimeout(pending.timer);
      response.error ? pending.reject(new Error(response.error.message)) : pending.resolve(response.result);
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { calls.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 60000);
      calls.set(requestId, {resolve, reject, timer});
      socket.send(JSON.stringify({id: requestId, method, params, sessionId}));
    });
    const target = await call("Target.createTarget", {url: "about:blank"});
    const attached = await call("Target.attachToTarget", {targetId: target.targetId, flatten: true});
    await call("Page.enable", {}, attached.sessionId);
    let loadTimer;
    const loaded = new Promise((resolve, reject) => {
      loadTimer = setTimeout(() => reject(new Error("Fixture navigation timed out.")), 20000);
      events.set(`${attached.sessionId}:Page.loadEventFired`, () => { clearTimeout(loadTimer); resolve(); });
    });
    loaded.catch(() => {});
    try { await call("Page.navigate", {url}, attached.sessionId); await loaded; }
    finally { clearTimeout(loadTimer); events.delete(`${attached.sessionId}:Page.loadEventFired`); }
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
    closedNormally = true;
    return result.result.value;
  } catch (error) {
    throw new Error(`${error.message}${diagnostics ? `; Chromium: ${diagnostics}` : ""}`);
  } finally {
    socket?.close();
    if (closedNormally && child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(resolve, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    if (child.exitCode === null) {
      if (process.platform === "win32" && child.pid) await new Promise(resolve => {
        // Only the browser process tree launched with this run's unique temporary profile.
        const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true, stdio: "ignore"});
        cleanup.once("error", resolve); cleanup.once("exit", resolve);
      });
      else child.kill();
      if (child.exitCode === null) await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}
module.exports = {runPage};
