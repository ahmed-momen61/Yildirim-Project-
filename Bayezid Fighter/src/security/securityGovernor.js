const axios = require('axios');
const isAllowedTarget = (targetId) => {
    if (!targetId) return false;
    const blockedTargets = ['localhost', '127.0.0.1', '::1'];
    let isBlocked = false;
    let reason = '';
    if (blockedTargets.includes(targetId.toLowerCase())) {
        isBlocked = true;
        reason = 'Target is a loopback/localhost address.';
    } else if (process.env.NODE_ENV === 'DEVELOPMENT') {
        isBlocked = true;
        reason = 'System is running in DEVELOPMENT mode. Live targets are locked.';
    }
    if (isBlocked) {
        console.warn(`\n[🔒] GOVERNOR LOCKOUT: Agent execution aborted on target ${targetId}. Reason: ${reason}`);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            const msg = `🛡️ GOVERNOR ALERT: Agent attempted to target ${targetId}. Execution was blocked.\nReason: ${reason}`;
            axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: chatId,
                text: msg
            }).catch(() => {});
        }
        return false;
    }
    return true;
};
module.exports = { isAllowedTarget };
