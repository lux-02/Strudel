import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://strudel.n2f.site";
const title = "Strudel AI Visual Coder | Image-to-Strudel Visual Music App";
const description = "Upload an image and generate executable Strudel music code, track-level pianorolls, waveforms, AI-selected sound packs, vocal chops, and audio-reactive shader visuals.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s | Strudel AI Visual Coder",
  },
  applicationName: "Strudel AI Visual Coder",
  description,
  keywords: [
    "Strudel",
    "AI music generator",
    "visual coding",
    "live coding",
    "image to music",
    "generative music",
    "audio reactive shader",
    "CodeMirror",
    "creative coding",
    "AI visual music",
    "TidalCycles",
    "WebGL music visualizer",
  ],
  authors: [{ name: "lux-02", url: "https://github.com/lux-02" }],
  creator: "lux-02",
  publisher: "lux-02",
  category: "creative coding",
  alternates: {
    canonical: "/",
    languages: {
      "ko-KR": "/",
      "en-US": "/",
    },
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Strudel AI Visual Coder",
    title,
    description,
    images: [
      {
        url: "/readme-preview.png",
        width: 1600,
        height: 1000,
        alt: "Strudel AI Visual Coder interface with image input, generated Strudel code, track widgets, and shader visuals.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/readme-preview.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#app`,
      name: "Strudel AI Visual Coder",
      url: siteUrl,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Desktop web browser",
      browserRequirements: "Requires WebGL, Web Audio API, and a desktop browser.",
      description,
      image: `${siteUrl}/readme-preview.png`,
      creator: {
        "@type": "Person",
        name: "lux-02",
        url: "https://github.com/lux-02",
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "Image-based Strudel code generation",
        "Track-level pianoroll and waveform widgets",
        "AI sound pack selection",
        "Semantic vocal chop generation",
        "Audio-reactive WebGL shader modes",
        "Variant evolve and auto loop performance workflow",
      ],
      programmingLanguage: ["TypeScript", "Strudel", "GLSL"],
      sameAs: [
        "https://github.com/lux-02/Strudel",
        "https://www.instagram.com/new.here.hero/",
      ],
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${siteUrl}/#source`,
      name: "Strudel AI Visual Coder source code",
      codeRepository: "https://github.com/lux-02/Strudel",
      programmingLanguage: ["TypeScript", "React", "GLSL", "Strudel"],
      license: "https://www.gnu.org/licenses/agpl-3.0.en.html",
      runtimePlatform: "Next.js",
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
