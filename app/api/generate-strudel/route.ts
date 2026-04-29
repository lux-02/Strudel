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

export async function POST(request: Request) {
  const body = (await request.json()) as GenerateRequest;
  const prompt = body.prompt?.trim() || "image-inspired live-coded electronic loop";
  const bpm = Number.isFinite(body.bpm) ? Number(body.bpm) : 124;
  const style = body.style ?? "dream";

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured",
        fallback: generateComposition({ prompt, bpm, style, imageName: body.imageName }),
      },
      { status: 503 },
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "original" }
  > = [
    {
      type: "input_text",
      text: `${STRUDEL_AI_PROMPT}

사용자 입력:
- Prompt: ${prompt}
- UI BPM hint: ${bpm}
- UI Style hint: ${style}
- Image name: ${body.imageName || "none"}

작업 순서:
1. 이미지가 있으면 이미지의 색, 조명, 질감, 구도, 에너지, 감정을 분석한다.
2. 분석 결과에 맞는 BPM을 60-190 사이에서 직접 선택한다.
3. 분석 결과에 맞는 style을 dream, club, cinematic, glitch, ambient 중 하나로 직접 선택한다.
4. 선택한 BPM/style과 분석 내용을 반영해 새로운 Strudel 코드를 만든다.
5. 예시 코드나 기존 진행을 복제하지 않는다.`,
    },
  ];

  if (body.imageDataUrl?.startsWith("data:image/")) {
    content.push({
      type: "input_image",
      image_url: body.imageDataUrl,
      detail: "original",
    });
  }

  try {
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

    const generated = JSON.parse(response.output_text) as StrudelAIResponse;
    const code = normalizeStrudelCode(stripCodeFence(generated.code));
    if (!code.includes("setcps") || !code.includes("$BASS:")) {
      throw new Error("Model response did not look like a complete Strudel patch");
    }
    const generatedBpm = Math.max(60, Math.min(190, Math.round(Number(generated.bpm) || bpm)));
    const generatedStyle = allowedStyles.includes(generated.style) ? generated.style : style;

    return NextResponse.json({
      title: generated.title,
      bpm: generatedBpm,
      style: generatedStyle,
      analysis: generated.analysis,
      code,
      tracks: extractTracks(code || generated.tracks.join("\n")),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "OpenAI failed to generate Strudel code" }, { status: 502 });
  }
}
