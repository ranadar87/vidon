import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Film, Mic, Captions, Music, Layers, Sparkles, Check, Loader2,
  ArrowLeft, Image as ImageIcon, Clapperboard, Coins,
} from 'lucide-react';

const VIDEO_TYPE_LABELS = {
  image_motion: { label: 'תמונות בתנועה', desc: 'תמונות AI עם אנימציית מצלמה ומעברים — זול ומהיר, אידיאלי ל-lead-gen.' },
  ugc_avatar: { label: 'אווטאר מדבר (UGC)', desc: 'דמות AI מדברת בסגנון תוכן גולשים אותנטי.' },
  generative_scenes: { label: 'סצנות וידאו גנרטיביות', desc: 'קטעי וידאו שנוצרים במלואם ב-AI (Veo/Kling).' },
  hybrid: { label: 'משולב', desc: 'שילוב של תמונות בתנועה, אווטאר וקטעי וידאו.' },
};

const PROVIDER_LABELS = {
  nano_banana: 'Nano Banana (תמונות)',
  wavespeed: 'WaveSpeed (תמונות)',
  veo: 'Veo (וידאו)',
  kling: 'Kling (וידאו)',
  stock: 'סטוק',
  heygen: 'HeyGen (אווטאר)',
  elevenlabs: 'ElevenLabs (קריינות)',
  scribe: 'Scribe (כתוביות)',
  suno: 'Suno (מוזיקה)',
  remotion: 'Remotion (רינדור)',
  openrouter: 'OpenRouter (תמונות)',
};

const STRUCTURE_LABELS = {
  hook: 'הוק', problem: 'בעיה', solution: 'פתרון', proof: 'הוכחה',
  cta: 'קריאה לפעולה', message: 'מסר', emotion: 'רגש', result: 'תוצאה',
};

function sceneText(s) {
  if (Array.isArray(s.onScreenText)) return s.onScreenText[0]?.text || '';
  return typeof s.onScreenText === 'string' ? s.onScreenText : '';
}

export default function ProposalCard({ briefId, briefJson, pricing, recommendation }) {
  const navigate = useNavigate();
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const j = briefJson || {};
  const rec = recommendation || j.recommendation || {};
  const vt = j.format?.videoType || rec.videoType;
  const typeInfo = VIDEO_TYPE_LABELS[vt] || { label: vt || 'סרטון', desc: '' };
  const scenes = j.scenes || [];
  const providers = [...new Set((pricing?.breakdown || []).map((b) => b.provider).filter(Boolean))];

  const features = [];
  if (j.voiceover?.enabled) features.push({ icon: Mic, text: 'קריינות AI' });
  if (j.captions?.enabled) features.push({ icon: Captions, text: 'כתוביות מסונכרנות' });
  if (j.music?.enabled) features.push({ icon: Music, text: `מוזיקה (${j.music.mood || 'רקע'})` });
  const ratios = j.format?.aspectRatios || [];

  const approve = async () => {
    if (!briefId || approving) return;
    setApproving(true);
    setError('');
    try {
      const res = await base44.functions.invoke('approveBrief', { brief_id: briefId });
      const d = res.data;
      if (d.error) {
        setError(d.details ? `${d.error}: ${d.details.join(', ')}` : d.error);
        setApproving(false);
        return;
      }
      navigate(`/render/${d.job.id}`);
    } catch (e) {
      setError(e.message);
      setApproving(false);
    }
  };

  return (
    <Card className="p-5 space-y-5 border-primary/30" dir="rtl">
      {/* כותרת + סוג סרטון */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">הצעת הפקה</span>
        </div>
        <div className="flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-display font-bold text-lg">{typeInfo.label}</h3>
        </div>
        {typeInfo.desc && <p className="text-sm text-muted-foreground">{typeInfo.desc}</p>}
        {rec.reason && <p className="text-sm bg-accent rounded-lg p-2.5">{rec.reason}</p>}
      </div>

      {/* מבנה */}
      {Array.isArray(rec.structure) && rec.structure.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">מבנה הסרטון</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {rec.structure.map((step, i) => (
              <React.Fragment key={i}>
                <Badge variant="secondary">{STRUCTURE_LABELS[step] || step}</Badge>
                {i < rec.structure.length - 1 && <ArrowLeft className="w-3 h-3 text-muted-foreground" />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* מפרט טכני */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-muted-foreground" />
          <span>{j.format?.durationSec ? `${j.format.durationSec} שניות` : 'משך לא נקבע'}</span>
        </div>
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
          <span>{ratios.length ? ratios.join(', ') : 'יחס לא נקבע'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span>{scenes.length} סצנות</span>
        </div>
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-muted-foreground" />
          <span>{j.project?.brand?.name || 'ללא מותג'}</span>
        </div>
      </div>

      {/* פיצ'רים */}
      {features.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">פיצ׳רים</div>
          <div className="flex flex-wrap gap-1.5">
            {features.map((f, i) => (
              <Badge key={i} variant="outline" className="gap-1"><f.icon className="w-3 h-3" />{f.text}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* טכנולוגיות */}
      {providers.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">טכנולוגיות בהפקה</div>
          <div className="flex flex-wrap gap-1.5">
            {providers.map((p) => <Badge key={p} variant="secondary">{PROVIDER_LABELS[p] || p}</Badge>)}
          </div>
        </div>
      )}

      {/* הבריף המלא — סצנות */}
      {scenes.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">הבריף המלא — פירוט סצנות</div>
          <div className="space-y-2">
            {scenes.map((s, i) => (
              <div key={s.id || i} className="rounded-lg border bg-card p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">סצנה {i + 1}</span>
                  <span className="text-xs text-muted-foreground">{s.durationSec ? `${s.durationSec}ש׳` : ''} · {PROVIDER_LABELS[s.visual?.source] || s.visual?.source || 'ויזואל'}</span>
                </div>
                {sceneText(s) && <div className="font-medium">{sceneText(s)}</div>}
                {s.script && <div className="text-muted-foreground text-xs">קריינות/סקריפט: {s.script}</div>}
                {s.visual?.prompt && <div className="text-muted-foreground text-xs">ויזואל: {s.visual.prompt}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* עלות + פירוט */}
      {pricing && (
        <div className="rounded-lg bg-accent p-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">עלות כוללת</span>
            <span className="text-2xl font-bold font-display">{pricing.credits} קרדיטים</span>
          </div>
          <div className="text-xs text-muted-foreground">עלות API: ${pricing.totalApiCostUsd?.toFixed(2)} · markup ×{pricing.markup}</div>
          {Array.isArray(pricing.breakdown) && (
            <div className="space-y-0.5 pt-1 border-t border-border/50">
              {pricing.breakdown.filter((b) => b.cost > 0).map((b, i) => (
                <div key={i} className="flex justify-between text-xs text-muted-foreground">
                  <span>{b.step} · {PROVIDER_LABELS[b.provider] || b.provider}</span>
                  <span>${b.cost.toFixed(3)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-2.5">{error}</div>}

      {/* אישור */}
      <div className="flex gap-2">
        <Button className="flex-1 gap-2" onClick={approve} disabled={approving || !pricing}>
          {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {approving ? 'מאשר...' : 'אשר והתחל הפקה'}
        </Button>
        {briefId && (
          <Button variant="outline" onClick={() => navigate(`/brief/${briefId}`)}>עריכה מלאה</Button>
        )}
      </div>
    </Card>
  );
}