import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Download, Play } from 'lucide-react';

export default function RenderProgress() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [steps, setSteps] = useState([]);
  const [renders, setRenders] = useState([]);

  const load = async () => {
    const [j, s, r] = await Promise.all([
      base44.entities.Job.get(jobId),
      base44.entities.JobStep.filter({ job_id: jobId }),
      base44.entities.Render.filter({ job_id: jobId }),
    ]);
    setJob(j);
    setSteps(s);
    setRenders(r);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (!job) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const stepIcon = (st) => st === 'succeeded' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
    : st === 'failed' ? <XCircle className="w-4 h-4 text-red-600" />
    : st === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
    : <div className="w-4 h-4 rounded-full border-2 border-muted" />;

  return (
    <div>
      <PageHeader title="מעקב הפקה" subtitle={`Job ${job.id.slice(0, 8)} · ${job.video_type}`} actions={<StatusBadge status={job.state} />} />
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">התקדמות</span>
            <span className="text-sm text-muted-foreground">{job.progress_pct || 0}%</span>
          </div>
          <Progress value={job.progress_pct || 0} />
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold">שלבי ה-pipeline</div>
          <div className="divide-y">
            {steps.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">השלבים נוצרים...</div>
            ) : steps.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                {stepIcon(s.status)}
                <span className="text-sm font-medium flex-1">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.provider}{s.attempt > 1 ? ` · ניסיון ${s.attempt}` : ''}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold">תוצרים</div>
          <div className="divide-y">
            {renders.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">הרינדור יתחיל כשכל הנכסים יהיו מוכנים</div>
            ) : renders.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <Play className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium flex-1">{r.aspect_ratio}</span>
                <StatusBadge status={r.status} />
                {r.url && r.status === 'completed' && (
                  <a href={r.url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1"><Download className="w-3.5 h-3.5" /> MP4</Button></a>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}