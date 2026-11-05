import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  IndianRupee,
  MonitorPlay,
  ShieldAlert,
  Wrench,
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
import { getSession, logout } from '@/utils/auth';
import { LogOut } from 'lucide-react';
import { Segmented, StatusDot, cx } from '@/components/ui/primitives';
import { Toasts } from '@/components/ui/Toasts';
import { fmtClock } from '@/utils/format';
import type { DataScope } from '@/types';

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Operations',
    items: [
      { to: '/live', label: 'Live Inspection', icon: Video },
      { to: '/simulation', label: 'Drone Simulator', icon: Boxes },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/defects', label: 'Defect Records', icon: ScanSearch },
      { to: '/aircraft', label: 'Aircraft', icon: Plane },
      { to: '/inspections', label: 'Inspection History', icon: History },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/risk', label: 'Risk Engine', icon: ShieldAlert },
      { to: '/roi', label: 'Cost & ROI', icon: IndianRupee },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

/** Human-readable page name for the top bar breadcrumb. */
function pageName(path: string): string {
  if (path.startsWith('/defects')) return 'Defect Records';
  if (path.startsWith('/aircraft')) return 'Aircraft';
  if (path.startsWith('/inspections')) return 'Inspection History';
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === path);
  return item?.label ?? 'Overview';
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Mark: top-down airliner inside drone-camera scan brackets, with a detected defect on the wing */}
      <svg viewBox="0 0 32 32" className="size-9 shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]" aria-hidden>
        <defs>
          <linearGradient id="logo-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#14465e" />
            <stop offset="1" stopColor="#071e2a" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-tile)" stroke="rgba(159,192,214,.4)" strokeWidth=".75" />
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
        <div className="leading-tight min-w-0">
          <div className="font-display font-bold tracking-[0.015em] text-[15px] text-ink">AEROSPECTRA</div>
          <div className="text-[8px] uppercase tracking-[0.24em] text-[rgb(252_244_219_/_0.42)] mt-0.5">Aircraft inspection</div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { backendOnline, health, active } = useApp();
  const aiOnline = health?.ai_model.status === 'online';
  return (
    <div className="relative z-10 flex h-full flex-col">
      <div className="px-4 h-[68px] flex items-center border-b border-line">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Primary">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-3.5' : undefined}>
            <div className="px-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[rgb(252_244_219_/_0.36)]">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'group relative flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13px] font-medium transition-all duration-150',
                      isActive
                        ? 'bg-[linear-gradient(90deg,rgba(252,244,219,.17),rgba(252,244,219,.05))] text-ink ring-1 ring-[rgba(252,244,219,.13)] shadow-[inset_0_1px_0_rgba(255,255,255,.08)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-cream'
                        : 'text-muted hover:text-ink hover:bg-white/[.055]',
                    )
                  }
                >
                  <Icon className="size-[17px] shrink-0 opacity-90" />
                  <span className="flex-1 truncate">{label}</span>
                  {to === '/live' && active && <span className="size-1.5 rounded-full bg-crit pulse-dot" aria-label="Inspection running" />}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="m-2.5 rounded-xl border border-line bg-[rgb(252_244_219_/_0.045)] p-3 text-xs backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,.06)]">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">System status</span>
          <span className={cx('chip !h-[18px] !px-1.5 !text-[9px] uppercase tracking-[0.08em]', backendOnline ? 'text-ok-ink border-ok/35 bg-ok/10' : 'text-crit-ink border-crit/40 bg-crit/10')}>
            {backendOnline ? 'Nominal' : 'Offline'}
          </span>
        </div>
        <div className="mt-2 divide-y divide-[rgb(252_244_219_/_0.08)]">
          <div className="flex items-center gap-2 py-1.5 text-ink-2">
            <StatusDot status={backendOnline ? 'online' : 'offline'} pulse />
            <span>Backend</span>
            <span className="ml-auto text-[10.5px] text-muted">{backendOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2 py-1.5 text-ink-2">
            <StatusDot status={health?.ai_model.status ?? 'offline'} pulse />
            <span>AI model</span>
            <span className="ml-auto text-[10.5px] text-muted">{health ? (aiOnline ? 'Loaded' : 'Not loaded') : '—'}</span>
          </div>
        </div>
        {health?.ai_model.device && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-white/[.05] px-2 py-1 text-[10px] text-muted" title={health.ai_model.device}>
            <Cpu className="size-3 shrink-0" />
            <span className="truncate">{health.ai_model.device}{health.ai_model.half ? ' · FP16' : ''}</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2 text-[10px] text-faint">
          <span className="num">v{health?.version ?? '1.0.0'}</span>
          <span className="text-[9px] uppercase tracking-[0.16em]">AeroSpectra</span>
        </div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { scope, setScope, backendOnline, healthChecked, wsState, health, active, ai, presentMode, setPresentMode } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  return (
    <header className="h-16 shrink-0 border-b border-line bg-surface/85 backdrop-blur-xl sticky top-0 z-30 flex items-center gap-3 px-4 md:px-6 shadow-[0_1px_0_rgb(9_38_53_/_0.03)]">
      <button className="btn btn-ghost btn-sm lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="lg:hidden"><Logo compact /></div>

      <div className="hidden lg:flex items-center gap-3 min-w-0">
        <span className="text-[13px] font-semibold text-ink truncate">{pageName(loc.pathname)}</span>
        <span className="h-4 w-px bg-line-strong shrink-0" aria-hidden />
      </div>

      <div className="flex items-center gap-2">
        <span className="eyebrow hidden sm:inline">Data scope</span>
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
        <button onClick={() => navigate('/live')} className="hidden md:flex items-center gap-2 h-8 px-3 rounded-lg border border-crimson/40 bg-crimson/10 text-xs font-semibold text-crit-ink shadow-[0_0_0_3px_rgb(125_10_10_/_0.05)]">
          <span className={cx('size-2 rounded-full', active.status === 'paused' ? 'bg-warn' : 'bg-crit pulse-dot')} />
          {active.status === 'paused' ? 'PAUSED' : 'INSPECTING'} · {active.inspection_id}
          <span className="num text-muted">{fmtClock(active.elapsed_s)}</span>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-2.5 text-xs">
        <StatusPill icon={<Server className="size-3.5" />} label="Backend" status={!healthChecked ? 'connecting' : backendOnline ? 'online' : 'offline'} />
        <LiveIndicator state={wsState} backendOnline={backendOnline} />
        <AIChip status={health?.ai_model.status ?? 'offline'} model={ai?.model ?? health?.ai_model.model} device={ai?.device ?? health?.ai_model.device} fps={active ? active.inference_fps ?? ai?.inference_fps : undefined} half={ai?.half} />
        <button
          className={cx('btn btn-sm', presentMode && 'border-crimson text-crit-ink')}
          onClick={() => setPresentMode(!presentMode)}
          title="Present mode: hides dev controls, enlarges live views, auto-cycles pages when idle"
        >
          <MonitorPlay className="size-4" /> <span className="hidden sm:inline">{presentMode ? 'Exit present' : 'Present'}</span>
        </button>
        <button className="btn btn-sm" title={`Signed in as ${getSession()?.email ?? ''}`} onClick={() => { logout(); navigate('/login', { replace: true }); }}>
          <LogOut className="size-4" /> <span className="hidden lg:inline">{getSession()?.name ?? 'Sign out'}</span>
        </button>
      </div>
    </header>
  );
}

function LiveIndicator({ state, backendOnline }: { state: string; backendOnline: boolean }) {
  const live = state === 'open';
  const label = live ? 'Live' : backendOnline || state === 'connecting' ? 'Reconnecting…' : 'Offline';
  return (
    <div
      className={cx(
        'flex items-center gap-2 h-8 px-2.5 rounded-lg border text-xs font-semibold',
        live ? 'border-ok/40 bg-ok/10 text-ok-ink' : backendOnline ? 'border-warn/50 bg-warn/15 text-warn-ink' : 'border-line text-muted',
      )}
      title="Real-time event stream (WebSocket). Reconnects automatically."
      aria-live="polite"
    >
      <span className={cx('size-2 rounded-full', live ? 'bg-ok pulse-dot' : backendOnline ? 'bg-warn animate-pulse' : 'bg-ink/30')} />
      <Radio className="size-3.5 hidden xl:inline" />
      {label}
    </div>
  );
}

function AIChip({ status, model, device, fps, half }: { status: Parameters<typeof StatusDot>[0]['status']; model?: string | null; device?: string | null; fps?: number; half?: boolean }) {
  const loaded = status === 'online';
  const dev = device ? (device.startsWith('CPU') ? 'CPU' : device.replace(/^NVIDIA /, '').replace(/ Laptop GPU$/, '')) : null;
  return (
    <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgb(9_38_53_/_0.03)] max-w-[340px]" title={`AI model: ${model ?? 'not loaded'} · ${device ?? 'no device'}${half ? ' (FP16)' : ''}`}>
      <StatusDot status={status} pulse />
      <Cpu className="size-3.5 text-muted hidden xl:inline" />
      <span className="text-ink-2 truncate">{loaded ? (model ?? 'AI').replace(/\.pt$/, '') : 'AI not loaded'}</span>
      {loaded && dev && <span className="hidden md:inline text-muted truncate">· {dev}{half ? ' FP16' : ''}</span>}
      {loaded && fps !== undefined && <span className="num text-ink font-semibold">· {fps.toFixed(0)} inf/s</span>}
    </div>
  );
}

const PRESENT_CYCLE = ['/', '/live', '/risk', '/roi'];

/** Present mode: auto-cycle dashboard -> live -> risk -> ROI after 25 s idle (never while inspecting). */
function usePresentCycle() {
  const { presentMode, active } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const lastInput = useRef(Date.now());
  useEffect(() => {
    const bump = () => (lastInput.current = Date.now());
    window.addEventListener('pointermove', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('pointermove', bump);
      window.removeEventListener('keydown', bump);
    };
  }, []);
  useEffect(() => {
    if (!presentMode) return;
    const t = setInterval(() => {
      if (active || Date.now() - lastInput.current < 25000) return;
      const i = PRESENT_CYCLE.indexOf(loc.pathname);
      navigate(PRESENT_CYCLE[(i + 1) % PRESENT_CYCLE.length]);
      lastInput.current = Date.now();
    }, 3000);
    return () => clearInterval(t);
  }, [presentMode, active, loc.pathname, navigate]);
}

function StatusPill({ icon, label, status, text }: { icon: React.ReactNode; label: string; status: Parameters<typeof StatusDot>[0]['status']; text?: string }) {
  const statusText = text ?? { online: 'Online', offline: 'Offline', connecting: 'Connecting', degraded: 'Degraded', not_configured: 'Not configured', unavailable: 'Unavailable' }[status];
  return (
    <div className="flex items-center gap-2 h-8 px-2 sm:px-2.5 rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgb(9_38_53_/_0.03)]" title={`${label}: ${statusText}`}>
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
  const { presentMode } = useApp();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  usePresentCycle();
  return (
    <div className={cx('flex h-full', presentMode && 'present-mode')}>
      <aside className={cx('theme-dark sidebar-maroon hidden w-60 shrink-0 border-r border-line bg-surface overflow-hidden', presentMode ? 'lg:hidden' : 'lg:block')}>
        <SidebarContent />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/45 backdrop-blur-[2px] backdrop-in" onClick={() => setOpen(false)} />
          <aside className="theme-dark sidebar-maroon drawer-in absolute left-0 top-0 bottom-0 w-64 bg-surface border-r border-line shadow-float">
            <button className="absolute right-2 top-4 btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close navigation">
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <TopBar onMenu={() => setOpen(true)} />
        <main ref={mainRef} className="app-canvas flex-1 overflow-y-auto">
          <div key={loc.pathname} className="page-in mx-auto max-w-[1600px] p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}
