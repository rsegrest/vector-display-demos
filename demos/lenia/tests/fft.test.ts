import { describe, expect, it } from "vitest";
import { Fft2d } from "../src/sim/fft.js";

function naiveDft2d(re: Float64Array, width: number, height: number) {
  const outRe = new Float64Array(width * height);
  const outIm = new Float64Array(width * height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const angle = -2 * Math.PI * ((u * x) / width + (v * y) / height);
          sumRe += re[y * width + x] * Math.cos(angle);
          sumIm += re[y * width + x] * Math.sin(angle);
        }
      }
      outRe[v * width + u] = sumRe;
      outIm[v * width + u] = sumIm;
    }
  }
  return { outRe, outIm };
}

describe("Fft2d", () => {
  it("matches a naive 2D DFT", () => {
    const width = 8;
    const height = 4;
    const re = Float64Array.from({ length: width * height }, (_, i) => Math.sin(i * 1.7) + (i % 3));
    const im = new Float64Array(width * height);
    const expected = naiveDft2d(re, width, height);
    new Fft2d(width, height).forward(re, im);
    for (let i = 0; i < width * height; i++) {
      expect(re[i]).toBeCloseTo(expected.outRe[i], 9);
      expect(im[i]).toBeCloseTo(expected.outIm[i], 9);
    }
  });

  it("round-trips through the inverse transform", () => {
    const fft = new Fft2d(16, 8);
    const original = Float64Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.31));
    const re = Float64Array.from(original);
    const im = new Float64Array(128);
    fft.forward(re, im);
    fft.inverse(re, im);
    for (let i = 0; i < 128; i++) {
      expect(re[i]).toBeCloseTo(original[i], 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => new Fft2d(12, 8)).toThrow();
  });
});
