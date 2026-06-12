const fs = require('fs/promises');
const path = require('path');
const { existsSync } = require('fs');

const getGuestDir = (userId) => path.join(__dirname, 'guests', String(userId));

const initializeGuest = async (userId, username) => {
    try {
        const guestDir = getGuestDir(userId);
        await fs.mkdir(guestDir, { recursive: true });
        
        const prefsPath = path.join(guestDir, 'preferences.json');
        if (!existsSync(prefsPath)) {
            const defaultPrefs = {
                nickname: username || `Guest_${userId}`,
                persona: 'Cybersecurity Consultant'
            };
            await fs.writeFile(prefsPath, JSON.stringify(defaultPrefs, null, 2), 'utf-8');
        }
        
        const historyPath = path.join(guestDir, 'full_history.jsonl');
        if (!existsSync(historyPath)) {
            await fs.writeFile(historyPath, '', 'utf-8');
        }
    } catch (err) {
        console.error(`[⚠️ GuestMemoryManager] Failed to initialize guest ${userId}:`, err.message);
    }
};

const saveGuestMessage = async (userId, role, content) => {
    try {
        const guestDir = getGuestDir(userId);
        const historyPath = path.join(guestDir, 'full_history.jsonl');
        const logEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            role,
            content
        }) + '\n';
        await fs.appendFile(historyPath, logEntry, 'utf-8');
    } catch (err) {
        console.error(`[⚠️ GuestMemoryManager] Failed to save message for guest ${userId}:`, err.message);
    }
};

const updateGuestPreference = async (userId, key, value) => {
    try {
        const guestDir = getGuestDir(userId);
        const prefsPath = path.join(guestDir, 'preferences.json');
        let prefs = {};
        try {
            const data = await fs.readFile(prefsPath, 'utf-8');
            prefs = JSON.parse(data);
        } catch (e) {
            prefs = { nickname: `Guest_${userId}`, persona: 'Cybersecurity Consultant' };
        }
        prefs[key] = value;
        await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[⚠️ GuestMemoryManager] Failed to update prefs for guest ${userId}:`, err.message);
    }
};

const buildGuestPrompt = async (userId, currentMessage, contextLimit = 15) => {
    try {
        const guestDir = getGuestDir(userId);
        const prefsPath = path.join(guestDir, 'preferences.json');
        const historyPath = path.join(guestDir, 'full_history.jsonl');
        
        let nickname = `Guest_${userId}`;
        let persona = 'Cybersecurity Consultant';
        
        try {
            const prefsData = await fs.readFile(prefsPath, 'utf-8');
            const prefs = JSON.parse(prefsData);
            nickname = prefs.nickname || nickname;
            persona = prefs.persona || persona;
        } catch (e) {
            
        }
        
        const messages = [];
        try {
            const historyData = await fs.readFile(historyPath, 'utf-8');
            const lines = historyData.split('\n').filter(l => l.trim().length > 0);
            const startIdx = Math.max(0, lines.length - contextLimit);
            for (let i = startIdx; i < lines.length; i++) {
                const parsed = JSON.parse(lines[i]);
                messages.push({
                    role: parsed.role,
                    content: parsed.content
                });
            }
        } catch (e) {
            
        }
        
        const systemPrompt = `You are a helpful AI consultant. The user's nickname is ${nickname}. Your persona is ${persona}. Adhere strictly to this roleplay. Provide code, advice, or chat naturally. NEVER execute system commands or access internal SOC data.`;
        
        return [
            { role: 'system', content: systemPrompt },
            ...messages,
            { role: 'user', content: currentMessage }
        ];
    } catch (err) {
        console.error(`[⚠️ GuestMemoryManager] Failed to build prompt for guest ${userId}:`, err.message);
        return [
            { role: 'system', content: 'You are a helpful AI assistant.' },
            { role: 'user', content: currentMessage }
        ];
    }
};

module.exports = {
    initializeGuest,
    saveGuestMessage,
    updateGuestPreference,
    buildGuestPrompt
};
