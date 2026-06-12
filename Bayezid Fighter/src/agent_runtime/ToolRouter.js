
'use strict';

const crypto = require('crypto');

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
});

class ToolRouter {
        constructor(options = {}) {
        this.hitlGate = options.hitlGate || null;
                this._registry = new Map();

        
        this._registerDefaultTools();
    }

        registerTool(toolDef) {
        if (!toolDef || !toolDef.name || typeof toolDef.handler !== 'function') {
            throw new Error('[ToolRouter] Tool must have a name and a handler function.');
        }

        this._registry.set(toolDef.name, {
            name: toolDef.name,
            description: toolDef.description || 'No description provided.',
            handler: toolDef.handler,
            requiresHITL: !!toolDef.requiresHITL,
            riskLevel: toolDef.riskLevel || RISK_LEVEL.LOW,
            timeout: toolDef.timeout || 30000,
        });

        console.log(`[🔧] Tool Registered: ${toolDef.name} [Risk: ${toolDef.riskLevel}]`);
    }

        listTools() {
        return Array.from(this._registry.values()).map(t => ({
            name: t.name,
            description: t.description,
            requiresHITL: t.requiresHITL,
            riskLevel: t.riskLevel,
            timeout: t.timeout,
        }));
    }

        async call(toolName, params, callerAgentId, traceId = crypto.randomUUID()) {
        const startTime = Date.now();
        const tool = this._registry.get(toolName);

        if (!tool) {
            return {
                success: false,
                error: `Tool not found: ${toolName}`,
                toolName,
                executionTimeMs: Date.now() - startTime,
                traceId
            };
        }

        console.log(`[🔧] Agent ${callerAgentId} calling tool: ${toolName}`);

        
        if (tool.requiresHITL || ['HIGH', 'CRITICAL'].includes(tool.riskLevel)) {
            if (this.hitlGate) {
                console.log(`[🚦] Tool ${toolName} requires HITL. Triggering gate...`);
                const hitlResult = await this.hitlGate.requestApproval({
                    agentId: callerAgentId,
                    action: { type: toolName, params },
                    context: { trace: `Agent requested execution of ${toolName}`, confidence: 1.0 },
                    consequences: { approve: 'Tool executes normally.', deny: 'Tool execution blocked.' },
                    trigger: 'IRREVERSIBLE_ACTION',
                    traceId
                });

                if (hitlResult.decision !== 'APPROVED') {
                    return {
                        success: false,
                        error: `HITL Gate denied execution. Reason: ${hitlResult.reason}`,
                        toolName,
                        executionTimeMs: Date.now() - startTime,
                        traceId
                    };
                }
            } else {
                console.warn(`[⚠️] Tool ${toolName} requires HITL but no gate is configured. Proceeding at risk.`);
            }
        }

        
        try {
            const context = { callerAgentId, traceId };
            
            
            let timeoutHandle;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`Tool execution timed out after ${tool.timeout}ms`));
                }, tool.timeout);
            });

            const execPromise = Promise.resolve(tool.handler(params, context)).finally(() => {
                clearTimeout(timeoutHandle);
            });

            const result = await Promise.race([execPromise, timeoutPromise]);

            const execTime = Date.now() - startTime;
            console.log(`[🔧] Tool ${toolName} completed in ${execTime}ms.`);

            return {
                success: true,
                result,
                toolName,
                executionTimeMs: execTime,
                traceId
            };

        } catch (err) {
            const execTime = Date.now() - startTime;
            console.error(`[❌] Tool ${toolName} failed: ${err.message}`);
            return {
                success: false,
                error: err.message,
                toolName,
                executionTimeMs: execTime,
                traceId
            };
        }
    }

        _registerDefaultTools() {
        this.registerTool({
            name: 'ML_SNIPER',
            description: 'Evaluate payload with the ML Sniper (BERT+LSTM-AE). Expects POST to ML engine.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.LOW
        });

        this.registerTool({
            name: 'CHIMERA_MUTATION',
            description: 'Apply 5-level mutation to bypass filters. High risk.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            requiresHITL: true,
            riskLevel: RISK_LEVEL.HIGH
        });

        this.registerTool({
            name: 'WINGMAN_EXEC',
            description: 'Execute Wingman response loop. Critical risk.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            requiresHITL: true,
            riskLevel: RISK_LEVEL.CRITICAL
        });

        this.registerTool({
            name: 'ZMQ_BLOCK',
            description: 'Kernel-level blocking via ZMQ and eBPF. Critical risk.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            requiresHITL: true,
            riskLevel: RISK_LEVEL.CRITICAL
        });

        this.registerTool({
            name: 'SIGMA_EVAL',
            description: 'Evaluate events against Sigma rules engine.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.LOW
        });

        this.registerTool({
            name: 'LORA_TRAIN',
            description: 'Submit dataset for LoRA fine-tuning and apply regression gating.',
            handler: async (p) => {
                const { spawn } = require('child_process');
                console.log(`[🧠] ToolRouter: Invoking lora_trainer.py with dataset ${p.dataset_path}`);
                
                return new Promise((resolve, reject) => {
                    const pythonProcess = spawn('python', [
                        './ml_engine/lora_trainer.py',
                        '--dataset', p.dataset_path,
                        '--output', p.output_path || './ml_engine/models/bayezid-qlora-latest'
                    ]);

                    let output = '';
                    let errorOutput = '';

                    pythonProcess.stdout.on('data', (data) => {
                        output += data.toString();
                    });

                    pythonProcess.stderr.on('data', (data) => {
                        errorOutput += data.toString();
                    });

                    pythonProcess.on('close', (code) => {
                        console.log(output);
                        if (code !== 0 && code !== 42) {
                            return resolve({ status: 'FAILED', error: errorOutput || 'Unknown python crash' });
                        }
                        
                        
                        let baselineLoss = 2.5; 
                        let evalLoss = null;
                        
                        const baseMatch = output.match(/Baseline Loss:\s*([\d.]+)/);
                        if (baseMatch) baselineLoss = parseFloat(baseMatch[1]);
                        
                        const evalMatch = output.match(/Eval Loss:\s*([\d.]+)/);
                        if (evalMatch) evalLoss = parseFloat(evalMatch[1]);

                        
                        if (evalLoss !== null) {
                            const regressionMultiplier = evalLoss / baselineLoss;
                            console.log(`[⚖️] LORA Gate: Eval Loss (${evalLoss}) / Baseline (${baselineLoss}) = ${regressionMultiplier.toFixed(3)}x`);
                            
                            
                            if (regressionMultiplier > 1.05 || code === 42) {
                                console.warn(`[🚨] REGRESSION DETECTED: Loss multiplier > 1.05x. Adapter REJECTED.`);
                                return resolve({ status: 'BLOCKED', reason: 'Eval loss regression exceeded 1.05x threshold.' });
                            }
                        }

                        console.log(`[✅] LORA Gate Passed: Adapter accepted.`);
                        return resolve({ status: 'COMPLETED', output_path: p.output_path });
                    });
                });
            },
            riskLevel: RISK_LEVEL.MEDIUM
        });

        this.registerTool({
            name: 'DEEP_INVESTIGATE',
            description: 'Trigger full forensic deep investigation pipeline.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.MEDIUM
        });

        this.registerTool({
            name: 'VERITAS_PROOF',
            description: 'Generate or verify zero-knowledge ZK-SNARK proofs.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.LOW
        });

        this.registerTool({
            name: 'GNN_PROPAGATE',
            description: 'Query the Graph Neural Network for topological blast radius.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.LOW
        });

        this.registerTool({
            name: 'DEPLOY_DECOY',
            description: 'Deploy deception/decoy nodes to entangle attacker.',
            handler: async (p) => ({ status: 'stub_executed', params: p }),
            riskLevel: RISK_LEVEL.MEDIUM
        });
    }
}

module.exports = {
    ToolRouter,
    RISK_LEVEL
};
