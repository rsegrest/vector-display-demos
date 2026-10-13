// Messages between the page and the Lenia simulation (in a worker, or inline as a fallback).
export type ToSimulation =
  | { readonly type: "init"; readonly width: number; readonly height: number }
  | { readonly type: "load"; readonly speciesIndex: number; readonly seed: number }
  | { readonly type: "drop"; readonly x: number; readonly y: number }
  | { readonly type: "erase"; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly type: "rate"; readonly stepsPerSecond: number }
  | { readonly type: "pause"; readonly isPaused: boolean }
  | { readonly type: "step" };

export interface SimulationFrame {
  readonly type: "frame";
  readonly cells: Float32Array;
  readonly stepCount: number;
  readonly mass: number;
  readonly seededMass: number;
  readonly speciesIndex: number;
  readonly placedCount: number;
}

export type PostFrame = (frame: SimulationFrame, transfer: Transferable[]) => void;
