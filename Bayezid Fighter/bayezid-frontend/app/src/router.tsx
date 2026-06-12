import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';

const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const SwarmArena = lazy(() => import('./pages/SwarmArena'));
const IntelligenceHub = lazy(() => import('./pages/IntelligenceHub'));
const CausalDAGMonitor = lazy(() => import('./pages/CausalDAGMonitor'));
const VeritasLedger = lazy(() => import('./pages/VeritasLedger'));
const WingmanTerminal = lazy(() => import('./pages/WingmanTerminal'));
const RedSwarmOps = lazy(() => import('./pages/RedSwarmOps'));
const BlueFortress = lazy(() => import('./pages/BlueFortress'));
const PurpleScorecard = lazy(() => import('./pages/PurpleScorecard'));
const FederationControl = lazy(() => import('./pages/FederationControl'));
const BrainTrainer = lazy(() => import('./pages/BrainTrainer'));
const ShadowMirrorLab = lazy(() => import('./pages/ShadowMirrorLab'));
const EBPFProbeConsole = lazy(() => import('./pages/EBPFProbeConsole'));
const RoEManager = lazy(() => import('./pages/RoEManager'));
const IncidentWarRoom = lazy(() => import('./pages/IncidentWarRoom'));
const ComplianceExport = lazy(() => import('./pages/ComplianceExport'));

export default function Router() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-cyan-400">LOADING BAYEZID MAINFRAME...</div>}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<CommandCenter />} />
            <Route path="war-room" element={<IncidentWarRoom />} />
            <Route path="arena" element={<SwarmArena />} />
            <Route path="red-ops" element={<RedSwarmOps />} />
            <Route path="blue-fortress" element={<BlueFortress />} />
            <Route path="intelligence" element={<IntelligenceHub />} />
            <Route path="causal" element={<CausalDAGMonitor />} />
            <Route path="veritas" element={<VeritasLedger />} />
            <Route path="wingman" element={<WingmanTerminal />} />
            <Route path="purple" element={<PurpleScorecard />} />
            <Route path="federation" element={<FederationControl />} />
            <Route path="brain" element={<BrainTrainer />} />
            <Route path="mirror" element={<ShadowMirrorLab />} />
            <Route path="ebpf" element={<EBPFProbeConsole />} />
            <Route path="roe" element={<RoEManager />} />
            <Route path="compliance" element={<ComplianceExport />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
