import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// אישור בריף (פעולת UI, לא תור LLM). מבצע ברצף לפי כללי ה-validation:
// validation אחרון → CreditLedger hold → Brief.status=approved (immutable) → יצירת Job → Orchestrator.

// validation בסיסי של Brief.json מול דרישות הסכמה הקריטיות
function validateBrief(b) {
  const errors = [];
  if (!b.project) errors.push("project חסר");
  else {
    if (!b.project.goal) errors.push("project.goal חסר");
    if (b.project.language !== "he") errors.push("language חייב להיות 'he'");
    if (!b.project.brand?.name) errors.push("brand.name חסר");
    const colors = b.project.brand?.colors || [];
    if (colors.length !== 4) errors.push("brand.colors חייב 4 צבעים");
  }
  if (!b.format) errors.push("format חסר");
  else {
    const vt = ["image_motion", "ugc_avatar", "generative_scenes", "hybrid"];
    if (!vt.includes(b.format.videoType)) errors.push("videoType לא תקין");
    if (!(b.format.durationSec >= 5 && b.format.durationSec <= 120)) errors.push("durationSec מחוץ לטווח 5-120");
    if (!(b.format.aspectRatios?.length >= 1)) errors.push("aspectRatios חסר");
  }
  if (!b.script?.hook || !b.script?.cta) errors.push("script.hook ו-script.cta נדרשים");
  if (!(b.scenes?.length >= 1)) errors.push("נדרשת לפחות סצנה אחת");
  if (!b.cost || b.cost.credits == null) errors.push("הבריף לא תומחר (cost.credits חסר)");
  return errors;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { brief_id } = await req.json();
    if (!brief_id) return Response.json({ error: 'brief_id is required' }, { status: 400 });

    const brief = await base44.asServiceRole.entities.Brief.get(brief_id);
    if (!brief) return Response.json({ error: 'brief not found' }, { status: 404 });

    // 1. validation אחרון
    const errors = validateBrief(brief.json || {});
    if (errors.length) {
      return Response.json({ error: 'validation failed', details: errors }, { status: 422 });
    }

    const credits = brief.json.cost.credits;
    const project = await base44.asServiceRole.entities.Project.get(brief.project_id);

    // 2. CreditLedger hold (≥ credits_estimate)
    await base44.asServiceRole.entities.CreditLedger.create({
      account_id: brief.account_id,
      project_id: brief.project_id,
      type: "hold",
      credits: credits,
      note: `hold עבור בריף ${brief.id} v${brief.version}`,
    });

    // 3. סימון הבריף כמאושר (immutable) והפרויקט כמאושר
    await base44.asServiceRole.entities.Brief.update(brief.id, {
      status: "approved",
      approved_at: new Date().toISOString(),
    });
    await base44.asServiceRole.entities.Project.update(brief.project_id, {
      status: "approved",
    });

    // 4. יצירת Job עם idempotency_key ו-brief_version
    const idempotencyKey = `${brief.project_id}:${brief.id}:${brief.version}`;
    const existing = await base44.asServiceRole.entities.Job.filter({ idempotency_key: idempotencyKey });
    let job;
    if (existing.length) {
      job = existing[0]; // resume — מחזיר את ה-job הקיים
    } else {
      job = await base44.asServiceRole.entities.Job.create({
        account_id: brief.account_id,
        project_id: brief.project_id,
        brief_id: brief.id,
        brief_version: brief.version,
        idempotency_key: idempotencyKey,
        state: "approved",
        video_type: brief.json.format.videoType,
        progress_pct: 0,
        started_at: new Date().toISOString(),
      });
    }

    return Response.json({ success: true, job, credits_held: credits });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});