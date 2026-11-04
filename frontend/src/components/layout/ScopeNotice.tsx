import { useApp } from '@/context/AppContext';
import { Banner, DemoBadge } from '@/components/ui/primitives';

/** Persistent notice explaining which dataset a page is showing. */
export function ScopeNotice() {
  const { scope, backendOnline, healthChecked } = useApp();
  if (scope === 'demo') {
    return (
      <div className="mb-4">
        <Banner tone="demo">
          <div className="flex flex-wrap items-center gap-2">
            <DemoBadge />
            <span>
              Showing <b>fictional demonstration data</b>: sample aircraft, inspections and simulated detections. Not real AI results.
              {healthChecked && !backendOnline && ' Backend offline: using the bundled demo dataset (reviews saved in this browser).'}
            </span>
          </div>
        </Banner>
      </div>
    );
  }
  if (healthChecked && !backendOnline) {
    return (
      <div className="mb-4">
        <Banner tone="warn">
          <b>Backend offline.</b> Real inspection records are stored by the AeroSpectra backend. Start it with{' '}
          <code className="num text-xs bg-black/30 px-1 py-0.5 rounded">uvicorn app.main:app --port 8000</code> or switch to Demo data.
        </Banner>
      </div>
    );
  }
  return null;
}
