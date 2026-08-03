/**
 * Outbox tests — run with: node apps-script/outbox/outbox.test.mjs
 *
 * No deps, no network, no Drive. Code.gs is plain ES5 that talks to three Apps Script
 * globals (DriveApp, Utilities, ContentService), so the file is read and evaluated here
 * with all three stubbed. That exercises the real doPost — the same source that gets
 * pasted into script.google.com — instead of a paraphrase of it.
 *
 * The point is the CONTRACT: what lands in Drive, and what a Zap reading the file
 * description would actually see. Those are the two things a deploy can't be rolled back
 * from cheaply, and the two things nobody can eyeball in the Apps Script editor.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "Code.gs");

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail || ""]);

/* A Drive stand-in that records everything written to it. */
function makeDrive() {
  const folders = new Map();
  const made = [];
  const mkFolder = (name) => {
    const files = [];
    const folder = {
      getName: () => name,
      createFile(a, b, c) {
        // createFile(blob) | createFile(name, content, mime)
        const file = typeof a === "object"
          ? { name: a.name, bytes: a.bytes, mime: a.mime, description: "" }
          : { name: a, content: b, mime: c, description: "" };
        file.getName = () => file.name;
        file.setDescription = (d) => { file.description = d; return file; };
        files.push(file);
        made.push(file);
        return file;
      },
      files,
    };
    folders.set(name, folder);
    return folder;
  };
  return {
    made,
    folders,
    DriveApp: {
      getFolderById: (id) => folders.get(id) || mkFolder(id),
      getFoldersByName(name) {
        const hit = folders.get(name);
        let served = false;
        return { hasNext: () => !!hit && !served, next: () => { served = true; return hit; } };
      },
      createFolder: mkFolder,
    },
  };
}

/* Load Code.gs into a fresh scope with the Apps Script globals stubbed. */
function loadOutbox() {
  const drive = makeDrive();
  const scope = {
    DriveApp: drive.DriveApp,
    Utilities: {
      base64Decode: (s) => Buffer.from(String(s), "base64"),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent: () => text }),
    },
  };
  const src = fs.readFileSync(SRC, "utf8");
  const keys = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...keys, `${src}\n; return { doPost: doPost, doGet: doGet };`);
  const api = factory(...keys.map((k) => scope[k]));
  return { ...api, drive };
}

const post = (api, payload) =>
  JSON.parse(api.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());

const B64 = Buffer.from("fake-jpeg-bytes").toString("base64");

const basePayload = (extra = {}) => ({
  source: "ember-caption-studio",
  caption: "Solid morning on the water.\n\n#getyourbassingear",
  captionWithHandles: "Solid morning on the water.\n\n#getyourbassingear\n@therealvexusboats",
  lockedTag: "#getyourbassingear",
  hashtagCount: 5,
  mimeType: "image/jpeg",
  species: "Smallmouth Bass",
  lake: "Detroit Lake",
  postWindow: "4 PM CT",
  postAt: "2026-08-03T21:00:00.000Z",
  postTimeLocal: "16:00",
  sponsors: ["@therealvexusboats", "@mercurymarine"],
  clientTime: "2026-08-01T14:09:00.000Z",
  ...extra,
});

// --- single image ---------------------------------------------------------

{
  const api = loadOutbox();
  const res = post(api, basePayload({ imageBase64: B64 }));
  check("single image: ok", res.ok === true, JSON.stringify(res));
  check("single image: one jpg + one txt written", api.drive.made.length === 2,
    api.drive.made.map((f) => f.name).join(", "));
  check("single image: no slide suffix on a one-slide post",
    /^\d{4}-\d{2}-\d{2}_\d{4}_smallmouth-bass\.jpg$/.test(res.images[0]), res.images[0]);
  check("single image: slideCount is 1", res.slideCount === 1);
}

// --- carousel -------------------------------------------------------------

{
  const api = loadOutbox();
  const res = post(api, basePayload({ images: [B64, B64, B64] }));
  const jpgs = api.drive.made.filter((f) => /\.jpg$/.test(f.name));
  check("carousel: ok with 3 slides", res.ok === true && res.slideCount === 3, JSON.stringify(res));
  check("carousel: three jpgs written", jpgs.length === 3, jpgs.map((f) => f.name).join(", "));
  check("carousel: names are zero-padded and ordered",
    jpgs.every((f, i) => f.name.endsWith(`_0${i + 1}.jpg`)), jpgs.map((f) => f.name).join(", "));
  check("carousel: exactly one txt sidecar for the whole post",
    api.drive.made.filter((f) => /\.txt$/.test(f.name)).length === 1);
  check("carousel: every slide shares one postId",
    jpgs.every((f) => JSON.parse(f.description).postId === res.postId));
  check("carousel: slide numbers are 1..n in order",
    jpgs.every((f, i) => JSON.parse(f.description).slide === i + 1));
}

// --- the metadata the Zap actually reads ----------------------------------

{
  const api = loadOutbox();
  const res = post(api, basePayload({ images: [B64, B64] }));
  const first = api.drive.made.find((f) => /\.jpg$/.test(f.name));
  const meta = JSON.parse(first.description);
  check("metadata: description is valid JSON", !!meta && typeof meta === "object");
  check("metadata: caption carries NO @handles (they ride as on-photo tags)",
    !/@/.test(meta.caption), meta.caption);
  check("metadata: captionWithHandles keeps them for manual/GBP use",
    /@therealvexusboats/.test(meta.captionWithHandles));
  check("metadata: sponsors survive as the Tagged Users list",
    meta.sponsors.length === 2 && meta.sponsors[0] === "@therealvexusboats");
  check("metadata: lake is a plain NAME, not a location ID",
    meta.lake === "Detroit Lake" && !/^\d+$/.test(meta.lake));
  check("metadata: slideCount present so a Zap can order the set", meta.slideCount === 2);
  check("metadata: postWindow present as the human label", meta.postWindow === "4 PM CT");
  check("metadata: postAt carries the ISO instant Delay-Until reads",
    meta.postAt === "2026-08-03T21:00:00.000Z", meta.postAt);
  check("sidecar names every image it wrote",
    res.images.every((n) => api.drive.made.find((f) => /\.txt$/.test(f.name)).content.includes(n)));
}

// --- images[] wins over the compatibility field ---------------------------

{
  const api = loadOutbox();
  const other = Buffer.from("second-photo").toString("base64");
  const res = post(api, basePayload({ images: [B64, other], imageBase64: B64 }));
  check("images[] wins over imageBase64 (no duplicated slide one)", res.slideCount === 2, JSON.stringify(res));
}

// --- rejections -----------------------------------------------------------

{
  const api = loadOutbox();
  const res = post(api, basePayload());
  check("no image at all is rejected", res.ok === false && /missing/.test(res.error), JSON.stringify(res));
  check("nothing was written on rejection", api.drive.made.length === 0);
}

{
  const api = loadOutbox();
  const res = post(api, basePayload({ images: [B64, null, "", B64] }));
  check("empty entries in images[] are dropped, not written as 0-byte files",
    res.ok === true && res.slideCount === 2, JSON.stringify(res));
}

{
  const api = loadOutbox();
  const res = post(api, basePayload({ images: new Array(7).fill(B64) }));
  check("more than 6 slides is refused", res.ok === false && /too many/.test(res.error), JSON.stringify(res));
  check("an over-limit post writes nothing", api.drive.made.length === 0);
}

{
  const api = loadOutbox();
  const res = JSON.parse(api.doPost({ postData: { contents: "not json" } }).getContent());
  check("a malformed body returns an error instead of throwing", res.ok === false);
}

// --- health check ---------------------------------------------------------

{
  const api = loadOutbox();
  const res = JSON.parse(api.doGet().getContent());
  check("doGet reports the service and its slide ceiling",
    res.ok === true && res.service === "baxstar-ember-outbox" && res.maxSlides === 6, JSON.stringify(res));
}

// --- report ---------------------------------------------------------------

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
