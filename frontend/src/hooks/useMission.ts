import { useEffect, useRef, useState } from 'react';
import { MissionController, type MissionParams, type MissionSnapshot } from '@/services/simulationService';

/** Owns a MissionController and exposes a 10 Hz telemetry snapshot for the UI. */
export function useMission(initial?: Partial<MissionParams>) {
  const ref = useRef<MissionController | null>(null);
  if (!ref.current) ref.current = new MissionController(initial);
  const mission = ref.current;
  // dev-only handle for automated tests (route order / pause / reset verification)
  if (import.meta.env.DEV) (window as unknown as { __mission?: MissionController }).__mission = mission;
  const [snap, setSnap] = useState<MissionSnapshot>(() => mission.snapshot());
  const [params, setParams] = useState<MissionParams>({ ...mission.params });

  useEffect(() => {
    const t = setInterval(() => setSnap(mission.snapshot()), 100);
    const off = mission.onChange(() => {
      setSnap(mission.snapshot());
      setParams({ ...mission.params });
    });
    return () => {
      clearInterval(t);
      off();
    };
  }, [mission]);

  return {
    mission,
    snap,
    params,
    start: () => mission.start(),
    pause: () => mission.pause(),
    resume: () => mission.resume(),
    reset: () => mission.reset(),
    update: (p: Partial<MissionParams>) => mission.setParams(p),
  };
}
