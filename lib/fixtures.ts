// The `phone` a touch test is handed: the demo, loaded and ready, behind one browser or another.
import { expect, test as base } from '@playwright/test';
import type { Page, TestType } from '@playwright/test';
import { chromeTouchPhone } from './chrome-touch';
import type { Phone } from './phone';

/** A `test` that hands each test a phone. The touch scenarios are written against this and nothing narrower. */
export type PhoneTest = TestType<{ phone: Phone }, object>;

/** Loads the demo in a page, lends out a phone that drives it, then fails the test if the page logged an error. */
export async function lendPhone(page: Page, url: string, make: (page: Page) => Promise<Phone>, use: (phone: Phone) => Promise<void>): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.locator('g.hex').first().waitFor();
  // Room to scroll on any screen: a tall phone shows the whole demo, and a page that cannot scroll
  // cannot show whether a swipe over the map scrolls it.
  await page.evaluate(() => {
    document.body.style.paddingBlock = '60vh';
  });
  await use(await make(page));
  expect(errors, 'errors the page logged').toEqual([]);
}

/** Desktop Chrome, made phone-sized and touch-capable by the project's `use` options. */
export const chromeTest = base.extend<{ phone: Phone }>({
  phone: async ({ page, baseURL }, use) => lendPhone(page, baseURL ?? '/', chromeTouchPhone, use),
});

export { expect };

/** Passes when two numbers are within a tolerance of each other; pixels are rarely exact. */
export function expectNear(actual: number, expected: number, tolerance: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: got ${actual}, expected ${expected} within ${tolerance}`).toBeLessThanOrEqual(tolerance);
}
