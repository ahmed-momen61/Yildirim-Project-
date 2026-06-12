const axios = require('axios');
const sendTelegramAlert = async (alertData, osintData) => {
    try {
        const { sendEnhancedAlert } = require('../core_ai/wingmanTelegram');
        await sendEnhancedAlert(alertData, osintData);
        return;
    } catch (e) {
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.log('[!] Telegram credentials missing. Skipping Mobile SOC alert.');
        return;
    }
    const message = `
🚨 <b>BAYEZID SOC ALERT</b> 🚨
━━━━━━━━━━━━━━━━━━━━
🔴 <b>Severity:</b> ${alertData.severity}
🎯 <b>Threat:</b> ${alertData.threat_type}
🌐 <b>Source IP:</b> <code>${alertData.extracted_ip || 'Unknown'}</code>
🌍 <b>Origin:</b> ${osintData ? osintData.country : 'Unknown'}
📊 <b>CVSS Score:</b> ${alertData.cvss_score}
🤖 <b>AI Confidence:</b> ${alertData.confidence_score}
📝 <b>AI Forensic Report:</b>
<i>${alertData.detailed_report}</i>
🛡️ <b>Recommended Action:</b>
${alertData.recommended_action}
━━━━━━━━━━━━━━━━━━━━
⚙️ <i>Engine: ${alertData.engine_used}</i>
    `;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⛔ Block IP on Firewall', callback_data: `block_${alertData.extracted_ip}` },
                        { text: '✅ Mark as False Positive', callback_data: `ignore` }
                    ]
                ]
            }
        });
        console.log('[📱] Mobile SOC Alert delivered to Telegram!');
    } catch (error) {
        console.error('[-] Failed to send Telegram alert:', error.message);
    }
};
const wsBuffer = [];
let io = null;

const broadcastAlert = (alertData) => {
    wsBuffer.push(alertData);
};

let batchIntervalId = null;

const initWsBatching = (ioInstance) => {
    io = ioInstance;
    batchIntervalId = setInterval(() => {
        if (wsBuffer.length > 0) {
            const batch = wsBuffer.splice(0, wsBuffer.length);
            io.emit('batch_update', batch);
            console.log(`[🔌] Broadcasted batch of ${batch.length} alerts to WebSocket clients.`);
        }
    }, 1000);
};

const stopWsBatching = () => {
    if (batchIntervalId) {
        clearInterval(batchIntervalId);
        batchIntervalId = null;
    }
};

module.exports = {
    sendTelegramAlert,
    broadcastAlert,
    initWsBatching,
    stopWsBatching
};