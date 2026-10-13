// Radix-2 complex FFT over a 2D grid, in place on separate real and imaginary arrays.
// Lenia convolves the whole field with a large kernel every step; doing it as a product of
// spectra costs O(n log n) instead of O(n × kernel area).
export class Fft2d {
  private readonly rowFft: Fft1d;
  private readonly columnFft: Fft1d;
  private readonly columnRe: Float64Array;
  private readonly columnIm: Float64Array;

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.rowFft = new Fft1d(width);
    this.columnFft = new Fft1d(height);
    this.columnRe = new Float64Array(height);
    this.columnIm = new Float64Array(height);
  }

  public forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, false);
  }

  // Includes the 1 / (width × height) scaling, so forward then inverse returns the input.
  public inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, true);
    const scale = 1 / (this.width * this.height);
    for (let i = 0; i < re.length; i++) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }

  private transform(re: Float64Array, im: Float64Array, isInverse: boolean): void {
    const { width, height, columnRe, columnIm } = this;
    for (let row = 0; row < height; row++) this.rowFft.transform(re, im, row * width, isInverse);
    for (let column = 0; column < width; column++) {
      for (let row = 0; row < height; row++) {
        columnRe[row] = re[row * width + column];
        columnIm[row] = im[row * width + column];
      }
      this.columnFft.transform(columnRe, columnIm, 0, isInverse);
      for (let row = 0; row < height; row++) {
        re[row * width + column] = columnRe[row];
        im[row * width + column] = columnIm[row];
      }
    }
  }
}

export class Fft1d {
  private readonly bitReversed: Uint32Array;
  private readonly cosines: Float64Array;
  private readonly sines: Float64Array;

  public constructor(private readonly size: number) {
    if (size < 1 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    const bits = Math.log2(size);
    this.bitReversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) reversed |= ((i >> bit) & 1) << (bits - 1 - bit);
      this.bitReversed[i] = reversed;
    }
    this.cosines = new Float64Array(size / 2);
    this.sines = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosines[i] = Math.cos((2 * Math.PI * i) / size);
      this.sines[i] = Math.sin((2 * Math.PI * i) / size);
    }
  }

  // Transforms `size` values starting at `offset`.
  public transform(re: Float64Array, im: Float64Array, offset: number, isInverse: boolean): void {
    const size = this.size;
    const bitReversed = this.bitReversed;
    for (let i = 0; i < size; i++) {
      const j = bitReversed[i];
      if (j <= i) continue;
      const a = offset + i;
      const b = offset + j;
      const swapRe = re[a];
      re[a] = re[b];
      re[b] = swapRe;
      const swapIm = im[a];
      im[a] = im[b];
      im[b] = swapIm;
    }
    const cosines = this.cosines;
    const sines = this.sines;
    const sign = isInverse ? 1 : -1;
    const end = offset + size;
    for (let half = 1; half < size; half <<= 1) {
      const span = half << 1;
      const twiddleStride = size / span;
      // One twiddle per k, applied to every butterfly that uses it.
      for (let k = 0; k < half; k++) {
        const twiddleRe = cosines[k * twiddleStride];
        const twiddleIm = sign * sines[k * twiddleStride];
        for (let even = offset + k; even < end; even += span) {
          const odd = even + half;
          const oddRe = re[odd] * twiddleRe - im[odd] * twiddleIm;
          const oddIm = re[odd] * twiddleIm + im[odd] * twiddleRe;
          const evenRe = re[even];
          const evenIm = im[even];
          re[odd] = evenRe - oddRe;
          im[odd] = evenIm - oddIm;
          re[even] = evenRe + oddRe;
          im[even] = evenIm + oddIm;
        }
      }
    }
  }
}
