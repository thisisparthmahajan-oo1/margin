import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { Toasts } from './Toasts.tsx';

export function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-button" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <Menu size={20} />
        </button>
        <span className="wordmark">Margin</span>
      </header>
      <div className={`sidebar-wrap${drawerOpen ? ' open' : ''}`}>
        <Sidebar />
        <div className="scrim" onClick={() => setDrawerOpen(false)} />
      </div>
      <main className="main">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}
