export type StyleKey = "dream" | "club" | "cinematic" | "glitch" | "ambient";

export type Track = {
  id: string;
  label: string;
  role: string;
  color: string;
  pattern: string;
};

export type GeneratedComposition = {
  title: string;
  code: string;
  tracks: Track[];
};

const styleConfig: Record<
  StyleKey,
  {
    title: string;
    scale: string;
    drum: string;
    snare: string;
    hats: string;
    bass: string;
    melody: string;
    synth: string;
    fx: string;
    palette: string[];
  }
> = {
  dream: {
    title: "Neon dream loop",
    scale: "D4 minor",
    drum: "sbd ~ sbd [~ sbd]",
    snare: "~ noise ~ noise",
    hats: "noise*8",
    bass: "d2 ~ a1 c2",
    melody: "<d4 f4 a4 c5>*2",
    synth: "<f4 a4 d5> <e4 g4 c5>",
    fx: ".room(.55).delay(.25)",
    palette: ["#11b5a4", "#ffbf47", "#f15d5d", "#7c8cff"],
  },
  club: {
    title: "Sharp club pattern",
    scale: "F4 minor",
    drum: "sbd*4",
    snare: "~ noise ~ noise",
    hats: "[noise noise]*4",
    bass: "f2 f2 ~ eb2",
    melody: "<f4 ab4 c5 eb5>*4",
    synth: "f4 ~ ab4 c5",
    fx: ".room(.22).shape(.35)",
    palette: ["#0ea5e9", "#eab308", "#ef4444", "#22c55e"],
  },
  cinematic: {
    title: "Wide cinematic pulse",
    scale: "A3 minor",
    drum: "sbd ~ ~ sbd",
    snare: "~ ~ noise ~",
    hats: "noise*4",
    bass: "a1 ~ e2 g2",
    melody: "<a3 c4 e4 g4>*2",
    synth: "<c4 e4 a4> <b3 d4 g4>",
    fx: ".room(.8).delay(.35)",
    palette: ["#2563eb", "#f97316", "#14b8a6", "#f43f5e"],
  },
  glitch: {
    title: "Glitch step sketch",
    scale: "C4 chromatic",
    drum: "sbd [~ sbd] ~ sbd",
    snare: "~ noise [noise ~] noise",
    hats: "[noise ~ noise noise]*3",
    bass: "c2 [eb2 ~] gb1 bb1",
    melody: "<c4 eb4 gb4 a4>*6",
    synth: "[c5 ~] eb5 [gb4 a4]",
    fx: ".crush(5).room(.35)",
    palette: ["#06b6d4", "#f59e0b", "#e11d48", "#84cc16"],
  },
  ambient: {
    title: "Soft ambient drift",
    scale: "G3 major",
    drum: "sbd ~ ~ ~",
    snare: "~ ~ ~ noise",
    hats: "~ noise ~ noise",
    bass: "g1 ~ d2 ~",
    melody: "<g3 b3 d4 e4>*2",
    synth: "<b3 d4 g4> <a3 c4 e4>",
    fx: ".room(.9).delay(.5).lpf(1800)",
    palette: ["#0891b2", "#65a30d", "#d97706", "#db2777"],
  },
};

const promptHints: Array<[RegExp, StyleKey]> = [
  [/club|dance|techno|house|rave/i, "club"],
  [/movie|cinema|epic|trailer|wide|dark|dramatic/i, "cinematic"],
  [/glitch|noise|broken|cyber|chaos|digital/i, "glitch"],
  [/calm|sleep|rain|soft|ambient|float|lofi/i, "ambient"],
  [/dream|neon|city|night|future|synth/i, "dream"],
  [/클럽|댄스|테크노|하우스|비트/i, "club"],
  [/영화|시네마|웅장|어두운|드라마/i, "cinematic"],
  [/글리치|노이즈|사이버|혼란/i, "glitch"],
  [/잔잔|수면|비|부드러운|앰비언트|로파이/i, "ambient"],
  [/꿈|네온|도시|밤|미래|신스/i, "dream"],
];

export const styles: Array<{ key: StyleKey; label: string }> = [
  { key: "dream", label: "Dream" },
  { key: "club", label: "Club" },
  { key: "cinematic", label: "Cinematic" },
  { key: "glitch", label: "Glitch" },
  { key: "ambient", label: "Ambient" },
];

export function inferStyle(prompt: string, fallback: StyleKey): StyleKey {
  const match = promptHints.find(([pattern]) => pattern.test(prompt));
  return match?.[1] ?? fallback;
}

export function generateComposition({
  bpm,
  style,
  prompt,
  imageName,
}: {
  bpm: number;
  style: StyleKey;
  prompt: string;
  imageName?: string;
}): GeneratedComposition {
  const config = styleConfig[inferStyle(`${prompt} ${imageName ?? ""}`, style)];
  const cps = Number.isFinite(bpm) ? Math.max(60, Math.min(190, bpm)) / 60 / 4 : 0.5;
  const tracks: Track[] = [
    {
      id: "drums",
      label: "$DRUMS",
      role: "kick, clap, hats",
      color: config.palette[0],
      pattern: `${config.drum} / ${config.snare} / ${config.hats}`,
    },
    {
      id: "bass",
      label: "$BASS",
      role: "low pattern",
      color: config.palette[1],
      pattern: config.bass,
    },
    {
      id: "melody",
      label: "$MEL",
      role: config.scale,
      color: config.palette[2],
      pattern: config.melody,
    },
    {
      id: "synth",
      label: "$SYNTH",
      role: "pad and texture",
      color: config.palette[3],
      pattern: config.synth,
    },
  ];

  const sourceNote = [prompt.trim(), imageName ? `image: ${imageName}` : ""]
    .filter(Boolean)
    .join(" | ");

  const code = `// ${config.title}${sourceNote ? ` - ${sourceNote}` : ""}
setcps(${cps.toFixed(3)})

$DRUMS: stack(
  s("${config.drum}").gain(.8).decay(.35),
  s("${config.snare}")
    .gain(.22)
    .hpf(1200)
    .decay(.12)
    .room(.18),
  s("${config.hats}")
    .gain(.08)
    .hpf(5200)
    .decay(.035)
    .pan(sine.range(-.35,.35).slow(4))
)

$BASS: note("${config.bass}")
  .s("sawtooth")
  .lpf(650)
  .gain(.72)

$MEL: note("${config.melody}")
  .s("triangle")
  .gain(.58)${config.fx}

$SYNTH: note("${config.synth}")
  .s("supersaw")
  .gain(.44)
  .slow(2)
  .room(.7)

1/1`;

  return {
    title: config.title,
    code,
    tracks,
  };
}

export function encodeShareState(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

export function decodeShareState<T>(value: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(value)))) as T;
  } catch {
    return null;
  }
}
