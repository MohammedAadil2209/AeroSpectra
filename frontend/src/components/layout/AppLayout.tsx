import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  Cpu,
  FileText,
  History,
  LayoutDashboard,
  Menu,
  Plane,
  Radio,
  ScanSearch,
  Server,
  Settings,
  Video,
  X,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Segmented, StatusDot, cx } from '@/components/ui/primitives';
import { Toasts } from '@/components/ui/Toasts';
import { fmtClock } from '@/utils/format';
import type { DataScope } from '@/types';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/live', label: 'Live Inspection', icon: Video },
  { to: '/simulation', label: 'Drone Simulator', icon: Boxes },
  { to: '/defects', label: 'Defect Records', icon: ScanSearch },
  { to: '/aircraft', label: 'Aircraft', icon: Plane },
  { to: '/inspections', label: 'Inspection History', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Mark: top-down airliner inside drone-camera scan brackets, with a detected defect on the wing */}
      <svg viewBox="0 0 32 32" className="size-9 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]" aria-hidden>
        <rect width="32" height="32" rx="7.5" fill="#092635" />
        <path
          d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M23 4h3.5A1.5 1.5 0 0 1 28 5.5V9M28 23v3.5a1.5 1.5 0 0 1-1.5 1.5H23M9 28H5.5A1.5 1.5 0 0 1 4 26.5V23"
          fill="none" stroke="#9FC0D6" strokeWidth="1.5" strokeLinecap="round"
        />
        <path
          d="M16 5.2c.95 0 1.35 1.05 1.35 2.2v4.75l7.9 3.85v1.5l-7.9-1.95-.1 5.6 2.75 1.9v1.25l-3.4-.8L16 25.9l-.6-2.4-3.4.8v-1.25l2.75-1.9-.1-5.6-7.9 1.95v-1.5l7.9-3.85V7.4c0-1.15.4-2.2 1.35-2.2z"
          fill="#FCF4DB"
        />
        <circle cx="21.6" cy="15.9" r="2.6" fill="#E5383B" fillOpacity=".28" />
        <circle cx="21.6" cy="15.9" r="1.35" fill="#E5383B" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className="font-display font-bold tracking-tight text-[15px] text-ink">AEROSPECTRA</div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { backendOnline, health, active } = useApp();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 h-16 flex items-center border-b border-line">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'group flex items-center gap-3 rounded-lg px-3 h-9 text-[13px] font-medium transition-colors relative',
                isActive ? 'bg-surface-3 text-ink before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-cream' : 'text-muted hover:text-ink hover:bg-surface-2',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {to === '/live' && active && <span className="size-1.5 rounded-full bg-crit pulse-dot" aria-label="Inspection running" />}
          </NavLink>
        ))}
      </nav>
      <div className="m-2.5 rounded-lg border border-line bg-surface-2/60 p-3 text-xs space-y-2">
        <div className="eyebrow">System</div>
        <div className="flex items-center gap-2 text-ink-2">
          <StatusDot status={backendOnline ? 'online' : 'offline'} /> Backend <span className="ml-auto text-muted">{backendOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div className="flex items-center gap-2 text-ink-2">
          <StatusDot status={health?.ai_model.status ?? 'offline'} /> AI model
          <span className="ml-auto text-muted">{health ? (health.ai_model.status === 'online' ? 'Loaded' : 'Not loaded') : '—'}</span>
        </div>
        <div className="text-[10px] text-faint pt-1">v{health?.version ?? '1.0.0'} · T-Hub BuildX</div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { scope, setScope, backendOnline, healthChecked, wsState, health, active } = useApp();
  const navigate = useNavigate();
  return (
    <header className="h-16 shrink-0 border-b border-line bg-surface/90 backdrop-blur sticky top-0 z-30 flex items-center gap-3 px-4 md:px-6">
      <button className="btn btn-ghost btn-sm lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="lg:hidden"><Logo compact /></div>

      <div className="flex items-center gap-2">
        <span className="eyebrow hidden sm:inline">Data</span>
        <Segmented<DataScope>
          ariaLabel="Data scope"
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'demo', label: 'Demo', title: 'Fictional demonstration dataset' },
            { value: 'real', label: 'Real', title: 'Records from real camera / uploaded-video inspections' },
          ]}
        />
      </div>

      {active && (
        <button onClick={() => navigate('/live')} className="hidden md:flex items-center gap-2 h-8 px-3 rounded-lg border border-crimson/40 bg-crimson/10 text-xs font-semibold text-crit-ink">
          <span className={cx('size-2 rounded-full', active.status === 'paused' ? 'bg-warn' : 'bg-crit pulse-dot')} />
          {active.status === 'paused' ? 'PAUSED' : 'INSPECTING'} · {active.inspection_id}
          <span className="num text-muted">{fmtClock(active.elapsed_s)}</span>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-3 text-xs">
        <StatusPill icon={<Server className="size-3.5" />} label="Backend" status={!healthChecked ? 'connecting' : backendOnline ? 'online' : 'offline'} />
        <StatusPill icon={<Radio className="size-3.5" />} label="Live link" status={wsState === 'open' ? 'online' : wsState === 'connecting' && backendOnline ? 'connecting' : 'offline'} />
        <StatusPill icon={<Cpu className="size-3.5" />} label="AI model" status={health?.ai_model.status ?? 'offline'} text={health ? (health.ai_model.status === 'online' ? 'Loaded' : 'Not loaded') : 'Unknown'} />
      </div>
    </header>
  );
}

function StatusPill({ icon, label, status, text }: { icon: React.ReactNode; label: string; status: Parameters<typeof StatusDot>[0]['status']; text?: string }) {
  const statusText = text ?? { online: 'Online', offline: 'Offline', connecting: 'Connecting', degraded: 'Degraded', not_configured: 'Not configured', unavailable: 'Unavailable' }[status];
  return (
    <div className="flex items-center gap-2 h-8 px-2 sm:px-2.5 rounded-lg border border-line bg-surface" title={`${label}: ${statusText}`}>
      <StatusDot status={status} pulse />
      <span className="text-muted hidden xl:inline">{icon}</span>
      <span className="hidden md:inline text-ink-2">{label}</span>
      <span className="hidden 2xl:inline text-muted">· {statusText}</span>
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="flex h-full">
      <aside className="theme-dark sidebar-maroon hidden lg:block w-60 shrink-0 border-r border-line bg-surface">
        <SidebarContent />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <aside className="theme-dark sidebar-maroon absolute left-0 top-0 bottom-0 w-64 bg-surface border-r border-line">
            <button className="absolute right-2 top-4 btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close navigation">
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <TopBar onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
