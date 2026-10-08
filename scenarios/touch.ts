// What fingers should be able to do to the map. Every gesture here is real touch input, never a
// scripted event, so the browser's own scrolling, pinch-zoom and tap handling all take part.
import { expect, expectNear } from '../lib/fixtures';
import type { PhoneTest } from '../lib/fixtures';
import { astride, drag, dragFrames, offset, pinch, pinchFrames, tap } from '../lib/gestures';
import { MAP, box, clampZoom, control, mapState, panLimit, seat, seatAt, show, touchesSeen, watchTouches } from '../lib/map-page';
import type { Frame, Phone, Point } from '../lib/phone';

/** Taps the zoom-in button: 130%, then 169%. */
async function zoomInTwice(phone: Phone): Promise<void> {
  const button = await show(phone, control('zoom-in'));
  await tap(phone, button.centre);
  await tap(phone, button.centre);
  const after = await mapState(phone);
  expectNear(after.zoom, 1.69, 0.001, 'zoom after two taps on zoom-in');
  expect(after.pageScale, 'two quick taps must not double-tap-zoom the page').toBe(1);
}

/** A frame repeated, for a finger that rests where it is. */
const rest = (frame: Frame, frames = 5): Frame[] => Array.from({ length: frames }, () => frame);

/**
 * Checks a pinch against what the page received. The map's zoom must be the zoom it had, times however far the
 * page saw the two fingers spread. The browser must not have magnified the page itself at any moment. And the
 * fingers must have gone roughly where they were sent, or the test proves nothing.
 */
async function expectPinched(phone: Phone, zoomBefore: number, sent: number): Promise<void> {
  const seen = await touchesSeen(phone);
  if (!seen.pinch) throw new Error('the page did not see two fingers down together');
  const spread = seen.pinch.last / seen.pinch.first;
  expectNear((await mapState(phone)).zoom, clampZoom(zoomBefore * spread), 0.05, `zoom, from ${zoomBefore} with the fingers seen to spread ${spread.toFixed(3)} times`);
  expectNear(spread, sent, sent * 0.1, 'how far the page saw the fingers spread, against how far they were sent');
  expect(seen.scale, 'how much the browser magnified the page itself during the touch').toEqual({ min: 1, max: 1 });
}

/** Declares the touch tests on a `test` whose `phone` is whichever phone the project drives. */
export function touchScenarios(test: PhoneTest): void {
  test.beforeEach(async ({ phone }) => {
    await watchTouches(phone);
  });

  // When a test fails, the page's own account of the touches it received says what the phone actually did.
  test.afterEach(async ({ phone }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const seen = await touchesSeen(phone).catch(() => null);
    if (seen) console.log(`What the page heard in "${testInfo.title}": ${seen.log.join(' | ')} || two fingers: ${JSON.stringify(seen.pinch)} || page magnified: ${JSON.stringify(seen.scale)}`);
  });

  test.describe('the test phone', () => {
    test('sends trusted touch input to a page that believes it is on a phone', async ({ phone }) => {
      await phone.evaluate(() => {
        const seen: string[] = [];
        Object.assign(window, { seen });
        // Browsers disagree on what kind of event a click is, so only the two pointer events say what made them.
        for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, (event) => seen.push(`${type} by ${(event as PointerEvent).pointerType}, trusted ${event.isTrusted}`), true);
        for (const type of ['touchstart', 'touchend', 'click']) document.addEventListener(type, (event) => seen.push(`${type}, trusted ${event.isTrusted}`), true);
      });
      const map = await show(phone, MAP);
      await tap(phone, map.centre);
      const heard = () => phone.evaluate(() => (window as unknown as { seen: string[] }).seen);
      // A click can follow the touch that caused it by a moment.
      await expect.poll(async () => (await heard()).at(-1), { timeout: 3000 }).toBe('click, trusted true');
      const seen = await heard();
      expect(seen.filter((entry) => entry.startsWith('pointer'))).toEqual(['pointerdown by touch, trusted true', 'pointerup by touch, trusted true']);
      expect(seen.filter((entry) => entry.startsWith('touch'))).toEqual(['touchstart, trusted true', 'touchend, trusted true']);
      expect(seen[seen.length - 1]).toBe('click, trusted true');
      expect(seen).toHaveLength(5);
      expect(await phone.evaluate(() => matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0)).toBe(true);
    });

    test('lifts one finger of two without lifting the other', async ({ phone }) => {
      await phone.evaluate(() => {
        const seen: string[] = [];
        Object.assign(window, { seen });
        for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, (event) => seen.push(`${type}:${(event as PointerEvent).isPrimary ? 'first' : 'second'}`), true);
      });
      const map = await show(phone, MAP);
      const [left, right] = astride(map.centre, 100);
      await phone.gesture([[left, right], [left, right], [left, null], [left, null]]);
      const seen = await phone.evaluate(() => (window as unknown as { seen: string[] }).seen);
      expect(seen).toEqual(['pointerdown:first', 'pointerdown:second', 'pointerup:second', 'pointerup:first']);
    });
  });

  test.describe('a tap', () => {
    test('selects the seat under the finger and fills the seat card', async ({ phone }) => {
      await show(phone, MAP);
      await tap(phone, (await box(phone, seat('Bass'))).centre);
      expect(await mapState(phone)).toMatchObject({ selected: 'Bass', card: 'Bass', pointed: null, zoom: 1, panX: 0, panY: 0 });
    });

    test('on another seat moves the selection and leaves no pointed-at ring behind', async ({ phone }) => {
      await show(phone, MAP);
      await tap(phone, (await box(phone, seat('Bass'))).centre);
      await tap(phone, (await box(phone, seat('Mildura'))).centre);
      expect(await mapState(phone)).toMatchObject({ selected: 'Mildura', card: 'Mildura', pointed: null });
    });

    test('works the zoom buttons', async ({ phone }) => {
      await zoomInTwice(phone);
      await tap(phone, (await show(phone, control('zoom-out'))).centre);
      expectNear((await mapState(phone)).zoom, 1.3, 0.001, 'zoom after zoom-out');
      await tap(phone, (await show(phone, control('zoom-reset'))).centre);
      expect(await mapState(phone)).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
    });
  });

  test.describe('two quick taps on a zoom button', () => {
    /** One finger tapping twice within a fifth of a second or so, which a browser may read as a double-tap. */
    const tapTwice = (phone: Phone, at: Point) => phone.gesture([...rest([at], 3), ...rest([null], 4), ...rest([at], 3)]);

    test('are two presses, and the page is not magnified', async ({ phone }) => {
      const button = await show(phone, control('zoom-in'));
      await tapTwice(phone, button.centre);
      const after = await mapState(phone);
      expectNear(after.zoom, 1.69, 0.001, 'zoom');
      expect(after.pageScale).toBe(1);
    });
  });

  test.describe('one finger at 100%', () => {
    test('swiping up over the map scrolls the page and leaves the map alone', async ({ phone }) => {
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      await drag(phone, offset(map.centre, 0, 100), offset(map.centre, 0, -100));
      const after = await mapState(phone);
      expect(after.scrollY - before.scrollY, 'how far the page scrolled').toBeGreaterThan(100);
      expect(after).toMatchObject({ zoom: 1, panX: 0, panY: 0, pageScale: 1, selected: null, pointed: null });
    });

    test('swiping sideways does not move the map or select a seat', async ({ phone }) => {
      const map = await show(phone, MAP);
      await drag(phone, offset(map.centre, 100, 0), offset(map.centre, -100, 0));
      expect(await mapState(phone)).toMatchObject({ zoom: 1, panX: 0, panY: 0, pageScale: 1, selected: null, pointed: null });
    });
  });

  test.describe('one finger when zoomed in', () => {
    test('dragging moves the map as far as the finger moved, and the page stays put', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      await drag(phone, offset(map.centre, 60, 40), offset(map.centre, -40, -20));
      const after = await mapState(phone);
      expectNear(after.panX, -100, 1, 'pan across');
      expectNear(after.panY, -60, 1, 'pan down');
      expect(after).toMatchObject({ scrollY: before.scrollY, pageScale: 1, zoom: before.zoom });
    });

    test('a drag selects nothing and leaves no pointed-at ring', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      expect(await seatAt(phone, offset(map.centre, 60, 40)), 'the drag starts on a seat').not.toBeNull();
      await drag(phone, offset(map.centre, 60, 40), offset(map.centre, -40, -20));
      expect(await mapState(phone)).toMatchObject({ selected: null, pointed: null, card: null });
    });

    test('a tap after a drag selects the seat now under the finger', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      await drag(phone, offset(map.centre, 60, 40), offset(map.centre, -40, -20));
      const under = await seatAt(phone, map.centre);
      expect(under).not.toBeNull();
      await tap(phone, map.centre);
      expect(await mapState(phone)).toMatchObject({ selected: under, card: under });
    });

    test('a drag that ends outside the map follows the finger all the way', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      const from = { x: map.centre.x, y: map.top + 30 };
      await drag(phone, from, offset(from, 0, -90));
      const after = await mapState(phone);
      expectNear(after.panY, -90, 1, 'pan down');
      await tap(phone, map.centre);
      expect((await mapState(phone)).selected, 'a tap after the drag').not.toBeNull();
    });

    test('the map stops at its limit however far the finger goes', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      await drag(phone, { x: map.right - 10, y: map.centre.y }, { x: 6, y: map.centre.y }, 24);
      const after = await mapState(phone);
      expectNear(after.panX, -panLimit(after.zoom, map.width), 1, 'pan across at the limit');
    });
  });

  test.describe('two fingers', () => {
    test('spreading them at 100% zooms the map, not the page', async ({ phone }) => {
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      await pinch(phone, astride(map.centre, 80), astride(map.centre, 200));
      await expectPinched(phone, 1, 200 / 80);
      expect(await mapState(phone)).toMatchObject({ pageScale: 1, scrollY: before.scrollY, selected: null, pointed: null });
    });

    test('pinching them together zooms back out, and below 100% the map is centred again', async ({ phone }) => {
      const map = await show(phone, MAP);
      await pinch(phone, astride(map.centre, 80), astride(map.centre, 200));
      await drag(phone, offset(map.centre, 40, 0), offset(map.centre, -40, 0));
      const zoomedIn = await mapState(phone);
      expectNear(zoomedIn.panX, -80, 1, 'pan across before pinching in');
      await pinch(phone, astride(map.centre, 250), astride(map.centre, 80));
      await expectPinched(phone, zoomedIn.zoom, 80 / 250);
      const after = await mapState(phone);
      expect(after.zoom, 'zoom after pinching in').toBeLessThan(1);
      expect(after).toMatchObject({ panX: 0, panY: 0, pageScale: 1 });
    });

    test('the zoom stops at 400% and at 50%', async ({ phone }) => {
      const map = await show(phone, MAP);
      await pinch(phone, astride(map.centre, 40), astride(map.centre, 300));
      expect((await mapState(phone)).zoom).toBe(4);
      await pinch(phone, astride(map.centre, 300), astride(map.centre, 30));
      await pinch(phone, astride(map.centre, 300), astride(map.centre, 30));
      expect(await mapState(phone)).toMatchObject({ zoom: 0.5, panX: 0, panY: 0, pageScale: 1 });
    });

    test('the seat between the fingers stays between them', async ({ phone }) => {
      // A seat off the middle of the map, so the map has to move as well as grow, but far enough from
      // the edge of the screen that both fingers stay on the glass.
      const map = await show(phone, MAP);
      const name = await seatAt(phone, offset(map.centre, 25, -70));
      if (!name) throw new Error('no seat up and to the right of the middle of the map');
      const before = (await box(phone, seat(name))).centre;
      await pinch(phone, astride(before, 60), astride(before, 180));
      const after = (await box(phone, seat(name))).centre;
      await expectPinched(phone, 1, 180 / 60);
      expectNear(after.x, before.x, 2, 'the seat across the screen');
      expectNear(after.y, before.y, 2, 'the seat down the screen');
    });

    test('moving both the same way when zoomed in moves the map with them', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      await pinch(phone, astride(offset(map.centre, 30, 20), 120), astride(offset(map.centre, -20, -10), 120));
      const after = await mapState(phone);
      await expectPinched(phone, before.zoom, 1);
      expectNear(after.panX, -50, 2, 'pan across');
      expectNear(after.panY, -30, 2, 'pan down');
      expect(after).toMatchObject({ scrollY: before.scrollY, pageScale: 1 });
    });

    test('lifting one and carrying on with the other pans from where the pinch left the map', async ({ phone }) => {
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      const [left, right] = astride(map.centre, 200);
      await phone.gesture([
        ...pinchFrames(astride(map.centre, 80), [left, right]),
        ...dragFrames(left, offset(left, -40, -30)).map(([finger]) => [finger, null]),
      ]);
      const after = await mapState(phone);
      await expectPinched(phone, 1, 200 / 80);
      expectNear(after.panX, -40, 2, 'pan across');
      expectNear(after.panY, -30, 2, 'pan down');
      expect(after).toMatchObject({ scrollY: before.scrollY, pageScale: 1, selected: null, pointed: null });
    });

    test('a second finger that lands after the first has rested still makes a pinch', async ({ phone }) => {
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      const [left, right] = astride(map.centre, 80);
      await phone.gesture([...rest([left, null]), ...pinchFrames([left, right], astride(map.centre, 200))]);
      await expectPinched(phone, 1, 200 / 80);
      expect(await mapState(phone)).toMatchObject({ pageScale: 1, scrollY: before.scrollY, selected: null, pointed: null });
    });

    test('a second finger that lands while the first has drifted a little still makes a pinch', async ({ phone }) => {
      const map = await show(phone, MAP);
      const before = await mapState(phone);
      const [left, right] = astride(map.centre, 80);
      const drifted = offset(left, -3, 3);
      await phone.gesture([[left, null], [offset(left, -1, 1), null], [offset(left, -2, 2), null], [drifted, null], ...pinchFrames([drifted, right], astride(map.centre, 200))]);
      await expectPinched(phone, 1, 200 / Math.hypot(right.x - drifted.x, right.y - drifted.y));
      expect(await mapState(phone)).toMatchObject({ pageScale: 1, scrollY: before.scrollY, selected: null, pointed: null });
    });

    test('a second finger that only touches during a drag does not make the map jump', async ({ phone }) => {
      await zoomInTwice(phone);
      const map = await show(phone, MAP);
      const start = offset(map.centre, 40, 30);
      const middle = offset(start, -50, -20);
      const end = offset(middle, -30, -25);
      const other = offset(map.centre, 90, -60);
      await phone.gesture([
        ...dragFrames(start, middle),
        ...rest([middle, other]),
        ...dragFrames(middle, end).map(([finger]): Frame => [finger, null]),
      ]);
      const after = await mapState(phone);
      // Two fingers that both stay still are a pinch of no size: the zoom keeps to what it was.
      await expectPinched(phone, 1.69, 1);
      expectNear(after.panX, -80, 2, 'pan across');
      expectNear(after.panY, -45, 2, 'pan down');
      expect(after).toMatchObject({ pageScale: 1, selected: null, pointed: null });
    });

    test('touching two seats without moving selects neither', async ({ phone }) => {
      await show(phone, MAP);
      const first = (await box(phone, seat('Mildura'))).centre;
      const second = (await box(phone, seat('Bass'))).centre;
      await phone.gesture(rest([first, second]));
      expect(await mapState(phone)).toMatchObject({ zoom: 1, panX: 0, panY: 0, pageScale: 1, selected: null, pointed: null });
    });

    test('a tap straight after a pinch selects a seat', async ({ phone }) => {
      const map = await show(phone, MAP);
      await pinch(phone, astride(map.centre, 80), astride(map.centre, 200));
      const under = await seatAt(phone, map.centre);
      expect(under).not.toBeNull();
      await tap(phone, map.centre);
      expect(await mapState(phone)).toMatchObject({ selected: under, card: under });
    });

    test('a third finger changes nothing, and the map still works when all three have lifted', async ({ phone }) => {
      const map = await show(phone, MAP);
      const [left, right] = astride(map.centre, 80);
      const [wideLeft, wideRight] = astride(map.centre, 200);
      const third = offset(map.centre, 0, 80);
      await phone.gesture([
        ...pinchFrames([left, right], [wideLeft, wideRight]),
        ...rest([wideLeft, wideRight, third]),
        ...dragFrames(third, offset(third, 40, 20)).map(([finger]): Frame => [wideLeft, wideRight, finger]),
      ]);
      const after = await mapState(phone);
      await expectPinched(phone, 1, 200 / 80);
      expectNear(after.panX, 0, 2, 'pan across');
      expectNear(after.panY, 0, 2, 'pan down');
      expect(after).toMatchObject({ pageScale: 1, selected: null, pointed: null });
      await tap(phone, map.centre);
      expect((await mapState(phone)).selected, 'a tap after three fingers').not.toBeNull();
    });

    test('after pinching back below 100% a swipe scrolls the page again', async ({ phone }) => {
      const map = await show(phone, MAP);
      await pinch(phone, astride(map.centre, 80), astride(map.centre, 200));
      await pinch(phone, astride(map.centre, 250), astride(map.centre, 80));
      const before = await mapState(phone);
      await drag(phone, offset(map.centre, 0, 100), offset(map.centre, 0, -100));
      const after = await mapState(phone);
      expect(after.scrollY - before.scrollY, 'how far the page scrolled').toBeGreaterThan(100);
      expect(after).toMatchObject({ zoom: before.zoom, panX: 0, panY: 0 });
    });
  });
}
