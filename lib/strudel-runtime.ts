type PatternLike = {
  draw?: (fn: (haps: Array<Record<string, unknown>>, time: number) => void, options: Record<string, unknown>) => unknown;
  pianoroll?: (options?: Record<string, unknown>) => unknown;
  scope?: (options?: Record<string, unknown>) => unknown;
  queryArc?: (begin: number, end: number, controls?: Record<string, unknown>) => Array<Record<string, unknown>>;
  p?: (id: string) => unknown;
};

type PatternConstructor = {
  prototype: PatternLike & Record<string, unknown>;
};

export type StrudelRuntime = {
  Pattern?: PatternConstructor;
  initStrudel: (config?: unknown) => Promise<unknown>;
  initAudio?: (options?: unknown) => Promise<unknown>;
  getAudioContext?: () => AudioContext;
  getTime?: () => number;
  evaluate: (code: string, autoplay?: boolean) => Promise<unknown>;
  hush: () => void;
  registerWidgetType?: (type: string) => void;
  samples?: (sampleMap: string, baseUrl?: string, options?: unknown) => Promise<unknown>;
};

export type WidgetTrack = {
  id: string;
  label: string;
  color: string;
};

type WidgetType = "pianoroll" | "scope";
type WidgetCanvasSet = Partial<Record<WidgetType, HTMLCanvasElement>>;
type DrawModule = {
  __pianoroll?: (options?: Record<string, unknown>) => void;
  cleanupDraw?: (clearScreen?: boolean, id?: string) => void;
};

const sliderValues = new Map<string, number>();
const pendingWidgets = new WeakMap<PatternLike, Partial<Record<WidgetType, Record<string, unknown>>>>();
const widgetCanvases = new Map<string, WidgetCanvasSet>();
let drawModule: DrawModule = {};

type StrudelGlobals = typeof globalThis & {
  sliderWithID: (id: string, value: number, min?: number, max?: number, step?: number) => number;
  slider: (value: number, min?: number, max?: number, step?: number) => number;
};

function widgetOptions(idOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) {
  if (typeof idOrOptions === "string") {
    return { id: idOrOptions, ...(options ?? {}) };
  }

  return idOrOptions ?? {};
}

function normalizeTrackID(id: string) {
  return id.replace(/^\$/, "").trim().toUpperCase();
}

function widgetID(trackID: string, type: WidgetType) {
  return `${normalizeTrackID(trackID)}-${type}`;
}

function stablePianorollRange(trackID: string) {
  if (trackID.includes("DRUM")) return { minMidi: 24, maxMidi: 84 };
  if (trackID.includes("BASS")) return { minMidi: 24, maxMidi: 52 };
  if (trackID.includes("MEL") || trackID.includes("LEAD")) return { minMidi: 48, maxMidi: 88 };
  if (trackID.includes("SYNTH") || trackID.includes("PAD")) return { minMidi: 36, maxMidi: 84 };
  if (trackID.includes("LIGHT")) return { minMidi: 64, maxMidi: 100 };
  if (trackID.includes("TEXTURE")) return { minMidi: 24, maxMidi: 96 };

  return { minMidi: 24, maxMidi: 96 };
}

function getCanvasContext(trackID: string, type: WidgetType) {
  const canvas = widgetCanvases.get(normalizeTrackID(trackID))?.[type];
  if (!canvas) return null;

  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return canvas.getContext("2d", { willReadFrequently: true });
}

function rememberWidget(pattern: PatternLike, type: WidgetType, options: Record<string, unknown>) {
  const current = pendingWidgets.get(pattern) ?? {};
  current[type] = options;
  pendingWidgets.set(pattern, current);
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function eventBegin(hap: Record<string, unknown>) {
  const whole = hap.whole as { begin?: unknown } | undefined;
  return toNumber(whole?.begin);
}

function eventDuration(hap: Record<string, unknown>) {
  return Math.max(0.02, toNumber(hap.duration, 0.08));
}

function eventGain(hap: Record<string, unknown>) {
  const value = hap.value as { gain?: unknown; velocity?: unknown } | undefined;
  const gain = Math.abs(toNumber(value?.gain, 0.65));
  const velocity = Math.abs(toNumber(value?.velocity, 1));
  return Math.max(0.08, Math.min(1, gain * velocity));
}

function eventSignature(hap: Record<string, unknown>) {
  const value = hap.value as Record<string, unknown> | undefined;
  return String(value?.s ?? value?.sound ?? value?.note ?? value?.n ?? value?.freq ?? "event");
}

function stableHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function drawPatternWaveform({
  ctx,
  haps,
  time,
  from,
  to,
}: {
  ctx: CanvasRenderingContext2D;
  haps: Array<Record<string, unknown>>;
  time: number;
  from: number;
  to: number;
}) {
  const { canvas } = ctx;
  const width = canvas.width;
  const height = canvas.height;
  const center = height / 2;
  const span = Math.max(0.001, to - from);
  const waveformColor = "#ffffff";

  ctx.clearRect(0, 0, width, height);
  if (haps.length === 0) {
    return;
  }

  const samples = new Float32Array(width);

  haps.forEach((hap) => {
    const start = eventBegin(hap);
    const duration = eventDuration(hap);
    const gain = eventGain(hap);
    const left = Math.max(0, Math.floor(((start - (time + from)) / span) * width));
    const right = Math.min(width - 1, Math.ceil(((start + duration - (time + from)) / span) * width));
    const sampleSeed = stableHash(eventSignature(hap));
    const cycles = 1.5 + sampleSeed * 4.5;
    const phase = sampleSeed * Math.PI * 2;

    if (right <= 0 || left >= width || right <= left) return;

    for (let x = left; x <= right; x += 1) {
      const progress = (x - left) / Math.max(1, right - left);
      const attack = Math.min(1, progress / 0.14);
      const release = Math.min(1, (1 - progress) / 0.22);
      const envelope = Math.max(0, Math.min(attack, release));
      const wave = Math.sin(progress * cycles * Math.PI * 2 + phase);
      samples[x] += wave * envelope * gain;
    }
  });

  ctx.lineWidth = Math.max(1, width / 180);
  ctx.strokeStyle = "rgba(255,255,255,.34)";
  ctx.beginPath();
  ctx.moveTo(0, center);
  ctx.lineTo(width, center);
  ctx.stroke();

  ctx.strokeStyle = waveformColor;
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const value = Math.max(-1, Math.min(1, samples[x]));
    const y = center - value * height * 0.42;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  ctx.globalAlpha = 0.24;
  ctx.beginPath();
  for (let x = 0; x < width; x += 2) {
    const value = Math.abs(Math.max(-1, Math.min(1, samples[x])));
    ctx.moveTo(x, center - value * height * 0.28);
    ctx.lineTo(x, center + value * height * 0.28);
  }
  ctx.stroke();

  const playheadX = (-from / span) * width;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();
}

function attachTrackWidgets(pattern: PatternLike, rawTrackID: string) {
  const trackID = normalizeTrackID(rawTrackID);
  const pending = pendingWidgets.get(pattern) ?? {};
  const pianorollContext = getCanvasContext(trackID, "pianoroll");
  const scopeContext = getCanvasContext(trackID, "scope");

  if (pianorollContext && typeof pattern.draw === "function" && drawModule.__pianoroll) {
    const options: Record<string, unknown> = {
      cycles: 4,
      labels: 1,
      fill: 1,
      fillActive: 1,
      stroke: 1,
      active: "#ffffff",
      inactive: "#6fdfff",
      playheadColor: "#ffffff",
      ...(pending.pianoroll ?? {}),
      ...stablePianorollRange(trackID),
      autorange: 0,
      fold: trackID.includes("DRUM") ? 1 : 0,
      ctx: pianorollContext,
    };
    const cycles = Number(options.cycles ?? 4);
    const playhead = Number(options.playhead ?? 0.5);
    const overscan = Number(options.overscan ?? 0);
    const hideNegative = Boolean(options.hideNegative);
    const from = -cycles * playhead;
    const to = cycles * (1 - playhead);

    pattern.draw(
      (haps, time) => {
        const visibleHaps = haps.filter((hap) => {
          const event = hap as {
            whole?: { begin: number };
            isWithinTime?: (from: number, to: number) => boolean;
          };
          return (!hideNegative || Number(event.whole?.begin ?? 0) >= 0) && Boolean(event.isWithinTime?.(time + from, time + to));
        });
        drawModule.__pianoroll?.({ ...options, time, haps: visibleHaps });
      },
      {
        lookbehind: from - overscan,
        lookahead: to + overscan,
        id: widgetID(trackID, "pianoroll"),
      },
    );
  }

  if (scopeContext && typeof pattern.draw === "function") {
    const options: Record<string, unknown> = {
      cycles: 4,
      playhead: 0.5,
      color: "#ffffff",
      ...(pending.scope ?? {}),
      ctx: scopeContext,
    };
    const cycles = Number(options.cycles ?? 4);
    const playhead = Number(options.playhead ?? 0.5);
    const overscan = Number(options.overscan ?? 0);
    const from = -cycles * playhead;
    const to = cycles * (1 - playhead);

    pattern.draw(
      (haps, time) => {
        drawPatternWaveform({
          ctx: scopeContext,
          haps,
          time,
          from,
          to,
        });
      },
      {
        lookbehind: from - overscan,
        lookahead: to + overscan,
        id: widgetID(trackID, "scope"),
      },
    );
  }
}

function installTrackPWrapper(runtime: StrudelRuntime) {
  const prototype = runtime.Pattern?.prototype;
  const currentP = prototype?.p;
  if (!prototype || typeof currentP !== "function" || Reflect.get(currentP, "__strudelWidgetWrapped")) {
    return;
  }

  const wrappedP = function (this: PatternLike, id: string) {
    attachTrackWidgets(this, id);
    return currentP.call(this, id);
  };
  Reflect.set(wrappedP, "__strudelWidgetWrapped", true);
  prototype.p = wrappedP;
}

export function setStrudelWidgetCanvas(trackID: string, type: WidgetType, canvas: HTMLCanvasElement | null) {
  const normalized = normalizeTrackID(trackID);
  const canvases = widgetCanvases.get(normalized) ?? {};
  if (canvas) {
    canvases[type] = canvas;
  } else {
    delete canvases[type];
  }
  widgetCanvases.set(normalized, canvases);
}

export function stopStrudelWidgetAnimations(tracks: string[]) {
  tracks.map(normalizeTrackID).forEach((trackID) => {
    drawModule.cleanupDraw?.(false, widgetID(trackID, "pianoroll"));
    drawModule.cleanupDraw?.(false, widgetID(trackID, "scope"));

    (["pianoroll", "scope"] as const).forEach((type) => {
      const canvas = widgetCanvases.get(trackID)?.[type];
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  });
}

export async function prepareStrudelRuntime(runtime: StrudelRuntime) {
  drawModule = (await import("@strudel/draw")) as DrawModule;

  const strudelGlobals = globalThis as StrudelGlobals;
  strudelGlobals.sliderWithID = (id: string, value: number) => {
    if (!sliderValues.has(id)) {
      sliderValues.set(id, value);
    }

    return sliderValues.get(id) ?? value;
  };
  strudelGlobals.slider = (value: number) => value;

  runtime.registerWidgetType?.("_pianoroll");
  runtime.registerWidgetType?.("_scope");

  const prototype = runtime.Pattern?.prototype;
  if (prototype && typeof prototype._pianoroll !== "function") {
    prototype._pianoroll = function (
      this: PatternLike,
      idOrOptions?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      rememberWidget(this, "pianoroll", widgetOptions(idOrOptions, options));
      return this;
    };
  }

  if (prototype && typeof prototype._scope !== "function") {
    prototype._scope = function (
      this: PatternLike,
      idOrOptions?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      rememberWidget(this, "scope", widgetOptions(idOrOptions, options));
      return this;
    };
  }

  return {
    beforeEval: () => installTrackPWrapper(runtime),
  };
}
