import sys
path = r"d:\\anything\\apps\\web\\src\\app\\sitemap.ts"
bt = chr(96)
ds = chr(36)
content = """import type { MetadataRoute } from "next";

const BASE_URL = "https://dealflow.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1.0 },
"""
for s in ["/features", "/pricing", "/compliance", "/faq", "/contact", "/legal/terms", "/legal/privacy"]:
    t = bt + ds + "{BASE_URL}" + s + "}" + bt
    content += "    { url: " + t + ", lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },\n"
content += "  ];\n}\n"
with open(path, "w", newline="") as f:
    f.write(content)
print("done")
