import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import { Loading } from '@/components';
import { navItems } from './registry';

function HealthIndicator() {
  const { data, isError } = useQuery({ queryKey: qk.health, queryFn: systemApi.health, refetchInterval: 15000 });
  const dot = (ok: boolean | undefined) => (ok ? '●' : '○');
  return (
    <div className="sidebar-foot" aria-label="Backend status">
      <span>{isError ? '○ Backend unreachable' : `${dot(data?.status === 'ok')} Backend ${data ? 'online' : '…'}`}</span>
      {data && <span>{dot(data.worker_alive)} Worker {data.worker_alive ? 'running' : 'stopped'}</span>}
      {data && <span>{dot(data.extraction_configured)} Extraction {data.extraction_configured ? 'configured' : 'not configured'}</span>}
    </div>
  );
}

export function AppShell() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Accounts Payable</strong>
          <span>Invoice processing</span>
        </div>
        <nav className="nav" aria-label="Main">
          {navItems.map((r) => {
            const Badge = r.nav!.badge;
            const to = r.path === '' ? '/' : `/${r.path}`;
            return (
              <NavLink key={r.path} to={to} end={r.nav!.end ?? r.path === ''}>
                <span>{r.nav!.label}</span>
                {Badge && <Badge />}
              </NavLink>
            );
          })}
        </nav>
        <HealthIndicator />
      </aside>
      <main className="content">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
