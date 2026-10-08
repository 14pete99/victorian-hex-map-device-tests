// Reading the demo page: where things are on screen and what the map says about itself.
import type { Phone, Point } from './phone';

export interface MapState {
  /** The map's own zoom: 1 is 100%. */
  zoom: number;
  panX: number;
  panY: number;
  /** How far the page has scrolled, and how far the browser has magnified it (1 is not at all). */
  scrollY: number;
  pageScale: number;
  /** The seat ringed as selected, the seat ringed as pointed at, and the seat the card describes. */
  selected: string | null;
  pointed: string | null;
  card: string | null;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centre: Point;
}

export const MAP = '[data-testid="map-viewport"]';
export const seat = (name: string) => `[data-seat="${name}"] .hex-hit`;
export const control = (id: 'zoom-in' | 'zoom-out' | 'zoom-reset') => `[data-testid="${id}"]`;

export function mapState(phone: Phone): Promise<MapState> {
  return phone.evaluate(() => {
    const map = document.querySelector<HTMLElement>('[data-testid="map"]');
    const viewport = document.querySelector<HTMLElement>('[data-testid="map-viewport"]');
    if (!map || !viewport) throw new Error('the map is not on the page');
    const ringed = (kind: string) => document.querySelector<SVGElement>(`[data-testid="hex-highlight"][data-kind="${kind}"]`)?.dataset.seat ?? null;
    return {
      zoom: Number(map.dataset.zoom),
      panX: Number(viewport.dataset.panX),
      panY: Number(viewport.dataset.panY),
      scrollY: window.scrollY,
      pageScale: window.visualViewport?.scale ?? 1,
      selected: ringed('selected'),
      pointed: ringed('pointed'),
      card: document.querySelector<HTMLElement>('[data-testid="seat-card"]')?.dataset.seat ?? null,
    };
  });
}

/** Where an element is on screen right now. */
export function box(phone: Phone, selector: string): Promise<Box> {
  return phone.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) throw new Error(`nothing matches ${query}`);
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height, centre: { x: left + width / 2, y: top + height / 2 } };
  }, selector);
}

/** Scrolls an element to the middle of the screen and says where it ended up. */
export async function show(phone: Phone, selector: string): Promise<Box> {
  await phone.evaluate((query) => document.querySelector(query)?.scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  return box(phone, selector);
}

/** The seat drawn under a point on screen, if any. */
export function seatAt(phone: Phone, point: Point): Promise<string | null> {
  return phone.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest<SVGElement>('g.hex')?.dataset.seat ?? null, point);
}

export interface TouchesSeen {
  /** What the page heard, in order: milliseconds since it began listening, then the event. */
  log: string[];
  /** How far apart the first two fingers were when the second came down, and when either last moved. Null if two never met. */
  pinch: { first: number; last: number } | null;
  /** The least and the most the browser itself magnified the page while it was being touched. */
  magnified: { least: number; most: number };
}

/**
 * Has the page keep its own account of the touches it receives. A test sends fingers to exact places, but a
 * phone delivers them a little differently, a few pixels off or a moment late, and the map can only be judged
 * against what reached it.
 */
export function watchTouches(phone: Phone): Promise<void> {
  return phone.evaluate(() => {
    const log: string[] = [];
    const down = new Map<number, { x: number; y: number }>();
    const seen: { log: string[]; pinch: { first: number; last: number } | null; magnified: { least: number; most: number } } = { log, pinch: null, magnified: { least: 1, most: 1 } };
    let pair: [number, number] | null = null;
    const began = performance.now();
    const note = (text: string) => {
      if (log.length < 300) log.push(`${Math.round(performance.now() - began)} ${text}`);
    };
    const sample = () => {
      const scale = window.visualViewport?.scale ?? 1;
      seen.magnified.least = Math.min(seen.magnified.least, scale);
      seen.magnified.most = Math.max(seen.magnified.most, scale);
    };
    const apart = () => {
      const first = pair && down.get(pair[0]);
      const second = pair && down.get(pair[1]);
      return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : null;
    };
    const at = (event: PointerEvent) => `#${event.pointerId}${event.isPrimary ? '*' : ''} ${Math.round(event.clientX)},${Math.round(event.clientY)}`;
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType !== 'touch') return;
        if (event.isPrimary) {
          down.clear();
          pair = null;
        }
        down.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (down.size === 2 && !pair) {
          const [first, second] = down.keys();
          pair = [first, second];
          const distance = apart() ?? 0;
          seen.pinch = { first: distance, last: distance };
        }
        note(`down ${at(event)}`);
        sample();
      },
      true,
    );
    document.addEventListener(
      'pointermove',
      (event) => {
        if (!down.has(event.pointerId)) return;
        down.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const distance = pair?.includes(event.pointerId) ? apart() : null;
        if (seen.pinch && distance !== null) seen.pinch.last = distance;
        sample();
      },
      true,
    );
    for (const type of ['pointerup', 'pointercancel'] as const) {
      document.addEventListener(
        type,
        (event) => {
          if (!down.has(event.pointerId)) return;
          note(`${type === 'pointerup' ? 'up' : 'cancel'} ${at(event)}`);
          if (pair?.includes(event.pointerId)) pair = null;
          down.delete(event.pointerId);
          sample();
        },
        true,
      );
    }
    document.addEventListener('click', (event) => note(`click on ${(event.target as Element).closest<SVGElement>('g.hex')?.dataset.seat ?? (event.target as HTMLElement).dataset?.testid ?? (event.target as Element).tagName}`), true);
    window.visualViewport?.addEventListener('resize', sample);
    Object.assign(window, { touchesSeen: seen });
  });
}

/**
 * The page's account, carried back as text. Appium's iOS driver edits the objects a page returns: it deletes
 * any field called `scale`, among others, which is how a first version of this lost its magnification.
 */
export async function touchesSeen(phone: Phone): Promise<TouchesSeen> {
  return JSON.parse(await phone.evaluate(() => JSON.stringify((window as unknown as { touchesSeen: unknown }).touchesSeen))) as TouchesSeen;
}

/** The zoom's limits, as in the map's `ZOOM`. */
export const clampZoom = (zoom: number) => Math.min(4, Math.max(0.5, zoom));

/** How far the map may be panned at a zoom before it stops: the rule in HexMap's `settle`. */
export function panLimit(zoom: number, size: number): number {
  return ((zoom - 1) * size) / 2 + size * 0.25;
}
