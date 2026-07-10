
import sys
path = r"d:\anything\apps\web\src\app\sitemap.ts"
bt = chr(96)
tl_start = bt + "${"
tl_end = "}" + bt
content = """import type { MetadataRoute } from "next";

const BASE_URL = "https://dealflow.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1.0 },
"""
for suffix in ["/features", "/pricing", "/compliance", "/faq", "/contact", "/legal/terms", "/legal/privacy"]:
    tpl = bt + "${" + "BASE_URL" + suffix + "}" + bt
    content += "    { url: " + tpl + ", lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },\n"
content += """  ];
}
"""
with open(path, "w", newline="") as f:
    f.write(content)
print("DONE")
