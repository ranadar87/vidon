import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle2, Film, Mic2, Music, Type } from 'lucide-react';

export default function BriefEditor() {
  const { briefId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    (async () => {
      const b = await base44.entities.Brief.get(briefId);
      setBrief(b);
      setLoading(false);
    })();
  }, [briefId]);

  const approve = async () => {
    setApproving(true);
    try {
      const res = await base44.functions.invoke('approveBrief', { brief_id: briefId });
      if (res.data.error) {
        toast({ title: 'האישור נכשל', description: (res.data.details || [res.data.error]).join(', '), variant: 'destructive' });
      } else {
        toast({ title: 'הבריף אושר', description: `${res.data.credits_held} קרדיטים הוקפאו. ההפקה החלה.` });
        navigate(`/render/${res.data.job.id}`);
      }
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
    }
    setApproving(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!brief) return <div className="p-10 text-center text-muted-foreground">הבריף לא נמצא</div>;

  const j = brief.json || {};
  const approved = brief.status === 'approved';

  return (
    <div>
      <PageHeader
        title="עריכת בריף"
        subtitle={`גרסה ${brief.version} · ${j.format?.videoType || ''}`}
        actions={
          !approved && (
            <Button onClick={approve} disabled={approving} className="gap-2">
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              אשר והפק ({j.cost?.credits} קרדיטים)
            </Button>
          )
        }
      />
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        {approved && (
          <Card className="p-4 bg-green-50 border-green-200 text-green-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> הבריף אושר ונעול (immutable).
          </Card>
        )}

        <Card className="p-5">
          <h3 className="font-semibold mb-3">פרויקט</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">מטרה</dt><dd>{j.project?.goal || '—'}</dd></div>
            <div><dt className="text-muted-foreground">קהל</dt><dd>{j.project?.audience || '—'}</dd></div>
            <div><dt className="text-muted-foreground">ורטיקל</dt><dd>{j.project?.vertical || '—'}</dd></div>
            <div><dt className="text-muted-foreground">משך</dt><dd>{j.format?.durationSec}ש׳ · {(j.format?.aspectRatios || []).join(', ')}</dd></div>
          </dl>
          {j.project?.brand?.colors && (
            <div className="flex gap-2 mt-3">
              {j.project.brand.colors.map((c, i) => <div key={i} className="w-7 h-7 rounded-md border" style={{ backgroundColor: c }} title={c} />)}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Type className="w-4 h-4" /> סקריפט</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">הוק: </span>{j.script?.hook}</p>
            {(j.script?.body || []).map((b, i) => <p key={i} className="text-muted-foreground">• {b}</p>)}
            <p><span className="text-muted-foreground">CTA: </span>{j.script?.cta}</p>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Film className="w-4 h-4" /> סצנות ({(j.scenes || []).length})</h3>
          <div className="space-y-3">
            {(j.scenes || []).map((s) => (
              <div key={s.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{s.id} · {s.durationSec}ש׳</span>
                  <Badge variant="secondary">{s.visual?.source} · {s.visual?.motion || 'static'}</Badge>
                </div>
                {(s.onScreenText || []).map((t, i) => <p key={i} className="text-xs text-muted-foreground">טקסט: "{t.text}" ({t.sizePx}px)</p>)}
                {s.voiceoverText && <p className="text-xs text-muted-foreground">קריינות: {s.voiceoverText}</p>}
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-2 flex items-center gap-2"><Mic2 className="w-4 h-4" /> קריינות</h3>
            <p className="text-sm text-muted-foreground">{j.voiceover?.enabled ? `מופעל · ${j.voiceover.voiceId}` : 'כתוביות בלבד'}</p>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold mb-2 flex items-center gap-2"><Music className="w-4 h-4" /> מוזיקה</h3>
            <p className="text-sm text-muted-foreground">{j.music?.enabled ? `${j.music.mood} · ${j.music.source}` : 'ללא'}</p>
          </Card>
        </div>

        {j.cost && (
          <Card className="p-5 bg-accent">
            <div className="flex items-center justify-between">
              <span className="font-semibold">עלות</span>
              <span className="text-2xl font-bold font-display">{j.cost.credits} קרדיטים</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">${j.cost.totalApiCost?.toFixed(2)} API · markup ×{j.cost.markup}</div>
          </Card>
        )}
      </div>
    </div>
  );
}