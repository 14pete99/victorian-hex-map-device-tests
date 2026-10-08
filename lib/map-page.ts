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

/** How far the map may be panned at a zoom before it stops: the rule in HexMap's `settle`. */
export function panLimit(zoom: number, size: number): number {
  return ((zoom - 1) * size) / 2 + size * 0.25;
}
