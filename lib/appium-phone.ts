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
    // Every kind of event a touch can cause is noted, so a tap that goes unfelt can still say what did arrive.
    const heard: string[] = [];
    Object.assign(window, { heard });
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'mousedown', 'click']) {
      window.addEventListener(type, (event) => heard.push(`${type}@${Math.round((event as MouseEvent).clientX ?? -1)},${Math.round((event as MouseEvent).clientY ?? -1)}`), true);
    }
    window.addEventListener('pointerdown', (event) => Object.assign(window, { felt: { x: event.clientX, y: event.clientY } }), { once: true, capture: true });
    return window.devicePixelRatio;
  });
  const unit = driver.isAndroid ? scale : 1;
  const size = await natively(() => driver.getWindowRect());
  const tapped = { x: Math.round(size.width / 2), y: Math.round(size.height / 3) };
  const press = (frames: number) => play(toActions(Array.from({ length: frames }, () => [tapped]), (point) => point, APPIUM_FRAME_MS));
  // Three ways to tap, tried in turn until the page feels one: a tenth of a second on the glass, the phone's
  // own tap command where there is one, and a third of a second on the glass. A browser opened for the first
  // time may also have a tip or a prompt on the screen, so whatever offers to be closed is closed first.
  const ways: [string, () => Promise<unknown>][] = [
    ['a touch of 100 ms', () => press(3)],
    ['the phone\'s own tap', () => (driver.isIOS ? natively(() => driver.execute('mobile: tap', { x: tapped.x, y: tapped.y })) : press(3))],
    ['a touch of 300 ms', () => press(7)],
  ];
  let felt: Point | null = null;
  const tried: string[] = [];
  for (const [name, tap] of ways) {
    if (felt) break;
    await natively(() => closeWhatIsInTheWay(driver));
    await tap().catch((error: unknown) => tried.push(`${name} failed: ${String(error).split('\n')[0]}`));
    for (let look = 0; look < 20 && !felt; look += 1) {
      felt = await driver.execute(() => (window as unknown as { felt?: Point }).felt ?? null);
      if (!felt) await driver.pause(100);
    }
    tried.push(`${name}: ${felt ? 'felt' : 'not felt'}`);
  }
  const heard = await driver.execute(() => ({ events: (window as unknown as { heard: string[] }).heard, focused: document.hasFocus(), visible: document.visibilityState, width: window.innerWidth, height: window.innerHeight }));
  console.log(`Finding the page on the screen: tapped ${tapped.x},${tapped.y} of ${size.width}x${size.height}. ${tried.join('; ')}. The page heard ${JSON.stringify(heard)}`);
  if (!felt) throw new Error(`the page did not feel a touch on the screen (${tried.join('; ')}). It heard ${JSON.stringify(heard)}`);
  const origin = felt;
  const onScreen = (point: Point): Point => ({ x: tapped.x + (point.x - origin.x) * unit, y: tapped.y + (point.y - origin.y) * unit });

  return {
    // The function travels as its source text, as it does in the other phones.
    evaluate: <Result, Arg>(fn: (arg: Arg) => Result, arg?: Arg) => driver.execute(`return (${String(fn)}).apply(null, arguments)`, arg) as Promise<Result>,
    async gesture(frames) {
      // A touch shorter than about a tenth of a second can go unnoticed by a phone, so a gesture of one or
      // two frames, which is to say a tap, is held for three.
      const held = frames.length > 0 && frames.length < 3 ? [...frames, ...Array.from({ length: 3 - frames.length }, () => frames[frames.length - 1])] : frames;
      await play(toActions(held, onScreen, APPIUM_FRAME_MS));
      // Long enough for the browser to have drawn whatever the gesture changed.
      await driver.pause(80);
    },
  };
}
