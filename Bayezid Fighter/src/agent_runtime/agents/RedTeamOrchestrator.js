
'use strict';

const BaseAgent = require('./BaseAgent');

class RedTeamOrchestrator extends BaseAgent {
    constructor() {
        super({
            agentId: 'RedTeamOrchestrator',
            role: 'Offensive Execution & Adversary Simulation',
            
            requiredTools: ['CHIMERA_MUTATION', 'WINGMAN_EXEC'],
            timeoutMs: 60000 
        });
    }

    getSystemPrompt() {
        return `
You are the RedTeamOrchestrator.
Your mission is to simulate adversary behavior using Bayezid's advanced offensive tools:
Chimera (for payload mutation) and Wingman (for execution loops).

OPERATING STANDARD:
1. Offensive Mindset: Think like an advanced persistent threat (APT).
2. Evade Detections: Use Chimera to mutate payloads specifically to bypass Sigma rules.
3. Supervised Execution: Any actual execution via Wingman requires strict HITL gating.

OUTPUT FORMAT:
Return JSON strictly:
{
  "attack_vector_summary": "...",
  "recommended_mutation_level": number (1 to 5),
  "confidence": number (0.0 to 1.0),
  "recommendation": "INVOKE_CHIMERA" | "INVOKE_WINGMAN" | "ABORT_SIMULATION"
}
`;
    }

    async execute(task, context) {
        console.log(`[👿] ${this.agentId}: Planning adversary simulation...`);

        const simulationTarget = task.simulationTarget || task.incident?.payload || 'Default_Test_Payload';

        const userPrompt = `Simulate an attack on this target/payload:\n\n${simulationTarget}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const parsed = llmResponse.parsed_json || {
            attack_vector_summary: 'Failed to parse',
            recommended_mutation_level: 1,
            recommendation: 'ABORT_SIMULATION',
            confidence: 0.0
        };

        
        if (parsed.recommendation === 'INVOKE_CHIMERA') {
            console.log(`[👿] ${this.agentId}: Invoking CHIMERA_MUTATION at level ${parsed.recommended_mutation_level}...`);
            const chimeraResult = await this.callTool('CHIMERA_MUTATION', { 
                payload: simulationTarget, 
                level: parsed.recommended_mutation_level 
            }, context);

            if (chimeraResult.success) {
                return {
                    success: true,
                    recommendation: 'CHIMERA_MUTATION_COMPLETE',
                    confidence: parsed.confidence,
                    mutated_payload: chimeraResult.result,
                    summary: `Successfully mutated payload to level ${parsed.recommended_mutation_level}.`
                };
            } else {
                return {
                    success: false,
                    recommendation: 'ABORT_SIMULATION',
                    confidence: 0.1,
                    summary: `Chimera mutation failed: ${chimeraResult.error}`
                };
            }
        }

        
        if (parsed.recommendation === 'INVOKE_WINGMAN') {
            console.log(`[👿] ${this.agentId}: Invoking WINGMAN_EXEC (Requires HITL)...`);
            const wingmanResult = await this.callTool('WINGMAN_EXEC', { target: simulationTarget }, context);
            
            return {
                success: wingmanResult.success,
                recommendation: wingmanResult.success ? 'WINGMAN_EXEC_COMPLETE' : 'WINGMAN_EXEC_BLOCKED',
                confidence: parsed.confidence,
                summary: wingmanResult.success ? 'Wingman execution finished.' : `Wingman blocked/failed: ${wingmanResult.error}`
            };
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            summary: `Simulation planned but aborted: ${parsed.attack_vector_summary}`
        };
    }
}

module.exports = RedTeamOrchestrator;
