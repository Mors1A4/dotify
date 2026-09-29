import React, { useEffect, useRef } from "react";
import { useThemeStore } from "../../store/themeStore";

/* ─────────────────────────────────────────────────────────────
   Types & themes
   ───────────────────────────────────────────────────────────── */

export type NebulaTheme = "theme" | "aurora" | "ember" | "neon" | "ice" | "mono";

export interface NebulaVisualiserProps {
  /** Any Web Audio AnalyserNode. Pass null for an ambient idle animation. */
  analyser?: AnalyserNode | null;
  theme?: NebulaTheme;
  /** Active app theme accent colour (hex) used when theme === "theme" */
  accentColor?: string;
  /** 0.5 = chill … 2 = unhinged. Default 1 */
  intensity?: number;
  /** Freezes audio input and eases into idle mode */
  paused?: boolean;
  /** Fired on detected beats with normalised bass energy 0..1 */
  onBeat?: (energy: number) => void;
  /** Cap device-pixel-ratio for perf (default 2) */
  maxDpr?: number;
  className?: string;
  style?: React.CSSProperties;
}

type RGB = [number, number, number];

function parseHexToRgb01(hex: string): RGB {
  const clean = (hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6,8}$/.test(clean)) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [0.114, 0.725, 0.329]; // Default #1db954
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 1000) / 1000,
    Math.round((g1 + m) * 1000) / 1000,
    Math.round((b1 + m) * 1000) / 1000,
  ];
}

function rgb01ToHex([r, g, b]: RGB): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Derives a smooth, atmospheric, non-jarring 3-stop shader palette [cA, cB, cC]
 * from any UI theme accent hex colour.
 * - Tempura harsh neon/lime hues and caps saturation so additive WebGL bloom
 *   never clips or fatigues the eyes.
 * - Uses a deep, low-luminance ambient shadow (cA), a velvety mid-tone matching
 *   the theme colour (cB), and a harmonious analogous pastel highlight (cC).
 */
export function deriveThemeNebulaPalette(accentHex: string = "#1db954"): [RGB, RGB, RGB] {
  const rgb = parseHexToRgb01(accentHex);
  const [h, s, l] = rgbToHsl(rgb);

  if (s < 0.08) {
    return [
      [0.05, 0.06, 0.09],
      [0.46, 0.50, 0.58],
      [0.80, 0.84, 0.90],
    ];
  }

  // Gently pull harsh yellow-green / pure-green hues toward lush emerald-teal
  const baseHue = h >= 85 && h <= 155 ? h + (160 - h) * 0.35 : h;

  // Stop A: Deep, low-luminance ambient shadow shifted slightly toward cool dusk/sea
  const hueA = baseHue >= 90 && baseHue <= 195 ? baseHue + 18 : baseHue - 20;
  const satA = Math.min(0.46, Math.max(0.24, s * 0.62));
  const cA = hslToRgb(hueA, satA, 0.13);

  // Stop B: Softened, velvety theme mid-tone (capped saturation & luminance to prevent blowout)
  const satB = Math.min(0.56, Math.max(0.32, s * 0.70));
  const ligB = Math.min(0.52, Math.max(0.42, l * 0.82 + 0.10));
  const cB = hslToRgb(baseHue, satB, ligB);

  // Stop C: Harmonious analogous pastel highlight for starlight, rim & waveform halo
  const hueC = baseHue + 26;
  const satC = Math.min(0.44, Math.max(0.24, s * 0.52));
  const cC = hslToRgb(hueC, satC, 0.72);

  return [cA, cB, cC];
}

export function getNebulaThemePalette(
  theme: NebulaTheme,
  accentHex?: string
): [RGB, RGB, RGB] {
  if (theme === "theme") {
    return deriveThemeNebulaPalette(accentHex || "#1db954");
  }
  return THEMES[theme] ?? THEMES.aurora;
}

export function getNebulaThemeHex(
  theme: NebulaTheme,
  accentHex?: string
): string {
  if (theme === "theme") {
    const rgb = parseHexToRgb01(accentHex || "#1db954");
    const [h, s, l] = rgbToHsl(rgb);
    if (s < 0.08) return "#c8d0dc";
    const baseHue = h >= 85 && h <= 155 ? h + (160 - h) * 0.35 : h;
    const softSat = Math.min(0.58, Math.max(0.35, s * 0.74));
    const softLig = Math.min(0.60, Math.max(0.48, l * 0.85 + 0.10));
    return rgb01ToHex(hslToRgb(baseHue, softSat, softLig));
  }
  return THEME_HEX[theme] || "#40f4bf";
}

export const THEMES: Record<NebulaTheme, [RGB, RGB, RGB]> = {
  theme:  deriveThemeNebulaPalette("#1db954"),
  aurora: [[0.02, 0.35, 0.55], [0.25, 0.95, 0.75], [0.85, 0.35, 1.0]],
  ember:  [[0.45, 0.05, 0.05], [1.0, 0.45, 0.1], [1.0, 0.9, 0.5]],
  neon:   [[0.1, 0.0, 0.5], [1.0, 0.1, 0.6], [0.2, 1.0, 1.0]],
  ice:    [[0.0, 0.1, 0.35], [0.3, 0.7, 1.0], [0.9, 0.95, 1.0]],
  mono:   [[0.05, 0.05, 0.07], [0.55, 0.55, 0.6], [1.0, 1.0, 1.0]],
};

export const THEME_HEX: Record<NebulaTheme, string> = {
  theme:  getNebulaThemeHex("theme", "#1db954"),
  aurora: "#40f4bf",
  ember:  "#ff731a",
  neon:   "#ff1a99",
  ice:    "#4db8ff",
  mono:   "#e6e6e6",
};

/* ─────────────────────────────────────────────────────────────
   Shaders
   ───────────────────────────────────────────────────────────── */

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform float u_bass, u_mid, u_treble, u_energy;
uniform float u_beat, u_beatTime, u_intensity;
uniform vec3  u_colA, u_colB, u_colC;
uniform sampler2D u_fft;   // 256x1 log-mapped spectrum
uniform sampler2D u_wave;  // 512x1 waveform

#define TAU 6.28318530718

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for(int i = 0; i < 5; i++){ v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}
float fft(float x){ return texture2D(u_fft, vec2(clamp(x,0.0,1.0), 0.5)).r; }
float wave(float x){ return texture2D(u_wave, vec2(fract(x), 0.5)).r; }

vec3 palette(float t){
  t = clamp(t, 0.0, 1.0);
  return mix(mix(u_colA, u_colB, smoothstep(0.0, 0.55, t)), u_colC, smoothstep(0.55, 1.0, t));
}

/* twinkling parallax star layer */
float stars(vec2 uv, float scale, float speed, float seed){
  vec2 p = uv * scale + vec2(seed * 13.1, u_time * speed);
  vec2 i = floor(p), f = fract(p);
  float h = hash(i + seed);
  vec2 c = vec2(hash(i + seed + 1.3), hash(i + seed + 7.1)) * 0.8 + 0.1;
  float d = length(f - c);
  float size = mix(0.015, 0.05, hash(i + seed + 3.7));
  float m = smoothstep(size, 0.0, d);
  float tw = 0.55 + 0.45 * sin(u_time * (2.0 + 5.0 * h) + h * 30.0);
  return m * step(0.72, h) * tw;
}

/* orb silhouette: fill + hot rim + soft glow */
float coreShape(float rr, float R){
  float fill = smoothstep(R, R - 0.012, rr);
  float rim  = exp(-abs(rr - R) * 95.0);
  float glow = exp(-max(rr - R, 0.0) * 5.5) * 0.30;
  return fill * 0.5 + rim * 1.5 + glow;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t   = u_time;
  float r   = length(uv);
  float ang = atan(uv.y, uv.x);
  float a01 = ang / TAU + 0.5;
  float I   = u_intensity;

  /* ── 1. nebula ─────────────────────────────── */
  float rot = t * 0.02;
  vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv * 1.4;
  vec2 w = vec2(fbm(q + vec2(0.0, t * 0.05)), fbm(q + vec2(5.2, 1.3) - t * 0.04));
  float n = fbm(q * 2.0 + 1.6 * w + u_bass * 0.35);
  vec3 col = palette(n) * (0.05 + 0.5 * n * n) * (0.45 + 1.6 * u_bass * I);
  col *= smoothstep(1.45, 0.05, r);

  /* ── 2. particles ─────────────────────────── */
  vec2 puv = uv * (1.0 - 0.08 * u_bass);
  float sp = 0.03 + 0.28 * u_energy;
  float s  = stars(puv,  6.0, sp * 0.5, 1.0) * 0.6
           + stars(puv, 12.0, sp,       2.0) * 0.8
           + stars(puv, 22.0, sp * 1.7, 3.0);
  col += s * mix(vec3(0.75, 0.85, 1.0), u_colC, 0.5) * (0.35 + 1.6 * u_treble);

  /* ── 3. spectrum core ─────────────────────── */
  float fx   = 1.0 - abs(2.0 * fract(a01 + 0.25) - 1.0);  // mirror L/R, bass at bottom
  float spec = pow(fft(fx * 0.8), 1.35);
  float baseR = 0.20 + 0.05 * u_bass + 0.035 * u_beat;
  float R     = baseR + spec * 0.22 * I;

  float ca = 0.003 + 0.022 * u_beat;                     // chromatic aberration
  vec3 shape = vec3(coreShape(r * (1.0 - ca), R), coreShape(r, R), coreShape(r * (1.0 + ca), R));

  float plasma = fbm(vec2(a01 * 6.0, r * 9.0 - t * 0.7) + u_mid * 2.0);
  vec3 innerCol = mix(u_colA * 0.6, palette(plasma), smoothstep(R * 0.2, R, r)) * (0.6 + u_mid);
  vec3 rimCol   = palette(0.45 + spec * 0.55 + 0.15 * sin(ang * 3.0 + t));
  vec3 coreCol  = mix(innerCol, rimCol, smoothstep(R - 0.08, R, r));
  col = mix(col, coreCol * shape, clamp(shape.g, 0.0, 1.0));
  col += rimCol * shape * 0.45;

  /* god-rays from the orb */
  float rays = pow(0.5 + 0.5 * sin(ang * 28.0 + t * 0.6 + 5.0 * fbm(uv * 2.5)), 8.0);
  rays *= smoothstep(R, R + 0.04, r) * exp(-(r - R) * 3.5) * (0.35 * u_bass + 1.2 * u_beat) * I;
  col += rays * palette(0.7);

  /* ── 4. radial bars + oscilloscope halo ───── */
  float segs = 64.0;
  float bars = smoothstep(0.34, 0.30, abs(fract(fx * segs) - 0.5));
  float specB = fft((floor(fx * segs) + 0.5) / segs * 0.8);
  float bR0 = baseR + 0.19, bR1 = bR0 + specB * 0.16 * I;
  float bar = bars * smoothstep(bR0 - 0.004, bR0, r) * smoothstep(bR1 + 0.004, bR1, r);
  col += bar * palette(specB * 0.9) * (0.3 + 0.6 * u_mid);

  float wv = wave(a01 * 2.0 + t * 0.02) * 2.0 - 1.0;
  float wR = baseR + 0.42 + wv * 0.045 * (0.4 + 1.6 * u_mid) * I;
  float wring = exp(-abs(r - wR) * 170.0);
  col += wring * u_colC * (0.5 + 1.2 * u_treble);

  /* ── 5. beat shockwave ────────────────────── */
  float age = t - u_beatTime;
  float swR = baseR + age * 0.95;
  float sw  = exp(-abs(r - swR) * 45.0) * exp(-age * 2.4) * step(0.0, age);
  col += sw * palette(0.85) * 1.6 * I;

  /* ── post ─────────────────────────────────── */
  col *= 1.0 - 0.5 * pow(r, 1.8);                                    // vignette
  col += (hash(gl_FragCoord.xy + fract(t) * 173.0) - 0.5) * 0.035;   // grain
  col  = 1.0 - exp(-col * 1.35);                                      // filmic tonemap
  col  = pow(max(col, 0.0), vec3(0.94));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */

const FFT_TEX = 256;
const WAVE_TEX = 512;

export const NebulaVisualiser: React.FC<NebulaVisualiserProps> = ({
  analyser = null,
  theme = "theme",
  accentColor,
  intensity = 1,
  paused = false,
  onBeat,
  maxDpr = 2,
  className,
  style,
}) => {
  const storeAccent = useThemeStore((s) => s.colors.accent);
  const resolvedAccent = accentColor || storeAccent || "#1db954";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Live refs so the render loop always sees latest props without re-init
  const live = useRef({ analyser, theme, accentColor: resolvedAccent, intensity, paused, onBeat, maxDpr });
  live.current = { analyser, theme, accentColor: resolvedAccent, intensity, paused, onBeat, maxDpr };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let destroyed = false;

    /* audio buffers */
    let freq = new Uint8Array(0);
    let wavIn = new Uint8Array(0);
    const fftSmooth = new Float32Array(FFT_TEX);
    const fftTex = new Uint8Array(FFT_TEX);
    const waveTex = new Uint8Array(WAVE_TEX).fill(128);
    const binMap: [number, number][] = [];

    /* smoothed features */
    let bass = 0, mid = 0, treble = 0, energy = 0;
    let beat = 0, beatTime = -10;
    const hist = new Float32Array(48);
    let histIdx = 0;
    let lastBeatMs = 0;

    /* smoothed palette colours so theme changes glide without jarring snaps */
    const initPal = getNebulaThemePalette(live.current.theme, live.current.accentColor);
    const curCA: RGB = [...initPal[0]];
    const curCB: RGB = [...initPal[1]];
    const curCC: RGB = [...initPal[2]];

    /* GL state */
    let gl: WebGLRenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let texF: WebGLTexture | null = null;
    let texW: WebGLTexture | null = null;
    const U: Record<string, WebGLUniformLocation | null> = {};

    let t = 0;
    let lastNow = typeof performance !== "undefined" ? performance.now() : Date.now();

    const compile = (g: WebGLRenderingContext, type: number, src: string) => {
      const sh = g.createShader(type);
      if (!sh) return null;
      g.shaderSource(sh, src);
      g.compileShader(sh);
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
        console.error("[Nebula] shader error:", g.getShaderInfoLog(sh));
      }
      return sh;
    };

    const makeTex = (g: WebGLRenderingContext, w: number, data: Uint8Array, unit: number) => {
      const tex = g.createTexture();
      if (!tex) return null;
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, w, 1, 0, g.LUMINANCE, g.UNSIGNED_BYTE, data);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      return tex;
    };

    const initGL = () => {
      gl = canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "high-performance",
      });
      if (!gl) { console.warn("[Nebula] WebGL unavailable"); return false; }
      const g = gl;

      const vs = compile(g, g.VERTEX_SHADER, VERT);
      const fs = compile(g, g.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;

      prog = g.createProgram();
      if (!prog) return false;
      g.attachShader(prog, vs);
      g.attachShader(prog, fs);
      g.linkProgram(prog);
      if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
        console.error("[Nebula] link error:", g.getProgramInfoLog(prog));
        return false;
      }
      g.useProgram(prog);

      // fullscreen triangle
      const buf = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
      const loc = g.getAttribLocation(prog, "a_pos");
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

      [
        "u_res", "u_time", "u_bass", "u_mid", "u_treble", "u_energy", "u_beat", "u_beatTime",
        "u_intensity", "u_colA", "u_colB", "u_colC", "u_fft", "u_wave",
      ].forEach((n) => (U[n] = g.getUniformLocation(prog!, n)));

      texF = makeTex(g, FFT_TEX, fftTex, 0);
      texW = makeTex(g, WAVE_TEX, waveTex, 1);
      g.uniform1i(U.u_fft, 0);
      g.uniform1i(U.u_wave, 1);
      return true;
    };

    const resize = () => {
      const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, live.current.maxDpr);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl?.viewport(0, 0, w, h);
      }
    };

    /** Build a log-ish bin map (more resolution where music lives) */
    const rebuildBinMap = (bins: number) => {
      binMap.length = 0;
      const maxBin = Math.floor(bins * 0.55); // ~12 kHz @ 44.1k
      let prev = 0;
      for (let i = 0; i < FFT_TEX; i++) {
        const p = (i + 1) / FFT_TEX;
        const b = Math.max(prev + 1, Math.floor(Math.pow(p, 2.2) * maxBin));
        binMap.push([prev, Math.min(b, maxBin)]);
        prev = b;
      }
    };

    const avgRange = (arr: Uint8Array, lo: number, hi: number) => {
      lo = Math.max(0, lo); hi = Math.min(arr.length - 1, hi);
      if (hi <= lo) return 0;
      let s = 0;
      for (let i = lo; i <= hi; i++) s += arr[i];
      return s / ((hi - lo + 1) * 255);
    };

    const smooth = (cur: number, target: number, dt: number, atk = 18, rel = 5) =>
      cur + (target - cur) * (1 - Math.exp(-(target > cur ? atk : rel) * dt));

    const analyse = (dt: number, nowMs: number) => {
      const { analyser: an, paused: p, onBeat: cb } = live.current;

      if (an && !p) {
        if (freq.length !== an.frequencyBinCount) {
          freq = new Uint8Array(an.frequencyBinCount);
          wavIn = new Uint8Array(an.fftSize);
          rebuildBinMap(an.frequencyBinCount);
        }
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(wavIn);

        // spectrum texture
        for (let i = 0; i < FFT_TEX; i++) {
          const [lo, hi] = binMap[i] || [0, 1];
          let m = 0;
          for (let b = lo; b <= hi; b++) if (freq[b] > m) m = freq[b];
          fftSmooth[i] = smooth(fftSmooth[i], m / 255, dt, 22, 6);
          fftTex[i] = (fftSmooth[i] * 255) | 0;
        }
        // waveform texture (downsample)
        const step = wavIn.length / WAVE_TEX;
        for (let i = 0; i < WAVE_TEX; i++) waveTex[i] = wavIn[(i * step) | 0];

        // band energies
        const sampleRate = an.context?.sampleRate || 44100;
        const hzPerBin = sampleRate / an.fftSize;
        const b = (hz: number) => Math.round(hz / hzPerBin);
        const rawBass = Math.pow(avgRange(freq, b(20), b(150)), 1.4);
        const rawMid = avgRange(freq, b(150), b(2000));
        const rawTreble = Math.pow(avgRange(freq, b(2000), b(9000)), 0.9) * 1.6;

        bass = smooth(bass, rawBass, dt, 25, 6);
        mid = smooth(mid, rawMid, dt, 20, 6);
        treble = smooth(treble, Math.min(1, rawTreble), dt, 25, 8);
        energy = smooth(energy, (rawBass + rawMid + rawTreble) / 3, dt, 10, 3);

        // beat detection: local energy vs running mean + variance
        let mean = 0;
        for (let i = 0; i < hist.length; i++) mean += hist[i];
        mean /= hist.length;
        let vari = 0;
        for (let i = 0; i < hist.length; i++) vari += (hist[i] - mean) ** 2;
        vari /= hist.length;
        const c = Math.max(1.15, 1.5 - vari * 12);
        if (rawBass > mean * c && rawBass > 0.22 && nowMs - lastBeatMs > 200) {
          beat = 1;
          beatTime = t;
          lastBeatMs = nowMs;
          cb?.(rawBass);
        }
        hist[histIdx] = rawBass;
        histIdx = (histIdx + 1) % hist.length;
      } else {
        // idle / paused: gentle synthetic breathing
        const ib = 0.18 + 0.1 * Math.sin(t * 0.9);
        bass = smooth(bass, ib, dt, 3, 3);
        mid = smooth(mid, 0.15 + 0.05 * Math.sin(t * 1.7), dt, 3, 3);
        treble = smooth(treble, 0.1, dt, 3, 3);
        energy = smooth(energy, 0.12, dt, 3, 3);
        for (let i = 0; i < FFT_TEX; i++) {
          const x = i / FFT_TEX;
          const target = 0.25 * Math.exp(-x * 3) * (0.7 + 0.3 * Math.sin(t * 1.3 + x * 12));
          fftSmooth[i] = smooth(fftSmooth[i], target, dt, 4, 4);
          fftTex[i] = (fftSmooth[i] * 255) | 0;
        }
        for (let i = 0; i < WAVE_TEX; i++) {
          const x = (i / WAVE_TEX) * Math.PI * 4;
          waveTex[i] = (128 + 18 * Math.sin(x + t * 2) * Math.sin(t * 0.6)) | 0;
        }
      }
      beat *= Math.exp(-dt * 4.5);
    };

    const frame = (now: number) => {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      if (!gl || !prog) return;
      const g = gl;

      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      t += dt * (live.current.paused ? 0.35 : 1);

      resize();
      analyse(dt, now);

      const [targetCA, targetCB, targetCC] = getNebulaThemePalette(
        live.current.theme,
        live.current.accentColor
      );
      for (let i = 0; i < 3; i++) {
        curCA[i] = smooth(curCA[i], targetCA[i], dt, 6, 6);
        curCB[i] = smooth(curCB[i], targetCB[i], dt, 6, 6);
        curCC[i] = smooth(curCC[i], targetCC[i], dt, 6, 6);
      }

      if (texF) {
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, texF);
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, FFT_TEX, 1, g.LUMINANCE, g.UNSIGNED_BYTE, fftTex);
      }
      if (texW) {
        g.activeTexture(g.TEXTURE1);
        g.bindTexture(g.TEXTURE_2D, texW);
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, WAVE_TEX, 1, g.LUMINANCE, g.UNSIGNED_BYTE, waveTex);
      }

      g.uniform2f(U.u_res, canvas.width, canvas.height);
      g.uniform1f(U.u_time, t);
      g.uniform1f(U.u_bass, bass);
      g.uniform1f(U.u_mid, mid);
      g.uniform1f(U.u_treble, treble);
      g.uniform1f(U.u_energy, energy);
      g.uniform1f(U.u_beat, beat);
      g.uniform1f(U.u_beatTime, beatTime);
      g.uniform1f(U.u_intensity, live.current.intensity);
      g.uniform3fv(U.u_colA, curCA);
      g.uniform3fv(U.u_colB, curCB);
      g.uniform3fv(U.u_colC, curCC);

      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    /* context loss resilience */
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); };
    const onRestored = () => { if (initGL()) { resize(); raf = requestAnimationFrame(frame); } };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    }

    if (initGL()) {
      resize();
      raf = requestAnimationFrame(frame);
    }

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (gl) {
        if (texF) gl.deleteTexture(texF);
        if (texW) gl.deleteTexture(texW);
        if (prog) gl.deleteProgram(prog);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{ width: "100%", height: "100%", display: "block", background: "#000", ...style }}
    />
  );
};

export default NebulaVisualiser;

/* ─────────────────────────────────────────────────────────────
   Convenience hook: wire an <audio> element to an AnalyserNode
   ───────────────────────────────────────────────────────────── */

export function useAudioAnalyser(
  audioEl: HTMLAudioElement | null,
  fftSize: 1024 | 2048 | 4096 = 2048
): AnalyserNode | null {
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!audioEl || typeof window === "undefined") return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    const src = ctx.createMediaElementSource(audioEl);
    const an = ctx.createAnalyser();
    an.fftSize = fftSize;
    an.smoothingTimeConstant = 0.6; // we do our own attack/release on top
    an.minDecibels = -90;
    an.maxDecibels = -10;
    src.connect(an);
    an.connect(ctx.destination);

    const resume = () => ctx.state === "suspended" && ctx.resume();
    audioEl.addEventListener("play", resume);
    setAnalyser(an);

    return () => {
      audioEl.removeEventListener("play", resume);
      src.disconnect();
      an.disconnect();
      ctx.close();
      setAnalyser(null);
    };
  }, [audioEl, fftSize]);

  return analyser;
}
