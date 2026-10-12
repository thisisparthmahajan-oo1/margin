// Builds the Android debug APK pointed at a Margin server. The APK holds no secret: like the web
// app, it asks for the access token on first open and stays signed in for 30 days.
//
//   MARGIN_API_URL=https://marginr.vercel.app npm run android:build
//
// Needs JDK 21 (JAVA_HOME, or ~/.jdks/jdk-21*) and the Android SDK (apps/android/local.properties).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');
const android = path.join(root, 'apps/android');

const apiUrl = process.env.MARGIN_API_URL?.replace(/\/+$/, '');
if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
  console.error('Set MARGIN_API_URL to the server address, e.g. https://margin.vercel.app');
  process.exit(1);
}
if (apiUrl.startsWith('http:')) console.warn('Plain http server: only debug builds are allowed to use it.');

function findJava21() {
  const candidates = [
    process.env.JAVA_HOME,
    ...(fs.existsSync(path.join(os.homedir(), '.jdks'))
      ? fs.readdirSync(path.join(os.homedir(), '.jdks'))
          .filter((d) => d.startsWith('jdk-21'))
          .map((d) => path.join(os.homedir(), '.jdks', d, 'Contents/Home'))
      : []),
  ].filter(Boolean);
  for (const home of candidates) {
    try {
      const version = execSync(`"${home}/bin/java" -version 2>&1`).toString();
      if (/version "21/.test(version)) return home;
    } catch {}
  }
  console.error('JDK 21 not found. Set JAVA_HOME to a JDK 21 installation.');
  process.exit(1);
}

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

run('npx vite build --outDir dist-native', web, { VITE_API_URL: apiUrl });
run('npx cap sync android', web, { MARGIN_API_URL: apiUrl });
run('./gradlew assembleDebug', android, { JAVA_HOME: findJava21() });

const apk = path.join(android, 'app/build/outputs/apk/debug/app-debug.apk');
console.log(`\nAPK: ${path.relative(root, apk)} (${(fs.statSync(apk).size / 1e6).toFixed(1)} MB) → ${apiUrl}`);
