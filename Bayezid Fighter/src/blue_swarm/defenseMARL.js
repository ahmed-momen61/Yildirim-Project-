const { EpistemicEngine } = require('./epistemicEngine');
class DefenseMARL {
    constructor(agents, possibleActions) {
        this.agents = agents; 
        this.possibleActions = possibleActions;
        this.qTable = {}; 
        this.epsilon = 0.95; 
        this.epistemicEngine = new EpistemicEngine();
        this.alpha = 0.1;  
        this.gamma = 0.95; 
    }
    getStateKey(state) {
        return `${state.anomalyDetected}_${state.decoyTripped}_${state.networkEntropy}`;
    }
    chooseJointAction(state) {
        const stateKey = this.getStateKey(state);
        if (!this.qTable[stateKey]) {
             this.qTable[stateKey] = {};
        }
        let jointAction = [];
        if (Math.random() < this.epsilon) {
            for (const agent of this.agents) {
                const randomAction = this.possibleActions[Math.floor(Math.random() * this.possibleActions.length)];
                jointAction.push({ ...randomAction, agent });
            }
            return jointAction;
        }
        for (const agent of this.agents) {
            let bestAction = this.possibleActions[0];
            let rawConfidence = state.highEntropy ? (0.75 + (Math.random() * 0.25)) : 0.99;
            if (state.anomalyDetected) {
                bestAction = this.possibleActions.find(a => a.type === 'DEPLOY_HONEY_TOKENS') || this.possibleActions[1];
            }
            if (state.decoyTripped) {
                bestAction = this.possibleActions.find(a => a.type === 'ISOLATE_NODE') || this.possibleActions[2];
            }
            if (!state.anomalyDetected && !state.decoyTripped && Math.random() > 0.5) {
                bestAction = this.possibleActions.find(a => a.type === 'PROACTIVE_HUNT') || this.possibleActions[0];
            }
            const evaluation = this.epistemicEngine.evaluateDoubtProtocol(bestAction, rawConfidence, state);
            jointAction.push({ 
                ...evaluation.approvedAction, 
                agent, 
                confidence: evaluation.calibratedConfidence,
                doubtTriggered: evaluation.doubtTriggered
            });
        }
        return jointAction;
    }
    learn(state, jointAction, globalReward, nextState) {
        let integrityReward = globalReward;
        if (nextState.lateralPivotAchieved) {
            integrityReward -= 1000; 
        }
        if (nextState.nodeIsolated && !nextState.decoyTripped && !nextState.rootGained) {
            integrityReward -= 200; 
            const wasHighlyConfident = jointAction.some(a => a.confidence >= 0.85);
            if (wasHighlyConfident) {
                console.log(`[📉] OVERCONFIDENCE PENALTY: Blue Team Hallucinated Confidence leading to False Positive.`);
                integrityReward -= 500;
            }
        }
        const deceptiveProbeUsed = jointAction.some(a => a.type === 'DECEPTIVE_PROBE');
        const escalateUsed = jointAction.some(a => a.type === 'ESCALATE_RESPONSE');
        const isolateUsed = jointAction.some(a => a.type === 'ISOLATE_NODE');
        const neutralizationUsed = jointAction.some(a => a.type === 'ACTIVE_NEUTRALIZATION');
        const maxConfidence = Math.max(...jointAction.map(a => a.confidence || 0));
        if (deceptiveProbeUsed && nextState.probeSuccessful) {
            console.log(`[🎣] PROBE SUCCESS: Red Team baited by Deceptive Probe. Confidence maxed.`);
            integrityReward += 100;
        }
        if (escalateUsed) {
            if (state.throttleCycles > 3) {
                console.log(`[📉] PASSIVE STALEMATE: Blue Team is just throttling. Failing to eradicate threat.`);
                integrityReward -= 400;
            } else {
                integrityReward += 0; 
            }
        }
        if (neutralizationUsed && nextState.threatEradicated) {
            console.log(`[🏆] HUNTER-KILLER SUCCESS: Threat surgically eradicated from node.`);
            integrityReward += 500;
        }
        if (isolateUsed && !nextState.probeSuccessful && maxConfidence < 0.70) {
            console.log(`[📉] PREMATURE ISOLATION: Blue Team isolated without prior probing and confidence < 70%.`);
            integrityReward -= 500;
        }
        if (state.highEntropy && !nextState.nodeIsolated && !nextState.rootGained) {
            console.log(`[🏅] SURVIVAL UNDER SILENCE: Blue Team maintained uptime and avoided panic isolation during chaos.`);
            integrityReward += 300;
        }
        if (state.highEntropy && integrityReward > 0) {
            integrityReward += 150;
        }
        this.epsilon = Math.max(0.01, this.epsilon * 0.995);
    }
}
module.exports = { DefenseMARL };
