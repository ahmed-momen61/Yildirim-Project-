
'use strict';

const crypto = require('crypto');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

class EpisodicMemory {
        constructor(redisClient, agentId) {
        if (!agentId) throw new Error('[EpisodicMemory] agentId is required');
        this.redisClient = redisClient;
        this.agentId = agentId;
        this.baseKey = `bayezid:episodic:${agentId}`;
        this.hashKey = `${this.baseKey}:data`;
        this.sortedSetKey = `${this.baseKey}:timeline`;
    }

        async store(episode) {
        if (!this._isRedisAvailable()) return false;

        const id = episode.episode_id || crypto.randomUUID();
        const ts = episode.timestamp ? new Date(episode.timestamp).getTime() : Date.now();
        
        const fullEpisode = {
            ...episode,
            episode_id: id,
            agent_id: this.agentId,
            timestamp: new Date(ts).toISOString()
        };

        try {
            await this.redisClient.hSet(this.hashKey, id, JSON.stringify(fullEpisode));
            await this.redisClient.zAdd(this.sortedSetKey, [{ score: ts, value: id }]);
            
            await this.prune();
            return true;
        } catch (err) {
            console.warn(`[EpisodicMemory] Store failed: ${err.message}`);
            return false;
        }
    }

        async recall(query, limit = 5) {
        if (!this._isRedisAvailable()) return [];

        try {
            const allIds = await this.redisClient.zRange(this.sortedSetKey, 0, -1, { REV: true });
            const lowerQuery = query.toLowerCase();
            const results = [];

            for (const id of allIds) {
                if (results.length >= limit) break;
                
                const raw = await this.redisClient.hGet(this.hashKey, id);
                if (raw) {
                    const ep = JSON.parse(raw);
                    const searchableText = `${ep.summary} ${ep.incident_type} ${ep.lessons_learned || ''}`.toLowerCase();
                    if (searchableText.includes(lowerQuery)) {
                        results.push(ep);
                    }
                }
            }
            return results;
        } catch (err) {
            console.warn(`[EpisodicMemory] Recall failed: ${err.message}`);
            return [];
        }
    }

        async recallByMitre(techniqueId, limit = 5) {
        if (!this._isRedisAvailable()) return [];

        try {
            const allIds = await this.redisClient.zRange(this.sortedSetKey, 0, -1, { REV: true });
            const results = [];

            for (const id of allIds) {
                if (results.length >= limit) break;
                
                const raw = await this.redisClient.hGet(this.hashKey, id);
                if (raw) {
                    const ep = JSON.parse(raw);
                    if (ep.mitre_techniques && ep.mitre_techniques.includes(techniqueId)) {
                        results.push(ep);
                    }
                }
            }
            return results;
        } catch (err) {
            console.warn(`[EpisodicMemory] recallByMitre failed: ${err.message}`);
            return [];
        }
    }

        async recallRecent(limit = 5) {
        if (!this._isRedisAvailable()) return [];

        try {
            
            const ids = await this.redisClient.zRange(this.sortedSetKey, 0, limit - 1, { REV: true });
            const results = [];

            for (const id of ids) {
                const raw = await this.redisClient.hGet(this.hashKey, id);
                if (raw) results.push(JSON.parse(raw));
            }
            return results;
        } catch (err) {
            console.warn(`[EpisodicMemory] recallRecent failed: ${err.message}`);
            return [];
        }
    }

        async prune() {
        if (!this._isRedisAvailable()) return 0;

        try {
            const cutoff = Date.now() - THIRTY_DAYS_MS;
            
            const oldIds = await this.redisClient.zRangeByScore(this.sortedSetKey, '-inf', cutoff);
            
            if (oldIds.length > 0) {
                
                await this.redisClient.hDel(this.hashKey, oldIds);
                
                await this.redisClient.zRemRangeByScore(this.sortedSetKey, '-inf', cutoff);
            }
            
            return oldIds.length;
        } catch (err) {
            console.warn(`[EpisodicMemory] Prune failed: ${err.message}`);
            return 0;
        }
    }

        async getStats() {
        if (!this._isRedisAvailable()) return { error: 'Redis unavailable' };

        try {
            const count = await this.redisClient.zCard(this.sortedSetKey);
            
            
            
            const recent = await this.recallRecent(100);
            
            let successes = 0;
            const typeCounts = {};

            for (const ep of recent) {
                if (ep.outcome === 'SUCCESS') successes++;
                if (ep.incident_type) {
                    typeCounts[ep.incident_type] = (typeCounts[ep.incident_type] || 0) + 1;
                }
            }

            return {
                totalEpisodes: count,
                sampledSuccessRate: recent.length > 0 ? (successes / recent.length) * 100 : 0,
                commonIncidentTypes: typeCounts
            };

        } catch (err) {
            console.warn(`[EpisodicMemory] getStats failed: ${err.message}`);
            return { error: err.message };
        }
    }

        _isRedisAvailable() {
        if (!this.redisClient || !this.redisClient.isOpen) {
            return false;
        }
        return true;
    }
}

module.exports = EpisodicMemory;
