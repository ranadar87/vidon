import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ============================================================================
// מנוע הווריאציות A/B — המנוף העסקי הגדול של VIDON.
//
// מבריף מאושר אחד מייצרים N גרסאות, כל אחת נבדלת בציר וריאציה יחיד:
//   hook   — פתיח שונה (הנפוץ ביותר בפרסום ביצועים)
//   cta    — קריאה-לפעולה שונה
//   visual — סגנון חזותי שונה (prompts שונים, אותו טקסט)
//   voice  — קול/קריינות שונה מתוך הקולות המאושרים
//
// כל וריאציה = Brief חדש (version נפרד) → מאושר → Job נפרד → רץ דרך אותו pipeline.
// כך מקבלים N סרטונים מוכנים-לבדיקה במקום אחד, בלי re-architecture.
//
// עלות: כל וריאציה מחייבת קרדיטים בנפרד (hold משלה). ה-orchestrator כבר אוכף
// rate-limit ו-budget — אבל כאן מגבילים את N (עד 6) כדי לא לפוצץ עלויות בטעות.
// ============================================================================

const MAX_VARIATIONS = 6;

// יצירת ואריאנטים טקסטואליים דרך ה-LLM (הוק/CTA) — בעברית, קצר וממוקד.
async function llmVariants(axis, count, baseBrief, approvedVoices) {
  const context = {
    goal: baseBrief.project?.goal,
    audience: baseBrief.project?.audience,
    brand: baseBrief.project?.brand?.name,
    currentHook: baseBrief.script?.hook,
    currentCta: baseBrief.script?.cta,
  };

  const axisInstruction = axis === "hook"
    ? `צור ${count} וריאציות שונות ומובחנות של ההוק (משפט הפתיחה). כל וריאציה בזווית שיווקית אחרת (סקרנות, בעיה, מספר/סטטיסטיקה, שאלה, הצהרה נועזת). קצר — עד 12 מילים.`
    : `צור ${count} וריאציות שונות של ה-CTA (קריאה לפעולה). כל אחת בטון אחר (דחיפות, הטבה, פשטות, סקרנות). קצר — עד 8 מילים.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `אתה קופירייטר ביצועים בעברית. ${axisInstruction} החזר JSON בלבד במבנה: {"variants": ["...", "..."]}. בדיוק ${count} פריטים. עברית תקנית, ללא markdown.` },
        { role: "user", content: `הקשר הקמפיין: ${JSON.stringify(context)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  let content = (await res.json()).choices?.[0]?.message?.content || "{}";
  content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(content);
  return (parsed.variants || []).slice(0, count);
}

// יצירת ואריאנטים ויזואליים — הזרקת style-modifier לכל סצנה (בלי LLM, דטרמיניסטי).
const VISUAL_STYLES = [
  "cinematic dramatic lighting, moody",
  "bright airy natural light, clean minimal",
  "bold vibrant colors, high energy, dynamic",
  "warm golden hour, premium lifestyle",
  "modern studio, sharp product focus",
  "documentary candid realism",
];

// onScreenText יכול להיות string או מערך של {text}. מעדכנים בהתאם, ומחזירים טקסט לקריאה.
function setSceneText(scene, text) {
  if (Array.isArray(scene.onScreenText)) {
    if (scene.onScreenText[0]) scene.onScreenText[0].text = text;
    else scene.onScreenText[0] = { text };
  } else {
    scene.onScreenText = text;
  }
}
function getSceneText(scene) {
  if (Array.isArray(scene.onScreenText)) return scene.onScreenText[0]?.text || "";
  return typeof scene.onScreenText === "string" ? scene.onScreenText : "";
}

function applyVariation(baseJson, axis, value, voices) {
  // deep clone
  const j = JSON.parse(JSON.stringify(baseJson));
  j.variation = { axis, value: typeof value === "string" ? value : value?.label || "" };

  if (axis === "hook") {
    j.script = j.script || {};
    j.script.hook = value;
    // onScreenText יכול להיות string או מערך של {text} — מטפלים בשני המבנים
    if (j.scenes?.[0]) setSceneText(j.scenes[0], value);
    if (j.voiceover?.enabled && j.voiceover.fullScript) {
      j.voiceover.fullScript = value + " " + (j.voiceover.fullScript.split(" ").slice(value.split(" ").length).join(" "));
    }
  } else if (axis === "cta") {
    j.script = j.script || {};
    j.script.cta = value;
    const last = j.scenes?.[j.scenes.length - 1];
    if (last) setSceneText(last, value);
  } else if (axis === "visual") {
    const style = value.style;
    (j.scenes || []).forEach((s) => {
      s.visual = s.visual || {};
      s.visual.prompt = `${s.visual.prompt || s.script || getSceneText(s) || "marketing scene"}, ${style}`;
    });
    j.project = j.project || {};
    j.project.brand = { ...(j.project.brand || {}), style };
  } else if (axis === "voice") {
    j.voiceover = { ...(j.voiceover || {}), enabled: true, voiceId: value.voiceId };
  }
  return j;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { brief_id, axis, count } = await req.json();
    if (!brief_id || !axis) return Response.json({ error: 'brief_id and axis are required' }, { status: 400 });
    if (!["hook", "cta", "visual", "voice"].includes(axis)) return Response.json({ error: 'invalid axis' }, { status: 400 });

    const n = Math.min(Math.max(parseInt(count) || 3, 2), MAX_VARIATIONS);
    const baseBrief = await sr.entities.Brief.get(brief_id);
    if (!baseBrief) return Response.json({ error: 'brief not found' }, { status: 404 });
    const baseJson = baseBrief.json || {};

    // חישוב ערכי הוריאציה לפי הציר
    let values = [];
    if (axis === "hook" || axis === "cta") {
      values = await llmVariants(axis, n, baseJson, []);
      if (values.length < n) {
        // גיבוי אם ה-LLM החזיר פחות — משכפלים עם וריאציה קלה
        while (values.length < n) values.push((baseJson.script?.[axis] || "") + ` (גרסה ${values.length + 1})`);
      }
    } else if (axis === "visual") {
      values = VISUAL_STYLES.slice(0, n).map((style, i) => ({ label: `סגנון ${i + 1}`, style }));
    } else if (axis === "voice") {
      const voices = await sr.entities.Voice.filter({ qa_passed: true });
      if (voices.length < 2) return Response.json({ error: 'צריך לפחות 2 קולות מאושרים כדי לייצר וריאציות קול' }, { status: 422 });
      values = voices.slice(0, n).map(v => ({ voiceId: v.voice_id, label: v.label }));
    }

    const created = [];
    // נעילת גרסאות: הווריאציות ממשיכות את מונה ה-version של הבריף הבסיסי
    let versionCursor = (baseBrief.version || 1);
    const project = await sr.entities.Project.get(baseBrief.project_id);

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const variantJson = applyVariation(baseJson, axis, value, []);

      // תמחור מחדש לכל וריאציה (ויזואל/קול עשויים לשנות עלות)
      let cost = baseJson.cost;
      try {
        const priced = await sr.functions.invoke("priceBrief", { brief: variantJson });
        const pd = priced.data || priced;
        cost = { breakdown: pd.breakdown, totalApiCost: pd.totalApiCostUsd, markup: pd.markup, credits: pd.credits };
      } catch (_) { /* נשארים עם עלות הבסיס */ }
      variantJson.cost = cost;

      versionCursor += 1;
      const label = typeof value === "string" ? value : value.label;

      // 1. Brief חדש (version נפרד, מאושר מיד — נגזר מבריף מאושר)
      const vBrief = await sr.entities.Brief.create({
        account_id: baseBrief.account_id,
        project_id: baseBrief.project_id,
        version: versionCursor,
        status: "approved",
        json: variantJson,
        phase: "review",
        credits_estimate: cost?.credits,
        total_api_cost_usd: cost?.totalApiCost,
        approved_at: new Date().toISOString(),
      });

      // 2. hold קרדיטים לוריאציה
      if (cost?.credits) {
        await sr.entities.CreditLedger.create({
          account_id: baseBrief.account_id, project_id: baseBrief.project_id,
          type: "hold", credits: cost.credits, note: `hold וריאציה (${axis}: ${label}) v${versionCursor}`,
        });
      }

      // 3. Job נפרד לוריאציה
      const idempotencyKey = `${baseBrief.project_id}:${vBrief.id}:${versionCursor}`;
      const job = await sr.entities.Job.create({
        account_id: baseBrief.account_id,
        project_id: baseBrief.project_id,
        brief_id: vBrief.id,
        brief_version: versionCursor,
        idempotency_key: idempotencyKey,
        state: "approved",
        video_type: variantJson.format?.videoType,
        progress_pct: 0,
        started_at: new Date().toISOString(),
      });

      created.push({ job_id: job.id, brief_id: vBrief.id, axis, label });
    }

    return Response.json({ success: true, axis, count: created.length, variations: created });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});