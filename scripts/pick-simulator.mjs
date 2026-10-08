// Picks an iPhone simulator to test on: the newest iOS installed, and a plain recent iPhone if there is
// one. Reads the output of `xcrun simctl list devices available --json` on standard input, and prints the
// phone as IOS_UDID, IOS_NAME and IOS_VERSION lines, the form a GitHub workflow's environment file takes.
//
// Usage: xcrun simctl list devices available --json | node scripts/pick-simulator.mjs
import { readFileSync } from 'node:fs';

/** The phones to prefer, most wanted first. Any other iPhone will do if none of these is installed. */
const PREFERRED = ['iPhone 17', 'iPhone 16', 'iPhone 16e', 'iPhone 15'];

/** "com.apple.CoreSimulator.SimRuntime.iOS-26-1" as [26, 1], or null for a runtime that is not iOS. */
const iosVersion = (runtime) => /SimRuntime\.iOS-([\d-]+)$/.exec(runtime)?.[1].split('-').map(Number) ?? null;
const newer = (a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);

export function pickSimulator(listing) {
  const runtimes = Object.entries(listing.devices ?? {})
    .map(([runtime, devices]) => ({ version: iosVersion(runtime), phones: devices.filter((device) => device.isAvailable !== false && device.name.startsWith('iPhone')) }))
    .filter(({ version, phones }) => version && phones.length > 0)
    .sort((a, b) => newer(b.version, a.version));
  const newest = runtimes[0];
  if (!newest) return null;
  const phone = PREFERRED.map((name) => newest.phones.find((device) => device.name === name)).find(Boolean) ?? newest.phones[0];
  return { udid: phone.udid, name: phone.name, ios: newest.version.join('.') };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const picked = pickSimulator(JSON.parse(readFileSync(0, 'utf8')));
  if (!picked) throw new Error('No iPhone simulator is installed.');
  console.error(`Using ${picked.name} with iOS ${picked.ios}`);
  console.log(`IOS_UDID=${picked.udid}\nIOS_NAME=${picked.name}\nIOS_VERSION=${picked.ios}`);
}
