import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { EmptyState, Loading } from './components/ui/primitives';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LiveInspection = lazy(() => import('./pages/LiveInspection'));
const Simulation = lazy(() => import('./pages/Simulation'));
const DefectRecords = lazy(() => import('./pages/DefectRecords'));
const AircraftManagement = lazy(() => import('./pages/AircraftManagement'));
const AircraftDetail = lazy(() => import('./pages/AircraftDetail'));
const InspectionHistory = lazy(() => import('./pages/InspectionHistory'));
const InspectionDetail = lazy(() => import('./pages/InspectionDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));

export default function App() {
  return (
    <Suspense fallback={<Loading className="h-screen" label="Loading AeroSpectra…" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="live" element={<LiveInspection />} />
          <Route path="simulation" element={<Simulation />} />
          <Route path="defects" element={<DefectRecords />} />
          <Route path="defects/:id" element={<DefectRecords />} />
          <Route path="aircraft" element={<AircraftManagement />} />
          <Route path="aircraft/:id" element={<AircraftDetail />} />
          <Route path="inspections" element={<InspectionHistory />} />
          <Route path="inspections/:id" element={<InspectionDetail />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<EmptyState title="Page not found" body="The requested page does not exist." />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
