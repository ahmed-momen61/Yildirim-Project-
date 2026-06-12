import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { GitBranch, Terminal, Play } from 'lucide-react';

const MOCK_DAG = {
  nodes: [
    { id: 'A', label: 'Initial Access (Phishing)', type: 'cause' },
    { id: 'B', label: 'Execution (PowerShell)', type: 'cause' },
    { id: 'C', label: 'Privilege Escalation', type: 'cause' },
    { id: 'D', label: 'Credential Access (LSASS)', type: 'effect' },
    { id: 'E', label: 'Lateral Movement (SMB)', type: 'effect' },
    { id: 'F', label: 'Data Exfiltration', type: 'effect' },
  ],
  links: [
    { source: 'A', target: 'B', probability: 0.9 },
    { source: 'B', target: 'C', probability: 0.7 },
    { source: 'C', target: 'D', probability: 0.85 },
    { source: 'D', target: 'E', probability: 0.95 },
    { source: 'E', target: 'F', probability: 0.6 },
    { source: 'B', target: 'E', probability: 0.4 },
  ]
};

const AVAILABLE_PROBES = [
  { id: 'sys_execve', label: 'Process Execution (execve)', active: true },
  { id: 'sys_ptrace', label: 'Process Injection (ptrace)', active: false },
  { id: 'tcp_sendmsg', label: 'Network Egress (tcp_send)', active: true },
  { id: 'vfs_read', label: 'File Reads (vfs_read)', active: false },
];

export default function CausalDAGMonitor() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [probes, setProbes] = useState(AVAILABLE_PROBES);

  useEffect(() => {
    if (!svgRef.current) return;

    const width = svgRef.current.parentElement?.clientWidth || 800;
    const height = svgRef.current.parentElement?.clientHeight || 600;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Setup arrow markers
    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 25) // push arrowhead to edge of circle
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("xoverflow", "visible")
      .append("svg:path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#64748b")
      .style("stroke", "none");

    const simulation = d3.forceSimulation(MOCK_DAG.nodes as any)
      .force("link", d3.forceLink(MOCK_DAG.links).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-800))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX().strength(0.1))
      .force("y", d3.forceY().strength(0.1));

    const link = svg.append("g")
      .selectAll("path")
      .data(MOCK_DAG.links)
      .join("path")
      .attr("stroke", (d: any) => d.probability > 0.8 ? "#ef4444" : "#64748b")
      .attr("stroke-width", 2)
      .attr("fill", "none")
      .attr("marker-end", "url(#arrowhead)");

    const linkLabels = svg.append("g")
      .selectAll("text")
      .data(MOCK_DAG.links)
      .join("text")
      .text((d: any) => `P=${d.probability}`)
      .attr("font-size", "10px")
      .attr("fill", "#cbd5e1")
      .attr("text-anchor", "middle");

    const node = svg.append("g")
      .selectAll("circle")
      .data(MOCK_DAG.nodes)
      .join("circle")
      .attr("r", 18)
      .attr("fill", (d: any) => d.type === 'cause' ? '#0ea5e9' : '#f59e0b')
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 3)
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    const labels = svg.append("g")
      .selectAll("text")
      .data(MOCK_DAG.nodes)
      .join("text")
      .text((d: any) => d.label)
      .attr("font-size", "12px")
      .attr("font-weight", "500")
      .attr("fill", "#f8fafc")
      .attr("dx", 22)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link.attr("d", (d: any) => {
        const dx = d.target.x - d.source.x,
              dy = d.target.y - d.source.y,
              dr = Math.sqrt(dx * dx + dy * dy);
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });

      linkLabels
        .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
        .attr("y", (d: any) => (d.source.y + d.target.y) / 2 - 10);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);

      labels
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });

    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return () => simulation.stop();
  }, []);

  const toggleProbe = (id: string) => {
    setProbes(prev => prev.map(p => p.id === id ? { ...p, active: !p.active } : p));
  };

  const handleApplyProbes = async () => {
    const activeSyscalls = probes.filter(p => p.active).map(p => p.id);
    try {
      await api.activateEBPFProbes(activeSyscalls);
      toast.success(`Successfully loaded ${activeSyscalls.length} eBPF probes into kernel space.`);
    } catch (e: any) {
      toast.error('Failed to attach eBPF probes: ' + e.message);
    }
  };

  return (
    <div className="flex h-full">
      {/* Main Graph Area */}
      <div className="flex-1 bg-slate-950 relative overflow-hidden flex flex-col">
        <div className="absolute top-4 left-6 z-10">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <GitBranch className="text-cyan-400" />
            CAUSAL DAG MONITOR
          </h1>
          <p className="text-sm text-slate-400">Do-Calculus Inference & Kernel Telemetry Mapping</p>
        </div>
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* eBPF Probe Control Panel */}
      <div className="w-80 border-l border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="text-amber-400" />
            Mnemon eBPF Probes
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Toggle kernel-space telemetry probes. Data feeds directly into the Causal DAG engine.
          </p>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {probes.map(probe => (
            <div key={probe.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-900/80">
              <span className="text-sm font-medium text-slate-300 font-mono">{probe.label}</span>
              <button
                onClick={() => toggleProbe(probe.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                  probe.active ? 'bg-cyan-500' : 'bg-slate-700'
                }`}
              >
                <span className="sr-only">Toggle {probe.label}</span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    probe.active ? 'translate-x-2' : '-translate-x-2'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900">
          <button 
            onClick={handleApplyProbes}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-md transition-colors"
          >
            <Play size={16} />
            Compile & Attach Probes
          </button>
        </div>
      </div>
    </div>
  );
}
