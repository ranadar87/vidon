import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Loader2, Activity, AlertTriangle, CheckCircle2, Clock, Layers } from 'lucide-react';

const STATE_LABEL = {
  draft: 'טיוטה', briefing: 'תדרוך', approved: 'מאושר', generating_assets: 'יצירת נכסים',
  rendering: 'רינדור', review: 'בדיקה', delivered: 'נמסר', completed: 'הושלם',
  failed: 'נכשל', refunded: 'הוחזר',
};

function fmtDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)} ש׳`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}ד ${s}ש׳`;
}

export default function Observability() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const res = await base44.functions.invoke('observabilityMetrics', {});
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || 'שגיאה בטעינת המטריקות');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // רענון אוטומטי כל 15 שניות
    return () => clearInterval(t);
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (error) {
    return (
      <div>
        <PageHeader title="ניטור תפעולי" subtitle="מטריקות pipeline בזמן אמת" />
        <div className="p-6">
          <Card className="p-10 text-center text-sm text-muted-foreground">{error}</Card>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'עומק תור (jobs פעילים)', value: data.queue_depth, icon: Layers },
    { label: 'הושלמו', value: data.completed_jobs, icon: CheckCircle2 },
    { label: 'נכשלו', value: data.failed_jobs, icon: AlertTriangle },
    { label: 'זמן מסירה ממוצע', value: fmtDuration(data.avg_delivery_sec), icon: Clock },
  ];

  return (
    <div>
      <PageHeader title="ניטור תפעולי" subtitle="מטריקות pipeline בזמן אמת · רענון כל 15 שניות" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <s.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold font-display mt-2">{s.value}</div>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" /> ביצועי שלבים (משך · שיעור כשל)
          </div>
          {data.step_metrics.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">אין עדיין נתוני שלבים</div>
          ) : (
            <div className="divide-y">
              {data.step_metrics.map((m) => (
                <div key={m.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="font-medium w-28">{m.name}</span>
                  <span className="text-muted-foreground flex-1">
                    {m.succeeded}/{m.total} הצליחו · {m.running} רצים · {m.pending} ממתינים
                  </span>
                  <span className="text-muted-foreground w-24">⌀ {fmtDuration(m.avg_duration_sec)}</span>
                  <span className={`font-semibold w-16 text-left ${m.failure_rate > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {(m.failure_rate * 100).toFixed(0)}% כשל
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold">jobs לפי מצב</div>
            <div className="divide-y">
              {Object.entries(data.jobs_by_state).map(([state, count]) => (
                <div key={state} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{STATE_LABEL[state] || state}</span>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
              {Object.keys(data.jobs_by_state).length === 0 && (
                <div className="p-10 text-center text-muted-foreground text-sm">אין jobs</div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b font-semibold">עלות API per job</div>
            {data.job_costs.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">אין נתונים</div>
            ) : (
              <div className="divide-y">
                {data.job_costs.map((j) => (
                  <div key={j.job_id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{j.job_id.slice(-6)}</span>
                    <span className="text-muted-foreground flex-1">{j.video_type || '—'} · {STATE_LABEL[j.state] || j.state}</span>
                    <span className="font-semibold">${j.cost_usd.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}