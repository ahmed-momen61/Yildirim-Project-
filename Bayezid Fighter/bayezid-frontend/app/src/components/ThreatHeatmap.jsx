import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Network, ShieldAlert } from 'lucide-react';

const ThreatHeatmap = () => {
  const svgRef = useRef();
  const wrapperRef = useRef();
  const [data, setData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    fetch('/api/v2/blue/threat-heatmap')
      .then(res => res.json())
      .then(res => {
        if (res.status === 'success') {
          setData(res.data);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!data || !wrapperRef.current) return;

    const width = wrapperRef.current.clientWidth;
    const height = wrapperRef.current.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    svg.selectAll('*').remove();

    // Setup zoom
    const g = svg.append('g');
    svg.call(d3.zoom().on('zoom', (e) => {
      g.attr('transform', e.transform);
    }));

    // Definitions for arrowheads and glow
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('xoverflow', 'visible')
      .append('svg:path')
      .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
      .attr('fill', '#0ea5e9')
      .attr('opacity', 0.5);

    const simulation = d3.forceSimulation(data.nodes)
      .force('link', d3.forceLink(data.links).id(d => d.id).distance(150))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke', '#0ea5e9')
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', d => Math.max(1, d.weight * 5))
      .attr('marker-end', 'url(#arrowhead)');

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(data.nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended))
      .on('click', (e, d) => setSelectedNode(d));

    // Node circles
    node.append('circle')
      .attr('r', 15)
      .attr('fill', d => {
        if (d.risk > 80) return '#f43f5e'; // rose-500
        if (d.risk > 40) return '#f59e0b'; // amber-500
        return '#10b981'; // emerald-500
      })
      .attr('stroke', '#0f172a') // slate-900
      .attr('stroke-width', 3);

    // Pulse rings for active alerts
    node.filter(d => d.activeAlert)
      .append('circle')
      .attr('r', 25)
      .attr('fill', 'none')
      .attr('stroke', '#f43f5e')
      .attr('stroke-width', 2)
      .attr('class', 'animate-ping opacity-50 origin-center');

    // Node labels
    node.append('text')
      .text(d => d.id)
      .attr('x', 20)
      .attr('y', 5)
      .attr('font-family', 'monospace')
      .attr('font-size', '12px')
      .attr('fill', '#94a3b8'); // slate-400

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(e) {
      if (!e.active) simulation.alphaTarget(0.3).restart();
      e.subject.fx = e.subject.x;
      e.subject.fy = e.subject.y;
    }
    function dragged(e) {
      e.subject.fx = e.x;
      e.subject.fy = e.y;
    }
    function dragended(e) {
      if (!e.active) simulation.alphaTarget(0);
      e.subject.fx = null;
      e.subject.fy = null;
    }

    return () => simulation.stop();
  }, [data]);

  const handleIsolate = async () => {
    if (!selectedNode) return;
    try {
      await fetch('/api/v1/oracle-g/isolate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: selectedNode.id })
      });
      setSelectedNode(null);
      // Optimistically reload data here in a real app
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-full bg-slate-950 text-slate-200">
      <div className="flex-1 p-6 flex flex-col min-h-0 relative">
        <header className="flex items-center gap-3 mb-4 absolute top-6 left-6 z-10">
          <Network className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-slate-100 uppercase">OracleGNN Threat Topology</h1>
        </header>

        <div className="flex-1 w-full h-full border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50" ref={wrapperRef}>
          <svg ref={svgRef} className="w-full h-full" />
        </div>
      </div>

      {selectedNode && (
        <div className="w-80 border-l border-slate-800 bg-slate-900/50 p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
            <ShieldAlert className="w-6 h-6 text-cyan-400" />
            <h2 className="text-lg font-bold text-slate-100 font-mono">{selectedNode.id}</h2>
          </div>

          <div className="space-y-4 flex-1">
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Asset Type</div>
              <div className="text-sm font-bold text-slate-200 uppercase">{selectedNode.type}</div>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">GNN Risk Score</div>
              <div className={`text-2xl font-mono ${selectedNode.risk > 80 ? 'text-rose-500' : selectedNode.risk > 40 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {selectedNode.risk} / 100
              </div>
            </div>
            {selectedNode.activeAlert && (
              <div className="p-3 bg-rose-500/10 rounded-lg border border-rose-500/30">
                <div className="text-sm font-bold text-rose-500 animate-pulse">ACTIVE MNEMON PROBE ALERT</div>
              </div>
            )}
          </div>

          <div className="mt-6">
            <button 
              onClick={handleIsolate}
              className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 text-white font-bold tracking-widest text-xs uppercase rounded-lg shadow-[0_0_15px_rgba(225,29,72,0.3)] transition-all"
            >
              ISOLATE NODE
            </button>
            <button 
              onClick={() => setSelectedNode(null)}
              className="w-full py-2 px-4 mt-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold tracking-widest text-xs uppercase rounded-lg transition-all"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreatHeatmap;
