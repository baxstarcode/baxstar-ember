# Caption Studio → Drive Outbox — deploy steps

`Code.gs` is a **scaffold**. It is intentionally **not deployed** (overnight run: no deploys).
When you're ready, this is the whole path — ~5 minutes, no billing.

## What it does
Ember's Caption Studio "Publish to Drive Outbox" button sends the finished JPEG + caption
to a Google Apps Script Web App, which drops both files into a **private Drive folder** for
you to review and post. It does **not** post to Instagram or Facebook.

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
- Open the `/exec` URL in a browser → you should see `{"ok":true,"service":"baxstar-ember-outbox","ready":true}`.
- In Ember, generate a caption for a test photo and hit **Publish to Drive Outbox** →
  the JPEG + a matching `.txt` (caption + metadata) appear in the outbox folder.

## Notes / gotchas
- **CORS:** Apps Script mishandles CORS preflight, so Ember sends the body as
  `text/plain` (a "simple" request that skips preflight). If your browser still blocks
  reading the response, Ember falls back to an opaque `no-cors` POST — the file still
  lands; you just won't get an in-app confirmation. The health-check `doGet` is the way to
  confirm the endpoint is alive.
- **Re-deploying after edits:** use **Deploy ▸ Manage deployments ▸ (edit) ▸ New version**
  so the `/exec` URL stays the same. A brand-new deployment mints a new URL you'd have to
  re-paste into Ember.
- **Privacy:** files are written to *your* Drive under your account. Keep the folder
  private. The `/exec` URL is not a secret worth protecting like a password, but don't
  publish it — anyone with it can write into that one folder.
