import type { AnyTableGame } from "./registry.js";
import type { Choice, Seat } from "./TableGame.js";

// Computer players. The game lists the legal moves; a chooser only picks one of them, so a
// computer can never make an illegal move. Two choosers:
//
//   simple  in code, instant and free: takes a move that wins at once, avoids one that lets the
//           next player win at once, and otherwise plays the game's own simple strategy or at
//           random. It looks ahead only in games with nothing hidden and no dice, so it never
//           peeks at what its seat could not see. The fallback whenever Jev cannot answer.
//   Jev     TypeSafe's decision model, through OpenRouter: shown the position (what its seat may
//           see), the game's strategy notes and the moves, it chooses one. The simple chooser's
//           lookahead first removes moves that lose at once, so Jev chooses among the rest.

export interface ChooserInput {
  readonly game: AnyTableGame;
  // The whole state: used only to look ahead, in games where looking ahead hides nothing.
  readonly state: unknown;
  // What the computer's seat may see.
  readonly view: unknown;
  readonly seat: Seat;
  readonly random: () => number;
}

export interface Decision {
  readonly choice: Choice;
  readonly by: "simple" | "jev";
  readonly confidence?: number;
  // Why the simple chooser was used instead, when Jev was asked and failed.
  readonly note?: string;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// The moves that do not hand the next player a win at once (all of them, if none is safe or
// looking ahead is not fair in this game), and among them any that win at once.
export function screenChoices(input: ChooserInput, choices: readonly Choice[]): { readonly winning: Choice[]; readonly safe: Choice[] } {
  const { game, state, seat, random } = input;
  if (!game.canLookAhead) return { winning: [], safe: [...choices] };
  const winning: Choice[] = [];
  const safe: Choice[] = [];
  for (const choice of choices) {
    const result = game.play(state, seat, choice.move, random);
    if (!result.ok) continue;
    const outcome = game.outcome(result.state);
    if (outcome?.winners.includes(seat) && outcome.winners.length === 1) {
      winning.push(choice);
      continue;
    }
    const next = game.toMove(result.state);
    const opponentWins =
      next.length === 1 &&
      next[0] !== seat &&
      game.choices(result.state, next[0]).some((reply) => {
        const after = game.play(result.state, next[0], reply.move, random);
        return after.ok && (game.outcome(after.state)?.winners.includes(next[0]) ?? false);
      });
    if (!opponentWins) safe.push(choice);
  }
  return { winning, safe: safe.length > 0 ? safe : [...choices] };
}

export function simpleChoice(input: ChooserInput): Decision | null {
  const choices = input.game.choices(input.state, input.seat);
  if (choices.length === 0) return null;
  const { winning, safe } = screenChoices(input, choices);
  if (winning.length > 0) return { choice: winning[0], by: "simple" };
  const suggested = input.game.simpleStrategy?.(input.view, input.seat, safe, input.random);
  return { choice: suggested ?? pick(safe, input.random), by: "simple" };
}

// ── Jev ────────────────────────────────────────────────────────────────────

export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "~typesafe/jev-latest";
// Jev chooses better among fewer options; a longer list is cut to this many (the simple
// chooser's pick always among them).
const MOST_CHOICES_SHOWN = 24;

// Sends one request body and returns the parsed JSON reply. The server passes a function that
// adds the key; nothing here sees it.
export type JevTransport = (body: unknown) => Promise<unknown>;

export function jevRequest(input: ChooserInput, shown: readonly Choice[]): unknown {
  const { game, seat, view } = input;
  const criteria: Record<string, string> = {};
  for (const choice of shown) criteria[choice.label] = choice.label;
  return {
    model: JEV_MODEL,
    state: {
      game: game.title,
      you_are: `player ${seat + 1}`,
      position: view,
    },
    questions: {
      next_move: {
        type: "choice",
        instructions: {
          question: `It is your move in ${game.title}, as player ${seat + 1} (seat ${seat} in \`position\`). Which move should you make?`,
          goal: game.strategy,
          position: "`position` is the game as you can see it; anything hidden from you is left out.",
          safety: "Every move listed is legal. Moves that would let the other player win at once have already been removed where that can be known.",
        },
        criteria,
      },
    },
  };
}

// Finds a decisions-API `answers` object wherever the proxy put it (as jev-arcade's policy does).
export function findAnswers(reply: unknown): Record<string, unknown> | null {
  if (Array.isArray(reply)) {
    for (const item of reply) {
      const found = findAnswers(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof reply !== "object" || reply === null) return null;
  const record = reply as Record<string, unknown>;
  if (typeof record.answers === "object" && record.answers !== null && !Array.isArray(record.answers)) return record.answers as Record<string, unknown>;
  for (const key of ["choices", "message", "output", "data"]) {
    const found = key in record ? findAnswers(record[key]) : null;
    if (found) return found;
  }
  if (typeof record.content === "string") {
    try {
      return findAnswers(JSON.parse(record.content));
    } catch {
      return null;
    }
  }
  return null;
}

export async function jevChoice(input: ChooserInput, transport: JevTransport): Promise<Decision | null> {
  return chooseMove(input, "normal", transport);
}

// ── Skill levels ───────────────────────────────────────────────────────────

// How well a computer player plays. Every level takes a move that wins at once.
//   beginner  mostly random moves, never a model call
//   easy      Jev's choice drawn by its own probabilities, so often its second or third pick
//   normal    Jev's top choice among the moves that do not lose at once
//   hard      as normal, after also removing moves that walk into a two-move trap, and
//             taking a win two moves deep (in games where looking ahead is fair)
// Without Jev (no key, a pure-chance game, practice in the window) the simple strategy stands
// in for it at every level.
export type Skill = "beginner" | "easy" | "normal" | "hard";

export const SKILLS: readonly Skill[] = ["beginner", "easy", "normal", "hard"];

export const SKILL_TITLES: Readonly<Record<Skill, string>> = { beginner: "Beginner", easy: "Easy", normal: "Normal", hard: "Hard" };

export function isSkill(value: unknown): value is Skill {
  return SKILLS.includes(value as Skill);
}

// The share of a beginner's moves made at random, and an easy player's without Jev.
const BEGINNER_RANDOM_SHARE = 0.7;
const EASY_RANDOM_SHARE = 0.35;
// The most moves the hard player's deeper look may play out before it gives up and plays as
// normal (chess, with thirty-odd moves a side, runs out; Connect 4 and checkers do not).
const DEEP_LOOK_BUDGET = 20_000;

export async function chooseMove(input: ChooserInput, skill: Skill, transport: JevTransport | null): Promise<Decision | null> {
  const { game, state, seat, random } = input;
  const choices = game.choices(state, seat);
  if (choices.length === 0) return null;
  const { winning, safe } = screenChoices(input, choices);
  // A move that wins at once needs no model, at any level.
  if (winning.length > 0) return { choice: winning[0], by: "simple" };
  const simpleAmong = (candidates: readonly Choice[]): Decision => ({
    choice: game.simpleStrategy?.(input.view, seat, candidates, random) ?? pick(candidates, random),
    by: "simple",
  });

  if (skill === "beginner") return random() < BEGINNER_RANDOM_SHARE ? { choice: pick(choices, random), by: "simple" } : simpleAmong(safe);

  let candidates = safe;
  if (skill === "hard") {
    const deep = lookTwoMovesDeep(input, safe);
    if (deep.forcedWin) return { choice: deep.forcedWin, by: "simple" };
    candidates = deep.survivors;
  }
  if (candidates.length === 1) return { choice: candidates[0], by: "simple" };

  if (!transport || game.isPureChance) {
    if (skill === "easy" && random() < EASY_RANDOM_SHARE) return { choice: pick(candidates, random), by: "simple" };
    return simpleAmong(candidates);
  }
  return askJevAmong(input, candidates, simpleAmong(candidates), skill === "easy", transport);
}

// Jev chooses among `candidates`: its top choice, or (`sample`) one drawn by its probabilities.
async function askJevAmong(input: ChooserInput, candidates: readonly Choice[], fallback: Decision, sample: boolean, transport: JevTransport): Promise<Decision> {
  let shown = [...candidates];
  if (shown.length > MOST_CHOICES_SHOWN) {
    const rest = shown.filter((choice) => choice.label !== fallback.choice.label);
    const sampled: Choice[] = [fallback.choice];
    while (sampled.length < MOST_CHOICES_SHOWN && rest.length > 0) sampled.push(rest.splice(Math.floor(input.random() * rest.length), 1)[0]);
    shown = sampled;
  }
  try {
    const answers = findAnswers(await transport(jevRequest(input, shown)));
    const answer = answers?.next_move as { choice?: unknown; confidence?: unknown; probabilities?: unknown } | undefined;
    const confidence = typeof answer?.confidence === "number" ? answer.confidence : undefined;
    if (sample) {
      const drawn = drawByProbability(shown, answer?.probabilities, input.random);
      if (drawn) return { choice: drawn, by: "jev", confidence };
    }
    const chosen = shown.find((choice) => choice.label === String(answer?.choice ?? ""));
    if (!chosen) return { ...fallback, note: `Jev gave no listed move (${JSON.stringify(answer?.choice ?? null)})` };
    return { choice: chosen, by: "jev", confidence };
  } catch (error) {
    return { ...fallback, note: `Jev failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// A move drawn in proportion to the model's probability for it; null if it gave none usable.
export function drawByProbability(choices: readonly Choice[], probabilities: unknown, random: () => number): Choice | null {
  if (typeof probabilities !== "object" || probabilities === null) return null;
  const weights = choices.map((choice) => {
    const weight = (probabilities as Record<string, unknown>)[choice.label];
    return typeof weight === "number" && weight > 0 ? weight : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;
  let point = random() * total;
  for (let index = 0; index < choices.length; index++) {
    point -= weights[index];
    if (point < 0) return choices[index];
  }
  return choices[choices.length - 1];
}

// The hard player's deeper look, in games where looking ahead is fair and one player moves at a
// time. A move is a forced win if every reply leaves a winning move; it is a trap if some reply
// leaves every answer of ours handing over a win at once. Gives up (keeping every move) past the budget.
export function lookTwoMovesDeep(input: ChooserInput, moves: readonly Choice[]): { readonly forcedWin: Choice | null; readonly survivors: Choice[] } {
  const { game, state, seat, random } = input;
  if (!game.canLookAhead) return { forcedWin: null, survivors: [...moves] };
  // Four moves deep costs about the number of moves to the fourth power: chess's thirty-odd
  // would spend the whole budget for nothing, so it is not tried there.
  if (moves.length ** 4 > DEEP_LOOK_BUDGET * 4) return { forcedWin: null, survivors: [...moves] };
  let budget = DEEP_LOOK_BUDGET;
  const play = (from: unknown, mover: number, move: unknown): unknown | null => {
    if (--budget < 0) throw new Error("budget");
    const result = game.play(from, mover, move, random);
    return result.ok ? result.state : null;
  };
  const wins = (after: unknown, mover: number): boolean => {
    const outcome = game.outcome(after);
    return outcome !== null && outcome.winners.length === 1 && outcome.winners[0] === mover;
  };
  const soleMover = (after: unknown): number | null => {
    const next = game.toMove(after);
    return next.length === 1 ? next[0] : null;
  };
  // Whether `mover`, to move in `position`, has a move that wins at once.
  const canWinAtOnce = (position: unknown, mover: number): boolean =>
    game.choices(position, mover).some((choice) => {
      const after = play(position, mover, choice.move);
      return after !== null && wins(after, mover);
    });

  try {
    let forcedWin: Choice | null = null;
    const survivors: Choice[] = [];
    for (const move of moves) {
      const afterMine = play(state, seat, move.move);
      if (afterMine === null) continue;
      const opponent = soleMover(afterMine);
      if (opponent === null || opponent === seat || game.outcome(afterMine)) {
        survivors.push(move);
        continue;
      }
      let everyReplyLeavesAWin = true;
      let isTrap = false;
      for (const reply of game.choices(afterMine, opponent)) {
        const afterReply = play(afterMine, opponent, reply.move);
        if (afterReply === null || game.outcome(afterReply)) {
          everyReplyLeavesAWin = false;
          continue;
        }
        if (soleMover(afterReply) !== seat) {
          everyReplyLeavesAWin = false;
          continue;
        }
        if (!canWinAtOnce(afterReply, seat)) everyReplyLeavesAWin = false;
        // A trap: after this reply, each of our answers lets the opponent win at once.
        const answers = game.choices(afterReply, seat);
        const allAnswersLose =
          answers.length > 0 &&
          answers.every((answer) => {
            const afterAnswer = play(afterReply, seat, answer.move);
            if (afterAnswer === null || game.outcome(afterAnswer)) return false;
            const next = soleMover(afterAnswer);
            return next === opponent && canWinAtOnce(afterAnswer, opponent);
          });
        if (allAnswersLose) {
          isTrap = true;
          break;
        }
      }
      if (everyReplyLeavesAWin && !forcedWin) forcedWin = move;
      if (!isTrap) survivors.push(move);
    }
    return { forcedWin, survivors: survivors.length > 0 ? survivors : [...moves] };
  } catch {
    return { forcedWin: null, survivors: [...moves] };
  }
}
