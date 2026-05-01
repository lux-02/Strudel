import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Strudel AI Visual Coder",
    short_name: "Strudel Visual",
    description: "Image-to-Strudel live coding workspace for AI-assisted visual music performance.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    categories: ["music", "productivity", "multimedia", "developer"],
  };
}
