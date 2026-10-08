# Phone gesture tests

Taps, drags and pinches on the Victorian hexagon map, sent as real touch input and checked against what the map reports about itself.

This folder is not part of the map repository. The map's `.gitignore` leaves it out, it has its own `package.json`, and nothing here runs from the map's `npm test` or its CI.

## Run

```bash
npm install
npm test               # desktop Chrome: the touch scenarios and the mouse checks
npm run typecheck
```

The tests start the map's demo themselves, on port 5199, from the folder above this one. Two environment variables change that:

| Variable | Meaning |
| --- | --- |
| `MAP_REPO` | Path to a checkout of the map, when it is not the parent folder |
| `MAP_URL` | Address of a demo that is already running; nothing is started |

Chrome must be installed. Playwright drives the installed Chrome and downloads no browser of its own.

## Android

```bash
npm run android:start   # boot the emulator with no window; creates the virtual phone the first time
npm run test:android    # the touch scenarios, twice: see the projects below
npm run android:status  # what is running, with its Android and Chrome versions
npm run android:stop
```

These need the Android SDK. Copy `.env.example` to `.env` and fill in where it is.

| Variable | Meaning |
| --- | --- |
| `ANDROID_HOME` | The SDK folder. It needs the `emulator`, `platform-tools` and `cmdline-tools;latest` packages and one system image. |
| `ANDROID_AVD_HOME` | Where virtual phones are kept |
| `JAVA_HOME` | A JDK, version 17 or later. Only creating the virtual phone uses it. |

The virtual phone is a Pixel 8 running the image `system-images;android-36;google_apis;x86_64`. A "Google APIs" image is needed for two reasons: it has Chrome, and it lets `adb root` run, which writing to the touchscreen requires. A "Google Play" image has Chrome but refuses `adb root`. `ANDROID_AVD`, `ANDROID_IMAGE` and `ANDROID_PROFILE` choose a different phone.

A real phone listed by `adb devices` works for `android-chrome`. It will not work for `android-screen` unless its shell may write to its input devices, which a phone off the shelf does not allow.

## iOS

The iOS Simulator runs only on a Mac, so these tests run on one of GitHub's. The workflow in `.github/workflows/ios.yml` checks out the map, boots an iPhone simulator, and runs the touch scenarios in Mobile Safari. It runs only when started by hand:

```bash
gh workflow run ios.yml -f map_ref=main      # or the Actions tab: "iOS Safari", "Run workflow"
gh run watch                                 # follow it
gh run download --name ios-safari-results    # Appium's log, and a picture of the screen for each failure
```

| Input | Meaning |
| --- | --- |
| `map_ref` | Branch, tag or commit of the map repository to test. `main` unless given. |
| `grep` | Run only the tests whose names match this |

A run takes about twenty minutes of a GitHub-hosted Mac, most of it building Apple's test runner. Be sparing with them: try a change through `android-appium` on the emulator first, which runs the same Appium code and costs nothing.

On a Mac of your own, with Xcode installed:

```bash
npm install --global appium
appium driver install xcuitest
appium &                 # leave it running
npm run test:ios
```

`IOS_UDID` names the simulator to use; without it, `IOS_DEVICE` and `IOS_VERSION` do, and without those Appium chooses. `APPIUM_URL` says where Appium is, if not `http://127.0.0.1:4723`.

## Projects

| Project | Browser | Input |
| --- | --- | --- |
| `chrome-touch` | Desktop Chrome at a phone's screen size | Trusted touch, sent through the DevTools protocol |
| `chrome-mouse` | Desktop Chrome | Mouse, to show a change made for fingers has not broken the desktop |
| `android-chrome` | Chrome for Android | Trusted touch, sent through the DevTools protocol |
| `android-screen` | Chrome for Android | Touches written to the device's touchscreen |
| `ios-safari` | Mobile Safari on the iOS Simulator | Touches made on the simulator's screen by Apple's test framework, through Appium |
| `android-appium` | Chrome for Android | Touches made by Android's test framework, through Appium |
| `unit` | None | Checks of the test code itself |

What each one is worth:

- **`chrome-touch`** runs in seconds and uses the engine Chrome for Android uses, so it catches mistakes in how the map handles touch. It is not Android: there is no address bar, no pull-to-refresh and no system gestures.
- **`android-chrome`** is the real browser. Its touches still enter through Chrome's debugging protocol, which reads gestures slightly differently from Chrome's handling of the screen. One difference is known: two quick taps on a button with no `touch-action` are read as a double-tap that magnifies the page, which the same taps on the screen are not.
- **`android-screen`** is the closest to a finger. Each frame of a gesture is written to the touchscreen's input device, so a touch passes through the kernel, Android's input system and Chrome's handling of the screen before the page hears of it.
- **`ios-safari`** is the only one that is Safari, and Safari differs. It found that a tap which makes a link appear gets no click, which left four seats impossible to select on an iPhone and which no other project could show. It is a simulator driven by Apple's test framework, with two limits. A finger that lands after another arrives as a touch, a lift and a touch again. And a third finger is reported under shuffled identities, so that scenario is left out here.
- **`android-appium`** is not needed to test Android; `android-screen` does that better. It exists because it runs the same Appium code as `ios-safari`, which cannot be tried without a Mac. It needs an Appium server with the `uiautomator2` driver, started with `--allow-insecure uiautomator2:chromedriver_autodownload`, and it leaves out four scenarios Appium's Android driver cannot play (the project's entry in `playwright.config.ts` says why).

## How the tests are written

- `lib/phone.ts` is the whole of what a test may do to a phone: run a function in the page, and play a gesture. A gesture is a list of frames, each saying where every finger is.
- `lib/chrome-touch.ts` plays those frames through the DevTools protocol, `lib/android-screen.ts` writes them to an Android touchscreen, and `lib/appium-phone.ts` hands them to Appium. Another browser needs only another file like them.
- `lib/gestures.ts` builds taps, drags and pinches out of frames. `lib/map-page.ts` reads the demo.
- `scenarios/touch.ts` holds the gestures. It names no browser, and each file in `tests/` hands it one kind of phone.
- A phone does not put fingers exactly where a test sends them. So the page keeps its own account of the touches it receives (`watchTouches` in `lib/map-page.ts`), a pinch is judged against that, and a failing test prints it.

A test never dispatches an event from a script. Scripted events skip the browser's own scrolling, pinch-zoom and tap handling, and those are what the tests are for.
