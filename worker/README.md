# Cloudflare service

The current release is a read-only AI wedding inspiration gallery. Production assets are built from `web/wedding/` into `dist/web` and served through the `ASSETS` binding. The gallery does not call the retained history API, create user profiles, or write browsing records to GitHub. No R2, KV, D1, or Durable Object stores are used.

## Configuration

For the gallery release, `wrangler.jsonc` sets `SYNC_ENABLED: "false"`; session and history operations remain unavailable even if Worker secrets were provisioned during earlier development. The gallery needs only its static assets. The history implementation and its tests are retained for development and are not gallery features. Any future release that enables this API must update the actual product, consent, privacy disclosures, category and review materials, then configure the exact origins and private repository before setting the flag to `"true"`.

- `GITHUB_TOKEN`: fine-grained token restricted to `BrclioData/Brclio-Miniapp-Data`, with repository Contents read/write. Never include it in public assets or mini program code.
- `DATA_HMAC_KEY`: at least 32 cryptographically random characters. Keep this secret stable; rotating it invalidates existing device capabilities and prevents those devices from reaching their previous saved files.
- `PUBLIC_ORIGIN`: the exact main HTTPS origin, initially `https://pocket.brclio.com`, without trailing slash.
- `EXTRA_ALLOWED_ORIGIN`: the optional exact HTTPS H5 alias, initially `https://pocket.bornforthis.cn`, without trailing slash. Neither setting accepts HTTP, a wildcard, or URL paths.
- `GITHUB_BRANCH`: the target existing branch, initially `main`.

Production secrets belong in Cloudflare Worker secrets. `.dev.vars.example` is a placeholder only; a populated `.dev.vars` must be ignored by Git. Use Wrangler 4.36.0 or later for the rate limiting bindings.

## Retained development API

The following contract applies only when sync is explicitly enabled for a future release. With the current gallery configuration, health reports `syncAvailable: false` and session/history operations are unavailable. Historical successful API tests do not indicate that the gallery exposes backup.

Sync is an optional device backup. It does not authenticate a real person or provide a competitive ranking. The browser must store its returned capability locally and treat it as a password. Anyone who possesses it can read that device's last 20 saved matches. Losing it loses access to that backup; there is no cross-device account recovery.

The page must be served from `PUBLIC_ORIGIN` or `EXTRA_ALLOWED_ORIGIN`. The Worker checks the exact `Origin` header, or a permitted `Referer` for browsers omitting Origin on GET. CORS responses echo only one of these approved origins with `Vary: Origin`; no wildcard or cookies are enabled. Preflight allows only GET, POST, DELETE, OPTIONS and the Authorization / Content-Type headers. A workers.dev address is not automatically added to the browser-origin allowlist. The approved H5 alias can call the API on the main origin with `credentials: 'omit'`.

1. `GET /api/health` → `{ "ok": true, "service": "brclio-pocket", "syncAvailable": false }`. Availability means configuration is present, not that a live GitHub write has been verified.
2. `POST /api/v1/session` with `Content-Type: application/json` and body `{}` → HTTP 201, `{ "token": "v1.…", "historyLimit": 20 }`. This issues an anonymous HMAC-signed capability and creates no GitHub file.
3. `GET /api/v1/history` with `Authorization: Bearer <token>` → `{ "matches": [], "updatedAt": null }` if there is no saved history.
4. `POST /api/v1/history` with the same bearer and JSON `{ "matches": […] }` → the merged history and server timestamp. Each match has exactly `id`, `at`, `names`, `winner`, `scores`, `bestMs`; the existing local storage shape is accepted. Unknown match properties are discarded. The root object cannot specify a path, repository, branch, or other fields.
5. `DELETE /api/v1/history` with the same bearer and no body → `{ "deleted": true }`. This removes only the current device's saved file, requires an approved origin and write limits, and is idempotent when the file is absent. The local capability remains valid, so a later explicit backup can create a new current file.

`matches` is capped at 20; request bodies are capped at 8 KiB. Timestamps are milliseconds since Unix epoch. The winning score must be 1, 3, or 5 and strictly greater than the other score. Reaction time is null or between 0 and 5000 ms. Names must have 1–16 UTF-16 code units without control characters. A saved match ID is immutable. Uploads merge by ID, preserve concurrent records, and keep the newest 20. An empty upload does not delete previous history. Clearing local history does not erase previously committed private repository data.

## Storage and limits

The only GitHub paths this service can access are server-derived `pocket/v1/devices/<HMAC-derived 64 hex characters>.json` files. The API never exposes repository listings, paths, blob SHAs, the GitHub token, or upstream error text. Files contain a fixed schema with a version, update timestamp, and canonical matches. Raw IP addresses and capabilities are not saved in the repository.

The Worker uses native Cloudflare rate limiting bindings: 60 API requests per minute per hashed IP, six session requests per minute per hashed IP, and a shared 30-write-request budget per minute. Cloudflare enforces these counters per location and uses eventual consistency; these are abuse controls, not strict global accounting. Saved devices also have a 10-second interval between changed writes. Idempotent uploads avoid extra commits. The GitHub Contents API uses the current file SHA and retries conflicts up to three times.

Errors return only a short code and an HTTP status: 400 invalid data, 401 invalid capability, 403 disallowed origin, 413 oversized request, 415 non-JSON body, 429 throttled, 409 repeated sync conflict, 503 unavailable sync or storage. Clients should preserve local data and make no claim of successful backup until a POST succeeds. Rate-limited clients should wait at least 60 seconds before retrying.

Deleting the current saved file does not purge Git commit history. Repository commit history retains prior versions after the current file is removed. Any future product offering cloud backup must disclose this retention behavior and obtain explicit opt-in. The current gallery offers no cloud backup.

Official references: [Workers static assets bindings](https://developers.cloudflare.com/workers/static-assets/binding/), [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [GitHub Contents API](https://docs.github.com/en/rest/repos/contents).
