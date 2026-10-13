// A tiny pinhole camera for the terrain flyover. The world here is y-up (altitude
// above the ground), unlike the y-down drawing frame, so the maths reads naturally;
// the projector returns screen coordinates in the usual y-down frame.
//
// There is no @vector-display/3d package installed, and this demo needs very little
// of one: one camera, one ground plane, no clipping of polygons because everything
// drawn is a line with both ends visible. That is the whole projection.

export interface ProjectionSettings {
  // Horizontal centre of the screen.
  readonly centreX: number;
  // Screen y of the vanishing point.
  readonly horizonY: number;
  // Larger focal lengths flatten the view; smaller ones rush it.
  readonly focalLength: number;
  // Height of the camera above the ground plane.
  readonly cameraHeight: number;
  // Depths at or below this are clamped, so nothing divides by zero.
  readonly nearDepth: number;
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

// lateral: world x, 0 at the centre of the flight path. altitude: height above the
// ground. depth: distance ahead of the camera, increasing away from the viewer.
export function projectPoint(lateral: number, altitude: number, depth: number, settings: ProjectionSettings): ProjectedPoint {
  const safeDepth = Math.max(depth, settings.nearDepth);
  const scale = settings.focalLength / safeDepth;
  return {
    x: settings.centreX + lateral * scale,
    y: settings.horizonY + (settings.cameraHeight - altitude) * scale,
  };
}
