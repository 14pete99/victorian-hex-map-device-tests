// Gestures as lists of frames. Nothing here knows which browser will play them.
import type { Frame, Phone, Point } from './phone';

/** Frames a gesture holds still for before the fingers lift, so the browser sees no flick to carry on from. */
const HOLD = 4;
const STEPS = 12;

export const offset = (point: Point, dx: number, dy: number): Point => ({ x: point.x + dx, y: point.y + dy });

/** Points from one place to another, both ends included. */
export function line(from: Point, to: Point, steps = STEPS): Point[] {
  return Array.from({ length: steps + 1 }, (_, step) => ({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }));
}

/** Two fingers side by side, `gap` pixels apart, either side of a point. */
export const astride = (centre: Point, gap: number): [Point, Point] => [offset(centre, -gap / 2, 0), offset(centre, gap / 2, 0)];

const held = (frame: Frame): Frame[] => Array.from({ length: HOLD }, () => frame);

/** One finger moving from one place to another. */
export function dragFrames(from: Point, to: Point, steps = STEPS): Frame[] {
  const frames = line(from, to, steps).map((point): Frame => [point]);
  return [...frames, ...held(frames[frames.length - 1])];
}

/** Two fingers moving from one pair of places to another. */
export function pinchFrames(from: readonly [Point, Point], to: readonly [Point, Point], steps = STEPS): Frame[] {
  const first = line(from[0], to[0], steps);
  const second = line(from[1], to[1], steps);
  const frames = first.map((point, step): Frame => [point, second[step]]);
  return [...frames, ...held(frames[frames.length - 1])];
}

export const tap = (phone: Phone, at: Point) => phone.gesture([[at], [at]]);
export const drag = (phone: Phone, from: Point, to: Point, steps = STEPS) => phone.gesture(dragFrames(from, to, steps));
export const pinch = (phone: Phone, from: readonly [Point, Point], to: readonly [Point, Point], steps = STEPS) => phone.gesture(pinchFrames(from, to, steps));
