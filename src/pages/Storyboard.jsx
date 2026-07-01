import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Film, PlayCircle, Mic2, Music, Clock } from 'lucide-react';

// Preview לפני רינדור — ה-UX עם התשואה הגבוהה ביותר.
// מציג את רצף הסצנות (תמונות שנוצרו + טקסט + תזמון) לפני ההתחייבות לרינדור המלא.
export default function Storyboard() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [job, setJob] = useState(null);
  const [brief, setBrief] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);

  const load = async () => {
    const j = await base44.entities.Job.get(jobId);
    const [b, a] = await Promise.all([
      base44.entities.Brief.get(j.brief_id),
      base44.entities.Asset.filter({ job_id: jobId }),
    ]);
    setJob(j);
    setBrief(b);
    setAssets(a);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [jobId]);

  const approveRender = async () => {
    setRendering(true);
    try {
      await base44.functions.invoke('orchestratorTick', { job_id: jobId, action: 'approve_render' });
      toast({ title: 'הרינדור החל', description: 'שולח את הסטוריבורד לרינדור המלא.' });
      navigate(`/render/${jobId}`);
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
      setRendering(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!job || !brief) return <div className="p-10 text-center text-muted-foreground">לא נמצא</div>;

  const j = brief.json || {};
  const scenes = j.scenes || [];
  const stillFor = (sceneId) => assets.find(a => a.scene_id === sceneId && ['still', 'avatar_clip', 'video_clip', 'broll'].includes(a.type));
  const hasVoiceover = !!assets.find(a => a.type === 'voiceover');
  const hasMusic = !!assets.find(a => a.type === 'music_track');
  const inReview = job.state === 'review';
  const totalDuration = scenes.reduce((s, sc) => s + (sc.durationSec || 4), 0);

  return (
    <div>
      <PageHeader
        title="תצוגה מקדימה — Storyboard"
        subtitle={`${scenes.length} סצנות · ${totalDuration}ש׳`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={job.state} />
            {inReview && (
              <Button onClick={approveRender} disabled={rendering} className="gap-2">
                {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                אשר ושגר לרינדור
              </Button>
            )}
          </div>
        }
      />
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        {!inReview && (
          <Card className="p-4 bg-amber-50 border-amber-200 text-amber-800 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> הנכסים עדיין נוצרים ({job.progress_pct || 0}%) — הסטוריבורד יתעדכן אוטומטית.
          </Card>
        )}

        {/* פס מטא — קריינות / מוזיקה / משך */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 flex items-center gap-2 text-sm">
            <Mic2 className={`w-4 h-4 ${hasVoiceover ? 'text-green-600' : 'text-muted-foreground'}`} />
            {j.voiceover?.enabled ? (hasVoiceover ? 'קריינות מוכנה' : 'קריינות בהכנה') : 'ללא קריינות'}
          </Card>
          <Card className="p-3 flex items-center gap-2 text-sm">
            <Music className={`w-4 h-4 ${hasMusic ? 'text-green-600' : 'text-muted-foreground'}`} />
            {j.music?.enabled ? (hasMusic ? 'מוזיקה מוכנה' : 'מוזיקה בהכנה') : 'ללא מוזיקה'}
          </Card>
          <Card className="p-3 flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground" /> {totalDuration} שניות
          </Card>
        </div>

        {/* רצף הסצנות */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {scenes.map((s, idx) => {
            const still = stillFor(s.id);
            const text = s.onScreenText?.[0]?.text || s.script || '';
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="aspect-[9/16] bg-secondary relative flex items-center justify-center">
                  {still?.url ? (
                    <img src={still.url} alt={s.id} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-xs">נוצר...</span>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                    {idx + 1} · {s.durationSec || 4}ש׳
                  </div>
                  {text && (
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                      <p className="text-white text-xs font-medium line-clamp-2 text-center">{text}</p>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {scenes.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Film className="w-8 h-8" /> אין סצנות בבריף.
          </Card>
        )}
      </div>
    </div>
  );
}