import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Send, Loader2, Sparkles, ArrowLeft } from 'lucide-react';

export default function NewVideo() {
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [briefId, setBriefId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pricing, setPricing] = useState(null);
  const [readyForApproval, setReadyForApproval] = useState(false);
  const [title, setTitle] = useState('');
  const [vertical, setVertical] = useState('');
  const [presets, setPresets] = useState([]);
  const [started, setStarted] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);
  useEffect(() => { base44.entities.Preset.list('-created_date', 100).then(setPresets); }, []);

  const startProject = async () => {
    if (!title.trim()) return;
    const accounts = await base44.entities.Account.list();
    const p = await base44.entities.Project.create({
      account_id: accounts[0]?.id,
      title: title.trim(),
      vertical: vertical || undefined,
      status: 'draft',
    });
    setProject(p);
    setStarted(true);
    const presetNote = vertical ? ` טענתי את תבנית הוורטיקל "${vertical}" — נתחיל ממנה.` : '';
    setMessages([{ role: 'assistant', content: `שלום! ספרו לי מה המטרה השיווקית — לדוגמה: "אני רוצה לקדם ניקוי מזגנים בגוש דן ולהשיג לידים."${presetNote}` }]);
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);
    try {
      const res = await base44.functions.invoke('briefChat', {
        project_id: project.id,
        brief_id: briefId,
        message: userMsg.content,
        history: messages,
      });
      const d = res.data;
      if (d.error) {
        setMessages([...newMessages, { role: 'assistant', content: `אירעה שגיאה: ${d.error}` }]);
      } else {
        setBriefId(d.brief?.id);
        setMessages([...newMessages, { role: 'assistant', content: d.assistant_message }]);
        setPricing(d.pricing);
        setReadyForApproval(d.ready_for_approval);
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `אירעה שגיאה: ${e.message}` }]);
    }
    setSending(false);
  };

  if (!started) {
    return (
      <div>
        <PageHeader title="סרטון חדש" subtitle="צ׳אט לבניית הבריף" />
        <div className="p-6 max-w-lg mx-auto">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-primary"><Sparkles className="w-5 h-5" /><span className="font-semibold">בואו נתחיל</span></div>
            <p className="text-sm text-muted-foreground">תנו שם לפרויקט. לאחר מכן תנהלו שיחה בעברית שתבנה את הבריף ותתמחר אותו.</p>
            <Input placeholder="שם הפרויקט (למשל: ניקוי מזגנים — גוש דן)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startProject()} />
            {presets.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">ורטיקל / preset (אופציונלי — נטען אוטומטית לצ׳אט)</label>
                <select className="w-full h-10 rounded-md border bg-background px-3 text-sm mt-1" value={vertical} onChange={(e) => setVertical(e.target.value)}>
                  <option value="">ללא — שיחה חופשית</option>
                  {presets.map((p) => <option key={p.id} value={p.vertical}>{p.name} ({p.vertical})</option>)}
                </select>
              </div>
            )}
            <Button className="w-full" onClick={startProject} disabled={!title.trim()}>התחל</Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title={project.title} subtitle="צ׳אט הבריף" />
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-end">
              <div className="bg-card border rounded-2xl px-4 py-2.5"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            </div>
          )}
          {pricing && (
            <Card className="p-4 max-w-[80%] ml-auto bg-accent">
              <div className="text-sm font-semibold mb-2">הצעת מחיר</div>
              <div className="text-2xl font-bold font-display">{pricing.credits} קרדיטים</div>
              <div className="text-xs text-muted-foreground mt-1">עלות API: ${pricing.totalApiCostUsd?.toFixed(2)} · markup ×{pricing.markup}</div>
              {readyForApproval && briefId && (
                <Button className="w-full mt-3 gap-2" onClick={() => navigate(`/brief/${briefId}`)}>
                  לעריכה ואישור <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
            </Card>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="border-t bg-card p-4">
        <div className="max-w-2xl mx-auto flex gap-2">
          <Input placeholder="כתבו הודעה..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={sending} />
          <Button onClick={send} disabled={sending || !input.trim()} className="gap-2"><Send className="w-4 h-4" /></Button>
        </div>
      </div>
    </div>
  );
}