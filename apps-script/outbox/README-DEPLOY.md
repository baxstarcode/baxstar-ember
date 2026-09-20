# Caption Studio → Drive Outbox — deploy steps

`Code.gs` is the maintained source for Ember's Drive-outbox Apps Script. A live
deployment exists. Treat its `/exec` URL as a write capability: it belongs only in the
Cloudflare Worker secret `OUTBOX_URL`, never in client source, browser storage, docs,
screenshots, or command history.

## What it does
Ember's Caption Studio sends the finished JPEG(s) and caption to same-origin
`/api/outbox`. The Access-protected Pages gateway and Worker validate the draft, and the
Worker relays it to the Apps Script Web App. The script drops the files into a **private
Drive folder** for review. It does **not** post to Instagram or Facebook.

A carousel writes one JPEG per slide (`…_01.jpg`, `…_02.jpg`, …) plus a single `.txt`
sidecar for the whole post. Every image also carries the full post as JSON in its **Drive
file description** — that is the field a Zap reads, so a "new file in folder" trigger has
the caption, sponsors, lake and posting window without a second lookup.

## Create or replace the Apps Script deployment

1. Go to <https://script.google.com> → **New project**. Name it `Baxstar Ember Outbox`.
2. Delete the starter `Code.gs` content and paste this repo's `apps-script/outbox/Code.gs`.
3. (Optional) Set `OUTBOX_FOLDER_ID` at the top to a specific private folder's ID — the
   long string in `drive.google.com/drive/folders/<THIS>`. If you leave it blank, the
   script creates/uses a My Drive folder named **Baxstar Ember Outbox**.
4. Set `SHARED_TOKEN` to a strong random value. Store the matching value only in the
   Worker secret `OUTBOX_TOKEN`.
5. **Deploy ▸ New deployment ▸ Web app.**
   - **Execute as:** Me (your account — so it writes to *your* Drive).
   - **Who has access:** **Anyone** (required so the Worker can POST; the browser never
     receives the URL or token).
6. Click **Deploy**, approve the Drive permission prompt, and copy the **Web app URL**
   (ends in `/exec`).
7. Store the `/exec` URL interactively as the Worker's encrypted `OUTBOX_URL` secret.
   Store the shared token as `OUTBOX_TOKEN`. Do not pass either value on a command line
   or add them to `wrangler.toml`.
8. Deploy the Worker, then verify through authenticated Ember. There is no browser-side
   endpoint setting.

## Verify
- Run `npm run test:release`; the offline suites verify both the Apps Script contract
  and the Worker relay without contacting Drive.
- In authenticated Ember, generate a caption for a disposable test photo and hit
  **Publish to Drive Outbox** →
  the JPEG + a matching `.txt` appear in the outbox folder.
- Right-click the JPEG in Drive → **File information ▸ Details**. The description should
  be a JSON blob with `caption`, `sponsors`, `lake`, `postWindow`, `slide`, `slideCount`.
  If that's empty, a Zap reading it will have nothing to work with.

Never test by posting directly to the Apps Script URL from a browser. A successful Ember
response means the Worker received a readable `{ok:true}` from the upstream deployment;
opaque `no-cors` requests are not treated as success.

## Wiring the Zap (when you get there)

The metadata is already shaped for it:

| Zap field | Where it comes from |
|---|---|
| Media | the Drive file object from **Find a File** (Zapier re-hosts the bytes for Meta) |
| Caption | `caption` from the description — **no @handles**, they'd double-tag |
| Tagged User(s) | `sponsors` — up to 9, auto-placed in a 3×3 grid |
| Location | `lake` **as a plain name**, or empty |
| Delay until | `postAt` — an ISO instant, ready to use as-is |

**Use `postAt`, not `postWindow`, for the delay.** `postWindow` is a human label like
"4 PM CT"; making the Zap parse it means guessing a date, and it guesses wrong for any
caption written after the posting time. `postAt` is already the next occurrence of that
time in US Central as an ISO timestamp, DST included.

**Never send a location ID.** The 2026-07-07 publish attempt failed outright because
Zapier auto-guessed one and Meta rejected it with "Location ID invalid". The lake name as
a plain string works; empty works; an ID does not.

## Notes / gotchas
- **Transport:** the Worker, not the browser, sends `text/plain` to Apps Script and reads
  the response. Ember never uses an opaque `no-cors` success path.
- **Payload size:** Ember downscales every slide to ≤1440px JPEG in the browser before
  sending. That is what keeps a six-slide carousel inside the Apps Script payload limit —
  don't remove it.
- **Re-deploying after edits:** use **Deploy ▸ Manage deployments ▸ (edit) ▸ New version**
  so the `/exec` URL stays the same. A brand-new deployment mints a new URL; update the
  encrypted Worker `OUTBOX_URL` secret, never the Ember client.
- **Privacy:** files are written to *your* Drive under your account. Keep the folder
  private. Treat the `/exec` URL as a capability secret because anyone who obtains an
  unprotected URL can attempt to write into that folder; keep the shared token enabled
  and rotate both secrets if either is exposed.
