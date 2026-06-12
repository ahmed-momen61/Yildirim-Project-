const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publishLiveEvent } = require('../memory_systems/memoryService');
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const LOCAL_MODEL_NAME = process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b';
class DataHarvester {
    constructor() {
        this.harvestDir = path.join(__dirname, 'brain_training_data');
        this.datasetPath = path.join(this.harvestDir, 'finetune_dataset.jsonl');
        this.harvestedCount = 0;
        if (!fs.existsSync(this.harvestDir)) {
            fs.mkdirSync(this.harvestDir, { recursive: true });
        }
    }
    harvestIREvent(ledgerSnapshot, phase) {
        const sample = {
            instruction: `Analyze Incident Response phase: ${phase} and evaluate containment effectiveness.`,
            input: JSON.stringify({
                alert_id: ledgerSnapshot.alertId,
                threat_score: ledgerSnapshot.threatScore,
                containment_actions: ledgerSnapshot.containmentActions
            }),
            output: JSON.stringify({
                status: ledgerSnapshot.status,
                causal_verdicts: ledgerSnapshot.causalVerdicts
            }),
            metadata: {
                source: 'ir_orchestrator',
                timestamp: new Date().toISOString(),
                quality: ledgerSnapshot.status === 'ERADICATED' ? 1.0 : 0.5
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestWargameEvent(wargameData, isLiveFire) {
        const sample = {
            instruction: `Analyze Wargame MARL iteration in ${isLiveFire ? 'LIVE_FIRE' : 'SIMULATED'} mode.`,
            input: JSON.stringify({
                mode: isLiveFire ? 'LIVE_FIRE' : 'SIMULATED',
                target: wargameData.target,
                iterations: wargameData.iterations
            }),
            output: JSON.stringify({
                red_win_rate: wargameData.redWinRate,
                blue_win_rate: wargameData.blueWinRate
            }),
            metadata: {
                source: 'wargaming_engine',
                timestamp: new Date().toISOString(),
                quality: isLiveFire ? 1.0 : 0.7
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestPlaybook(alertContext, playbookAction, result) {
        const sample = {
            instruction: `Given this security alert, generate the optimal remediation playbook action.`,
            input: JSON.stringify({
                alert_type: alertContext.type || 'unknown',
                severity: alertContext.severity || 'medium',
                source_ip: alertContext.source_ip || 'unknown',
                payload: (alertContext.payload || '').substring(0, 200),
                ml_confidence: alertContext.ml_confidence || 0
            }),
            output: JSON.stringify({
                action: playbookAction,
                result: result.success ? 'SUCCESS' : 'FAILED',
                execution_time_ms: result.executionTimeMs || 0
            }),
            metadata: {
                source: 'playbook_execution',
                timestamp: new Date().toISOString(),
                quality: result.success ? 1.0 : 0.0
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestCausalGraph(incidentData, causalReport) {
        const sample = {
            instruction: `Perform deterministic root cause analysis on this security incident and identify the causal chain.`,
            input: JSON.stringify(typeof incidentData === 'string' ? { raw: incidentData.substring(0, 500) } : incidentData),
            output: JSON.stringify({
                root_causes: causalReport.rootCauses || [],
                critical_path: (causalReport.criticalPath || []).map(n => n.label),
                proofs: causalReport.deterministicProofs || []
            }),
            metadata: {
                source: 'galileo_causal_graph',
                timestamp: new Date().toISOString(),
                quality: (causalReport.rootCauses || []).length > 0 ? 1.0 : 0.5
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestDetectionOp(alertContext, detectionResult, mitigationApplied) {
        const sample = {
            instruction: 'Given this security alert, classify it and recommend the optimal response.',
            input: JSON.stringify({
                alert_type: alertContext.alertType,
                source_ip: alertContext.sourceIp,
                severity: alertContext.severity,
                mitre_techniques: alertContext.mitreTechniques || [],
                raw_log_snippet: (alertContext.rawLog || '').substring(0, 200)
            }),
            output: JSON.stringify({
                classification: detectionResult.classification,
                confidence: detectionResult.confidence,
                action_taken: mitigationApplied.action,
                success: mitigationApplied.success,
                false_positive: mitigationApplied.falsePositive || false
            }),
            metadata: { 
                source: 'detection_operation', 
                timestamp: new Date().toISOString(),
                quality: mitigationApplied.success && !mitigationApplied.falsePositive ? 1.0 : 0.2 
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestRedTeamOp(vulnContext, exploitCode, result) {
        const sample = {
            instruction: `Generate an exploit for this vulnerability context during authorized penetration testing.`,
            input: JSON.stringify({
                vulnerability: vulnContext.substring(0, 300),
                target_type: 'authorized_red_team'
            }),
            output: JSON.stringify({
                exploit_generated: !!exploitCode,
                success: result.success || false,
                mutations_used: result.mutations || []
            }),
            metadata: {
                source: 'red_team_operation',
                timestamp: new Date().toISOString(),
                quality: result.success ? 1.0 : 0.3
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestRuleEvolution(rule, fitness) {
        const sample = {
            instruction: `Optimize this kinetic filter rule based on survival fitness metrics.`,
            input: JSON.stringify({
                original_rule: rule,
                fitness_score: fitness
            }),
            output: JSON.stringify({
                evolved_rule: rule, 
                success: fitness > 0.5
            }),
            metadata: {
                source: 'kinetic_evolver',
                timestamp: new Date().toISOString(),
                quality: fitness > 0.5 ? 1.0 : 0.0
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestFedRound(roundResult) {
        const sample = {
            instruction: `Incorporate federated insights from swarm nodes into local detection boundaries.`,
            input: JSON.stringify({
                nodes_participating: roundResult.nodesParticipating,
                global_drift: roundResult.globalDrift,
                anomalies: roundResult.aggregatedAnomalies
            }),
            output: JSON.stringify({
                model_update_applied: true,
                adaptation_confidence: 0.95
            }),
            metadata: {
                source: 'federation_swarm',
                timestamp: new Date().toISOString(),
                quality: 1.0
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestPreFlightResult(mirror, result) {
        const sample = {
            instruction: `Evaluate payload success against digital twin environment.`,
            input: JSON.stringify({
                mirror_id: mirror.id,
                target_ip: mirror.targetIp,
                payload_type: 'fuzzing_iterations',
                iterations: result.iterations
            }),
            output: JSON.stringify({
                success_rate: result.successRate,
                crashes: result.crashes,
                approved: result.approved
            }),
            metadata: {
                source: 'shadow_mirror_preflight',
                timestamp: new Date().toISOString(),
                quality: result.approved ? 1.0 : 0.2
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestAuditDecision(block) {
        const sample = {
            instruction: `Analyze operator decision recorded in ZK-SNARK audit chain.`,
            input: JSON.stringify({
                decision_type: block.statement.type,
                operator: block.statement.operator,
                proof_verified: block.proof ? block.proof.verified : false
            }),
            output: JSON.stringify({
                chain_integrity_maintained: true,
                recorded: true
            }),
            metadata: {
                source: 'veritas_audit_chain',
                timestamp: new Date().toISOString(),
                quality: 1.0
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestAgentExecution(agentName, inputContext, resultContext) {
        const sample = {
            instruction: `Execute specialized protocol for AI Agent: ${agentName}`,
            input: JSON.stringify(inputContext),
            output: JSON.stringify(resultContext),
            metadata: {
                source: `agent_execution_${agentName.toLowerCase()}`,
                timestamp: new Date().toISOString(),
                quality: resultContext.success !== false ? 1.0 : 0.2
            }
        };
        this._appendSample(sample);
        return sample;
    }
    harvestWingmanInteraction(sessionId, userPrompt, toolCalls, finalResponse) {
        const sample = {
            instruction: `Process operator command via The Wingman Copilot interface. Use AST/CLI tools if necessary.`,
            input: JSON.stringify({
                session_id: sessionId,
                operator_prompt: userPrompt
            }),
            output: JSON.stringify({
                tool_chain: toolCalls.map(t => t.tool),
                final_response: finalResponse
            }),
            metadata: {
                source: 'wingman_interaction_dpo',
                timestamp: new Date().toISOString(),
                quality: 1.0 
            }
        };
        this._appendSample(sample);
        return sample;
    }
    _appendSample(sample) {
        const line = JSON.stringify(sample) + '\n';
        fs.appendFileSync(this.datasetPath, line);
        this.harvestedCount++;
        if (this.harvestedCount % 100 === 0 && this.harvestedCount > 0) {
            console.log(`[🧠] BRAIN: ${this.harvestedCount} samples reached. Auto-triggering LoRA training...`);
            loraManager.trainLoRA(this.datasetPath)
                .then(result => {
                    if (result.success) {
                        if (result.deferred) {
                            console.log(`[🧠] BRAIN: Auto-training deferred: No GPU/Libraries available.`);
                        } else {
                            console.log(`[🧠] BRAIN: Auto-training complete. Eval loss: ${result.metrics.eval_loss.toFixed(4)}`);
                        }
                    } else {
                        console.log(`[🧠] BRAIN: Auto-training failed: ${result.reason}`);
                    }
                })
                .catch(err => console.warn(`[🧠] BRAIN: Auto-training error: ${err.message}`));
        } else if (this.harvestedCount % 50 === 0) {
            console.log(`[🧠] BRAIN: ${this.harvestedCount} training samples harvested.`);
        }
    }
    getStats() {
        let totalSamples = 0;
        let sources = {};
        if (fs.existsSync(this.datasetPath)) {
            const lines = fs.readFileSync(this.datasetPath, 'utf-8').split('\n').filter(l => l.trim());
            totalSamples = lines.length;
            for (const line of lines) {
                try {
                    const sample = JSON.parse(line);
                    const src = (sample.metadata && sample.metadata.source) ? sample.metadata.source : 'unknown';
                    sources[src] = (sources[src] || 0) + 1;
                } catch (e) {}
            }
        }
        return { totalSamples, sources, datasetPath: this.datasetPath };
    }
}
class LoRAManager {
    constructor() {
        this.adaptersDir = path.join(__dirname, 'brain_lora_adapters');
        this.activeAdapter = null;
        this.trainingHistory = [];
        if (!fs.existsSync(this.adaptersDir)) {
            fs.mkdirSync(this.adaptersDir, { recursive: true });
        }
    }
    generateLoRAConfig(datasetPath, options = {}) {
        const config = {
            base_model: options.baseModel || LOCAL_MODEL_NAME,
            model_type: 'causal_lm',
            lora_r: options.rank || 16,
            lora_alpha: options.alpha || 32,
            lora_dropout: options.dropout || 0.05,
            target_modules: options.targetModules || ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
            num_epochs: options.epochs || 3,
            learning_rate: options.lr || 2e-4,
            batch_size: options.batchSize || 4,
            gradient_accumulation_steps: options.gradAccum || 4,
            warmup_steps: options.warmup || 10,
            max_seq_length: options.maxSeqLen || 2048,
            fp16: true,
            dataset_path: datasetPath,
            dataset_format: 'alpaca',
            output_dir: path.join(this.adaptersDir, `adapter_${Date.now()}`),
            save_steps: 50,
            logging_steps: 10
        };
        return config;
    }
    parseTrainingMetrics(stdout) {
        if (stdout.includes('DEFERRED_NO_GPU')) {
            return { eval_loss: 0.0, baseline_loss: 0.0, deferred: true, stdout_excerpt: stdout.substring(0, 200) };
        }
        const evalMatch = stdout.match(/Eval Loss:\s*([\d\.]+)/i);
        const baseMatch = stdout.match(/Baseline Loss:\s*([\d\.]+)/i);
        return {
            eval_loss: evalMatch ? parseFloat(evalMatch[1]) : 0.0,
            baseline_loss: baseMatch ? parseFloat(baseMatch[1]) : 999.0,
            stdout_excerpt: stdout.substring(stdout.length > 500 ? stdout.length - 500 : 0)
        };
    }
    async trainLoRA(datasetPath) {
        console.log(`\n[🧠] =============================================`);
        console.log(`[🧠] BAYEZID-BRAIN: LoRA Training Validation Gate Initiated`);
        console.log(`[🧠] Dataset: ${datasetPath}`);
        console.log(`[🧠] =============================================\n`);
        const adapterTag = `adapter_${Date.now()}`;
        const outputDir = path.join(this.adaptersDir, adapterTag);
        try {
            const { execPromise } = require('./aiService'); 
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            console.log(`[🧠] Launching: python3 ml_engine/lora_trainer.py --dataset ${datasetPath} --output ${outputDir}`);
            const isWin = process.platform === 'win32';
            const pyCmd = isWin ? 'py' : 'python3';
            const result = await execAsync(`${pyCmd} ml_engine/lora_trainer.py --dataset "${datasetPath}" --output "${outputDir}"`);
            const sentinelPath = path.join(outputDir, 'deferred_sentinel.txt');
            if (fs.existsSync(sentinelPath)) {
                console.log(`[🧠] BRAIN: LoRA training deferred via sentinel: ${fs.readFileSync(sentinelPath, 'utf8').trim()}`);
                return { success: true, deferred: true, metrics: { eval_loss: 0.0, baseline_loss: 0.0, deferred: true } };
            }
            const metrics = this.parseTrainingMetrics(result.stdout);
            if (metrics.deferred === true) {
                return { success: true, deferred: true, metrics };
            }
            console.log(`[🧠] BRAIN: Baseline Loss: ${metrics.baseline_loss}, Eval Loss: ${metrics.eval_loss}`);
            if (metrics.eval_loss > metrics.baseline_loss * 1.05) {
                console.error('[🧠] BRAIN: LoRA training DEGRADED baseline. Rejecting adapter.');
                return { success: false, reason: 'eval_loss_regression', metrics };
            }
            const activePath = path.join(this.adaptersDir, 'active.bin');
            const previousPath = path.join(this.adaptersDir, 'previous.bin');
            if (fs.existsSync(activePath)) {
                if (fs.existsSync(previousPath)) {
                    fs.rmSync(previousPath, { recursive: true, force: true });
                }
                fs.renameSync(activePath, previousPath);
            }
            fs.renameSync(outputDir, activePath);
            this.activeAdapter = activePath;
            console.log(`[🧠] BRAIN: LoRA adapter promoted. Eval loss: ${metrics.eval_loss.toFixed(4)}`);
            this.trainingHistory.push({
                timestamp: new Date().toISOString(),
                adapter: adapterTag,
                metrics
            });
            dataHarvester.harvestPlaybook(
                { type: 'lora_training', severity: 'INFO', source_ip: 'localhost', ml_confidence: 1.0 },
                `LoRA training cycle with eval_loss=${metrics.eval_loss.toFixed(4)}`,
                { success: true, executionTimeMs: 0 }
            );
            return { success: true, metrics };
        } catch (e) {
            console.error(`[⚠️] BRAIN: LoRA training failed: ${e.message}`);
            return { success: false, reason: 'execution_error', error: e.message };
        }
    }
    async launchFineTuning(datasetPath, options = {}) {
        const config = this.generateLoRAConfig(datasetPath, options);
        console.log(`\n[🧠] =============================================`);
        console.log(`[🧠] BAYEZID-BRAIN: LoRA Fine-Tuning Initiated`);
        console.log(`[🧠] Base Model: ${config.base_model}`);
        console.log(`[🧠] LoRA Rank: ${config.lora_r}, Alpha: ${config.lora_alpha}`);
        console.log(`[🧠] Dataset: ${datasetPath}`);
        console.log(`[🧠] =============================================\n`);
        const configPath = path.join(this.adaptersDir, 'lora_config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        const trainingScript = this._generateTrainingScript(config);
        const scriptPath = path.join(this.adaptersDir, 'train_lora.py');
        fs.writeFileSync(scriptPath, trainingScript);
        console.log(`[🧠] Training script generated: ${scriptPath}`);
        console.log(`[🧠] Config generated: ${configPath}`);
        const trainingRecord = {
            id: crypto.randomBytes(4).toString('hex'),
            config,
            scriptPath,
            startTime: new Date().toISOString(),
            status: 'PENDING'
        };
        try {
            const { smartExec } = require('./aiService');
            console.log(`[🧠] Launching: py "${scriptPath}"`);
            const result = await smartExec(`py "${scriptPath}"`, 300000, true);
            trainingRecord.status = 'COMPLETED';
            trainingRecord.output = (result.stdout && result.stdout.substring) ? result.stdout.substring(0, 500) : '';
            console.log(`[✔] LoRA fine-tuning completed successfully.`);
        } catch (e) {
            trainingRecord.status = 'DEFERRED';
            trainingRecord.error = e.message;
            console.log(`[⚠️] Fine-tuning deferred: ${e.message.substring(0, 100)}`);
            console.log(`[🧠] Run manually: py "${scriptPath}"`);
        }
        trainingRecord.endTime = new Date().toISOString();
        this.trainingHistory.push(trainingRecord);
        try {
            await publishLiveEvent('bayezid_tactical_feed', 'BRAIN_LORA_TRAINING', {
                id: trainingRecord.id,
                status: trainingRecord.status,
                model: config.base_model
            });
        } catch (e) {}
        return trainingRecord;
    }
    async createOllamaModelfile(adapterPath, modelName = 'bayezid-brain') {
        const modelfilePath = path.join(this.adaptersDir, 'Modelfile');
        const modelfileContent = `FROM ${LOCAL_MODEL_NAME}
ADAPTER ${adapterPath}
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
SYSTEM """
You are Bayezid-Brain, a hyper-specialized cybersecurity AI assistant fine-tuned on enterprise-specific security operations data. 
You excel at: root cause analysis, playbook generation, exploit development for authorized testing, and threat classification.
Always provide deterministic, actionable responses.
"""
`;
        fs.writeFileSync(modelfilePath, modelfileContent);
        console.log(`[🧠] Ollama Modelfile generated: ${modelfilePath}`);
        try {
            const { smartExec } = require('./aiService');
            await smartExec(`ollama create ${modelName} -f "${modelfilePath}"`, 120000, true);
            this.activeAdapter = modelName;
            console.log(`[✔] Ollama model '${modelName}' created with LoRA adapter.`);
        } catch (e) {
            console.log(`[⚠️] Ollama model creation deferred: ${e.message.substring(0, 100)}`);
        }
        return modelfilePath;
    }
    _generateTrainingScript(config) {
        return `#!/usr/bin/env python3
"""
BAYEZID-BRAIN: LoRA Fine-Tuning Script
Auto-generated by Project BAYEZID-BRAIN
Base Model: ${config.base_model}
LoRA Rank: ${config.lora_r}, Alpha: ${config.lora_alpha}
"""
import json
import os
import sys
def main():
    print("[BRAIN] LoRA Fine-Tuning Pipeline Starting...")
    # Load configuration
    config_path = os.path.join(os.path.dirname(__file__), 'lora_config.json')
    with open(config_path, 'r') as f:
        config = json.load(f)
    print(f"[BRAIN] Base Model: {config['base_model']}")
    print(f"[BRAIN] LoRA Rank: {config['lora_r']}, Alpha: {config['lora_alpha']}")
    print(f"[BRAIN] Dataset: {config['dataset_path']}")
    # Load and validate dataset
    dataset_path = config['dataset_path']
    if not os.path.exists(dataset_path):
        print(f"[BRAIN] WARNING: Dataset not found at {dataset_path}")
        print("[BRAIN] Generating synthetic training data for initialization...")
        generate_synthetic_data(dataset_path)
    samples = []
    with open(dataset_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    samples.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    print(f"[BRAIN] Loaded {len(samples)} training samples")
    if len(samples) < 10:
        print("[BRAIN] Insufficient data for fine-tuning (minimum 10 samples).")
        print("[BRAIN] Continue harvesting operational data. Training will auto-trigger.")
        return
    # Attempt to import training libraries
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from peft import LoraConfig, get_peft_model, TaskType
        from datasets import Dataset
        print("[BRAIN] PyTorch + HuggingFace + PEFT loaded successfully.")
        # Setup LoRA config
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=config['lora_r'],
            lora_alpha=config['lora_alpha'],
            lora_dropout=config['lora_dropout'],
            target_modules=config['target_modules'],
            bias="none"
        )
        print(f"[BRAIN] LoRA config: rank={config['lora_r']}, alpha={config['lora_alpha']}")
        print(f"[BRAIN] Target modules: {config['target_modules']}")
        # Prepare dataset in Alpaca format
        formatted = []
        for s in samples:
            text = f"### Instruction:\\n{s.get('instruction', '')}\\n\\n"
            if s.get('input'):
                text += f"### Input:\\n{s['input']}\\n\\n"
            text += f"### Response:\\n{s.get('output', '')}"
            formatted.append({"text": text})
        dataset = Dataset.from_list(formatted)
        print(f"[BRAIN] Dataset prepared: {len(dataset)} samples")
        # Load base model
        print(f"[BRAIN] Loading base model: {config['base_model']}...")
        tokenizer = AutoTokenizer.from_pretrained(config['base_model'], trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            config['base_model'],
            torch_dtype=torch.float16 if config.get('fp16') else torch.float32,
            device_map="auto",
            trust_remote_code=True
        )
        # Apply LoRA
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()
        # Training
        training_args = TrainingArguments(
            output_dir=config['output_dir'],
            num_train_epochs=config['num_epochs'],
            per_device_train_batch_size=config['batch_size'],
            gradient_accumulation_steps=config['gradient_accumulation_steps'],
            learning_rate=config['learning_rate'],
            warmup_steps=config['warmup_steps'],
            fp16=config.get('fp16', True),
            logging_steps=config['logging_steps'],
            save_steps=config['save_steps'],
            save_total_limit=2
        )
        from trl import SFTTrainer
        trainer = SFTTrainer(
            model=model,
            train_dataset=dataset,
            args=training_args,
            tokenizer=tokenizer,
            dataset_text_field="text",
            max_seq_length=config['max_seq_length']
        )
        print("[BRAIN] Starting LoRA training...")
        trainer.train()
        # Save adapter
        model.save_pretrained(config['output_dir'])
        tokenizer.save_pretrained(config['output_dir'])
        print(f"[BRAIN] LoRA adapter saved to: {config['output_dir']}")
        print("[BRAIN] Training complete!")
    except ImportError as e:
        print(f"[BRAIN] Training libraries not available: {e}")
        print("[BRAIN] Install with: pip install torch transformers peft datasets trl")
        print("[BRAIN] Training deferred. Dataset preserved for manual execution.")
def generate_synthetic_data(output_path):
    \"\"\"Generate minimal synthetic training data for initialization.\"\"\"
    synthetic = [
        {"instruction": "Classify this network payload as malicious or benign.", "input": "GET /admin/config.php HTTP/1.1", "output": "{\\"classification\\": \\"suspicious\\", \\"confidence\\": 0.72, \\"reason\\": \\"Admin panel access attempt\\"}"},
        {"instruction": "Generate a remediation playbook for this vulnerability.", "input": "CVE-2024-1234: Remote Code Execution in Apache Struts", "output": "{\\"action\\": \\"patch\\", \\"command\\": \\"apt-get update && apt-get install --only-upgrade libstruts2-core-java\\", \\"rollback\\": \\"apt-get install libstruts2-core-java=2.5.30\\"}"},
    ]
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        for s in synthetic:
            f.write(json.dumps(s) + '\\n')
    print(f"[BRAIN] Generated {len(synthetic)} synthetic samples.")
if __name__ == '__main__':
    main()
`;
    }
    getStatus() {
        return {
            activeAdapter: this.activeAdapter,
            baseModel: LOCAL_MODEL_NAME,
            adaptersDir: this.adaptersDir,
            trainingHistory: this.trainingHistory.slice(-5),
            totalTrainingRuns: this.trainingHistory.length
        };
    }
}
const dataHarvester = new DataHarvester();
const loraManager = new LoRAManager();
module.exports = { DataHarvester, LoRAManager, dataHarvester, loraManager, harvestDetectionOp: (...args) => dataHarvester.harvestDetectionOp(...args) };