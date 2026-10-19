import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { edgeGecV2 } from "./vendor/edge-gec-v2.mjs";

// Fixtures generated with unmodified edge-tts 7.3.1 Python, not this JS port.
const vectors = JSON.parse(await readFile(new URL("./vendor/edge-gec-vectors.json", import.meta.url)));
test("v2 tokens match the independent Python reference across 38 timestamps", () => {
  for (const { now, token } of vectors) assert.equal(edgeGecV2(now), token, `clock ${now}`);
});
test("five-minute boundary changes the token; within-bucket milliseconds do not", () => {
  assert.equal(edgeGecV2(1792404000000), edgeGecV2(1792404299999));
  assert.notEqual(edgeGecV2(1792404299999), edgeGecV2(1792404300000));
});
test("single-entry cache permits time moving backwards without reusing another bucket", () => {
  for (const { now, token } of vectors.toReversed()) assert.equal(edgeGecV2(now), token);
});
test("invalid clocks fail before generating a connection token", () => {
  for (const now of [NaN, Infinity, -1, 1.5, "1792404000000", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => edgeGecV2(now), RangeError);
  }
});
