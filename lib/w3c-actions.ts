// A gesture's frames as WebDriver "actions", the form Appium takes touches in.
import { FRAME_MS } from './phone';
import type { Frame, Point } from './phone';

export interface PointerAction {
  type: 'pointerMove' | 'pointerDown' | 'pointerUp' | 'pause';
  duration?: number;
  x?: number;
  y?: number;
  button?: number;
}

export interface PointerSource {
  type: 'pointer';
  id: string;
  parameters: { pointerType: 'touch' };
  actions: PointerAction[];
}

/**
 * Translates frames into one source of actions per touch. A finger that lifts and comes down again is two
 * sources, because whatever plays these gives each source one unbroken path across the glass.
 *
 * The sources keep in step by taking one action per tick. Tick 0 places the fingers that start the gesture,
 * tick n + 1 is frame n, and a last tick lifts whatever is still down. A finger is placed in the tick before
 * it touches, where the move costs nothing because it is not yet on the glass.
 */
export function toActions(frames: readonly Frame[], onScreen: (point: Point) => Point, frameMs = FRAME_MS): PointerSource[] {
  const sources: PointerSource[] = [];
  const fingers = Math.max(0, ...frames.map((frame) => frame.length));
  const at = (frame: number, finger: number) => frames[frame]?.[finger] ?? null;
  const place = (point: Point) => {
    const { x, y } = onScreen(point);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  };
  /** How long a tick lasts: nothing for the placing tick, a frame for the rest. */
  const lasts = (tick: number) => (tick === 0 ? 0 : frameMs);

  for (let finger = 0; finger < fingers; finger += 1) {
    let touch = 0;
    for (let start = 0; start < frames.length; start += 1) {
      const first = at(start, finger);
      if (!first || at(start - 1, finger)) continue;
      // The touch runs from frame `start` to the frame before `end`.
      let end = start + 1;
      while (at(end, finger)) end += 1;

      const actions: PointerAction[] = [];
      for (let tick = 0; tick < start; tick += 1) actions.push({ type: 'pause', duration: lasts(tick) });
      actions.push({ type: 'pointerMove', duration: lasts(start), ...place(first) });
      actions.push({ type: 'pointerDown', button: 0 });
      for (let frame = start + 1; frame < end; frame += 1) {
        const now = at(frame, finger) as Point;
        const before = at(frame - 1, finger) as Point;
        actions.push(now.x === before.x && now.y === before.y ? { type: 'pause', duration: frameMs } : { type: 'pointerMove', duration: frameMs, ...place(now) });
      }
      actions.push({ type: 'pointerUp', button: 0 });
      sources.push({ type: 'pointer', id: `finger${finger}touch${touch}`, parameters: { pointerType: 'touch' }, actions });
      touch += 1;
      start = end;
    }
  }
  return sources;
}
