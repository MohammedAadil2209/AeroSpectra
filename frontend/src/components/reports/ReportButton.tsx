import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import type { DataScope } from '@/types';
import { inspectionService } from '@/services/dataService';
import { generateInspectionReport } from '@/utils/report';
import { useApp } from '@/context/AppContext';
import { cx } from '@/components/ui/primitives';

export function ReportButton({ inspectionId, scope, className, label = 'Download PDF report' }: { inspectionId: string; scope: DataScope; className?: string; label?: string }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={cx('btn', className)}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          const detail = await inspectionService.get(inspectionId, scope);
          await generateInspectionReport(detail);
          notify({ tone: 'ok', title: 'Report generated', body: `AeroSpectra-${inspectionId}.pdf` });
        } catch (err) {
          notify({ tone: 'crit', title: 'Report failed', body: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} {label}
    </button>
  );
}
