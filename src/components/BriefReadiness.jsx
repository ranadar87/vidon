import React from 'react';
import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

// בודק אילו שדות חובה חסרים בבריף לפני אישור (משקף את הוולידציה בשרת approveBrief).
export function getMissingFields(j = {}) {
  const missing = [];
  if (!j.project?.goal) missing.push('מטרת הסרטון');
  if (!j.project?.brand?.name) missing.push('שם המותג');
  if ((j.project?.brand?.colors || []).length !== 4) missing.push('4 צבעי מותג');
  if (!j.format?.videoType) missing.push('סוג הסרטון');
  if (!(j.format?.durationSec >= 5 && j.format?.durationSec <= 120)) missing.push('משך תקין (5-120ש׳)');
  if (!(j.format?.aspectRatios?.length >= 1)) missing.push('יחס תצוגה');
  if (!j.script?.hook || !j.script?.cta) missing.push('הוק וקריאה לפעולה');
  if (!(j.scenes?.length >= 1)) missing.push('לפחות סצנה אחת');
  if (!j.cost || j.cost.credits == null) missing.push('תמחור הבריף');
  return missing;
}

export default function BriefReadiness({ missing }) {
  if (!missing?.length) return null;
  return (
    <Card className="p-4 bg-amber-50 border-amber-200 text-amber-800 text-sm">
      <div className="flex items-center gap-2 font-semibold mb-1.5">
        <AlertTriangle className="w-4 h-4" /> הבריף עדיין לא מוכן לאישור
      </div>
      <p className="text-xs mb-2">כדי לאשר ולהפיק, יש להשלים את הפרטים הבאים בצ׳אט הבריף:</p>
      <ul className="list-disc pr-5 space-y-0.5 text-xs">
        {missing.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </Card>
  );
}