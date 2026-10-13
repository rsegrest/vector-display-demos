import type { BeamColor, DisplayList } from "@vector-display/core";
import { BEAM_SETTING_RANGES, fontSafeText, getDemoFont, type BeamSettings, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { APP_CATEGORIES, type OsApp, type OsServices } from "./OsApp.js";

const TEXT_COLOR: BeamColor = { red: 0.45, green: 1, blue: 0.6 };
const TEXT_SIZE = 14;
const LINE_HEIGHT = 23;
const MARGIN = 14;
const SCROLLBACK = 300;
const PROMPT = "> ";

// The names typed at the terminal for each beam setting.
const SETTING_NAMES: Readonly<Record<string, keyof BeamSettings>> = {
  WIDTH: "beamWidth",
  GLOW: "glowRadius",
  GLOWSTRENGTH: "glowStrength",
  PERSISTENCE: "persistenceHalfLifeMilliseconds",
  BLOOM: "bloomStrength",
  EXPOSURE: "exposure",
  FLICKER: "flickerAmount",
};

const HELP: readonly string[] = [
  "LS               LIST PROGRAMS, OR ONE GROUP: LS CREATIVE",
  "RUN NAME         OPEN A PROGRAM, E.G. RUN LENIA",
  "PS               LIST OPEN WINDOWS",
  "CLOSE NAME       CLOSE A WINDOW, OR CLOSE ALL",
  "SET NAME VALUE   CHANGE THE BEAM, E.G. SET PERSISTENCE 200",
  "GET              SHOW THE BEAM SETTINGS",
  "RESET            BEAM SETTINGS BACK TO DEFAULTS",
  "DATE             THE DATE AND TIME",
  "ECHO TEXT        SAY IT BACK",
  "CLEAR            WIPE THIS SCREEN",
  "ABOUT            WHAT THIS IS",
  "REBOOT           START AGAIN",
];

// Carries out one command line and returns what to print. "CLEAR" is the one
// command with an effect on the terminal itself; it is signalled by null.
export function runCommand(line: string, services: OsServices): string[] | null {
  const words = line.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const [command, ...rest] = words;
  const argument = rest.join(" ");

  switch (command) {
    case "HELP":
    case "?":
      return [...HELP];
    case "LS":
    case "DIR": {
      // All of them, one kind (DEMOS or TOOLS), or one of the launcher's categories by its name or the start of it.
      const kind = rest[0] === "DEMOS" ? "demo" : rest[0] === "TOOLS" ? "tool" : null;
      const category = argument && !kind ? APP_CATEGORIES.find((candidate) => candidate.title.toUpperCase().startsWith(argument) || candidate.id.toUpperCase() === argument) : undefined;
      if (argument && !kind && !category) return [`NO GROUP CALLED ${argument}. TRY ${APP_CATEGORIES.map((candidate) => candidate.title.toUpperCase()).join(", ")}.`];
      const names = services.entries.filter((entry) => (!kind || entry.kind === kind) && (!category || entry.category === category.id)).map((entry) => entry.id.toUpperCase());
      return inColumns(names, 2);
    }
    case "RUN":
    case "OPEN": {
      if (!argument) return ["RUN WHAT? TRY LS."];
      const entry = findEntry(argument, services);
      if (!entry) return [`NO PROGRAM CALLED ${argument}. TRY LS.`];
      services.launch(entry.id);
      return [`STARTING ${entry.title.toUpperCase()}`];
    }
    case "PS": {
      const open = services.openWindows();
      return open.length ? open.map((title) => title.toUpperCase()) : ["NO WINDOWS OPEN"];
    }
    case "CLOSE":
    case "KILL": {
      if (!argument) return ["CLOSE WHAT? TRY PS, OR CLOSE ALL."];
      const count = services.close(argument);
      return [count === 0 ? `NOTHING OPEN CALLED ${argument}` : `CLOSED ${count}`];
    }
    case "SET": {
      const key = SETTING_NAMES[rest[0] ?? ""];
      const value = Number(rest[1]);
      if (!key) return [`SET WHAT? ONE OF ${Object.keys(SETTING_NAMES).join(" ")}`];
      if (rest[1] === undefined || !Number.isFinite(value)) return [`SET ${rest[0]} TO WHAT NUMBER?`];
      services.beam.set({ [key]: value });
      // The store keeps values in range, so report what was actually set.
      return [`${rest[0]} ${formatSetting(key, services.beam.current[key])}`];
    }
    case "GET":
      return Object.entries(SETTING_NAMES).map(([name, key]) => `${name.padEnd(13)}${formatSetting(key, services.beam.current[key])}`);
    case "RESET":
      services.beam.reset();
      return ["BEAM SETTINGS RESET"];
    case "DATE":
    case "TIME":
      return [services.now().toISOString().slice(0, 19).replace("T", " ") + " UTC"];
    case "ECHO":
      return [argument];
    case "CLEAR":
    case "CLS":
      return null;
    case "ABOUT":
      return ["VECTOR OS 0.1", "A DESKTOP DRAWN BY ONE BEAM.", "EVERY WINDOW IS A LIST OF STROKES,", "TRIMMED TO ITS FRAME."];
    case "REBOOT":
      services.reboot();
      return ["REBOOTING"];
    default:
      return [`UNKNOWN COMMAND ${command}. TYPE HELP.`];
  }
}

// A program by its id, or by the start of its id or title, ignoring case and hyphens.
function findEntry(name: string, services: OsServices) {
  const plain = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wanted = plain(name);
  return (
    services.entries.find((entry) => plain(entry.id) === wanted || plain(entry.title) === wanted) ??
    services.entries.find((entry) => plain(entry.id).startsWith(wanted) || plain(entry.title).startsWith(wanted))
  );
}

function formatSetting(key: keyof BeamSettings, value: number): string {
  const range = BEAM_SETTING_RANGES.find((candidate) => candidate.key === key);
  const places = !range || range.step >= 1 ? 0 : range.step >= 0.1 ? 1 : 2;
  return `${value.toFixed(places)}${range?.unit ? ` ${range.unit.toUpperCase()}` : ""}`;
}

function inColumns(names: readonly string[], columns: number): string[] {
  const width = Math.max(...names.map((name) => name.length), 1) + 3;
  const lines: string[] = [];
  for (let index = 0; index < names.length; index += columns) {
    lines.push(names.slice(index, index + columns).map((name) => name.padEnd(width)).join("").trimEnd());
  }
  return lines;
}

// A terminal: lines of text, a prompt, and whatever the commands print.
export class Terminal implements Demo {
  public lines: string[] = ["VECTOR OS 0.1", "TYPE HELP FOR COMMANDS.", ""];
  public input = "";

  private readonly history: string[] = [];
  private historyIndex = 0;
  private seconds = 0;

  public constructor(private readonly services: OsServices) {}

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const font = getDemoFont();
    const visible = Math.max(1, Math.floor((frame.height - MARGIN * 2) / LINE_HEIGHT));
    // The prompt is the last line; the scrollback fills the rows above it.
    const shown = this.lines.slice(-(visible - 1));
    displayList.setColor(TEXT_COLOR);
    shown.forEach((line, row) => {
      if (line) font.addText(displayList, { text: line, x: MARGIN, y: MARGIN + row * LINE_HEIGHT, size: TEXT_SIZE, intensity: 0.8 });
    });
    // The cursor blinks twice a second.
    const cursor = this.seconds % 1 < 0.5 ? "_" : "";
    font.addText(displayList, { text: `${PROMPT}${this.input}${cursor}`, x: MARGIN, y: MARGIN + shown.length * LINE_HEIGHT, size: TEXT_SIZE, intensity: 1.1 });
  }

  public key(key: string): void {
    if (key === "Enter") {
      this.submit();
    } else if (key === "Backspace") {
      this.input = this.input.slice(0, -1);
    } else if (key === "ArrowUp" || key === "ArrowDown") {
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (key === "ArrowUp" ? -1 : 1)));
      this.input = this.history[this.historyIndex] ?? "";
    } else if (key.length === 1 && this.input.length < 60) {
      // The font has capitals only, and no glyph for some symbols; those become spaces.
      this.input += fontSafeText(key.toUpperCase());
    }
  }

  private submit(): void {
    const line = this.input;
    this.input = "";
    this.print(`${PROMPT}${line}`);
    if (line.trim()) {
      this.history.push(line);
      this.historyIndex = this.history.length;
    }
    const output = runCommand(line, this.services);
    if (output === null) this.lines = [];
    else for (const text of output) this.print(fontSafeText(text));
  }

  private print(line: string): void {
    this.lines.push(line);
    if (this.lines.length > SCROLLBACK) this.lines.splice(0, this.lines.length - SCROLLBACK);
  }
}

export function createTerminal(services: OsServices): OsApp {
  const terminal = new Terminal(services);
  return { demo: terminal, worldHeight: null, onKey: (key) => terminal.key(key) };
}
