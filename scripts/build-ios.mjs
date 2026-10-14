// Builds the iOS app pointed at a Margin server and installs it.
//
//   MARGIN_API_URL=https://marginr.vercel.app npm run ios:sim      # iPhone simulator
//   MARGIN_API_URL=https://marginr.vercel.app npm run ios:device   # your iPhone
//
// Signing uses the free Apple ID team set in apps/ios (DEVELOPMENT_TEAM), with automatic
// provisioning; free-team builds stop opening after 7 days. After a device install, the build is handed to
// ios-app-renewer (~/projects/claude/custom-tools-for-terminal), which keeps it renewed.
// Options: MARGIN_IOS_SIMULATOR (default "iPhone 17"), MARGIN_IOS_DEVICE (default: first paired iPhone).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE_ID = 'com.parthmahajan.margin';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'apps/web');
const project = path.join(root, 'apps/ios/App/App.xcodeproj');
const derived = path.join(root, 'apps/ios/build');
const target = process.argv[2];

const apiUrl = process.env.MARGIN_API_URL?.replace(/\/+$/, '');
if (!['sim', 'device'].includes(target)) {
  console.error('Usage: build-ios.mjs sim|device');
  process.exit(1);
}
if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
  console.error('Set MARGIN_API_URL to the server address, e.g. https://marginr.vercel.app');
  process.exit(1);
}

const run = (cmd, cwd = root, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const read = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' });

run('npx vite build --outDir dist-native', web, { VITE_API_URL: apiUrl });
run('npx cap sync ios', web, { MARGIN_API_URL: apiUrl });

const xcodebuild = (args) =>
  run(`xcodebuild -project "${project}" -scheme App -derivedDataPath "${derived}" -quiet ${args} build`);

if (target === 'sim') {
  const name = process.env.MARGIN_IOS_SIMULATOR ?? 'iPhone 17';
  xcodebuild(`-configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,name=${name}"`);
  const app = path.join(derived, 'Build/Products/Debug-iphonesimulator/App.app');
  try {
    execSync(`xcrun simctl boot "${name}"`, { stdio: 'ignore' });
  } catch {
    // already booted
  }
  run('open -a Simulator');
  run(`xcrun simctl install "${name}" "${app}"`);
  run(`xcrun simctl launch "${name}" ${BUNDLE_ID}`);
  console.log(`\nInstalled on simulator "${name}" → ${apiUrl}`);
} else {
  const device = findDevice(process.env.MARGIN_IOS_DEVICE);
  xcodebuild(`-configuration Release -destination "id=${device.udid}" -allowProvisioningUpdates`);
  const app = path.join(derived, 'Build/Products/Release-iphoneos/App.app');
  run(`xcrun devicectl device install app --device ${device.identifier} "${app}"`);
  console.log(`\nInstalled on "${device.name}" → ${apiUrl}.`);
  keepRenewed(app);
  try {
    run(`xcrun devicectl device process launch --device ${device.identifier} ${BUNDLE_ID}`);
  } catch {
    console.log('Couldn’t open it on the phone (it’s probably locked); open Margin yourself.');
  }
}

/**
 * Free Apple ID builds stop opening after 7 days. ios-app-renewer (a launchd job on this Mac) re-signs and
 * reinstalls the installed build daily while the phone is on the same Wi-Fi; this hands it the new build.
 */
function keepRenewed(app) {
  const renewer = path.join(os.homedir(), 'projects/claude/custom-tools-for-terminal/ios-app-renewer/renew.mjs');
  if (!fs.existsSync(renewer)) {
    console.log('Free Apple ID builds expire in 7 days; re-run to renew.');
    return;
  }
  run(`node "${renewer}" adopt ${BUNDLE_ID} "${app}"`);
  console.log('ios-app-renewer will keep this build from expiring (renewed daily when the phone is on the same Wi-Fi).');
}

/** A paired, reachable iPhone (USB or same Wi-Fi), by name or the first one found. */
function findDevice(wanted) {
  const out = path.join(os.tmpdir(), `margin-devices-${process.pid}.json`);
  read(`xcrun devicectl list devices --json-output "${out}" --quiet`);
  const devices = JSON.parse(fs.readFileSync(out, 'utf8')).result.devices
    .filter((d) => d.hardwareProperties?.platform === 'iOS' && d.hardwareProperties?.reality === 'physical')
    .map((d) => ({
      name: d.deviceProperties?.name,
      identifier: d.identifier,
      udid: d.hardwareProperties?.udid,
      available: d.connectionProperties?.tunnelState !== 'unavailable',
    }));
  fs.rmSync(out, { force: true });
  const match = devices.find((d) => (wanted ? d.name === wanted : d.available)) ?? devices.find((d) => d.name === wanted);
  if (!match) {
    console.error(`No iPhone found${wanted ? ` named "${wanted}"` : ''}. Paired: ${devices.map((d) => d.name).join(', ') || 'none'}.`);
    process.exit(1);
  }
  if (!match.available) console.warn(`"${match.name}" looks offline: connect it by cable (or same Wi-Fi) and unlock it.`);
  return match;
}
