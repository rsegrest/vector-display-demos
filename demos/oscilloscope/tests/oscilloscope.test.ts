import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { BASE_FREQUENCY, DEFAULT_SAMPLE_RATE, OscilloscopeDemo, PROGRAMS } from "../src/OscilloscopeDemo.js";
import { ScopeEngine } from "../src/sim/ScopeEngine.js";
import { buildPath, cubePath, octahedronPath, samplePath, spiralPath, starPath, textPath } from "@vector-demos/demo-kit";
import { AMPLITUDE, LissajousSource, PathSource, RecordedSource, type SignalSource } from "../src/sim/signals.js";

const RATE = 48000;

function render(source: SignalSource, count: number, sampleRate = RATE): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  source.render(left, right, count, sampleRate);
  return { left, right };
}

// The same signal, asked for in uneven pieces.
function renderInPieces(source: SignalSource, pieces: readonly number[]): { left: number[]; right: number[] } {
  const left: number[] = [];
  const right: number[] = [];
  for (const count of pieces) {
    const piece = render(source, count);
    left.push(...piece.left);
    right.push(...piece.right);
  }
  return { left, right };
}

describe("buildPath", () => {
  it("makes one closed tour, scaled to the unit sphere, timed from 0 to 1", () => {
    const path = starPath();
    expect(path.stopCount).toBe(6);
    expect(Array.from(path.points.subarray(0, 3))).toEqual(Array.from(path.points.subarray(15, 18)));
    expect(path.times[0]).toBe(0);
    expect(path.times[path.stopCount - 1]).toBe(1);
    let farthest = 0;
    for (let stop = 0; stop < path.stopCount; stop++) farthest = Math.max(farthest, Math.hypot(path.points[stop * 3], path.points[stop * 3 + 1], path.points[stop * 3 + 2]));
    expect(farthest).toBeCloseTo(1, 5);
  });

  it("crosses a gap between strokes much faster than it draws", () => {
    // Two unit strokes a unit apart: draw, jump, draw, jump back.
    const path = buildPath([
      { points: [[0, 0, 0], [1, 0, 0]] },
      { points: [[1, 1, 0], [0, 1, 0]] },
    ]);
    expect(path.stopCount).toBe(5);
    const drawTime = path.times[1] - path.times[0];
    const jumpTime = path.times[2] - path.times[1];
    expect(drawTime / jumpTime).toBeCloseTo(7, 4);
    expect(path.times[3] - path.times[2]).toBeCloseTo(drawTime, 6);
  });

  it("walks every edge of the cube and the octahedron", () => {
    const edgesOf = (path: ReturnType<typeof cubePath>, edgeLength: number): Set<string> => {
      const key = (stop: number) => [0, 1, 2].map((axis) => Math.round(path.points[stop * 3 + axis] * 100)).join(",");
      const edges = new Set<string>();
      for (let stop = 1; stop < path.stopCount; stop++) {
        const length = Math.hypot(...[0, 1, 2].map((axis) => path.points[stop * 3 + axis] - path.points[(stop - 1) * 3 + axis]));
        expect(length).toBeCloseTo(edgeLength, 4);
        edges.add([key(stop - 1), key(stop)].sort().join("|"));
      }
      return edges;
    };
    // Corners sit on the unit sphere, which fixes the edge lengths.
    expect(edgesOf(cubePath(), 2 / Math.sqrt(3)).size).toBe(12);
    expect(edgesOf(octahedronPath(), Math.SQRT2).size).toBe(12);
  });

  it("returns the spiral to its start without a jump", () => {
    const path = spiralPath();
    const last = (path.stopCount - 1) * 3;
    expect(Math.hypot(path.points[last] - path.points[0], path.points[last + 1] - path.points[1])).toBeLessThan(1e-6);
  });

  it("traces words from the vector font, and refuses text with no glyphs", () => {
    expect(textPath("VECTOR").stopCount).toBeGreaterThan(20);
    expect(() => textPath("\u0000")).toThrow();
  });
});

describe("samplePath", () => {
  const path = buildPath([{ points: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]], closed: true }]);
  const out: [number, number, number] = [0, 0, 0];

  it("is at each corner on the quarter and half way along a side in between", () => {
    samplePath(path, 0, 0, out);
    const first = [...out];
    samplePath(path, 0.25, 0, out);
    const second = [...out];
    samplePath(path, 0.125, 0, out);
    expect(out[0]).toBeCloseTo((first[0] + second[0]) / 2, 6);
    expect(out[1]).toBeCloseTo((first[1] + second[1]) / 2, 6);
  });

  it("gives the same answer whatever hint it starts from", () => {
    for (const time of [0, 0.1, 0.37, 0.5, 0.99]) {
      samplePath(path, time, 0, out);
      const expected = [...out];
      for (let hint = 0; hint < path.stopCount; hint++) {
        samplePath(path, time, hint, out);
        expect(out).toEqual(expected);
      }
    }
  });
});

describe("LissajousSource", () => {
  it("is two sine waves at the given ratio", () => {
    const { left, right } = render(new LissajousSource({ frequency: 100, ratioX: 2, ratioY: 3, drift: 0 }), 480);
    for (const index of [0, 7, 120, 479]) {
      expect(left[index]).toBeCloseTo(AMPLITUDE * Math.sin((2 * Math.PI * 200 * index) / RATE), 4);
      expect(right[index]).toBeCloseTo(AMPLITUDE * Math.sin((2 * Math.PI * 300 * index) / RATE), 4);
    }
  });

  it("slides the left channel's phase when drifting", () => {
    const steady = render(new LissajousSource({ frequency: 100, ratioX: 1, ratioY: 1, drift: 0 }), RATE / 4);
    const drifting = render(new LissajousSource({ frequency: 100, ratioX: 1, ratioY: 1, drift: 1 }), RATE / 4);
    // After a quarter of a second at one turn per second, the left channel leads by a quarter turn.
    const index = RATE / 4 - 1;
    expect(drifting.right[index]).toBeCloseTo(steady.right[index], 5);
    expect(drifting.left[index]).toBeCloseTo(AMPLITUDE * Math.sin(2 * Math.PI * (100 * (index / RATE) + index / RATE)), 3);
  });

  it("produces the same signal however it is chopped into blocks", () => {
    const whole = render(new LissajousSource({ frequency: 97, ratioX: 3, ratioY: 4, drift: 0.3 }), 3000);
    const pieces = renderInPieces(new LissajousSource({ frequency: 97, ratioX: 3, ratioY: 4, drift: 0.3 }), [1, 999, 512, 1488]);
    expect(pieces.left).toEqual(Array.from(whole.left));
    expect(pieces.right).toEqual(Array.from(whole.right));
  });

  it("follows a change of pitch from the next sample, without a jump", () => {
    const source = new LissajousSource({ frequency: 100, ratioX: 1, ratioY: 1, drift: 0 });
    const before = render(source, 100);
    source.frequency = 200;
    const after = render(source, 100);
    expect(Math.abs(after.right[0] - before.right[99])).toBeLessThan(0.05);
    expect(Math.abs(after.right[1] - after.right[0])).toBeGreaterThan(Math.abs(before.right[99] - before.right[98]));
  });
});

describe("PathSource", () => {
  it("goes round the shape once per cycle and stays inside full scale", () => {
    const { left, right } = render(new PathSource(starPath(), { frequency: 100, roll: 0, yaw: 0 }), 960);
    // 480 samples per cycle at 100 Hz: one cycle later the beam is back where it was.
    for (const index of [0, 13, 200, 479]) {
      expect(left[index + 480]).toBeCloseTo(left[index], 3);
      expect(right[index + 480]).toBeCloseTo(right[index], 3);
    }
    for (let index = 0; index < 960; index++) {
      expect(Math.abs(left[index])).toBeLessThanOrEqual(1);
      expect(Math.abs(right[index])).toBeLessThanOrEqual(1);
    }
  });

  it("turns the shape as it plays", () => {
    const still = render(new PathSource(starPath(), { frequency: 100, roll: 0, yaw: 0 }), RATE / 4 + 1);
    const rolling = render(new PathSource(starPath(), { frequency: 100, roll: 1, yaw: 0 }), RATE / 4 + 1);
    // A quarter turn after a quarter second: what was up is now pointing left.
    const index = RATE / 4;
    expect(rolling.left[index]).toBeCloseTo(-still.right[index], 2);
    expect(rolling.right[index]).toBeCloseTo(still.left[index], 2);
  });

  it("holds the shape still when motion is zero", () => {
    const source = new PathSource(cubePath(), { frequency: 100, roll: 0.3, yaw: 0.4, tilt: 0.5 });
    source.motion = 0;
    const { left } = render(source, 1440);
    for (const index of [0, 100, 479]) expect(left[index + 960]).toBeCloseTo(left[index], 3);
  });

  it("produces the same signal however it is chopped into blocks", () => {
    const settings = { frequency: 83, roll: 0.2, yaw: 0.1, tilt: 0.4 };
    const whole = render(new PathSource(cubePath(), settings), 2500);
    const pieces = renderInPieces(new PathSource(cubePath(), settings), [700, 3, 1024, 773]);
    expect(pieces.left).toEqual(Array.from(whole.left));
    expect(pieces.right).toEqual(Array.from(whole.right));
  });
});

describe("RecordedSource", () => {
  it("plays the recording in order and loops at the end", () => {
    const source = new RecordedSource(Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6]));
    const { left, right } = render(source, 7);
    expect(Array.from(left)).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect(Array.from(right)).toEqual([4, 5, 6, 4, 5, 6, 4]);
    expect(source.positionSamples).toBe(1);
    source.rewind();
    expect(render(source, 1).left[0]).toBe(1);
  });

  it("is silent when the recording is empty", () => {
    const { left } = render(new RecordedSource(new Float32Array(0), new Float32Array(0)), 4);
    expect(Array.from(left)).toEqual([0, 0, 0, 0]);
  });
});

describe("ScopeEngine", () => {
  const counter = (): SignalSource => {
    let next = 0;
    return {
      render: (left, right, count) => {
        for (let index = 0; index < count; index++) {
          left[index] = next;
          right[index] = -next;
          next++;
        }
      },
    };
  };

  it("numbers samples from zero and returns any recent stretch of them", () => {
    const engine = new ScopeEngine(counter(), RATE);
    const left = new Float32Array(5);
    const right = new Float32Array(5);
    engine.copy(3000, 5, left, right);
    expect(Array.from(left)).toEqual([3000, 3001, 3002, 3003, 3004]);
    expect(Array.from(right)).toEqual([-3000, -3001, -3002, -3003, -3004]);
    expect(engine.generated).toBe(3005);
    // Asking again, or for something earlier, does not generate anything new.
    engine.copy(10, 5, left, right);
    expect(Array.from(left)).toEqual([10, 11, 12, 13, 14]);
    expect(engine.generated).toBe(3005);
  });

  it("gives two readers of the same samples the same values", () => {
    const engine = new ScopeEngine(new LissajousSource({ frequency: 110, ratioX: 2, ratioY: 3, drift: 0.2 }), RATE);
    const ahead = new Float32Array(2048);
    const behind = new Float32Array(2048);
    const unused = new Float32Array(2048);
    // The speakers take a block ahead of time; the screen reads the same block later.
    engine.copy(4096, 2048, ahead, unused);
    engine.ensure(20000);
    engine.copy(4096, 2048, behind, unused);
    expect(Array.from(behind)).toEqual(Array.from(ahead));
  });

  it("returns silence for samples too old to remember", () => {
    const engine = new ScopeEngine(counter(), RATE);
    engine.ensure(200000);
    const left = new Float32Array(2);
    engine.copy(5, 2, left, new Float32Array(2));
    expect(Array.from(left)).toEqual([0, 0]);
    expect(engine.oldestAvailable).toBeGreaterThan(5);
  });

  it("switches source from the next sample only", () => {
    const engine = new ScopeEngine(counter(), RATE);
    engine.ensure(100);
    engine.setSource({ render: (left, right, count) => { left.fill(7, 0, count); right.fill(7, 0, count); } });
    const left = new Float32Array(4);
    engine.copy(98, 4, left, new Float32Array(4));
    expect(Array.from(left)).toEqual([98, 99, 7, 7]);
  });
});

describe("OscilloscopeDemo", () => {
  const frame = (seconds: number) => ({ width: 1778, height: 1000, seconds });

  function segments(demo: OscilloscopeDemo, seconds: number): { count: number; data: Float32Array } {
    const displayList = new DisplayList();
    demo.draw(displayList, frame(seconds));
    return { count: displayList.segmentCount, data: displayList.getSegmentData().slice(0, displayList.segmentCount * FLOATS_PER_BEAM_SEGMENT) };
  }

  function createDemo(programIndex = 0): OscilloscopeDemo {
    const demo = new OscilloscopeDemo({ programIndex });
    demo.autoCycle = false;
    demo.showGraticule = false;
    return demo;
  }

  it("draws one segment per sample played since the last frame", () => {
    const demo = createDemo();
    expect(segments(demo, 0).count).toBe(0);
    // 1/60 s at 48 kHz is 800 samples; the first frame has no earlier sample to join on to.
    expect(segments(demo, 1 / 60).count).toBe(799);
    expect(segments(demo, 2 / 60).count).toBe(800);
    expect(demo.playhead).toBe(1600);
  });

  it("keeps the whole trace inside the scope's face", () => {
    for (let program = 0; program < PROGRAMS.length; program++) {
      const demo = createDemo(program);
      segments(demo, 0);
      const { count, data } = segments(demo, 0.05);
      expect(count).toBeGreaterThan(0);
      for (let segment = 0; segment < count; segment++) {
        const offset = segment * FLOATS_PER_BEAM_SEGMENT;
        expect(Math.abs(data[offset] - 889)).toBeLessThanOrEqual(460.5);
        expect(Math.abs(data[offset + 1] - 500)).toBeLessThanOrEqual(460.5);
      }
    }
  });

  it("holds the picture while paused and carries on from the same sample after", () => {
    const demo = createDemo();
    segments(demo, 0);
    const moving = segments(demo, 1 / 60);
    demo.togglePause();
    const held = segments(demo, 2 / 60);
    expect(held.count).toBe(moving.count);
    expect(demo.playhead).toBe(800);
    demo.togglePause();
    segments(demo, 3 / 60);
    expect(demo.playhead).toBe(1600);
  });

  it("follows the audio clock once sound is on, and never runs backwards", () => {
    const demo = createDemo();
    segments(demo, 0);
    segments(demo, 1 / 60);
    let heard = 5000;
    demo.followAudio(() => heard);
    expect(demo.soundOn).toBe(true);
    segments(demo, 2 / 60);
    expect(demo.playhead).toBe(5000);
    heard = 4000;
    segments(demo, 3 / 60);
    expect(demo.playhead).toBe(5000);
    demo.followAudio(null);
    segments(demo, 4 / 60);
    expect(demo.playhead).toBe(5800);
  });

  it("never draws more than a frame's worth after a long stall", () => {
    const demo = createDemo();
    segments(demo, 0);
    expect(segments(demo, 3).count).toBeLessThanOrEqual(4096);
  });

  it("changes pitch in semitones and applies it to the next figure too", () => {
    const demo = createDemo();
    expect(demo.frequency).toBe(BASE_FREQUENCY);
    for (let step = 0; step < 12; step++) demo.changePitch(1);
    expect(demo.frequency).toBeCloseTo(BASE_FREQUENCY * 2, 6);
    demo.changeProgram(1);
    expect(demo.program).toBe(1);
    // An octave up, the 1:2 figure's right channel completes a cycle in 150 samples.
    const left = new Float32Array(301);
    const right = new Float32Array(301);
    const start = demo.engine.generated;
    demo.engine.copy(start, 301, left, right);
    expect(right[150]).toBeCloseTo(right[0], 2);
    expect(right[300]).toBeCloseTo(right[0], 2);
  });

  it("plays a recording in place of the figures, and goes back to them on request", () => {
    const demo = createDemo(3);
    demo.loadRecording("tone", new Float32Array(100).fill(0.5), new Float32Array(100).fill(-0.5));
    expect(demo.hasRecording).toBe(true);
    expect(demo.programName).toBe("FILE TONE");
    const left = new Float32Array(10);
    const right = new Float32Array(10);
    demo.engine.copy(demo.engine.generated, 10, left, right);
    expect(left[5]).toBe(0.5);
    expect(right[5]).toBe(-0.5);
    demo.changeProgram(1);
    expect(demo.hasRecording).toBe(false);
    expect(demo.program).toBe(3);
  });

  it("starts at the default sample rate", () => {
    expect(createDemo().engine.sampleRate).toBe(DEFAULT_SAMPLE_RATE);
  });
});
