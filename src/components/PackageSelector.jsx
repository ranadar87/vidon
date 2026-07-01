import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Coins, Check, Film, ImagePlay, Sparkles, User } from 'lucide-react';

const STRATEGY_ICON = {
  image_motion: ImagePlay,
  image_to_video: Film,
  text_to_video: Sparkles,
  avatar: User,
};

const TIER_ACCENT = {
  economy: 'border-emerald-500/40',
  standard: 'border-primary/50',
  premium: 'border-amber-500/50',
};

// בורר חבילות איכות — עד 3 אפשרויות מהזול ליקר. הלקוח בוחר אחת.
export default function PackageSelector({ packages, selected, onSelect }) {
  if (!Array.isArray(packages) || packages.length === 0) return null;

  return (
    <div dir="rtl">
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        בחרו רמת הפקה — {packages.length} אפשרויות מהזול לאיכותי
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${packages.length}, minmax(0, 1fr))` }}>
        {packages.map((p) => {
          const Icon = STRATEGY_ICON[p.strategy] || Film;
          const isSel = selected === p.tier;
          return (
            <button
              key={p.tier}
              onClick={() => onSelect(p)}
              className={`relative text-right rounded-xl border-2 p-3 transition-all ${
                isSel ? `${TIER_ACCENT[p.tier] || 'border-primary'} bg-accent shadow-sm` : 'border-border hover:border-primary/30 bg-card'
              }`}
            >
              {isSel && (
                <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              {p.tier === 'standard' && (
                <Badge className="absolute -top-2 right-3 text-[10px] px-1.5 py-0">מומלץ</Badge>
              )}
              <Icon className="w-5 h-5 text-muted-foreground mb-1.5" />
              <div className="font-display font-bold text-sm">{p.tier_label}</div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 min-h-[28px]">
                {p.strategy_label}
              </div>
              <div className="flex items-center gap-1 mt-2 text-primary font-bold">
                <Coins className="w-3.5 h-3.5" />
                <span>{p.credits}</span>
                <span className="text-[10px] font-normal text-muted-foreground">קרדיטים</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}