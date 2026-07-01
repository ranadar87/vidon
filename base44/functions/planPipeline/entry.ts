import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ============================================================================
// מנוע תכנון ה-Pipeline החכם של VIDON
// ----------------------------------------------------------------------------
// מקבל brief + קטלוג מודלים אמיתי, ומחזיר עד 3 חבילות איכות (economy/standard/
// premium). לכל חבילה: סוג הצינור (pipeline) המתאים לצורך, המודלים הספציפיים
// לכל שלב, ותמחור אמיתי בקרדיטים — מהזול ליקר.
//
// המנוע "חכם": הוא בוחר את הצינור לפי מורכבות ההפקה:
//   - avatar        → דמות אנושית מדברת (עדות / מסר אישי)
//   - text_to_video → סצנות גנרטיביות ישירות מטקסט (הכי איכותי, יקר)
//   - image_to_video→ ייצור תמונה ואז הנפשה שלה (איזון עלות/איכות)
//   - image_motion  → תמונות סטילס עם אנימציית Ken-Burns ברינדור (הכי זול)
// ============================================================================

const FX = 3.7;          // USD → ILS
const CREDIT_VALUE = 0.15; // ₪ לקרדיט
const DEFAULT_MARKUP = 5;

// עלות קריינות/כתוביות/רינדור — משותפת לכל החבילות
function commonCosts(brief, catalog) {
  let usd = 0;
  const items = [];
  const durationSec = brief.format?.durationSec || 0;

  if (brief.voiceover?.enabled) {
    const tts = catalog.find((m) => m.capability === "tts");
    const chars = (brief.voiceover.fullScript || "").length;
    const c = (tts?.rate_usd ?? 0.3) * (chars / 1000);
    usd += c;
    items.push({ step: "voiceover", model: tts?.display_name || "ElevenLabs", provider: "elevenlabs", cost_usd: c });
  }
  if (brief.captions?.enabled) {
    const c = 0.4 * (durationSec / 60); // Scribe
    usd += c;
    items.push({ step: "captions", model: "ElevenLabs Scribe", provider: "scribe", cost_usd: c });
  }
  if (brief.music?.enabled && brief.music.source === "suno") {
    usd += 0.5;
    items.push({ step: "music", model: "Suno", provider: "suno", cost_usd: 0.5 });
  }
  const ratios = (brief.format?.aspectRatios || []).length || 1;
  const render = catalog.find((m) => m.capability === "render");
  const renderCost = (render?.rate_usd ?? 0.03) * (durationSec / 60) * ratios;
  usd += renderCost;
  items.push({ step: "render", model: render?.display_name || "Remotion", provider: "remotion", cost_usd: renderCost });

  return { usd, items };
}

// בחירת מודל לפי יכולת + רמת איכות (עם נפילה חכמה לרמה סמוכה)
function pickModel(catalog, capability, tier) {
  const pool = catalog.filter((m) => m.capability === capability && m.enabled !== false);
  if (pool.length === 0) return null;
  const order = { economy: ["economy", "standard", "premium"], standard: ["standard", "premium", "economy"], premium: ["premium", "standard", "economy"] };
  for (const t of (order[tier] || ["standard"])) {
    const hit = pool.find((m) => m.quality_tier === t);
    if (hit) return hit;
  }
  return pool[0];
}

// קביעת סוג הצינור המתאים לפי הצורך שבבריף
function determineStrategy(brief) {
  const vt = brief.format?.videoType;
  if (vt === "ugc_avatar") return "avatar";
  if (vt === "generative_scenes") return "text_to_video";
  if (vt === "hybrid") return "image_to_video";
  // image_motion (ברירת מחדל): אם יש הרבה סצנות קצרות → סטילס בתנועה
  return "image_motion";
}

// בניית חבילה אחת ברמת איכות נתונה
function buildPackage(brief, catalog, tier, strategy) {
  const scenes = brief.scenes || [];
  const durationSec = brief.format?.durationSec || 0;
  const steps = [];
  let usd = 0;

  if (strategy === "avatar") {
    const avatar = pickModel(catalog, "avatar", tier);
    const c = (avatar?.rate_usd ?? 0.1) * durationSec;
    usd += c;
    steps.push({ step: "avatar", model: avatar?.display_name, model_key: avatar?.model_key, provider: avatar?.provider, cost_usd: c });
  } else if (strategy === "text_to_video") {
    const t2v = pickModel(catalog, "text_to_video", tier);
    for (const s of scenes) {
      const sec = s.durationSec || 0;
      const c = (t2v?.rate_usd ?? 0.1) * sec;
      usd += c;
      steps.push({ step: "video:" + s.id, model: t2v?.display_name, model_key: t2v?.model_key, provider: t2v?.provider, cost_usd: c });
    }
  } else if (strategy === "image_to_video") {
    const img = pickModel(catalog, "text_to_image", tier);
    const i2v = pickModel(catalog, "image_to_video", tier);
    for (const s of scenes) {
      const sec = s.durationSec || 0;
      const imgC = (img?.rate_usd ?? 0.04);
      const vidC = (i2v?.rate_usd ?? 0.06) * sec;
      usd += imgC + vidC;
      steps.push({ step: "image:" + s.id, model: img?.display_name, model_key: img?.model_key, provider: img?.provider, cost_usd: imgC });
      steps.push({ step: "animate:" + s.id, model: i2v?.display_name, model_key: i2v?.model_key, provider: i2v?.provider, cost_usd: vidC });
    }
  } else {
    // image_motion — תמונות סטילס + Ken-Burns ברינדור
    const img = pickModel(catalog, "text_to_image", tier);
    for (const s of scenes) {
      const c = (img?.rate_usd ?? 0.04);
      usd += c;
      steps.push({ step: "image:" + s.id, model: img?.display_name, model_key: img?.model_key, provider: img?.provider, cost_usd: c });
    }
  }

  const common = commonCosts(brief, catalog);
  usd += common.usd;
  steps.push(...common.items);

  const totalIls = usd * FX;
  const credits = Math.ceil((totalIls * DEFAULT_MARKUP) / CREDIT_VALUE);

  const tierLabels = { economy: "חסכוני", standard: "מומלץ", premium: "פרימיום" };
  const strategyLabels = {
    avatar: "דמות אנושית מדברת (UGC)",
    text_to_video: "סצנות וידאו גנרטיביות מטקסט",
    image_to_video: "תמונות מותאמות שהופכות לווידאו",
    image_motion: "תמונות סטילס עם אנימציה",
  };

  return {
    tier,
    tier_label: tierLabels[tier],
    strategy,
    strategy_label: strategyLabels[strategy],
    steps,
    total_api_cost_usd: usd,
    total_api_cost_ils: totalIls,
    credits,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { brief } = await req.json();
    if (!brief) return Response.json({ error: 'brief is required' }, { status: 400 });

    const catalog = await base44.asServiceRole.entities.ModelCatalog.list();
    if (!catalog || catalog.length === 0) {
      return Response.json({ error: 'ModelCatalog is empty' }, { status: 400 });
    }

    const strategy = determineStrategy(brief);

    // בונים עד 3 חבילות מהזול ליקר. כל חבילה מציעה גם רמת איכות וגם — כשמתאים —
    // אסטרטגיית הפקה אחרת, כך שהלקוח מקבל אלטרנטיבה אמיתית (סטילס → תמונה-לווידאו → וידאו גנרטיבי).
    let plan;
    if (strategy === "avatar") {
      // אווטאר: אין תחליף אסטרטגי — רק רמות איכות של הדמות
      plan = [
        { tier: "standard", strategy: "avatar" },
        { tier: "premium", strategy: "avatar" },
      ];
    } else {
      // הפקת סצנות: מהזול (סטילס בתנועה) → בינוני (תמונה→וידאו) → יקר (וידאו גנרטיבי מלא)
      plan = [
        { tier: "economy", strategy: "image_motion" },
        { tier: "standard", strategy: "image_to_video" },
        { tier: "premium", strategy: "text_to_video" },
      ];
    }
    let packages = plan.map((p) => buildPackage(brief, catalog, p.tier, p.strategy));

    // סינון כפילויות מחיר (אם שתי רמות יוצאות זהות — משאירים אחת)
    const seen = new Set();
    packages = packages.filter((p) => {
      const key = p.credits;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // מיון מהזול ליקר
    packages.sort((a, b) => a.credits - b.credits);

    return Response.json({
      recommended_strategy: strategy,
      packages,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});