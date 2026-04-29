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
};

type StrudelAIResponse = {
  title: string;
  bpm: number;
  style: StyleKey;
  analysis: string;
  code: string;
  tracks: string[];
};

const allowedStyles: StyleKey[] = ["dream", "club", "cinematic", "glitch", "ambient"];
const maxRequestBodyBytes = 2_500_000;
const kananaBaseUrl = "https://kanana-o.a2s-endpoint.kr-central-2.kakaocloud.com/v1";

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

function buildUserPrompt({ prompt, bpm, style, imageName }: { prompt: string; bpm: number; style: StyleKey; imageName?: string }) {
  return `${STRUDEL_AI_PROMPT}

사용자 입력:
- Prompt: ${prompt}
- UI BPM hint: ${bpm}
- UI Style hint: ${style}
- Image name: ${imageName || "none"}

작업 순서:
1. 이미지가 있으면 이미지의 색, 조명, 질감, 구도, 에너지, 감정을 분석한다.
2. 분석 결과에 맞는 BPM을 60-190 사이에서 직접 선택한다.
3. 분석 결과에 맞는 style을 dream, club, cinematic, glitch, ambient 중 하나로 직접 선택한다.
4. 선택한 BPM/style과 분석 내용을 반영해 새로운 Strudel 코드를 만든다.
5. 예시 코드나 기존 진행을 복제하지 않는다.

반드시 JSON 객체만 반환한다. Markdown 코드펜스나 설명 문장을 JSON 밖에 쓰지 않는다.`;
}

function parseGeneratedPatch(output: string, fallbackBpm: number, fallbackStyle: StyleKey) {
  const jsonText = stripCodeFence(output).replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const generated = JSON.parse(jsonText) as StrudelAIResponse;
  const code = normalizeStrudelCode(stripCodeFence(generated.code));

  if (!code.includes("setcps") || !code.includes("$BASS:")) {
    throw new Error("Model response did not look like a complete Strudel patch");
  }

  return {
    title: generated.title,
    bpm: Math.max(60, Math.min(190, Math.round(Number(generated.bpm) || fallbackBpm))),
    style: allowedStyles.includes(generated.style) ? generated.style : fallbackStyle,
    analysis: generated.analysis,
    code,
    tracks: extractTracks(code || generated.tracks.join("\n")),
  };
}

function stripDataUrlPrefix(dataUrl?: string) {
  return dataUrl?.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "") ?? "";
}

async function generateWithGpt({ prompt, bpm, style, imageName, imageDataUrl }: Required<Pick<GenerateRequest, "prompt" | "bpm" | "style">> & Pick<GenerateRequest, "imageName" | "imageDataUrl">) {
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
      text: buildUserPrompt({ prompt, bpm, style, imageName }),
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
          required: ["title", "bpm", "style", "analysis", "code", "tracks"],
          properties: {
            title: { type: "string" },
            bpm: { type: "number", minimum: 60, maximum: 190 },
            style: { type: "string", enum: allowedStyles },
            analysis: { type: "string" },
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
  });

  return parseGeneratedPatch(response.output_text, bpm, style);
}

async function generateWithKanana({ prompt, bpm, style, imageName, imageDataUrl, apiKey }: Required<Pick<GenerateRequest, "prompt" | "bpm" | "style">> & Pick<GenerateRequest, "imageName" | "imageDataUrl"> & { apiKey: string }) {
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
      text: buildUserPrompt({ prompt, bpm, style, imageName }),
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

  return parseGeneratedPatch(output, bpm, style);
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

  try {
    let patch;
    let providerUsed: "gpt" | "kanana" = "gpt";
    let providerFallback = false;

    if (provider === "kanana") {
      const kananaApiKey = body.kananaApiKey?.trim() || process.env.KANANA_API_KEY?.trim();

      if (!kananaApiKey) {
        providerFallback = true;
      } else {
        try {
          patch = await generateWithKanana({
            prompt,
            bpm,
            style,
            imageName: body.imageName,
            imageDataUrl: body.imageDataUrl,
            apiKey: kananaApiKey,
          });
          providerUsed = "kanana";
        } catch (error) {
          console.error("Kanana generation failed; falling back to GPT", error);
          providerFallback = true;
        }
      }
    }

    if (!patch) {
      patch = await generateWithGpt({
        prompt,
        bpm,
        style,
        imageName: body.imageName,
        imageDataUrl: body.imageDataUrl,
      });
    }

    return NextResponse.json({
      ...patch,
      provider: providerUsed,
      providerFallback,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      error: "AI failed to generate Strudel code",
      fallback: generateComposition({ prompt, bpm, style, imageName: body.imageName }),
    }, { status: 502 });
  }
}
