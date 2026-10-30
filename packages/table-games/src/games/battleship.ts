import { isIndex, isRecord, otherSeat, refuse, type Choice, type MoveResult, type Outcome, type Seat, type TableGame } from "../TableGame.js";

export const BATTLESHIP_SIZE = 10;

export const FLEET = [
  { id: "carrier", name: "Carrier", size: 5 },
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser", name: "Cruiser", size: 3 },
  { id: "submarine", name: "Submarine", size: 3 },
  { id: "destroyer", name: "Destroyer", size: 2 },
] as const;

export type ShipId = (typeof FLEET)[number]["id"];

export interface ShipPlacement {
  readonly row: number;
  readonly column: number;
  // Across runs to the right of (row, column); otherwise down from it.
  readonly isAcross: boolean;
}

export interface Ship {
  readonly id: ShipId;
  readonly name: string;
  readonly size: number;
  // null until placed; in a view, also for an enemy ship that is still afloat.
  readonly at: ShipPlacement | null;
  readonly isSunk: boolean;
}

export type Shot = "hit" | "miss";

export interface Fleet {
  readonly ships: readonly Ship[];
  // The shots fired at this fleet, [row][column].
  readonly shots: readonly (readonly (Shot | null)[])[];
  readonly isReady: boolean;
}

export interface BattleshipState {
  // Both players place their ships at once, then take turns firing.
  readonly phase: "placing" | "firing";
  readonly fleets: readonly [Fleet, Fleet];
  readonly turn: Seat;
  readonly outcome: Outcome | null;
  readonly lastShot: { readonly seat: Seat; readonly row: number; readonly column: number; readonly shot: Shot; readonly sank: string | null } | null;
}

// A view has the same shape: what is hidden is an enemy ship's `at`, until it sinks.
export type BattleshipView = BattleshipState;

export type BattleshipMove =
  | { readonly kind: "place"; readonly ship: ShipId; readonly row: number; readonly column: number; readonly isAcross: boolean }
  | { readonly kind: "autoPlace" }
  | { readonly kind: "ready" }
  | { readonly kind: "fire"; readonly row: number; readonly column: number };

export function shipCells(size: number, { row, column, isAcross }: ShipPlacement): [number, number][] {
  return Array.from({ length: size }, (_, index): [number, number] => (isAcross ? [row, column + index] : [row + index, column]));
}

// Whether `ship` fits at `placement`: on the board and clear of the fleet's other ships.
export function fitsAt(fleet: Fleet, ship: ShipId, placement: ShipPlacement): boolean {
  const size = FLEET.find((candidate) => candidate.id === ship)?.size ?? 0;
  const taken = new Set(
    fleet.ships.filter((other) => other.id !== ship && other.at).flatMap((other) => shipCells(other.size, other.at!).map(([r, c]) => r * BATTLESHIP_SIZE + c)),
  );
  return shipCells(size, placement).every(([r, c]) => isIndex(r, BATTLESHIP_SIZE) && isIndex(c, BATTLESHIP_SIZE) && !taken.has(r * BATTLESHIP_SIZE + c));
}

function emptyFleet(): Fleet {
  return {
    ships: FLEET.map(({ id, name, size }) => ({ id, name, size, at: null, isSunk: false })),
    shots: Array.from({ length: BATTLESHIP_SIZE }, () => Array<Shot | null>(BATTLESHIP_SIZE).fill(null)),
    isReady: false,
  };
}

function withFleet(state: BattleshipState, seat: Seat, fleet: Fleet): BattleshipState {
  const fleets: [Fleet, Fleet] = [...state.fleets];
  fleets[seat] = fleet;
  return { ...state, fleets };
}

function placeShip(fleet: Fleet, ship: ShipId, at: ShipPlacement): Fleet {
  return { ...fleet, ships: fleet.ships.map((candidate) => (candidate.id === ship ? { ...candidate, at } : candidate)) };
}

function autoPlace(random: () => number): Fleet {
  let fleet = emptyFleet();
  // Largest first: a random spot that fits is found within a few tries. If the tries run out
  // (a poor source of randomness), the first spot that fits is taken, so this always ends.
  for (const { id } of FLEET) {
    const isPlaced = (): boolean => fleet.ships.find((ship) => ship.id === id)!.at !== null;
    for (let attempt = 0; attempt < 200 && !isPlaced(); attempt++) {
      const at = { row: Math.floor(random() * BATTLESHIP_SIZE), column: Math.floor(random() * BATTLESHIP_SIZE), isAcross: random() < 0.5 };
      if (fitsAt(fleet, id, at)) fleet = placeShip(fleet, id, at);
    }
    for (let spot = 0; spot < 2 * BATTLESHIP_SIZE * BATTLESHIP_SIZE && !isPlaced(); spot++) {
      const at = { row: Math.floor(spot / 2 / BATTLESHIP_SIZE), column: Math.floor(spot / 2) % BATTLESHIP_SIZE, isAcross: spot % 2 === 0 };
      if (fitsAt(fleet, id, at)) fleet = placeShip(fleet, id, at);
    }
  }
  return fleet;
}

function fire(state: BattleshipState, seat: Seat, row: number, column: number): MoveResult<BattleshipState> {
  const target = state.fleets[otherSeat(seat)];
  if (target.shots[row][column]) return refuse("You have already fired there");
  const hitShip = target.ships.find((ship) => shipCells(ship.size, ship.at!).some(([r, c]) => r === row && c === column));
  const shots = target.shots.map((cells) => [...cells]);
  shots[row][column] = hitShip ? "hit" : "miss";
  const isSunk = (ship: Ship): boolean => shipCells(ship.size, ship.at!).every(([r, c]) => shots[r][c] === "hit");
  const ships = target.ships.map((ship) => (ship === hitShip ? { ...ship, isSunk: isSunk(ship) } : ship));
  const sank = hitShip && !hitShip.isSunk && isSunk(hitShip) ? hitShip.name : null;
  const isFleetSunk = ships.every((ship) => ship.isSunk);
  // One shot a turn, hit or miss, as in Milton Bradley's rules.
  return {
    ok: true,
    state: {
      ...withFleet(state, otherSeat(seat), { ...target, ships, shots }),
      turn: otherSeat(seat),
      outcome: isFleetSunk ? { winners: [seat], summary: "The whole fleet is sunk" } : null,
      lastShot: { seat, row, column, shot: hitShip ? "hit" : "miss", sank },
    },
  };
}

function readMove(move: unknown): BattleshipMove | null {
  if (!isRecord(move)) return null;
  switch (move.kind) {
    case "place":
      if (!FLEET.some((ship) => ship.id === move.ship) || !Number.isInteger(move.row) || !Number.isInteger(move.column) || typeof move.isAcross !== "boolean") return null;
      return { kind: "place", ship: move.ship as ShipId, row: move.row as number, column: move.column as number, isAcross: move.isAcross };
    case "fire":
      if (!isIndex(move.row, BATTLESHIP_SIZE) || !isIndex(move.column, BATTLESHIP_SIZE)) return null;
      return { kind: "fire", row: move.row, column: move.column };
    case "autoPlace":
    case "ready":
      return { kind: move.kind };
    default:
      return null;
  }
}

function hiddenFleet(fleet: Fleet): Fleet {
  return { ...fleet, ships: fleet.ships.map((ship) => (ship.isSunk ? ship : { ...ship, at: null })) };
}

export const battleship: TableGame<BattleshipState, BattleshipView> = {
  id: "battleship",
  title: "Battleship",
  description: "Hide five ships, then hunt down the other fleet.",
  family: "board",
  minPlayers: 2,
  maxPlayers: 2,
  strategy:
    "Sink all five enemy ships first. Players take one shot each in turn. After a hit, fire at the squares next to it to find which way the ship lies, and follow the line until it sinks. Otherwise spread shots in a checkerboard pattern, since every ship is at least two squares long.",

  start: () => ({ phase: "placing", fleets: [emptyFleet(), emptyFleet()], turn: 0, outcome: null, lastShot: null }),

  play(state, seat, rawMove, random): MoveResult<BattleshipState> {
    if (state.outcome) return refuse("The game is over");
    const move = readMove(rawMove);
    if (!move) return refuse("That is not a Battleship move");
    const fleet = state.fleets[seat];
    if (move.kind === "fire") {
      if (state.phase !== "firing") return refuse("The ships are still being placed");
      if (seat !== state.turn) return refuse("Not your turn");
      return fire(state, seat, move.row, move.column);
    }
    if (state.phase !== "placing" || fleet.isReady) return refuse("Your ships are already placed");
    switch (move.kind) {
      case "place": {
        const at = { row: move.row, column: move.column, isAcross: move.isAcross };
        if (!fitsAt(fleet, move.ship, at)) return refuse("The ship does not fit there");
        return { ok: true, state: withFleet(state, seat, placeShip(fleet, move.ship, at)) };
      }
      case "autoPlace":
        return { ok: true, state: withFleet(state, seat, autoPlace(random)) };
      case "ready": {
        if (!fleet.ships.every((ship) => ship.at)) return refuse("Place every ship first");
        const next = withFleet(state, seat, { ...fleet, isReady: true });
        return { ok: true, state: next.fleets.every((each) => each.isReady) ? { ...next, phase: "firing", turn: 0 } : next };
      }
    }
  },

  // Once the game is over, both fleets are shown.
  viewFor(state, seat): BattleshipView {
    if (state.outcome) return state;
    const fleets: [Fleet, Fleet] = [
      seat === 0 ? state.fleets[0] : hiddenFleet(state.fleets[0]),
      seat === 1 ? state.fleets[1] : hiddenFleet(state.fleets[1]),
    ];
    return { ...state, fleets };
  },

  toMove(state) {
    if (state.outcome) return [];
    if (state.phase === "placing") return ([0, 1] as const).filter((seat) => !state.fleets[seat].isReady);
    return [state.turn];
  },
  outcome: (state) => state.outcome,

  // Hunt and target: next to a hit on a ship not yet sunk, along its line if two hits show it;
  // otherwise on a checkerboard, where every ship (two squares or more) must touch.
  simpleStrategy(view, seat, choices, random) {
    if (view.phase !== "firing") return choices[0];
    const target = view.fleets[otherSeat(seat)];
    const sunkCells = new Set(target.ships.filter((ship) => ship.isSunk && ship.at).flatMap((ship) => shipCells(ship.size, ship.at!).map(([r, c]) => r * BATTLESHIP_SIZE + c)));
    const isOpenHit = (row: number, column: number): boolean =>
      isIndex(row, BATTLESHIP_SIZE) && isIndex(column, BATTLESHIP_SIZE) && target.shots[row][column] === "hit" && !sunkCells.has(row * BATTLESHIP_SIZE + column);
    const score = (choice: Choice): number => {
      const { row, column } = choice.move as { row: number; column: number };
      let value = (row + column) % 2 === 0 ? 1 : 0;
      for (const [rowStep, columnStep] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (!isOpenHit(row + rowStep, column + columnStep)) continue;
        value += 10;
        // Two hits in a line: the ship lies along it.
        if (isOpenHit(row + 2 * rowStep, column + 2 * columnStep)) value += 10;
      }
      return value + random();
    };
    return [...choices].sort((a, b) => score(b) - score(a))[0];
  },

  choices(state, seat): Choice[] {
    if (state.outcome) return [];
    if (state.phase === "placing") {
      if (state.fleets[seat].isReady) return [];
      return state.fleets[seat].ships.every((ship) => ship.at)
        ? [{ move: { kind: "ready" }, label: "ready: the ships are placed" }]
        : [{ move: { kind: "autoPlace" }, label: "place the ships at random" }];
    }
    if (seat !== state.turn) return [];
    const shots = state.fleets[otherSeat(seat)].shots;
    const choices: Choice[] = [];
    for (let row = 0; row < BATTLESHIP_SIZE; row++) {
      for (let column = 0; column < BATTLESHIP_SIZE; column++) {
        if (!shots[row][column]) choices.push({ move: { kind: "fire", row, column }, label: `fire at ${"ABCDEFGHIJ"[row]}${column + 1}` });
      }
    }
    return choices;
  },
};
