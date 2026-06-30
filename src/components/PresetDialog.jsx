import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';

const VIDEO_TYPES = ['image_motion', 'ugc_avatar', 'generative_scenes', 'hybrid'];
const RATIOS = ['9:16', '1:1', '4:5', '16:9'];

// תבנית-בריף חלקית הנטענת אוטומטית בצ׳אט לפי הוורטיקל. נשמרת ב-Preset.brief_template.
export default function PresetDialog({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', vertical: '', description: '',
    videoType: 'image_motion', durationSec: 30,
    aspectRatios: ['9:16', '1:1', '16:9'],
    hook: '', cta: '', mood: 'upbeat', captions: true, voiceover: false,
  });

  const toggleRatio = (r) =>
    setForm((f) => ({ ...f, aspectRatios: f.aspectRatios.includes(r) ? f.aspectRatios.filter((x) => x !== r) : [...f.aspectRatios, r] }));

  const save = async () => {
    setSaving(true);
    const accounts = await base44.entities.Account.list();
    const brief_template = {
      project: { vertical: form.vertical, language: 'he' },
      format: { videoType: form.videoType, durationSec: Number(form.durationSec), aspectRatios: form.aspectRatios },
      script: { hook: form.hook, cta: form.cta },
      captions: { enabled: form.captions, source: 'scribe' },
      music: { enabled: true, source: 'library', mood: form.mood, ducking: true },
      ...(form.voiceover ? { voiceover: { enabled: true, provider: 'elevenlabs' } } : {}),
    };
    await base44.entities.Preset.create({
      account_id: accounts[0]?.id,
      vertical: form.vertical,
      name: form.name,
      description: form.description,
      brief_template,
    });
    setSaving(false);
    setOpen(false);
    setForm({ name: '', vertical: '', description: '', videoType: 'image_motion', durationSec: 30, aspectRatios: ['9:16', '1:1', '16:9'], hook: '', cta: '', mood: 'upbeat', captions: true, voiceover: false });
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> preset חדש</Button></DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader><DialogTitle>preset חדש לוורטיקל</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>שם ה-preset</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ניקוי מזגנים — לידים" /></div>
          <div><Label>ורטיקל (מזהה)</Label><Input value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} placeholder="ac_cleaning" /></div>
          <div><Label>תיאור</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>סוג סרטון</Label>
              <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={form.videoType} onChange={(e) => setForm({ ...form, videoType: e.target.value })}>
                {VIDEO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><Label>משך (ש׳)</Label><Input type="number" value={form.durationSec} onChange={(e) => setForm({ ...form, durationSec: e.target.value })} /></div>
          </div>
          <div>
            <Label>יחסי תצוגה</Label>
            <div className="flex gap-2 mt-1">
              {RATIOS.map((r) => (
                <button key={r} type="button" onClick={() => toggleRatio(r)}
                  className={`px-3 py-1.5 rounded-md border text-sm ${form.aspectRatios.includes(r) ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>{r}</button>
              ))}
            </div>
          </div>
          <div><Label>הוק</Label><Input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} /></div>
          <div><Label>CTA</Label><Input value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} /></div>
          <div><Label>מצב מוזיקה</Label><Input value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} placeholder="upbeat / calm / dramatic" /></div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.captions} onChange={(e) => setForm({ ...form, captions: e.target.checked })} /> כתוביות</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.voiceover} onChange={(e) => setForm({ ...form, voiceover: e.target.checked })} /> קריינות</label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!form.name || !form.vertical || saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}