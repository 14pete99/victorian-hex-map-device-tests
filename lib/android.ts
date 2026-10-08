// Chrome for Android, on an emulator or a phone that `adb devices` lists. Playwright attaches to the
// browser installed on the device; nothing about the device is emulated.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { _android as android, test as base } from '@playwright/test';
import type { AndroidDevice, BrowserContext, Page } from '@playwright/test';
import { androidScreenPhone } from './android-screen';
import { chromeTouchPhone } from './chrome-touch';
import { lendPhone } from './fixtures';
import type { Phone } from './phone';

export interface AndroidChrome {
  device: AndroidDevice;
  chrome: BrowserContext;
}

/** The adb beside the SDK the emulator came from, or failing that whichever is on the PATH. */
export const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';

/** A `test` with Chrome open on the device, and a phone made from each new tab by `make`. */
const androidTestWith = (make: (device: AndroidDevice, page: Page) => Promise<Phone>) =>
  base.extend<{ phone: Phone }, { android: AndroidChrome }>({
    android: [
      async ({}, use, workerInfo) => {
        execFileSync(ADB, ['start-server']);
        // Writing touches to the touchscreen needs a root shell. An emulator grants one; a phone off the shelf
        // refuses, which stops only the tests that write to the screen.
        try {
          execFileSync(ADB, ['root'], { stdio: 'ignore' });
          execFileSync(ADB, ['wait-for-device']);
        } catch {
          // No root: carry on.
        }
        const [device] = await android.devices();
        if (!device) throw new Error('No Android device is connected. Run `npm run android:start`, then check `adb devices`.');
        // The demo is served by this computer. `adb reverse` makes the same address reach it from the device.
        const port = new URL(workerInfo.project.use.baseURL ?? 'http://127.0.0.1/').port;
        if (port) execFileSync(ADB, ['-s', device.serial(), 'reverse', `tcp:${port}`, `tcp:${port}`]);
        await device.shell('am force-stop com.android.chrome');
        // A new Chrome opens with a dialog asking to send notifications, which would take the first touches
        // on the screen. With the permission already settled, it has nothing to ask.
        await device.shell('pm grant com.android.chrome android.permission.POST_NOTIFICATIONS');
        // `viewport: null` leaves the screen as the device has it.
        const chrome = await device.launchBrowser({ viewport: null });
        // Chrome reopens the tabs it had; each test wants only its own.
        const restored = chrome.pages();
        await use({ device, chrome });
        for (const page of restored) await page.close().catch(() => undefined);
        await chrome.close();
        await device.close();
      },
      { scope: 'worker', timeout: 180_000 },
    ],
    phone: async ({ android: { device, chrome }, baseURL }, use) => {
      const page = await chrome.newPage();
      try {
        await lendPhone(page, baseURL ?? '/', (opened) => make(device, opened), use);
      } finally {
        await page.close();
      }
    },
  });

/** Touch input sent to Chrome through the DevTools protocol, as in desktop Chrome. */
export const androidChromeTest = androidTestWith((_device, page) => chromeTouchPhone(page));

/** Touch input written to the device's touchscreen, as a finger on the glass would produce. */
export const androidScreenTest = androidTestWith(androidScreenPhone);
