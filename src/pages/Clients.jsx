import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Building2 } from 'lucide-react';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', brand_name: '', colors: '#7C6CF7,#16C9A0,#F4B23C,#0A0A11', default_vertical: '' });

  const load = async () => {
    const c = await base44.entities.Client.list('-created_date', 100);
    setClients(c);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const accounts = await base44.entities.Account.list();
    await base44.entities.Client.create({
      account_id: accounts[0]?.id,
      name: form.name,
      brand_name: form.brand_name || form.name,
      brand_colors: form.colors.split(',').map(s => s.trim()).filter(Boolean),
      default_vertical: form.default_vertical,
      status: 'active',
    });
    setOpen(false);
    setForm({ name: '', brand_name: '', colors: '#7C6CF7,#16C9A0,#F4B23C,#0A0A11', default_vertical: '' });
    load();
  };

  return (
    <div>
      <PageHeader
        title="לקוחות"
        subtitle="ברירות מחדל של מותג לכל לקוח"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> לקוח חדש</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>לקוח חדש</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>שם הלקוח</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>שם המותג</Label><Input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} /></div>
                <div><Label>צבעי מותג (4, מופרדים בפסיק)</Label><Input value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} /></div>
                <div><Label>ורטיקל ברירת מחדל</Label><Input value={form.default_vertical} onChange={(e) => setForm({ ...form, default_vertical: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!form.name}>שמור</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-6">
        {loading ? <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          : clients.length === 0 ? <div className="p-10 text-center text-muted-foreground text-sm">אין עדיין לקוחות</div>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clients.map((c) => (
                <Card key={c.id} className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center"><Building2 className="w-5 h-5 text-muted-foreground" /></div>
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.brand_name}{c.default_vertical ? ` · ${c.default_vertical}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-3">
                    {(c.brand_colors || []).map((col, i) => <div key={i} className="w-6 h-6 rounded border" style={{ backgroundColor: col }} title={col} />)}
                  </div>
                </Card>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}