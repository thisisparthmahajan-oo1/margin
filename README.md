# Margin

A personal read-later app modelled on Instapaper. Paste a link (or share it from your phone) and the article is downloaded, cleaned up, and kept for offline reading, images included. It also handles **X (Twitter) long-form Articles**.

There's one hosted API (Vercel + MongoDB Atlas) and two clients: a web app/PWA and an Android app. Both work fully offline.

## Run it locally

Needs Node 22+ and a local MongoDB (`brew services start mongodb-community`).

```sh
npm install
npm run dev          # API on :8787, web app on :5173 (open http://localhost:5173)
```

| Env var       | Default                     | Purpose                                                          |
|---------------|-----------------------------|------------------------------------------------------------------|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB (Atlas in production)                                    |
| `DB_NAME`     | `margin`                    | Database name                                                    |
| `APP_TOKEN`   | unset                       | API token. **Required in production.** The web app asks for it under Settings |
| `PORT`        | `8787`                      | Local server port                                                |

## Deploy (Vercel + MongoDB Atlas)

Same setup as `personal-tracker`.

1. **Atlas:** create a free cluster, a database user, and allow access from anywhere (`0.0.0.0/0`, which Vercel needs). Copy the `mongodb+srv://…` connection string.
2. **GitHub:** push this repo to a new GitHub repository.
3. **Vercel:** *Add New → Project*, import the repo, and keep the root directory as the repo root. The build settings come from `vercel.json`. Under *Environment Variables*, add:
   - `MONGODB_URI`: the Atlas string
   - `DB_NAME`: `margin`
   - `APP_TOKEN`: a long random secret, e.g. `openssl rand -hex 24`
4. Deploy, then open `https://<project>.vercel.app/api/health`. It should return `{"ok":true}`.

`npm run build:vercel` produces a [Build Output API](https://vercel.com/docs/build-output-api/v3) bundle in `.vercel/output`:
- the PWA as static files;
- the whole API as one Node.js function (`maxDuration` 60s).

Article downloads keep running after the response via `waitUntil`. Downloads that get lost are retried automatically on the next sync.

## Android app

The Android app is the web app wrapped with [Capacitor](https://capacitorjs.com). The server URL and token are built into the APK.

```sh
MARGIN_API_URL=https://<project>.vercel.app MARGIN_APP_TOKEN=<APP_TOKEN> npm run android:build
# → apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on your phone with either:
- `adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk` (USB debugging on), or
- copy the APK to the phone and open it (allow *Install unknown apps*).

Requirements:
- **JDK 21:** `JAVA_HOME`, or a JDK in `~/.jdks/jdk-21*`.
- **Android SDK:** the path is in `apps/android/local.properties`. Gradle downloads SDK 36 on the first build.

What the Android app adds:
- **Share → Save to Margin** from Chrome, X, or any other app.
- **Offline by default:** the app's files ship inside the APK, and article images are stored on the device.
- **Listen** uses Android's system text-to-speech.
- The back button works as expected.

For local testing against the dev server, build with `MARGIN_API_URL=http://10.0.2.2:8787` (Android emulator → your Mac) or `http://<mac-lan-ip>:8787` (phone on the same Wi-Fi). Plain `http` is allowed in debug builds only.

## Features

- **Save:** paste a link, or share it to the app. Saving a link you already have moves it back to the top of Home.
- **Lists:** Home, Liked, Archive, your own folders, and Notes. Sort by newest, oldest, shortest, or longest.
- **Reader:** 5 fonts, text size, line spacing, width, and Light/Sepia/Dark/Black themes. It remembers where you stopped, and can optionally archive an article when you reach the end.
- **Highlights & notes:** select text, then choose Highlight or Add note. They're all collected on the Notes page.
- **Search:** searches the full text of every article when online, and titles and summaries when offline.
- **Listen:** text-to-speech with adjustable speed.
- **Keyboard (web):** `j`/`k` to move, `Enter` to open, `a` to archive, `l` to like, `/` to search, `n` to add a link, `Esc` to go back.
- **Offline-first:** every change is saved on the device first and synced when you're back online.

### X Articles

x.com shows nothing without a login, so X posts are read through the public [FxTwitter API](https://github.com/FxEmbed/FxEmbed). Article bodies are converted from X's rich-text blocks into clean HTML (`apps/server/src/extractors/x-article.ts`). Paste the **post link** (`x.com/<user>/status/<id>`). Regular posts are saved too, as short text.

## How it's built

```
packages/shared/   Types shared by every client: Bookmark, Folder, Highlight, API shapes, list rules
apps/server/       Hono API on MongoDB. Fetch → extract → sanitize → store images in GridFS → $text index
apps/web/          React PWA. Dexie (IndexedDB) mirror + outbox + on-device image cache
apps/android/      Capacitor Android project (+ ShareIntentPlugin for the share sheet)
scripts/           build-vercel.mjs, build-android.mjs
```

- **Server wiring** (`apps/server/src/wiring.ts`) is shared by both entrypoints: `index.ts` for local Node and `vercel.ts` for serverless. The only difference is how background downloads are kept alive (`Defer`).
- **Extractors** (`apps/server/src/extractors/index.ts`): an ordered list in which the first match wins. X Articles come first, and [Readability](https://github.com/mozilla/readability) is the catch-all for everything else. HTML is parsed with parse5 + linkedom, which bundles cleanly for serverless.
- **Sync:** clients always read from IndexedDB. Changes go to an outbox and are sent in order. Then `GET /api/sync?since=<cursor>` pulls everything that changed, including deletions. The cursor lags real time by 10s, so writes from other serverless instances aren't missed.
- **Images** are stored in GridFS under their content hash (`/api/media/<hash>.<ext>`). That makes them immutable and cacheable forever, and clients keep a copy in IndexedDB.
- **Highlights** are stored as text quotes with surrounding context (W3C TextQuoteSelector).

## Tests

```sh
npm test        # server (in-memory MongoDB): store, sync, search, API auth, media, extractors. Web: highlight anchoring
```
