import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Loader2, TrendingUp, Wallet, Receipt } from 'lucide-react';

export default function Budget() {
  const [ledger, setLedger] = useState([]);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [l, c] = await Promise.all([
        base44.entities.CreditLedger.list('-created_date', 500),
        base44.entities.ApiCostLog.list('-created_date', 500),
      ]);
      setLedger(l);
      setCosts(c);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const captured = ledger.filter(l => l.type === 'capture').reduce((s, l) => s + l.credits, 0);
  const held = ledger.filter(l => l.type === 'hold').reduce((s, l) => s + l.credits, 0)
    + ledger.filter(l => l.type === 'refund').reduce((s, l) => s + l.credits, 0);
  const apiCostUsd = costs.reduce((s, c) => s + (c.cost_usd || 0), 0);
  const revenueIls = captured * 0.15;
  const apiCostIls = apiCostUsd * 3.7;
  const margin = revenueIls - apiCostIls;

  const stats = [
    { label: 'קרדיטים מוחזקים (hold פתוח)', value: held, icon: Wallet },
    { label: 'קרדיטים שנצברו (capture)', value: captured, icon: Receipt },
    { label: 'עלות API בפועל', value: `$${apiCostUsd.toFixed(2)}`, icon: Receipt },
    { label: 'מרווח משוער (₪)', value: `₪${margin.toFixed(2)}`, icon: TrendingUp },
  ];

  const typeLabel = { hold: 'הקפאה', capture: 'חיוב', refund: 'החזר', adjustment: 'התאמה' };

  return (
    <div>
      <PageHeader title="תקציב וקרדיטים" subtitle="מעקב עלות ומרווח מול ApiCostLog" />
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
          <div className="px-5 py-3 border-b font-semibold">תנועות קרדיט (append-only)</div>
          {ledger.length === 0 ? <div className="p-10 text-center text-muted-foreground text-sm">אין עדיין תנועות</div> : (
            <div className="divide-y">
              {ledger.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${l.credits < 0 ? 'bg-green-100 text-green-700' : 'bg-accent'}`}>{typeLabel[l.type] || l.type}</span>
                  <span className="text-sm flex-1 text-muted-foreground">{l.note}</span>
                  <span className={`text-sm font-semibold ${l.credits < 0 ? 'text-green-600' : ''}`}>{l.credits > 0 ? '+' : ''}{l.credits}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}