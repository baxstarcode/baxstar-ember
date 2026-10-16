import { useState, useEffect, useRef } from "react";

/* ============================================================
   BAXSTAR EMBER — FULL JARVIS BUILD v4.1
   ------------------------------------------------------------
   v4 adds:
     · Claude Chat: model toggle (Haiku / Sonnet / Opus / Fable) +
       effort level (Low / Med / High / Xtra). Failed requests stay visible so
       Brady can retry or choose a different model explicitly.
     · Google Drive tool in the Studio rail (real Drive icon) —
       search + read Agent OS docs via the Drive connector.
     · Background system for OPS + Studio: 4 built-in scene
       presets + upload-your-own (persisted on this device).

   MODULES: OPS | BAXSTAR STUDIO (Claude Chat, AI Handoff,
   Caption Studio, Google Drive).
   ============================================================ */

/* ---------- CONFIG ---------- */

const MCP_SERVERS = [
  // The browser requests names only. The Worker owns destinations, credentials,
  // and read-only toolsets, so client code cannot redirect or expand access.
  { name: "quo" },
  { name: "gmail" },
  { name: "calendar" },
];
const DRIVE_SERVER = { name: "gdrive" };

// Dock destinations (2026-10-15). FareHarbor's company dashboard is confirmed by
// the "Baxstar FareHarbor Pricing — Operator Playbook" (shortname baxstarfishing).
// Drive opens in Brady's own signed-in browser — no new sign-in system.
const DRIVE_URL = "https://drive.google.com/";
const FAREHARBOR_URL = "https://fareharbor.com/baxstarfishing/dashboard/";
// The Knowledge Foundry: baxstarcode/baxstar-knowledge-network, Cloudflare Pages.
const FOUNDRY_URL = "https://baxstar-knowledge-network.pages.dev/";

const HANDOFF_DOC_URL = "https://docs.google.com/document/d/1Gfs1H5KTmj5C7_-wm6AVs1IUO9ET1as8gVibHvdybns/edit";

const BRADY_CONTEXT = `You are EMBER, Brady Baxter's operations assistant for Baxstar Fishing and Lakes Golf Simulator in Detroit Lakes, MN.
Quo phone inboxes: Fishing 218-325-6857, Pontoon rentals 218-325-9846.
Style: BLUF — bottom line first. Concise. No hedging. Numerals without commas.
Customer-facing drafts: premium-but-warm, sign "Brady @ Baxstar". Fishing number in fishing comms, pontoon number in rental comms. Never mention Scheels rods. Never say "one group per day" — use "private trip(s)".
Use your tools (Quo, Gmail, Calendar) whenever the request involves calls, voicemails, texts, email, or schedule.
HARD RULE — schedule and messages: if a tool is unavailable or returns nothing, say exactly that ("I can't see your calendar right now") and STOP. Never state that a trip, booking, or message does or doesn't exist unless a tool actually returned that data. A guessed "you're free tomorrow" can cost Brady a paid charter.`;

// Every model call goes through this, never the bare const: the model has no
// clock, and left to guess it once decided "today" was mid-May — it pulled 170
// missed calls spanning 3 months (41KB of transcripts, a 61-second round trip
// that iOS Safari killed at 60s as "Sync failed") and reported May voicemails
// as recent. Reproduced live 2026-08-28. sync-standalone.py still copies the
// bare const by regex, which is why the date rides in a wrapper.
function bradyContext() {
  const stamp = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago", weekday: "long", year: "numeric",
    month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  return `${BRADY_CONTEXT}
Current date/time: ${stamp}. Compute "today", "tomorrow", and any look-back window from this timestamp — never guess a date.`;
}

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
/* ---------- YOUR TOOLS ----------
   The strip along the bottom of the dashboard. Edit this list and nothing else —
   it is the one place the links live. `note` is the small line under the name.
   Verified against the SITE HOSTING MAP (06_Baxstar_Tech_Stack_Context). */
const TOOL_LINKS = [
  { group: "Sites", items: [
    { label: "Baxstar Fishing", url: "https://baxstarfishing.com", note: "main site" },
    { label: "The Boat", url: "https://boat.baxstarfishing.com", note: "Vexus DVX 20S" },
    { label: "Lakes Golf Sim", url: "https://lakesgolfsim.com", note: "golf sim" },
    { label: "AI, For Real.", url: "https://ai.lakesgolfsim.com", note: "course signup" },
  ]},
  { group: "Tools", items: [
    { label: "Caption Studio", url: "https://baxstarcode.github.io/caption-studio/", note: "standalone" },
    { label: "Pontoon Check-In", url: "https://baxstarcode.github.io/baxstar-pontoon/", note: "rentals" },
    { label: "Classroom", url: "https://learn.lakesgolfsim.com", note: "live sessions" },
  ]},
  { group: "Back office", items: [
    { label: "FareHarbor", url: "https://fareharbor.com/dashboard/", note: "bookings" },
    { label: "Quo", url: "https://app.quo.com", note: "phone + texts" },
    { label: "Wix Editor", url: "https://manage.wix.com/", note: "edit the site" },
    { label: "Drive", url: "https://drive.google.com/", note: "Data Engine" },
  ]},
];

/* ---------- THE ECOSYSTEM GRAPH ----------
   Every moving part of Brady's operation and what it actually touches. Read-only:
   it draws what is true, it does not edit, sync, or generate anything.

   This is the ONE place the graph data lives. Edit these two arrays and nothing
   else — the layout is computed, so adding a node needs no coordinates.

   Provenance, so a later session can check a line instead of guessing: sites and
   hosting come from TOOL_LINKS above (itself verified against the SITE HOSTING MAP
   in 06_Baxstar_Tech_Stack_Context); connector edges from MCP_SERVERS and
   proxy/cloudflare-worker.js; document ownership from the Drive Router
   ("Baxstar Source of Truth", 1AgIxAj0YM8XNTTMHVcJInNAquLKnon-WB4i2DMzTzRQ);
   repos from the baxstarcode org. Nothing here is invented.

   The `g` field is the group id — it sets the colour and the legend filter.  */
const ECO_GROUPS = [
  { id: "core",     label: "Ember",     color: "#FF4D32" },
  { id: "business", label: "Business",  color: "#FF7A45" },
  { id: "site",     label: "Sites",     color: "#FFB13B" },
  { id: "repo",     label: "Repos",     color: "#D6B36A" },
  { id: "service",  label: "Services",  color: "#B08D57" },
  { id: "truth",    label: "Truth",     color: "#C9B18A" },
];

const ECO_NODES = [
  { id: "ember", g: "core", label: "EMBER", note: "This console — the front door to all of it", url: "https://ember.baxstarfishing.com" },

  { id: "fishing", g: "business", label: "Baxstar Fishing", note: "Guided trips, ice houses, pontoon rentals" },
  { id: "golf",    g: "business", label: "Lakes Golf Sim",  note: "Simulator bays and the tech camp" },
  { id: "consult", g: "business", label: "AI Consulting",   note: "Workflow audits and productized packages" },
  { id: "course",  g: "business", label: "AI, FOR REAL.",   note: "The course — landing page plus live sessions" },

  { id: "s-fishing", g: "site", label: "baxstarfishing.com", note: "Main site — Wix shell, HTML embeds from bax1", url: "https://baxstarfishing.com" },
  { id: "s-boat",    g: "site", label: "boat.baxstar…",      note: "Vexus DVX 20S page — GitHub Pages, self-publishing", url: "https://boat.baxstarfishing.com" },
  { id: "s-golf",    g: "site", label: "lakesgolfsim.com",   note: "Golf sim site — tech-camp page only so far", url: "https://lakesgolfsim.com" },
  { id: "s-ai",      g: "site", label: "ai.lakesgolfsim",    note: "Public course landing and signup", url: "https://ai.lakesgolfsim.com" },
  { id: "s-learn",   g: "site", label: "learn.lakesgolfsim", note: "The classroom used during live sessions", url: "https://learn.lakesgolfsim.com" },
  { id: "s-ember",   g: "site", label: "ember.baxstar…",     note: "Hosted Ember, behind Cloudflare Access", url: "https://ember.baxstarfishing.com" },

  { id: "r-bax1",    g: "repo", label: "bax1",             note: "Fishing site HTML — the live embed code", url: "https://github.com/baxstarcode/bax1" },
  { id: "r-ember",   g: "repo", label: "baxstar-ember",    note: "This app. src/baxstar-ember.jsx is canonical", url: "https://github.com/baxstarcode/baxstar-ember" },
  { id: "r-caption", g: "repo", label: "caption-studio",   note: "Standalone caption tool — shares the SPONSORS set", url: "https://github.com/baxstarcode/caption-studio" },
  { id: "r-vexus",   g: "repo", label: "baxstar-vexus",    note: "Serves the boat page directly from main", url: "https://github.com/baxstarcode/baxstar-vexus" },
  { id: "r-pontoon", g: "repo", label: "baxstar-pontoon",  note: "Pontoon check-in app", url: "https://github.com/baxstarcode/baxstar-pontoon" },
  { id: "r-course",  g: "repo", label: "ai-everyday-life", note: "Course repo — blueprint, releases, QA" },

  { id: "claude", g: "service", label: "Anthropic API",   note: "Claude — Ember's brain" },
  { id: "worker", g: "service", label: "Ember Worker",    note: "Key-holding, read-only connector gateway behind Access" },
  { id: "cf",     g: "service", label: "Cloudflare",      note: "Worker, Pages hosting, and Access" },
  { id: "fh",     g: "service", label: "FareHarbor",      note: "Bookings. De-facto price truth under the 2026 freeze", url: "https://fareharbor.com/dashboard/" },
  { id: "wix",    g: "service", label: "Wix",             note: "Hosts the fishing site shell", url: "https://manage.wix.com/" },
  { id: "gas",    g: "service", label: "Apps Script",     note: "Drive Gateway · Caption outbox · Site price feed" },
  { id: "drive",  g: "service", label: "Google Drive",    note: "The Data Engine — every owning doc lives here", url: "https://drive.google.com/" },
  { id: "gmail",  g: "service", label: "Gmail",           note: "MCP connector" },
  { id: "cal",    g: "service", label: "Calendar",        note: "MCP connector" },
  { id: "quo",    g: "service", label: "Quo",             note: "Phones and texts. Fishing + pontoon inboxes", url: "https://app.quo.com" },
  { id: "zapier", g: "service", label: "Zapier",          note: "Automation rail. 1500 tasks/mo — spend them carefully" },
  { id: "ig",     g: "service", label: "Instagram",       note: "Auto-post target. Sponsors ride as photo tags" },
  { id: "gbp",    g: "service", label: "Google Business", note: "Posts and reviews" },
  { id: "ga4",    g: "service", label: "GA4 / GTM",       note: "Tracking. GTM is the single source for tags" },
  { id: "github", g: "service", label: "GitHub",          note: "Every repo, and Pages for three of the sites" },

  { id: "router",  g: "truth", label: "SoT Router",    note: "The map. It routes; it never stores facts" },
  { id: "pricing", g: "truth", label: "Pricing Engine",note: "2026 LIVE sheet. RECONCILER tab is the snapshot" },
  { id: "tech",    g: "truth", label: "06 Tech Stack", note: "Tooling facts and the site hosting map" },
  { id: "aictx",   g: "truth", label: "AI Context",    note: "How Brady and the agents work together" },
  { id: "voice",   g: "truth", label: "Brand Voice",   note: "03 — the copy standard" },
  { id: "elog",    g: "truth", label: "Ember Log",     note: "Ember state and the standing-truth block" },
  { id: "blog",    g: "truth", label: "Baxstar Log",   note: "Recent state for everything that is not Ember" },
];

/* [from, to] — undirected. Order is cosmetic only. */
const ECO_EDGES = [
  ["ember","claude"], ["ember","worker"], ["worker","claude"], ["worker","cf"],
  ["ember","s-ember"], ["s-ember","cf"], ["ember","r-ember"], ["r-ember","github"],
  ["ember","gmail"], ["ember","cal"], ["ember","drive"], ["ember","quo"],
  ["ember","fishing"], ["ember","golf"], ["ember","zapier"], ["ember","r-caption"],
  ["ember","elog"],

  ["fishing","s-fishing"], ["fishing","fh"], ["fishing","quo"], ["fishing","ig"],
  ["fishing","gbp"], ["fishing","s-boat"], ["fishing","r-pontoon"],
  ["s-fishing","wix"], ["s-fishing","r-bax1"], ["s-fishing","ga4"], ["s-fishing","fh"],
  ["s-boat","r-vexus"], ["r-vexus","github"], ["r-pontoon","github"],
  ["r-bax1","github"], ["r-caption","github"], ["r-course","github"],

  ["golf","s-golf"], ["golf","course"], ["course","s-ai"], ["course","s-learn"],
  ["course","r-course"], ["consult","drive"], ["consult","ember"],

  ["r-caption","ig"], ["zapier","ig"], ["zapier","gbp"], ["ember","gas"],
  ["gas","drive"], ["gas","s-fishing"], ["gas","pricing"],

  ["fh","pricing"], ["drive","router"],
  ["router","pricing"], ["router","tech"], ["router","aictx"], ["router","voice"],
  ["router","elog"], ["router","blog"], ["elog","r-ember"], ["tech","cf"],
  ["voice","s-fishing"], ["blog","fishing"],
];

const PROJECTS_META = {
  updated: "2026-08-24",
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
      { name: "Ember / Mission Control", pct: 97, platform: "Claude + Codex",
        links: [["app", "https://ember.baxstarfishing.com"], ["repo", "https://github.com/baxstarcode/baxstar-ember"], ["cloudflare", "https://dash.cloudflare.com/"]],
        outstanding: "Desktop dashboard and chat reliability checks in progress. Desktop voice probe pending Mac verification.", sessions: "~0.5" },
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

// The newest model in each family Anthropic serves (verified 2026-10-15 against
// Anthropic's model reference). Buttons show the family; the exact ID rides in the
// tooltip and every reply is stamped with the model the API says actually served it.
const MODELS = [
  { id: "claude-haiku-5-5",  label: "Haiku",  name: "Haiku 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet", name: "Sonnet 5.5" },
  { id: "claude-opus-5-5",   label: "Opus",   name: "Opus 5.5" },
  { id: "claude-fable-5-1",  label: "Fable",  name: "Fable 5.1" },
];
// Saved choices from older builds land on the same family's newest model.
const MODEL_SUCCESSOR = {
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-opus-4-8": "claude-opus-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "claude-fable-5": "claude-fable-5-1",
};
const EFFORT_SUCCESSOR = { standard: "medium" };
// Preserve Brady's chosen model default. Failed requests require an explicit
// retry or model change; silently retrying can repeat connector work.
const DEFAULT_MODEL = "claude-opus-5-5";
// Low, since 2026-08-28: effort genuinely rides the API now, and Brady's verdict
// on High-by-default was "slow as hell". High stays one tap away for hard asks.
const DEFAULT_EFFORT = "low";
// Bump when a default above changes: stored model/effort prefs from an older
// version are dropped once so the new default actually lands on his phone.
const PREFS_V = 3;

// `api` is the real output_config.effort level. All four current models accept
// low/medium/high/xhigh, and Opus 5.5 and Haiku 5.5 default to medium when it is
// omitted — so it is always sent; "Low" must never quietly run at medium.
// `budget` is max_tokens: these models always think first and the thinking
// counts against it, so deeper effort needs more room before the first word.
const EFFORT = {
  low:    { label: "Low",  api: "low",    budget: 4000,  note: "\nEffort: LOW — shortest useful answer. No elaboration." },
  medium: { label: "Med",  api: "medium", budget: 8000,  note: "" },
  high:   { label: "High", api: "high",   budget: 12000, note: "\nEffort: HIGH — reason carefully step-by-step before answering; be thorough and double-check specifics." },
  xtra:   { label: "Xtra", api: "xhigh",  budget: 16000, note: "\nEffort: EXTRA HIGH — reason exhaustively before answering; check every specific against your tools." },
};
// Models whose API accepts output_config.effort (Haiku 4.5 rejected it; 5.5 accepts).
const EFFORT_MODELS = /^claude-(haiku-5-5|sonnet-5-5|opus-5-5|fable-5-1)$/;
const modelName = (id) => MODELS.find((m) => m.id === id)?.name || id;

// Background presets — CSS scenes modeled on Brady's reference images.
const DARK_LAKE_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCAOEBkADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxeiiigAooooAKWkooAWiikoAKM0UUAFFFFABRRRQAtFFFABRRRQAUUUUALRRRQAUUUUAFFFJQAtFFFABRRRQAUUUUAFFFFAC0UUmaBi0lFFABS0UUAFFFFAC0UlLQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFJS0UAFFFFABRRRQAUUUUAFFFLQAlFFFABRRRQAtJS0UAFJS0UAFFFFABRSUtABRSUtABSUUUALRSUUALRSUUALRR2pKAClpKKAFopKKAFpKKKAClpKKACiiigAooooAKKKKACiiigApaSloAKKM0UAFFFJQAtFFFABRRRSAKKKKYBS0lFIBaKKSmAUUUUgCgUUUwCiiikMKMUUUxCUUtFACUtFFIAoopaAEopaSgAooooAKKKKYBRRRQAUUUUgCiiigAooopgFFFFABRRSUALSUtFACUtFFIApKWkoGFFFFABRRRQIKKKWgYlLRRQAUlLSUAFFFLQAlFFFABRRRQAUUUUAJS0UUAFJS0lAgooopgFFFFIAooooAKKKKYBSUtJQAUUUUAFFFFACUUtJQAUUUUAJRRRQIKKKKACiiigBaTvRRQAUUUUAFFFFABRRRQAtFJS0AFFFFABS0UUAFFFJQAtFJS0AFFFFABRRRQAUUUUAFFFFAC0UlLQAlLRRQMSloooAKWiigBKKWigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKWkoAKKWkoAKKKKACilpKAFpKKKAFooooAKKKKACikpaACiiigAooooAKKSloAKSlpKAFopKWgBKKKKACiiigAooooAWiiigBKKWigBKKWigBKKWigBKKKKACiiigApaSigAooooAKSlooAKKKKACiiigAooooAWiiigBaSiigAooooAWkpaKQBRRRTAKSlopAJRRRQAUUtFACUtJRTAKKKKQBRRRTAKKKKQBRRRQMKKKKACiiigQUUUUAFFFFMAooopAFFFFAwooooEFFFFAxKKKWgBKWikoAKKKKACiiloASilooAKKKKACiiigAooxRQAlFLSUAFFFFABRRRQAUUUUAFFFFAgpKWkoAKKKKACiiigAooooAKKKKACkpaSgAooooAKKKKYBRRRSASiiimAlFFFAgpaSigBaKKKAEpaSloAKSiigAooooAKKKKAFooooAKKKKAFopKKAFooooAKKBRQAUUUtACUUUUAFFFFABRRRQAUtJSigYUUtJQAUCiloAKKKKACiiigApaSigAooooAKKKKACiiigAooooAKKKWgBKWiigBKKWkoAKKKKACiiigBaSlooASiiloAKKKSgBaKSigBaKSloAKKKKACiiigApKWkoAKWkFLQAlFLSUALSUUtABRRRQAlFLRQAUUUUAFFJS0AJRS0lABS0lFABS0lLQAUlLSUAFFFFABRRRQAUUUUAFFFFABRRRQAtFJS0gCiiigYUUUUCCiiimAUUUUhi0UlLQIKKSlpjCkoopAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQACiiigAopKKAFpKKKACiiigBaKSloAKKWkoAMUtFFABSUtBoASiiloASiiigAooooAKKKKACkpaKACiiigBKKKKACiiigAooooAKSlpKACiiigBKKKWgQUUUlAC0UlLQAUlLRQAlFFFABRRRQAlFBooASiiimIKKKKACiiigApaSloASilooASilooASloooAKKKKACiiigAooooAKWkooAWiiigAooooAKKKKACilooAKKKKBhRS0UAFFFFACUtFFABRRRQAUUUUAFLRSUAFFFFABRRRQAUUUUAFFFFABRRRQAtFFFABSUtJQAUUUtACUtFFABRRRQAUlLRQAlFLRQAUUUUAFFLSUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAJS0UUAFFFJQAUUUUAFFLSUALRSUtACUUUUAFLSUtACUUtJQAUtFFIAooooAKKKKACiiigAooooAKKKKACiiigYUUtJQAUUUUAFFFFABRRRQAUtJRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUtFACUUtFACUUtFACUUUUAFFFLQAlFFJQAtFJS0AJRRS0AJRS0UAJRS0UAFFFLigAopaMUAJS0UUAFJRRQAUUUUAJRS0UAJRS0lABRS0lABRRRQAUUUUAJRS0UAJRRRQAUUUlAC0UlLQAUlLRQAlFFFABRRRQAlLSUUAFLSUUALSUUUCCiiigApKKKAEooopiCiiigAooooAWiiigAoopaAEooooAWkoooAKKKKAFopKWgApKKKACloooAKKKKACiiloASiiigBaKSloGFFFAoAWikpaACiiigAooooAKKKKACiiigBaKKKACkoooAKWkooAKKWkNABS0lFAC0UUUAJS0UUAFFFLQAlFFLQMSlpKKBC0UUUAJRRRQAUUUUAFLSUUALSUUtACUUUUAFFFFABRRRQAUUtJQAUUUUAFFFFABRRRQAUlLRSAKKKKYBRRRSASilpKAFooooAKKKKACiiigYUUUUAFFFFABRRRQAUUUUAFFFFABRS0lABS0lFABRRRQAUUUUALRRSUALSUUUAFFFFABSUtFABRRRQAUUUUAFLQKWgBKMUtFACUUtFACUtFFABRRRQAlFLRQA2loxS4oASiiigApKWigBKSnUlAAKWkpaACiiloASilxSUAFLSUtABS0lLSGJRRRTASiiigQUUUtACUUtFACUUtJQAUUUUAFJS0UAIaKXFFACUUtJQAlFLRQAlFLSUAFFFFABSUpooASiig0ABpKWkxQAUUYoxQAUUYooAKKKKACiiigQlFFJQAUUlLTEFFFFAC0UUUAFFFFABRRS0AJS0UUAFJSmigBKKKKACiiigAooooAWiiigYUtJS0AFFFFABSUtFACUUUUALRRSUALRRSUALS0lLQAUUUtACUUUtABRRRQAUUUUAJRS0lABRS0lAC0lLRQAUUUUAFFFFABRRRQAUtJRQAtFFFACUtJS0AFJS0lABRRRQAUUtFIBKKKKBhS0lLQAUUCigBKKWkoAKWiloASkp1JigBKKWjFACUUtFACUUUUAFFFFABRRS0AJRS0UCEooooGFFFHegBaSiigAooooAKKKKACjtRRQAUtJS0AJS0lLQAUUUUAFFFFACUUtFACUUtFABRRRQAUUUUAFFFFACUUtFACUtFGKACkp1JigAFGKUUUAGKKWigBKKKWgBKWiigYYooooASilooASilxRSAKSlooASilxRimAlFLRQAlJS0UAFGKKWgQlFLRQMSilooASjFLRQAUUUUgEopcUYoATFFLikNMAooooEFFFFAwooooAKSlooASiloxQISilooGJSUtFAhKWikoAKSloxQAlFLijFACUUtLQA2jFLRQA2ilooASilpKACiiigBKKWkoAKKKKAEooooEJRRRTEFLSUCgBaKKKACiiigBaKSloAKKKKACiiigAooooASiiigAooooAWiiigAooooGLRRRQAUYoFLSGJSUtGKYCUtApaQWExRTqQ0A0JRRRTEFKKSigB1FJRQAtFJRQAtJRRQAtJRRQAtFJRQAtJS0UAFFFFABRRRQAUCiigAooooAKWkooGLRRRQAUlFGKBBRRilxxSGJS0lFABS0UYoAOlFFFAC4oxQKUUDEpKdRigBMUUtFACUUtGKAsJijFOpKQWExSEYpc0lMApKWigQUUYooAKKKKACkpaSgAopaKACiiigAooooAKKKKACiiigAooooAKKKWgBKKWkxQAUUYpaAEopaKACiiloASiijFACUtFFABRRRigAooxRQAUUtJQMSlopcUAJS0oooASlxRQKQBRRRQAlLRRQAUlLRQAlFLRQAlLiiigAooFLQAmKMUtFACUUppKACiiigBMUUtGKAExSijFFABSUtFACUUuKKAEoopaACiiigAooooAKSlooASilpKACiiigAooooAKKKKACkpaKAEooooASg0uKKAEpKdikpiCiiigBM0hNKaSgBRS0maBQAtFFJ3oGFFLSUCEoxS0hNABxSUZooAM0lFJQAtJRRQAUlFFAgoopaYhKKWigAooooAKKKKAFopKWgBKWiigAooooAKKKKACjFFFAwooooEFFGKKACiiigApaSigYtLmkooAXNFJS5pDuFLSUd6BjiOKTFGaO9AMQ0UdaXFAhKQ0ppKYgpaSigBaKSigBaWkFLQAlFLRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUtABSUtFACUtFLQAUE0UlIYUAUtFAABRSiigYlFLiigQUUUUAFLRRQMQ0ZooxQAuaDzSClpBcMUmKWlpgNxSYp1JQAmKWiloAbig0tBoAbRS4oxQISjFLiigBKKWigApBS0UAJRS0UAJS0UUAJS0UUAFFFFABRS0UDEopaKAEopaKACiiigAopaKAEopaKAEopcUYoASlxRilxSASkpaKAEopaMUAJiloxS4oAKKKKAEopaKACilooASilooAbRS0YoGFFLRQITFLjilFBIxxQMTiiikoAKM0UhoEBooooAKMUUtACYpaKKACiiigApKWigBKKXFFACUUtFAxKKWigBKKKKBBRRRQAUUUUAJRS0UAJRS0lABRS0UAJRRRQAUUUUAFFFLQAlJilooAbR0paSgBDSYp1JTASig0lAhaWm0tACk0maSigBaM+lJRQAlFFFACUUUuKAEopSKSgApKcKMUANpaSlpkhRRRQAUUUUAFFFFABS0UUAFFFLQMKKKKACkpaKACkpaKACiiigAoxRRQAUlLS0AJRRRQAUUUUAFFFFABS0lFAC0UUUgFFLTaUUDuJRSnmkoATFFLS0CEoxSiimMSlpaKQhDRS0lMApaSigBaKKKACiiigApKWigBKKWigBKWiigYUUtFACUUtFIAooooAKKKKACiiigApaSloAKBRS0AFFFFABRRRQAUUUUAFFFFABRQaKADFGKKWkMTFFFLQAlLiiigYmKQ0tFAhtFLRimAlFLRQISlopcUDEooooAKKKWgBKKKKACilooASiiikAUUUtACUUtFABRRS0AFFFFACUUtFABRRRQAUUtFACYopaKBiUUtFACUtFFAhKKWkoGFFAooAKWijFABRRRQAUUUtACUtJRQAUUUUAFFFLigBtFOIpMUAJigClpaAG4op1JigAooxS0AJRS4ooASiloxQAlGKKWgBKSnUUAJRS0lACYopaKAEooooAKKKKAEopaMUAJRS0UAJRS0UAJSU7FGKAG0U7FGKAEooxRigBKSnYooENpMU7FGKAGmkp2KMCgBlLilPFJTAKQ0Zo60AGM0YoGaOaAEoxS0tAhuKMU/k0bTQOwzFFP24oxSCwwjNGKfSYoATFJinYpKYEdAopaZAUUUUAFFFLQAlLRRQMKWiigAooooAKKKKACiiigBaSiigApaSigApaSigAooooAKKKWgBKKKWgBKKWigAooooASloooAKWkxRSAWiilFAxKKWigAooooAKKKKACiiigAxRRRTEFFFFAwoopaAEopaKQCUUtFABRRRQAUUtFACUUtFACUUtIaACilooAKKKKACiiloAKWkpaACiiigApKWlxQAlJTqSgBKKWigBKKKWgAooooGFFFFIAoooxQMKMUUUAJijFPA4oxQFhuKSndKSgBKKWkoEFFFFABRiiloASiilxQAlFLRQAYpKWigBKKWloASkpaKACiiloAKKKKBhRRRQIKKKKBhRRRQAUUUtACUUtFACUUUUAFFLSUAJS0UUAFLSCloAKKKKACiiigBKWiigBKWiloAKKKMUAJRS4ooGJRilxS0gExRilzSE0AFFFJTELSUUtABRRRQAlFLRQAlFLRQMTFFFFAhKKWkoASloooAKKKKAEpaMUUAGKMUtGKAExSU7FJQAlLRSUALRSUUALmm5oxRQAUmaXFJigAzSZpcUYoATNJTsUYoENoxTqKAG4AoxzxS0uKBjcUYp2KMUAAAoCrS4ooATp0FBJopKAuFFLSUCCkoNJk0ALSZpMmkzTENoopaZIlLRRQAUUUUAFFFFABS0lFAxaKKKACiiigAooooAKKKKACilpKACiiigQUUUUDCloooAKKKKACiiloASilpKACiiigAoopaACiiigBaKKKQwoxRRQIWiiigYUUUUwCjFFFAhKKWikMSloooAWiiigBKWkpaACiiigAopaKAEooooAKKKWgBKWiigBKWiloATFFLRQAUUtFAxKWiigAooooEFFLikoGJiilooASilpKACilpKACilpKACiiikAdqBRjNOA5xQAA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KADFJS5o60AGKMUlLigAxSYpaT8aADFFFFABRRRQAUUUUAFFFFABS0lFADqSkooAdS0yloGOo/CkyaM0AL+FGaM0cUAGaOaKXFACc0ZpcUmKADNFJRmgBaKTNFAC0ZpKKAHZoDYptFAXHZFLxTKKQXHcUcU2igLjuKKbRTC47ig+xptLmkFxc0U3NL+FAxefWjmkooAU5pKXmjJz2/KgBKMU/cP7oozn+EUBYZiinf8AARTc47UBYMUYpdwpcg0ANowaXNGaAsJzRmlzRmgApCKOKQj0oEBFGKMe9JQAuKQ0c0nNMBcGkA5pc0mTQA6jJpM0uaACk4paSkAYpKWjFMBKKXFIaAENFHUUUCEzS5oxRQAhz2o57rS8UUAA9qM0UEUAIaYwp31NHFAEf0opxxScUxCUUYooAPwopQKMUCEopdtAFAAKWkxR+FAwJpppaKBDqKSloAKKKKACiiigBKWkpaACiiigApaSigBaKKKACiiigAopaSgAooooAKKKKACiiigAooooAKKKKAFopKKAFpKKKACiiloASilooASloooAKKKKACiiigAooooAKKKKACiiigYUtJS4oAKKKKAEopaKAEopaSgBaKSloAKKKKACloooAKKKSgBaKTNFAC0UlFAC0UUUAFFFFACUUtJQAtGaSigBc0UlLQAUZoopALRmkooAKKKKACiiimAUUUUAFFLSUAFFFFABRRRQAUZoNFABmjNFJQAuaTNFFAC5ozSUCgBc0ZpKKAHZozSUUgDNFFFAxaM0UUAGaM0UlAC0UUUAFFFGaACijNFABmjNFFABmlzSUUALmikooAdxRSCjNAx1FNzS5oAdmim5ooAWjApKKAFoxSYPrRzQAYopeaMUAFJQaMUALScUUYoAWikxRQAtFJRQAtHFNzSk+1ABxQCKTNFADgRSk02jNADs0maSkoC47NITSYoxQFxd5o3eopKSgLsfuHYUZBplLRYLj8UlNzRmkFx+aTNJn3pOtADsikzSYo49aYC5pKKSgBc0maKM0AGaM0UhoELmjNNooAduozTaKAuOzS5pmaXNADs0hJ+tJmjNAADz0NLSZpaADFFJRQAUlLRQAlFLQaAEpKWkoAaRSFeKcaTJpiG0UpNJQIOlOBpuaM0DH5FFMyTTgaAFoxRmigBpFIRTqM0AFFJS0CCiiigAooooAKKKKACiiigAooooAKKKKAFFFJRQAtFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRS0UAFFFJQAtFJRQAtFJS0AFFFFABRRRQAUUUlAC0UlFAwpRSUtAC0UmaXNABRRRQAUUUUAJRRRQAUUUUALRSUtABRSUUALRSUUALRRRQAUZooBoAM0uaSigBaKSigAooooAKKKKACiiigANFFAoAKKKKAFopKKAFopKM0ALRSUtABRRRQAUUUlAC0UUZoAKSiikAUUuaM0wCkpc0ZoASlxRmkzQAtFJmlzSAKKSimAtFJS0AFFFFAC0lFFABS0lLSAKKSigYtFJS5oAKKTNLQAUUYpKAFopMUUALmiijFABRRRQAtFJQKAFpabRQA7NGabS8UDFzRmkyKKAFzRSUlADqKTNGaAFzRmkooAWikooAXNFFJQAUUUZoAXNGaSigBaCKM0uaAG4opd3tR1oASjFLijFAhMUUtFACUlLikIoAKSlpKAFyaM0lFAC5opKWgAoox70UDCiiigQlGKdSZ9qAExRilzRQAlJS0lABRRSUALRmkooELmjNJRQAuaM0lFAC0UlJzTAUmikooAU00mlzSUAIcUlOxSYoEJgetGKXFGB6UDExS4560tFABQaOKOKADNGaQikIoAWloFFAgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKM0UALRSUUALRRRQAUUtFAxKKKKBBRRRQAUUtJQMWiikoAKKKKBBRRRQAUUUUALRSUUALRRRQAUlLRQAUUUUAFJS0UAJS0lFAC0tNpaBi0lGaKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAXNGabRQA6ikooAWikooAKKKWgAooooAKSlpMUALRSUtABRSUUALRSUUALmjNJRQAtFJRQAtFFFACUtJRQAtFJRQAtFJRQAtFJS0AJRS0UAFFFFABRRRQAUUUUAFFFFABRRRQAUtJRQAtFJRQAtGKSlFIApaTNGaBi0YpKKAFopMmjNAC5ozSUZoAXNFJkUUALSUtFACUtFJQAUUUUALSUtFABRRmigAooooAXNGabRmgB2aSkooAdRSZpKAHcUZFNpKAH5FFNooAdRk0lGaADNGfSjPtRmgAyaKN1GaACikzRmgAoopKAHCim0UALRSUUALS8U2loADRRSUALmlzSUlAC0UmaM0ALmkzRmjigAoopKAFxRSfhS5oEJS0ZFGaAEozS0mKYBmijFGKAEopaSgBKKGFJkjrQAuaSkzRmgQ6ikzRmgBaKTNKKBhRRRQAlIaU0hoAdRRRQIKKKKACiiigAooooAKKSigBaKKKACiiigAooooAKSiigApaKSgBaWkooAWikooAWiiigAooooAM0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUALRSUUALSUUUAFFFFABRRSUALRRRQAUUUUALRSUtABRRRQMKKKKACiiigAooooEFFFJQMWikpaACiiigQlFLRQAUlLSUDFopKWgQUUUUAFFFFAwpaSigBaSiigQUUUlAxaKKKACiiigAooooAWikpaACiikoAWiiigApKKKACiiigBaKKSgAooooAWkoooAWikooAWiiigAoopKAFopKWgAooooAKKKKACilooASilxSUAFFLSUAFFFFIApaSigBaX8abRQMdmkzSUUBcdxRxSUUALRSUUALSUUUwCiiigQUUlFIBaKSlpgFFFFABRSUUALS4ptLSGGKKKKACiiigAoopKBBRRRQAUUUUALRSUZoAWkoooAWkoooAM0UUYpgFJS4oxSASilopgJRRRQAUUUUAFLmkooAWkoooAWkoNJQAtFJS0ABpKWigBKTFLRQA0ikpxpDQISjFKKKADFLikooGLRSUtACUUGigQtFFFABSUtJQAtFJS0AFJS0lABRRRQAUUtFACUtFFABSUtJQAUUtFACUUtFABRRRQAUUUUAFLSUUALRSUUALRRRQAlFFFABS0lLQAUtJRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAlLRRQAUUUUAFFFFABRRRQAtFJS0AFFFFAwooooEFFFFABSUtFACUUUUDFooooAKKKKACkpaKAEopaSgAopaKBCUUtJQAUUtFABRRRQAlFFFABS0lLQMKKKKACjFFFABS0maM0ALRSUtABSUUtACUUtFACUUtFACUUUUAFFJRQAtFFFABRRS0AJS0UlABRRRQAUUUUAFFFFAC0UlFAC0tJRQAtJRRQAtJRRQAUUUUAFFFFABS0lLQAUlLRQACikopALRSUUDFzRmkooAWikpaAEoxS0lABRRS0CEpaSlpgJRRRQAlLRRQAUZoooAM0uabRQFxaWm5ooAWiiikAUUUUAIaKWkoAKWkozTAWkpc0UAFFJRQAtGaSloAKSlpKACiiigAopKWgApKWkoAWikooAWkooJoAKKKSgBaTNFFABmikooAM0Z9qKKBC0UUUDEoxS0hoAKKKKBBSUUUALRRRQAUUtJQAUUUUAFFFFABRRRQAUtJRQAtHaiigAooooAKKKKACiiigAoopKAFooooAKKKKACiiigAooooAKKKKAClpKKACgUUUALRSUUALRSUUALRSUtABRSUtABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAtJRRQAtFJRQMWikooELSUUUAFLSUUAFLRSUAFLSUtAwopKWgQUlFFAxaKKKACikooAWlpKKACikpaACiiigApKWkoAKWiigBKWiigBKKWkoAKWkooAWiiigAooooAKWkooAKMUUUAJRS0UAFFFFABS0lFABRS0lABRRRQAUUtJQAUUUUAFFFFAC0UmaKAFooooAKKKSgBaKSigBaKKKACiiigAooooAKKKSgBaKKKACiikoAWgUlFAC0UlLQAtJRRQAtJRRSAKKSimAtFJRQAtFJS0ABpKKKACkpaKAEpaSjvQAtLTaKAFooooAKKDRQAUUUUAFFFFABRSUUALmkoooAKKKSgBaWkooAU0lFFABRRxSUALRQKKACiikoAWkoooASig0UCEooNFAC0UlFAC0tJRQAppKKKBiUlLRQIWiiimAUUUUgCiiigAooooAKWkooAKKKKAClpKKAFooooAKKSigBaSlpKAFpKKWgAooooAKKKKACiiigAooooAKKKBQAUUUUAFFFFAAaKKKACiiigAooooAKWkooAWiiigAoopKAFopKKAFooooASilooAKKKSgBaKSloAKKKSgBaKSloAKKKKAEpaKKACiiigAooooAKKKKACiiigApaSigBaKKSgAooooAKKKKACiiigAooooAKKKKAClpKWgYUUUlABRS0lABRS0lABS0lFAC0lFBoAKKSloELRSUUDFopKKBC0UUUDCiiigQUUUUDCikooAWiiigAoopKAFopKWgAooooAKWkooAKKKKACiiigAooooAKKKKAFopBRQAUUUUALSUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUlLQAUUUUAFFFFABS5ptFADqSkpaACkpaKAEopaKACiiigBKWkxRQAUUUUALRSZooAWikzRmgAoooNABSGlooASiiigAooooEFFJS0AFFFFAwooooAKSjNFABikpaKBCUUUtACUtFFACUUUUAFLSUUALRSUUALRRRTAKKKKQBRRRQAUUUUAFFFFAC0UlFAC0UlLQAUlLRQAlLRRQAUUUlABS0UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUALRRRQAUUGkoAWkoooAWkoooAKBRRQAtBopKAClpKWgAooooAKKKKADvRRRQAUUUUAFLSUUALRSUUAFFFFABS0UlABRRRQAUUUUAFAoooAKKKKACiiigAooooAKWkooAWkooNABRRRQAlFLRQAUUUUAFFFFAC0lFFABS0lFAC0lFFABRRRQAUUUUAFFFFABRRRQAUUUUDFopKKBC0UlFAxaKKSgBaKSloAKKSloAKKKKACiiigAooooAKKKKACiiigAooooAKKKSgBaKSloASloooAKSiigBaKSigAooooEFFFFAwooooAKWkozQAtJRRQAUUUUAFFFFAgpKWkoGFFFFAhaKSigYtFJS0AFFFFABSUtFACUUtJQISilooAKSiigAooooAKKKKACkpaSgAopaKAEpaKKAEopaKAEooNJQA6iikoAWkoopgLRRRSAKKKKACiiigAooooAKKKKAFopKKACiiigBaSiigAooooAWikooAWikooAKBRRQAtFJRQAtFJRQAtFJS0AFFJRQAtFFJQAtFFJQAtJRRQAtFJRQAtFJRQAtFJS0AFFJRQAtFJRQAtLSUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFGaKKACiiigBaKSigBaKSloAKKKKACikpaAEpaSloAKKKKACiiigAoopKAFopKWgAooooAKKKKACiikoAWikooAWikooAWikpaACikpaACiiigAopKKAFoozRQAUUUlAC0UlFAC0UUUAFFFFABRRRQAUUUUAFFFLQAlFFFABRRRQAUUlLQAUUUUDCiiigQUUUUAFFFFABRRSUALRRRQAUUUlADqSkpaBi0lJmloAKKSloEFLSUUDCiiigQtJRRQMKKKKBBRRRQAUlLRQAlLRSUALRSUUALRSUUDFopKKAFpKKKBBRS0lABRRRQAUUUlAC0UmaWgAoozRQAUUUUAFFFJQAUUUUAFFFJQAtFFFABSUtJQAUtJS0AFFFJQAtFJRQAGkpaKAFpKKKACiiigBaKKKYBRRRSAKKKKACiiigAooooAKKKKYBSUUUgA0tFFABRRRQAUUUUAFFFFABQKKKACkoooAWgUUUAFLRRQAlAoooAKKKKACiiigAooooAKDRRQAUUUUALSUUUABooooAKKKKACloooATvS0UUAHaiiigBKWiigAooooASloooAKKKKACkoooAKWiigAooooAKKKKAFpKKKACiiigAoFFFACmjtRRQAUUUUAJRRRQAUUUUAFLRRQAUlFFABRRRQAUUUUAJS0UUAAooooAKO9FFAC0UUUAJSUUUALRRRQAUUUUAJSiiigBaTvRRQAtFFFABRRRQAUUUUAAooooAWkoooADRRRQAlFFFABRRRQAtFFFABRRRQAUUUUAJRRRQAtFFFAwooooEJQKKKBhSCiigQtFFFABS0UUAFFFFAwpKKKAFooooEFJRRQAUtFFABRRRQAlFFFABRRRQAUUUUAFFFFAC0neiigANFFFACUd6KKACiiigApaKKACg0UUAJRRRQAUUUUAJ3paKKACkoooAWkoooAKKKKAA0UUUAJQKKKAFooopgf/Z";

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

/* Where Ember sends its Claude traffic. Production sets the same-origin Pages route in
   build.mjs. Local preview also remains same-origin and fails honestly without a gateway;
   the browser never receives an Anthropic or Worker destination. */
const BUILD_STAMP = "__EMBER_BUILD__".startsWith("__") ? "dev" : "__EMBER_BUILD__";

const API_ENDPOINT =
  (typeof window !== "undefined" && window.EMBER_API_PROXY) || "/api/messages";
// The Worker's data-free credential check: it refreshes each connector's token but
// never calls a tool or reads a record. Same-origin sibling of /api/messages.
const STATUS_ENDPOINT = /\/messages$/.test(API_ENDPOINT)
  ? API_ENDPOINT.replace(/\/messages$/, "/connectors/status")
  : "/api/connectors/status";

// Each OPS feed and the one connector that fills it. Sync is per feed: a dead Quo
// used to throw away perfectly good Gmail and Calendar results (reproduced live
// 2026-10-15 — status showed gmail/calendar/gdrive connected, quo offline, and every
// panel stayed on the demo preview).
const OPS_FEEDS = [
  { server: "quo",      key: "voicemails", label: "Quo",      what: "calls and voicemail" },
  { server: "gmail",    key: "emails",     label: "Gmail",    what: "email" },
  { server: "calendar", key: "events",     label: "Calendar", what: "schedule" },
];
const STATUS_CONNECTORS = ["quo", "gmail", "calendar", "gdrive"];
// Returning to the tab re-syncs once the panels are older than this.
const OPS_STALE_MS = 15 * 60 * 1000;

// "connected" proves only that a token could be minted, not a full MCP handshake —
// so it decides which connectors are worth asking for, and the tool results still
// decide which panels may change. Unreachable route → null, and sync asks for all.
async function fetchConnectorStatus() {
  try {
    const res = await fetch(STATUS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectors: STATUS_CONNECTORS }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.connectors;
    if (!c || typeof c !== "object") return null;
    return Object.fromEntries(STATUS_CONNECTORS.map((n) =>
      [n, c[n] === "connected" ? "connected" : c[n] === "offline" ? "offline" : "unknown"]));
  } catch (e) {
    return null;
  }
}

// Chat's connector warning names what was actually missing. The old blanket line
// ("Live business data was not checked") appeared above a triage reply that listed
// real Gmail on 2026-10-15: only Quo was down, Gmail and Calendar were read.
function degradedChatNote(status) {
  const off = status ? OPS_FEEDS.filter((f) => status[f.server] === "offline") : [];
  if (off.length && off.length < OPS_FEEDS.length) {
    return `${listNames(off.map((f) => f.label))} ${off.length === 1 ? "is" : "are"} offline — ${listNames(off.map((f) => f.what))} not checked in this reply.`;
  }
  return "Connectors unavailable — this reply uses conversation context only. Live business data was not checked.";
}

// Midnight in America/Chicago, `days` after today's Chicago date, as an ISO
// instant. 06:00Z is midnight CST; the Chicago hour shown at that instant (0 in
// winter, 1 in summer) is exactly how far past midnight it is.
function chicagoMidnightISO(now, days) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const guess = Date.UTC(+parts.year, +parts.month - 1, +parts.day + days, 6);
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(guess);
  return new Date(guess - hour * 3600 * 1000).toISOString();
}

function listNames(names) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function responseError(data, fallback) {
  return typeof data?.error === "string" ? data.error : data?.error?.message || data?.message || fallback;
}

async function callClaude(messages, { useTools = true, model = DEFAULT_MODEL, servers, maxTokens, effort, onDelta, onMeta, signal } = {}) {
  // Thinking-capable models (Opus 5) bill their reasoning AND tool round-trips
  // against max_tokens. 1000 ran out before the first word of a tool-using
  // answer was written — reproduced live 2026-08-26: stop_reason max_tokens,
  // four successful tool calls, zero text.
  // 8000 by default (was 3000): the current models always think first, and
  // Caption Studio and the Drive librarian pass no budget of their own.
  const body = { model, max_tokens: maxTokens || 8000, messages };
  if (useTools) body.mcp_servers = servers || MCP_SERVERS;
  // Real speed dial: pass the picked effort to models that accept it. Calls that
  // pick none get an explicit medium, so the level never depends on a model default.
  if (EFFORT_MODELS.test(model)) body.output_config = { effort: effort || "medium" };
  // Streaming is requested, never assumed: if the server answers with plain
  // JSON anyway (test stubs, older proxy), the JSON path below still works.
  if (onDelta) body.stream = true;
  let res;
  try {
    res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted || e.name === "AbortError") throw e;
    // Network-level failure: CORS rejection hosted, or the proxy is down.
    throw new Error("Can't reach Ember's same-origin gateway. Check the hosted deployment and try again.");
  }
  const degraded = res.headers.get("x-ember-connectors") === "degraded";
  onMeta?.({ degraded });
  if (!res.ok) {
    let detail;
    try { detail = await res.json(); } catch {}
    throw new Error(responseError(detail, `Ember request failed (HTTP ${res.status}). Try again when the service is available.`));
  }
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("text/event-stream")) {
    let data;
    try { data = await res.json(); }
    catch (e) {
      if (signal?.aborted || e.name === "AbortError") throw e;
      throw new Error("Ember received an unreadable reply. Please retry.");
    }
    if (data?.error || data?.type === "error") throw new Error(responseError(data, "The model could not finish this reply."));
    if (!data || typeof data !== "object") throw new Error("Ember received an invalid reply.");
    return { ...data, _connectorsDegraded: degraded };
  }
  if (!res.body) throw new Error("The reply stream was empty. Please retry.");
  // SSE frames can cross byte/chunk boundaries and contain multiple data lines.
  // Only a message_stop marks success; an EOF or error is never a finished answer.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let sawText = false;
  let eventName = "", dataLines = [], stopped = false, stopReason = null, servedModel = null;
  const dispatch = () => {
    const data = dataLines.join("\n");
    const name = eventName;
    eventName = ""; dataLines = [];
    if (!data.trim() && name !== "error") return;
    let ev = {};
    try { if (data.trim()) ev = JSON.parse(data); }
    catch { throw new Error("Ember received a malformed reply stream. Please retry."); }
    if (name === "error" || ev.type === "error" || ev.error) {
      throw new Error(responseError(ev, "The model reported a streaming error. Please retry."));
    }
    if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
      if (sawText && text && !text.endsWith("\n")) text += "\n";
      sawText = true;
      text += ev.content_block.text || "";
      if (text) onDelta?.(text);
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      if (typeof ev.delta.text !== "string") throw new Error("Ember received an invalid text fragment.");
      text += ev.delta.text;
      onDelta?.(text);
    }
    if (ev.type === "message_start" && typeof ev.message?.model === "string") servedModel = ev.message.model;
    if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
    if (ev.message?.stop_reason) stopReason = ev.message.stop_reason;
    if (ev.type === "message_stop") stopped = true;
  };
  const line = (value) => {
    const s = value.endsWith("\r") ? value.slice(0, -1) : value;
    if (!s) { dispatch(); return; }
    if (s.startsWith(":")) return;
    const colon = s.indexOf(":");
    const field = colon < 0 ? s : s.slice(0, colon);
    let valueText = colon < 0 ? "" : s.slice(colon + 1);
    if (valueText.startsWith(" ")) valueText = valueText.slice(1);
    if (field === "event") eventName = valueText;
    if (field === "data") dataLines.push(valueText);
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!stopped) {
      if (signal?.aborted) throw new DOMException("Reply stopped.", "AbortError");
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) {
        if (signal?.aborted || e?.name === "AbortError") throw e;
        throw new Error("The reply connection was interrupted. The partial reply is shown; retry when ready.");
      }
      const { done, value } = chunk;
      if (signal?.aborted) throw new DOMException("Reply stopped.", "AbortError");
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      let end;
      while (!stopped && (end = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, end)); buf = buf.slice(end + 1);
      }
      if (done) {
        if (!stopped && buf) line(buf);
        if (!stopped && (dataLines.length || eventName)) dispatch();
        break;
      }
    }
    if (!stopped) throw new Error("The connection ended before the reply finished. The partial reply is shown; retry when ready.");
    return { content: [{ type: "text", text }], stop_reason: stopReason, model: servedModel, _streamed: true, _connectorsDegraded: degraded };
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const chatId = () => globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function validChatMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = new Set();
  return raw.filter((m) => m && ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" && m.content.trim() && !m.streaming && !m.error &&
    (!m.status || m.status === "complete")).slice(-24).map((m) => {
      const id = typeof m.id === "string" && m.id && !ids.has(m.id) ? m.id : chatId();
      ids.add(id);
      const model = m.role === "assistant" && typeof m.model === "string" && /^claude-[a-z0-9-]+$/.test(m.model) ? m.model : undefined;
      return model ? { id, role: m.role, content: m.content, status: "complete", model } : { id, role: m.role, content: m.content, status: "complete" };
    });
}
function chatContext(messages) {
  const tail = messages.slice(-8);
  while (tail[0]?.role === "assistant") tail.shift();
  return tail.map(({ role, content }) => ({ role, content }));
}

// A deliberately small text renderer: React escapes every leaf. No raw HTML,
// remote images, executable URLs, or generated markup enters the DOM.
function ChatText({ text }) {
  const lines = String(text).split(/\r?\n/), blocks = [];
  const inline = (s) => s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      try {
        const url = new URL(link[2]);
        if (["https:", "http:"].includes(url.protocol)) return <a key={i} href={url.href} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
      } catch { /* Invalid or executable links remain escaped text. */ }
    }
    return part;
  });
  const listItem = (s) => s.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^\s*```/.test(lines[i])) {
      const label = lines[i++].replace(/^\s*```/, "").trim();
      const code = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<div className="chat-code" key={i}>{label && <span>{label}</span>}<pre><code>{code.join("\n")}</code></pre></div>);
      continue;
    }
    const item = listItem(lines[i]);
    if (item) {
      const ordered = !item[1], items = [];
      while (i < lines.length) {
        const next = listItem(lines[i]);
        if (!next || (!next[1]) !== ordered) break;
        items.push(<li key={i}>{inline(next[2])}</li>); i++;
      }
      blocks.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>);
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !listItem(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={i}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="chat-text">{blocks}</div>;
}

function extractText(data) {
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function succeededConnectors(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const calls = new Map();
  for (const block of blocks) {
    if (block?.type === "mcp_tool_use" && typeof block.id === "string" &&
        typeof block.server_name === "string") {
      calls.set(block.id, block.server_name);
    }
  }
  const succeeded = new Set();
  for (const block of blocks) {
    if (block?.type !== "mcp_tool_result" || block.is_error !== false) continue;
    const server = calls.get(block.tool_use_id);
    if (server) succeeded.add(server);
  }
  return succeeded;
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
   the outbox gateway's payload limit and converts iPhone HEIC to JPEG on the way through. */
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
   dropped lake connection and Mission Control's numbers. Every call is
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

// Pre-gateway builds stored a write-capable endpoint in the browser. Delete that legacy
// value during hydration; the client must never choose or transmit an outbox destination.
const LEGACY_OUTBOX_URL_KEY = "ember-outbox-url";
const OUTBOX_ENDPOINT = "/api/outbox";
const CAPTION_DRAFT_KEY = "ember-caption-draft";

/* ---------- GOOGLE DRIVE ICON ---------- */

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

// Brass push-plates either side of the reactor (Brady, 2026-10-15): they replaced
// the Draft Reply / Task Draft levers, whose jobs live on every call and email row.
// Each runs an existing ACTIONS prompt into the chat thread — no second copy of it.
function PromptPlate({ side, lines, running, disabled, onPress }) {
  // Light follows the pointer; the brass control and its hit target stay put.
  // Touch and reduced-motion users get the same finish without pointer tracking.
  const resetLight = (event) => {
    event.currentTarget.style.removeProperty("--plate-x");
    event.currentTarget.style.removeProperty("--plate-y");
  };
  const trackLight = (event) => {
    if (disabled || event.pointerType === "touch" ||
        !window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const percent = (value) => `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
    event.currentTarget.style.setProperty("--plate-x", percent((event.clientX - rect.left) / rect.width * 100));
    event.currentTarget.style.setProperty("--plate-y", percent((event.clientY - rect.top) / rect.height * 100));
  };
  return (
    <button type="button" className={`prompt-plate ${side} ${running ? "running" : ""}`}
      disabled={disabled} onClick={onPress} aria-label={lines.join(" ")}
      onPointerMove={trackLight} onPointerLeave={resetLight} onPointerCancel={resetLight} onFocus={resetLight}>
      <span className="plate-index" aria-hidden="true">{side === "left" ? "01" : "02"}</span>
      <span className="plate-lamp" aria-hidden="true" />
      <span className="plate-label">{lines.map((l) => <span key={l}>{l}</span>)}</span>
    </button>
  );
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function BaxstarEmber() {
  const [view, setView] = useState("ops");
  const [studioTool, setStudioTool] = useState("captions");
  // Bumped on every Caption Studio press; DockMech keys the lever rotor off it,
  // so each click restarts the throw animation from the top with no timers.
  const [leverPull, setLeverPull] = useState(0);

  // steampunk context actions — selected Calls/Inbox item feeds the two levers
  const [selectedComm, setSelectedComm] = useState(null); // { type:"vm"|"email", i }
  const [leverBusy, setLeverBusy] = useState(null);       // "draft" | "task" | null
  const [promptRunning, setPromptRunning] = useState(null);  // which push-plate is running
  const [graphOpen, setGraphOpen] = useState(false);
  const closeGraph = useRef(() => setGraphOpen(false)).current;
  const [leverPending, setLeverPending] = useState(null); // pending-review pulse
  const [draftEdit, setDraftEdit] = useState(null);       // editable lever draft text
  const [draftCopied, setDraftCopied] = useState(false);
  const [taskProposal, setTaskProposal] = useState(null); // { title, source, due, details }
  const [taskFeedback, setTaskFeedback] = useState("");
  const [taskError, setTaskError] = useState("");

  // ---- OPS state ----
  const [data, setData] = useState(DEMO);
  // Per feed, because connectors fail independently. `live` = at least one real feed.
  const [feedLive, setFeedLive] = useState({ voicemails: false, emails: false, events: false });
  const live = feedLive.voicemails || feedLive.emails || feedLive.events;
  const [connStatus, setConnStatus] = useState(null);
  const connStatusRef = useRef(null);
  const [syncProblems, setSyncProblems] = useState([]);
  const freshFeeds = OPS_FEEDS.filter((f) => feedLive[f.key] && connStatus?.[f.server] !== "offline" && !syncProblems.some((p) => p.key === f.key));
  const feedState = !live ? "DEMO" : freshFeeds.length === OPS_FEEDS.length ? "LIVE" : freshFeeds.length ? "PARTIAL" : "STALE";
  const lastSyncRef = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [command, setCommand] = useState("");
  const [focused, setFocused] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef([]);

  // core visualizer
  const [coreMode, setCoreMode] = useState("enigma"); // "enigma" | "scope"
  const levelRef = useRef(0);           // 0..1 smoothed level
  const gasRef = useRef(null);
  const ventRef = useRef(null);
  const scopeRef = useRef(null);
  const prevLvlRef = useRef(0);
  const lastVentRef = useRef(0);
  // The instrument reads these every animation frame, where state would be stale.
  const thinkingRef = useRef(false);
  const syncingRef = useRef(false);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);

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
  // The browser sends only to Ember's same-origin server gateway. The server owns the
  // private destination and confirms the Drive handoff before this UI reports success.
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  const [captionRestored, setCaptionRestored] = useState(false);
  // Stripped mobile shell: dock + non-caption tools hidden. Set by ?lean=1 / #lean.
  const [leanCaption, setLeanCaption] = useState(false);

  // ---- CLAUDE CHAT state (the thread lives on the OPS home page) ----
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatModel, setChatModel] = useState(DEFAULT_MODEL);
  const [chatEffort, setChatEffort] = useState(DEFAULT_EFFORT);
  const [chatReady, setChatReady] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatConnectors, setChatConnectors] = useState("");
  const [chatFeedback, setChatFeedback] = useState("");
  const [copiedChatId, setCopiedChatId] = useState(null);
  const chatMsgsRef = useRef([]);
  const activeChatRef = useRef(null);
  const chatWriteRef = useRef(Promise.resolve());
  const chatSavedRef = useRef(null);
  function updateChat(update) {
    const next = update(chatMsgsRef.current);
    chatMsgsRef.current = next;
    historyRef.current = validChatMessages(next);
    setChatMsgs(next);
  }
  useEffect(() => () => { activeChatRef.current?.controller.abort(); activeChatRef.current = null; }, []);

  /* Today's revenue is MANUAL — Brady sets it, nothing invents it. The panel
     used to show a hardcoded demo number ("+$1,240 · 2 FareHarbor bookings")
     that read as real; Brady called it out 2026-08-15. Stored with its date so
     yesterday's number can't masquerade as today's. Real automatic revenue
     waits for a booking-system connection that doesn't exist yet. */
  const [revToday, setRevToday] = useState(null); // { n: 450, d: "2026-08-15" }
  const localDay = () => new Date().toLocaleDateString("en-CA");
  const revSet = !!(revToday && revToday.d === localDay() && Number.isFinite(revToday.n));
  // In-page editor, not window.prompt: iOS suppresses native dialogs in
  // standalone (home-screen) mode, so the Set button silently did nothing on
  // Brady's phone — reported 2026-08-28 as "the revenue section doesn't work".
  const [revEdit, setRevEdit] = useState(null); // draft string while editing, else null
  function editRevenue() { setRevEdit(revSet ? String(revToday.n) : ""); }
  function commitRevenue(raw) {
    setRevEdit(null);
    const n = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
    if (!String(raw).trim() || isNaN(n)) { setRevToday(null); return; }
    setRevToday({ n, d: localDay() });
  }
  // Odometer face: at least 5 digits so the tiles keep their instrument look.
  const odoFmt = (n) => {
    const s = String(n).padStart(5, "0");
    return "$" + s.slice(0, -3) + "," + s.slice(-3);
  };

  const chatEndRef = useRef(null);
  const chatThreadRef = useRef(null);
  const chatPinnedRef = useRef(true);
  const cmdInputRef = useRef(null);
  // greeting-count buttons jump to these two panel columns
  const callsColRef = useRef(null);
  const inboxColRef = useRef(null);
  useEffect(() => {
    const thread = chatThreadRef.current;
    if (thread && chatPinnedRef.current) thread.scrollTop = thread.scrollHeight;
  }, [chatMsgs, thinking]);

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
        if (prefs.surfaces && typeof prefs.surfaces === "object") setSurfaces((s0) => ({ ...s0, ...prefs.surfaces }));
        if (prefs.v >= PREFS_V) {
          const model = MODEL_SUCCESSOR[prefs.chatModel] || prefs.chatModel;
          const effort = EFFORT_SUCCESSOR[prefs.chatEffort] || prefs.chatEffort;
          if (MODELS.some((m) => m.id === model)) setChatModel(model);
          if (Object.hasOwn(EFFORT, effort)) setChatEffort(effort);
        }
        if (prefs.revToday && typeof prefs.revToday.n === "number" && typeof prefs.revToday.d === "string") setRevToday(prefs.revToday);
        if (prefs.lake) setLake(prefs.lake);
        if (prefs.postWindow) setPostTime(toPostTime(prefs.postWindow));
        if (prefs.coreMode) setCoreMode(prefs.coreMode);
        if (prefs.studioTool) setStudioTool(prefs.studioTool === "chat" ? "captions" : prefs.studioTool);
      }
      updateChat(() => validChatMessages(chat));
      if (Array.isArray(drive)) setDriveMsgs(drive);
      hydrated.current = true;
      setChatReady(true);
    })();
  }, []);

  /* ---- MOBILE DEEP-LINK + LEGACY OUTBOX CLEANUP + CAPTION DRAFT RECOVERY ----
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

    // Old builds stored a write-capable destination in localStorage. The server gateway
    // now owns routing, so erase the legacy browser value instead of reading or sending it.
    lsDel(LEGACY_OUTBOX_URL_KEY);

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
  function saveChat(messages) {
    const json = JSON.stringify(validChatMessages(messages));
    if (json === chatSavedRef.current) return;
    chatSavedRef.current = json;
    const failed = () => {
      chatSavedRef.current = null;
      setChatFeedback("Conversation could not be saved on this device. Keep a copy before reloading.");
    };
    if (window.storage?.set) {
      // Serial writes prevent a slow earlier save from resurrecting a cleared thread.
      chatWriteRef.current = chatWriteRef.current.then(() => window.storage.set("ember-chat", json, false)).catch(failed);
    } else {
      try { localStorage.setItem("ember-chat", json); } catch { failed(); }
    }
  }
  useEffect(() => { if (chatReady) saveChat(chatMsgs); }, [chatMsgs, chatReady]);
  useEffect(() => { if (hydrated.current) persist("ember-drive", driveMsgs.slice(-24)); }, [driveMsgs]);
  useEffect(() => {
    if (hydrated.current) persist("ember-prefs", { v: PREFS_V, surfaces, chatModel, chatEffort, lake, postWindow: postTime, studioTool, coreMode, revToday });
  }, [surfaces, chatModel, chatEffort, lake, postTime, studioTool, coreMode, revToday]);
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

  // one RAF loop drives both cores through refs — zero React re-renders per frame
  useEffect(() => {
    let raf;
    const loop = (t) => {
      // The instrument used to run on microphone level. With voice retired it
      // runs on WORK: a slow idle breath at rest, a live swell while she is
      // thinking or syncing. The core still means something at a glance.
      const busy = thinkingRef.current || syncingRef.current;
      const wave = null;
      const target = busy
        ? 0.30 + 0.20 * Math.abs(Math.sin(t / 130)) + 0.10 * Math.abs(Math.sin(t / 47))
        : 0.05 + 0.03 * Math.sin(t / 900);
      levelRef.current += (target - levelRef.current) * 0.2;
      const lvl = levelRef.current;

      // ENIGMA gas — swells with sound, colors oscillate as decibels climb
      if (gasRef.current) {
        const hue = Math.sin(t / 200) * lvl * 60;
        gasRef.current.style.transform = `scale(${1 + lvl * 0.28})`;
        gasRef.current.style.filter = `hue-rotate(${hue}deg) brightness(${1 + lvl * 0.55}) saturate(${1 + lvl * 0.5})`;
      }

      // Pressure-release glow — a brass ring vents outward as she spins up
      if (ventRef.current) {
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
        } else if (lvl > 0.02) {
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

  async function sendCommand(text, { retryId } = {}) {
    // Ref guard is synchronous: two clicks in one render cannot launch two requests.
    if (activeChatRef.current || !chatReady) return null;
    const current = chatMsgsRef.current;
    const lastUser = [...current].reverse().find((m) => m.role === "user");
    const retryIndex = retryId ? current.findIndex((m) => m.id === retryId && m.role === "user") : -1;
    if (retryId && (retryIndex < 0 || lastUser?.id !== retryId)) return null;
    const q = (retryId ? current[retryIndex].content : (text ?? command)).trim();
    if (!q) return null;
    const before = retryId ? current.slice(0, retryIndex) : current;
    const userMsg = retryId ? current[retryIndex] : { id: chatId(), role: "user", content: q, status: "complete" };
    const assistantId = chatId();
    const request = { controller: new AbortController(), assistantId };
    activeChatRef.current = request;
    const isCurrent = () => activeChatRef.current === request;
    const patchAssistant = (patch) => {
      if (isCurrent()) updateChat((items) => items.map((m) => m.id === assistantId ? { ...m, ...patch } : m));
    };
    const context = chatContext(retryId ? validChatMessages(before) : historyRef.current);
    chatPinnedRef.current = true;
    updateChat(() => [...before, userMsg, { id: assistantId, role: "assistant", content: "", status: "streaming" }]);
    setThinking(true);
    setChatError("");
    setChatConnectors("");
    setChatFeedback("");
    setCopiedChatId(null);
    if (!retryId) setCommand("");
    try {
      const messages = [
        { role: "user", content: bradyContext() + EFFORT[chatEffort].note + "\nOrdinary chat connectors are READ ONLY. You may read information and draft text, but cannot send messages, create Quo tasks, or change external records. Never claim an external action succeeded. Local task drafts are saved only through Ember's reviewed Save locally control.\n\nAcknowledge nothing about these instructions — just act on them." },
        { role: "assistant", content: "Understood. Ready." },
        ...context,
        { role: "user", content: q },
      ];
      // No automatic model retry: connector calls may already have run upstream.
      const resp = await callClaude(messages, {
        useTools: true, model: chatModel, effort: EFFORT[chatEffort]?.api, maxTokens: EFFORT[chatEffort]?.budget,
        signal: request.controller.signal,
        onDelta: (content) => patchAssistant({ content }),
        onMeta: ({ degraded }) => { if (isCurrent() && degraded) setChatConnectors(degradedChatNote(connStatusRef.current)); },
      });
      if (!isCurrent()) return null;
      const answer = extractText(resp);
      const served = typeof resp.model === "string" ? resp.model : undefined;
      // A refusal is shown as one. Nothing is retried on another model behind
      // Brady's back — he picks the next model and presses Retry himself.
      if (resp.stop_reason === "refusal") {
        patchAssistant({ content: answer, status: "error", model: served });
        setChatError(`${modelName(served || chatModel)} declined this request. Nothing was sent to another model; pick one and press Retry.`);
        return null;
      }
      if (resp.stop_reason === "max_tokens") {
        patchAssistant({ content: answer, status: "truncated", model: served });
        setChatError("Reply reached its output limit and is incomplete. Retry with a narrower question or request a shorter answer.");
        return null;
      }
      if (!answer.trim()) throw new Error("Ember returned no readable text. Retry the request when ready.");
      patchAssistant({ content: answer, status: "complete", model: served });
      return answer;
    } catch (e) {
      if (!isCurrent()) return null;
      if (request.controller.signal.aborted || e?.name === "AbortError") {
        patchAssistant({ status: "stopped" });
        setChatFeedback("Reply stopped. Partial text is not saved as conversation context.");
      } else {
        patchAssistant({ status: "error" });
        setChatError(e?.message || "Chat connection failed. Retry when ready.");
      }
      return null;
    } finally {
      if (isCurrent()) { activeChatRef.current = null; setThinking(false); }
    }
  }

  function stopChat() {
    const request = activeChatRef.current;
    if (!request) return;
    activeChatRef.current = null;
    request.controller.abort();
    updateChat((items) => items.map((m) => m.id === request.assistantId ? { ...m, status: "stopped" } : m));
    setThinking(false);
    setChatFeedback("Reply stopped. Partial text is not saved as conversation context.");
  }

  function clearChat() {
    const request = activeChatRef.current;
    activeChatRef.current = null;
    request?.controller.abort();
    updateChat(() => []);
    setThinking(false);
    setCommand("");
    setChatError("");
    setChatConnectors("");
    setChatFeedback("");
    setCopiedChatId(null);
    chatPinnedRef.current = true;
    saveChat([]);
  }

  async function copyChat(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      if (!chatMsgsRef.current.some((m) => m.id === message.id)) return;
      setCopiedChatId(message.id);
      setChatFeedback("Reply copied.");
    } catch {
      if (chatMsgsRef.current.some((m) => m.id === message.id)) setChatFeedback("Could not copy to the clipboard. Select the reply text to copy it.");
    }
  }

  /* ---------- OPS: SYNC LIVE DATA ---------- */

  async function syncLive() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    // Stamped at the attempt, so a fully offline round still retries on return.
    lastSyncRef.current = Date.now();
    let landed = [];
    let problems = [];
    try {
      const status = await fetchConnectorStatus();
      connStatusRef.current = status;
      setConnStatus(status);
      // Ask only for connectors that can authorize. An unreachable status route
      // asks for all three and lets the tool results decide.
      const wanted = OPS_FEEDS.filter((f) => !status || status[f.server] !== "offline");
      const offline = OPS_FEEDS.filter((f) => !wanted.includes(f));
      problems = offline.map((f) => ({ key: f.key, text: `${f.label} offline` }));
      if (!wanted.length) {
        setSyncProblems(problems);
        throw new Error(`${listNames(offline.map((f) => f.label))} are offline; no feeds were replaced.`);
      }

      // Computed here and passed verbatim: when the model picked its own dates
      // it guessed the wrong month and dragged in a quarter of call history.
      // "Today" is Detroit Lakes' today (America/Chicago), whatever clock the
      // browser happens to be on.
      const now = new Date();
      const since48 = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
      const dayStart = chicagoMidnightISO(now, 0);
      const dayEnd = chicagoMidnightISO(now, 2);
      const steps = {
        voicemails: `Missed calls and voicemails from BOTH Quo inboxes (Fishing 218-325-6857, Pontoon 218-325-9846) — pass createdAfter=${since48} to the tool exactly. Include voicemail transcripts when present.`,
        emails: "Up to 5 unread Gmail messages from the last 24 hours.",
        events: `Calendar events between ${dayStart} and ${dayEnd} (today and tomorrow in America/Chicago) — pass these exact timestamps to the tool. Give each event's time in America/Chicago (e.g. "2:00 PM").`,
      };
      const shapes = {
        voicemails: '"voicemails":[{"from":"","line":"Fishing or Pontoon","time":"","note":"","vm":"transcript or empty"}]',
        emails: '"emails":[{"from":"","time":"","subject":""}]',
        events: '"events":[{"time":"","title":"","detail":""}]',
      };
      const prompt = `${bradyContext()}

Fetch, using your tools:
${wanted.map((f, i) => `${i + 1}. ${steps[f.key]}`).join("\n")}

Use the ISO timestamps above verbatim — never compute or guess your own dates.

Then respond with ONLY valid JSON — no markdown, no commentary:
{${wanted.map((f) => shapes[f.key]).join(",")}}`;
      // Three connector fetches + thinking + a full JSON payload: the default
      // budget starved this exact call into "Sync failed" every time on Opus 5
      // (reproduced live, then proven fixed at 4000 — 2026-08-26).
      // Haiku, deliberately: pulling three feeds into JSON is mechanical work,
      // and the fast model turns a 30-40s Opus sync into ~10s. Haiku 5.5 thinks
      // by default (medium) — Low keeps that thinking from eating the 4000 budget.
      const resp = await callClaude([{ role: "user", content: prompt }], {
        useTools: true, maxTokens: 4000, model: "claude-haiku-5-5", effort: "low",
        servers: wanted.map((f) => ({ name: f.server })),
      });
      // A panel changes only when ITS connector returned a successful tool result
      // and the reply carries ITS array. The Worker can fall back to connector-free
      // chat; that must never make invented or empty JSON look like live data.
      const ok = succeededConnectors(resp);
      let parsed = null;
      try { parsed = extractJSON(extractText(resp)); } catch (e) { parsed = null; }
      landed = wanted.filter((f) => ok.has(f.server) && parsed && Array.isArray(parsed[f.key]));
      const unverified = wanted.filter((f) => !landed.includes(f));
      for (const f of unverified) problems.push({ key: f.key, text: `${f.label} unverified` });
      setSyncProblems(problems);
      if (landed.length) {
        setData((d) => ({ ...d, ...Object.fromEntries(landed.map((f) => [f.key, parsed[f.key]])) }));
        setFeedLive((prev) => ({ ...prev, ...Object.fromEntries(landed.map((f) => [f.key, true])) }));
        setSelectedComm(null);
      }
      if (unverified.length) {
        const names = listNames(unverified.map((f) => f.label));
        throw new Error(landed.length
          ? `Live sync did not verify successful results from ${names}; those panels were not replaced.`
          : `Live sync did not verify successful results from ${names}; no feeds were replaced.`);
      }
    } catch (e) {
      // React state updates above have not changed this render's feedLive value.
      // Describe the actual result of this attempt plus any older retained feeds.
      const kept = OPS_FEEDS.filter((f) => feedLive[f.key] && !landed.includes(f));
      const demo = OPS_FEEDS.filter((f) => !feedLive[f.key] && !landed.includes(f));
      setSyncProblems(OPS_FEEDS.filter((f) => !landed.includes(f)).map((f) =>
        problems.find((p) => p.key === f.key) || { key: f.key, text: `${f.label} unverified` }));
      const truth = !landed.length && !kept.length
        ? "Showing the demo preview; no live data was loaded."
        : [
            landed.length ? `Updated ${listNames(landed.map((f) => f.what))}.` : "",
            kept.length ? `Keeping the last synced ${listNames(kept.map((f) => f.what))}.` : "",
            demo.length ? `Demo preview remains for ${listNames(demo.map((f) => f.what))}.` : "",
          ].filter(Boolean).join(" ");
      setError(`${e?.message || "Sync failed."} ${truth}`);
    } finally {
      setSyncing(false);
    }
  }
  const syncLiveRef = useRef(syncLive);
  syncLiveRef.current = syncLive;

  // Coming back to Ember after a while refreshes the panels by itself — Brady
  // should never have to press SYNC to see current data. Same automation rule
  // as the arrival sync below.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && navigator.webdriver && !window.__EMBER_AUTOSYNC_TEST) return;
      if (lastSyncRef.current && Date.now() - lastSyncRef.current > OPS_STALE_MS) syncLiveRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // OPS fills itself on arrival — Brady shouldn't need to know a SYNC button
  // exists for the panels to stop being demo furniture. One shot per page
  // load; the button stays as the manual refresh. Skipped under automation
  // (navigator.webdriver) so test harnesses don't fire live network calls;
  // a harness testing THIS behavior sets window.__EMBER_AUTOSYNC_TEST.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (autoSyncedRef.current) return;
    if (typeof navigator !== "undefined" && navigator.webdriver && !window.__EMBER_AUTOSYNC_TEST) return;
    autoSyncedRef.current = true;
    const t = setTimeout(() => { try { syncLive(); } catch (e) {} }, 1500);
    return () => clearTimeout(t);
  }, []);

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

  function discardDraft() {
    lsDel(CAPTION_DRAFT_KEY);
    setCaptionRestored(false);
    setPhotos([]); setCaption(""); setFishId(null);
    setSponsors(blankSponsors());
  }

  /* Publish the finished JPEG + caption through Ember's same-origin gateway to Brady's
     private Drive outbox. This does NOT post to Instagram/Facebook; it drops a reviewed,
     ready-to-post package into Drive. Only a readable `{ ok: true }` server response is a
     success — an opaque or interrupted request must never be presented as sent. */
  async function publishToOutbox() {
    if (!photos.length || !caption || publishing) return;
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

    const publishImages = photos.map((p) => `data:image/jpeg;base64,${p.publishB64 || p.b64}`);
    const payload = {
      source: "ember-caption-studio",
      caption: forPost.text,
      captionWithHandles: forHumans.text,
      lockedTag: LOCKED_TAG,
      hashtagCount: forPost.total,
      // Full-quality publish renders, first slide first. The gateway derives any legacy
      // compatibility field only after validating this canonical array.
      images: publishImages,
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
      storyImages: storyImages.map((image) => `data:image/jpeg;base64,${image}`),
    };
    try {
      const res = await fetch(OUTBOX_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let result;
      try { result = await res.json(); }
      catch { throw new Error("The Drive outbox returned an unreadable confirmation."); }
      if (!res.ok || result?.ok !== true) throw new Error("The Drive outbox did not confirm the handoff.");
      setPublishMsg(`✓ Sent to the Drive outbox for ${picked.length} destination${picked.length > 1 ? "s" : ""} — review and post from there.`);
      lsDel(CAPTION_DRAFT_KEY);
    } catch (e) {
      setPublishMsg("Couldn't confirm the Drive outbox handoff. Your draft is still here — retry when Ember's gateway is available.");
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
  const lastClaudeReply = [...chatMsgs].reverse().find((m) => m.role === "assistant" && m.status === "complete")?.content || "";
  const lastChatUserId = [...chatMsgs].reverse().find((m) => m.role === "user")?.id;
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

  /* ---------- CONTEXT LEVERS: Draft Reply + Local Task Draft ---------- */


  // Draft reply from a call or email row: the answer opens in the editable draft
  // box (formerly the lever's job) and never sends.
  async function draftReply(item, type, index) {
    if (!item || leverBusy || thinking) return;
    setSelectedComm({ type, i: index });
    setLeverPending(null); setDraftEdit(null); setTaskProposal(null);
    setLeverBusy("draft");
    try {
      const prompt = type === "vm"
        ? `Draft a reply text to ${item.from} on the ${item.line || "Fishing"} Quo line responding to: "${item.vm || "their missed call — apologize we missed them and ask how we can help"}". Premium-but-warm, BLUF, sign Brady @ Baxstar. Show me the draft — don't send yet.`
        : `Draft a reply to the email from ${item.from}: "${item.subject}". Match Baxstar voice. Show me the draft — don't send yet.`;
      const answer = await sendCommand(prompt);
      if (answer) { setDraftEdit(answer); setLeverPending("draft"); }
    } finally {
      setLeverBusy(null);
    }
  }

  function openTaskDraft(item, type, index) {
    if (!item) return;
    setSelectedComm({ type, i: index });
    setDraftEdit(null);
    setTaskFeedback("");
    setTaskError("");
    setTaskProposal({
      id: chatId(),
      title: `${type === "vm" ? "Call back" : "Follow up with"} ${item.from}`,
      due: "",
      details: type === "vm" ? item.vm || item.note || "" : item.subject || "",
      source: (!feedLive[type === "vm" ? "voicemails" : "emails"] ? "Demo preview — " : "") + (type === "vm" ? `call/voicemail from ${item.from}${item.line ? " (" + item.line + " line)" : ""}` : `email from ${item.from}: "${item.subject}"`),
    });
    setLeverPending("task");
  }


  function confirmTaskProposal() {
    if (!taskProposal?.title.trim()) return;
    try {
      mcSaveTaskDraft(taskProposal);
      setTaskProposal(null); setLeverPending(null); setTaskError("");
      setTaskFeedback("Saved locally in Mission Control → Baxstar Ember; not sent to Quo.");
    } catch (e) {
      setTaskError(e.message || "Could not save the task on this device. Your draft is still here.");
    }
  }

  /* ---------- OPS TRUTH LINE ----------
     One short line, per feed: what is live, what is stale, what is still demo. */
  const opsNote = (() => {
    if (!live && !syncProblems.length) return "Demo preview · Sync to load current calls, email, and schedule.";
    const why = (f) => syncProblems.find((p) => p.key === f.key);
    const fresh = OPS_FEEDS.filter((f) => feedLive[f.key] && !why(f));
    const rest = OPS_FEEDS.filter((f) => !fresh.includes(f)).map((f) => {
      const w = why(f);
      return `${f.what[0].toUpperCase()}${f.what.slice(1)}: ${feedLive[f.key] ? "last sync kept" : "demo preview"}${w ? ` (${w.text})` : ""}`;
    });
    if (!rest.length) return "";
    return [fresh.length ? `Live: ${fresh.map((f) => f.what).join(", ")}` : null, ...rest].filter(Boolean).join(" · ");
  })();

  /* ---------- QUICK ACTIONS ---------- */

  const ACTIONS = [
    { id: "miss", label: "What'd I miss", primary: true, prompt: "What did I miss? Check missed calls and voicemails on both Quo inboxes (last 24h), unread Gmail (last 24h), and today's + tomorrow's calendar. BLUF summary, then anything needing a reply." },
    { id: "triage", label: "Triage inbox", dot: "var(--ember-orange)", prompt: "Triage my unread Gmail from the last 24h: bucket into NEEDS REPLY / FYI / IGNORE, one line each. Suggest a one-sentence reply for each NEEDS REPLY." },
    { id: "brief", label: "Brief my day", dot: "var(--brass)", prompt: "Brief me on tomorrow: calendar events in order with times, plus any open loops from today's calls or emails I should handle before the first event." },
    // Handoff draft was dropped from the dock 2026-08-01 to make room for Projects —
    // Rule 15 makes log writes Claude's job automatically, and the AI Handoff studio
    // tool still covers manual pulls.
  ];

  // The reactor's push-plates and the Inbox's Triage link run these exact prompts.
  // Triage also hands over the inbox Brady is looking at — but only when that
  // panel is live; the demo preview must never be passed off as his email.
  function runPrompt(id) {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action || thinking) return;
    let prompt = action.prompt;
    if (id === "triage" && feedLive.emails && data.emails.length) {
      prompt += `\n\nThe Inbox panel currently shows (from the last live sync):\n${data.emails
        .map((m) => `- ${m.from}${m.time ? ` (${m.time})` : ""}: ${m.subject}`).join("\n")}\nCheck Gmail for anything newer.`;
    }
    setView("ops");
    setPromptRunning(id);
    Promise.resolve(sendCommand(prompt)).finally(() => setPromptRunning(null));
  }

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
        html { scroll-padding-bottom:calc(126px + env(safe-area-inset-bottom)); }
        * { box-sizing:border-box; }
        body, button, input, textarea { font-family:var(--ember-font-ui); }
        .font-mono-x { font-family:"SF Mono",ui-monospace,Menlo,monospace; }
        .font-display { font-family:"Cinzel","Georgia",serif; }

        .ember-root { position:relative; min-height:100vh; overflow-x:clip; }
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
          width:100%; min-height:100vh; max-width:none;
          padding:16px clamp(68px,5.4vw,96px) calc(126px + env(safe-area-inset-bottom));
          gap:12px; overflow:visible;
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
          display:grid; grid-template-columns:minmax(0,1fr) minmax(420px,1.9fr) minmax(0,1fr);
          gap:12px; align-items:stretch; min-height:640px; flex:none;
        }
        .cap-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:stretch; min-height:0; }
        .ops-side { min-height:0; gap:10px!important; }
        .ops-core, .ops-side { min-width:0; }
        .ops-data-note { margin:0 4px; color:var(--ink-dim); font-size:12px; line-height:1.5; }
        .feed-empty { padding:22px 0; color:var(--ink-dim); font-size:13px; line-height:1.6; }

        @media (max-width:1020px){
          .ember-root { height:auto; min-height:100vh; overflow:auto; }
          .ember-shell { width:100%; height:auto; min-height:100vh; padding:14px 14px calc(110px + env(safe-area-inset-bottom)); overflow:visible; }
          .main-grid, .cap-grid { grid-template-columns:minmax(0,1fr); }
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

        /* Opacity ONLY. The old translateY+blur entrance promoted every .reveal row
           to a rasterized GPU layer on iOS Safari; with any page zoom the layer
           re-rendered at the wrong scale and small text (Model/Effort segs, thread
           bubbles) stayed permanently fuzzy — KNOWN-ISSUES §12, same disease as the
           codexDrum. No transform, no filter, on anything carrying small text. */
        @keyframes riseIn { from{opacity:0;} to{opacity:1;} }
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
        .is-thinking .core-glow { animation-duration:1.1s; opacity:1; }

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
        .home-thread { display:flex; flex-direction:column; gap:12px; overflow-y:auto;
          width:100%; min-height:240px; height:clamp(240px,32vh,360px); max-height:none;
          flex:none; padding:4px; scrollbar-gutter:stable; overscroll-behavior:contain; }
        .home-thread > div { flex-shrink:0; }
        .home-thread > div:last-child { scroll-margin-bottom:76px; }
        .chat-bubble { max-width:94%; font-size:15px; line-height:1.65; overflow-wrap:anywhere; }
        .chat-composer { display:flex; align-items:center; gap:8px; width:100%; }
        .chat-composer .cmd-input { flex:1; min-width:0; min-height:76px; max-height:240px; resize:vertical; font-size:16px; line-height:1.5; padding:12px 14px; }
        .chat-run { flex:none; min-width:58px; min-height:52px; border-radius:10px;
          padding:10px; font-size:12px; font-weight:800; color:#fff; }
        .chat-run:disabled { cursor:not-allowed; opacity:.4; }
        .chat-message-actions button { min-width:44px; min-height:44px; }
        /* Touch only: on a mouse pointer these 44px minimums wrapped Model onto two
           tall rows and pushed Model/Effort below the fold. Phones keep the target
           (they also get .seg.sm min-height:44px in the max-width:760px block). */
        @media (pointer:coarse) { .chat-controls button { min-width:44px; min-height:44px; } }
        .chat-message-actions { display:flex; align-items:center; gap:8px; margin-top:8px; }
        .chat-message-status { font-size:12px; color:var(--ink-dim); }
        .chat-text { white-space:normal; }
        .chat-served { color:var(--ink-faint); letter-spacing:.06em; text-transform:none; }
        .chat-text p { white-space:pre-wrap; margin:0 0 10px; }
        .chat-text > :last-child { margin-bottom:0; }
        .chat-text ul, .chat-text ol { padding-left:24px; margin:8px 0; }
        .chat-text ul { list-style:disc; }
        .chat-text ol { list-style:decimal; }
        .chat-text li { margin:3px 0; }
        .chat-text a { color:var(--ember-brass-bright); text-decoration:underline; text-underline-offset:3px; }
        .chat-text code { font-family:monospace; font-size:.9em; background:rgba(255,255,255,.06); border-radius:4px; padding:2px 4px; }
        .chat-code { min-width:0; max-width:100%; margin:10px 0; }
        .chat-code > span { display:block; color:var(--ink-dim); font-size:11px; }
        .chat-code pre { white-space:pre; overflow-x:auto; max-width:100%; padding:12px; border:1px solid var(--line); border-radius:8px; }
        .chat-code code { padding:0; background:none; }
        .chat-error, .chat-connectors, .chat-feedback, .chat-hint { width:100%; font-size:12px; line-height:1.5; }
        .chat-error { color:#ffb4aa; }
        .chat-connectors { color:var(--ember-brass-bright); }
        .chat-feedback, .chat-hint { color:var(--ink-dim); }
        .task-proposal button, .task-proposal input, .task-proposal textarea, .task-feedback button, .task-draft-button { min-height:44px; }
        .task-proposal button { min-width:44px; }
        @media (max-width:979px){ .home-thread { height:clamp(260px,45vh,420px); } }
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
        .voice-picker-row { flex-wrap:wrap; width:100%; }
        .voice-pick { background:#120c0c; color:var(--ember-amber); border:1px solid var(--ember-brass-dark);
          border-radius:8px; font-size:10px; padding:6px 8px; flex:0 1 270px; min-width:190px; max-width:270px; }
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

        /* The brass skull arch was removed 2026-09-22 (Brady: "get rid of that and
           move the circular full version up and bigger"). The reactor is the crown now. */
        .core-host { overflow:hidden; }
        /* Lift the chamber's contents above the background gradients. z-index needs a
           position, but this must not clobber children that place themselves: give
           any such child .core-abs. (The :not() also keeps this rule's specificity
           where it has always been, above single-class rules like .notch.) */
        .core-host > :not(.core-abs) { position:relative; z-index:1; }

        .orb-shell { position:absolute; inset:0; height:100%; width:100%; pointer-events:none; opacity:.94; }

        .core-chamber {
          overflow:hidden; min-height:640px; gap:8px!important; padding:8px 16px 12px!important;
          justify-content:flex-start;
          background:
            radial-gradient(circle at 50% 48%,rgba(255,92,24,.08),transparent 42%),
            linear-gradient(180deg,#0b0a08,#070706)!important;
        }
        .core-chamber h2 { font-size:clamp(22px,1.55vw,28px); line-height:1.05; }
        .core-chamber .reveal.text-center .mt-3\\.5 { margin-top:8px!important; }
        .core-chamber .max-w-sm { max-width:100%; }
        .core-chamber .greet-row { margin-top:2px; max-width:100%; }
        .core-chamber .core-wrap { flex:none; }
        .core-chamber.has-thread .greet-row { margin-top:2px; }
        .reactor-stage {
          position:relative; width:250px; height:250px;
          margin:0 auto; cursor:pointer; isolation:isolate;
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
        .is-thinking .reactor-stage::before { animation-duration:3.2s; opacity:1; }
        .is-thinking .reactor-stage::after { animation-duration:2.1s; opacity:.9; }
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
        /* ---------- MISSION CONTROL (iron/bronze) ---------- */
        .mc-grid { display:grid; grid-template-columns:1.15fr .85fr; gap:12px; min-height:0; min-width:0; width:100%; }
        @media (max-width:1020px){ .mc-grid { grid-template-columns:1fr; } }
        .mc-stack, .mc-grid .panel { min-width:0; width:100%; max-width:100%; }
        .mc-stack { display:flex; flex-direction:column; gap:12px; min-height:0; }
        .mc-input { border:1px solid var(--line); background:#0f0d0b; color:var(--candle);
          min-width:0; max-width:100%; border-radius:7px; padding:5px 8px; font-size:12px; caret-color:var(--brass); }
        .mc-input:focus { outline:none; border-color:var(--brass); box-shadow:0 0 0 3px rgba(176,141,87,.14); }
        .mc-num { width:74px; text-align:right; font-variant-numeric:tabular-nums; }
        .mc-metric { display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:9px;
          border:1px solid var(--ember-panel-line); background:linear-gradient(180deg,#131110,#0c0b0a); }
        .mc-metric .k { font-size:8.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-faint); }
        .mc-metric .v { font-size:19px; font-weight:800; color:var(--candle); font-variant-numeric:tabular-nums; letter-spacing:.02em; }
        .mc-metric .v.warn { color:var(--ember-red); }
        .mc-metric .v.ok { color:#54e08a; }
        /* Zapier task meter bar */
        .mc-meter { height:12px; border-radius:7px; overflow:hidden; border:1px solid var(--ember-brass-dark);
          background:repeating-linear-gradient(45deg,#0e0d0b,#0e0d0b 6px,#121110 6px,#121110 12px); position:relative; }
        .mc-meter-fill { height:100%; transition:width .4s var(--ember-ease-sweep);
          background:linear-gradient(90deg,var(--brass),var(--ember-amber)); }
        .mc-meter-fill.warn { background:linear-gradient(90deg,var(--copper),var(--ember-red)); }
        .mc-meter-mark { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--candle); opacity:.55; }
        /* project fuse row */
        .mc-fuse-wrap { position:relative; height:14px; border-radius:8px;
          background:linear-gradient(180deg,#0c0b0a,#100e0c); border:1px solid var(--ember-panel-line); overflow:hidden; }
        .mc-fuse-burnt { position:absolute; left:0; top:0; bottom:0;
          background:repeating-linear-gradient(90deg,#241a12,#241a12 3px,#1c140d 3px,#1c140d 6px); opacity:.9; }
        .mc-fuse-live { position:absolute; top:0; bottom:0;
          background:linear-gradient(90deg,rgba(176,141,87,.25),var(--brass) 60%,var(--ember-amber)); }
        .mc-fuse-spark { position:absolute; top:50%; width:9px; height:9px; margin-top:-4.5px; margin-left:-4.5px;
          border-radius:50%; background:radial-gradient(circle,#fff,var(--ember-orange) 45%,transparent 70%);
          box-shadow:0 0 9px 2px rgba(255,120,60,.75); animation:mcSpark 1.5s ease-in-out infinite; }
        @keyframes mcSpark { 0%,100%{ transform:scale(1); opacity:.9; } 50%{ transform:scale(1.35); opacity:1; } }
        .mc-row { min-width:0; max-width:100%; border:1px solid var(--ember-panel-line); border-radius:11px; padding:10px 12px;
          background:linear-gradient(180deg,var(--ember-panel-alt),var(--ember-panel)); }
        .mc-row.blocked { border-color:rgba(217,60,43,.5); }
        .mc-row.frozen { opacity:.72; }
        .mc-row.kill { border-color:var(--ember-red); box-shadow:0 0 0 1px rgba(255,77,50,.25), 0 0 18px rgba(255,50,30,.12); }
        .mc-status { font-size:8.5px; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
          padding:2px 8px; border-radius:20px; border:1px solid; cursor:pointer; background:transparent; }
        .mc-st-active { color:#54e08a; border-color:rgba(84,224,138,.5); }
        .mc-st-blocked { color:var(--ember-red); border-color:rgba(217,60,43,.55); }
        .mc-st-parked { color:var(--ember-amber); border-color:rgba(255,177,59,.5); }
        .mc-st-frozen { color:var(--gunmetal); border-color:rgba(120,120,132,.6); }
        .mc-tag-rev { color:#54e08a; border-color:rgba(84,224,138,.5); }
        .mc-tag-norev { color:var(--ink-faint); border-color:var(--line); }
        .mc-chip { font-size:8.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
          padding:2px 8px; border-radius:20px; border:1px solid var(--line); color:var(--ink-dim); }
        .mc-check { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:12px; color:var(--ink-dim); }
        .mc-check input { accent-color:var(--brass); width:14px; height:14px; }
        .mc-check.done span { text-decoration:line-through; opacity:.55; }
        .mc-mini { font-size:9px; letter-spacing:.05em; color:var(--brass); background:transparent; border:1px solid var(--ember-brass-dark);
          border-radius:6px; padding:3px 8px; cursor:pointer; }
        .mc-mini:hover { color:var(--candle); border-color:var(--brass); }
        .mc-resume { color:var(--ember-amber); border-color:rgba(255,158,61,.5); background:rgba(255,158,61,.10); white-space:nowrap; }
        .mc-resume:hover:not(:disabled) { background:rgba(255,158,61,.20); border-color:rgba(255,158,61,.85); }
        .mc-resume:disabled { opacity:.35; cursor:default; }
        .mc-linkchip { display:inline-flex; align-items:center; gap:4px; max-width:100%; padding:2px 5px; border-radius:6px;
          border:1px solid var(--ember-panel-line); background:#0e0c0b; font-size:10px; }
        .mc-linkchip a { max-width:100%; overflow:hidden; text-overflow:ellipsis; color:var(--ember-amber); text-decoration:underline; text-underline-offset:2px; white-space:nowrap; }
        .mc-linkchip a:hover { color:var(--candle); }
        .mc-linkin { width:74px; font-size:9px; padding:1px 4px; }
        .mc-linkurl { width:150px; }
        .mc-x { color:var(--ink-faint); background:transparent; border:none; cursor:pointer; font-size:14px; line-height:1; padding:0 4px; }
        .mc-x:hover { color:var(--ember-red); }

        @media (max-width:760px) {
          .mc-grid, .mc-stack, .mc-grid .panel, .mc-row { min-width:0; width:100%; max-width:100%; }
          .mc-grid .grid-cols-4 { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .mc-project-head, .mc-project-meta, .mc-next-row, .mc-links { min-width:0; width:100%; }
          .mc-project-head { align-items:stretch; flex-wrap:wrap; }
          .mc-project-head > .mc-input { flex:1 1 100%; width:100%; }
          .mc-project-head .mc-status { flex:1 1 auto; }
          .mc-project-meta .mc-mini { margin-left:0; }
          .mc-next-row { align-items:stretch; flex-wrap:wrap; }
          .mc-next-row > .fieldlabel { flex:0 0 100%; }
          .mc-next-row > .mc-input { flex:1 1 100%; width:100%; }
          .mc-links { align-items:stretch; }
          .mc-linkchip { flex:1 1 100%; flex-wrap:wrap; width:100%; }
          .mc-linkchip > a, .mc-linkchip > span { flex:1 1 100%; }
          .mc-linkin { flex:1 1 90px; width:auto; }
          .mc-linkurl { flex-basis:150px; width:auto; }
          .mc-input, .mc-status, .mc-mini { min-height:44px; }
          .mc-x { display:inline-flex; align-items:center; justify-content:center; min-width:44px; min-height:44px; }
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

        /* ---------- DOCK MECHANISM MOTION ----------
           Restored 2026-09-21. The 2026-08-01 rebuild swapped the whole bar for a
           CSS one and the cinematic motion layer went with it; the 2026-08-15 tiles
           brought the painted mechanisms back but not their movement. Three of them
           move again here — the linkage lever, the wheel, the reactor core — under
           one rule that is not stylistic:

               NOTHING DRAWS A SECOND OUTLINE OF ANYTHING.

           The first attempt at dock motion had to be benched because synthesised
           line-art mechanisms sat on top of the photoreal ones and double-drew them.
           So none of the moving parts here is drawn. Each is a MASKED COPY OF THE
           SAME PAINTED PIXELS, transformed in place: the mask element never moves,
           the copy inside it does, and inside the mask that copy is opaque — so it
           covers the still artwork rather than adding to it. There is no frame in
           which two versions of a mechanism are on screen at once.

           Geometry is expressed as a percentage of .dock-art, whose box IS the
           233.333 x 200 source-pixel crop and which scales that crop uniformly.
           Every region therefore stays locked to its own brass at any tile width,
           on any screen, with nothing measured in JS. */
        .dock-mech { position:absolute; inset:0; pointer-events:none; }
        .dock-mech-rotor { position:absolute; inset:0; }

        /* LEVER — Caption Studio, the strip's second panel: the connecting rod that
           runs from the crank boss down to the suspended brass vessel. Pressing the
           button throws it and lets it settle.
           The pivot is the boss centre, panel-local (122.75, 134) — located by ring
           symmetry and confirmed against the rod's fitted centreline to within half
           a source pixel. An off-centre pivot is what makes a swing look like a
           slide, so it is measured, not estimated.
           The mask is the rod's SWEPT ENVELOPE across the whole throw, feathered, so
           its edge always falls on bare backplate — the rod is never sliced by the mask,
           and the still rod is never left showing beside the moving one.

           WHAT SETS THE TRAVEL is the hanger assembly above the vessel, and it is not
           what it looks like. The hanger is INSIDE the mask, so it rises with the
           vessel rather than standing still; push too far and its brass climbs past the
           mask's top edge and is simply erased, shearing the assembly in half. The
           envelope's top is therefore raised to y=114 across x=174..207 — the dark gap
           that runs between the hanger's upper eye and the vessel below it (measured:
           that band peaks at luminance 40-97, while y<=113 and y>=126 are brass at
           121-202). The shear line now falls in bare plate, and the eye above it stays
           put, which is what a bolted hanger should do.
           Travel stops at 8deg — the mask's true ceiling, where the dimmest hanger
           pixel still sits at 57% opacity and none is erased. Erasure starts near
           10deg and is total by 12deg, so there is no more angle to take. The throw
           is short by nature, so it is made FAST instead: 420ms with an overshoot,
           because at this size the eye catches a snap it would miss in a drift. The gears, the small gear and the bottom rail are nowhere near at
           any of these angles. The boss itself is deliberately left out of the moving
           layer, because its upper-left overlaps the big gear's teeth and any mask
           holding it would drag a tooth with it. */
        .dock-mech-lever {
          -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='s'%3E%3CfeGaussianBlur stdDeviation='2.4'/%3E%3C/filter%3E%3Cpolygon points='129.5,146.4 133.5,124.8 172.0,121.9 174.0,114.0 207.0,114.0 213.8,152.5 213.5,154.1 213.1,155.6 212.7,157.2 212.3,158.8 211.9,160.3 211.4,161.9 210.9,163.4 210.4,165.0 209.8,166.5 209.2,168.0 208.6,169.5 208.0,171.0 178.0,171.0' fill='white' filter='url(%23s)'/%3E%3C/svg%3E"); mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='s'%3E%3CfeGaussianBlur stdDeviation='2.4'/%3E%3C/filter%3E%3Cpolygon points='129.5,146.4 133.5,124.8 172.0,121.9 174.0,114.0 207.0,114.0 213.8,152.5 213.5,154.1 213.1,155.6 212.7,157.2 212.3,158.8 211.9,160.3 211.4,161.9 210.9,163.4 210.4,165.0 209.8,166.5 209.2,168.0 208.6,169.5 208.0,171.0 178.0,171.0' fill='white' filter='url(%23s)'/%3E%3C/svg%3E");
          -webkit-mask-size:100% 100%; mask-size:100% 100%;
          -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
        }
        .dock-mech-lever .dock-mech-rotor {
          transform-origin:52.607% 67%;
          /* Idle: one throw every 9s, unprompted — motion-spec's "intermittent
             mechanical cycles". The button's own click also changes the view, so an
             on-press-only throw is a throw nobody is looking at. */
          animation:dockLeverIdle 9s cubic-bezier(.16,1.1,.3,1) infinite;
          will-change:transform;
        }
        .dock-mech-lever .dock-mech-rotor.run {
          animation:dockLeverPull 420ms cubic-bezier(.16,1.1,.3,1);
        }
        @keyframes dockLeverIdle {
          0%, 100% { transform:rotate(0deg); }
          2.2%     { transform:rotate(-8deg); }
          3.6%     { transform:rotate(-8deg); }
          5.2%     { transform:rotate(0deg); }
        }
        @keyframes dockLeverPull {
          0%   { transform:rotate(0deg); }
          18%  { transform:rotate(-8deg); }
          30%  { transform:rotate(-8deg); }
          100% { transform:rotate(0deg); }
        }

        /* GEAR — the same Caption Studio tile: the sixteen-tooth brass gear. It turns,
           slowly and forever, and it is the real gear in the artwork rather than
           something wheel-shaped standing in for one.
           Centre panel-local (85.47, 88), clip r=45. The radius is the whole trick,
           and the usable window is TWO pixels wide, not eight. Measured brightness on
           the boundary ring itself (1440 angular samples): r=43 is 12.5% bright brass
           and r=44 is 3.3% — those are the gear's own tooth tips, so clipping there
           shaves the mechanism. r=46 is 2.6% (max 177) and r=47 is 5.8% (max 172) —
           that is the lever's polished ball joint, whose inner edge sits at r=46, and
           a clip through it makes one bright blob orbit the gear once per turn.
           r=45 is the only ring that is inside neither: 0.0% above luminance 110,
           max 83. For scale, the r=56 radius that visibly swallows the panel's frame
           bar and sweeps it round as a diagonal measures 5.4% — indistinguishable
           from r=47.
           A circular mask is what keeps the rotation seamless: the boundary is
           rotation-invariant, so no angle of the turn can reveal an edge, and
           centring it on the measured hub is what stops it wobbling.
           SPEED, corrected 2026-09-22 after Brady looked at it: motion-spec's
           14s idle was written for a large studio gear, and at this tile the disc is
           24 CSS px across — one revolution every 14s is about five pixels of rim
           travel per second, which reads as a still image. 4.5s is the slowest rate
           that still reads as machinery running rather than a photograph. */
        .dock-mech-gear {
          -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='g'%3E%3CfeGaussianBlur stdDeviation='1.5'/%3E%3C/filter%3E%3Ccircle cx='85.47' cy='88.0' r='45' fill='white' filter='url(%23g)'/%3E%3C/svg%3E"); mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='g'%3E%3CfeGaussianBlur stdDeviation='1.5'/%3E%3C/filter%3E%3Ccircle cx='85.47' cy='88.0' r='45' fill='white' filter='url(%23g)'/%3E%3C/svg%3E");
          -webkit-mask-size:100% 100%; mask-size:100% 100%;
          -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
        }
        .dock-mech-gear .dock-mech-rotor {
          transform-origin:36.63% 44.0%;
          animation:dockGearSpin 4.5s linear infinite;
          will-change:transform;
        }
        @keyframes dockGearSpin { to { transform:rotate(360deg); } }

        /* REACTOR — the third quick action, the strip's third panel: the glowing
           porthole. An idle amber breath over the painted core, centred on the
           glow's own luminance-weighted centroid, panel-local (121.24, 122.72), and
           stopping at r=52 where the glow has fallen back to plate level — eight
           pixels short of the bezel's inner edge, so it can never bloom onto brass.
           mix-blend-mode:screen means this layer can only ADD light. It cannot
           occlude the artwork, cannot darken it, and cannot put an edge anywhere —
           which is the whole reason a glow is safe where a drawn ring would not be.
           Every gradient stop is SAMPLED from the asset's own core — #fefde9, #f98719,
           #fa7716, #e64a06, #a72902, a candle-white centre falling through ember
           orange into oxblood. No new hue is introduced, so warmth-only
           (BUILD-PROMPT S3) holds by construction, not by inspection.
           4200ms matches the ambient cadence motion-spec.json already uses for
           tank-energy, so the dock breathes at the same rate as the rest of the room. */
        .dock-reactor {
          position:absolute; pointer-events:none; mix-blend-mode:screen;
          left:29.6743%; top:35.36%; width:44.5714%; height:52.0%;
          border-radius:50%;
          background:radial-gradient(circle at 50% 50%,
            rgba(255,214,150,.44) 0 6%,
            rgba(255,140,40,.42) 18%,
            rgba(242,98,22,.30) 36%,
            rgba(204,58,8,.17) 56%,
            rgba(150,36,2,.06) 76%,
            transparent 92%);
          opacity:.70;
          animation:dockReactorPulse 4200ms ease-in-out infinite alternate;
          will-change:opacity, transform;
        }
        @keyframes dockReactorPulse {
          from { opacity:.16; transform:scale(.92); }
          to   { opacity:1;   transform:scale(1.08); }
        }

        /* Reduced motion: the movement stops, the light stays. The global rule near
           the end of this sheet already kills every animation, which parks each rotor
           at 0deg and the reactor at its resting opacity — so the resting frame is
           deliberately the LIT one, not a hidden one. These two lines restate that
           locally so a future edit to the base opacity cannot silently leave
           reduced-motion users with a dark core. */
        @media (prefers-reduced-motion:reduce) {
          .dock-mech .dock-mech-rotor { transform:none !important; }
          .dock-reactor { opacity:.70 !important; transform:none !important; }
        }

        /* WHEEL — FareHarbor (2026-10-15), the old Brief My Day tile's ship's wheel.
           Same masked-copy technique as the gear: the painted wheel itself turns.
           Brady's spec: spin fast, slow down, come home, rest five seconds, repeat.
           Three whole turns (1080deg) with a long ease-out land EXACTLY on the start
           pose, so nothing ever snaps back; then it holds still for 5s of the 8.6s.
           Geometry measured on the asset, not estimated: centre panel-local
           (104.19, 108.37) by a least-squares fit to the rim's outer edge (168 edge
           points), rim outer radius 68.1. This wheel is not as clean a case as the
           gear: its rim touches fixed brackets, handle stubs and a ring of bolt
           heads, so NO circle is bare plate all the way round. Boundary-ring scan,
           1440 samples per ring: r=70 3.75% bright, r=70.5 2.29%, r=72 1.88%,
           r=74 0.69%, r=74.5 0.49%, r=77 1.32%.
           The clip is r=70.5, NOT the lowest-scoring r=74.5, and that is the lesson
           this wheel adds to CLAUDE.md's: a quiet boundary is still not enough. At
           r=74.5 the disc carries a ring of plate whose shadow is lit from the upper
           left; turned, that shading made the disc's edge visible mid-spin as a
           dark crescent. At r=70.5 the disc holds only the wheel — rim, spokes, hub
           — and almost no plate, so nothing in it betrays the turn. Its bright
           boundary samples are the four places the rim meets its mounts, which then
           read as what they are: a wheel turning between fixed brackets.
           Verified on frames: outside the mask plus its feather (r=72.9) two
           mid-spin frames differ in 0 of 80517 pixels; the 3.6s and 6.0s rest frames
           are identical to frame 0 in every pixel. */
        .dock-mech-wheel {
          -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='w'%3E%3CfeGaussianBlur stdDeviation='0.8'/%3E%3C/filter%3E%3Ccircle cx='104.19' cy='108.37' r='70.5' fill='%23fff' filter='url(%23w)'/%3E%3C/svg%3E");
          mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 233.3333 200'%3E%3Cfilter id='w'%3E%3CfeGaussianBlur stdDeviation='0.8'/%3E%3C/filter%3E%3Ccircle cx='104.19' cy='108.37' r='70.5' fill='%23fff' filter='url(%23w)'/%3E%3C/svg%3E");
          -webkit-mask-size:100% 100%; mask-size:100% 100%;
          -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
        }
        .dock-mech-wheel .dock-mech-rotor {
          transform-origin:44.653% 54.185%;
          animation:dockWheelCycle 8.6s infinite;
          will-change:transform;
        }
        @keyframes dockWheelCycle {
          0%      { transform:rotate(0deg); animation-timing-function:cubic-bezier(.08,.62,.2,1); }
          41.86%  { transform:rotate(1080deg); }
          100%    { transform:rotate(1080deg); }
        }

        /* FURNACE — Knowledge Graph (2026-10-15), the old What'd I Miss reactor tile.
           Same screen-blended light as the reactor breath (it can only ADD light,
           never outline anything), slowed into a heat swell with a second, smaller
           flicker riding on it. The flicker changes about twice a second and only by
           a few percent — fire, not a strobe; well clear of the 3-flashes-a-second
           photosensitivity line. Reduced motion leaves it steadily lit. */
        .dock-furnace { animation:dockFurnaceSwell 5600ms ease-in-out infinite alternate; }
        .dock-furnace::after { content:""; position:absolute; inset:-6%; border-radius:50%;
          background:radial-gradient(circle at 50% 56%, rgba(255,170,90,.38), rgba(230,74,6,.18) 45%, transparent 70%);
          animation:dockFurnaceFlicker 3700ms linear infinite; }
        @keyframes dockFurnaceSwell {
          from { opacity:.28; transform:scale(.94); }
          to   { opacity:1;   transform:scale(1.06); }
        }
        @keyframes dockFurnaceFlicker {
          0% { opacity:.55; } 14% { opacity:.8; } 23% { opacity:.62; } 37% { opacity:.9; } 49% { opacity:.66; }
          63% { opacity:.84; } 76% { opacity:.58; } 88% { opacity:.78; } 100% { opacity:.55; }
        }

        /* GOOGLE DRIVE plate — see DrivePlate. Opaque, round, set into the gauge's own
           bezel; a slow sheen crosses it (screen blend: light only). */
        .dock-drive { position:absolute; left:26.396%; top:29.74%; width:43.286%; height:50.5%;
          border-radius:50%; overflow:hidden; pointer-events:none;
          box-shadow:inset 0 1px 2px rgba(0,0,0,.7); }
        .dock-drive svg { display:block; width:100%; height:100%; }
        .dock-drive-sheen { position:absolute; inset:0; mix-blend-mode:screen;
          background:linear-gradient(115deg, transparent 35%, rgba(255,214,150,.30) 50%, transparent 65%);
          background-size:300% 100%; animation:dockDriveSheen 7s ease-in-out infinite; }
        @keyframes dockDriveSheen { 0%, 55% { background-position:120% 0; } 100% { background-position:-120% 0; } }

        a.dock-control { text-decoration:none; }
        /* Phones: the longer 2026-10-15 names (KNOWLEDGE GRAPH, FAREHARBOR) must fit a
           ~58px tile without clipping a letter. */
        @media (max-width:440px){ .dock-label { font-size:7.6px; letter-spacing:.01em; } }
        @media (max-width:380px){ .dock-label { font-size:7.2px; letter-spacing:0; margin:0 -2px; width:calc(100% + 4px); } }

        /* Inbox heading link — runs the existing triage prompt into chat. */
        .panel-link { background:none; border:none; padding:0; cursor:pointer;
          font-family:var(--ember-font-display); font-size:10.5px; font-weight:700; letter-spacing:.08em;
          color:var(--ember-brass-bright); text-decoration:underline; text-decoration-color:rgba(214,179,106,.4);
          text-underline-offset:3px; white-space:nowrap; }
        .panel-link:hover:not(:disabled) { color:#ffd08a; text-decoration-color:currentColor; }
        .panel-link:disabled { opacity:.5; cursor:default; }
        @media (pointer:coarse) { .panel-link { min-height:44px; padding:0 4px; } }

        /* KNOWLEDGE GRAPH overlay. */
        .kg-overlay { position:fixed; inset:0; z-index:80; background:rgba(0,0,0,.5);
          display:flex; align-items:center; justify-content:center; padding:clamp(10px,3vw,40px); }
        .kg-sheet { position:relative; display:flex; flex-direction:column; width:min(1500px,100%); height:min(940px,100%);
          border:2px solid #6b4a26; border-radius:16px; overflow:hidden;
          background:linear-gradient(180deg,#120d08,#070605);
          box-shadow:inset 0 0 0 1px rgba(214,179,106,.25), 0 24px 60px rgba(0,0,0,.75), 0 0 30px rgba(255,105,38,.12); }
        .kg-head { display:flex; align-items:center; gap:14px; padding:10px 12px 10px 18px; flex:none;
          border-bottom:1px solid var(--ember-panel-line); }
        .kg-title { font-size:13px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:var(--ember-text-soft); }
        .kg-open { margin-left:auto; font-size:11px; font-weight:700; letter-spacing:.06em; color:var(--ember-brass-bright); }
        .kg-close { margin-left:auto; width:44px; height:44px; flex:none; border-radius:10px; cursor:pointer;
          border:1px solid #8a6230; color:#ffe1b0; font-size:18px; line-height:1;
          background:linear-gradient(180deg,#3a2716,#140d07); box-shadow:inset 0 1px 0 rgba(255,214,150,.25); }
        .kg-open + .kg-close { margin-left:0; }
        .kg-close:hover { filter:brightness(1.2); border-color:var(--ember-brass-bright); }
        .kg-body { position:relative; flex:1; min-height:0; }
        .kg-frame { display:block; width:100%; height:100%; border:0; background:#080605; }
        .kg-works { height:100%; overflow:auto; padding:10px; }
        .kg-works .eco-rail { margin:0; }
        .kg-works .reveal { opacity:1; animation:none; }
        @media (max-width:760px) {
          .kg-overlay { padding:6px; }
          .kg-head { gap:8px; padding:6px 6px 6px 12px; flex-wrap:wrap; }
          .kg-title { font-size:11px; letter-spacing:.12em; }
        }

        .ember-row { padding-top:8px!important; padding-bottom:8px!important; }
        .ember-row .row-title { font-size:13.5px; line-height:1.25; }
        .panel h3 { font-size:12px!important; color:var(--ember-text-soft)!important; }

        /* pipe-junction ornaments — outer frame corners only, never behind text */
        .pipe-junction { position:absolute; top:-8px; width:46px; height:46px; opacity:.55; pointer-events:none; z-index:0; display:none; }
        .pipe-junction.pj-l { left:-12px; }
        .pipe-junction.pj-r { right:-12px; transform:scaleX(-1); }
        @media (min-width:980px){ .pipe-junction { display:block; } }

        /* PUSH-PLATES — WHAT'D I MISS / BRIEF MY DAY either side of the reactor
           (Brady, 2026-10-15; they replaced the Draft Reply / Task Draft levers).
           Machined brass, engraved caps, an ember lamp that glows while its prompt
           runs. They sit in the reactor's row, so they can never cover it. */
        .core-row { display:flex; align-items:center; justify-content:center; gap:clamp(10px,2.2vw,34px); width:100%; }
        .prompt-plate {
          flex:none; position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px;
          width:clamp(74px,6.4vw,98px); min-height:clamp(78px,7vw,98px); padding:10px 6px 9px;
          border:2px solid #6b4a26; border-radius:3px 12px 3px 12px; cursor:pointer; isolation:isolate;
          background:
            radial-gradient(circle at 9px 9px,#c2924e 0 1.4px,#3a2718 2.2px 3.6px,transparent 4px),
            radial-gradient(circle at calc(100% - 9px) 9px,#c2924e 0 1.4px,#3a2718 2.2px 3.6px,transparent 4px),
            radial-gradient(circle at 9px calc(100% - 9px),#c2924e 0 1.4px,#3a2718 2.2px 3.6px,transparent 4px),
            radial-gradient(circle at calc(100% - 9px) calc(100% - 9px),#c2924e 0 1.4px,#3a2718 2.2px 3.6px,transparent 4px),
            linear-gradient(180deg,#3a2716 0%,#1c130b 46%,#0d0905 100%);
          box-shadow:inset 0 1px 0 rgba(255,214,150,.28), inset 0 0 0 1px rgba(214,179,106,.22),
            inset 0 -10px 16px rgba(0,0,0,.5), 0 8px 18px rgba(0,0,0,.6), 0 0 14px rgba(255,105,38,.08);
          transition:transform 140ms var(--ember-ease-mechanical), filter 180ms, box-shadow 180ms;
        }
        /* An etched serial and a moving reflection make these feel like bespoke
           instruments. Only light moves; no copied mechanism or shifting target. */
        .prompt-plate::before {
          content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none; z-index:-1;
          background:radial-gradient(ellipse at var(--plate-x,50%) var(--plate-y,24%),
            rgba(255,200,112,.52), rgba(196,108,37,.12) 48%, transparent 76%);
          mix-blend-mode:screen; opacity:.22; transition:opacity 220ms var(--ember-ease-mechanical);
        }
        .prompt-plate::after {
          content:""; position:absolute; left:22%; right:22%; bottom:5px; height:1px; pointer-events:none;
          background:#ffbd6b; box-shadow:0 0 7px rgba(255,122,69,.7);
          opacity:.35; transform:scaleX(.28);
          transition:transform 260ms var(--ember-ease-mechanical), opacity 180ms;
        }
        .plate-index { position:absolute; top:5px; left:0; right:0; font-family:ui-monospace,monospace;
          font-size:7px; line-height:1; letter-spacing:.16em; color:#c6a271; pointer-events:none; }
        .prompt-plate:focus-visible::before, .prompt-plate.running::before { opacity:.85; }
        .prompt-plate:focus-visible::after, .prompt-plate.running::after { opacity:1; transform:scaleX(1); }
        @media (hover:hover) and (pointer:fine) {
          .prompt-plate:hover:not(:disabled)::before { opacity:1; }
          .prompt-plate:hover:not(:disabled)::after { opacity:1; transform:scaleX(1); }
        }
        .prompt-plate:hover:not(:disabled) { filter:brightness(1.16); box-shadow:inset 0 1px 0 rgba(255,214,150,.32),
            inset 0 0 0 1px rgba(214,179,106,.4), inset 0 -10px 16px rgba(0,0,0,.5), 0 8px 18px rgba(0,0,0,.6), 0 0 18px rgba(255,105,38,.22); }
        .prompt-plate:active:not(:disabled) { transform:translateY(2px); box-shadow:inset 0 3px 8px rgba(0,0,0,.7), inset 0 0 0 1px rgba(214,179,106,.3); }
        .prompt-plate:focus-visible { outline:2px solid var(--ember-brass-bright); outline-offset:3px; }
        .prompt-plate:disabled { cursor:default; opacity:.62; }
        .prompt-plate.running { opacity:1; }
        .plate-lamp { width:9px; height:9px; border-radius:50%;
          background:radial-gradient(circle at 35% 35%,#ffb27a,#c3381c 60%,#5a1408);
          box-shadow:0 0 6px rgba(255,77,50,.55), inset 0 -1px 2px rgba(0,0,0,.5); }
        .prompt-plate.running .plate-lamp { animation:plateLamp 900ms ease-in-out infinite; }
        @keyframes plateLamp { 0%,100% { box-shadow:0 0 5px rgba(255,77,50,.5); filter:brightness(.9); } 50% { box-shadow:0 0 14px rgba(255,122,69,.95); filter:brightness(1.35); } }
        .plate-label { display:flex; flex-direction:column; align-items:center; gap:1px;
          font-family:var(--ember-font-display); font-weight:700; font-size:clamp(10px,.8vw,12px); line-height:1.15;
          letter-spacing:.1em; color:#f0d9a8; text-shadow:0 1px 0 #000, 0 0 8px rgba(255,150,70,.18); }
        @media (prefers-reduced-motion:reduce) {
          .prompt-plate.running .plate-lamp { animation:none; }
          .prompt-plate { --plate-x:50%!important; --plate-y:24%!important; }
          .prompt-plate:active:not(:disabled) { transform:none; }
        }

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

        /* ---------- YOUR TOOLS RAIL ----------
           Engraved brass plates screwed to the foot of the dashboard. Same
           warmth law as the rest of the instrument: no blues, no purples. */
        /* ---------- THE WORKS — ecosystem graph ----------
           Same warmth law as the rest of the instrument: no blues, no purples.
           On a phone the SVG keeps its min-width and the rail scrolls sideways —
           shrinking 39 labels to fit a 360px screen makes them unreadable, which
           is worse than panning. */
        .eco-rail { width:100%; padding:10px 16px; margin-top:4px; flex:none; }
        .eco-head { display:flex; align-items:center; gap:7px; min-height:44px; cursor:pointer; list-style:none; }
        .eco-head::-webkit-details-marker { display:none; }
        .eco-head::after { content:"Open map +"; font-size:11px; color:var(--brass); margin-left:10px; }
        .eco-rail[open] .eco-head { padding-bottom:9px; margin-bottom:11px; border-bottom:1px solid var(--ember-panel-line); }
        .eco-rail[open] .eco-head::after { content:"Close map −"; }
        .eco-count { margin-left:auto; font-size:8.5px; letter-spacing:.2em; color:var(--ink-faint); }
        .eco-legend { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
        .eco-key { display:inline-flex; align-items:center; gap:6px; padding:4px 9px; border-radius:999px;
          border:1px solid var(--ember-panel-line); background:rgba(18,16,13,.6); cursor:pointer;
          font-size:9.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
          color:var(--ink-dim); transition:border-color 160ms var(--ember-ease-mechanical), color 160ms; }
        .eco-key:hover { border-color:var(--line-hot); color:var(--ink); }
        .eco-key.on { border-color:var(--ember-brass-bright); color:var(--ink); background:rgba(214,179,106,.1); }
        .eco-key.reset { color:var(--ink-faint); }
        .eco-dot { width:8px; height:8px; border-radius:50%; }
        .eco-scroll { overflow-x:auto; overflow-y:hidden; -webkit-overflow-scrolling:touch;
          border:1px solid var(--ember-panel-line); border-radius:12px; background:rgba(10,9,7,.5); }
        .eco-svg { display:block; width:100%; min-width:1040px; height:auto; }
        .eco-node { cursor:pointer; }
        .eco-node:focus { outline:none; }
        .eco-node:focus-visible circle { stroke:var(--ember-brass-bright); }
        .eco-label { font-family:var(--ember-font-ui); font-size:10px; font-weight:600;
          letter-spacing:.02em; pointer-events:none; }
        .eco-label.core { font-size:12px; font-weight:800; letter-spacing:.12em; }
        .eco-detail { display:flex; align-items:baseline; flex-wrap:wrap; gap:9px; min-height:34px;
          padding:9px 2px 0; }
        .eco-detail-name { font-size:12.5px; font-weight:800; letter-spacing:.03em; }
        .eco-detail-note { font-size:11.5px; line-height:1.5; color:var(--ink-dim); }
        .eco-detail-meta { font-size:8.5px; letter-spacing:.2em; color:var(--ink-faint); }
        .eco-detail-open { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
          color:var(--ember-brass-bright); text-decoration:none; }
        .eco-detail-open:hover { text-decoration:underline; }
        @media (max-width:760px) {
          .eco-rail { padding:12px 13px 14px; }
          .eco-detail { min-height:46px; }
        }
        @media (prefers-reduced-motion:reduce) { .eco-node { transition:none; } }

        .tools-rail { width:100%; padding:7px 12px 10px; flex:none; }
        .tools-head { display:flex; align-items:center; gap:7px; padding-bottom:9px; margin-bottom:11px;
          border-bottom:1px solid var(--ember-panel-line); }
        .tools-groups { display:grid; grid-template-columns:repeat(11,minmax(0,1fr)); gap:7px; }
        .tools-group, .tools-links { display:contents; }
        .tools-group .fieldlabel, .tool-note { display:none; }
        .tool-link { display:flex; flex-direction:column; gap:1px; min-width:0;
          min-height:44px; justify-content:center; padding:8px; border-radius:9px; text-decoration:none;
          border:1px solid var(--ember-panel-line);
          background:linear-gradient(180deg,rgba(214,179,106,.07),rgba(10,9,7,.55));
          box-shadow:inset 0 1px 0 rgba(255,201,122,.10);
          transition:border-color .16s, background .16s, box-shadow .16s; }
        .tool-link:hover { border-color:var(--ember-brass-bright);
          background:linear-gradient(180deg,rgba(255,158,61,.15),rgba(10,9,7,.5));
          box-shadow:inset 0 1px 0 rgba(255,201,122,.2), 0 3px 16px rgba(255,120,60,.16); }
        .tool-name { font-size:11.5px; font-weight:700; letter-spacing:.02em; color:var(--ink); overflow-wrap:anywhere; }
        .tool-note { font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); }
        @media (max-width:1179px){
          .tools-groups { display:flex; overflow-x:auto; padding-bottom:5px; scrollbar-width:thin; }
          .tool-link { flex:0 0 128px; }
          .tools-head::after { content:"scroll for more →"; margin-left:auto; font-size:10px; color:var(--ink-dim); }
        }
        @media (max-width:760px){
          .tools-rail { padding:7px 10px 10px; }
          .core-chamber { padding-left:10px!important; padding-right:10px!important; }
          .core-chamber .greet-row { gap:6px!important; padding:3px 4px!important; }
          .core-chamber .greet-row .chip { min-height:44px; padding:8px 9px!important; }
          .ember-header .header-control, .seg.sm, button.chip, .eco-key { min-height:44px; }
          .chat-bubble { max-width:100%; }
          .eco-count { letter-spacing:.04em; }
        }

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

        @media (prefers-reduced-motion:reduce){ *, *::before, *::after {animation:none!important; transition:none!important;} .reveal{opacity:1;} }
        @media (max-height:820px) and (min-width:1021px) {
          .ember-shell { padding-top:18px; gap:10px; }
          .ember-header { min-height:48px; padding-block:6px; }
          .mic-rail { min-height:32px; padding-block:5px!important; }
          .core-chamber { padding-block:8px!important; }
          .tool-tile { min-height:50px; }
        }

        /* ---------- ONE-SCREEN OPS (Brady, 2026-10-15) ----------
           On a desktop-sized window the OPS view is exactly one viewport tall:
           header, the three columns, YOUR TOOLS and the fixed dock all show at once,
           and the panels scroll inside themselves instead of the page scrolling.
           Measured before: 1440x900 ran to 1144px with YOUR TOOLS hidden under the
           dock. Short or narrow windows keep the normal scrolling layout. */
        .ops-error { margin:0 4px; color:#ff8074; font-size:12px; font-weight:600; line-height:1.4; }
        /* Truncate to one line only where a pointer can hover for the full text. */
        @media (min-width:1021px) and (hover:hover){
          .ops-error { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        }
        .core-wrap { width:100%; container-type:inline-size; }
        .reactor-stage {
          /* Height-led: everything else in the centre column is ~270px fixed. */
          --r: clamp(140px, calc(100dvh - 630px), 330px);
          width:min(var(--r), calc(100cqw - 2 * clamp(74px,6.4vw,98px) - 2 * clamp(10px,2.2vw,34px)));
          height:auto; aspect-ratio:1;
        }
        .core-chamber.has-thread .reactor-stage { --r: clamp(96px, calc(100dvh - 760px), 170px); height:auto; }
        @media (max-width:760px){
          .prompt-plate { width:58px; min-height:70px; padding:8px 3px; gap:5px; }
          .plate-label { font-size:9px; letter-spacing:.05em; }
          .core-row { gap:6px; }
          .reactor-stage { --r:240px; width:min(var(--r), calc(100cqw - 2 * 58px - 2 * 6px)); }
        }
        @media (min-width:1021px) and (min-height:640px){
          .ember-shell.ops-fit { height:100dvh; min-height:0; overflow:hidden; }
          .ops-fit .main-grid { flex:1 1 0; min-height:0; grid-template-rows:minmax(0,1fr); }
          .ops-fit .ops-side, .ops-fit .ops-core { min-height:0; }
          .ops-fit .ops-core { display:flex; flex-direction:column; }
          .ops-fit .core-chamber { min-height:0; }
          .ops-fit .home-thread { flex:1 1 0; height:auto; min-height:80px; }
          .ops-fit .chat-composer, .ops-fit .chat-hint, .ops-fit .chat-controls { flex:none; }
          .ops-fit .chat-hint { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          /* Model and Effort share one row. */
          .ops-fit .chat-controls { flex-wrap:nowrap; max-width:none; column-gap:8px; }
          .ops-fit .chat-controls > div { gap:5px; }
          .ops-fit .chat-controls .codex { flex-wrap:nowrap; padding:1px 4px; gap:3px; }
          .ops-fit .chat-controls .seg.sm { padding:4px 9px; font-size:10px; }
          .ops-fit .chat-controls .fieldlabel { letter-spacing:.12em; }
        }
        /* A conversation is open: the thread gets the room. The reactor shrinks,
           the push-plates become one-line pills, and the greeting and ENIGMA/SCOPE
           rows step aside until the thread is cleared. */
        @media (min-width:1021px) and (min-height:640px){
          .ops-fit .core-chamber.has-thread .reactor-stage { --r: clamp(64px, calc(100dvh - 810px), 150px); }
          .ops-fit .core-chamber.has-thread .greet-row,
          .ops-fit .core-chamber.has-thread .core-wrap > .mt-2 { display:none; }
          .ops-fit .core-chamber.has-thread .prompt-plate { flex-direction:row; width:auto; min-height:0; padding:7px 12px; gap:7px; }
          .ops-fit .core-chamber.has-thread .plate-index { display:none; }
          .ops-fit .core-chamber.has-thread .plate-label { flex-direction:row; gap:4px; }
          .ops-fit .core-chamber.has-thread .chat-composer .cmd-input { min-height:56px; }
        }
        /* No conversation open: the reactor row takes exactly the room the panel
           has left once greeting, composer, hint and controls are placed, and the
           reactor sizes itself to that room (container query units) rather than to
           a guess from the window height. A guess overflowed at 1024x700 and
           1100x640, where narrow columns wrap the controls onto two rows. */
        @media (min-width:1021px) and (min-height:640px){
          .ops-fit .core-chamber:not(.has-thread) .core-wrap { flex:1 1 0; min-height:0; container-type:size; justify-content:center; }
          .ops-fit .core-chamber:not(.has-thread) .reactor-stage {
            width:min(330px, calc(100cqw - 2 * clamp(74px,6.4vw,98px) - 2 * clamp(10px,2.2vw,34px)), calc(100cqh - 44px));
          }
          .ops-fit .core-chamber:not(.has-thread) .prompt-plate { min-height:min(clamp(78px,7vw,98px), calc(100cqh - 44px)); }
        }
        /* SCOPE shares the row with the push-plates, so it must be able to shrink. */
        .core-row .scope-bezel { flex:0 1 auto; min-width:0; margin-top:6px; margin-bottom:6px; }
        .core-row .scope-bezel canvas { width:100%; height:auto; }
        /* Short laptop windows: the composer starts at two lines, not three. */
        @media (min-width:1021px) and (min-height:640px) and (max-height:800px){
          .ops-fit .chat-composer .cmd-input { min-height:56px; padding:9px 12px; }
          .ops-fit .core-wrap > .mt-2 { margin-top:2px; }
          .ops-fit .core-chamber { gap:6px!important; padding-top:6px!important; padding-bottom:8px!important; }
        }
        /* Narrower centre columns: the field labels give their room to the buttons
           (the buttons still name themselves; the row stays one row). */
        .ops-core { container-type:inline-size; }
        @container (max-width:600px){
          .ops-fit .chat-controls .fieldlabel { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
          .ops-fit .chat-controls { column-gap:8px; }
          .ops-fit .chat-controls .seg.sm { padding:4px 7px; font-size:9.5px; }
        }
        @container (max-width:470px){
          .ops-fit .chat-controls { column-gap:5px; }
          .ops-fit .chat-controls .codex { padding:1px 2px; gap:2px; }
          .ops-fit .chat-controls .seg.sm { padding:4px 5px; font-size:9px; }
        }
        .chat-controls > .chip { white-space:nowrap; }
        /* Short windows with a conversation open: the hint line steps aside
           (still announced to screen readers) so the thread keeps its room. */
        @media (min-width:1021px) and (min-height:640px) and (max-height:799px){
          .ops-fit .core-chamber.has-thread .chat-hint { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
        }
        /* YOUR TOOLS: one slim row with its label inline. */
        .tools-rail.panel { display:flex; align-items:center; gap:12px; border-width:9px; border-radius:12px; padding:3px 8px; }
        .tools-rail .tools-head { flex:none; border:none; padding:0; margin:0; }
        .tools-rail .tools-groups { flex:1; min-width:0; }
        .tools-rail .tools-groups { display:flex; gap:7px; overflow-x:auto; scrollbar-width:thin; }
        .tool-link { flex:1 0 auto; min-height:32px; padding:5px 10px; }
        .tool-name { white-space:nowrap; overflow-wrap:normal; }
        @media (pointer:coarse){ .tool-link { min-height:44px; } }
        @media (max-width:1179px){ .tools-rail .tools-head::after { content:none; } }
        /* Warm focus everywhere: the browser's default blue ring broke the warmth
           law on the YOUR TOOLS links (Brady's screenshot, 2026-10-15). */
        a:focus-visible, button:focus-visible, [role="button"]:focus-visible, summary:focus-visible {
          outline:2px solid var(--ember-brass-bright); outline-offset:2px; }
        a:focus:not(:focus-visible), button:focus:not(:focus-visible) { outline:none; }
        /* Chat replies: 1pt smaller than the 15px they were (Brady, 2026-10-15). */
        .chat-bubble { font-size:calc(15px - 1pt); }
        /* The composer grows up to 192px (was 240px, -20%), then scrolls inside. */
        .chat-composer .cmd-input { max-height:192px; }
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

      <div className={`ember-shell relative z-10 mx-auto flex flex-col ${bgActive ? "bg-on" : ""} ${view === "ops" ? "ops-fit" : ""}`}>

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
              {view === "ops" ? "OPS" : view === "projects" ? "PROJECTS" : view === "mission" ? "MISSION CONTROL" : "BAXSTAR STUDIO"}
            </span>
          </div>

          <div className="font-mono-x flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-[10px] tracking-wider" style={{ color: "var(--ink-dim)" }}>
            {OPS_FEEDS.map((f) => {
              // Offline wins over stale-but-real data: the light reports the connector now.
              const state = connStatus?.[f.server] === "offline" ? "offline" : !feedLive[f.key] ? "demo" : freshFeeds.includes(f) ? "live" : "stale";
              const dot = state === "live" ? "#54e08a" : state === "offline" ? "#ff4d3d" : "var(--ember-orange)";
              return (
                <span key={f.server} className="conn-dots flex items-center gap-1.5" data-connector={f.server} data-state={state}
                  title={state === "live" ? `${f.label}: live` : state === "offline" ? `${f.label}: offline — ${feedLive[f.key] ? "showing the last sync" : "demo preview"}` : state === "stale" ? `${f.label}: refresh unverified — showing the last sync` : `${f.label}: demo preview`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
                  {f.label.toUpperCase()}
                </span>
              );
            })}
            <span className="hdr-clock" style={{ color: "var(--ink-faint)" }}>{feedState} · {clock}</span>

            <button onClick={() => setBgMenu(!bgMenu)} title="Background"
              className="header-control rounded-md border px-2 py-1 transition-colors"
              style={{ borderColor: "var(--line)", color: bg.choice !== "default" ? "var(--ember-orange)" : "var(--ink-faint)" }}>
              <img src={`${ASSETS}/svg/ornaments/corner-gear.svg`} alt="" width="14" height="14"
                style={{ display: "inline-block", verticalAlign: "-3px", marginRight: "4px" }} />BG
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

        {/* One slim line, not a boxed banner: the failure stays visible and complete
            (hover or long-press shows all of it), it just stops costing 40px. */}
        {error && <p className="ops-error" role="alert" title={error}>{error}</p>}


        {/* ================= OPS VIEW ================= */}
        {view === "ops" && opsNote && (
          <p className="ops-data-note" role="status">{opsNote}</p>
        )}
        {view === "ops" && (
        <div className="main-grid flex-1">

          {/* LEFT */}
          <div ref={callsColRef} className="ops-side flex min-h-0 flex-col gap-4">
            <Panel notch="warm" title="Calls & Voicemail" count={`${data.voicemails.length} ITEMS`} countColor="var(--ember-orange)" delay="0.15s" grow>
              {data.voicemails.length === 0 && <p className="feed-empty">No missed calls or voicemails returned for the last 48 hours.</p>}
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
                    <button className="chip solid" disabled={thinking || !!leverBusy} onClick={(e) => { e.stopPropagation(); draftReply(v, "vm", i); }}>
                      Draft reply
                    </button>
                    <button className="chip ghost task-draft-button" onClick={(e) => { e.stopPropagation(); openTaskDraft(v, "vm", i); }}>
                      Task draft
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
                  {revEdit === null ? (
                    <button className="chip ghost" onClick={editRevenue}>{revSet ? "Update" : "Set today's number"}</button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        autoFocus
                        inputMode="numeric"
                        placeholder="dollars"
                        value={revEdit}
                        onChange={(e) => setRevEdit(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRevenue(revEdit); if (e.key === "Escape") setRevEdit(null); }}
                        className="cmd-input w-24 rounded-lg px-2 py-1 text-[12px]"
                        style={{ background: "#120c0c", color: "var(--ink)" }}
                        aria-label="Today's revenue in dollars"
                      />
                      <button className="chip solid" onClick={() => commitRevenue(revEdit)}>Save</button>
                      <button className="chip ghost" onClick={() => setRevEdit(null)}>Cancel</button>
                    </div>
                  )}
                  {revEdit !== null && <div className="mt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>Numbers only — save empty to clear.</div>}
                </div>
              </Row>
            </Panel>
          </div>

          {/* CENTER: CORE — first thing on a phone (.ops-core orders it to the top).
              One compact greeting line; the counts are BUTTONS that jump to their
              panels, because a number you can't act on is dead weight up here. */}
          <div className="ops-core flex min-h-0 flex-col">
            <div className={`core-chamber panel core-host relative flex flex-1 flex-col items-center justify-center ${chatMsgs.length ? "has-thread" : ""} ${thinking || syncing ? "is-thinking" : ""}`}>
              {/* The skeleton. Its CSS survived the v2 merge but this element didn't —
                  the class had nothing to draw until 2026-08-01. */}
              <span className="notch hot" />


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
                <div className="core-row">
                <PromptPlate side="left" lines={["WHAT'D", "I MISS"]} running={thinking && promptRunning === "miss"}
                  disabled={thinking} onPress={() => runPrompt("miss")} />
                {coreMode === "enigma" ? (
                  <div className="reactor-stage" onClick={() => cmdInputRef.current?.focus()} role="button" aria-label="Focus the ask box">
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
                  <div className="scope-bezel mx-auto my-6" onClick={() => cmdInputRef.current?.focus()} role="button" aria-label="Focus the ask box">
                    <span className="scope-screw" style={{ top: "5px", left: "6px" }} />
                    <span className="scope-screw" style={{ top: "5px", right: "6px" }} />
                    <span className="scope-screw" style={{ bottom: "5px", left: "6px" }} />
                    <span className="scope-screw" style={{ bottom: "5px", right: "6px" }} />
                    <canvas ref={scopeRef} width="300" height="110" style={{ display: "block" }} />
                  </div>
                )}
                <PromptPlate side="right" lines={["BRIEF", "MY DAY"]} running={thinking && promptRunning === "brief"}
                  disabled={thinking} onPress={() => runPrompt("brief")} />
                </div>

                {/* Status + the core's face selector. The old row carried five voice
                    controls; what is left is what a dashboard actually needs: is she
                    working, and which instrument do you want to look at. */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <span className="font-mono-x text-[9.5px] tracking-[0.25em]"
                    style={{ color: thinking || syncing ? "var(--ember-orange)" : "var(--ink-faint)" }}>
                    {thinking ? "THINKING…" : syncing ? "SYNCING…" : live ? feedState : "READY"}
                  </span>
                  <button className={`seg sm ${coreMode === "enigma" ? "on" : ""}`} onClick={() => setCoreMode("enigma")}>ENIGMA</button>
                  <button className={`seg sm ${coreMode === "scope" ? "on" : ""}`} onClick={() => setCoreMode("scope")}>SCOPE</button>
                </div>
              </div>

              {/* THE THREAD — home is the real Claude chat (Brady, 2026-08-01). Full
                  scrolling history, not a single-answer box; OPS commands, dock
                  actions and typed questions all land here. */}
              {chatMsgs.length > 0 && (
                <div ref={chatThreadRef} className="home-thread reveal w-full" role="region" aria-label="Conversation" aria-busy={thinking}
                  onScroll={(e) => { const el = e.currentTarget; chatPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
                  style={{ animationDelay: "0.45s" }}>
                  {chatMsgs.map((m) => (
                    m.role === "user" ? (
                      <div key={m.id} data-message-id={m.id} data-role="user" data-status={m.status} className="chat-bubble self-end whitespace-pre-wrap rounded-2xl rounded-br-sm border px-4 py-2.5"
                        style={{ background: "rgba(255,77,61,.13)", borderColor: "var(--line-hot)", color: "var(--ink)" }}>
                        {m.content}
                        {m.id === lastChatUserId && !thinking && <div className="chat-message-actions"><button className="chip ghost" onClick={() => sendCommand(undefined, { retryId: m.id })}>Retry</button></div>}
                      </div>
                    ) : (
                      <div key={m.id} data-message-id={m.id} data-role="assistant" data-status={m.status} className="chat-bubble self-start rounded-2xl rounded-bl-sm border px-4 py-2.5"
                        style={{ background: "#140d0d", borderColor: "var(--line)", color: "var(--ink)" }}>
                        <span className="font-mono-x mb-1 block text-[8.5px] tracking-[0.25em]" style={{ color: "var(--ember-orange)" }}>EMBER{m.model && <span className="chat-served" title="Model the API reports served this reply"> · {m.model}</span>}</span>
                        {m.content ? <ChatText text={m.content} /> : m.status === "streaming" ? <span>Thinking…</span> : <span>No reply text received.</span>}
                        <div className="chat-message-actions">
                          {m.status === "complete" ? <button className="chip ghost" aria-label="Copy reply" onClick={() => copyChat(m)}>{copiedChatId === m.id ? "Copied" : "Copy"}</button> :
                            <span className="chat-message-status">{({ streaming: "Replying…", stopped: "Stopped · not saved", truncated: "Incomplete · output limit", error: "Incomplete · not saved" })[m.status]}</span>}
                        </div>
                      </div>
                    )
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}

              {chatConnectors && <div className="chat-connectors" role="status">{chatConnectors}</div>}
              {chatError && <div className="chat-error" role="alert">{chatError}</div>}
              {chatFeedback && <div className="chat-feedback" role="status">{chatFeedback}</div>}
              <span className="sr-only" role="status">{thinking ? "Ember is replying. Stop is available." : chatMsgs.at(-1)?.status === "complete" && chatMsgs.at(-1)?.role === "assistant" ? "Reply complete." : ""}</span>

              <div className="chat-composer reveal" style={{ animationDelay: "0.55s" }}>
                <textarea
                  ref={cmdInputRef}
                  rows={2} value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); if (!e.repeat) sendCommand(); }
                    if (e.key === "Escape" && activeChatRef.current) { e.preventDefault(); stopChat(); }
                  }}
                  aria-label="Ask Ember"
                  aria-describedby="chat-input-hint"
                  placeholder="Ask Ember anything…"
                  className="cmd-input w-full rounded-xl px-5 py-3.5 text-sm"
                  style={{ background: "#120c0c", color: "var(--ink)" }}
                />
                <button onClick={() => thinking ? stopChat() : sendCommand()}
                  disabled={!thinking && (!chatReady || !command.trim())}
                  className="chat-run transition-opacity"
                  style={{ background: "linear-gradient(90deg,var(--ember-red),#ff6a4d)" }}>
                  {thinking ? "Stop" : "RUN"}
                </button>
              </div>
              <div id="chat-input-hint" className="chat-hint" title="Last 24 saved messages; up to 8 included as context. Connectors are read-only; external actions are not enabled.">Enter to send · Shift+Enter for a new line · connectors are read-only; nothing is sent for you.</div>

              {/* Model + Effort live on the home page now — the codex wraps instead of
                  running off the right edge of a phone. */}
              <div className="chat-controls reveal flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-2" style={{ animationDelay: "0.6s" }}>
                <div className="flex max-w-full items-center gap-2">
                  <span className="fieldlabel">Model</span>
                  <div className="codex">
                    {MODELS.map((m) => (
                      <button key={m.id} disabled={thinking} aria-pressed={chatModel === m.id} title={`${m.name} · ${m.id}`} className={`seg sm ${chatModel === m.id ? "on" : ""}`} onClick={() => setChatModel(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex max-w-full items-center gap-2">
                  <span className="fieldlabel">Effort</span>
                  <div className="codex">
                    {Object.entries(EFFORT).map(([k, e]) => (
                      <button key={k} disabled={thinking} aria-pressed={chatEffort === k} className={`seg sm ${chatEffort === k ? "on" : ""}`} onClick={() => setChatEffort(k)}>
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>
                {chatMsgs.length > 0 && (
                  <button className="chip ghost" onClick={clearChat}>Clear thread</button>
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

              {taskFeedback && <div className="task-feedback w-full text-xs" role="status" style={{ color: "var(--ember-brass-bright)" }}>{taskFeedback} <button className="chip ghost" onClick={() => setView("mission")}>View in Mission Control</button></div>}
              {taskError && <div className="task-error w-full text-xs" role="alert" style={{ color: "#ffb4aa" }}>{taskError}</div>}
              {/* Local reviewable task draft. General chat has no write-capable tools. */}
              {taskProposal && (
                <div className="task-proposal w-full max-w-sm rounded-xl border px-4 py-3"
                  style={{ borderColor: "rgba(255,177,59,.5)", background: "rgba(255,177,59,.05)" }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono-x text-[9px] tracking-[0.25em]" style={{ color: "var(--ember-warning)" }}>TASK DRAFT — LOCAL ONLY</span>
                    <button aria-label="Close task draft" onClick={() => { setTaskProposal(null); setLeverPending(null); setTaskError(""); }} className="text-xs" style={{ color: "var(--ink-faint)" }}>✕</button>
                  </div>
                  <div className="fieldlabel">Title</div>
                  <input aria-label="Task title" value={taskProposal.title}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, title: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />
                  <div className="fieldlabel mt-2">Due</div>
                  <input aria-label="Task due" placeholder="Optional — choose a due date" value={taskProposal.due}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, due: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-sm" style={{ background: "#120c0c", color: "var(--ink)" }} />
                  <div className="fieldlabel mt-2">Details</div>
                  <textarea aria-label="Task details" value={taskProposal.details}
                    onChange={(e) => { setTaskProposal({ ...taskProposal, details: e.target.value }); setLeverPending(null); }}
                    className="cmd-input mt-1 w-full rounded-lg px-3 py-2 text-[12.5px]"
                    style={{ background: "#120c0c", color: "var(--ink)", minHeight: "60px", resize: "vertical" }} />
                  <div className="mt-1 text-[10px]" style={{ color: "var(--ink-faint)" }}>Source: {taskProposal.source}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" disabled={!taskProposal.title.trim()} onClick={confirmTaskProposal}>Save locally</button>
                    <button className="chip ghost" onClick={() => { setTaskProposal(null); setLeverPending(null); setTaskError(""); }}>Discard</button>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* RIGHT */}
          <div ref={inboxColRef} className="ops-side flex min-h-0 flex-col gap-4">
            <Panel notch="hot" title="Inbox" count={`${data.emails.length} UNREAD`} countColor="#ff8074" delay="0.2s" grow
              action={<button type="button" className="panel-link" disabled={thinking} onClick={() => runPrompt("triage")}>Triage Inbox ›</button>}>
              {data.emails.length === 0 && <p className="feed-empty">No unread email returned for the last 24 hours.</p>}
              {data.emails.map((m, i) => (
                <Row key={i} who={m.from} when={m.time}
                  selected={selectedComm?.type === "email" && selectedComm.i === i}
                  onClick={() => setSelectedComm(selectedComm?.type === "email" && selectedComm.i === i ? null : { type: "email", i })}>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ink-dim)" }}>{m.subject}</div>
                  <div className="mt-2 flex gap-2">
                    <button className="chip solid" disabled={thinking || !!leverBusy} onClick={(e) => { e.stopPropagation(); draftReply(m, "email", i); }}>
                      Draft reply
                    </button>
                    <button className="chip ghost task-draft-button" onClick={(e) => { e.stopPropagation(); openTaskDraft(m, "email", i); }}>
                      Task draft
                    </button>
                  </div>
                </Row>
              ))}
            </Panel>

            <Panel notch="cool" title="Schedule" count={`${data.events.length} EVENTS`} countColor="var(--brass)" gauge={data.events.length / 6} delay="0.3s">
              {data.events.length === 0 && <p className="feed-empty">No calendar events returned for today or tomorrow.</p>}
              {data.events.map((e, i) => (
                <Row key={i} who={`${e.time} — ${e.title}`} when={e.detail} />
              ))}
            </Panel>
          </div>
        </div>
        )}

        {/* Optional reference map. The operating dashboard keeps priority. */}
        {/* YOUR TOOLS sits at the FOOT of the dashboard — Brady's original spec, and
            it gives the workspace back the ~140px at the top of the page that the
            reactor, composer and Model/Effort controls need to fit one screen. */}
        {view === "ops" && (
          <div className="tools-rail panel reveal" style={{ animationDelay: "0.7s" }}>
            <div className="tools-head">
              <img src={`${ASSETS}/svg/ornaments/corner-gear.svg`} alt="" width="12" height="12" aria-hidden="true" />
              <span className="font-mono-x text-[9px] tracking-[0.28em]" style={{ color: "var(--brass)" }}>YOUR TOOLS</span>
            </div>
            <div className="tools-groups">
              {TOOL_LINKS.map((g) => (
                <div key={g.group} className="tools-group">
                  <div className="fieldlabel">{g.group}</div>
                  <div className="tools-links">
                    {g.items.map((t) => (
                      <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" className="tool-link" title={`${g.group} · ${t.note}`}>
                        <span className="tool-name">{t.label}</span>
                        <span className="tool-note">{t.note}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
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

                <div className="mt-4 rounded-lg border p-3"
                  style={{ borderColor: "rgba(255,177,59,.35)", background: "rgba(255,177,59,.04)" }}>
                  <div className="flex items-center gap-2">
                    <EmberIcon name="drive" size={14} />
                    <span className="fieldlabel" style={{ color: "var(--ember-amber)" }}>Protected Drive outbox</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
                    Ember's server gateway protects the private destination. Publishing sends this reviewed package to Drive; it does <b>not</b> post to social by itself. If the gateway is unavailable, the draft stays here.
                  </div>
                </div>

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
        {/* ================= PROJECT BOARDS ================= */}
        {/* One dock tile (Projects — the dock stays at its lawful six), two boards
            behind it: the glanceable session-maintained bars, and Mission Control,
            Brady's editable command board ported from the Codex line's fork. */}
        {(view === "projects" || view === "mission") && (
          <div className="flex justify-center gap-2">
            <button className={`seg sm ${view === "projects" ? "on" : ""}`} onClick={() => setView("projects")}>QUICK BARS</button>
            <button className={`seg sm ${view === "mission" ? "on" : ""}`} onClick={() => setView("mission")}>MISSION CONTROL</button>
          </div>
        )}
        {view === "mission" && <MissionControl />}

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
              <span className="dock-art" style={{ "--panel-x": "42.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /></span>
              <span className="dock-label">OPS</span>
              <span className="dock-lamp" />
            </button>
            <button className={`dock-control ${view === "studio" ? "active" : ""}`}
              onClick={() => { setView("studio"); setStudioTool("captions"); setLeverPull((n) => n + 1); }}>
              <span className="dock-art" style={{ "--panel-x": "142.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /><DockMech kind="gear" /><DockMech kind="lever" pull={leverPull} /></span>
              <span className="dock-label">Caption Studio</span>
              <span className="dock-lamp" />
            </button>
            {/* Dock reorganised 2026-10-15 (Brady): the three quick-action tiles became
                destinations. Their prompts moved, not vanished — WHAT'D I MISS and BRIEF
                MY DAY are the reactor's push-plates, Triage is a link on the Inbox. */}
            <button className={`dock-control ${graphOpen ? "active" : ""}`} onClick={() => setGraphOpen(true)}
              aria-haspopup="dialog" aria-label="Knowledge Graph">
              <span className="dock-art" style={{ "--panel-x": "242.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /><DockMech kind="furnace" /></span>
              <span className="dock-label">Knowl{"\u00AD"}edge Graph</span>
              <span className="dock-lamp" />
            </button>
            <a className="dock-control" href={DRIVE_URL} target="_blank" rel="noopener noreferrer" title="Open Google Drive in a new tab">
              <span className="dock-art" style={{ "--panel-x": "342.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /><DockMech kind="drive" /></span>
              <span className="dock-label">Google Drive</span>
              <span className="dock-lamp" />
            </a>
            <a className="dock-control" href={FAREHARBOR_URL} target="_blank" rel="noopener noreferrer" title="Open the FareHarbor dashboard in a new tab">
              <span className="dock-art" style={{ "--panel-x": "442.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /><DockMech kind="wheel" /></span>
              <span className="dock-label">Fare<wbr />Harbor</span>
              <span className="dock-lamp" />
            </a>
            <button className={`dock-control ${view === "projects" ? "active" : ""}`} onClick={() => setView("projects")}>
              <span className="dock-art" style={{ "--panel-x": "542.857%" }}><img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" /></span>
              <span className="dock-label">Projects</span>
              <span className="dock-lamp" />
            </button>
          </div>
        </div>
        )}
      </div>
      <GraphOverlay open={graphOpen} onClose={closeGraph} />
    </div>
  );
}

/* ============================================================
   SMALL PIECES
   ============================================================ */

/* One painted mechanism, put back in motion.
   Every kind here is a masked copy of the tile's OWN pixels — never new geometry
   drawn over them. `pull` is a counter: keying the rotor off it restarts the throw
   on each press without timers, and the falsy first value keeps it still on load. */
function DockMech({ kind, pull }) {
  if (kind === "reactor") return <span className="dock-reactor" aria-hidden="true" />;
  if (kind === "furnace") return <span className="dock-reactor dock-furnace" aria-hidden="true" />;
  if (kind === "drive") return <DrivePlate />;
  return (
    <span className={`dock-mech dock-mech-${kind}`} aria-hidden="true">
      <span key={pull} className={`dock-mech-rotor ${pull ? "run" : ""}`}>
        <img src={`${ASSETS}/raster/command-console@2x.webp`} alt="" aria-hidden="true" />
      </span>
    </span>
  );
}

/* GOOGLE DRIVE — the Triage tile's painted gauge keeps its brass bezel; an opaque
   engraved plate replaces the dial face (it covers the face and its needle whole,
   so nothing painted is ever doubled). The Drive mark is drawn by its shape alone,
   in three warm metals — brass, copper, bronze — because Google's green/yellow/blue
   would break the warmth law (BUILD-PROMPT S3). Geometry, measured on the asset:
   gauge centre panel-local (112.09, 109.98) by fitting the face's edge; the plate's
   edge is r=50.5, inside the dark band at r=47-50 (0% of 1440 samples above
   luminance 110) and just short of the bright brass line at r=52, which frames it. */
function DrivePlate() {
  return (
    <span className="dock-drive" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <defs>
          <radialGradient id="drvFace" cx="40%" cy="34%" r="70%">
            <stop offset="0" stopColor="#4a3520" /><stop offset=".55" stopColor="#2a1c10" /><stop offset="1" stopColor="#120c06" />
          </radialGradient>
          <linearGradient id="drvBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3cf7f" /><stop offset=".5" stopColor="#c89a45" /><stop offset="1" stopColor="#7a5622" /></linearGradient>
          <linearGradient id="drvCopper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f0a06a" /><stop offset=".5" stopColor="#c0612c" /><stop offset="1" stopColor="#6e2e10" /></linearGradient>
          <linearGradient id="drvBronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e8c48c" /><stop offset=".5" stopColor="#b07a3a" /><stop offset="1" stopColor="#6a4720" /></linearGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#drvFace)" />
        {[44, 37, 30].map((r) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(214,179,106,.10)" strokeWidth=".8" />)}
        <g stroke="rgba(0,0,0,.6)" strokeWidth="1.4" strokeLinejoin="round" transform="translate(50 50) scale(1.2) translate(-50 -51)">
          <polygon points="38,24 52,24 34,56 20,56" fill="url(#drvBronze)" transform="translate(4 6)" />
          <polygon points="48,24 62,24 86,66 72,66" fill="url(#drvBrass)" transform="translate(-6 4)" />
          <polygon points="27,58 74,58 68,70 21,70" fill="url(#drvCopper)" transform="translate(2 2)" />
        </g>
      </svg>
      <span className="dock-drive-sheen" />
    </span>
  );
}

/* KNOWLEDGE GRAPH overlay. Default tab: the Baxstar Knowledge Foundry — the graph
   Brady preferred, a self-contained page in baxstarcode/baxstar-knowledge-network —
   embedded, so it keeps its own search, filters, zoom and sources with no copy to
   drift. It loads only when opened. Second tab: THE WORKS, which used to sit
   collapsed on the OPS page. Backdrop 50% black; Escape, the close button or a
   tap outside the sheet closes it; focus returns to the dock. */
function GraphOverlay({ open, onClose }) {
  const [tab, setTab] = useState("foundry");
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    // Everything behind the dialog goes inert: Tab cannot wander onto the dashboard
    // and screen readers stay in the dialog.
    const shell = document.querySelector(".ember-shell");
    shell?.setAttribute("inert", "");
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      shell?.removeAttribute("inert");
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="kg-overlay" role="dialog" aria-modal="true" aria-label="Knowledge Graph"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="kg-sheet">
        <div className="kg-head">
          <span className="kg-title font-display">Knowledge Graph</span>
          <div className="codex kg-tabs" role="tablist" aria-label="Graph">
            <button role="tab" aria-selected={tab === "foundry"} className={`seg sm ${tab === "foundry" ? "on" : ""}`} onClick={() => setTab("foundry")}>Foundry</button>
            <button role="tab" aria-selected={tab === "works"} className={`seg sm ${tab === "works" ? "on" : ""}`} onClick={() => setTab("works")}>The Works</button>
          </div>
          {tab === "foundry" && <a className="kg-open" href={FOUNDRY_URL} target="_blank" rel="noopener noreferrer">Open full page ↗</a>}
          <button ref={closeRef} type="button" className="kg-close" onClick={onClose} aria-label="Close Knowledge Graph">✕</button>
        </div>
        <div className="kg-body">
          {tab === "foundry"
            ? <iframe className="kg-frame" src={FOUNDRY_URL} title="Baxstar Knowledge Foundry" referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />
            : <div className="kg-works"><EcoGraph defaultOpen /></div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   THE ECOSYSTEM GRAPH — read-only picture of what touches what.

   No graph library. A dependency for one panel is not worth it, and the
   generated index.html must stay self-contained with no CDN (see build.mjs).
   So the layout is ~40 lines of force relaxation below.

   DETERMINISTIC ON PURPOSE. The seed positions come from a golden-angle
   spiral, not Math.random, so the graph draws identically on every render
   and every reload. A graph that rearranges itself each visit is a graph
   Brady has to re-read each visit.
   ============================================================ */

function ecoLayout(nodes, edges, W, H) {
  const N = nodes.length;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const GOLDEN = 2.399963229728653;
  const P = nodes.map((n, i) => {
    const a = i * GOLDEN;
    const r = 40 + 210 * Math.sqrt((i + 0.5) / N);
    return { x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a), vx: 0, vy: 0 };
  });
  const links = edges
    .map(([a, b]) => [idx.get(a), idx.get(b)])
    .filter(([a, b]) => a !== undefined && b !== undefined);

  /* Repulsion is deliberately ANISOTROPIC. What collides on screen is not the
     circles — those sit ~46px apart — it is the LABELS, which are wide and
     short. Pushing equally in every direction produced a readable ring of dots
     with "baxstar-pontoon" printed straight through "Lakes Golf Sim". Shoving
     harder along x buys the horizontal room a text label actually needs. */
  const XBIAS = 2.35;
  const STEPS = 460;
  for (let it = 0; it < STEPS; it++) {
    const cool = 1 - it / STEPS;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 160000) continue;             // ignore far pairs — cheap and harmless
        const d = Math.sqrt(d2), f = 7400 / d2;
        dx /= d; dy /= d;
        P[i].vx += dx * f * XBIAS; P[i].vy += dy * f;
        P[j].vx -= dx * f * XBIAS; P[j].vy -= dy * f;
      }
    }
    for (const [a, b] of links) {
      let dx = P[b].x - P[a].x, dy = P[b].y - P[a].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 125) * 0.045;
      dx /= d; dy /= d;
      P[a].vx += dx * f; P[a].vy += dy * f;
      P[b].vx -= dx * f; P[b].vy -= dy * f;
    }
    for (let i = 0; i < N; i++) {
      P[i].vx += (W / 2 - P[i].x) * 0.0016;
      P[i].vy += (H / 2 - P[i].y) * 0.0022;
      P[i].x += P[i].vx * 0.52 * cool;
      P[i].y += P[i].vy * 0.52 * cool;
      P[i].vx *= 0.8; P[i].vy *= 0.8;
    }
  }

  /* LABEL DE-OVERLAP. The force pass positions circles; what a reader actually
     collides with is the text under them. Estimate each label's box from its
     character count and push overlapping pairs apart along their cheapest axis,
     with a weak spring back to the force solution so the shape of the graph
     survives. Deterministic, like everything above it. */
  const LW = (n) => n.label.length * 6.8 + 14;   // ~10px Inter, measured generously
  const LH = 19;
  const home = P.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < 240; pass++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const need = (LW(nodes[i]) + LW(nodes[j])) / 2 + 6;
        const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        const ox = need - Math.abs(dx), oy = LH - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;        // boxes already clear
        if (ox / need < oy / LH) {               // cheaper to separate sideways
          const push = (ox / 2) * (dx < 0 ? -1 : 1) * 0.6;
          P[i].x -= push; P[j].x += push;
        } else {
          const push = (oy / 2) * (dy < 0 ? -1 : 1) * 0.6;
          P[i].y -= push; P[j].y += push;
        }
      }
    }
    for (let i = 0; i < N; i++) {                // weak pull home keeps the shape
      P[i].x += (home[i].x - P[i].x) * 0.015;
      P[i].y += (home[i].y - P[i].y) * 0.015;
    }
  }

  // Fit whatever shape it settled into back inside the viewBox.
  const pad = 58;
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
  const ox = pad + ((W - 2 * pad) - (maxX - minX) * s) / 2;
  const oy = pad + ((H - 2 * pad) - (maxY - minY) * s) / 2;
  return nodes.map((n, i) => ({
    ...n,
    x: ox + (P[i].x - minX) * s,
    y: oy + (P[i].y - minY) * s,
  }));
}

/* Solved once when the module loads, not per render. The inputs are module
   constants, so there is nothing to recompute — and doing it here keeps the
   component down to plain useState, which matters: build.mjs and
   sync-standalone.py both match the React import line as an exact string and
   abort if a new hook has to be added to it. */
const ECO_W = 1460, ECO_H = 760;
const ECO_PLACED = ecoLayout(ECO_NODES, ECO_EDGES, ECO_W, ECO_H);
const ECO_BY_ID = new Map(ECO_PLACED.map((n) => [n.id, n]));
const ECO_COLOR = new Map(ECO_GROUPS.map((g) => [g.id, g.color]));
/* Who each node touches — powers the highlight and the detail line. */
const ECO_NEAR = (() => {
  const m = new Map(ECO_NODES.map((n) => [n.id, new Set()]));
  for (const [a, b] of ECO_EDGES) {
    if (m.has(a) && m.has(b)) { m.get(a).add(b); m.get(b).add(a); }
  }
  return m;
})();

function EcoGraph({ defaultOpen = false } = {}) {
  /* Hover and pin are SEPARATE. Collapsing them into one "selected" id looks
     tempting and is wrong: on a desktop the pointer is already inside the node
     when the click lands, so a single toggling id gets set by mouseenter and
     immediately cleared by the click — clicking would do nothing at all.
     Hover peeks, click pins, and a pin survives the pointer leaving. */
  const [hover, setHover] = useState(null);
  const [pin, setPin] = useState(null);
  const [only, setOnly] = useState(null);    // group id isolated via the legend

  const sel = pin || hover;
  const colorOf = (g) => ECO_COLOR.get(g) || "var(--brass)";
  const active = sel ? ECO_BY_ID.get(sel) : null;
  const near = sel ? ECO_NEAR.get(sel) : null;
  const dimmed = (n) => (only && n.g !== only) || (sel && n.id !== sel && !near.has(n.id));

  return (
    <details className="eco-rail panel reveal" style={{ animationDelay: "0.62s" }} open={defaultOpen || undefined}>
      <summary className="eco-head">
        <img src={`${ASSETS}/svg/ornaments/pipe-junction.svg`} alt="" width="12" height="12" aria-hidden="true" />
        <span className="font-mono-x text-[9px] tracking-[0.28em]" style={{ color: "var(--brass)" }}>THE WORKS</span>
        <span className="eco-count font-mono-x">{ECO_NODES.length} PARTS · {ECO_EDGES.length} LINKS</span>
      </summary>

      <div className="eco-legend">
        {ECO_GROUPS.map((g) => (
          <button
            key={g.id}
            className={`eco-key ${only === g.id ? "on" : ""}`}
            onClick={() => { setOnly(only === g.id ? null : g.id); setPin(null); setHover(null); }}
          >
            <span className="eco-dot" style={{ background: g.color }} />
            {g.label}
          </button>
        ))}
        {(only || sel) && (
          <button className="eco-key reset" onClick={() => { setOnly(null); setPin(null); setHover(null); }}>Reset</button>
        )}
      </div>

      <div className="eco-scroll">
        <svg className="eco-svg" viewBox={`0 0 ${ECO_W} ${ECO_H}`} role="img"
          aria-label="Map of Brady's sites, repos, services and sources of truth, and how they connect">
          <g>
            {ECO_EDGES.map(([a, b], i) => {
              const na = ECO_BY_ID.get(a), nb = ECO_BY_ID.get(b);
              if (!na || !nb) return null;
              const lit = sel && (a === sel || b === sel);
              const off = (only && na.g !== only && nb.g !== only) || (sel && !lit);
              return (
                <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  // Visible at rest (Brady, 2026-10-15): dark brass at 34% was invisible
                  // on near-black until a hover lit it, so the map read as loose dots.
                  stroke={lit ? colorOf(active.g) : "var(--ember-brass)"}
                  strokeWidth={lit ? 1.9 : 1.25}
                  opacity={off ? 0.1 : lit ? 0.95 : 0.6} />
              );
            })}
          </g>
          <g>
            {ECO_PLACED.map((n) => {
              const core = n.id === "ember";
              const r = core ? 17 : n.g === "business" ? 11 : 8;
              const off = dimmed(n);
              const c = colorOf(n.g);
              return (
                <g key={n.id} className="eco-node" opacity={off ? 0.2 : 1}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={() => setPin((q) => (q === n.id ? null : n.id))}
                  role="button" tabIndex={0}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover((h) => (h === n.id ? null : h))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPin((q) => (q === n.id ? null : n.id)); } }}>
                  {/* Named with SVG's own <title> rather than aria-label. The
                      dashboard smoke test reads any aria-label containing
                      "Voice" as a surviving voice control, and one of these
                      nodes is the Brand Voice doc — and <title> is the correct
                      SVG naming idiom regardless. */}
                  <title>{`${n.label} — ${n.note}`}</title>
                  {/* Invisible, finger-sized hit target. The painted circle is
                      about 11px across on a phone — too small to tap, and small
                      enough that the centre of this group's bounding box (which
                      includes the label beneath) lands OUTSIDE it, so a tap or a
                      synthetic click missed the node entirely. Verified on a
                      390px viewport before this was added. */}
                  <circle cx={n.x} cy={n.y} r={Math.max(r + 16, 26)} fill="transparent" />
                  {(core || n.id === sel) && (
                    <circle cx={n.x} cy={n.y} r={r + 9} fill={c} opacity={0.14} />
                  )}
                  <circle cx={n.x} cy={n.y} r={r} fill="#100D0A" stroke={c}
                    strokeWidth={n.id === sel ? 3 : core ? 2.5 : 1.6} />
                  {core && <circle cx={n.x} cy={n.y} r={r - 6} fill={c} opacity={0.85} />}
                  <text x={n.x} y={n.y + r + 13} textAnchor="middle"
                    className={core ? "eco-label core" : "eco-label"}
                    fill={n.id === sel ? "var(--ink)" : core ? c : "var(--ink-dim)"}>
                    {n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="eco-detail">
        {active ? (
          <>
            <span className="eco-detail-name" style={{ color: colorOf(active.g) }}>{active.label}</span>
            <span className="eco-detail-note">{active.note}</span>
            <span className="eco-detail-meta font-mono-x">
              {near.size} {near.size === 1 ? "LINK" : "LINKS"}
            </span>
            {pin === active.id && (
              <button className="eco-detail-open" onClick={() => setPin(null)}>pinned — tap to release</button>
            )}
            {active.url && (
              <a href={active.url} target="_blank" rel="noopener noreferrer" className="eco-detail-open">open ↗</a>
            )}
          </>
        ) : (
          <span className="eco-detail-note">
            Hover or tap any part to trace what it touches. Tap a colour to isolate that layer.
          </span>
        )}
      </div>
    </details>
  );
}

function Panel({ notch, title, count, countColor, children, delay, grow, scroll = true, codexCount, gauge, action }) {
  return (
    <div className={`panel reveal flex flex-col px-5 py-4 ${grow ? "flex-1" : ""}`} style={{ animationDelay: delay, minHeight: 0 }}>
      <span className={`notch ${notch}`} />
      <div className="mb-2.5 flex items-center justify-between">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--ink-dim)" }}>{title}</h3>
          {action}
        </span>
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

/* ================= MISSION CONTROL (ported from mission-control-draft) =================
   The terminal/Codex line built this view on a fork; the voice commits riding with it
   were superseded by the ear machine, but the view itself is the product Brady uses.
   Ported onto main so both AI lines finally build one codebase. */
const MC_KEY = "ember-mc";
const MC_CHANGED = "ember:mc-updated";
const MC_STATUSES = ["active", "blocked", "parked", "frozen"];
const mcUid = () => Math.random().toString(36).slice(2, 9);
const mcToday = () => { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } };
const mcNum = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };

function mcDefaults() {
  const d = mcToday();
  const dom = (() => { try { return new Date().getDate(); } catch (e) { return 15; } })();
  return {
    zap: { used: null, allowance: PROJECTS_META.zapierTasks.cap, dayOfCycle: dom, daysInCycle: 30 },
    projects: [
      { id: mcUid(), name: "Baxstar Ember", pct: 97, status: "active", revenue: false, sessions: 1, hours: 2, next: "Verify desktop dashboard and chat reliability; voice probe pending Mac verification", updated: d,
        links: [
          { id: mcUid(), label: "app", url: "https://ember.baxstarfishing.com" },
          { id: mcUid(), label: "repo", url: "https://github.com/baxstarcode/baxstar-ember" },
          { id: mcUid(), label: "cloudflare", url: "https://dash.cloudflare.com/?to=/:account/workers-and-pages" },
        ],
        tasks: [{ id: mcUid(), text: "Caption HEIC + Drive outbox", done: true }, { id: mcUid(), text: "Mission Control view", done: false }] },
      { id: mcUid(), name: "Pontoon check-in", pct: 85, status: "active", revenue: true, sessions: 1, hours: 2, next: "Close multi-tab queue TOCTOU", updated: d,
        links: [], tasks: [{ id: mcUid(), text: "Sync-truth v8 live", done: true }] },
      { id: mcUid(), name: "Caption Studio (Ember)", pct: 70, status: "active", revenue: true, sessions: 2, hours: 4, next: "Verify protected Drive outbox gateway", updated: d,
        links: [{ id: mcUid(), label: "studio", url: "https://ember.baxstarfishing.com" }], tasks: [] },
      { id: mcUid(), name: "Open-water page", pct: 90, status: "blocked", revenue: true, sessions: 1, hours: 1, next: "Brady re-paste + publish in Wix", updated: d,
        links: [{ id: mcUid(), label: "wix editor", url: "https://manage.wix.com/" }], tasks: [] },
    ],
    decisions: [
      { id: mcUid(), text: "Turn the Caption → IG Zap ON (throwaway test first)", done: false },
      { id: mcUid(), text: "Verify the protected Drive-outbox gateway", done: false },
      { id: mcUid(), text: "Verify dashboard data and connector status", done: false },
    ],
  };
}

function mcSaveTaskDraft(draft) {
  let record;
  try {
    const raw = window.localStorage.getItem(MC_KEY);
    record = raw === null ? mcDefaults() : JSON.parse(raw);
  } catch {
    throw new Error("Cannot read saved Mission Control data. Nothing was overwritten; your task draft is still here.");
  }
  if (!record || typeof record !== "object" || !Array.isArray(record.projects)) {
    throw new Error("Saved Mission Control data is unreadable. Nothing was overwritten; your task draft is still here.");
  }
  const projects = [...record.projects];
  let index = projects.findIndex((p) => typeof p?.name === "string" && p.name.trim().toLowerCase() === "baxstar ember");
  if (index < 0) {
    index = projects.length;
    projects.push({ ...mcDefaults().projects[0], tasks: [] });
  }
  const project = projects[index];
  if (project.tasks != null && !Array.isArray(project.tasks)) throw new Error("The Baxstar Ember task list is unreadable. Nothing was overwritten.");
  const tasks = project.tasks || [];
  // A draft carries one ID through review and save, making double clicks harmless.
  if (tasks.some((task) => task.id === draft.id)) return;
  projects[index] = {
    ...project, updated: mcToday(),
    tasks: [...tasks, { id: draft.id, text: draft.title.trim(), done: false, due: draft.due.trim(), details: draft.details.trim(), source: draft.source, localOnly: true }],
  };
  const next = { ...record, projects };
  if (!lsSet(MC_KEY, next)) throw new Error("Could not save locally. Check this browser's storage; your task draft is still here.");
  window.dispatchEvent(new CustomEvent(MC_CHANGED));
}

function MissionControl() {
  const [init] = useState(() => (typeof window !== "undefined" && lsGet(MC_KEY, null)) || mcDefaults());
  const [zap, setZap] = useState(init.zap || mcDefaults().zap);
  const [projects, setProjects] = useState(init.projects || []);
  const [decisions, setDecisions] = useState(init.decisions || []);
  const [openRows, setOpenRows] = useState({});
  useEffect(() => { lsSet(MC_KEY, { ...lsGet(MC_KEY, {}), zap, projects, decisions }); }, [zap, projects, decisions]);
  useEffect(() => {
    const refresh = (event) => {
      if (event.type === "storage" && event.key !== MC_KEY) return;
      const saved = lsGet(MC_KEY, null);
      if (!saved || !Array.isArray(saved.projects)) return;
      setProjects(saved.projects);
      setZap(saved.zap || mcDefaults().zap);
      setDecisions(Array.isArray(saved.decisions) ? saved.decisions : []);
    };
    window.addEventListener(MC_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(MC_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  // --- Zapier meter math ---
  const used = mcNum(zap.used), allowance = mcNum(zap.allowance);
  const hasUsage = zap.used != null && String(zap.used).trim() !== "" && Number.isFinite(Number(zap.used));
  const dayOfCycle = mcNum(zap.dayOfCycle), daysInCycle = mcNum(zap.daysInCycle);
  const pctUsed = allowance > 0 ? (used / allowance) * 100 : 0;
  const callsLeft = Math.max(0, Math.floor((allowance - used) / 2));
  const dailyBurn = dayOfCycle > 0 ? used / dayOfCycle : 0;
  const projection = Math.round(dailyBurn * daysInCycle);
  const pacingOver = allowance > 0 && projection > allowance;
  const projMark = allowance > 0 ? Math.max(0, Math.min(100, (projection / allowance) * 100)) : 0;

  // --- rollups ---
  const totalHours = projects.reduce((s, p) => s + mcNum(p.hours), 0);
  const totalSessions = projects.reduce((s, p) => s + mcNum(p.sessions), 0);
  const avgPct = projects.length ? Math.round(projects.reduce((s, p) => s + mcNum(p.pct), 0) / projects.length) : 0;
  const revHours = projects.filter((p) => p.revenue).reduce((s, p) => s + mcNum(p.hours), 0);
  const revEffortPct = totalHours > 0 ? Math.round((revHours / totalHours) * 100) : 0;

  // --- mutators ---
  const setZapField = (k, v) => setZap((z) => ({ ...z, [k]: v }));
  const updProject = (id, patch) => setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch, updated: mcToday() } : p)));
  const cycleStatus = (id) => setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, status: MC_STATUSES[(MC_STATUSES.indexOf(p.status) + 1) % MC_STATUSES.length], updated: mcToday() } : p)));
  // Older saved data predates links, so always read through a default.
  const linksOf = (p) => (Array.isArray(p.links) ? p.links : []);
  const addLink = (pid) =>
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, links: [...linksOf(p), { id: mcUid(), label: "", url: "" }] } : p)));
  const updLink = (pid, lid, patch) =>
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, links: linksOf(p).map((l) => (l.id === lid ? { ...l, ...patch } : l)) } : p)));
  const delLink = (pid, lid) =>
    setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, links: linksOf(p).filter((l) => l.id !== lid) } : p)));

  // Reopen every tab a project needs. The first window.open rides the click's
  // user gesture; the rest are staggered because browsers block a burst of them
  // from a single gesture and would silently drop all but the first.
  const resumeProject = (p) => {
    const urls = linksOf(p).map((l) => (l.url || "").trim()).filter(Boolean);
    if (!urls.length) return;
    urls.forEach((u, i) => {
      const href = /^https?:\/\//i.test(u) ? u : "https://" + u;
      if (i === 0) window.open(href, "_blank", "noopener");
      else setTimeout(() => window.open(href, "_blank", "noopener"), i * 250);
    });
  };

  const addProject = () => setProjects((ps) => [...ps, { id: mcUid(), name: "New project", pct: 0, status: "active", revenue: false, sessions: 1, hours: 1, next: "", updated: mcToday(), links: [], tasks: [] }]);
  const delProject = (id) => setProjects((ps) => ps.filter((p) => p.id !== id));
  const addTask = (pid) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, tasks: [...p.tasks, { id: mcUid(), text: "New task", done: false }] } : p)));
  const updTask = (pid, tid, patch) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, tasks: p.tasks.map((t) => (t.id === tid ? { ...t, ...patch } : t)) } : p)));
  const delTask = (pid, tid) => setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, tasks: p.tasks.filter((t) => t.id !== tid) } : p)));
  const addDecision = () => setDecisions((d) => [...d, { id: mcUid(), text: "New decision", done: false }]);
  const updDecision = (id, patch) => setDecisions((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const delDecision = (id) => setDecisions((d) => d.filter((x) => x.id !== id));

  const statusClass = (s) => ({ active: "mc-st-active", blocked: "mc-st-blocked", parked: "mc-st-parked", frozen: "mc-st-frozen" }[s] || "mc-st-active");

  return (
    <div className="mc-grid flex-1" style={{ minHeight: 0 }}>
      {/* LEFT — meter + projects */}
      <div className="mc-stack" style={{ minHeight: 0 }}>
        <Panel notch="cool" title="Zapier Task Meter" count={!hasUsage ? "NOT RECORDED" : pacingOver ? "PACING OVER" : "ON PACE"}
          countColor={!hasUsage ? "var(--brass)" : pacingOver ? "var(--ember-red)" : "#54e08a"} delay="0.05s" scroll={false}>
          <div className="grid grid-cols-4 gap-2">
            {[["used", "Used"], ["allowance", "Allowance"], ["dayOfCycle", "Day of cycle"], ["daysInCycle", "Days in cycle"]].map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="fieldlabel">{label}</span>
                <input type="number" className="mc-input mc-num" style={{ width: "100%", textAlign: "left" }}
                  value={zap[k] ?? ""} placeholder={k === "used" ? "Not recorded" : undefined} onChange={(e) => setZapField(k, e.target.value)} />
              </label>
            ))}
          </div>
          <div className="mc-meter mt-3">
            <div className={`mc-meter-fill ${pacingOver ? "warn" : ""}`} style={{ width: `${Math.max(0, Math.min(100, pctUsed))}%` }} />
            {hasUsage && <div className="mc-meter-mark" title="projected cycle end" style={{ left: `${projMark}%` }} />}
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            <div className="mc-metric"><span className="k">% Used</span><span className={`v ${pctUsed >= 100 ? "warn" : ""}`}>{hasUsage ? `${Math.round(pctUsed)}%` : "—"}</span></div>
            <div className="mc-metric"><span className="k">Calls left ÷2</span><span className="v">{hasUsage ? callsLeft : "—"}</span></div>
            <div className="mc-metric"><span className="k">Daily burn</span><span className="v">{hasUsage ? dailyBurn.toFixed(1) : "—"}</span></div>
            <div className="mc-metric"><span className="k">Proj. end</span><span className={`v ${hasUsage ? pacingOver ? "warn" : "ok" : ""}`}>{hasUsage ? projection : "—"}</span></div>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink-dim)" }}>Entered on this device · check Zapier for current usage.</p>
        </Panel>

        <Panel notch="hot" title="Projects" count={`${projects.length} TRACKED`} countColor="var(--brass)" delay="0.12s" grow>
          <div className="flex flex-col gap-2.5">
            {projects.map((p) => {
              const pct = Math.max(0, Math.min(100, mcNum(p.pct)));
              return (
                <div key={p.id} className={`mc-row ${p.status}`}>
                  <div className="mc-project-head flex items-center gap-2">
                    <input className="mc-input flex-1" value={p.name} onChange={(e) => updProject(p.id, { name: e.target.value })} />
                    {/* The name stays editable, so the link lives beside it -- one tap
                        reopens every page this project needs to pick back up. */}
                    <button className="mc-status mc-resume" onClick={() => resumeProject(p)}
                      disabled={!linksOf(p).some((l) => (l.url || "").trim())}
                      title={linksOf(p).filter((l) => l.url).map((l) => l.label || l.url).join(" · ") || "add pages below"}>
                      ↗ resume{linksOf(p).filter((l) => (l.url || "").trim()).length > 1 ? ` (${linksOf(p).filter((l) => (l.url || "").trim()).length})` : ""}
                    </button>
                    <button className={`mc-status ${statusClass(p.status)}`} onClick={() => cycleStatus(p.id)} title="cycle status">{p.status}</button>
                    <button className={`mc-status ${p.revenue ? "mc-tag-rev" : "mc-tag-norev"}`} onClick={() => updProject(p.id, { revenue: !p.revenue })} title="revenue impact">
                      {p.revenue ? "$ revenue" : "no revenue"}
                    </button>
                    <button className="mc-x" onClick={() => delProject(p.id)} title="remove">×</button>
                  </div>
                  <div className="mc-fuse-wrap mt-2">
                    <div className="mc-fuse-burnt" style={{ width: `${pct}%` }} />
                    <div className="mc-fuse-live" style={{ left: `${pct}%`, width: `${100 - pct}%` }} />
                    {pct > 0 && pct < 100 && <div className="mc-fuse-spark" style={{ left: `${pct}%` }} />}
                  </div>
                  <div className="mc-project-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>
                    <label className="flex items-center gap-1">%<input type="number" className="mc-input mc-num" style={{ width: 54 }} value={p.pct} onChange={(e) => updProject(p.id, { pct: e.target.value })} /></label>
                    <label className="flex items-center gap-1">sessions<input type="number" className="mc-input mc-num" style={{ width: 48 }} value={p.sessions} onChange={(e) => updProject(p.id, { sessions: e.target.value })} /></label>
                    <label className="flex items-center gap-1">hours<input type="number" className="mc-input mc-num" style={{ width: 48 }} value={p.hours} onChange={(e) => updProject(p.id, { hours: e.target.value })} /></label>
                    <button className="mc-mini ml-auto" onClick={() => setOpenRows((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                      {openRows[p.id] ? "hide tasks" : `tasks (${p.tasks.length})`}
                    </button>
                  </div>
                  <div className="mc-next-row mt-2 flex items-center gap-1.5">
                    <span className="fieldlabel" style={{ whiteSpace: "nowrap" }}>Next</span>
                    <input className="mc-input flex-1" placeholder="next action" value={p.next} onChange={(e) => updProject(p.id, { next: e.target.value })} />
                  </div>
                  {/* Individual pages: click a chip for just that one, or edit them. */}
                  <div className="mc-links mt-2 flex flex-wrap items-center gap-1.5">
                    {linksOf(p).map((l) => (
                      <span key={l.id} className="mc-linkchip">
                        {(l.url || "").trim() ? (
                          <a href={/^https?:\/\//i.test(l.url.trim()) ? l.url.trim() : "https://" + l.url.trim()}
                            target="_blank" rel="noopener noreferrer" title={l.url}>
                            {l.label || l.url}
                          </a>
                        ) : (
                          <span style={{ color: "var(--ink-faint)" }}>{l.label || "untitled"}</span>
                        )}
                        <input className="mc-input mc-linkin" placeholder="label" value={l.label}
                          onChange={(e) => updLink(p.id, l.id, { label: e.target.value })} />
                        <input className="mc-input mc-linkin mc-linkurl" placeholder="paste the tab URL" value={l.url}
                          onChange={(e) => updLink(p.id, l.id, { url: e.target.value })} />
                        <button className="mc-x" onClick={() => delLink(p.id, l.id)} title="remove page">×</button>
                      </span>
                    ))}
                    <button className="mc-mini" onClick={() => addLink(p.id)}>+ page</button>
                  </div>
                  {openRows[p.id] && (
                    <div className="mt-2 rounded-lg p-2" style={{ background: "#0e0c0b", border: "1px solid var(--ember-panel-line)" }}>
                      {p.tasks.map((t) => (
                        <div key={t.id} data-task-id={t.id}>
                          <div className={`mc-check ${t.done ? "done" : ""}`}>
                            <input type="checkbox" aria-label={`Complete ${t.text}`} checked={t.done} onChange={(e) => updTask(p.id, t.id, { done: e.target.checked })} />
                            <input aria-label="Task name" className="mc-input flex-1" style={{ background: "transparent", border: "none" }} value={t.text} onChange={(e) => updTask(p.id, t.id, { text: e.target.value })} />
                            <button className="mc-x" aria-label={`Remove ${t.text}`} onClick={() => delTask(p.id, t.id)}>×</button>
                          </div>
                          {(t.localOnly || t.due || t.details || t.source) && <div className="mb-2 pl-6 text-[11px] whitespace-pre-wrap" style={{ color: "var(--ink-dim)" }}>
                            {t.localOnly && <div>Local task · not sent to Quo</div>}
                            {t.due && <div>Due: {t.due}</div>}
                            {t.details && <div>{t.details}</div>}
                            {t.source && <div>Source: {t.source}</div>}
                          </div>}
                        </div>
                      ))}
                      <button className="mc-mini mt-1" onClick={() => addTask(p.id)}>+ task</button>
                    </div>
                  )}
                </div>
              );
            })}
            <button className="mc-mini" style={{ alignSelf: "flex-start" }} onClick={addProject}>+ project</button>
          </div>
        </Panel>
      </div>

      {/* RIGHT — rollups + decisions */}
      <div className="mc-stack" style={{ minHeight: 0 }}>
        <Panel notch="warm" title="Rollups" count="LOCAL ESTIMATES" countColor="var(--ember-orange)" delay="0.08s" scroll={false}>
          <div className="grid grid-cols-2 gap-2">
            <div className="mc-metric"><span className="k">Total hours left</span><span className="v">{totalHours}</span></div>
            <div className="mc-metric"><span className="k">Total sessions</span><span className="v">{totalSessions}</span></div>
            <div className="mc-metric"><span className="k">Avg complete</span><span className="v">{avgPct}%</span></div>
            <div className="mc-metric"><span className="k">Effort on revenue</span><span className={`v ${revEffortPct < 50 ? "warn" : "ok"}`}>{revEffortPct}%</span></div>
          </div>
          <div className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--ink-faint)" }}>
            {revEffortPct < 50
              ? "Under half of remaining effort is on revenue projects — worth a rebalance."
              : "Most remaining effort is pointed at revenue. Good."}
          </div>
        </Panel>

        <Panel notch="cool" title="Decision Queue" count={`${decisions.filter((d) => !d.done).length} OPEN`} countColor="var(--brass)" delay="0.16s" grow>
          <div className="flex flex-col gap-1">
            {decisions.map((d) => (
              <div key={d.id} className={`mc-check ${d.done ? "done" : ""}`}>
                <input type="checkbox" checked={d.done} onChange={(e) => updDecision(d.id, { done: e.target.checked })} />
                <input className="mc-input flex-1" style={{ background: "transparent", border: "none" }} value={d.text} onChange={(e) => updDecision(d.id, { text: e.target.value })} />
                <button className="mc-x" onClick={() => delDecision(d.id)}>×</button>
              </div>
            ))}
            <button className="mc-mini mt-1" style={{ alignSelf: "flex-start" }} onClick={addDecision}>+ decision</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
