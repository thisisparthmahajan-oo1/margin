# Margin

A personal read-later app modelled on Instapaper. Paste a link (or share it from your phone) and the article is downloaded, cleaned up, and kept for offline reading, images included. It also handles:
- **X (Twitter) long-form Articles**;
- **PDFs** from your devices, read as text or as the original pages;
- **YouTube links**, saved but not downloaded.

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
| `APP_TOKEN`   | unset                       | Access token. **Required in production.** Apps ask for it on first open and stay signed in for 30 days |
| `PORT`        | `8787`                      | Local server port                                                |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | unset | Cloudflare R2 for PDFs (see below). Without them, adding PDFs is switched off |
| `FILE_STORAGE_LIMIT_GB` | `5`              | Hard cap on all PDFs together; uploads past it are refused       |
| `FILE_MAX_MB` | `100`                       | Largest single PDF                                               |

## Deploy (Vercel + MongoDB Atlas)

Same setup as `personal-tracker`.

1. **Atlas:** create a free cluster, a database user, and allow access from anywhere (`0.0.0.0/0`, which Vercel needs). Copy the `mongodb+srv://…` connection string.
2. **GitHub:** push this repo to a new GitHub repository.
3. **Vercel:** *Add New → Project*, import the repo, and keep the root directory as the repo root. The build settings come from `vercel.json`. Under *Environment Variables*, add:
   - `MONGODB_URI`: the Atlas string
   - `DB_NAME`: `margin`
   - `APP_TOKEN`: a long random secret, e.g. `openssl rand -hex 24`
4. Deploy, then open `https://<project>.vercel.app/api/health`. It should return `{"ok":true}`.

### PDF storage (Cloudflare R2)

PDFs are kept in a private R2 bucket. R2's free tier is 10 GB, and Margin stops at `FILE_STORAGE_LIMIT_GB` (5 GB).
1. In Cloudflare, go to **R2 → Create bucket** (Automatic location, Standard class, not public).
2. Open the bucket, then **Settings → CORS policy**. Add a policy that allows `GET`, `PUT` and `HEAD`:
   - from `https://<project>.vercel.app`, `http://localhost:5173`, `capacitor://localhost` (iOS) and `https://localhost` (Android);
   - with header `Content-Type`.
3. Go to **R2 → Manage API tokens → Create Account API token**, with *Object Read & Write* on that bucket only. Then add to Vercel:
   - `R2_ACCESS_KEY_ID` = the Access Key ID;
   - `R2_SECRET_ACCESS_KEY` = the Secret Access Key;
   - `R2_ACCOUNT_ID` = the id in `https://<id>.r2.cloudflarestorage.com`;
   - `R2_BUCKET` = the bucket name.

Devices upload and download PDFs **directly to and from R2** with short-lived signed links, so files never pass through the API, which has a 4.5 MB body limit on Vercel.

`npm run build:vercel` produces a [Build Output API](https://vercel.com/docs/build-output-api/v3) bundle in `.vercel/output`:
- the PWA as static files;
- the whole API as one Node.js function (`maxDuration` 60s).

Article downloads keep running after the response via `waitUntil`. Downloads that get lost are retried automatically on the next sync.

## Android app

The Android app is the web app wrapped with [Capacitor](https://capacitorjs.com). The server URL is built into the APK; the access token is not (the app asks for it on first open).

```sh
MARGIN_API_URL=https://marginr.vercel.app npm run android:build
# → apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on your phone with either:
- `adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk` (USB debugging on), or
- copy the APK to the phone and open it (allow *Install unknown apps*).

Requirements:
- **JDK 21:** `JAVA_HOME`, or a JDK in `~/.jdks/jdk-21*`.
- **Android SDK:** the path is in `apps/android/local.properties`. Gradle downloads SDK 36 on the first build.

What the Android app adds:
- **Share → Save to Margin** from Chrome, X, or any other app. PDFs work the same way: use Share or *Open with → Margin*.
- **Offline by default:** the app's files ship inside the APK, and article images are stored on the device.
- **Listen** uses Android's system text-to-speech.
- The back button works as expected.

For local testing against the dev server, build with `MARGIN_API_URL=http://10.0.2.2:8787` (Android emulator → your Mac) or `http://<mac-lan-ip>:8787` (phone on the same Wi-Fi). Plain `http` is allowed in debug builds only.

## iOS app

Same Capacitor wrapper as Android (`apps/ios`). It's signed with your **free Apple ID team** (`T9275P7FTT`, the same team as the fitness app), using automatic signing.

```sh
MARGIN_API_URL=https://marginr.vercel.app npm run ios:sim      # build + run in the iPhone simulator
MARGIN_API_URL=https://marginr.vercel.app npm run ios:device   # build + install on your iPhone
```

- **Device install:** connect the iPhone by cable (or the same Wi-Fi once paired) and unlock it. If the phone says *Untrusted Developer*, trust the team once: *Settings → General → VPN & Device Management*. Pick a specific phone with `MARGIN_IOS_DEVICE="Parth Phone"`.
- **Free Apple ID limits:**
  - Builds stop opening after **7 days**. On this Mac, **ios-app-renewer** (`~/projects/claude/custom-tools-for-terminal/ios-app-renewer`) handles that automatically: it's a launchd job that re-signs and reinstalls the installed build about once a day whenever the iPhone is on the same Wi-Fi. `npm run ios:device` hands each new build to it. Your library and sign-in stay.
  - No TestFlight.
  - No share-sheet extension for links. Instead, when you open Margin after copying a link, it offers **"Save the link you copied?"**. This uses `packages/capacitor-clipboard-link`. iOS asks "Allow Paste" only when you tap Save.
  - **PDFs can be shared to Margin** from Files, Mail or Safari (*Share → Margin*). This works even on the free team, because Margin declares that it opens PDFs; it doesn't need an extension.
- **Paid Apple Developer Program ($99/yr):** switch `DEVELOPMENT_TEAM` in `apps/ios/App/App.xcodeproj` to the paid team. That adds TestFlight, 90-day builds, and the option of a real share extension.

## Features

- **Save:** paste a link, or share it to the app. Saving a link you already have moves it back to the top of Home.
- **Lists:** Home, Liked, PDFs, Videos, Archive, your own folders, and Notes.
- **Tags:** mark items with where they stand, e.g. *Don't understand yet*. An item can have any number of tags, whatever its folder. Each tag has its own list, and any list (a folder, Home…) can be narrowed to a tag with the chips under its title. Sort by newest, oldest, shortest, or longest.
- **Reader:** 5 fonts, text size, line spacing, width, and Light/Sepia/Dark/Black themes. It remembers where you stopped, and can optionally archive an article when you reach the end.
- **Highlights & notes:** select text, then choose Highlight or Add note. They're all collected on the Notes page.
- **Search:** searches the full text of every article when online, and titles and summaries when offline.
- **Listen:** text-to-speech with adjustable speed.
- **Keyboard (web):** `j`/`k` to move, `Enter` to open, `a` to archive, `l` to like, `t` for tags, `/` to search, `n` to add a link, `Esc` to go back.
- **Offline-first:** every change is saved on the device first and synced when you're back online.
- **Sign-in:** each device asks for the access token once, then stays signed in for 30 days (also offline). Changing `APP_TOKEN` on the server signs every device out.

### PDFs

- **Adding PDFs:**
  - **Add PDF** on Home or PDFs, or drop files onto any list (web);
  - share or open a PDF in Margin (Android, iOS);
  - save a link to a PDF.
- **Reading:**
  - **Text** shows the extracted text, with themes, highlights, notes, Listen and search;
  - **Original** shows the actual pages, drawn with pdf.js.
  - Both work offline: every device keeps a copy of each PDF.
  - Scanned PDFs have no text layer, so they open in Original only.
- **Text extraction** (`apps/server/src/pdf.ts`):
  - lines are joined into paragraphs, and larger or numbered lines become headings;
  - running headers, footers and page numbers are dropped;
  - without a title in the metadata, the biggest heading on page 1 is used.
- **Storage:** Settings shows *PDF storage: X of 5 GB*. Deleting a PDF deletes its file everywhere.

### Videos

YouTube links save the title, channel, thumbnail and description. The description is the text, so it's searchable. Videos aren't downloaded:
- on the web they play inline;
- in the apps they open in YouTube.

X posts and Articles that contain videos are labelled **Video**; they stream from X. Both kinds appear under **Videos** in the sidebar.

### X Articles

x.com shows nothing without a login, so X posts are read through the public [FxTwitter API](https://github.com/FxEmbed/FxEmbed). Article bodies are converted from X's rich-text blocks into clean HTML (`apps/server/src/extractors/x-article.ts`). Paste the **post link** (`x.com/<user>/status/<id>`). Regular posts are saved too, as short text.

## Planned

- YouTube transcripts (searchable, readable offline).
- Cleanup and OCR for messy or scanned PDFs.
- Highlights on a PDF's original pages.
- Chrome extension.

## How it's built

```
packages/shared/   Types shared by every client: Bookmark, Folder, Highlight, API shapes, list rules
apps/server/       Hono API on MongoDB. Fetch → extract → sanitize → store images in GridFS → $text index
apps/web/          React PWA. Dexie (IndexedDB) mirror + outbox + on-device image cache
apps/android/      Capacitor Android project (+ ShareIntentPlugin for the share sheet)
apps/ios/          Capacitor iOS project (Swift Package Manager)
packages/capacitor-clipboard-link/   iOS plugin: offer to save a copied link
scripts/           build-vercel.mjs, build-android.mjs, build-ios.mjs
```

- **Server wiring** (`apps/server/src/wiring.ts`) is shared by both entrypoints: `index.ts` for local Node and `vercel.ts` for serverless. The only difference is how background downloads are kept alive (`Defer`).
- **Extractors** (`apps/server/src/extractors/index.ts`): an ordered list in which the first match wins, in this order:
  - X;
  - YouTube;
  - [Readability](https://github.com/mozilla/readability), the catch-all, which also notices when a link is a PDF.

  Each extractor returns an article, a video or a PDF (`Extracted`), and the pipeline handles each kind. HTML is parsed with parse5 + linkedom, which bundles cleanly for serverless.
- **Sync:** clients always read from IndexedDB. Changes go to an outbox and are sent in order. Then `GET /api/sync?since=<cursor>` pulls everything that changed, including deletions. The cursor lags real time by 10s, so writes from other serverless instances aren't missed.
- **Images** are stored in GridFS under their content hash (`/api/media/<hash>.<ext>`). That makes them immutable and cacheable forever, and clients keep a copy in IndexedDB.
- **PDFs** (`apps/server/src/uploads.ts`) are added in three steps:
  1. *prepare* checks the size limits and reserves the space;
  2. the device PUTs the file to R2;
  3. *finish* creates the item.

  Files are named by content hash, so adding the same PDF again finds the existing item.
- **Highlights** are stored as text quotes with surrounding context (W3C TextQuoteSelector).

## Tests

```sh
npm test        # server (in-memory MongoDB): store, sync, search, API auth, media, extractors. Web: highlight anchoring
```
