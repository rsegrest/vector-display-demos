// Draws the virtual cabinet's room into a WebGL2 context: the floor's grid, the
// screen showing a picture taken from another canvas (Vector OS's), and the
// controllers' rays.  One draw call each; nothing here knows about WebXR, so
// the page's flat preview draws through it too.

import { floorLines, multiply, panelFor, screenVertices, type Screen } from "./geometry.js";
import { Lines3d } from "./Lines3d.js";

/**
 * Where a game's 3D picture stands in the room: its eye (the picture's origin) where the viewer's
 * eye is, lowered by its drop, its distance 1 RIM_DISTANCE metres ahead, and its width and height
 * squeezed by its spread, depth kept.  The defaults are Tempest's: its eye sits so close to the
 * rim that the picture spans 150 degrees (squeezed to a quarter, about 90), and the owner's tries
 * on the Quest (2026-10-18) put the well best 0.3 m below the eye.  A game whose picture is right
 * as it is (Battlezone's) says spread 1, drop 0.
 */
const RIM_DISTANCE = 1.5;
const DEFAULT_SPREAD = 0.25;
const DEFAULT_DROP = 0.3;

function pictureModel(spread: number, drop: number): Float32Array {
  const across = RIM_DISTANCE * spread;
  return Float32Array.from([across, 0, 0, 0, 0, across, 0, 0, 0, 0, RIM_DISTANCE, 0, 0, 1.6 - drop, 0, 1]);
}


const TEXTURED_VS = `#version 300 es
in vec3 a_position; in vec2 a_uv; uniform mat4 u_mvp; out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = u_mvp * vec4(a_position, 1.0); }`;
const TEXTURED_FS = `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_picture; uniform float u_alpha; out vec4 colour;
void main() { colour = vec4(texture(u_picture, v_uv).rgb, u_alpha); }`;
const LINE_VS = `#version 300 es
in vec3 a_position; uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_position, 1.0); }`;
const LINE_FS = `#version 300 es
precision mediump float; uniform vec4 u_colour; out vec4 colour;
void main() { colour = u_colour; }`;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    return shader;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
  return p;
}

export class VrRoom {
  private readonly textured: WebGLProgram;
  private readonly lineProgram: WebGLProgram;
  private readonly screenVao: WebGLVertexArrayObject;
  private readonly screenBuffer: WebGLBuffer;
  /** Whether the floor grid is drawn (not while a program is full screen). */
  public showRoom = true;
  /** How visible the controls panel is, 0..1 (it fades in as the viewer looks down at it). */
  public panelOpacity = 0;
  private readonly statusBuffer: WebGLBuffer;
  private readonly floorVao: WebGLVertexArrayObject;
  private readonly floorCount: number;
  private readonly rayVao: WebGLVertexArrayObject;
  private readonly rayBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly lines: Lines3d;
  /** Whether a 3D picture stands in place of the flat screen (setPicture3d), and where it stands. */
  private picture3d = false;
  private pictureModel = pictureModel(DEFAULT_SPREAD, DEFAULT_DROP);
  private readonly statusVao: WebGLVertexArrayObject;
  private readonly statusTexture: WebGLTexture;

  public constructor(private readonly gl: WebGL2RenderingContext, screen: Screen) {
    this.textured = program(gl, TEXTURED_VS, TEXTURED_FS);
    this.lineProgram = program(gl, LINE_VS, LINE_FS);

    this.screenVao = this.texturedVao(screenVertices(screen));
    this.screenBuffer = this.lastBuffer!;
    // The controls panel under the screen.
    this.statusVao = this.texturedVao(screenVertices(panelFor(screen)));
    this.statusBuffer = this.lastBuffer!;

    const floor = floorLines();
    this.floorCount = floor.length / 3;
    this.floorVao = this.lineVao(floor, gl.STATIC_DRAW).vao;
    const ray = this.lineVao(new Float32Array(6), gl.DYNAMIC_DRAW);
    this.rayVao = ray.vao;
    this.rayBuffer = ray.buffer;
    gl.bindVertexArray(null);

    this.lines = new Lines3d(gl);
    this.texture = this.newTexture();
    this.statusTexture = this.newTexture();
  }

  private newTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return texture;
  }

  private lastBuffer: WebGLBuffer | null = null;

  /** Moves or resizes the screen. */
  public setScreen(screen: Screen): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, screenVertices(screen));
    this.setPanelUnder(screen);
  }

  /** Puts the controls panel under a screen (or under the place a 3D picture's panel goes). */
  public setPanelUnder(screen: Screen): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.statusBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, screenVertices(panelFor(screen)));
  }

  private texturedVao(vertices: Float32Array): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.lastBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lastBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.textured, "a_position");
    const uv = gl.getAttribLocation(this.textured, "a_uv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
    return vao;
  }

  /** A game's picture in 3D in place of the flat screen (ArcadeCabinet.picture3d), or null for the screen. */
  public setPicture3d(
    picture: { readonly positions: Float32Array; readonly colours: Float32Array; readonly spread?: number; readonly drop?: number } | null,
  ): void {
    this.picture3d = picture !== null;
    if (!picture) return;
    this.lines.setLines(picture.positions, picture.colours);
    this.pictureModel = pictureModel(picture.spread ?? DEFAULT_SPREAD, picture.drop ?? DEFAULT_DROP);
  }


  /** Copies a status picture (a 2D canvas of text) for the panel under the screen. */
  public takeStatus(source: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.statusTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private lineVao(data: Float32Array, usage: number): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const position = gl.getAttribLocation(this.lineProgram, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 12, 0);
    return { vao, buffer };
  }

  /** Copies the picture from the source canvas (once a frame, before the eyes are drawn). */
  public takePicture(source: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** Clears the bound framebuffer's viewport to the dark room (call once per framebuffer). */
  public clear(): void {
    const gl = this.gl;
    gl.clearColor(0.004, 0.006, 0.01, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Draws the room for one eye into the bound framebuffer's current viewport. */
  public draw(
    projection: ArrayLike<number>,
    view: ArrayLike<number>,
    rays: readonly { origin: number[]; end: number[] }[] = [],
    viewport: { width: number; height: number } = { width: 1000, height: 1000 },
  ): void {
    const gl = this.gl;
    const mvp = multiply(projection, view);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, "u_mvp"), false, mvp);
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "u_colour"), 0.05, 0.16, 0.18, 1);
    if (this.showRoom) {
      gl.bindVertexArray(this.floorVao);
      gl.drawArrays(gl.LINES, 0, this.floorCount);
    }

    gl.useProgram(this.textured);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.textured, "u_mvp"), false, mvp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.textured, "u_picture"), 0);
    gl.uniform1f(gl.getUniformLocation(this.textured, "u_alpha"), 1);
    if (!this.picture3d) {
      gl.bindVertexArray(this.screenVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (this.panelOpacity > 0.01) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(gl.getUniformLocation(this.textured, "u_alpha"), this.panelOpacity);
      gl.bindTexture(gl.TEXTURE_2D, this.statusTexture);
      gl.bindVertexArray(this.statusVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND);
    }

    if (this.picture3d) this.lines.draw(multiply(mvp, this.pictureModel), viewport);

    gl.useProgram(this.lineProgram);
    gl.uniform4f(gl.getUniformLocation(this.lineProgram, "u_colour"), 0.55, 1, 1, 1);
    gl.bindVertexArray(this.rayVao);
    for (const ray of rays) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rayBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, Float32Array.from([...ray.origin, ...ray.end]));
      gl.drawArrays(gl.LINES, 0, 2);
    }
    gl.bindVertexArray(null);
  }
}
