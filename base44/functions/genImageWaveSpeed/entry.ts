import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// genImageWaveSpeed — מייצר תמונה אמיתית דרך WaveSpeed (Google Nano Banana),
// ממתין לתוצאה (poll), מעלה לאחסון Base44 ומחזיר { url, cost_usd }.
// payload: { prompt, aspectRatio?, model? }
// model: "nano-banana" (ברירת מחדל) או "nano-banana-pro".

const BASE = "https://api.wavespeed.ai/api/v3";
// תמחור פר ריצה לפי מודל (USD) — מתואם לתעריפי WaveSpeed.
const COST_PER_RUN = { "nano-banana": 0.038, "nano-banana-pro": 0.08 };

// aspect ratios שנתמכים ע"י נאנו-בננה; ממפים מפורמט הבריף (9:16) לערך הספק.
const ALLOWED_RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const { prompt, aspectRatio, model } = await req.json().catch(() => ({}));
    if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 });

    const apiKey = Deno.env.get("WAVESPEED_API_KEY");
    if (!apiKey) return Response.json({ error: 'WAVESPEED_API_KEY not configured' }, { status: 500 });

    const modelName = model === "nano-banana-pro" ? "nano-banana-pro" : "nano-banana";
    const ratio = ALLOWED_RATIOS.includes(aspectRatio) ? aspectRatio : "1:1";

    // 1. submit — שליחת הבקשה
    const submitRes = await fetch(`${BASE}/google/${modelName}/text-to-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ prompt, aspect_ratio: ratio, output_format: "png" }),
    });
    if (!submitRes.ok) {
      const txt = await submitRes.text();
      return Response.json({ error: `wavespeed submit ${submitRes.status}: ${txt}` }, { status: 502 });
    }
    const submitData = await submitRes.json();
    const predictionId = submitData?.data?.id || submitData?.id;
    if (!predictionId) return Response.json({ error: 'wavespeed returned no prediction id' }, { status: 502 });

    // 2. poll — המתנה לתוצאה (עד ~60ש')
    let imageUrl = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const pollRes = await fetch(`${BASE}/predictions/${predictionId}/result`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const d = pollData?.data || pollData;
      const status = d?.status;
      if (status === "completed") {
        imageUrl = (d.outputs && d.outputs[0]) || (d.output && d.output[0]) || d.url;
        break;
      }
      if (status === "failed") {
        return Response.json({ error: `wavespeed failed: ${d.error || 'unknown'}` }, { status: 502 });
      }
    }
    if (!imageUrl) return Response.json({ error: 'wavespeed timeout' }, { status: 504 });

    // 3. הורדת התמונה והעלאתה לאחסון Base44 לכתובת קבועה
    const imgRes = await fetch(imageUrl);
    const blob = await imgRes.blob();
    const file = new File([blob], `wavespeed-${predictionId}.png`, { type: "image/png" });
    const uploaded = await sr.integrations.Core.UploadFile({ file });

    return Response.json({
      url: uploaded.file_url,
      cost_usd: COST_PER_RUN[modelName],
      provider_image_url: imageUrl,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});