export interface LeniaPattern {
  readonly width: number;
  readonly height: number;
  readonly cells: Float32Array;
}

// Decodes a 2D pattern in the Lenia reference implementation's RLE format (Chakazul/Lenia, Board.rle2arr).
// Values are 0–255 written as "." (0), "A"–"X" (1–24), or a prefix p–y plus A–X (25–255).
// "$" ends a row, "!" ends the pattern, and a number before any symbol repeats it.
export function parseLeniaRle(source: string): LeniaPattern {
  const rows: number[][] = [];
  let row: number[] = [];
  let count = "";
  let prefix = "";
  for (const character of source.replace(/!$/, "") + "$") {
    if (character >= "0" && character <= "9") {
      count += character;
    } else if (character >= "p" && character <= "y") {
      prefix = character;
    } else if (character === "$") {
      rows.push(row);
      for (let extra = 1; extra < (count === "" ? 1 : Number(count)); extra++) rows.push([]);
      row = [];
      count = "";
      prefix = "";
    } else if (character.trim() !== "") {
      const value = cellValue(prefix + character);
      const repeat = count === "" ? 1 : Number(count);
      for (let i = 0; i < repeat; i++) row.push(value);
      count = "";
      prefix = "";
    }
  }
  const width = Math.max(...rows.map((r) => r.length));
  const cells = new Float32Array(width * rows.length);
  rows.forEach((r, y) => r.forEach((value, x) => (cells[y * width + x] = value / 255)));
  return { width, height: rows.length, cells };
}

function cellValue(symbol: string): number {
  if (symbol === "." || symbol === "b") return 0;
  if (symbol === "o") return 255;
  if (symbol.length === 1) return symbol.charCodeAt(0) - 65 + 1;
  return (symbol.charCodeAt(0) - 112) * 24 + (symbol.charCodeAt(1) - 65 + 25);
}
