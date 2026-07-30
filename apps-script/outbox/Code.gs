/**
 * Baxstar Ember — Caption Studio "Publish" outbox (Google Apps Script Web App)
 * =============================================================================
 * Receives a finished JPEG + caption from Ember's Caption Studio and drops the pair
 * into a PRIVATE Google Drive folder for Brady to review and post. It does NOT post to
 * Instagram, Facebook, or anywhere else — it is a staging outbox, nothing more.
 *
 * SCAFFOLD ONLY — this is not deployed. See README-DEPLOY.md for the exact steps.
 *
 * Contract (what Ember sends): a JSON body, POSTed as text/plain (Apps Script web apps
 * mishandle CORS preflight, so Ember avoids it by sending a "simple" request):
 *   {
 *     "source":     "ember-caption-studio",
 *     "caption":    "full caption text incl. the locked #getyourbassingear",
 *     "lockedTag":  "#getyourbassingear",
 *     "imageBase64":"<base64 JPEG, no data: prefix>",
 *     "mimeType":   "image/jpeg",
 *     "species":    "Smallmouth Bass",
 *     "lake":       "Detroit Lake",
 *     "postWindow": "4 PM CT",
 *     "sponsors":   ["@vexusboats"],
 *     "clientTime": "2026-07-30T09:14:00.000Z"
 *   }
 *
 * Response: {"ok": true, "folder": "...", "image": "...", "caption": "..."} on success,
 *           {"ok": false, "error": "..."} on failure.
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

    if (!payload.imageBase64) return _json({ ok: false, error: "missing imageBase64" });

    var folder = _resolveFolder();
    var stamp = _stamp(payload.clientTime);
    var slug = _slug(payload.species || "catch");
    var baseName = stamp + "_" + slug;

    // 1) the image
    var bytes = Utilities.base64Decode(payload.imageBase64);
    var blob = Utilities.newBlob(bytes, payload.mimeType || "image/jpeg", baseName + ".jpg");
    var imageFile = folder.createFile(blob);

    // 2) the caption + metadata sidecar
    var meta =
      (payload.caption || "") + "\n\n" +
      "— — — — — — — — — —\n" +
      "species:  " + (payload.species || "") + "\n" +
      "lake:     " + (payload.lake || "") + "\n" +
      "window:   " + (payload.postWindow || "") + "\n" +
      "sponsors: " + ((payload.sponsors || []).join(", ")) + "\n" +
      "sent:     " + (payload.clientTime || "") + "\n" +
      "image:    " + imageFile.getName() + "\n";
    var captionFile = folder.createFile(baseName + ".txt", meta, "text/plain");

    return _json({
      ok: true,
      folder: folder.getName(),
      image: imageFile.getName(),
      caption: captionFile.getName()
    });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// Health check — open the /exec URL in a browser to confirm the deploy is live.
function doGet() {
  return _json({ ok: true, service: "baxstar-ember-outbox", ready: true });
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

// yyyy-mm-dd_hhmm from the client timestamp (falls back to the script's clock).
function _stamp(iso) {
  var d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes());
}
