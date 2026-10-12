import type { CapacitorConfig } from '@capacitor/cli';

/** Server the app talks to; baked into the build by `npm run android:build`. */
const apiUrl = process.env.MARGIN_API_URL ?? '';

const config: CapacitorConfig = {
  appId: 'com.parthmahajan.margin',
  appName: 'Margin',
  // Separate from the PWA build: this one has the server URL and token baked in.
  webDir: 'dist-android',
  android: {
    path: '../android',
    // The app itself is served from https://localhost; a plain-http dev server needs mixed content.
    // Hosted (https) builds keep it off. Plain http is additionally only permitted in debug builds.
    allowMixedContent: apiUrl.startsWith('http:'),
  },
};

export default config;
