import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

export default function Settings() {
  const [configs, setConfigs] = useState([]);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    const [c, a] = await Promise.all([
      base44.entities.ProviderConfig.list(),
      base44.entities.Account.list(),
    ]);
    setConfigs(c);
    setAccount(a[0]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateRate = async (cfg, rate) => {
    await base44.entities.ProviderConfig.update(cfg.id, { rate_usd: parseFloat(rate) || 0 });
  };
  const toggleEnabled = async (cfg) => {
    await base44.entities.ProviderConfig.update(cfg.id, { enabled: !cfg.enabled });
    load();
  };
  const updateMarkup = async (val) => {
    if (!account) return;
    await base44.entities.Account.update(account.id, { default_markup: parseFloat(val) || 1 });
    toast({ title: 'נשמר', description: `markup עודכן ל-×${val}` });
  };

  const capLabel = { image: 'תמונה', tts: 'קריינות', avatar: 'אווטאר', captions: 'כתוביות', music: 'מוזיקה', text_to_video: 'וידאו גנרטיבי', render: 'רינדור' };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <PageHeader title="הגדרות" subtitle="ספקים, שיעורי עלות, markup ומכסות" />
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <Card className="p-5">
          <h3 className="font-semibold mb-3">תמחור</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Markup (×)</span>
            <Input type="number" step="0.5" min="1" defaultValue={account?.default_markup ?? 5} onBlur={(e) => updateMarkup(e.target.value)} className="w-28" />
            <span className="text-xs text-muted-foreground">1 = עלות נטו · 4-10 = סימולציית לקוח</span>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold">ספקים ושיעורי עלות (USD)</div>
          <div className="divide-y">
            {configs.map((cfg) => (
              <div key={cfg.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{cfg.provider}</div>
                  <Badge variant="secondary" className="mt-0.5 text-[11px]">{capLabel[cfg.capability] || cfg.capability}{cfg.is_default ? ' · ברירת מחדל' : ''}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input type="number" step="0.01" defaultValue={cfg.rate_usd} onBlur={(e) => updateRate(cfg, e.target.value)} className="w-24 h-8" />
                  <span className="text-[11px] text-muted-foreground w-20">{cfg.rate_unit}</span>
                </div>
                <Switch checked={cfg.enabled} onCheckedChange={() => toggleEnabled(cfg)} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}