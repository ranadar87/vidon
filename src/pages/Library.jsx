import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Film, Layers, Trash2 } from 'lucide-react';
import PresetDialog from '@/components/PresetDialog';

export default function Library() {
  const [renders, setRenders] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadPresets = async () => {
    setPresets(await base44.entities.Preset.list('-created_date', 100));
  };

  useEffect(() => {
    (async () => {
      const [r, p] = await Promise.all([
        base44.entities.Render.filter({ status: 'completed' }, '-created_date', 100),
        base44.entities.Preset.list('-created_date', 100),
      ]);
      setRenders(r);
      setPresets(p);
      setLoading(false);
    })();
  }, []);

  const deletePreset = async (id) => {
    await base44.entities.Preset.delete(id);
    loadPresets();
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <PageHeader title="ספרייה" subtitle="תוצרים ו-presets לפי ורטיקל" />
      <div className="p-6">
        <Tabs defaultValue="renders">
          <TabsList>
            <TabsTrigger value="renders" className="gap-2"><Film className="w-4 h-4" /> תוצרים</TabsTrigger>
            <TabsTrigger value="presets" className="gap-2"><Layers className="w-4 h-4" /> Presets</TabsTrigger>
          </TabsList>
          <TabsContent value="renders" className="mt-4">
            {renders.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">אין עדיין תוצרים מוגמרים</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {renders.map((r) => (
                  <Card key={r.id} className="overflow-hidden">
                    <div className="aspect-video bg-muted flex items-center justify-center">
                      {r.url ? <video src={r.url} controls className="w-full h-full object-cover" /> : <Film className="w-8 h-8 text-muted-foreground" />}
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <Badge variant="secondary">{r.aspect_ratio}</Badge>
                      <StatusBadge status={r.status} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="presets" className="mt-4 space-y-4">
            <div className="flex justify-end"><PresetDialog onSaved={loadPresets} /></div>
            {presets.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">אין עדיין presets — צרו את הראשון</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {presets.map((p) => (
                  <Card key={p.id} className="p-4 group relative">
                    <div className="font-medium">{p.name}</div>
                    <Badge variant="secondary" className="mt-1">{p.vertical}</Badge>
                    {p.description && <p className="text-xs text-muted-foreground mt-2">{p.description}</p>}
                    <div className="text-[11px] text-muted-foreground mt-2">
                      {p.brief_template?.format?.videoType} · {p.brief_template?.format?.durationSec}ש׳ · {(p.brief_template?.format?.aspectRatios || []).join(', ')}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => deletePreset(p.id)}
                      className="absolute top-2 left-2 h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}