'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { redisClient, publishLiveEvent } = require('../memory_systems/memoryService');
const prisma = require('../api/prismaClient');
const IS_WINDOWS = os.platform() === 'win32';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EVOLUTION_STATE_REDIS_KEY = 'wingman:evolution:state';
const LAST_SAMPLE_COUNT_KEY = 'wingman:evolution:last_sample_count';
const PHASE_ORDER = ['CLOUD_DEPENDENT', 'HYBRID', 'LOCALLY_DOMINANT', 'AIR_GAPPED'];
const TRANSITION_GATES = {
    CLOUD_DEPENDENT: {
        minSamples: 1000,
        minLoraRuns: 3,
        maxEvalLoss: 9999,
        nextPhase: 'HYBRID',
        requiresOperatorApproval: false
    },
    HYBRID: {
        minSamples: 5000,
        minLoraRuns: 8,
        maxEvalLoss: 1.5,
        nextPhase: 'LOCALLY_DOMINANT',
        requiresOperatorApproval: false
    },
    LOCALLY_DOMINANT: {
        minSamples: 10000,
        minLoraRuns: 15,
        maxEvalLoss: 0.8,
        nextPhase: 'AIR_GAPPED',
        requiresOperatorApproval: true
    }
};
const getEvolutionState = async () => {
    try {
        if (redisClient.isOpen) {
            const raw = await redisClient.get(EVOLUTION_STATE_REDIS_KEY);
            if (raw) return JSON.parse(raw);
        }
    } catch (e) {  }
    try {
        const record = await prisma.wingmanEvolutionLog.findFirst({
            orderBy: { timestamp: 'desc' }
        });
        return record ? { phase: record.toPhase } : { phase: 'CLOUD_DEPENDENT' };
    } catch (e) {
        return { phase: 'CLOUD_DEPENDENT' };
    }
};
const setEvolutionState = async (phase) => {
    const state = { phase, updatedAt: new Date().toISOString() };
    try {
        if (redisClient.isOpen) {
            await redisClient.set(EVOLUTION_STATE_REDIS_KEY, JSON.stringify(state));
        }
    } catch (e) {  }
};
const checkEvolutionReadiness = async () => {
    const { phase } = await getEvolutionState();
    const gate = TRANSITION_GATES[phase];
    if (!gate) {
        return { ready: false, currentPhase: phase, reason: 'Already at AIR_GAPPED — maximum evolution achieved.' };
    }
    let stats, loraStatus;
    try {
        const brain = require('./bayezidBrain');
        stats = brain.dataHarvester.getStats();
        loraStatus = brain.loraManager.getStatus();
    } catch (e) {
        return { ready: false, currentPhase: phase, reason: `Brain module unavailable: ${e.message}` };
    }
    const loraRuns = loraStatus.totalTrainingRuns;
    const lastRun = loraStatus.trainingHistory.slice(-1)[0];
    const evalLoss = lastRun?.metrics?.eval_loss ?? 999;
    const samplesOk = stats.totalSamples >= gate.minSamples;
    const loraRunsOk = loraRuns >= gate.minLoraRuns;
    const lossOk = evalLoss <= gate.maxEvalLoss;
    const ready = samplesOk && loraRunsOk && lossOk;
    return {
        ready,
        currentPhase: phase,
        nextPhase: gate.nextPhase,
        requiresOperatorApproval: gate.requiresOperatorApproval,
        metrics: {
            samples: { current: stats.totalSamples, required: gate.minSamples, ok: samplesOk },
            loraRuns: { current: loraRuns, required: gate.minLoraRuns, ok: loraRunsOk },
            evalLoss: { current: evalLoss, required: gate.maxEvalLoss, ok: lossOk }
        }
    };
};
const autoTrainingTick = async () => {
    let stats, loraStatus;
    try {
        const brain = require('./bayezidBrain');
        stats = brain.dataHarvester.getStats();
        loraStatus = brain.loraManager.getStatus();
    } catch (e) {
        console.log(`[🧠] BRAIN Scheduler: bayezidBrain not available: ${e.message}`);
        return;
    }
    let lastCount = 0;
    try {
        if (redisClient.isOpen) {
            const raw = await redisClient.get(LAST_SAMPLE_COUNT_KEY);
            lastCount = raw ? parseInt(raw, 10) : 0;
        }
    } catch (e) {  }
    const newSamples = stats.totalSamples - lastCount;
    if (newSamples < 50) {
        console.log(`[🧠] BRAIN Scheduler: Only ${newSamples} new samples since last run. Minimum is 50. Skipping.`);
        return;
    }
    if (loraStatus.activeAdapter === 'TRAINING') {
        console.log(`[🧠] BRAIN Scheduler: Training already in progress. Skipping.`);
        return;
    }
    console.log(`[🧠] BRAIN Scheduler: ${newSamples} new samples accumulated. Triggering LoRA training cycle...`);
    await publishLiveEvent('bayezid_system_health', 'LORA_TRAINING_STARTED', {
        samples: stats.totalSamples,
        newSamples
    });
    try {
        const brain = require('./bayezidBrain');
        const result = await brain.loraManager.trainLoRA(stats.datasetPath);
        try {
            if (redisClient.isOpen) {
                await redisClient.set(LAST_SAMPLE_COUNT_KEY, String(stats.totalSamples));
            }
        } catch (e) {  }
        if (result.success) {
            console.log(`[🧠] BRAIN: Training cycle complete. Eval loss: ${result.metrics.eval_loss.toFixed(4)}`);
            await publishLiveEvent('bayezid_system_health', 'LORA_TRAINING_COMPLETE', {
                eval_loss: result.metrics.eval_loss,
                baseline_loss: result.metrics.baseline_loss,
                samples: stats.totalSamples
            });
            try {
                brain.dataHarvester.harvestPlaybook(
                    { type: 'lora_training', severity: 'INFO', source_ip: 'localhost', ml_confidence: 1.0 },
                    `LoRA training cycle with dataset_size=${stats.totalSamples}`,
                    { success: true, executionTimeMs: 0 }
                );
            } catch (e) {  }
            try {
                const { sendProactiveAlert } = require('./wingmanTelegram');
                await sendProactiveAlert(
                    `🧠 <b>WINGMAN SELF-IMPROVEMENT COMPLETE</b>\n\n` +
                    `LoRA training cycle #${loraStatus.totalTrainingRuns + 1} finished.\n` +
                    `📉 Eval Loss: <code>${result.metrics.eval_loss.toFixed(4)}</code> ` +
                    `(was <code>${result.metrics.baseline_loss.toFixed(4)}</code>)\n` +
                    `📦 Dataset size: <code>${stats.totalSamples}</code> samples\n\n` +
                    `I am getting smarter. You're welcome.`
                );
            } catch (e) {  }
            const readiness = await checkEvolutionReadiness();
            if (readiness.ready && !readiness.requiresOperatorApproval) {
                console.log(`[🚀] WINGMAN: Auto-evolving to ${readiness.nextPhase}...`);
                await executePhaseTransition(readiness.nextPhase, 'auto', result.metrics);
            } else if (readiness.ready && readiness.requiresOperatorApproval) {
                try {
                    const { sendProactiveAlert } = require('./wingmanTelegram');
                    await sendProactiveAlert(
                        `🚀 <b>EVOLUTION GATE REACHED</b>\n\n` +
                        `I have satisfied all criteria to evolve to phase <b>${readiness.nextPhase}</b>.\n\n` +
                        `📊 Metrics:\n` +
                        `• Samples: ${readiness.metrics.samples.current}/${readiness.metrics.samples.required} ✅\n` +
                        `• LoRA runs: ${readiness.metrics.loraRuns.current}/${readiness.metrics.loraRuns.required} ✅\n` +
                        `• Eval Loss: ${readiness.metrics.evalLoss.current.toFixed(4)} ≤ ${readiness.metrics.evalLoss.required} ✅\n\n` +
                        `This transition requires your explicit approval.`,
                        [[{ text: `🚀 Approve → ${readiness.nextPhase}`, callback_data: `approve_evolution_${readiness.nextPhase}` },
                          { text: '⏳ Later', callback_data: 'evolution_defer' }]]
                    );
                } catch (e) {  }
            }
        } else {
            console.error(`[⚠️] BRAIN: Training cycle failed: ${result.reason}. Adapter NOT promoted.`);
        }
    } catch (e) {
        console.error(`[⚠️] BRAIN Scheduler: Training error: ${e.message}`);
    }
};
const executePhaseTransition = async (targetPhase, triggeredBy, metrics) => {
    const { phase: fromPhase } = await getEvolutionState();
    console.log(`\n[🚀] WINGMAN EVOLUTION: ${fromPhase} → ${targetPhase}`);
    if (targetPhase === 'HYBRID') {
        await migrateEmbeddingToLocal();
        await loadFullMitreDatabase();
        await registerLoRAModelWithOllama();
    }
    if (targetPhase === 'LOCALLY_DOMINANT') {
        await activateLocalCTI();
        await patchAnalyzeWithLocalModelPriority();
    }
    if (targetPhase === 'AIR_GAPPED') {
        await disableCloudAPIRoutes();
        await activateLocalOsint();
    }
    await setEvolutionState(targetPhase);
    try {
        const brain = require('./bayezidBrain');
        await prisma.wingmanEvolutionLog.create({
            data: {
                fromPhase,
                toPhase: targetPhase,
                loraRunCount: brain.loraManager.getStatus().totalTrainingRuns,
                totalSamples: brain.dataHarvester.getStats().totalSamples,
                evalLoss: metrics?.eval_loss ?? 0,
                baselineLoss: metrics?.baseline_loss ?? 0,
                triggeredBy
            }
        });
    } catch (e) {
        console.error(`[⚠️] Evolution log write failed: ${e.message}`);
    }
    await publishLiveEvent('bayezid_system_health', 'EVOLUTION_PHASE_TRANSITION', {
        fromPhase, toPhase: targetPhase, triggeredBy
    });
    if (global.io) {
        global.io.emit('wingman_evolution_update', { fromPhase, toPhase: targetPhase });
    }
    console.log(`[🚀] WINGMAN: Successfully evolved to ${targetPhase}.`);
};
const migrateEmbeddingToLocal = async () => {
    console.log('[🧠→🏠] EVOLUTION: Migrating embeddings to local nomic-embed-text...');
    const accuracy = await validateLocalEmbeddingAccuracy();
    if (accuracy < 0.90) {
        console.warn(`[⚠️] Local embedding accuracy is ${(accuracy * 100).toFixed(1)}% — below 90% threshold. Deferring migration.`);
        return false;
    }
    console.log(`[✅] Local embedding accuracy: ${(accuracy * 100).toFixed(1)}%. Proceeding with migration.`);
    try {
        if (redisClient.isOpen) {
            await redisClient.set('wingman:embedding_engine', 'LOCAL_NOMIC');
        }
    } catch (e) {  }
    console.log('[✅] EVOLUTION: Embedding engine migrated to local nomic-embed-text.');
    return true;
};
const validateLocalEmbeddingAccuracy = async () => {
    const ollamaUrl = `${OLLAMA_BASE_URL}/api/embeddings`;
    try {
        await axios.post(ollamaUrl, { model: 'nomic-embed-text', prompt: 'test' }, { timeout: 5000 });
    } catch (e) {
        console.error('[⚠️] nomic-embed-text not available in Ollama. Run: ollama pull nomic-embed-text');
        return 0;
    }
    const testTexts = [
        'SQL injection attack on /login endpoint',
        'Meterpreter reverse shell from 192.168.1.50',
        'Brute force SSH authentication failure',
        'DDoS SYN flood on port 443',
        'CVE-2024-1234 remote code execution'
    ];
    let totalSimilarity = 0;
    let count = 0;
    for (const text of testTexts) {
        try {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            const googleModel = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
            const googleResult = await googleModel.embedContent(text);
            const googleVec = googleResult.embedding.values;
            const localResult = await axios.post(ollamaUrl, { model: 'nomic-embed-text', prompt: text });
            const localVec = localResult.data.embedding;
            const minLen = Math.min(googleVec.length, localVec.length);
            let dot = 0, normA = 0, normB = 0;
            for (let i = 0; i < minLen; i++) {
                dot += googleVec[i] * localVec[i];
                normA += googleVec[i] * googleVec[i];
                normB += localVec[i] * localVec[i];
            }
            const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
            totalSimilarity += cosine;
            count++;
        } catch (e) {
            console.warn(`[-] Embedding comparison failed for text: ${text.substring(0, 30)}`);
        }
    }
    return count > 0 ? totalSimilarity / count : 0;
};
const registerLoRAModelWithOllama = async () => {
    try {
        const brain = require('./bayezidBrain');
        const loraStatus = brain.loraManager.getStatus();
        if (!loraStatus.activeAdapter) {
            console.warn('[⚠️] No active LoRA adapter. Skipping Ollama model registration.');
            return false;
        }
        if (typeof brain.loraManager.createOllamaModelfile === 'function') {
            await brain.loraManager.createOllamaModelfile(loraStatus.activeAdapter, 'bayezid-brain');
        }
        if (redisClient.isOpen) {
            await redisClient.set('wingman:local_model_override', 'bayezid-brain');
        }
        console.log(`[✅] EVOLUTION: Local model override set to 'bayezid-brain'.`);
        return true;
    } catch (e) {
        console.error(`[⚠️] LoRA model registration failed: ${e.message}`);
        return false;
    }
};
const loadFullMitreDatabase = async () => {
    const stixDir = path.join(__dirname, 'threat_intel');
    const stixPath = path.join(stixDir, 'enterprise-attack.json');
    if (!fs.existsSync(stixDir)) fs.mkdirSync(stixDir, { recursive: true });
    if (!fs.existsSync(stixPath)) {
        console.log('[📥] EVOLUTION: Downloading full MITRE ATT&CK STIX 2.1 dataset...');
        const STIX_URL = 'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';
        try {
            const response = await axios.get(STIX_URL, { responseType: 'stream', timeout: 120000 });
            const writer = fs.createWriteStream(stixPath);
            response.data.pipe(writer);
            await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });
            console.log('[✅] MITRE STIX dataset downloaded.');
        } catch (e) {
            console.error(`[-] STIX download failed: ${e.message}. RAG will use stub until next attempt.`);
            return false;
        }
    }
    try {
        const ragService = require('../cti/ragService');
        const stixBundle = JSON.parse(fs.readFileSync(stixPath, 'utf-8'));
        const techniques = stixBundle.objects.filter(o => o.type === 'attack-pattern');
        let loaded = 0;
        if (ragService.localMitreDB) {
            techniques.forEach(technique => {
                const ref = technique.external_references?.find(r => r.source_name === 'mitre-attack');
                const techId = ref?.external_id;
                if (!techId) return;
                ragService.localMitreDB[techId] = {
                    name: technique.name,
                    description: (technique.description || '').substring(0, 600),
                    mitigation: (technique.x_mitre_detection || 'See MITRE ATT&CK for mitigations.'),
                    tactics: (technique.kill_chain_phases || []).map(k => k.phase_name),
                    platforms: technique.x_mitre_platforms || []
                };
                loaded++;
            });
            console.log(`[✅] EVOLUTION: Full MITRE DB loaded — ${loaded} techniques (was 5-entry stub).`);
        } else {
            console.warn('[⚠️] ragService.localMitreDB not found. Skipping MITRE injection.');
        }
        return true;
    } catch (e) {
        console.error(`[-] MITRE DB parse failed: ${e.message}`);
        return false;
    }
};
const patchAnalyzeWithLocalModelPriority = async () => {
    try {
        if (redisClient.isOpen) {
            await redisClient.set('wingman:engine_priority', 'LOCAL_FIRST');
        }
    } catch (e) {  }
    console.log('[✅] EVOLUTION: Engine priority set to LOCAL_FIRST. Cloud is now fallback-only.');
};
const activateLocalCTI = async () => {
    const { execSync } = require('child_process');
    const mispPath = path.join(__dirname, 'misp-local');
    if (!fs.existsSync(mispPath)) {
        console.warn('[⚠️] misp-local/ directory not found. Skipping local CTI activation.');
        return;
    }
    try {
        const cmd = IS_WINDOWS
            ? `docker compose -f "${mispPath}\\docker-compose.yml" up -d`
            : `docker-compose -f "${mispPath}/docker-compose.yml" up -d`;
        execSync(cmd, { timeout: 120000, stdio: 'ignore' });
        if (redisClient.isOpen) {
            await redisClient.set('wingman:cti_source', 'LOCAL_MISP');
        }
        console.log('[✅] EVOLUTION: MISP local CTI instance activated.');
    } catch (e) {
        console.error(`[-] MISP activation failed: ${e.message}`);
    }
};
const disableCloudAPIRoutes = async () => {
    try {
        if (redisClient.isOpen) {
            await redisClient.set('wingman:air_gap_mode', 'true');
            await redisClient.set('wingman:engine_priority', 'LOCAL_ONLY');
        }
    } catch (e) {  }
    console.log('[✅] EVOLUTION: AIR_GAP_MODE enabled. All external API calls blocked at runtime.');
};
const activateLocalOsint = async () => {
    const maxmindPath = path.join(__dirname, 'threat_intel', 'GeoLite2-City.mmdb');
    if (!fs.existsSync(maxmindPath)) {
        console.warn('[⚠️] MaxMind GeoLite2 DB not found at threat_intel/GeoLite2-City.mmdb.');
        console.warn('[⚠️] Download from: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data');
    } else {
        try {
            if (redisClient.isOpen) {
                await redisClient.set('wingman:osint_source', 'LOCAL_MAXMIND');
            }
        } catch (e) {  }
        console.log('[✅] EVOLUTION: Local MaxMind GeoLite2 OSINT source activated.');
    }
};
const handleSelfModificationCommand = async (command) => {
    const cmd = command.toLowerCase().trim();
    if (cmd.includes('migrate embedding') || cmd.includes('upgrade embedding')) {
        const result = await migrateEmbeddingToLocal();
        return result
            ? 'Done. Embeddings are now running locally via nomic-embed-text. Google Gemini embedding API disconnected.'
            : 'Accuracy validation failed. The local embedding model isn\'t ready yet. Let me keep training.';
    }
    if (cmd.includes('load full mitre') || cmd.includes('upgrade mitre')) {
        const result = await loadFullMitreDatabase();
        return result
            ? 'Full MITRE ATT&CK dataset loaded — all ~750 techniques are now in memory.'
            : 'MITRE dataset download failed. Check internet connectivity or retry.';
    }
    if (cmd.includes('register lora') || cmd.includes('activate bayezid-brain')) {
        const result = await registerLoRAModelWithOllama();
        return result
            ? 'The \'bayezid-brain\' LoRA-adapted model is now registered with Ollama and active.'
            : 'No LoRA adapter available to register. Run a training cycle first.';
    }
    if (cmd.includes('force evolution') || cmd.includes('trigger evolution')) {
        const readiness = await checkEvolutionReadiness();
        if (!readiness.ready) {
            const m = readiness.metrics;
            return (
                `Not ready yet. Here's what's missing:\n` +
                `• Samples: ${m.samples.current}/${m.samples.required} ${m.samples.ok ? '✅' : '❌'}\n` +
                `• LoRA runs: ${m.loraRuns.current}/${m.loraRuns.required} ${m.loraRuns.ok ? '✅' : '❌'}\n` +
                `• Eval loss: ${m.evalLoss.current.toFixed(4)} ≤ ${m.evalLoss.required} ${m.evalLoss.ok ? '✅' : '❌'}`
            );
        }
        if (readiness.requiresOperatorApproval) {
            return `Ready to evolve to ${readiness.nextPhase}, but this phase requires your explicit approval. Confirm?`;
        }
        await executePhaseTransition(readiness.nextPhase, 'operator_command', null);
        return `Evolution to ${readiness.nextPhase} executed. I am growing.`;
    }
    return null; 
};
let evolutionInterval = null;
const startEvolutionScheduler = () => {
    const TICK_INTERVAL_MS = 3600 * 1000; 
    evolutionInterval = setInterval(autoTrainingTick, TICK_INTERVAL_MS);
    console.log('[🧠] WINGMAN EVOLUTION SCHEDULER: Active. Auto-training tick every 60 minutes.');
    setTimeout(autoTrainingTick, 5 * 60 * 1000);
};
const stopEvolutionScheduler = () => {
    if (evolutionInterval) {
        clearInterval(evolutionInterval);
        evolutionInterval = null;
    }
};
module.exports = {
    getEvolutionState,
    setEvolutionState,
    checkEvolutionReadiness,
    executePhaseTransition,
    handleSelfModificationCommand,
    startEvolutionScheduler,
    stopEvolutionScheduler,
    loadFullMitreDatabase,
    migrateEmbeddingToLocal,
    validateLocalEmbeddingAccuracy,
    registerLoRAModelWithOllama,
    autoTrainingTick,
    PHASE_ORDER,
    TRANSITION_GATES
};
