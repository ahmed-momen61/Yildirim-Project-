const { findSimilarIncidents, findSimilarMitigation, saveMitigationStrategy } = require('./memoryService');
const recall = async (alert) => {
  const contextString = `${alert.alertType} from ${alert.sourceIp} targeting ${alert.path || 'unknown'}`;
  const [pastIncident, pastMitigation] = await Promise.all([
    findSimilarIncidents(contextString),
    findSimilarMitigation(contextString)
  ]);
  return {
    pastIncident,
    pastMitigation,
    confidence: pastMitigation ? pastMitigation.similarity : 0.0,
    hasMemory: !!(pastIncident || pastMitigation)
  };
};
const learn = async (alertId, attackType, actionTaken, outcome, mitreTechniques) => {
  await saveMitigationStrategy(alertId, attackType, actionTaken, outcome, mitreTechniques);
  console.log(`[🧠] Episodic Memory: Learned mitigation for ${attackType} → ${actionTaken}`);
};
module.exports = { recall, learn };
