const crypto = require('crypto');
const axios = require('axios');
const { publishLiveEvent } = require('../memory_systems/memoryService');
const addDifferentialPrivacy = (gradients, epsilon = 1.0, sensitivity = 1.0) => {
    const noisyGradients = new Float32Array(gradients.length);
    const scale = sensitivity / epsilon;
    for (let i = 0; i < gradients.length; i++) {
        const u = Math.random() - 0.5;
        const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
        noisyGradients[i] = gradients[i] + noise;
    }
    return noisyGradients;
};
const clipGradients = (gradients, maxNorm = 1.0) => {
    let norm = 0;
    for (let i = 0; i < gradients.length; i++) {
        norm += gradients[i] * gradients[i];
    }
    norm = Math.sqrt(norm);
    if (norm > maxNorm) {
        const scale = maxNorm / norm;
        const clipped = new Float32Array(gradients.length);
        for (let i = 0; i < gradients.length; i++) {
            clipped[i] = gradients[i] * scale;
        }
        return clipped;
    }
    return gradients;
};
class FederatedLocalModel {
    constructor(nodeId, modelDim = 256) {
        this.nodeId = nodeId;
        this.modelDim = modelDim;
        this.weights = new Float32Array(modelDim);
        this.gradients = null;
        this.trainingRounds = 0;
        this.localDataSize = 0;
        const scale = Math.sqrt(2.0 / modelDim);
        for (let i = 0; i < modelDim; i++) {
            this.weights[i] = (Math.random() * 2 - 1) * scale;
        }
    }
        trainLocal(localData, learningRate = 0.01, epochs = 5) {
        console.log(`[🐝] Node ${this.nodeId}: Training on ${localData.length} samples (${epochs} epochs)...`);
        const prevWeights = new Float32Array(this.weights);
        this.localDataSize = localData.length;
        for (let epoch = 0; epoch < epochs; epoch++) {
            for (const sample of localData) {
                const features = sample.features || new Float32Array(this.modelDim);
                let prediction = 0;
                for (let i = 0; i < Math.min(features.length, this.modelDim); i++) {
                    prediction += this.weights[i] * (features[i] || 0);
                }
                prediction = 1 / (1 + Math.exp(-prediction));
                const error = prediction - (sample.label || 0);
                for (let i = 0; i < Math.min(features.length, this.modelDim); i++) {
                    this.weights[i] -= learningRate * error * (features[i] || 0);
                }
            }
        }
        this.gradients = new Float32Array(this.modelDim);
        for (let i = 0; i < this.modelDim; i++) {
            this.gradients[i] = this.weights[i] - prevWeights[i];
        }
        const MAX_GRAD_NORM = 5.0;
        const norm = this._norm(this.gradients);
        if (norm > MAX_GRAD_NORM) {
            for (let i = 0; i < this.modelDim; i++) {
                this.gradients[i] = this.gradients[i] * (MAX_GRAD_NORM / norm);
            }
        }
        const sensitivity = MAX_GRAD_NORM;
        const epsilon = 0.1;
        const b = sensitivity / epsilon;
        for (let i = 0; i < this.modelDim; i++) {
            this.gradients[i] = this.gradients[i] + (Math.random() < 0.5 ? 1 : -1) * (-b * Math.log(1 - Math.random()));
        }
        this.trainingRounds++;
        console.log(`[🐝] Node ${this.nodeId}: Local training complete. Gradient norm: ${this._norm(this.gradients).toFixed(6)}`);
        return this.gradients;
    }
    applyGlobalUpdate(globalGradients) {
        for (let i = 0; i < this.modelDim; i++) {
            this.weights[i] += globalGradients[i];
        }
        console.log(`[🐝] Node ${this.nodeId}: Global update applied.`);
    }
    _norm(arr) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum);
    }
}
class FederationAggregator {
    constructor(options = {}) {
        this.modelDim = options.modelDim || 256;
        this.epsilon = options.epsilon || 1.0;
        this.maxGradNorm = options.maxGradNorm || 1.0;
        this.globalWeights = new Float32Array(this.modelDim);
        this.registeredNodes = new Map();
        this.pendingUpdates = new Map();
        this.roundNumber = 0;
        this.roundHistory = [];
        this.swarmNodes = (process.env.SWARM_NODES || 'http://localhost:3000').split(',');
        const scale = Math.sqrt(2.0 / this.modelDim);
        for (let i = 0; i < this.modelDim; i++) {
            this.globalWeights[i] = (Math.random() * 2 - 1) * scale;
        }
    }
    registerNode(nodeId, endpoint) {
        this.registeredNodes.set(nodeId, {
            endpoint,
            lastSeen: Date.now(),
            roundsParticipated: 0
        });
        console.log(`[🌐] Federation: Node ${nodeId} registered (${endpoint}).`);
    }
    receiveUpdate(nodeId, rawGradients, dataSize) {
        console.log(`[🌐] Federation: Received gradient delta from node ${nodeId} (${dataSize} samples).`);
        const clipped = clipGradients(rawGradients, this.maxGradNorm);
        const privatized = addDifferentialPrivacy(clipped, this.epsilon);
        this.pendingUpdates.set(nodeId, {
            gradients: privatized,
            dataSize,
            timestamp: Date.now()
        });
        if (this.registeredNodes.has(nodeId)) {
            this.registeredNodes.get(nodeId).lastSeen = Date.now();
            this.registeredNodes.get(nodeId).roundsParticipated++;
        }
        console.log(`[🌐] DP noise injected (ε=${this.epsilon}). Update stored for aggregation.`);
        return { accepted: true, noiseLevel: this.epsilon };
    }
    _standardFedAvg(updates) {
        const aggregated = new Float32Array(this.modelDim);
        let totalData = 0;
        for (const update of updates) {
            totalData += update.dataSize;
        }
        for (const update of updates) {
            const weight = update.dataSize / totalData;
            for (let i = 0; i < this.modelDim; i++) {
                aggregated[i] += update.gradients[i] * weight;
            }
        }
        return aggregated;
    }
    aggregate() {
        if (this.pendingUpdates.size === 0) {
            console.log(`[⚠️] No pending updates to aggregate.`);
            return null;
        }
        console.log(`\n[🌐] =============================================`);
        console.log(`[🌐] FEDERATION: Round ${this.roundNumber + 1} Aggregation`);
        console.log(`[🌐] Participating Nodes: ${this.pendingUpdates.size}`);
        console.log(`[🌐] =============================================\n`);
        const DATA_SIZE_CAP = 10000;
        for (const [nodeId, update] of this.pendingUpdates) {
            if (update.dataSize > DATA_SIZE_CAP) {
                console.log(`[🛡️] BFT: Capping dataSize for node ${nodeId}: ${update.dataSize} -> ${DATA_SIZE_CAP}`);
                update.dataSize = DATA_SIZE_CAP;
            }
        }
        const updates = [...this.pendingUpdates.values()];
        let aggregated;
        if (updates.length < 3) {
            console.log(`[🌐] FedAvg fallback (< 3 valid nodes).`);
            aggregated = this._standardFedAvg(updates);
        } else {
            console.log(`[🛡️] BFT: Using Multi-Krum Byzantine Robust Aggregation (${updates.length} nodes).`);
            const n = updates.length;
            const f = Math.floor(n / 3);
            const distances = updates.map((ui, i) => {
                const neighborDists = updates.map((uj, j) => {
                    if (i === j) return Infinity;
                    let dist = 0;
                    for (let k = 0; k < this.modelDim; k++) {
                        dist += Math.pow(ui.gradients[k] - uj.gradients[k], 2);
                    }
                    return Math.sqrt(dist);
                }).sort((a, b) => a - b);
                return neighborDists.slice(0, n - f - 2).reduce((s, d) => s + d, 0);
            });
            const m = n - f;
            const selected = distances
                .map((d, i) => ({ d, i }))
                .sort((a, b) => a.d - b.d)
                .slice(0, m)
                .map(({ i }) => updates[i]);
            aggregated = this._standardFedAvg(selected);
        }
        for (let i = 0; i < this.modelDim; i++) {
            this.globalWeights[i] += aggregated[i];
        }
        let totalData = 0;
        for (const update of updates) {
            totalData += update.dataSize;
        }
        const roundResult = {
            round: this.roundNumber,
            nodes: updates.length,
            totalData,
            aggregatedNorm: this._norm(aggregated),
            globalWeightsNorm: this._norm(this.globalWeights),
            timestamp: new Date().toISOString()
        };
        this.roundHistory.push(roundResult);
        this.roundNumber++;
        this.pendingUpdates.clear();
        console.log(`[🌐] Global model updated. Round ${this.roundNumber} complete.`);
        console.log(`[🌐] Aggregated gradient norm: ${roundResult.aggregatedNorm.toFixed(6)}`);
        try {
            publishLiveEvent('bayezid_tactical_feed', 'FEDERATION_ROUND_COMPLETE', roundResult);
        } catch (e) {}
        return { globalWeights: this.globalWeights, roundResult };
    }
    async distributeGlobalModel() {
        console.log(`[🌐] Federation: Distributing global model to ${this.swarmNodes.length} swarm nodes...`);
        const payload = {
            round: this.roundNumber,
            globalWeightsChecksum: crypto.createHash('sha256')
                .update(Buffer.from(this.globalWeights.buffer))
                .digest('hex'),
            modelDim: this.modelDim,
            timestamp: new Date().toISOString()
        };
        const results = [];
        for (const nodeUrl of this.swarmNodes) {
            try {
                const res = await axios.post(`${nodeUrl}/api/v1/federation/receive-global`, payload, { timeout: 5000 });
                results.push({ node: nodeUrl, status: 'delivered', response: res.status });
                console.log(`[✔] Delivered to ${nodeUrl}`);
            } catch (e) {
                results.push({ node: nodeUrl, status: 'failed', error: e.message });
                console.log(`[!] Failed to deliver to ${nodeUrl}: ${e.message}`);
            }
        }
        return results;
    }
    _norm(arr) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum);
    }
    getStatus() {
        return {
            roundNumber: this.roundNumber,
            registeredNodes: Object.fromEntries([...this.registeredNodes.entries()].map(([k, v]) => [k, {...v }])),
            pendingUpdates: this.pendingUpdates.size,
            globalModelNorm: this._norm(this.globalWeights),
            epsilon: this.epsilon,
            recentRounds: this.roundHistory.slice(-5)
        };
    }
}
const federationAggregator = new FederationAggregator();
module.exports = { FederatedLocalModel, FederationAggregator, federationAggregator, addDifferentialPrivacy, clipGradients };