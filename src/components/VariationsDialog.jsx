import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Sparkles, Type, Megaphone, Palette, Mic2 } from 'lucide-react';

const AXES = [
  { id: 'hook', label: 'הוק (פתיח)', desc: 'משפט פתיחה שונה לכל וריאציה — הזווית שמשנה הכי הרבה בביצועים', icon: Type },
  { id: 'cta', label: 'CTA', desc: 'קריאה-לפעולה שונה בכל גרסה', icon: Megaphone },
  { id: 'visual', label: 'סגנון חזותי', desc: 'אותו טקסט, סגנון תמונות שונה', icon: Palette },
  { id: 'voice', label: 'קול', desc: 'אותו בריף, קול קריינות שונה (דורש 2+ קולות מאושרים)', icon: Mic2 },
];

// מנוע וריאציות A/B — מבריף מאושר מייצרים N גרסאות לבדיקה.
export default function VariationsDialog({ open, onOpenChange, briefId, onCreated }) {
  const { toast } = useToast();
  const [axis, setAxis] = useState('hook');
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('generateVariations', { brief_id: briefId, axis, count });
      const data = res.data || res;
      if (data.error) {
        toast({ title: 'יצירת הווריאציות נכשלה', description: data.error, variant: 'destructive' });
      } else {
        toast({ title: `${data.count} וריאציות נוצרו`, description: 'כל וריאציה רצה כהפקה נפרדת. עוקבים בפרויקט.' });
        onOpenChange(false);
        onCreated?.(data.variations);
      }
    } catch (e) {
      toast({ title: 'שגיאה', description: e.message, variant: 'destructive' });
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5" /> ייצר וריאציות A/B</DialogTitle>
          <DialogDescription>מבריף זה נייצר מספר גרסאות לבדיקה — כל אחת רצה כהפקה נפרדת דרך אותו pipeline.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-2 block">ציר הווריאציה</Label>
            <div className="grid grid-cols-2 gap-2">
              {AXES.map((a) => {
                const Icon = a.icon;
                const active = axis === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAxis(a.id)}
                    className={`text-right p-3 rounded-lg border transition-colors ${active ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'}`}
                  >
                    <div className="flex items-center gap-2 font-medium text-sm mb-0.5"><Icon className="w-4 h-4" /> {a.label}</div>
                    <p className="text-xs text-muted-foreground leading-tight">{a.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">מספר וריאציות</Label>
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`w-10 h-10 rounded-lg border font-medium text-sm transition-colors ${count === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">שים לב: כל וריאציה מקפיאה קרדיטים בנפרד.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>ביטול</Button>
          <Button onClick={generate} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            ייצר {count} וריאציות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}