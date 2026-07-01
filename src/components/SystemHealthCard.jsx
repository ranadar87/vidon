import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2, Zap } from 'lucide-react';

function StatusIcon({ configured, ok }) {
  if (!configured) return <AlertTriangle className="w-5 h-5 text-amber-500" />;
  if (ok) return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
  return <XCircle className="w-5 h-5 text-red-500" />;
}

export default function SystemHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('systemHealth', {});
      setData(res.data);
    } catch (e) {
      setError(e?.message || 'שגיאה בבדיקת המערכת');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  const summary = data?.summary;
  const allOk = summary?.all_ok;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold">חיבורי מערכת</span>
          {summary && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${allOk ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {summary.healthy}/{summary.total} תקינים
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={run} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          רענן
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="p-6 text-center text-sm text-red-600">{error}</div>
      ) : (
        <div className="divide-y">
          {data?.checks?.map((c) => (
            <div key={c.name} className="flex items-start justify-between px-5 py-3.5 gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <StatusIcon configured={c.configured} ok={c.ok} />
                <div className="min-w-0">
                  <div className="font-medium leading-tight">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.category}</div>
                  <div className={`text-xs mt-1 ${c.ok ? 'text-muted-foreground' : c.configured ? 'text-red-600' : 'text-amber-600'}`}>{c.message}</div>
                </div>
              </div>
              {c.latency_ms != null && (
                <span className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5">{c.latency_ms}ms</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}