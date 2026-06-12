'use strict';

const BaseAgent = require('./BaseAgent');

class AIDataRemediationEngineer extends BaseAgent {
    constructor() {
        super({
            agentId: 'AIDataRemediationEngineer',
            role: 'Data Curation & Neural Training Preparer',
            requiredTools: ['LORA_TRAIN', 'FILESYSTEM_WRITE']
        });

        
        
        this.batchLimit = parseInt(process.env.WARGAMES_BATCH_LIMIT || '50', 10);
    }

        async execute(task, context) {
        console.log(`[🧹] AIDataRemediationEngineer: Processing ${task.rawTraces?.length || 0} raw traces...`);

        if (!task.rawTraces || task.rawTraces.length === 0) {
            return {
                status: 'NO_DATA',
                summary: 'No raw traces provided to curate.',
                curated_count: 0
            };
        }

        const curatedPairs = [];
        let scrubbedCount = 0;

        
        for (const traceStr of task.rawTraces) {
            try {
                const trace = typeof traceStr === 'string' ? JSON.parse(traceStr) : traceStr;
                
                
                const scrubbedTrace = this._scrubPII(trace);
                scrubbedCount++;

                
                const alpacaPair = this._formatToAlpaca(scrubbedTrace);
                if (alpacaPair) {
                    curatedPairs.push(alpacaPair);
                }

            } catch (err) {
                console.warn(`[⚠️] RemediationEngineer: Failed to process a trace: ${err.message}`);
            }
        }

        
        const currentMemory = await this.memory.shortTerm.retrieveContext('alpaca_buffer') || [];
        const newBuffer = currentMemory.concat(curatedPairs);
        await this.memory.shortTerm.store('alpaca_buffer', newBuffer);

        console.log(`[✨] RemediationEngineer: Curated ${curatedPairs.length} new traces. Buffer size: ${newBuffer.length}/${this.batchLimit}`);

        
        if (newBuffer.length >= this.batchLimit) {
            console.log(`[🚀] RemediationEngineer: Batch limit (${this.batchLimit}) reached. Triggering LORA_TRAIN pipeline...`);
            
            
            const jsonlData = newBuffer.map(obj => JSON.stringify(obj)).join('\n');
            const datasetPath = './ml_engine/datasets/alpaca_curated_batch.jsonl';
            
            
            let writeSuccess = false;
            if (context.toolRouter) {
               try {
                   
                   console.log(`[💾] RemediationEngineer: Saving dataset to ${datasetPath}`);
                   
                   require('fs').mkdirSync('./ml_engine/datasets', { recursive: true });
                   require('fs').writeFileSync(datasetPath, jsonlData, 'utf8');
                   writeSuccess = true;
               } catch (e) {
                   console.error(`[❌] RemediationEngineer: Failed to save dataset: ${e.message}`);
               }
            }

            if (writeSuccess) {
                
                console.log(`[🧠] RemediationEngineer: Invoking Python LoRA Trainer via ToolRouter...`);
                let trainResult;
                try {
                    trainResult = await context.toolRouter.executeTool('LORA_TRAIN', {
                        dataset_path: datasetPath,
                        output_path: './ml_engine/models/bayezid-qlora-latest'
                    }, context.traceId);
                    
                    console.log(`[🎖️] RemediationEngineer: Training Complete. Status: ${trainResult.status}`);
                    
                    if (trainResult.status === 'COMPLETED') {
                        
                        await this.memory.shortTerm.store('alpaca_buffer', []);
                    } else if (trainResult.status === 'BLOCKED') {
                        console.warn(`[⚠️] RemediationEngineer: Training blocked by Regression Gate! Model degraded.`);
                        
                        await this.memory.shortTerm.store('alpaca_buffer', []);
                    }

                } catch (trainErr) {
                    console.error(`[❌] RemediationEngineer: Training invocation failed: ${trainErr.message}`);
                }
            }
            
            return {
                status: 'TRAINING_TRIGGERED',
                summary: `Curated ${curatedPairs.length} traces. Triggered LoRA training on ${newBuffer.length} samples.`,
                curated_count: curatedPairs.length,
                batch_size: newBuffer.length
            };
        }

        return {
            status: 'BUFFERING',
            summary: `Curated ${curatedPairs.length} traces. Awaiting batch limit (${newBuffer.length}/${this.batchLimit}).`,
            curated_count: curatedPairs.length,
            batch_size: newBuffer.length
        };
    }

        _scrubPII(data) {
        let strData = JSON.stringify(data);
        
        
        strData = strData.replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '[REDACTED_IP]');
        
        
        strData = strData.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
        
        
        strData = strData.replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED_API_KEY]');
        strData = strData.replace(/xox[baprs]-[a-zA-Z0-9]{10,}/g, '[REDACTED_SLACK_TOKEN]');

        return JSON.parse(strData);
    }

        _formatToAlpaca(trace) {
        try {
            
            const instruction = `Analyze the following security incident and generate a response plan using the Bayezid AgentRuntime hierarchy.`;
            
            
            const input = JSON.stringify({
                alert_type: trace.incident?.eventType || 'Unknown',
                severity: trace.incident?.severity || 'Unknown',
                context: trace.incident?.ragContext || 'No context'
            });

            
            const output = JSON.stringify({
                agent_decisions: trace.agent_outputs,
                tools_used: trace.tool_calls
            });

            return {
                instruction,
                input,
                output
            };
        } catch (e) {
            return null;
        }
    }
}

module.exports = AIDataRemediationEngineer;
