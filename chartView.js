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
  function createRenderer(container, onHover) {
    const L = globalThis.LightweightCharts;
    if (!L) throw new Error("Local Lightweight Charts bundle is missing. Run npm run vendor.");
    const chart = L.createChart(container, {autoSize: true,
      layout: {background: {type: L.ColorType.Solid, color: "#10131b"}, textColor: "#a5b1c7", attributionLogo: true},
      grid: {vertLines: {color: "#202635"}, horzLines: {color: "#202635"}},
      rightPriceScale: {autoScale: true, minimumWidth: 105, borderColor: "#303743"},
      timeScale: {timeVisible: true, secondsVisible: true, borderColor: "#303743",
        tickMarkFormatter: time => new Date(Number(time) * 1000).toISOString().slice(11, 19)},
      localization: {timeFormatter: time => new Date(Number(time) * 1000).toISOString()},
      crosshair: {mode: L.CrosshairMode.Normal},
      handleScroll: false, handleScale: false});
    const timeline = chart.addSeries(L.LineSeries, {lineVisible: false, pointMarkersVisible: false,
      lastValueVisible: false, priceLineVisible: false});
    let series = [], previousKey = null, resetEnd = null, lastEnd = null, starts = [], lookup = new Map(), pointOnly = false;
    chart.subscribeCrosshairMove(param => {
      if (param.time === undefined) return;
      onHover(Number(param.time), lookup.get(Number(param.time)) ?? null);
    });
    return {
      render(samples, end, key) {
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
        const precision = Math.min(24, Math.max(2, ...groups.flat().map(row => (exact(row.value).split(".")[1] ?? "").length)));
        const format = {type: "custom", minMove: 10 ** -precision, base: 10 ** precision,
          formatter: value => exact(Number(value.toPrecision(12)))};
        for (let index = 0; index < plotted.length; index++) {
          const rows = plotted[index];
          const options = {color: "#2fe3b0", lineWidth: 2, lineVisible: !dots, pointMarkersVisible: true,
            pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: index === plotted.length - 1 && rows.at(-1).timestamp === end,
            priceFormat: format};
          if (rebuild) { const api = chart.addSeries(L.LineSeries, options); api.setData(rows.map(row => ({time: row.timestamp, value: row.value}))); series.push(api); }
          else {
            const api = series[index], last = api.data().at(-1)?.time;
            api.applyOptions(options);
            for (const row of rows) if (last === undefined || row.timestamp >= last) api.update({time: row.timestamp, value: row.value});
          }
        }
        chart.timeScale().setVisibleRange({from: end - 899, to: end});
        previousKey = key; lastEnd = end; pointOnly = dots;
        container.dataset.segments = groups.length;
        container.dataset.pointOnly = String(dots);
      },
      inspect: () => ({series: series.map(api => api.data()), version: L.version(), pointOnly,
        visibleRange: chart.timeScale().getVisibleRange()}),
      remove: () => chart.remove()
    };
  }
  const api = {exact, segments, createRenderer};
  globalThis.AxiomChartView = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
