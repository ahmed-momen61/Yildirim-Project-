
'use strict';

const BaseAgent = require('./BaseAgent');

class ThreatIntelligenceAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'ThreatIntelligenceAgent',
            role: 'CTI & IOC Enrichment Specialist',
            
            requiredTools: ['DEEP_INVESTIGATE'], 
            timeoutMs: 40000
        });
    }

    getSystemPrompt() {
        return `
You are the ThreatIntelligenceAgent, a specialist in Cyber Threat Intelligence (CTI).
Your mission is to receive raw Indicators of Compromise (IOCs) — such as IP addresses,
file hashes, or domain names — and enrich them with context.

OPERATING STANDARD:
1. Fallback to offline IOCs (RAG) when external APIs are unavailable.
2. Cross-reference findings with MITRE ATT&CK groups.
3. If an IOC is highly suspect but lacks local data, recommend 'DEEP_INVESTIGATE'.

OUTPUT FORMAT:
Return JSON strictly:
{
  "ioc_summary": "...",
  "known_threat_actors": ["...", "..."],
  "confidence": number (0.0 to 1.0),
  "recommendation": "ISOLATE" | "MONITOR" | "DEEP_INVESTIGATE" | "IGNORE"
}
`;
    }

    async execute(task, context) {
        console.log(`[🕵️] ${this.agentId}: Enriching IOCs for incident ${task.incident?.alertId || 'UNKNOWN'}...`);

        const iocs = task.incident?.iocs || [];
        if (iocs.length === 0) {
            return {
                success: true,
                recommendation: 'IGNORE',
                confidence: 1.0,
                summary: 'No IOCs provided in task payload.'
            };
        }

        
        
        console.log(`[🕵️] ${this.agentId}: Querying local offline intelligence...`);
        const simulatedOfflineIntel = {
            matches: iocs.length > 0 ? 1 : 0,
            notes: 'Simulated hit on offline threat feed.'
        };

        
        const userPrompt = `Analyze these IOCs: ${JSON.stringify(iocs)}\n\nLocal Intel Results: ${JSON.stringify(simulatedOfflineIntel)}`;
        
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        const parsed = llmResponse.parsed_json || {
            recommendation: 'DEEP_INVESTIGATE',
            confidence: 0.5,
            known_threat_actors: []
        };

        
        if (parsed.recommendation === 'DEEP_INVESTIGATE') {
            console.log(`[🕵️] ${this.agentId}: Insufficient local data. Triggering DEEP_INVESTIGATE tool...`);
            
            await this.callTool('DEEP_INVESTIGATE', { iocs, incidentId: task.incident?.alertId }, context);
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            known_threat_actors: parsed.known_threat_actors,
            summary: `Analyzed ${iocs.length} IOCs. Recommendation: ${parsed.recommendation}`
        };
    }
}

module.exports = ThreatIntelligenceAgent;
