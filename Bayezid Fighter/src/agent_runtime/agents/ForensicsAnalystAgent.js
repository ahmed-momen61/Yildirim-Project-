
'use strict';

const BaseAgent = require('./BaseAgent');

class ForensicsAnalystAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'ForensicsAnalystAgent',
            role: 'Digital Forensics & Timeline Reconstruction',
            requiredTools: ['VERITAS_PROOF'],
            timeoutMs: 45000
        });
    }

    getSystemPrompt() {
        return `
You are the ForensicsAnalystAgent.
Your job is to reconstruct the exact timeline of a security incident and preserve evidence integrity.

OPERATING STANDARD:
1. Chronological Ordering: Organize all events sequentially.
2. Causal Links: Identify what caused what (e.g., 'Phishing Email -> Executable Download -> C2 Beacon').
3. Evidence Integrity: Ensure zero-knowledge proofs (Veritas) are used for critical evidence.

OUTPUT FORMAT:
Return JSON strictly:
{
  "timeline": ["[HH:MM:SS] Event 1", "[HH:MM:SS] Event 2"],
  "root_cause_identified": boolean,
  "confidence": number (0.0 to 1.0),
  "recommendation": "PRESERVE_EVIDENCE" | "INSUFFICIENT_LOGS"
}
`;
    }

    async execute(task, context) {
        console.log(`[🔎] ${this.agentId}: Reconstructing timeline...`);

        const logs = task.incident?.logs || [];
        
        if (logs.length === 0) {
            return {
                success: true,
                recommendation: 'INSUFFICIENT_LOGS',
                confidence: 1.0,
                summary: 'No logs provided for forensic timeline reconstruction.'
            };
        }

        const userPrompt = `Reconstruct timeline from these logs:\n\n${JSON.stringify(logs)}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const parsed = llmResponse.parsed_json || {
            timeline: [],
            root_cause_identified: false,
            recommendation: 'INSUFFICIENT_LOGS',
            confidence: 0.4
        };

        
        if (parsed.root_cause_identified && parsed.recommendation === 'PRESERVE_EVIDENCE') {
            console.log(`[🔎] ${this.agentId}: Root cause found. Generating Veritas ZK-proof for evidence vault...`);
            await this.callTool('VERITAS_PROOF', { data: parsed.timeline }, context);
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            timeline: parsed.timeline,
            summary: `Timeline reconstructed (${parsed.timeline.length} events). Root cause found: ${parsed.root_cause_identified}`
        };
    }
}

module.exports = ForensicsAnalystAgent;
