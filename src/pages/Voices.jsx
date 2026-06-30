import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Mic2, Play } from 'lucide-react';

export default function Voices() {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const v = await base44.entities.Voice.list('-created_date', 100);
    setVoices(v);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleQa = async (voice) => {
    await base44.entities.Voice.update(voice.id, { qa_passed: !voice.qa_passed });
    load();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <PageHeader title="ספריית קולות" subtitle="רק קולות מאושרי-QA נחשפים בצ׳אט" />
      <div className="p-6">
        <Card className="overflow-hidden">
          <div className="divide-y">
            {voices.map((v) => (
              <div key={v.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center"><Mic2 className="w-5 h-5 text-muted-foreground" /></div>
                <div className="flex-1">
                  <div className="font-medium">{v.label}</div>
                  <div className="text-xs text-muted-foreground">{v.gender === 'male' ? 'גבר' : v.gender === 'female' ? 'אישה' : 'ניטרלי'} · {v.style} · {v.voice_id}</div>
                </div>
                {v.sample_url && <a href={v.sample_url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" className="gap-1"><Play className="w-3.5 h-3.5" /></Button></a>}
                <Badge className={v.qa_passed ? 'bg-green-100 text-green-700 border-0' : 'bg-secondary text-secondary-foreground border-0'}>
                  {v.qa_passed ? 'עבר QA' : 'ממתין ל-QA'}
                </Badge>
                <Switch checked={v.qa_passed} onCheckedChange={() => toggleQa(v)} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}