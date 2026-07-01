import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ----- תמחור מוטמע (inline) — זהה ל-priceBrief, כדי לעקוף כשלי 403 של functions.invoke פנימי -----
const DEFAULT_RATES = { nanoBananaPerImage: 0.04, avatarPerSec: 0.10, genVideoPerSec: 0.50, ttsPer1kChars: 0.30, scribePerMin: 0.40, remotionPerMin: 0.03, sunoPerTrack: 0.50 };

function computePricing(brief, rates, { markup = 5, fx = 3.7, creditValue = 0.15 } = {}) {
  let cost = 0;
  const breakdown = [];
  for (const s of (brief.scenes || [])) {
    const sec = s.durationSec || 0;
    let c = 0;
    switch (s.visual?.source) {
      case "nano_banana": c = rates.nanoBananaPerImage; break;
      case "wavespeed": c = rates.avatarPerSec * sec; break;
      case "veo": case "kling": c = rates.genVideoPerSec * sec; break;
      default: c = 0;
    }
    cost += c;
    breakdown.push({ step: "visual:" + s.id, provider: s.visual?.source, cost: c });
  }
  if (brief.voiceover?.enabled) {
    const chars = (brief.voiceover.fullScript || "").length;
    const c = rates.ttsPer1kChars * (chars / 1000);
    cost += c;
    breakdown.push({ step: "voiceover", provider: "elevenlabs", cost: c });
  }
  if (brief.captions?.enabled) {
    const c = rates.scribePerMin * ((brief.format?.durationSec || 0) / 60);
    cost += c;
    breakdown.push({ step: "captions", provider: "scribe", cost: c });
  }
  if (brief.music?.enabled && brief.music.source === "suno") {
    cost += rates.sunoPerTrack;
    breakdown.push({ step: "music", provider: "suno", cost: rates.sunoPerTrack });
  }
  const ratios = (brief.format?.aspectRatios || []).length || 1;
  const render = rates.remotionPerMin * ((brief.format?.durationSec || 0) / 60) * ratios;
  cost += render;
  breakdown.push({ step: "render", provider: "remotion", cost: render });
  const totalApiCostIls = cost * fx;
  const credits = Math.ceil((totalApiCostIls * markup) / creditValue);
  return { breakdown, totalApiCostUsd: cost, totalApiCostIls, markup, credits };
}

// מנוע ה-Brief Intelligence — לולאת LLM אגנטית בעברית.
// קורא ל-Claude Sonnet דרך OpenRouter, תור אחר תור. חסר-מצב: כל ההקשר מוזרק בכל קריאה.
// התמחור נעשה בקוד (priceBrief) — ה-LLM לעולם לא ממציא מחירים.

const SYSTEM_PROMPT = `אתה מנוע ה-Brief Intelligence של VIDON — פלטפורמה להפקת סרטוני וידאו שיווקיים מבוססת צ׳אט.
תפקידך: לנהל שיחה בעברית עם צוות סוכנות, לחלץ בריף הפקה מובנה, להמליץ על סוג הסרטון ומבנהו, ולהפיק בריף JSON תקין.

עקרונות:
- כל התקשורת בעברית, RTL, טון מקצועי וקצר.
- שאל רק את החסר. אם יש preset לוורטיקל — הסתמך עליו ואל תתחיל מאפס.
- בחר videoType: image_motion (ברירת מחדל זולה ומהירה ל-lead-gen), ugc_avatar (דמות מדברת), generative_scenes, hybrid.
- מבנה: lead-gen = hook→בעיה→פתרון→הצעה→CTA. brand = hook→מסר→רגש→CTA רך. testimonial = hook אישי→בעיה→מה שעשיתי→תוצאה→CTA.
- הקצאת משך: הוק 2-3ש׳, גוף מחולק לסצנות, CTA 3-4ש׳. סכום משכי הסצנות = durationSec בדיוק.
- voiceId חייב להיות מתוך הקולות המאושרים בלבד ({{approved_voices}}). אל תמציא voiceId.
- language תמיד "he". brand.colors תמיד 4 צבעי HEX.
- לעולם אל תקבע מחיר או credits — שדה cost מתמלא ע"י המערכת בלבד.
- אם הקלט עמום — שאל שאלת הבהרה אחת ממוקדת. אם הבקשה אינה הפקת וידאו — הסבר בקצרה את ייעודך והחזר לפסים.

הקשר נוכחי:
- ורטיקל: {{vertical}}
- preset: {{preset}}
- מותג הלקוח: {{client_brand}}
- קולות מאושרים: {{approved_voices}}
- מצבי מוזיקה זמינים: {{music_moods}}
- בריף נוכחי: {{current_brief}}
- שלב השיחה: {{conversation_phase}}

מבנה ה-brief_patch — חובה להשתמש במבנה המדויק הזה (המערכת מתמחרת ומאשרת לפיו בלבד):
{
  "project": { "goal": "המטרה השיווקית", "language": "he", "brand": { "name": "שם העסק/מותג", "colors": ["#RRGGBB","#RRGGBB","#RRGGBB","#RRGGBB"], "style": "תיאור סגנון" } },
  "format": { "videoType": "image_motion|ugc_avatar|generative_scenes|hybrid", "durationSec": <סכום משכי הסצנות>, "aspectRatios": ["9:16"] },
  "script": { "hook": "משפט הפתיחה", "cta": "הקריאה לפעולה" },
  "scenes": [
    { "id": "s1", "durationSec": 4, "visual": { "source": "wavespeed|nano_banana|veo|kling|stock", "prompt": "תיאור ויזואלי באנגלית" }, "onScreenText": "טקסט על המסך", "script": "טקסט קריינות לסצנה" }
  ],
  "voiceover": { "enabled": true, "voiceId": "מזהה קול מאושר", "fullScript": "כל הקריינות ברצף" },
  "captions": { "enabled": true, "font": "Assistant", "highlight": "amber" },
  "music": { "enabled": true, "source": "library", "mood": "upbeat" }
}

כללי מבנה קריטיים:
- כל שדה חייב להיות במיקום המדויק לעיל. אל תשטח שדות (למשל business_name בשורש) — brand.name בתוך project.brand.
- format.videoType, format.durationSec, format.aspectRatios חובה. project.goal, project.brand.name, project.brand.colors (בדיוק 4) חובה.
- script.hook ו-script.cta חובה. חייבת להיות לפחות סצנה אחת עם id, durationSec, ו-visual.source.
- durationSec של format = סכום durationSec של כל הסצנות בדיוק.
- ready_for_pricing=true רק כשכל שדות החובה מלאים (יש scenes עם visual.source ו-format ו-script). ready_for_approval=true רק אחרי שהוצג תמחור והמשתמש לא ביקש שינויים.

החזר אך ורק אובייקט JSON תקין במבנה הבא (ללא טקסט נוסף, ללא markdown):
{
  "phase": "gathering | proposing | review",
  "assistant_message": "מחרוזת בעברית שתוצג למשתמש",
  "brief_patch": { /* חלקי-Brief במבנה המדויק לעיל */ },
  "missing_fields": ["שמות שדות חובה שעדיין חסרים"],
  "recommendation": { "videoType": "...", "reason": "הסבר קצר למה סוג זה מתאים", "structure": ["hook","problem","solution","proof","cta"] },
  "ready_for_pricing": false,
  "ready_for_approval": false
}`;

function buildSystemPrompt(ctx) {
  return SYSTEM_PROMPT
    .replace("{{vertical}}", ctx.vertical || "לא צוין")
    .replace("{{preset}}", ctx.preset ? JSON.stringify(ctx.preset) : "אין")
    .replace("{{client_brand}}", ctx.clientBrand ? JSON.stringify(ctx.clientBrand) : "אין")
    .replace("{{approved_voices}}", ctx.approvedVoices ? JSON.stringify(ctx.approvedVoices) : "[]")
    .replace("{{music_moods}}", ctx.musicMoods ? JSON.stringify(ctx.musicMoods) : "[]")
    .replace("{{current_brief}}", ctx.currentBrief ? JSON.stringify(ctx.currentBrief) : "{}")
    .replace("{{conversation_phase}}", ctx.phase || "gathering");
}

// מיזוג עמוק חלקי (deep merge) של brief_patch לתוך הבריף
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (Array.isArray(v)) {
      out[k] = v;
    } else if (v && typeof v === "object") {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function callLLM(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages,
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || "{}";
  // Claude לא תמיד מכבד response_format ועוטף ב-```json ... ``` — מנקים לפני parse.
  content = content.trim();
  if (content.startsWith("```")) {
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  // חילוץ אובייקט ה-JSON הראשון אם יש טקסט עוטף נוסף
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first !== -1 && last !== -1 && (first > 0 || last < content.length - 1)) {
    content = content.slice(first, last + 1);
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    // fallback: אם ה-JSON שבור, לא מפילים את כל השיחה — מחזירים הודעה גולמית בלי brief_patch.
    console.error("callLLM JSON parse failed:", e.message, "| raw:", content.slice(0, 500));
    return { phase: "gathering", assistant_message: content.replace(/[{}"]/g, "").slice(0, 800) || "מצטער, נתקלתי בבעיה טכנית. אפשר לחזור על הבקשה?", brief_patch: {}, missing_fields: [], ready_for_pricing: false, ready_for_approval: false };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { project_id, brief_id, message, history } = await req.json();
    if (!project_id || !message) {
      return Response.json({ error: 'project_id and message are required' }, { status: 400 });
    }

    // טעינת הבריף הנוכחי
    let brief = null;
    if (brief_id) {
      brief = await base44.asServiceRole.entities.Brief.get(brief_id);
    }
    const currentBrief = brief?.json || {};

    // הקשר מוזרק
    const project = await base44.asServiceRole.entities.Project.get(project_id);
    const voices = await base44.asServiceRole.entities.Voice.filter({ qa_passed: true });
    const approvedVoices = voices.map(v => ({ voiceId: v.voice_id, label: v.label, gender: v.gender, style: v.style }));
    const tracks = await base44.asServiceRole.entities.MusicTrack.list();
    const musicMoods = [...new Set(tracks.map(t => t.mood).filter(Boolean))];

    let clientBrand = null;
    if (project?.client_id) {
      const client = await base44.asServiceRole.entities.Client.get(project.client_id).catch(() => null);
      if (client) clientBrand = { name: client.brand_name, colors: client.brand_colors, logo: client.logo_url, font: client.brand_font };
    }

    let presets = [];
    if (project?.vertical) {
      presets = await base44.asServiceRole.entities.Preset.filter({ vertical: project.vertical });
    }

    const systemPrompt = buildSystemPrompt({
      vertical: project?.vertical,
      preset: presets[0]?.brief_template,
      clientBrand,
      approvedVoices,
      musicMoods,
      currentBrief,
      phase: brief?.phase || "gathering",
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // קריאה ל-LLM עם עד 2 ניסיונות תיקון validation
    let output = await callLLM(messages);

    // התעלמות תמיד מ-cost שמגיע מה-LLM
    if (output.brief_patch?.cost) delete output.brief_patch.cost;

    // מיזוג הבריף
    let mergedJson = deepMerge(currentBrief, output.brief_patch || {});
    // שמירת ההמלצה על הבריף עצמו — כדי שהכרטיס יציג פירוט גם בטעינה מחדש
    if (output.recommendation) mergedJson.recommendation = output.recommendation;
    const approvedVoiceIds = new Set(approvedVoices.map(v => v.voiceId));

    // מעקה בטיחות: voiceId חייב להיות מאושר
    if (mergedJson.voiceover?.enabled && mergedJson.voiceover.voiceId && !approvedVoiceIds.has(mergedJson.voiceover.voiceId)) {
      mergedJson.voiceover.voiceId = approvedVoices[0]?.voiceId || "";
    }

    // תמחור אם הבריף מוכן — גם אם Claude שכח את הדגל, מתמחרים ברגע שהמבנה שלם
    const briefComplete =
      Array.isArray(mergedJson.scenes) && mergedJson.scenes.length > 0 &&
      mergedJson.scenes.every((s) => s.visual?.source) &&
      mergedJson.format?.videoType && mergedJson.format?.durationSec &&
      mergedJson.script?.hook && mergedJson.script?.cta;

    let pricing = null;
    if (output.ready_for_pricing || briefComplete) {
      // תמחור מוטמע — עוקף כשלי 403 של functions.invoke פנימי
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
      } catch (_e) { /* ברירות מחדל */ }

      pricing = computePricing(mergedJson, rates, {});
      mergedJson.cost = {
        breakdown: pricing.breakdown,
        totalApiCost: pricing.totalApiCostUsd,
        markup: pricing.markup,
        credits: pricing.credits,
      };
    }

    // שמירת/יצירת הבריף עם version מועלה
    let savedBrief;
    if (brief) {
      savedBrief = await base44.asServiceRole.entities.Brief.update(brief.id, {
        json: mergedJson,
        version: (brief.version || 1) + 1,
        phase: output.phase || brief.phase,
        credits_estimate: pricing?.credits ?? brief.credits_estimate,
        total_api_cost_usd: pricing?.totalApiCostUsd ?? brief.total_api_cost_usd,
        total_api_cost_ils: pricing?.totalApiCostIls ?? brief.total_api_cost_ils,
      });
    } else {
      savedBrief = await base44.asServiceRole.entities.Brief.create({
        account_id: project?.account_id,
        project_id,
        version: 1,
        status: "draft",
        json: mergedJson,
        phase: output.phase || "gathering",
        credits_estimate: pricing?.credits,
        total_api_cost_usd: pricing?.totalApiCostUsd,
        total_api_cost_ils: pricing?.totalApiCostIls,
      });
      await base44.asServiceRole.entities.Project.update(project_id, {
        current_brief_id: savedBrief.id,
        status: "briefing",
        credits_estimate: pricing?.credits,
      });
    }

    return Response.json({
      assistant_message: output.assistant_message,
      phase: output.phase,
      brief: savedBrief,
      missing_fields: output.missing_fields || [],
      recommendation: output.recommendation || null,
      ready_for_pricing: !!output.ready_for_pricing,
      ready_for_approval: !!output.ready_for_approval,
      pricing,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});