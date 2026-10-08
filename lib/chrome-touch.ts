// A phone made of desktop Chrome: touch input goes in through the DevTools protocol, so the page
// receives trusted touch and pointer events from the same engine Chrome for Android uses.
import type { Page } from '@playwright/test';
import { FRAME_MS } from './phone';
import type { Frame, Phone, Point } from './phone';

export async function chromeTouchPhone(page: Page): Promise<Phone> {
  const session = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: ReadonlyMap<number, Point>) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers].map(([id, point]) => ({ x: point.x, y: point.y, id })) });

  return {
    evaluate: <Result, Arg>(fn: (arg: Arg) => Result, arg?: Arg) => page.evaluate(fn as (arg: unknown) => Result, arg),
    async gesture(frames) {
      let down = new Map<number, Point>();
      for (const frame of frames) {
        const now = new Map(frame.flatMap((point, id): [number, Point][] => (point ? [[id, point]] : [])));
        // A touchEnd naming some fingers lifts those and leaves the rest down; naming none lifts them all.
        const lifted = new Map([...down].filter(([id]) => !now.has(id)));
        if (lifted.size > 0) await send('touchEnd', now.size > 0 ? lifted : new Map());
        if (now.size > 0) await send([...now.keys()].some((id) => !down.has(id)) ? 'touchStart' : 'touchMove', now);
        down = now;
        await page.waitForTimeout(FRAME_MS);
      }
      if (down.size > 0) await send('touchEnd', new Map());
      // Two display refreshes, so the page has drawn whatever the gesture changed.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
  };
}
