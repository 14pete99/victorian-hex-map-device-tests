// The translation from frames to WebDriver actions, checked without a browser. iOS runs only on a Mac,
// so a mistake here would otherwise show up a quarter of an hour into a run on someone else's computer.
import { expect, test } from '@playwright/test';
import { FRAME_MS } from '../lib/phone';
import type { Frame } from '../lib/phone';
import { toActions } from '../lib/w3c-actions';

const same = (point: { x: number; y: number }) => point;
const kinds = (frames: Frame[]) => toActions(frames, same).map((source) => source.actions.map((action) => action.type).join(' '));

test('a tap is a move to the place, a press, a rest and a lift', () => {
  const [finger] = toActions([[{ x: 10, y: 20 }], [{ x: 10, y: 20 }]], same);
  expect(finger.parameters.pointerType).toBe('touch');
  expect(finger.actions).toEqual([
    { type: 'pointerMove', duration: 0, x: 10, y: 20 },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: FRAME_MS },
    { type: 'pointerUp', button: 0 },
  ]);
});

test('two fingers moving together stay in step, tick for tick', () => {
  const sources = toActions([[{ x: 0, y: 0 }, { x: 50, y: 0 }], [{ x: -10, y: 0 }, { x: 60, y: 0 }], [{ x: -20, y: 0 }, { x: 70, y: 0 }]], same);
  expect(sources.map((source) => source.actions.map((action) => action.type))).toEqual([
    ['pointerMove', 'pointerDown', 'pointerMove', 'pointerMove', 'pointerUp'],
    ['pointerMove', 'pointerDown', 'pointerMove', 'pointerMove', 'pointerUp'],
  ]);
});

test('a finger that lands later waits, is placed in the tick before, and presses in its own frame', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 50, y: 0 };
  const [first, second] = toActions([[a, null], [a, null], [a, b], [a, b]], same);
  expect(first.actions.map((action) => action.type)).toEqual(['pointerMove', 'pointerDown', 'pause', 'pause', 'pause', 'pointerUp']);
  // ticks:                                                        place          frame 0  frame 1        frame 2        frame 3  lift
  expect(second.actions.map((action) => action.type)).toEqual(['pause', 'pause', 'pointerMove', 'pointerDown', 'pause', 'pointerUp']);
  expect(second.actions[2]).toEqual({ type: 'pointerMove', duration: FRAME_MS, x: 50, y: 0 });
});

test('a finger that lifts early lifts in the frame it leaves', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 50, y: 0 };
  expect(kinds([[a, b], [a, b], [a, null], [a, null]])).toEqual(['pointerMove pointerDown pause pause pause pointerUp', 'pointerMove pointerDown pause pointerUp']);
});

test('a finger that comes down twice is two touches, the second waiting for the first', () => {
  const a = { x: 5, y: 5 };
  const sources = toActions([[a], [a], [null], [null], [a], [a]], same);
  expect(sources.map((source) => source.id)).toEqual(['finger0touch0', 'finger0touch1']);
  expect(kinds([[a], [a], [null], [null], [a], [a]])).toEqual(['pointerMove pointerDown pause pointerUp', 'pause pause pause pause pointerMove pointerDown pause pointerUp']);
});

test('places are passed through the screen mapping', () => {
  const [finger] = toActions([[{ x: 10, y: 20 }]], (point) => ({ x: point.x + 0.26, y: point.y * 2 }));
  expect(finger.actions[0]).toMatchObject({ x: 10.3, y: 40 });
});
