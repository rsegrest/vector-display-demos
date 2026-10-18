import "../page.css";
import { startVectorOsVr } from "@vector-demos/vector-os";

startVectorOsVr(
  document.getElementById("screen") as HTMLCanvasElement,
  document.getElementById("enter-vr") as HTMLButtonElement,
  document.getElementById("vr-note") as HTMLElement,
);
