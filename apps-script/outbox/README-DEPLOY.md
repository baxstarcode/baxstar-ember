# Caption Studio → Drive Outbox — deploy steps

`Code.gs` is a **scaffold**. It is intentionally **not deployed**. When you're ready, this
is the whole path — ~5 minutes, no billing.

## What it does
Ember's Caption Studio "Publish to Drive Outbox" button sends the finished JPEG(s) +
caption to a Google Apps Script Web App, which drops them into a **private Drive folder**
for you to review and post. It does **not** post to Instagram or Facebook.

A carousel writes one JPEG per slide (`…_01.jpg`, `…_02.jpg`, …) plus a single `.txt`
sidecar for the whole post. Every image also carries the full post as JSON in its **Drive
file description** — that is the field a Zap reads, so a "new file in folder" trigger has
the caption, sponsors, lake and posting window without a second lookup.

## Deploy

1. Go to <https://script.google.com> → **New project**. Name it `Baxstar Ember Outbox`.
2. Delete the starter `Code.gs` content and paste this repo's `apps-script/outbox/Code.gs`.
3. (Optional) Set `OUTBOX_FOLDER_ID` at the top to a specific private folder's ID — the
   long string in `drive.google.com/drive/folders/<THIS>`. If you leave it blank, the
   script creates/uses a My Drive folder named **Baxstar Ember Outbox**.
4. (Optional) Set `SHARED_TOKEN` to any random string for a little extra guard.
5. **Deploy ▸ New deployment ▸ Web app.**
   - **Execute as:** Me (your account — so it writes to *your* Drive).
   - **Who has access:** **Anyone** (required so the browser can POST to it; the URL is
     unguessable and, if you set `SHARED_TOKEN`, also token-gated).
6. Click **Deploy**, approve the Drive permission prompt, and copy the **Web app URL**
   (ends in `/exec`).
7. In Ember → Caption Studio → the **gear** next to Publish → paste the `/exec` URL. It's
   saved on that device (localStorage). If you set a `SHARED_TOKEN`, append it to the URL
   as `?token=YOURTOKEN`.

## Verify
- Open the `/exec` URL in a browser → you should see
  `{"ok":true,"service":"baxstar-ember-outbox","ready":true,"maxSlides":6}`.
- In Ember, generate a caption for a test photo and hit **Publish to Drive Outbox** →
  the JPEG + a matching `.txt` appear in the outbox folder.
- Right-click the JPEG in Drive → **File information ▸ Details**. The description should
  be a JSON blob with `caption`, `sponsors`, `lake`, `postWindow`, `slide`, `slideCount`.
  If that's empty, a Zap reading it will have nothing to work with.

Before deploying, the contract is checkable offline: `npm run test:outbox` evaluates this
exact file against a stubbed Drive and asserts what lands and what the description says.

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
- **CORS:** Apps Script mishandles CORS preflight, so Ember sends the body as
  `text/plain` (a "simple" request that skips preflight). If your browser still blocks
  reading the response, Ember falls back to an opaque `no-cors` POST — the file still
  lands; you just won't get an in-app confirmation. The health-check `doGet` is the way to
  confirm the endpoint is alive.
- **Payload size:** Ember downscales every slide to ≤1440px JPEG in the browser before
  sending. That is what keeps a six-slide carousel inside the Apps Script payload limit —
  don't remove it.
- **Re-deploying after edits:** use **Deploy ▸ Manage deployments ▸ (edit) ▸ New version**
  so the `/exec` URL stays the same. A brand-new deployment mints a new URL you'd have to
  re-paste into Ember.
- **Privacy:** files are written to *your* Drive under your account. Keep the folder
  private — a private file is all Zapier needs, so there's no reason to ever make it
  public. The `/exec` URL is not a secret worth protecting like a password, but don't
  publish it — anyone with it can write into that one folder.
