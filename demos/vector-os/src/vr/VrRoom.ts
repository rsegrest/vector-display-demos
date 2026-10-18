// Draws the virtual cabinet's room into a WebGL2 context: the floor's grid, the
// screen showing a picture taken from another canvas (Vector OS's), and the
// controllers' rays.  One draw call each; nothing here knows about WebXR, so
// the page's flat preview draws through it too.

import { floorLines, multiply, screenVertices, type Screen } from "./geometry.js";

const TEXTURED_VS = `#version 300 es
in vec3 a_position; in vec2 a_uv; uniform mat4 u_mvp; out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = u_mvp * vec4(a_position, 1.0); }`;
const TEXTURED_FS = `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_picture; out vec4 colour;
void main() { colour = vec4(texture(u_picture, v_uv).rgb, 1.0); }`;
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
  private readonly lines: WebGLProgram;
  private readonly screenVao: WebGLVertexArrayObject;
  private readonly floorVao: WebGLVertexArrayObject;
  private readonly floorCount: number;
  private readonly rayVao: WebGLVertexArrayObject;
  private readonly rayBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;

  public constructor(private readonly gl: WebGL2RenderingContext, screen: Screen) {
    this.textured = program(gl, TEXTURED_VS, TEXTURED_FS);
    this.lines = program(gl, LINE_VS, LINE_FS);

    this.screenVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.screenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, screenVertices(screen), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.textured, "a_position");
    const uv = gl.getAttribLocation(this.textured, "a_uv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);

    const floor = floorLines();
    this.floorCount = floor.length / 3;
    this.floorVao = this.lineVao(floor, gl.STATIC_DRAW).vao;
    const ray = this.lineVao(new Float32Array(6), gl.DYNAMIC_DRAW);
    this.rayVao = ray.vao;
    this.rayBuffer = ray.buffer;
    gl.bindVertexArray(null);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private lineVao(data: Float32Array, usage: number): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const position = gl.getAttribLocation(this.lines, "a_position");
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
  public draw(projection: ArrayLike<number>, view: ArrayLike<number>, rays: readonly { origin: number[]; end: number[] }[] = []): void {
    const gl = this.gl;
    const mvp = multiply(projection, view);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lines, "u_mvp"), false, mvp);
    gl.uniform4f(gl.getUniformLocation(this.lines, "u_colour"), 0.05, 0.16, 0.18, 1);
    gl.bindVertexArray(this.floorVao);
    gl.drawArrays(gl.LINES, 0, this.floorCount);

    gl.useProgram(this.textured);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.textured, "u_mvp"), false, mvp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.textured, "u_picture"), 0);
    gl.bindVertexArray(this.screenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.useProgram(this.lines);
    gl.uniform4f(gl.getUniformLocation(this.lines, "u_colour"), 0.55, 1, 1, 1);
    gl.bindVertexArray(this.rayVao);
    for (const ray of rays) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rayBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, Float32Array.from([...ray.origin, ...ray.end]));
      gl.drawArrays(gl.LINES, 0, 2);
    }
    gl.bindVertexArray(null);
  }
}
