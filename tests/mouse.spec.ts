// The map under a mouse. These are the pointer behaviours the map had before fingers were tested,
// kept here so a change made for touch cannot quietly break them.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const state = (page: Page) =>
  page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('[data-testid="map"]');
    const viewport = document.querySelector<HTMLElement>('[data-testid="map-viewport"]');
    if (!map || !viewport) throw new Error('the map is not on the page');
    const ringed = (kind: string) => document.querySelector<SVGElement>(`[data-testid="hex-highlight"][data-kind="${kind}"]`)?.dataset.seat ?? null;
    return { zoom: Number(map.dataset.zoom), panX: Number(viewport.dataset.panX), panY: Number(viewport.dataset.panY), scrollY: window.scrollY, selected: ringed('selected'), pointed: ringed('pointed') };
  });

async function mapBox(page: Page) {
  const viewport = page.getByTestId('map-viewport');
  await viewport.scrollIntoViewIfNeeded();
  const found = await viewport.boundingBox();
  if (!found) throw new Error('the map is not on the page');
  return { ...found, right: found.x + found.width, bottom: found.y + found.height, centre: { x: found.x + found.width / 2, y: found.y + found.height / 2 } };
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await page.locator('g.hex').first().waitFor();
});

test.afterEach(() => {
  expect(errors, 'errors the page logged').toEqual([]);
});

test('pointing at a seat rings it, clicking selects it, and leaving clears the ring', async ({ page }) => {
  const bass = page.locator('[data-seat="Bass"] .hex-hit');
  await bass.hover();
  expect(await state(page)).toMatchObject({ pointed: 'Bass', selected: null });
  await bass.click();
  expect(await state(page)).toMatchObject({ selected: 'Bass', pointed: null });
  await page.mouse.move(2, 2);
  expect(await state(page)).toMatchObject({ selected: 'Bass', pointed: null });
});

test('dragging at 100% does not move the map', async ({ page }) => {
  const map = await mapBox(page);
  await page.mouse.move(map.centre.x, map.centre.y);
  await page.mouse.down();
  await page.mouse.move(map.centre.x - 120, map.centre.y - 60, { steps: 8 });
  await page.mouse.up();
  expect(await state(page)).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
});

test('dragging when zoomed in moves the map with the mouse and selects nothing', async ({ page }) => {
  await page.getByTestId('zoom-in').click();
  const map = await mapBox(page);
  await page.mouse.move(map.centre.x, map.centre.y);
  await page.mouse.down();
  await page.mouse.move(map.centre.x - 120, map.centre.y - 60, { steps: 8 });
  await page.mouse.up();
  expect(await state(page)).toMatchObject({ panX: -120, panY: -60, selected: null });
  await page.mouse.click(map.centre.x, map.centre.y);
  expect((await state(page)).selected, 'a click after the drag').not.toBeNull();
});

test('a drag released outside the map ends there', async ({ page }) => {
  await page.getByTestId('zoom-in').click();
  const map = await mapBox(page);
  await page.mouse.move(map.x + 60, map.centre.y);
  await page.mouse.down();
  await page.mouse.move(map.x - 40, map.centre.y, { steps: 8 });
  await page.mouse.up();
  const released = await state(page);
  expect(released.panX).toBe(-100);
  await page.mouse.move(map.centre.x, map.centre.y, { steps: 8 });
  expect(await state(page)).toMatchObject({ panX: released.panX, panY: released.panY });
});

test('a press that leaves the map before it becomes a drag is forgotten', async ({ page }) => {
  await page.getByTestId('zoom-in').click();
  const map = await mapBox(page);
  await page.mouse.move(map.x + 1, map.centre.y);
  await page.mouse.down();
  await page.mouse.move(map.x - 2, map.centre.y);
  await page.mouse.up();
  await page.mouse.move(map.centre.x, map.centre.y, { steps: 8 });
  expect(await state(page)).toMatchObject({ panX: 0, panY: 0 });
});

test('the wheel zooms only with Ctrl held', async ({ page }) => {
  const map = await mapBox(page);
  await page.mouse.move(map.centre.x, map.centre.y);
  await page.mouse.wheel(0, -100);
  expect((await state(page)).zoom).toBe(1);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await state(page)).zoom).toBeCloseTo(1.1, 3);
});
