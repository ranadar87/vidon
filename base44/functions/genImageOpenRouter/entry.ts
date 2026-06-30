import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// genImageOpenRouter — מייצר תמונה אמיתית דרך OpenRouter Image API,
// מעלה לאחסון Base44 ומחזיר { url, cost_usd }.
// payload: { prompt, aspectRatio?, model?, resolution? }
// model: slug של מודל תמונה ב-OpenRouter (ברירת מחדל: google/gemini-2.5-flash-image).

const DEFAULT_MODEL = "google/gemini-2.5-flash-image";
// יחסי aspect שנתמכים ע"י OpenRouter; ממפים מפורמט הבריף.
const ALLOWED_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "9:21"];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const { prompt, aspectRatio, model, resolution } = await req.json().catch(() => ({}));
    if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 });

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return Response.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });

    const ratio = ALLOWED_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1";

    const res = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        prompt,
        aspect_ratio: ratio,
        resolution: resolution || "2K",
        output_format: "png",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return Response.json({ error: `openrouter ${res.status}: ${txt}` }, { status: 502 });
    }

    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return Response.json({ error: 'openrouter returned no image' }, { status: 502 });

    // העלאת התמונה (base64) לאחסון Base44 לכתובת קבועה
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], `openrouter-${Date.now()}.png`, { type: "image/png" });
    const uploaded = await sr.integrations.Core.UploadFile({ file });

    return Response.json({
      url: uploaded.file_url,
      cost_usd: data?.usage?.cost || 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});