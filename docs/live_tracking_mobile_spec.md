# Live tracking: mobile app work (batching, SQLite outbox, watchdog)

Audience: the Flutter developer. Files involved: `lib/services/tracking_service.dart`, `lib/view/auth/role_home_router.dart`
(`reconcilePunchPrefs`), `pubspec.yaml`, Android manifest. The backend is ready for everything below.

## Status: implemented in code, needs on-phone testing

All three tasks below are written:

- `lib/services/tracking_outbox.dart` (new): the SQLite outbox (`sqflite`).
- `lib/services/tracking_service.dart`: fixes go to the outbox first; uploads are batched (at most 100 per request, every 30 s,
  at once at 50 waiting, on reconnect, and a final flush when the service stops); heartbeat, `clientPingId` and the
  per-item reply handling are in; the old SharedPreferences queue is imported once.
- `lib/services/tracking_watchdog.dart` (new) and `lib/main.dart`: the periodic restart task (`workmanager`).
- `pubspec.yaml`: added `sqflite` and `workmanager`.

The code passes `dart analyze` and a debug build, but none of it has run on a phone. Work through section 7 on at least two
Android brands before release. Not done on purpose: `autoStartOnBoot` (starting a location service at boot is restricted on
newer Android; decide after testing) and the OEM autostart settings screen.

## 1. Why this is needed (real data, 29 Oct 2026, ST580 and ST427, one 78 km day)

- The app showed 55 km and 66 km; the stored fixes actually contain about 77 km and 74 km.
- Fixes were stamped with the send time, not the capture time (already fixed, see section 2), so the server threw many away.
- Each phone had 16 to 18 silences of over 3 minutes, the longest 136 to 153 minutes. Most were the phone standing still
  (nothing is sent under the 30 m rule), but about 10 to 12 km per person was driven with no fixes recorded.
- 240 of ST580's 1,209 pings reached the server more than a minute after they were taken.

The three tasks below make sure fixes are not lost (outbox), are uploaded cheaply and reliably (batching) and that tracking
comes back by itself when the phone kills it (watchdog).

## 2. Already done in `tracking_service.dart` (do not redo, build on it)

- `capturedAt` is the fix's own `position.timestamp` (UTC).
- Fixes are handled one at a time through `pingChain`.
- `_syncOfflineQueue` has a single-run lock, removes only the rows it handled from the front of the *latest* queue, drops
  permanent 4xx rejections, and keeps 401/408/429/5xx for retry.
- Every fix carries a `clientPingId` (unique id, kept in the queue). The server stores an id once, so a retry can never
  duplicate a fix.
- A heartbeat sends an `IDLE_PING` fix every 90 s when nothing was uploaded (the 30 m rule does not apply to it).
- Not compiled by the author (no packages on that machine): build it first and fix anything the compiler reports.

## 3. Server contract

`POST {baseUrl}/api/hr/tracking/ping` with `Authorization: Bearer <accessToken>` and `Content-Type: application/json`.
The body is either one object (still supported) or an **array of objects (batch)**.

Item fields:

| Field | Type | Rule |
|---|---|---|
| `latitude` | number | -90 to 90 |
| `longitude` | number | -180 to 180 |
| `accuracyMeters` | number, optional | send it always |
| `batteryPercent` | number, optional | 0 to 100 |
| `activityType` | string | `EN_ROUTE` (moving) or `IDLE_PING` (heartbeat). Punch and visit events are written by the backend itself. |
| `capturedAt` | ISO-8601 UTC string | the fix's own time. Older than 7 days is rejected; more than 5 minutes in the future is stored at the server time. |
| `clientPingId` | string, 1 to 100 chars | unique per fix, generated when the fix is captured |

Batch limit: 1 to 500 items per request. **Use at most 100** to keep the body small on weak networks.

Batch response, `201`:

```json
{ "success": true, "message": "Tracking batch recorded",
  "data": { "count": 3, "events": 0, "pings": 2, "duplicates": 1, "invalid": 0,
            "results": [ { "index": 0, "clientPingId": "a1", "status": "accepted" },
                         { "index": 1, "clientPingId": "a2", "status": "duplicate" },
                         { "index": 2, "clientPingId": "a3", "status": "accepted" } ] } }
```

`status` is `accepted`, `duplicate` (already stored, safe to delete) or `invalid` (with a `reason`, will never succeed).
If **every** item is invalid the response is `400` with `data.results`. A bad request as a whole (wrong size, not JSON) is a
`400` without `results`.

What to do with each answer:

| Answer | Action |
|---|---|
| 201, item `accepted` or `duplicate` | delete the row |
| 201, item `invalid` | delete the row, log it (count it in diagnostics) |
| 400 with `results` | delete the rows marked `invalid` |
| 400 without `results` | split the batch in two and retry each half; a single item that still gets 400 is deleted |
| 401 | refresh the token with the app's existing refresh logic and retry; if refresh fails, keep the rows |
| 408, 429, 5xx, timeout, no network | keep the rows; retry with backoff 15 s, 30 s, 60 s, up to 5 min |

## 4. Task A: SQLite outbox (replaces the `SharedPreferences` queue)

New packages: `sqflite` (and `path`, already available through `path_provider`). Pin versions compatible with the Flutter
version in use.

Table:

```sql
CREATE TABLE tracking_outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ping_id  TEXT    NOT NULL UNIQUE,
  captured_at     INTEGER NOT NULL,      -- ms since epoch, UTC
  payload         TEXT    NOT NULL,      -- the JSON item exactly as it will be sent
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX tracking_outbox_order ON tracking_outbox (captured_at, id);
```

Rules:

1. **Write first, send second.** Every fix (including the heartbeat) is inserted into the outbox *before* any network call.
   The fix survives the app being killed in the middle of an upload.
2. **One flusher.** A single `flush()` function guarded by a lock (the existing `_syncingQueue` flag is a start). Every
   trigger (new fix, timer, connectivity change, punch-out) calls the same function; they never upload in parallel.
3. **Delete only after the server answers** for that row (table in section 3). Never rewrite a list; deleting by id cannot
   erase rows added meanwhile.
4. **Retention:** delete rows older than 48 hours, and if there are more than 5,000 rows delete the oldest. Log how many.
5. **Migration:** at first start, import the old `pending_live_tracking_pings_v1` entries from `SharedPreferences` (give any
   entry without a `clientPingId` a new one), then remove that key.
6. **Isolates:** the background service isolate is the only writer. The UI isolate must not write rows. To flush at punch-out
   or logout, send the service a message, for example `service.invoke('flushNow')`, and wait for an acknowledgement (with a
   10 s timeout). Remember `DartPluginRegistrant.ensureInitialized()` before opening the database in the service isolate.

## 5. Task B: batching

Replaces the one-request-per-fix upload.

- **Flush triggers:** every 30 to 60 seconds if there are rows; as soon as 50 rows are waiting; when connectivity returns;
  immediately before `stopService` and before punch-out (`flushNow`); and right after a heartbeat fix.
- **Batch building:** take the oldest rows by `(captured_at, id)`, at most 100, send them as one JSON array **in that
  order**, then apply the answer table from section 3. Repeat until the outbox is empty or a request fails temporarily.
- Keep the 30 m movement rule, the accuracy rule and the heartbeat as they are; only the *upload* changes.
- **Do not** put punch-in/out or visit events in this stream; the backend writes those.
- Diagnostics (log only): fixes captured, skipped for accuracy, skipped for distance, queued, accepted, duplicate, invalid.

## 6. Task C: watchdog restart

What already exists: `reconcilePunchPrefs` (`role_home_router.dart`, around line 311) starts the service whenever the server
says the employee is punched in, on every login and home screen load. So tracking is restarted when the app is opened.

What is missing: restart when the app is **not** opened. If the phone's battery manager kills the service (Oppo and Xiaomi do
this), nothing runs until the employee opens the app again, and the server sees hours of silence.

Steps:

1. In `TrackingService.start()` set `trackingShouldRun = true` in `SharedPreferences` (with today's date); in `stop()` set it
   to false *first*. The service updates `trackingLastAliveMs` on every fix and heartbeat.
2. Register a periodic background task (the `workmanager` package; Android allows 15 minutes at the shortest). The task
   reads only local preferences: if `trackingShouldRun` is true, the stored date is today, and
   `now - trackingLastAliveMs` is over 5 minutes, it starts the service (`startService()`).
3. On Android 12 and later, starting a foreground service from the background is restricted and the exceptions are narrow.
   **Test this on real phones.** If the restart is blocked on some devices, use a fallback and say which one you picked:
   - show a high-priority notification, "Tracking stopped. Tap to resume", that opens the app; or
   - ask the backend to send a high-priority data push when its "Tracking lost" alert fires (this needs `firebase_messaging`;
     the backend part is small and can be added on request).
4. Check whether the installed `flutter_background_service` version supports `autoStartOnBoot` in `AndroidConfiguration`
   and enable it only while `trackingShouldRun` is true.
5. For Oppo, Xiaomi, Vivo, Realme and Huawei, add a one-time screen that sends the user to the autostart / background
   settings page, in addition to the battery-optimisation exemption the app already requests.
6. Never restart after punch-out: the task must also stop when the server-confirmed punch-out clears `trackingShouldRun`.

## 7. How to know it works (test on real Android phones, at least two brands)

1. Punch in, drive or walk 3 km, swipe the app away, and confirm fixes keep arriving.
2. Punch in, stand still for 20 minutes: a heartbeat `IDLE_PING` arrives about every 90 to 180 seconds.
3. Switch on flight mode for 15 minutes while moving, switch it off: every fix arrives within about a minute, in order, with
   its original `capturedAt`, and none twice.
4. Force-stop or kill the service from the battery manager: tracking resumes within about 15 minutes without opening the app
   (or the fallback notification appears).
5. Kill the app in the middle of a batch upload: no fixes are lost and none are duplicated after restart.
6. Make the server answer 400 for one item of a batch: the other items are stored, and the bad one is dropped, not retried.
7. Punch out: the last stretch is uploaded before tracking stops (the outbox is empty).
8. Backend check: for a day's test route, the distance shown on the live tracking detail page is close to the real distance,
   and the "Tracking lost" alert appears if the phone is switched off while punched in.
