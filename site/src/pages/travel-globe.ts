import "../page.css";
import { startTravelGlobe } from "@vector-demos/travel-globe";

startTravelGlobe(document.getElementById("screen") as HTMLCanvasElement, { indexHref: "../", editApi: "/api/travel" });
