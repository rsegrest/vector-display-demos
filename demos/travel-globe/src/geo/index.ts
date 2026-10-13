// The parts of the travel globe that other globes can build on: the view that
// turns longitude and latitude into screen positions, and the star field.
export { GlobeView, MAX_ZOOM, MIN_ZOOM } from "./GlobeView.js";
export type { GlobeScreen, ProjectedPoint } from "./GlobeView.js";
export { createStars } from "./stars.js";
export type { Star } from "./stars.js";
