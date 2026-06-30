import React from 'react';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="h-16 border-b bg-card/60 backdrop-blur sticky top-0 z-10 flex items-center justify-between px-6">
      <div>
        <h1 className="font-display font-bold text-xl leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}