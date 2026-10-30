import type { BeamColor } from "@vector-display/core";
import {
  BATTLESHIP_SIZE,
  CHECKERS_SIZE,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  FLEET,
  fitsAt,
  landingRow,
  legalCheckersMoves,
  shipCells,
  type BattleshipMove,
  type BattleshipView,
  type CheckersMove,
  type CheckersState,
  type ConnectFourState,
  type Fleet,
  type GameInfo,
  type Seat,
  type ShipId,
  type Square,
} from "@vector-demos/table-games";
import type { Rect, Ui } from "./Ui.js";

export const SEAT_COLORS: Readonly<Record<"connect4" | "checkers", readonly [BeamColor, BeamColor]>> = {
  connect4: [
    { red: 1, green: 0.35, blue: 0.3 },
    { red: 1, green: 0.9, blue: 0.3 },
  ],
  checkers: [
    { red: 1, green: 0.35, blue: 0.3 },
    { red: 0.85, green: 0.9, blue: 1 },
  ],
};
export const GRID_COLOR: BeamColor = { red: 0.35, green: 0.6, blue: 1 };
const SHIP_COLOR: BeamColor = { red: 0.5, green: 1, blue: 0.85 };
const HIT_COLOR: BeamColor = { red: 1, green: 0.55, blue: 0.25 };
const MISS_COLOR: BeamColor = { red: 0.45, green: 0.6, blue: 0.9 };
const LABEL_COLOR: BeamColor = { red: 0.6, green: 0.85, blue: 1 };

// What the window remembers about a board between clicks, which the room never hears about.
export interface BoardChoices {
  // Checkers: the piece picked up, waiting for where it goes.
  checkersFrom: Square | null;
  // Battleship: the ship being placed and which way it lies.
  shipToPlace: ShipId;
  isAcross: boolean;
}

export function freshChoices(): BoardChoices {
  return { checkersFrom: null, shipToPlace: FLEET[0].id, isAcross: true };
}

type Send = (move: unknown) => void;

// The largest square grid of `columns` by `rows` cells that fits in `area`, centered.
function gridIn(area: Rect, columns: number, rows: number): { readonly x: number; readonly y: number; readonly cell: number } {
  const cell = Math.floor(Math.min(area.width / columns, area.height / rows));
  return { x: area.x + (area.width - cell * columns) / 2, y: area.y + (area.height - cell * rows) / 2, cell };
}

export function drawConnectFour(ui: Ui, area: Rect, info: GameInfo, mySeat: Seat | null, send: Send): void {
  const state = info.view as ConnectFourState;
  const grid = gridIn(area, CONNECT_FOUR_COLUMNS, CONNECT_FOUR_ROWS);
  const colors = SEAT_COLORS.connect4;
  const myTurn = mySeat !== null && info.turn === mySeat;
  const isWinning = (row: number, column: number): boolean => state.winningCells.some(([r, c]) => r === row && c === column);

  ui.rect(GRID_COLOR, 0.6, { x: grid.x, y: grid.y, width: grid.cell * CONNECT_FOUR_COLUMNS, height: grid.cell * CONNECT_FOUR_ROWS });
  for (let column = 0; column < CONNECT_FOUR_COLUMNS; column++) {
    const columnRect = { x: grid.x + column * grid.cell, y: grid.y, width: grid.cell, height: grid.cell * CONNECT_FOUR_ROWS };
    const canDrop = myTurn && landingRow(state.board, column) >= 0;
    const isAimed = canDrop && ui.isHovered(columnRect);
    for (let row = 0; row < CONNECT_FOUR_ROWS; row++) {
      const centerX = columnRect.x + grid.cell / 2;
      const centerY = grid.y + row * grid.cell + grid.cell / 2;
      const seat = state.board[row][column];
      const radius = grid.cell * 0.38;
      if (seat === null) {
        const isLanding = isAimed && row === landingRow(state.board, column);
        ui.circle(isLanding ? colors[mySeat!] : GRID_COLOR, isLanding ? 0.8 : 0.3, centerX, centerY, radius);
      } else {
        const isLast = state.lastDrop?.[0] === row && state.lastDrop[1] === column;
        ui.circle(colors[seat], isLast ? 1.2 : 0.9, centerX, centerY, radius);
        ui.circle(colors[seat], 0.6, centerX, centerY, radius * 0.6);
        if (isWinning(row, column)) ui.circle(colors[seat], 1.3, centerX, centerY, radius * 0.25);
      }
    }
    if (canDrop) ui.region(columnRect, () => send({ column }));
  }
}

export function drawCheckers(ui: Ui, area: Rect, info: GameInfo, mySeat: Seat | null, choices: BoardChoices, send: Send): void {
  const state = info.view as CheckersState;
  const grid = gridIn(area, CHECKERS_SIZE, CHECKERS_SIZE);
  const colors = SEAT_COLORS.checkers;
  // Each player sees their own pieces at the bottom; watchers see it as seat 0 does.
  const fromBottom = mySeat !== 1;
  const screenRow = (row: number): number => (fromBottom ? CHECKERS_SIZE - 1 - row : row);
  const squareRect = (row: number, column: number): Rect => ({ x: grid.x + column * grid.cell, y: grid.y + screenRow(row) * grid.cell, width: grid.cell, height: grid.cell });
  const legal: CheckersMove[] = mySeat !== null && info.turn === mySeat ? legalCheckersMoves(state, mySeat) : [];
  // A piece in the middle of a run of jumps stays picked up.
  if (state.jumpingFrom && legal.length > 0) choices.checkersFrom = state.jumpingFrom;
  const from = choices.checkersFrom;
  const sameSquare = (a: Square, b: Square | null): boolean => b !== null && a[0] === b[0] && a[1] === b[1];
  const destinations = from ? legal.filter((move) => sameSquare(move.from, from)) : [];

  ui.rect(GRID_COLOR, 0.6, { x: grid.x, y: grid.y, width: grid.cell * CHECKERS_SIZE, height: grid.cell * CHECKERS_SIZE });
  for (let row = 0; row < CHECKERS_SIZE; row++) {
    for (let column = 0; column < CHECKERS_SIZE; column++) {
      if ((row + column) % 2 === 0) continue;
      const square: Square = [row, column];
      const rect = squareRect(row, column);
      const wasMoved = state.lastMove && (sameSquare(square, state.lastMove.from) || sameSquare(square, state.lastMove.to));
      ui.rect(GRID_COLOR, wasMoved ? 0.6 : 0.25, rect, 2);
      const piece = state.board[row][column];
      const centerX = rect.x + grid.cell / 2;
      const centerY = rect.y + grid.cell / 2;
      if (piece) {
        const isPicked = sameSquare(square, from);
        ui.circle(colors[piece.seat], isPicked ? 1.3 : 0.9, centerX, centerY, grid.cell * 0.36);
        // A king is marked by a second ring with a bar across it.
        if (piece.isKing) {
          ui.circle(colors[piece.seat], 0.9, centerX, centerY, grid.cell * 0.2);
          ui.pen(colors[piece.seat], 0.9).addSegment(centerX - grid.cell * 0.1, centerY, centerX + grid.cell * 0.1, centerY);
        }
      }
      const destination = destinations.find((move) => sameSquare(move.to, square));
      if (destination) {
        ui.circle(colors[mySeat!], ui.isHovered(rect) ? 1 : 0.45, centerX, centerY, grid.cell * 0.12);
        ui.region(rect, () => {
          choices.checkersFrom = null;
          send({ from: destination.from, to: destination.to });
        });
      } else if (legal.some((move) => sameSquare(move.from, square)) && !state.jumpingFrom) {
        ui.region(rect, () => {
          choices.checkersFrom = sameSquare(square, choices.checkersFrom) ? null : square;
        });
      }
    }
  }
}

// Battleship: the player's own fleet on the left, the waters they fire into on the right.
// Watchers see both fleets' shots, and neither's ships.
export function drawBattleship(ui: Ui, area: Rect, info: GameInfo, mySeat: Seat | null, choices: BoardChoices, send: (move: BattleshipMove) => void): void {
  const state = info.view as BattleshipView;
  const leftSeat: Seat = mySeat ?? 0;
  const rightSeat: Seat = leftSeat === 0 ? 1 : 0;
  const isPlacing = state.phase === "placing" && mySeat !== null && !state.fleets[mySeat].isReady;
  const controlsHeight = isPlacing ? 64 : 0;
  const labelHeight = 20;
  const half = (area.width - 24) / 2;
  const gridArea = (x: number): Rect => ({ x, y: area.y + labelHeight, width: half, height: area.height - labelHeight - controlsHeight });
  const leftGrid = gridIn(gridArea(area.x), BATTLESHIP_SIZE, BATTLESHIP_SIZE);
  const rightGrid = gridIn(gridArea(area.x + half + 24), BATTLESHIP_SIZE, BATTLESHIP_SIZE);
  const cell = Math.min(leftGrid.cell, rightGrid.cell);
  const leftTop = { x: leftGrid.x, y: area.y + labelHeight };
  const rightTop = { x: rightGrid.x, y: area.y + labelHeight };

  const leftTitle = mySeat === null ? "Fleet 1" : "Your fleet";
  const rightTitle = mySeat === null ? "Fleet 2" : "Enemy waters";
  ui.text(LABEL_COLOR, leftTitle, leftTop.x, area.y, 12);
  ui.text(LABEL_COLOR, rightTitle, rightTop.x, area.y, 12);

  drawWaters(ui, leftTop, cell, state.fleets[leftSeat]);
  drawWaters(ui, rightTop, cell, state.fleets[rightSeat]);

  if (isPlacing) {
    drawPlacement(ui, leftTop, cell, state.fleets[mySeat], choices, send);
    const controlsTop = leftTop.y + cell * BATTLESHIP_SIZE + 12;
    drawPlacementControls(ui, { x: area.x, y: controlsTop, width: area.width, height: controlsHeight - 12 }, state.fleets[mySeat], choices, send);
  } else if (mySeat !== null && info.turn === mySeat) {
    const enemyShots = state.fleets[rightSeat].shots;
    for (let row = 0; row < BATTLESHIP_SIZE; row++) {
      for (let column = 0; column < BATTLESHIP_SIZE; column++) {
        if (enemyShots[row][column]) continue;
        const rect = { x: rightTop.x + column * cell, y: rightTop.y + row * cell, width: cell, height: cell };
        if (ui.isHovered(rect)) ui.cross(HIT_COLOR, 0.8, rect.x + cell / 2, rect.y + cell / 2, cell * 0.3);
        ui.region(rect, () => send({ kind: "fire", row, column }));
      }
    }
  }
}

function drawWaters(ui: Ui, top: { x: number; y: number }, cell: number, fleet: Fleet): void {
  const size = cell * BATTLESHIP_SIZE;
  const pen = ui.pen(GRID_COLOR, 0.22);
  for (let line = 1; line < BATTLESHIP_SIZE; line++) {
    pen.addSegment(top.x + line * cell, top.y, top.x + line * cell, top.y + size);
    pen.addSegment(top.x, top.y + line * cell, top.x + size, top.y + line * cell);
  }
  ui.rect(GRID_COLOR, 0.6, { x: top.x, y: top.y, width: size, height: size });
  for (const ship of fleet.ships) {
    if (!ship.at) continue;
    drawShip(ui, top, cell, ship.size, ship.at.row, ship.at.column, ship.at.isAcross, SHIP_COLOR, ship.isSunk ? 0.4 : 0.85);
  }
  for (let row = 0; row < BATTLESHIP_SIZE; row++) {
    for (let column = 0; column < BATTLESHIP_SIZE; column++) {
      const shot = fleet.shots[row][column];
      const centerX = top.x + column * cell + cell / 2;
      const centerY = top.y + row * cell + cell / 2;
      if (shot === "hit") ui.cross(HIT_COLOR, 1.2, centerX, centerY, cell * 0.3);
      else if (shot === "miss") ui.circle(MISS_COLOR, 0.6, centerX, centerY, cell * 0.12);
    }
  }
}

function drawShip(ui: Ui, top: { x: number; y: number }, cell: number, size: number, row: number, column: number, isAcross: boolean, color: BeamColor, intensity: number): void {
  const inset = cell * 0.18;
  ui.rect(color, intensity, {
    x: top.x + column * cell + inset,
    y: top.y + row * cell + inset,
    width: (isAcross ? size : 1) * cell - 2 * inset,
    height: (isAcross ? 1 : size) * cell - 2 * inset,
  });
}

function drawPlacement(ui: Ui, top: { x: number; y: number }, cell: number, fleet: Fleet, choices: BoardChoices, send: (move: BattleshipMove) => void): void {
  const ship = FLEET.find((each) => each.id === choices.shipToPlace)!;
  for (let row = 0; row < BATTLESHIP_SIZE; row++) {
    for (let column = 0; column < BATTLESHIP_SIZE; column++) {
      const rect = { x: top.x + column * cell, y: top.y + row * cell, width: cell, height: cell };
      const at = { row, column, isAcross: choices.isAcross };
      if (!fitsAt(fleet, ship.id, at)) continue;
      if (ui.isHovered(rect)) {
        drawShip(ui, top, cell, ship.size, row, column, choices.isAcross, HIT_COLOR, 0.9);
        for (const [r, c] of shipCells(ship.size, at)) ui.circle(HIT_COLOR, 0.4, top.x + c * cell + cell / 2, top.y + r * cell + cell / 2, cell * 0.08);
      }
      ui.region(rect, () => {
        send({ kind: "place", ship: ship.id, ...at });
        // On to the next ship not yet placed.
        const index = FLEET.findIndex((each) => each.id === ship.id);
        const next = [...FLEET.slice(index + 1), ...FLEET.slice(0, index)].find((each) => !fleet.ships.find((placed) => placed.id === each.id)?.at);
        if (next) choices.shipToPlace = next.id;
      });
    }
  }
}

function drawPlacementControls(ui: Ui, area: Rect, fleet: Fleet, choices: BoardChoices, send: (move: BattleshipMove) => void): void {
  const height = 24;
  let x = area.x;
  for (const ship of FLEET) {
    const isPlaced = fleet.ships.find((each) => each.id === ship.id)?.at !== null;
    // The ship being placed is lit; those already on the board are dimmer.
    const label = ship.name;
    const width = ui.textWidth(label, 10) + 14;
    const rect = { x, y: area.y, width, height };
    const isChosen = ship.id === choices.shipToPlace;
    ui.button(isChosen ? HIT_COLOR : isPlaced ? GRID_COLOR : SHIP_COLOR, rect, label, () => (choices.shipToPlace = ship.id), 10);
    if (isChosen) ui.rect(HIT_COLOR, 0.8, rect, 3);
    x += width + 6;
  }
  const row2 = area.y + height + 6;
  let x2 = area.x;
  const allPlaced = fleet.ships.every((ship) => ship.at);
  for (const [label, action] of [
    [choices.isAcross ? "Turn ship: across" : "Turn ship: down", () => (choices.isAcross = !choices.isAcross)],
    ["Place for me", () => send({ kind: "autoPlace" })],
    ...(allPlaced ? ([["Ready", () => send({ kind: "ready" })]] as const) : []),
  ] as const) {
    const width = ui.textWidth(label, 11) + 18;
    ui.button(label === "Ready" ? HIT_COLOR : SHIP_COLOR, { x: x2, y: row2, width, height: 22 }, label, action, 11);
    x2 += width + 8;
  }
}
