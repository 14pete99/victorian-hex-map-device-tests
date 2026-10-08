// Phones driven through an Appium server, which must be listening on APPIUM_URL (http://127.0.0.1:4723
// unless set) with the driver for the phone installed.
import { execFileSync } from 'node:child_process';
import { expect, test as base } from '@playwright/test';
import { remote } from 'webdriverio';
import type { Browser } from 'webdriverio';
import { ADB } from './android';
import { appiumPhone } from './appium-phone';
import type { Phone } from './phone';

const MINUTE = 60_000;

/** A `test` with one browser session on the phone for the whole run, and the demo loaded afresh for each test. */
const appiumTestWith = (capabilities: Record<string, unknown>) =>
  base.extend<{ phone: Phone }, { browserOnPhone: Browser }>({
    browserOnPhone: [
      async ({}, use, workerInfo) => {
        // An iPhone simulator shares this computer's network. An Android device has to be told how to reach the demo.
        const port = new URL(workerInfo.project.use.baseURL ?? 'http://127.0.0.1/').port;
        if (capabilities.platformName === 'Android' && port) execFileSync(ADB, ['reverse', `tcp:${port}`, `tcp:${port}`]);
        const appium = new URL(process.env.APPIUM_URL ?? 'http://127.0.0.1:4723');
        const open = () =>
          remote({
            protocol: appium.protocol.replace(':', ''),
            hostname: appium.hostname,
            port: Number(appium.port || 4723),
            path: appium.pathname,
            logLevel: 'warn',
            connectionRetryTimeout: 25 * MINUTE,
            connectionRetryCount: 0,
            // WebdriverIO would otherwise try the newer BiDi protocol, which Appium's drivers do not speak.
            capabilities: { 'wdio:enforceWebDriverClassic': true, 'appium:newCommandTimeout': 300, ...capabilities },
          });
        // The first session on a new iPhone simulator waits while Apple's test runner is built for it. That takes
        // minutes, and the connection can drop before it is done; by the next try the build has finished.
        let driver: Browser | undefined;
        for (let attempt = 1; !driver; attempt += 1) {
          try {
            driver = await open();
          } catch (error) {
            if (attempt === 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, 20_000));
          }
        }
        await use(driver);
        await driver.deleteSession();
      },
      { scope: 'worker', timeout: 30 * MINUTE },
    ],
    phone: async ({ browserOnPhone: driver, baseURL }, use, testInfo) => {
      await driver.url(baseURL ?? 'http://127.0.0.1:5199/');
      await driver.waitUntil(async () => (await driver.execute(() => document.querySelectorAll('g.hex').length)) > 0, { timeout: MINUTE, timeoutMsg: 'the demo did not draw its map' });
      await driver.execute(() => {
        // Room to scroll on any screen, as in the other phone projects.
        document.body.style.paddingBlock = '60vh';
        // The browser's console is out of reach from here, so the page keeps its own list of what went wrong.
        const errors: string[] = [];
        Object.assign(window, { errors });
        window.addEventListener('error', (event) => errors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
        const report = console.error.bind(console);
        console.error = (...parts: unknown[]) => {
          errors.push(parts.map(String).join(' '));
          report(...parts);
        };
      });
      // A picture of the screen is the only way to see what went wrong on a phone nobody is watching.
      const picture = async () => testInfo.attach('screen', { body: Buffer.from(await driver.takeScreenshot(), 'base64'), contentType: 'image/png' });
      const phone = await appiumPhone(driver).catch(async (error: unknown) => {
        await picture();
        throw error;
      });
      await use(phone);
      if (testInfo.status !== testInfo.expectedStatus) await picture();
      expect(await driver.execute(() => (window as unknown as { errors: string[] }).errors), 'errors the page logged').toEqual([]);
    },
  });

/** Mobile Safari on the iOS Simulator. This needs a Mac with Xcode, and Appium's XCUITest driver. */
export const iosTest = appiumTestWith({
  platformName: 'iOS',
  browserName: 'Safari',
  'appium:automationName': 'XCUITest',
  // The simulator to use: one by its id, or failing that by name. With neither, Appium picks.
  ...(process.env.IOS_UDID ? { 'appium:udid': process.env.IOS_UDID } : {}),
  ...(process.env.IOS_DEVICE ? { 'appium:deviceName': process.env.IOS_DEVICE } : {}),
  ...(process.env.IOS_VERSION ? { 'appium:platformVersion': process.env.IOS_VERSION } : {}),
  'appium:wdaLaunchTimeout': 20 * MINUTE,
  'appium:wdaConnectionTimeout': 20 * MINUTE,
  'appium:webviewConnectTimeout': MINUTE,
  // Touches are made by these tests, at places they choose. Appium must not turn clicks into its own.
  'appium:nativeWebTap': false,
  // Do not wait for Safari to fall idle before each touch: it adds seconds to every gesture.
  'appium:waitForIdleTimeout': 0,
  // Apple's own switch for tests: no tips. Safari's first-run tip otherwise takes the first touches.
  'appium:processArguments': { args: ['-com.apple.TipKit.HideAllTips', '1'] },
});

/**
 * Chrome for Android through Appium's UiAutomator2 driver. The android-screen project is a truer test of
 * Android; this one exists because it shares its code with iOS, which cannot be tried without a Mac.
 * The server needs `--allow-insecure uiautomator2:chromedriver_autodownload` to fetch a matching chromedriver.
 */
export const androidAppiumTest = appiumTestWith({
  platformName: 'Android',
  browserName: 'Chrome',
  'appium:automationName': 'UiAutomator2',
});
