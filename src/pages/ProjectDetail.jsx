import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useParams, Link } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import StatusBadge from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Activity } from 'lucide-react';

export default function ProjectDetail() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [brief, setBrief] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [variationLabels, setVariationLabels] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const p = await base44.entities.Project.get(projectId);
      setProject(p);
      if (p.current_brief_id) setBrief(await base44.entities.Brief.get(p.current_brief_id).catch(() => null));
      const js = await base44.entities.Job.filter({ project_id: projectId }, '-created_date');
      setJobs(js);
      // תוויות וריאציה מתוך הבריפים (job → brief.json.variation)
      const briefs = await base44.entities.Brief.filter({ project_id: projectId });
      const map = {};
      briefs.forEach(b => { if (b.json?.variation) map[b.id] = b.json.variation; });
      setVariationLabels(map);
      setLoading(false);
    })();
  }, [projectId]);

  // review → storyboard; אחרת → מסך ההפקה
  const jobLink = (j) => (j.state === 'review' ? `/storyboard/${j.id}` : `/render/${j.id}`);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!project) return <div className="p-10 text-center text-muted-foreground">הפרויקט לא נמצא</div>;

  return (
    <div>
      <PageHeader title={project.title} subtitle={project.vertical || 'ללא ורטיקל'} actions={<StatusBadge status={project.status} />} />
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-2">פרטים</h3>
          <p className="text-sm text-muted-foreground">{project.goal || 'אין מטרה מוגדרת'}</p>
          {project.credits_estimate ? <p className="text-sm mt-2">הערכת קרדיטים: <b>{project.credits_estimate}</b></p> : null}
        </Card>

        {brief && (
          <Card className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="font-medium text-sm">בריף v{brief.version}</div>
                <div className="text-xs text-muted-foreground">{brief.status === 'approved' ? 'מאושר' : 'טיוטה'}</div>
              </div>
            </div>
            <Link to={`/brief/${brief.id}`}><Button variant="outline" size="sm">פתח בריף</Button></Link>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b font-semibold">הפקות</div>
          {jobs.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">אין הפקות עדיין</div> : (
            <div className="divide-y">
              {jobs.map((j) => {
                const v = variationLabels[j.brief_id];
                return (
                  <Link key={j.id} to={jobLink(j)} className="flex items-center gap-3 px-5 py-3 hover:bg-accent">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm flex-1">
                      {j.video_type} · {j.progress_pct || 0}%
                      {v && <span className="text-xs text-muted-foreground mr-2">· {v.axis}: {v.value}</span>}
                    </span>
                    <StatusBadge status={j.state} />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}