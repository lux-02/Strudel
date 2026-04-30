# Strudel AI Visual Coder

이미지를 음악 코드, 라이브 패치 위젯, 오디오 반응형 셰이더로 변환하는 AI Music Visual Coding 웹앱입니다. 사용자가 이미지를 업로드하면 AI가 이미지의 색감, 질감, 공간감, 밝기, 장면성을 분석하고, 브라우저에서 바로 실행 가능한 Strudel 코드를 생성합니다.

This is an AI music visual coding web app that turns an uploaded image into executable Strudel code, live patch widgets, and an audio-reactive shader. The app analyzes visual mood, texture, color, space, and contrast, then generates a playable Strudel patch directly in the browser.

Live app: https://strudel.n2f.site

---

## 한국어

### 핵심 기능

- **이미지 기반 Strudel 코드 생성**
  - 이미지 업로드 후 `Generate`를 누르면 AI가 제목, BPM, 스타일, 트랙 구성, Strudel 코드를 생성합니다.
  - 이미지를 업로드하지 않은 상태에서 `Generate`를 누르면 파일 선택창이 먼저 열립니다.
  - iPhone HEIC/HEIF 이미지는 브라우저에서 JPEG로 변환한 뒤 분석에 사용합니다.
  - 생성 코드는 `$DRUMS`, `$BASS`, `$MEL`, `$SYNTH`, `$LIGHT`, `$TEXTURE` 같은 트랙 라벨 구조를 사용합니다.
  - 브라우저에서 바로 평가 가능한 Strudel 표현을 우선 사용하도록 프롬프트와 정규화 로직이 들어 있습니다.

- **브라우저 내 Strudel 실행**
  - `@strudel/web` 기반으로 앱 내부에서 직접 재생합니다.
  - 별도 Strudel REPL 임베드가 아니라, 앱의 CodeMirror 코드 에디터와 실행 엔진이 직접 연결됩니다.

- **라이브 코드 에디터**
  - CodeMirror 기반 편집기입니다.
  - 생성 후 코드를 바로 수정할 수 있습니다.
  - 재생 중 코드를 편집하면 입력이 잠깐 멈춘 뒤 자동으로 최신 코드가 재평가됩니다.
  - 재생 중 active range는 주변 코드를 낮은 채도/밝기로 가라앉히고, 현재 실행 중인 토큰은 원래 syntax color를 유지하는 방식으로 표시됩니다.

- **트랙별 피아노롤 / 웨이브폼**
  - Strudel inline visual widget 방식에 맞춰 트랙별 피아노롤과 waveform scope를 보여줍니다.
  - 화면에 실제로 신호가 있는 위젯만 남기도록 가시성 감지가 들어 있습니다.
  - 하단 영역을 넓게 사용해 영상 오버레이용으로 읽기 쉽게 구성했습니다.

- **오디오 반응형 GLSL 스타일 셰이더**
  - 우측 패널 전체 배경에 셰이더가 깔립니다.
  - 트랙별 신호가 서로 다른 시각 효과에 연결됩니다.
  - `$DRUMS`: vertical burst, glitch slice, scanline intensity
  - `$BASS`: low-frequency blob, subtle screen shake, bloom pulse
  - `$MEL`: thin light filament, curve trail
  - `$SYNTH`: liquid warp, feedback smear
  - `$LIGHT` / `$TEXTURE`: grain, dust, afterimage

- **Variant Generation + Evolve**
  - 한 번의 생성에서 A/B/C/D 변주를 만듭니다.
  - `Evolve`는 현재 변주들을 부모로 삼아 같은 DJ set 안에서 자연스럽게 이어지는 새 변주를 만듭니다.
  - 모든 변주는 같은 performance DNA, BPM, 스타일, 호환 가능한 key/scale을 유지하도록 설계되어 있습니다.

- **DJ식 큐 전환**
  - 재생 중 A/B/C/D를 누르면 즉시 끊지 않고 다음 마디 기준으로 큐됩니다.
  - 너무 마디 끝에 가까운 시점에 누르면 한 마디 더 기다려 박자 밀림을 줄입니다.
  - AI bridge 코드가 생성되면 8마디 이상 크로스페이드 구간으로 들어갑니다.
  - 브릿지와 최종 변주는 React autoplay 경로가 아니라 Strudel 런타임 직접 evaluate 경로를 사용해 타이밍 밀림을 줄입니다.

- **AI Visual Style Generator**
  - 이미지 분석 결과로 `foggy`, `glitch`, `liquid`, `metallic`, `bloom`, `scanline` 값을 생성합니다.
  - Settings에서 직접 값을 조정할 수 있습니다.
  - 재생 중에는 Settings 버튼이 비활성화되어 라이브 상태가 흔들리지 않도록 했습니다.

- **AI 모델 선택**
  - 기본 모델은 OpenAI GPT입니다.
  - Settings에서 Kanana를 선택하고 API Key를 입력하면 Kanana API를 사용할 수 있습니다.
  - Kanana 요청 실패 시 서버에서는 GPT 경로로 폴백할 수 있도록 구성되어 있습니다.

### 기술 스택

- **Framework**: Next.js App Router
- **UI**: React
- **Code Editor**: CodeMirror
- **Music Engine**: `@strudel/web`
- **Visual Widgets**: `@strudel/draw`, custom canvas routing
- **Shader**: WebGL canvas
- **AI**: OpenAI Responses API, optional Kanana-compatible endpoint
- **Deployment**: Vercel

### 프로젝트 구조

```text
app/
  api/generate-strudel/route.ts  # 이미지 분석 및 Strudel 코드 생성 API
  globals.css                    # 전체 UI, CodeMirror, shader/layout 스타일
  page.tsx                       # 메인 앱, Strudel 런타임, 위젯, shader, variant 전환

lib/
  code-highlight.ts              # CodeMirror active range decoration
  strudel-ai-prompt.ts           # AI 시스템 프롬프트 및 Strudel 코드 정규화
  strudel-presets.ts             # fallback composition preset
  strudel-runtime.ts             # Strudel widget canvas/runtime helper

types/
  *.d.ts                         # 타입 보강
```

### 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:3000
```

### 환경변수

`.env.example`을 참고해 `.env.local`을 만듭니다.

```bash
cp .env.example .env.local
```

필요한 값:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
KANANA_API_KEY=
```

- `OPENAI_API_KEY`: GPT 기반 이미지 분석 및 Strudel 생성에 필요합니다.
- `OPENAI_MODEL`: 사용할 OpenAI 모델명입니다. 기본값은 `gpt-5.5`입니다.
- `KANANA_API_KEY`: Kanana 선택 시 사용할 서버 기본 키입니다. 사용자가 Settings에서 직접 입력할 수도 있습니다.

> 실제 API Key는 `.env.local`에만 보관하세요. `.env*`는 `.gitignore`에 포함되어 있습니다.

### 사용 방법

1. 좌측 이미지 영역을 눌러 이미지를 업로드합니다.
2. `Generate`를 누릅니다.
3. AI가 이미지를 분석하고 A/B/C/D 변주를 생성합니다.
4. 생성이 끝나면 자동으로 첫 번째 패치가 로드되고 재생됩니다.
5. 코드 에디터에서 Strudel 코드를 직접 수정할 수 있습니다.
6. 재생 중 A/B/C/D를 누르면 다음 마디 기준으로 큐되고, AI bridge를 거쳐 자연스럽게 전환됩니다.
7. `Code` 버튼으로 현재 Strudel 코드를 `.js` 파일로 저장할 수 있습니다.

### 검증 명령어

```bash
npm run typecheck
npm run build
```

### Vercel 배포

Vercel 프로젝트에 다음 환경변수를 설정합니다.

```text
OPENAI_API_KEY
OPENAI_MODEL
KANANA_API_KEY
```

빌드 명령은 기본 Next.js 설정을 사용합니다.

```bash
npm run build
```

### 구현상 주의사항

- 이미지 파일은 API 요청 크기 제한을 피하기 위해 클라이언트에서 압축됩니다.
- AI가 생성한 코드에 브라우저 Strudel에서 불안정한 표현이 들어올 수 있어 `normalizeStrudelCode`에서 일부 표현을 보정합니다.
- 자동재생은 브라우저 오디오 정책의 영향을 받습니다. 앱은 `Generate` 클릭 시점에 오디오 컨텍스트를 먼저 깨워 자동재생 실패 가능성을 줄입니다.
- 실제 API Key는 저장소에 커밋하지 마세요. `.env.local`은 `.gitignore`에 포함되어 있습니다.

### 라이선스 및 Attribution

이 프로젝트는 `AGPL-3.0-or-later`로 배포됩니다.

Strudel AI Visual Coder는 Strudel 생태계 위에 구축되어 있습니다. 특히 `@strudel/web`, `@strudel/draw`, `@strudel/core`, `@strudel/webaudio` 패키지를 사용하며, 해당 패키지들은 `AGPL-3.0-or-later` 라이선스를 따릅니다.

- Strudel: https://strudel.cc/
- Strudel source: https://github.com/tidalcycles/strudel
- 자세한 attribution: [NOTICE.md](./NOTICE.md)

---

## English

### Overview

Strudel AI Visual Coder is a browser-based AI music visual coding tool. Upload an image, generate a set of Strudel patches, edit the code live, and perform with track-level visual widgets and an audio-reactive shader background.

The product is designed for short-form visual music workflows: code, piano rolls, waveform scopes, and shader feedback can sit on top of image/video material as a screen-style overlay.

### Key Features

- **Image-to-Strudel Generation**
  - Upload an image and click `Generate`.
  - If no image has been uploaded yet, clicking `Generate` opens the file picker first.
  - iPhone HEIC/HEIF images are converted to JPEG in the browser before analysis.
  - The AI analyzes color, texture, contrast, space, material, and mood.
  - It returns a title, BPM, style, track plan, shader style, and playable Strudel code.
  - The generated code uses labeled tracks such as `$DRUMS`, `$BASS`, `$MEL`, `$SYNTH`, `$LIGHT`, and `$TEXTURE`.

- **Native In-App Playback**
  - Powered by `@strudel/web`.
  - The app evaluates and plays Strudel code directly instead of embedding the official REPL UI.

- **Live Code Editing**
  - Built with CodeMirror.
  - Generated code is editable immediately.
  - While playing, code edits are debounced and re-evaluated automatically.
  - Active code ranges are shown by dimming surrounding code while preserving the original syntax colors of the active tokens.

- **Track-Level Piano Roll and Waveform Widgets**
  - Each track can render inline Strudel-style piano roll or waveform scope widgets.
  - Empty widgets are hidden after signal detection.
  - The visual widget area is expanded horizontally for video overlay readability.

- **Audio-Reactive Shader Background**
  - A WebGL shader sits behind the entire right panel.
  - Track signals influence different visual behaviors:
  - `$DRUMS`: vertical bursts, glitch slices, scanline intensity
  - `$BASS`: low-frequency blobs, subtle screen shake, bloom pulse
  - `$MEL`: thin light filaments and curve trails
  - `$SYNTH`: liquid warp and feedback smear
  - `$LIGHT` / `$TEXTURE`: grain, dust, and afterimage trails

- **Variant Generation and Evolve**
  - Each generation returns A/B/C/D variants.
  - `Evolve` creates new variations from the current set.
  - Variants are constrained to behave like one DJ set: same BPM, same style, compatible key/scale, similar drum backbone, and similar bass root motion.

- **Quantized DJ-Style Switching**
  - Clicking A/B/C/D during playback queues the transition.
  - If the click lands too close to the end of a bar, the transition waits one more bar.
  - AI bridge patches are used for longer transitions.
  - The bridge and final variant are evaluated directly through the Strudel runtime to reduce timing drift.

- **AI Visual Style Generator**
  - The AI also returns shader parameters:
    - `foggy`
    - `glitch`
    - `liquid`
    - `metallic`
    - `bloom`
    - `scanline`
  - These can be edited in Settings.
  - Settings are disabled during playback to keep the live state stable.

- **Model Selection**
  - Default provider: OpenAI GPT.
  - Optional provider: Kanana-compatible endpoint.
  - When Kanana is selected, the UI shows an API key input field.
  - The server can fall back to GPT if the Kanana request fails.

### Tech Stack

- **Framework**: Next.js App Router
- **UI**: React
- **Code Editor**: CodeMirror
- **Music Engine**: `@strudel/web`
- **Visual Widgets**: `@strudel/draw`, custom canvas routing
- **Shader**: WebGL canvas
- **AI**: OpenAI Responses API, optional Kanana-compatible endpoint
- **Deployment**: Vercel

### Project Structure

```text
app/
  api/generate-strudel/route.ts  # AI generation endpoint
  globals.css                    # Global UI, CodeMirror, shader/layout styles
  page.tsx                       # Main app, Strudel runtime, widgets, shader, variants

lib/
  code-highlight.ts              # CodeMirror active range decorations
  strudel-ai-prompt.ts           # AI prompt and Strudel code normalization
  strudel-presets.ts             # fallback composition preset
  strudel-runtime.ts             # Strudel widget/runtime helpers

types/
  *.d.ts                         # Type declarations
```

### Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

### Environment Variables

Create `.env.local` from `.env.example`.

```bash
cp .env.example .env.local
```

Variables:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
KANANA_API_KEY=
```

- `OPENAI_API_KEY`: Required for GPT-based image analysis and Strudel generation.
- `OPENAI_MODEL`: OpenAI model name. Defaults to `gpt-5.5`.
- `KANANA_API_KEY`: Optional server-side default key for the Kanana provider. Users can also provide a key from the Settings modal.

> Never commit real API keys. `.env*` files are ignored by Git.

### Usage

1. Upload an image from the left panel.
2. Click `Generate`.
3. The AI creates A/B/C/D variants.
4. The first patch loads and starts automatically.
5. Edit Strudel code directly in the editor.
6. During playback, click A/B/C/D to queue quantized transitions.
7. Export the current Strudel code with the `Code` button.

### Validation

```bash
npm run typecheck
npm run build
```

### Deploying to Vercel

Set these environment variables in your Vercel project:

```text
OPENAI_API_KEY
OPENAI_MODEL
KANANA_API_KEY
```

Build command:

```bash
npm run build
```

### Notes

- Uploaded images are compressed client-side to avoid request size limits.
- AI-generated Strudel can include unstable expressions, so `normalizeStrudelCode` applies small compatibility fixes before playback.
- Browser autoplay rules can affect audio startup. The app tries to unlock the audio context at the moment the user clicks `Generate`.
- Do not commit real API keys. `.env.local` is ignored by Git.

### License and Attribution

This project is distributed under `AGPL-3.0-or-later`.

Strudel AI Visual Coder is built on top of the Strudel ecosystem. It uses `@strudel/web`, `@strudel/draw`, `@strudel/core`, and `@strudel/webaudio`, which are licensed under `AGPL-3.0-or-later`.

- Strudel: https://strudel.cc/
- Strudel source: https://github.com/tidalcycles/strudel
- Detailed notices: [NOTICE.md](./NOTICE.md)
