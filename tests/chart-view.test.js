"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const View = require("../chartView.js");
test("exact hover values retain small-price digits without fixed two-decimal rounding", () => {
  assert.equal(View.exact(0.00000123), "0.00000123");
  assert.equal(View.exact(0.00000000000045), "0.00000000000045");
  assert.equal(View.exact(1.23e-20), "0.0000000000000000000123");
  assert.equal(View.exact(1230000), "1230000");
});
test("line groups cannot join missing or unavailable slots", () => {
  const samples = [{timestamp: 100, value: 1}, {timestamp: 101, value: 1}, {timestamp: 102, value: null, gap: true},
    {timestamp: 103, value: 2}, {timestamp: 105, value: 2}, {timestamp: 106, value: null, stale: true}];
  assert.deepEqual(View.segments(samples, 106).map(group => group.map(row => row.timestamp)), [[100, 101], [103], [105]]);
});
test("axis formatting retains tiny values beyond 24 decimals and finite step sizes", () => {
  const format = View.priceFormat([1.23e-30, 1.24e-30]);
  assert.equal(format.formatter(1.23e-30), "0.00000000000000000000000000000123");
  assert(format.minMove <= 1e-32 && Number.isFinite(format.base));
  assert.equal(View.priceFormat([]).minMove, 0.01);
});
