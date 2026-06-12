import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { api, TopologyData } from '../lib/api';
import { toast } from 'sonner';
import { Crosshair, Shield } from 'lucide-react';

export default function SwarmArena() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [topology, setTopology] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTopology = async () => {
    try {
      const data = await api.fetchThreatHeatmap();
      setTopology(data);
    } catch (e) {
      console.error('Failed to fetch topology', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopology();
    const interval = setInterval(fetchTopology, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!topology || !svgRef.current) return;

    const width = svgRef.current.parentElement?.clientWidth || 800;
    const height = svgRef.current.parentElement?.clientHeight || 600;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const simulation = d3.forceSimulation(topology.nodes as any)
      .force("link", d3.forceLink(topology.edges).id((d: any) => d.ip).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(30));

    const link = svg.append("g")
      .selectAll("line")
      .data(topology.edges)
      .join("line")
      .attr("stroke", "#334155")
      .attr("stroke-width", (d: any) => Math.sqrt(d.weight || 1));

    const node = svg.append("g")
      .selectAll("circle")
      .data(topology.nodes)
      .join("circle")
      .attr("r", (d: any) => d.risk > 50 ? 12 : 8)
      .attr("fill", (d: any) => {
        if (d.isolated) return '#94a3b8'; // grey for isolated
        if (d.risk > 70) return '#f43f5e'; // red for compromised/attacker
        return '#0ea5e9'; // blue for defender/normal
      })
      .attr("stroke", (d: any) => d.isolated ? '#cbd5e1' : '#0284c7')
      .attr("stroke-width", 2)
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    const labels = svg.append("g")
      .selectAll("text")
      .data(topology.nodes)
      .join("text")
      .text((d: any) => d.ip)
      .attr("font-size", "10px")
      .attr("fill", "#cbd5e1")
      .attr("dx", 15)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

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

    return () => {
      simulation.stop();
    };
  }, [topology]);

  const handleLaunchScout = async () => {
    try {
      await api.startRedSwarmScout({ targetSubnet: '10.0.0.0/24' });
      toast.success('Red Swarm Scout launched.');
    } catch (e: any) {
      toast.error('Failed to launch scout: ' + e.message);
    }
  };

  const handleIsolateNode = async () => {
    const ip = prompt('Enter IP to isolate:');
    if (!ip) return;
    try {
      await api.isolateNode(ip);
      toast.success(`${ip} isolated successfully.`);
      fetchTopology();
    } catch (e: any) {
      toast.error('Failed to isolate: ' + e.message);
    }
  };

  return (
    <div className="flex h-full">
      {/* Canvas Area */}
      <div className="flex-1 bg-slate-950 relative overflow-hidden">
        {loading && <div className="absolute inset-0 flex items-center justify-center text-slate-500">Loading Topology...</div>}
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* Control Panel */}
      <div className="w-72 border-l border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Crosshair className="text-rose-500" />
            SWARM ARENA
          </h2>
          <p className="text-xs text-slate-400 mt-1">Live Threat Topography & Kinetic Warfare</p>
        </div>

        <div className="space-y-4">
          <div className="p-3 rounded border border-rose-500/30 bg-rose-500/5">
            <h3 className="text-sm font-semibold text-rose-400 mb-2">Red Controls</h3>
            <button 
              onClick={handleLaunchScout}
              className="w-full py-2 bg-rose-500 hover:bg-rose-600 text-white rounded text-sm transition-colors"
            >
              Deploy Scout Swarm
            </button>
          </div>

          <div className="p-3 rounded border border-cyan-500/30 bg-cyan-500/5">
            <h3 className="text-sm font-semibold text-cyan-400 mb-2 flex items-center gap-2">
              <Shield size={16} /> Blue Controls
            </h3>
            <button 
              onClick={handleIsolateNode}
              className="w-full py-2 border border-cyan-500 hover:bg-cyan-500/20 text-cyan-400 rounded text-sm transition-colors"
            >
              Isolate Compromised Node
            </button>
          </div>
        </div>

        <div className="mt-auto">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span className="w-3 h-3 rounded-full bg-[#f43f5e]"></span> Compromised
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span className="w-3 h-3 rounded-full bg-[#0ea5e9]"></span> Healthy
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-3 h-3 rounded-full bg-[#94a3b8]"></span> Isolated
          </div>
        </div>
      </div>
    </div>
  );
}
