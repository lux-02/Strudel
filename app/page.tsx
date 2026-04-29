"use client";

import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import {
  Download,
  ImagePlus,
  LoaderCircle,
  Play,
  Sparkles,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  setStrudelActiveRanges,
  strudelActiveRangeField,
  strudelActiveRangeTheme,
  type CodeRange,
} from "../lib/code-highlight";
import {
  generateComposition,
  type GeneratedComposition,
  type StyleKey,
} from "../lib/strudel-presets";
import { normalizeStrudelCode } from "../lib/strudel-ai-prompt";
import {
  prepareStrudelRuntime,
  setStrudelWidgetCanvas,
  stopStrudelWidgetAnimations,
  type StrudelRuntime,
  type WidgetTrack,
} from "../lib/strudel-runtime";

type GeneratedAIComposition = GeneratedComposition & {
  bpm?: number;
  style?: StyleKey;
  analysis?: string;
};

type ActivePattern = {
  queryArc?: (begin: number, end: number, controls?: Record<string, unknown>) => ActiveHap[];
};

type ActiveHap = {
  context?: {
    locations?: ActiveLocation[];
  };
  hasOnset?: () => boolean;
};

type ActiveLocation =
  | {
      start?: unknown;
      end?: unknown;
      from?: unknown;
      to?: unknown;
    }
  | [unknown, unknown];

type WidgetType = "pianoroll" | "scope";
type WidgetVisibility = Partial<Record<string, Partial<Record<WidgetType, boolean>>>>;
type VisualSignal = {
  master: number;
  bass: number;
  drums: number;
  mel: number;
  synth: number;
  light: number;
};

type VisualSignalRef = {
  current: VisualSignal;
};

const initialComposition = generateComposition({
  bpm: 124,
  style: "dream",
  prompt: "neon night drive",
});

const maxImageDataUrlLength = 1_600_000;
const imageCompressionDimensions = [1280, 960, 720];
const imageCompressionQualities = [0.82, 0.72, 0.62, 0.52];

const defaultWidgetTracks: WidgetTrack[] = [
  { id: "BASS", label: "$BASS", color: "#f5bd3d" },
  { id: "DRUMS", label: "$DRUMS", color: "#17b6a4" },
  { id: "MEL", label: "$MEL", color: "#ef5c5c" },
  { id: "SYNTH", label: "$SYNTH", color: "#7c8cff" },
];

function extractWidgetTracks(code: string): WidgetTrack[] {
  const colors = ["#f5bd3d", "#17b6a4", "#ef5c5c", "#7c8cff", "#8ff7ff", "#cfffff"];
  const known = new Map(defaultWidgetTracks.map((track) => [track.id, track]));
  const found = [...code.matchAll(/^\s*\$([A-Za-z][\w]*)\s*:/gm)]
    .map((match) => match[1].toUpperCase())
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const ids = found.length ? found : defaultWidgetTracks.map((track) => track.id);

  return ids.map((id, index) => known.get(id) ?? { id, label: `$${id}`, color: colors[index % colors.length] });
}

function clampRange(range: CodeRange, length: number) {
  return {
    from: Math.max(0, Math.min(length, range.from)),
    to: Math.max(0, Math.min(length, range.to)),
  };
}

function normalizeLocation(location: ActiveLocation, codeLength: number): CodeRange | null {
  const rawFrom = Array.isArray(location) ? location[0] : (location.start ?? location.from);
  const rawTo = Array.isArray(location) ? location[1] : (location.end ?? location.to);
  const from = Number(rawFrom);
  const to = Number(rawTo);

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  const range = clampRange({ from, to }, codeLength);
  return range.to > range.from ? range : null;
}

function extractActiveCodeRanges(pattern: ActivePattern, time: number, codeLength: number) {
  if (typeof pattern.queryArc !== "function") return [];

  const seen = new Set<string>();
  const ranges: CodeRange[] = [];
  const haps = pattern.queryArc(time - 0.015, time + 0.08).filter((hap) => hap.hasOnset?.() ?? true);

  for (const hap of haps) {
    for (const location of hap.context?.locations ?? []) {
      const range = normalizeLocation(location, codeLength);
      if (!range) continue;

      const key = `${range.from}:${range.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ranges.push(range);
    }
  }

  return ranges;
}

function trackIDForRange(code: string, from: number) {
  const trackMatches = [...code.matchAll(/^\s*\$([A-Za-z][\w]*)\s*:/gm)];
  let activeTrack = "";

  for (const match of trackMatches) {
    if ((match.index ?? 0) > from) break;
    activeTrack = match[1].toUpperCase();
  }

  return activeTrack;
}

function updateVisualSignal(signalRef: VisualSignalRef, code: string, ranges: CodeRange[]) {
  const next: VisualSignal = {
    master: signalRef.current.master * 0.84,
    bass: signalRef.current.bass * 0.82,
    drums: signalRef.current.drums * 0.8,
    mel: signalRef.current.mel * 0.84,
    synth: signalRef.current.synth * 0.86,
    light: signalRef.current.light * 0.88,
  };

  ranges.forEach((range) => {
    const trackID = trackIDForRange(code, range.from);
    next.master = Math.min(1, next.master + 0.16);

    if (trackID.includes("DRUM")) {
      next.drums = Math.min(1, next.drums + 0.42);
    } else if (trackID.includes("BASS")) {
      next.bass = Math.min(1, next.bass + 0.34);
    } else if (trackID.includes("MEL") || trackID.includes("LEAD")) {
      next.mel = Math.min(1, next.mel + 0.3);
    } else if (trackID.includes("SYNTH") || trackID.includes("PAD")) {
      next.synth = Math.min(1, next.synth + 0.28);
    } else if (trackID.includes("LIGHT") || trackID.includes("TEXTURE")) {
      next.light = Math.min(1, next.light + 0.24);
    }
  });

  signalRef.current = next;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function AudioVisualizer({ isPlaying, signalRef }: { isPlaying: boolean; signalRef: VisualSignalRef }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false });
    if (!canvas || !gl) return;

    const vertexShader = createShader(
      gl,
      gl.VERTEX_SHADER,
      `
      attribute vec2 a_position;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
      `,
    );
    const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      `
      precision highp float;

      uniform vec2 u_resolution;
      uniform vec2 u_pointer;
      uniform float u_time;
      uniform float u_playing;
      uniform float u_master;
      uniform float u_bass;
      uniform float u_drums;
      uniform float u_mel;
      uniform float u_synth;
      uniform float u_light;
      uniform sampler2D u_feedback;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      mat2 rotate2d(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;

        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = rotate2d(0.74) * p * 2.02 + vec2(1.7, -0.9);
          amplitude *= 0.5;
        }

        return value;
      }

      float streak(vec2 p, float x, float width, float blur) {
        float core = exp(-abs(p.x - x) / width);
        float vertical = smoothstep(blur, 0.0, abs(p.y));
        return core * vertical;
      }

      float ridge(float value) {
        return 1.0 - abs(value * 2.0 - 1.0);
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
        vec2 pointer = (u_pointer * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0);
        float t = u_time * (0.11 + u_playing * 0.48);
        float energy = clamp(u_master + u_bass * 0.45 + u_drums * 0.55 + u_mel * 0.32 + u_synth * 0.28 + u_light * 0.35, 0.0, 1.0);

        vec2 flow = uv;
        flow += vec2(fbm(uv * 1.6 + vec2(t * 0.17, -0.31)), fbm(uv * 1.4 + vec2(-0.27, t * 0.13))) * 0.42 - 0.21;
        flow += vec2(fbm(flow * 3.2 - t * 0.11), fbm(flow * 2.7 + t * 0.16)) * (0.22 + energy * 0.16) - 0.11;
        float driftAngle = -0.035 + fbm(flow + t * 0.035) * 0.08 + u_synth * 0.025;
        flow *= rotate2d(driftAngle);

        float matter = 0.0;
        float hot = 0.0;
        float filaments = 0.0;

        for (int i = 0; i < 9; i++) {
          float fi = float(i);
          float seed = fi * 13.17 + 2.41;
          vec2 anchor = vec2(
            sin(t * (0.21 + seed * 0.011) + seed),
            cos(t * (0.17 + seed * 0.009) + seed * 1.31)
          );
          anchor *= vec2(0.38 + 0.16 * hash(vec2(seed, 1.0)), 0.42 + 0.18 * hash(vec2(seed, 2.0)));
          anchor += vec2(fbm(vec2(seed, t * 0.09)), fbm(vec2(t * 0.07, seed))) * 0.34 - 0.17;

          vec2 local = flow - anchor;
          local *= rotate2d(seed * 0.08 + t * (0.003 + hash(vec2(seed)) * 0.005));
          local.x *= 0.58 + hash(vec2(seed, 4.0)) * 1.2;
          local.y *= 1.8 + hash(vec2(seed, 5.0)) * 2.6;

          float d = dot(local, local);
          float glow = exp(-d * (3.2 + hash(vec2(seed, 6.0)) * 7.0));
          float core = exp(-d * (20.0 + hash(vec2(seed, 7.0)) * 42.0));
          float tear = exp(-abs(local.y + sin(local.x * (2.0 + fi) + t * 0.7) * 0.08) * (8.0 + fi * 0.9));

          matter += glow * (0.11 + hash(vec2(seed, 8.0)) * 0.12);
          hot += core * (0.32 + hash(vec2(seed, 9.0)) * 0.5);
          filaments += tear * glow * (0.18 + hash(vec2(seed, 10.0)) * 0.18);
        }

        float turbulence = fbm(flow * 8.0 + vec2(t * 0.21, -t * 0.14));
        float highFreq = fbm(flow * 23.0 + vec2(-t * 0.38, t * 0.27));
        float ridges = pow(ridge(turbulence), 3.2) * smoothstep(0.15, 0.92, matter);

        float sliceA = exp(-abs(flow.y + flow.x * 0.28 + (turbulence - 0.5) * 0.42) * 9.0);
        float sliceB = exp(-abs(flow.y - flow.x * 0.62 - 0.18 + highFreq * 0.24) * 13.0);
        float scanBurst = exp(-abs(uv.y + 0.03 * sin(t * 0.7)) * (12.0 - u_bass * 4.0));
        float verticalA = streak(uv, -0.24 + fbm(vec2(t * 0.16, 1.0)) * 0.32, 0.011 + u_drums * 0.01, 0.94);
        float verticalB = streak(uv, 0.18 + fbm(vec2(2.0, t * 0.13)) * 0.26, 0.018, 0.86);

        float scratches = smoothstep(0.986, 1.0, noise(vec2(uv.x * 38.0 + t * 0.17, uv.y * 4.0)));
        scratches += smoothstep(0.994, 1.0, noise(vec2(uv.x * 5.0 - t * 0.2, uv.y * 58.0)));
        scratches *= 0.06 + energy * 0.12;

        float scanline = sin((gl_FragCoord.y + t * 26.0) * 1.1) * 0.5 + 0.5;
        float staticGrain = hash(gl_FragCoord.xy);
        float slowGrain = hash(floor(gl_FragCoord.xy * 0.7) + floor(t * 2.0) * 17.0);
        float grain = mix(staticGrain, slowGrain, 0.28);
        float dust = smoothstep(0.985, 1.0, hash(floor(gl_FragCoord.xy * 0.45) + floor(t * 3.0)));

        float luminance = 0.0;
        luminance += matter * (0.38 + u_mel * 0.22);
        luminance += hot * (0.95 + u_bass * 0.85 + u_drums * 0.42);
        luminance += filaments * (0.8 + u_synth * 0.6);
        luminance += ridges * (0.42 + u_light * 0.42);
        luminance += sliceA * matter * (0.55 + u_bass * 0.5);
        luminance += sliceB * matter * (0.38 + u_drums * 0.58);
        luminance += scanBurst * matter * 0.22;
        luminance += verticalA * (0.24 + u_drums * 0.5) + verticalB * (0.18 + u_light * 0.36);
        luminance += scratches + dust * 0.12;
        luminance *= 0.5 + energy * 0.86;
        luminance += exp(-length(uv - pointer) * 8.0) * 0.08;

        float bloom = smoothstep(0.22, 1.45, luminance);
        float fringe = filaments * 0.22 + verticalA * 0.4 + hot * 0.18 + sliceA * matter * 0.18;
        vec3 monochrome = vec3(luminance);
        vec3 prism = vec3(0.68, 0.88, 1.0) * fringe * 0.18 + vec3(1.0, 0.58, 0.5) * fringe * 0.12;
        vec3 color = monochrome + bloom * vec3(0.95) + prism;

        vec2 feedbackUv = gl_FragCoord.xy / u_resolution.xy;
        vec2 feedbackCenter = feedbackUv - 0.5;
        float feedbackSpin = 0.00004 + energy * 0.00008 + u_synth * 0.00005;
        vec2 feedbackSampleCenter = rotate2d(feedbackSpin) * feedbackCenter;
        vec2 feedbackWarp = feedbackCenter * (0.0035 + energy * 0.006);
        feedbackWarp += vec2(
          fbm(feedbackCenter * 4.2 + vec2(t * 0.07, 0.4)),
          fbm(feedbackCenter * 3.8 + vec2(-0.2, -t * 0.06))
        ) * 0.004 - 0.002;
        feedbackWarp.y += (u_bass - u_drums) * 0.0012;

        vec3 previous = texture2D(u_feedback, clamp(feedbackSampleCenter + 0.5 - feedbackWarp, vec2(0.002), vec2(0.998))).rgb;
        previous *= 0.952 + u_synth * 0.018 + u_light * 0.012;
        previous = max(previous - vec3(0.012 + u_drums * 0.008), vec3(0.0));
        vec3 lifted = max(color, previous * (0.42 + u_master * 0.12));
        color = mix(color, lifted, 0.46);
        color += previous * (0.08 + u_bass * 0.035);

        float vignette = smoothstep(1.42, 0.18, length(uv));
        color *= vignette;
        color *= 0.94 + scanline * 0.06;
        color += vec3((grain - 0.5) * 0.055 + grain * 0.018);
        color = pow(max(color, 0.0), vec3(0.82));

        gl_FragColor = vec4(color, 1.0);
      }
      `,
    );
    const displayFragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      `
      precision highp float;

      uniform vec2 u_resolution;
      uniform sampler2D u_texture;

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        gl_FragColor = vec4(texture2D(u_texture, uv).rgb, 1.0);
      }
      `,
    );

    if (!vertexShader || !fragmentShader || !displayFragmentShader) return;

    const program = gl.createProgram();
    const displayProgram = gl.createProgram();
    if (!program || !displayProgram) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.attachShader(displayProgram, vertexShader);
    gl.attachShader(displayProgram, displayFragmentShader);
    gl.linkProgram(displayProgram);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      return;
    }

    if (!gl.getProgramParameter(displayProgram, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(displayProgram));
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      pointer: gl.getUniformLocation(program, "u_pointer"),
      time: gl.getUniformLocation(program, "u_time"),
      playing: gl.getUniformLocation(program, "u_playing"),
      master: gl.getUniformLocation(program, "u_master"),
      bass: gl.getUniformLocation(program, "u_bass"),
      drums: gl.getUniformLocation(program, "u_drums"),
      mel: gl.getUniformLocation(program, "u_mel"),
      synth: gl.getUniformLocation(program, "u_synth"),
      light: gl.getUniformLocation(program, "u_light"),
      feedback: gl.getUniformLocation(program, "u_feedback"),
    };
    const displayUniforms = {
      resolution: gl.getUniformLocation(displayProgram, "u_resolution"),
      texture: gl.getUniformLocation(displayProgram, "u_texture"),
    };
    type FeedbackTarget = {
      texture: WebGLTexture;
      framebuffer: WebGLFramebuffer;
      width: number;
      height: number;
    };
    let feedbackTargets: FeedbackTarget[] = [];
    let readTargetIndex = 0;
    let frame = 0;
    const startedAt = performance.now();

    const createFeedbackTarget = (width: number, height: number): FeedbackTarget | null => {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) return null;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      return { texture, framebuffer, width, height };
    };

    const deleteFeedbackTargets = () => {
      feedbackTargets.forEach((target) => {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      });
      feedbackTargets = [];
    };

    const ensureFeedbackTargets = (width: number, height: number) => {
      if (feedbackTargets.length === 2 && feedbackTargets.every((target) => target.width === width && target.height === height)) {
        return true;
      }

      deleteFeedbackTargets();
      const first = createFeedbackTarget(width, height);
      const second = createFeedbackTarget(width, height);
      if (!first || !second) return false;

      feedbackTargets = [first, second];
      readTargetIndex = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    };

    const render = () => {
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      if (!ensureFeedbackTargets(width, height)) {
        frame = requestAnimationFrame(render);
        return;
      }

      const signal = signalRef.current;
      const readTarget = feedbackTargets[readTargetIndex];
      const writeTarget = feedbackTargets[1 - readTargetIndex];

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform2f(uniforms.pointer, pointerRef.current.x, pointerRef.current.y);
      gl.uniform1f(uniforms.time, (performance.now() - startedAt) / 1000);
      gl.uniform1f(uniforms.playing, isPlaying ? 1 : 0);
      gl.uniform1f(uniforms.master, Math.min(1, signal.master + (isPlaying ? 0.08 : 0.02)));
      gl.uniform1f(uniforms.bass, signal.bass);
      gl.uniform1f(uniforms.drums, signal.drums);
      gl.uniform1f(uniforms.mel, signal.mel);
      gl.uniform1f(uniforms.synth, signal.synth);
      gl.uniform1f(uniforms.light, signal.light);
      gl.uniform1i(uniforms.feedback, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(displayProgram);
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, writeTarget.texture);
      gl.uniform2f(displayUniforms.resolution, width, height);
      gl.uniform1i(displayUniforms.texture, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      readTargetIndex = 1 - readTargetIndex;
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      deleteFeedbackTargets();
      gl.deleteProgram(program);
      gl.deleteProgram(displayProgram);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteShader(displayFragmentShader);
      gl.deleteBuffer(buffer);
    };
  }, [isPlaying, signalRef]);

  return (
    <section className="visualizer-card" aria-label="Interactive GLSL audio visualizer">
      <canvas
        ref={canvasRef}
        className="shader-canvas"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          pointerRef.current = {
            x: (event.clientX - rect.left) / Math.max(1, rect.width),
            y: 1 - (event.clientY - rect.top) / Math.max(1, rect.height),
          };
        }}
      />
    </section>
  );
}

function renderHighlightedCode(code: string, ranges: CodeRange[]) {
  if (!ranges.length) return code;

  const merged = [...ranges]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .reduce<CodeRange[]>((acc, range) => {
      const previous = acc.at(-1);
      if (previous && range.from <= previous.to) {
        previous.to = Math.max(previous.to, range.to);
      } else {
        acc.push({ ...range });
      }
      return acc;
    }, []);

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  merged.forEach((range, index) => {
    if (range.from > cursor) {
      parts.push(code.slice(cursor, range.from));
    }
    parts.push(
      <mark key={`${range.from}-${range.to}-${index}`} className="stage-code-active">
        {code.slice(range.from, range.to)}
      </mark>,
    );
    cursor = range.to;
  });

  if (cursor < code.length) {
    parts.push(code.slice(cursor));
  }

  return parts;
}

function canvasHasVisibleSignal(canvas: HTMLCanvasElement | null | undefined, type: WidgetType) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return false;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  const width = canvas.width;
  const height = canvas.height;
  const data = context.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const stridePixels = Math.max(1, Math.floor(totalPixels / 9000));
  const minimumPixels = type === "scope" ? Math.max(70, totalPixels * 0.002) : Math.max(120, totalPixels * 0.006);
  const minimumColumns = Math.max(type === "scope" ? 18 : 12, width * (type === "scope" ? 0.08 : 0.035));
  const minimumRows = Math.max(type === "scope" ? 6 : 10, height * (type === "scope" ? 0.05 : 0.12));
  const activeColumns = new Set<number>();
  const activeRows = new Set<number>();
  let signalPixels = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += stridePixels) {
    const index = pixel * 4;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const brightness = red + green + blue;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const hasStrongColor = maxChannel > 92 && maxChannel - minChannel > 16;
    const hasBrightInk = brightness > 420 || hasStrongColor;

    if (alpha > 28 && hasBrightInk) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);

      signalPixels += 1;
      activeColumns.add(x);
      activeRows.add(y);

      if (signalPixels >= minimumPixels && activeColumns.size >= minimumColumns && activeRows.size >= minimumRows) {
        return true;
      }
    }
  }

  return false;
}

export default function Home() {
  const [prompt, setPrompt] = useState("neon night drive, glass reflections, steady pulse");
  const [bpm, setBpm] = useState(124);
  const [style, setStyle] = useState<StyleKey>("dream");
  const [composition, setComposition] = useState<GeneratedComposition>(initialComposition);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [hasGeneratedPatch, setHasGeneratedPatch] = useState(false);
  const [autoPlayRequested, setAutoPlayRequested] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [activeCodeRanges, setActiveCodeRanges] = useState<CodeRange[]>([]);
  const [widgetVisibility, setWidgetVisibility] = useState<WidgetVisibility>({});
  const hasImageMood = imageDataUrl.trim().length > 0;
  const patchReady = hasGeneratedPatch && composition.code.trim().length > 0;
  const widgetTracks = useMemo(() => extractWidgetTracks(composition.code), [composition.code]);
  const activeTrackIDs = useMemo(() => {
    return new Set(
      activeCodeRanges
        .map((range) => trackIDForRange(composition.code, range.from))
        .filter(Boolean),
    );
  }, [activeCodeRanges, composition.code]);
  const codeLayout = useMemo(() => {
    const lineCount = Math.max(1, composition.code.split("\n").length);
    const columns = lineCount > 72 ? 2 : 1;

    return {
      columns,
      rows: Math.ceil(lineCount / columns),
    };
  }, [composition.code]);
  const editorExtensions = useMemo(
    () => [javascript(), EditorView.lineWrapping, strudelActiveRangeField, strudelActiveRangeTheme],
    [],
  );
  const runtimeRef = useRef<StrudelRuntime | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const widgetCanvasRefs = useRef(new Map<string, Partial<Record<WidgetType, HTMLCanvasElement>>>());
  const activePatternRef = useRef<ActivePattern | null>(null);
  const codeRef = useRef(initialComposition.code);
  const codeLengthRef = useRef(initialComposition.code.length);
  const codeHighlightFrameRef = useRef<number | null>(null);
  const widgetVisibilityTimerRef = useRef<number | null>(null);
  const visualSignalRef = useRef<VisualSignal>({
    master: 0.16,
    bass: 0,
    drums: 0,
    mel: 0,
    synth: 0,
    light: 0,
  });

  const setWidgetCanvasRef = useCallback((trackID: string, type: WidgetType, canvas: HTMLCanvasElement | null) => {
    const normalized = trackID.toUpperCase();
    const current = widgetCanvasRefs.current.get(normalized) ?? {};
    if (canvas) {
      current[type] = canvas;
      widgetCanvasRefs.current.set(normalized, current);
    } else {
      delete current[type];
      widgetCanvasRefs.current.set(normalized, current);
    }
    setStrudelWidgetCanvas(trackID, type, canvas);
  }, []);

  const clearWidgetVisibilityMonitor = useCallback(() => {
    if (widgetVisibilityTimerRef.current !== null) {
      window.clearInterval(widgetVisibilityTimerRef.current);
      widgetVisibilityTimerRef.current = null;
    }
  }, []);

  const startWidgetVisibilityMonitor = useCallback(() => {
    clearWidgetVisibilityMonitor();
    setWidgetVisibility({});

    const updateVisibility = () => {
      setWidgetVisibility(() => {
        const next: WidgetVisibility = {};

        widgetTracks.forEach((track) => {
          const canvases = widgetCanvasRefs.current.get(track.id.toUpperCase());
          next[track.id] = {
            pianoroll: canvasHasVisibleSignal(canvases?.pianoroll, "pianoroll"),
            scope: canvasHasVisibleSignal(canvases?.scope, "scope"),
          };
        });

        return next;
      });
    };

    window.setTimeout(updateVisibility, 700);
    widgetVisibilityTimerRef.current = window.setInterval(updateVisibility, 900);
  }, [clearWidgetVisibilityMonitor, widgetTracks]);

  const dispatchActiveCodeRanges = useCallback((ranges: CodeRange[]) => {
    const view = editorViewRef.current;
    updateVisualSignal(visualSignalRef, codeRef.current, ranges);
    setActiveCodeRanges(ranges);
    view?.dispatch({
      effects: setStrudelActiveRanges.of(ranges.map((range) => clampRange(range, view.state.doc.length))),
    });
  }, []);

  const stopCodeHighlightLoop = useCallback(() => {
    if (codeHighlightFrameRef.current !== null) {
      cancelAnimationFrame(codeHighlightFrameRef.current);
      codeHighlightFrameRef.current = null;
    }
    dispatchActiveCodeRanges([]);
  }, [dispatchActiveCodeRanges]);

  const startCodeHighlightLoop = useCallback(
    (pattern: ActivePattern) => {
      activePatternRef.current = pattern;
      stopCodeHighlightLoop();

      const tick = () => {
        const runtime = runtimeRef.current;

        try {
          const time = runtime?.getTime?.();
          if (typeof time === "number" && Number.isFinite(time)) {
            dispatchActiveCodeRanges(extractActiveCodeRanges(pattern, time, codeLengthRef.current));
          }
        } catch (error) {
          console.debug("Code highlight frame skipped", error);
        }

        codeHighlightFrameRef.current = requestAnimationFrame(tick);
      };

      codeHighlightFrameRef.current = requestAnimationFrame(tick);
    },
    [dispatchActiveCodeRanges, stopCodeHighlightLoop],
  );

  useEffect(() => {
    let mounted = true;

    async function loadStrudel() {
      const runtime = (await import("@strudel/web")) as StrudelRuntime;
      const runtimeOptions = await prepareStrudelRuntime(runtime);
      await runtime.initStrudel({
        ...runtimeOptions,
        prebake: () => runtime.samples?.("github:tidalcycles/dirt-samples"),
      });
      if (mounted) {
        runtimeRef.current = runtime;
        setRuntimeReady(true);
        setStatus("Strudel engine loaded");
      }
    }

    loadStrudel().catch((error) => {
      console.error(error);
      setStatus("Strudel engine failed to load");
    });

    return () => {
      mounted = false;
      clearWidgetVisibilityMonitor();
      stopCodeHighlightLoop();
      runtimeRef.current?.hush();
    };
  }, [clearWidgetVisibilityMonitor, stopCodeHighlightLoop]);

  useEffect(() => {
    codeRef.current = composition.code;
    codeLengthRef.current = composition.code.length;
  }, [composition.code]);

  const generate = useCallback(async () => {
    if (!hasImageMood) {
      setStatus("Add an image mood first");
      return;
    }

    activePatternRef.current = null;
    clearWidgetVisibilityMonitor();
    setWidgetVisibility({});
    runtimeRef.current?.hush();
    stopStrudelWidgetAnimations(widgetTracks.map((track) => track.id));
    stopCodeHighlightLoop();
    setIsPlaying(false);
    setAutoPlayRequested(false);
    setIsGenerating(true);
    setStatus("Generating Strudel code with OpenAI");

    try {
      const response = await fetch("/api/generate-strudel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, bpm, style, imageName, imageDataUrl }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const result = (contentType.includes("application/json")
        ? await response.json()
        : { error: (await response.text()) || `Request failed with ${response.status}` }) as Partial<GeneratedAIComposition> & {
        error?: string;
        fallback?: GeneratedComposition;
      };

      if (!response.ok) {
        if (result.fallback) {
          setComposition(result.fallback);
          setHasGeneratedPatch(true);
        }
        setStatus(response.status === 413 ? "Image is too large for generation" : (result.error ?? "OpenAI generation failed"));
        return;
      }

      if (!result.code) {
        setStatus("OpenAI returned an empty patch");
        return;
      }

      setComposition({
        title: result.title ?? "OpenAI generated patch",
        code: normalizeStrudelCode(result.code),
        tracks: result.tracks ?? composition.tracks,
      });
      setHasGeneratedPatch(true);
      setAutoPlayRequested(true);
      if (typeof result.bpm === "number") {
        setBpm(result.bpm);
      }
      if (result.style) {
        setStyle(result.style);
      }
      setStatus(result.analysis ? `Image analysis: ${result.analysis}` : "Generated Strudel code with OpenAI");
    } catch (error) {
      console.error(error);
      setStatus("Could not reach OpenAI generator");
    } finally {
      setIsGenerating(false);
    }
  }, [bpm, clearWidgetVisibilityMonitor, composition.tracks, hasImageMood, imageDataUrl, imageName, prompt, stopCodeHighlightLoop, style, widgetTracks]);

  const play = useCallback(async () => {
    if (!patchReady) {
      setStatus("Generate a patch first");
      return;
    }
    if (!runtimeRef.current) {
      setStatus("Strudel engine is still loading");
      return;
    }

    try {
      setIsEvaluating(true);
      setStatus("Starting audio engine");
      await runtimeRef.current.initAudio?.();
      const audioContext = runtimeRef.current.getAudioContext?.();
      if (audioContext?.state === "suspended") {
        await audioContext.resume();
      }
      setStatus("Evaluating Strudel code");
      runtimeRef.current.hush();
      stopStrudelWidgetAnimations(widgetTracks.map((track) => track.id));
      stopCodeHighlightLoop();
      const playableCode = normalizeStrudelCode(composition.code);
      if (playableCode !== composition.code) {
        setComposition((current) => ({ ...current, code: playableCode }));
      }
      const pattern = await runtimeRef.current.evaluate(playableCode);
      if (!pattern) {
        setIsPlaying(false);
        setStatus("Strudel code did not return a playable pattern");
        return;
      }
      startCodeHighlightLoop(pattern as ActivePattern);
      startWidgetVisibilityMonitor();
      setIsPlaying(true);
      setStatus("Playing in this app with @strudel/web");
    } catch (error) {
      console.error(error);
      setIsPlaying(false);
      setStatus("Could not evaluate Strudel code");
    } finally {
      setIsEvaluating(false);
    }
  }, [composition.code, patchReady, startCodeHighlightLoop, startWidgetVisibilityMonitor, stopCodeHighlightLoop, widgetTracks]);

  useEffect(() => {
    if (!autoPlayRequested || isGenerating || !patchReady || !runtimeReady || isEvaluating) return;

    const frame = window.requestAnimationFrame(() => {
      setAutoPlayRequested(false);
      void play();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoPlayRequested, isEvaluating, isGenerating, patchReady, play, runtimeReady]);

  const stop = useCallback(() => {
    if (!patchReady) return;
    runtimeRef.current?.hush();
    stopStrudelWidgetAnimations(widgetTracks.map((track) => track.id));
    activePatternRef.current = null;
    clearWidgetVisibilityMonitor();
    setWidgetVisibility({});
    stopCodeHighlightLoop();
    setIsPlaying(false);
    setStatus("Stopped");
  }, [clearWidgetVisibilityMonitor, patchReady, stopCodeHighlightLoop, widgetTracks]);

  const exportCode = useCallback(() => {
    if (!patchReady) {
      setStatus("Generate a patch first");
      return;
    }
    const blob = new Blob([normalizeStrudelCode(composition.code)], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "strudel-code.js";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported code");
  }, [composition.code, patchReady]);

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not read image file"));
      image.src = dataUrl;
    });
  }

  function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number) {
    return new Promise<string>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not compress image"));
            return;
          }

          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        quality,
      );
    });
  }

  async function compressImageForGeneration(file: File) {
    const sourceDataUrl = await readFileAsDataUrl(file);
    const sourceImage = await loadImage(sourceDataUrl);
    const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Image compression is not available");
    }

    let compressed = "";
    for (const dimension of imageCompressionDimensions) {
      const scale = Math.min(1, dimension / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.drawImage(sourceImage, 0, 0, width, height);

      for (const quality of imageCompressionQualities) {
        compressed = await canvasToDataUrl(canvas, quality);
        if (compressed.length <= maxImageDataUrlLength) return compressed;
      }
    }

    return compressed;
  }

  async function onImageChange(file?: File) {
    if (!file) return;

    try {
      setStatus("Preparing image");
      setImageName(file.name);
      const dataUrl = await compressImageForGeneration(file);
      setImageDataUrl(dataUrl);
      setImagePreview(dataUrl);
      setPrompt((current) => `${current}, image mood: ${file.name.replace(/\.[^.]+$/, "")}`);
      setStatus("Image attached");
    } catch (error) {
      console.error(error);
      setImageDataUrl("");
      setImagePreview("");
      setStatus("Could not prepare image");
    }
  }

  function openImagePicker() {
    imageInputRef.current?.click();
  }

  return (
    <main className="shell">
      <section className="workspace" aria-label="Strudel visual coding workspace">
        <div className="control-panel">
          <button
            type="button"
            className="drop-zone"
            onClick={openImagePicker}
          >
            {imagePreview ? (
              <img src={imagePreview} alt="" />
            ) : (
              <span className="image-empty">
                <ImagePlus size={24} />
                Add image mood
              </span>
            )}
          </button>
          <input
            ref={imageInputRef}
            className="image-file-input"
            type="file"
            accept="image/*"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onImageChange(event.target.files?.[0])}
          />

          <div className="button-grid">
            <button className="primary" onClick={generate} disabled={isGenerating || !hasImageMood}>
              {isGenerating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
              {isGenerating ? "Generating" : "Generate"}
            </button>
            <button onClick={exportCode} disabled={!patchReady}>
              <Download size={17} />
              Code
            </button>
          </div>

          <div className="transport-row">
            <button
              onClick={isPlaying ? stop : play}
              disabled={isPlaying ? !patchReady : !patchReady || !runtimeReady || isEvaluating}
            >
              {isPlaying ? <Square size={18} /> : <Play size={18} />}
              {isEvaluating ? "Starting" : isPlaying ? "Stop" : "Play"}
            </button>
          </div>

          <AudioVisualizer isPlaying={isPlaying} signalRef={visualSignalRef} />
        </div>

        <div className="main-panel">
          <section className="stage-wrap" aria-label="Vertical short-form stage">
            <div className={isPlaying ? "phone-stage playing" : "phone-stage"}>
              <pre>{renderHighlightedCode(composition.code, activeCodeRanges)}</pre>
              <div className="phone-widgets" aria-label="Live track widgets">
                {widgetTracks.map((track) => {
                  const visibility = widgetVisibility[track.id];
                  const hasMeasured = Boolean(visibility);
                  const showPianoroll = !isPlaying || !hasMeasured || visibility?.pianoroll === true;
                  const showScope = !isPlaying || !hasMeasured || visibility?.scope === true;
                  const canvasClassName =
                    showPianoroll && !showScope ? "phone-canvases only-pianoroll" : !showPianoroll && showScope ? "phone-canvases only-scope" : "phone-canvases";
                  const widgetClassName = [
                    "phone-widget",
                    activeTrackIDs.has(track.id.toUpperCase()) ? "active" : "",
                    isPlaying && hasMeasured && !showPianoroll && !showScope ? "hidden" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <article className={widgetClassName} key={track.id} style={{ "--track-color": track.color } as React.CSSProperties}>
                      <header>
                        <strong>{track.label}</strong>
                      </header>
                      <div className={canvasClassName}>
                        <div className={showPianoroll ? "phone-canvas-slot" : "phone-canvas-slot hidden"}>
                          <span>Piano</span>
                          <canvas
                            ref={(node) => setWidgetCanvasRef(track.id, "pianoroll", node)}
                            aria-label={`${track.label} pianoroll`}
                          />
                        </div>
                        <div className={showScope ? "phone-canvas-slot" : "phone-canvas-slot hidden"}>
                          <span>Wave</span>
                          <canvas
                            ref={(node) => setWidgetCanvasRef(track.id, "scope", node)}
                            aria-label={`${track.label} waveform`}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="editor-panel" aria-label="Strudel code editor">
            <CodeMirror
              value={composition.code}
              height="100%"
              extensions={editorExtensions}
              basicSetup={{
                foldGutter: false,
                highlightActiveLine: false,
                lineNumbers: false,
              }}
              className={patchReady ? "code-editor-shell" : "code-editor-shell disabled"}
              editable={patchReady}
              readOnly={!patchReady}
              style={
                {
                  "--code-columns": codeLayout.columns,
                  "--code-rows": codeLayout.rows,
                } as React.CSSProperties
              }
              onCreateEditor={(view) => {
                editorViewRef.current = view;
              }}
              onChange={(value) => {
                activePatternRef.current = null;
                clearWidgetVisibilityMonitor();
                setWidgetVisibility({});
                stopCodeHighlightLoop();
                setComposition((current) => ({ ...current, code: value }));
              }}
            />
          </section>

        </div>
      </section>
    </main>
  );
}
