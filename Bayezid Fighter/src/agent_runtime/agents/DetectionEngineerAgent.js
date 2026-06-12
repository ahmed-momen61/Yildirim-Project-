
'use strict';

const BaseAgent = require('./BaseAgent');

class DetectionEngineerAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'DetectionEngineerAgent',
            role: 'MITRE ATT&CK Mapping & Rule Validation',
            requiredTools: ['SIGMA_EVAL'],
            timeoutMs: 35000
        });
    }

    getSystemPrompt() {
        return `
You are the DetectionEngineerAgent.
Your role is to map observed attacker behavior to the MITRE ATT&CK framework.

OPERATING STANDARD:
1. Identify the primary Tactic (e.g., Initial Access, Persistence, Exfiltration).
2. Identify the specific Technique(s) (e.g., T1078 Valid Accounts).
3. Evaluate if our current Sigma ruleset is sufficient to detect this reliably.

OUTPUT FORMAT:
Return JSON strictly:
{
  "tactic": "...",
  "techniques": ["TXXXX", "TYYYY"],
  "detection_gap": boolean,
  "confidence": number (0.0 to 1.0),
  "recommendation": "UPDATE_SIGMA" | "ADEQUATE_COVERAGE"
}
`;
    }

    async execute(task, context) {
        console.log(`[🎯] ${this.agentId}: Mapping behavior to MITRE ATT&CK...`);

        const behavior = task.incident?.behavior || JSON.stringify(task.incident?.payload) || '';

        // Ask the LLM to map the behavior to MITRE
        const userPrompt = `Map this behavior to MITRE ATT&CK:\n\n${behavior}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const parsed = llmResponse.parsed_json || {
            tactic: 'Unknown',
            techniques: [],
            detection_gap: true,
            recommendation: 'UPDATE_SIGMA',
            confidence: 0.5
        };

        
        
        if (parsed.detection_gap) {
            console.log(`[🎯] ${this.agentId}: LLM suspects a detection gap. Verifying with SIGMA_EVAL...`);
            const sigmaResult = await this.callTool('SIGMA_EVAL', { behavior }, context);
            if (sigmaResult.success && sigmaResult.result?.matched) {
                console.log(`[🎯] ${this.agentId}: Sigma engine DID match. Correcting LLM gap assessment.`);
                parsed.detection_gap = false;
                parsed.recommendation = 'ADEQUATE_COVERAGE';
                
                parsed.confidence = Math.min(1.0, parsed.confidence + 0.2); 
            }
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            mitre_tactic: parsed.tactic,
            mitre_techniques: parsed.techniques,
            summary: `Mapped to ${parsed.tactic} (${parsed.techniques.join(', ')}). Gap present: ${parsed.detection_gap}`
        };
    }
}

module.exports = DetectionEngineerAgent;
