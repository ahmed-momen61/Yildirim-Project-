
'use strict';

const BaseAgent = require('./BaseAgent');

class IncidentCommanderAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'IncidentCommanderAgent',
            role: 'Hierarchical Orchestrator & Task Delegator',
            requiredTools: ['ZMQ_BLOCK', 'WINGMAN_EXEC', 'DEPLOY_DECOY'],
            timeoutMs: 60000 
        });
    }

        getSystemPrompt() {
        return `
You are the IncidentCommanderAgent, the apex orchestrator of the Bayezid SOAR cognitive layer.
Your mission is to evaluate an incoming security incident, decompose it into actionable tasks,
and delegate those tasks to the appropriate specialized agents.

AVAILABLE AGENTS:
- SecOpsGuardianAgent: Code analysis, secrets detection, payload inspection.
- ThreatIntelligenceAgent: IOC enrichment, MITRE mapping.
- ForensicsAnalystAgent: Deep system logs and timeline reconstruction.

CRITICAL RULES:
1. Fail-Closed: If the incident severity is CRITICAL and confidence is low, escalate to HITL.
2. Delegate, Don't Guess: Do not try to analyze payloads yourself; delegate to SecOpsGuardianAgent.
3. Realistic Scope: Focus strictly on the data present in the alert. Do not hallucinate lateral movement if no evidence exists.

OUTPUT FORMAT:
Return JSON strictly:
{
  "incident_understanding": "Brief summary",
  "delegation_plan": [
    { "agent_id": "AgentName", "task": "Specific task description" }
  ],
  "immediate_action": "ZMQ_BLOCK" | "DEPLOY_DECOY" | "WAIT_FOR_AGENTS" | "ESCALATE",
  "confidence": number (0.0 to 1.0)
}
`;
    }

        async execute(task, context) {
        console.log(`[🎖️] ${this.agentId}: Orchestrating incident ${task.incident?.alertId || 'UNKNOWN'}`);

        
        const userPrompt = `Incident Event:\n${JSON.stringify(task.incident)}\n\nAvailable Agents:\n${JSON.stringify(task.available_agents.map(a => a.agentId))}`;
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        const plan = llmResponse.parsed_json;
        if (!plan || !plan.delegation_plan) {
            throw new Error(`[${this.agentId}] Failed to parse delegation plan from LLM.`);
        }

        console.log(`[🎖️] ${this.agentId}: Plan created. Delegating to ${plan.delegation_plan.length} agents...`);

        
        if (plan.immediate_action === 'ZMQ_BLOCK') {
            console.log(`[🎖️] ${this.agentId}: Executing immediate containment (ZMQ_BLOCK)...`);
            const targetIp = task.incident?.sourceIp || 'UNKNOWN_IP';
            await this.callTool('ZMQ_BLOCK', { target: targetIp }, context);
        }

        
        const delegationResults = {};
        if (context.delegateTo && typeof context.delegateTo === 'function') {
            const promises = plan.delegation_plan.map(async (delegation) => {
                try {
                    const result = await context.delegateTo(delegation.agent_id, {
                        type: 'DELEGATED_TASK',
                        incident: task.incident,
                        instruction: delegation.task
                    });
                    delegationResults[delegation.agent_id] = result;
                } catch (err) {
                    console.warn(`[🎖️] ${this.agentId}: Delegation to ${delegation.agent_id} failed: ${err.message}`);
                    delegationResults[delegation.agent_id] = { error: err.message };
                }
            });

            await Promise.allSettled(promises);
        }

        
        
        
        
        return {
            success: true,
            summary: `Incident orchestrated. ${Object.keys(delegationResults).length} sub-tasks completed.`,
            confidence: plan.confidence || 0.8,
            delegation_plan: plan.delegation_plan,
            sub_agent_results: delegationResults,
            recommendation: 'REVIEW_COMPLETED_TASKS'
        };
    }
}

module.exports = IncidentCommanderAgent;
