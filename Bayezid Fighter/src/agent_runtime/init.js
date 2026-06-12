
'use strict';

const AgentRuntime = require('./AgentRuntime');
const { ToolRouter, RISK_LEVEL } = require('./ToolRouter');
const HITLGate = require('./HITLGate');
const EpisodicMemory = require('./memory/EpisodicMemory');
const SemanticMemory = require('./memory/SemanticMemory');
const ShortTermMemory = require('./memory/ShortTermMemory');


const IncidentCommanderAgent = require('./agents/IncidentCommanderAgent');
const SecOpsGuardianAgent = require('./agents/SecOpsGuardianAgent');
const ThreatIntelligenceAgent = require('./agents/ThreatIntelligenceAgent');
const DetectionEngineerAgent = require('./agents/DetectionEngineerAgent');
const ForensicsAnalystAgent = require('./agents/ForensicsAnalystAgent');
const RedTeamOrchestrator = require('./agents/RedTeamOrchestrator');
const ComplianceAuditorAgent = require('./agents/ComplianceAuditorAgent');
const DefenseSwarmOrchestrator = require('./agents/DefenseSwarmOrchestrator');

let runtimeInstance = null;

function initializeRuntime(redisClient) {
    if (runtimeInstance) {
        return runtimeInstance;
    }

    console.log('[🧠] Bootstrapping CHIMERA-OMEGA AgentRuntime...');

    
    const hitlGate = new HITLGate(redisClient, { defaultTimeoutMs: 60000 });

    
    const toolRouter = new ToolRouter({ hitlGate });

    
    

    
    runtimeInstance = new AgentRuntime({
        toolRouter,
        hitlGate,
        maxReflectionDepth: 3
    });

    
    const globalEpisodic = new EpisodicMemory(redisClient, 'global');
    const globalSemantic = new SemanticMemory(redisClient, 'bayezid:semantic');

    
    const register = (AgentClass) => {
        const agent = new AgentClass();
        const stm = new ShortTermMemory(50);
        runtimeInstance.registerAgent(agent, {
            shortTerm: stm,
            episodic: globalEpisodic,
            semantic: globalSemantic
        });
        console.log(`[🤖] Registered Agent: ${agent.agentId}`);
    };

    
    register(IncidentCommanderAgent);
    register(SecOpsGuardianAgent);
    register(ThreatIntelligenceAgent);
    register(DetectionEngineerAgent);
    register(ForensicsAnalystAgent);
    register(RedTeamOrchestrator);
    register(ComplianceAuditorAgent);
    register(DefenseSwarmOrchestrator);

    console.log('[🚀] CHIMERA-OMEGA AgentRuntime fully bootstrapped and ready.');

    return runtimeInstance;
}

function getRuntime() {
    if (!runtimeInstance) {
        throw new Error('AgentRuntime is not initialized. Call initializeRuntime(redisClient) first.');
    }
    return runtimeInstance;
}

module.exports = {
    initializeRuntime,
    getRuntime
};
