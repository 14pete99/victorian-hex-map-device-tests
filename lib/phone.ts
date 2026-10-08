// What a test can do to a phone, whichever browser and driver is behind it.

/** A place on the screen: CSS pixels from the top left of the visible page. */
export interface Point {
  x: number;
  y: number;
}

/** One moment of a gesture: where each finger is, by finger number. `null` is a finger off the glass. */
export type Frame = readonly (Point | null)[];

export interface Phone {
  /** Runs a function in the page and returns what it returns. The function cannot see the test's variables. */
  evaluate<Result>(fn: () => Result): Promise<Result>;
  evaluate<Result, Arg>(fn: (arg: Arg) => Result, arg: Arg): Promise<Result>;
  /**
   * Plays a gesture one frame after another, a display refresh apart, then lifts every finger.
   * A finger that appears in a frame touches down there; one that turns `null` lifts.
   */
  gesture(frames: readonly Frame[]): Promise<void>;
}

/** Time between the frames of a gesture, in milliseconds: one refresh of a 60 Hz display. */
export const FRAME_MS = 16;
