const ebpfBridge = require('./ebpfBridge');
const axios = require('axios');
class eBPFWeightUpdater {
    constructor(intervalMs = 300000) { 
        this.intervalMs = intervalMs;
        this.timer = null;
        this.mlEndpoint = 'http://localhost:8000/api/v1/ml/ebpf-weights';
        this.FP_SCALE = 1000000;
    }
    start() {
        if (this.timer) return;
        console.log(`[🧠] eBPF Weight Updater started. Polling every ${this.intervalMs / 1000}s.`);
        ebpfBridge.setEbpfMode(process.env.BAYEZID_EBPF_MODE || 'monitor').catch(() => {});
        this.updateCycle();
        this.timer = setInterval(() => this.updateCycle(), this.intervalMs);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[🧠] eBPF Weight Updater stopped.');
        }
    }
    async updateCycle() {
        try {
            console.log('[🧠] Fetching latest LoRA weights for eBPF injection...');
            let weights = [];
            try {
                const response = await axios.get(this.mlEndpoint, { timeout: 3000 });
                weights = response.data.weights;
            } catch (err) {
                console.warn(`[🧠] ML API offline. Using heuristic defensive baseline weights.`);
                weights = [
                    0.05,  
                    0.01,  
                    -0.02, 
                    0.2,   
                    -0.1,  
                    0.5,   
                    0.01,  
                    0.0,   
                    -1.0   
                ];
            }
            const fixedPointWeights = weights.map(w => Math.round(w * this.FP_SCALE));
            await ebpfBridge.updateNeuralWeights(1, fixedPointWeights);
        } catch (e) {
            console.error(`[-] eBPF Weight Update Cycle Error: ${e.message}`);
        }
    }
}
module.exports = new eBPFWeightUpdater();
