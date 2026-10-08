// Starts or stops the Android emulator the tests use. Usage: node scripts/emulator.mjs start|stop|status
//
// Needs ANDROID_HOME (the SDK, with `emulator`, `platform-tools` and a system image installed) and, to
// create the virtual phone the first time, JAVA_HOME. ANDROID_AVD_HOME says where virtual phones are kept.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const AVD = process.env.ANDROID_AVD ?? 'hexmap-phone';
const IMAGE = process.env.ANDROID_IMAGE ?? 'system-images;android-36;google_apis;x86_64';
const PROFILE = process.env.ANDROID_PROFILE ?? 'pixel_8';
const BOOT_SECONDS = 300;

const sdk = process.env.ANDROID_HOME;
if (!sdk || !existsSync(sdk)) throw new Error('Set ANDROID_HOME to the Android SDK folder (a .env file here is read).');
const windows = process.platform === 'win32';
const adb = join(sdk, 'platform-tools', windows ? 'adb.exe' : 'adb');
const emulator = join(sdk, 'emulator', windows ? 'emulator.exe' : 'emulator');
const avdmanager = join(sdk, 'cmdline-tools', 'latest', 'bin', windows ? 'avdmanager.bat' : 'avdmanager');

const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', shell: file.endsWith('.bat'), ...options }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emulators = () => run(adb, ['devices']).split('\n').filter((line) => /^emulator-\d+\s+device/.test(line)).map((line) => line.split(/\s+/)[0]);
const booted = (serial) => {
  try {
    // adb complains on stderr while the phone is still starting; that is expected, so it is not shown.
    return run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { stdio: ['ignore', 'pipe', 'ignore'] }) === '1';
  } catch {
    return false;
  }
};

async function start() {
  run(adb, ['start-server']);
  if (emulators().some(booted)) return console.log(`An emulator is already running: ${emulators().join(', ')}`);
  if (!run(emulator, ['-list-avds']).split(/\r?\n/).includes(AVD)) {
    console.log(`Creating the virtual phone ${AVD} (${PROFILE}, ${IMAGE})`);
    run(avdmanager, ['create', 'avd', '--name', AVD, '--package', `"${IMAGE}"`, '--device', PROFILE], { input: 'no\n' });
  }
  // No window, no sound and no saved state: the phone starts the same way every time.
  const child = spawn(emulator, ['-avd', AVD, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect', '-no-metrics'], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`Starting ${AVD}...`);
  for (let waited = 0; waited < BOOT_SECONDS; waited += 2) {
    if (emulators().some(booted)) return console.log(`${emulators().join(', ')} is ready after about ${waited} seconds.`);
    await sleep(2000);
  }
  throw new Error(`${AVD} did not finish starting within ${BOOT_SECONDS} seconds.`);
}

function stop() {
  const running = emulators();
  for (const serial of running) run(adb, ['-s', serial, 'emu', 'kill']);
  console.log(running.length > 0 ? `Stopped ${running.join(', ')}.` : 'No emulator was running.');
}

function status() {
  const running = emulators();
  if (running.length === 0) return console.log('No emulator is running.');
  for (const serial of running) {
    const prop = (name) => run(adb, ['-s', serial, 'shell', 'getprop', name]);
    const chrome = /versionName=(\S+)/.exec(run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', 'com.android.chrome']))?.[1] ?? 'not installed';
    console.log(`${serial}: Android ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')}), Chrome ${chrome}`);
  }
}

const command = process.argv[2];
if (command === 'start') await start();
else if (command === 'stop') stop();
else if (command === 'status') status();
else throw new Error('Usage: node scripts/emulator.mjs start|stop|status');
