const { oracleGNN } = require('../../../blue_swarm/oracleGNN');

const OSINT_CONFIDENCE_THRESHOLD = parseFloat(process.env.OSINT_GNN_THRESHOLD || '0.75');

const injectOsintEntityIntoGNN = (osintArtifacts, investigationConfidence) => {
  if (investigationConfidence < OSINT_CONFIDENCE_THRESHOLD) {
    console.log(`[OSINT-GNN] Confidence ${investigationConfidence} below threshold ${OSINT_CONFIDENCE_THRESHOLD}. Not injecting into GNN.`);
    return [];
  }

  const injected = [];
  for (const ip of (osintArtifacts.confirmedIPs || [])) {
    oracleGNN.addNode(ip, {
      hostname: osintArtifacts.ipHostnameMap?.[ip] || '',
      os: 'unknown',
      services: osintArtifacts.ipServicesMap?.[ip] || []
    });
    const node = oracleGNN.nodes.get(ip);
    if (node) {
      node.risk = Math.round(investigationConfidence * 100);
      injected.push(ip);
      console.log(`[OSINT-GNN] Injected external threat entity ${ip} with risk ${node.risk} into NetworkGNN`);
    }
  }
  return injected;
};

module.exports = { injectOsintEntityIntoGNN };
