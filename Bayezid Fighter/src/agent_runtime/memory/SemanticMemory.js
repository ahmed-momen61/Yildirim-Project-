
'use strict';

class SemanticMemory {
        constructor(redisClient, namespace = 'bayezid:semantic') {
        this.redisClient = redisClient;
        this.namespace = namespace;
        this.vectorsKey = `${this.namespace}:vectors`;
        this.vocabKey = `${this.namespace}:vocab`;
        this.docCountKey = `${this.namespace}:doc_count`;
    }

        _tokenize(text) {
        if (!text) return [];
        return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);
    }

    /**
     * Compute TF (Term Frequency) for a list of tokens.
     * @param {string[]} tokens
     * @returns {Object<string, number>}
     * @private
     */
    _computeTF(tokens) {
        const tf = {};
        const total = tokens.length;
        if (total === 0) return tf;

        for (const token of tokens) {
            tf[token] = (tf[token] || 0) + 1;
        }

        // Normalize
        for (const token in tf) {
            tf[token] = tf[token] / total;
        }
        return tf;
    }

    /**
     * Fetch IDF values for given tokens from Redis.
     * If a token is unseen, its IDF is calculated assuming it appears in 1 document.
     * @param {string[]} tokens
     * @param {number} totalDocs
     * @returns {Promise<Object<string, number>>}
     * @private
     */
    async _getIDF(tokens, totalDocs) {
        const idf = {};
        if (tokens.length === 0 || !this._isRedisAvailable()) return idf;

        const uniqueTokens = [...new Set(tokens)];
        
        try {
            // Get document frequencies for these tokens
            const dfs = await this.redisClient.hmGet(this.vocabKey, uniqueTokens);
            
            for (let i = 0; i < uniqueTokens.length; i++) {
                const token = uniqueTokens[i];
                // If unseen, assume df=1 to avoid Infinity/Zero
                const df = parseInt(dfs[i], 10) || 1; 
                // Standard IDF formula: log( N / (df + 1) )
                idf[token] = Math.log( (totalDocs + 1) / (df + 1) ) + 1;
            }
        } catch (err) {
            console.warn(`[SemanticMemory] IDF fetch failed: ${err.message}`);
            // Fallback: raw TF
            for (const t of uniqueTokens) idf[t] = 1;
        }
        
        return idf;
    }

    /**
     * Generate a TF-IDF vector mapping term -> weight.
     * @param {string} text
     * @returns {Promise<Object<string, number>>}
     */
    async embed(text) {
        const tokens = this._tokenize(text);
        const tf = this._computeTF(tokens);
        
        let totalDocs = 1;
        if (this._isRedisAvailable()) {
            const count = await this.redisClient.get(this.docCountKey);
            totalDocs = parseInt(count, 10) || 1;
        }

        const idf = await this._getIDF(Object.keys(tf), totalDocs);
        
        const vector = {};
        let normSq = 0;

        for (const token in tf) {
            const weight = tf[token] * idf[token];
            vector[token] = weight;
            normSq += weight * weight;
        }

        // L2 Normalization
        const norm = Math.sqrt(normSq);
        if (norm > 0) {
            for (const token in vector) {
                vector[token] = vector[token] / norm;
            }
        }

        return vector;
    }

    /**
     * Store text and its embedding in Redis.
     * @param {string} id
     * @param {string} text
     * @param {Object} [metadata={}]
     * @returns {Promise<boolean>}
     */
    async store(id, text, metadata = {}) {
        if (!this._isRedisAvailable() || !id || !text) return false;

        try {
            const vector = await this.embed(text);
            const tokens = Object.keys(vector);

            // Update document frequencies in vocab
            const multi = this.redisClient.multi();
            for (const token of tokens) {
                multi.hIncrBy(this.vocabKey, token, 1);
            }
            // Increment total doc count
            multi.incr(this.docCountKey);
            
            // Store vector data
            const record = {
                id,
                text, // Optionally truncate if too large
                vector,
                metadata,
                timestamp: new Date().toISOString()
            };
            
            multi.hSet(this.vectorsKey, id, JSON.stringify(record));
            await multi.exec();

            return true;
        } catch (err) {
            console.warn(`[SemanticMemory] Store failed: ${err.message}`);
            return false;
        }
    }

    /**
     * Compute cosine similarity between two unit vectors.
     * (dot product since they are already L2 normalized)
     * @param {Object<string, number>} vecA
     * @param {Object<string, number>} vecB
     * @returns {number}
     * @private
     */
    _cosineSimilarity(vecA, vecB) {
        let dot = 0;
        // Iterate over the smaller vector
        const keysA = Object.keys(vecA);
        const keysB = Object.keys(vecB);
        const [smaller, larger] = keysA.length < keysB.length ? [vecA, vecB] : [vecB, vecA];

        for (const token in smaller) {
            if (larger[token]) {
                dot += smaller[token] * larger[token];
            }
        }
        return dot;
    }

    /**
     * Query memory for semantic matches.
     * @param {string} text
     * @param {number} [topK=5]
     * @param {number} [threshold=0.1]
     * @returns {Promise<Object[]>} Array of matches { id, score, text, metadata }
     */
    async query(text, topK = 5, threshold = 0.1) {
        if (!this._isRedisAvailable()) return [];

        try {
            const queryVector = await this.embed(text);
            if (Object.keys(queryVector).length === 0) return [];

            // Fetch ALL vectors (Note: For massive datasets, an inverted index is needed.
            // For Bayezid's local scale, a linear scan over HVALS is acceptable.)
            const allRecordsStr = await this.redisClient.hVals(this.vectorsKey);
            
            const matches = [];

            for (const recordStr of allRecordsStr) {
                const record = JSON.parse(recordStr);
                const score = this._cosineSimilarity(queryVector, record.vector);
                
                if (score >= threshold) {
                    matches.push({
                        id: record.id,
                        score: score,
                        text: record.text,
                        metadata: record.metadata
                    });
                }
            }

            
            matches.sort((a, b) => b.score - a.score);
            return matches.slice(0, topK);

        } catch (err) {
            console.warn(`[SemanticMemory] Query failed: ${err.message}`);
            return [];
        }
    }

        async delete(id) {
        if (!this._isRedisAvailable()) return false;
        try {
            
            
            await this.redisClient.hDel(this.vectorsKey, id);
            return true;
        } catch (err) {
            return false;
        }
    }

        async count() {
        if (!this._isRedisAvailable()) return 0;
        try {
            return await this.redisClient.hLen(this.vectorsKey);
        } catch (err) {
            return 0;
        }
    }

        _isRedisAvailable() {
        if (!this.redisClient || !this.redisClient.isOpen) {
            return false;
        }
        return true;
    }
}

module.exports = SemanticMemory;
