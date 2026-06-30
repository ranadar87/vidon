import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// מנוע התמחור הדטרמיניסטי — קוד, לא LLM. ה-LLM לעולם לא ממציא מחירים.
// שיעורי ברירת מחדל (USD) — נטענים מ-ProviderConfig אם קיימים.
const DEFAULT_RATES = {
  nanoBananaPerImage: 0.04,
  avatarPerSec: 0.10,
  genVideoPerSec: 0.50,
  ttsPer1kChars: 0.30,
  scribePerMin: 0.40,
  remotionPerMin: 0.03,
  sunoPerTrack: 0.50,
};

function priceBrief(brief, rates, { markup = 5, fx = 3.7, creditValue = 0.15 } = {}) {
  let cost = 0;
  const breakdown = [];

  // 1. מקור ויזואלי — לכל סצנה
  for (const s of (brief.scenes || [])) {
    const sec = s.durationSec || 0;
    let c = 0;
    switch (s.visual?.source) {
      case "nano_banana": c = rates.nanoBananaPerImage; break;
      case "wavespeed": c = rates.avatarPerSec * sec; break;
      case "veo":
      case "kling": c = rates.genVideoPerSec * sec; break;
      case "stock": c = 0; break;
      default: c = 0;
    }
    cost += c;
    breakdown.push({ step: "visual:" + s.id, provider: s.visual?.source, cost: c });
  }

  // 2. קריינות (ElevenLabs)
  if (brief.voiceover?.enabled) {
    const chars = (brief.voiceover.fullScript || "").length;
    const c = rates.ttsPer1kChars * (chars / 1000);
    cost += c;
    breakdown.push({ step: "voiceover", provider: "elevenlabs", cost: c });
  }

  // 3. כתוביות (Scribe) — לפי אורך האודיו
  if (brief.captions?.enabled) {
    const c = rates.scribePerMin * ((brief.format?.durationSec || 0) / 60);
    cost += c;
    breakdown.push({ step: "captions", provider: "scribe", cost: c });
  }

  // 4. מוזיקה (suno בלבד עולה; library = 0)
  if (brief.music?.enabled && brief.music.source === "suno") {
    cost += rates.sunoPerTrack;
    breakdown.push({ step: "music", provider: "suno", cost: rates.sunoPerTrack });
  }

  // 5. רינדור — לכל דקת-פלט × מספר יחסי התצוגה
  const ratios = (brief.format?.aspectRatios || []).length || 1;
  const render = rates.remotionPerMin * ((brief.format?.durationSec || 0) / 60) * ratios;
  cost += render;
  breakdown.push({ step: "render", provider: "remotion", cost: render });

  const totalApiCostIls = cost * fx;
  const credits = Math.ceil((totalApiCostIls * markup) / creditValue);

  return { breakdown, totalApiCostUsd: cost, totalApiCostIls, markup, credits };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { brief, markup, fx, creditValue } = await req.json();
    if (!brief) return Response.json({ error: 'brief is required' }, { status: 400 });

    // טעינת rates מ-ProviderConfig (אם קיימים) מעל ברירות המחדל
    const rates = { ...DEFAULT_RATES };
    try {
      const configs = await base44.asServiceRole.entities.ProviderConfig.list();
      for (const cfg of configs) {
        if (cfg.rate_usd == null) continue;
        if (cfg.provider === "nano_banana") rates.nanoBananaPerImage = cfg.rate_usd;
        if (cfg.provider === "wavespeed" || cfg.provider === "heygen") rates.avatarPerSec = cfg.rate_usd;
        if (cfg.provider === "veo" || cfg.provider === "kling") rates.genVideoPerSec = cfg.rate_usd;
        if (cfg.provider === "elevenlabs") rates.ttsPer1kChars = cfg.rate_usd;
        if (cfg.provider === "scribe") rates.scribePerMin = cfg.rate_usd;
        if (cfg.provider === "remotion") rates.remotionPerMin = cfg.rate_usd;
        if (cfg.provider === "suno") rates.sunoPerTrack = cfg.rate_usd;
      }
    } catch (_e) { /* שימוש בברירות מחדל */ }

    const result = priceBrief(brief, rates, {
      markup: markup ?? 5,
      fx: fx ?? 3.7,
      creditValue: creditValue ?? 0.15,
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});