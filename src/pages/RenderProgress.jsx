import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Download, Play, RotateCcw } from 'lucide-react';

export default function RenderProgress() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [steps, setSteps] = useState([]);
  const [renders, setRenders] = useState([]);
  const [resuming, setResuming] = useState(false);

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

  // "נסה שוב" — מאתחל job שנכשל ומריץ רק שלבים שנפלו (שומר נכסים שהצליחו)
  const retry = async () => {
    setResuming(true);
    try {
      await base44.functions.invoke('orchestratorTick', { job_id: jobId, action: 'resume' });
      await load();
    } catch (e) {
      console.error('resume failed:', e);
    }
    setResuming(false);
  };

  if (!job) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const failed = job.state === 'failed';

  const stepIcon = (st) => st === 'succeeded' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
    : st === 'failed' ? <XCircle className="w-4 h-4 text-red-600" />
    : st === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
    : <div className="w-4 h-4 rounded-full border-2 border-muted" />;

  return (
    <div>
      <PageHeader
        title="מעקב הפקה"
        subtitle={`Job ${job.id.slice(0, 8)} · ${job.video_type}`}
        actions={
          <div className="flex items-center gap-2">
            {failed && (
              <Button size="sm" onClick={retry} disabled={resuming} className="gap-1">
                {resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                נסה שוב
              </Button>
            )}
            <StatusBadge status={job.state} />
          </div>
        }
      />
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        {failed && (
          <Card className="p-4 border-red-300 bg-red-50/50">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-red-700">ההפקה נכשלה</div>
                <div className="text-muted-foreground mt-0.5">
                  {job.error_message || 'אחד השלבים נכשל לאחר מספר ניסיונות. הקרדיטים שהוקפאו הוחזרו. "נסה שוב" יריץ מחדש רק את השלבים שנפלו וישמור את מה שכבר נוצר.'}
                </div>
              </div>
            </div>
          </Card>
        )}

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
                {s.status === 'failed' && s.error && (
                  <span className="text-xs text-red-500 truncate max-w-[40%]" title={s.error}>{s.error}</span>
                )}
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