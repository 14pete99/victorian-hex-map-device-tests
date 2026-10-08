// What a moving finger costs. A pan or a pinch changes only where the map sits and how big it is, so the
// page should do very little for each movement. When it instead redrew all 88 seats every time, the map
// trailed behind the finger on a phone and moved in jumps; every other test still passed, because they
// check where the map ends up and not how smoothly it got there.
import type { Browser, Page } from '@playwright/test';
import { expect, chromeTest as test } from '../lib/fixtures';
import { astride, dragFrames, offset, pinchFrames } from '../lib/gestures';
import { MAP, show } from '../lib/map-page';
import type { Frame, Phone } from '../lib/phone';

/** How much slower than this computer the processor is made to run: roughly a mid-range phone. */
const SLOWDOWN = 4;
/**
 * The most script time one movement may take, in milliseconds, at that speed. A display refresh is 16 ms.
 * The demo's development server measures about 7 for a pan and 3 for a pinch; redrawing every seat measured 48.
 */
const BUDGET_MS = 20;

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
}

/** Plays a gesture and returns the script time the page spent on each pointer movement, in milliseconds. */
async function scriptPerMove(phone: Phone, page: Page, browser: Browser, frames: Frame[]): Promise<number> {
  await page.evaluate(() => (window as unknown as { takeMoves: () => number }).takeMoves());
  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  await phone.gesture(frames);
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const moves = await page.evaluate(() => (window as unknown as { takeMoves: () => number }).takeMoves());
  expect(moves, 'pointer movements the page saw').toBeGreaterThan(20);
  const script = trace.traceEvents.filter((event) => event.name === 'FunctionCall' && event.ph === 'X').reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000;
  return script / moves;
}

test.describe('a moving finger', () => {
  // `phone` is asked for so that the demo is loaded before anything is added to its page.
  test.beforeEach(async ({ page, phone: _loaded }) => {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
    await page.evaluate(() => {
      let moves = 0;
      Object.assign(window, {
        takeMoves: () => {
          const seen = moves;
          moves = 0;
          return seen;
        },
      });
      document.addEventListener('pointermove', () => (moves += 1), true);
    });
  });

  test('costs little while it pans a zoomed map', async ({ phone, page, browser }, testInfo) => {
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-in').click();
    const map = await show(phone, MAP);
    const cost = await scriptPerMove(phone, page, browser, dragFrames(offset(map.centre, 60, 30), offset(map.centre, -60, -30), 30));
    testInfo.annotations.push({ type: 'script per movement', description: `${cost.toFixed(1)} ms` });
    expect(cost, `script time per movement while panning, in ms (budget ${BUDGET_MS})`).toBeLessThan(BUDGET_MS);
  });

  test('costs little while it pinches', async ({ phone, page, browser }, testInfo) => {
    const map = await show(phone, MAP);
    const cost = await scriptPerMove(phone, page, browser, pinchFrames(astride(map.centre, 60), astride(map.centre, 180), 30));
    testInfo.annotations.push({ type: 'script per movement', description: `${cost.toFixed(1)} ms` });
    expect(cost, `script time per movement while pinching, in ms (budget ${BUDGET_MS})`).toBeLessThan(BUDGET_MS);
  });
});
