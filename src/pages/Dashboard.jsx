import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MessageSquarePlus, Film, Clock, Wallet, Loader2 } from 'lucide-react';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [p, j, l] = await Promise.all([
        base44.entities.Project.list('-created_date', 50),
        base44.entities.Job.list('-created_date', 50),
        base44.entities.CreditLedger.list('-created_date', 200),
      ]);
      setProjects(p);
      setJobs(j);
      setLedger(l);
      setLoading(false);
    })();
  }, []);

  const activeJobs = jobs.filter(j => !['completed', 'failed', 'refunded', 'delivered'].includes(j.state));
  const heldCredits = ledger.filter(l => l.type === 'hold').reduce((s, l) => s + l.credits, 0)
    + ledger.filter(l => l.type === 'refund').reduce((s, l) => s + l.credits, 0);
  const capturedCredits = ledger.filter(l => l.type === 'capture').reduce((s, l) => s + l.credits, 0);

  const stats = [
    { label: 'פרויקטים', value: projects.length, icon: Film },
    { label: 'הפקות פעילות', value: activeJobs.length, icon: Clock },
    { label: 'קרדיטים מוחזקים', value: heldCredits, icon: Wallet },
    { label: 'קרדיטים שנצברו', value: capturedCredits, icon: Wallet },
  ];

  return (
    <div>
      <PageHeader
        title="דאשבורד"
        subtitle="הפקות פעילות, תקציב וסטטוסים"
        actions={
          <Link to="/new"><Button className="gap-2"><MessageSquarePlus className="w-4 h-4" /> סרטון חדש</Button></Link>
        }
      />
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map((s) => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{s.label}</span>
                    <s.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-3xl font-bold font-display mt-2">{s.value}</div>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b font-semibold">פרויקטים אחרונים</div>
              {projects.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                  אין עדיין פרויקטים. <Link to="/new" className="text-primary underline">צרו סרטון ראשון</Link>
                </div>
              ) : (
                <div className="divide-y">
                  {projects.map((p) => (
                    <Link key={p.id} to={`/project/${p.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-accent transition-colors">
                      <div>
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.vertical || 'ללא ורטיקל'}{p.credits_estimate ? ` · ${p.credits_estimate} קרדיטים` : ''}</div>
                      </div>
                      <StatusBadge status={p.status} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}