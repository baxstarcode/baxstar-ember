/**
 * Baxstar Ember — Caption Studio "Publish" outbox (Google Apps Script Web App)
 * =============================================================================
 * Receives finished JPEG(s) + caption from Ember's Caption Studio and drops them into a
 * PRIVATE Google Drive folder for Brady to review and post. It does NOT post to Instagram,
 * Facebook, or anywhere else — it is a staging outbox, nothing more.
 *
 * SCAFFOLD ONLY — this is not deployed. See README-DEPLOY.md for the exact steps.
 *
 * WHY DRIVE AND NOT AN IMAGE CDN
 * A browser photo can't be handed to Meta directly — Meta needs a URL it can fetch, and it
 * will not take a blob. The 2026-07-07 session proved that a FULLY PRIVATE Drive file is
 * enough: Zapier's "Find a File" returns a file object that drops straight into Instagram
 * "Publish Photo(s)" as the media value, and Zapier re-hosts the bytes for Meta itself. So
 * no Cloudinary, no public bucket, no extra key — the private folder IS the host.
 *
 * HOW THE CAPTION TRAVELS WITH THE PHOTO
 * Each image file's Drive DESCRIPTION carries the whole post as JSON. That's the carrier
 * the Zap reads, and it's deliberately per-file so a Zap triggered by "new file in folder"
 * has everything it needs from the trigger alone, with no second lookup. The .txt sidecar
 * next to it is for a human reading the folder, not for the Zap.
 *
 * Contract (what Ember sends): a JSON body, POSTed as text/plain (Apps Script web apps
 * mishandle CORS preflight, so Ember avoids it by sending a "simple" request):
 *   {
 *     "source":      "ember-caption-studio",
 *     "caption":     "post text WITHOUT @handles — handles ride as on-photo tags",
 *     "captionWithHandles": "same text WITH the @handles appended (manual/GBP use)",
 *     "lockedTag":   "#getyourbassingear",
 *     "hashtagCount": 5,
 *     "images":      ["<base64 JPEG>", "..."],   // carousel order, slide 1 first
 *     "imageBase64": "<base64 JPEG>",            // slide 1 again, for older deploys
 *     "mimeType":    "image/jpeg",
 *     "species":     "Smallmouth Bass",
 *     "lake":        "Detroit Lake",             // a NAME, never a location ID
 *     "postWindow":  "4 PM CT",
 *     "sponsors":    ["@therealvexusboats"],     // becomes Instagram Tagged User(s)
 *     "clientTime":  "2026-08-01T09:14:00.000Z"
 *   }
 *
 * Response: {"ok":true, "folder":"...", "images":[...], "caption":"..."} on success,
 *           {"ok":false, "error":"..."} on failure.
 *
 * LOCATION WARNING (learned the hard way, 2026-07-07): send the lake NAME as a plain
 * string or leave location empty. The first live publish failed because Zapier auto-guessed
 * a location ID and Meta hard-rejected it with "Location ID invalid".
 */

// ── CONFIG ───────────────────────────────────────────────────────────────────
// Paste the ID of the private Drive folder to write into (the long string in the
// folder's URL: drive.google.com/drive/folders/<THIS>). Leave "" to auto-create/use a
// folder literally named "Baxstar Ember Outbox" in My Drive.
var OUTBOX_FOLDER_ID = "";
var OUTBOX_FOLDER_NAME = "Baxstar Ember Outbox";

// Optional shared secret. If set, Ember must send the same value as ?token= on the URL
// or as payload.token. Leave "" to disable (the /exec URL is already unguessable).
var SHARED_TOKEN = "";

// Instagram's own ceiling. More slides than this can't post as one carousel anyway.
var MAX_SLIDES = 6;
// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (SHARED_TOKEN) {
      var provided = (e && e.parameter && e.parameter.token) || payload.token || "";
      if (provided !== SHARED_TOKEN) {
        return _json({ ok: false, error: "unauthorized" });
      }
    }

    // Accept the carousel form or the single-image form. `images` wins when both are
    // present, because Ember repeats slide one as imageBase64 for older deploys.
    var shots = _shots(payload);
    if (!shots.length) return _json({ ok: false, error: "missing imageBase64" });
    if (shots.length > MAX_SLIDES) {
      return _json({ ok: false, error: "too many slides (max " + MAX_SLIDES + ")" });
    }

    var folder = _resolveFolder();
    var stamp = _stamp(payload.clientTime);
    var slug = _slug(payload.species || "catch");
    var baseName = stamp + "_" + slug;
    var mime = payload.mimeType || "image/jpeg";

    // The metadata block stamped onto every slide. `slide`/`slideCount` let a Zap tell a
    // cover from the rest, and post the set in the right order.
    var meta = {
      source: payload.source || "ember-caption-studio",
      caption: payload.caption || "",
      captionWithHandles: payload.captionWithHandles || payload.caption || "",
      lockedTag: payload.lockedTag || "",
      hashtagCount: payload.hashtagCount || null,
      species: payload.species || "",
      lake: payload.lake || "",          // NAME only — never a location ID
      postWindow: payload.postWindow || "",
      sponsors: payload.sponsors || [],  // → Instagram Tagged User(s)
      clientTime: payload.clientTime || "",
      postId: baseName,                  // ties every slide of one post together
      slideCount: shots.length
    };

    var written = [];
    for (var i = 0; i < shots.length; i++) {
      var name = baseName + (shots.length > 1 ? "_" + _pad(i + 1) : "") + ".jpg";
      var blob = Utilities.newBlob(Utilities.base64Decode(shots[i]), mime, name);
      var file = folder.createFile(blob);

      var perSlide = _assign({}, meta);
      perSlide.slide = i + 1;
      // The Zap's payload carrier. JSON so it parses cleanly on the other side.
      file.setDescription(JSON.stringify(perSlide));

      written.push(file.getName());
    }

    // Human-readable sidecar — one per post, not per slide.
    var sidecar =
      (payload.captionWithHandles || payload.caption || "") + "\n\n" +
      "— — — — — — — — — —\n" +
      "species:  " + (payload.species || "") + "\n" +
      "lake:     " + (payload.lake || "") + "\n" +
      "window:   " + (payload.postWindow || "") + "\n" +
      "sponsors: " + ((payload.sponsors || []).join(", ")) + "\n" +
      "slides:   " + shots.length + "\n" +
      "sent:     " + (payload.clientTime || "") + "\n" +
      "images:   " + written.join(", ") + "\n";
    var captionFile = folder.createFile(baseName + ".txt", sidecar, "text/plain");

    return _json({
      ok: true,
      folder: folder.getName(),
      postId: baseName,
      images: written,
      slideCount: written.length,
      caption: captionFile.getName()
    });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// Health check — open the /exec URL in a browser to confirm the deploy is live.
function doGet() {
  return _json({ ok: true, service: "baxstar-ember-outbox", ready: true, maxSlides: MAX_SLIDES });
}

/* Pull the slides out of either payload shape, dropping empties so a trailing null in
   `images` can't create a zero-byte file in Drive. */
function _shots(payload) {
  var list = [];
  if (payload.images && payload.images.length) {
    for (var i = 0; i < payload.images.length; i++) {
      if (payload.images[i]) list.push(payload.images[i]);
    }
  } else if (payload.imageBase64) {
    list.push(payload.imageBase64);
  }
  return list;
}

function _resolveFolder() {
  if (OUTBOX_FOLDER_ID) return DriveApp.getFolderById(OUTBOX_FOLDER_ID);
  var it = DriveApp.getFoldersByName(OUTBOX_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(OUTBOX_FOLDER_NAME);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "catch";
}

function _pad(n) { return (n < 10 ? "0" : "") + n; }

// Object.assign isn't available in the Apps Script runtime's older modes.
function _assign(target, src) {
  for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
  return target;
}

// yyyy-mm-dd_hhmm from the client timestamp (falls back to the script's clock).
function _stamp(iso) {
  var d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return d.getFullYear() + "-" + _pad(d.getMonth() + 1) + "-" + _pad(d.getDate()) + "_" + _pad(d.getHours()) + _pad(d.getMinutes());
}
