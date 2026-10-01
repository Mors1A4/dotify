import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { audioEngine } from '../../audio/audioEngine';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type VisualizerMode =
  | 'singularity'
  | 'quantum'
  | 'cymatics'
  | 'hyperdrive';

export type VisualizerThemeId =
  | 'obsidian'
  | 'ultraviolet'
  | 'emerald'
  | 'solar'
  | 'dolby';

export interface VisualizerTheme {
  id: VisualizerThemeId;
  name: string;
  primary: [number, number, number];   // Normalized RGB [0..1]
  secondary: [number, number, number]; // Normalized RGB [0..1]
  accent: [number, number, number];    // Normalized RGB [0..1]
  cssAccent: string;
}

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  sampleRate?: string;
}

export interface UltraAudioVisualizerProps {
  /** Standard Web Audio API AnalyserNode from your audio pipeline */
  analyser?: AnalyserNode | null;
  /** Optional track metadata displayed in the HUD */
  track?: TrackMetadata;
  /** Initial shader mode */
  initialMode?: VisualizerMode;
  /** Initial color palette */
  initialTheme?: VisualizerThemeId;
  /** Audio reactivity multiplier (default: 1.0) */
  sensitivity?: number;
  /** Show the precision 2D telemetry HUD (Vectorscope, dB meters, spectrum) */
  showHud?: boolean;
  /** Show interactive floating control dock */
  showControls?: boolean;
  /** Enable built-in procedural Web Audio synth button when no external stream is playing */
  enableDemoSynth?: boolean;
  /** Max Device Pixel Ratio for WebGL canvas (default: 2.0 for 4K/Retina performance balance) */
  maxDpr?: number;
  /** Optional CSS class name for the root container */
  className?: string;
  /** Optional inline styles for the root container */
  style?: React.CSSProperties;
}

interface AudioMetrics {
  sub: number;
  bass: number;
  mid: number;
  high: number;
  energy: number;
  beat: number;
  bpmEstimate: number;
  isSilent: boolean;
}

// ============================================================================
// COLOR THEMES
// ============================================================================

export const VISUALIZER_THEMES: Record<VisualizerThemeId, VisualizerTheme> = {
  obsidian: {
    id: 'obsidian',
    name: 'Cyber Cyan',
    primary: [0.0, 0.88, 1.0],
    secondary: [0.45, 0.1, 0.95],
    accent: [1.0, 0.2, 0.65],
    cssAccent: '#00e0ff',
  },
  ultraviolet: {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    primary: [0.72, 0.25, 1.0],
    secondary: [0.12, 0.4, 1.0],
    accent: [0.0, 0.98, 0.82],
    cssAccent: '#b840ff',
  },
  emerald: {
    id: 'emerald',
    name: 'Bioluminescent',
    primary: [0.05, 0.96, 0.62],
    secondary: [0.02, 0.48, 0.75],
    accent: [0.78, 1.0, 0.2],
    cssAccent: '#0df59e',
  },
  solar: {
    id: 'solar',
    name: 'Solar Flare',
    primary: [1.0, 0.38, 0.1],
    secondary: [0.85, 0.05, 0.38],
    accent: [1.0, 0.85, 0.25],
    cssAccent: '#ff611a',
  },
  dolby: {
    id: 'dolby',
    name: 'Studio Gold',
    primary: [0.96, 0.78, 0.42],
    secondary: [0.32, 0.38, 0.52],
    accent: [1.0, 0.95, 0.85],
    cssAccent: '#f5c76b',
  },
};

const MODE_LABELS: { id: VisualizerMode; label: string; tag: string }[] = [
  { id: 'singularity', label: 'Aether Singularity', tag: '3D SDF FERROFLUID' },
  { id: 'quantum', label: 'Quantum Horizon', tag: 'VOLUMETRIC WAVES' },
  { id: 'cymatics', label: 'Cymatic Resonance', tag: 'CHLADNI HARMONICS' },
  { id: 'hyperdrive', label: 'Relativistic Warp', tag: 'TUNNEL OSCILLOSCOPE' },
];

// ============================================================================
// GLSL SHADERS (WEBGL 2.0 / GLSL ES 3.00)
// ============================================================================

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_sub;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_beat;
uniform int u_mode;
uniform vec3 u_colPrimary;
uniform vec3 u_colSecondary;
uniform vec3 u_colAccent;
uniform sampler2D u_audioTex; // Row 0 (y=0.25): FFT Spectrum, Row 1 (y=0.75): Waveform

#define PI 3.14159265359
#define TAU 6.28318530718

// --- Utility & Math Functions ---
mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Fast organic 3D Gyroid noise field
float gyroid(vec3 p, float scale) {
  p *= scale;
  return dot(sin(p), cos(p.zxy)) / scale;
}

// Audio Texture Samplers
float sampleFreq(float x) {
  return texture(u_audioTex, vec2(clamp(x, 0.002, 0.998), 0.25)).r;
}

float sampleWave(float x) {
  return (texture(u_audioTex, vec2(clamp(x, 0.002, 0.998), 0.75)).r - 0.5) * 2.0;
}

// Iridescent thin-film palette blended with user theme
vec3 thinFilmPalette(float t) {
  vec3 irid = 0.5 + 0.5 * cos(TAU * (t * vec3(1.0, 0.85, 0.7) + vec3(0.0, 0.33, 0.67)));
  vec3 themeMix = mix(mix(u_colSecondary, u_colPrimary, sin(t * PI) * 0.5 + 0.5), u_colAccent, pow( max(0.0, cos(t * TAU)), 3.0 ));
  return mix(themeMix, irid, 0.28);
}

// ACES Filmic Tone Mapping for true HDR bloom look
vec3 acesToneMapping(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// ============================================================================
// MODE 0: AETHER SINGULARITY (3D Raymarched Ferrofluid + Polar Spectrum Halo)
// ============================================================================

float mapFerrofluid(vec3 p) {
  vec3 q = p;
  q.xz *= rot(u_time * 0.35);
  q.xy *= rot(u_time * 0.22);

  // Base radius expands with sub-bass & kick impulse
  float baseRadius = 0.92 + u_sub * 0.22 + u_beat * 0.14;
  float d = length(q) - baseRadius;

  // Spherical angle for frequency lookup
  float angle = abs(atan(q.y, q.x)) / PI;
  float fVal = sampleFreq(angle * 0.65);

  // Multi-layered acoustic gyroid displacement
  float g1 = gyroid(q + vec3(0.0, 0.0, u_time * 0.8), 3.4 + u_bass * 2.5);
  float g2 = gyroid(q - vec3(u_time * 0.5, 0.0, 0.0), 7.2 + u_mid * 4.0);
  float g3 = gyroid(q + vec3(0.0, u_time * 1.1, 0.0), 14.0);

  float disp = g1 * (0.18 + u_bass * 0.32 + fVal * 0.18)
             + g2 * (0.08 + u_mid * 0.22)
             + g3 * (0.025 + u_high * 0.12);

  d += disp;

  // Orbiting ferrofluid satellite droplets that merge via smooth-min
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float speed = 0.7 + fi * 0.25;
    float orbitR = 1.45 + sin(u_time * 0.9 + fi * 2.0) * 0.35 - u_bass * 0.25;
    vec3 orbPos = vec3(
      cos(u_time * speed + fi * 2.094) * orbitR,
      sin(u_time * speed * 1.3 + fi * 2.094) * (orbitR * 0.6),
      sin(u_time * speed + fi * 2.094) * orbitR
    );
    float satR = 0.22 + sampleFreq(fi * 0.25 + 0.1) * 0.18;
    float dSat = length(p - orbPos) - satR;
    d = smin(d, dSat, 0.45 + u_bass * 0.2);
  }

  return d * 0.65;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0025, -0.0025);
  return normalize(
    e.xyy * mapFerrofluid(p + e.xyy) +
    e.yyx * mapFerrofluid(p + e.yyx) +
    e.yxy * mapFerrofluid(p + e.yxy) +
    e.xxx * mapFerrofluid(p + e.xxx)
  );
}

vec3 renderSingularity(vec2 uv) {
  vec3 col = vec3(0.0);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float normAngle = abs(a) / PI;

  // 1. Deep Atmospheric Background & Polar Frequency Halo
  float freq = sampleFreq(pow(normAngle, 1.2) * 0.75);
  float wave = sampleWave(normAngle);

  // Outer acoustic halo ring (scaled for zoomed-out perspective)
  float haloRadius = 0.72 + u_sub * 0.08 + freq * 0.22;
  float ringDist = abs(r - haloRadius);
  float haloGlow = 0.007 / (ringDist * ringDist + 0.005);
  col += mix(u_colSecondary, u_colPrimary, freq) * haloGlow * (0.4 + freq * 1.4);

  // Radial frequency beams
  float rays = sin(a * 64.0) * 0.5 + 0.5;
  float rayMask = smoothstep(0.58, 0.72, r) * smoothstep(1.05 + freq * 0.3, 0.72, r);
  col += u_colAccent * rays * rayMask * freq * 0.9;

  // Plasma waveform ring
  float waveRadius = 0.82 + wave * (0.07 + u_mid * 0.11);
  float waveGlow = 0.0022 / (abs(r - waveRadius) + 0.0022);
  col += u_colPrimary * waveGlow * (0.5 + u_high * 1.2);

  // 2. Raymarching the 3D Ferrofluid Core (Zoomed-out camera)
  vec3 ro = vec3(0.0, 0.0, 5.2 - u_beat * 0.28);
  vec3 rd = normalize(vec3(uv, -1.5));

  float t = 0.0;
  float hit = 0.0;
  vec3 volumetricGlow = vec3(0.0);

  for (int i = 0; i < 52; i++) {
    vec3 p = ro + rd * t;
    float d = mapFerrofluid(p);

    // Accumulate volumetric aura near surface
    float aura = exp(-max(d, 0.0) * 7.0);
    volumetricGlow += mix(u_colSecondary, u_colPrimary, aura) * aura * 0.015 * (0.7 + u_energy);

    if (d < 0.0025) {
      hit = 1.0;
      break;
    }
    if (t > 8.5) break;
    t += max(d, 0.018);
  }

  col += volumetricGlow;

  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 v = normalize(ro - p);

    // Fresnel rim lighting
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.2);

    // Dual dynamic studio lights
    vec3 lightDir1 = normalize(vec3(2.0, 2.5, 2.0));
    vec3 lightDir2 = normalize(vec3(-2.5, -1.5, 1.0));
    float diff1 = max(dot(n, lightDir1), 0.0);
    float diff2 = max(dot(n, lightDir2), 0.0);

    vec3 halfVec1 = normalize(lightDir1 + v);
    float spec1 = pow(max(dot(n, halfVec1), 0.0), 48.0 + u_high * 64.0);

    // Thin-film iridescent surface color
    float iridPhase = dot(n, v) * 1.5 + length(p) * 1.2 - u_time * 0.25 + u_bass * 0.6;
    vec3 surfaceColor = thinFilmPalette(iridPhase);

    // Dark liquid chrome core + bright iridescent reflections
    vec3 objCol = surfaceColor * (diff1 * 0.75 + diff2 * 0.35 + 0.12);
    objCol += u_colPrimary * fresnel * (1.6 + u_bass * 1.2);
    objCol += u_colAccent * spec1 * (1.4 + u_high * 1.8);

    // Acoustic subsurface veins
    float veins = smoothstep(0.35, 0.42, abs(gyroid(p, 9.0)));
    objCol += u_colAccent * (1.0 - veins) * (u_bass * 1.4 + u_beat * 1.2);

    col = mix(col, objCol, 0.96);
  }

  return col;
}

// ============================================================================
// MODE 1: QUANTUM HORIZON (3D Volumetric Acoustic Terrain & Eclipse)
// ============================================================================

vec3 renderQuantumHorizon(vec2 uv) {
  vec3 col = vec3(0.01, 0.01, 0.03);

  // Acoustic Eclipse Sun in Upper Horizon
  vec2 sunUv = uv - vec2(0.0, 0.28);
  float sunR = length(sunUv);
  float sunRadius = 0.34 + u_sub * 0.06 + u_beat * 0.04;

  // Corona frequency modulation
  float angle = abs(atan(sunUv.y, sunUv.x)) / PI;
  float fCorona = sampleFreq(angle * 0.7);
  float corona = 0.018 / (abs(sunR - sunRadius - fCorona * 0.08) + 0.012);
  col += mix(u_colSecondary, u_colPrimary, fCorona) * corona * (0.6 + u_energy);

  // Dark eclipse core
  if (sunR < sunRadius) {
    col *= smoothstep(sunRadius * 0.88, sunRadius, sunR);
  }

  // 26 Stacked 3D Perspective Acoustic Ribbons
  for (int i = 0; i < 26; i++) {
    float z = float(i) / 26.0; // 0 = back, 1 = front
    float perspective = mix(0.25, 1.45, z * z);
    float yBase = -0.78 + (1.0 - z) * 0.88;

    float xCoord = uv.x / perspective;
    if (abs(xCoord) < 1.15) {
      float normX = abs(xCoord);
      float freqVal = sampleFreq(normX * 0.75 + (1.0 - z) * 0.15);
      float waveVal = sampleWave(normX * 0.5 + z * 0.3);

      // Envelope so edges taper cleanly like a classic synthesizer Joy Division plot
      float envelope = exp(-normX * normX * 2.2);
      float displacement = (freqVal * (0.28 + u_bass * 0.22) + waveVal * 0.05) * envelope * perspective;
      displacement += sin(xCoord * 6.0 + u_time * 2.0 + float(i) * 0.5) * 0.018 * (1.0 + u_mid);

      float lineY = yBase + displacement;
      float dist = uv.y - lineY;

      // Occlude background behind this wave ribbon
      if (dist < 0.0) {
        col *= mix(0.25, 0.82, 1.0 - z);
      }

      // Glowing crest line
      float thickness = mix(0.0015, 0.0045, z);
      float glow = thickness / (abs(dist) + 0.0025);
      vec3 lineCol = mix(u_colSecondary, u_colPrimary, z);
      lineCol = mix(lineCol, u_colAccent, freqVal * 0.85);

      col += lineCol * glow * (0.35 + z * 0.85) * (0.5 + freqVal * 1.2);
    }
  }

  return col;
}

// ============================================================================
// MODE 2: CYMATIC RESONANCE (Bioluminescent Chladni Quantum Plate)
// ============================================================================

vec3 renderCymatics(vec2 uv) {
  vec2 p = uv * (1.35 - u_sub * 0.15);
  float r = length(p);
  float a = atan(p.y, p.x);

  // Polar audio lookup
  float fVal = sampleFreq(clamp(r * 0.65, 0.0, 1.0));
  float wVal = sampleWave(abs(a) / PI);

  // Dynamic Chladni harmonic mode numbers driven by audio bands
  float n = 3.0 + floor(u_bass * 3.0) + sin(u_time * 0.25) * 0.5;
  float m = 5.0 + floor(u_mid * 4.0) + cos(u_time * 0.2) * 0.5;

  // Kaleidoscopic fold + gyroid perturbation
  vec2 q = p * rot(u_time * 0.08 + r * (0.3 + u_beat * 0.2));
  q += fVal * 0.18 * vec2(cos(a * 4.0), sin(a * 4.0));

  float chladni1 = cos(n * PI * q.x) * cos(m * PI * q.y) - cos(m * PI * q.x) * cos(n * PI * q.y);
  float chladni2 = cos((n + 1.0) * PI * q.x) * cos((m + 2.0) * PI * q.y) - cos((m + 2.0) * PI * q.x) * cos((n + 1.0) * PI * q.y);

  float pattern = mix(chladni1, chladni2, sin(u_time * 0.5) * 0.5 + 0.5);
  pattern += wVal * 0.25;

  // Extract glowing nodal lines
  float nodalLine = 0.022 / (abs(pattern) + 0.018);
  float fineHarmonic = 0.006 / (abs( abs(pattern) - 0.35 - u_high * 0.2 ) + 0.008);

  vec3 col = vec3(0.0);
  col += mix(u_colSecondary, u_colPrimary, r * 0.7) * nodalLine * (0.5 + fVal * 1.4);
  col += u_colAccent * fineHarmonic * (0.4 + u_high * 1.8);

  // Circular containment resonance ring
  float outerRing = 0.008 / (abs(r - 1.15 - u_sub * 0.08) + 0.006);
  col += u_colPrimary * outerRing * (0.8 + u_beat);

  // Fade outside circular plate
  col *= smoothstep(1.45, 1.05, r);

  return col;
}

// ============================================================================
// MODE 3: RELATIVISTIC HYPERDRIVE (Audio Tunnel & Ribbon Oscilloscope)
// ============================================================================

vec3 renderHyperdrive(vec2 uv) {
  vec2 p = uv;
  p *= rot(sin(u_time * 0.25) * 0.2);

  float r = length(p) + 0.001;
  float a = atan(p.y, p.x);
  float normA = abs(a) / PI;

  float freq = sampleFreq(normA * 0.8);
  float wave = sampleWave(normA);

  // Tunnel depth projection
  float depth = 1.0 / (r + 0.05) + u_time * (1.8 + u_energy * 1.5);

  // Geometric ribs modulated by waveform & FFT
  float deformedR = r + wave * 0.08 * r + freq * 0.14 * r;
  float rings = sin(depth * 6.0 - u_beat * 3.0);
  float spokes = sin(a * 16.0 + depth * 1.5);

  float grid = 0.035 / (abs(rings) + 0.04) * (0.3 + freq * 1.5);
  float spokeGlow = 0.015 / (abs(spokes) + 0.08) * (0.2 + u_high * 1.4);

  vec3 col = mix(u_colSecondary, u_colPrimary, sin(depth * 0.5) * 0.5 + 0.5) * grid;
  col += u_colAccent * spokeGlow * smoothstep(0.1, 0.9, r);

  // Foreground 3D Neon Oscilloscope Ribbon
  float oscY = sampleWave(uv.x * 0.35 + 0.5) * (0.35 + u_bass * 0.25);
  float oscGlow = 0.006 / (abs(uv.y - oscY) + 0.005);
  col += mix(u_colPrimary, u_colAccent, abs(uv.x)) * oscGlow * (0.7 + u_energy);

  // Singularity core mask
  col *= smoothstep(0.04, 0.26, deformedR);
  col += u_colPrimary * (0.015 / (r * r + 0.015)) * (0.5 + u_sub * 1.5);

  return col;
}

// ============================================================================
// MAIN FRAGMENT ENTRY & POST-PROCESSING PIPELINE
// ============================================================================

vec3 renderScene(vec2 uv) {
  if (u_mode == 0) return renderSingularity(uv);
  if (u_mode == 1) return renderQuantumHorizon(uv);
  if (u_mode == 2) return renderCymatics(uv);
  return renderHyperdrive(uv);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  // Subtle camera shake on heavy bass transients
  uv += vec2(sin(u_time * 45.0), cos(u_time * 38.0)) * u_beat * 0.006;

  // Chromatic dispersion intensity scales with radial distance + beat transient
  float chromaOffset = (0.002 + u_beat * 0.012 + u_high * 0.005) * dot(uv, uv);

  vec3 col;
  if (chromaOffset > 0.0025) {
    vec3 colR = renderScene(uv * (1.0 - chromaOffset));
    vec3 colG = renderScene(uv);
    vec3 colB = renderScene(uv * (1.0 + chromaOffset));
    col = vec3(colR.r, colG.g, colB.b);
  } else {
    col = renderScene(uv);
  }

  // Reactive ambient starfield / dust particles
  vec2 starGrid = floor(uv * 28.0 + u_time * 0.4);
  float starHash = hash21(starGrid);
  if (starHash > 0.965) {
    vec2 starLocal = fract(uv * 28.0 + u_time * 0.4) - 0.5;
    float starSparkle = 0.0018 / (dot(starLocal, starLocal) + 0.002);
    col += u_colAccent * starSparkle * (0.2 + u_high * 1.5) * sin(u_time * 4.0 + starHash * 20.0);
  }

  // ACES Filmic HDR Tone Mapping
  col = acesToneMapping(col);

  // Studio Vignette
  float vig = 1.0 - dot(v_uv - 0.5, v_uv - 0.5) * 0.85;
  col *= clamp(vig, 0.0, 1.0);

  // Subtle film grain to prevent 8-bit gradient banding
  float grain = (hash21(v_uv * u_resolution + fract(u_time)) - 0.5) * 0.022;
  col += grain;

  // Gamma correction
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  fragColor = vec4(col, 1.0);
}
`;

// ============================================================================
// WEBGL HELPER UTILITIES
// ============================================================================

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createShaderProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const UltraAudioVisualizer: React.FC<UltraAudioVisualizerProps> = ({
  analyser,
  track = {
    title: 'AETHERIUM // SPATIAL MASTER',
    artist: 'NEURAL ACOUSTIC LABS',
    album: '24-BIT / 96KHZ LOSSLESS',
  },
  initialMode = 'singularity',
  initialTheme = 'obsidian',
  sensitivity = 1.0,
  showHud: initialShowHud = true,
  showControls = true,
  enableDemoSynth = true,
  maxDpr = 2.0,
  className = '',
  style,
}) => {
  // --- UI State ---
  const [mode, setMode] = useState<VisualizerMode>(initialMode);
  const [themeId, setThemeId] = useState<VisualizerThemeId>(initialTheme);
  const [showHud, setShowHud] = useState<boolean>(initialShowHud);
  const [gain, setGain] = useState<number>(sensitivity);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [uiVisible, setUiVisible] = useState<boolean>(true);
  const [demoSynthActive, setDemoSynthActive] = useState<boolean>(false);

  // --- Refs for Canvas & Animation ---
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const hideUiTimeoutRef = useRef<number | null>(null);

  // Mutable state ref for the 60-120fps render loop
  const renderStateRef = useRef({
    mode,
    theme: VISUALIZER_THEMES[themeId],
    showHud,
    gain,
  });

  useEffect(() => {
    renderStateRef.current = {
      mode,
      theme: VISUALIZER_THEMES[themeId],
      showHud,
      gain,
    };
  }, [mode, themeId, showHud, gain]);

  // --- Built-in Procedural Demo Synthesizer (Fallback for instant testing) ---
  const demoAudioRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
    timerId: number;
  } | null>(null);

  const toggleDemoSynth = useCallback(() => {
    if (demoAudioRef.current) {
      window.clearInterval(demoAudioRef.current.timerId);
      demoAudioRef.current.ctx.close().catch(() => {});
      demoAudioRef.current = null;
      setDemoSynthActive(false);
      return;
    }

    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      const internalAnalyser = ctx.createAnalyser();
      internalAnalyser.fftSize = 1024;
      internalAnalyser.smoothingTimeConstant = 0.78;

      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.28;
      masterGain.connect(internalAnalyser);
      internalAnalyser.connect(ctx.destination);

      let step = 0;
      const bassNotes = [55, 55, 65.41, 49, 55, 55, 73.42, 61.74];
      const arpNotes = [220, 277.18, 329.63, 440, 554.37, 659.25, 554.37, 329.63];

      const triggerStep = () => {
        if (ctx.state === 'closed') return;
        const now = ctx.currentTime;

        // 1. Sub Kick on 4-on-the-floor
        if (step % 2 === 0) {
          const kickOsc = ctx.createOscillator();
          const kickGain = ctx.createGain();
          kickOsc.type = 'sine';
          kickOsc.frequency.setValueAtTime(135, now);
          kickOsc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
          kickGain.gain.setValueAtTime(0.95, now);
          kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
          kickOsc.connect(kickGain);
          kickGain.connect(masterGain);
          kickOsc.start(now);
          kickOsc.stop(now + 0.33);
        }

        // 2. Reese Sub-Bass
        const bassOsc = ctx.createOscillator();
        const bassFilter = ctx.createBiquadFilter();
        const bassGain = ctx.createGain();
        bassOsc.type = 'sawtooth';
        bassOsc.frequency.setValueAtTime(bassNotes[step % bassNotes.length], now);
        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(260 + (step % 4) * 90, now);
        bassGain.gain.setValueAtTime(0.4, now);
        bassGain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        bassOsc.connect(bassFilter);
        bassFilter.connect(bassGain);
        bassGain.connect(masterGain);
        bassOsc.start(now);
        bassOsc.stop(now + 0.23);

        // 3. Crystalline Pluck Arp
        const arpOsc = ctx.createOscillator();
        const arpGain = ctx.createGain();
        arpOsc.type = 'triangle';
        arpOsc.frequency.setValueAtTime(
          arpNotes[step % arpNotes.length] * (step % 8 === 7 ? 1.5 : 1),
          now
        );
        arpGain.gain.setValueAtTime(0.25, now);
        arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        arpOsc.connect(arpGain);
        arpGain.connect(masterGain);
        arpOsc.start(now);
        arpOsc.stop(now + 0.19);

        step++;
      };

      triggerStep();
      const timerId = window.setInterval(triggerStep, 230); // ~130 BPM
      demoAudioRef.current = { ctx, analyser: internalAnalyser, timerId };
      setDemoSynthActive(true);
    } catch (e) {
      console.warn('[UltraAudioVisualizer] Failed to start demo synth:', e);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (demoAudioRef.current) {
        window.clearInterval(demoAudioRef.current.timerId);
        demoAudioRef.current.ctx.close().catch(() => {});
        demoAudioRef.current = null;
      }
    };
  }, []);

  // --- Auto-hide Controls on Mouse Inactivity ---
  const handleMouseMove = useCallback(() => {
    setUiVisible(true);
    if (hideUiTimeoutRef.current) {
      window.clearTimeout(hideUiTimeoutRef.current);
    }
    hideUiTimeoutRef.current = window.setTimeout(() => {
      setUiVisible(false);
    }, 3200);
  }, []);

  // --- Fullscreen Toggle ---
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ==========================================================================
  // CORE WEBGL2 + 2D HUD RENDER LOOP
  // ==========================================================================

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    const hudCanvas = hudCanvasRef.current;
    const container = containerRef.current;
    if (!glCanvas || !hudCanvas || !container) return;

    const gl = glCanvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const hudCtx = hudCanvas.getContext('2d');

    const program = gl ? createShaderProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC) : null;

    let vao: WebGLVertexArrayObject | null = null;
    let posBuffer: WebGLBuffer | null = null;
    let audioTexture: WebGLTexture | null = null;
    const TEXTURE_WIDTH = 512;
    const audioTexData = new Uint8Array(TEXTURE_WIDTH * 2);

    let uniforms: Record<string, WebGLUniformLocation | null> = {};

    if (gl && program) {
      // Fullscreen Quad Geometry
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // 512x2 R8 Hardware Audio Texture (Row 0: Frequency, Row 1: Waveform)
      audioTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, audioTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        TEXTURE_WIDTH,
        2,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        audioTexData
      );

      // Uniform Locations
      uniforms = {
        u_resolution: gl.getUniformLocation(program, 'u_resolution'),
        u_time: gl.getUniformLocation(program, 'u_time'),
        u_sub: gl.getUniformLocation(program, 'u_sub'),
        u_bass: gl.getUniformLocation(program, 'u_bass'),
        u_mid: gl.getUniformLocation(program, 'u_mid'),
        u_high: gl.getUniformLocation(program, 'u_high'),
        u_energy: gl.getUniformLocation(program, 'u_energy'),
        u_beat: gl.getUniformLocation(program, 'u_beat'),
        u_mode: gl.getUniformLocation(program, 'u_mode'),
        u_colPrimary: gl.getUniformLocation(program, 'u_colPrimary'),
        u_colSecondary: gl.getUniformLocation(program, 'u_colSecondary'),
        u_colAccent: gl.getUniformLocation(program, 'u_colAccent'),
        u_audioTex: gl.getUniformLocation(program, 'u_audioTex'),
      };
    }

    // Resize Observer
    let width = container.clientWidth || 800;
    let height = container.clientHeight || 600;
    let dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, maxDpr);

    const updateDimensions = () => {
      width = container.clientWidth || 800;
      height = container.clientHeight || 600;
      dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, maxDpr);

      glCanvas.width = Math.floor(width * dpr);
      glCanvas.height = Math.floor(height * dpr);
      if (gl) {
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      }

      const hudDpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
      hudCanvas.width = Math.floor(width * hudDpr);
      hudCanvas.height = Math.floor(height * hudDpr);
      if (hudCtx) {
        hudCtx.setTransform(hudDpr, 0, 0, hudDpr, 0, 0);
      }
    };

    updateDimensions();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(container);
    }

    // Audio Analysis Buffers & Smoothing State
    let rawFreqBuffer = new Uint8Array(TEXTURE_WIDTH);
    let rawTimeBuffer = new Uint8Array(TEXTURE_WIDTH);

    const smoothed: AudioMetrics = {
      sub: 0,
      bass: 0,
      mid: 0,
      high: 0,
      energy: 0,
      beat: 0,
      bpmEstimate: 124,
      isSilent: true,
    };

    const peakHolds = [0, 0, 0, 0];
    let rollingBassAvg = 0.1;
    let lastBeatTime = 0;
    const beatIntervals: number[] = [];

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let rafId = 0;

    // --- Frame Loop ---
    const renderFrame = (now: number) => {
      const elapsed = (now - startTime) * 0.001;
      const { mode: currentMode, theme, showHud: hudEnabled, gain: currentGain } =
        renderStateRef.current;

      const activeAnalyser = analyser || demoAudioRef.current?.analyser || null;
      let hasSignal = false;
      let bridgeActive = false;
      try {
        bridgeActive = audioEngine.isBridgeAudible();
      } catch {
        bridgeActive = false;
      }

      if (bridgeActive) {
        // YouTube-bridge audio is unreachable via AnalyserNode (cross-origin
        // iframe): synthesize beat-reactive spectrum from playback clock.
        if (rawFreqBuffer.length !== TEXTURE_WIDTH) {
          rawFreqBuffer = new Uint8Array(TEXTURE_WIDTH);
          rawTimeBuffer = new Uint8Array(TEXTURE_WIDTH);
        }
        hasSignal = audioEngine.fillBridgeVisualizerData(rawFreqBuffer, rawTimeBuffer);
        if (!hasSignal) bridgeActive = false;
      }

      if (!bridgeActive && activeAnalyser) {
        const binCount = activeAnalyser.frequencyBinCount;
        if (rawFreqBuffer.length !== binCount) {
          rawFreqBuffer = new Uint8Array(binCount);
          rawTimeBuffer = new Uint8Array(binCount);
        }
        activeAnalyser.getByteFrequencyData(rawFreqBuffer);
        activeAnalyser.getByteTimeDomainData(rawTimeBuffer);

        // Check if audio stream is actively producing signal
        let sumSignal = 0;
        for (let i = 0; i < Math.min(128, binCount); i++) {
          sumSignal += rawFreqBuffer[i];
        }
        hasSignal = sumSignal > 64;
      }

      if (hasSignal && (activeAnalyser || bridgeActive)) {
        smoothed.isSilent = false;
        const binCount = rawFreqBuffer.length;

        // Resample & pack into 512x2 texture
        for (let i = 0; i < TEXTURE_WIDTH; i++) {
          const srcIdx = Math.min(
            binCount - 1,
            Math.floor((i / TEXTURE_WIDTH) * (binCount * 0.75))
          );
          audioTexData[i] = Math.min(255, rawFreqBuffer[srcIdx] * currentGain);
          audioTexData[TEXTURE_WIDTH + i] = rawTimeBuffer[srcIdx];
        }

        // Band Extraction (Normalized 0..1)
        const avgRange = (start: number, end: number) => {
          let sum = 0;
          const clampedEnd = Math.min(binCount, end);
          const count = Math.max(1, clampedEnd - start);
          for (let i = start; i < clampedEnd; i++) sum += rawFreqBuffer[i];
          return Math.min(1.5, ((sum / count) / 255) * currentGain);
        };

        const rawSub = avgRange(0, 5);
        const rawBass = avgRange(5, 18);
        const rawMid = avgRange(18, 110);
        const rawHigh = avgRange(110, 340);

        // Asymmetric EMA Smoothing (Fast attack, smooth organic decay)
        const smoothParam = (curr: number, target: number, attack = 0.42, release = 0.12) =>
          target > curr ? curr + (target - curr) * attack : curr + (target - curr) * release;

        smoothed.sub = smoothParam(smoothed.sub, rawSub, 0.5, 0.14);
        smoothed.bass = smoothParam(smoothed.bass, rawBass, 0.45, 0.12);
        smoothed.mid = smoothParam(smoothed.mid, rawMid, 0.38, 0.12);
        smoothed.high = smoothParam(smoothed.high, rawHigh, 0.45, 0.15);
        smoothed.energy =
          smoothed.sub * 0.35 + smoothed.bass * 0.3 + smoothed.mid * 0.2 + smoothed.high * 0.15;

        // Transient / Beat Flux Detector
        const currentLowEnergy = (rawSub + rawBass) * 0.5;
        rollingBassAvg = rollingBassAvg * 0.94 + currentLowEnergy * 0.06;

        if (
          currentLowEnergy > rollingBassAvg * 1.32 &&
          currentLowEnergy > 0.24 &&
          now - lastBeatTime > 210
        ) {
          smoothed.beat = 1.0;
          const delta = now - lastBeatTime;
          lastBeatTime = now;
          if (delta > 280 && delta < 1200) {
            beatIntervals.push(delta);
            if (beatIntervals.length > 8) beatIntervals.shift();
            const avgInterval =
              beatIntervals.reduce((a, b) => a + b, 0) / beatIntervals.length;
            smoothed.bpmEstimate = Math.round(60000 / avgInterval);
          }
        } else {
          smoothed.beat *= 0.86;
        }
      } else {
        // Ambient Breathing Idle State (when paused or waiting for stream)
        smoothed.isSilent = true;
        smoothed.sub = 0.15 + Math.sin(elapsed * 1.4) * 0.08;
        smoothed.bass = 0.12 + Math.sin(elapsed * 1.1 + 1.0) * 0.06;
        smoothed.mid = 0.1 + Math.cos(elapsed * 0.9) * 0.05;
        smoothed.high = 0.08 + Math.sin(elapsed * 2.1) * 0.04;
        smoothed.energy = 0.14;
        smoothed.beat *= 0.9;

        for (let i = 0; i < TEXTURE_WIDTH; i++) {
          const u = i / TEXTURE_WIDTH;
          const synthFreq =
            (Math.sin(u * 12.0 - elapsed * 1.8) * 0.5 + 0.5) *
            Math.exp(-u * 2.5) *
            95;
          const synthWave =
            128 +
            Math.sin(u * Math.PI * 4.0 + elapsed * 2.5) * 28 +
            Math.cos(u * Math.PI * 10.0 - elapsed * 1.5) * 12;
          audioTexData[i] = synthFreq;
          audioTexData[TEXTURE_WIDTH + i] = synthWave;
        }
      }

      // Render WebGL2 Shader if context is active
      if (gl && program && vao && audioTexture) {
        // Upload Audio Texture to GPU
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, audioTexture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          TEXTURE_WIDTH,
          2,
          gl.RED,
          gl.UNSIGNED_BYTE,
          audioTexData
        );

        gl.useProgram(program);
        gl.bindVertexArray(vao);

        const modeIndex =
          currentMode === 'singularity'
            ? 0
            : currentMode === 'quantum'
            ? 1
            : currentMode === 'cymatics'
            ? 2
            : 3;

        gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height);
        gl.uniform1f(uniforms.u_time, elapsed);
        gl.uniform1f(uniforms.u_sub, smoothed.sub);
        gl.uniform1f(uniforms.u_bass, smoothed.bass);
        gl.uniform1f(uniforms.u_mid, smoothed.mid);
        gl.uniform1f(uniforms.u_high, smoothed.high);
        gl.uniform1f(uniforms.u_energy, smoothed.energy);
        gl.uniform1f(uniforms.u_beat, smoothed.beat);
        gl.uniform1i(uniforms.u_mode, modeIndex);
        gl.uniform3fv(uniforms.u_colPrimary, theme.primary);
        gl.uniform3fv(uniforms.u_colSecondary, theme.secondary);
        gl.uniform3fv(uniforms.u_colAccent, theme.accent);
        gl.uniform1i(uniforms.u_audioTex, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // ======================================================================
      // 2D PRECISION STUDIO TELEMETRY HUD OVERLAY
      // ======================================================================
      if (hudCtx) {
        hudCtx.clearRect(0, 0, width, height);

        // Fallback backdrop if WebGL2 is unavailable
        if (!gl) {
          hudCtx.fillStyle = '#030308';
          hudCtx.fillRect(0, 0, width, height);

          // Draw fallback ambient line
          hudCtx.strokeStyle = theme.cssAccent;
          hudCtx.lineWidth = 2;
          hudCtx.beginPath();
          for (let i = 0; i < width; i += 4) {
            const sampleIdx = Math.floor((i / width) * 256);
            const val = (audioTexData[TEXTURE_WIDTH + sampleIdx] - 128) / 128;
            const y = height / 2 + val * 40 * currentGain;
            if (i === 0) hudCtx.moveTo(i, y);
            else hudCtx.lineTo(i, y);
          }
          hudCtx.stroke();
        }

        if (hudEnabled && width > 480) {
          const accentHex = theme.cssAccent;
          hudCtx.save();

          // 1. Top-Right Lissajous Phase Vectorscope
          const scopeSize = 76;
          const scopeX = width - scopeSize - 28;
          const scopeY = 28;
          const centerX = scopeX + scopeSize / 2;
          const centerY = scopeY + scopeSize / 2;

          // Scope Frame & Crosshairs
          hudCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          hudCtx.lineWidth = 1;
          hudCtx.beginPath();
          hudCtx.arc(centerX, centerY, scopeSize / 2, 0, Math.PI * 2);
          hudCtx.moveTo(scopeX, centerY);
          hudCtx.lineTo(scopeX + scopeSize, centerY);
          hudCtx.moveTo(centerX, scopeY);
          hudCtx.lineTo(centerX, scopeY + scopeSize);
          hudCtx.stroke();

          // Plot Phase Vector Curve (x = sample[i], y = sample[i + quarterPhase])
          hudCtx.strokeStyle = accentHex;
          hudCtx.lineWidth = 1.35;
          hudCtx.beginPath();
          const quarterOffset = 64;
          for (let i = 0; i < 256; i += 2) {
            const s1 = (audioTexData[TEXTURE_WIDTH + i] - 128) / 128;
            const s2 =
              (audioTexData[TEXTURE_WIDTH + ((i + quarterOffset) % TEXTURE_WIDTH)] - 128) /
              128;
            const px = centerX + (s1 - s2) * (scopeSize * 0.36);
            const py = centerY + (s1 + s2) * (scopeSize * 0.36);
            if (i === 0) hudCtx.moveTo(px, py);
            else hudCtx.lineTo(px, py);
          }
          hudCtx.stroke();

          // Vectorscope Label
          hudCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          hudCtx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
          hudCtx.textAlign = 'center';
          hudCtx.fillText('PHASE // LISSAJOUS', centerX, scopeY + scopeSize + 14);

          // 2. Left-Side Acoustic Band Telemetry & Peak-Hold Meters
          const bands = [
            { label: 'SUB', val: Math.min(1, smoothed.sub) },
            { label: 'LOW', val: Math.min(1, smoothed.bass) },
            { label: 'MID', val: Math.min(1, smoothed.mid) },
            { label: 'HI ', val: Math.min(1, smoothed.high) },
          ];

          const meterStartX = 28;
          const meterStartY = height - 120;
          const barW = 68;
          const barH = 4;

          hudCtx.textAlign = 'left';
          bands.forEach((b, idx) => {
            const y = meterStartY + idx * 15;
            if (b.val > peakHolds[idx]) peakHolds[idx] = b.val;
            else peakHolds[idx] *= 0.985;

            hudCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            hudCtx.fillText(b.label, meterStartX, y + 4);

            // Track background
            const bx = meterStartX + 28;
            hudCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            hudCtx.fillRect(bx, y, barW, barH);

            // Active fill
            hudCtx.fillStyle = accentHex;
            hudCtx.fillRect(bx, y, barW * b.val, barH);

            // Peak hold tick
            hudCtx.fillStyle = '#ffffff';
            hudCtx.fillRect(bx + barW * peakHolds[idx], y - 1, 1.5, barH + 2);
          });

          // BPM & Transient Indicator
          const statusText = smoothed.isSilent
            ? 'STANDBY // AMBIENT SYNTHESIS'
            : `SYNC // ~${smoothed.bpmEstimate} BPM`;
          hudCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          hudCtx.fillText(statusText, meterStartX, meterStartY - 12);

          // Beat LED Dot
          hudCtx.beginPath();
          hudCtx.arc(
            meterStartX + 104,
            meterStartY - 15,
            3.5,
            0,
            Math.PI * 2
          );
          hudCtx.fillStyle =
            smoothed.beat > 0.35 ? accentHex : 'rgba(255, 255, 255, 0.18)';
          hudCtx.fill();

          // 3. Subtle Bottom-Right Micro-Spectrum Analyzer
          const specCount = 42;
          const specWidth = 148;
          const specX = width - specWidth - 28;
          const specY = height - 64;

          for (let i = 0; i < specCount; i++) {
            const binVal =
              audioTexData[Math.floor((i / specCount) * 280)] / 255;
            const h = Math.max(2, binVal * 34);
            const x = specX + i * (specWidth / specCount);
            hudCtx.fillStyle =
              binVal > 0.75 ? '#ffffff' : i % 2 === 0 ? accentHex : 'rgba(255,255,255,0.35)';
            hudCtx.fillRect(x, specY - h, 2, h);
          }

          hudCtx.restore();
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      if (gl) {
        if (audioTexture) gl.deleteTexture(audioTexture);
        if (posBuffer) gl.deleteBuffer(posBuffer);
        if (vao) gl.deleteVertexArray(vao);
        if (program) gl.deleteProgram(program);
      }
    };
  }, [analyser, maxDpr]);

  const activeTheme = useMemo(() => VISUALIZER_THEMES[themeId], [themeId]);
  const activeModeMeta = useMemo(
    () => MODE_LABELS.find((m) => m.id === mode) || MODE_LABELS[0],
    [mode]
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setUiVisible(true)}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '260px',
        backgroundColor: '#030308',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
        color: '#ffffff',
        ...style,
      }}
    >
      {/* Layer 1 (DOM First for testing 2D canvas): 2D High-DPI Studio Telemetry HUD Canvas */}
      <canvas
        ref={hudCanvasRef}
        data-testid="audio-visualizer-canvas"
        className="visualizer"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          display: 'block',
          zIndex: 2,
        }}
      />

      {/* Layer 0: WebGL 2.0 Raymarching Shader Canvas */}
      <canvas
        ref={glCanvasRef}
        className="visualizer-gl"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          zIndex: 1,
        }}
      />

      {/* Layer 2: Top-Left Track Metadata */}
      {showHud && track?.title && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 28,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#ffffff',
              textShadow: '0 2px 16px rgba(0,0,0,0.6)',
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'rgba(255, 255, 255, 0.6)',
            }}
          >
            {track.artist}
            {track.album ? ` • ${track.album}` : ''}
          </div>
        </div>
      )}

      {/* Layer 3: Interactive Glassmorphic Control Dock */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: `translateX(-50%) translateY(${uiVisible ? '0px' : '16px'})`,
            opacity: uiVisible ? 1 : 0,
            pointerEvents: uiVisible ? 'auto' : 'none',
            transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '16px',
            background: 'rgba(12, 14, 24, 0.68)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
            zIndex: 20,
            maxWidth: '94vw',
          }}
        >
          {/* Shader Mode Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '3px',
              borderRadius: '10px',
            }}
          >
            {MODE_LABELS.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMode(item.id)}
                  data-testid="visualizer-mode-toggle"
                  aria-label={`Toggle Visualizer Mode - ${item.label}`}
                  style={{
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    padding: '6px 11px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    color: active ? '#05050a' : 'rgba(255, 255, 255, 0.75)',
                    background: active ? activeTheme.cssAccent : 'transparent',
                    boxShadow: active
                      ? `0 0 16px ${activeTheme.cssAccent}66`
                      : 'none',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div
            style={{
              width: '1px',
              height: '20px',
              background: 'rgba(255, 255, 255, 0.12)',
              margin: '0 2px',
            }}
          />

          {/* Color Palette Swatches */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {(Object.keys(VISUALIZER_THEMES) as VisualizerThemeId[]).map((tKey) => {
              const t = VISUALIZER_THEMES[tKey];
              const isSelected = themeId === tKey;
              return (
                <button
                  key={tKey}
                  title={t.name}
                  onClick={() => setThemeId(tKey)}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: isSelected
                      ? '2px solid #ffffff'
                      : '1px solid rgba(255,255,255,0.25)',
                    background: t.cssAccent,
                    cursor: 'pointer',
                    padding: 0,
                    transform: isSelected ? 'scale(1.18)' : 'scale(1)',
                    boxShadow: isSelected ? `0 0 12px ${t.cssAccent}` : 'none',
                    transition: 'all 0.2s ease',
                  }}
                />
              );
            })}
          </div>

          <div
            style={{
              width: '1px',
              height: '20px',
              background: 'rgba(255, 255, 255, 0.12)',
              margin: '0 2px',
            }}
          />

          {/* Gain / Reactivity Slider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 4px',
            }}
            title="Audio Reactivity Gain"
          >
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              GAIN
            </span>
            <input
              type="range"
              min={0.4}
              max={2.2}
              step={0.05}
              value={gain}
              onChange={(e) => setGain(parseFloat(e.target.value))}
              style={{
                width: '62px',
                accentColor: activeTheme.cssAccent,
                cursor: 'pointer',
              }}
            />
          </div>

          {/* Demo Synth Trigger (Only shown if enabled & no external analyser is passed) */}
          {enableDemoSynth && !analyser && (
            <button
              onClick={toggleDemoSynth}
              style={{
                border: `1px solid ${
                  demoSynthActive
                    ? activeTheme.cssAccent
                    : 'rgba(255, 255, 255, 0.18)'
                }`,
                background: demoSynthActive
                  ? `${activeTheme.cssAccent}28`
                  : 'rgba(255, 255, 255, 0.06)',
                color: demoSynthActive ? activeTheme.cssAccent : '#ffffff',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s ease',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: demoSynthActive ? activeTheme.cssAccent : '#888',
                }}
              />
              {demoSynthActive ? 'Stop Test Synth' : 'Test Synth'}
            </button>
          )}

          {/* HUD Toggle Button */}
          <button
            onClick={() => setShowHud((prev) => !prev)}
            title="Toggle Studio Telemetry HUD"
            style={{
              border: '1px solid rgba(255, 255, 255, 0.14)',
              background: showHud
                ? 'rgba(255, 255, 255, 0.14)'
                : 'rgba(255, 255, 255, 0.04)',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '6px 9px',
              fontSize: '10px',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            HUD
          </button>

          {/* Fullscreen Toggle Button */}
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            aria-label="Toggle Fullscreen"
            style={{
              border: '1px solid rgba(255, 255, 255, 0.14)',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '6px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isFullscreen ? (
                <>
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </>
              ) : (
                <>
                  <path d="M15 3h6v6" />
                  <path d="M9 21H3v-6" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 21l7-7" />
                </>
              )}
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default UltraAudioVisualizer;
