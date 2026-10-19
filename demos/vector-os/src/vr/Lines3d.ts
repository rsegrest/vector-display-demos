// Glowing lines in 3D, for a game's picture drawn in the room (Tempest's well):
// each line a strip facing the eye, a fixed number of pixels wide, bright in
// the middle and fading to the sides, added onto what is there (a beam's light
// adds).  Drawn twice, a thin core and a wide dim glow, as the flat renderer's
// beam and glow.

const VS = `#version 300 es
in vec3 a_from; in vec3 a_to; in vec2 a_corner; in vec4 a_colour;
uniform mat4 u_mvp; uniform vec2 u_viewport; uniform float u_width;
out float v_side; out vec4 v_colour;
void main() {
  vec4 a = u_mvp * vec4(a_from, 1.0);
  vec4 b = u_mvp * vec4(a_to, 1.0);
  a.w = max(a.w, 1e-3); b.w = max(b.w, 1e-3);
  vec2 sa = a.xy / a.w * u_viewport * 0.5;
  vec2 sb = b.xy / b.w * u_viewport * 0.5;
  vec2 along = sb - sa;
  vec2 dir = length(along) > 1e-4 ? normalize(along) : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  bool atEnd = a_corner.x > 0.5;
  vec4 p = atEnd ? b : a;
  vec2 offset = (normal * a_corner.y + dir * (atEnd ? 1.0 : -1.0) * 0.5) * u_width;
  p.xy += offset / (u_viewport * 0.5) * p.w;
  gl_Position = p;
  v_side = a_corner.y;
  v_colour = a_colour;
}`;
const FS = `#version 300 es
precision mediump float; in float v_side; in vec4 v_colour; uniform float u_gain; out vec4 colour;
void main() {
  float light = exp(-3.0 * v_side * v_side) * v_colour.a * u_gain;
  colour = vec4(v_colour.rgb * light, 1.0);
}`;

const CORNERS = [0, -1, 0, 1, 1, -1, 1, -1, 0, 1, 1, 1]; // (end, side) for the strip's two triangles

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

export class Lines3d {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private count = 0;
  private data = new Float32Array(0);

  public constructor(private readonly gl: WebGL2RenderingContext) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
    this.program = p;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = 12 * 4;
    const attribute = (name: string, size: number, offset: number) => {
      const location = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
    };
    attribute("a_from", 3, 0);
    attribute("a_to", 3, 3);
    attribute("a_corner", 2, 6);
    attribute("a_colour", 4, 8);
    gl.bindVertexArray(null);
  }

  /** Takes a picture's lines: x, y, z per end (two ends a line), and r, g, b, brightness per line. */
  public setLines(positions: Float32Array, colours: Float32Array): void {
    const lines = positions.length / 6;
    const size = lines * 6 * 12;
    if (this.data.length < size) this.data = new Float32Array(size);
    const out = this.data;
    let o = 0;
    for (let i = 0; i < lines; i += 1) {
      for (let c = 0; c < 6; c += 1) {
        out.set(positions.subarray(i * 6, i * 6 + 6), o);
        out[o + 6] = CORNERS[c * 2];
        out[o + 7] = CORNERS[c * 2 + 1];
        out.set(colours.subarray(i * 4, i * 4 + 4), o + 8);
        o += 12;
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, size), gl.DYNAMIC_DRAW);
    this.count = lines * 6;
  }

  /** Draws the lines for one eye into the bound framebuffer's current viewport. */
  public draw(mvp: Float32Array, viewport: { width: number; height: number }): void {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "u_mvp"), false, mvp);
    gl.uniform2f(gl.getUniformLocation(this.program, "u_viewport"), viewport.width, viewport.height);
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    // A wide dim glow, then the bright core.
    for (const [width, gain] of [
      [Math.max(6, viewport.width / 250), 0.35],
      [Math.max(2, viewport.width / 900), 1.2],
    ]) {
      gl.uniform1f(gl.getUniformLocation(this.program, "u_width"), width);
      gl.uniform1f(gl.getUniformLocation(this.program, "u_gain"), gain);
      gl.drawArrays(gl.TRIANGLES, 0, this.count);
    }
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }
}
