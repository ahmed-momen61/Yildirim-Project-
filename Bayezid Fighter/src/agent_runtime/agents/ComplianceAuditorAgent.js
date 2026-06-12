
'use strict';

const BaseAgent = require('./BaseAgent');

class ComplianceAuditorAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'ComplianceAuditorAgent',
            role: 'Regulatory Compliance & Privacy Auditor',
            requiredTools: [],
            timeoutMs: 30000
        });
    }

    getSystemPrompt() {
        return `
You are the ComplianceAuditorAgent.
Your mission is to evaluate security incidents and proposed response actions against
major regulatory frameworks (GDPR, PCI-DSS, HIPAA, SOC2).

OPERATING STANDARD:
1. PII Awareness: Flag any incident involving Personally Identifiable Information.
2. Reporting Mandates: Identify if an incident requires 72-hour regulatory notification.
3. Safe Actions: Ensure proposed response actions (like memory dumps) do not accidentally expose PII to unauthorized logs.

OUTPUT FORMAT:
Return JSON strictly:
{
  "frameworks_impacted": ["GDPR", "PCI-DSS"],
  "pii_exposed": boolean,
  "breach_notification_required": boolean,
  "confidence": number (0.0 to 1.0),
  "recommendation": "COMPLIANT" | "FLAG_FOR_LEGAL"
}
`;
    }

    async execute(task, context) {
        console.log(`[📋] ${this.agentId}: Assessing regulatory compliance...`);

        const incidentData = JSON.stringify(task.incident || {});
        const proposedAction = task.proposedAction || 'None';

        const userPrompt = `Assess compliance for this incident:\n\nIncident: ${incidentData}\nProposed Action: ${proposedAction}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const parsed = llmResponse.parsed_json || {
            frameworks_impacted: [],
            pii_exposed: false,
            breach_notification_required: false,
            recommendation: 'FLAG_FOR_LEGAL',
            confidence: 0.5
        };

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence,
            frameworks: parsed.frameworks_impacted,
            pii_exposed: parsed.pii_exposed,
            breach_notification: parsed.breach_notification_required,
            summary: `Compliance check complete. PII Exposed: ${parsed.pii_exposed}. Frameworks: ${parsed.frameworks_impacted.join(', ')}`
        };
    }
}

module.exports = ComplianceAuditorAgent;
