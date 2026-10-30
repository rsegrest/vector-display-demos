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
  const fallback = simpleChoice(input);
  if (!fallback) return null;
  const choices = input.game.choices(input.state, input.seat);
  const { winning, safe } = screenChoices(input, choices);
  // A move that wins at once needs no model.
  if (winning.length > 0) return { choice: winning[0], by: "simple" };
  if (safe.length === 1) return { choice: safe[0], by: "simple" };
  let shown = safe;
  if (shown.length > MOST_CHOICES_SHOWN) {
    const rest = safe.filter((choice) => choice.label !== fallback.choice.label);
    const sample: Choice[] = [fallback.choice];
    while (sample.length < MOST_CHOICES_SHOWN && rest.length > 0) sample.push(rest.splice(Math.floor(input.random() * rest.length), 1)[0]);
    shown = sample;
  }
  try {
    const answers = findAnswers(await transport(jevRequest(input, shown)));
    const answer = answers?.next_move as { choice?: unknown; confidence?: unknown } | undefined;
    const chosen = shown.find((choice) => choice.label === String(answer?.choice ?? ""));
    if (!chosen) return { ...fallback, note: `Jev gave no listed move (${JSON.stringify(answer?.choice ?? null)})` };
    return { choice: chosen, by: "jev", confidence: typeof answer?.confidence === "number" ? answer.confidence : undefined };
  } catch (error) {
    return { ...fallback, note: `Jev failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
