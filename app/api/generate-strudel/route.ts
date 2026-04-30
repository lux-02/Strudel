import OpenAI from "openai";
import { NextResponse } from "next/server";
import { normalizeStrudelCode, STRUDEL_AI_PROMPT, stripCodeFence } from "../../../lib/strudel-ai-prompt";
import { generateComposition, type StyleKey, type Track } from "../../../lib/strudel-presets";

export const runtime = "nodejs";

type GenerateRequest = {
  prompt?: string;
  bpm?: number;
  style?: StyleKey;
  imageDataUrl?: string;
  imageName?: string;
  aiProvider?: "gpt" | "kanana";
  kananaApiKey?: string;
  mode?: "generate" | "evolve" | "bridge";
  variantCount?: number;
  parents?: Array<{
    title?: string;
    bpm?: number;
    style?: StyleKey;
    analysis?: string;
    shaderStyle?: Partial<ShaderStyle>;
    code?: string;
  }>;
};

type StrudelAIVariant = {
  title: string;
  bpm: number;
  style: StyleKey;
  analysis: string;
  shaderStyle?: ShaderStyle;
  code: string;
  tracks: string[];
};

type VoiceTexture = {
  enabled: boolean;
  text: string;
  words: string[];
  language: "ko" | "en" | "hybrid" | "abstract";
  chopPattern: string;
  audioDataUrl?: string;
  mimeType?: string;
  disclosure?: string;
};

type StrudelAIResponse = StrudelAIVariant | {
  variants: StrudelAIVariant[];
  voiceTexture?: VoiceTexture;
};

type GeneratedPatchResult = {
  variants: Awaited<ReturnType<typeof parseGeneratedVariant>>[];
  voiceTexture?: VoiceTexture;
};

type VoiceSynthesisProvider = "gpt" | "kanana";

const allowedStyles: StyleKey[] = ["dream", "club", "cinematic", "glitch", "ambient"];
const maxRequestBodyBytes = 2_500_000;
const kananaBaseUrl = "https://kanana-o.a2s-endpoint.kr-central-2.kakaocloud.com/v1";
const defaultShaderStyle = {
  foggy: 0.46,
  glitch: 0.18,
  liquid: 0.54,
  metallic: 0.38,
  bloom: 0.68,
  scanline: 0.22,
};
type ShaderStyle = typeof defaultShaderStyle;

function extractTracks(code: string): Track[] {
  const colors = ["#f5bd3d", "#17b6a4", "#ef5c5c", "#7c8cff", "#8ff7ff", "#cfffff"];
  const tracks = [...code.matchAll(/^\s*\$([A-Za-z][\w]*)\s*:/gm)].map((match) => `$${match[1].toUpperCase()}`);
  const labels = tracks.length ? tracks : ["$BASS", "$DRUMS", "$MEL", "$SYNTH"];

  return labels.map((label, index) => ({
    id: label.replace(/^\$/, "").toLowerCase(),
    label,
    role: "generated track",
    color: colors[index % colors.length],
    pattern: "OpenAI generated",
  }));
}

function buildUserPrompt({
  prompt,
  bpm,
  style,
  imageName,
  mode,
  variantCount,
  parents,
}: {
  prompt: string;
  bpm: number;
  style: StyleKey;
  imageName?: string;
  mode: "generate" | "evolve" | "bridge";
  variantCount: number;
  parents?: GenerateRequest["parents"];
}) {
  const parentBlock = parents?.length
    ? `\n부모 패치:\n${parents.map((parent, index) => `Parent ${index + 1}
- Title: ${parent.title ?? "untitled"}
- BPM: ${parent.bpm ?? "unknown"}
- Style: ${parent.style ?? "unknown"}
- Analysis: ${parent.analysis ?? "none"}
- ShaderStyle: ${JSON.stringify(normalizeShaderStyle(parent.shaderStyle))}
- Code:\n${parent.code ?? ""}`).join("\n\n")}`
    : "";

  return `${STRUDEL_AI_PROMPT}

사용자 입력:
- Prompt: ${prompt}
- UI BPM hint: ${bpm}
- UI Style hint: ${style}
- Image name: ${imageName || "none"}
- Mode: ${mode}
- Variant count: ${variantCount}
${parentBlock}

작업 순서:
1. 이미지가 있으면 이미지의 색, 조명, 질감, 구도, 에너지, 감정을 분석한다.
2. 분석 결과에 맞는 BPM을 60-190 사이에서 직접 선택한다.
3. 분석 결과에 맞는 style을 dream, club, cinematic, glitch, ambient 중 하나로 직접 선택한다.
4. 먼저 하나의 performance DNA를 정한다: bpm, style, scale/key, drumBackbone, bassRootMotion, soundPalette.
5. mode가 generate이면 서로 다른 곡 후보가 아니라 같은 performance DNA 안에서 즉시 믹스 가능한 후보 ${variantCount}개를 만든다.
6. mode가 evolve이면 부모 패치의 performance DNA를 유지하면서 offspring ${variantCount}개를 만든다. 장르, BPM, scale/key를 바꾸지 않는다.
7. mode가 bridge이면 Parent 1에서 Parent 2로 넘어가는 전환용 패치 1개만 만든다. Parent 1의 $DRUMS 그루브를 유지하고, Parent 2의 코드/스케일/화성 중심으로 filter가 상승하는 느낌을 만들며, $MEL은 Parent 1의 음형에서 Parent 2의 음형으로 변형되는 중간 형태여야 한다. shaderStyle은 Parent 2에 70-85% 가까운 값으로 만든다.
8. 같은 응답의 모든 후보는 동일한 setcps, 동일한 style, 호환 가능한 scale/key, 유사한 $DRUMS backbone, 유사한 $BASS root motion을 유지한다.
9. 후보 간 차이는 $MEL, $SYNTH, $LIGHT, $TEXTURE, 필터/룸/딜레이, shaderStyle 강도에서 만든다.
10. 라이브 전환이 자연스럽도록 큰 변화는 $MEL, $SYNTH, $LIGHT, $TEXTURE 쪽에서 만들고 $DRUMS/$BASS는 안정적으로 유지한다.
11. mode가 bridge가 아니면 모든 후보 코드에 $VOICE 트랙을 포함한다. $VOICE는 s("voice")를 begin/end/speed로 잘라 쓰는 낮은 gain의 vocal chop이어야 한다.
12. voiceTexture는 같은 응답의 모든 후보가 공유하는 음성 재료다. 이미지에서 나온 단어 5-9개를 만들고 TTS가 읽기 쉬운 짧은 text로 압축한다.
13. mode가 bridge이면 voiceTexture.enabled는 false로 두고 새 $VOICE 트랙을 만들지 않는다.
14. 예시 코드나 기존 진행을 복제하지 않는다.

반드시 {"voiceTexture": {...}, "variants":[...]} 형태의 JSON 객체만 반환한다. variants 길이는 ${variantCount}개여야 한다. Markdown 코드펜스나 설명 문장을 JSON 밖에 쓰지 않는다.`;
}

function normalizeShaderStyle(shaderStyle?: Partial<ShaderStyle>): ShaderStyle {
  return Object.fromEntries(
    Object.entries(defaultShaderStyle).map(([key, fallback]) => {
      const value = Number(shaderStyle?.[key as keyof ShaderStyle]);
      return [key, Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback];
    }),
  ) as ShaderStyle;
}

async function assertValidStrudelSyntax(code: string) {
  try {
    const { transpiler } = await import("@strudel/transpiler");
    transpiler(code, {
      addReturn: false,
      emitMiniLocations: false,
      emitWidgets: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Strudel parse error";
    throw new Error(`Model returned invalid Strudel syntax: ${message}`);
  }
}

async function parseGeneratedVariant(generated: StrudelAIVariant, fallbackBpm: number, fallbackStyle: StyleKey) {
  const code = normalizeStrudelCode(stripCodeFence(generated.code));

  if (!code.includes("setcps") || !code.includes("$BASS:")) {
    throw new Error("Model response did not look like a complete Strudel patch");
  }
  await assertValidStrudelSyntax(code);

  return {
    title: generated.title,
    bpm: Math.max(60, Math.min(190, Math.round(Number(generated.bpm) || fallbackBpm))),
    style: allowedStyles.includes(generated.style) ? generated.style : fallbackStyle,
    analysis: generated.analysis,
    shaderStyle: normalizeShaderStyle(generated.shaderStyle),
    code,
    tracks: extractTracks(code || generated.tracks.join("\n")),
  };
}

async function parseGeneratedPatch(output: string, fallbackBpm: number, fallbackStyle: StyleKey, variantCount: number) {
  const jsonText = stripCodeFence(output).replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const generated = JSON.parse(jsonText) as StrudelAIResponse;
  const rawVariants = "variants" in generated ? generated.variants : [generated];
  const variants = await Promise.all(
    rawVariants
      .slice(0, variantCount)
      .map((variant) => parseGeneratedVariant(variant, fallbackBpm, fallbackStyle)),
  );

  if (!variants.length) {
    throw new Error("Model response did not include variants");
  }

  const anchor = variants[0];
  return {
    variants: variants.map((variant) => ({
      ...variant,
      bpm: anchor.bpm,
      style: anchor.style,
      code: variant.code.replace(/setcps\s*\(\s*[^)]+\s*\)/i, `setcps(${anchor.bpm}/60/4)`),
    })),
    voiceTexture: "variants" in generated ? normalizeVoiceTexture(generated.voiceTexture) : undefined,
  };
}

function normalizeVoiceTexture(voiceTexture?: Partial<VoiceTexture>): VoiceTexture | undefined {
  if (!voiceTexture?.enabled) return undefined;

  const words = (voiceTexture.words ?? [])
    .map((word) => String(word).trim())
    .filter(Boolean)
    .slice(0, 9);
  const text = String(voiceTexture.text ?? words.join(", ")).trim().slice(0, 240);
  const language = ["ko", "en", "hybrid", "abstract"].includes(String(voiceTexture.language))
    ? voiceTexture.language as VoiceTexture["language"]
    : "hybrid";

  if (!text || words.length < 3) return undefined;

  return {
    enabled: true,
    text,
    words,
    language,
    chopPattern: String(voiceTexture.chopPattern ?? "word-slice").trim().slice(0, 80) || "word-slice",
    disclosure: "AI-generated voice texture.",
  };
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function pcm16MonoToWav(pcm: Buffer, sampleRate = 24_000) {
  const wav = Buffer.alloc(44 + pcm.length);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  pcm.copy(wav, 44);

  return wav;
}

async function synthesizeVoiceTextureWithGpt(voiceTexture: VoiceTexture) {
  if (!voiceTexture?.enabled || !process.env.OPENAI_API_KEY) return voiceTexture;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const speech = await client.audio.speech.create({
    model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.OPENAI_TTS_VOICE || "ash",
    input: voiceTexture.text,
    instructions: [
      "Speak as a source recording for experimental vocal chops, not as narration.",
      "Use a close, dry, restrained voice with clear separations between words.",
      "Keep it short, slightly whispered, and textural.",
    ].join(" "),
    response_format: "wav",
    speed: 0.92,
  });
  const buffer = Buffer.from(await speech.arrayBuffer());

  return {
    ...voiceTexture,
    audioDataUrl: `data:audio/wav;base64,${buffer.toString("base64")}`,
    mimeType: "audio/wav",
    disclosure: "AI-generated voice texture via OpenAI.",
  };
}

function audioBase64FromDelta(audio: unknown) {
  if (typeof audio === "string") return audio;
  if (!audio || typeof audio !== "object") return "";

  const record = audio as Record<string, unknown>;
  const value = record.data ?? record.audio;
  return typeof value === "string" ? value : "";
}

async function synthesizeVoiceTextureWithKanana(voiceTexture: VoiceTexture, apiKey: string) {
  const client = new OpenAI({
    baseURL: kananaBaseUrl,
    apiKey,
  });
  const stream = await client.chat.completions.create({
    model: "kanana-o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Create a short AI voice texture for experimental vocal chopping.",
              "Do not explain the image. Speak only the following words with clear spacing, dry and close:",
              voiceTexture.text,
            ].join("\n"),
          },
        ],
      },
    ],
    modalities: ["text", "audio"],
    stream: true,
  } as never) as unknown as AsyncIterable<unknown>;

  const pcmChunks: Buffer[] = [];

  for await (const chunk of stream) {
    const raw = chunk as { choices?: Array<{ delta?: Record<string, unknown> }> };
    const audio = raw.choices?.[0]?.delta?.audio;
    const audioB64 = audioBase64FromDelta(audio);

    if (audioB64) {
      const payload = audioB64.includes(",") ? audioB64.split(",").pop() ?? "" : audioB64;
      const pcm = Buffer.from(payload, "base64");
      if (pcm.length) {
        pcmChunks.push(pcm);
      }
    }
  }

  if (!pcmChunks.length) {
    throw new Error("Kanana did not return audio chunks");
  }

  const wav = pcm16MonoToWav(Buffer.concat(pcmChunks), 24_000);

  return {
    ...voiceTexture,
    audioDataUrl: `data:audio/wav;base64,${wav.toString("base64")}`,
    mimeType: "audio/wav",
    disclosure: "AI-generated voice texture via Kanana.",
  };
}

async function synthesizeVoiceTexture(
  voiceTexture: VoiceTexture | undefined,
  options: { provider: VoiceSynthesisProvider; kananaApiKey?: string },
) {
  if (!voiceTexture?.enabled) return voiceTexture;

  if (options.provider === "kanana" && options.kananaApiKey) {
    try {
      return await synthesizeVoiceTextureWithKanana(voiceTexture, options.kananaApiKey);
    } catch (error) {
      console.error("Kanana voice texture synthesis failed; falling back to GPT", error);
    }
  }

  try {
    return await synthesizeVoiceTextureWithGpt(voiceTexture);
  } catch (error) {
    console.error("Voice texture synthesis failed", error);
    return voiceTexture;
  }
}

function stripDataUrlPrefix(dataUrl?: string) {
  return dataUrl?.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "") ?? "";
}

async function generateWithGpt({
  prompt,
  bpm,
  style,
  imageName,
  imageDataUrl,
  mode,
  variantCount,
  parents,
}: Required<Pick<GenerateRequest, "prompt" | "bpm" | "style">> & Pick<GenerateRequest, "imageName" | "imageDataUrl" | "parents"> & { mode: "generate" | "evolve" | "bridge"; variantCount: number }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "original" }
  > = [
    {
      type: "input_text",
      text: buildUserPrompt({ prompt, bpm, style, imageName, mode, variantCount, parents }),
    },
  ];

  if (imageDataUrl?.startsWith("data:image/")) {
    content.push({
      type: "input_image",
      image_url: imageDataUrl,
      detail: "original",
    });
  }

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    input: [
      {
        role: "user",
        content: content as never,
      },
    ],
    reasoning: { effort: "low" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "strudel_image_patch",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["variants", "voiceTexture"],
          properties: {
            voiceTexture: {
              type: "object",
              additionalProperties: false,
              required: ["enabled", "text", "words", "language", "chopPattern"],
              properties: {
                enabled: { type: "boolean" },
                text: { type: "string" },
                words: {
                  type: "array",
                  minItems: mode === "bridge" ? 0 : 5,
                  maxItems: 9,
                  items: { type: "string" },
                },
                language: { type: "string", enum: ["ko", "en", "hybrid", "abstract"] },
                chopPattern: { type: "string" },
              },
            },
            variants: {
              type: "array",
              minItems: variantCount,
              maxItems: variantCount,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "bpm", "style", "analysis", "shaderStyle", "code", "tracks"],
                properties: {
                  title: { type: "string" },
                  bpm: { type: "number", minimum: 60, maximum: 190 },
                  style: { type: "string", enum: allowedStyles },
                  analysis: { type: "string" },
                  shaderStyle: {
                    type: "object",
                    additionalProperties: false,
                    required: ["foggy", "glitch", "liquid", "metallic", "bloom", "scanline"],
                    properties: {
                      foggy: { type: "number", minimum: 0, maximum: 1 },
                      glitch: { type: "number", minimum: 0, maximum: 1 },
                      liquid: { type: "number", minimum: 0, maximum: 1 },
                      metallic: { type: "number", minimum: 0, maximum: 1 },
                      bloom: { type: "number", minimum: 0, maximum: 1 },
                      scanline: { type: "number", minimum: 0, maximum: 1 },
                    },
                  },
                  code: { type: "string" },
                  tracks: {
                    type: "array",
                    minItems: 4,
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return parseGeneratedPatch(response.output_text, bpm, style, variantCount);
}

async function generateWithKanana({
  prompt,
  bpm,
  style,
  imageName,
  imageDataUrl,
  apiKey,
  mode,
  variantCount,
  parents,
}: Required<Pick<GenerateRequest, "prompt" | "bpm" | "style">> & Pick<GenerateRequest, "imageName" | "imageDataUrl" | "parents"> & { apiKey: string; mode: "generate" | "evolve" | "bridge"; variantCount: number }) {
  const client = new OpenAI({
    baseURL: kananaBaseUrl,
    apiKey,
  });
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: buildUserPrompt({ prompt, bpm, style, imageName, mode, variantCount, parents }),
    },
  ];
  const imageBase64 = stripDataUrlPrefix(imageDataUrl);

  if (imageBase64) {
    content.unshift({
      type: "image_url",
      image_url: { url: imageBase64 },
    });
  }

  const response = await client.chat.completions.create({
    model: "kanana-o",
    messages: [
      {
        role: "user",
        content,
      },
    ],
  });
  const output = response.choices[0]?.message?.content;

  if (!output) {
    throw new Error("Kanana returned an empty response");
  }

  return parseGeneratedPatch(output, bpm, style, variantCount);
}

function fallbackVariants({ prompt, bpm, style, imageName, variantCount }: { prompt: string; bpm: number; style: StyleKey; imageName?: string; variantCount: number }) {
  return Array.from({ length: variantCount }, (_, index) => {
    const patch = generateComposition({
      prompt: `${prompt} variant ${index + 1}`,
      bpm,
      style,
      imageName,
    });

    return {
      ...patch,
      bpm,
      style,
      analysis: "Fallback generated from local Strudel presets.",
      shaderStyle: normalizeShaderStyle({
        foggy: defaultShaderStyle.foggy + index * 0.04,
        glitch: defaultShaderStyle.glitch + index * 0.03,
        liquid: defaultShaderStyle.liquid + index * 0.025,
        metallic: defaultShaderStyle.metallic + index * 0.025,
        bloom: defaultShaderStyle.bloom + index * 0.035,
        scanline: defaultShaderStyle.scanline + index * 0.025,
      }),
    };
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBodyBytes) {
    return NextResponse.json({ error: "Uploaded image is too large. Use a smaller image." }, { status: 413 });
  }

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid generation request" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() || "image-inspired live-coded electronic loop";
  const bpm = Number.isFinite(body.bpm) ? Number(body.bpm) : 124;
  const style = body.style ?? "dream";
  const provider = body.aiProvider === "kanana" ? "kanana" : "gpt";
  const mode = body.mode === "bridge" ? "bridge" : body.mode === "evolve" ? "evolve" : "generate";
  const variantCount = mode === "bridge" ? 1 : Math.max(1, Math.min(4, Math.round(Number(body.variantCount) || 4)));
  const parents = body.parents?.filter((parent) => parent.code?.trim()).slice(0, 4);
  const kananaApiKey = body.kananaApiKey?.trim() || process.env.KANANA_API_KEY?.trim();

  try {
    let generated: GeneratedPatchResult | undefined;
    let providerUsed: "gpt" | "kanana" = "gpt";
    let providerFallback = false;

    if (provider === "kanana") {
      if (!kananaApiKey) {
        providerFallback = true;
      } else {
        try {
          generated = await generateWithKanana({
            prompt,
            bpm,
            style,
            imageName: body.imageName,
            imageDataUrl: body.imageDataUrl,
            apiKey: kananaApiKey,
            mode,
            variantCount,
            parents,
          });
          providerUsed = "kanana";
        } catch (error) {
          console.error("Kanana generation failed; falling back to GPT", error);
          providerFallback = true;
        }
      }
    }

    if (!generated) {
      generated = await generateWithGpt({
        prompt,
        bpm,
        style,
        imageName: body.imageName,
        imageDataUrl: body.imageDataUrl,
        mode,
        variantCount,
        parents,
      });
    }
    const variants = generated.variants;
    const primary = variants[0];
    const voiceTexture = mode === "bridge"
      ? undefined
      : await synthesizeVoiceTexture(generated.voiceTexture, {
        provider: providerUsed,
        kananaApiKey,
      });

    return NextResponse.json({
      ...primary,
      variants,
      voiceTexture,
      provider: providerUsed,
      providerFallback,
    });
  } catch (error) {
    console.error(error);
    const variants = fallbackVariants({ prompt, bpm, style, imageName: body.imageName, variantCount });
    return NextResponse.json({
      error: "AI failed to generate Strudel code",
      fallback: variants[0],
      variants,
    }, { status: 502 });
  }
}
