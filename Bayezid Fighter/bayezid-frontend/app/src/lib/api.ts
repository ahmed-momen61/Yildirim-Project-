export interface Alert {
  id: string;
  sourceIp: string;
  targetServer: string;
  eventType: string;
  severity: string;
  threatType: string;
  recommendedAction: string;
  confidenceType: string;
  status: string;
  osintData: string;
  createdAt: string;
}
export interface TopologyData {
  nodes: { ip: string; risk: number; isolated: boolean; subnet: string; services: string[] }[];
  edges: { source: string; target: string; weight: number }[];
}
export interface MitreCoverage {
  covered: string[];
  uncovered: string[];
}
export interface PurpleMetrics {
  meanTimeToDetect: number;
  meanTimeToRespond: number;
  detectionCoverage: number;
  falsePositiveRate: number;
  evasionSuccessRate: number;
  roeComplianceRate: number;
}
export interface VeritasStatus {
  chainLength: number;
  chainIntegrity: 'VALID' | 'BROKEN';
  lastBlockHash: string;
  lastBlockTimestamp: string;
}
export interface FedStatus {
  round: number;
  participantCount: number;
  globalWeights: number[];
  loss: number;
  timestamp: string;
}
export interface BrainStatus {
  harvester: { totalSamples: number };
  lora: { activeAdapter: string };
}
export interface TrainingMetrics {
  datasetSize: number;
  evalLoss: number;
  baselineLoss: number;
  improvementDelta: number;
  activeAdapter: string;
}
export interface DataQuality {
  distribution: any;
  ratioMetrics: any;
}
export interface MnemonStatus {
  probes: { probeId: string; syscall: string; bpfCode: string; loadStatus: string; hitsToday: number }[];
}
export interface MirrorStatus {
  activeMirrors: any;
  totalTests: number;
  avgFidelity: number;
}
export interface AdversarialMetrics {
  lstm_evasion_rate: number;
  sigma_rule_evasion_rate: number;
  kinetic_filter_bypass_rate: number;
}
export const BASE_URL = 'http://localhost:3000';
export const authHeaders = () => {
  const token = localStorage.getItem('bayezid_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};
export const api = {
  get: async (path: string): Promise<any> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.statusText}`);
    return res.json();
  },
  post: async (path: string, body: object): Promise<any> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.statusText}`);
    return res.json();
  },
  delete: async (path: string): Promise<any> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.statusText}`);
    return res.json();
  },
  fetchAlerts: (): Promise<Alert[]> => api.get('/api/v1/alerts').then((res) => res.data || res),
  fetchThreatHeatmap: (): Promise<TopologyData> => api.get('/api/v2/blue/threat-heatmap').then((res) => res.data || res),
  fetchMitreCoverage: (): Promise<MitreCoverage> => api.get('/api/v2/analytics/mitre-coverage').then((res) => res.data || res),
  fetchPurpleScorecard: (): Promise<PurpleMetrics> => api.get('/api/v2/analytics/purple-scorecard').then((res) => res.data || res),
  fetchVeritasStatus: (): Promise<VeritasStatus> => api.get('/api/v1/veritas/status').then((res) => res.data || res),
  fetchVeritasExport: (): Promise<any> => api.get('/api/v1/veritas/export').then((res) => res.data || res),
  fetchFederationStatus: (): Promise<FedStatus> => api.get('/api/v1/federation/status').then((res) => res.data || res),
  fetchBrainStatus: (): Promise<BrainStatus> => api.get('/api/v1/brain/status').then((res) => res.data || res),
  fetchBrainTrainingMetrics: (): Promise<TrainingMetrics> => api.get('/api/v2/brain/training-metrics').then((res) => res.data || res),
  fetchBrainDataQuality: (): Promise<DataQuality> => api.get('/api/v2/brain/data-quality').then((res) => res.data || res),
  fetchMnemonStatus: (): Promise<MnemonStatus> => api.get('/api/v1/mnemon/status').then((res) => res.data || res),
  fetchShadowMirrorStatus: (): Promise<MirrorStatus> => api.get('/api/v1/shadow-mirror/status').then((res) => res.data || res),
  fetchAdversarialCoverage: (): Promise<AdversarialMetrics> => api.get('/api/v2/red/adversarial-coverage').then((res) => res.data || res),
  issueRoEToken: (body: object): Promise<any> => api.post('/api/v2/roe/issue', body),
  revokeRoEToken: (id: string): Promise<any> => api.post('/api/v2/roe/revoke', { id }),
  getRoEStatus: (id: string): Promise<any> => api.get(`/api/v2/roe/status/${id}`),
  startRedSwarmScout: (body: object): Promise<any> => api.post('/api/v1/redswarm/scout', body),
  startRedSwarmBreach: (body: object): Promise<any> => api.post('/api/v1/redswarm/breach', body),
  startRedSwarmPhantom: (body: object): Promise<any> => api.post('/api/v1/redswarm/phantom', body),
  startRedSwarmAutoPilot: (targetInfo: string): Promise<any> => api.post('/api/v1/redswarm/auto-pilot', { targetInfo }),
  runAlchemist: (body: object): Promise<any> => api.post('/api/v1/red/alchemist', body),
  runForge: (body: object): Promise<any> => api.post('/api/v1/red/forge', body),
  runChimeraX: (body: object): Promise<any> => api.post('/api/v1/red/chimera-x', body),
  runHydraC2: (body: object): Promise<any> => api.post('/api/v1/red/hydra-c2', body),
  ingestGNNTraffic: (entries: object[]): Promise<any> => api.post('/api/v1/oracle-g/ingest', { entries }),
  isolateNode: (compromisedIp: string): Promise<any> => api.post('/api/v1/oracle-g/isolate', { compromisedIp }),
  runGalileoForensics: (incidentData: object): Promise<any> => api.post('/api/v1/forensic/galileo', { incidentData }),
  recordVeritasDecision: (body: object): Promise<any> => api.post('/api/v1/veritas/record', body),
  verifyVeritasChain: (): Promise<any> => api.get('/api/v1/veritas/verify'),
  exportVeritasCompliance: (format: string): Promise<any> => api.get(`/api/v2/veritas/export-compliance/${format}`),
  aggregateFederation: (): Promise<any> => api.post('/api/v1/federation/aggregate', {}),
  registerFederationNode: (body: object): Promise<any> => api.post('/api/v1/federation/register', body),
  submitFederationUpdate: (body: object): Promise<any> => api.post('/api/v1/federation/submit-update', body),
  distributeFederationModel: (): Promise<any> => api.post('/api/v1/federation/distribute', {}),
  forceBrainTrain: (): Promise<any> => api.post('/api/v2/brain/force-train', {}),
  harvestPlaybookSample: (): Promise<any> => api.post('/api/v1/brain/harvest-playbook', {}),
  harvestCausalGraph: (): Promise<any> => api.post('/api/v1/brain/harvest-causal', {}),
  createShadowMirrorV1: (targetIp: string): Promise<any> => api.post('/api/v1/shadow-mirror/create', { targetIp }),
  replayShadowMirrorV1: (body: object): Promise<any> => api.post('/api/v1/shadow-mirror/replay', body),
  validateMirrorBlueV1: (body: object): Promise<any> => api.post('/api/v1/shadow-mirror/validate-blue', body),
  runZeroFailPipeline: (body: object): Promise<any> => api.post('/api/v1/shadow-mirror/zero-fail', body),
  activateEBPFProbes: (syscalls: string[]): Promise<any> => api.post('/api/v2/blue/ebpf/activate-probe', { syscalls }),
  simulateMnemonProbe: (body: object): Promise<any> => api.post('/api/v1/mnemon/simulate', body),
  generateMnemonProbes: (): Promise<any> => api.post('/api/v1/mnemon/generate-probes', {}),
  injectSwarmRule: (body: object): Promise<any> => api.post('/api/v1/swarm/sync', body),
  recordVeritasDecisionV2: (body: object): Promise<any> => api.post('/api/v2/veritas/record-decision', body),
  fetchAlertChatHistory: (alertId: string): Promise<any> => api.get(`/api/v1/alerts/${alertId}/chat`),
  getRoEStatusV1: (id: string): Promise<any> => api.get(`/api/v1/auth/roe/status/${id}`),
  issueRoETokenV1: (body: object): Promise<any> => api.post('/api/v1/auth/roe/issue', body),
  revokeRoETokenV1: (id: string): Promise<any> => api.post(`/api/v1/auth/roe/revoke/${id}`, {}),
  exportComplianceReport: (body: object): Promise<any> => api.post('/api/v1/compliance/export', body),
  createShadowMirror: (targetIp: string): Promise<any> => api.post('/api/v2/mirror/auto-create', { targetIp }),
  replayShadowMirror: (body: object): Promise<any> => api.post('/api/v2/mirror/stateful-replay', body),
  validateMirrorBlue: (body: object): Promise<any> => api.post('/api/v2/mirror/blue-validation', body),
  setAutonomyMode: (mode: string): Promise<any> => api.post('/api/v1/config/set-autonomy', { mode }),
  startSigmaLoop: (): Promise<any> => api.post('/api/v1/sigma-live/start', {}),
  runKineticEvolver: (ctx: string): Promise<any> => api.post('/api/v1/kinetic-evolver/evolve', { anomalyContext: ctx }),
  startWargaming: (targetAsset: string): Promise<any> => api.post('/api/v1/wargaming/start', { targetAsset }),
  runDeepOSINT: (seed: string, seedType: string): Promise<any> => api.post('/api/v1/osint/investigate', { seed, seedType }),
  fetchOSINTGraph: (seed: string): Promise<any> => api.get(`/api/v1/osint/graph?seed=${encodeURIComponent(seed)}`),
  fetchLatestOSINTInvestigations: (): Promise<any> => api.get('/api/v1/osint/investigations'),
  runNmapRecon: (subnet: string, roeToken: string): Promise<any> => {
    const headers = { 'x-roe-token': roeToken };
    return fetch(`${BASE_URL}/api/v1/osint/recon/nmap`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        ...headers
      },
      body: JSON.stringify({ subnet })
    }).then((res) => {
      if (!res.ok) throw new Error(`Nmap Scan Failed: ${res.statusText}`);
      return res.json();
    });
  }
};
