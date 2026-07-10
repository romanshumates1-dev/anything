path=r"d:\\anything\\apps\\web\\src\\app\\sitemap.ts"
bt=chr(96); ds=chr(36)
c="import type { MetadataRoute } from "next";\n\nconst BASE_URL = "https://dealflow.ai";\n\nexport default function sitemap(): MetadataRoute.Sitemap {\n  return [\n    { url: BASE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1.0 },\n"
for s in ["/features","/pricing","/compliance","/faq","/contact","/legal/terms","/legal/privacy"]:
  t=bt+ds+"{BASE_URL}"+s+"}"+bt
  c+="    { url: "+t+", lastModified: new Date(), changeFrequency: "monthly", priority: 0.9 },\n"
c+="  ];\n}\n"
open(path,"w",newline="").write(c)
print("OK")
