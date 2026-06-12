const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
let collectionId = null;

const ensureChromaRunning = async () => {
    try {
        const url = new URL(CHROMA_URL);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            const port = url.port || '8000';
            try {
                
                await axios.get(`${CHROMA_URL}/api/v2/heartbeat`, { timeout: 1500 });
                console.log('[🧠 CHROMA] ChromaDB is already running and reachable.');
                return true;
            } catch (err) {
                console.log(`[🧠 CHROMA] ChromaDB not reachable on port ${port}. Attempting to start Docker container...`);
                try {
                    
                    await execPromise('docker start bayezid-chroma');
                    console.log('[🧠 CHROMA] Successfully started existing "bayezid-chroma" container.');
                    await new Promise(r => setTimeout(r, 3000));
                    return true;
                } catch (startErr) {
                    try {
                        
                        console.log('[🧠 CHROMA] Container not found or failed to start. Creating a new container...');
                        await execPromise(`docker run -d -p ${port}:8000 --name bayezid-chroma chromadb/chroma`);
                        console.log(`[🧠 CHROMA] Successfully created and started new "bayezid-chroma" container on port ${port}.`);
                        await new Promise(r => setTimeout(r, 6000));
                        return true;
                    } catch (runErr) {
                        console.error(`[⚠️ CHROMA] Failed to auto-start ChromaDB container: ${runErr.message}`);
                        return false;
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`[⚠️ CHROMA] Error checking ChromaDB URL: ${e.message}`);
    }
    return false;
};

const initCollection = async () => {
    await ensureChromaRunning();
    try {
        const response = await axios.post(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections`, {
            name: 'bayezid_memory',
            get_or_create: true
        });
        if (response.data && response.data.id) {
            collectionId = response.data.id;
            console.log(`[🧠 CHROMA] Initialized collection 'bayezid_memory' (ID: ${collectionId})`);
            return collectionId;
        }
        throw new Error('No collection ID returned from ChromaDB');
    } catch (e) {
        console.warn(`[⚠️ CHROMA] Failed to initialize collection: ${e.message}`);
        return null;
    }
};

const getCollectionId = async () => {
    if (collectionId) return collectionId;
    return await initCollection();
};

const storeIncident = async (alertId, textContext, metadata = {}, embeddingVector = null) => {
    try {
        const id = await getCollectionId();
        if (!id) {
            console.warn('[⚠️ CHROMA] Skipping storage: Collection not initialized');
            return false;
        }
        
        const embeddings = embeddingVector ? [embeddingVector] : [new Array(1536).fill(0.0)];

        const payload = {
            ids: [String(alertId)],
            embeddings: embeddings,
            metadatas: [metadata],
            documents: [textContext]
        };

        await axios.post(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${id}/add`, payload);
        console.log(`[🧠 CHROMA] Incident ${alertId} stored successfully.`);
        return true;
    } catch (e) {
        console.error(`[⚠️ CHROMA] Failed to store incident ${alertId}:`, e.message);
        return false;
    }
};

const recallSimilar = async (queryEmbedding, nResults = 3) => {
    try {
        const id = await getCollectionId();
        if (!id) {
            console.warn('[⚠️ CHROMA] Skipping query: Collection not initialized');
            return [];
        }

        const payload = {
            query_embeddings: [queryEmbedding || new Array(1536).fill(0.0)],
            n_results: nResults,
            include: ['documents', 'metadatas', 'distances']
        };

        const response = await axios.post(`${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database/collections/${id}/query`, payload);
        const results = [];
        
        if (response.data && response.data.ids && response.data.ids[0]) {
            const data = response.data;
            for (let i = 0; i < data.ids[0].length; i++) {
                results.push({
                    id: data.ids[0][i],
                    document: data.documents[0][i],
                    metadata: data.metadatas[0][i],
                    distance: data.distances ? data.distances[0][i] : null
                });
            }
        }
        return results;
    } catch (e) {
        console.error('[⚠️ CHROMA] Failed to query collection:', e.message);
        return [];
    }
};

module.exports = {
    initCollection,
    storeIncident,
    recallSimilar
};
