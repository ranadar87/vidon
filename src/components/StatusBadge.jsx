import React from 'react';
import { Badge } from '@/components/ui/badge';

const MAP = {
  draft: { label: 'טיוטה', cls: 'bg-secondary text-secondary-foreground' },
  briefing: { label: 'בריף', cls: 'bg-blue-100 text-blue-700' },
  approved: { label: 'אושר', cls: 'bg-indigo-100 text-indigo-700' },
  generating: { label: 'מפיק נכסים', cls: 'bg-amber-100 text-amber-700' },
  generating_assets: { label: 'מפיק נכסים', cls: 'bg-amber-100 text-amber-700' },
  rendering: { label: 'מרנדר', cls: 'bg-purple-100 text-purple-700' },
  review: { label: 'בתצוגה מקדימה', cls: 'bg-cyan-100 text-cyan-700' },
  delivered: { label: 'נמסר', cls: 'bg-green-100 text-green-700' },
  completed: { label: 'הושלם', cls: 'bg-green-100 text-green-700' },
  failed: { label: 'נכשל', cls: 'bg-red-100 text-red-700' },
  refunded: { label: 'הוחזר', cls: 'bg-red-100 text-red-700' },
};

export default function StatusBadge({ status }) {
  const s = MAP[status] || { label: status, cls: 'bg-secondary text-secondary-foreground' };
  return <Badge className={`${s.cls} border-0 font-medium`}>{s.label}</Badge>;
}