export interface CameraView {
  readonly worldWidth: number;
  readonly worldHeight: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

function wrapCentered(value: number, size: number): number {
  return value - Math.round(value / size) * size;
}

function wrap(value: number, size: number): number {
  return value - Math.floor(value / size) * size;
}

// A window onto the toroidal world. The screen and the simulation share one coordinate size,
// so at zoom 1 the whole torus is visible, centered on (centerX, centerY).
export class Camera {
  public centerX = 0;
  public centerY = 0;
  public zoom = 1;
  private worldWidth = 1;
  private worldHeight = 1;
  private readonly scratch = { x: 0, y: 0 };

  public setView(view: CameraView): void {
    if (this.worldWidth === 1 && this.worldHeight === 1) {
      this.centerX = view.worldWidth / 2;
      this.centerY = view.worldHeight / 2;
    } else {
      this.centerX *= view.worldWidth / this.worldWidth;
      this.centerY *= view.worldHeight / this.worldHeight;
    }
    this.worldWidth = view.worldWidth;
    this.worldHeight = view.worldHeight;
  }

  // Returns a shared object: read it before the next call.
  public toScreen(x: number, y: number): { x: number; y: number } {
    this.scratch.x = wrapCentered(x - this.centerX, this.worldWidth) * this.zoom + this.worldWidth / 2;
    this.scratch.y = wrapCentered(y - this.centerY, this.worldHeight) * this.zoom + this.worldHeight / 2;
    return this.scratch;
  }

  public toWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: wrap((screenX - this.worldWidth / 2) / this.zoom + this.centerX, this.worldWidth),
      y: wrap((screenY - this.worldHeight / 2) / this.zoom + this.centerY, this.worldHeight),
    };
  }

  public pan(screenDeltaX: number, screenDeltaY: number): void {
    this.centerX = wrap(this.centerX + screenDeltaX / this.zoom, this.worldWidth);
    this.centerY = wrap(this.centerY + screenDeltaY / this.zoom, this.worldHeight);
  }

  public zoomAbout(factor: number, screenX: number, screenY: number): void {
    const anchor = this.toWorld(screenX, screenY);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    // Move the center so the anchor stays under the same screen point.
    this.centerX = wrap(anchor.x - (screenX - this.worldWidth / 2) / this.zoom, this.worldWidth);
    this.centerY = wrap(anchor.y - (screenY - this.worldHeight / 2) / this.zoom, this.worldHeight);
  }
}
