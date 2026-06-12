const { HeuristicWatchdog } = require('./heuristicWatchdog');
class EpistemicEngine {
    constructor() {
        this.confidenceThreshold = 0.85; 
        this.dropoutRate = 0.20; 
        this.watchdog = new HeuristicWatchdog();
    }
    applyMonteCarloDropout(baseConfidence) {
        let droppedNodes = 0;
        for (let i = 0; i < 10; i++) {
            if (Math.random() < this.dropoutRate) droppedNodes++;
        }
        const dropoutPenalty = droppedNodes * 0.05 * Math.random();
        return Math.max(0, baseConfidence - dropoutPenalty);
    }
    evaluateDoubtProtocol(proposedAction, rawConfidence, state) {
        const calibratedConfidence = this.applyMonteCarloDropout(rawConfidence);
        let finalActionType = proposedAction.type;
        let doubtTriggered = false;
        let isHeuristicBreach = false;
        if (state) {
            const metrics = this.watchdog.getSystemMetrics(state);
            isHeuristicBreach = this.watchdog.evaluateBehavioralBreach(metrics);
        }
        if (proposedAction.type === 'ISOLATE_NODE' || proposedAction.type === 'DEPLOY_HONEY_TOKENS' || proposedAction.type === 'ACTIVE_NEUTRALIZATION') {
            if (calibratedConfidence >= 0.95 && state && state.highEntropy && !isHeuristicBreach) {
                console.log(`\n[🐺] WATCHDOG ARBITER: Vetoing high-confidence isolation. Heuristics are quiet.`);
                finalActionType = 'DECEPTIVE_PROBE';
                doubtTriggered = true;
            } else if (calibratedConfidence < 0.40) {
                if (isHeuristicBreach) {
                    console.log(`\n[🐺] WATCHDOG ARBITER: Confidence is low, but Heuristics spiked! Forcing Escalation.`);
                    finalActionType = 'ESCALATE_RESPONSE';
                    doubtTriggered = true;
                } else {
                    console.log(`\n[🤔] EPISTEMIC DOUBT: Confidence (${(calibratedConfidence * 100).toFixed(1)}%) < 40%. Level 1.`);
                    console.log(`    Action overridden to [PASSIVE_OBSERVATION].`);
                    finalActionType = 'OBSERVE';
                    doubtTriggered = true;
                }
            } else if (calibratedConfidence >= 0.40 && calibratedConfidence <= 0.65) {
                console.log(`\n[🎣] DECEPTIVE PROBE: Confidence (${(calibratedConfidence * 100).toFixed(1)}%) in target window. Level 2.`);
                console.log(`    Action overridden to [DECEPTIVE_PROBE]. Initiating fake request.`);
                finalActionType = 'DECEPTIVE_PROBE';
                doubtTriggered = true;
            } else if (calibratedConfidence > 0.65 && calibratedConfidence <= 0.80) {
                console.log(`\n[🚧] CALIBRATED AGGRESSION: Confidence (${(calibratedConfidence * 100).toFixed(1)}%) in target window. Level 3.`);
                console.log(`    Action overridden to [ESCALATE_RESPONSE] / [COUNTER_FLOOD]. Throttling and hunting.`);
                finalActionType = 'ESCALATE_RESPONSE'; 
                doubtTriggered = true;
            } else if (calibratedConfidence > 0.80 && calibratedConfidence < 0.95) {
                console.log(`\n[⚔️] THE HUNTER-KILLER: Confidence (${(calibratedConfidence * 100).toFixed(1)}%) in target window. Level 4.`);
                console.log(`    Action overridden to [ACTIVE_NEUTRALIZATION]. Executing surgical strike.`);
                finalActionType = 'ACTIVE_NEUTRALIZATION';
                doubtTriggered = true;
            } else if (calibratedConfidence >= 0.95) {
                finalActionType = 'ISOLATE_NODE';
            }
        }
        return {
            approvedAction: { type: finalActionType, agent: proposedAction.agent },
            calibratedConfidence: calibratedConfidence,
            doubtTriggered: doubtTriggered
        };
    }
}
module.exports = { EpistemicEngine };
