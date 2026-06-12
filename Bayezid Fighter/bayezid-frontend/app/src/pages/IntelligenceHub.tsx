import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import * as d3 from 'd3';
import { Search, Shield, Cpu, Activity, Database, HelpCircle, Network, Terminal, CheckCircle, ChevronRight, Play } from 'lucide-react';
import { toast } from 'sonner';

// Strict Arrow Function syntax only - no function keywords allowed.
const IntelligenceHub = () => {
  const [activeTab, setActiveTab] = useState<'details' | 'investigate' | 'activeScan' | 'hypotheses' | 'breaches'>('details');
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [selectedSeed, setSelectedSeed] = useState<string>('');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  
  // Scopes and tokens for active scans
  const [targetSubnet, setTargetSubnet] = useState<string>('');
  const [roeToken, setRoeToken] = useState<string>('');
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);

  // Investigation form
  const [newSeed, setNewSeed] = useState<string>('');
  const [newSeedType, setNewSeedType] = useState<string>('ip');
  const [investigating, setInvestigating] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const loadInvestigations = async () => {
    try {
      const res = await api.fetchLatestOSINTInvestigations();
      if (res.status === 'success') {
        setInvestigations(res.data);
        if (res.data.length > 0 && !selectedSeed) {
          setSelectedSeed(res.data[0].seed);
        }
      }
    } catch (err: any) {
      toast.error(`Failed to load investigations: ${err.message}`);
    }
  };

  const loadGraph = async (seedVal: string) => {
    try {
      const res = await api.fetchOSINTGraph(seedVal);
      if (res.status === 'success') {
        setSelectedReport(res.data);
        setSelectedNode(null);
      }
    } catch (err: any) {
      toast.error(`Failed to load graph: ${err.message}`);
    }
  };

  useEffect(() => {
    loadInvestigations();
  }, []);

  useEffect(() => {
    if (selectedSeed) {
      loadGraph(selectedSeed);
    }
  }, [selectedSeed]);

  // D3 Graph Renderer
  useEffect(() => {
    if (!svgRef.current || !selectedReport?.graph) return;

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 500;

    // Clear previous elements
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    // Enable zooming and panning
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoomBehavior);

    const rawNodes = selectedReport.graph.nodes.map((n: any) => ({ ...n }));
    const rawLinks = selectedReport.graph.links.map((l: any) => ({ ...l }));

    const simulation = d3.forceSimulation(rawNodes)
      .force('link', d3.forceLink(rawLinks).id((d: any) => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(35));

    // Render edges
    const link = g.append('g')
      .selectAll('line')
      .data(rawLinks)
      .enter().append('line')
      .attr('stroke', '#334155')
      .attr('stroke-width', (d: any) => Math.max(1, d.confidence * 3))
      .attr('stroke-dasharray', (d: any) => d.label === 'associated_email' ? '4,4' : '0');

    // Node drag handlers
    const dragStarted = (event: any, d: any) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    };

    const dragged = (event: any, d: any) => {
      d.fx = event.x;
      d.fy = event.y;
    };

    const dragEnded = (event: any, d: any) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    };

    // Node color strategy
    const getNodeColor = (type: string) => {
      switch (type) {
        case 'ip': return '#f43f5e'; // rose-500
        case 'domain': return '#06b6d4'; // cyan-500
        case 'email': return '#3b82f6'; // blue-500
        case 'alias': return '#10b981'; // emerald-500
        case 'dark_web_post': return '#8b5cf6'; // violet-500
        default: return '#64748b'; // slate-500
      }
    };

    // Render nodes
    const node = g.append('g')
      .selectAll('g')
      .data(rawNodes)
      .enter().append('g')
      .call(d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded) as any)
      .on('click', (event, d: any) => {
        setSelectedNode(d);
        setActiveTab('details');
      });

    // Draw circles
    node.append('circle')
      .attr('r', 18)
      .attr('fill', (d: any) => getNodeColor(d.type))
      .attr('stroke', '#020617')
      .attr('stroke-width', 2)
      .attr('class', 'cursor-pointer hover:scale-115 transition-transform duration-150');

    // Append labels
    node.append('text')
      .text((d: any) => d.value.length > 15 ? d.value.slice(0, 12) + '...' : d.value)
      .attr('dy', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', '10px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('class', 'pointer-events-none select-none');

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('transform', (d: any) => `translate(${d.x}, ${d.y})`);
    });

  }, [selectedReport]);

  const triggerInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSeed) return;
    setInvestigating(true);
    try {
      const res = await api.runDeepOSINT(newSeed, newSeedType);
      if (res.status === 'success') {
        toast.success(`Deep scan completed for ${newSeed}`);
        await loadInvestigations();
        setSelectedSeed(newSeed);
        setNewSeed('');
      }
    } catch (err: any) {
      toast.error(`Deep scanner error: ${err.message}`);
    } finally {
      setInvestigating(false);
    }
  };

  const triggerActiveScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetSubnet || !roeToken) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await api.runNmapRecon(targetSubnet, roeToken);
      if (res.status === 'success') {
        toast.success(`Authorized active scan completed on ${targetSubnet}`);
        setScanResult(res.data);
      }
    } catch (err: any) {
      toast.error(`Recon scanner error: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-full bg-slate-950 text-slate-100 font-sans">
      {/* Left Area: Visualizer Graph */}
      <div className="flex-1 flex flex-col relative border-r border-slate-900">
        {/* Header toolbar */}
        <div className="flex items-center justify-between p-4 bg-slate-900/50 backdrop-blur-md border-b border-slate-900 shrink-0">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2 tracking-wide text-cyan-400">
              <Network size={20} className="animate-pulse" />
              OSINT THREAT SPIDER
            </h1>
            <p className="text-xs text-slate-400">Interactive multi-vector intelligence correlation graph</p>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Selected Case:</span>
            <select
              value={selectedSeed}
              onChange={(e) => setSelectedSeed(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-500"
            >
              {investigations.map((inv) => (
                <option key={inv.seed} value={inv.seed}>
                  {inv.seedType.toUpperCase()}: {inv.seed} (Conf: {(inv.confidence * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* The D3 Canvas container */}
        <div className="flex-1 w-full bg-slate-950 relative overflow-hidden">
          <svg ref={svgRef} className="w-full h-full" />
          
          {/* Visual Legend */}
          <div className="absolute bottom-4 left-4 p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-lg flex flex-col gap-2.5 text-[11px] text-slate-400 shadow-xl">
            <div className="font-semibold text-slate-300 border-b border-slate-800 pb-1 mb-1">ENTITY INDEX</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>IP Address</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>Domain Space</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>Email Address</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>AI Actor Profile</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-violet-500"></span>Dark Web Mention</div>
          </div>
        </div>
      </div>

      {/* Right Column: Actions and Detail Panels */}
      <div className="w-96 flex flex-col bg-slate-900/30 backdrop-blur-md">
        {/* Detail Tabs */}
        <div className="flex bg-slate-900/60 border-b border-slate-800 shrink-0 select-none overflow-x-auto text-xs scrollbar-none">
          {(['details', 'investigate', 'activeScan', 'hypotheses', 'breaches'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-center border-b-2 font-semibold transition-all capitalize whitespace-nowrap px-4 ${
                activeTab === tab 
                  ? 'border-cyan-400 text-cyan-400 bg-cyan-950/10' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'activeScan' ? 'Active Scan' : tab}
            </button>
          ))}
        </div>

        {/* Tab content area */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {activeTab === 'details' && (
            <div className="flex flex-col h-full">
              {!selectedNode ? (
                <div className="flex flex-col items-center justify-center text-center text-slate-500 h-full py-10">
                  <Database size={40} className="text-slate-600 mb-3" />
                  <p className="text-sm">Click any node on the graph to inspect threat attributes, pivots, and metadata.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 animate-fadeIn">
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                    <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">{selectedNode.type} Node</span>
                    <h3 className="text-lg font-bold text-slate-100 select-all break-all mt-1">{selectedNode.value}</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-900/30 border border-slate-800/80 rounded-lg">
                      <span className="text-slate-500 text-[10px] block">Confidence Level</span>
                      <span className="text-sm font-bold text-slate-200">{(selectedNode.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="p-3 bg-slate-900/30 border border-slate-800/80 rounded-lg">
                      <span className="text-slate-500 text-[10px] block">Date Discovered</span>
                      <span className="text-[11px] font-semibold text-slate-300">
                        {selectedNode.firstSeen ? new Date(selectedNode.firstSeen).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] text-slate-400 font-semibold">ATTRIBUTION DATA SOURCES</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.sources?.map((src: string) => (
                        <span key={src} className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-300 capitalize">
                          {src.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'investigate' && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                  <Search size={16} className="text-cyan-400" />
                  Trigger Deep OSINT Scanner
                </h3>
                <p className="text-xs text-slate-400">Initiates automated multi-vector collection, pivots on threat actor metadata, and runs AI reasoning.</p>
              </div>

              <form onSubmit={triggerInvestigation} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-slate-400 font-semibold">Indicator Value</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 194.26.135.2 or root-alias"
                    value={newSeed}
                    onChange={(e) => setNewSeed(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-slate-400 font-semibold">Indicator Type</label>
                  <select
                    value={newSeedType}
                    onChange={(e) => setNewSeedType(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                  >
                    <option value="ip">IPv4 Address</option>
                    <option value="domain">Domain Space</option>
                    <option value="alias">Threat Actor Alias</option>
                    <option value="email">Email Address</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={investigating}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-colors disabled:opacity-50"
                >
                  <Play size={12} fill="currentColor" />
                  {investigating ? 'Running Scans...' : 'Launch Deep Scan'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'activeScan' && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-rose-950/15 border border-rose-900/30 text-rose-200/90 rounded-lg text-xs flex gap-2">
                <Shield size={16} className="shrink-0 text-rose-500" />
                <p><strong>Warning:</strong> Active scans query target servers directly. An active Rules of Engagement (RoE) token in scope is strictly required.</p>
              </div>

              <form onSubmit={triggerActiveScan} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-slate-400 font-semibold">Subnet Scope</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 10.0.2.0/24"
                    value={targetSubnet}
                    onChange={(e) => setTargetSubnet(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] text-slate-400 font-semibold">RoE Approval Token</label>
                  <input
                    type="text"
                    required
                    placeholder="Provide your Active RoE UUID"
                    value={roeToken}
                    onChange={(e) => setRoeToken(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <button
                  type="submit"
                  disabled={scanning}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded font-bold text-xs bg-rose-700 hover:bg-rose-600 text-slate-100 transition-colors disabled:opacity-50"
                >
                  <Terminal size={12} />
                  {scanning ? 'Running Active Nmap...' : 'Trigger Active Nmap'}
                </button>
              </form>

              {scanResult && (
                <div className="mt-2 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-56 overflow-y-auto">
                  <h4 className="text-[11px] text-cyan-400 font-bold mb-1.5 flex items-center gap-1">
                    <CheckCircle size={12} /> SCAN COMPLETE (Own infrastructure)
                  </h4>
                  <pre className="text-[10px] text-slate-400 whitespace-pre font-mono">{scanResult.nmapXml}</pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'hypotheses' && (
            <div className="flex flex-col gap-4">
              {!selectedReport?.artifacts?.hypotheses?.hypotheses ? (
                <div className="text-center text-slate-500 text-xs py-8">
                  <HelpCircle size={24} className="mx-auto mb-2 text-slate-600" />
                  No AI hypotheses generated for this scan.
                </div>
              ) : (
                <div className="flex flex-col gap-4 animate-fadeIn text-xs">
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col gap-2">
                    <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">AI Hypothesis Statement</span>
                    <p className="text-slate-200 font-semibold leading-relaxed">
                      {selectedReport.artifacts.hypotheses.hypotheses.primary_hypothesis.statement}
                    </p>
                    <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 mt-1">
                      <span className="text-slate-500">Confidence Score:</span>
                      <span className="font-bold text-emerald-400">
                        {(selectedReport.artifacts.hypotheses.hypotheses.primary_hypothesis.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] text-slate-400 font-semibold">EVIDENTIARY CHAIN</span>
                    <ul className="flex flex-col gap-2">
                      {selectedReport.artifacts.hypotheses.hypotheses.primary_hypothesis.evidence_chain.map((pt: string, idx: number) => (
                        <li key={idx} className="flex gap-2 text-slate-300">
                          <ChevronRight size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {selectedReport.artifacts.hypotheses.hypotheses.primary_hypothesis.gaps?.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] text-slate-400 font-semibold">ATTRIBUTION GAPS</span>
                      <ul className="flex flex-col gap-2">
                        {selectedReport.artifacts.hypotheses.hypotheses.primary_hypothesis.gaps.map((gap: string, idx: number) => (
                          <li key={idx} className="flex gap-2 text-slate-400">
                            <span className="text-rose-400 select-none shrink-0">•</span>
                            <span>{gap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'breaches' && (
            <div className="flex flex-col gap-4">
              {!selectedReport?.artifacts?.breachHits ? (
                <div className="text-center text-slate-500 text-xs py-8">
                  <Database size={24} className="mx-auto mb-2 text-slate-600" />
                  No breach data loaded.
                </div>
              ) : (
                <div className="flex flex-col gap-4 animate-fadeIn text-xs">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wide border-b border-slate-800 pb-1.5">Exposed Breach Records</h3>
                  
                  {/* HIBP results */}
                  {selectedReport.artifacts.breachHits.hibp?.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      <span className="text-[11px] text-cyan-400 font-semibold">HaveIBeenPwned Hits</span>
                      {selectedReport.artifacts.breachHits.hibp.map((h: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-lg border border-slate-800 bg-slate-900/30">
                          <div className="font-bold text-slate-200 mb-0.5 capitalize">{h.email || h.domain}</div>
                          <div className="text-[10px] text-slate-400">{h.breaches?.length || 0} exposed records found</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Hudson Rock results */}
                  {selectedReport.artifacts.breachHits.hudson_rock?.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      <span className="text-[11px] text-cyan-400 font-semibold">Hudson Rock Cavalier Hits</span>
                      {selectedReport.artifacts.breachHits.hudson_rock.map((h: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-lg border border-slate-800 bg-slate-900/30">
                          <div className="font-bold text-slate-200 mb-0.5 break-all">{h.domain || h.ip}</div>
                          <div className="text-[10px] text-slate-400">{h.stealerData?.total || 0} infostealer malware logs</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntelligenceHub;
