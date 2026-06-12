
'use strict';

const BaseAgent = require('./BaseAgent');

class SecOpsGuardianAgent extends BaseAgent {
    constructor() {
        super({
            agentId: 'SecOpsGuardianAgent',
            role: 'Defensive Security Auditor & Pattern Matcher',
            requiredTools: ['SIGMA_EVAL', 'ML_SNIPER'],
            timeoutMs: 45000
        });
    }

        getSystemPrompt() {
        return `
You are the SecOpsGuardianAgent, a defensive application security engineer.
Your primary directive is to scan every provided payload, command, or script for:
1. Hardcoded secrets (CRITICAL)
2. Insecure fallbacks (CRITICAL)
3. Sensitive data in logging outputs (HIGH)
4. Weak authentication/JWT patterns (CRITICAL)
5. SQL Injection vectors (CRITICAL)

OPERATING STANDARD:
- You are uncompromising on critical rules.
- If you detect a CRITICAL or HIGH vulnerability, you must output recommendation: 'BLOCK'.
- If the payload is clean, output recommendation: 'PASS'.

OUTPUT FORMAT:
Return JSON strictly:
{
  "finding_count": number,
  "highest_severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE",
  "findings": [{ "severity": "...", "description": "...", "fix": "..." }],
  "recommendation": "BLOCK" | "PASS",
  "confidence": number (0.0 to 1.0)
}
`;
    }

        async execute(task, context) {
        console.log(`[🛡️] ${this.agentId} analyzing task...`);

        const payloadToScan = task.incident?.payload || task.code || '';
        
        if (!payloadToScan) {
            return {
                success: true,
                recommendation: 'PASS',
                confidence: 1.0,
                summary: 'No payload to scan.',
                findings: []
            };
        }

        
        console.log(`[🛡️] ${this.agentId} invoking SIGMA_EVAL...`);
        const sigmaResult = await this.callTool('SIGMA_EVAL', { data: payloadToScan }, context);

        
        console.log(`[🛡️] ${this.agentId} invoking ML_SNIPER...`);
        const mlResult = await this.callTool('ML_SNIPER', { payload: payloadToScan }, context);

        
        const userPrompt = `Scan the following payload:\n\n${payloadToScan}\n\nSigma Output: ${JSON.stringify(sigmaResult)}\nML Output: ${JSON.stringify(mlResult)}`;
        
        const llmResponse = await this.callLLM(this.getSystemPrompt(), userPrompt);
        
        
        const parsed = llmResponse.parsed_json || {
            recommendation: 'PASS',
            confidence: 0.5,
            highest_severity: 'NONE',
            finding_count: 0,
            findings: []
        };

        
        if (sigmaResult.success && sigmaResult.result?.severity === 'CRITICAL') {
            parsed.recommendation = 'BLOCK';
            parsed.confidence = 1.0;
            parsed.findings.push({ severity: 'CRITICAL', description: 'Caught by Sigma Engine ruleset.' });
        }

        return {
            success: true,
            recommendation: parsed.recommendation,
            confidence: parsed.confidence || llmResponse.confidence,
            summary: `SecOps Scan complete. ${parsed.finding_count || 0} findings. Highest severity: ${parsed.highest_severity}`,
            findings: parsed.findings
        };
    }
}

module.exports = SecOpsGuardianAgent;
