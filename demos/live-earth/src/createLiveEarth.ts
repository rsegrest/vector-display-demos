import geo from "@vector-demos/travel-globe/geo.json";
import { QUAKE_MAXIMUM_AGE_MILLISECONDS, browserEnvironment, loadQuakes, loadSatelliteElements, type Snapshot } from "./data/LiveData.js";
import snapshotData from "./data/snapshot.json";
import { LiveEarthDemo } from "./LiveEarthDemo.js";

// Builds the live Earth with its map and starts fetching its data, for whoever
// wants to show it: the demo's own page, or a window in Vector OS.
//
// Satellite orbits and earthquakes are fetched from CelesTrak and the USGS; if
// either cannot be reached, the copy bundled with the demo is used instead, and
// the demo labels it as a snapshot. Earthquakes are checked again every few minutes.
// Returns the demo and a function that stops the checking.
export function createLiveEarth(): { demo: LiveEarthDemo; stop: () => void } {
  // The travel globe's map data: coastlines and borders as longitude, latitude pairs.
  const demo = new LiveEarthDemo({ coastLines: (geo as unknown as { countryLines: number[][] }).countryLines });
  const environment = browserEnvironment();
  const snapshot = snapshotData as unknown as Snapshot;
  void loadSatelliteElements(environment, snapshot).then((data) => demo.setSatellites(data));
  const refreshQuakes = (): void => void loadQuakes(environment, snapshot).then((data) => demo.setQuakes(data));
  refreshQuakes();
  // New earthquakes keep coming; orbits do not change fast enough to need refetching in one sitting.
  const timer = setInterval(refreshQuakes, QUAKE_MAXIMUM_AGE_MILLISECONDS + 5000);
  return { demo, stop: () => clearInterval(timer) };
}
