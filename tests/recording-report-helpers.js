"use strict";

// Independent reader for the documented text format, used to verify lossless reports.
function readReport(text) {
  const section = (start, end) => text.split(`${start}\n`)[1].split(`\n${end}`)[0].trim();
  const header = JSON.parse(text.split("\n")[4]);
  const clock = section("SAMPLE CLOCK", "BASELINE").split("\n").filter(Boolean).map(JSON.parse);
  const baseline = JSON.parse(section("BASELINE — sample 0 (shared definitions and initial values)", "FIELD TIMELINES"));
  const timelines = section("FIELD TIMELINES — one JSON object per line", "END OF RECORDING").split("\n").filter(Boolean).map(JSON.parse);
  const fields = new Map();
  function visit(value, parts = []) {
    const path = parts.length ? `/${parts.map(key => String(key).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
    fields.set(path, value !== null && typeof value === "object" ? [Array.isArray(value) ? "array" : "object"] : value);
    if (value !== null && typeof value === "object") for (const key of Object.keys(value)) visit(value[key], [...parts, key]);
  }
  if (baseline !== null) visit(baseline);
  const rows = clock.map(([sequence, loggedMs, observedMs, gapBeforeMs], index) => {
    const current = new Map(fields);
    for (const timeline of timelines) {
      for (const path of timeline.paths) {
        let value = fields.has(path) ? fields.get(path) : ["absent"];
        if (timeline.clock) value = timeline.clock === "loggedMs" ? loggedMs + header.startedAt : observedMs + header.startedAt;
        else if (timeline.values) {
          value = timeline.values[index];
          if (timeline.time && typeof value === "number") value += header.startedAt;
        } else {
          for (const [sample, change] of timeline.changes) {
            if (sample > index) break;
            value = timeline.time && typeof change === "number" ? change + header.startedAt : change;
          }
        }
        current.set(path, value);
      }
    }
    let data;
    for (const [path, value] of [...current].sort((a, b) => a[0].split("/").length - b[0].split("/").length)) {
      if (Array.isArray(value) && value[0] === "absent") continue;
      const decoded = Array.isArray(value) ? value[0] === "array" ? [] : {} : value;
      if (path === "") { data = decoded; continue; }
      const keys = path.slice(1).split("/").map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"));
      let parent = data;
      for (const key of keys.slice(0, -1)) parent = parent[key];
      Object.defineProperty(parent, keys.at(-1), {value: decoded, writable: true, enumerable: true, configurable: true});
    }
    const loggedAt = header.startedAt + loggedMs, observedAt = header.startedAt + observedMs;
    return {sequence, loggedAt, loggedAtUTC: new Date(loggedAt).toISOString(), observedAt,
      observedAtUTC: new Date(observedAt).toISOString(), elapsedMs: loggedMs, gapBeforeMs, ...data};
  });
  return {header, rows};
}
module.exports = {readReport};
