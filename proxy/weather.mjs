// WEATHER (2026-11-14). Brady asked for Ember to "check the weather on a daily
// basis" and picked the National Weather Service ("NWS") over an OpenWeather key:
// api.weather.gov is free, needs no account or secret, and is the official
// forecast and alert source for Detroit Lakes. The Worker fetches it server-side
// and returns one small, fixed-shape report; the dashboard puts that report in the
// chat context so Ember answers weather questions from real data, never a guess.
//
// The place is a server constant: the browser sends nothing that picks a URL.
// NWS asks automated clients to identify themselves in User-Agent; this sends a
// generic client name only, no personal contact details.
export const WEATHER_PLACE = { name: "Detroit Lakes, MN", lat: 46.8172, lon: -95.8453 };
const NWS_ORIGIN = "https://api.weather.gov";
const NWS_HEADERS = { "User-Agent": "ember-dashboard-weather", Accept: "application/geo+json" };
const FETCH_TIMEOUT_MS = 8000;
const REPORT_TTL_MS = 10 * 60 * 1000;
const GRID_TTL_MS = 24 * 60 * 60 * 1000;
// A forecast this old is still better than nothing when NWS is briefly down, and
// it is labelled stale so Ember says how old it is.
const STALE_OK_MS = 3 * 60 * 60 * 1000;
const PERIODS = 6, HOURS = 12, ALERTS = 5;

// Module scope survives between requests on a warm isolate; a cold one refetches.
const cache = { grid: null, report: null };
export function resetWeatherCache() { cache.grid = null; cache.report = null; }

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// NWS text ends up in a model prompt: one line, printable, bounded.
const line = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : undefined;
const int = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined;
const wind = (p) => [line(p.windDirection, 4), line(p.windSpeed, 24)].filter(Boolean).join(" ");
const pop = (p) => int(p?.probabilityOfPrecipitation?.value ?? 0, 0, 100);

function nwsUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === NWS_ORIGIN && url.pathname.startsWith("/gridpoints/") && !url.search ? url.href : null;
  } catch { return null; }
}

async function nwsJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: NWS_HEADERS, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error("nws " + response.status);
  const data = await response.json();
  if (!isRecord(data)) throw new Error("nws shape");
  return data;
}

async function grid(fetchImpl, now) {
  if (cache.grid && now - cache.grid.at < GRID_TTL_MS) return cache.grid;
  const data = await nwsJson(`${NWS_ORIGIN}/points/${WEATHER_PLACE.lat},${WEATHER_PLACE.lon}`, fetchImpl);
  const forecast = nwsUrl(data.properties?.forecast), hourly = nwsUrl(data.properties?.forecastHourly);
  if (!forecast) throw new Error("nws grid");
  cache.grid = { at: now, forecast, hourly };
  return cache.grid;
}

function periods(data) {
  const list = Array.isArray(data?.properties?.periods) ? data.properties.periods : [];
  return list.filter(isRecord).slice(0, PERIODS).map((p) => ({
    name: line(p.name, 24), day: p.isDaytime !== false, temp: int(p.temperature, -90, 140), unit: p.temperatureUnit === "C" ? "C" : "F",
    wind: wind(p), pop: pop(p), short: line(p.shortForecast, 80), detail: line(p.detailedForecast, 260),
  })).filter((p) => p.name && p.temp !== undefined);
}

function hours(data, now) {
  const list = Array.isArray(data?.properties?.periods) ? data.properties.periods : [];
  return list.filter((p) => isRecord(p) && Date.parse(p.endTime) > now).slice(0, HOURS).map((p) => ({
    at: iso(p.startTime), temp: int(p.temperature, -90, 140), wind: wind(p), pop: pop(p), short: line(p.shortForecast, 48),
  })).filter((p) => p.at && p.temp !== undefined);
}

function alerts(data) {
  const list = Array.isArray(data?.features) ? data.features : [];
  return list.map((f) => f?.properties).filter(isRecord).filter((p) => p.status === "Actual" && p.messageType !== "Cancel")
    .slice(0, ALERTS).map((p) => ({
      event: line(p.event, 60), severity: line(p.severity, 12), headline: line(p.headline, 220),
      ends: iso(p.ends) || iso(p.expires),
    })).filter((a) => a.event);
}

export async function weatherReport(fetchImpl, now) {
  if (cache.report && now - cache.report.at < REPORT_TTL_MS) return cache.report.value;
  try {
    const g = await grid(fetchImpl, now);
    const [forecast, hourly, active] = await Promise.allSettled([
      nwsJson(g.forecast, fetchImpl),
      g.hourly ? nwsJson(g.hourly, fetchImpl) : Promise.reject(new Error("no hourly")),
      nwsJson(`${NWS_ORIGIN}/alerts/active?point=${WEATHER_PLACE.lat},${WEATHER_PLACE.lon}`, fetchImpl),
    ]);
    if (forecast.status !== "fulfilled") throw new Error("nws forecast");
    const list = periods(forecast.value);
    if (!list.length) throw new Error("nws empty");
    const value = {
      place: WEATHER_PLACE.name, source: "National Weather Service",
      fetchedAt: new Date(now).toISOString(), updatedAt: iso(forecast.value.properties?.updateTime),
      periods: list,
      hours: hourly.status === "fulfilled" ? hours(hourly.value, now) : [],
      // "No alerts" is only true when the alert lookup itself succeeded.
      alertsChecked: active.status === "fulfilled",
      alerts: active.status === "fulfilled" ? alerts(active.value) : [],
    };
    cache.report = { at: now, value };
    return value;
  } catch (error) {
    if (cache.report && now - cache.report.at < STALE_OK_MS) return { ...cache.report.value, stale: true };
    throw error;
  }
}

export async function handleWeather(cors, fetchImpl, now, log = console.log) {
  const headers = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    return new Response(JSON.stringify(await weatherReport(fetchImpl, now)), { status: 200, headers });
  } catch {
    // One fixed word to the browser and one line to Workers Logs; no upstream text.
    try { log(JSON.stringify({ ember: "weather", outcome: "unavailable" })); } catch {}
    return new Response(JSON.stringify({ error: "weather_unavailable" }), { status: 502, headers });
  }
}
