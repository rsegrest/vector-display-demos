// The globe as a page of its own, for ricksegrest.com/globe (no demo menu to return to).
import { startTravelGlobe } from "../src/index.js";

startTravelGlobe(document.getElementById("screen") as HTMLCanvasElement);
