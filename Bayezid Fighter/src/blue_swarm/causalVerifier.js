const axios = require('axios');
const CAUSAL_ENGINE_URL = process.env.CAUSAL_ENGINE_URL || 'http://127.0.0.1:8002';
const verifyDefensiveAction = async (actionType, targetNode, serviceDependencyEvents = []) => {
  try {
    const response = await axios.post(
      `${CAUSAL_ENGINE_URL}/api/v1/causal/verify-action`,
      { action_type: actionType, target_node: targetNode, service_dependency_events: serviceDependencyEvents },
      { timeout: 5000 }
    );
    return response.data;
  } catch (err) {
    console.warn(`[CausalVerifier] Engine unreachable: ${err.message}. Defaulting to PROCEED with warning.`);
    return { safe: true, downtime_risk: 0.0, recommendation: 'PROCEED_WITH_WARNING', confidence: 'UNAVAILABLE' };
  }
};
module.exports = { verifyDefensiveAction };
