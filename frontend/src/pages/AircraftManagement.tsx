import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Plane, Plus } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { aircraftService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from '@/components/ui/primitives';
import { fmtDate } from '@/utils/format';

function RegisterForm({ onDone }: { onDone: () => void }) {
  const { notify, bumpData, setScope } = useApp();
  const [f, setF] = useState({ id: '', registration: '', model: '', operator: '', base: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = (k: keyof typeof f, label: string, ph: string, req = false) => (
    <div>
      <label className="label" htmlFor={`f-${k}`}>{label}{req && ' *'}</label>
      <input id={`f-${k}`} className="field" value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={req} />
    </div>
  );
  return (
    <form
      className="p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const a = await aircraftService.create(f);
          notify({ tone: 'ok', title: `Aircraft ${a.id} registered` });
          setScope('real');
          bumpData();
          onDone();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">Registered aircraft are <b className="text-ink">real records</b> used for Live Camera and Uploaded Video inspections.</p>
      {field('id', 'Aircraft ID', 'e.g. AC-001', true)}
      {field('registration', 'Registration number', 'as painted on the airframe', true)}
      {field('model', 'Aircraft model', 'e.g. A320neo', true)}
      {field('operator', 'Operator', 'optional')}
      {field('base', 'Base / hangar', 'optional')}
      {err && <div className="text-sm text-crit">{err}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.id || !f.registration || !f.model}>{busy && <Loader2 className="size-4 animate-spin" />} Register aircraft</button>
      </div>
    </form>
  );
}

export default function AircraftManagement() {
  const { scope, dataVersion, backendOnline } = useApp();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [reg, setReg] = useState(sp.get('register') === '1');
  useEffect(() => {
    if (sp.get('register')) {
      sp.delete('register');
      setSp(sp, { replace: true });
    }
  }, [sp, setSp]);
  const list = useAsync(() => aircraftService.list(scope), [scope, dataVersion, backendOnline]);

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Aircraft Management"
        subtitle="Aircraft records with inspection history and outstanding findings."
        actions={<button className="btn btn-primary" onClick={() => setReg(true)} disabled={!backendOnline} title={backendOnline ? undefined : 'Requires backend'}><Plus className="size-4" /> Register aircraft</button>}
      />
      <ScopeNotice />
      <Panel bodyClass="p-0" title={list.data ? `${list.data.length} aircraft` : 'Aircraft'}>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
          <EmptyState icon={<Plane className="size-5" />} title="No aircraft registered" body="Register an aircraft to run real camera or uploaded-video inspections." action={backendOnline && <button className="btn btn-primary" onClick={() => setReg(true)}><Plus className="size-4" /> Register aircraft</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Aircraft ID</th><th>Model</th><th>Registration</th><th>Operator</th><th className="text-right">Inspections</th><th>Last inspection</th><th className="text-right">Findings</th><th className="text-right">Open</th></tr>
              </thead>
              <tbody>
                {list.data.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => navigate(`/aircraft/${a.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/aircraft/${a.id}`)}>
                    <td><span className="num text-ink">{a.id}</span></td>
                    <td className="text-ink">{a.model}</td>
                    <td className="num text-xs">{a.registration}</td>
                    <td className="text-xs">{a.operator || '—'}</td>
                    <td className="text-right num">{a.inspection_count}</td>
                    <td className="text-xs">{fmtDate(a.last_inspection_at)}</td>
                    <td className="text-right num">{a.finding_count}</td>
                    <td className="text-right">{a.open_finding_count ? <span className="chip text-warn-ink bg-warn/10 border-warn/35 num">{a.open_finding_count}</span> : <span className="text-faint">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Drawer open={reg} onClose={() => setReg(false)} title="Register aircraft" width="max-w-md">
        <RegisterForm onDone={() => setReg(false)} />
      </Drawer>
    </>
  );
}
