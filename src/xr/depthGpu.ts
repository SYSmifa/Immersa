import type { WebGLRenderer } from 'three';

// Reads the headset's depth when the browser gives it only as a GPU texture ("gpu-optimized"; on the Quest it is what you get
// even if the page asks for CPU access). The texture is a depth buffer (values 0..1, not metres) with one layer per eye: a tiny
// shader samples it at a grid of points and in a small patch at the centre, into a float texture that is read back at once.
// Used by the ?depth probe, which turns the raw values into metres (see rawToMeters).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const GRID_U = 32;
export const GRID_V = 24;
export const PATCH = 7; // the centre patch is PATCH x PATCH samples, 0.008 of the view apart
const W = GRID_U + PATCH;
const H = GRID_V;
const UNIT = 7; // a texture unit three.js does not use

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uDepth;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uJitter;
uniform float uLayer;
uniform float uPatch;
out vec4 o;
void main() {
  vec2 p = floor(gl_FragCoord.xy - uOrigin);
  vec2 uv = uPatch > 0.5 ? vec2(0.5) + (p - vec2(${((PATCH - 1) / 2).toFixed(1)})) * 0.008 : (p + uJitter) / uSize;
  o = vec4(texture(uDepth, vec3(uv, uLayer)).r, 0.0, 0.0, 1.0);
}`;

export interface GpuDepth {
  grid: Float32Array; // raw values, GRID_V rows of GRID_U (row b, column a at b * GRID_U + a)
  patch: Float32Array; // raw values of the centre patch
  jitter: [number, number]; // where in its cell each grid sample was taken
  near: number;
  far: number;
  width: number;
  height: number;
}

// A depth-buffer value 0..1 to the distance along the view axis, in metres, for a perspective projection with these planes.
export function rawToMeters(d: number, near: number, far: number): number {
  if (!(d > 0 && d < 1)) return 0; // nothing measured / beyond the range
  if (!Number.isFinite(far) || far > 1e6) return near / (1 - d);
  return (2 * near * far) / (far + near - (2 * d - 1) * (far - near));
}

export function createGpuDepthReader(renderer: WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let binding: Any = null;
  let prog: WebGLProgram | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let target: WebGLTexture | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};
  let error = '';
  const out = new Float32Array(W * H * 4);

  function setup() {
    if (prog) return true;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      error = 'manca EXT_color_buffer_float';
      return false;
    }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    prog = p;
    for (const n of ['uDepth', 'uOrigin', 'uSize', 'uJitter', 'uLayer', 'uPatch']) loc[n] = gl.getUniformLocation(p, n);
    target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, W, H);
    gl.bindTexture(gl.TEXTURE_2D, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    vao = gl.createVertexArray();
    if (!ok) error = 'framebuffer float incompleto';
    return ok;
  }

  return {
    get error() {
      return error;
    },
    // Depth of one view of this frame, or null (not available this frame, or an error: see `error`).
    read(session: XRSession, view: XRView, viewIndex: number): GpuDepth | null {
      try {
        if (!binding) binding = new (window as Any).XRWebGLBinding(session, gl);
        const info: Any = binding.getDepthInformation(view);
        if (!info || info.isValid === false || !info.texture) return null;
        if (!setup()) return null;
        const jitter: [number, number] = [Math.random(), Math.random()];
        // remember what three.js had set, to put it back
        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
        const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
        const prevScissor = gl.isEnabled(gl.SCISSOR_TEST);
        const prevDepth = gl.isEnabled(gl.DEPTH_TEST);
        const prevBlend = gl.isEnabled(gl.BLEND);
        const prevCull = gl.isEnabled(gl.CULL_FACE);
        gl.activeTexture(gl.TEXTURE0 + UNIT);
        const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
        while (gl.getError() !== gl.NO_ERROR);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, info.texture);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); // may be refused on an opaque texture: harmless
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        while (gl.getError() !== gl.NO_ERROR);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.uniform1i(loc.uDepth, UNIT);
        gl.uniform1f(loc.uLayer, info.imageIndex ?? viewIndex);
        gl.uniform2f(loc.uJitter, jitter[0], jitter[1]);
        gl.uniform2f(loc.uSize, GRID_U, GRID_V);
        gl.uniform1f(loc.uPatch, 0);
        gl.uniform2f(loc.uOrigin, 0, 0);
        gl.viewport(0, 0, GRID_U, GRID_V);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.uniform1f(loc.uPatch, 1);
        gl.uniform2f(loc.uOrigin, GRID_U, 0);
        gl.viewport(GRID_U, 0, PATCH, PATCH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);
        const err = gl.getError();
        // put everything back
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
        gl.useProgram(prevProg);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, prevTex);
        gl.activeTexture(prevActive);
        if (prevScissor) gl.enable(gl.SCISSOR_TEST);
        if (prevDepth) gl.enable(gl.DEPTH_TEST);
        if (prevBlend) gl.enable(gl.BLEND);
        if (prevCull) gl.enable(gl.CULL_FACE);
        renderer.resetState();
        if (err !== gl.NO_ERROR) {
          error = `errore GL ${err}`;
          return null;
        }
        const grid = new Float32Array(GRID_U * GRID_V);
        for (let b = 0; b < GRID_V; b++) for (let a = 0; a < GRID_U; a++) grid[b * GRID_U + a] = out[4 * (b * W + a)];
        const patch = new Float32Array(PATCH * PATCH);
        for (let b = 0; b < PATCH; b++) for (let a = 0; a < PATCH; a++) patch[b * PATCH + a] = out[4 * (b * W + GRID_U + a)];
        error = '';
        return {
          grid,
          patch,
          jitter,
          near: Number.isFinite(info.depthNear) && info.depthNear > 0 ? info.depthNear : (session.renderState.depthNear ?? 0.1),
          far: Number.isFinite(info.depthFar) && info.depthFar > 0 ? info.depthFar : (session.renderState.depthFar ?? 1000),
          width: info.width ?? 0,
          height: info.height ?? 0,
        };
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
  };
}
