import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

החזר אך ורק אובייקט JSON תקין במבנה הבא (ללא טקסט נוסף, ללא markdown):
{
  "phase": "gathering | proposing | review",
  "assistant_message": "מחרוזת בעברית שתוצג למשתמש",
  "brief_patch": { /* חלקי-Brief למיזוג לפי הסכמה */ },
  "missing_fields": ["שמות שדות חובה שעדיין חסרים"],
  "recommendation": { "videoType": "...", "reason": "...", "structure": ["hook","problem","solution","proof","cta"] },
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
  const content = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
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
    const approvedVoiceIds = new Set(approvedVoices.map(v => v.voiceId));

    // מעקה בטיחות: voiceId חייב להיות מאושר
    if (mergedJson.voiceover?.enabled && mergedJson.voiceover.voiceId && !approvedVoiceIds.has(mergedJson.voiceover.voiceId)) {
      mergedJson.voiceover.voiceId = approvedVoices[0]?.voiceId || "";
    }

    // תמחור אם הבריף מוכן
    let pricing = null;
    if (output.ready_for_pricing) {
      const priced = await base44.functions.invoke("priceBrief", { brief: mergedJson });
      pricing = priced.data;
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