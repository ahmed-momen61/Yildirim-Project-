import { useState } from 'react';
import { api } from '../lib/api';
import { FileText, Download, FileJson, CheckCircle2, AlertCircle, FileBarChart } from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceExport() {
  const [reportType, setReportType] = useState('VERITAS_LEDGER');
  const [format, setFormat] = useState('PDF');
  const [dateRange, setDateRange] = useState('LAST_7_DAYS');
  
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<any>(null);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsExporting(true);
    try {
      const res = await api.exportComplianceReport({
        type: reportType,
        dateRange,
        format
      });
      
      setLastExport({
        id: `EXP-${Math.floor(Math.random()*10000)}`,
        timestamp: new Date().toISOString(),
        url: res.downloadUrl || '#',
        size: '2.4 MB',
        type: reportType,
        format
      });
      
      toast.success(`${reportType} exported successfully as ${format}.`);
    } catch (err: any) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <FileText className="text-blue-400" />
          COMPLIANCE & EXPORT
        </h1>
        <p className="text-sm text-slate-400">Generate Audit-Ready Reports</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* EXPORT FORM */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-6 flex items-center gap-2">
            <Download size={16} className="text-emerald-400" /> REPORT CONFIGURATION
          </h2>

          <form onSubmit={handleExport} className="space-y-6">
            
            <div>
              <label className="block text-xs uppercase tracking-widest text-slate-500 mb-2">Report Type</label>
              <div className="space-y-2">
                {[
                  { id: 'VERITAS_LEDGER', label: 'Veritas Immutable Ledger', desc: 'Cryptographically signed chain of all SOAR actions.' },
                  { id: 'PURPLE_SCORECARD', label: 'Purple Team Scorecard', desc: 'Performance metrics, MTTD, MTTR, and RoE compliance.' },
                  { id: 'ROE_AUDIT', label: 'RoE Token Audit', desc: 'History of all issued, used, and revoked RoE tokens.' },
                  { id: 'THREAT_INTEL', label: 'CTI Summary', desc: 'Aggregated Threat Intelligence collected over period.' }
                ].map(rt => (
                  <label key={rt.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${reportType === rt.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-slate-950 border-slate-800 hover:border-slate-700'}`}>
                    <input type="radio" name="reportType" value={rt.id} checked={reportType === rt.id} onChange={(e) => setReportType(e.target.value)} className="mt-1 accent-blue-500" />
                    <div>
                      <div className={`text-sm font-bold ${reportType === rt.id ? 'text-blue-400' : 'text-slate-300'}`}>{rt.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{rt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-slate-500 mb-2">Format</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFormat('PDF')} className={`flex-1 py-2 flex items-center justify-center gap-2 rounded border text-sm font-bold transition-colors ${format === 'PDF' ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                    <FileBarChart size={16} /> PDF
                  </button>
                  <button type="button" onClick={() => setFormat('JSON')} className={`flex-1 py-2 flex items-center justify-center gap-2 rounded border text-sm font-bold transition-colors ${format === 'JSON' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
                    <FileJson size={16} /> JSON
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-slate-500 mb-2">Time Range</label>
                <select value={dateRange} onChange={e=>setDateRange(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-slate-300 focus:outline-none focus:border-blue-500 h-[42px]">
                  <option value="TODAY">Today</option>
                  <option value="LAST_24_HOURS">Last 24 Hours</option>
                  <option value="LAST_7_DAYS">Last 7 Days</option>
                  <option value="LAST_30_DAYS">Last 30 Days</option>
                  <option value="ALL_TIME">All Time (Max 1 yr)</option>
                </select>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isExporting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold tracking-widest text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isExporting ? <span className="animate-pulse">GENERATING REPORT...</span> : <><Download size={18} /> GENERATE & DOWNLOAD</>}
            </button>
          </form>
        </div>

        {/* RECENT EXPORTS */}
        <div className="flex flex-col gap-6">
          
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 flex-1">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-6">RECENT EXPORTS</h2>
            
            {lastExport ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-start gap-4">
                  <CheckCircle2 className="text-emerald-400 mt-1 shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-emerald-400 mb-1">Export Ready: {lastExport.id}</h3>
                    <div className="text-xs text-slate-400 font-mono mb-2">Generated: {new Date(lastExport.timestamp).toLocaleString()}</div>
                    <div className="flex gap-2 text-[10px] uppercase font-bold">
                      <span className="px-2 py-1 bg-slate-950 rounded text-slate-300">{lastExport.type.replace('_', ' ')}</span>
                      <span className={`px-2 py-1 bg-slate-950 rounded ${lastExport.format === 'PDF' ? 'text-rose-400' : 'text-emerald-400'}`}>{lastExport.format}</span>
                      <span className="px-2 py-1 bg-slate-950 rounded text-slate-400">{lastExport.size}</span>
                    </div>
                  </div>
                  <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded">
                    DOWNLOAD
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-slate-500">
                <FileText size={48} className="mb-4 opacity-50" />
                <p className="text-sm">No recent exports in this session.</p>
              </div>
            )}
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-400" /> COMPLIANCE NOTICE
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              All exports from the Bayezid Hybrid SOC are cryptographically signed. 
              The <strong>Veritas Ledger</strong> exports include the full Merkle tree proofs for each block. 
              Any modification to the exported JSON will invalidate the cryptographic signature during external audits.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
