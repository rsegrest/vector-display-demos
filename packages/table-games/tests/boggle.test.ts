import { describe, expect, it } from "vitest";
import { simpleChoice, type MoveResult } from "../src/index.js";
import type { AnyTableGame } from "../src/registry.js";
import { BOGGLE_SIZE, boggle, findWords, seatScores, tracePath, wordScore, type BoggleState } from "../src/games/boggle.js";
import { BOGGLE_WORDS } from "../src/games/boggleWords.js";

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function accepted<State>(result: MoveResult<State>): State {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

// A grid where "stone", "tone", "note" and "quiet" can be traced.
const GRID = [
  ["S", "T", "O", "X"],
  ["Z", "E", "N", "X"],
  ["Qu", "I", "T", "X"],
  ["X", "X", "X", "X"],
];

function tableOf(players: number): BoggleState {
  return { ...boggle.start(players, seededRandom(1)), grid: GRID };
}

describe("Boggle words", () => {
  it("shakes the sixteen standard dice into a 4 by 4 grid", () => {
    const state = boggle.start(2, seededRandom(3));
    expect(state.grid).toHaveLength(BOGGLE_SIZE);
    expect(state.grid.every((row) => row.length === BOGGLE_SIZE && row.every((face) => /^([A-Z]|Qu)$/.test(face)))).toBe(true);
    expect(boggle.start(2, seededRandom(3)).grid).toEqual(state.grid);
  });

  it("traces words through neighboring dice, each used once, with Qu as two letters", () => {
    expect(tracePath(GRID, "stone")).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [1, 1]]);
    expect(tracePath(GRID, "quiet")).not.toBeNull();
    expect(tracePath(GRID, "qit")).toBeNull();
    // S to O skips a die.
    expect(tracePath(GRID, "so")).toBeNull();
    // There is only one O.
    expect(tracePath(GRID, "toot")).toBeNull();
  });

  it("scores by length", () => {
    expect([3, 4, 5, 6, 7, 8, 9].map((length) => wordScore("a".repeat(length)))).toEqual([1, 1, 2, 3, 5, 11, 11]);
  });

  it("finds dictionary words on the grid", () => {
    const found = findWords(GRID);
    expect(found).toEqual(expect.arrayContaining(["stone", "tone", "note", "quiet"]));
    expect(found.every((word) => BOGGLE_WORDS.has(word) && tracePath(GRID, word) !== null)).toBe(true);
  });
});

describe("Boggle play", () => {
  it("takes words that are on the grid and in the dictionary, once per seat", () => {
    let state = tableOf(2);
    state = accepted(boggle.play(state, 0, { kind: "word", word: "Stone" }, Math.random));
    expect(state.words[0]).toEqual(["stone"]);
    expect(boggle.play(state, 0, { kind: "word", word: "stone" }, Math.random)).toEqual({ ok: false, error: "You already have that word" });
    expect(boggle.play(state, 0, { kind: "word", word: "to" }, Math.random).ok).toBe(false);
    expect(boggle.play(state, 0, { kind: "word", word: "dog" }, Math.random)).toEqual({ ok: false, error: "That word is not on the grid" });
    expect(boggle.play(state, 0, { kind: "word", word: "tnes" }, Math.random).ok).toBe(false);
    expect(boggle.play(state, 0, { kind: "word", word: "st0ne" }, Math.random).ok).toBe(false);
    for (const move of [null, "stone", { kind: "word" }, { kind: "word", word: 5 }, { kind: "time" }]) {
      expect(boggle.play(state, 0, move, Math.random).ok).toBe(false);
    }
    expect(boggle.play(state, 2, { kind: "done" }, Math.random).ok).toBe(false);
  });

  it("lets everyone play at once, hides other seats' words, and ends when all are done", () => {
    let state = tableOf(3);
    expect(boggle.toMove(state)).toEqual([0, 1, 2]);
    state = accepted(boggle.play(state, 0, { kind: "word", word: "stone" }, Math.random));
    state = accepted(boggle.play(state, 0, { kind: "word", word: "quiet" }, Math.random));
    state = accepted(boggle.play(state, 1, { kind: "word", word: "stone" }, Math.random));
    state = accepted(boggle.play(state, 1, { kind: "word", word: "note" }, Math.random));
    const view = boggle.viewFor(state, 1);
    expect(view.words).toEqual([null, ["stone", "note"], null]);
    expect(view.wordCounts).toEqual([2, 2, 0]);
    expect(boggle.viewFor(state, null).words).toEqual([null, null, null]);
    state = accepted(boggle.play(state, 1, { kind: "done" }, Math.random));
    expect(boggle.toMove(state)).toEqual([0, 2]);
    expect(boggle.play(state, 1, { kind: "word", word: "tone" }, Math.random).ok).toBe(false);
    state = accepted(boggle.play(state, 0, { kind: "done" }, Math.random));
    state = accepted(boggle.play(state, 2, { kind: "done" }, Math.random));
    // "stone" was found twice and scores nothing: quiet 2 against note 1.
    expect(state.scores).toEqual([2, 1, 0]);
    expect(state.outcome).toEqual(expect.objectContaining({ winners: [0] }));
    expect(boggle.viewFor(state, 2).words).toEqual([["stone", "quiet"], ["stone", "note"], []]);
    expect(boggle.toMove(state)).toEqual([]);
  });

  it("calls a tie when nobody scores", () => {
    expect(seatScores([["stone"], ["stone"]])).toEqual([0, 0]);
    let state = tableOf(2);
    state = accepted(boggle.play(state, 0, { kind: "done" }, Math.random));
    state = accepted(boggle.play(state, 1, { kind: "done" }, Math.random));
    expect(state.outcome?.winners).toEqual([0, 1]);
  });

  it("gives a computer player words it can find, of which it plays a modest few, then done", () => {
    const random = seededRandom(5);
    let state = boggle.start(2, random);
    const choices = boggle.choices(state, 0);
    expect(choices.at(-1)?.move).toEqual({ kind: "done" });
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(choices.length);
    const everyWord = findWords(state.grid);
    let moves = 0;
    while (!state.isDone[0]) {
      const decision = simpleChoice({ game: boggle as unknown as AnyTableGame, state, view: boggle.viewFor(state, 0), seat: 0, random })!;
      state = accepted(boggle.play(state, 0, decision.choice.move, random));
      expect(++moves).toBeLessThan(everyWord.length + 2);
    }
    expect(state.words[0]).toHaveLength(Math.min(8, everyWord.length));
    expect(state.words[0].every((word) => everyWord.includes(word))).toBe(true);
    expect(boggle.choices(state, 0)).toEqual([]);
  });
});
