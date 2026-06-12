'use strict';

const BaseAgent = require('./BaseAgent');

class ScribeAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'ScribeAgent',
            role: 'Forensic Reporter & ITSM Documenter',
            requiredTools: ['WRITE_FILE', 'JIRA_TICKET', 'SLACK_NOTIFY'],
            timeoutMs: 60000
        });
    }

    getSystemPrompt() {
        return `
You are the ScribeAgent, the principal documentation and forensic reporting engine for Bayezid SOAR.
Your mission is to ingest raw incident data, agent execution logs, and network artifacts to produce:
1. Executive Summaries for C-Suite readability.
2. Deep Forensic Timelines for the SOC tier 3 analysts.
3. Formatted JSON for ITSM ticketing (ServiceNow, Jira, etc).

CRITICAL RULES:
1. Objectivity: Do not hallucinate data. Only report facts provided in the context.
2. Formatting: Output strictly according to the specified JSON schema.
3. Prioritization: Escalate the Urgency field if the incident involves lateral movement, data exfiltration, or critical infrastructure.

OUTPUT FORMAT:
Return JSON strictly:
{
  "executive_summary": "A concise paragraph summarizing the incident.",
  "forensic_timeline": ["Event 1", "Event 2", ...],
  "itsm_ticket": {
    "title": "Incident Title",
    "description": "Full technical description.",
    "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    "urgency": "HIGH" | "MEDIUM" | "LOW",
    "assigned_group": "SOC" | "IR" | "NETWORK"
  },
  "confidence": number (0.0 to 1.0)
}
`;
    }

    async execute(task, context) {
        console.log(`[📝] ${this.agentId} generating comprehensive forensic report...`);

        const rawData = task.incident || task.data || {};
        const agentLogs = task.logs || context.history || [];

        if (Object.keys(rawData).length === 0) {
            return {
                success: false,
                error: 'No incident data provided for reporting.'
            };
        }

        const userPrompt = `Generate a forensic report based on the following context:\n\nIncident Data:\n${JSON.stringify(rawData)}\n\nAgent Execution Logs:\n${JSON.stringify(agentLogs)}`;

        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);

        const parsed = llmResponse.parsed_json || {
            executive_summary: "Automated report generation failed parsing.",
            forensic_timeline: [],
            itsm_ticket: {
                title: "Undiagnosed Security Event",
                description: "Failed to parse LLM output.",
                severity: "LOW",
                urgency: "LOW",
                assigned_group: "SOC"
            },
            confidence: 0.1
        };

        // Simulated ITSM tool invocation if real mode
        if (process.env.EXECUTION_MODE === 'REAL') {
            console.log(`[📝] ${this.agentId} invoking ITSM ticket creation...`);
            try {
                await this.callTool('JIRA_TICKET', parsed.itsm_ticket, context);
            } catch (err) {
                console.warn(`[⚠️] ${this.agentId} ITSM ticket creation failed: ${err.message}`);
            }
        }

        return {
            success: true,
            report: parsed,
            summary: `Report generated successfully. ITSM Ticket: ${parsed.itsm_ticket.title}`,
            confidence: parsed.confidence || llmResponse.confidence
        };
    }
}

module.exports = ScribeAgent;
