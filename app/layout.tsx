import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strudel AI Visual Coder",
  applicationName: "Strudel AI Visual Coder",
  description: "Image-to-Strudel live coding workspace with track widgets and an audio-reactive shader.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
