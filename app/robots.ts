import type { MetadataRoute } from "next";

const siteUrl = "https://strudel.n2f.site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/report-demo"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
