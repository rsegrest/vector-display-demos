// The Quest's controllers as the keys and pointer Vector OS already takes.
//
// Right hand: the ray is the mouse; the trigger is its button.
// Left hand: the arcade cabinet's controls, as keys:
//   thumbstick left / right   ArrowLeft / ArrowRight (turn, steer)
//   thumbstick up / down      ArrowUp / ArrowDown (thrust, dive)
//   trigger                   Space (fire)
//   grip                      Shift (shields, hyperspace)
//   X                         the coin key of the game in front (1; Tempest's is 5)
//   Y                         Enter (start)
// Right hand's A is Enter too, and B is 2 (two players).
// Battlezone (its cabinet scheme, a stick per tread): the left thumbstick's up/down is the left
// tread (W / S), the right thumbstick's up/down the right tread (ArrowUp / ArrowDown).
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

/** Each game's coin key, where it is not 1 (the games' own bindings). */
const COIN_KEYS: Readonly<Record<string, string>> = { tempest: "5" };

/** The coin key for the program in front (by its id), 1 for every game but those listed. */
export function coinKeyFor(programId: string | null): string {
  return (programId && COIN_KEYS[programId]) || "1";
}

/** How the controllers play the program in front. */
export interface ControlProfile {
  readonly coinKey: string;
  /** A thumbstick per tread (Battlezone), instead of the left stick as arrows. */
  readonly treads: boolean;
}

export function profileFor(programId: string | null): ControlProfile {
  return { coinKey: coinKeyFor(programId), treads: programId === "battlezone" };
}

/** The keys each hand holds down now, given which it held before (for the thumbstick's hysteresis). */
export function heldKeys(state: ControllerState, before: ReadonlySet<string>, profile: ControlProfile = { coinKey: "1", treads: false }): Set<string> {
  const held = new Set<string>();
  const p = (i: number) => state.pressed[i] === true;
  const [x, y] = state.stick;
  const axis = (value: number, key: string) => {
    if (value > STICK_ON || (before.has(key) && value > STICK_OFF)) held.add(key);
  };
  const coinKey = profile.coinKey;
  if (state.hand === "left") {
    if (profile.treads) {
      axis(-y, "w");
      axis(y, "s");
    } else {
      axis(-x, "ArrowLeft");
      axis(x, "ArrowRight");
      axis(-y, "ArrowUp");
      axis(y, "ArrowDown");
    }
    if (p(0)) held.add(" ");
    if (p(1)) held.add("Shift");
    if (p(4)) held.add(coinKey);
    if (p(5)) held.add("Enter");
  } else if (state.hand === "right") {
    if (profile.treads) {
      axis(-y, "ArrowUp");
      axis(y, "ArrowDown");
    }
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
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  return key;
}
