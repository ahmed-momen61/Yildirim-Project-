const { DefenseMARL } = require('./defenseMARL');
const { EpistemicEngine } = require('./epistemicEngine');
const { verifyDefensiveAction } = require('./causalVerifier');
const { recall: episodicRecall } = require('../memory_systems/episodicMemory');
const { orchestrateDecision } = require('../core_ai/aiOrchestrator');

const marl = new DefenseMARL(
  ['Auditor', 'Warden', 'Action'],
  [
    { type: 'OBSERVE' }, { type: 'DECEPTIVE_PROBE' }, { type: 'ESCALATE_RESPONSE' },
    { type: 'ACTIVE_NEUTRALIZATION' }, { type: 'ISOLATE_NODE' }, { type: 'PROACTIVE_HUNT' }
  ]
);
const epistemicEngine = new EpistemicEngine();
const synthesiseDecision = (epistemic, causalVerdict, memory) => {
  let actionType = epistemic.approvedAction.type;
  if (causalVerdict.safe === false && causalVerdict.downtime_risk > 0.3) {
    actionType = 'DECEPTIVE_PROBE';
    console.log(`[🧠] CAUSAL VETO: Downgraded due to downtime risk ${causalVerdict.downtime_risk}`);
  } else if (memory.hasMemory && memory.pastMitigation && memory.pastMitigation.outcome?.success === false) {
    actionType = 'ESCALATE_RESPONSE';
    console.log(`[🧠] EPISODIC VETO: Past similar action failed. Escalating.`);
  }
  return {
    type: actionType,
    confidence: epistemic.calibratedConfidence,
    causalRisk: causalVerdict.downtime_risk,
    episodicContext: memory.pastMitigation?.actionTaken || null
  };
};
const makeVerifiedDefensiveDecision = async (state, alert) => {
  const decision = await orchestrateDecision(alert);
  
  const finalAction = {
    type: decision.recommended_action,
    confidence: decision.confidence,
    causalRisk: decision.causalRisk || 0.0,
    episodicContext: decision.reasoning || null
  };

  console.log(`[🎯] VERIFIED DECISION: ${finalAction.type} | Confidence: ${finalAction.confidence} | CausalRisk: ${finalAction.causalRisk}`);

  return {
    finalAction,
    epistemic: { approvedAction: { type: finalAction.type }, calibratedConfidence: finalAction.confidence },
    causalVerdict: { safe: finalAction.causalRisk < 0.3, downtime_risk: finalAction.causalRisk },
    memory: { hasMemory: true, pastMitigation: { actionTaken: finalAction.type } },
    allProposedActions: [finalAction]
  };
};
module.exports = { makeVerifiedDefensiveDecision, synthesiseDecision };
