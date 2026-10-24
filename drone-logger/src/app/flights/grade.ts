/**
 * Lumetri-style Basic Correction for the flight footage, done on the GPU with WebGL: the same shader grades the
 * preview and every frame of the finished video, so what you see is what renders.
 *
 * Per pixel, in order: exposure and white balance (temperature, tint) as channel gains, saturation around the
 * pixel's luma, then one tone curve on each channel for contrast, highlights, shadows, whites and blacks.
 */
export interface Grade {
  /** Blue (−100) to orange (+100). */
  temperature: number;
  /** Green (−100) to magenta (+100). */
  tint: number;
  /** Percent; 100 is as recorded. */
  saturation: number;
  /** Stops, −4 to +4. */
  exposure: number;
  /** −100 (flat) to +100 (a strong S-curve). */
  contrast: number;
  /** −100 to +100: the bright tones, the dark tones, the very top and the very bottom of the range. */
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

export const NEUTRAL_GRADE: Grade = {
  temperature: 0, tint: 0, saturation: 100, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
};

export const isNeutral = (g: Grade) => (Object.keys(NEUTRAL_GRADE) as (keyof Grade)[]).every(k => g[k] === NEUTRAL_GRADE[k]);

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A soft bump peaking at 1 on `at` and falling to 0 `width` either side. */
const bump = (v: number, at: number, width: number) => Math.max(0, 1 - ((v - at) / width) ** 2);

/** The tone curve, 0–1 in and out. Highlights and shadows leave black and white where they are; whites and blacks move them. */
export function toneCurve(g: Grade, v: number): number {
  const c = g.contrast / 100;
  // Contrast: towards a smoothstep S-curve (steeper mids, ends held), or towards a flatter line for negative values.
  let out = c >= 0 ? v + (v * v * (3 - 2 * v) - v) * c : v + (0.5 + (v - 0.5) * 0.5 - v) * -c;
  out += (g.highlights / 100) * 0.12 * bump(v, 0.75, 0.3);
  out += (g.shadows / 100) * 0.12 * bump(v, 0.25, 0.3);
  out += (g.whites / 100) * 0.15 * smooth(0.5, 1, v);
  out += (g.blacks / 100) * 0.15 * (1 - smooth(0, 0.5, v));
  return Math.min(1, Math.max(0, out));
}

/**
 * Red, green and blue gains for exposure and white balance. Exposure is in stops of light, so on gamma-encoded video
 * it's 2^(stops / 2.2); warm adds red and takes blue, magenta takes green.
 */
export function channelGains(g: Grade): [number, number, number] {
  const e = 2 ** (g.exposure / 2.2), t = g.temperature / 100, m = g.tint / 100;
  return [e * (1 + 0.25 * t) * (1 + 0.1 * m), e * (1 - 0.2 * m), e * (1 - 0.25 * t) * (1 + 0.1 * m)];
}

const VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  // Frame rows run top to bottom, clip space bottom to top.
  uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D frame;
uniform sampler2D curve;
uniform vec3 gains;
uniform float saturation;
in vec2 uv;
out vec4 color;
float tone(float v) { return texture(curve, vec2(v * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r; }
void main() {
  vec3 c = texture(frame, uv).rgb * gains;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(mix(vec3(luma), c, saturation), 0.0, 1.0);
  color = vec4(tone(c.r), tone(c.g), tone(c.b), 1.0);
}`;

/** Grades frames into its canvas with WebGL 2. */
export class GradeRenderer {
  private gl: WebGL2RenderingContext | null;
  private frame: WebGLTexture | null = null;
  private curve: WebGLTexture | null = null;
  private uGains: WebGLUniformLocation | null = null;
  private uSaturation: WebGLUniformLocation | null = null;
  /** The grade the curve texture was last built for, to skip rebuilding it every frame. */
  private curveFor = '';

  constructor(readonly canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (this.gl) this.setUp(this.gl);
  }

  /** False where the browser has no WebGL 2: the footage then goes ungraded. */
  get ready() { return !!this.gl; }

  private setUp(gl: WebGL2RenderingContext) {
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Grade shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    const texture = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.frame = texture(0);
    this.curve = texture(1);
    gl.uniform1i(gl.getUniformLocation(program, 'frame'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'curve'), 1);
    this.uGains = gl.getUniformLocation(program, 'gains');
    this.uSaturation = gl.getUniformLocation(program, 'saturation');
  }

  /** Draws `source` (a video, canvas or frame of `width`×`height`) graded into the canvas, sized to match. */
  draw(source: TexImageSource, width: number, height: number, grade: Grade): boolean {
    const gl = this.gl;
    if (!gl || !width || !height) return false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const key = JSON.stringify(grade);
    if (key !== this.curveFor) {
      const table = new Uint8Array(256);
      for (let i = 0; i < 256; i++) table[i] = Math.round(toneCurve(grade, i / 255) * 255);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curve);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, table);
      gl.uniform3fv(this.uGains, channelGains(grade));
      gl.uniform1f(this.uSaturation, grade.saturation / 100);
      this.curveFor = key;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
}
