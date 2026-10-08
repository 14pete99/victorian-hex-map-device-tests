import { defineConfig } from '@playwright/test';

// A .env file here holds this computer's own settings, such as where the Android SDK is.
try {
  process.loadEnvFile();
} catch {
  // No .env file: the environment is used as it stands.
}

// The page under test is the map's demo. By default it is served from the map repository this
// folder sits in; MAP_REPO points at another checkout, and MAP_URL at a demo that is already running.
const PORT = 5199;
const MAP_REPO = process.env.MAP_REPO ?? '..';
const MAP_URL = process.env.MAP_URL ?? `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: 'tests',
  // Gestures are timed, so tests take turns rather than compete for the processor.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: { baseURL: MAP_URL, trace: 'retain-on-failure' },
  webServer: process.env.MAP_URL
    ? undefined
    : {
        // --strictPort: the tests must never talk to some other server that happens to hold the port.
        command: `npm run dev -- --port ${PORT} --strictPort`,
        cwd: MAP_REPO,
        url: MAP_URL,
        reuseExistingServer: false,
      },
  projects: [
    {
      // Desktop Chrome told it is a phone, with touch input sent through the DevTools protocol.
      name: 'chrome-touch',
      testMatch: /chrome-touch\.spec\.ts$/,
      use: { channel: 'chrome', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      // The same map under a mouse, so a fix for fingers cannot break the desktop.
      name: 'chrome-mouse',
      testMatch: /mouse\.spec\.ts$/,
      use: { channel: 'chrome', viewport: { width: 1280, height: 800 } },
    },
    {
      // Chrome for Android on an emulator or phone, with the same protocol touch input as chrome-touch.
      name: 'android-chrome',
      testMatch: /android-chrome\.spec\.ts$/,
    },
    {
      // Chrome for Android again, with every touch written to the device's touchscreen.
      name: 'android-screen',
      testMatch: /android-screen\.spec\.ts$/,
    },
    {
      // Mobile Safari on the iOS Simulator, through Appium. Mac only; each gesture takes a second or two.
      name: 'ios-safari',
      testMatch: /ios-safari\.spec\.ts$/,
      timeout: 180_000,
    },
    {
      // Chrome for Android through Appium: a way to try the code iOS uses without a Mac.
      name: 'android-appium',
      testMatch: /android-appium\.spec\.ts$/,
      timeout: 180_000,
      // Appium's Android driver reports one finger lifting before another as the whole touch ending. Android
      // rejects that, and then every touch after it until the device restarts. android-screen runs these four.
      grepInvert: /lifts one finger of two|lifting one and carrying on|only touches during a drag|a third finger/,
    },
    {
      // Checks of the test code itself, with no browser.
      name: 'unit',
      testMatch: /\.unit\.spec\.ts$/,
    },
  ],
});
