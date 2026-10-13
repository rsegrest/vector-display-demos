/// <reference lib="webworker" />
import { LeniaRunner } from "../sim/LeniaRunner.js";
import type { ToSimulation } from "../sim/protocol.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const runner = new LeniaRunner((frame, transfer) => scope.postMessage(frame, transfer));
scope.onmessage = (event: MessageEvent<ToSimulation>) => runner.handle(event.data);
