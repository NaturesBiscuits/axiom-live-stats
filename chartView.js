// Chart math is shared with tests; the renderer uses the locally bundled library.
(() => {
  "use strict";
  function exact(value) {
    if (!Number.isFinite(value)) return "unavailable";
    const text = String(value);
    if (!/[eE]/.test(text)) return text;
    const [mantissa, exponent] = text.toLowerCase().split("e");
    const sign = mantissa.startsWith("-") ? "-" : "";
    const unsigned = mantissa.replace(/^-/, ""), digits = unsigned.replace(".", "");
    const position = (unsigned.split(".")[0].length) + Number(exponent);
    if (position <= 0) return sign + "0." + "0".repeat(-position) + digits;
    if (position >= digits.length) return sign + digits + "0".repeat(position - digits.length);
    return sign + digits.slice(0, position) + "." + digits.slice(position);
  }
  function segments(samples, end) {
    const groups = []; let current = null;
    for (const row of samples) {
      if (row.timestamp <= end - 900 || row.timestamp > end) continue;
      if (row.value === null || row.stale || row.gap || !Number.isFinite(row.value)) { current = null; continue; }
      if (!current || row.timestamp !== current.at(-1).timestamp + 1) { current = []; groups.push(current); }
      current.push(row);
    }
    return groups;
  }
  function priceFormat(values) {
    const precision = Math.min(100, Math.max(2, ...values.filter(Number.isFinite)
      .map(value => (exact(value).split(".")[1] ?? "").length)));
    return {type: "custom", minMove: 10 ** -precision, base: 10 ** precision,
      formatter: value => exact(Number(value.toPrecision(12)))};
  }
  function createChart(container) {
    const L = globalThis.LightweightCharts;
    if (!L) throw new Error("Local Lightweight Charts bundle is missing. Run npm run vendor.");
    return L.createChart(container, {autoSize: true,
      layout: {background: {type: L.ColorType.Solid, color: "#10131b"}, textColor: "#a5b1c7", attributionLogo: true},
      grid: {vertLines: {color: "#202635"}, horzLines: {color: "#202635"}},
      rightPriceScale: {autoScale: true, minimumWidth: 105, borderColor: "#303743"},
      timeScale: {timeVisible: true, secondsVisible: true, borderColor: "#303743",
        tickMarkFormatter: time => new Date(Number(time) * 1000).toISOString().slice(11, 19)},
      localization: {timeFormatter: time => new Date(Number(time) * 1000).toISOString()},
      crosshair: {mode: L.CrosshairMode.Normal},
      handleScroll: true, handleScale: true});
  }
  function createRenderer(container, onHover, onFollowChange = () => {}) {
    const L = globalThis.LightweightCharts, chart = createChart(container);
    // Whitespace provides second slots without imposing a two-decimal price format.
    const timeline = chart.addSeries(L.LineSeries, {priceScaleId: "timeline", lineVisible: false, pointMarkersVisible: false,
      lastValueVisible: false, priceLineVisible: false});
    let series = [], previousKey = null, resetEnd = null, lastEnd = null, starts = [], lookup = new Map(), pointOnly = false;
    let following = true, fit = true, windowSeconds = 900, lastSamples = [], pointer = null;
    const setFollowing = value => { following = value; onFollowChange(value); };
    const pause = () => setFollowing(false);
    const pointerDown = event => { pointer = {x: event.clientX, y: event.clientY}; };
    const pointerMove = event => {
      if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3) pause();
    };
    const pointerUp = () => { pointer = null; };
    const eventBindings = [["wheel", pause], ["pointerdown", pointerDown], ["pointermove", pointerMove],
      ["pointerup", pointerUp], ["pointercancel", pointerUp], ["pointerleave", pointerUp], ["touchmove", pause]];
    for (const [name, listener] of eventBindings) container.addEventListener(name, listener, {passive: true});
    function applyRange() {
      if (lastEnd === null) return;
      const first = lastSamples.find(row => row.timestamp > lastEnd - windowSeconds &&
        Number.isFinite(row.value) && !row.stale && !row.gap)?.timestamp;
      const from = fit && first !== undefined ? Math.max(lastEnd - windowSeconds + 1, Math.min(first, lastEnd - 10)) : lastEnd - windowSeconds + 1;
      chart.timeScale().setVisibleRange({from, to: lastEnd});
    }
    chart.subscribeCrosshairMove(param => {
      if (param.time === undefined) return;
      onHover(Number(param.time), lookup.get(Number(param.time)) ?? null);
    });
    return {
      render(samples, end, key) {
        const changed = key !== previousKey;
        const pausedRange = !following && !changed ? chart.timeScale().getVisibleRange() : null;
        if (changed) setFollowing(true);
        lastSamples = samples;
        lookup = new Map(samples.map(row => [row.timestamp, row]));
        const groups = segments(samples, end);
        const dots = groups.length > 32;
        const plotted = dots ? [groups.flat()].filter(rows => rows.length) : groups;
        const rebuild = key !== previousKey || resetEnd === null || end < lastEnd || end - resetEnd >= 60 ||
          dots !== pointOnly || plotted.length !== series.length || plotted.some((rows, index) =>
            rows[0].timestamp < starts[index] || (index > 0 && rows[0].timestamp !== starts[index]));
        if (rebuild) {
          for (const api of series) chart.removeSeries(api);
          series = []; starts = plotted.map(rows => rows[0].timestamp);
          timeline.setData(Array.from({length: 900}, (_, index) => ({time: end - 899 + index})));
          resetEnd = end;
        } else if (end > lastEnd) {
          for (let time = lastEnd + 1; time <= end; time++) timeline.update({time});
        }
        const format = priceFormat(groups.flat().map(row => row.value));
        for (let index = 0; index < plotted.length; index++) {
          const rows = plotted[index];
          const options = {priceScaleId: "right", color: "#2fe3b0", lineWidth: 2, lineVisible: !dots, pointMarkersVisible: true,
            pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: index === plotted.length - 1 && rows.at(-1).timestamp === end,
            priceFormat: format};
          if (rebuild) { const api = chart.addSeries(L.LineSeries, options); api.setData(rows.map(row => ({time: row.timestamp, value: row.value}))); series.push(api); }
          else {
            const api = series[index], last = api.data().at(-1)?.time;
            api.applyOptions(options);
            for (const row of rows) if (last === undefined || row.timestamp >= last) api.update({time: row.timestamp, value: row.value});
          }
        }
        previousKey = key; lastEnd = end; pointOnly = dots;
        if (following) applyRange();
        else if (pausedRange) chart.timeScale().setVisibleRange(pausedRange);
        container.dataset.segments = groups.length;
        container.dataset.pointOnly = String(dots);
      },
      setWindow(seconds) { windowSeconds = seconds; fit = false; setFollowing(true); applyRange(); },
      fitAvailable() { fit = true; setFollowing(true); chart.priceScale("right").applyOptions({autoScale: true}); applyRange(); },
      follow() { setFollowing(true); chart.priceScale("right").applyOptions({autoScale: true}); applyRange(); },
      inspect: () => ({series: series.map(api => api.data()), version: L.version(), pointOnly,
        following, fit, windowSeconds, timelineScale: timeline.options().priceScaleId,
        formattedPrice: series[0]?.priceFormatter().format(series[0].data()[0]?.value),
        visibleRange: chart.timeScale().getVisibleRange()}),
      remove() { for (const [name, listener] of eventBindings) container.removeEventListener(name, listener); chart.remove(); }
    };
  }
  const api = {exact, segments, priceFormat, createChart, createRenderer};
  globalThis.AxiomChartView = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
