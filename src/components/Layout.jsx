import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, MessageSquarePlus, Library, Mic2, Users, Settings, Wallet, Clapperboard } from 'lucide-react';

const nav = [
  { to: '/', label: 'דאשבורד', icon: LayoutDashboard },
  { to: '/new', label: 'סרטון חדש', icon: MessageSquarePlus },
  { to: '/library', label: 'ספרייה', icon: Library },
  { to: '/voices', label: 'קולות', icon: Mic2 },
  { to: '/clients', label: 'לקוחות', icon: Users },
  { to: '/budget', label: 'תקציב', icon: Wallet },
  { to: '/settings', label: 'הגדרות', icon: Settings },
];

export default function Layout() {
  const location = useLocation();
  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground flex">
      <aside className="w-60 shrink-0 border-l bg-card flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <Clapperboard className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-display font-bold text-lg leading-none">VIDON</div>
            <div className="text-[11px] text-muted-foreground">הפקת וידאו · LeadON</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 text-[11px] text-muted-foreground border-t">Phase 1 · MVP</div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}