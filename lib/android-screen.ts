// A phone whose glass is really touched, as far as Android can tell. Each frame of a gesture is written to
// the touchscreen's own input device, so a touch travels the whole way a finger's does: the kernel, Android's
// input system, Chrome's handling of the screen, and only then the page. It works on an emulator, and on a
// phone whose shell may write to its input devices.
import type { AndroidDevice, Page } from '@playwright/test';
import { FRAME_MS } from './phone';
import type { Frame, Phone, Point } from './phone';

/** Linux input event numbers, from input-event-codes.h. */
const EV_SYN = 0;
const EV_KEY = 1;
const EV_ABS = 3;
const SYN_REPORT = 0;
const BTN_TOUCH = 330;
const ABS_MT_SLOT = 47;
const ABS_MT_TOUCH_MAJOR = 48;
const ABS_MT_POSITION_X = 53;
const ABS_MT_POSITION_Y = 54;
const ABS_MT_TRACKING_ID = 57;
const ABS_MT_PRESSURE = 58;
/** Lifting a finger is giving its slot no tracking id: -1, as the unsigned number `sendevent` takes. */
const NO_FINGER = 4294967295;

interface Touchscreen {
  path: string;
  /** The largest x and y the device reports; the screen is spread across 0 to these. */
  maxX: number;
  maxY: number;
  pressure: boolean;
  touchMajor: boolean;
  button: boolean;
  /** The screen in pixels. */
  width: number;
  height: number;
}

/** Finds the touchscreen among the device's inputs: the first that reports multi-touch positions. */
async function findTouchscreen(device: AndroidDevice): Promise<Touchscreen> {
  const listing = (await device.shell('getevent -pl')).toString();
  const size = /(?:Override|Physical) size: (\d+)x(\d+)/.exec((await device.shell('wm size')).toString());
  if (!size) throw new Error('the device did not report its screen size');
  for (const entry of listing.split(/(?=add device \d+:)/)) {
    const path = /add device \d+: (\S+)/.exec(entry)?.[1];
    const maxX = /ABS_MT_POSITION_X\s*: value \d+, min \d+, max (\d+)/.exec(entry)?.[1];
    const maxY = /ABS_MT_POSITION_Y\s*: value \d+, min \d+, max (\d+)/.exec(entry)?.[1];
    if (!path || !maxX || !maxY) continue;
    return {
      path,
      maxX: Number(maxX),
      maxY: Number(maxY),
      pressure: entry.includes('ABS_MT_PRESSURE'),
      touchMajor: entry.includes('ABS_MT_TOUCH_MAJOR'),
      button: entry.includes('BTN_TOUCH'),
      width: Number(size[1]),
      height: Number(size[2]),
    };
  }
  throw new Error('the device has no multi-touch screen among its inputs');
}

export async function androidScreenPhone(device: AndroidDevice, page: Page): Promise<Phone> {
  const screen = await findTouchscreen(device);
  let touches = 0;

  /** The input events that take the glass from one frame to the next. Positions are screen pixels. */
  const step = (before: ReadonlyMap<number, Point>, now: ReadonlyMap<number, Point>): [number, number, number][] => {
    const events: [number, number, number][] = [];
    for (const [slot, point] of now) {
      const was = before.get(slot);
      if (was && was.x === point.x && was.y === point.y) continue;
      events.push([EV_ABS, ABS_MT_SLOT, slot]);
      if (!was) {
        touches += 1;
        events.push([EV_ABS, ABS_MT_TRACKING_ID, touches % 65535]);
        if (screen.touchMajor) events.push([EV_ABS, ABS_MT_TOUCH_MAJOR, 12]);
        if (screen.pressure) events.push([EV_ABS, ABS_MT_PRESSURE, 512]);
      }
      events.push([EV_ABS, ABS_MT_POSITION_X, Math.round(((point.x + 0.5) * (screen.maxX + 1)) / screen.width)]);
      events.push([EV_ABS, ABS_MT_POSITION_Y, Math.round(((point.y + 0.5) * (screen.maxY + 1)) / screen.height)]);
    }
    for (const slot of before.keys()) {
      if (!now.has(slot)) events.push([EV_ABS, ABS_MT_SLOT, slot], [EV_ABS, ABS_MT_TRACKING_ID, NO_FINGER]);
    }
    if (screen.button && before.size === 0 && now.size > 0) events.push([EV_KEY, BTN_TOUCH, 1]);
    if (screen.button && before.size > 0 && now.size === 0) events.push([EV_KEY, BTN_TOUCH, 0]);
    if (events.length > 0) events.push([EV_SYN, SYN_REPORT, 0]);
    return events;
  };

  /**
   * The shell command that writes a frame's events to the touchscreen in one go. Each event is the kernel's
   * `input_event` for a 64-bit system: sixteen bytes of time, which the kernel fills in, then type, code and value.
   * `echo` is built into the shell, so a frame costs a write and not a new process for every event.
   */
  const write = (events: readonly [number, number, number][]): string => {
    const bytes = Buffer.alloc(events.length * 24);
    events.forEach(([type, code, value], index) => {
      bytes.writeUInt16LE(type, index * 24 + 16);
      bytes.writeUInt16LE(code, index * 24 + 18);
      bytes.writeUInt32LE(value, index * 24 + 20);
    });
    return `echo -n -e '${[...bytes].map((byte) => `\\0${byte.toString(8).padStart(3, '0')}`).join('')}' >&3`;
  };

  /** Plays frames whose points are already screen pixels. */
  const play = async (frames: readonly ReadonlyMap<number, Point>[]): Promise<void> => {
    const pause = `sleep ${(FRAME_MS / 1000).toFixed(3)}`;
    const commands: string[] = [];
    let down: ReadonlyMap<number, Point> = new Map();
    for (const frame of [...frames, new Map<number, Point>()]) {
      const events = step(down, frame);
      if (events.length > 0) commands.push(write(events));
      commands.push(pause);
      down = frame;
    }
    const output = (await device.shell(`exec 3>${screen.path} && { ${commands.join('; ')}; }`)).toString().trim();
    if (output) throw new Error(`could not write to the touchscreen ${screen.path}: ${output}. Writing to it needs a root shell, which an emulator gives with \`adb root\`.`);
  };

  // Where the page sits on the screen. Chrome slides its address bar away as a page scrolls, so the top of
  // the page moves; its bottom edge and its left edge stay put, and one tap on an empty spot finds them.
  // The tap is made now, before the test has scrolled anywhere, because it needs the page at its top.
  const findEdges = async (): Promise<{ left: number; bottom: number }> => {
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      window.addEventListener('pointerdown', (event) => Object.assign(window, { felt: { x: event.clientX, y: event.clientY } }), { once: true, capture: true });
    });
    // The page starts with the empty padding `lendPhone` adds, so a tap a third of the way down hits nothing.
    const tapped = { x: Math.round(screen.width / 2), y: Math.round(screen.height / 3) };
    await play([new Map([[0, tapped]])]);
    const felt = await page.waitForFunction(() => (window as unknown as { felt?: Point }).felt, undefined, { timeout: 10_000 }).then((handle) => handle.jsonValue());
    if (!felt) throw new Error('the page did not feel a touch on the screen');
    const { height, scale } = await page.evaluate(() => ({ height: window.visualViewport?.height ?? window.innerHeight, scale: window.devicePixelRatio }));
    return { left: tapped.x - felt.x * scale, bottom: tapped.y + (height - felt.y) * scale };
  };
  const { left, bottom } = await findEdges();

  return {
    evaluate: <Result, Arg>(fn: (arg: Arg) => Result, arg?: Arg) => page.evaluate(fn as (arg: unknown) => Result, arg),
    async gesture(frames) {
      const { height, scale } = await page.evaluate(() => ({ height: window.visualViewport?.height ?? window.innerHeight, scale: window.devicePixelRatio }));
      const onScreen = (point: Point): Point => {
        const pixel = { x: Math.round(left + point.x * scale), y: Math.round(bottom - (height - point.y) * scale) };
        if (pixel.x < 0 || pixel.y < 0 || pixel.x >= screen.width || pixel.y >= screen.height) throw new Error(`a finger at ${point.x}, ${point.y} on the page would be off the ${screen.width} by ${screen.height} screen`);
        return pixel;
      };
      await play(frames.map((frame: Frame) => new Map(frame.flatMap((point, slot): [number, Point][] => (point ? [[slot, onScreen(point)]] : [])))));
      // Two display refreshes, so the page has drawn whatever the gesture changed.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
  };
}
