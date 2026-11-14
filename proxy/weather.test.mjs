// /api/weather: National Weather Service forecast for one fixed place.
// The fixture is a trimmed copy of real api.weather.gov replies for Detroit Lakes
// (captured 2026-11-14); every network call here is a stub.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import worker from "./cloudflare-worker.js";
import { weatherReport, resetWeatherCache, WEATHER_PLACE } from "./weather.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./weather.fixture.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-14T16:00:00Z"); // 10:00 AM CST, inside the fixture's hours
const origin = "https://ember.baxstarfishing.com";
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/geo+json" } });
const alert = (over = {}) => ({ properties: { status: "Actual", messageType: "Alert", event: "Wind Advisory", severity: "Moderate",
  headline: "Wind Advisory issued November 14 at 9:12AM CST until November 14 at 6:00PM CST by NWS Grand Forks ND", ends: "2026-11-14T18:00:00-06:00", ...over } });

function nws({ alerts = [], fail = {}, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    assert.equal(u.origin, "https://api.weather.gov");
    if (u.pathname.startsWith("/points/")) return fail.points ? reply({}, 503) : reply(fixture.points);
    if (u.pathname.endsWith("/forecast/hourly")) return fail.hourly ? reply({}, 500) : reply(fixture.hourly);
    if (u.pathname.endsWith("/forecast")) return fail.forecast ? reply({}, 500) : reply(fixture.forecast);
    if (u.pathname === "/alerts/active") return fail.alerts ? reply({}, 500) : reply({ features: alerts });
    throw new Error("unexpected NWS path " + u.pathname);
  };
}

test("a report carries periods, hours and a checked, empty alert list", async () => {
  resetWeatherCache();
  const calls = [];
  const report = await weatherReport(nws({ calls }), NOW);
  assert.equal(report.place, "Detroit Lakes, MN");
  assert.equal(report.source, "National Weather Service");
  assert.equal(report.fetchedAt, "2026-11-14T16:00:00.000Z");
  assert.equal(report.periods.length, 6);
  assert.deepEqual({ ...report.periods[0], detail: undefined }, { name: "Today", day: true, temp: 41, unit: "F", wind: "SSE 7 to 10 mph", pop: 0, short: "Mostly Sunny", detail: undefined });
  assert.match(report.periods[0].detail, /^Mostly sunny\. High near 41/);
  assert.equal(report.periods[1].day, false);
  assert.equal(report.hours.length, 12);
  assert.equal(report.hours[0].at, "2026-11-14T16:00:00.000Z"); // finished hours are dropped
  assert.ok(report.hours.every((h) => Number.isInteger(h.temp) && h.wind));
  assert.equal(report.alertsChecked, true);
  assert.deepEqual(report.alerts, []);
  assert.equal(report.stale, undefined);
  // Fixed place, generic client name, no redirects followed, no secrets.
  assert.ok(calls[0].url.endsWith(`/points/${WEATHER_PLACE.lat},${WEATHER_PLACE.lon}`));
  for (const c of calls) {
    assert.equal(c.init.headers["User-Agent"], "ember-dashboard-weather");
    assert.equal(c.init.redirect, "manual");
    assert.equal(JSON.stringify(c.init.headers).includes("@"), false);
  }
});

test("reports are cached for 10 minutes and the grid for a day", async () => {
  resetWeatherCache();
  const calls = [];
  const fetchImpl = nws({ calls });
  await weatherReport(fetchImpl, NOW);
  assert.equal(calls.length, 4);
  await weatherReport(fetchImpl, NOW + 9 * 60 * 1000);
  assert.equal(calls.length, 4);
  await weatherReport(fetchImpl, NOW + 11 * 60 * 1000);
  assert.equal(calls.length, 7); // forecast, hourly, alerts again; the grid lookup is reused
  assert.equal(calls.slice(4).some((c) => c.url.includes("/points/")), false);
});

test("active alerts are bounded, cleaned and cancelled ones dropped", async () => {
  resetWeatherCache();
  const report = await weatherReport(nws({ alerts: [
    alert(), alert({ messageType: "Cancel", event: "Dense Fog Advisory" }), alert({ status: "Test", event: "Test Message" }),
    alert({ event: "Winter Storm\nWarning", headline: "x".repeat(400), ends: null, expires: "2026-11-15T06:00:00-06:00" }),
  ] }), NOW);
  assert.equal(report.alerts.length, 2);
  assert.deepEqual(report.alerts[0], { event: "Wind Advisory", severity: "Moderate",
    headline: "Wind Advisory issued November 14 at 9:12AM CST until November 14 at 6:00PM CST by NWS Grand Forks ND", ends: "2026-11-15T00:00:00.000Z" });
  assert.equal(report.alerts[1].event, "Winter Storm Warning");
  assert.equal(report.alerts[1].headline.length, 220);
  assert.equal(report.alerts[1].ends, "2026-11-15T12:00:00.000Z");
});

test("a failed alert or hourly lookup never claims 'no alerts' and never fails the forecast", async () => {
  resetWeatherCache();
  const report = await weatherReport(nws({ fail: { alerts: true, hourly: true } }), NOW);
  assert.equal(report.periods.length, 6);
  assert.equal(report.alertsChecked, false);
  assert.deepEqual(report.hours, []);
});

test("an NWS outage serves the last report as stale for 3 hours, then fails", async () => {
  resetWeatherCache();
  await weatherReport(nws(), NOW);
  const down = nws({ fail: { forecast: true } });
  const stale = await weatherReport(down, NOW + 60 * 60 * 1000);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, "2026-11-14T16:00:00.000Z");
  await assert.rejects(weatherReport(down, NOW + 4 * 60 * 60 * 1000));
  resetWeatherCache();
  await assert.rejects(weatherReport(nws({ fail: { points: true } }), NOW));
});

test("a grid URL that leaves api.weather.gov is refused", async () => {
  resetWeatherCache();
  const evil = async (url) => String(url).includes("/points/")
    ? reply({ properties: { forecast: "https://evil.example/gridpoints/FGF/1,1/forecast" } }) : reply(fixture.forecast);
  await assert.rejects(weatherReport(evil, NOW));
});

test("the Worker route answers a signed-in page and nothing else", async () => {
  resetWeatherCache();
  const lines = []; const realLog = console.log; console.log = (l) => lines.push(l);
  try {
    const post = (options = {}) => worker.fetch(new Request(`${options.host || origin}/api/weather`, {
      method: options.method || "POST", headers: { Origin: options.origin || origin, "Content-Type": "application/json" },
      body: options.method === "GET" ? undefined : options.body ?? "",
    }), { ALLOWED_ORIGINS: origin }, {}, { fetch: options.fetch || nws(), now: () => NOW });
    const ok = await post();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Cache-Control"), "no-store");
    const body = await ok.json();
    assert.equal(body.place, "Detroit Lakes, MN");
    assert.equal(body.periods[0].name, "Today");
    // No ANTHROPIC_API_KEY in env: weather needs no key.
    assert.equal((await post({ origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ host: "https://ember-claude-proxy.brady-9d1.workers.dev" })).status, 404);
    assert.equal((await post({ method: "GET" })).status, 405);
    assert.equal((await post({ body: JSON.stringify({ pad: "x".repeat(2000) }) })).status, 413);
    resetWeatherCache();
    const down = await post({ fetch: nws({ fail: { points: true } }) });
    assert.equal(down.status, 502);
    assert.deepEqual(await down.json(), { error: "weather_unavailable" });
    assert.equal(lines.filter((l) => l === JSON.stringify({ ember: "weather", outcome: "unavailable" })).length, 1);
  } finally { console.log = realLog; }
});
