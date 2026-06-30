import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Server } from 'lucide-react';

export default function RenderServiceCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const runCheck = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('checkRenderService', {});
      setResult(res.data);
    } catch (err) {
      setResult({ ok: false, message: 'שגיאה בהרצת הבדיקה: ' + err.message });
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="w-4 h-4" />
          שירות הרינדור (Remotion)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={runCheck} disabled={loading} variant="outline" className="w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'בודק...' : 'בדיקת חיבור לשירות הרינדור'}
        </Button>

        {result && (
          <div
            className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
              result.ok
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {result.ok ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p>{result.message}</p>
              {result.url && (
                <p className="text-xs opacity-70 break-all" dir="ltr">
                  {result.url}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}