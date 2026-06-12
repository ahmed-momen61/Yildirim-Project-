
'use strict';

class ShortTermMemory {
        constructor(maxEntries = 50, maxTokenEstimate = 4000) {
        this.maxEntries = maxEntries;
        this.maxTokenEstimate = maxTokenEstimate;
                this.entries = [];
    }

        add(role, content, metadata = {}) {
        if (!['agent', 'tool', 'system', 'user'].includes(role)) {
            console.warn(`[ShortTermMemory] Unrecognized role: ${role}`);
        }

        this.entries.push({
            role,
            content: String(content),
            timestamp: new Date().toISOString(),
            metadata
        });

        this._evictIfNecessary();
    }

        getContext() {
        return [...this.entries];
    }

        getSummary(n = 10) {
        const slice = this.entries.slice(-n);
        return slice.map(e => `[${e.timestamp}] ${e.role.toUpperCase()}: ${e.content}`).join('\n');
    }

        search(query) {
        const lowerQuery = query.toLowerCase();
        return this.entries.filter(e => e.content.toLowerCase().includes(lowerQuery));
    }

        clear() {
        this.entries = [];
    }

        size() {
        return this.entries.length;
    }

        _evictIfNecessary() {
        
        while (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        
        while (this.entries.length > 0 && this._estimateTokens() > this.maxTokenEstimate) {
            
            this.entries.shift();
        }
    }

        _estimateTokens() {
        return this.entries.reduce((total, entry) => {
            const words = entry.content.split(/\s+/).length;
            return total + Math.ceil(words * 1.3);
        }, 0);
    }
}

module.exports = ShortTermMemory;
