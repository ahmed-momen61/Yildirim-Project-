class ArtifactGraph {
  constructor() {
    this.nodes = new Map(); 
    this.edges = [];        
  }

  addNode = (type, value, confidence = 1.0, sources = []) => {
    const id = `${type}::${value}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type, value, confidence, sources, firstSeen: Date.now() });
    } else {
      const node = this.nodes.get(id);
      node.confidence = Math.max(node.confidence, confidence);
      node.sources = [...new Set([...node.sources, ...sources])];
    }
    return id;
  };

  addEdge = (fromId, toId, relation, confidence = 1.0) => {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return;
    this.edges.push({ from: fromId, to: toId, relation, confidence, timestamp: Date.now() });
  };

  findConnectedTo = (nodeId, maxDepth = 3) => {
    const visited = new Set([nodeId]);
    const queue   = [{ id: nodeId, depth: 0 }];
    const results = [];
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (depth >= maxDepth) continue;
      for (const edge of this.edges) {
        if (edge.from === id && !visited.has(edge.to)) {
          visited.add(edge.to);
          results.push({ node: this.nodes.get(edge.to), via: edge });
          queue.push({ id: edge.to, depth: depth + 1 });
        }
      }
    }
    return results;
  };

  toD3Format = () => ({
    nodes: [...this.nodes.values()],
    links: this.edges.map((e) => ({ source: e.from, target: e.to, label: e.relation, confidence: e.confidence }))
  });
}

module.exports = { ArtifactGraph };
