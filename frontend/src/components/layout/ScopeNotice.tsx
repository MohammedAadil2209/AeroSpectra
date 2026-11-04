import { useApp } from '@/context/AppContext';
import { Banner } from '@/components/ui/primitives';

/** Operational notice: shown only when real records are selected but the backend is unreachable. */
export function ScopeNotice() {
  const { scope, backendOnline, healthChecked } = useApp();
  if (scope === 'real' && healthChecked && !backendOnline) {
    return (
      <div className="mb-4">
        <Banner tone="warn">
          <b>Backend offline.</b> Real inspection records are stored by the AeroSpectra backend. Start it with{' '}
          <code className="num text-xs bg-black/30 px-1 py-0.5 rounded">uvicorn app.main:app --port 8000</code>.
        </Banner>
      </div>
    );
  }
  return null;
}
