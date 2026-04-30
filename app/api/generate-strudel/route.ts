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

type StrudelAIResponse = StrudelAIVariant | {
  variants: StrudelAIVariant[];
};

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
11. 예시 코드나 기존 진행을 복제하지 않는다.

반드시 {"variants":[...]} 형태의 JSON 객체만 반환한다. variants 길이는 ${variantCount}개여야 한다. Markdown 코드펜스나 설명 문장을 JSON 밖에 쓰지 않는다.`;
}

function normalizeShaderStyle(shaderStyle?: Partial<ShaderStyle>): ShaderStyle {
  return Object.fromEntries(
    Object.entries(defaultShaderStyle).map(([key, fallback]) => {
      const value = Number(shaderStyle?.[key as keyof ShaderStyle]);
      return [key, Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback];
    }),
  ) as ShaderStyle;
}

function parseGeneratedVariant(generated: StrudelAIVariant, fallbackBpm: number, fallbackStyle: StyleKey) {
  const code = normalizeStrudelCode(stripCodeFence(generated.code));

  if (!code.includes("setcps") || !code.includes("$BASS:")) {
    throw new Error("Model response did not look like a complete Strudel patch");
  }

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

function parseGeneratedPatch(output: string, fallbackBpm: number, fallbackStyle: StyleKey, variantCount: number) {
  const jsonText = stripCodeFence(output).replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const generated = JSON.parse(jsonText) as StrudelAIResponse;
  const rawVariants = "variants" in generated ? generated.variants : [generated];
  const variants = rawVariants
    .slice(0, variantCount)
    .map((variant) => parseGeneratedVariant(variant, fallbackBpm, fallbackStyle));

  if (!variants.length) {
    throw new Error("Model response did not include variants");
  }

  const anchor = variants[0];
  return variants.map((variant) => ({
    ...variant,
    bpm: anchor.bpm,
    style: anchor.style,
    code: variant.code.replace(/setcps\s*\(\s*[^)]+\s*\)/i, `setcps(${anchor.bpm}/60/4)`),
  }));
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
          required: ["variants"],
          properties: {
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

  try {
    let variants;
    let providerUsed: "gpt" | "kanana" = "gpt";
    let providerFallback = false;

    if (provider === "kanana") {
      const kananaApiKey = body.kananaApiKey?.trim() || process.env.KANANA_API_KEY?.trim();

      if (!kananaApiKey) {
        providerFallback = true;
      } else {
        try {
          variants = await generateWithKanana({
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

    if (!variants) {
      variants = await generateWithGpt({
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
    const primary = variants[0];

    return NextResponse.json({
      ...primary,
      variants,
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
