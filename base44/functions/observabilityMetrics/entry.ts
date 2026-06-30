import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// observabilityMetrics — מטריקות תפעוליות ל-VIDON:
// משך/כשל per step, עלות per job, עומק תור (jobs פעילים), ו-time-to-delivery.
// admin-only. מחזיר JSON מצרפי ל-Dashboard תפעולי.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const sr = base44.asServiceRole;
    const [jobs, steps, costs] = await Promise.all([
      sr.entities.Job.list('-created_date', 500),
      sr.entities.JobStep.list('-created_date', 1000),
      sr.entities.ApiCostLog.list('-created_date', 1000),
    ]);

    // עומק תור — jobs שעדיין לא הסתיימו
    const activeStates = ["approved", "generating_assets", "rendering", "review"];
    const queueDepth = jobs.filter(j => activeStates.includes(j.state)).length;

    // התפלגות jobs לפי state
    const byState = {};
    for (const j of jobs) byState[j.state] = (byState[j.state] || 0) + 1;

    // עלות per job (Σ ApiCostLog)
    const costByJob = {};
    for (const c of costs) {
      if (!c.job_id) continue;
      costByJob[c.job_id] = (costByJob[c.job_id] || 0) + (c.cost_usd || 0);
    }
    const jobCosts = jobs.map(j => ({
      job_id: j.id,
      state: j.state,
      video_type: j.video_type,
      cost_usd: +(costByJob[j.id] || 0).toFixed(4),
    }));

    // משך וכשל per step (לפי שם שלב) — שיעור כשל וזמן ריצה ממוצע
    const stepAgg = {};
    for (const s of steps) {
      const key = s.name?.split(":")[0] || s.name || "unknown"; // visual:s1 -> visual
      const a = stepAgg[key] || (stepAgg[key] = { name: key, total: 0, succeeded: 0, failed: 0, running: 0, pending: 0, durations: [] });
      a.total++;
      if (s.status === "succeeded") a.succeeded++;
      else if (s.status === "failed") a.failed++;
      else if (s.status === "running") a.running++;
      else a.pending++;
      if (s.created_date && s.updated_date && (s.status === "succeeded" || s.status === "failed")) {
        const ms = new Date(s.updated_date).getTime() - new Date(s.created_date).getTime();
        if (ms >= 0 && ms < 1000 * 60 * 60) a.durations.push(ms / 1000);
      }
    }
    const stepMetrics = Object.values(stepAgg).map(a => ({
      name: a.name,
      total: a.total,
      succeeded: a.succeeded,
      failed: a.failed,
      running: a.running,
      pending: a.pending,
      failure_rate: a.total ? +(a.failed / a.total).toFixed(3) : 0,
      avg_duration_sec: a.durations.length ? +(a.durations.reduce((x, y) => x + y, 0) / a.durations.length).toFixed(1) : null,
    }));

    // time-to-delivery — ממוצע על jobs שהסתיימו (started_at -> completed_at)
    const deliveries = jobs
      .filter(j => j.started_at && j.completed_at)
      .map(j => (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000)
      .filter(s => s >= 0);
    const avgDeliverySec = deliveries.length ? +(deliveries.reduce((x, y) => x + y, 0) / deliveries.length).toFixed(0) : null;

    const failedJobs = jobs.filter(j => j.state === "failed").length;
    const completedJobs = jobs.filter(j => ["completed", "delivered"].includes(j.state)).length;

    return Response.json({
      queue_depth: queueDepth,
      jobs_by_state: byState,
      failed_jobs: failedJobs,
      completed_jobs: completedJobs,
      avg_delivery_sec: avgDeliverySec,
      step_metrics: stepMetrics,
      job_costs: jobCosts.slice(0, 50),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});