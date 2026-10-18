// The Quest's controllers as the keys and pointer Vector OS already takes.
//
// Right hand: the ray is the mouse; the trigger is its button.
// Left hand: the arcade cabinet's controls, as keys:
//   thumbstick left / right   ArrowLeft / ArrowRight (turn, steer)
//   thumbstick up / down      ArrowUp / ArrowDown (thrust, dive)
//   trigger                   Space (fire)
//   grip                      Shift (shields, hyperspace)
//   X                         1 (coin)
//   Y                         Enter (start)
// Right hand's A is Enter too, and B is 2 (two players).
// Pure: it takes button states and gives key edges, so it is tested without a headset.

export interface ControllerState {
  /** "left" or "right". */
  readonly hand: string;
  /** buttons[i].pressed, in the xr-standard order: 0 trigger, 1 grip, 3 thumbstick press, 4 A/X, 5 B/Y. */
  readonly pressed: readonly boolean[];
  /** axes[2], axes[3]: the thumbstick, x right, y down. */
  readonly stick: readonly [number, number];
}

export interface KeyEdge {
  readonly key: string;
  readonly down: boolean;
}

const STICK_ON = 0.5;
const STICK_OFF = 0.35;

/** The keys each hand holds down now, given which it held before (for the thumbstick's hysteresis). */
export function heldKeys(state: ControllerState, before: ReadonlySet<string>): Set<string> {
  const held = new Set<string>();
  const p = (i: number) => state.pressed[i] === true;
  if (state.hand === "left") {
    const [x, y] = state.stick;
    const axis = (value: number, key: string) => {
      if (value > STICK_ON || (before.has(key) && value > STICK_OFF)) held.add(key);
    };
    axis(-x, "ArrowLeft");
    axis(x, "ArrowRight");
    axis(-y, "ArrowUp");
    axis(y, "ArrowDown");
    if (p(0)) held.add(" ");
    if (p(1)) held.add("Shift");
    if (p(4)) held.add("1");
    if (p(5)) held.add("Enter");
  } else if (state.hand === "right") {
    if (p(4)) held.add("Enter");
    if (p(5)) held.add("2");
  }
  return held;
}

/** What changed between two sets of held keys: releases first, then presses. */
export function keyEdges(before: ReadonlySet<string>, now: ReadonlySet<string>): KeyEdge[] {
  const edges: KeyEdge[] = [];
  for (const key of before) if (!now.has(key)) edges.push({ key, down: false });
  for (const key of now) if (!before.has(key)) edges.push({ key, down: true });
  return edges;
}

/** A KeyboardEvent's code for a key, as the OS's handlers take both. */
export function codeOf(key: string): string {
  if (key === " ") return "Space";
  if (key === "Shift") return "ShiftLeft";
  if (key === "Enter") return "Enter";
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}
