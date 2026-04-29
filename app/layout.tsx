import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strudel Visual Coder",
  description: "AI-assisted visual coding workspace for Strudel sketches.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
