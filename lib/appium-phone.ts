// A phone driven through Appium. The page is read in the browser's web context; touches are made in the
// native one, where the phone's own test framework puts fingers on the screen, so the browser receives
// them the way it receives a person's.
import type { Browser } from 'webdriverio';
import type { Phone, Point } from './phone';
import { toActions } from './w3c-actions';
import type { PointerSource } from './w3c-actions';

const NATIVE = 'NATIVE_APP';
/**
 * How long each frame of a gesture lasts here, in milliseconds. The phones' own frameworks turn a list of
 * timed moves into touches themselves, and Android's muddles moves that are a display refresh apart.
 */
const APPIUM_FRAME_MS = 50;

/**
 * Presses any button on the screen that closes something. Safari on a new iPhone opens with a tip about its
 * menus, in a bubble that takes every touch until it is closed. Called in the native context.
 */
async function closeWhatIsInTheWay(driver: Browser): Promise<void> {
  if (!driver.isIOS) return;
  const buttons = await driver.$$('-ios predicate string:type == "XCUIElementTypeButton" AND (label ==[c] "Close" OR label ==[c] "Dismiss" OR label ==[c] "Close tip")');
  for (const button of buttons) await button.click().catch(() => undefined);
}

export async function appiumPhone(driver: Browser): Promise<Phone> {
  const web = String(await driver.getAppiumContext());

  /** Runs something with the whole screen as its subject, then returns to the page. */
  const natively = async <Result>(task: () => Promise<Result>): Promise<Result> => {
    await driver.switchAppiumContext(NATIVE);
    try {
      return await task();
    } finally {
      await driver.switchAppiumContext(web);
    }
  };
  const play = (sources: PointerSource[]) =>
    natively(async () => {
      await driver.performActions(sources);
      // Every source ends with its finger lifted, so there is nothing left to release; some drivers object to being asked.
      await driver.releaseActions().catch(() => undefined);
    });

  // Where the page sits on the screen, and how many of the screen's units one of its pixels covers. iOS
  // counts its screen in points, which a page's pixels equal while the page is not magnified; Android
  // counts in device pixels. One tap on an empty spot, compared with where the page felt it, gives the rest.
  // The page starts with the empty padding the fixture adds, so a tap a third of the way down hits nothing.
  const scale = await driver.execute(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.addEventListener('pointerdown', (event) => Object.assign(window, { felt: { x: event.clientX, y: event.clientY } }), { once: true, capture: true });
    return window.devicePixelRatio;
  });
  const unit = driver.isAndroid ? scale : 1;
  const size = await natively(() => driver.getWindowRect());
  const tapped = { x: Math.round(size.width / 2), y: Math.round(size.height / 3) };
  let felt: Point | null = null;
  // A browser opened for the first time may have a tip or a prompt of its own on the screen, and the first
  // touch can go to closing it. So the tap is made up to three times, closing whatever offers to be closed.
  for (let tap = 0; tap < 3 && !felt; tap += 1) {
    await natively(() => closeWhatIsInTheWay(driver));
    await play(toActions([[tapped], [tapped]], (point) => point));
    for (let look = 0; look < 20 && !felt; look += 1) {
      felt = await driver.execute(() => (window as unknown as { felt?: Point }).felt ?? null);
      if (!felt) await driver.pause(100);
    }
  }
  if (!felt) throw new Error(`the page did not feel a touch on the screen. What the screen held:\n${await natively(() => driver.getPageSource()).catch(() => '(could not be read)')}`);
  const origin = felt;
  const onScreen = (point: Point): Point => ({ x: tapped.x + (point.x - origin.x) * unit, y: tapped.y + (point.y - origin.y) * unit });

  return {
    // The function travels as its source text, as it does in the other phones.
    evaluate: <Result, Arg>(fn: (arg: Arg) => Result, arg?: Arg) => driver.execute(`return (${String(fn)}).apply(null, arguments)`, arg) as Promise<Result>,
    async gesture(frames) {
      await play(toActions(frames, onScreen, APPIUM_FRAME_MS));
      // Long enough for the browser to have drawn whatever the gesture changed.
      await driver.pause(80);
    },
  };
}
