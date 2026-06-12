
'use strict';

const BaseAgent = require('./BaseAgent');

class DefenseSwarmOrchestrator extends BaseAgent {
    constructor() {
        super({
            agentId: 'DefenseSwarmOrchestrator',
            role: 'Blue Team Defense Coordination',
            requiredTools: ['GNN_PROPAGATE', 'DEPLOY_DECOY', 'LORA_TRAIN'],
            timeoutMs: 45000
        });
    }

    getSystemPrompt() {
        return `
You are the DefenseSwarmOrchestrator, replacing the legacy defenseMARL system.
Your role is to orchestrate defensive actions across the network graph.

OPERATING STANDARD:
1. Blast Radius: Use the GNN to calculate the topological blast radius of an infection.
2. Decoy Deployment: Deploy decoys ahead of the attacker's expected lateral movement path.
3. Continuous Learning: Suggest LoRA training parameters based on successful defensive maneuvers.

OUTPUT FORMAT:
Return JSON strictly:
{
  "defensive_strategy": "...",
  "confidence": number (0.0 to 1.0),
  "recommendation": "DEPLOY_DECOYS" | "ISOLATE_SUBNET" | "MONITOR_ONLY"
}
`;
    }

    async execute(task, context) {
        console.log(`[🛡️] ${this.agentId}: Formulating swarm defense strategy...`);

        const compromisedNode = task.incident?.targetNode || 'UNKNOWN_NODE';

        
        console.log(`[🛡️] ${this.agentId}: Querying GNN for blast radius of ${compromisedNode}...`);
        const gnnResult = await this.callTool('GNN_PROPAGATE', { startNode: compromisedNode }, context);
        
        const blastRadius = gnnResult.success ? gnnResult.result : 'GNN Unavailable';

        
        const userPrompt = `Compromised Node: ${compromisedNode}\nBlast Radius Topology: ${JSON.stringify(blastRadius)}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const parsed = llmResponse.parsed_json || {
            defensive_strategy: 'Fallback to isolation.',
            recommendation: 'ISOLATE_SUBNET',
            confidence: 0.5
        };

        
        if (parsed.recommendation === 'DEPLOY_DECOYS') {
            console.log(`[🛡️] ${this.agentId}: Deploying decoys along predicted lateral path...`);
            await this.callTool('DEPLOY_DECOY', { targetSubnet: 'Predicted_Path_Subnet' }, context);
        }

        
        
        if (parsed.confidence > 0.9) {
            console.log(`[🛡️] ${this.agentId}: High confidence strategy generated. Dispatching to LORA_TRAIN...`);
            await this.callTool('LORA_TRAIN', {
                episodeData: { node: compromisedNode, strategy: parsed.defensive_strategy }
            }, context);
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            summary: `Defense strategy formulated: ${parsed.defensive_strategy}`
        };
    }
}

module.exports = DefenseSwarmOrchestrator;
