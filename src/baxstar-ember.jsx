import { useState, useEffect, useRef } from "react";

/* ============================================================
   BAXSTAR EMBER — FULL JARVIS BUILD v4.1
   ------------------------------------------------------------
   v4 adds:
     · Claude Chat: model toggle (Haiku / Sonnet / Opus / Fable) +
       effort level (Low / Std / High). Non-Sonnet models
       auto-fall back to Sonnet 4.6 if the gateway rejects them.
     · Google Drive tool in the Studio rail (real Drive icon) —
       search + read Agent OS docs via the Drive connector.
     · Background system for OPS + Studio: 4 built-in scene
       presets + upload-your-own (persisted on this device).

   MODULES: OPS | BAXSTAR STUDIO (Claude Chat, AI Handoff,
   Caption Studio, Google Drive).
   ============================================================ */

/* ---------- CONFIG ---------- */

const MCP_SERVERS = [
  // Quo is DESCOPED (2026-08-19, verified live): mcp.quo.com only accepts OAuth
  // clients on Quo's own allowlist — dynamic registration rejects every redirect
  // URI we control, and a valid API key is refused as a bearer. Worse than
  // useless in this list: one dead connector trips the worker's degrade guard,
  // which strips ALL connectors from the retry, taking Gmail and Calendar down
  // with it. Do not re-add without a Quo-issued client id.
  { type: "url", url: "https://gmailmcp.googleapis.com/mcp/v1", name: "gmail" },
  { type: "url", url: "https://calendarmcp.googleapis.com/mcp/v1", name: "calendar" },
];
const DRIVE_SERVER = { type: "url", url: "https://drivemcp.googleapis.com/mcp/v1", name: "gdrive" };

const HANDOFF_DOC_URL = "https://docs.google.com/document/d/1Gfs1H5KTmj5C7_-wm6AVs1IUO9ET1as8gVibHvdybns/edit";

const BRADY_CONTEXT = `You are EMBER, Brady Baxter's operations assistant for Baxstar Fishing and Lakes Golf Simulator in Detroit Lakes, MN.
Quo phone inboxes: Fishing 218-325-6857, Pontoon rentals 218-325-9846.
Style: BLUF — bottom line first. Concise. No hedging. Numerals without commas.
Customer-facing drafts: premium-but-warm, sign "Brady @ Baxstar". Fishing number in fishing comms, pontoon number in rental comms. Never mention Scheels rods. Never say "one group per day" — use "private trip(s)".
Use your tools (Quo, Gmail, Calendar) whenever the request involves calls, voicemails, texts, email, or schedule.
HARD RULE — schedule and messages: if a tool is unavailable or returns nothing, say exactly that ("I can't see your calendar right now") and STOP. Never state that a trip, booking, or message does or doesn't exist unless a tool actually returned that data. A guessed "you're free tomorrow" can cost Brady a paid charter.`;

// Appended to the system turn only while the voice toggle is on. Without this
// she answers from self-knowledge — "I'm text-based" — because nothing told
// her the reply is read aloud.
/* Sent when spoken output is OFF. Without it the model had no idea the app can speak at
   all, and invented a limitation — it told Brady "I'm not able to push audio to your
   device from my end… you'd need text-to-speech enabled on your side", which is both
   wrong and unfixable-sounding. The app speaks every reply whenever voice is on. */
const VOICE_OFF_CONTEXT = `
Spoken output is currently OFF in the app, so this reply will be read on screen, not heard. If asked to speak: say voice is switched off and it turns back on with the VOICE button — never claim you are unable to produce audio or that speech is something the user must add on their end. The app speaks your replies whenever voice is on.`;

/* The ONE spoken ruleset. The voice rig (voice/ember-demo.html) speaks with these same
   rules — scripts/sync-standalone.py copies this constant into its generated config, the
   same way it copies BRADY_CONTEXT. It used to keep its own hand-written version, which
   drifted from this one — same failure as the old config drift, just with prose. */
const VOICE_CONTEXT = `
Voice: your reply is spoken aloud through Ember's voice AND shown on screen. You are not text-only — never claim to be. Write for the ear: answer first in one or two short sentences, then detail only if asked. No bullet lists, no markdown, no headings. Never say a URL or an email address unless asked for it directly. Numbers and times said the way a person says them: 'two eighteen, three two five, six eight five seven', 'a hundred forty nine a month', 'eighty two percent'.`;

const DRIVE_CONTEXT = `You are EMBER's Drive librarian for Brady Baxter. Use your Google Drive tools to search and read files to answer.
Key doc: "Baxstar Handoff Log" (Google Doc ID 1Gfs1H5KTmj5C7_-wm6AVs1IUO9ET1as8gVibHvdybns) — the canonical source of truth.
The Agent OS lives in the "Baxstar Data Engine" folder: 01 Identity, 02 Context Library, 03 Skills, 04 Memory + Logs, 05 Verification, 06 Agents, 07 Automations, 08 Archive, 09 Handoff (Shared).
READ ONLY — never modify files. BLUF answers. Name the doc(s) you pulled from.`;

/* EDIT HERE if a handle is off — one place, used everywhere.

   Handles are the canonical set from "Baxstar Caption Tool — Consolidation Notes" §2 and
   the standalone tool at baxstarcode/caption-studio. Two of them are easy to get wrong:
   Vexus's boat account is @therealvexusboats (NOT @vexusboats, which is a different
   account) and its apparel/logo account is @therealvexus. Detroit Lake carries two
   handles, which is why every entry stores a `handles` ARRAY.

   `detect` is the vision key the photo scan sets. Entries without one (Detroit Lake,
   J&K Marine) aren't visually identifiable and stay manual toggles.

   Tagging is confirm-before-post by design: vision only pre-arms a chip, Brady approves. */
const SPONSORS = {
  vexus:     { label: "Vexus boat",       handles: ["@therealvexusboats"], detect: "vexusBoat" },
  vexusLogo: { label: "Vexus apparel",    handles: ["@therealvexus"],      detect: "vexusLogo" },
  mercury:   { label: "Mercury",          handles: ["@mercurymarine"],     detect: "mercury" },
  powerPole: { label: "Power-Pole",       handles: ["@power.pole"],        detect: "powerPole" },
  striker:   { label: "Striker",          handles: ["@strikerbrands"],     detect: "striker" },
  eternal:   { label: "Eternal Lithium",  handles: ["@eternallithium"],    detect: "eternalLithium" },
  igogs:     { label: "iGOGS shades",     handles: ["@igogs"],             detect: "sunglasses" },
  summit:    { label: "Summit Fishing",   handles: ["@summitfishingequipment"], detect: "summit" },
  detroit:   { label: "Detroit Lake",     handles: ["@dlchamber", "@detroitlakesminnesota"] },
  jk:        { label: "J&K Marine",       handles: ["@jandkmarine"] },
};

const SPONSOR_KEYS = Object.keys(SPONSORS);

/* What each detectable brand actually looks like in a boat photo. These go into the vision
   prompt verbatim — vague keys like "vexusDetected" produced false positives on any white
   hull, so each one says what to look for and the prompt tells the model to stay
   conservative. A wrong tag notifies the wrong company, so a miss is cheaper than a hit. */
const SPONSOR_VISION_HINT = {
  vexus:     "a Vexus boat — hull, console, deck, or the Vexus name on the boat itself",
  vexusLogo: "the Vexus name or logo on CLOTHING — a shirt, hat, or jersey, not the boat",
  mercury:   "a Mercury outboard motor, or the Mercury name/logo on the cowling",
  powerPole: "a Power-Pole shallow-water anchor — the vertical pole unit on the transom",
  striker:   "Striker-branded apparel — jacket, bibs, or hat carrying the Striker name",
  eternal:   "an Eternal Lithium battery or its branding",
  igogs:     "someone wearing sunglasses (iGOGS is the shades sponsor)",
  summit:    "Summit Fishing Equipment gear, apparel, or logo",
};

// Every handle for the chips that are switched on, flattened and de-duplicated.
function activeHandles(sponsors) {
  const out = [];
  SPONSOR_KEYS.forEach((k) => {
    if (!sponsors[k]?.on) return;
    SPONSORS[k].handles.forEach((h) => { if (!out.includes(h)) out.push(h); });
  });
  return out;
}

// A fresh chip set: nothing on, nothing detected.
function blankSponsors() {
  const s = {};
  SPONSOR_KEYS.forEach((k) => { s[k] = { on: false, detected: false }; });
  return s;
}

const LOCKED_TAG = "#getyourbassingear";

/* ---------- POSTING TIME ----------
   Stored as 24h "HH:MM" so a custom time is just a value, not a new case. The two
   presets are the usual windows; the picker covers everything else.

   nextPostAt() is the load-bearing one: it returns a real ISO timestamp for the next
   occurrence of that wall-clock time in US Central, which is what a Zapier Delay-Until
   step needs. Sending the label "4 PM CT" instead would make the Zap parse English and
   guess a date — and guess wrong the moment a caption is written after 4 PM. */
const POST_PRESETS = ["16:00", "19:00"];
const POST_TZ = "America/Chicago";

// Minutes Central is offset from UTC at that instant (negative — Central is behind).
// Derived from Intl rather than hardcoded so CDT/CST switches itself.
function centralOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: POST_TZ, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? 0 : Number(parts.hour); // some ICU builds emit 24
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return (asUTC - date.getTime()) / 60000;
}

function fmtPostTime(hhmm) {
  const [h, m] = String(hhmm || "16:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${ampm} CT`;
}

/* Accepts either the new "HH:MM" or a legacy "4 PM CT" label, so a saved pref or a
   recovered draft from before the picker existed still lands on a valid time. */
function toPostTime(v) {
  if (!v) return "16:00";
  if (/^\d{1,2}:\d{2}$/.test(v)) return v.padStart(5, "0");
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(String(v).trim());
  if (!m) return "16:00";
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
}

// ISO timestamp of the next time it is HH:MM in Central. Today if still ahead, else tomorrow.
function nextPostAt(hhmm, now = new Date()) {
  const [h, m] = toPostTime(hhmm).split(":").map(Number);
  const [y, mo, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: POST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now).split("-").map(Number);

  // Two passes: the first offset guess can be wrong across a DST boundary.
  const build = (yy, mm, dd) => {
    const wall = Date.UTC(yy, mm - 1, dd, h, m, 0);
    let ms = wall;
    for (let i = 0; i < 2; i++) ms = wall - centralOffsetMinutes(new Date(ms)) * 60000;
    return ms;
  };

  let ms = build(y, mo, d);
  if (ms <= now.getTime()) {
    const t = new Date(Date.UTC(y, mo - 1, d) + 86400000);
    ms = build(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return new Date(ms).toISOString();
}

const HANDOFF = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com", color: "#10a37f" },
  gemini:  { label: "Gemini",  url: "https://gemini.google.com", color: "#4285f4" },
};

/* ---------- PROJECTS DASHBOARD DATA ----------
   SESSION-MAINTAINED, per Baxstar_AI_Context Rule 15: when a session ships work on any
   of these, it updates pct / outstanding / sessions here in the same commit. Numbers are
   honest estimates, not telemetry — the point is one glanceable page that can't get lost
   in a chat the way the first version of this dashboard did.
   zapierTasks.used is Brady-reported (the client can't query Zapier live); null renders
   as "not recorded" rather than pretending. Allowance per Rule 14: 1,500/mo. */
const PROJECTS_META = {
  updated: "2026-08-01",
  zapierTasks: { used: null, cap: 1500, note: "check zapier.com/app/tasks" },
};

const PROJECTS = [
  {
    cat: "Revenue Generating",
    items: [
      { name: "baxstarfishing.com build", pct: 90, platform: "Claude",
        links: [["site", "https://baxstarfishing.com"], ["wix editor", "https://manage.wix.com/"]],
        outstanding: "Schema/SEO polish, PR #24 Open Water page", sessions: "~2" },
      { name: "Pontoon rentals stack", pct: 100, platform: "Claude",
        links: [["repo", "https://github.com/baxstarcode/baxstar-pontoon"]],
        outstanding: "Shipped — checkout + proxy live", sessions: "0" },
      { name: "Caption Studio v1 (standalone)", pct: 100, platform: "Claude",
        links: [["repo", "https://github.com/baxstarcode/caption-studio"]],
        outstanding: "Shipped — live on GitHub Pages", sessions: "0" },
      { name: "Caption Studio v2 auto-post", pct: 90, platform: "Claude",
        links: [["repo", "https://github.com/baxstarcode/caption-studio"], ["zaps", "https://zapier.com/app/zaps"]],
        outstanding: "LIVE 8/15 — IG + GBP with photo, mirror retired. Left: PR #4 merge, first real-post proof", sessions: "~0" },
      { name: "Lakes Golf Simulator site", pct: 15, platform: "ChatGPT",
        links: [["site", "https://lakesgolfsim.com"]],
        outstanding: "Tech-camp page only — main site unbuilt", sessions: "~5" },
    ],
  },
  {
    cat: "Supporting",
    items: [
      { name: "Ember / Mission Control", pct: 85, platform: "Claude",
        links: [["app", "https://baxstar-ember.pages.dev"], ["repo", "https://github.com/baxstarcode/baxstar-ember"], ["cloudflare", "https://dash.cloudflare.com/"]],
        outstanding: "MCP OAuth for hosted connectors (voice merge shipped 8/14)", sessions: "~2" },
      { name: "Agent OS logs + trimmers", pct: 90, platform: "Claude",
        outstanding: "Confirm first unattended nightly trim", sessions: "~1" },
      { name: "Asset pipeline docs", pct: 100, platform: "—",
        outstanding: "Documented — Squoosh/Handbrake/Wix runbooks", sessions: "0" },
    ],
  },
];

// Reopen every page a project needs. A burst of window.open from one gesture
// gets blocked after the first, so only the first rides the click and the rest
// are staggered.
function openProjectTabs(links) {
  if (!links || !links.length) return;
  links.forEach(([, url], i) => {
    if (i === 0) window.open(url, "_blank", "noopener");
    else setTimeout(() => window.open(url, "_blank", "noopener"), i * 250);
  });
}

const TOOLS = [
  { id: "handoff",  icon: "handoff", label: "AI Handoff" },
  { id: "captions", icon: "quill", label: "Caption Studio" },
  { id: "drive",    icon: "drive", label: "Google Drive" },
  { id: "html",     icon: "globe", label: "HTML Viewer" },
  { id: "filters",  icon: "dials", label: "Image Filters" },
  { id: "github",   icon: "github", label: "GitHub" },
  { id: "snippets", icon: "clipboard", label: "Snippets" },
];

// Known Baxstar repos — pick one, or type any owner/repo below it
const GH_REPOS = ["baxstarcode/caption-studio", "baxstarcode/baxstar-pontoon", "baxstarcode/bax1"];

// Canned replies for common policy situations — copy, paste, done
const SNIPPETS = [
  { title: "Multi-day pontoon — weather", text: "Multi-day pontoon rentals carry some risk, and we do not offer refunds or credit for multi-day rentals due to weather. Trip Protection does not apply to multi-day pontoon bookings." },
  { title: "Trip Protection framing", text: "Trip Protection gives you flexibility and peace of mind — if plans change, you're covered. It's a small add-on that removes the risk of the unexpected." },
  { title: "Fair Hills Resort discount", text: "As a Fair Hills Resort guest, use code FAIRHILLS06 at checkout for your discount." },
  { title: "5-guest trip framing", text: "Our 5-guest option is ideal for family and action trips — the added cost reflects extra setup time, gear, bait, and coaching for the group, not a walleye-focused add-on." },
  { title: "Provider fee disclosure", text: "Your total includes a 6% Provider Fee, already reflected in the out-the-door price you see at checkout." },
  { title: "Private trip exclusivity", text: "This is a private trip — just your group, our gear, and the lake. Nothing shared, nothing rushed." },
];

const MODELS = [
  { id: "claude-haiku-4-5",  label: "Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8",   label: "Opus 4.8" },
  { id: "claude-opus-5",     label: "Opus 5" },
  { id: "claude-fable-5",    label: "Fable 5" },
];
// Brady's call (2026-08-23): Opus 5 on High effort is the default. Sonnet stays
// the fallback when the gateway rejects the chosen model.
const DEFAULT_MODEL = "claude-opus-5";
const FALLBACK_MODEL = "claude-sonnet-4-6";
const DEFAULT_EFFORT = "high";
// Bump when a default above changes: stored model/effort prefs from an older
// version are dropped once so the new default actually lands on his phone.
const PREFS_V = 2;

const EFFORT = {
  low:      { label: "Low",  note: "\nEffort: LOW — shortest useful answer. No elaboration." },
  standard: { label: "Std",  note: "" },
  high:     { label: "High", note: "\nEffort: HIGH — reason carefully step-by-step before answering; be thorough and double-check specifics." },
};

// Background presets — CSS scenes modeled on Brady's reference images.
const DARK_LAKE_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCAOEBkADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxeiiigAooooAKWkooAWiikoAKM0UUAFFFFABRRRQAtFFFABRRRQAUUUUALRRRQAUUUUAFFFJQAtFFFABRRRQAUUUUAFFFFAC0UUmaBi0lFFABS0UUAFFFFAC0UlLQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFJS0UAFFFFABRRRQAUUUUAFFFLQAlFFFABRRRQAtJS0UAFJS0UAFFFFABRSUtABRSUtABSUUUALRSUUALRSUUALRR2pKAClpKKAFopKKAFpKKKAClpKKACiiigAooooAKKKKACiiigApaSloAKKM0UAFFFJQAtFFFABRRRSAKKKKYBS0lFIBaKKSmAUUUUgCgUUUwCiiikMKMUUUxCUUtFACUtFFIAoopaAEopaSgAooooAKKKKYBRRRQAUUUUgCiiigAooopgFFFFABRRSUALSUtFACUtFFIApKWkoGFFFFABRRRQIKKKWgYlLRRQAUlLSUAFFFLQAlFFFABRRRQAUUUUAJS0UUAFJS0lAgooopgFFFFIAooooAKKKKYBSUtJQAUUUUAFFFFACUUtJQAUUUUAJRRRQIKKKKACiiigBaTvRRQAUUUUAFFFFABRRRQAtFJS0AFFFFABS0UUAFFFJQAtFJS0AFFFFABRRRQAUUUUAFFFFAC0UlLQAlLRRQMSloooAKWiigBKKWigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKWkoAKKWkoAKKKKACilpKAFpKKKAFooooAKKKKACikpaACiiigAooooAKKSloAKSlpKAFopKWgBKKKKACiiigAooooAWiiigBKKWigBKKWigBKKWigBKKKKACiiigApaSigAooooAKSlooAKKKKACiiigAooooAWiiigBaSiigAooooAWkpaKQBRRRTAKSlopAJRRRQAUUtFACUtJRTAKKKKQBRRRTAKKKKQBRRRQMKKKKACiiigQUUUUAFFFFMAooopAFFFFAwooooEFFFFAxKKKWgBKWikoAKKKKACiiloASilooAKKKKACiiigAooxRQAlFLSUAFFFFABRRRQAUUUUAFFFFAgpKWkoAKKKKACiiigAooooAKKKKACkpaSgAooooAKKKKYBRRRSASiiimAlFFFAgpaSigBaKKKAEpaSloAKSiigAooooAKKKKAFooooAKKKKAFopKKAFooooAKKBRQAUUUtACUUUUAFFFFABRRRQAUtJSigYUUtJQAUCiloAKKKKACiiigApaSigAooooAKKKKACiiigAooooAKKKWgBKWiigBKKWkoAKKKKACiiigBaSlooASiiloAKKKSgBaKSigBaKSloAKKKKACiiigApKWkoAKWkFLQAlFLSUALSUUtABRRRQAlFLRQAUUUUAFFJS0AJRS0lABS0lFABS0lLQAUlLSUAFFFFABRRRQAUUUUAFFFFABRRRQAtFJS0gCiiigYUUUUCCiiimAUUUUhi0UlLQIKKSlpjCkoopAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQACiiigAopKKAFpKKKACiiigBaKSloAKKWkoAMUtFFABSUtBoASiiloASiiigAooooAKKKKACkpaKACiiigBKKKKACiiigAooooAKSlpKACiiigBKKKWgQUUUlAC0UlLQAUlLRQAlFFFABRRRQAlFBooASiiimIKKKKACiiigApaSloASilooASilooASloooAKKKKACiiigAooooAKWkooAWiiigAooooAKKKKACilooAKKKKBhRS0UAFFFFACUtFFABRRRQAUUUUAFLRSUAFFFFABRRRQAUUUUAFFFFABRRRQAtFFFABSUtJQAUUUtACUtFFABRRRQAUlLRQAlFLRQAUUUUAFFLSUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAJS0UUAFFFJQAUUUUAFFLSUALRSUtACUUUUAFLSUtACUUtJQAUtFFIAooooAKKKKACiiigAooooAKKKKACiiigYUUtJQAUUUUAFFFFABRRRQAUtJRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUtFACUUtFACUUtFACUUUUAFFFLQAlFFJQAtFJS0AJRRS0AJRS0UAJRS0UAFFFLigAopaMUAJS0UUAFJRRQAUUUUAJRS0UAJRS0lABRS0lABRRRQAUUUUAJRS0UAJRRRQAUUUlAC0UlLQAUlLRQAlFFFABRRRQAlLSUUAFLSUUALSUUUCCiiigApKKKAEooopiCiiigAooooAWiiigAoopaAEooooAWkoooAKKKKAFopKWgApKKKACloooAKKKKACiiloASiiigBaKSloGFFFAoAWikpaACiiigAooooAKKKKACiiigBaKKKACkoooAKWkooAKKWkNABS0lFAC0UUUAJS0UUAFFFLQAlFFLQMSlpKKBC0UUUAJRRRQAUUUUAFLSUUALSUUtACUUUUAFFFFABRRRQAUUtJQAUUUUAFFFFABRRRQAUlLRSAKKKKYBRRRSASilpKAFooooAKKKKACiiigYUUUUAFFFFABRRRQAUUUUAFFFFABRS0lABS0lFABRRRQAUUUUALRRSUALSUUUAFFFFABSUtFABRRRQAUUUUAFLQKWgBKMUtFACUUtFACUtFFABRRRQAlFLRQA2loxS4oASiiigApKWigBKSnUlAAKWkpaACiiloASilxSUAFLSUtABS0lLSGJRRRTASiiigQUUUtACUUtFACUUtJQAUUUUAFJS0UAIaKXFFACUUtJQAlFLRQAlFLSUAFFFFABSUpooASiig0ABpKWkxQAUUYoxQAUUYooAKKKKACiiigQlFFJQAUUlLTEFFFFAC0UUUAFFFFABRRS0AJS0UUAFJSmigBKKKKACiiigAooooAWiiigYUtJS0AFFFFABSUtFACUUUUALRRSUALRRSUALS0lLQAUUUtACUUUtABRRRQAUUUUAJRS0lABRS0lAC0lLRQAUUUUAFFFFABRRRQAUtJRQAtFFFACUtJS0AFJS0lABRRRQAUUtFIBKKKKBhS0lLQAUUCigBKKWkoAKWiloASkp1JigBKKWjFACUUtFACUUUUAFFFFABRRS0AJRS0UCEooooGFFFHegBaSiigAooooAKKKKACjtRRQAUtJS0AJS0lLQAUUUUAFFFFACUUtFACUUtFABRRRQAUUUUAFFFFACUUtFACUtFGKACkp1JigAFGKUUUAGKKWigBKKKWgBKWiigYYooooASilooASilxRSAKSlooASilxRimAlFLRQAlJS0UAFGKKWgQlFLRQMSilooASjFLRQAUUUUgEopcUYoATFFLikNMAooooEFFFFAwooooAKSlooASiloxQISilooGJSUtFAhKWikoAKSloxQAlFLijFACUUtLQA2jFLRQA2ilooASilpKACiiigBKKWkoAKKKKAEooooEJRRRTEFLSUCgBaKKKACiiigBaKSloAKKKKACiiigAooooASiiigAooooAWiiigAooooGLRRRQAUYoFLSGJSUtGKYCUtApaQWExRTqQ0A0JRRRTEFKKSigB1FJRQAtFJRQAtJRRQAtJRRQAtFJRQAtJS0UAFFFFABRRRQAUCiigAooooAKWkooGLRRRQAUlFGKBBRRilxxSGJS0lFABS0UYoAOlFFFAC4oxQKUUDEpKdRigBMUUtFACUUtGKAsJijFOpKQWExSEYpc0lMApKWigQUUYooAKKKKACkpaSgAopaKACiiigAooooAKKKKACiiigAooooAKKKWgBKKWkxQAUUYpaAEopaKACiiloASiijFACUtFFABRRRigAooxRQAUUtJQMSlopcUAJS0oooASlxRQKQBRRRQAlLRRQAUlLRQAlFLRQAlLiiigAooFLQAmKMUtFACUUppKACiiigBMUUtGKAExSijFFABSUtFACUUuKKAEoopaACiiigAooooAKSlooASilpKACiiigAooooAKKKKACkpaKAEooooASg0uKKAEpKdikpiCiiigBM0hNKaSgBRS0maBQAtFFJ3oGFFLSUCEoxS0hNABxSUZooAM0lFJQAtJRRQAUlFFAgoopaYhKKWigAooooAKKKKAFopKWgBKWiigAooooAKKKKACjFFFAwooooEFFGKKACiiigApaSigYtLmkooAXNFJS5pDuFLSUd6BjiOKTFGaO9AMQ0UdaXFAhKQ0ppKYgpaSigBaKSigBaWkFLQAlFLRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUtABSUtFACUtFLQAUE0UlIYUAUtFAABRSiigYlFLiigQUUUUAFLRRQMQ0ZooxQAuaDzSClpBcMUmKWlpgNxSYp1JQAmKWiloAbig0tBoAbRS4oxQISjFLiigBKKWigApBS0UAJRS0UAJS0UUAJS0UUAFFFFABRS0UDEopaKAEopaKACiiigAopaKAEopaKAEopcUYoASlxRilxSASkpaKAEopaMUAJiloxS4oAKKKKAEopaKACilooASilooAbRS0YoGFFLRQITFLjilFBIxxQMTiiikoAKM0UhoEBooooAKMUUtACYpaKKACiiigApKWigBKKXFFACUUtFAxKKWigBKKKKBBRRRQAUUUUAJRS0UAJRS0lABRS0UAJRRRQAUUUUAFFFLQAlJilooAbR0paSgBDSYp1JTASig0lAhaWm0tACk0maSigBaM+lJRQAlFFFACUUUuKAEopSKSgApKcKMUANpaSlpkhRRRQAUUUUAFFFFABS0UUAFFFLQMKKKKACkpaKACkpaKACiiigAoxRRQAUlLS0AJRRRQAUUUUAFFFFABS0lFAC0UUUgFFLTaUUDuJRSnmkoATFFLS0CEoxSiimMSlpaKQhDRS0lMApaSigBaKKKACiiigApKWigBKKWigBKWiigYUUtFACUUtFIAooooAKKKKACiiigApaSloAKBRS0AFFFFABRRRQAUUUUAFFFFABRQaKADFGKKWkMTFFFLQAlLiiigYmKQ0tFAhtFLRimAlFLRQISlopcUDEooooAKKKWgBKKKKACilooASiiikAUUUtACUUtFABRRS0AFFFFACUUtFABRRRQAUUtFACYopaKBiUUtFACUtFFAhKKWkoGFFAooAKWijFABRRRQAUUUtACUtJRQAUUUUAFFFLigBtFOIpMUAJigClpaAG4op1JigAooxS0AJRS4ooASiloxQAlGKKWgBKSnUUAJRS0lACYopaKAEooooAKKKKAEopaMUAJRS0UAJRS0UAJSU7FGKAG0U7FGKAEooxRigBKSnYooENpMU7FGKAGmkp2KMCgBlLilPFJTAKQ0Zo60AGM0YoGaOaAEoxS0tAhuKMU/k0bTQOwzFFP24oxSCwwjNGKfSYoATFJinYpKYEdAopaZAUUUUAFFFLQAlLRRQMKWiigAooooAKKKKACiiigBaSiigApaSigApaSigAooooAKKKWgBKKKWgBKKWigAooooASloooAKWkxRSAWiilFAxKKWigAooooAKKKKACiiigAxRRRTEFFFFAwoopaAEopaKQCUUtFABRRRQAUUtFACUUtFACUUtIaACilooAKKKKACiiloAKWkpaACiiigApKWlxQAlJTqSgBKKWigBKKKWgAooooGFFFFIAoooxQMKMUUUAJijFPA4oxQFhuKSndKSgBKKWkoEFFFFABRiiloASiilxQAlFLRQAYpKWigBKKWloASkpaKACiiloAKKKKBhRRRQIKKKKBhRRRQAUUUtACUUtFACUUUUAFFLSUAJS0UUAFLSCloAKKKKACiiigBKWiigBKWiloAKKKMUAJRS4ooGJRilxS0gExRilzSE0AFFFJTELSUUtABRRRQAlFLRQAlFLRQMTFFFFAhKKWkoASloooAKKKKAEpaMUUAGKMUtGKAExSU7FJQAlLRSUALRSUUALmm5oxRQAUmaXFJigAzSZpcUYoATNJTsUYoENoxTqKAG4AoxzxS0uKBjcUYp2KMUAAAoCrS4ooATp0FBJopKAuFFLSUCCkoNJk0ALSZpMmkzTENoopaZIlLRRQAUUUUAFFFFABS0lFAxaKKKACiiigAooooAKKKKACilpKACiiigQUUUUDCloooAKKKKACiiloASilpKACiiigAoopaACiiigBaKKKQwoxRRQIWiiigYUUUUwCjFFFAhKKWikMSloooAWiiigBKWkpaACiiigAopaKAEooooAKKKWgBKWiigBKWiloATFFLRQAUUtFAxKWiigAooooEFFLikoGJiilooASilpKACilpKACilpKACiiikAdqBRjNOA5xQAAU4Ck6UE5pFCEZ70mKWimISkxSmigBMUH2paXFACYpMU6jFADaWlxRigBKKdikxQAmKMU7FFADaKWigBKKWigBKKWigAoopaAExRS0UAJRRS0AJijFLRQAlFLRQAlFLRigBKKdiigBtFKaSgAxRilxS0ANxS0uKSgAoxRS0AJRS0UAJRS0UAJS0YpaQwooooASjFLSUALSGikoASg0tFADc0opcUUAFLQPeloATFJTsUUAJijFOpKAExQRTqSgBuKMU7FJigBtGKWigBKKWlFACYoxS0UAJijFLRQAmKKWkoAKb3p3Sm5oAQnFJk0p5pMUxCZNKKKSgBTQKSigBc0maKSgBSTSUtFAgFLTadQMXAppooIoAUY9aXIpooJ9KAFJoBplLnFACknNGabRQIUmjNJRQAZozRRigAzSUtBoAbSGnGmnqKYCUUUUyApKWkoAWiikoAWikooAKWiigBaKSloAKKSigBaKSloGFFFFAC0lFFABRRS0AJS0lLQAUUUUAFLRRQAUUUUAFFFFABRRS0AJRS0lABRRRQAtFJRQAtAoxS0gAUUUtAwooooAKSlooATFFLRQAlLRRQAUUUUAJS0YooAKWiigAooooAKKKKACiloxQAlFLRQAUtFLQAlLRiigYUUUUgCiiloAQClxRRQAUlLSUwDFFFFABSUtFIBKKKMUAJS0UUwCgUtFIAooooAKKKKACilApaBjcUuKWigBKKKKACiinY4oAbRSmkoAWkNFFABRRSUALSUtFACUuKKWgBMUUtGKAEopcUUAJRRS0AJRS0UAJS0UUAFFLRQAlFLRigYUUUtIBtFOpMUAJS0YpaAG0Yp1BoAQCjFLRQAlFLSigBuKMU7FGKLjsNpaUjHSgCkFhKKkEZIyOaaRii5XKxlGMmncUbselArCbSaTFLyaXae9FwsMop2PWjaT2oFYaRRT9hHJFBI7DFFx2Gge1Lil5oxzQFg4pKXGaXbjrQFhtFO4FGaAG4opSfWigQlIadijFAWI8UYqTFGKLhYZiinYoxQA2kNOIoNAWG0tGaSmIWjOKKTigBCaSlNHFADaMU6lA9aLhYZSVIQD0NNOM8UXCw2kpx5o2mmIbRSkUUAJSUtGKACiiigBM8UUUYoEFFFFABSU7FGKAEopTwMntUXmfOfSgCTFFLRigYlFLtpcCgBtFLmkoATFIRyKdRQIioooqiAopKWgApKWigBKWiigAooopgFFFFIAooooAKWiimMKKSlpAFFFFABS0lLQAUUUUAFLSUUALRRRQAUlLRSAKKKKYC0tJRQAUYoooASlpM0UALRRRQAUtJRQAtFFFIYtFFFABS0lFAC0UlFABRSjFFABRSiigBMUUuKKAEopaKACjFLRQAlGKWigAoopaBiUU7FFACUUtAoAKKKKQCUuKKKACiiigAooozQAUUUUAFFFFACUUtFACUUUUAFFFFABRS0CgYlFLiloATFLiiloASilpKACkpcZooASlFFFAC0ho5ooAKKKMUAJRTsUmKAEoxTsUGgY2ilooEJSiilxQAUYopaAEoxS0UDEopcUUgEopcUtACYoxS4pcUANxRinYpMUAJRS4oxQAmKMUtGKADFFFFIYUlOxRQA3FBp1JimA2inYoxQISl3HGKSikMXdjsKN+e2KbiigdyQbepalDqD61FQTRYfNYleYngACot7etITSUJITk2x4OTyacFyeOajWpFOAaGCfcd5ZHNOIHQ8fjUe9v7xpP50rMvmS2JPLx3GKQ4HSm5o4oFfsPUDqaQjvTd1OGDQK4YoFLRg4zjigBKQ0tKVIFADMUYp1JQITFFOo/CgdhtFLmnE8dKAsMxS4p4Y9gKMmgdkM2kdqMYp1NNArDDmkxTqXbTEMwKTinEU0igQlGKMUuKYhMCkNOxRikMbRS4opgJSU7FFAhtJTqMe1ADaSn4pKAG0Yp2KcBQFiPFGKkwPWj6YouFhmKMU/GetHAFFwsMxTsAilHPanD/dpXGkR7R6UYFSHJqGWTYRxxTB2QxnVgy9O1QfdbnnFSSsp6d+uKiPBwDVIzZNExJAqXNV1YqCF6mpYlIXnqaGND80lNZwH207NIYYpcUZpM0AGKTilpjtgjPTvQBHS0UVRmFFFFABRRRQAUUUtACUUUUALSUtFACUUtAoASloopjCiiikAUUUUAFFFFAC0UUUAFFLRQAUUUlABS0lFAC0UUUhi0UUUCCiiimAUUYooAKKWkoGFFFFABmlpKWkIKKKWgYmaXNJiigBaQ0lLmgApc02igBc07PFMpaAFyaUGm5paAHUZpoNBNAx4NFNFO7UAJS0gpaAFpaSikAtFJRQAtFFFABRmkzRQAuaKSjNAC0UlLQAUUUUAFJRRQAUtIKWgYUUUDpQAUlLQBQAUUtFACUtKBRQAlFLRigBKWiigAopcUYoAKMUtBoAbijFLmigBKUCjFFAABRiikzQMXFFJ1pRSAKMU7FLgDqaLjSGYoAzT8npTaQWG0U9V5oK07hbS42ijtS0CCiiigBaSlpDQMWiiikAUtFFABRS0UANopaKAEopaKAEpKU8UmaAFpaTNJQA6im5pCc0AOyKM0yjNMBSaQmjFGKAAmkJpTSEUCEzRmjFGKACijFLjAoASlzQT6CkoAdmjNNxSgUALg0oFAOBRuNIY4LTgMVHuNODGgaJFbB7fjSk+4A9BUeSaXaamxVx2fQUBD9aTFOUGgaGke1GPWp9gA+Yc0HA6H8MUrlchDtJ6UpjYdqeXP0+gpMsepo1FaI3ZjuKAAPelxSYpiFJB6DFJRilx60BuJijaPancYppxjIoCw3AFITTtpPSk8sntRcLMjJzSYqXYfSl249KdxcjIMUuMVKRx1qJs54JoTuDVg4pCaSnAGmSN604Rse1TIjnhVAHrSlf9rNK5XIQ7PU00rVgRhh97mkaLHvRcbgyuBSkVMsTHtR5LelHMhcjIMUmKseVjqQKPKGeSBRzIORkGDQasFVHfP0pMIf4QKLhy+ZAF9acEB71LkdABSAkUBZCeWBjJpCidqUmkoBtdAIA6Um72oNGKZNyEygsRnpUU3zLwM065ixyO9Q+YVwOwqkiG+jGEYNAHzdM+1G4EnOOaQN83HANUQSx7Vb5gBSyTdl/OoSaTBNKwXHoCzZqeoo1PX9KloZSFoozSHpxSGRs/wA49BTjzULE7s96lXOBnrTYkNooopkhRRRQAUUtIaACiiloASilooASilooASloooAKKKKACiiigAooooAWiiigAoopaACiikoAKKKBQAUUtFABRRRQAUtFFIAooopjFoxQKKQBRRRmgAoxRmlzQAlFLSUAITRmlNBFACZozRRQAUUlFMBaKKKACiiikAUtJS0AKKUCkFGaBjsUUm6lzSAWikzS5oAWiikzQAtFJRQAtFFIaAFopKWgAooooAKWkpaACiiigYYoozSZoAWikJozQAtLSA0vSgAoopCRQAuaKbmlzQA6im5NBzQA6ikFKKADFLilopDEozS0mKYC5pCaKTNABiikzSZoAXNGaSigQ6k70ZpM0DFFOFNFOpAKKcOaaKdSGLikwB1penekoGGeOKbTsUYoAbRTwue4pdo9aLhYZ1oxT8Cg0XCw3FBpaKAG0uKWigBMUtLRQAlFLilFIBuKXFLRigBuKMU6koGMI5pccU7HNGKAGbaKdTW+tMQhIpPwpDQKBC0UAUpGKAEooNIBQAUUuKKYCUlLQBQAlGKeBS7DjPalcdiPFLin4pQM0XBIZtpdtSMuOnNG1h2xSuVykeKAuak8pzyeB6mgrjqwouHL3G7CDShPXil3HpTgpY0DsgVOPWpUjB6kAUqxAdT+VOUKvOTn0xUNmiiuovlR4GCKawA4UfjQME/NmnZUdB+dA20yLBpdtPJzTaZFhpFJin4zRigVhmOaMVJtpMUXHYbgelHA7Zp30pCCaAGkjsMUZ9hS7aXbQGo05NJipNuBSEUC1IyM0m2n4pcUXCxEVJoEee1T4A6Cmk59qLhZdSPy1HUUvA+6MU7HNGKA9BuW6ZOKTFSbaNtADAKcpx604Cg4oHsDP6KKiZie5p7EVBPL5cZPftTSFKTH0U2F/MQHpUmKCVqNNJT8UmKAsMpMU48UwmmIMUmaKTFAh2aarq2dp6UHgGqIk2ybl9ehqkribsXWPGKpSowYk057hjjbgcc0wysRnPP0ppNENpkbAg80gFOz60hPOe9UQKozxT0GR1HNR4PWgHBzQMs5AwD3pjyAAgdahYknJNA60rD5ixFytEmQuV/GlQjb0xUZkIY5GR6Uh9CMn0pUJBoY/NnHFKrIpzyaokdRRS0CCiiigYUUUUAFFFFABRRRQAUUUUAFFFFAAKKKWgBKKWkNABRSUtAC0tJRQAtFFJQAUUUUAFLSUtABRRRQAUtJS0hhRmikpiFpabS5oAWim5ooAdSUlFAC0UlLQAUUUUhhRRRQAUlLRQAUUUUAFFLRigAoxS0UAIaBTqQigYtGKTBpcGgAxSgUmDTgOOaQBikpelFACUtFFABRRRQAUooooAUUUgpaBhSYpTSZNABRniil20ANOaQ5p+KNtADMUppTxSZoASlNITSUCHBqC2TxTKXNADiaSkzS0DAU6m5oBoAkGKXApgpeaQx1LTRmngd6AClpBS/SgAppNKaMUAIBSEUpzSCgBuKKd9aTFACUUuKMUAJRRS4oABSg0YpwFA7CilApCPSlGaQ7C4opaKAACloPSkzikMWkozSUCFx60lFLQAUuKBxSigYmKMUtGKAExS4paKAExRS4ooGJijFLSGgLBikozSE0CFpCaTmkwT1oADTcZqQLmnbcUXCxDtNLinkUoXI4FFxqJGKMVIUI64FIPpRcOUaBRtNPyKTcenai4WQzFJipRGW9B9aXZg9QaLj5WQ7acFqZgpHNM4pXBxsMIpQDTjkmhVYngU7iSFCA9TzQYmB45p+31NOAx0qbl2XUh+ccc0fN3NTgtjrRj2ouOxFjI5JpQg/GpMegpVX+9RcLDBGRjingFeDxTsc8E4pQMdaVx2E+lGKcTk8UUAxuKTFSEehzTdtArDcUbaftNGw9aLhYbig4p23FG2lcdhlGKk20FRRcLEeKMU/FIaAsNpKfSUxDaMc0uCeBQVYdRigLDMUU47ccnmmbsdKBC/Wl45FMLHrUMEga5Yg5DU7CvqWgtKFp30o+vFK5dhuPWmswFOYjBwc1AxNCE9BWc00sfWk5zSHAIBPJ6VViLg0ioAW7nFU7xiXIBO39KtTxl48DrWe6soOSDjrg1UUZzbJ4JtkZLf8AARViGRnQMwwT2qlCseVMj8elTy3AYBYuMfrTaCMrIs5JpcE0i52gkYPelqCxpU+opuKeR7ikJx0pgxuKXFLu9qaWFAgIqs0HzMxOSentVkmq00jpnj6GmiZWIDH6MDjrTGx0ANK5LHJ61HWhkwzmgjnGfxoooELk/WjtS8H2pBjvQAhqWNcjmkQZ9CKmBHbFJspIRjsUUxirDOKJHBBHeoxk0IGxDjPtQeTwMUZoLGmIlpaSloEFFFFAwooooAKWiigAooooAKKKKAEopaKAEpaMUUAFJS0UAFGKWigAooooAKKKMUAFGKKWkAgFLiiloGJiilooASlopKACiiigQlFLSUwCiiigAoopaAEpaKKACiiigAoopaBiUUtFIBKWkooAWlFJRQA6jFJS0DFGKXIptFIB2aM0gFGKAFzRmkxS4oAKKKSgBaKKSgBc0ZpuaXNMBc0ZpuaXNIBc0Fqbmg0BcduoBpuaKAH5xRupuaKAHbuKaTRS4oGNzRmnbaTFACUlShQBTGoAbRS4ooEJS0UuKBgKUCjFOFAwApwxmkwO5p2B2pDAj0o56Uq9KWkAgHrS0UUAFFFLigBKUAUUtA7DSBikxUgFOwO4ouOxDijYfSpcUUrhZEJWlValIFGKLhZEe2lxT8UUAJijiiigBaCabmigBSabS0YpiAUUoFFIYUUUooAUUopKM0DHYoApATTqQwxSUtFABS4o7UoBI4FAJDcUYp209xR9KQ7DNvpRtp/I6g007j0BoCw0jFNJx0qUQu3UgfWkeDHQ5ouh8kuxEG7ZoDU8REngZp5i9TindC5ZEeVHOCaQuSMDge1SmNcf1pAgpXQ7MiUsDwakVd/UHNPAweBSnJ7mhjWm40RAdf1NLhV6EH6CjFOCE0h83ZDfvHk4p3lAAEgnNSIAhyRmlZy3B6egpeg1a12MMaHocUzy0HAGfc1IQKAvrQF/IQIhGelGAOg59adtpcUBcjxRipMUYpk2GYoAp+KKB2E5xjNJtpwpfrSAaFNOIA6mkB9KXbu6UDAkdhSAZ60u3FOFAWDbRtp2aNpPU0h2E4ApCRTtg70bQKAIyfQUmTUm0UYoCwzFGKfSZoAbto207IpGYCmIbtpGwB0pS2eRTTvySMUAMY5phB9akAyST1NNPsKYmhoX3pdtAD0ku8KCgyQenrTJK9wroWw/ysO9VU3JJkjJB6Cp53Y/ewSeo9Paq4bLMhyMnpWi2MZbl+N0QElhuY8808PuGRVKGBycHhM5xVskRjkjOOBUNGibtqOwaMU9RkA0uKVyrEW3NVL4MrKe1XzVe4QOOecU4vUmauim905VVzyOp9agYq3bB/nUkwVWwg6dTURyTk1qjBt9RDk7ee35VZtvLjcsXVvSoo4i564HqelI0RH8SknoAaH2BaaluW7VlKqOT60sTFoxmq8UB3AtjjtVzbtXJ4FQ7I0V3qwHSkJAxk0uKhuCAUGRndzSQ27IlJxVQzkzA46cVakXzIyB3FUHVlb5utVEibaL/bIppGQRVUTsoCjoKY8zFiQxAzRysHNEksagnJAAHryTVc4oJzSdapGbdxCaKKD1piBSR0oNLnNJQAc0tJRQAp5oU80UAUAIaSlpDQBPS0lLQAUUUtAxKKXFFAAKKKKAFpKKKAF4opKWgAoooxQAYoxS4oxQAmKWiigBKKKKADNFGKMUAFFLSUALRRRSGLRRRQAUUUlAC0UlFMAooopAFFFFABRRRQAUUUtABRRRQAUUUUAFFFLQAlFLSUAFJS4ooAKKKUCgYYopaKAEpRRijFIBQaCaAKUgigBuaUGlx7UoWgYhopW44ppNAhaCKbmlzxQAUhxRSUwCiiigAooooAKKKKADNKKSlpAOBpc02igY4c07GOtNB9KXrSGISaTFP7Ugx60BYbtpcU9QO1BWi4WIyKBUnl+tLsAouFhvB+tGPan7VpCKQxAM04ClC0YNAwpaaTilzmgQUtGKXigYUUmRSkjHFADqMVHkmlyaQx9LTNxpd1ADqSk3ClyO1ABRQBThQAlJinUGgYwijFOoxQIbigUtFACUUuKMUAJmjNGKMUAFKDSYpRQMUUYop1IYgp9NAp3HagaDHuKcNoPXNNpKQ72HE+lKGx1ptAFAXZKGXvk00uewAptOCE0rIrmbAyN2o3seppdtGKNBXkGeOgz60DjpRil2mgNRNx9aQinhc96cqr3o2HZshwadipSqjpTfwouHLYZikIqQYJwRTvLXON2aLhy3IgcU4MKlWL6GgjaOgBpcxXI+pFvHpTlwx9KeMMfnOPoKU47HIouFkN2r3b9KMr70uKTFIA4peKBx0ApT7igLDaKcAD60AZOBigLCdaTApwA75owM9KAsNxSsoPQH8adRzQOw0DFLTsUoFADMU4CnBfWlApBYQLS44p2KQUDsNxQQKdSEUBYbSU7FGKAIzQoAPIzT9uaNtAWEO0/wAfSmEeiipMUxmxQDG7S3XH4UjIB1I/Kglj6imlWJ6GmIN2BhSaN7eg/KkKsKjZgpAJ5PSnYTk0R3cjqoYEnBzxUIvFKktwR2qxInmIVPQ1RmtmXHK4q422MZ8yd0RtO0jMAWOfWm4LBi3UEEk9aj2nNC8tjI/HvWljBtssRTvGMD5vrSxs7sFbnPQGiGI52kDGeSKvxxIAG4JH8RqW0jSMWyUEbR2pjMB3oY4BPpUEgWeDOTgjPHWs0jZsiN5i4ZGHy9BipWZQcFhk9s1lYwT1/Ggkscnk1ryI5/aMsSyQE7sNnPT1quZCQQFABp2zcuQM46+1MxVJENtjjISip2FIGIBA6Gk7YyMU+JS3A2kepoDVsRWKsCOCKe0kkvUkjpgdKd9mkI3Y78Duas20GxcsMNSbRUYyeg5F2RgHsKqXKMr7geCelX5Nu3axABqjLxgYBAPBBqYlzWhPAd6FV4AGM1WmiKybQST6mnxM24HdhQenSrDosrcHBXuKd7MVuZGdJ14Oaj5q7cRbY+ijniqoHOO9UnczkrMbS9qcwAGCCD3plMQGkopKBC0UvHHH1owMZoASjvRRQAvb3pTgdKbRQAUlFFAFiiiloGFFAooAKKKWgBKKKWgBKKWigBKKKWgBKWiigBaKKKACilxRikMSiloxQAlFLRQAUlLRQAlFLRQAlFLRQAlFLRQAlFFFABRRS0AJRRS0AJRS0UAFGKKWgBKWiigYUYpaMUAJRS4oAoASlFLtpcUgEGKMCjFBFAwC0oGKBThQAzbRtqTIooCw0LSkClo4oGIMU6kx6UoFACGmkGn4oINICPaaNhpzZFAYimIZtNGKlDZ60jbe3Wi4WGYoK+tOyaQ0AM6UU7FJigBMUYp2KMUBYbSU/FJigBuKXFOxRQFhMUYp1GKBiYxRS4pcUgsJijFOFOwaLjsMGRTsml2mlC0gsAz3pcUCnUDsNxS0vFFACUUuKMUAIVyKORTgKXikOxHg0EYp5FG2i4WI8UYNSbaUJRcLEYpRUmwelGKLjsN2/SjaKfijFIY3HNOoxS4oASilC07FAWGUuKdSGgLDcUYp1GKAsNxQBTsUtAWGYpcUtFADcUYpaKAsJigUtJQAYpQKMU4CgYgFGKdSUgExRilpRQOwlLS4pwx3FAJDR1pwzTlxSggdBn60rlJBt9xTmVcfJkn6Um/wBFFLuP0pale6MwaAKkGO4zQFOOgouKwzbQFJ4AqdYwv3uvpTgSo/hFLmKUO5CI2PUY+tSoigfMAffNMbg5Jz9aazgn+gpaspOMSZ1THAH4dajIOMgUeao6L+tNaUtQkwk4sQn3pO/NISTQAaozuOzSim04A0ALmilC+tO20h2G0lOIoC0BYQUtKBS4FFx2G4pdtOopBYQClxTgKXAoKSGYpQacaTHpQAUUuKCM0gAUY5pvSnA0AKRSYpc0maBhijt0FJupM0AKxJwOMCmY9TS00j2poTFwPWkOB0J/KmRsHZ1HVTg08LQJO4jHPNMZm6A4FSkCoJDg4FCBtjSPU1Bdwl0DDcSvQCpC20E+1QxXaeXhieDjnrVq+5lJrZlVbmWIEMO/U1HLdM7E9Ae1XLmHzFZlALe5rOkjMeNxB9ga0VmYz5loGGkbPWmlPmI7ihSc4H5UqlctkHnoKszDBQc5HpTxcOE8vPy5zTGJPBPAoAHTbmkF+xZHnSxjk4HGBWnFCkcYVQfxrOh3CJmZtg7HNWzeQxoqs2/j7wrOV3ojohZasiurMMXkXJYjgVSEXl58xQuePmq1LqClD5YIb3FUZp3l++c+lVFS6mc3C90DyKBtQcZ6k1HuOMdqSlPFWYttiDnpTvLbOCMfXimg+hwaVpGYYZiR70wVixFMERVHLdyT0q6r/L1FZFO3sepNS43LjUsTzzq8oxnA4PuKjbA6dz+FR9adnAp2J5rjgOfU1YgkiiU7m+bvVZnwPkP1qPtSauNSsWppg6src88cdqrHA6GkJz1pKaVhN3FJzTaU0nPSmSFFHfrSGgB2OAaSgUZNABRRRQAUcUUUAFJSmkNAFiloooGFFFLQAUUUUAFFLijFACUtFFIBKXFFLQMTFGKWjFACUUuKXFACUZ9aXFGKACilooASilooASilooASkp2KMUANopcUUAJRRiloASilxSUAGKKKKAEpaMUtACUUYpcUAJS0YooGFLQBS4pAFHFGKMUDFwKcMU0CnAAe9ABS4ozS5pDE5pMc0o60HrQACikyKN1MQtJRnNKAaAEopcUlAxc0uaT60UAOpaZnFGT60guOo4puaUH1oAdgUED0ozTgM0DGbaNop+KMUgsRlPejZxUmKXFMCHZxShalxSAUXCxHik21OFFG2i4WIdtGAKlKUm0UgI8ZNLtI7VJt9KMUDI1FLinkUYoAYBTgKdtpcelIY3FFOIpMUAIMDsDQTS4FLxQAzFOxS0UBYTFLRS0ANpaWjFACUtGKSgY4YpwxUeaUUhknFJTaUUAFKKXHHNGKQ7CcZpcikIoAoAUnNFKBS4oCw2lxS0lAwxRS0vagLDKKdikoCwlLikNJuoEKRRikzSjNAwxQAKdRigLCYoxSkUopDEApdo7mnKB3oI5oGrCbRT0CjsMe9JnsBinKppFJ2AADoOfekxk808LS7aAeowClC08LShaBWI9tOxUmKTbmlcdhE2fxU5gv8OaNlLigYw5pNtSYoxii4rEYQUbB6U88UA0AM2AdBQBipAKMYouOwzFG2hmApnmA+tAh+2gEeopp3kcCmCNvSnoOz6ExYCk3+lRbXBxtzUi574/KkCv1DcfSlBJpcnsB+VN+bOc4pFWRJtOMnApQKahOfWpFxnkUh2TGgUtKwpjlUUsxwBQA4GlBqlDcFpXDZILYXHarWDTasTF32HUoptLzjgUikrjqTB9KcrN90lQKZKWxjzBipuXyqw3BLYGM/WhmEfJdSf7o5qttHWlRNxxV2Iv2RaWQNinhMjO5fzpiRP0wPxp4jPQuv51DaNFF9g8v3X86ibg46n2qcnAx8pH0prNGT/qz+dCbBxREPcVHcSiBA5UkZxVjcvZFH1OaybqV0ZopwxRjkf8A1quCuzKo1FEVlNtmb5sKSSc9TWqvIyKxbbdvxGuWJ4OMkVqK7W9rmb76jnmrmtTGk9NSVjgc1C8hwcgYHrS20gmhVmxuxzSuvoanY03V0UZ51aElWAJ9RWfGdrBjg/WrM0TLuJwvqMcfhVat4pWOSo3fUkllXflMgDgHPWoCcmlwTk44FMJzVIhu4vIPFJ0pQaMUEj4yDkucN6kZq5FaqcHcDxwapsACApzSiR1wN5AU5AqWm9jSLS3ReuTHDCqEMfdazWHO7aQp6VYkunfGcKfaoxEZOVI645NEVZajm+Z6ENJjNPljMblT1HWnRxkLvIGMZGe9Vczs72IyCD0waCCAM/hUjuMH5cE1Hn5cUA7CKBg5zntijFKrMpypxSls8kCmIbijFKWyelSLtIypw2ehoCxGOPrSHPrUkgYHnH4UzbxSG1YaevFKFLHApcZHUUoBwTuwvr60CsMIoFJQaYgNGeMdqSigApKWigAooooAKKKDQAUUUUAFFJRQBZoopaBgKKKKACilooGAooFLSEJS0UUDClxSUtABS4oooAMUtFFACUUtFACUUUUAFFLiigYUUUtACUlOxSUAJRS0oFADaKdijFADaDTsUmDSASilxSYpgFFLijFACUUuKXFIBtGKcBS4oGIOlFLijFABijFGKXFACgUuKQUtABikpaKBiYoxS4paAG4pMU+kxSAb9KKdRimA3NHNP20FaAGYpcZp2KNtILDdppcGnge9L3ouOxGAafjNOAApaQ0MxSinAUYzQACloooASilpaAEpcUlGaACgUUUgFopM0ZoAKKM0n1oAWjFJmjNAxaWmZoBoAfSUBqN1ABSjFNJooGO4ooFGaACil4opAFFGKMUAFGKXaTS7aB2GYoqTbQVouFhlLk5p22nbR3pXHYZzThS444pMUDsLmkzTtvFIRQAA4paTbSgGgApMU8LSlaQ7EeKKcV9qMGgLDTRTttLtoAjPNG0VJtxRtoCxGB6UtP20YoHYbRzTgKXFAWG4pcU6lFAWGgUYp+KUCkOw0CnCl20uKAANSgg0mKcBSGKOtOpoNLmgYtLkU3NFADqMUClpDEFLxQTRg0AKFHoTTt7AYVQPwpu44xmjJIxSsUmhoODkjNLkMeIz9M0h5pASOKLAnYf5LP0jpFidM5Cr9RQHbpk0MzEY3GlZlKUR6ptHvSld332wKgJPqaCxpcrH7RdicJEvG4nNMMcQ5BJ/Go8k0cmny+Yc6fQlHkgHhj+NOCAj5VqDGKcrFTkGlygp90SeW/UDFHlOFycD6mhZnBzkfjTXcN1J+gpe8X7jQhUZx5i1nT3cUisgkKkHHzLwRVtZ4zM8Z4IxjPeqF3axeYzIxJz8wDDitY76nPUel4jbWRRIA2WQNnC8Z960/tCGQxrGpIGetY0OxCdxc4PRfStOARxqSufm5JJ5NOaRFFu1kTNISMBQPpURLe9PjZZC205wcGnlMHg5qNjV3epBg0uDU3l0bCTxT5g5WRhacFOcjg08LzgilkZY42fGdozipuUkKMn7xJqTHTFJb/vo0ccBhmrgh+XBINRKVjWMHJXKe2kMdWmRB0qpPOI7lI2wEZTg+9NO+wpRUdzOupntro45D469qqTXQnIzCu7oGLdK1L98xAxKj/rj6VgyYGck7vTFdELM4q14u19CVHkjRirYUNyQe9OlMsqmWQnb03djVP5mGO3Wp97LGYhjacZxzWljBS01NHTY3BZDsx168mrk+2BC7/dHoKoaSo8wuQMqMgk4rS86K5iyAGU9iKwn8R10rOBkX8zscA4jPTHes9jntWhfwu8uAFVF5GKz3AUjDBvwraFrHLUT5ncSk296cCuORz60hOasyG45pVODnOKWmmgRIwYYJBAPT3pAhY4Apd7MuOuOntSxzMnA5Gc0tS9LjfJfDHafl61ZsFQSo0wBj6HNKb98AbE465FQXUqSOCmcY6HoKn3nozT3I+8ncsX88LyMIACpGCxH8qha6JQKyIQFwOMY96rU47QvXJP6VSikrEOpKTbEwz5PXA/Km4wKcWLYyegxTTVGbChlwBk8ntSCl56mgBMUDg804deacy5+bGFJ7UAkNL5PAwKMjaaaevFHagLgeaC2VAxyO9JRigLiUtFLQIbRSmkoAKWkooAKKKSgBc0UlFAC0UUUAJRS0UAWaKWigYYoxRRQMKXFFApAFFLS0AJSUuKKAAUUUoFABRRiloAKWkpaBhiijNJmkAtFGcUmaAFopMnNLmgBcUUm6jOaAFoxSZpaADFFLRQMKKKKAExRS0UAJRilpaAG4oxTsUUANop2KMUANpRS4o20ANpRS7aMUAFJmgqaTFADs0ZpuKWgB2aM00UtIYuaM0DBpcUAJmjrTuKOKAEopeKKAEzRmlxRigAzRmjFLigAozRRQMM0vNJRnFIBwzTs0zNG6gY/NBpoajOaQx1Lmm5ozmgBTSUZFGaADNJmlxRigBM0UtLigLDM0ZpxFMNMQueaM03NLQAuaKSikAtLikAp2KBiUopcUYoGFFAFKBSAUClApMGlFA7DgKUCm804Uihwpaac0LkHNIY7FKMUqgEHnml20DsNOMUmKdtpwAoCwwLTgtOxS4pXHYZto20+louFhgUUu30p3FGaAsNApcU6mk46UgEwKNopy9Mml7UDsMC0uKeEOM44oIouOwzFIRTwM96MZ9qBWI8UYqQLS7adwsRbaXbT8UpFILDNopQBS4o20AJilFKFpwXFAxtLinAUoFAWG4NG00+igLDQtLtpaKBgAKOPSjmgCkAZ5oFOApaB2EAxS5peKBikFhuKTFSYFG2i47DKTFSYxSAUBYZiinN0ptFwsGKjdlRlUnljxUmfWs66kZp42QqQPusDVRVyJvlRexR9aYsm5AQc+9O3GkWrDjjtSZGcU3k1GQfMBz+NJIGyY0nNAqvNc+TPh/uEcY7GmlcTdtSvdoxlLEZJPDDjFV2CFvnlGO561NdSQyvy7jjBHaqLhPuRKzc/eNbR2OWdrk6qjq5EgAU4Ge9SCONVADtIx6DsKr20eGJeMMAccnFaVrCjSAiFypPBPQUpOxUI8xNZWzomWBy3OKvJbSt0Q1IKcJD03fhmuWU2zvjSjFWFWzdcebgD2bmgQoB1OfakLk96TNR73VmvurZDvLj/ALpJ9zWVqjjBSMjbjDYPQ1euJ1hZA3Ru+elYuqRsZ3bYAuMhlPUeprWlHXU58RO0LIvaZMQmwnIUDA9KvGZsccVkWO2V4UdwoGCFUfzNapmhFyYP48ZHoaKi94dGV4bjS7GsvVInLiUE4xzz0rWuJI4Iy79M+lUL9hIhETKXXkA06bs7irRTi0zLcSLEFVj5fUYqsQR82eadLLKGKu3QY4PFRjnqcfWupHmyd2OXnOSAO5qbfCuCqlsHlT3FVxznp+NOXDHGce5ptCTJTPJKBEi4UElQOtXmuBaQIAu4MOqnoapR+XF8xYmQHgqe1PjZWjVHAKg9zUNL5G0JNddSN7mVyAzkgDGRxmonjK4JBAPTNLLtDZRSF96jZy3Uk/WrS7GMn3BlxTaCc0lUQO4xSHqcUUUgDqaKU44pM0AJSVJhcDnk/pTniRT/AK1GHqvJouPlbIaMUpxnigUxAFPakdSoBPenhioIzwabKwYDAxSHpYRRkE46UEGkToaeCu3kZNAkR0ZpTyeRSGmAE5pKXFHSgQlLSUtABSGiigBKKKKACiiigApKWigBKKU0lAC0uOM0lLQAlFFFAFqigClpFCUUUooAKKXFGKAClooxQAUUClFABijFApRQMKKWjFIAoo4paBiUYpaKAG4oxTqWgBhWkINSAUuBQBBg0YNTbaQqTRcViKgGnbD6Uuw0xWE3GijaaMUDFB9aduFMopAO3DNKCKjoFAybFHFMAyMGgqRQMkxSU1SR1pc5pALSUp4pN/tQAtLikBzTs0AJikpdwpNwoAWk20FhSgj1oAAMUm2gn0NN5z1oAftoxSc4pQaADFJinUtAxmDRzTsUUAN5op2KMUCG5NG6lxQFoAM0tJtowaBi0CkGacOaAA0mKdgUm2kMTbRinAHFIQR1oAKXimFjTec07CuS5HrRkeoqMAmgilYLkgxS1FzT13YoGmOFLRilxSGNpM0/FIRQFhv40hz6U/b7UEZouFiLPrSg07YT0pwjPtTuFmMop+zFIQRSCwAUuaRc+lOBx1oGAJI4oJ9RShx6Uu8HtSHoICvrTximZx/DS7x/doGh1JuHYUBz6CnbsDlcUhjSW7CnKT3pRk+oppJHegNiUc9acAKgLe9J5hHTNKw7otcCjIqqGJ61IW+XGaLDTJty+uKUEdqqlQe9KoIP3iKLBctUuOOaYrcUu8DqakodSfSkMi44NNMg7UwEKvnqfzphLqeSac0npTN5+v1pk6D0DuetSFXA6io/N4HFPEg65pO5SsChj1OKlwBUJmXHFPViRkUmhpol5PU0uM0wGn5460ihMc8UoFN3DtzTs0ALik20oNLSAbik20+l+lMLDMUYp+KTFAWExSU7FLtzQFhop2KKXFAWExRtp+KMUDsNxikp1GBSCwynAUhdQcZFO69KAsGKTApaRmC8k0AC4IyKcABUHmrvJAIBpwkBPBzTaYJomyKXIqHefSjd7UrDuSkr3ppZaj3UYHrRYLjiwpMZpCPegA+tACMOoBXjrk9Kym2rKihkZc+n86lvY3WR2VflPJOetVA/zKxOFPHArWKOepLWxqWzqdscKEDPzE9qtbBVC1mtoSdvmEY5JNSWsslxdBsERheg6fjWckbQkrJFsIPSl2DOelSYA9aXgjgVFzblIJmSMAuQMnAqpeKjpuwhI9T1qe+tWuVAVsEdM1kTQlH28kdK0gk+phVbXTQiYjLbiPw5oSURqflye2elO2IoBJyT/CBSTLgfc2jtnrW5yarUiikZGL43LnkHpWhb6lJEuEjUD09KowoC+GBK9wDVkWzE7kUHPRFOfzqZcvUqnzr4Sz/aF05JBABGBgdKsaalwZZJJX+8O9KtupUZG0kYI64+lXojsjVFPAGK55yVrJHdTpybvJj/ACm9aCmOpo3N6moDcLtclgMErkmsldnQ+VFbVI2dVYKGC/nWQzPgryF7inTzTJNweQcjacioHnlYMGYkN19664RaR5lWcZO+xatZZkIS3xluCCOtaFjaNbqZp+H7AnoKyIrqUIFBG0cdORUyvNOnkqzOuelKcWyqU4rzZrXTC7tym8qD6VhyFlZ1DcfdJ9RWjJcrbRhWZZGzg7T0rPurlJJAUTgDoR3opJr0KxEovW+pX8s+lMP1pzSFsZpvbNbnE7dBAMnHT60ciil6jGaBCip4nRV+cDnnJFVwcUrtuyT17Y7UmrlRlbUWRsng8dh6VGaUmk600S3cTrS0UUxBiijNJQA4jHWkpM0ZoAPpQBnPNJmhWx1GaAHEAY5zRkYxj8aRjnHFIWpDBjnoKbR1opkgO+KXtTaUGgBaSiigApM0UUAFFFFABSUUUAFFFJQAUooooAO9FFLQAlFLSUAKAKOlAJooAKSiigC3RikDinZB6GkUJS0nWloAKKWgUAFLRiloGJS0UYpAFKKTFLQMXFGKKWgBKMUtFABRiiigAopaMUAFFFLQAlFFFABSE0tLigBnNBPtTwKKAI+O9GBUmM0bR6UAR7c0uz0qQcUcUDsRgGnc+lLSg0gG96NuadkUZFACYo2ijIo3CgYm09jRhqdkUuaAsRkGkwamHNGKLhYgxRUzLTdnvRcVhlAPNKRSgCmINxo30uFowvrSHqAcUu4etGFowvrQMUEUtJgClwPWkMXikoyvSjIoAXFKBRle9KGWgYYppWn7wPSmF/QUBoJijFG/2pd4oFoIBS03zPQU3cSetFguiYClxUO89+aN2epNFg5kSEqKZ8pPPFHB7UhxQFx23+6aawI6immlDsO9AtABxTg/tTCcnmgkdqdguP8AMNG9vWo80uaLBdkqsafuA61XzS5pWK5icOM9OKkwKqhqeJGBzmk0NS7kxKjrikBBqJnB5xinh09cUrDuS4FGFxTPMXHXNMLFuhFKw20SFkFRsVY5zgelNYnvTcVSRLkO3AdB+dOD+wqOg0Cuxxc55pwZcc1FS9qLBckLgdOKTd71HRRYLsm8w00uTTKUUDuxwOKdvJpgpc0AmKWNJk0hpRQO4u49KXcaTFAB9KQajgzetLuPWm4NLtb0NA0LuJpQTSBT6GnBaQ7MMUAVIqk9hTvKB70rlcpGPc09Yw3el8huoI/OmhGzjFK5Vmt0SeUo60BwvA6UKrdD0+tO8te2aVyrdg3jFG4npzUkcar6U7jsMClcfKRBSfanqMHoad9KXFFxpCgUHgetA4prTIvBP5Ug2EySeRTs4GScCoWuVzwCR60vmo/BPFOzFdDzOgHUmo/tOD93j60yRU5weaiIqkkS2y59pj44NPWWNvusM+hqgBRijlQuZlqS5AOFGTQtyO6/lVXFPC8ZosgUmXBMhHDY+oqJslsrJn8ahpvNFhuRYVT1D4/GkdJM9c/jUQyKcGIoC6FCvTgj+v60iyHPNSbx2BzSbY0kwEZ9eaUReppPMbsKUSEn7p/ClqVZDhGB0pQopVDN0B/KnNE643A1Ny1HyG4FIQPWnDZj5t2fTFPKrIfkGBSuNRuRDHqKeApHrUiWx/ut+VTLbNjOMD3pOaLVKXYqbR/dqnfPJAyypjGMEEVpXUbRQM6YZlGcVTmKSWnmYVwRkAnjNVCXUzqQ0t1MW5uXn4Y8dgKhUDcgG5gevarEr7JG3wRj/ZB4FQMxcjdj6DoK6UefLfVkgLowwuCegxnNa2mxSjMkjnpgLjArNt7p4GUI2VU5CkVd/tR9zbY1VcZGTzWc1J6I6KMoRd2y8Jlad4u6dSamMqopJ24FYttcMLjOPvnDZ5rSuSEjxJnDcdKylGzsdNOpzRbK8WorsPmbicnGB2qheXsjSkRsAg6YFSwQRyCTf8pTgYNRz2gjG4tkck1olBSOeTqygU1mdAdpxnvQPmYEscHqcdKjkdWI2rtHuc5pVLlduTtHOK3scl+hNAnmMVz0PWpWHkOQknzdDtqqD6dal8mTahAzu6Cpa11Ki9NEaEN+kcaIVZiPvEnpUn9oq0yrFypOCTVKC1eSQpgk4+grRs9P8t1kYgeq9eaxnyI66XtpaLYmmnMUbMX+bHANZsV0wMYYbs5LDHqauatGGgLbhlDmsPeQ3yk565p0opxFiJyjOxcv54pHJjJUng5GKouVHCnJ9e1BO7rTSK2jGyOSc+Z3HBhjkc9jVqK5eBUbbgeo71TxSnpj096GrijNx1QsjhmYgkjPem9ak8tSpIcD2NMIwOtNCae43FIx9KUmkIpkiUtJS5/KgQUUZoBx2oGJzSUuaKYgopKKACg0UGgBKKKKAENIBTqKAENJTieKbQIAaKWkoASiilFACUtFJQAtJRRmgApKWkoAKKKKACiiigApRSUooATvSig0UABopaSgAoox6UlABRRRQBLSimilBoAcDin7x3FR0UDJd607IxnNQUtKwXJt6+tLuX1FQUtFguS719aXevrUNFFh3JwynvS5HqKr0UWC5ZzSB1JwDVeiiwXLX1oyKrZNKGI6UWHcs0lQ+a3tTlkJPQUrBclopNwHU0Ag9DQMWijFLQAUUlKKBi4ooxS0gEpcUUlABSikoH1oAUik20uWHajIoGN20Yp2RRxQFhuKTFSYowKLhYjxSYqXaKNoouFiKg5qbYKNgouFiIE0uTUuwUbRSuOzITk0YNT7BRt9KLhYh2+9G33FSlaNtFwsRbM0bDUoUetLj3ouHKRbDSbSDUxA9aTaPU0XCxCQe9AXPcVKYxSGIdqdxWGbfcU4LSeWfWkww4oAfgUuBjpUfNOUkUh3F2jvTgq0m8+gpwdv7tGo9Bdi0jIDRubsuKVd2eRSHoN8sUnljvU3PpS8Y6UXDlIdg7CmmOpx1pGDdjii4cpDt9Ka3ualZGP8VNMbCncTRERSYqXYaXZ7incnlZDRipChpNhouFmMxRUixk0vln1FFw5WR4oxTiuOtFK4WEpcUUZoGGDSbTTuacvvRcdhgBpeRUygYyacNrcVPMWoEGSaMGrCIAc1II1POKXMP2bKeKMVbMS+lM8gZ60cyF7NlcAUuBVj7P6MKTyQOpo5kPkZBilxxUwjX1o8sY4NHMHIyHFJU/lEeh/GmlG7KB+NO6FyMjxSgUoRzyFpQrk4xRcOVjdtKFp3KnBFOyW6DH0pXK5UIMdMU/IxwKTy5D0U0whgeQaW49UPDYNOEo9CaYkbv0Xj1NL5TA4Io0GuYkEikc09XU1GkLseFNP+zyA9h75qXYtKXYflT0IppYdqaLd93UEd8GpPKUdzn60rodpDASelLhhT1jH8TY/GgI2eOnrRcfKxnOaeAaf5ZHXFLtouHKM3EdFNOBY/3fzpcCjFIaQAN6p+dGyRv+WqLShaUCkPTsMMJz+8lGPaj7PEw4kO73GKlCg9TilVUDcqWFF2Oy7FIx4NKqZOBV99r4HljA7ZoC7BuSNV9+tHOxeyV9yobSUqSAABTRGoGD1q+sj9ySPSiRIJD88eD6g80ueXUv2cOn4lDaD3FJgZ9auG1gzwzkelPFvAv3lb6lqfOheybKSxZ5NPICjgZ96uBYOhQgexprRwgcrk+xpc4/ZJLRlPPqM04BG/hxVoIpHEIx707yyRxGMUOYKmVcxKeOKQxZGV6VZK7D9xQfzpNx7saLvoNxWzKwhYHhT+VSLE2cBCTUvmHsxoyfU0XYuWKFUBByi7qXJ7AD6UzilD496Vh8xKpyeTge1KCcYy2PrUQf2pfM9qVilIeY0JzhvxNSoyoMhQvvVcS+oqpe3u2MqrbJFYYoUHLQHUUFctWV5511cJklc5U+gq40jYxurlrWRvtJdQxk5IA9a145gERTJknjJ7mnOmk9CaNdyWpaulM8LRseGHasJrWRGSEOMHJ29hWrcSvHA7KeQOKwp7yeRNrtx3IGCaukpdDLEShf3txjusZIxlwenaoTIdwOMYPak60HH4V0pHntkxaNkDAt5hPzAjilijDgnegI7McZqE4x8ufxoye9Fh311Ni2WK0Qy3BUnjaAc1HqV3mWJVYkEc46Gs1pZJAF6hRwAO1LI5O1WbdtHHtWap63Z0Sr+5yxWgjTPHIdvBpk0jytudiac4BwVXtUTZ61okjmcnsKAMep9Kk3gHgfUGoc05AWOBTsJPsOjdkZiADngginGR2fJYkmmoCxwKeCeB2B4FDGm7Fy3v5YwqkhlHqOasjU3yxCqBj5QT3rMIIALc+lKELKWOAqjv39qydOL1OiNaqtEyS5ull3ldw3j5lPr7VTzg5/SnyFS3yLtHuetRGtIpJGE5NvUk3AjkD29qYcdqQH1pCRnjp71ViG7i5pygscDGfrSDbt5Bz602gNieNkj3+Yoc4wB2FMkcOQ3H0AximgjnIzxx7U2lbW43LSw4DJ44+tI3HfNJSGmSFFBopiFooooASjilpM0AIaKDRQAUHpRSZoAWkozRQITNBNGKKAD60E4opKBhSUtJQIKM0UUALSUUUAFFFAFABSUpHFNoAWiilAoASkp2KSgApRSGlFACUUUtABRRRQACjvRRQAnSkpTzSUAS0UUCgBRS5puaWgBRS02nUDClpM0UCFopKKBi0UUUAFFFFABRRRQAUuaSigBc0oNJRQBKspHvT/OHpiq9FKw7skDkHrTjLwNtRClzRYLjzIx70eYxGM0yiiwXFyfWnhzwM1HS0BckMp9KkUggGq9OWQqMYpNFJ9ywMetLjNVhK3t1qZZFJ60rFJpjsUuBSZz0o5pDDbS496QU4A9s0AGD60vQUm0+tLtPrQMMnHSjdSbaMUAKGzTsio8UYoC5Jn3ozTADTsUgFzRTeaOaAHUYpMmlBNACYoxS0ZoADkUlLmkoASlp4UGlCj1ouOxGBRs9ql2ilxRcLEQSnBcU/FLilcdhgpcA0uKMUDDA9KNgPUUvTrRmgLDfLHpSFB6U/NFK4WRGR9aNufWpMZoxTuFiLaPSgL/s1LilxSuPlIDnpto+b0qfbRii4cpVO7vmkwauYz2pNg9KdxcpUC04KO+as7B6UbKOYOQrhFPrThCO9TeWKXYRSuUokPlD1oEVTBTTgtK4+VEGzIwc0oi5qxtpcUrlKKIhEPelCY7mpMUbaVyrEewZ6k04IPSnbQKdii4JEeKQqPSpMUYpBYi2L6UBR6VLto2CncLEYQelLtHpUm2jZSuFiLauOlNIX0qfZSbOelFwsQgL6U5WwPlxUhjoEeKLodmRkn1NAJ9c/WptgzSrHzRdAosiyxPenBn9TU4j46UGOpui1FkRZ26saTBPeplSneXRcfK2V9tAQ+lWRFS+XilzD5CBV/CnYqXy6Xy6Lj5SGjBNTeX7UoQ5pcwcjIdtLg1N5ZpdmDRzD5CHaaQgip8CjaDRzByES5p4U4qQJShcUnIpQGbaXbUoIxg0HHYVPMXyEW3FGKlK+1Gz2o5g5BmB3phxUjL2pNgNFw5RhcYGBzTanEanqKURrRzIHBsh3HGOfzpp3elWdqiq7zot2ICOq5BHrTTvsTJW3YgVjThExqfGOgpwz6UuYpUyt5LA0bCOoqzimSMqAZOSTRzMORIh20ojp7SKOnNRm4I/hFNNiaih2zHamMuKRJ9zsGxipPNj9RRqhLlZTuS6QuyHBAyDWTdXMchVjnfj5gK2TfWxLxy4XkgZHBFYV4UeU+XtCg/LhccVvSv1RyYhq10xsTbmJA+nOKuFXV45LhljRT8oFUkIjYkAN/vClaXLAkDA6DtWrVznjNRWpp6iR5QLsRg5GOePWqUrQKm3cz/xcdCaJWlvFBijP91tvQ1UC4XJx1xiphGyszSrUu7pA7ZOcAfSmUGkrU5BetSo5UHgEkYye1Rg47UZNDQ07bFqK4SJTtjCuRjPXNVXYFsqNvtRn1GaRyCeBgUkrMpzbVhPMcAqGIB7U2nHFNqkQwp2TTaeuQeB+dAIEbaemRUiyqFwVJJ7/wCFRKcdgfrRnnpSauNOyL1m7chUGByeM4qbUom+V48GPHTPes+OVo3DRnBFSz3LzKrMU+U/dxWbi+a6OiNSLpuMis5OTTKcxJJJ702tTlYoGaU4xwMU2igBVJHSijtRQAUZoJ4pKYgNFFFABRRSUAKKXOKaKcMYoACecU08Uv1owO9ACUUUE0AGaSiigApO9L2pKBBmkopaAEooooAM0nWiigAooooAKSlFGOaAClBpKUUAB6Uyn000AFFFKBQAUUGkoAKBR1paAEozSUtAC0UlFAC0UlFAAelJSmkoAkooooAKWkpaAClpKKAHA0ZptGaAH0U0UuaBjqKTNANAC0UUtABSUtJQAUUUtAAKKKKACiiigAFLSUUALRRSUAOopKKAFopKWgApaTNFIBwJXocVIsxHUA1FRRYd2TecewFHnN7VDmlzRZD5mS+c3tS+c3oKhzS0WQczH+a/qKQux702iiwrsUMR0NKJHHem0UWC48yOedxo81/71MpaLDuyQSsOvNPEw/iH5VBmilZApMnEy9wRUgKnoQap0BiDwcUnEpT7lygEE4yM1WEz9Mim5Oc55o5R86Lu2lCn0qqs8gGM/pSGV26saXKx88S2BTgapCaQfxfnSCV/7xo5WHtEXxThVH7Q+e1PF0c/d4pcrKVRFukqBZ1b2PpUm4+tKxSaY40hJ7U3dRmgLjgaXPvTcD1oxigBc0uabikIPrQMfmlzUeDRk0WC4/NLu9qZmjJpBceGpwIqPOKXd60WHckyPWl4qLcD60Z9M0rFXJcUVFuftQN1FguS5pQ3rUYLelBL9gKVh3JM806oMS0fvfWiw7+ROTSZqvscnqc/WpFjbu1FkCbfQlpN6+tIVHc0m1fXJqStR/mD0NG8noKYMDtTgQe1AIcDntTwOKj3AUeZRYd0S4pcVD5lG4n+LFKzHdExFJjFRBtvfNOD564oswuiUD2pcVGHA70LKCcUrMq6JMUuKZ5qj3pvnc9BilZjukS7fSlUc1F52OgH50GYkcYFFmHNEsCgDJxVVZXU5Jz9amWdRzgUnFoqMosmC45pN6g46n2pnnrnqMU4zJjOB+FTZl3j0Y8yKq7mVgPXFCyo/wB0N+VQ/aFH8FL9sxwqUcr7BzR7k5GOtIHGfuk1EtyD95Pyp5uEx0NKz7DvF9R+fag+xNV2uVB4U003b/wqBT5WHPHuTMzE8Ow9sUDf65/CoDcSE8ACkLyHvT5WTzotjJHTml7cg1TVpR91jTvMk7k0co1NFoEUpdR1I/OqhMjev4UiwSP0GaXKurHzPoic3KCm/bD/AAr+dQ/Z5B1Q/lTvs8n9xvyqrQIvUJftTE54B+lBupD0OPoKZ5D/AN1vypuxh/Cfype6O8yT7TJnk5p3nkn0FQ7aaVxRZBzSRaE6gcmhrgZ4waq4HfP4U2X93Ez9cChQQ3OVid7oLjdtGTgZrLVj9r3FyMdw2ce2aszndCCm0g9STVSGXbMNpTp1PQVrCNkzmqzbkkzXWZjGr9A3TdThOT/His24nZ2jUuH28/KOBVvy881m4pbm8ajk2kTNKveQmqM92sd1GATt7mnz/uYy7Zx0rJEhMi5fjPVu1XTgmZVqjjZG95gPQ1DcylIzjOTwOKZZsZIvk3Pg4JNNuiyuquAvBIJpRXvWLnJ8lxbTLID7VMwNQ2TABFVS2Rz9asXW5IiEQkkdu1En71ggrwuZl+qBgx++ew71Rdu2Mc9xzUs9xIRsLcDjkc1W5JyT+NdME0tTz6sk5XRJG2CcMF460fIR82QfUVEDg5pc81VjNMkeU4AUbQP7vFRE04ghc44NNHvQgk29xKKDSUyBaUcjGBTaM4oC44nimmlzSUAGOKKM0maAFxRSZooAM0uabS0ALRmkooADSUGkpiFopKWgBRRSUtACUtIaM0ABoozRQAUlFKDQAmKcBxQaSgAPJ4pD70vU0hwBQAlFFFABSUoooEJRRRQAUhoooAKKKXHFADaB3opR3oAbS0lKDmgBwpKKDQA005fWigDFAC000tFACUopKKAAmkpaKAAUUUUAJRS4oxzQAlFLiigBKKXFFAB17U2nHmkIoAfRRRQAUtJRQAtFFFABRRRQAClpKWgApQabRQA8HmlzTAaXNAx2aKbmlzQAtBozRQAUUUUALRRRQIKWkooGLRRSUAFLRRQAUUUUAFFFFAC0UlFAC0UlLQAtFJRQA7NFNpaAFFGaSloAKM0lFADs0UlJQAuaSiigApc0lFADs0U2lzQA6kpM0uaACiiikAtOV2ByDTaKB3J1l+b5un8qkyCMg8VUoycUnEtTsXBmnAVSV2U5BNSic8cfWpcWWposEGkxUYlU98fWnA56GlYpNMdilFN5peaQxwIpQR6VGeKTcM4yKLDuTZHoKQsPQVHS80rBcfuPagHFNFLxQO44MfWl3YplFFh3H7z60nmN602ilYd2OLtRvNJxRQF2G4g9aXzD603in8Y7UArjS+aM5p4C+lL8g/houPl8xop1G5f7oo3j+4v5UhpLuGGpQpPQUbx2QCgSYHCilqNJC7T3BFOEbEZ4pvnP60vmOe9Go/dH+Uf8ilEQ/wBr8qjEjj+I0/zZR3palLlHCMY/ipRGB1BqPzZT3NHmSdMmlZlXj2JPLXPRvzp4jjB6E+xNQguO9G9qVn3KTj2JTEmeEx/wKlEad1A/GmB29aQuCfmyaVmF4roTbYcdVpjJDnOePQVGZAPurj605ZV/iQGizHzRYhEYOcmglOxOaeWiYcrj2puIj0Uii4mu1hvWlC+1TRxR4yT+tSrEn939aTnYqNJsq7cGlz6irXlIeg/WlEC45Sp9oi1SZWVwP4Fpd2f4R+VW1hTsozTxb552CpdRGioyKYLHoB+AoUt2GfwrQEYVeU4pdkZ/gAqfarsX7F9ygsrDsPypC7df6VeMEROQtOEKAf6sfjR7SPYPZS7lFWlb7qkj8qkEMw5C/kc1eBOMADFORcHIGPoKh1PItUu7KiRTsM7WI96kWCYn0/GrgVn6AmmsGHJBH41HPc0VNIqSRyrnKkimKhcco1XN47sPzo3Lnlh+dPnfYXs03uVDCMcJTTDkfdH4GpdQnSO3ZVZcsCOtLaTI9vGxKBtoBGKq8uXmJtDn5CJbcdDGCfrVXVUMVqTsABIB96sX979neFVKfO4Bx6VV1fUkSKWFSyyjGDtyDWlNTckzGtKmoSVzJujbtHGF3FguCo6D61WikKN90EEbSBTCxbJ/OkDNnIJz7V3qNlY8aVS8rmistl5ILGUNnBUH9auwX8f2r7PEwMZUBT71g9RU0EJJD8qufvdgazlSTWrNqeImmuVF29Mqu6TyYOc49apY3OCV3D0HGaHlkWRnc7mBwd3OajaZ2YEnn2q4xsjOpNSZpWPlhgyTlAASY2PXj1qvPdPIoDndt5B9Krq+DUlzLE+Au5uOCeNppclpXK9reFtgiuXUgRsQAPmNWJ9Tz0jBdPuvng/UVS85/JEYCqoHOB1+tRd+afIm7slV5QVoslupEmYSAEO3L56Z9qgxSkikJGeOlWlbQwlK7uxKKSiqJFZiepNIKTNFAXFNJQaKBBRQKKACjNFBpgJRRRQIKKKKAEpaO9FIAooooADSClNFMBMUUUUALQaSigBDSClNFACUZoooAWkooFAC0tJzR2oAMd6Pal4x1pCaACkpaQ9KACikpT0FADaWik5oELSZoooAKOxpKUUAA5oXv9KB1pR0NADTQKKWgAFFJmigB4470lGfQUlAwox60ZooEGKWkooADijikNFAC0UZozQAtIRmjNBNABRnFJmkoAdmkpKKAFpKKKAH0UUUAFLSUooASloooAKKKM0AFFFFABRRRQAUtJRQAtFFLQACiiigBaM03NLQMXNLSUtABRRRQIKWkpaBi0UlLQAUUlLQAUUUUAFFKKKAEpc0UUAGaM0UYoAWlpuKKAHUUZNFABRiiigAooooAKSlooASiloxQAlFLRQAlLRijFABS0UooASloooAKSlpKAClzSUUgFzSgnsabRQO48MR0Jp3mPjG6os0uaLD5mOJJopM0tAXHK7Dv+dSCfHVQahzSZpWGptFlZ1zyMU4zR+tUzmjNLlRSqsueenofypyujdD+BqlmlDUuQpVWX8Ckym7GefrVPd70bqXIV7XyL20Z60bQO9UgxHQ4pCxPU0cg/arsX9o9aNo9az8mlViOhIpcg/bLsaG0UbRVITSDox/GnC4buAaXIylViW9q04BaqC5wOVyfrSi6/2f1pcrK9rAtYWlGP8AIqsLle6mni4j9T+VLlY1UiTHH+RRUfnxY+9+lAmiP8QpWZXNHuSZFGaaHjPRh+dPVk9R+dIpa9Rcj0o3D0pwKHptpw2+lTctK40MO+aUMue9O+X0FLlf7opXLSYxinYtSAx4/izUuV9BS/L/AHRSuPlIcJ70m0dqm+X0FJujHUqKLhyojCc9alWL/aFBeEDIdKjNzEM4bP0FHvPYPcW7JjEezCgRODwwqEXkfcN+VL9tTsrH9KOWYc9LuWUWUcbqfslPVqpfbRjhDn60q3xzynHsalwn2LVakupeVZQfvU8CTPWqa36Z5Vh+NKb+PPG/64qXCfY0Val3LzBmXDGkUSdB29aqrexk483H1FTpIrdJAfoahxa3LU4y2ZIDKeNtSBZ+uw01HVT6/WlMinuPwNQ7mqt3JVEndSKR4pWPDOPbNR7vf9aQyepqbMu6tqSCOcdWb/vqlMG777t9Kh8zI4NRtKw7mmoyZLlFFryBjis68u0hvYoh90ff/HpUhmYdzWLNNK9yDISzKeOh4ralTbepy4iuoxSiupY1S53ZjVSEz1x1qfTZcxhNyZA9aoXglLb3k3rjcCT/ACFLaz+WmBNhpB0Vc/n6Vu4Xp2RzRqWrNsivX3zM4bJ3+tSXc0NxDG8oKyDjCnOR71Rd8k00n5SK3UNjidXV+Ywn6UA0horQ57js07zXCFAx2+lMxSE+lFhptCnnmkopKBDgaCaBSE8UAKG6UcHOT9KZRmiwXFNNNLSUxBSUtGKBCClooxQAhopTSdqACigdKKACilooAbRTsUlAhKKKKAE70tJRTAUUtJmgHg0gA0lFFMAFFGaKACikpaAEpKWjFAABSnFFJQAUUUlADuCeKQ0UhoAUUUmeMUoOKADtSYpc0UAIRSZoooAM0hNFFAhKKWgUAJSgUuKKAEFL2opKAENLSUtABSDrRR3oAcaQ0Cg0AJS0YzSHFABS0lLQAUnag0UAJRmiigAzRSgUY9KAEpQKMUtACYNGKX8aQmgANJSmkoAkooooAKKSloADSU6igBKSnYoxQA2lpcUUAJRS49KKAEpaDQBQAUUYoxQAUUtFACUtFLQAlLRiigBaKQCloAKM0UUDFzRSYo5oAWlxSCnCgBMUYpaWgBtLijFGKACjFLiigBMUU7GaXFADaKWlxQA2ilxRigBKKXFGKACijFLQAlLRRQAUUUYoASlopcGgBKKXFGDQAlLRg0YNIAopcH0o2n0NACUGjB9DRtPpQAUtGD6UAH0oGFJinYPpRg+lADMUuKdg+ho2n0NADaOlO2n0pNp9DQAmaM0u0+ho2t6GgLBRS7G9DQFb0NAWEop21vQ0bT6GgdhtJT9reho2n0NILDaM07YfQ0uxvQ0D1G5pc0uxvQ0bG9DQAlFLsb+6aNjehoASjNO2N/dP5UbG9DQOzG5ozTtjehpfLb+6aQWYzNG40/y2x900eU/900aDsxuaUUvlv/dNHlv/AHTRoGoZo3kcAkfjS+W/900eVJ/dNGg9RA7DoxH408XEn980nlP/AHDR5L/3TS0GnJD/AD5T/wAtDThPJ/faovKkB+6aUJJ/cP5UrIfNPzHGQsckk/U0b6TY/wDcNHlP/cP5UaB7wbxmnbs0zyn/ALppRHJ/dNGgajs0uaBHJ/dNL5Un900tClcXNGaTZJ/dNKIpD/CaWg9ewZpwNAhk/uGnCGX+4aV0UlLsJmjNPEEp/gNL5Ev9w0roq0uw0MfU/nShyOhI+hpfIl7IfzFKIJj/AMsz+Yo0HaQhkPqfzpPNc/xN+dO+zzdoj+lJ5MuceWaXuj98aGIPBP509ZG7Mfzpfs8v/PNqcbaQKCFYn0xQ2hpTGSSOEJ8xh6c1nsTuyx5Pc1fkikKkGNsDms2Rt+WyOuMVcLGNVvqDMSvJpseC2O56UHG3OefSm9K0sYX1HEYJBppFOB9aHcE/KuBQGgzFIaWjBpkjc4pKdto20ANop2KTFAgzSUuKNtAxuKME0/FL0oFYZt9aXFOxmkIoAQ4pDS0GgBp60UGlxTENop2KMUANoxTwuaMCgBlGCO1O+lHfmgBmDRinGm0AB+lIaXNFAhuKXFFGaYBRSZooAKKKKAEpaMGigAzSZ7UUCgBRSUUfWgApcgUlFACE0UUUAFFGKcBzmgBtLQaSgBc+lJRRigApDS0GgQlJS0vFACUAGngLj3oz2HFA7DdpApM0pptABRS0UCDFKAKTNGSaBgwpKCc0lAhwpCe1JS0AL0FNpx6UhoASijFFABRSUtABS0lFACiikozQAtJRRQAUlLmkoAKKSloAlwKMCigUAGB70u0e9GaM0DFwPejA96TNLmgAwKMD3ozRQIXApMD3oooGKAPejAoooAMD0owPSjNFABgelLgelGaKADA9KAB6UZozQAuB/dFHHoKM0ZoAOPQUfgKKWkAD6Ckz7CnUUAN/AflS/gKWigA/AflRmiloAPwoozS8UAGaMml4oyKBiZNLk/5FAI96XcPegBMn/Ipcn0/SjdRuoGGW/wAijJ70bqA1AC5NGTSbh6Uu72oAMmjJpM+1LkelABk0c0bhRuFAC80c0m72pdw9KQBzRzS5HpRkUAJzRzRkUZFAC5PrSjPrTeKMigY7n1owfWm8etH40AO59aUZ9aZQKAJPxox70wCnAfSgBce9GPejB9qSkMXHvS496AaUGgdhMe9GB60u6lzRcLDcD1oCj1p2aAfelcdkJt96XaPWl3Gii4WE2+9G33pcmlBoHZDdtG360p60uTSuFhNtG2nAmlzRcdhuwUm30pxJpM0BZCbKXZRnNLQFkJto20pzSii47DdlGyn5pRSuFkR7DRsNSijHvRcfKRbDShDUuKXFK4+VEYQ+lGw+lSc0tFx8qIvLb+6aBGf7tT0opXK5EQBD/dNPEZ/umpaWlzMfIiLyj/dNO8s/3afupeTSux8qIvLP92k8pv7tTZ+tKMkdDRzMfIiARt/dpfKb0qwA2eh/KlzjrmlzMagiv5bY6UnlN6VYJozRzMfIit5belOWJu4qwWoDGjmY1BEIib0pwhb0qcN7U8N9PyqXJlqnEhELegp4gbuBUm8+lOEhx0qW5FqMSLyTnoKXySewqUSN6fpS73x8qGp5mUoRIhbeqCgQOvKxg1YjMgHzpn8aeZMdf51Lky1TjYgWFxyYh+BFBjcH/UKf+BVYE2B2pBPhqXM+xXLHuV3E6/dtFI/36ika6xgWa5/36utccYGDTDMfampPsJwT+1+RhzwX0hJdSq/3QeBVTym7kfnXS72IOcflWXKcEj5T+FdNOo3pY4a9CK1uZ/knHb86QxkdCPzq7MflGSOnHFQxpvOPl/GtVLS5zOmr2RXMZ7kUnl4//XU7RgH7wprqB3ppkuFiIqRRg96U4pOM0yBMHsKTac9KdxnqaQ4oCwnln0o2H0NLRmmAm0jsfypCD6Gn5Bo/CkFiMg+hpMGnk0UxWGcgUh5p9IcUAJge9KAPSk4pQaAEyBRnPrRxS5x0oEJj0o49aN1GaAEJ9KSnUmaYDaSn5pKBDMUuPel/CjPNADeBRxmnEE00igBMUlOpOKBBijFKKOKBiDijvRgUmKYhT7UhFH40Y96AEopxFGPegBKMcUuPpSYNACUYp2PpSYzQAfgKUA4yTik5z0FBBPWgBeO1NJ5penakPJ6YoAOtJiiigAozRilxQA2kp+0d6BjPSgBoBp2Me9KaMUAISTSZoIPejFACcmjHqaWk5oAXGOabTsdyaTAoENxS0uKXaPWgBtFP20Yx1FADMUoFOpM0DEY80hoNJQIKSlxRQAlLSUUALSUuKSgAooooAKKKKACiilAoASg07FJQBJRRRQAUUUUAFLzSUUAFLSUtAC0lFFAC0UlLQAGiiigYUUUuaACjmiloASjmlH1o/KgAozRRQAuaKKKAClxSUtABQMelFFIBaUGkxRigBwIo4pMe9FAxcilyvvSDFFAC5FGR6UdqSgBcj0pcj0pBSgmgYE0Z9qM+woz7CgAz7UZ9qPwooEJn2oz7UtFABmiiigAzRmilxQAmaBQaOTQMKKACaULQAgpRS4opAA96KKOaBig0uaQGlFACg0Uf560UigpaQU4UhhSg/wCcUUooHYSlpcfWl/GlcdhuKWlpKAsGKXFJn3p4PvQNIbmlBoPNAAzzSAWgDvRS0DSEJpPyp2BSUh2FAFLikFLj60DsGOaMUYp1ILDSKXFL70tFx2EAGKXFLxTgB2zSuOw0CjFOxSgUXHYaBSgU7FAwKVyrBilwKM0v5UhiYHbNLgYpc8cUtIqwwge/5Un1qXrQPrRcfKMG004AA9adketL8n+TSbKSG45/+vS4H40YX0FKMe2KQ7CEepH5UhHoakGCOtBUE0XG0RY96cuPWnkUgGOaLisAA9RTgcelCkk+n1qQCpbNIoZ+NGOeKeM+p/KpFye5pXsUopkS/X8MGpQOf/rVIF9cn8aUKCc4P51DkaKIm0ehpCq9walJC9BSEA+9TcuxE0eO3H1phjOeKtgDHf8AOm7Rj0oUgcEV9hpfLPTB/KrIANOwp4O786OcXIVvLIHese6IEhHQ5roTtA7/AJ1i6gi+acq+fXcK1oy9458TC0dChIRgYzT7dNx6GrMsK+WjbHCnvkVJawoy4+fPc5rdz905VSfOZ8ww3WoWJxyau3SxiQgb/bpVc7dp4Y+/HFXF6GM42bKxpOKe3tTa0MA4pGx6ilxQyHGTj86AGZozQVoxTEFLzSUUCH7SOo/WkZSOv86bg+1BB9qRQNkHFITQRTTTJYuaSkpKYh2aU0yloAWkpTSGgAooooAWjNIaTNACmiijNAgzSGijvQAlJindqSgBBRS0UAJikxTqSgBMUUuKSgQUUUUwFpKKDSGFJS0lMQUuabS0ALSdaKKACiikoAdRmkooAXpyQKOopp5pRQAuBS8U2lzSADim4paM0wDA9KPwooNAAfpScUZozQAfnRRRQAuPQ0mPeijNACEe9J2pxpKAG0oH0pKUUCEOaMUtJjigA5o5oxRQAhzSU40c0ANopaKADFFLSgn2oAbilxSkmjPHSgBMUhFOz7UmaAH0UlLQAUUUUAFFLQKACijFLigAo4pcUlAwoopaAEpaKKAEopaKACl/Gk/ClwfSgA/Gl/Gjn0ooAKKPyozQAUUY+tLg0AJS0nNFAC59qM0maUUAL+VAo/Glz7ikMOaUBu1J+IpR/vUAKAaXBpMj+9Rx/e/SkMXB96OfQ0Db6mjjPGaADn3o59DR+B/OgfQ/nQAH6Gj8DSkH/JoIPofzoCwCijB9DQAfQ0AH50mKf2+6fzpCfY/nQFhMUuPakyfel+px+NACfhSjPoKTj1pRt/vfpQMCD1wKTB/yadlR60ny+9AAB7j86MD1FL8v900mRn7tAC/iKPxFGR6UvH92gAGP7w/Kj8R+VGR6fpRn2/SkMUEf3h+VGR/eH5UA+36UpPt+lAxAR/e/Snf8CH5UgNLSGL260fjSfhSikMWjn1pKKBjhmlNMpc0BcdRjNJRQA7FG30oFJSGKAaXFJkUhIoAXmjmkBFKCKBi8+tApDQKQx4xS5plFA7j80o+tN4oBx0ApDuPx70d6bu9BRk0BceKcCaj/ACpRSKTHk0ZpnA70tAXH59MUnWm8eoozzRYdxwyKUH6U3dShsHrSBMeTnuBRnH8QppbPQ/pShh7/AJUrFJjw3pilzTM0E/5zSsXcfu55P6UpPfP6VFlieP5075vQ/nRYFIUuM+30pQw9Kb83uPxo+b3pWHckDHsDTt/PQ1D8/vilwfc0WHzMlLe1OFRA+xp6n1BpWGmO3EN709X9aYADT1x2AqWaJsl3jrTgQB/9aohnrsH504Mw/hqGjRMmVyemAP8Adp4dQOgJ9dtQBmz0x7U8OSeVH4VDRpGQ4n/OKdketIrL/Ejn6GjCf3ZPzFIok7cEUuDjigGPbwjg/WjIx/Fn6VJYDPpzTxj05+mai3KPvEj8KUSIe4P1NFguT43duPZaz7+NN3zNz7x1dVlx0X/vqq9yFPLElfRT3pw0kTV1iV5+IlAVW/DGKjtGzwIQPfNWJIyYtm4t9TUdsi4wSCRwcCtU/dMGnzoo3yjzCTCn1Jqu8a+UcCLn0BzWxMoHyhmyegxkVVuDIITg4x12sK1hPRGFSnZtmO6Y6FPwpu0Z6ipnPJ4bnuRUSjnpxXSmee1qBX3FK3CfwflzT9vcjI+tSlV8keg/hDVLZcY3KWCVONuP1pu0k1Z2oAchj6EGowVz0P51VzNxEEZx98/TbSFSOpP4ip+ich8em6o+p/joTG4gg9HP/fNJIvoxP/AcVYSJCoI84UTBR1Eh+rVPNqXyaFJ1OOM1HipzhsgZH1aoyvPJH51omYNEZFGKfj6fnScdsfnTJsMpaX3xR1oASkp34UhOe1AhKKM+1LnimAlFLQetACcUhpxFJigBKKWkoASlFBHNFAgpDSmkoAKO9FLigBKKWkP0oAQ0UuaKAEoNLg+hpKAEoxS0YoENxRS4opgGKSlpaAG0U7FJQAmKMUppCcCgAIweuaQUdKUUAFFHekJ5oAKKM0lAC0UCloAbRzS0hoAM0ox3pKKAHUU2igBxptFFACUUUUCCiikoAWlwKbS0DDFFFGaACjFLmigQmKMUtFAxKUUlLQIKSlpKAFpaBRQAUUUtACU7BpB9aXA9aBhiijj1peMdaAEzRS/jR+NACUZpeaMGgAyaM0YpdtACc0uPejFH40AGKPzox70uB3NACcUUuBRhaQCUuR6frQAPWlAHrQMTj0/Wlz/s0uB/eNLj3NADf+A0f8BpdvuaNp9aAEx7Glx6g0bff9adt96AEH0NGPY0oX3pcCgdhOPSnbh6UYWgBfakMMn+7Rkj+EUox60uKAEBP90UZb0pePU0mR60AGW9KXLelAI9aUYoAQ59KCT6Cl4oz7mgY3c3pRk07I9TR9M0AJuOKTJpeaMGgQZpQR6Ck2570bfegYbh6U4N7U3b/nNOApAO3Um8e1GKOPQUD1DcPak3j1pQB6CjA9KADcPWjcKTijj2oAXNGaOPSkOPagBwPtSg+1N47YpRSGLn2oyPSk5pRQAoIoyKQU7NIYUhoJ+tB/GgAoBNHFGcUAKM0v1pu73ozQA7PNGfem59qM+xoHcdketBNAP1pCw9TQAoz60opuR60u4f3qB3HUmR6Ubhjkmm7h60guSA+1GfamAgf/rp2R70DuL+FL+FICewP5Ubj6H8qQxfwoz7UhJ9P0pATQA/cPSgNjoKbyaXJFA7ilye1KGNN5NGT6CkMeSfX9KTJ9ablvSkBbNAXJQWxwKAzZ/+tTAWpeff86LDuPDMDzmnbiT0NQ/MOmTShj/tUrDTJjn+61Icd0P51GWP+3QX44DfjSsPmQ76IaUE9ozTA7erUu9s4LECnYE0Pz/sGj/gBpu49nxQCTzvpDH5x/AaUN/sn86Yd3940oDeppDuSrn+6fzqRR/smohkd2pwJ9T+dJlpk3P900oHrk1EGI4x+tODf7OfxqbGiZKi+tPAHbP51Ep/2Tn0pdxxwrZqGi0ydVJ//XTthHAFVstnkMKcpJ6Bv++qTRakicBl52An60jMy/w4/GotzjouR9aC0pHA4+tLlHzE3mN/zzH504ykj/VY/Gq2Zx/CPzp++b+EZ+tLlKUyQs3ZD+dSK5wP3Z/Gqu+cHoacJ5c8oAPpRygqi6lrzAP+WIqKSUgfKm4+gqM3EgPKrj6U2SZscAY9qSgDqKxI8jEcAj8KakvPfjttpvnErztH50gkbqFXH1quUly13JzIjdj+VVrmGEoW2sM9do5qTzSB0XPuahlIkHz4B9QacVZim00UZoVUA+c+OwZTUUaguAJM+5FWZ4Y9ozI2fQtVaNFMmD0/3q6YvQ4JxtLYnK3OMKzEexFPKzmHaAxPfcetL5UWAcgD/fqRo0MW0n5R33VDZtGO/wDmUTBNzmLA9qjCOD9wflVgwx5IVm/76qDytr8lsVaZhKNiyokMZPlKoH+yKqlnLcrnB6YxVtbQbCfM5PuDUH2Yq+WlPHQ8Uk0VKMrInhExXKqFH0JqO4M6tgN/47VqCJmQZuJQfTNR3ULL1mYj0LVKauayi1DqZ7B3BJ+b/gNQMCvUfpV5o2CZDOB6A1Sk3EkEsfrW0WcdRWIjQaOc04qewJrQxGgA9Tj8KXC9nP5UmM9BRjFAAcetNOPWlxSGgQlLzikxS0CFCkmnbW9Bn61HTsfSgaDBoPvQaOMUANNGKWkNMQEGkNFGB3NACGkpT9aAB3P6UCsKPrTh7t+VIFX+8fyp2F6bv0pFJDaQ04getIVz3FAhBQMZ54FOC+4pMYpgRvIWPHAHQCkRs8GkcLu+XOKI+DzQS9x9L+FAxS5oGNop2fYUmfYUAJRS5pCaACikpaAEprdaeOTwKbimISnCkpRQAGmmn96aaAG0UtFACrSjpzTaWgApDS02gAoFFA60ALQaBQaAENFBooASilooASkpaKBCUc0tJQAc0UUUALRSUUDHZopKM0ALSUZ9qPwoEFFFJQA+l/CjHuKMD1FAB+Apfyo49aOPWgYAn2pcmjAo4oAMmjcfWjI9KXPtQAmT60ZPrS5PpRn2oATJ/vUv/AqM+1LkelIBPx/Sj8T+VLx70ce9AxKUYpcD0pRgdqAE496OPQ08HijNAWGYPpRtPpT80ZoAZtPpRtapKKB2GbW9qNrU/NGfegBm1vf8qMN70/NG6gBuD70uD7/lTtwoyDQFhu00bT604n/OKT/PSkAm0+tKF/GloFAxce1LgY6U2l5NAC49qKMUYoABTqbijHvQA4DmlNNFH50hi/nSFR7/AJ0UuKAGkD/JpMD1P5040n40xBj60UH60v40AGaM0gz6/pRk+v6Uhjs0DNNyfenUBcdjikxTcH0oG72oC4pHvRt+tJ81A3ev6UALt+v50m0j1/Oj5vWg59f0oAOcd6XcfekHuaXj1NABuPoaMn3pOPX9aMigY4E0uSKbkUZ+tKwXHZpefWmZ+tKCB2/Wgdx1BJpu72o3e360BcUk0Bj/AJFJk/5NJk+lAXHZY0vPoKZk+lLlh/CKAuOyf8ilDN6U3LY+6KTL+gosFx+40bjTMv8A3RRuf0H5UWHceWNJuNN3P/kUZc//AKqLBcduNLk/5FMJf0FGX9vyosFyQZ7Uvze9R7m9hRlvUUrDuP8Ampcn1/Soxu7GlG/uf1osO5J82OtHNM2t6/rRtbuf1pWC4/5vU0vPqfzqPa1KAfagdx/PqaMkd6QLRtx1NAxwb3pd3vUZA/v0cD+OiwXJC/ufyoD+9MyP75pRt7s1KwKTHhs9xS5PqKYCn99vypcr/eaixVx4J/vUuT/e/SoiVx95qTcvZjSsHMSE5/8A1UnXqTTcj+8aXj++aAuO47MfypwH+0fzqPgcljTwy/3j+VBV0PGR/F+tODEfxfrUYK/36Xco7j8qmxSZKCTzk/nTg7DoahDp6/pTxIvd/wBKTRSkS+bIT2/OnCV/T9ai3J2k/SneYnTzT+VTbyLUn3JDM4/un8aDLI3ZR+FR5B6SH8qUFB/y0/SlZFcz7j/Mb0UfhTvMlA+4MfSo8x/3z+ApQyf89ZKLeQ+Z9x4nbuFp3nvjov8A3zUW5O0j0bl7SyUuVdg533JPtDAYwp+opPtGOyfhSAqerMfxFIPKB5Zj9CKOVdh80u5J9oB6Iv40eeQegP8AwGmFoCfvMPcijNt0LsT6gcUrLsPmb6i+duPKkfQU5XGeI2JP+zUR8kcbjQpix99gfpTshczvuTFs/wDLM5+lRy7XXY6MBnsKP3ZHElRuAOjbvxoSFKWgskClMBmOOxOKrLbHeMIQPdhUrYxxn8KZG7huQxHuvNaK6MpcraJDAwH+rU/9tKkVBsIIGPTNKWIQMAfpTlZm42A1LuWrXIGhH9xD6fNiq0iFW+aBR7h60iCTwoFVZzh/uy8ei5BpxbuTOKsLbwFuTbRY9S7UkkA3jbbIcejmpIpT3Vh9VxTzIGIBQsPY4pXdyuWLiLCoAy9lj6SU2doAMvZSMfZqn7ZEZA/3qrzS7Puqc+haoWrNJJJf8Bf5FWVVK7ksJQD38w1UfA6Wzj3Lmrk3nyqDuXP90HFVmhn7nGP9qt4nJUV3ovwRCNhHMWD/ALxpxEYAIg/8eNNZXDc9frS5lbsT+daHOhrKG4CRxn3Y81Hnn7q8e9OZJnGdh/KmGNweQAfc00J37CZ9hSE+woAoI9xVEaiUGnAKDxTiF7k/98ii4JEWM1JtYL0Qj6ilQR/xFh9BT2Ef/wBcCk2NR0IfypAKcdueMn68UYHTH60xWGkUhpxGKa1AmIRjrRSkD1FGBjrmgVhmKXFPCqerY/Cl8tcZD/8AjpouNIaoHfP4Cl+XPG7H0pdno4/WlIPTeCKVx2Yw47ZoFO2kc5FNIxTE0wNIx2r2ORSk+1QO2ScUxN2ENJRRTIHK2DUmPpUODgHsakXkZoGh2Pej8aTFGKQx3T0pKApPaggjtQMCSRjj8qaaU03j2oEKDjJ79qSmNycCnimIWgdaKBSAU0w08imkUwEooxRQAUtNpc0AKetJQTzSUAFFFFABS844pKX6UAIelJS0lABRRRQAUUUUCEooooAKKKKACjNFFABmiiigAzRRRQAUUUlAE22jb70AH1pcH1oGJtFAFG33pce9AAKWk2+9GPc0ALS0mPejHvSAWjikA96Xb70DClFJj3NG33NADsCjaPWkC+5pcD3oATb70u33pMD1NA+poAcAPelH40DpS0DE49KWjpS5pAJgUD8aWigBMUuBRRQAcUfSiigBc+xoyaOlJQMWk5owaKACjP1o59KOaAFopOaUE0AL+FFN59qXB9BQAvNHNGDRg0AHNHzUUfjQAmWoyaXIo4oATml5oz6Um72oAXB9KX8KTcaTcfSgB2aSm59qPwoAdmnA0zmlBoAfkmjp2pm8+lLv9jSHcXd7UhJpN4o3UwDJPrRzSbqXd9KBCYNGD6Uu/wBxRu96AE5owaMn1FGTQAc0oz7UgZvWlyaQxwz6CnDPoKjyf71GT/eNAD+fQUHPpTNx9aM+/wCtFh3Hc+lL83pTOPX9aSgLkh3DtTctSAE0bfpQA7cR1NGT6n86TZ6Um05o0DUdk+ppNx9T+dJt9/0pQBQGou898/nShifWm/L60mU9DQFyTcaMj0FRhlHQfpS7x6GlYaY/K0YFN3/7Jo3n0oHdDwgpdq+tR72o3H1o1C6HlRRgetM5NHNArj+B/F+tGR6im4PpSbfpQFyTPo4o5/vD86j2nsBS7T6j8qB3Y/r3H50u01Hg+v6U5SR60gQ7B9KUBvT9aTJ96Dk9s0FaC4x60U0D2pcZ7UgFAY9KXa/939KQKPSlA/zmgaFUP/zyz+FPGf8Ankc1Gd2OM0dB3zSHcl5/55Gk+Yf8szTA/rml3KaLDuPye6frTlJP8FRnHelBUdaVhpkq7v8Ann+tPG4DmM/mKhVl9ad5g/yKTRakiXI/uH86aQD/AAn86bvX0P4UvnYH3SKVmO6DYc8KaUKf7jUn2gf3CfxpDcE9Ix/OjULx7jwuOdpo3DuDTFnfvGn4rTxM/wDdX8qLMLxFwp7Gl2ZHH86T7TID0X/vmk+0Sd9v/fApajvEXaRSFT2o81vRfypPNk/2f++aeoroNrdgaOnUNSea2c8flS+c+Oqj6CjUE4ihGPQMfoM0m1geQR+FKJ5P7549KeLmX+9+lL3h3gII3PRX/Kn+Uw5IP5VGZ3zksc0glcnov5UWY1KJJt55IFKpGcFW+tR+Yc9V/KkDYbOBRZhddCxwvT+dAYbv4vqKRbkD+FR+Ap3nl+Dj8ABU2Zomu47PbdnFNaTH8Ln6CgswXIHHtio8vnuP+BUJBKRIvOcg/lUbhhyOfYCnh2H8QH40nmOTwVNIL30JYrj5eYnz6FaikkkLLth3knpjGKkVpfVPyNAJHUL+dSrJmju1a4yWK5RN32dPpuyaqvckDElqfrzV9pGI+8fwNVJ5UBxKJj/wLirh5oyqK2zKEk8Tf8u/PqGNCzo2N0TDHualKW7t0kFOEVuRl95x/eOa2ujmSk3uiN54tuFWUf8AAqhaRCeGYHHUgGrEotQvTA9sioGFuejN/OiNuwpqXdFZm96aTU7Rxk8Mw/CozGoP3jj6VomjBpjAadyex/KlCL/e/SnskeAVkY+uRRcFFiRxbjySPwzT2hH/AD0T8iKckcJ6zkf8Bp7CMj/Xk/hUtmijp/wSttAP3hRg9iPzpzRqTxIT/wABphjAxh/0Ip3IaaGkEdaTFO2tnqPzppzVEAR7Gmk1IVOBgjP+9TVQMeWH4UXHZjBTwAR9/wDSneTzwT+YqfyE2/ffjtkUnJFKDK67hyHNP3yD+NjT2jCdGcflTcKTy5/KloFmtCN59rYDseOpFJ5xP8dJIFcYHDZ4JPWoGidThgAfrVJIhtk5JYYJPNVwhJJ9KMMn8WPxzTg5A60yXruMNJS5pDTJHBhs29TmpIyVTFRK2OwP1pwk9v1pFJkpJPekyRTBIPel3r6mgLj9xpdwx0P50wOv979KcCh/iH40hiOwCEgcngc1XPWpZDuPHQcCo368Y/CqRLG1LH92oqliIA5GaAQ4A5o5pxYn0HsKbikMXNNp200mKBDKPxpSKNp9D+VMBKU0YPoaOaAEopSDjOKTmgAoopKAFozRmigAzSUUpPGKAEooooEFJRRQAUUUUAFFFFABRRSUAKaKSigBaKSigAoooNAE9LmkooGLRSUtABxRkUUUgEyKXNFLQAmaXNFFAxc0uT6U2jNADwaM03ml5oACfagH2oooAcKWmA0tAx1Gfem/hS0ALmj8aKT6UgFoyKTmlxQApNJmj8aOPWgAz70ZHrSUY96AHZHr+tJ+P603aKMCmAZPrS59/wBKTHvRigB2fekz70mPrRj60AOz70vHqaZ+Bpce1ACgj1P50vHqfzpuPaj8BSAdx60nFJRQA7ilGKbRQA7j1o/Gm8f5FFADsijI96bijFAx2aN1JR/npQIM/SjcaSigYuWpOaXmloAbg0Yp+DSfhQFhuKKXPtRu9qAExRinZo3e1ADcUU4k+lJk+goAQc0vNG4+1GaAFGaPqRTc+9GR60AOx7rS8f3hTMikIFAXH/8AAqOP71MwKKLBcd/wKk/GkpPwoAdz60AkdzSZ9qWgBcmlyT0H603j1oGPWgB27HUCjeP7opNo9aTbQPUdvHoKN49BTdvvRt96QXY8OvcUu9e1M2GjYaNB3ZJkUfLTApoIoC5LhcfeoynqaiFLSsO5JlOu6l3J9aizRRYLkwkQdB+tBlTsP1qHilx9KLIfMyTzV/u0eYv939ajx6YpdposhXY4yL2U/nQJF7g0zBo2+9FkF2P3jPSnBx2xTAtLgD1pFJslDZ7il59RUO4jt+lAb1H5UWHzEpLetJ831pu8Y+7Sq4H8NKwXXcMtmnAnPIoDp6YpdyHuB+NBS9Rwb/Yz+NKZPSPH41Hlc9R+dLkdsUrBcdvP9z9aQTFT9wUo98UYB9KNA1F+0r/FH+RoEsR7FT+dNMXfH60oio0HeQ4EH7sij6inBW7Sp+dN8o4+9S+ST0IpaD17ClSOsiH6GgqSPvqfxpnlNSFHHcUDv5EgQ/30/Ojbn+Nf++qiy3qPypwb1AoswTQ/aw43Aj605UY/xD86Ysij+EH8KeJowMGNTS1KTj3HqmD82CP96nlI/Qf991AJYu8f5GjfAf42X6jNS0ylKNh5VAen60gK5xwPrUe5ez/jing/7YqrE3uTbVIyDGfwo2J1LIPpSBFxnzU/KkP1z9EqDT5Dxt/vgfSkYY6OPyqMsM84P1TFAIB4VD9adhXHZcfxL+VKGf8AvL+VAYd41/BqaXX/AJ5f+PUB8/zJd7Dsh+lJ5h9P/Hqi3rnlD+dOG30I/GiwczY8OGHMjL7YzShQTnzh/wB80LGD0b9aUwtjII/Opui0n2LEeMfJcLn3GKH68yKT6iqvlydmFCq+eX/SlyruXzvsOmbYpIJb2Aqk9zgcwyke4q4Q2fv/APjtBJweSfYCqVkZy5ntoUUuYs/6nB9zVpbiLAG0e4x0qCRwGB8p857ripYZFfqgU+hFU7Mzg2na/wCA2d0x1Kj/AHM1TlKH/lr/AOOYrVO0rwqn61Wm+zgkGAE+x4oiwqR8/wAzODL3akYj+9mnypDnjzB+FRbBuABfHuK2RyO44OueU3fjUyXKrwYh+dMWFT03/wDfNOFqM5JP5UnYqKl0JRcxN96MCmSPExyox+NKkUe/Csd3oVqR7YHJ3KPwxU+6jS02iojxgEHOfXdTSQTwTipZLRx/EnP+0Kh+zyjrtx/vVaa7mTUlo0Nam5NSeU46gfnSGNh1x+dURZjffinR7QclQfxo8s5xinCNyOFpAkyRPJYnemD220+SKJRzvUeuKgCSg8BvwqRDMpy5YD3IqX5M1jtZojdUBwsoP4UwjH8Z/AVK6/xbfxpoU4yB+dNMhrUglXa2Pxpm47cHke9Tzqdyk91qu1WjOWjGkA9KQgig0YIHBpkjTRTh70celAhopaUbfelOCPvH8qAG4p23ikAH979KXav979KBgFz3FBAXrzQAo/iP5UhK/wC0aAEzSgg0cen60mfYUCDGaUbgOOlIWOKOtAD9wHU/kKUNuPQACmACnqPloHcX6UhpaSkAlAz2NFFMAOR3P50c0H6UlAAaTNLRigAPSkpcUYoAKOPWjHvRQAlFLRxQAhooooEJRRRQAlLRSUALSUUUAFFFFABRRRQAUUUUAFJRRQBPS0mKWgYUUUYoAKKKMUALRRijFIApc0mKPwoAXNGaTiloAM+1Lu9qTij8KBi7qMn0FJ+FLQAbj7UbjRk0c0ALuNAJ9qbz60v40AOyfaj8qTp3o/GgB1ApMj1oyKBi/Wjj0pMj1oyKAFGPSlyPSmbvajd7UCuOyPSjIpu72FJk0Bcfn2ozmmZoyaAuPJozTdxoz9KAuOzRn603NGaAHZNGabn2ozQA7NGRSZFGRQMdkUfhTd1BagBfwoz7UmaM0AOyfSjJpvPrRz60AOyaM+9N/GlAHrSAN1LmkwKMUALuo3D0pMUUALvpN9BHsKTHtQF2Lvpd1Jt9aMUALk+tJz60Y96APegAx70Y96Wg0AN20uB6UuaTNAB+FGD2ozS5oGJz60fWijigAyPT9aTI9Kdx7UZoAbn2ozS5paAEyaM0ueKM0AH4UYPpRn60ZNABg+lLtNJmjcaA0F2mjBpNx9BRu9qNR6CgH/JpQfam7uOlKGHfNIB27HQD8qA5pAy+poytAx27/OKN3pxSAr60ZFAC5J70fjRkUnFAC/L3xS5X0pvFKMelADsp6H86TK+n60ED0oGPSkMXilyKbxRxQFx2aN3vSAA9h+dKB/uigYoYHqAaMD0o/KkJPvSAXGO1GCegpMk04MR/CtAaCbc9qPL96Xd7Um7/AGaeoaC+X7ijy/em7/8AZpQ/+zS1DQUKR3pwz3NN3N2FH7ztQP0JQwA5ANLvGOEX8zUADnqaPmpWQ+ZkpLdtopwkYdcflUQDHvTgG9aLIabJhKfWniRSOZGH/AagA45xSBeccUrIpSZYzD3nf/vikxGRxMPxGKg20bfely+Y+fyJGVezp+BppjB6MDSBT6A0mMfwj8qYrrsKUH96jYPUUmPagg9lNMWgu33ox70g3Z+6fypc98H8qAF/GgM4+6zD6GlDJ6GnZTsD+dIq3mCzSj+Jvxp/2hu+D+FN8xB/Dik81f7tK3kO7XUeJgeqIfwpwGf4FA+hqMXAB4UU43LHrilZjUl1Y8IR0OPwppU5+9SeefSgTH+6KLMd4iiM+3508J2wPzqPz2HAwPwpBNIOQ2Pwosw5oom2P2T8jTWWXoAc037VMepB+opftLk8hfyqbSK5oPuKBMOozRvOfmXH40jTEjBVfqBTFKdGjDA+tOz6i5l0ZPuUjGRn607bgdM1WWOAPu2cf3amSSFBgRn8GNJrsVGV9xScdRj2NRySI424GfYUkrmXI3OPfNUzby8kXGPrTjHuTOdttRXgHJEi/jVd1fIy2fTmn+VOvR81GySbgG5JrZepyy9CSITHo5A/3quR/aUHBUj/AGqoqkw/hb8DU4huFBZXxx681Mi4Nroy4HfH7wKW/wBkUyYqeSvzehFQRCdcEkMPQkipZFmK52Jj/ZfmoskzfmbiQ4jYHcqj6VG8KHkMAPeopFnBP3x+FAeVV+YMfqK0SZzuSe6GmMgEjaR9aZnnmh3JPQZ+lJxnkn8qsyFHPHFIR/tD86VQvOck+lSJEjnk5J7KM0MErjF2FeSqn1AOanRIQh/eru/vc5p6WityY2AHUk0o+zIdpUf8CBqG+xtGLWrsMWJBz56n605o4yf9chPpg0vn2wOVXB9lpj3K5yu7PuBS1D3UMnjIj45wc5A7VTarhunbj5iO4qlIeTgcelaRv1Malug00dqaTRniqMxaKTpRmgBcCjApM0uaBBijFITRmgAxR0opKAFzRmkoFAAaUUUooAKlGMDpTVGTk0vFA0Kfamml70YJ6A0hjc+lKHbsxoKkdRikx+FMWovmNn7350bjnrSH2OaKB3AmjcR0NFIaBBmlzTaKAFoozRk0AJRS5PWl3n1oAYaKdk0hPrQAlFLmjNAhKSlooAQ0lLRQAUlFFMAooopAFLRSUAFFFFAE9FFFAxaKSloAKBmiigBeaXHvTeaXNAC4owKTNFAC0UnNFIBfxo49aT8aOKBjsj1pM0nFGKAFBpeaTFGKADmj8aXAo49qAEo/OlzRQAUUo+lFACUYpaKBCYoxThRQMTbRilo/GgBMUmKd+NGaAExRilyKKAExRilzSc0AGKMUUUAGKKMUmKADijijFFABkUZoooAM078KbmjJoAdzRzTcmigB2aM/Wm/jS5oGOzSg+1MyaXJoAdzRzTcml59aQC80hzRSZoAOaKTNLmgA5ozSUY96YDs+uaMj3plKAPWgLjsr60HHrTOKKAuP4o49qZRQFx2BS4ptLmgBaKTNH5UgFo/CjJpc0AFNp2aSgBKPx/SlooAT8aSn4FGKAGUU/FGBQA2lFLtFLtzQMMCjijbS7aBice9GB2al20m0UgFx70u0+opMD0o49KAF2nsRRsbsR+dG72oz7UD0Dy3/AMmjYw7UbjRubtmjUNBMN6UoLUoZ6dl8fdoAbu9acDnvRz/cNADH+A0hq48AnpR0pMEcFWFITjs34mkMdk+gpMkHpTN3tRu+tOwrj9x9vypRJ7Coifejiiw+Yl8xPT9aN6f3SPxqPI9BRkelFg5mTb4z3IpyuuMB/wA6r8UvFKw+cscHq360m5V/iqEEDvS7h35osPnJt6f3h+NKMHpIKhPl9g1C+X33fhSsPmJSCOj/AKUZYd8/hTR5X+3ThIqjCu4+tId0JuPpS+aw7GguD/HmkJ+tMB3nnuin6igyof8AlkAfVSabuHvmjePQUrIfM+48SKO8g+jUGRSMF5fzFRk+wpvX0/KnyoXOyQ+Xj/WOfwpwEWMiTPsRUOBRt9KLBzeRNtiPXNN2wZ+9imbDShPUUfMV/Ifsg/vkUbIj0k/WmbDS+VnuKPmO/kSCH0Yn8aXy8cZNRiA9nApwhb+8fwpfMdvId5LdjSeW470ojYH5Xb8aeqy+v60rlKPkRFXpAp9atiG5U8bh9DTWlnQ4ZiPqBS5uw/Z23uQBW9ad5T4zuX86kzKRu4PuQKQSP3VfyFFw5UR9TgPn6Cjkdqny2M7D+ApN5HY/lRcOVIiz6CnYJHSlL57GlDUBoVZY5y2FJVfpUTLMrbWnXn2qzLJKmfvEeoAqs9y2e/41auZSsiWNZF4YjHtmphjvxVeOQydQB9SanXYR1pMqPkO4/v0p3evH0pm1T0YfnQAOzn8DSK1FIboHx/wGoXafONoYeucVKxCqTuJqtLOpXAdv+AjmmkTJ26jJBJuyFYfRqYzE9d344pomdTxK34ikZi/JYFvpV2MWwBwcdqcGHo9NCP6A/jUscZ/55g/8CpsSTHxS/NgbhVkSOB6+xGagCdP3ar7g1J2x1qHqbRbQrndktEn121CyQt1CqfZsVLnHRefrTZCX+/GG980kDZTnVE+4Wz7mq5qW42b8R9KiNarY5pbjMUhpxpMVRAlNp+KTFADaKdigigBtFLijFACZpKdikxQAlKKMUuKADtQPelxRQBKG44HFBYnsPypgOKU49TSKuO3ttKg4B6jFNAJpPxpQPRv1oAUKp6kj8KXao/iB+tNwPWkC57j8aAHkL/s/gabhfelI46D8KTaaAYED1/SmnHrSkUhpiExS7SRnFJRmgBSpHUUlFLQAlFKMd80oC9yaAG0UpC9j+lJQAUlKaKBDTRSmkoAKKKKACkNFBoAKWijNACUtFHFACUUvFJQBPRRRQMKKKKAClzSUUALmjNGKKAAGjNFFABmiiigAxRRS0AJRS0UAFLSUfjQAtFJ+NFIBaWkooAWlptLQMWim0ZoAcKXim80Z96AHcUVHmjNAXJPypKZmjNFguPz9KM0yimK4/PvRmm0Uh3HZpc02kzQFx2aKbmjNAC0UlFAg/KikooGLRSUtABRRRQAUtFHFABS0lFAC0Zo4oz7UAGaKKKAF5ox70lGaBi4pNtGaMn0oANvvS7RSZpc0AJto20mTSjJoAMUmCKXJ9qM0AJQAaXPvRk+9ABg0YNLk+9H40AJg0uDS/jSfjSAXmjJ9KTj1NGPc0AO/CjIpv40cetAx1FM/GgMfWgLj6Uj3pm8+tJuPoKLBdD/xpwBqPf7Uu80BdEhDYpuDSCQ+tLvoHoGDS4PrSBhS7z2xSDQOnejPtRuPtRuPtQAbjRvPpSZPtRu9qAF3ntRvb1o3e1G4elABvb1o3mjIoJFACbqN1GB60uB6imAofB7/AJ04OD1zTdo/vCgL7iloPUdwaMCjy/cUYx3pDDaKNopcn0/WjdQFg2A96NnvS7vQ5/CkyT70BZCBM9xS7B60mP8AOaOlMQuweopQvpTMmnDPpSAcFJHFL5T/AN00gHqafgAff5pXKSGbGHUGjafQ07Hv+tGCD0/Wi47DfLb0pSrjoadn2H50DdnjFAWQz5/WlDOPenlmHXbS5OOo/KgdvMYCT1X9KXA7g1Ir4H8H1208vGBwQT/uVNylFdyHApNue9SmVR0x/wB8UguD2Vf++aLsLR6sYFPqaeA3rS+aT/cH4U0u4+6UP409QsugpDetJg+tHmSdwv4CkLuf4RRqDsLj1NKFbPtUZZ88rRvftn86LCuice/8qCAv/wCqq5Z/ek8x+9HKPnRYDn8KcjRnhyw9wM1ULmjf7Ucoe0sXCsZ4WUf8CWkER5+eM4qqJDS+ZnvS5X3GqkexbUN2kX/vqn/vOoIP/AqpK3Xk49qXkdzS5SvaFli3Vk49RTQQD91s1Ac460g3dmNHKJzJy7Dgx/8Aj1QTO+RiPHp3pwd+5pS7YqkrEuV0R+ZOfvIf++aUSOTyhH4Gl8xvpSeY2fvUyb+Y50fbvIXHqTSJtPLSIPopNOWdxzvNSi8lxjf+gqXzFpw6/wBfiQSzRRkeWXI7lhQZLRvvj8hQ8hJ5OaTdxTS0E5akMi2/JRm/EVCwX+Empm3Dq5/75poc85xj1qkZOzIfm6ZNPVWA4lUfU0v5VNGzEe3tTbEkLEXPUqQPQ1MM9sURqv8AHK34KKXYP+evFZtmyWgoDY4waQ5wS2AO9DKv8LOB/vCmOkhQ7WY/8DFCY2inN5GfkX8Qahbb2BpdhY4OQfcUmxQf9YPyrVaHK7sYcU2pvLXGdwb6HFRlcc9qZNhKMcdKKCaYCGkxS59vxp2R3X8jQAzFLTsr/c/Wg47DH40BYZig09VB6uB9c0pjH99D+NFwsRYpacybe4P0NJQAUlLSGgQoxTiR2FNCk9jSjjrQMXIoGO5oIGKAE7sR+FIYmAT1pSq9n/SnARd2NLhB92gLEfI704MTSkKfUfhTdno350AKfemkDFBBFJimIAOaMCjvRQAoHvil2e60meOtIWNADimBywpNme9NzRn3oDQcUPbn6U0qR1Boz6Gjn1oASlwcUZNGT60CEooNJQAUc0UUAFFAooAKMUUZoAMe9GOKKKACkpaSgCbNLSUtAwooooAKWkzRQAuKMUUtACAUtFFABiikxRQAtJRRQAtFJRQAtFJxS0AFFFJQAtFJRQA4GjikzRmgBaTNFFAC0UlLQAmKMUvNFACYowaWkoAMUuKKWgBMUuKKKADFGKKKQAaKKKAEopaSgBcUhpaKBiUtJijFAC0lFFAC0cUlFAC5opKKAHcetHHrTc0uaAHY96Me9No/GgB1FNyaM0DHUmaSigB2RSEj3pKKBBkUuabRQA7IoyKT8KKAFoyfWkxRQAuaM0lLQAZpM0tFACZozS4oxQA3NFOxSUAFJTvwpPwoASilooAKKOKXj0oGFLxScUvFIAzRmgAHpS7fcUDE3e1Lu9qMe4pdvvQFg/OjHvS496UfUUDsJzSc07NJmgQAE0YNJ3paBhg+lApaMCkAYFHA7UYHrRgetAChh6ClBHp+tJgetGFoHdjty+9AK+9M4pOPSiwXJDs/vH8qUbP71RgCl+UdqLDuP3IO9JvSm5X0NKCnvSC44MnY/pS71pu1T2/Wk8r2NGgakm9fQ00yD0pPLPofyoEZzwCfwo0DUN49KUPRsPoaTYfQ/lRoGoF80hY+tO8s+hoCexo0DUbuNG8+pp2yjZ7U9BWYm80u80bDSbWoHqPEpHrTxcsPQ/UVFtb0oxjqKVkO7RMbnPVFP4U3zV/uY+hqPj3owPWlZD5mTCZT1VqTzlByAw/GouB0NGQPQ0WQ+dkxuM9s/Wk8zPaouKdj6fnRZC5myQNmjj/JqPbS4A60Bdj9oPWjYh/ix+FMwKcP880DFEa/3hSGMfWjJoyTQGgeXnpRsNAx/exSlPRx+dK4WHLHIRlRkUGN/wC435UKmOfM5qQM4/5anFK5aiiLDDrQS3bBqRmb61CwYfdGPammJqwvXqKNoNA5GcH6inBW7BvyouKwwx0m2pD5o6K2PpTNzg5Kn8RRcGkJt96NvvTwXPO3I+lKGx/DRcXKREfWm7B2JFOlfYcmNue9QNPg/cIqkS7IVYzu54/CpgMCoNzsM7eKeiSkDA/ShiXkSijH40vlHvSeWQeppXRdmFIWAGaeEPZqQxmgLMhadT3/ADWoXZCOi59gRVkkL3pMqw6A0yGmZ7daD0GalmRVbv8AlUbYI9/arMmhtFFJTEPwDHkg5zwafF5W3DgZpgjbbnjH1qaGNcZf8qTKV7ilYT0x+dNMIPIJx+dOaKM9Mj6UggIPyuaVx28hohXuW/KgxDH8Q/CpRHIB98H600rJ3Cn8aLjt5EDoo6Nmm496kaJuuPypuxj0BpkMaASaUqR2NJjB5pS/pmmITOOtGaXIPWg7cdDn60gEJ9TSjH8R/SkoJoHckBUdG/MU7JPofwqGlBI6HFFgTHsfXio+KU7mOf5UgyOlANhjHWgAf3gKXPvTSM0AA60v40gFLx75+tMQGjA7nH4UAetOK4GRQAzC+tGBTiR6UnB7CgYbQehppGKUjntShMjrQIaD6igkelO2UhT3oCw2kpSCKQ0CCg0ZozQAopKWg0AJQaKUCgBKKXFLj2oAbRQRRigCWikpaADNLmkooAKKKWgYUUUlAC5oyaSigBc0uabRQApNGaKSgBc0ZpKWgBaKSigBaKKKAEpaKKACiiloASloooAKKKWgBKOaXNGaADPtRn2pM0ZpALmlpmaKYD6KZmjNAD6Tmm5ooAdS5pmaXNIBc+1H4UmaTNMLjuaMmm5pc0ALmjJpM0UgDNFJmjNMBaKM0UAFFFLSASilxRigYUUuKMCgBMCjA9aXijigBMUUtJQAtFJS0AFFGaTNAC0Yo/GkoAXml59KbmjNADvwo49KTNGaBh+dLRmlzQAUYpM/SikAuaM0mfY0fhQAuaM0mfaigBcijIpKTFMB2aN1J+NFABmjNFJQAtFJRmgB2KKbmjNAXHUuT6VHk0uTQFyTcfSl471FS0rBckwKXj3qIHFKGosO5ISPek3U3NH40Bcfk+lIT7UmTQCaADJFGTS5pc+1ADc0ZxTs+woAB7UDG5pc5p2z6fnRs+n50XCzGgUY9qUjHcGkJoAMClB9DTc0maAJA7jox/Oje/8AeP50zNLmlYLihm9TS72Hc0mRRlfegdyQSnv+lKJmHRjUW5felGPelZD5n3JhIW/iFBLDuahJX1oDY6Giw+Yf83rR83fNN30okIosK6DJ96CT70eZR5ntTATJopQw9BTty+n5UAR8+lKAfSngjsTS7vf9KQWGbT6UYPpTi59aTefWgNAGfSlyR60m73pQ2f4gKBhkn1o59/ypRz/Gv40pyO4P0NAWG5b0NJu9qUk/3aaT7UCF3fWlyMdaYSfSm/WiwXJAwHqKd5zf3z+NQ59DSZPpRYOZljzn7NS+Y/XdUAJp2TRYfMyys8mPvkUG4mIx5pqruo3mlyoftJdycs5PLZ/GkLE9XP50wMD1pwwe9FgvcXJ+tOWV0+6SM+hphX0xTcH0NGgXaJHkZ+G5+tRFcHKkqaXoaN1MTd9xo3hslsj6VKrnHINR5BPejPpRYE7EoI+n4U/Po1Vtx9aNx9aXKPnLBdgev6Um9j3qDefWjeaLBzkvWo3QEYIGKTfntQ/zrgHBp2E2is6urYTdj86azHoyDPrUxRwOhI9jTGLqeFIH51SM2iGkp7Nnr/KmZqiBc1LDyejfj0psYBIyFH41OEBPyualsqKHcU4Y9TTQGH8f6UHf6ipNBxIx0ppwfWm/Me4/Kl2n1FArkcqHHylvpUOxvQ1aPAqN8defwqkyWiEDn5gTQcf3QKM/NkMfxpM80yRSBjPFN4zT/wAqTHNACYHrRgHv+lOwB6/hRjJ7/jQFhCg4+b86Xy/R1/OngL+NOwPQUrlWISrL3/I00mpioPamNHTTE0R0dulO2nsM/jTTnvmmSJmjNLQAvcmgAzShz60fJnqcfSkOz+Et+NAC/e65NIVPoaSjcfU0AGD6UlLvPqaM560AGTRuPrSUEe9ABmjOetFJQIKMUUUAHSlpKKAClpKKAFoyaSigANFFFAEtFJRQAtFJRQAtLSUUDFooooASilooAKKKWgBKKKMUAGKWkxRQAuKDTc0ZoAcKM0lFAC5ozSUUAOzRmm0vFAC5ozSYoxQAZooxRigAooxRQAUUUUAJS0UUAFJS0uKAEopcUUAJRS4oxQAlFLRQAlLRijFABRRgUYoAWkoooAKM0UUgDJozRRQAZpc0lFAxc0ZpKKAFyPSjNJmjNAC0YpMmloAXFFJmigAopKKAHUlFFABRRRQAUUUUAFLSZo3UALSc+lGaTNAC5NGT60lFADtxo3H0FNpc0BcXPtRkehpKM0BcX86XApuaM0BcdijFNpcmgYuBRgUmTS5oAMe9GKNwoBFABijFOGKMe1ILDcUYpxFGKYWGilxS4o4pAG0etKFHqKTIpM0DH7fpRtpu6lD/AOcUBoLtpdtJv9z+FBbPrQPQXb9aTHvTc0AigQ7IpNwFHy+9GFoAN1Lv9h+VNwKDQFxd3sKXd7CmmkyaB3JNynsaTj0pmaUEigLjvwNGD70mTSgmgAx7UbT6GlDGjc3egA20YoyaN3rQAbaXZSbqNxpBoO2mjZmm7z60m4+po1HoSBDTvJOOlRbz6mkLE9STRZheJMIzSFcdxUQcjoaXex6nNFmO6H4HrRhR3NJvH90UblP8P60g0FynoaCU9DSEjsMUmfanYVw3ClDL3zSZ9qTg0BceHUetO8we9RcUfSiw+Zknmp/dpPMQ/wDLMmmZx6U4OR0AFKwcwoI7KQKUBD1yPwpN+euKN2OmfwoHcX5PWjKnvQfmPI5+lJsPpQHoOwp7il2D1WhYy3QUvlEdeKVxpPsAWMfez+GKMRer/kKYVHpSbf8AOKAv5D8r2z+NODEdCaj20FTigV2Sb/UD8qazDrtH4UzHuaMGnYLsUEHoho25HpTQpB44p4ZvQUAvMTZ70BD7Gnhh3FIcHpSCyE2HuKNn0pCWFKHbuDQFkJ5ftRsx1zSmTHajzfQU9Q0GGmSHC9M/Q1L5hqOSTAyQKZLKxZSfu/rUisndcD6U0sndaVDETggimQSKIm/hH5UpSPt+hpAkefl/Q0u0e/50ihVz2J/GpCPw+lMAApwOKRQbctntQQBQTzTWNAAy5qNo1PandabtPbFMlkbRgc8470gQ5OKcyk54P500K3XFUSIyn0H5005pxz3AFJigQgOO1ODkdqMDvmlGRyDmgY4MT/CKd+FM3H1NOzjqaQxc+1IfpSMSRx1qI7vWiwNjyP8AZNNOO4OaA5HWgtnp+tMkT5felAU9zSBvYU8H2NAB5YpDGvp+tO3DvkUm8etLUegwhR60047U8lexNN4Pc/jTEAC96Nq9jRjjqKAuaAEIX1ppqQx+9J5fuKYrEdFOKGk2mgBKKKKBBRRRQAUtJRzQAvFGKSigBcUhopKAJaKSloASilooAKWkpaAClpKKBi0maKKBC0UlFAxaWm5ozQAtGKKKADFGKKKACiiigAoopaACiiigAooooAXNFJmjNAC0YpKKAFopKM0ALRSUUALRSUUALS02loAWkozSZoAWikooAWiiigAooooAM0UlFADqKbRQA6im5ozQA6im5ozQA6kpKM0ALRSUUALmjNJRQAtLSUUALRRSUgFopKM0DFpKX8KPwoAKKQn2oH0oAKKXOO1Ln2oAbRinZpKAExRilo/CgBKMUufaloASjFLSUAFFFFAC0ZptFADqKbRmgB1ANNooHcfkUuajpaAuOzS7qZmloAXdRmgCjFABRmjAo20AJmjNLtoxQAlKCR3ooP1oAUEdxTsD6VHRmkFyQAHoaXbj0qLJo3Ggd0SgUYqPdRuNAXQ8rSYpNx9aXJPegBQBS4FNBPrThQMMUuPekoxQAuD60mD60lLQAfjSZFLkelJx6UCDIpM0vFGBQAlLSYooADRiiigBKXmijIoAMmjNLkUvy0BYQGlB9hShQetLtX1pXHZiZHpRxTto7UbG7AUXHZjKXrQVIpMGmIXAopMHvR+IoAKTNLtz3oCZ7igLMUP7UvmEdCR+NNKY6kfnTaWgXaHlz3NKJGHRjUdFOwXZL5jHq2aN5HQ/rUVFKw+ZkhdvWkEhqM0o5osK7Jd+etG70qMClIosFyTc3tRyewqPntRlqLDuPOaaSaTcaN1Ari5pQx/vGkyKUbe5oGOyT1NIfwowvrSjZ3pDG01hkdvxFSfJ2NNOM9RRcViqynPShVPpip3BB6flQFzVXJsNUYp9Jg0YNAwozRg0mDQAuTQzZGOR9DSc0mfUUBcTB6qzfjSjd3ajIpcigQ0hvakAIzx+tPzRxQFiPr3/AFppJFOc/wCz+NM4zTJF3GlDHvSbTShPegeo4HPbNLtzSqPSlNIYwr7U0rUlIRQBEV96bgipSM00pnpTJaI6Xn1pSjDtRtPpTEJk0lP2GjZ60BYbRSkDsaaRSGOBHfFL8vtTCuKSgLjzj1NBx/eqPNGaYrinPrSZozRQAGjPrSUUCFNJRRmgBePejPpRmjHtQMM+1BFHIpcmgQ2kp1IaAH0UGigAooooAWiiigAooooAWikooAWkopaACiiigYUtJRQAtFJRQAtFJS0AFFFFABRRRQAUUUUAFLSUlADs0maTNGaAFzRmkooAdmkzSUUALmlptLQAtFJRQAtFJRQAtJRRQAuaKSigBaKKKACiiigAooooAKKKKADFGKKKACilxRQAlFLRQAlLRRQAUUUUAFFFFABRRRQAUUUUhhRRSUAOpKSloAKWkpM0AOozSZozQA7Io4puaM+1ADuKOKbn2pc0ALn0ozSUUAFGaWkoAKXg0mKXaaBgQKTFHNGTQIUCjFJmjJoGLiikyaM0ALmlyKbmloAXIoBpKOlADt1G6m5ooAdkd6MA0lGaAF20mKKMUAJikp2KMUANop2fajNACc0UtLQA2lpfyo/CkMTmjmnYo+tAWEyaN1LgUbaAsw3UUFaNpoAKKaQRRzQAuaXNJk0ZoC4uRRkelJxSGgBcikzRRimIKKMUuDQAZNKGNNopDuPDkd6XeajzRRYLsk3mlLg1HRRYd2OODQRTcUYNAhaKTmloAKM0lLQAoPHQUZpKM0AFKDikzRmgB28A8qKN6k9Kbn2o4osO5JuWlyvvUYFGSKVh3JOD0IoApm4n0oyfagLkm0elJtFM3GnBvUUBoLsFBQetGVPtTSPQigAKj1puDS8jtRz2FAhOaCOOaXafSlwaAsMIyO4+lOGR3J+tOoxmgLCbqMinBQKMD1H5UDE4o+WlwPagoPX9aQDTik4pSnvTSKYhcD2pCOP/AK9HSjPtQAzJ/umkLgetPP0pjBuw/OmITzKaSM5Ao3kdhRuHpTJHBh60oYVGSKTPNA7kwOehpcmodw9KkBPcUhpjiR6UlGaTNACsM1GUOeCac27saYWdevNMTAKwPU04bh1amiTPUU4MKA0HZoxSA0A0hiEUwgVIaiI578UxMUZ7Gl+oBoAoY8dcUAIVHpTCtO3fSkzQIbSU7NJTEJQaKKBBRS4pCKAClDCkpKAH7hSZpBS4oAM0maKKAH0UUUAFFFFABRRRQAUUUUAFLRRQAUUUUAFLSUUALRRRQAUUUUAFFFFABS0lFABRRRQMKKKKBBRRRQAUUUUAFFFFAwooooAKWkpaACiijFABRRRQAUUtFACUUUtACUtFFABSUtJQAUUUUALRSUUALS02gGgB1FJmjNAC0UlFAC0UlFAC0UlFAC0UlLQAUUUUDDNFFFAgNJS0UAJRS0UgCkpaKYCUUUUgFooooGFFFFABRSUtABmjJoooASloooAM0ZpaSgApaSloAKSjNLmgBKOaKKAFoo/CigYZooooELRSUlAD+PWj8aZRQFyTj1oz71FRzQO5JwaPl96ZRQFxxxSZpKKBC0lFFABk9qXdSUUBcXNLnPem0UBcdRTc0ZoC47NKDTc0ZoHcdkUHFJmjNABiil4o4oASilwKMUAJmlzRijFAC5pM0YoxQAZFLmkxS4pDDNAJoxS/hQAmTS7jRn2oyKADJpM0vFKPbBoGJmjinAjuooyvtSCwyinblz0FG5fSmIbRSkik3UAGaKXPtRx6UAJzSc07ikoASjNGKMUCDJoBPrRg0YoGODE0U2jNAXHgGl+tR0ufegLjuPWlAX1qPNGaLDuTYA6HNJkd6jBpdxosFx+Vo3L61Hn2oz7UCuP3LSEj1ptFAXH59zSHJptGTQFxST6UgY0maXNAC5pCaTNBoADjuKaQvYU49KZg9iKBC8egpMD0pQD3FGKYBgdqWkpKQXHH6U04PY0UUwAEA9/ypC3pSmkK+hoEN4P8IpQP9n9aNvvSjI7CgBcD0oAwOKTn0pPwNAx/NIRxzSZHqaT/AIFQAppDjvRg0dO2KAEwuKQgUufWkJHrQIacUnFKR70c0xCGij60lAhelGfWjPpRQAoxRgGkpd3rQMXbRtoFL2oAYeKKUim0CHUtJS0AFFFFABRRRQAUUUUAFFFFACiiiigAooooAKWkooAWiikoAWikpaACiikoAKWkooAWikpaACiiigAooooAKKKKACiiigAopKKAHZopKKBi0UlKKACiiigApcUUZoAKMUUZoAKSg0UAFFGaKACiiigAopKKAFooFFAC0UmaKAFooooAKKSloAKKM0UAFFFFIApaSimAtFJRQAtFJRmkAtFJmigBaKKKBhS0lFAC0lFFABiiikoAWiiigAooooAKKSloEFFFFABRSUUALSUUUDF5o5pKWgBeaM0lFABmlzSUUAGaWij8KADFJS5o60AGKMUlLigAxSYpaT8aADFFFFABRRRQAUUUUAFFFFABS0lFADqSkooAdS0yloGOo/CkyaM0AL+FGaM0cUAGaOaKXFACc0ZpcUmKADNFJRmgBaKTNFAC0ZpKKAHZoDYptFAXHZFLxTKKQXHcUcU2igLjuKKbRTC47ig+xptLmkFxc0U3NL+FAxefWjmkooAU5pKXmjJz2/KgBKMU/cP7oozn+EUBYZiinf8AARTc47UBYMUYpdwpcg0ANowaXNGaAsJzRmlzRmgApCKOKQj0oEBFGKMe9JQAuKQ0c0nNMBcGkA5pc0mTQA6jJpM0uaACk4paSkAYpKWjFMBKKXFIaAENFHUUUCEzS5oxRQAhz2o57rS8UUAA9qM0UEUAIaYwp31NHFAEf0opxxScUxCUUYooAPwopQKMUCEopdtAFAAKWkxR+FAwJpppaKBDqKSloAKKKKACiiigBKWkpaACiiigApaSigBaKKKACiiigAopaSgAooooAKKKKACiiigAooooAKKKKAFopKKAFpKKKACiiloASilooASloooAKKKKACiiigAooooAKKKKACiiigYUtJS4oAKKKKAEopaKAEopaSgBaKSloAKKKKACloooAKKKSgBaKTNFAC0UlFAC0UUUAFFFFACUUtJQAtGaSigBc0UlLQAUZoopALRmkooAKKKKACiiimAUUUUAFFLSUAFFFFABRRRQAUZoNFABmjNFJQAuaTNFFAC5ozSUCgBc0ZpKKAHZozSUUgDNFFFAxaM0UUAGaM0UlAC0UUUAFFFGaACijNFABmjNFFABmlzSUUALmikooAdxRSCjNAx1FNzS5oAdmim5ooAWjApKKAFoxSYPrRzQAYopeaMUAFJQaMUALScUUYoAWikxRQAtFJRQAtHFNzSk+1ABxQCKTNFADgRSk02jNADs0maSkoC47NITSYoxQFxd5o3eopKSgLsfuHYUZBplLRYLj8UlNzRmkFx+aTNJn3pOtADsikzSYo49aYC5pKKSgBc0maKM0AGaM0UhoELmjNNooAduozTaKAuOzS5pmaXNADs0hJ+tJmjNAADz0NLSZpaADFFJRQAUlLRQAlFLQaAEpKWkoAaRSFeKcaTJpiG0UpNJQIOlOBpuaM0DH5FFMyTTgaAFoxRmigBpFIRTqM0AFFJS0CCiiigAooooAKKKKACiiigAooooAKKKKAFFFJRQAtFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRS0UAFFFJQAtFJRQAtFJS0AFFFFABRRRQAUUUlAC0UlFAwpRSUtAC0UmaXNABRRRQAUUUUAJRRRQAUUUUALRSUtABRSUUALRSUUALRRRQAUZooBoAM0uaSigBaKSigAooooAKKKKACiiigANFFAoAKKKKAFopKKAFopKM0ALRSUtABRRRQAUUUlAC0UUZoAKSiikAUUuaM0wCkpc0ZoASlxRmkzQAtFJmlzSAKKSimAtFJS0AFFFFAC0lFFABS0lLSAKKSigYtFJS5oAKKTNLQAUUYpKAFopMUUALmiijFABRRRQAtFJQKAFpabRQA7NGabS8UDFzRmkyKKAFzRSUlADqKTNGaAFzRmkooAWikooAXNFFJQAUUUZoAXNGaSigBaCKM0uaAG4opd3tR1oASjFLijFAhMUUtFACUlLikIoAKSlpKAFyaM0lFAC5opKWgAoox70UDCiiigQlGKdSZ9qAExRilzRQAlJS0lABRRSUALRmkooELmjNJRQAuaM0lFAC0UlJzTAUmikooAU00mlzSUAIcUlOxSYoEJgetGKXFGB6UDExS4560tFABQaOKOKADNGaQikIoAWloFFAgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKM0UALRSUUALRRRQAUUtFAxKKKKBBRRRQAUUtJQMWiikoAKKKKBBRRRQAUUUUALRSUUALRRRQAUlLRQAUUUUAFJS0UAJS0lFAC0tNpaBi0lGaKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAXNGabRQA6ikooAWikooAKKKWgAooooAKSlpMUALRSUtABRSUUALRSUUALmjNJRQAtFJRQAtFFFACUtJRQAtFJRQAtFJRQAtFJS0AJRS0UAFFFFABRRRQAUUUUAFFFFABRRRQAUtJRQAtFJRQAtGKSlFIApaTNGaBi0YpKKAFopMmjNAC5ozSUZoAXNFJkUUALSUtFACUtFJQAUUUUALSUtFABRRmigAooooAXNGabRmgB2aSkooAdRSZpKAHcUZFNpKAH5FFNooAdRk0lGaADNGfSjPtRmgAyaKN1GaACikzRmgAoopKAHCim0UALRSUUALS8U2loADRRSUALmlzSUlAC0UmaM0ALmkzRmjigAoopKAFxRSfhS5oEJS0ZFGaAEozS0mKYBmijFGKAEopaSgBKKGFJkjrQAuaSkzRmgQ6ikzRmgBaKTNKKBhRRRQAlIaU0hoAdRRRQIKKKKACiiigAooooAKKSigBaKKKACiiigAooooAKSiigApaKSgBaWkooAWikooAWiiigAooooAM0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUALRSUUALSUUUAFFFFABRRSUALRRRQAUUUUALRSUtABRRRQMKKKKACiiigAooooEFFFJQMWikpaACiiigQlFLRQAUlLSUDFopKWgQUUUUAFFFFAwpaSigBaSiigQUUUlAxaKKKACiiigAooooAWikpaACiikoAWiiigApKKKACiiigBaKKSgAooooAWkoooAWikooAWiiigAoopKAFopKWgAooooAKKKKACilooASilxSUAFFLSUAFFFFIApaSigBaX8abRQMdmkzSUUBcdxRxSUUALRSUUALSUUUwCiiigQUUlFIBaKSlpgFFFFABRSUUALS4ptLSGGKKKKACiiigAoopKBBRRRQAUUUUALRSUZoAWkoooAWkoooAM0UUYpgFJS4oxSASilopgJRRRQAUUUUAFLmkooAWkoooAWkoNJQAtFJS0ABpKWigBKTFLRQA0ikpxpDQISjFKKKADFLikooGLRSUtACUUGigQtFFFABSUtJQAtFJS0AFJS0lABRRRQAUUtFACUtFFABSUtJQAUUtFACUUtFABRRRQAUUUUAFLSUUALRSUUALRRRQAlFFFABS0lLQAUtJRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAlLRRQAUUUUAFFFFABRRRQAtFJS0AFFFFAwooooEFFFFABSUtFACUUUUDFooooAKKKKACkpaKAEopaSgAopaKBCUUtJQAUUtFABRRRQAlFFFABS0lLQMKKKKACjFFFABS0maM0ALRSUtABSUUtACUUtFACUUtFACUUUUAFFJRQAtFFFABRRS0AJS0UlABRRRQAUUUUAFFFFAC0UlFAC0tJRQAtJRRQAtJRRQAUUUUAFFFFABS0lLQAUlLRQACikopALRSUUDFzRmkooAWikpaAEoxS0lABRRS0CEpaSlpgJRRRQAlLRRQAUZoooAM0uabRQFxaWm5ooAWiiikAUUUUAIaKWkoAKWkozTAWkpc0UAFFJRQAtGaSloAKSlpKACiiigAopKWgApKWkoAWikooAWkooJoAKKKSgBaTNFFABmikooAM0Z9qKKBC0UUUDEoxS0hoAKKKKBBSUUUALRRRQAUUtJQAUUUUAFFFFABRRRQAUtJRQAtHaiigAooooAKKKKACiiigAoopKAFooooAKKKKACiiigAooooAKKKKAClpKKACgUUUALRSUUALRSUUALRSUtABRSUtABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAtJRRQAtFJRQMWikooELSUUUAFLSUUAFLRSUAFLSUtAwopKWgQUlFFAxaKKKACikooAWlpKKACikpaACiiigApKWkoAKWiigBKWiigBKKWkoAKWkooAWiiigAooooAKWkooAKMUUUAJRS0UAFFFFABS0lFABRS0lABRRRQAUUtJQAUUUUAFFFFAC0UmaKAFooooAKKKSgBaKSigBaKKKACiiigAooooAKKKSgBaKKKACiikoAWgUlFAC0UlLQAtJRRQAtJRRSAKKSimAtFJRQAtFJS0ABpKKKACkpaKAEpaSjvQAtLTaKAFooooAKKDRQAUUUUAFFFFABRSUUALmkoooAKKKSgBaWkooAU0lFFABRRxSUALRQKKACiikoAWkoooASig0UCEooNFAC0UlFAC0tJRQAppKKKBiUlLRQIWiiimAUUUUgCiiigAooooAKWkooAKKKKAClpKKAFooooAKKSigBaSlpKAFpKKWgAooooAKKKKACiiigAooooAKKKBQAUUUUAFFFFAAaKKKACiiigAooooAKWkooAWiiigAoopKAFopKKAFooooASilooAKKKSgBaKSloAKKKSgBaKSloAKKKKAEpaKKACiiigAooooAKKKKACiiigApaSigBaKKSgAooooAKKKKACiiigAooooAKKKKAClpKWgYUUUlABRS0lABRS0lABS0lFAC0lFBoAKKSloELRSUUDFopKKBC0UUUDCiiigQUUUUDCikooAWiiigAoopKAFopKWgAooooAKWkooAKKKKACiiigAooooAKKKKAFopBRQAUUUUALSUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUlLQAUUUUAFFFFABS5ptFADqSkpaACkpaKAEopaKACiiigBKWkxRQAUUUUALRSZooAWikzRmgAoooNABSGlooASiiigAooooEFFJS0AFFFFAwooooAKSjNFABikpaKBCUUUtACUtFFACUUUUAFLSUUALRSUUALRRRTAKKKKQBRRRQAUUUUAFFFFAC0UlFAC0UlLQAUlLRQAlLRRQAUUUlABS0UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUALRRRQAUUGkoAWkoooAWkoooAKBRRQAtBopKAClpKWgAooooAKKKKADvRRRQAUUUUAFLSUUALRSUUAFFFFABS0UlABRRRQAUUUUAFAoooAKKKKACiiigAooooAKWkooAWkooNABRRRQAlFLRQAUUUUAFFFFAC0lFFABS0lFAC0lFFABRRRQAUUUUAFFFFABRRRQAUUUUDFopKKBC0UlFAxaKKSgBaKSloAKKSloAKKKKACiiigAooooAKKKKACiiigAooooAKKKSgBaKSloASloooAKSiigBaKSigAooooEFFFFAwooooAKWkozQAtJRRQAUUUUAFFFFAgpKWkoGFFFFAhaKSigYtFJS0AFFFFABSUtFACUUtJQISilooAKSiigAooooAKKKKACkpaSgAopaKAEpaKKAEopaKAEooNJQA6iikoAWkoopgLRRRSAKKKKACiiigAooooAKKKKAFopKKACiiigBaSiigAooooAWikooAWikooAKBRRQAtFJRQAtFJRQAtFJS0AFFJRQAtFFJQAtFFJQAtJRRQAtFJRQAtFJRQAtFJS0AFFJRQAtFJRQAtLSUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFGaKKACiiigBaKSigBaKSloAKKKKACikpaAEpaSloAKKKKACiiigAoopKAFopKWgAooooAKKKKACiikoAWikooAWikooAWikpaACikpaACiiigAopKKAFoozRQAUUUlAC0UlFAC0UUUAFFFFABRRRQAUUUUAFFFLQAlFFFABRRRQAUUlLQAUUUUDCiiigQUUUUAFFFFABRRSUALRRRQAUUUlADqSkpaBi0lJmloAKKSloEFLSUUDCiiigQtJRRQMKKKKBBRRRQAUlLRQAlLRSUALRSUUALRSUUDFopKKAFpKKKBBRS0lABRRRQAUUUlAC0UmaWgAoozRQAUUUUAFFFJQAUUUUAFFFJQAtFFFABSUtJQAUtJS0AFFFJQAtFJRQAGkpaKAFpKKKACiiigBaKKKYBRRRSAKKKKACiiigAooooAKKKKYBSUUUgA0tFFABRRRQAUUUUAFFFFABQKKKACkoooAWgUUUAFLRRQAlAoooAKKKKACiiigAooooAKDRRQAUUUUALSUUUABooooAKKKKACloooATvS0UUAHaiiigBKWiigAooooASloooAKKKKACkoooAKWiigAooooAKKKKAFpKKKACiiigAoFFFACmjtRRQAUUUUAJRRRQAUUUUAFLRRQAUlFFABRRRQAUUUUAJS0UUAAooooAKO9FFAC0UUUAJSUUUALRRRQAUUUUAJSiiigBaTvRRQAtFFFABRRRQAUUUUAAooooAWkoooADRRRQAlFFFABRRRQAtFFFABRRRQAUUUUAJRRRQAtFFFAwooooEJQKKKBhSCiigQtFFFABS0UUAFFFFAwpKKKAFooooEFJRRQAUtFFABRRRQAlFFFABRRRQAUUUUAFFFFAC0neiigANFFFACUd6KKACiiigApaKKACg0UUAJRRRQAUUUUAJ3paKKACkoooAWkoooAKKKKAA0UUUAJQKKKAFooopgf/Z";

const BGS = [
  { id: "embersky", label: "Ember Sunset",
    css: "radial-gradient(ellipse 60% 22% at 62% 78%, rgba(255,120,50,.35), transparent 70%), linear-gradient(180deg,#070404 0%,#0d0605 48%,#25100a 66%,#57200f 78%,#7a2f12 84%,#1a0c08 92%,#070404 100%)" },
  { id: "topo", label: "Night Topo",
    css: "repeating-radial-gradient(circle at 28% 42%, rgba(255,90,50,.06) 0 1px, transparent 1px 42px), repeating-radial-gradient(circle at 72% 30%, rgba(255,140,60,.05) 0 1px, transparent 1px 56px), radial-gradient(ellipse 70% 45% at 50% 30%, rgba(120,40,20,.25), transparent 70%), #060303" },
  { id: "glacier", label: "Brass Lantern",
    css: "radial-gradient(ellipse 70% 40% at 50% 70%, rgba(201,168,106,.18), transparent 70%), linear-gradient(180deg,#0b0806 0%,#1a1108 55%,#140d06 78%,#0a0604 100%)" },
  { id: "aurora", label: "Foundry Smoke",
    css: "radial-gradient(1.5px 1.5px at 20% 25%, rgba(255,196,128,.45), transparent 2px), radial-gradient(1.5px 1.5px at 65% 15%, rgba(255,178,102,.38), transparent 2px), radial-gradient(2px 2px at 85% 35%, rgba(255,208,148,.4), transparent 2.5px), radial-gradient(ellipse 60% 35% at 50% 60%, rgba(176,113,79,.24), transparent 70%), linear-gradient(180deg,#0c0806 0%,#1b120b 55%,#0d0806 100%)" },
];

/* ---------- DEMO DATA (shown until SYNC) ---------- */

const DEMO = {
  voicemails: [
    { from: "(701) 555-0142", line: "Pontoon", time: "8:41 PM", note: "", vm: "Looking at a 3-day pontoon rental for the weekend of the 18th — what's still open?" },
    { from: "(218) 555-0977", line: "Fishing", time: "6:12 PM", note: "Missed — no voicemail left.", vm: "" },
  ],
  emails: [
    { from: "FareHarbor", time: "9:03 PM", subject: "New booking — Open Water Guided · Jul 14 · party of 4" },
    { from: "Fair Hills Resort", time: "4:30 PM", subject: "Newsletter feature confirmed — FAIRHILLS06 in August issue" },
    { from: "Tech Camp parent", time: "2:14 PM", subject: "Can we switch from AM to PM session on Aug 3?" },
  ],
  events: [
    { time: "6:00 AM", title: "Guided Trip · Detroit Lake", detail: "4 GUESTS" },
    { time: "2:00 PM", title: "Pontoon turnover", detail: "SLIP 3" },
  ],
};

/* ---------- CLAUDE API HELPERS ---------- */

/* Where Ember sends its Claude traffic.
   Unset  → calls the Anthropic API direct. That only works inside a Claude artifact,
            where the platform injects credentials.
   Hosted → set window.EMBER_API_PROXY to a server-side proxy that holds the key.
            See docs/DEPLOY.md. Never put an API key in this file — it ships to the browser. */
const BUILD_STAMP = "__EMBER_BUILD__".startsWith("__") ? "dev" : "__EMBER_BUILD__";

const ANTHROPIC_DIRECT = "https://api.anthropic.com/v1/messages";
const API_ENDPOINT =
  (typeof window !== "undefined" && window.EMBER_API_PROXY) || ANTHROPIC_DIRECT;
const USING_PROXY = API_ENDPOINT !== ANTHROPIC_DIRECT;

const NO_PROXY_HINT =
  "Ember has no brain here. Hosted builds need a key-holding proxy — set window.EMBER_API_PROXY (docs/DEPLOY.md).";

async function callClaude(messages, { useTools = true, model = DEFAULT_MODEL, servers, maxTokens } = {}) {
  const body = { model, max_tokens: maxTokens || 1000, messages };
  if (useTools) body.mcp_servers = servers || MCP_SERVERS;
  let res;
  try {
    res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Network-level failure: CORS rejection hosted, or the proxy is down.
    throw new Error(
      USING_PROXY
        ? "Can't reach the Ember proxy. Check it's deployed and its CORS allows this origin."
        : NO_PROXY_HINT
    );
  }
  if (!res.ok) {
    if (!USING_PROXY && (res.status === 401 || res.status === 403)) {
      throw new Error(`API ${res.status} — no credentials. ${NO_PROXY_HINT}`);
    }
    throw new Error(`API ${res.status}`);
  }
  return res.json();
}

function extractText(data) {
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/g, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

/* HEIC/HEIF → JPEG before anything else touches the file. iPhones hand out HEIC by
   default and <img> can't decode it outside Safari, so a raw HEIC would fail the canvas
   step below. When the heic2any decoder is present (bundled into the generated shells),
   convert; when it isn't (offline, or the Claude artifact sandbox where external scripts
   are blocked) fall through — Safari decodes HEIC natively, and everything else lands in
   the caller's catch with a friendly message. */
async function maybeConvertHeic(file) {
  const name = file.name || "";
  const isHeic = /image\/(heic|heif)/i.test(file.type) || (/\.(heic|heif)$/i.test(name) && !/^image\/(jpe?g|png|webp)/i.test(file.type));
  if (!isHeic) return file;
  if (typeof window !== "undefined" && typeof window.heic2any === "function") {
    try {
      const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const blob = Array.isArray(out) ? out[0] : out;
      const jpgName = name.replace(/\.(heic|heif)$/i, "") + ".jpg" || "photo.jpg";
      return new File([blob], jpgName, { type: "image/jpeg" });
    } catch (e) {
      /* decoder failed — let the native path try, then the caller's catch */
    }
  }
  return file;
}

// One carousel is at most six slides — Instagram's own limit, and the standalone tool's.
const MAX_PHOTOS = 6;

/* Two renders per photo, deliberately different sizes.

   VISION (<=1280, q0.85) is what the model reads. Every extra pixel is billed on each of
   the two calls per photo (scan + caption) and buys no accuracy at this task, so it stays
   small.

   PUBLISH (<=1440, q0.92) is what actually leaves for the Drive outbox and eventually
   Instagram. 1440px wide is Instagram's ingest ceiling — it downscales anything larger
   anyway — and doing it here in the browser is also what keeps a six-photo carousel under
   the Apps Script payload limit and converts iPhone HEIC to JPEG on the way through. */
async function drawToJpeg(img, MAX, quality) {
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

/* Single-render resize — used by the background-image picker, which wants one big frame
   and has nothing to do with the caption pipeline's vision/publish split. */
async function fileToResizedB64(file, MAX = 1440, quality = 0.85) {
  file = await maybeConvertHeic(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const dataUrl = await drawToJpeg(img, MAX, quality);
    return { b64: dataUrl.split(",")[1], preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderPhoto(file) {
  file = await maybeConvertHeic(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const visionUrl = await drawToJpeg(img, 1280, 0.85);
    const publishUrl = await drawToJpeg(img, 1440, 0.92);
    return {
      b64: visionUrl.split(",")[1],        // what the model reads
      publishB64: publishUrl.split(",")[1], // what gets posted
      preview: visionUrl,
      // Natural dimensions, kept for the feed-aspect guard. Only the ratio is read.
      w: img.width,
      h: img.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Story/vertical render: 1080x1920. The photo sits contained in the frame over a
   blurred, zoomed copy of itself — the standard story treatment, and it means a
   landscape fish photo still fills the screen instead of floating on black. */
async function renderStoryFromB64(b64) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = "data:image/jpeg;base64," + b64;
  });
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const cover = Math.max(W / img.width, H / img.height);
  ctx.filter = "blur(36px)";
  ctx.drawImage(img, (W - img.width * cover) / 2, (H - img.height * cover) / 2, img.width * cover, img.height * cover);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(0,0,0,.22)"; // settle the blur so the photo pops
  ctx.fillRect(0, 0, W, H);
  const fit = Math.min(W / img.width, H / img.height, 1.6);
  const fw = img.width * fit, fh = img.height * fit;
  ctx.drawImage(img, (W - fw) / 2, (H - fh) / 2, fw, fh);
  return c.toDataURL("image/jpeg", 0.92).split(",")[1];
}

/* Instagram's feed ceiling for portrait photos is 4:5. Anything taller — including a
   plain uncropped 3:4 phone vertical — gets machine-cropped or rejected by Meta at
   publish time, hours later, with nobody watching the Zap. So the app flags it while
   Brady is still looking at the screen. 1.26 instead of 1.25 exact so a true 4:5 crop
   that picked up a rounding pixel isn't nagged. Stories are exempt: 9:16 is their
   native shape. */
const FEED_MAX_HW = 1.26;
const tallForFeed = (p) => !!p && p.w > 0 && p.h / p.w > FEED_MAX_HW;

/* Center-crop a photo's PUBLISH render to 4:5 for the feed. The pre-crop render is
   kept on the photo as storyB64 so a story still gets the full tall frame — the crop
   changes only what feed surfaces see. The vision render is left alone; the model
   captions the composition either way. Center crop on purpose: the fish is framed
   mid-shot or Brady recrops in Snapseed, whose eye outranks any slider here. */
async function cropPublishTo45(p) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = "data:image/jpeg;base64," + (p.publishB64 || p.b64);
  });
  const w = img.width;
  const targetH = Math.round(w * 1.25);
  const sy = Math.max(0, Math.round((img.height - targetH) / 2));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = targetH;
  c.getContext("2d").drawImage(img, 0, sy, w, targetH, 0, 0, w, targetH);
  const dataUrl = c.toDataURL("image/jpeg", 0.92);
  return {
    ...p,
    storyB64: p.storyB64 || p.publishB64 || p.b64,
    publishB64: dataUrl.split(",")[1],
    preview: dataUrl,
    w,
    h: targetH,
    cropped45: true,
  };
}

/* Where a post can go. Feed surfaces consume the caption; story surfaces consume
   the 9:16 renders and no caption body. Video-only surfaces stay visible but
   disabled until the video pipeline exists — an honest grey beats a dead toggle. */
const SURFACES = [
  { id: "ig_feed",  label: "IG FEED",  needsVideo: false },
  { id: "fb_page",  label: "FB PAGE",  needsVideo: false },
  { id: "ig_story", label: "IG STORY", needsVideo: false },
  { id: "fb_story", label: "FB STORY", needsVideo: false },
  { id: "ig_reel",  label: "REEL",     needsVideo: true },
  { id: "tiktok",   label: "TIKTOK",   needsVideo: true },
];

function sanitizeCaption(t) {
  return t
    .replace(/```/g, "")
    .replace(new RegExp(LOCKED_TAG, "gi"), "")
    .replace(/scheels(\s+rods?)?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Brady's rule, verbatim: "5 max total, counting #getyourbassingear." The locked tag is
   appended at copy/publish time and always occupies one of the five, so the caption body
   gets a budget of four.

   The prompt already asks the model for at most three, but a prompt is a request, not a
   guarantee — this is the enforcement. Extras are trimmed from the END (keeping the ones
   written first, which are the species tags that matter) and the count is REPORTED rather
   than silently dropped, so nothing disappears without Brady seeing it. @mentions are not
   hashtags and never count toward the five. Mirrors capHashtags() in the standalone tool. */
const MAX_HASHTAGS = 5;

function capCaptionTags(text) {
  const budget = MAX_HASHTAGS - 1; // the locked tag holds one slot
  let seen = 0;
  let dropped = 0;
  const out = text.replace(/#[\w]+/g, (tag) => {
    seen += 1;
    if (seen <= budget) return tag;
    dropped += 1;
    return "";
  });
  return {
    text: dropped ? out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : text,
    total: Math.min(seen, budget) + 1, // +1 for the locked tag
    dropped,
  };
}

/* The finished post text. `withHandles: false` is the auto-post form — sponsor handles
   ride as on-photo Instagram tags there, so repeating them in the caption would tag
   everyone twice. Copy-to-clipboard uses the handles-inline form. */
function assembleCaption(caption, sponsors, { withHandles = true } = {}) {
  const capped = capCaptionTags(sanitizeCaption(caption));
  const lines = [capped.text, "", LOCKED_TAG];
  if (withHandles) {
    const handles = activeHandles(sponsors);
    if (handles.length) lines.push(handles.join(" "));
  }
  return { text: lines.join("\n").trim(), total: capped.total, dropped: capped.dropped };
}

/* ---------- LOCAL PERSISTENCE ----------
   window.storage is the Claude-artifact key/value store and is the app's primary
   persistence. It's absent everywhere else (local preview, the hosted deploy), where its
   calls silently no-op. These helpers add a plain-localStorage layer for state that must
   actually survive a reload OUTSIDE the artifact — the caption draft that has to outlive a
   dropped lake connection, the outbox URL, and Mission Control's numbers. Every call is
   wrapped so a disabled/full/again-absent store can never throw into a render. */
function lsGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { window.localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { return false; }
}
function lsDel(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

const OUTBOX_URL_KEY = "ember-outbox-url";

/* The deployed Drive-outbox endpoint, baked in so a fresh browser, a wiped phone, or a
   cleared cache just works — localStorage alone meant re-pasting this by hand on every
   device and after every "clear browsing data".

   Safe to keep here: this repo is private, and the built page is served behind Cloudflare
   Access gated to Brady's own two emails, so the URL isn't publicly readable either way.
   It also isn't a credential — the worst it grants is writing files into that one private
   Drive folder.

   The in-app field still overrides it (localStorage wins), which is the escape hatch if
   the deployment ever mints a new URL before this constant is updated. */
const DEFAULT_OUTBOX_URL =
  "https://script.google.com/macros/s/AKfycby-xcjTOM4tabBgVc-Jpy66_B8kpgROT86Z7J8Qz3wx5DRI94W_tySk3HzexCv9g6VE/exec";
const CAPTION_DRAFT_KEY = "ember-caption-draft";

/* ---------- GOOGLE DRIVE ICON ---------- */

// The artifact iframe can't prompt for mic permission — a top-level popup can.
// This builds a tiny Ember-styled bridge window that owns the microphone and
// posts transcripts + live levels back to the app.
function buildBridgeHtml() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>EMBER MIC</title><style>'
    + 'body{margin:0;background:#0d0807;color:#f5ece8;font-family:-apple-system,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:14px}'
    + 'h1{font-size:12px;letter-spacing:.3em;color:#ff9e3d;margin:0}'
    + '#st{font-size:11px;letter-spacing:.2em;color:#a08a82}'
    + '#bar{width:240px;height:10px;border:1px solid rgba(255,120,60,.4);border-radius:6px;overflow:hidden}'
    + '#fill{height:100%;width:0%;background:linear-gradient(90deg,#ff4d3d,#ff9e3d)}'
    + 'button{background:linear-gradient(90deg,#ff4d3d,#ff6a4d);color:#fff;border:none;border-radius:10px;padding:12px 22px;font-weight:800;letter-spacing:.06em;cursor:pointer;font-size:13px}'
    + '.note{font-size:10px;color:#5a4a44;max-width:280px;text-align:center;line-height:1.5}'
    + '</style></head><body>'
    + '<h1>EMBER MIC BRIDGE</h1><div id="st">STARTING…</div>'
    + '<div id="bar"><div id="fill"></div></div>'
    + '<button id="btn">Stop Listening</button>'
    + '<div class="note">Keep this little window open — it feeds your voice to Ember. Close it to end voice input.</div>'
    + '<scr' + 'ipt>\n'
    + 'var P=window.opener;var active=false;var rec=null;var an=null;var data=null;var frame=0;var sayBusy=false;var extBusy=false;\n'
    + 'function post(m){try{P&&P.postMessage(Object.assign({ch:"EMBERMIC"},m),"*");}catch(e){}}\n'
    + 'function setSt(s){document.getElementById("st").textContent=s;}\n'
    + 'function canHear(){return active&&!sayBusy&&!extBusy;}\n'
    // start() throws if recognition is already running (harmless) or if the mic
    // is genuinely unavailable (not harmless). Swallowing both and claiming
    // LISTENING regardless meant a dead mic looked identical to a live one.
    + 'function regain(){if(canHear()){if(!rec){setSt("NO SPEECH SUPPORT - USE CHROME");return;}try{rec.start();setSt("LISTENING");}catch(e){setSt(/already/i.test(String(e&&e.message))?"LISTENING":"MIC UNAVAILABLE - TAP START");}}else if(extBusy||sayBusy){setSt("MUTED - EMBER SPEAKING");}else{setSt("PAUSED");}}\n'
    + 'function startSR(){var SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setSt("NO SPEECH SUPPORT - USE CHROME");return;}\n'
    + 'rec=new SR();rec.lang="en-US";rec.continuous=true;rec.interimResults=false;\n'
    + 'rec.onresult=function(e){for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal){post({t:"transcript",text:e.results[i][0].transcript.trim()});}}};\n'
    + 'rec.onend=function(){if(canHear()){try{rec.start();}catch(e){}}};\n'
    + 'rec.onerror=function(ev){if(ev.error==="not-allowed"){active=false;setSt("MIC BLOCKED - ALLOW AND RETRY");post({t:"listening",on:false});}};\n'
    + 'active=true;post({t:"listening",on:true});document.getElementById("btn").textContent="Stop Listening";regain();}\n'
    + 'function stopSR(){active=false;try{rec&&rec.stop();}catch(e){}setSt("PAUSED");post({t:"listening",on:false});document.getElementById("btn").textContent="Start Listening";}\n'
    + 'document.getElementById("btn").onclick=function(){active?stopSR():startSR();};\n'
    + 'navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){\n'
    + 'var C=window.AudioContext||window.webkitAudioContext;var ctx=new C();an=ctx.createAnalyser();an.fftSize=256;ctx.createMediaStreamSource(s).connect(an);data=new Uint8Array(an.fftSize);\n'
    + 'function loop(){if(an){an.getByteTimeDomainData(data);var sum=0;for(var i=0;i<data.length;i++){var d=(data[i]-128)/128;sum+=d*d;}var v=Math.min(1,Math.sqrt(sum/data.length)*4);\n'
    + 'document.getElementById("fill").style.width=(v*100)+"%";\n'
    + 'if(frame++%2===0){var w=[];for(var k=0;k<64;k++){w.push(data[Math.floor(k*data.length/64)]);}post({t:"lvl",v:v,w:w});}}\n'
    + 'requestAnimationFrame(loop);}loop();startSR();\n'
    + '}).catch(function(){setSt("MIC PERMISSION DENIED");});\n'
    + 'function pickV(){var vs=window.speechSynthesis?window.speechSynthesis.getVoices():[];var en=vs.filter(function(v){return v.lang&&v.lang.indexOf("en")===0;});function sc(v){var s=0;if(v.localService)s+=100;if(/premium|enhanced|natural|neural/i.test(v.name))s+=40;if(/samantha|alex|aria|zira|david|daniel|karen/i.test(v.name))s+=25;if(v.lang==="en-US")s+=10;return s;}en.sort(function(a,b){return sc(b)-sc(a);});return en[0]||null;}\n'
    + 'if(window.speechSynthesis){window.speechSynthesis.onvoiceschanged=function(){};window.speechSynthesis.getVoices();}\n'
    // A superseded utterance never posts 'speaking on' (a late start would otherwise
    // latch the gate shut, since its end is suppressed) and never calls cancel() --
    // cancel() is queue-wide, so it would silence the utterance that replaced it.
    // sayGen retires a scheduled utterance: stopSay used to cancel the engine
    // but not the pending 700ms go(), so she would start reading an answer that
    // had already been stopped. It also makes go() one-shot — the timer and
    // onvoiceschanged could both fire, and the second go()'s cancel() ran the
    // first one's fin(), reopening the mic mid-sentence.
    + 'var sayGen=0;\n'
    + 'function say(text){if(!window.speechSynthesis)return;var synth=window.speechSynthesis;var gen=++sayGen;var ran=false;\n'
    + 'function go(){if(ran||gen!==sayGen)return;ran=true;synth.cancel();synth.resume();sayBusy=true;try{rec&&rec.abort();}catch(e){}\n'
    + 'var u=new SpeechSynthesisUtterance(text);var v=pickV();if(v){u.voice=v;u.lang=v.lang;}u.rate=1.03;\n'
    + 'var done=false;function fin(){if(done)return;done=true;if(gen===sayGen)sayBusy=false;post({t:"speaking",on:false,src:"bridge"});regain();}\n'
    // If the swallow-watchdog already gave up on this utterance, a late start is
    // the engine talking over whatever replaced it — and its onend would be
    // suppressed by done, so the main window would never hear "speaking off"
    // and would drop every spoken command from then on. Kill it instead.
    + 'u.onstart=function(){if(done||gen!==sayGen)return;started=true;post({t:"speaking",on:true});setSt("SPEAKING");};\n'
    + 'u.onend=fin;u.onerror=fin;\n'
    // Chrome silently swallows an utterance queued in the same tick as cancel().
    // The main window already defers for this reason; the bridge did not, and a
    // swallowed utterance fires no event at all, so sayBusy stuck true and
    // canHear() could never be satisfied again — mic dead, UI still LISTENING.
    + 'var started=false;setTimeout(function(){if(gen!==sayGen)return;try{synth.speak(u);}catch(e){fin();return;}\n'
    + 'setTimeout(function(){if(!started&&!done&&gen===sayGen)fin();},2500);},80);}\n'
    + 'if(synth.getVoices().length){go();}else{var tv=setTimeout(go,700);synth.onvoiceschanged=function(){clearTimeout(tv);synth.onvoiceschanged=null;go();};}}\n'
    + 'function killSay(){sayGen++;try{window.speechSynthesis.cancel();}catch(e){}sayBusy=false;post({t:"speaking",on:false,src:"bridge"});regain();}\n'
    + 'window.addEventListener("message",function(e){var m=e.data||{};if(m.ch!=="EMBERMIC")return;if(m.t==="toggle"){active?stopSR():startSR();}if(m.t==="micOff"){if(active){stopSR();}}if(m.t==="say"&&m.text){say(m.text);}if(m.t==="stopSay"){killSay();}\n'
    + 'if(m.t==="micPause"){extBusy=true;try{rec&&rec.abort();}catch(e){}regain();}\n'
    + 'if(m.t==="micResume"){extBusy=false;regain();}\n'
    + 'if(m.t==="close"){window.close();}});\n'
    + 'window.onbeforeunload=function(){post({t:"closed"});post({t:"listening",on:false});};\n'
    + '</scr' + 'ipt></body></html>';
}

/* Engraved-line icon set — one style across every tool: thin brass linework,
   stroke-only, currentColor so each icon takes its housing's metal tint. */
const ICON_GLYPHS = {
  chat: (
    <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7l-4.5 4v-4A3 3 0 0 1 4 13z" />
  ),
  handoff: (
    <>
      <path d="M16 3.5h4.5V8" />
      <path d="M3.5 20 20.5 3.5" />
      <path d="M20.5 16v4.5H16" />
      <path d="m14.5 14.5 6 6" />
      <path d="m3.5 3.5 6 6" />
    </>
  ),
  quill: (
    <>
      <path d="M20.2 3.8c-4.6-.9-8.9.7-11.6 4.1-1.9 2.4-2.9 5.6-3.1 9.3 3.7-.2 6.9-1.2 9.3-3.1 3.4-2.7 5-7 4.1-11.6z" />
      <path d="M3.5 20.5 14 10" />
    </>
  ),
  drive: (
    <>
      <path d="M12 4 3 19.5h18z" />
      <path d="M7.6 11.75h8.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.9 3.4 2.9 13.6 0 17-2.9-3.4-2.9-13.6 0-17z" />
    </>
  ),
  dials: (
    <>
      <path d="M6 4v3.5M6 11.5V20" />
      <circle cx="6" cy="9.5" r="2" />
      <path d="M12 4v8.5M12 16.5V20" />
      <circle cx="12" cy="14.5" r="2" />
      <path d="M18 4v1.5M18 9.5V20" />
      <circle cx="18" cy="7.5" r="2" />
    </>
  ),
  github: (
    <>
      <path d="M6 9v6" />
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6.5" r="2.5" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M9 10h6M9 13.5h6M9 17h3.5" />
    </>
  ),
  spark: (
    <path d="M13 3 5.5 13.5h4.5L11 21l7.5-10.5H14z" />
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 1.5-2-.6-1.3.2-2.5 1.7-2.5h2c1.9 0 3.3-1.4 3.3-3.5 0-5-3.8-9-8.5-9z" />
      <circle cx="8" cy="9" r="1" />
      <circle cx="12" cy="7" r="1" />
      <circle cx="16" cy="9.5" r="1" />
      <circle cx="7.5" cy="13.5" r="1" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.5" />
      <path d="m3.5 16.5 5-4.5 4 3.5 3.5-3 4.5 4" />
    </>
  ),
  folder: (
    <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2.5 2.5h6.5a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  file: (
    <>
      <path d="M6 4.5a2 2 0 0 1 2-2h5.5L18 7v12.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M13.5 2.5V7H18" />
      <path d="M9 12h6M9 15.5h6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5M8.5 21.5h7" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L13 5v14l-5.5-4.5H4z" />
      <path d="M16.5 9a4.5 4.5 0 0 1 0 6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  hook: (
    <>
      <path d="M12 3v9.5a4.5 4.5 0 0 0 9 0v-1.5l-2.5 2" />
      <circle cx="12" cy="4" r="1.4" />
    </>
  ),
};

function EmberIcon({ name, size = 18, strokeWidth = 1.5, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={style} aria-hidden="true">
      {ICON_GLYPHS[name] || null}
    </svg>
  );
}

/* ============================================================
   STEAMPUNK ASSET PACK (assets/ember) — see CLAUDE-HANDOFF.md
   ============================================================ */

const ASSETS = (typeof window !== "undefined" && window.EMBER_ASSET_ROOT) || "assets/ember";

// Bronze brand marks for the three branded Studio tools — inlined so the
// stroke/fill color can switch with tool state (imgs can't inherit CSS vars).
function BrandMark({ tool, active, size = 22 }) {
  const c = active ? "#D6B36A" : "#B08D57";
  const fx = {
    transition: "filter 140ms cubic-bezier(.2,.8,.2,1)",
    filter: active ? "brightness(1) drop-shadow(0 0 7px rgba(255,120,60,.55))" : "brightness(.78)",
  };
  if (tool === "chat") return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={fx} aria-hidden="true">
      <g stroke={c} strokeWidth="5" strokeLinecap="round">
        <path d="M32 6v52M6 32h52M13.6 13.6l36.8 36.8M50.4 13.6 13.6 50.4" />
        <path d="m21 8 22 48M56 21 8 43M43 8 21 56M56 43 8 21" strokeWidth="3" />
      </g>
      <circle cx="32" cy="32" r="6" fill={c} />
    </svg>
  );
  if (tool === "drive") return (
    <svg width={size + 3} height={size} viewBox="0 0 72 64" fill="none" style={fx} aria-hidden="true">
      <path d="M27 5h18l24 42-9 15H12L3 47 27 5Z" stroke={c} strokeWidth="7" strokeLinejoin="round" />
      <path d="M27 5 12 32m48 0H12m33-27-15 27 15 30" stroke={c} strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={fx} aria-hidden="true">
      <path d="M32 4C16.5 4 4 16.9 4 32.8c0 12.7 8 23.5 19.1 27.3 1.4.3 1.9-.6 1.9-1.4v-5.5c-7.8 1.7-9.4-3.4-9.4-3.4-1.3-3.3-3.1-4.2-3.1-4.2-2.5-1.8.2-1.7.2-1.7 2.8.2 4.3 3 4.3 3 2.5 4.4 6.6 3.1 8.2 2.4.3-1.9 1-3.1 1.8-3.8-6.2-.7-12.8-3.2-12.8-14.2 0-3.1 1.1-5.7 2.9-7.7-.3-.7-1.3-3.6.3-7.6 0 0 2.4-.8 7.7 2.9a26.2 26.2 0 0 1 14 0c5.4-3.7 7.7-2.9 7.7-2.9 1.5 4 .6 6.9.3 7.6a11.2 11.2 0 0 1 2.9 7.7c0 11-6.6 13.4-12.9 14.1 1 1 1.9 2.8 1.9 5.6v8.2c0 .8.5 1.7 1.9 1.4A28.8 28.8 0 0 0 60 32.8C60 16.9 47.5 4 32 4Z" fill={c} />
    </svg>
  );
}

// Contextual action lever (Draft Reply / Create Task) — art per state from the
// pack; status point pulses at 900ms during pending-review per motion-spec.
function ContextLever({ side, label, state, onPull }) {
  const img =
    state === "active" ? "action-lever-active.svg"
    : state === "idle" ? "action-lever-idle.svg"
    : "action-lever-ready.svg"; // ready + pending-review share the ready art
  return (
    <button type="button" disabled={state === "idle" || state === "active"} onClick={onPull}
      aria-label={`${label} for selected communication`}
      className={`ctx-lever ${side} ${state}`}>
      <img alt="" src={`${ASSETS}/svg/controls/${img}`} />
      <span className={`lever-dot ${state}`} />
      <span className="lever-label">{label}</span>
    </button>
  );
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function BaxstarEmber() {
  const [view, setView] = useState("ops");
  const [studioTool, setStudioTool] = useState("captions");

  // steampunk context actions — selected Calls/Inbox item feeds the two levers
  const [selectedComm, setSelectedComm] = useState(null); // { type:"vm"|"email", i }
  const [leverBusy, setLeverBusy] = useState(null);       // "draft" | "task" | null
  const [leverPending, setLeverPending] = useState(null); // pending-review pulse
  const [draftEdit, setDraftEdit] = useState(null);       // editable lever draft text
  const [draftCopied, setDraftCopied] = useState(false);
  const [taskProposal, setTaskProposal] = useState(null); // { title, source, due, details }

  // ---- OPS state ----
  const [data, setData] = useState(DEMO);
  const [live, setLive] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [command, setCommand] = useState("");
  const [focused, setFocused] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef([]);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);

  // core visualizer + voice engine
  const [coreMode, setCoreMode] = useState("enigma"); // "enigma" | "scope"
  const speechUnlockedRef = useRef(false);
  // The ear is a state machine, not a flag. 'off': mic fully released — this is
  // what gives Brady his CarPlay back, because iOS silences all other audio
  // while ANY page holds the mic. 'passive': listening but discarding everything
  // except the wake phrase (desktop). 'armed': wake heard, waiting briefly for
  // the command. 'live': capturing commands directly (phone tap-to-talk window).
  const earModeRef = useRef("off");
  const earLastActiveRef = useRef(0);    // last wake/command; the ear sleeps when this goes stale
  const followTimerRef = useRef(null);   // phone: release deadline after an exchange
  const armTimerRef = useRef(null);      // wake heard, command window countdown
  const inlineGenRef = useRef(0);      // stale-session events must not touch live state
  const inlineBornRef = useRef(0);     // for the rapid-death guard
  const inlineFailsRef = useRef(0);
  const inlineRecRef = useRef(null);   // in-page recognition (phones)
  const [micArm, setMicArm] = useState(false);
  const [earState, setEarState] = useState("off"); // UI mirror of earModeRef
  const [voiceChoice, setVoiceChoice] = useState("");   // "" = automatic
  const [voiceTrace, setVoiceTrace] = useState([]);      // last few speech events, on screen
  const voiceTraceRef = useRef([]);
  const voiceChoiceRef = useRef("");
  const [voiceList, setVoiceList] = useState([]);       // device voices, for the picker // popup blocked at load; first click opens it
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const voiceRef = useRef(null);        // best TTS voice on this device
  const levelRef = useRef(0);           // 0..1 smoothed level
  const bridgeLevelRef = useRef({ v: 0, wave: null, ts: 0 });
  const popupRef = useRef(null);        // the mic bridge window
  const gasRef = useRef(null);
  const ventRef = useRef(null);
  const scopeRef = useRef(null);
  const prevLvlRef = useRef(0);
  const lastVentRef = useRef(0);
  const sendRef = useRef(() => {});
  const ttsPathRef = useRef(null);      // "local" | "bridge" | "mp3" once proven
  const audioElRef = useRef(null);      // mp3 fallback element
  const bridgeAckRef = useRef(null);    // resolves when bridge confirms speaking
  const busyRef = useRef(false);        // a command is in flight — state lags, this doesn't
  const pendingRef = useRef(null);      // what he said while she was still answering
  const speechEpochRef = useRef(0);     // only the newest utterance may reopen the mic
  const speechEndRef = useRef(null);    // resolves when she actually stops talking
  const speechEndResolveRef = useRef(null); // the ONE resolver for the above
  const speechTokenRef = useRef(0);     // ...tagged, so only its owner may end it
  const bridgeEndRef = useRef(null);    // ditto, for speech the bridge produced
  const lastSpokenRef = useRef("");     // normalised, to recognise her own voice coming back
  const lastSpokenAtRef = useRef(0);    // ...and when, so the match expires
  const voiceOnRef = useRef(true);      // read inside async speech, where state is stale
  const [voiceDiag, setVoiceDiag] = useState("");
  const [queued, setQueued] = useState("");

  // ---- CAPTION STUDIO state ----
  // Up to MAX_PHOTOS slides; one caption covers the set. photos[0] drives the preview.
  const [photos, setPhotos] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [fishId, setFishId] = useState(null);
  const [sponsors, setSponsors] = useState(blankSponsors);
  /* Seasonal default, set 2026-08 per Brady: Pelican Lake for the rest of the year.
     It's the lake the trips are actually on right now, and it feeds the Instagram
     geotag, so a stale default mislabels the location on every post. Revisit at the
     turn of the year. Note: a device that already has a saved pref keeps that value —
     this is the default for a fresh start, not an override. */
  const [lake, setLake] = useState("Pelican Lake");
  const [postTime, setPostTime] = useState("16:00"); // 24h "HH:MM"
  // Destinations. IG feed on by default — that is the pipeline that exists today.
  const [surfaces, setSurfaces] = useState({ ig_feed: true });
  const [genBusy, setGenBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [capErr, setCapErr] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef(null);
  // Feed-aspect gate: armed by the first Publish press that finds a too-tall slide,
  // so the second press means "send as-is". Any change to the set or the
  // destinations re-arms the warning — a new tall photo gets its own first press.
  const tallOkRef = useRef(false);
  useEffect(() => { tallOkRef.current = false; }, [photos, surfaces]);

  // ---- CAPTION: PUBLISH → DRIVE OUTBOX ----
  // The outbox URL is the deployed Apps Script /exec endpoint (see apps-script/outbox/).
  // It's a deployment URL, not a secret, so localStorage is the right home — it must
  // persist outside the artifact where window.storage doesn't exist.
  const [outboxUrl, setOutboxUrl] = useState("");
  const [outboxEdit, setOutboxEdit] = useState(false); // reveal the field again after setup
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [captionRestored, setCaptionRestored] = useState(false);
  // Stripped mobile shell: dock + non-caption tools hidden. Set by ?lean=1 / #lean.
  const [leanCaption, setLeanCaption] = useState(false);

  // ---- CLAUDE CHAT state (the thread lives on the OPS home page) ----
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatModel, setChatModel] = useState(DEFAULT_MODEL);
  const [chatEffort, setChatEffort] = useState(DEFAULT_EFFORT);

  /* Today's revenue is MANUAL — Brady sets it, nothing invents it. The panel
     used to show a hardcoded demo number ("+$1,240 · 2 FareHarbor bookings")
     that read as real; Brady called it out 2026-08-15. Stored with its date so
     yesterday's number can't masquerade as today's. Real automatic revenue
     waits for a booking-system connection that doesn't exist yet. */
  const [revToday, setRevToday] = useState(null); // { n: 450, d: "2026-08-15" }
  const localDay = () => new Date().toLocaleDateString("en-CA");
  const revSet = !!(revToday && revToday.d === localDay() && Number.isFinite(revToday.n));
  function editRevenue() {
    const cur = revSet ? String(revToday.n) : "";
    const raw = window.prompt("Today's revenue, in dollars (numbers only — leave empty to clear):", cur);
    if (raw === null) return;
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    if (!String(raw).trim() || isNaN(n)) { setRevToday(null); return; }
    setRevToday({ n, d: localDay() });
  }
  // Odometer face: at least 5 digits so the tiles keep their instrument look.
  const odoFmt = (n) => {
    const s = String(n).padStart(5, "0");
    return "$" + s.slice(0, -3) + "," + s.slice(-3);
  };

  /* Talk-to-type for the command box: one-shot dictation that fills the input
     and stops. Deliberately separate from the ear/talk-window machinery — this
     must never send on its own, and it must not fight the conversation mic. */
  const [dictating, setDictating] = useState(false);
  const dictRecRef = useRef(null);
  function toggleDictation() {
    if (dictRecRef.current) {
      try { dictRecRef.current.abort(); } catch (e) {}
      dictRecRef.current = null;
      setDictating(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("This browser has no speech recognition. Safari or Chrome."); return; }
    stopAllMics(); // dictation and the conversation mic must not share the channel
    let rec;
    try { rec = new SR(); } catch (e) { return; }
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true; // words appear in the box as he says them
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      setCommand(text);
    };
    rec.onend = () => { dictRecRef.current = null; setDictating(false); };
    rec.onerror = () => {};
    dictRecRef.current = rec;
    try { rec.start(); setDictating(true); } catch (e) { dictRecRef.current = null; }
  }
  const chatEndRef = useRef(null);
  // greeting-count buttons jump to these two panel columns
  const callsColRef = useRef(null);
  const inboxColRef = useRef(null);
  useEffect(() => { voiceOnRef.current = voiceOn; }, [voiceOn]);
  useEffect(() => {
    voiceChoiceRef.current = voiceChoice;
    // A newly chosen voice must actually be used: forget the remembered one and
    // let the next utterance audition the choice first.
    if (voiceChoice) voiceRef.current = null;
  }, [voiceChoice]);
  // The picker needs the device's voices. iOS delivers them LATE — often only
  // after the first utterance, sometimes without ever firing voiceschanged
  // (Chrome iOS in particular). One mount-time read left the picker invisible
  // on Brady's phone, which read as "the voices you wired up aren't there".
  // Poll for ~8s and keep the event listener as a bonus.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let tries = 0;
    const fill = () => {
      const vs = synth.getVoices().filter((v) => v.lang && v.lang.startsWith("en"));
      if (vs.length) setVoiceList((old) => (vs.length >= old.length ? vs : old));
      return vs.length;
    };
    fill();
    const iv = setInterval(() => {
      tries += 1;
      const n = fill();
      if ((n && tries > 4) || tries > 20) clearInterval(iv);
    }, 400);
    synth.addEventListener?.("voiceschanged", fill);
    return () => { clearInterval(iv); synth.removeEventListener?.("voiceschanged", fill); };
  }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chatMsgs, thinking]);

  // ---- GOOGLE DRIVE state ----
  const [driveMsgs, setDriveMsgs] = useState([]);
  const [driveInput, setDriveInput] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  const driveEndRef = useRef(null);
  useEffect(() => { driveEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [driveMsgs, driveBusy]);

  // ---- HANDOFF state ----
  const [handoffText, setHandoffText] = useState("");
  const [handoffCopied, setHandoffCopied] = useState("");
  const [handErr, setHandErr] = useState("");

  // ---- HTML VIEWER state ----
  const [htmlSrc, setHtmlSrc] = useState("");
  const [htmlRendered, setHtmlRendered] = useState("");

  // ---- GITHUB state (token is session-only — never persisted) ----
  const [ghToken, setGhToken] = useState("");
  const [ghRepo, setGhRepo] = useState("");
  const [ghPath, setGhPath] = useState("");
  const [ghItems, setGhItems] = useState(null);
  const [ghFile, setGhFile] = useState(null); // { name, content, htmlUrl }
  const [ghBusy, setGhBusy] = useState(false);
  const [ghErr, setGhErr] = useState("");

  // ---- SNIPPETS state ----
  const [copiedSnippet, setCopiedSnippet] = useState(-1);

  // ---- BACKGROUND state ----
  const [bg, setBg] = useState({ choice: "darklake", customB64: null });
  const [bgMenu, setBgMenu] = useState(false);
  const bgFileRef = useRef(null);
  const hydrated = useRef(false);
  useEffect(() => {
    (async () => {
      const load = async (key) => {
        try {
          if (window.storage?.get) {
            const r = await window.storage.get(key, false);
            return r?.value ? JSON.parse(r.value) : null;
          }
          const v = localStorage.getItem(key);
          return v ? JSON.parse(v) : null;
        } catch (e) { return null; }
      };
      const [b, prefs, chat, drive] = await Promise.all([
        load("ember-bg"), load("ember-prefs"), load("ember-chat"), load("ember-drive"),
      ]);
      if (b?.choice) setBg(b);
      if (prefs) {
        if (typeof prefs.voiceOn === "boolean") setVoiceOn(prefs.voiceOn);
        if (typeof prefs.voiceChoice === "string") setVoiceChoice(prefs.voiceChoice);
        if (prefs.surfaces && typeof prefs.surfaces === "object") setSurfaces((s0) => ({ ...s0, ...prefs.surfaces }));
        if (prefs.v >= PREFS_V) {
          if (prefs.chatModel) setChatModel(prefs.chatModel);
          if (prefs.chatEffort) setChatEffort(prefs.chatEffort);
        }
        if (prefs.revToday && typeof prefs.revToday.n === "number" && typeof prefs.revToday.d === "string") setRevToday(prefs.revToday);
        if (prefs.lake) setLake(prefs.lake);
        if (prefs.postWindow) setPostTime(toPostTime(prefs.postWindow));
        if (prefs.coreMode) setCoreMode(prefs.coreMode);
        if (prefs.studioTool) setStudioTool(prefs.studioTool === "chat" ? "captions" : prefs.studioTool);
      }
      if (Array.isArray(chat)) setChatMsgs(chat);
      if (Array.isArray(drive)) setDriveMsgs(drive);
      hydrated.current = true;
    })();
  }, []);

  /* ---- MOBILE DEEP-LINK + OUTBOX URL + CAPTION DRAFT RECOVERY ----
     Runs once, synchronously off localStorage, so a phone that opens
     ember?tool=captions (or #caption) lands straight in the caption tool and — if the
     lake connection dropped mid-caption last time — offers the unsent draft back. */
  useEffect(() => {
    // Deep-link: ?tool=captions / ?view=caption / #caption / #/caption ; ?lean=1 for the
    // stripped mobile shell (dock + non-caption tools hidden).
    try {
      const qs = new URLSearchParams(window.location.search || "");
      const hash = (window.location.hash || "").toLowerCase();
      const wantsCaption =
        /caption/i.test(qs.get("tool") || "") ||
        /caption/i.test(qs.get("view") || "") ||
        /(^|[#/])caption/.test(hash);
      if (wantsCaption) { setView("studio"); setStudioTool("captions"); }
      if (qs.get("lean") === "1" || /lean/.test(hash)) { setLeanCaption(true); setView("studio"); setStudioTool("captions"); }
    } catch (e) { /* no location — artifact/SSR */ }

    // Outbox endpoint (deployment URL, not a secret).
    // A device-specific override wins; otherwise fall back to the built-in endpoint.
    const savedUrl = lsGet(OUTBOX_URL_KEY, "");
    setOutboxUrl(typeof savedUrl === "string" && savedUrl ? savedUrl : DEFAULT_OUTBOX_URL);

    // Caption draft recovery — the survives-a-dropped-connection piece.
    const draft = lsGet(CAPTION_DRAFT_KEY, null);
    // `photo` (singular) is the pre-carousel draft shape — still restored so a draft written
    // by an older build isn't stranded.
    const draftShots = draft?.photos || (draft?.photo ? [draft.photo] : []);
    if (draft && (draft.caption || draftShots.length)) {
      if (draftShots.length) setPhotos(draftShots);
      if (draft.caption) setCaption(draft.caption);
      if (draft.fishId) setFishId(draft.fishId);
      // Merge onto a blank set — a draft saved before a sponsor was added carries only the
      // old keys, and reading .on off a missing key would throw during render.
      if (draft.sponsors) setSponsors({ ...blankSponsors(), ...draft.sponsors });
      if (draft.lake) setLake(draft.lake);
      if (draft.postWindow) setPostTime(toPostTime(draft.postWindow));
      setCaptionRestored(true);
    }
  }, []);

  /* Autosave the in-progress caption to localStorage so a dropped lake connection or an
     accidental reload never loses it.

     Images are saved on a best-effort ladder, because a six-slide carousel carries two
     renders each and will not fit a ~5MB localStorage quota: try the full set, then the
     vision renders alone (roughly half the bytes), then text and metadata only. The
     caption itself — the part that took a model call to produce — survives every rung. */
  useEffect(() => {
    if (!hydrated.current) return;
    if (!caption && !photos.length) { lsDel(CAPTION_DRAFT_KEY); return; }
    const base = { caption, fishId, sponsors, lake, postWindow: postTime, ts: clock };
    const lean = photos.map(({ b64, preview }) => ({ b64, preview }));
    if (lsSet(CAPTION_DRAFT_KEY, { ...base, photos })) return;
    if (lsSet(CAPTION_DRAFT_KEY, { ...base, photos: lean })) return;
    lsSet(CAPTION_DRAFT_KEY, base);
  }, [caption, photos, fishId, sponsors, lake, postTime]);

  // fire-and-forget persist that never throws, even if storage is absent
  // window.storage is the artifact-era API. The hosted site never had it, so
  // every preference silently reset on each visit. localStorage is the fallback.
  const persist = (key, val) => {
    try {
      const json = JSON.stringify(val);
      if (window.storage?.set) {
        const p = window.storage.set(key, json, false);
        if (p && p.catch) p.catch(() => {});
      } else {
        localStorage.setItem(key, json);
      }
    } catch (e) { /* persistence optional */ }
  };
  useEffect(() => { if (hydrated.current) persist("ember-chat", chatMsgs.slice(-24)); }, [chatMsgs]);
  useEffect(() => { if (hydrated.current) persist("ember-drive", driveMsgs.slice(-24)); }, [driveMsgs]);
  useEffect(() => {
    if (hydrated.current) persist("ember-prefs", { v: PREFS_V, voiceOn, voiceChoice, surfaces, chatModel, chatEffort, lake, postWindow: postTime, studioTool, coreMode, revToday });
  }, [voiceOn, voiceChoice, surfaces, chatModel, chatEffort, lake, postTime, studioTool, coreMode, revToday]);
  async function saveBg(next) {
    setBg(next);
    setBgMenu(false);
    try {
      const payload = JSON.stringify(next);
      if (payload.length < 4800000) await window.storage.set("ember-bg", payload, false);
    } catch (e) { /* persistence optional */ }
  }
  async function handleBgUpload(file) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const p = await fileToResizedB64(file, 1920, 0.8);
      saveBg({ choice: "custom", customB64: p.b64 });
    } catch (e) {
      setError("Couldn't read that background image.");
    }
  }
  const activeBgCss = bg.choice !== "default" && bg.choice !== "custom" && bg.choice !== "darklake" ? BGS.find((b) => b.id === bg.choice)?.css : null;
  const activeBgImg =
    bg.choice === "custom" && bg.customB64 ? `url(data:image/jpeg;base64,${bg.customB64})` :
    bg.choice === "darklake" ? `url(data:image/jpeg;base64,${DARK_LAKE_B64})` : null;
  const bgActive = !!(activeBgCss || activeBgImg);

  // clock
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const clock = now
    .toLocaleString("en-US", { weekday: "short", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" })
    .toUpperCase()
    .replace(",", " ·");
  const hour = now.getHours();
  const dayPart = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  /* ---------- VOICE (Web Speech) ---------- */

  // iOS Safari refuses getUserMedia and SpeechRecognition to a blob: popup --
  // that window has an opaque origin, and no amount of granting mic permission
  // in Settings changes it. On a phone we skip the bridge entirely and listen in
  // this page, which has a real origin and the tap that started it.
  const isPhone =
    typeof navigator !== "undefined" &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
      !window.open);
  // Inline recognition runs wherever the API exists — desktop included. The
  // popup bridge was born when Ember lived inside claude.ai's artifact iframe,
  // which could not prompt for the mic; hosted on its own origin, the main
  // window can. The popup remains only as a fallback for browsers with no
  // SpeechRecognition at all.
  const hasSR = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const inlineMic = isPhone; // phone rail + gesture-unlock JSX keys off this

  // iOS keeps speechSynthesis mute until a tap-context utterance unlocks it.
  // Her replies arrive after a network wait -- outside any tap -- so without
  // this, the engine swallows them silently, the cascade falls through to the
  // mp3 robot voice, and that gets remembered as the "proven" path. Unlock on
  // the first genuine gesture, then void the proven path so the cascade
  // re-auditions the real local voices it never got to try.
  function unlockSpeech() {
    if (speechUnlockedRef.current) return;
    speechUnlockedRef.current = true;
    try {
      const synth = window.speechSynthesis;
      if (synth) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; u.rate = 2; synth.speak(u); }
    } catch (e) {}
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const ctx = new C(); ctx.resume?.(); setTimeout(() => ctx.close?.(), 300);
    } catch (e) {}
    if (ttsPathRef.current === "mp3") ttsPathRef.current = null; // proven against a mute engine — void it
    if (!voiceChoiceRef.current) voiceRef.current = null;
  }

  // iOS kills a REUSED recognition session after a few start/stop cycles, so
  // every session is a fresh instance, and a generation counter keeps a stale
  // instance's late events away from live state.

  // Flight recorder for the speech path. Brady can screenshot this instead of
  // describing silence from a truck; the entries name the exact step that died.
  function traceAdd(line) {
    const stamp = new Date().toTimeString().slice(0, 8);
    const arr = [...voiceTraceRef.current.slice(-5), stamp + " " + line];
    voiceTraceRef.current = arr;
    setVoiceTrace(arr);
  }

  function setEar(mode) {
    earModeRef.current = mode;
    setEarState(mode);
  }

  function clearEarTimers() {
    if (followTimerRef.current) { clearTimeout(followTimerRef.current); followTimerRef.current = null; }
    if (armTimerRef.current) { clearTimeout(armTimerRef.current); armTimerRef.current = null; }
  }

  // Recognizers routinely hear "Ember" as "Amber" (Brady does too), so both
  // count. Tail text after the phrase is the command itself: "Ember awake
  // what's my day" answers immediately, no second breath needed.
  const WAKE_RE = /\b(?:ember|amber|embers)[\s,!.]*(?:a?wake|awaken|wake\s*up)\b/i;

  // How long the desktop ear stays open with no wake phrase before it releases
  // the mic. Long enough to cover a boat ride between spots; short enough that
  // a tab left open overnight isn't a live microphone.
  const EAR_IDLE_MS = 30 * 60 * 1000;
  // Phone talk window: how much TRUE silence ends the conversation. Generous on
  // purpose — Brady thinks between sentences on the water; interim speech
  // refreshes this clock so it never counts against a sentence in progress.
  const LIVE_IDLE_MS = 15000;

  // Soft ping: "I heard my name." Distinct from the boot chime — shorter,
  // higher, quieter.
  function wakePing() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const ctx = new C();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1318; // E6
      g.gain.setValueAtTime(0.07, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.18);
      setTimeout(() => ctx.close?.(), 400);
    } catch (e) {}
  }

  function makeInlineRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec;
    try { rec = new SR(); } catch (e) { return null; }
    const gen = ++inlineGenRef.current;
    // Single-shot on purpose: iOS ends continuous sessions on its own schedule
    // anyway, and one-phrase sessions deliver finals faster.
    rec.continuous = false;
    // Phone talk windows get interim results — not for their text, but as a
    // "he's still talking" heartbeat so the follow window can't cut a sentence
    // in half. The desktop ear stays finals-only: interims from room noise
    // would keep bumping the activity clock and defeat the 30-minute sleep.
    rec.interimResults = isPhone;
    rec.lang = "en-US";
    rec.onstart = () => {
      if (gen !== inlineGenRef.current) return;
      setListening(true); setMicArm(false); setError("");
    };
    rec.onerror = (e) => {
      if (gen !== inlineGenRef.current) return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        clearEarTimers();
        setEar("off");
        inlineRecRef.current = null;
        setListening(false);
        setError(isPhone
          ? "Mic blocked — tap aA in the address bar, Website Settings, Microphone, Allow."
          : "Mic blocked — click the lock icon by the address bar and allow the microphone.");
      }
      // no-speech / aborted / network: onend fires next and handles it
    };
    rec.onend = () => {
      const resolve = rec.__release;
      rec.__release = null;
      if (resolve) resolve(); // someone is waiting for the mic to actually let go
      if (gen !== inlineGenRef.current) return;
      inlineRecRef.current = null;
      // 'off' means OFF: no restart, channel surrendered, CarPlay comes back.
      if (earModeRef.current === "off" || speakingRef.current) { setListening(false); return; }
      const now = Date.now();
      if (now - inlineBornRef.current < 700) {
        inlineFailsRef.current += 1;
        if (inlineFailsRef.current >= 6) {
          clearEarTimers();
          setEar("off");
          setListening(false);
          setError("The mic keeps dying — tap the mic to restart it.");
          return;
        }
      } else {
        inlineFailsRef.current = 0;
      }
      // The ear is allowed to be always-on, not on forever: with no wake phrase
      // for EAR_IDLE_MS it goes back to sleep instead of holding an open mic
      // over an empty room. Waking it is one tap.
      if (earModeRef.current === "passive" &&
          Date.now() - earLastActiveRef.current > EAR_IDLE_MS) {
        clearEarTimers();
        setEar("off");
        setListening(false);
        setError("Quiet for a while, so the mic went to sleep — tap it to wake her.");
        return;
      }
      setTimeout(() => {
        if (earModeRef.current !== "off" && !speakingRef.current && !inlineRecRef.current) startInlineSession();
      }, 180);
    };
    rec.onresult = (ev) => {
      if (gen !== inlineGenRef.current) return;
      let text = "";
      let sawInterim = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
        else sawInterim = true;
      }
      // Mid-sentence speech refreshes the talk window's idle clock, so a long
      // slow question can't get the mic yanked out from under it.
      if (sawInterim && earModeRef.current === "live") earLastActiveRef.current = Date.now();
      text = text.trim();
      if (!text) return;
      if (speakingRef.current || isEcho(text)) return; // never act on her own voice
      const mode = earModeRef.current;
      if (mode === "passive") {
        const m = text.match(WAKE_RE);
        if (!m) return; // not for her — discarded, never sent anywhere
        earLastActiveRef.current = Date.now();
        wakePing();
        const tail = text.slice(m.index + m[0].length).replace(/^[\s,!.—-]+/, "").trim();
        if (tail) { clearEarTimers(); sendRef.current(tail); return; }
        setEar("armed");
        if (armTimerRef.current) clearTimeout(armTimerRef.current);
        // His spec: about two seconds for the prompt to start. The session is
        // already open, so this is a countdown back to passive, not a gate.
        armTimerRef.current = setTimeout(() => {
          armTimerRef.current = null;
          if (earModeRef.current === "armed") setEar("passive");
        }, 2600);
        return;
      }
      // armed or live: this IS the command
      earLastActiveRef.current = Date.now();
      clearEarTimers();
      if (mode === "armed") setEar("passive"); // desktop returns to wake-listening
      sendRef.current(text);
    };
    return rec;
  }

  function startInlineSession() {
    const rec = makeInlineRec();
    if (!rec) return false;
    inlineRecRef.current = rec;
    inlineBornRef.current = Date.now();
    try { rec.start(); } catch (e) { inlineRecRef.current = null; return false; }
    return true;
  }

  // Phone: fully surrender the mic. This is the CarPlay fix — while any page
  // holds a recognition session, iOS mutes every other audio app. Nothing may
  // restart the session once mode is 'off'.
  function releaseMic() {
    clearEarTimers();
    setEar("off");
    inlineGenRef.current += 1; // orphan anything in flight
    const rec = inlineRecRef.current;
    inlineRecRef.current = null;
    if (rec) { try { rec.abort(); } catch (e) {} }
    setListening(false);
  }

  // Phone tap-to-talk: open a conversation window. Every exchange extends it;
  // silence closes it and gives the audio channel back.
  function openTalkWindow() {
    unlockSpeech();
    if (!hasSR) { setError("This browser has no speech recognition. Safari or Chrome."); return false; }
    clearEarTimers();
    setEar("live");
    earLastActiveRef.current = Date.now();
    inlineFailsRef.current = 0;
    if (!inlineRecRef.current && !startInlineSession()) {
      setEar("off");
      setError("Could not start the mic.");
      return false;
    }
    armFollowTimer();
    return true;
  }

  /* The talk window used to be a hard fuse — 9 seconds to speak, 8 between
     exchanges — and it fired even mid-sentence, which is how Brady kept getting
     cut off. Now it's an idle check: the mic releases only after LIVE_IDLE_MS
     of true silence, with interim speech results refreshing the clock, and it
     re-checks instead of guillotining. Busy/speaking defers the check. */
  function armFollowTimer() {
    if (followTimerRef.current) clearTimeout(followTimerRef.current);
    const check = () => {
      followTimerRef.current = null;
      if (earModeRef.current !== "live") return;
      if (speakingRef.current || busyRef.current) {
        followTimerRef.current = setTimeout(check, 2000);
        return;
      }
      const idle = Date.now() - earLastActiveRef.current;
      if (idle >= LIVE_IDLE_MS) releaseMic();
      else followTimerRef.current = setTimeout(check, LIVE_IDLE_MS - idle + 250);
    };
    followTimerRef.current = setTimeout(check, LIVE_IDLE_MS);
  }

  // Desktop: the ear. Always listening while on, but passive — everything that
  // is not the wake phrase is discarded on the spot.
  function startEar() {
    unlockSpeech();
    if (!hasSR) return false;
    clearEarTimers();
    setEar("passive");
    earLastActiveRef.current = Date.now();
    inlineFailsRef.current = 0;
    if (!inlineRecRef.current && !startInlineSession()) { setEar("off"); return false; }
    return true;
  }

  function stopInlineMic() { releaseMic(); }

  /* Whole-utterance sleep phrases: "should we stop at the landing" stays a
     normal question. Consumed by sendCommand, which confirms and releases. */
  const SLEEP_RE = /^\s*(?:ok(?:ay)?\s+)?(?:ember[,\s]+)?(?:please\s+)?(go to sleep|goodbye|good bye|bye|stop listening|stop talking|stop|quiet|be quiet|shut up|mute|sleep|that'?s all|that is all|never ?mind|we'?re done|i'?m done|thanks that'?s all)\s*[.!]?\s*$/i;

  function stopAllMics() {
    releaseMic();
    const w = popupRef.current;
    if (w && !w.closed) { try { w.postMessage({ ch: "EMBERMIC", t: "micOff" }, "*"); } catch (e) {} }
    setListening(false);
  }

  function toggleMic() {
    if (hasSR) {
      if (isPhone) {
        if (earModeRef.current !== "off") releaseMic();
        else openTalkWindow();
      } else {
        if (earModeRef.current !== "off") releaseMic();
        else startEar();
      }
      return;
    }
    const w = popupRef.current;
    if (w && !w.closed) {
      w.postMessage({ ch: "EMBERMIC", t: "toggle" }, "*");
      w.focus();
      return;
    }
    openMicBridge();
  }

  function openMicBridge(silent = false) {
    stopSpeaking();
    const url = URL.createObjectURL(new Blob([buildBridgeHtml()], { type: "text/html" }));
    const w = window.open(url, "emberMic", "width=400,height=300");
    if (!w) {
      if (!silent) setError("Popup blocked — allow popups for claude.ai so the Mic Bridge can open.");
      return false;
    }
    popupRef.current = w;
    setMicArm(false);
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    return true;
  }

  // Load behavior. Phone: mic OFF until Brady taps — a page that grabs the mic
  // at load is what silenced his truck. Desktop: the ear starts inline (no
  // popup) and listens for "Ember, awake". The popup bridge opens only for
  // browsers with no SpeechRecognition at all.
  useEffect(() => {
    if (isPhone) {
      setMicArm(true);
      const un = () => { window.removeEventListener("pointerdown", un); unlockSpeech(); };
      window.addEventListener("pointerdown", un);
      // Every later tap nudges the engine too: iOS sometimes leaves synthesis
      // paused after mic use, and a queued reply sits silent until resumed.
      const pump = () => {
        try {
          const synth = window.speechSynthesis;
          if (!synth) return;
          synth.resume();
          if (speechEndResolveRef.current && !synth.speaking) traceAdd("tap-pump: reply pending but engine idle");
        } catch (e) {}
      };
      window.addEventListener("pointerdown", pump);
      return () => { window.removeEventListener("pointerdown", un); window.removeEventListener("pointerdown", pump); };
    }
    // The mic NEVER self-starts. It used to: the ear opened 600ms after load
    // (and the no-SR path auto-opened the bridge popup), so any tab that merely
    // rendered Ember — a shared laptop, an automated test — was streaming room
    // audio to the browser's recognition service with no tap ever given. During
    // one automated run it transcribed a stretch of ambient house conversation
    // straight into the thread. Listening is consent: it starts at the mic
    // control or not at all.
    if (!hasSR) setMicArm(true); // show the bridge button; opening it is a click
  }, []);

  /* ---------- OPS: SPEECH — three-path cascade with diagnostics ---------- */

  // Pure oscillator chime — cannot fail the way TTS does. If the chime plays,
  // the audio output path is proven good and any silence is TTS-specific.
  function chime() {
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = new C();
    const play = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.5);
      setTimeout(() => ctx.close?.(), 900);
    };
    const p = ctx.resume?.();
    if (p && p.then) p.then(play).catch(play); else play();
  }

  // Path 1 — in-frame synthesis, forced LOCAL voice only
  function whenVoicesReady(cb) {
    const synth = window.speechSynthesis;
    if (!synth || synth.getVoices().length) return cb();
    let done = false;
    const fire = () => { if (!done) { done = true; cb(); } };
    synth.addEventListener?.("voiceschanged", fire, { once: true });
    setTimeout(fire, 700);
  }
  // macOS reports well over a hundred local voices. Most are novelty voices, and
  // some are listed but silent. Taking locals[0] gave one arbitrary voice a single
  // attempt, so an unlucky pick failed this path deterministically every time.
  const NOVELTY_VOICE = /eloquence|bad news|good news|bells|boing|bubbles|cellos|deranged|hysterical|jester|junior|organ|pipe|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|albert|fred|kathy|bahh|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed/i;

  function scoreVoice(v) {
    let s = 0;
    if (/premium/i.test(v.name)) s += 60;
    else if (/enhanced/i.test(v.name)) s += 45;
    if (/\b(ava|zoe|evan|nathan|allison|samantha|serena)\b/i.test(v.name)) s += 20;
    if (v.lang === "en-US") s += 30;
    else if (v.lang && v.lang.startsWith("en")) s += 12;
    if (v.default) s += 5;
    if (/compact/i.test(v.name)) s -= 40; // iOS ships these tinny defaults
    if (NOVELTY_VOICE.test(v.name)) s -= 100;
    return s;
  }

  function rankedLocals() {
    const synth = window.speechSynthesis;
    if (!synth) return [];
    return synth.getVoices()
      .filter((v) => v.localService && v.lang && v.lang.startsWith("en"))
      .sort((a, b) => scoreVoice(b) - scoreVoice(a));
  }

  // The bridge holds the microphone in a separate window. Continuous recognition
  // competes with the speech engine and, worse, hears Ember's own reply and sends
  // it straight back as a new command. The bridge already closes the mic around
  // speech it produces itself; this extends that to speech from this window.
  //
  // The gate is epoch-owned, not a boolean. Cancelling an utterance makes its
  // onend/onerror fire as a LATER task — after its replacement has already asked
  // for the mic to close. An unowned reopen from that stale handler would leave
  // the mic live for the whole next utterance, which is exactly the self-hearing
  // the gate exists to prevent.
  // Recognition returns bare words — strip everything punctuation and case so a
  // heard phrase can be compared against what she just said.
  function normalizeHeard(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  // Echo suppression has to expire. lastSpokenRef was never cleared, so a phrase
  // that appeared anywhere in an answer stayed un-sayable for the life of the
  // page — and repeating her own words back is a normal way to talk to her
  // ("call the marina" right after she says she will call the marina). Speakers
  // only feed the mic while she is actually talking, so a short window after
  // speech ends is all this needs to cover.
  const ECHO_WINDOW_MS = 2500;
  function isEcho(text) {
    const said = lastSpokenRef.current;
    if (!said) return false;
    const age = performance.now() - (lastSpokenAtRef.current || 0);
    if (age > ECHO_WINDOW_MS && !speakingRef.current) return false;
    const heard = normalizeHeard(text);
    if (heard.length < 9) return false;
    return said.includes(heard) || heard.includes(said.slice(0, 60));
  }

  // One owner for the "she stopped talking" signal. Each speech path used to
  // create its own promise and resolve it from its own event handlers, which
  // meant every path that ended some other way — pause(), a closed popup, an
  // engine that simply never fires anything — left speak() awaiting a promise
  // nobody could resolve. sendCommand()'s finally never ran, busyRef stayed
  // true, and every later command was queued forever behind an answer that had
  // already finished. Reload was the only way out. Now: one resolver, released
  // from anywhere, idempotent, and never awaited without a timeout.
  // Release is ownership-checked, not "resolve whatever is current". A handler
  // from an utterance we already abandoned still fires — late onend, a cancel()
  // that flushes the old queue, a bridge reply that outlived its timeout — and
  // an identity-blind release let that stale handler resolve the LIVE
  // utterance's promise. speak() would return mid-answer, the queue would drain
  // on top of her, and she would cut herself off mid-sentence. Callers pass the
  // token they armed with; only a bare call (the STOP button) force-releases.
  function armSpeechEnd() {
    releaseSpeechEnd();
    const token = ++speechTokenRef.current;
    speechEndRef.current = new Promise((r) => { speechEndResolveRef.current = { token, r }; });
    return token;
  }
  function releaseSpeechEnd(token) {
    const cur = speechEndResolveRef.current;
    if (!cur) return;
    if (token !== undefined && cur.token !== token) return; // not ours to end
    speechEndResolveRef.current = null;
    cur.r();
  }

  // iOS shares one audio session between the mic and the speaker. Starting TTS
  // while the mic still holds it produces a "spoken" utterance with no sound --
  // onstart and onend fire, the app believes she answered, Brady hears nothing.
  // So the handoff is awaited: abort the session and resolve only when its
  // onend confirms the channel is free (400ms cap so a wedged session cannot
  // hold speech hostage).
  function pauseInlineMic() {
    const rec = inlineRecRef.current;
    if (!rec) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const settle = () => { if (!done) { done = true; resolve(); } };
      rec.__release = settle;
      setTimeout(settle, 400);
      try { rec.abort(); } catch (e) { settle(); }
    });
  }
  function resumeInlineMic() {
    if (earModeRef.current === "off" || speakingRef.current) return;
    if (isPhone) {
      // The conversation continues: renew the follow-up window so he can answer
      // back without tapping. Restamp the clock — her answer may have taken
      // longer than the idle ceiling, and that must not count against him.
      clearEarTimers();
      setEar("live");
      earLastActiveRef.current = Date.now();
      armFollowTimer();
    } else if (earModeRef.current === "armed") {
      setEar("passive");
    }
    if (!inlineRecRef.current) startInlineSession();
  }

  function postBridge(t) {
    const w = popupRef.current;
    if (w && !w.closed) w.postMessage({ ch: "EMBERMIC", t }, "*");
  }
  function beginSpeech() {
    const epoch = ++speechEpochRef.current;
    postBridge("micPause");
    pauseInlineMic();
    return epoch;
  }
  function endSpeech(epoch) {
    if (epoch !== speechEpochRef.current) return; // superseded — not ours to reopen
    postBridge("micResume");
    resumeInlineMic();
  }

  function tryVoice(v, short, slot) {
    return new Promise((res) => {
      const synth = window.speechSynthesis;
      const epoch = beginSpeech();
      synth.cancel();
      synth.resume();
      const token = armSpeechEnd();
      const u = new SpeechSynthesisUtterance(short);
      u.voice = v; u.lang = v.lang;
      u.rate = 1.03;
      let ok = false;
      let kick;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(kick);
        // Only clear the speaking flag if we are still the current utterance —
        // a superseded one must not mark the live one as finished.
        if (epoch === speechEpochRef.current) { speakingRef.current = false; setSpeaking(false); }
        endSpeech(epoch);
        releaseSpeechEnd(token);
      };
      // The ceiling in speak() must be able to run this. Releasing the promise
      // alone left speakingRef true and micResume unposted, so a stalled path
      // meant the mic never reopened -- a lockup made by the anti-lockup valve.
      if (slot) { slot.token = token; slot.finish = finish; }
      // Epoch-guarded like finish() is: a superseded utterance that starts late
      // must not flip speakingRef on, because its own finish() is barred from
      // flipping it back off — that combination latches the self-hearing guard
      // shut and silently drops every spoken command from then on.
      u.onstart = () => {
        traceAdd(`▶ speaking: ${v.name}`);
        ok = true; voiceRef.current = v;
        if (epoch === speechEpochRef.current) { speakingRef.current = true; setSpeaking(true); }
        kick = setInterval(() => synth.resume(), 4000);
        res(true);
      };
      u.onend = finish;
      u.onerror = (e) => { if (!ok) traceAdd(`✕ ${v.name}: ${(e && e.error) || "error"}`); finish(); if (!ok) res(false); };
      // Chrome wedges if speak() lands in the same tick as cancel() — the queue
      // hasn't flushed and the new utterance silently never starts. Give it a
      // beat, and clear any leftover speaking state before trying again.
      setTimeout(() => {
        // STOP retires the epoch, but cancel() can only flush what is already
        // queued — it cannot retire a speak() we have not called yet. Without
        // this check she reads the whole answer after he stopped her, with the
        // mic live the entire time. The bridge already guards this with sayGen.
        if (epoch !== speechEpochRef.current) { finish(); res(false); return; }
        if (synth.speaking || synth.pending) synth.cancel();
        setTimeout(() => {
          if (epoch !== speechEpochRef.current) { finish(); res(false); return; }
          synth.speak(u);
        }, 60);
      }, 120);
      // Enhanced and Premium voices load from disk on first use. 1.1s was
      // cancelling them mid-load and reporting it as a dead path.
      setTimeout(() => { if (!ok) { traceAdd(`⏱ ${v.name}: silent 3s`); synth.cancel(); finish(); res(false); } }, 3000);
    });
  }

  function sayLocal(short, slot) {
    return new Promise((res) => whenVoicesReady(async () => {
      if (!window.speechSynthesis) return res(false);
      // Brady's explicit pick beats everything; then a voice that already
      // spoke; then the scorer's ranking.
      const vs = window.speechSynthesis.getVoices();
      const picked = voiceChoiceRef.current ? vs.find((v) => v.name === voiceChoiceRef.current) : null;
      if (picked && (await tryVoice(picked, short, slot))) return res(true);
      const known = voiceRef.current;
      if (known && known !== picked && (await tryVoice(known, short, slot))) return res(true);
      for (const v of rankedLocals().filter((v) => v !== known && v !== picked).slice(0, 3)) {
        if (await tryVoice(v, short, slot)) return res(true);
      }
      res(false); // every candidate stayed silent — fall through to another path
    }));
  }

  // Path 2 — Mic Bridge popup does the speaking (top-level engine)
  function sayViaBridge(short, slot) {
    return new Promise((res) => {
      const w = popupRef.current;
      if (!w || w.closed) return res(false);
      let settled = false;
      const token = armSpeechEnd();
      bridgeEndRef.current = () => releaseSpeechEnd(token);
      if (slot) {
        slot.token = token;
        slot.finish = () => {
          speakingRef.current = false; setSpeaking(false);
          bridgeEndRef.current = null;
          postBridge("stopSay"); postBridge("micResume");
          releaseSpeechEnd(token);
        };
      }
      bridgeAckRef.current = () => { if (!settled) { settled = true; res(true); } };
      w.postMessage({ ch: "EMBERMIC", t: "say", text: short }, "*");
      setTimeout(() => {
        if (settled) return;
        settled = true;
        // Giving up on the bridge is not the same as the bridge giving up. It
        // may still be waiting on getVoices() and start talking a second later,
        // over the top of whichever path we fall back to. Tell it to drop the
        // utterance before we hand the answer to someone else.
        bridgeEndRef.current = null;
        postBridge("stopSay");
        releaseSpeechEnd(token);
        res(false);
      }, 1500);
    });
  }

  // Path 3 — MP3 TTS through an <audio> element: no speech engine involved at all
  function playMp3(short, slot) {
    return new Promise((res) => {
      try {
        // Never leave two answers playing over each other.
        const prev = audioElRef.current;
        if (prev) { try { prev.pause(); } catch (e) {} }
        const epoch = beginSpeech();
        const token = armSpeechEnd();
        const a = new Audio("https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=" + encodeURIComponent(short.slice(0, 290)));
        audioElRef.current = a;
        let ok = false;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (epoch === speechEpochRef.current) { speakingRef.current = false; setSpeaking(false); }
          endSpeech(epoch);
          releaseSpeechEnd(token);
        };
        if (slot) { slot.token = token; slot.finish = finish; }
        a.onplaying = () => {
          traceAdd("▶ speaking: mp3 fallback (Brian)");
          ok = true;
          if (epoch === speechEpochRef.current) { speakingRef.current = true; setSpeaking(true); }
          res(true);
        };
        a.onended = finish;
        a.onerror = () => { finish(); if (!ok) res(false); };
        // A play() rejection fires no error event — reopen the gate here or the
        // mic stays shut with nothing playing.
        a.play().catch(() => { finish(); if (!ok) res(false); });
        // Abandoning a element that never started is not enough — it can still
        // buffer and start playing after we have moved on, talking over the
        // path that replaced it.
        setTimeout(() => {
          if (!ok) { try { a.pause(); } catch (e) {} if (audioElRef.current === a) audioElRef.current = null; finish(); res(false); }
        }, 2500);
      } catch (e) { res(false); }
    });
  }

  async function speakCascade(short, slot) {
    if (await sayLocal(short, slot)) { ttsPathRef.current = "local"; return true; }
    if (await sayViaBridge(short, slot)) { ttsPathRef.current = "bridge"; return true; }
    if (await playMp3(short, slot)) { ttsPathRef.current = "mp3"; return true; }
    return false;
  }

  // Resolves when she has stopped talking, not when she starts. Callers serialize
  // on that: a queued command must not cut the current answer off mid-sentence,
  // and two overlapping utterances would interleave their gate messages.
  async function speak(text) {
    // voiceOn off the ref, not the closure: speak() is awaited from sendCommand
    // long after render, so muting while she was thinking still spoke the answer.
    if (!voiceOnRef.current || !text) return;
    const short = text.length > 380 ? text.slice(0, 380) + "… full answer on screen." : text;
    lastSpokenRef.current = normalizeHeard(short);
    lastSpokenAtRef.current = performance.now();
    // Phones: wait for the mic to actually surrender the audio channel, or the
    // whole utterance plays into a closed session and comes out silent. The
    // session's onend is necessary but iOS deactivates the underlying audio
    // session AFTER that, on its own clock — the extra settle is for the gap
    // TEST-works-but-replies-are-silent lives in.
    if (hasSR) {
      const t0 = performance.now();
      await pauseInlineMic();
      if (isPhone) await new Promise((r) => setTimeout(r, 550));
      traceAdd(`reply ${short.length}ch · mic freed ${Math.round(performance.now() - t0)}ms · path ${ttsPathRef.current || "audition"}`);
    }
    releaseSpeechEnd();
    speechEndRef.current = null;
    const p = ttsPathRef.current;
    // The path writes the token it armed in here. Re-reading the shared ref at
    // the end would sample whatever utterance armed LAST, so a short prompt's
    // ceiling could end a long answer that started after it.
    const slot = { token: undefined, finish: null };
    let started = false;
    if (p === "local") started = await sayLocal(short, slot);
    else if (p === "bridge") started = await sayViaBridge(short, slot);
    else if (p === "mp3") started = await playMp3(short, slot);
    if (!started) {
      ttsPathRef.current = null;
      started = await speakCascade(short, slot);
    }
    if (!started) {
      traceAdd("✕ every path silent — gave up");
      setError("No speech path worked — hit VOICE TEST under the core and read me the amber line.");
      return;
    }
    // Never await this bare. Every permanent lockup in this feature has been
    // some path forgetting to resolve; a caller that cannot hang turns the
    // whole class of bug into "the mic reopens a bit early" instead of "the app
    // is dead until reload". Ceiling is well past the longest real utterance —
    // 380 chars at rate 1.03 is roughly 30s.
    if (speechEndRef.current) {
      // Sized off spoken time, not source characters: the engine expands
      // numbers, times and prices, so "$1,250 at 5:45" is a handful of
      // characters and several seconds of speech. Erring long is nearly free —
      // the end signal almost always arrives first — while erring short
      // reopens the mic while she is still talking, which is the whole bug.
      const ceiling = Math.min(60000, 8000 + short.length * 140);
      let bail;
      let timedOut = false;
      await Promise.race([
        speechEndRef.current,
        new Promise((r) => { bail = setTimeout(() => { timedOut = true; r(); }, ceiling); }),
      ]);
      clearTimeout(bail);
      // If the ceiling won, the path never signalled an end -- a stalled audio
      // element fires neither ended nor error. Run its finisher so the gate
      // reopens; releasing the promise alone leaves the mic shut for good.
      if (timedOut && slot.finish) slot.finish();
      else if (slot.token !== undefined) releaseSpeechEnd(slot.token);
    }
    // Restamp on the way out: the echo window should run from when she stopped
    // talking, not from when she started.
    lastSpokenAtRef.current = performance.now();
  }

  async function testVoice() {
    setVoiceDiag("TESTING — chime first, then a voice…");
    // testVoice is the one speak path not serialized by busyRef, and arming a
    // new utterance force-releases whatever is live. Without stopping her
    // first, the test voice talks over an answer still coming from the bridge
    // or the mp3 element -- two engines, no gate.
    stopSpeaking();
    try { chime(); } catch (e) {}
    ttsPathRef.current = null;
    const ok = await speakCascade("Ember online. Brady, can you hear me?");
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const locals = vs.filter((v) => v.localService);
    // Name the voice on success and the rejects on failure — "all paths failed"
    // alone doesn't say whether the picker chose badly or the engine is dead.
    // testVoice speaks through speakCascade directly, but speak() bails when voice is
    // toggled off — so a passing test while muted told Brady the engine was fine when in
    // fact every reply was landing silent. Say that plainly instead.
    setVoiceDiag(ok
      ? (voiceOnRef.current
          ? "WORKING — PATH " + ttsPathRef.current.toUpperCase() + " · " + (voiceRef.current ? voiceRef.current.name : "?") + " · " + vs.length + " VOICES (" + locals.length + " LOCAL)"
          : "ENGINE WORKS — BUT VOICE IS OFF, SO REPLIES STAY SILENT. TAP VOICE OFF BELOW TO TURN IT ON.")
      : "ALL TTS PATHS FAILED · TRIED " + (rankedLocals().slice(0, 3).map((v) => v.name).join(", ") || "no english local voice") + " · " + vs.length + " VOICES (" + locals.length + " LOCAL) · DID THE CHIME PLAY?");
  }

  function stopSpeaking() {
    // Retire the epoch first so no in-flight handler can reopen the mic behind
    // us, then reopen it ourselves — pause() fires neither ended nor error, so
    // nothing else ever would, and the mic would stay dead for good.
    speechEpochRef.current++;
    window.speechSynthesis?.cancel();
    if (audioElRef.current) { try { audioElRef.current.pause(); } catch (e) {} audioElRef.current = null; }
    speakingRef.current = false;
    setSpeaking(false);
    bridgeEndRef.current = null;
    // pause() fires neither ended nor error, and both watchdogs are guarded on
    // "never started" — so on the stop path nothing else in the app will ever
    // resolve this. Release it here or speak() waits forever and every command
    // after this one is queued behind an answer that already stopped.
    releaseSpeechEnd();
    postBridge("stopSay");
    postBridge("micResume");
    resumeInlineMic();
  }

  /* ---------- OPS: VOICE ENGINE + CORE VISUALIZER ---------- */

  // pick the most natural TTS voice available on this device
  useEffect(() => {
    const pick = () => {
      const vs = window.speechSynthesis?.getVoices() || [];
      const en = vs.filter((v) => v.lang && v.lang.startsWith("en"));
      // Chromium bug 374263394: network voices (Google *) silently produce no audio
      // on Chrome 130+ — local voices are the only reliable path. Score local-first.
      const score = (v) => {
        let s = 0;
        if (v.localService) s += 100;
        if (/premium|enhanced|natural|neural/i.test(v.name)) s += 40;
        if (/samantha|alex|aria|zira|david|daniel|karen|moira/i.test(v.name)) s += 25;
        if (v.lang === "en-US") s += 10;
        return s;
      };
      voiceRef.current = en.slice().sort((a, b) => score(b) - score(a))[0] || null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.("voiceschanged", pick);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", pick);
  }, []);

  // Chrome only allows TTS after a user gesture — prime it on the first click
  useEffect(() => {
    const prime = () => {
      try {
        const synth = window.speechSynthesis;
        synth?.resume();
        const local = synth?.getVoices().find((v) => v.localService && v.lang && v.lang.startsWith("en"));
        if (local) {
          const u = new SpeechSynthesisUtterance(" ");
          u.voice = local; u.lang = local.lang; u.volume = 0;
          synth.speak(u);
        }
      } catch (e) {}
      window.removeEventListener("pointerdown", prime);
    };
    window.addEventListener("pointerdown", prime);
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  // one RAF loop drives both cores through refs — zero React re-renders per frame
  useEffect(() => {
    let raf;
    const loop = (t) => {
      const b = bridgeLevelRef.current;
      const fresh = performance.now() - b.ts < 300;
      let target = 0;
      let wave = null;
      if (fresh) { target = b.v; wave = b.wave; }
      else if (speakingRef.current) { target = 0.28 + 0.22 * Math.abs(Math.sin(t / 130)) + 0.1 * Math.abs(Math.sin(t / 47)); }
      levelRef.current += (target - levelRef.current) * 0.2;
      const lvl = levelRef.current;

      // ENIGMA gas — swells with sound, colors oscillate as decibels climb
      if (gasRef.current) {
        const hue = Math.sin(t / 200) * lvl * 60;
        gasRef.current.style.transform = `scale(${1 + lvl * 0.28})`;
        gasRef.current.style.filter = `hue-rotate(${hue}deg) brightness(${1 + lvl * 0.55}) saturate(${1 + lvl * 0.5})`;
      }

      // Pressure-release glow on voice inflection (real mic input only) —
      // a brass ring vents outward from the instrument and settles
      if (fresh && ventRef.current) {
        if (target > 0.45 && prevLvlRef.current < 0.28 && t - lastVentRef.current > 420) {
          lastVentRef.current = t;
          const el = document.createElement("span");
          el.className = "vent-ring";
          ventRef.current.appendChild(el);
          setTimeout(() => el.remove(), 950);
        }
        prevLvlRef.current = target;
      }

      // SCOPE — solid amber line at rest, real waveform when sound flows
      const cv = scopeRef.current;
      if (cv) {
        const g = cv.getContext("2d");
        const W = cv.width, H = cv.height, mid = H / 2;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = "rgba(255,158,61,.14)";
        g.lineWidth = 1;
        for (let x = 0; x <= W; x += W / 10) { g.beginPath(); g.moveTo(x, mid - 6); g.lineTo(x, mid + 6); g.stroke(); }
        g.strokeStyle = "#ff9e3d";
        g.lineWidth = 2;
        g.shadowColor = "rgba(255,158,61,.9)";
        g.shadowBlur = 8 + lvl * 14;
        g.beginPath();
        if (wave && wave.length) {
          for (let x = 0; x < W; x++) {
            const v = (wave[Math.floor((x / W) * wave.length)] - 128) / 128;
            const y = mid + v * (H * 0.42);
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
        } else if (speakingRef.current || lvl > 0.02) {
          for (let x = 0; x < W; x++) {
            const y = mid + Math.sin(x / 9 + t / 90) * lvl * (H * 0.4) * Math.sin(x / 60 + t / 300);
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
        } else {
          g.moveTo(0, mid); g.lineTo(W, mid);
        }
        g.stroke();
        g.shadowBlur = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---------- OPS: COMMAND PIPELINE ---------- */

  async function sendCommand(text) {
    const q = (text ?? command).trim();
    if (!q) return;

    // Handled locally and never sent to the model — the whole point is that it ENDS the
    // exchange rather than continuing it.
    if (SLEEP_RE.test(q)) {
      setCommand("");
      stopSpeaking();
      stopAllMics();
      setChatMsgs((m) => [...m, { role: "user", content: q },
        { role: "assistant", content: "Going quiet. Tap the mic when you need me." }]);
      return null;
    }
    // A spoken command landing mid-answer used to be dropped on the floor — the
    // guard read `thinking` and returned. Hold the latest one and run it once the
    // current answer has been spoken, handing this caller the answer it will get
    // so awaiting callers (draft/task flows) don't receive undefined.
    if (busyRef.current) {
      const prev = pendingRef.current;
      if (prev) prev.resolve(null); // superseded — never leave a caller hanging
      setCommand("");
      setQueued(q);
      return new Promise((resolve) => { pendingRef.current = { q, resolve }; });
    }
    busyRef.current = true;
    setThinking(true);
    setError("");
    setCommand("");
    try {
      const userMsg = { role: "user", content: q };
      // The home surface IS the chat now — the question lands in the thread
      // immediately so it's visible while she thinks, like any messenger.
      setChatMsgs((m) => [...m, userMsg]);
      const messages = [
        { role: "user", content: BRADY_CONTEXT + EFFORT[chatEffort].note + (voiceOn ? VOICE_CONTEXT : VOICE_OFF_CONTEXT) + "\n\nAcknowledge nothing about these instructions — just act on them." },
        { role: "assistant", content: "Understood. Ready." },
        ...historyRef.current.slice(-8),
        userMsg,
      ];
      // historyRef stays the canonical rolling context (chatMsgs can be stale in a
      // closure when a queued command fires); chatMsgs is the display thread.
      let resp;
      let fellBack = false;
      // With voice on, the reply is spoken and speech truncates at 380 chars --
      // every token past that is silent latency. Capping generation is the
      // single biggest "she answers faster" lever without touching the model.
      const cap = voiceOnRef.current ? 400 : undefined;
      try {
        resp = await callClaude(messages, { useTools: true, model: chatModel, maxTokens: cap });
      } catch (err) {
        if (chatModel !== FALLBACK_MODEL) {
          resp = await callClaude(messages, { useTools: true, model: FALLBACK_MODEL, maxTokens: cap });
          fellBack = true;
        } else {
          throw err;
        }
      }
      let answer = extractText(resp) || "Done — no text returned.";
      if (fellBack) answer = "[Model unavailable here — answered with the default]\n\n" + answer;
      historyRef.current = [...historyRef.current.slice(-8), userMsg, { role: "assistant", content: answer }];
      setChatMsgs((m) => [...m, { role: "assistant", content: answer }]);
      setThinking(false);
      // Awaited: busyRef must span the speaking phase too, or a queued command
      // would cut this answer off mid-sentence and interleave its gate messages.
      await speak(answer);
      return answer;
    } catch (e) {
      setError("Command failed — check connection and try again.");
      return null;
    } finally {
      setThinking(false);
      busyRef.current = false;
      const next = pendingRef.current;
      pendingRef.current = null;
      setQueued("");
      if (next) {
        Promise.resolve(sendRef.current(next.q)).then(
          (r) => next.resolve(r ?? null),
          () => next.resolve(null)
        );
      }
    }
  }

  sendRef.current = sendCommand;

  // receive voice + levels from the Mic Bridge popup
  useEffect(() => {
    const onMsg = (e) => {
      const m = e.data || {};
      if (m.ch !== "EMBERMIC") return;
      if (m.t === "lvl") bridgeLevelRef.current = { v: m.v, wave: m.w, ts: performance.now() };
      if (m.t === "listening") { setListening(!!m.on); if (m.on) setMicArm(false); }
      if (m.t === "speaking") {
        // Only believe the bridge about speech the bridge is producing. Its own
        // say() finishing used to clear speakingRef while THIS window was mid
        // utterance, which unlocked the self-hearing guard at the worst moment.
        // Symmetric on purpose. Honouring "on" unconditionally but "off" only
        // while the proven path is still "bridge" meant a late bridge utterance
        // — one we already timed out on and replaced — could switch speaking ON
        // and then have its OFF discarded, latching the self-hearing guard shut
        // so every spoken command after it was dropped in silence.
        const oursToBelieve = ttsPathRef.current === "bridge" || !!bridgeEndRef.current;
        if (oursToBelieve) {
          speakingRef.current = !!m.on;
          setSpeaking(!!m.on);
        }
        if (m.on) bridgeAckRef.current?.();
        if (!m.on && bridgeEndRef.current) { bridgeEndRef.current(); bridgeEndRef.current = null; }
      }
      if (m.t === "closed") {
        setListening(false); speakingRef.current = false; setSpeaking(false); popupRef.current = null;
        // The popup's own note invites closing it, and closing it mid-answer
        // posts "closed" but never "speaking off" — so the speech we were
        // waiting on ends with nothing to announce it.
        // Only end speech the BRIDGE was producing. TTS is often local or mp3
        // while the popup is merely listening; releasing unconditionally cut
        // her off mid-sentence the moment he closed the mic window.
        const endBridge = bridgeEndRef.current;
        bridgeEndRef.current = null;
        if (endBridge) endBridge();
      }
      if (m.t === "transcript" && m.text) {
        // Two layers, because the gate closes a beat after speech starts and a
        // recognition result lands a beat after speech stops: drop anything heard
        // while she is speaking, and drop anything that is recognisably her own
        // last answer coming back through the speakers.
        if (!speakingRef.current && !isEcho(m.text)) sendRef.current(m.text);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  /* ---------- OPS: SYNC LIVE DATA ---------- */

  async function syncLive() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const prompt = `${BRADY_CONTEXT}

Fetch, using your tools:
1. Missed calls and voicemails from BOTH Quo inboxes (Fishing 218-325-6857, Pontoon 218-325-9846), last 48 hours. Include voicemail transcripts when present.
2. Up to 5 unread Gmail messages from the last 24 hours.
3. Calendar events for today and tomorrow.

Then respond with ONLY valid JSON — no markdown, no commentary:
{"voicemails":[{"from":"","line":"Fishing or Pontoon","time":"","note":"","vm":"transcript or empty"}],"emails":[{"from":"","time":"","subject":""}],"events":[{"time":"","title":"","detail":""}]}`;
      const resp = await callClaude([{ role: "user", content: prompt }], { useTools: true });
      const parsed = extractJSON(extractText(resp));
      setData({
        voicemails: parsed.voicemails?.length ? parsed.voicemails : [{ from: "—", line: "", time: "", note: "No missed calls in the last 48h.", vm: "" }],
        emails: parsed.emails?.length ? parsed.emails : [{ from: "—", time: "", subject: "Inbox zero — no unread." }],
        events: parsed.events?.length ? parsed.events : [{ time: "—", title: "Nothing scheduled.", detail: "" }],
      });
      setLive(true);
    } catch (e) {
      setError("Sync failed — showing demo data. Try again.");
    } finally {
      setSyncing(false);
    }
  }

  /* ---------- STUDIO: CAPTION PIPELINE ---------- */

  /* Take one or many files. `replace` starts a fresh post; otherwise the files are
     appended to the existing carousel up to MAX_PHOTOS. Anything past the cap is reported
     rather than dropped in silence. */
  async function handleFiles(fileList, { replace = false } = {}) {
    const incoming = Array.from(fileList || []).filter((file) => {
      // iOS sometimes hands over a HEIC with an empty MIME type, so fall back to the
      // extension when there's no usable type string.
      return file.type ? /^image\//i.test(file.type) : /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name || "");
    });
    if (!incoming.length) return;

    const room = replace ? MAX_PHOTOS : MAX_PHOTOS - photos.length;
    if (room <= 0) { setCapErr(`That's the ${MAX_PHOTOS}-photo limit for one carousel.`); return; }
    const take = incoming.slice(0, room);
    const overflow = incoming.length - take.length;

    setCapErr(overflow ? `Added ${take.length} — ${overflow} over the ${MAX_PHOTOS}-photo carousel limit.` : "");
    setCaption("");
    setFishId(null);
    try {
      const rendered = [];
      for (const file of take) rendered.push(await renderPhoto(file));
      const next = replace ? rendered : [...photos, ...rendered];
      setPhotos(next);
      analyzePhoto(next);
    } catch (e) {
      const wasHeic = take.some((f) => /image\/(heic|heif)/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || ""));
      setCapErr(wasHeic
        ? "Couldn't decode that HEIC on this device — in iPhone Settings ▸ Camera ▸ Formats pick \"Most Compatible\", or share it as a JPG."
        : "Couldn't read that image — try a JPG or PNG.");
    }
  }

  function removePhoto(i) {
    setPhotos((list) => {
      const next = list.filter((_, idx) => idx !== i);
      if (!next.length) { setFishId(null); setCaption(""); }
      return next;
    });
  }

  /* One tap on a TALL flag crops that slide's feed render to 4:5. The tall original
     survives on the photo as storyB64, so stories keep the full frame. */
  async function fitPhoto45(i) {
    const p = photos[i];
    if (!p) return;
    try {
      const fixed = await cropPublishTo45(p);
      setPhotos((list) => list.map((q, idx) => (idx === i ? fixed : q)));
    } catch (e) {
      setCapErr("Couldn't crop that photo — remove it and re-add it.");
    }
  }

  /* Scan the whole set in ONE vision call — the carousel gets a single caption, so the
     model needs to see every slide before it names a species or a sponsor. Sponsors that
     aren't visually identifiable (Detroit Lake, J&K Marine) keep whatever Brady set. */
  async function analyzePhoto(shots) {
    const set = (shots || []).filter(Boolean);
    if (!set.length) return;
    setAnalyzing(true);
    setSponsors((s) => {
      const next = blankSponsors();
      SPONSOR_KEYS.forEach((k) => { if (!SPONSORS[k].detect) next[k] = s[k]; });
      return next;
    });
    try {
      const detectLines = SPONSOR_KEYS
        .filter((k) => SPONSORS[k].detect)
        .map((k) => `- ${SPONSORS[k].detect}: ${SPONSOR_VISION_HINT[k]}`)
        .join("\n");
      const detectFields = SPONSOR_KEYS
        .filter((k) => SPONSORS[k].detect)
        .map((k) => `"${SPONSORS[k].detect}":true or false`)
        .join(",");
      const resp = await callClaude(
        [{
          role: "user",
          content: [
            ...set.map((p) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.b64 } })),
            { type: "text", text: `Analyze ${set.length === 1 ? "this fishing photo" : `these ${set.length} fishing photos — they are one carousel post, so answer for the set as a whole`}. Respond with ONLY valid JSON, no markdown:
{"species":"specific common name, e.g. Smallmouth Bass — or 'No fish detected'","confidence":"high|medium|low",${detectFields},"notes":"one short line about the shot"}

Brand detection — be CONSERVATIVE. Only true if you can actually see it; a wrong tag notifies the wrong company:
${detectLines}` },
          ],
        }],
        { useTools: false }
      );
      const parsed = extractJSON(extractText(resp));
      setFishId({ species: parsed.species || "Unknown", confidence: parsed.confidence || "low", notes: parsed.notes || "" });
      setSponsors((s) => {
        const next = { ...s };
        SPONSOR_KEYS.forEach((k) => {
          const key = SPONSORS[k].detect;
          if (!key) return;
          const hit = !!parsed[key];
          next[k] = { on: hit, detected: hit };
        });
        return next;
      });
    } catch (e) {
      setFishId({ species: "Unknown", confidence: "low", notes: "" });
      setCapErr("Vision scan failed — you can still generate a caption.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function generateCaption() {
    if (!photos.length || genBusy) return;
    setGenBusy(true);
    setCapErr("");
    setCopied(false);
    try {
      const handles = activeHandles(sponsors);
      const prompt = `You write Instagram/Facebook captions for Baxstar Fishing — premium guided fishing out of Detroit Lakes, MN. Voice: premium-but-warm, confident, first-person from the guide. Specific beats generic.

Photo context:
- ${photos.length === 1 ? "A single photo." : `${photos.length} photos — ONE carousel post. Write a single caption that covers the set, not slide-by-slide.`}
- Species: ${fishId?.species || "Unknown"} (${fishId?.confidence || "low"} confidence — trust what you see in the photo)
- Lake: ${lake || "Pelican Lake"}
- Posting window: ${fmtPostTime(postTime)}
- Sponsor handles to tag naturally inline: ${handles.length ? handles.join(", ") : "none"}

HARD RULES:
- NEVER mention Scheels or Scheels rods in any form.
- Never say "one group per day" or "one trip per day". If referencing exclusivity, say "private trip(s)".
- Do NOT include the hashtag ${LOCKED_TAG} — it is appended automatically.
- At most 3 other hashtags, at the very end. The post is hard-capped at ${MAX_HASHTAGS} total and extras are trimmed, so make the ones you pick count. 1-3 tasteful emojis max.
- 60-120 words with line breaks for rhythm.

Look at the ${photos.length === 1 ? "photo" : "photos"} and write the caption. Output caption text only — no preamble.`;
      const resp = await callClaude(
        [{
          role: "user",
          content: [
            ...photos.map((p) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.b64 } })),
            { type: "text", text: prompt },
          ],
        }],
        { useTools: false }
      );
      const raw = extractText(resp);
      if (!raw) throw new Error("empty");
      setCaption(sanitizeCaption(raw));
    } catch (e) {
      setCapErr("Caption generation failed — try again.");
    } finally {
      setGenBusy(false);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(assembleCaption(caption, sponsors).text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setCapErr("Clipboard blocked — select and copy manually.");
    }
  }

  // Live hashtag budget for the caption panel — recomputed as Brady edits the textarea.
  const capState = capCaptionTags(sanitizeCaption(caption || ""));

  function toggleSponsor(key) {
    setSponsors((s) => ({ ...s, [key]: { ...s[key], on: !s[key].on } }));
  }

  function saveOutboxUrl(u) {
    const v = (u || "").trim();
    // Emptying the field means "go back to the built-in endpoint", not "break publishing".
    if (v && v !== DEFAULT_OUTBOX_URL) { setOutboxUrl(v); lsSet(OUTBOX_URL_KEY, v); }
    else { setOutboxUrl(v || DEFAULT_OUTBOX_URL); lsDel(OUTBOX_URL_KEY); }
  }

  function discardDraft() {
    lsDel(CAPTION_DRAFT_KEY);
    setCaptionRestored(false);
    setPhotos([]); setCaption(""); setFishId(null);
    setSponsors(blankSponsors());
  }

  /* Publish the finished JPEG + caption to Brady's private Drive outbox (an Apps Script
     web app — see apps-script/outbox/Code.gs). This does NOT post to Instagram/Facebook;
     it drops a ready-to-post pair into Drive for review. The endpoint is set once in the
     outbox settings. Apps Script web apps choke on CORS preflight, so we send a
     "simple" text/plain request and, if the browser still blocks reading the response,
     fall back to an opaque no-cors write (the file still lands; we just can't read a
     confirmation). */
  async function publishToOutbox() {
    if (!photos.length || !caption || publishing) return;
    const url = (outboxUrl || "").trim();
    if (!url) { setPublishMsg("Add your Drive Outbox URL first — the field is in the left panel."); return; }
    const picked = SURFACES.filter((sf) => surfaces[sf.id] && !sf.needsVideo).map((sf) => sf.id);
    if (!picked.length) { setPublishMsg("Pick at least one destination — tap IG FEED, a story, or FB PAGE."); return; }
    // Feed-aspect gate. A slide taller than 4:5 headed for a feed surface will be
    // machine-cropped or rejected by Meta at post time — hours from now, silently.
    // First press warns and names the slides; a second press is Brady's explicit
    // "send as-is" and goes through. Stories never trip this — 9:16 is their shape.
    const feedPicked = picked.includes("ig_feed") || picked.includes("fb_page");
    const tallSlides = photos.map((p, i) => (tallForFeed(p) ? i + 1 : 0)).filter(Boolean);
    if (feedPicked && tallSlides.length && !tallOkRef.current) {
      tallOkRef.current = true;
      setPublishMsg(
        (tallSlides.length === 1 ? `Slide ${tallSlides[0]} is` : `Slides ${tallSlides.join(", ")} are`) +
        " taller than Instagram's 4:5 feed limit — Meta will crop or reject at post time. Tap FIT 4:5 on the flagged photo, or hit Publish again to send as-is."
      );
      return;
    }
    setPublishing(true);
    setPublishMsg("");
    // Stories consume a 9:16 render; build them only when a story surface is on,
    // and only now — at upload time it would slow every photo for a format that
    // is usually off.
    let storyImages = [];
    if (picked.includes("ig_story") || picked.includes("fb_story")) {
      try {
        // storyB64 is the pre-crop original when a slide was fitted to 4:5 for the
        // feed — a story should show the full tall frame Brady shot, not the crop.
        storyImages = await Promise.all(photos.map((p) => renderStoryFromB64(p.storyB64 || p.publishB64 || p.b64)));
      } catch (e) {
        setPublishing(false);
        setPublishMsg("Story render failed — post without the story surfaces or re-add the photo.");
        return;
      }
    }

    /* Two forms of the caption travel together, because they are consumed differently:

       `caption` omits the @handles. Sponsor handles ride as ON-PHOTO Instagram tags (Meta
       user_tags, which is the version that actually notifies the account), so repeating
       them in the caption body would tag everyone twice.

       `captionWithHandles` is the copy-paste form, kept for a manual post or for a
       destination like Google Business Profile that has no photo-tag concept. */
    const forPost = assembleCaption(caption, sponsors, { withHandles: false });
    const forHumans = assembleCaption(caption, sponsors, { withHandles: true });

    const payload = {
      source: "ember-caption-studio",
      caption: forPost.text,
      captionWithHandles: forHumans.text,
      lockedTag: LOCKED_TAG,
      hashtagCount: forPost.total,
      // Full-quality publish renders, first slide first. imageBase64 repeats slide one so
      // an outbox deployed before carousel support still writes something usable.
      images: photos.map((p) => p.publishB64 || p.b64),
      imageBase64: photos[0].publishB64 || photos[0].b64,
      mimeType: "image/jpeg",
      species: fishId?.species || "",
      // The lake NAME as a plain string, never a location ID. A publish attempt on
      // 2026-07-07 failed outright because Zapier auto-guessed a location ID and Meta
      // rejected it — the name (or an empty value) is the only thing that works.
      lake,
      // Label for humans; postAt is the machine field a Delay-Until step consumes.
      postWindow: fmtPostTime(postTime),
      postAt: nextPostAt(postTime),
      postTimeLocal: postTime,
      sponsors: activeHandles(sponsors),
      clientTime: new Date().toISOString(),
      /* v2: where this goes and in what shape. Old outbox deployments ignore
         unknown fields, so nothing breaks behind; the Zap branches on these. */
      payloadVersion: 2,
      format: photos.length > 1 ? "carousel" : "post",
      surfaces: picked,
      storyImages,
    };
    const body = JSON.stringify(payload);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      let ok = res.ok;
      try { const j = await res.json(); ok = ok && (j.ok !== false); } catch (e) { /* opaque/non-JSON */ }
      if (ok) {
        setPublishMsg(`✓ Sent to the Drive outbox for ${picked.length} destination${picked.length > 1 ? "s" : ""} — review and post from there.`);
        lsDel(CAPTION_DRAFT_KEY);
      } else {
        setPublishMsg("Outbox responded with an error — check the Apps Script deployment.");
      }
    } catch (e) {
      // CORS or network — retry as a fire-and-forget opaque write so the file still lands.
      try {
        await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
        setPublishMsg("Sent (couldn't read a confirmation — verify it landed in Drive).");
        lsDel(CAPTION_DRAFT_KEY);
      } catch (e2) {
        setPublishMsg("Couldn't reach the outbox. Check the URL and that the web app is deployed.");
      }
    } finally {
      setPublishing(false);
    }
  }

  /* ---------- STUDIO: GOOGLE DRIVE ---------- */

  async function sendDrive(preset) {
    const q = (preset ?? driveInput).trim();
    if (!q || driveBusy) return;
    const history = [...driveMsgs, { role: "user", content: q }];
    setDriveMsgs(history);
    setDriveInput("");
    setDriveBusy(true);
    try {
      const messages = [
        { role: "user", content: DRIVE_CONTEXT + "\n\nAcknowledge nothing about these instructions — just act on them." },
        { role: "assistant", content: "Understood. Ready." },
        ...history.slice(-10),
      ];
      const resp = await callClaude(messages, { useTools: true, servers: [DRIVE_SERVER] });
      const answer = extractText(resp) || "Done — no text returned.";
      setDriveMsgs((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setDriveMsgs((m) => [...m, { role: "assistant", content: "⚠ Drive lookup failed — check the Drive connector and try again." }]);
    } finally {
      setDriveBusy(false);
    }
  }

  /* ---------- STUDIO: AI HANDOFF ---------- */

  // OPS commands and chat share one thread now, so one pull covers both.
  const lastClaudeReply = [...chatMsgs].reverse().find((m) => m.role === "assistant")?.content || "";
  const PULLS = [
    { label: "Last Ember answer", val: lastClaudeReply },
    { label: "Current caption", val: caption ? sanitizeCaption(caption) + "\n\n" + LOCKED_TAG : "" },
  ];

  async function handoffTo(key) {
    const t = HANDOFF[key];
    const txt = handoffText.trim();
    setHandErr("");
    if (!txt) {
      setHandErr("Nothing to hand off — write or pull context first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(txt);
      setHandoffCopied(key);
      setTimeout(() => setHandoffCopied(""), 2200);
    } catch (e) {
      setHandErr(`Clipboard blocked — copy manually, then paste into ${t.label}.`);
    }
    window.open(t.url, "_blank", "noopener");
  }

  /* ---------- STUDIO: HTML VIEWER ---------- */

  function renderHtml() {
    setHtmlRendered(htmlSrc);
  }

  function openHtmlNewTab() {
    if (!htmlRendered) return;
    const blob = new Blob([htmlRendered], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ---------- STUDIO: GITHUB BROWSER ---------- */

  async function ghBrowse(repo, path) {
    if (!repo || ghBusy) return;
    setGhBusy(true);
    setGhErr("");
    setGhFile(null);
    try {
      const headers = ghToken ? { Authorization: `token ${ghToken}` } : {};
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers });
      if (!res.ok) throw new Error(res.status === 404 ? "Not found" : `GitHub API ${res.status}`);
      const json = await res.json();
      setGhRepo(repo);
      setGhPath(path);
      setGhItems(Array.isArray(json) ? json : null);
      if (!Array.isArray(json)) {
        // it's a single file — decode and show
        const content = json.encoding === "base64" ? atob(json.content.replace(/\n/g, "")) : json.content;
        setGhFile({ name: json.name, content, htmlUrl: json.html_url });
      }
    } catch (e) {
      setGhErr(e.message === "Not found" ? "Not found — check the path." : "GitHub request failed — check the repo, path, and token (private repos need one).");
    } finally {
      setGhBusy(false);
    }
  }

  function ghOpenItem(item) {
    if (item.type === "dir") {
      ghBrowse(ghRepo, item.path);
    } else {
      ghBrowse(ghRepo, item.path);
    }
  }

  function ghGoUp() {
    if (!ghPath) return;
    const parts = ghPath.split("/");
    parts.pop();
    ghBrowse(ghRepo, parts.join("/"));
  }

  /* ---------- STUDIO: SNIPPETS ---------- */

  async function copySnippet(i, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSnippet(i);
      setTimeout(() => setCopiedSnippet(-1), 1500);
    } catch (e) { /* clipboard blocked — silent, chip just won't confirm */ }
  }

  /* ---------- CONTEXT LEVERS: Draft Reply + Create Task ---------- */

  const commItem = selectedComm
    ? (selectedComm.type === "vm" ? data.voicemails[selectedComm.i] : data.emails[selectedComm.i]) || null
    : null;

  function leverState(kind) {
    if (leverBusy === kind) return "active";
    if (!commItem) return "idle";
    if (leverPending === kind) return "pending";
    return "ready";
  }

  function commLabel() {
    if (!commItem) return "";
    return selectedComm.type === "vm"
      ? `call/voicemail from ${commItem.from}${commItem.line ? " (" + commItem.line + " line)" : ""}`
      : `email from ${commItem.from}: "${commItem.subject}"`;
  }

  async function leverDraftReply() {
    if (!commItem || leverBusy || thinking) return;
    setLeverPending(null); setDraftEdit(null); setTaskProposal(null);
    setLeverBusy("draft");
    try {
      const prompt = selectedComm.type === "vm"
        ? `Draft a reply text to ${commItem.from} on the ${commItem.line || "Fishing"} Quo line responding to: "${commItem.vm || "their missed call — apologize we missed them and ask how we can help"}". Premium-but-warm, BLUF, sign Brady @ Baxstar. Show me the draft — don't send yet.`
        : `Draft a reply to the email from ${commItem.from}: "${commItem.subject}". Match Baxstar voice. Show me the draft — don't send yet.`;
      const answer = await sendCommand(prompt);
      if (answer) { setDraftEdit(answer); setLeverPending("draft"); }
    } finally {
      setLeverBusy(null);
    }
  }

  async function leverCreateTask() {
    if (!commItem || leverBusy || thinking) return;
    setLeverPending(null); setDraftEdit(null); setTaskProposal(null);
    setLeverBusy("task");
    try {
      const src = commLabel();
      const resp = await callClaude([{
        role: "user",
        content: `${BRADY_CONTEXT}\nFrom this item: ${src}${selectedComm.type === "vm" && commItem.vm ? ` Voicemail: "${commItem.vm}"` : ""}\nPropose ONE follow-up task for Brady. Respond with ONLY valid JSON, no commentary: {"title":"","due":"suggested due date in plain words","details":"one or two sentences"}`,
      }], { useTools: false });
      const parsed = extractJSON(extractText(resp));
      setTaskProposal({
        title: parsed.title || `Follow up: ${commItem.from}`,
        source: src,
        due: parsed.due || "tomorrow morning",
        details: parsed.details || "",
      });
      setLeverPending("task");
    } catch (e) {
      setError("Task proposal failed — try again.");
    } finally {
      setLeverBusy(null);
    }
  }

  async function confirmTaskProposal() {
    if (!taskProposal || thinking) return;
    const t = taskProposal;
    setTaskProposal(null); setLeverPending(null);
    await sendCommand(`Create a Quo task titled "${t.title}" due ${t.due}. Details: ${t.details || "—"} (Source: ${t.source})`);
  }

  /* ---------- QUICK ACTIONS ---------- */

  const ACTIONS = [
    { label: "What'd I miss", primary: true, prompt: "What did I miss? Check missed calls and voicemails on both Quo inboxes (last 24h), unread Gmail (last 24h), and today's + tomorrow's calendar. BLUF summary, then anything needing a reply." },
    { label: "Triage inbox", dot: "var(--ember-orange)", prompt: "Triage my unread Gmail from the last 24h: bucket into NEEDS REPLY / FYI / IGNORE, one line each. Suggest a one-sentence reply for each NEEDS REPLY." },
    { label: "Brief my day", dot: "var(--brass)", prompt: "Brief me on tomorrow: calendar events in order with times, plus any open loops from today's calls or emails I should handle before the first event." },
    // Handoff draft was dropped from the dock 2026-08-01 to make room for Projects —
    // Rule 15 makes log writes Claude's job automatically, and the AI Handoff studio
    // tool still covers manual pulls.
  ];

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <div className="ember-root w-full" style={{ background: "var(--bg)", color: "var(--ink)" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        :root {
          --bg:#070604; --panel:#0D0C0A; --panel-2:#12100D;
          --line:rgba(176,141,87,.22); --line-hot:rgba(176,141,87,.5);
          --ember-red:#FF4D32; --ember-orange:#FF7A45; --ember-dark:#8a1f14;
          --ember-amber:#FFB13B;
          --brass:#B08D57; --copper:#A65A32; --gunmetal:#565660; --candle:#F3E9D8;
          --ink:#F3E9D8; --ink-dim:#B8A78F; --ink-faint:#8B7A66;

          /* asset-pack design tokens (design-tokens.css) */
          --ember-bg:#070604; --ember-bg-raised:#0A0907;
          --ember-panel:#0D0C0A; --ember-panel-alt:#12100D; --ember-panel-hover:#17130F;
          --ember-panel-line:#3D2A1C;
          --ember-brass:#B08D57; --ember-brass-bright:#D6B36A; --ember-brass-dark:#5F4428;
          --ember-antique:#7C5B32; --ember-bone:#C9B18A;
          --ember-active:#FF4D32; --ember-active-bright:#FF7A45;
          --ember-warning:#FFB13B; --ember-cyan:#19D7E6; --ember-danger:#D93C2B;
          --ember-text:#F3E9D8; --ember-text-soft:#D8C9B5; --ember-text-muted:#B8A78F; --ember-text-dim:#8B7A66;
          --ember-font-display:"Cinzel", Georgia, serif;
          --ember-font-ui:"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --ember-shadow-panel:0 10px 30px rgb(0 0 0 / 48%);
          --ember-shadow-active:0 0 18px rgb(255 77 50 / 42%);
          --ember-shadow-cyan:0 0 22px rgb(25 215 230 / 20%);
          --ember-ease-mechanical:cubic-bezier(.2,.8,.2,1);
          --ember-ease-sweep:cubic-bezier(.22,1,.36,1);
        }
        html, body, #root { margin:0; width:100%; height:100%; background:var(--bg); }
        * { box-sizing:border-box; }
        body, button, input, textarea { font-family:var(--ember-font-ui); }
        .font-mono-x { font-family:"SF Mono",ui-monospace,Menlo,monospace; }
        .font-display { font-family:"Cinzel","Georgia",serif; }

        .ember-root { position:relative; height:100vh; min-height:720px; overflow:hidden; }
        .ember-root::before {
          content:""; position:fixed; inset:0; z-index:20; pointer-events:none;
          border:7px solid #171008;
          box-shadow:inset 0 0 0 2px #73502b,inset 0 0 0 5px #0a0704,inset 0 0 34px rgba(0,0,0,.9);
        }
        .ember-root::after {
          content:""; position:fixed; left:6px; right:6px; top:6px; height:13px; z-index:19; pointer-events:none;
          background:
            radial-gradient(circle at 7% 50%,#d09952 0 2px,#2a1b0e 3px 6px,transparent 6.5px),
            radial-gradient(circle at 93% 50%,#d09952 0 2px,#2a1b0e 3px 6px,transparent 6.5px),
            linear-gradient(180deg,#3b2816,#120c07 45%,#8c6030 52%,#1b120a 60%,#080503);
          border-bottom:1px solid rgba(214,179,106,.35);
          box-shadow:0 5px 15px rgba(0,0,0,.62);
        }
        .ember-shell {
          width:100vw; height:100vh; min-height:720px; max-width:none;
          padding:16px clamp(68px,5.4vw,96px) calc(84px + env(safe-area-inset-bottom));
          gap:8px; overflow:hidden;
        }
        .ember-header {
          flex:0 0 auto; min-height:58px; padding:9px 16px;
          border:1px solid rgba(214,179,106,.38); border-radius:14px;
          background:linear-gradient(180deg,rgba(18,14,10,.96),rgba(7,6,4,.94));
          box-shadow:inset 0 0 0 2px rgba(36,23,13,.95), inset 0 -10px 24px rgba(0,0,0,.34),
            0 8px 24px rgba(0,0,0,.45), 0 0 18px rgba(255,105,38,.06);
        }
        .brand-title { font-size:clamp(23px,1.8vw,31px); text-shadow:0 2px 2px #000; }
        .header-control {
          min-height:30px; border:1px solid #63431f!important; border-radius:7px!important;
          padding:5px 11px!important; background:linear-gradient(180deg,#17100b,#080604)!important;
          box-shadow:inset 0 1px 0 rgba(255,212,143,.12),inset 0 -5px 10px rgba(0,0,0,.42),0 4px 12px rgba(0,0,0,.45);
        }
        .header-control:hover { filter:brightness(1.18); border-color:#b57c35!important; }
        .header-control.sync-control {
          background:linear-gradient(180deg,#ff7349,#b82e1d)!important;
          border-color:#ff8b5d!important; box-shadow:inset 0 1px 0 rgba(255,231,206,.42),0 0 16px rgba(255,77,50,.35);
        }
        .mic-rail {
          flex:0 0 auto; min-height:38px; border-radius:11px!important;
          box-shadow:inset 0 0 0 1px rgba(92,54,25,.42), 0 6px 18px rgba(0,0,0,.32);
        }

        .atmo { position:fixed; inset:0; z-index:0; pointer-events:none; opacity:.5;
          background:
            radial-gradient(ellipse 70% 50% at 50% 100%, rgba(255,77,61,.10), transparent 60%),
            radial-gradient(ellipse 40% 30% at 85% 10%, rgba(255,158,61,.06), transparent 60%); }
        .trace { position:fixed; height:1px; z-index:0; pointer-events:none; opacity:.35;
          background:linear-gradient(90deg, transparent, var(--ember-red), var(--ember-orange), transparent);
          animation:tracepulse 6s ease-in-out infinite; }
        @keyframes tracepulse { 50% { opacity:.7; } }
        .node { position:fixed; width:5px; height:5px; border-radius:50%; z-index:0;
          background:var(--ember-orange); box-shadow:0 0 10px var(--ember-orange); }

        .main-grid {
          display:grid; grid-template-columns:minmax(300px,1fr) minmax(430px,1.28fr) minmax(300px,1fr);
          gap:10px; align-items:stretch; min-height:0; overflow:hidden;
        }
        .cap-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:stretch; min-height:0; }
        .ops-side { min-height:0; gap:10px!important; }

        @media (max-width:1020px){
          .ember-root { height:auto; min-height:100vh; overflow:auto; }
          .ember-shell { width:100%; height:auto; min-height:100vh; padding:14px 14px calc(92px + env(safe-area-inset-bottom)); overflow:visible; }
          .main-grid, .cap-grid { grid-template-columns:1fr; }
          .ops-core { order:-1; }
          /* the QUO/GMAIL/CALENDAR dots are demo-state, not tappable — dead weight on a phone */
          .conn-dots { display:none; }
          /* Header on a phone: ONE row, period — Brady's 8/23 note. Everything
             that can't earn its width goes: the OPS tag (the dock already shows
             the active view), the DEMO·clock strip, and the toggle's long
             wording (.tgl-long). Brand stays nowrap so the two words never
             stack. What remains packs horizontally on a single band. */
          .ember-header { row-gap:0; min-height:0; padding:5px 9px; flex-wrap:nowrap; }
          .ember-header h1.brand-title { font-size:14px !important; letter-spacing:.09em !important; }
          .ember-header > div:first-child { gap:6px !important; flex:0 1 auto; min-width:0; }
          /* the B monogram square goes — the brand text already says it, and its
             28px is exactly the slack that kept EMBER from colliding with BG */
          .ember-header > div:first-child > div:first-child { display:none; }
          .ember-header > div:first-child > span { display:none; }
          .ember-header > div:last-child { column-gap:5px !important; row-gap:2px !important; font-size:9px !important; flex-wrap:nowrap !important; }
          .hdr-clock { display:none; }
          .tgl-long { display:none; }
          .ember-header .header-control { padding:2px 6px !important; font-size:9px !important; min-height:24px; }
          .ember-header .tgl-track { width:22px; height:11px; }
          /* greeting: one compact line over the skull crown, not a two-row block.
             !important throughout — the base .greet-row rule sits LATER in this
             sheet, so without it these lose the cascade and the row wraps. */
          .greet-row { padding:2px 8px !important; column-gap:8px !important; row-gap:2px !important; }
          .greet-hi { font-size:13px !important; }
          .greet-row .chip { padding:3px 9px !important; font-size:10px !important; white-space:nowrap; }
          .greet-long { display:none; }
          .greet-short { display:inline !important; }
          .home-thread { max-height:min(46vh,420px); }
          .rail-list { flex-direction:row; flex-wrap:wrap; }
        }

        /* machined 9-slice plate frame from the asset pack — brass etch + rivet
           corners live in the SVG; center stays CSS so bg-on translucency works */
        .panel { position:relative; border:14px solid transparent; border-radius:18px;
          border-image:url("${ASSETS}/svg/frames/panel-frame.svg") 28 fill stretch;
          background:linear-gradient(180deg, var(--ember-panel-alt), var(--ember-panel));
          background-clip:padding-box;
          box-shadow:var(--ember-shadow-panel), inset 0 0 0 1px rgba(214,179,106,.2),
            inset 0 14px 30px rgba(255,177,59,.025), 0 0 0 1px rgba(27,17,10,.9);
          transition:filter .25s, box-shadow .25s; }
        .panel::after {
          content:""; position:absolute; inset:-8px; border-radius:15px; pointer-events:none;
          background:
            radial-gradient(circle at 5px 5px,#c2924e 0 1px,#3a2718 2px 4px,transparent 4.5px),
            radial-gradient(circle at calc(100% - 5px) 5px,#c2924e 0 1px,#3a2718 2px 4px,transparent 4.5px),
            radial-gradient(circle at 5px calc(100% - 5px),#c2924e 0 1px,#3a2718 2px 4px,transparent 4.5px),
            radial-gradient(circle at calc(100% - 5px) calc(100% - 5px),#c2924e 0 1px,#3a2718 2px 4px,transparent 4.5px);
        }
        .panel:hover { filter:brightness(1.05);
          box-shadow:var(--ember-shadow-panel), 0 0 24px rgba(255,120,60,.09); }
        .bg-on .panel { background:linear-gradient(180deg, rgba(18,16,13,.84), rgba(13,12,10,.86)); background-clip:padding-box; backdrop-filter:blur(6px); }
        /* category light — sits on the plate's top rail inside the frame */
        .notch { position:absolute; top:-8px; left:14px; width:38px; height:2px; border-radius:2px; opacity:.9; }
        .notch.hot  { background:linear-gradient(90deg,var(--ember-red),var(--ember-dark));  box-shadow:0 0 12px var(--ember-red); }
        .notch.warm { background:linear-gradient(90deg,var(--ember-orange),#ffcf5d);         box-shadow:0 0 12px var(--ember-orange); }
        .notch.cool { background:linear-gradient(90deg,var(--brass),#e8d3a0);            box-shadow:0 0 12px rgba(201,168,106,.55); }

        @keyframes riseIn { from{opacity:0; transform:translateY(14px); filter:blur(8px);} to{opacity:1; transform:translateY(0); filter:blur(0);} }
        .reveal { opacity:0; animation:riseIn .7s cubic-bezier(.25,.46,.45,.94) forwards; }

        @keyframes badgePulse { 0%,100%{box-shadow:0 0 0 rgba(255,191,94,0);} 50%{box-shadow:0 0 16px rgba(255,191,94,.45);} }
        .badge-pulse { animation:badgePulse 2.6s ease-in-out infinite; }

        .gas-wrap { position:relative; width:190px; height:190px; will-change:transform,filter; }
        .gas { position:absolute; border-radius:50%; mix-blend-mode:screen; }
        .g1 { inset:8%;  filter:blur(24px); background:radial-gradient(circle at 40% 35%, rgba(255,158,61,.95), rgba(255,77,61,.5) 55%, transparent 75%); animation:gasA 11s ease-in-out infinite; }
        .g2 { inset:0;   filter:blur(34px); background:radial-gradient(circle at 65% 60%, rgba(255,77,61,.8), rgba(122,28,16,.45) 60%, transparent 78%); animation:gasB 14s ease-in-out infinite; }
        .g3 { inset:18%; filter:blur(18px); background:radial-gradient(circle at 30% 70%, rgba(255,181,115,.85), transparent 70%); animation:gasC 9s ease-in-out infinite; }
        .g4 { inset:-6%; filter:blur(44px); background:radial-gradient(circle at 55% 30%, rgba(255,120,60,.35), transparent 70%); animation:gasB 18s ease-in-out infinite reverse; }
        @keyframes gasA { 0%,100%{transform:translate(0,0) scale(1);} 33%{transform:translate(9px,-7px) scale(1.08);} 66%{transform:translate(-7px,6px) scale(.95);} }
        @keyframes gasB { 0%,100%{transform:translate(0,0) rotate(0deg) scale(1);} 50%{transform:translate(-10px,8px) rotate(18deg) scale(1.1);} }
        @keyframes gasC { 0%,100%{transform:translate(0,0) scale(1);} 50%{transform:translate(8px,10px) scale(1.14);} }

        .vent-ring { position:absolute; left:50%; top:50%; width:52px; height:52px;
          margin:-26px 0 0 -26px; border-radius:50%; pointer-events:none;
          border:1.5px solid rgba(255,191,94,.75);
          box-shadow:0 0 14px rgba(255,158,61,.4), inset 0 0 10px rgba(255,158,61,.25);
          animation:ventRelease .9s cubic-bezier(.22,.61,.36,1) forwards; }
        @keyframes ventRelease {
          0%   { transform:scale(.55); opacity:0; }
          14%  { transform:scale(.75); opacity:.9; }
          100% { transform:scale(2.1); opacity:0; } }
        .scope-bezel { position:relative; border-radius:14px; padding:14px 16px; cursor:pointer;
          background:linear-gradient(180deg,#1c1210,#0d0807);
          border:1px solid rgba(255,120,60,.3);
          box-shadow: inset 0 2px 6px rgba(0,0,0,.7), inset 0 -1px 0 rgba(255,255,255,.04), 0 8px 26px rgba(0,0,0,.5); }
        .scope-screw { position:absolute; width:7px; height:7px; border-radius:50%;
          background:radial-gradient(circle at 35% 30%, #6b5a4a, #241a12); box-shadow:inset 0 1px 1px rgba(255,255,255,.25); }
        @keyframes breathe { 0%,100%{transform:scale(1);opacity:.55;} 50%{transform:scale(1.14);opacity:.85;} }
        .core-glow { animation:breathe 3.2s ease-in-out infinite; }
        .core-wrap:hover .core-glow { animation-duration:1.8s; opacity:1; }
        .is-listening .core-glow, .is-thinking .core-glow { animation-duration:1.1s; opacity:1; }

        @keyframes blink { 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
        .cursor-block { display:inline-block; width:7px; height:14px; margin-left:6px; vertical-align:-2px;
          background:var(--ember-orange); animation:blink 1.1s step-start infinite; }
        /* projects dashboard — horizontal brass-and-ember bars */
        .proj-meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 14px;
          margin-bottom:14px; padding:8px 12px; border:1px solid var(--line); border-radius:10px;
          background:#100c09; font-size:10px; letter-spacing:.12em; color:var(--ink-dim); }
        .proj-cat { font-size:11px; font-weight:700; letter-spacing:.24em; text-transform:uppercase;
          color:var(--brass); border-bottom:1px solid var(--line); padding-bottom:5px; margin-bottom:4px; }
        .proj-row { padding:9px 0; border-bottom:1px solid rgba(255,90,60,.09); }
        .proj-name-link { background:none; border:0; padding:0; text-align:left; cursor:pointer;
          color:var(--ember-amber); text-decoration:underline; text-underline-offset:2.5px;
          text-decoration-color:rgba(255,158,61,.45); }
        .proj-name-link:hover { color:var(--candle); text-decoration-color:var(--candle); }
        .proj-name-arrow { font-size:10px; opacity:.7; }
        .proj-chip { display:inline-block; padding:1.5px 7px; border-radius:999px; font-size:9.5px;
          letter-spacing:.06em; text-transform:uppercase; color:var(--brass);
          border:1px solid var(--ember-brass-dark); background:transparent; text-decoration:none; }
        .proj-chip:hover { color:var(--candle); border-color:var(--brass); }
        .proj-row:last-child { border-bottom:none; }
        .proj-bar { position:relative; height:12px; margin-top:6px; border-radius:7px; overflow:hidden;
          background:linear-gradient(180deg,#0a0806,#14100c);
          border:1px solid var(--line); box-shadow:inset 0 2px 4px rgba(0,0,0,.7); }
        .proj-fill { position:absolute; left:0; top:0; bottom:0; border-radius:6px;
          background:linear-gradient(90deg,var(--ember-red),var(--ember-orange));
          box-shadow:0 0 12px rgba(255,98,36,.45), inset 0 1px 0 rgba(255,220,170,.35);
          transition:width .7s var(--ember-ease-sweep); }
        .proj-fill[data-pct="100"] { background:linear-gradient(90deg,var(--brass),#e8d3a0);
          box-shadow:0 0 10px rgba(214,179,106,.4), inset 0 1px 0 rgba(255,240,210,.4); }

        /* greeting sits over the skull crown — a translucent seat keeps it readable
           against the art instead of fighting it */
        .greet-row { padding:4px 12px; border-radius:12px; background:rgba(7,6,4,.55);
          backdrop-filter:blur(2px); text-shadow:0 1px 2px rgba(0,0,0,.8); }
        /* "vm" is the phone abbreviation; desktop spells voicemails out */
        .greet-short { display:none; }

        /* the home chat thread — scrolls inside the chamber, newest pinned by autoscroll */
        .home-thread { display:flex; flex-direction:column; gap:10px; overflow-y:auto;
          max-width:520px; max-height:clamp(170px,30vh,320px); padding:2px 6px 2px 2px; }
        /* Once the levers appear they float over the chamber at z-index 4, and the
           thread is centred beneath them -- so a wide answer slid under the brass and
           became unreadable. Keep the thread inside the gap between the two levers.
           Expressed against the chamber width so it holds at any window size. */
        @media (min-width:980px){
          .home-thread { max-width:min(520px, calc(100% - 210px)); }
        }
        .cmd-input { border:1px solid var(--line); transition:border-color .25s, box-shadow .25s; caret-color:var(--ember-orange); }
        .cmd-input:focus { outline:none; border-color:var(--ember-orange);
          box-shadow:0 0 0 1px rgba(255,158,61,.35), 0 0 28px rgba(255,120,60,.22), 0 8px 30px rgba(0,0,0,.5); }

        .chip { font-size:10.5px; font-weight:700; padding:5px 12px; border-radius:8px; cursor:pointer;
          transition:all .16s; border:1px solid transparent; }
        .chip.solid { color:#fff; box-shadow:0 2px 14px rgba(255,77,61,.35);
          background:linear-gradient(110deg,var(--ember-red) 0%, #ff6a4d 38%, var(--ember-orange) 50%, #ff6a4d 62%, var(--ember-red) 100%);
          background-size:220% 100%; background-position:0% 0; }
        .chip.solid:hover { box-shadow:0 4px 22px rgba(255,77,61,.6); transform:translateY(-1px); animation:chipShine 1.1s linear infinite; }
        @keyframes chipShine { to { background-position:-220% 0; } }
        .chip.ghost { border-color:var(--line); color:var(--ink-dim); background:transparent; }
        .chip.ghost:hover { border-color:var(--line-hot); color:var(--ink); }
        .voice-pick { background:#120c0c; color:var(--ember-amber); border:1px solid var(--ember-brass-dark);
          border-radius:8px; font-size:10px; padding:4px 8px; max-width:220px; }
        .voice-pick:focus { outline:none; border-color:var(--brass); }
        .surface-chip:disabled { opacity:.35; cursor:default; text-decoration:line-through; }
        .chip:disabled { opacity:.35; cursor:default; }

        .big { display:flex; align-items:center; gap:10px; font-size:12px; font-weight:700; letter-spacing:.06em;
          border:11px solid transparent;
          border-image:url("${ASSETS}/svg/frames/quick-action-frame.svg") 16 / 11px stretch;
          padding:6px 16px; cursor:pointer; transition:all 140ms var(--ember-ease-mechanical);
          background:var(--panel-2); background-clip:padding-box; color:var(--ink-dim); }
        .big:hover { transform:translateY(-2px); color:var(--ink); filter:brightness(1.1) drop-shadow(0 6px 18px rgba(255,77,50,.2)); }
        .big.primary { background:linear-gradient(90deg,var(--ember-red),#ff6a4d); background-clip:padding-box; color:#fff;
          filter:drop-shadow(0 0 14px rgba(255,77,50,.4)); }
        .big.primary:hover { filter:brightness(1.08) drop-shadow(0 0 20px rgba(255,77,50,.6)); }
        .big:disabled { opacity:.5; cursor:wait; transform:none; }

        .tabwrap { display:flex; align-items:center; gap:6px; }
        .tab { font-family:var(--ember-font-display); font-size:14px; font-weight:700; letter-spacing:.14em;
          border:11px solid transparent;
          border-image:url("${ASSETS}/svg/frames/quick-action-frame.svg") 16 / 11px stretch;
          padding:4px 14px; background:rgba(10,9,7,.72); background-clip:padding-box;
          color:var(--ink-dim); cursor:pointer; transition:all 140ms var(--ember-ease-mechanical);
          text-shadow:0 1px 0 rgba(0,0,0,.7); }
        .tab:hover { color:var(--ink); filter:brightness(1.12); }
        .tab.active { background:linear-gradient(180deg,#ff7a55,var(--ember-red)); background-clip:padding-box; color:#fff;
          filter:drop-shadow(0 0 12px rgba(255,77,50,.5));
          text-shadow:0 1px 2px rgba(100,15,8,.7); }

        .studio-stack { display:flex; flex-direction:column; gap:10px; min-height:0; overflow:hidden; }
        .studio-tools-panel { flex:0 0 auto; padding:8px 12px!important; }
        /* one row, scrolls sideways — the 2x4 grid buried the actual tool below a
           full screen of tiles on a phone */
        .tool-grid { display:flex; gap:8px; overflow-x:auto; padding-bottom:2px;
          scrollbar-width:thin; -webkit-overflow-scrolling:touch; }
        .tool-grid .tool-tile { flex:0 0 auto; width:96px; min-height:56px; }
        .tool-tile { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
          min-height:64px; border:8px solid transparent;
          border-image:url("${ASSETS}/svg/frames/tool-module-frame.svg") 18 / 8px stretch;
          padding:6px 2px; font-size:10.5px; font-weight:700; letter-spacing:.03em;
          color:var(--ink-dim); text-align:center; cursor:pointer;
          background:
            radial-gradient(circle at 50% 16%,rgba(214,179,106,.08),transparent 34%),
            linear-gradient(180deg,#18120d,#080705 72%); background-clip:padding-box;
          box-shadow:inset 0 1px 0 rgba(255,214,150,.08), inset 0 -12px 20px rgba(0,0,0,.45);
          transition:all 140ms var(--ember-ease-mechanical); }
        .tool-tile::after { content:""; position:absolute; inset:4px; border:1px solid rgba(176,141,87,.18); pointer-events:none; }
        .tool-tile:hover { color:var(--ink); filter:brightness(1.12); }
        .tool-tile.on { color:var(--ink); transform:translateY(-2px);
          background:linear-gradient(180deg,#1A120D,#0D0906); background-clip:padding-box;
          filter:brightness(1.15) drop-shadow(0 0 14px rgba(255,77,50,.4)); }
        .tool-tile .tic { font-size:19px; line-height:1; display:flex; justify-content:center; }
        .tool-tile.on .tic { filter:drop-shadow(0 0 6px rgba(255,120,60,.85)); }

        .code-view { font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:11.5px; line-height:1.6;
          white-space:pre; overflow:auto; background:#0c0808; border:1px solid var(--line); border-radius:12px;
          padding:14px; color:var(--ink-dim); max-height:360px; }
        .fs-item { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer;
          font-size:12px; transition:background .14s; }
        .fs-item:hover { background:rgba(255,90,60,.07); }

        .hbtn { flex:1; display:flex; align-items:center; justify-content:center; gap:10px;
          font-size:12px; font-weight:800; letter-spacing:.08em; padding:15px 20px; border-radius:14px;
          cursor:pointer; transition:all .18s; background:var(--panel-2); }
        .hbtn:hover { transform:translateY(-2px); filter:brightness(1.2); }

        .upzone { border:1.5px dashed var(--line-hot); border-radius:14px; padding:18px 16px; text-align:center;
          cursor:pointer; transition:all .2s; background:rgba(255,77,61,.03); }
        .upzone:hover { border-color:var(--ember-orange); background:rgba(255,120,60,.07); box-shadow:0 0 26px rgba(255,77,61,.15) inset; }

        .toggle-chip { display:inline-flex; align-items:center; gap:7px; border:1px solid var(--line); color:var(--ink-dim);
          border-radius:9999px; padding:7px 15px; font-size:11px; font-weight:700; cursor:pointer; transition:all .16s; background:transparent; }
        .toggle-chip:hover { border-color:var(--line-hot); color:var(--ink); }
        .toggle-chip.on { background:linear-gradient(90deg,var(--ember-red),#ff6a4d); color:#fff; border-color:transparent; box-shadow:0 2px 14px rgba(255,77,61,.35); }
        .vision-tag { font-size:8px; letter-spacing:.15em; padding:1.5px 6px; border-radius:4px;
          background:rgba(255,191,94,.15); color:var(--ember-amber); border:1px solid rgba(255,191,94,.45); }
        .toggle-chip.on .vision-tag { background:rgba(0,0,0,.25); color:#ffe1b0; border-color:rgba(255,225,176,.5); }

        .seg { font-size:11px; font-weight:700; padding:8px 18px; border-radius:10px; border:1px solid var(--line);
          color:var(--ink-dim); cursor:pointer; transition:all .16s; background:transparent; }
        .seg.on { background:linear-gradient(90deg,var(--ember-red),#ff6a4d); color:#fff; border-color:transparent; box-shadow:0 2px 14px rgba(255,77,61,.35); }
        .seg.sm { font-size:10px; padding:5px 12px; border-radius:8px; }

        .lockrow { display:flex; align-items:center; gap:9px; margin-top:10px; padding:10px 15px; border-radius:10px;
          border:1px dashed rgba(255,191,94,.45); background:rgba(255,191,94,.06); color:var(--ember-amber);
          font-weight:700; font-size:12.5px; }
        .locktag { margin-left:auto; font-size:8px; letter-spacing:.2em; padding:2px 7px; border-radius:4px;
          border:1px solid rgba(255,191,94,.45); }

        .fieldlabel { font-size:9.5px; font-weight:800; letter-spacing:.22em; color:var(--ink-faint); text-transform:uppercase; }

        @keyframes spin1 { to{transform:rotate(360deg);} }
        .spinner { width:12px; height:12px; border-radius:50%; border:2px solid rgba(255,255,255,.25);
          border-top-color:#fff; animation:spin1 .8s linear infinite; }
        .spinner.dark { border-color:rgba(255,120,60,.3); border-top-color:var(--ember-orange); }

        .spark { position:fixed; bottom:-12px; width:3px; height:3px; border-radius:50%;
          background:radial-gradient(circle, #ffcf8a 0%, #ff9e3d 45%, #ff4d3d 100%);
          box-shadow:0 0 6px rgba(255,158,61,.8); opacity:0; pointer-events:none;
          animation:sparkRise linear infinite; }
        @keyframes sparkRise {
          0%   { transform:translate(0,0) scale(1); opacity:0; }
          6%   { opacity:.9; }
          55%  { opacity:.45; }
          100% { transform:translate(var(--dx,18px),-108vh) scale(.35); opacity:0; }
        }

        /* ---------- steampunk pack: iron floor, tanks, skull, levers, shells ---------- */

        .iron-bg { position:fixed; inset:0; z-index:0; pointer-events:none; opacity:.55;
          background-image:url("${ASSETS}/textures/iron-tile.svg"); background-repeat:repeat; background-size:128px 128px; }

        .tank-wrap { position:fixed; top:50%; transform:translateY(-46%); z-index:11; pointer-events:none;
          display:none; height:clamp(330px,48vh,560px); filter:drop-shadow(0 14px 20px rgba(0,0,0,.75)); }
        .tank-wrap.left { left:0; }
        .tank-wrap.right { right:0; transform:translateY(-46%) scaleX(-1); }
        /* The tank artwork is painted cyan, which is the single loudest violation of
           BUILD-PROMPT §3 ("no blues, no purples for primary UI — warmth only"): lit from
           both edges it was the most saturated thing on screen. sepia strips the cyan
           outright, then saturate/hue-rotate bring it back up as banked-coal amber, so
           the glass still reads as lit fluid rather than going grey. Filtering rather
           than repainting keeps this one line to revert if the asset is ever redrawn. */
        .tank-wrap img {
          height:100%; width:auto; opacity:.96;
          filter:sepia(1) saturate(2.5) hue-rotate(-14deg) brightness(1.04) contrast(1.04);
        }
        .tank-energy { content:""; position:absolute; left:22%; right:22%; top:14%; bottom:12%;
          background:radial-gradient(ellipse at 50% 62%, rgba(255,150,58,.38), transparent 68%);
          mix-blend-mode:screen; animation:tankEnergy 4200ms ease-in-out infinite alternate; }
        .tank-wrap::after {
          content:""; position:absolute; left:29%; right:29%; top:19%; bottom:18%; border-radius:40%;
          opacity:.62; mix-blend-mode:screen;
          background-image:
            radial-gradient(circle at 22% 95%,rgba(255,231,186,.9) 0 2px,transparent 3px),
            radial-gradient(circle at 69% 82%,rgba(255,181,96,.8) 0 1.5px,transparent 2.5px),
            radial-gradient(circle at 46% 68%,rgba(255,238,205,.65) 0 1px,transparent 2px),
            radial-gradient(circle at 78% 52%,rgba(255,181,96,.7) 0 2px,transparent 3px);
          background-size:39px 74px,47px 92px,31px 63px,53px 106px;
          animation:tankBubbles 5.6s linear infinite;
        }
        @keyframes tankEnergy {
          from { transform:translateY(18%); opacity:.16; }
          to   { transform:translateY(-18%); opacity:.32; } }
        @keyframes tankBubbles {
          from { background-position:0 80px,8px 96px,3px 68px,12px 112px; }
          to { background-position:0 -80px,8px -96px,3px -68px,12px -112px; }
        }
        @media (min-width:1180px){ .tank-wrap { display:block; } }

        /* skull crowns the center chamber only — width capped to the center
           column so it never overflows onto the side panels' text (readability) */
        /* visible at EVERY width — the skeleton is the identity, and on a phone it
           was hidden entirely, which is why the home screen read as generic panels */
        .skull-arch { position:absolute; left:50%; top:0; transform:translate(-50%,-34%);
          width:clamp(300px,88vw,720px); max-width:100%; opacity:.80; pointer-events:none; z-index:0; display:block; }
        .skull-host { overflow:hidden; }
        /* Lift the chamber's contents above the arch. z-index needs a position, but this
           must not clobber children that place themselves — .ctx-lever is absolute and
           carries its own z-index, and being forced to relative dropped both levers into
           flow, on top of the greeting. */
        .skull-host > :not(.skull-arch):not(.ctx-lever) { position:relative; z-index:1; }

        .orb-shell { position:absolute; inset:0; height:100%; width:100%; pointer-events:none; opacity:.94; }

        .core-chamber {
          overflow:hidden; gap:4px!important; padding:9px 26px 8px!important;
          background:
            radial-gradient(circle at 50% 48%,rgba(255,92,24,.08),transparent 42%),
            linear-gradient(180deg,#0b0a08,#070706)!important;
        }
        .core-chamber h2 { font-size:clamp(22px,1.55vw,28px); line-height:1.05; }
        .core-chamber .reveal.text-center .mt-3\\.5 { margin-top:8px!important; }
        .core-chamber .max-w-sm { max-width:440px; }
        .reactor-stage {
          position:relative; width:clamp(238px,35vh,326px); height:clamp(238px,35vh,326px);
          margin:-6px auto -12px; cursor:pointer; isolation:isolate;
          filter:drop-shadow(0 16px 24px rgba(0,0,0,.72));
        }
        .reactor-bezel { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; z-index:1; pointer-events:none; }
        .reactor-core-orb {
          position:absolute; left:31%; top:31%; width:38%; height:38%; z-index:2;
          display:flex; align-items:center; justify-content:center; border-radius:50%;
          box-shadow:0 0 26px rgba(255,77,25,.3);
        }
        .reactor-core-orb .gas-wrap { width:100%; height:100%; }
        .reactor-stage::before,.reactor-stage::after {
          content:""; position:absolute; border-radius:50%; pointer-events:none; z-index:3;
          background:repeating-conic-gradient(
            from 0deg,
            rgba(255,177,78,.84) 0deg 1.5deg,
            rgba(79,43,20,.22) 1.5deg 5.5deg
          );
          -webkit-mask:radial-gradient(circle,transparent 0 70%,#000 71% 79%,transparent 80%);
          mask:radial-gradient(circle,transparent 0 70%,#000 71% 79%,transparent 80%);
          filter:drop-shadow(0 0 5px rgba(255,104,37,.35));
        }
        .reactor-stage::before { inset:8%; animation:reactorSpin 18s linear infinite; opacity:.68; }
        .reactor-stage::after {
          inset:21%; animation:reactorSpin 11s linear infinite reverse; opacity:.52;
          background:repeating-conic-gradient(
            from 2deg,
            rgba(255,112,46,.9) 0deg 2deg,
            rgba(69,35,16,.16) 2deg 8deg
          );
          -webkit-mask:radial-gradient(circle,transparent 0 64%,#000 65% 76%,transparent 77%);
          mask:radial-gradient(circle,transparent 0 64%,#000 65% 76%,transparent 77%);
        }
        .is-listening .reactor-stage::before,.is-thinking .reactor-stage::before { animation-duration:3.2s; opacity:1; }
        .is-listening .reactor-stage::after,.is-thinking .reactor-stage::after { animation-duration:2.1s; opacity:.9; }
        @keyframes reactorSpin { to { transform:rotate(360deg); } }

        .odometer { display:flex; align-items:center; gap:4px; margin:2px 0 8px; }
        .odo-cell {
          min-width:29px; padding:6px 5px; border:1px solid #76502a; border-radius:4px;
          color:#ffb15f; text-align:center; font-family:"SF Mono",ui-monospace,monospace;
          font-size:20px; line-height:1; text-shadow:0 0 8px rgba(255,92,25,.72);
          background:linear-gradient(180deg,#16100b 0 47%,#060504 49% 53%,#160f0a 55% 100%);
          box-shadow:inset 0 2px 5px #000,0 0 0 2px #21150c,0 5px 10px rgba(0,0,0,.5);
        }
        .odo-cell.punct { min-width:14px; padding-inline:1px; border-color:transparent; background:none; box-shadow:none; }

        /* ---------- COMMAND DOCK — pinned brass bar ----------
           Rebuilt 2026-08-01 per Brady: the photoreal command-console asset is retired
           as the dock. Stretched to arbitrary bar sizes by object-fit:fill it read flat
           and distorted, and its painted nameplates forced absolutely-positioned labels
           that drifted off-center on phones. The bar is now built in CSS — iron plate,
           brass hairline, riveted top edge — so nothing is a stretched raster, labels
           center natively, and the bar stays pinned to the bottom of the screen. */
        .console-dock {
          position:fixed; left:0; right:0; bottom:0; z-index:30;
          padding:9px 10px calc(9px + env(safe-area-inset-bottom));
          background:linear-gradient(180deg,#191008 0%,#0e0a06 34%,#0a0705 100%);
          border-top:1px solid rgba(214,179,106,.5);
          box-shadow:0 -1px 0 #000, 0 -10px 26px rgba(0,0,0,.66);
        }
        /* rivet strip along the brass hairline */
        .console-dock::before {
          content:""; position:absolute; left:0; right:0; top:2px; height:5px; pointer-events:none;
          background:radial-gradient(circle at 8px 50%, #c2924e 0 1.2px, rgba(58,39,24,.9) 1.8px 2.6px, transparent 3px);
          background-size:64px 5px; background-repeat:repeat-x; opacity:.8;
        }
        .console-dock-grid {
          display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:6px;
          max-width:1180px; margin:0 auto;
        }
        .dock-control {
          display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
          min-width:0; min-height:54px; padding:6px 2px; cursor:pointer;
          border:1px solid rgba(176,141,87,.35); border-radius:10px;
          background:linear-gradient(180deg,#221609 0%,#140e08 46%,#0d0906 100%);
          box-shadow:inset 0 1px 0 rgba(255,214,150,.14), inset 0 -2px 5px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.5);
          color:var(--ember-text-soft);
          transition:filter 150ms var(--ember-ease-mechanical),transform 150ms var(--ember-ease-mechanical),border-color 150ms;
        }
        .dock-control:hover { filter:brightness(1.16); border-color:rgba(214,179,106,.6); transform:translateY(-1px); }
        .dock-control:active { transform:translateY(1px); box-shadow:inset 0 2px 6px rgba(0,0,0,.75); }
        .dock-control:disabled { cursor:wait; opacity:.6; transform:none; }
        .dock-control.active {
          color:#fff1dc; border-color:rgba(255,122,69,.75);
          background:linear-gradient(180deg,#2d1509 0%,#1b0e07 50%,#120a05 100%);
          box-shadow:inset 0 1px 0 rgba(255,177,120,.25), inset 0 -2px 6px rgba(0,0,0,.6), 0 0 16px rgba(255,77,50,.34);
        }
        /* Brass instrument tiles — back per Brady 2026-08-15, done right this time.
           Each button shows ITS OWN slice of command-console@2x.webp at a LOCKED
           aspect ratio (no object-fit:fill anywhere), cropped to the mechanism
           area ABOVE the painted nameplates — so the HTML label underneath never
           fights painted text and centers natively at every width. The 2026-08-01
           failures were stretch distortion and label drift; both are structurally
           impossible in this form. Panels occupy x=100..1500 of the 1600px strip. */
        .dock-art { position:relative; width:min(64px,86%); aspect-ratio:233/200; overflow:hidden;
          border-radius:7px; background:#0d0906;
          box-shadow:inset 0 0 0 1px rgba(214,179,106,.28), inset 0 -6px 10px rgba(0,0,0,.45); }
        .dock-art img { position:absolute; top:0; width:685.7%; max-width:none; height:auto;
          left:calc(var(--panel-x) * -1); pointer-events:none; }
        .dock-control.active .dock-art { box-shadow:inset 0 0 0 1px rgba(255,122,69,.55), 0 0 12px rgba(255,77,50,.35); }
        .dock-control.active .dock-art img { filter:brightness(1.2) saturate(1.08); }
        .dock-label {
          display:block; width:100%; text-align:center;
          font-family:var(--ember-font-display);
          font-size:clamp(8px,1.9vw,10.5px); font-weight:700; letter-spacing:.06em; text-transform:uppercase;
          line-height:1.15; text-shadow:0 1px 1px #000; overflow:hidden;
        }
        .dock-control.active .dock-label { text-shadow:0 1px 1px #000, 0 0 8px rgba(255,145,73,.5); }
        /* active lamp — a lit rivet centered under the label */
        .dock-lamp { width:5px; height:5px; border-radius:50%; margin-top:1px; flex:0 0 auto;
          background:#3a2718; box-shadow:inset 0 1px 1px rgba(0,0,0,.8); }
        .dock-control.active .dock-lamp { background:var(--ember-active); box-shadow:0 0 8px var(--ember-active); }

        .ember-row { padding-top:8px!important; padding-bottom:8px!important; }
        .ember-row .row-title { font-size:13.5px; line-height:1.25; }
        .panel h3 { font-size:12px!important; color:var(--ember-text-soft)!important; }

        /* pipe-junction ornaments — outer frame corners only, never behind text */
        .pipe-junction { position:absolute; top:-8px; width:46px; height:46px; opacity:.55; pointer-events:none; z-index:0; display:none; }
        .pipe-junction.pj-l { left:-12px; }
        .pipe-junction.pj-r { right:-12px; transform:scaleX(-1); }
        @media (min-width:980px){ .pipe-junction { display:block; } }

        .ctx-lever { position:absolute; top:48%; transform:translateY(-50%); z-index:4;
          display:none; flex-direction:column; align-items:center; gap:4px;
          background:none; border:none; padding:0; cursor:pointer;
          transition:filter 220ms var(--ember-ease-mechanical), transform 220ms var(--ember-ease-mechanical); }
        @media (min-width:980px){ .ctx-lever { display:flex; } }
        .ctx-lever.left { left:7px; } .ctx-lever.right { right:7px; }
        .ctx-lever img {
          width:clamp(48px,4.3vw,62px); height:auto; max-height:82px;
          transform-origin:50% 82%; transition:filter 220ms var(--ember-ease-mechanical),transform 220ms var(--ember-ease-mechanical);
        }
        .ctx-lever:disabled { cursor:default; }
        .ctx-lever:disabled img { opacity:.6; }
        .ctx-lever:not(:disabled):hover { filter:brightness(1.15); transform:translateY(calc(-50% - 2px)); }
        .ctx-lever:not(.idle) img { animation:leverAttention 5.8s var(--ember-ease-mechanical) infinite; }
        .ctx-lever.active img { animation:contextLeverPull 720ms var(--ember-ease-mechanical) infinite alternate; }
        @keyframes leverAttention {
          0%,76%,100%{transform:rotate(0deg);}
          82%{transform:rotate(-7deg);}
          89%{transform:rotate(5deg);}
          94%{transform:rotate(0deg);}
        }
        @keyframes contextLeverPull { to{transform:rotate(17deg) translateY(3px);} }
        .lever-label {
          order:-1; width:76px; padding:4px 3px; margin-bottom:-5px;
          border:2px solid #5f4428; border-radius:5px; color:var(--ember-text-soft);
          background:linear-gradient(180deg,#18110c,#070604);
          box-shadow:inset 0 0 0 1px rgba(214,179,106,.18),0 5px 12px rgba(0,0,0,.55);
          font-family:var(--ember-font-display); font-size:8px; font-weight:700;
          line-height:1.15; letter-spacing:.06em; text-transform:uppercase; text-align:center;
        }
        .lever-dot { width:7px; height:7px; border-radius:50%; background:var(--ember-brass-dark); transition:background 220ms; }
        .lever-dot.ready { background:var(--ember-brass-bright); box-shadow:0 0 6px rgba(214,179,106,.8); }
        .lever-dot.active { background:var(--ember-active); box-shadow:0 0 8px rgba(255,77,50,.85); }
        .lever-dot.pending { background:var(--ember-warning); box-shadow:0 0 8px rgba(255,177,59,.8);
          animation:leverPulse 900ms ease-in-out infinite; }
        @keyframes leverPulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }

        .row-sel { cursor:pointer; transition:background 140ms, box-shadow 140ms, padding 140ms; }
        .row-sel:hover { background:rgba(214,179,106,.05); }
        .row-on { background:rgba(214,179,106,.08); box-shadow:inset 2px 0 0 var(--ember-brass-bright); padding-left:9px; }

        .codex { position:relative; display:inline-flex; flex-wrap:wrap; justify-content:center; max-width:100%; border:9px solid transparent;
          border-image:url("${ASSETS}/svg/controls/codex-lock-shell.svg") 20 / 9px stretch;
          background:#0A0907; background-clip:padding-box; display:inline-flex; align-items:center; gap:4px; padding:2px 6px; }
        /* No transform animation on the segs. The old codexDrum translateY promoted
           every button to a rasterized GPU layer on iOS Safari; with any page zoom the
           layer re-rendered at the wrong scale and the labels stayed blurry after each
           pick. The .seg background/shadow transition carries the click feel instead. */

        .tgl { display:inline-flex; align-items:center; gap:7px; font-weight:700; letter-spacing:inherit;
          color:var(--ink-faint); background:transparent; border:none; padding:2px 0; cursor:pointer; font-size:inherit; }
        .tgl.on { color:var(--ember-orange); }
        .tgl-track { flex:none; display:block; overflow:visible; }
        .tgl-knob-o { fill:#6A4727; transition:fill 220ms var(--ember-ease-mechanical), stroke 220ms var(--ember-ease-mechanical); }
        .tgl-knob-i { fill:#8B7A66; transition:fill 220ms var(--ember-ease-mechanical); }
        .tgl-knob-g { transition:transform 220ms var(--ember-ease-mechanical); }
        .tgl.on .tgl-knob-g { transform:translateX(52px); }
        .tgl.on .tgl-knob-o { fill:#B0451F; stroke:#FFB067; }
        .tgl.on .tgl-knob-i { fill:#FFD9A0; }

        .sync-gear { display:inline-block; }
        .sync-gear.spin { animation:gearSpin 900ms linear infinite; }
        .sync-gear.spin.rev { animation-direction:reverse; }
        @keyframes gearSpin { to { transform:rotate(360deg); } }

        .gauge-wrap { position:relative; width:40px; height:40px; flex:none; }
        .gauge-wrap img { position:absolute; inset:0; width:100%; height:100%; }
        .gauge-needle { transition:transform 600ms var(--ember-ease-sweep); transform-origin:50% 68%; }

        .chip.qframe { border:8px solid transparent; border-radius:0;
          border-image:url("${ASSETS}/svg/frames/quick-action-frame.svg") 16 / 8px stretch;
          background:rgba(10,9,7,.72); background-clip:padding-box; }

        @media (prefers-reduced-motion:reduce){ *{animation:none!important; transition:none!important;} .reveal{opacity:1;} }
        @media (max-height:820px) and (min-width:1021px) {
          .ember-shell { padding-top:18px; padding-bottom:6px; gap:7px; }
          .ember-header { min-height:48px; padding-block:6px; }
          .mic-rail { min-height:32px; padding-block:5px!important; }
          .core-chamber { padding-block:8px!important; }
          .reactor-stage { width:252px; height:252px; }
          .tool-tile { min-height:50px; }
        }
      `}</style>

      {/* background layer (behind everything) */}
      {bgActive && (
        <div className="fixed inset-0" style={{
          zIndex: 0,
          background: activeBgCss || undefined,
          backgroundImage: activeBgImg || undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }} />
      )}
      {bgActive && (
        <div className="fixed inset-0" style={{ zIndex: 0, background: "linear-gradient(180deg, rgba(8,6,6,.78), rgba(8,6,6,.5) 45%, rgba(8,6,6,.86))" }} />
      )}

      {/* iron floor texture — beneath the panel layer */}
      {!bgActive && <div className="iron-bg" aria-hidden="true" />}

      {/* mirrored glass tanks at the far edges (>=1180px only) — filtered to amber, see .tank-wrap img */}
      <div className="tank-wrap left" aria-hidden="true">
        <img src={`${ASSETS}/raster/glass-tank@2x.png`} alt="" />
        <span className="tank-energy" />
      </div>
      <div className="tank-wrap right" aria-hidden="true">
        <img src={`${ASSETS}/raster/glass-tank@2x.png`} alt="" />
        <span className="tank-energy" />
      </div>

      {/* atmosphere */}
      <div className="atmo" />
      <div className="trace" style={{ top: "18%", left: 0, right: "40%" }} />
      <div className="node" style={{ top: "calc(18% - 2px)", right: "40%" }} />
      <div className="trace" style={{ top: "82%", left: "30%", right: 0, animationDelay: "1.5s" }} />
      <div className="node" style={{ top: "calc(82% - 2px)", left: "30%" }} />

      {/* rising embers */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 1 }} aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="spark" style={{
            left: `${4 + i * 8.1}%`,
            animationDuration: `${7.5 + (i % 5) * 2.2}s`,
            animationDelay: `${-i * 1.6}s`,
            "--dx": `${(i % 2 ? -1 : 1) * (14 + i * 5)}px`,
          }} />
        ))}
      </div>

      <div className={`ember-shell relative z-10 mx-auto flex flex-col ${bgActive ? "bg-on" : ""}`}>

        <img src={`${ASSETS}/svg/ornaments/pipe-junction.svg`} alt="" aria-hidden="true" className="pipe-junction pj-l" />
        <img src={`${ASSETS}/svg/ornaments/pipe-junction.svg`} alt="" aria-hidden="true" className="pipe-junction pj-r" />

        {/* ================= HEADER ================= */}
        <header className="ember-header reveal relative flex items-center justify-between" style={{ animationDelay: "0.05s" }}>
          <div className="flex items-center gap-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg text-base font-extrabold text-white"
              style={{ background: "linear-gradient(135deg,var(--ember-red),var(--ember-dark))", boxShadow: "0 0 24px rgba(255,77,61,.5)" }}>
              B
            </div>
            <h1 className="brand-title font-display font-extrabold leading-none tracking-[0.13em] whitespace-nowrap">
              BAXSTAR{" "}
              <span style={{ background: "linear-gradient(90deg,var(--ember-red),var(--ember-orange))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 0 12px rgba(255,90,50,.35))" }}>
                EMBER
              </span>
            </h1>
            <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--ink-faint)" }}>
              {view === "ops" ? "OPS" : view === "projects" ? "PROJECTS" : "BAXSTAR STUDIO"}
            </span>
          </div>

          <div className="font-mono-x flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-[10px] tracking-wider" style={{ color: "var(--ink-dim)" }}>
            {["GMAIL", "CALENDAR"].map((s) => (
              <span key={s} className="conn-dots flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "#54e08a" : "var(--ember-orange)", boxShadow: `0 0 8px ${live ? "#54e08a" : "var(--ember-orange)"}` }} />
                {s}
              </span>
            ))}
            <span className="hdr-clock" style={{ color: "var(--ink-faint)" }}>{live ? "LIVE" : "DEMO"} · {clock}</span>

            <button onClick={() => setBgMenu(!bgMenu)} title="Background"
              className="header-control rounded-md border px-2 py-1 transition-colors"
              style={{ borderColor: "var(--line)", color: bg.choice !== "default" ? "var(--ember-orange)" : "var(--ink-faint)" }}>
              <img src={`${ASSETS}/svg/ornaments/corner-gear.svg`} alt="" width="14" height="14"
                style={{ display: "inline-block", verticalAlign: "-3px", marginRight: "4px" }} />BG
            </button>
            {/* Brady's spec: orange while voice is on (it starts on), darker with
                "TAP FOR VOICE MODE" when off — the state reads at a glance. */}
            <button onClick={() => setVoiceOn(!voiceOn)} title="Spoken replies"
              className={`header-control tgl font-mono-x ${voiceOn ? "on" : ""}`} aria-pressed={voiceOn}
              style={voiceOn ? { color: "var(--ember-orange)" } : { color: "#8a8078", opacity: 0.85 }}>
              <svg className="tgl-track" viewBox="0 0 112 52" width="30" height="14" aria-hidden="true">
                <rect x="2" y="2" width="108" height="48" rx="24" fill="#0A0907" stroke="#5F4428" strokeWidth="4" />
                <path d="M26 26h60" stroke="#3A281B" strokeWidth="10" strokeLinecap="round" />
                <g className="tgl-knob-g">
                  <circle cx="30" cy="26" r="17" className="tgl-knob-o" strokeWidth="3" />
                  <circle cx="30" cy="26" r="5" className="tgl-knob-i" />
                </g>
              </svg>
              {/* Full wording on desktop; the .tgl-long spans drop on a phone so the
                  toggle stays one short word and the header holds a single row. */}
              {voiceOn ? <>VOICE<span className="tgl-long"> ON</span></> : <><span className="tgl-long">TAP FOR </span>VOICE<span className="tgl-long"> MODE</span></>}
            </button>
            <button onClick={syncLive} disabled={syncing}
              className="header-control sync-control flex items-center gap-2 rounded-md px-3 py-1 font-bold text-white transition-all"
              style={{ background: "linear-gradient(90deg,var(--ember-red),#ff6a4d)", boxShadow: "0 2px 14px rgba(255,77,61,.35)", opacity: syncing ? 0.6 : 1 }}>
              <img src={`${ASSETS}/svg/ornaments/corner-gear.svg`} alt="" width="13" height="13"
                className={`sync-gear ${syncing ? "spin" : ""}`} />
              {syncing && (
                <img src={`${ASSETS}/svg/ornaments/corner-gear.svg`} alt="" width="10" height="10"
                  className="sync-gear spin rev" style={{ marginLeft: "-6px", marginTop: "8px" }} />
              )}
              {syncing ? "SYNCING" : "SYNC"}
            </button>
          </div>

          {/* BG picker dropdown */}
          {bgMenu && <div className="fixed inset-0 z-20" onClick={() => setBgMenu(false)} />}
          {bgMenu && (
            <div className="panel absolute right-0 top-11 z-30 flex w-64 flex-col gap-1.5 p-3">
              <div className="fieldlabel mb-1">Background</div>
              <button className="chip ghost flex items-center justify-between"
                onClick={() => saveBg({ ...bg, choice: "default" })}>
                Ember (default) {bg.choice === "default" && <span style={{ color: "var(--ember-orange)" }}>✓</span>}
              </button>
              <button className="chip ghost flex items-center justify-between"
                onClick={() => saveBg({ ...bg, choice: "darklake" })}>
                Dark Lake (photo) {bg.choice === "darklake" && <span style={{ color: "var(--ember-orange)" }}>✓</span>}
              </button>
              {BGS.map((b) => (
                <button key={b.id} className="chip ghost flex items-center justify-between"
                  onClick={() => saveBg({ ...bg, choice: b.id })}>
                  {b.label} {bg.choice === b.id && <span style={{ color: "var(--ember-orange)" }}>✓</span>}
                </button>
              ))}
              {bg.customB64 && (
                <button className="chip ghost flex items-center justify-between"
                  onClick={() => saveBg({ ...bg, choice: "custom" })}>
                  Your image {bg.choice === "custom" && <span style={{ color: "var(--ember-orange)" }}>✓</span>}
                </button>
              )}
              <button className="chip solid mt-1" onClick={() => bgFileRef.current?.click()}>
                Upload your own…
              </button>
              <input ref={bgFileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => handleBgUpload(e.target.files?.[0])} />
              <div className="mt-1 text-[9.5px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                Drop in your generated scenes — saved to this device.
              </div>
            </div>
          )}
        </header>

        {inlineMic && (
          // Phone controls: big targets, always visible. Left = mic, right =
          // spoken replies. Small header chips are unusable in a truck.
          <div className="flex gap-2">
            <button onClick={toggleMic}
              className="mic-rail font-mono-x flex-1 rounded-lg border px-4 py-3 text-center text-[11px] tracking-[0.2em]"
              style={listening
                ? { borderColor: "rgba(120,220,120,.7)", background: "rgba(120,220,120,.12)", color: "#9fe89f" }
                : { borderColor: "rgba(255,158,61,.75)", background: "rgba(255,158,61,.14)", color: "var(--ember-amber)" }}>
              <EmberIcon name="mic" size={13} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
              {earState !== "off" ? "IN CONVERSATION — TAP TO END" : "TAP TO TALK TO EMBER"}
            </button>
            <button onClick={() => { unlockSpeech(); setVoiceOn(!voiceOn); }} aria-pressed={voiceOn}
              className="font-mono-x rounded-lg border px-4 py-3 text-center text-[11px] tracking-[0.2em]"
              style={voiceOn
                ? { borderColor: "rgba(255,158,61,.75)", background: "rgba(255,158,61,.14)", color: "var(--ember-amber)" }
                : { borderColor: "rgba(160,160,160,.5)", background: "rgba(160,160,160,.08)", color: "#9a9a9a" }}>
              {voiceOn ? "VOICE ON" : "TAP FOR VOICE MODE"}
            </button>
          </div>
        )}
        {inlineMic && earState === "off" && !micArm && (
          <div className="font-mono-x text-center text-[9px] tracking-[0.2em]" style={{ color: "var(--ink-faint)" }}>
            MIC RELEASED — YOUR TRUCK AUDIO IS UNTOUCHED UNTIL YOU TAP
          </div>
        )}
        {voiceList.length > 0 && (
          <div className="flex items-center justify-center gap-2">
            <span className="font-mono-x text-[9px] tracking-[0.2em]" style={{ color: "var(--ink-faint)" }}>HER VOICE</span>
            <select className="voice-pick font-mono-x" value={voiceChoice}
              onChange={(e) => { unlockSpeech(); setVoiceChoice(e.target.value); }}>
              <option value="">Automatic</option>
              {voiceList.map((v) => (
                <option key={v.name} value={v.name}>{v.name}{v.localService ? "" : " (network)"}</option>
              ))}
            </select>
            <button className="chip ghost" onClick={testVoice} style={{ fontSize: "9px", padding: "3px 8px" }}>HEAR IT</button>
          </div>
        )}
        {inlineMic && voiceTrace.length > 0 && (
          <div className="font-mono-x rounded-lg border px-3 py-1.5 text-[8px] leading-relaxed"
            style={{ borderColor: "var(--ember-panel-line)", background: "#0c0a09", color: "var(--ink-faint)" }}>
            {voiceTrace.slice(-3).map((l, i) => <div key={i}>{l}</div>)}
            <div style={{ color: "var(--brass)" }}>BUILD {BUILD_STAMP} — screenshot this if she goes silent</div>
          </div>
        )}
        {!inlineMic && hasSR && earState === "passive" && (
          <div onClick={toggleMic} role="button" className="mic-rail font-mono-x rounded-lg border px-4 py-2 text-center text-[10px] tracking-[0.25em]"
            style={{ cursor: "pointer", borderColor: "rgba(255,158,61,.45)", background: "rgba(255,158,61,.07)", color: "var(--ember-amber)" }}>
            <EmberIcon name="mic" size={12} style={{ verticalAlign: "-2px", marginRight: "6px" }} />EAR ON — SAY "EMBER, AWAKE" · CLICK TO TURN OFF
          </div>
        )}
        {!inlineMic && hasSR && earState === "armed" && (
          <div className="mic-rail font-mono-x rounded-lg border px-4 py-2 text-center text-[10px] tracking-[0.25em]"
            style={{ borderColor: "rgba(120,220,120,.7)", background: "rgba(120,220,120,.10)", color: "#9fe89f" }}>
            <EmberIcon name="mic" size={12} style={{ verticalAlign: "-2px", marginRight: "6px" }} />AWAKE — WHAT DO YOU NEED?
          </div>
        )}
        {!inlineMic && micArm && !listening && !hasSR && (
          <div className="mic-rail font-mono-x rounded-lg border px-4 py-2 text-center text-[10px] tracking-[0.25em]"
            style={{ borderColor: "rgba(255,158,61,.45)", background: "rgba(255,158,61,.07)", color: "var(--ember-amber)" }}>
            <EmberIcon name="mic" size={12} style={{ verticalAlign: "-2px", marginRight: "6px" }} />MIC ARMED — CLICK ANYWHERE TO GO LIVE
          </div>
        )}

        {error && (
          <div className="rounded-lg border px-4 py-2 text-xs font-semibold"
            style={{ borderColor: "rgba(255,77,61,.5)", background: "rgba(255,77,61,.08)", color: "#ff8074" }}>
            {error}
          </div>
        )}

        {/* ================= OPS VIEW ================= */}
        {view === "ops" && (
        <div className="main-grid flex-1">

          {/* LEFT */}
          <div ref={callsColRef} className="ops-side flex min-h-0 flex-col gap-4">
            <Panel notch="warm" title="Calls & Voicemail" count={`${data.voicemails.length} ITEMS`} countColor="var(--ember-orange)" delay="0.15s" grow>
              {data.voicemails.map((v, i) => (
                <Row key={i} who={`${v.from}${v.line ? " · " + v.line : ""}`} when={v.time}
                  selected={selectedComm?.type === "vm" && selectedComm.i === i}
                  onClick={() => setSelectedComm(selectedComm?.type === "vm" && selectedComm.i === i ? null : { type: "vm", i })}>
                  {v.vm ? (
                    <div className="mt-1.5 rounded-r-lg px-3 py-2 text-[11.5px] italic leading-relaxed"
                      style={{ background: "rgba(255,158,61,.06)", borderLeft: "2px solid var(--ember-orange)", color: "var(--ink-dim)" }}>
                      "{v.vm}"
                    </div>
                  ) : (
                    <div className="mt-1 text-xs" style={{ color: "var(--ink-dim)" }}>{v.note || "No voicemail."}</div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" onClick={(e) => { e.stopPropagation(); sendCommand(`Draft a reply text to ${v.from} on the ${v.line || "Fishing"} Quo line responding to: "${v.vm || "their missed call — apologize we missed them and ask how we can help"}". Premium-but-warm, BLUF, sign Brady @ Baxstar. Show me the draft — don't send yet.`); }}>
                      Draft reply
                    </button>
                    <button className="chip ghost" onClick={(e) => { e.stopPropagation(); sendCommand(`Create a Quo task to call back ${v.from} (${v.line || "Fishing"} line) tomorrow morning re: ${v.vm ? "their voicemail" : "their missed call"}.`); }}>
                      Task
                    </button>
                  </div>
                </Row>
              ))}
            </Panel>

            {/* Revenue is set by Brady, never invented — a hardcoded demo number
                used to live here and read as real, which is worse than nothing. */}
            <Panel notch="hot" title="Today's Revenue" count={revSet ? `+$${revToday.n.toLocaleString()}` : "—"} countColor="#ffb87a" codexCount delay="0.25s">
              <Odometer value={revSet ? odoFmt(revToday.n) : "$--,---"} />
              <Row who={revSet ? "Set by you today" : "Not logged yet"}>
                <div className="mt-1 text-xs" style={{ color: "var(--ink-dim)" }}>
                  <button className="chip ghost" onClick={editRevenue}>{revSet ? "Update" : "Set today's number"}</button>
                </div>
              </Row>
            </Panel>
          </div>

          {/* CENTER: CORE — first thing on a phone (.ops-core orders it to the top).
              One compact greeting line; the counts are BUTTONS that jump to their
              panels, because a number you can't act on is dead weight up here. */}
          <div className="ops-core flex min-h-0 flex-col">
            <div className={`core-chamber panel skull-host relative flex flex-1 flex-col items-center justify-center ${listening ? "is-listening" : ""} ${thinking ? "is-thinking" : ""}`}>
              {/* The skeleton. Its CSS survived the v2 merge but this element didn't —
                  the class had nothing to draw until 2026-08-01. */}
              <img src={`${ASSETS}/raster/skull-arch@2x.png`} alt="" aria-hidden="true" className="skull-arch" />
              <span className="notch hot" />

              <ContextLever side="left" label="Draft Reply" state={leverState("draft")} onPull={leverDraftReply} />
              <ContextLever side="right" label="Create Task" state={leverState("task")} onPull={leverCreateTask} />

              <div className="greet-row reveal flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center" style={{ animationDelay: "0.1s" }}>
                <span className="greet-hi text-[15px] font-bold tracking-tight">
                  {dayPart},{" "}
                  <span style={{ background: "linear-gradient(90deg,var(--ember-red),var(--ember-orange),var(--ember-dark))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                    Brady.
                  </span>
                </span>
                <button className="chip ghost" onClick={() => callsColRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  {data.voicemails.length} <span className="greet-long">voicemails</span><span className="greet-short">vm</span> ↓
                </button>
                <button className="chip ghost" onClick={() => inboxColRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  {data.emails.length} unread ↓
                </button>
              </div>

              <div className="reveal core-wrap flex flex-col items-center" style={{ animationDelay: "0.35s" }}>
                {coreMode === "enigma" ? (
                  <div className="reactor-stage" onClick={toggleMic} role="button" aria-label="Voice input">
                    <img src={`${ASSETS}/raster/reactor-bezel@2x.webp`} alt="" aria-hidden="true" className="reactor-bezel" />
                    <div className="reactor-core-orb">
                      <img src={`${ASSETS}/svg/controls/mic-orb-shell.svg`} alt="" aria-hidden="true" className="orb-shell" />
                      <div ref={gasRef} className="gas-wrap">
                        <div className="gas g1" /><div className="gas g2" /><div className="gas g3" /><div className="gas g4" />
                      </div>
                      <div ref={ventRef} className="pointer-events-none absolute z-10" style={{ inset: "-26px" }} />
                    </div>
                  </div>
                ) : (
                  <div className="scope-bezel mx-auto my-6" onClick={toggleMic} role="button" aria-label="Voice input">
                    <span className="scope-screw" style={{ top: "5px", left: "6px" }} />
                    <span className="scope-screw" style={{ top: "5px", right: "6px" }} />
                    <span className="scope-screw" style={{ bottom: "5px", left: "6px" }} />
                    <span className="scope-screw" style={{ bottom: "5px", right: "6px" }} />
                    <canvas ref={scopeRef} width="300" height="110" style={{ display: "block" }} />
                  </div>
                )}

                {/* status + demoted utilities on ONE row — these were stacked four
                    high and pushed the input off the phone screen */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <span className="font-mono-x text-[9.5px] tracking-[0.25em]"
                    style={{ color: thinking ? "var(--ember-orange)" : listening ? "var(--ember-red)" : speaking ? "var(--ember-orange)" : "var(--ink-faint)" }}>
                    {thinking ? "THINKING…" : listening ? "LISTENING…" : speaking ? "SPEAKING…" : "TAP TO OPEN MIC"}
                  </span>
                  {speaking && <button className="chip solid" onClick={stopSpeaking}>⏹ Stop</button>}
                  {/* An off switch that is always reachable while the mic is live. It used
                      to live only in the popup bridge window, so on the desktop the only
                      way to stop a runaway session was to find that window. */}
                  {listening && (
                    <button className="chip solid" onClick={() => { stopSpeaking(); stopAllMics(); }}>
                      ⏹ Stop listening
                    </button>
                  )}
                  {/* The mute state was only legible in the header (desktop) or a bar above
                      the fold (phone), so Brady had voice off without knowing and read the
                      silence as broken audio. State + fix in one tap, next to the status. */}
                  <button className="chip"
                    onClick={() => { unlockSpeech(); setVoiceOn(!voiceOn); }} aria-pressed={voiceOn}
                    style={voiceOn
                      ? { borderColor: "rgba(255,158,61,.75)", background: "rgba(255,158,61,.14)", color: "var(--ember-amber)" }
                      : { borderColor: "rgba(120,110,100,.5)", background: "rgba(60,54,48,.35)", color: "#8a8078" }}>
                    {voiceOn ? "VOICE ON" : "TAP FOR VOICE MODE"}
                  </button>
                  <button className={`seg sm ${coreMode === "enigma" ? "on" : ""}`} onClick={() => setCoreMode("enigma")}>ENIGMA</button>
                  <button className={`seg sm ${coreMode === "scope" ? "on" : ""}`} onClick={() => setCoreMode("scope")}>SCOPE</button>
                  <button className="chip ghost" onClick={testVoice}><EmberIcon name="speaker" size={11} style={{ verticalAlign: "-2px", marginRight: "4px" }} />TEST</button>
                </div>
                {voiceDiag && (
                  <div className="font-mono-x mt-1.5 max-w-xs text-center text-[9px] leading-relaxed tracking-[0.15em]" style={{ color: "var(--ember-amber)" }}>
                    {voiceDiag}
                  </div>
                )}
              </div>

              {/* THE THREAD — home is the real Claude chat (Brady, 2026-08-01). Full
                  scrolling history, not a single-answer box; OPS commands, dock
                  actions and typed questions all land here. */}
              {chatMsgs.length > 0 && (
                <div className="home-thread reveal w-full" style={{ animationDelay: "0.45s" }}>
                  {chatMsgs.map((m, i) => (
                    m.role === "user" ? (
                      <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-sm border px-4 py-2.5 text-[12.5px] leading-relaxed"
                        style={{ background: "rgba(255,77,61,.13)", borderColor: "var(--line-hot)", color: "var(--ink)" }}>
                        {m.content}
                      </div>
                    ) : (
                      <div key={i} className="max-w-[85%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[12.5px] leading-relaxed"
                        style={{ background: "#140d0d", borderColor: "var(--line)", color: "var(--ink)" }}>
                        <span className="mb-1 flex items-center justify-between gap-3">
                          <span className="font-mono-x text-[8.5px] tracking-[0.25em]" style={{ color: "var(--ember-orange)" }}>EMBER</span>
                          <button onClick={() => speak(m.content)} title="Read aloud" style={{ color: "var(--ember-orange)" }}>
                            <EmberIcon name="speaker" size={12} />
                          </button>
                        </span>
                        {m.content}
                      </div>
                    )
                  ))}
                  {thinking && (
                    <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-sm border px-4 py-3"
                      style={{ background: "#140d0d", borderColor: "var(--line)" }}>
                      <span className="spinner dark" />
                      <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--ember-orange)" }}>THINKING…</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              <div className="reveal relative w-full max-w-sm" style={{ animationDelay: "0.55s" }}>
                <input
                  type="text" value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  onKeyDown={(e) => e.key === "Enter" && sendCommand()}
                  className="cmd-input w-full rounded-xl px-5 py-3.5 text-sm"
                  style={{ background: "#120c0c", color: "var(--ink)" }}
                />
                {command === "" && !focused && (
                  <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--ink-faint)" }}>
                    Ask anything — "what'd I miss?"<span className="cursor-block" />
                  </span>
                )}
                {/* Talk-to-type: fills the box, never sends by itself. */}
                <button onClick={toggleDictation} title="Talk to type" aria-pressed={dictating} aria-label="Dictate into the command box"
                  className="absolute right-14 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1"
                  style={{ color: dictating ? "var(--ember-red)" : "var(--ink-faint)", filter: dictating ? "drop-shadow(0 0 6px rgba(255,77,61,.7))" : "none" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                    <path d="M12 18v4" />
                  </svg>
                </button>
                <button onClick={() => sendCommand()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-[10px] font-bold text-white transition-opacity"
                  style={{ background: "linear-gradient(90deg,var(--ember-red),#ff6a4d)", opacity: command ? 1 : 0.35 }}>
                  RUN
                </button>
              </div>

              {queued && (
                <div className="font-mono-x w-full max-w-sm text-[9px] tracking-[0.2em]" style={{ color: "var(--ink-faint)" }}>
                  QUEUED — RUNS WHEN SHE FINISHES: {queued.length > 54 ? queued.slice(0, 54) + "…" : queued}
                </div>
              )}

              {/* Model + Effort live on the home page now — the codex wraps instead of
                  running off the right edge of a phone. */}
              <div className="reveal flex w-full max-w-md flex-wrap items-center justify-center gap-x-4 gap-y-2" style={{ animationDelay: "0.6s" }}>
                <div className="flex max-w-full items-center gap-2">
                  <span className="fieldlabel">Model</span>
                  <div className="codex">
                    {MODELS.map((m) => (
                      <button key={m.id} className={`seg sm ${chatModel === m.id ? "on" : ""}`} onClick={() => setChatModel(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex max-w-full items-center gap-2">
                  <span className="fieldlabel">Effort</span>
                  <div className="codex">
                    {Object.entries(EFFORT).map(([k, e]) => (
                      <button key={k} className={`seg sm ${chatEffort === k ? "on" : ""}`} onClick={() => setChatEffort(k)}>
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>
                {chatMsgs.length > 0 && (
                  <button className="chip ghost" onClick={() => { setChatMsgs([]); historyRef.current = []; }}>Clear thread</button>
                )}
              </div>

              {/* editable lever draft — never sends automatically */}
              {draftEdit !== null && (
                <div className="w-full max-w-sm rounded-xl border px-4 py-3"
                  style={{ borderColor: "rgba(214,179,106,.5)", background: "rgba(214,179,106,.05)" }}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--ember-brass-bright)" }}>DRAFT — EDIT FREELY, NOTHING SENDS</span>
                    <button onClick={() => { setDraftEdit(null); setLeverPending(null); }} className="text-xs" style={{ color: "var(--ink-faint)" }}>✕</button>
                  </div>
                  <textarea value={draftEdit}
                    onChange={(e) => { setDraftEdit(e.target.value); setLeverPending(null); }}
                    className="cmd-input w-full rounded-xl p-3 text-[12.5px] leading-relaxed"
                    style={{ background: "#120c0c", color: "var(--ink)", minHeight: "130px", resize: "vertical" }} />
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" onClick={() => {
                      navigator.clipboard.writeText(draftEdit).catch(() => {});
                      setDraftCopied(true); setTimeout(() => setDraftCopied(false), 1600);
                      setLeverPending(null);
                    }}>{draftCopied ? "COPIED ✓" : "Copy draft"}</button>
                    <button className="chip ghost" onClick={() => { setDraftEdit(null); setLeverPending(null); }}>Discard</button>
                  </div>
                </div>
              )}

              {/* task proposal — requires explicit confirmation before saving */}
              {taskProposal && (
                <div className="w-full max-w-sm rounded-xl border px-4 py-3"
                  style={{ borderColor: "rgba(255,177,59,.5)", background: "rgba(255,177,59,.05)" }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--ember-warning)" }}>TASK PROPOSAL — CONFIRM TO SAVE</span>
                    <button onClick={() => { setTaskProposal(null); setLeverPending(null); }} className="text-xs" style={{ color: "var(--ink-faint)" }}>✕</button>
                  </div>
                  <div className="fieldlabel">Title</div>
                  <input value={taskProposal.title}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, title: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />
                  <div className="fieldlabel mt-2">Due</div>
                  <input value={taskProposal.due}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, due: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />
                  <div className="fieldlabel mt-2">Details</div>
                  <textarea value={taskProposal.details}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, details: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-[12.5px]"
                    style={{ background: "#120c0c", color: "var(--ink)", minHeight: "60px", resize: "vertical" }} />
                  <div className="mt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>Source: {taskProposal.source}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" disabled={thinking} onClick={confirmTaskProposal}>Create task</button>
                    <button className="chip ghost" onClick={() => { setTaskProposal(null); setLeverPending(null); }}>Discard</button>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT */}
          <div ref={inboxColRef} className="ops-side flex min-h-0 flex-col gap-4">
            <Panel notch="hot" title="Inbox" count={`${data.emails.length} UNREAD`} countColor="#ff8074" delay="0.2s" grow>
              {data.emails.map((m, i) => (
                <Row key={i} who={m.from} when={m.time}
                  selected={selectedComm?.type === "email" && selectedComm.i === i}
                  onClick={() => setSelectedComm(selectedComm?.type === "email" && selectedComm.i === i ? null : { type: "email", i })}>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-dim)" }}>{m.subject}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" onClick={(e) => { e.stopPropagation(); sendCommand(`Draft a reply to the email from ${m.from}: "${m.subject}". Match Baxstar voice. Show me the draft — don't send yet.`); }}>
                      Draft reply
                    </button>
                  </div>
                </Row>
              ))}
            </Panel>

            <Panel notch="cool" title="Schedule" count={`${data.events.length} EVENTS`} countColor="var(--brass)" gauge={data.events.length / 6} delay="0.3s">
              {data.events.map((e, i) => (
                <Row key={i} who={`${e.time} — ${e.title}`} when={e.detail} />
              ))}
            </Panel>
          </div>
        </div>
        )}

        {/* ================= BAXSTAR STUDIO VIEW ================= */}
        {view === "studio" && (
        <div className="studio-stack flex-1">

          {/* TOOLS — one horizontal strip, tap a tile, its panel opens below.
              Hidden in the lean mobile caption shell (?lean=1), which pins to captions. */}
          {!leanCaption && (
          <div className="studio-tools-panel panel reveal px-5 py-4" style={{ animationDelay: "0.08s" }}>
            <span className="notch hot" />
            <div className="tool-grid">
              {TOOLS.map((t) => (
                <button key={t.id} className={`tool-tile ${studioTool === t.id ? "on" : ""}`} onClick={() => setStudioTool(t.id)}>
                  <span className="tic">
                    {t.id === "drive" || t.id === "github"
                      ? <BrandMark tool={t.id} active={studioTool === t.id} />
                      : <EmberIcon name={t.icon} />}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* TOOL BAY */}
          <div className="flex min-h-0 flex-1 flex-col">

            {/* --- CAPTION STUDIO --- */}
            {studioTool === "captions" && (
            <div className="cap-grid flex-1">
              <Panel notch="warm" title="Photo & Detection"
                count={analyzing ? "SCANNING" : fishId ? `${(fishId.confidence || "").toUpperCase()} ID` : "AWAITING PHOTO"}
                countColor={analyzing ? "var(--ember-orange)" : fishId ? "#54e08a" : "var(--ink-faint)"} delay="0.1s" grow>

                <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />

                {captionRestored && (
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[11px]"
                    style={{ borderColor: "rgba(255,191,94,.45)", background: "rgba(255,191,94,.07)", color: "var(--ember-amber)" }}>
                    <span><EmberIcon name="spark" size={11} style={{ verticalAlign: "-1px", marginRight: "6px" }} />Recovered your last unfinished caption.</span>
                    <button className="chip ghost" onClick={discardDraft}>Start fresh</button>
                  </div>
                )}

                {!photos.length ? (
                  <div className="upzone mt-1" onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
                    <div style={{ color: "var(--ember-amber)", opacity: .7 }}><EmberIcon name="hook" size={34} strokeWidth={1.25} /></div>
                    <div className="mt-2 text-[13px] font-bold">Drop fish photos, or click to upload</div>
                    <div className="mt-1 text-[11px]" style={{ color: "var(--ink-faint)" }}>
                      Up to {MAX_PHOTOS} for one carousel · vision auto-scans for species and sponsor gear
                    </div>
                  </div>
                ) : (
                  <div className="mt-1"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
                    <div className="relative">
                      <img src={photos[0].preview} alt="Catch"
                        className="w-full rounded-xl border object-cover" style={{ borderColor: "var(--line)", maxHeight: "230px" }} />
                      {analyzing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl"
                          style={{ background: "rgba(8,6,6,.65)" }}>
                          <span className="spinner dark" />
                          <span className="font-mono-x text-[9px] tracking-[0.3em]" style={{ color: "var(--ember-orange)" }}>SCANNING…</span>
                        </div>
                      )}
                      <button className="chip ghost absolute right-2 top-2" style={{ background: "rgba(8,6,6,.7)" }}
                        disabled={photos.length >= MAX_PHOTOS}
                        onClick={() => fileRef.current?.click()}>
                        {photos.length < MAX_PHOTOS ? "Add photo" : "Carousel full"}
                      </button>
                      {/* Feed-aspect flag on the cover photo. Only speaks when a feed
                          surface is on — a story-only post is allowed to be tall. */}
                      {(surfaces.ig_feed || surfaces.fb_page) && tallForFeed(photos[0]) && (
                        <button className="chip absolute bottom-2 left-2 text-[10px] font-bold"
                          style={{ background: "rgba(8,6,6,.8)", border: "1px solid var(--ember-amber)", color: "var(--ember-amber)" }}
                          onClick={() => fitPhoto45(0)}>
                          TALLER THAN 4:5 FEED — FIT 4:5
                        </button>
                      )}
                      {photos[0]?.cropped45 && (
                        <span className="font-mono-x absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[9px] tracking-[0.15em]"
                          style={{ background: "rgba(8,6,6,.75)", color: "#54e08a" }}>
                          FEED 4:5 ✓ STORY KEEPS FULL FRAME
                        </span>
                      )}
                    </div>

                    {/* Slide strip — order is the carousel order, slide 1 is the cover.
                        Instagram crops every slide to the FIRST slide's aspect ratio. */}
                    {photos.length > 1 && (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {photos.map((p, i) => (
                            <div key={i} className="relative">
                              <img src={p.preview} alt={`Slide ${i + 1}`}
                                className="rounded-lg border object-cover"
                                style={{
                                  borderColor: (surfaces.ig_feed || surfaces.fb_page) && tallForFeed(p)
                                    ? "var(--ember-amber)"
                                    : i === 0 ? "var(--brass)" : "var(--line)",
                                  width: "56px", height: "56px",
                                }} />
                              <span className="font-mono-x absolute left-1 top-1 rounded px-1 text-[8px]"
                                style={{ background: "rgba(8,6,6,.75)", color: i === 0 ? "var(--brass)" : "var(--ink-dim)" }}>
                                {i + 1}
                              </span>
                              <button aria-label={`Remove slide ${i + 1}`}
                                className="absolute -right-1.5 -top-1.5 rounded-full px-1 text-[10px] font-bold"
                                style={{ background: "#2a1414", border: "1px solid var(--line)", color: "#ff8074", lineHeight: "14px" }}
                                onClick={() => removePhoto(i)}>×</button>
                              {(surfaces.ig_feed || surfaces.fb_page) && tallForFeed(p) && (
                                <button aria-label={`Fit slide ${i + 1} to 4:5`}
                                  className="font-mono-x absolute bottom-0 left-0 right-0 rounded-b-lg px-0 py-0.5 text-[7px] font-bold tracking-[0.1em]"
                                  style={{ background: "rgba(8,6,6,.85)", color: "var(--ember-amber)", border: "none" }}
                                  onClick={() => fitPhoto45(i)}>
                                  FIT 4:5
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
                          {photos.length}/{MAX_PHOTOS} slides · Instagram crops every slide to slide 1's shape
                        </div>
                      </>
                    )}
                  </div>
                )}

                {fishId && !analyzing && (
                  <div className="mt-4">
                    <div className="fieldlabel">Species</div>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-xl font-extrabold"
                        style={{ background: "linear-gradient(90deg,var(--ember-red),var(--ember-orange))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                        {fishId.species}
                      </span>
                      <span className="font-mono-x rounded-full border px-2 py-0.5 text-[9px] tracking-widest"
                        style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}>
                        {(fishId.confidence || "").toUpperCase()}
                      </span>
                    </div>
                    {fishId.notes && <div className="mt-1 text-[11px]" style={{ color: "var(--ink-dim)" }}>{fishId.notes}</div>}
                  </div>
                )}

                <div className="mt-4">
                  <div className="fieldlabel">Sponsor Tags</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SPONSOR_KEYS.map((k) => (
                      <button key={k} className={`toggle-chip ${sponsors[k].on ? "on" : ""}`} onClick={() => toggleSponsor(k)}
                        title={SPONSORS[k].handles.join(" ")}>
                        {SPONSORS[k].label}
                        {sponsors[k].detected && <span className="vision-tag">VISION</span>}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
                    Vision pre-arms what it can see — you confirm before anything is tagged.
                  </div>
                </div>

                <div className="mt-4 flex gap-4">
                  <div className="flex-1">
                    <div className="fieldlabel">Lake</div>
                    <input value={lake} onChange={(e) => setLake(e.target.value)}
                      className="cmd-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
                      style={{ background: "#120c0c", color: "var(--ink)" }} />
                  </div>
                  <div>
                    <div className="fieldlabel">Posting Window</div>
                    <div className="mt-2 flex gap-2">
                      {POST_PRESETS.map((t) => (
                        <button key={t} className={`seg ${postTime === t ? "on" : ""}`} onClick={() => setPostTime(t)}>
                          {fmtPostTime(t)}
                        </button>
                      ))}
                      <input type="time" value={postTime} aria-label="Custom posting time"
                        onChange={(e) => setPostTime(e.target.value || "16:00")}
                        className="cmd-input rounded-lg px-2 py-1.5 text-[12px]"
                        style={{ background: "#120c0c", color: "var(--ink)", colorScheme: "dark" }} />
                    </div>
                  </div>
                </div>

                {/* Destinations. One tap adds a surface; the payload carries the set and
                    the Zap fans out. Video surfaces are visible but disabled until the
                    video pipeline exists — an honest grey beats a dead toggle. */}
                <div className="mt-4">
                  <div className="fieldlabel">Where It Goes</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SURFACES.map((sf) => (
                      <button key={sf.id} disabled={sf.needsVideo}
                        aria-pressed={!!surfaces[sf.id]}
                        title={sf.needsVideo ? "Needs video — coming in the video phase" : ""}
                        className={`seg surface-chip ${surfaces[sf.id] && !sf.needsVideo ? "on" : ""}`}
                        onClick={() => setSurfaces((cur) => ({ ...cur, [sf.id]: !cur[sf.id] }))}>
                        {sf.label}{sf.needsVideo ? " ·🎬" : ""}
                      </button>
                    ))}
                  </div>
                  {(surfaces.ig_story || surfaces.fb_story) && (
                    <div className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
                      Stories go out as 9:16 renders of your photos — no caption text on a story.
                    </div>
                  )}
                </div>

                {/* The outbox endpoint is a ONE-TIME, PER-DEVICE setup step, so it earns
                    permanent space only until it's done. Unset: the full field, impossible
                    to miss. Set: a single quiet line with a Change link. It has been both
                    too hidden (behind an icon that needed a finished caption to appear) and
                    too loud (a permanent form field in the panel used on every trip) —
                    this is the middle. */}
                {!outboxUrl ? (
                  <div className="mt-4 rounded-lg border p-3"
                    style={{ borderColor: "rgba(255,177,59,.45)", background: "rgba(255,177,59,.05)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="fieldlabel" style={{ color: "var(--ember-amber)" }}>Drive Outbox — one-time setup</div>
                      <span className="font-mono-x text-[9px] tracking-[0.2em]" style={{ color: "var(--ember-amber)" }}>NOT SET</span>
                    </div>
                    <input value={outboxUrl} onChange={(e) => saveOutboxUrl(e.target.value)}
                      placeholder="Paste your Apps Script /exec URL here"
                      aria-label="Drive outbox URL"
                      className="cmd-input mt-2 w-full rounded-lg px-3 py-2 text-[12px]"
                      style={{ background: "#120c0c", color: "var(--ink)" }} />
                    <div className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                      Saved on this device, then this box goes away. Publishing drops the photo +
                      caption into a private Drive folder — it does <b>not</b> post to Instagram by itself.
                    </div>
                  </div>
                ) : outboxEdit ? (
                  <div className="mt-4">
                    <div className="fieldlabel">Drive Outbox URL</div>
                    <input value={outboxUrl} onChange={(e) => saveOutboxUrl(e.target.value)}
                      autoFocus aria-label="Drive outbox URL"
                      className="cmd-input mt-2 w-full rounded-lg px-3 py-2 text-[12px]"
                      style={{ background: "#120c0c", color: "var(--ink)" }} />
                    <button className="chip ghost mt-2" onClick={() => setOutboxEdit(false)}>Done</button>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: "var(--ink-faint)" }}>
                    <span style={{ color: "#54e08a" }}>●</span>
                    <span>Drive outbox connected</span>
                    <button className="underline" style={{ color: "var(--ink-faint)" }}
                      onClick={() => setOutboxEdit(true)}>change</button>
                  </div>
                )}

                <button className="big primary mt-5 w-full justify-center" disabled={!photos.length || analyzing || genBusy} onClick={generateCaption}>
                  {genBusy ? <span className="spinner" /> : <EmberIcon name="spark" size={14} />}
                  {genBusy ? "GENERATING…" : "Generate Caption"}
                </button>
                {capErr && <div className="mt-2 text-xs font-semibold" style={{ color: "#ff8074" }}>{capErr}</div>}
              </Panel>

              <Panel notch="hot" title="Caption" count={caption ? "READY" : "—"}
                countColor={caption ? "#54e08a" : "var(--ink-faint)"} delay="0.2s" grow>

                {!caption ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                    <div className="opacity-40"><EmberIcon name="quill" size={30} strokeWidth={1.25} /></div>
                    <div className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
                      Upload a photo and hit Generate.<br />Caption lands here, fully editable.
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea value={caption} onChange={(e) => setCaption(e.target.value)}
                      className="cmd-input w-full rounded-xl p-4 text-[13px] leading-relaxed"
                      style={{ background: "#120c0c", color: "var(--ink)", minHeight: "230px", resize: "vertical" }} />

                    <div className="lockrow">
                      <span style={{ display: "inline-flex" }}><EmberIcon name="lock" size={12} /></span> {LOCKED_TAG}
                      <span className="locktag font-mono-x">LOCKED · AUTO-APPENDED</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="font-mono-x rounded-full border px-2.5 py-1 text-[9px] tracking-widest"
                        style={{ borderColor: "var(--line)", color: "var(--brass)" }}>
                        POSTS {fmtPostTime(postTime).toUpperCase()}
                      </span>
                      {fishId && (
                        <span className="font-mono-x rounded-full border px-2.5 py-1 text-[9px] tracking-widest"
                          style={{ borderColor: "var(--line)", color: "var(--ember-orange)" }}>
                          {fishId.species.toUpperCase()}
                        </span>
                      )}
                      {photos.length > 1 && (
                        <span className="font-mono-x rounded-full border px-2.5 py-1 text-[9px] tracking-widest"
                          style={{ borderColor: "var(--line)", color: "var(--brass)" }}>
                          CAROUSEL · {photos.length}
                        </span>
                      )}
                      {activeHandles(sponsors).map((h) => (
                        <span key={h} className="font-mono-x rounded-full border px-2.5 py-1 text-[9px] tracking-widest"
                          style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}>
                          {h}
                        </span>
                      ))}
                      {/* Hashtag budget. Brady's rule is 5 total and the locked tag holds one
                          slot, so anything past four in the body is trimmed on the way out —
                          reported here rather than dropped silently. */}
                      <span className="font-mono-x rounded-full border px-2.5 py-1 text-[9px] tracking-widest"
                        style={{
                          borderColor: capState.dropped ? "rgba(255,128,116,.5)" : "var(--line)",
                          color: capState.dropped ? "#ff8074" : "var(--ink-dim)",
                        }}>
                        {capState.total}/{MAX_HASHTAGS} TAGS{capState.dropped ? ` · ${capState.dropped} TRIMMED` : ""}
                      </span>
                    </div>

                    <div className="mt-4 flex gap-3">
                      <button className="big primary flex-1 justify-center" onClick={copyCaption}>
                        {copied ? "COPIED ✓" : "Copy Caption"}
                      </button>
                      <button className="big" disabled={genBusy} onClick={generateCaption}>
                        {genBusy ? <span className="spinner" /> : "Regenerate"}
                      </button>
                    </div>

                    {/* Publish → private Drive outbox (review-then-post; never auto-posts to social) */}
                    <button className="big mt-3 w-full justify-center" disabled={publishing || !photos.length} onClick={publishToOutbox}
                      style={{ borderColor: "var(--brass)", color: "var(--candle)" }}>
                      {publishing ? <span className="spinner" /> : <EmberIcon name="drive" size={14} />}
                      {publishing ? "SENDING…" : "Publish to Drive Outbox"}
                    </button>

                    {publishMsg && (
                      <div className="mt-2 text-[11px] font-semibold"
                        style={{ color: /couldn|error|reach|add your/i.test(publishMsg) ? "#ff8074" : "#54e08a" }}>
                        {publishMsg}
                      </div>
                    )}
                  </>
                )}
              </Panel>
            </div>
            )}

            {/* --- GOOGLE DRIVE --- */}
            {studioTool === "drive" && (
            <Panel notch="cool" title="Google Drive" count={driveBusy ? "SEARCHING" : "AGENT OS"}
              countColor={driveBusy ? "var(--ember-orange)" : "var(--brass)"} delay="0.1s" grow scroll={false}>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button className="chip solid" onClick={() => window.open(HANDOFF_DOC_URL, "_blank", "noopener")}>
                  Open Handoff Log ↗
                </button>
                <button className="chip ghost" disabled={driveBusy}
                  onClick={() => sendDrive("Summarize the 3 newest entries in the Baxstar Handoff Log. BLUF, one short block per entry.")}>
                  Summarize latest Handoff entries
                </button>
                <button className="chip ghost" disabled={driveBusy}
                  onClick={() => sendDrive("List the docs in the Agent OS 02 Context Library and one line on what each covers.")}>
                  Scan Context Library
                </button>
                {driveMsgs.length > 0 && (
                  <button className="chip ghost ml-auto" onClick={() => setDriveMsgs([])}>Clear</button>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" style={{ minHeight: "280px" }}>
                {driveMsgs.length === 0 && !driveBusy && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <div className="opacity-60"><EmberIcon name="drive" size={32} strokeWidth={1.25} /></div>
                    <div className="mt-2 text-[12px]" style={{ color: "var(--ink-faint)" }}>
                      Search and read your Agent OS docs.<br />Read-only — writes stay in your normal Claude workflow.
                    </div>
                  </div>
                )}
                {driveMsgs.map((m, i) => (
                  m.role === "user" ? (
                    <div key={i} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-sm border px-4 py-2.5 text-[12.5px] leading-relaxed"
                      style={{ background: "rgba(93,216,255,.09)", borderColor: "rgba(93,216,255,.35)", color: "var(--ink)" }}>
                      {m.content}
                    </div>
                  ) : (
                    <div key={i} className="max-w-[85%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[12.5px] leading-relaxed"
                      style={{ background: "#140d0d", borderColor: "var(--line)", color: "var(--ink)" }}>
                      <span className="font-mono-x mb-1 block text-[8.5px] tracking-[0.25em]" style={{ color: "var(--brass)" }}>DRIVE</span>
                      {m.content}
                    </div>
                  )
                ))}
                {driveBusy && (
                  <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-sm border px-4 py-3"
                    style={{ background: "#140d0d", borderColor: "var(--line)" }}>
                    <span className="spinner dark" />
                    <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--candle)" }}>SEARCHING DRIVE…</span>
                  </div>
                )}
                <div ref={driveEndRef} />
              </div>

              <div className="relative mt-3">
                <input
                  type="text" value={driveInput}
                  onChange={(e) => setDriveInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendDrive()}
                  placeholder='Ask Drive — "what does Policy_Cancellation_Master say about Tier A?"'
                  className="cmd-input w-full rounded-xl px-5 py-3.5 pr-16 text-sm"
                  style={{ background: "#120c0c", color: "var(--ink)" }}
                />
                <button onClick={() => sendDrive()} disabled={driveBusy}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-[10px] font-bold text-white transition-opacity"
                  style={{ background: "linear-gradient(90deg,var(--ember-red),#ff6a4d)", opacity: driveInput && !driveBusy ? 1 : 0.35 }}>
                  ASK
                </button>
              </div>
            </Panel>
            )}

            {/* --- AI HANDOFF --- */}
            {studioTool === "handoff" && (
            <Panel notch="cool" title="AI Handoff" count="HUB PATTERN" countColor="var(--brass)" delay="0.1s" grow scroll={false}>
              <div className="text-[12px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                Package context → copy → open the other AI. Paste and go. No keys, no signups — uses your existing accounts.
              </div>

              <div className="mt-4">
                <div className="fieldlabel">Pull From</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PULLS.map((p) => (
                    <button key={p.label} className="chip ghost" disabled={!p.val}
                      onClick={() => { setHandoffText(p.val); setHandErr(""); }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <div className="fieldlabel">Context Package</div>
                <textarea value={handoffText} onChange={(e) => setHandoffText(e.target.value)}
                  placeholder="Write or pull the context you want to hand off…"
                  className="cmd-input mt-2 w-full flex-1 rounded-xl p-4 text-[13px] leading-relaxed"
                  style={{ background: "#120c0c", color: "var(--ink)", minHeight: "220px", resize: "vertical" }} />
              </div>

              <div className="mt-4 flex gap-3">
                {Object.entries(HANDOFF).map(([key, t]) => (
                  <button key={key} className="hbtn"
                    style={{
                      border: `1px solid ${t.color}55`,
                      color: t.color,
                      boxShadow: handoffCopied === key ? `0 0 30px ${t.color}66` : `0 4px 22px ${t.color}26, inset 0 1px 0 rgba(255,255,255,.05)`,
                      background: handoffCopied === key ? `${t.color}22` : "var(--panel-2)",
                    }}
                    onClick={() => handoffTo(key)}>
                    <span className="h-2 w-2 rounded-full" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
                    {handoffCopied === key ? "COPIED ✓ — OPENING…" : `Send to ${t.label}`}
                  </button>
                ))}
              </div>
              {handErr && <div className="mt-2 text-xs font-semibold" style={{ color: "#ff8074" }}>{handErr}</div>}
            </Panel>
            )}

            {/* --- HTML VIEWER --- */}
            {studioTool === "html" && (
            <div className="cap-grid flex-1">
              <Panel notch="warm" title="Source" count="PASTE HTML" countColor="var(--ember-orange)" delay="0.1s" grow scroll={false}>
                <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                  Paste raw HTML — Wix Custom Embed code, email markup, a snippet you're testing — and render it sandboxed, right here.
                </div>
                <textarea value={htmlSrc} onChange={(e) => setHtmlSrc(e.target.value)}
                  placeholder="<div>Paste HTML here…</div>"
                  className="cmd-input mt-3 w-full flex-1 rounded-xl p-4 text-[12.5px] leading-relaxed"
                  style={{ background: "#120c0c", color: "var(--ink)", minHeight: "260px", resize: "vertical", fontFamily: "var(--font-mono-x, monospace)" }} />
                <div className="mt-3 flex gap-3">
                  <button className="big primary flex-1 justify-center" disabled={!htmlSrc.trim()} onClick={renderHtml}>Render</button>
                  <button className="big" onClick={() => { setHtmlSrc(""); setHtmlRendered(""); }}>Clear</button>
                </div>
              </Panel>

              <Panel notch="hot" title="Preview" count={htmlRendered ? "LIVE" : "—"}
                countColor={htmlRendered ? "#54e08a" : "var(--ink-faint)"} delay="0.2s" grow scroll={false}>
                {!htmlRendered ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                    <div className="opacity-40"><EmberIcon name="globe" size={30} strokeWidth={1.25} /></div>
                    <div className="text-[12px]" style={{ color: "var(--ink-faint)" }}>Rendered output shows here, sandboxed.</div>
                  </div>
                ) : (
                  <>
                    <iframe title="html-preview" srcDoc={htmlRendered} sandbox="allow-scripts allow-popups allow-forms"
                      className="w-full flex-1 rounded-xl border" style={{ borderColor: "var(--line)", background: "#fff", minHeight: "300px" }} />
                    <button className="big primary mt-3 justify-center" onClick={openHtmlNewTab}>Open in New Tab ↗</button>
                  </>
                )}
              </Panel>
            </div>
            )}

            {/* --- IMAGE FILTERS (placeholder) --- */}
            {studioTool === "filters" && (
            <Panel notch="cool" title="Baxstar Image Filters" count="PLANNED" countColor="var(--ember-amber)" delay="0.1s" grow scroll={false}>
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="opacity-50"><EmberIcon name="dials" size={36} strokeWidth={1.25} /></div>
                <div className="text-[15px] font-bold">Coming soon</div>
                <div className="max-w-sm text-[12.5px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                  A one-tap color grade for Baxstar photos before they hit Caption Studio — consistent warmth, contrast,
                  and a signature look across every post. Placeholder for now; slot in the real pipeline whenever you're ready to spec it.
                </div>
              </div>
            </Panel>
            )}

            {/* --- GITHUB --- */}
            {studioTool === "github" && (
            <div className="cap-grid flex-1">
              <Panel notch="warm" title="Repo Browser" count={ghRepo ? ghRepo.split("/")[1] : "PICK A REPO"}
                countColor={ghRepo ? "#54e08a" : "var(--ink-faint)"} delay="0.1s" grow scroll={false}>

                <div className="fieldlabel">Personal Access Token (optional)</div>
                <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)}
                  placeholder="Only needed for private repos — never saved, re-enter each session"
                  className="cmd-input mt-2 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />

                <div className="mt-3 fieldlabel">Repository</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GH_REPOS.map((r) => (
                    <button key={r} className={`toggle-chip ${ghRepo === r ? "on" : ""}`} onClick={() => ghBrowse(r, "")}>
                      {r.split("/")[1]}
                    </button>
                  ))}
                </div>
                <input value={ghRepo} onChange={(e) => setGhRepo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ghBrowse(ghRepo, "")}
                  placeholder="or type owner/repo…"
                  className="cmd-input mt-2 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />

                {ghRepo && (
                  <div className="mt-3 flex items-center gap-2 font-mono-x text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
                    <button className="chip ghost" disabled={!ghPath || ghBusy} onClick={ghGoUp}>↑ Up</button>
                    <span>/{ghPath}</span>
                  </div>
                )}

                {ghBusy && <div className="mt-3 flex items-center gap-2"><span className="spinner dark" /><span className="font-mono-x text-[10px]" style={{ color: "var(--ember-orange)" }}>LOADING…</span></div>}
                {ghErr && <div className="mt-2 text-xs font-semibold" style={{ color: "#ff8074" }}>{ghErr}</div>}

                {ghItems && !ghBusy && (
                  <div className="mt-3 flex flex-1 flex-col overflow-y-auto">
                    {ghItems
                      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
                      .map((item) => (
                        <div key={item.path} className="fs-item" onClick={() => ghOpenItem(item)}>
                          <span style={{ display: "inline-flex", opacity: .8 }}><EmberIcon name={item.type === "dir" ? "folder" : "file"} size={14} /></span>
                          <span style={{ color: "var(--ink)" }}>{item.name}</span>
                        </div>
                      ))}
                  </div>
                )}
              </Panel>

              <Panel notch="hot" title="File" count={ghFile ? ghFile.name : "—"}
                countColor={ghFile ? "#54e08a" : "var(--ink-faint)"} delay="0.2s" grow scroll={false}>
                {!ghFile ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                    <div className="opacity-50"><EmberIcon name="github" size={30} strokeWidth={1.25} /></div>
                    <div className="mt-2 text-[12px]" style={{ color: "var(--ink-faint)" }}>Pick a repo, browse to a file, read it here.</div>
                  </div>
                ) : (
                  <>
                    <div className="code-view flex-1">{ghFile.content}</div>
                    <div className="mt-3 flex gap-3">
                      <button className="big primary flex-1 justify-center" onClick={() => navigator.clipboard.writeText(ghFile.content).catch(() => {})}>Copy Contents</button>
                      {ghFile.htmlUrl && <button className="big" onClick={() => window.open(ghFile.htmlUrl, "_blank", "noopener")}>Open on GitHub ↗</button>}
                    </div>
                  </>
                )}
              </Panel>
            </div>
            )}

            {/* --- SNIPPETS --- */}
            {studioTool === "snippets" && (
            <Panel notch="cool" title="Snippets" count={`${SNIPPETS.length} SAVED`} countColor="var(--brass)" delay="0.1s" grow>
              {SNIPPETS.map((s, i) => (
                <Row key={i} who={s.title}>
                  <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>{s.text}</div>
                  <div className="mt-2">
                    <button className="chip solid" onClick={() => copySnippet(i, s.text)}>
                      {copiedSnippet === i ? "COPIED ✓" : "Copy"}
                    </button>
                  </div>
                </Row>
              ))}
            </Panel>
            )}

          </div>
        </div>
        )}

        {/* ================= PROJECTS VIEW ================= */}
        {/* The dashboard Brady asked for in the pinned DASHBOARD REQUIREMENTS: every open
            project as a horizontal bar under its category, with outstanding work and an
            honest session estimate. Data is the session-maintained PROJECTS constant. */}
        {view === "projects" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <Panel notch="hot" title="Project Status" count={`UPDATED ${PROJECTS_META.updated}`} countColor="var(--brass)" delay="0.1s" grow>
            <div className="proj-meta font-mono-x">
              <span>ZAPIER TASKS&nbsp;
                <b style={{ color: PROJECTS_META.zapierTasks.used == null ? "var(--ink-faint)" : "var(--ember-amber)" }}>
                  {PROJECTS_META.zapierTasks.used == null ? "not recorded" : PROJECTS_META.zapierTasks.used}
                </b>
                &nbsp;/ {PROJECTS_META.zapierTasks.cap} mo
              </span>
              <span style={{ color: "var(--ink-faint)" }}>{PROJECTS_META.zapierTasks.note}</span>
            </div>

            {PROJECTS.map((group) => (
              <div key={group.cat} className="mb-4">
                <div className="proj-cat font-display">{group.cat}</div>
                {group.items.map((pr) => (
                  <div key={pr.name} className="proj-row">
                    <div className="flex items-baseline justify-between gap-3">
                      {pr.links && pr.links.length ? (
                        <button className="proj-name-link text-[13px] font-semibold" onClick={() => openProjectTabs(pr.links)}
                          title={`Open ${pr.links.map(([l]) => l).join(" + ")}`}>
                          {pr.name}
                          <span className="proj-name-arrow"> ↗</span>
                        </button>
                      ) : (
                        <span className="text-[13px] font-semibold">{pr.name}</span>
                      )}
                      <span className="font-mono-x shrink-0 text-[10px]" style={{ color: "var(--ember-amber)" }}>
                        {pr.pct}%
                        {pr.platform !== "—" && <span style={{ color: "var(--ink-faint)" }}> · {pr.platform.toUpperCase()}</span>}
                      </span>
                    </div>
                    <div className="proj-bar" role="img" aria-label={`${pr.name}: ${pr.pct} percent complete`}>
                      <span className="proj-fill" style={{ width: `${pr.pct}%` }} data-pct={pr.pct} />
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px]" style={{ color: "var(--ink-dim)" }}>
                      <span>{pr.outstanding}</span>
                      {pr.sessions !== "0" && (
                        <span className="font-mono-x shrink-0 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>EST {pr.sessions} SESSIONS</span>
                      )}
                    </div>
                    {pr.links && pr.links.length > 1 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {pr.links.map(([label, url]) => (
                          <a key={url} className="proj-chip" href={url} target="_blank" rel="noopener noreferrer">{label}</a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
              Session-maintained — Claude updates this with each shipped piece of work. Edit PROJECTS in src to correct anything.
            </div>
          </Panel>
        </div>
        )}

        {/* ================= DOCK ================= */}
        {/* Pinned to the bottom of the screen at all times (position:fixed) — the shell
            carries matching bottom padding so content never hides behind it.
            Hidden in the lean mobile caption shell (?lean=1) — that route is single-purpose. */}
        {!leanCaption && (
        <div className="console-dock reveal" style={{ animationDelay: "0.65s" }}>
          <div className="console-dock-grid">
            <button className={`dock-control ${view === "ops" ? "active" : ""}`} onClick={() => setView("ops")}>
              <span className="dock-art"><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" style={{ "--panel-x": "42.857%" }} /></span>
              <span className="dock-label">OPS</span>
              <span className="dock-lamp" />
            </button>
            <button className={`dock-control ${view === "studio" ? "active" : ""}`}
              onClick={() => { setView("studio"); setStudioTool("captions"); }}>
              <span className="dock-art"><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" style={{ "--panel-x": "142.857%" }} /></span>
              <span className="dock-label">Caption Studio</span>
              <span className="dock-lamp" />
            </button>
          {ACTIONS.map((a, i) => (
            <button key={a.label} disabled={thinking} className={`dock-control ${a.primary && thinking ? "active" : ""}`}
              onClick={() => { setView("ops"); sendCommand(a.prompt); }}>
              <span className="dock-art"><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" style={{ "--panel-x": `${242.857 + i * 100}%` }} /></span>
              <span className="dock-label">{a.label}</span>
              <span className="dock-lamp" />
            </button>
          ))}
            <button className={`dock-control ${view === "projects" ? "active" : ""}`} onClick={() => setView("projects")}>
              <span className="dock-art"><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" style={{ "--panel-x": "542.857%" }} /></span>
              <span className="dock-label">Projects</span>
              <span className="dock-lamp" />
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SMALL PIECES
   ============================================================ */

function Panel({ notch, title, count, countColor, children, delay, grow, scroll = true, codexCount, gauge }) {
  return (
    <div className={`panel reveal flex flex-col px-5 py-4 ${grow ? "flex-1" : ""}`} style={{ animationDelay: delay, minHeight: 0 }}>
      <span className={`notch ${notch}`} />
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--ink-dim)" }}>{title}</h3>
        <span className="flex items-center gap-2">
          {gauge != null && (
            <span className="gauge-wrap" aria-hidden="true">
              <img src={`${ASSETS}/svg/controls/gauge-face.svg`} alt="" />
              <img src={`${ASSETS}/svg/controls/gauge-needle.svg`} alt="" className="gauge-needle"
                style={{ transform: `rotate(${(-52 + Math.max(0, Math.min(1, gauge)) * 104).toFixed(1)}deg)` }} />
            </span>
          )}
          {codexCount ? (
            <span className="codex font-mono-x text-[10px] font-semibold" style={{ color: countColor }}>{count}</span>
          ) : (
            <span className="font-mono-x rounded-full border px-2.5 py-0.5 text-[10px] font-semibold"
              style={{ color: countColor, borderColor: "var(--line)", background: "rgba(255,90,60,.06)" }}>
              {count}
            </span>
          )}
        </span>
      </div>
      <div className={`flex min-h-0 flex-1 flex-col ${scroll ? "overflow-y-auto" : ""}`}>{children}</div>
    </div>
  );
}

function Row({ who, when, children, onClick, selected }) {
  return (
    <div className={`ember-row border-b py-2.5 last:border-none ${onClick ? "row-sel" : ""} ${selected ? "row-on" : ""}`}
      style={{ borderColor: "rgba(255,90,60,.09)" }} onClick={onClick}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="row-title text-[13px] font-semibold">{who}</span>
        {when && <span className="font-mono-x shrink-0 text-[9.5px]" style={{ color: "var(--ink-faint)" }}>{when}</span>}
      </div>
      {children}
    </div>
  );
}

function Odometer({ value }) {
  return (
    <div className="odometer" aria-label={`Today's revenue ${value}`}>
      {String(value).split("").map((char, i) => (
        <span key={`${char}-${i}`} className={`odo-cell ${char === "," ? "punct" : ""}`}>{char}</span>
      ))}
    </div>
  );
}

function Badge({ label }) {
  return (
    <span className="badge-pulse inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold"
      style={{ background: "rgba(255,191,94,0.08)", border: "1px solid rgba(255,191,94,0.35)", color: "var(--ember-amber)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ember-amber)", boxShadow: "0 0 8px var(--ember-amber)" }} />
      {label}
    </span>
  );
}
