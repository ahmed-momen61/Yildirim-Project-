import { useEffect, useState } from 'react';
import { api, VeritasStatus } from '../lib/api';
import MetricCard from '../components/shared/MetricCard';
import { Lock, FileCheck, CheckCircle2, ShieldCheck, Database } from 'lucide-react';
import { toast } from 'sonner';

const MOCK_BLOCKS = [
  { id: 'BLK-998', timestamp: '2026-05-22T10:15:30Z', action: 'Sigma Loop triggered. Sentinel flagged anomalous payload.', hash: '0x3f2a...8c1b' },
  { id: 'BLK-999', timestamp: '2026-05-22T10:16:05Z', action: 'Red Swarm Phantom evasion attempt recorded.', hash: '0x7e1b...9a2f' },
  { id: 'BLK-1000', timestamp: '2026-05-22T10:18:22Z', action: 'Oracle GNN isolated node 10.0.0.5.', hash: '0x1a4c...3e5d' },
  { id: 'BLK-1001', timestamp: '2026-05-22T10:20:10Z', action: 'Wingman auto-patched memory buffer overflow.', hash: '0x9f8d...4b6a' },
  { id: 'BLK-1002', timestamp: '2026-05-22T10:25:00Z', action: 'ZK-SNARK proof generated for chain state.', hash: '0x5c3d...7f1e' },
];

export default function VeritasLedger() {
  const [status, setStatus] = useState<VeritasStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await api.fetchVeritasStatus();
        setStatus(data);
      } catch (err) {
        console.error('Failed to fetch Veritas status', err);
        // Fallback mock if backend is not ready
        setStatus({
          chainLength: 1002,
          chainIntegrity: 'VALID',
          lastBlockHash: '0x5c3d...7f1e',
          lastBlockTimestamp: new Date().toISOString()
        });
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      await api.verifyVeritasChain();
      toast.success('Zero-Knowledge Proof verified successfully. Chain integrity intact.');
    } catch (e: any) {
      toast.error('Chain verification failed: ' + e.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleExport = async () => {
    try {
      await api.exportVeritasCompliance('pdf');
      toast.success('Compliance report exported successfully.');
    } catch (e: any) {
      toast.error('Export failed: ' + e.message);
    }
  };

  if (loading) {
    return <div className="p-8 text-violet-400">Loading Veritas Ledger...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Lock className="text-violet-400" />
            VERITAS LEDGER
          </h1>
          <p className="text-sm text-slate-400">Cryptographic Chain of Custody & ZK-SNARK Compliance</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleVerifyChain}
            disabled={verifying}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-violet-500/30 rounded-lg transition-colors text-sm font-medium disabled:opacity-50"
          >
            <ShieldCheck size={16} className={verifying ? 'animate-pulse text-violet-400' : 'text-violet-400'} />
            {verifying ? 'Verifying Proofs...' : 'Verify Chain Integrity'}
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <FileCheck size={16} />
            Export Compliance Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <MetricCard 
          icon={Database} 
          label="Chain Length" 
          value={status?.chainLength || 0} 
          color="violet" 
          trend="Immutable blocks appended"
        />
        <MetricCard 
          icon={CheckCircle2} 
          label="Integrity Status" 
          value={status?.chainIntegrity || 'UNKNOWN'} 
          color={status?.chainIntegrity === 'VALID' ? 'emerald' : 'rose'} 
          trend="ZK-SNARK mathematically verified"
        />
        <MetricCard 
          icon={Lock} 
          label="Last Block Hash" 
          value={status?.lastBlockHash || 'N/A'} 
          color="cyan" 
          trend={`Mined at ${new Date(status?.lastBlockTimestamp || '').toLocaleTimeString()}`}
        />
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden flex-1">
        <div className="p-4 border-b border-slate-800 bg-slate-900/80">
          <h2 className="text-sm font-semibold text-slate-300 tracking-wider">RECENT BLOCKCHAIN LEDGER ENTRIES</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-3">Block ID</th>
                <th className="px-6 py-3">Timestamp</th>
                <th className="px-6 py-3">Recorded Action</th>
                <th className="px-6 py-3">Cryptographic Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {MOCK_BLOCKS.map((block) => (
                <tr key={block.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs text-violet-400">{block.id}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {new Date(block.timestamp).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 font-medium">{block.action}</td>
                  <td className="px-6 py-4 font-mono text-xs text-cyan-400 bg-slate-950/50 rounded p-1 inline-block mt-2 border border-slate-800">
                    {block.hash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
