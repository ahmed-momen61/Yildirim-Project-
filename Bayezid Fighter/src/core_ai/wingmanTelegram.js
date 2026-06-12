const { Telegraf } = require('telegraf');
const { processMessage, callLLM } = require('./wingmanService');
const axios = require('axios');
const { initializeGuest, saveGuestMessage, updateGuestPreference, buildGuestPrompt } = require('../memory_systems/guestMemoryManager');

const TELEGRAM_BOT_TOKEN = process.env.WINGMAN_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.WINGMAN_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
let bot = null;
let botActive = false;
const MAX_TELEGRAM_MSG = 4000;
const authenticatedAdmins = new Set();
const splitMessage = (text) => {
    if (text.length <= MAX_TELEGRAM_MSG) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        let chunk = remaining.substring(0, MAX_TELEGRAM_MSG);
        const lastNewline = chunk.lastIndexOf('\n');
        if (lastNewline > MAX_TELEGRAM_MSG * 0.5) {
            chunk = remaining.substring(0, lastNewline);
        }
        chunks.push(chunk);
        remaining = remaining.substring(chunk.length);
    }
    return chunks;
};
const escapeHTML = (text) => {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
const setupCommands = (bot) => {
    const sessionStates = new Map();

    const isAuthorized = (ctx) => {
        const chatId = ctx.chat ? ctx.chat.id.toString() : '';
        const userId = ctx.from ? ctx.from.id.toString() : '';
        const authorized = (process.env.WINGMAN_AUTHORIZED_OPERATORS || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);
        return authorized.includes(chatId) || authorized.includes(userId);
    };

    const requireTacticalAuth = async (ctx, next) => {
        if (!isAuthorized(ctx)) {
            await ctx.reply('⛔ Access Denied: Unauthorized Operator.');
            return;
        }
        const state = sessionStates.get(ctx.chat.id.toString());
        if (!state || state.mode !== 'SOC_TACTICAL' || state.authState !== 'AUTHENTICATED') {
            await ctx.reply('⛔ SECURITY_VETO: This command requires an authenticated SOC_TACTICAL session. Type /start to initialize.');
            return;
        }
        return next();
    };

    bot.command('start', async (ctx) => {
        const chatId = ctx.chat.id.toString();
        sessionStates.set(chatId, { mode: null, authState: null });
        await ctx.replyWithHTML(
            `🦾 <b>THE WINGMAN — Dual-Gateway Uplink</b>\n\n` +
            `Identify operational context:\n\n`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🟢 Chit-Chat (Sandbox)', callback_data: 'mode_sandbox' }],
                        [{ text: '🔴 SOC Tactical Command Center', callback_data: 'mode_tactical' }]
                    ]
                }
            }
        );
    });

    const dispatchAsync = async (ctx, prompt, sessionId, executionMode) => {
        let thinkingMsg;
        try {
            thinkingMsg = await ctx.reply("🤔 Processing...");
        } catch(e) { return; }
        Promise.resolve().then(async () => {
            let response = '';
            try {
                const userId = ctx.from ? ctx.from.id.toString() : 'telegram_operator';
                const result = await processMessage(prompt, sessionId, null, userId, executionMode);
                response = result.finalResponse || response;
            } catch (e) {
                response = `⚠️ Error processing request: ${e.message}`;
            }
            if (!response || response.trim() === '') response = 'Processed request successfully, but no output generated.';
            const chunks = splitMessage(response);
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, thinkingMsg.message_id, undefined, chunks[0], { parse_mode: 'HTML' });
            } catch(e) {
                try {
                    await ctx.telegram.sendMessage(ctx.chat.id, chunks[0], { parse_mode: 'HTML' });
                } catch (e2) {
                    await ctx.telegram.sendMessage(ctx.chat.id, chunks[0]);
                }
            }
            for (let i = 1; i < chunks.length; i++) {
                try {
                    await ctx.telegram.sendMessage(ctx.chat.id, chunks[i], { parse_mode: 'HTML' });
                } catch (e3) {
                    await ctx.telegram.sendMessage(ctx.chat.id, chunks[i]);
                }
            }
        }).catch(e => console.error("[WINGMAN] Async dispatch error:", e.message));
    };

    bot.command('status', requireTacticalAuth, async (ctx) => {
        const sessionId = `telegram_${ctx.chat.id}_status`;
        await dispatchAsync(ctx, 'Give me a quick system status summary', sessionId, 'SOC_TACTICAL');
    });
    bot.command('alerts', requireTacticalAuth, async (ctx) => {
        const args = ctx.message.text.split(' ');
        const n = parseInt(args[1]) || 5;
        const sessionId = `telegram_${ctx.chat.id}_alerts`;
        await dispatchAsync(ctx, `Show me the last ${n} alerts with their severity and status`, sessionId, 'SOC_TACTICAL');
    });
    bot.command('supervise', requireTacticalAuth, async (ctx) => {
        const agent = ctx.message.text.split(' ').slice(1).join(' ');
        if (!agent) return ctx.reply('Usage: /supervise <agent_name_or_target_ip>');
        const sessionId = `telegram_${ctx.chat.id}_supervise`;
        await dispatchAsync(ctx, `Supervise agent/target ${agent} and show me its recent events`, sessionId, 'SOC_TACTICAL');
    });
    bot.command('block', requireTacticalAuth, async (ctx) => {
        const ip = ctx.message.text.split(' ')[1];
        if (!ip) return ctx.reply('Usage: /block <ip_address>');
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) return ctx.reply('❌ Invalid IP format.');
        await ctx.replyWithHTML(
            `⚠️ About to block <code>${escapeHTML(ip)}</code> at the OS level via KernelStriker.\n\n<b>Confirm?</b>`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔴 EXECUTE BLOCK', callback_data: `confirm_block_${ip}` },
                        { text: '❌ Cancel', callback_data: 'cancel_action' }
                    ]]
                }
            }
        );
    });
    bot.command('approve', requireTacticalAuth, async (ctx) => {
        const operationId = ctx.message.text.split(' ')[1];
        if (!operationId) return ctx.reply('Usage: /approve <operationId>');
        if (global.io) {
            global.io.of('/wingman').emit('operation_approved_telegram', {
                operationId,
                approvedBy: 'TELEGRAM_OPERATOR',
                timestamp: new Date().toISOString()
            });
        }
        await ctx.replyWithHTML(`✅ Operation <code>${escapeHTML(operationId)}</code> approved via Telegram.`);
    });
    bot.command('deny', requireTacticalAuth, async (ctx) => {
        const operationId = ctx.message.text.split(' ')[1];
        if (!operationId) return ctx.reply('Usage: /deny <operationId>');
        if (global.io) {
            global.io.of('/wingman').emit('operation_denied_telegram', {
                operationId,
                deniedBy: 'TELEGRAM_OPERATOR',
                timestamp: new Date().toISOString()
            });
        }
        await ctx.replyWithHTML(`❌ Operation <code>${escapeHTML(operationId)}</code> denied via Telegram.`);
    });
    bot.command('train', requireTacticalAuth, async (ctx) => {
        const sessionId = `telegram_${ctx.chat.id}_train`;
        await dispatchAsync(ctx, 'Force a LoRA training cycle now', sessionId, 'SOC_TACTICAL');
    });
    bot.command('lora_status', requireTacticalAuth, async (ctx) => {
        const sessionId = `telegram_${ctx.chat.id}_lora`;
        await dispatchAsync(ctx, 'What is the current LoRA training status and metrics?', sessionId, 'SOC_TACTICAL');
    });
    bot.command('brief', requireTacticalAuth, async (ctx) => {
        const sessionId = `telegram_${ctx.chat.id}_brief`;
        await dispatchAsync(ctx, 'Give me a comprehensive system briefing covering health, alerts, active operations, LoRA status, and any recent notable events', sessionId, 'SOC_TACTICAL');
    });

    bot.command('nickname', async (ctx) => {
        const chatId = ctx.chat.id.toString();
        const state = sessionStates.get(chatId) || { mode: null, authState: null };
        if (state.mode !== 'SANDBOX') {
            return ctx.reply('⛔ This command is only available in Sandbox mode. Type /start to initialize.');
        }
        const message = ctx.message.text;
        const args = message.split(' ').slice(1).join(' ').trim();
        if (!args) {
            return ctx.reply('Usage: /nickname <your_preferred_name>');
        }

        const userId = ctx.from ? ctx.from.id.toString() : chatId;
        try {
            await updateGuestPreference(userId, 'nickname', args);
            await ctx.reply(`✅ Nickname updated to: ${args}. I will address you as such.`);
        } catch (err) {
            await ctx.reply(`❌ Failed to update nickname: ${err.message}`);
        }
    });

    bot.command('persona', async (ctx) => {
        const chatId = ctx.chat.id.toString();
        const state = sessionStates.get(chatId) || { mode: null, authState: null };
        if (state.mode !== 'SANDBOX') {
            return ctx.reply('⛔ This command is only available in Sandbox mode. Type /start to initialize.');
        }
        const message = ctx.message.text;
        const args = message.split(' ').slice(1).join(' ').trim();
        if (!args) {
            return ctx.reply('Usage: /persona <custom_role>');
        }

        const userId = ctx.from ? ctx.from.id.toString() : chatId;
        try {
            await updateGuestPreference(userId, 'persona', args);
            await ctx.reply(`✅ Persona updated to: ${args}. I will adopt this roleplay context.`);
        } catch (err) {
            await ctx.reply(`❌ Failed to update persona: ${err.message}`);
        }
    });

    bot.on('text', async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const message = ctx.message.text;
        const chatId = ctx.chat.id.toString();

        let state = sessionStates.get(chatId) || { mode: null, authState: null };

        
        if (state.authState === 'PENDING_PIN') {
            if (!isAuthorized(ctx)) {
                state.mode = null;
                state.authState = null;
                sessionStates.set(chatId, state);
                await ctx.reply("⛔ Access Denied: Unauthorized Operator.");
                return;
            }
            const expectedPin = process.env.WINGMAN_TELEGRAM_PIN;
            if (message.trim() === expectedPin) {
                state.mode = 'SOC_TACTICAL';
                state.authState = 'AUTHENTICATED';
                sessionStates.set(chatId, state);
                await ctx.replyWithHTML(`✅ <b>AUTHORIZATION ACCEPTED</b>\n\nFull kinetic SOC privileges unlocked. What are your orders?`);
            } else {
                state.mode = null;
                state.authState = null;
                sessionStates.set(chatId, state);
                await ctx.reply(`❌ AUTHORIZATION FAILED. Session aborted.`);
            }
            return;
        }

        if (!state.mode) {
            return ctx.reply('Type /start to select an operational mode.');
        }

        if (state.mode === 'SOC_TACTICAL') {
            if (!isAuthorized(ctx) || state.authState !== 'AUTHENTICATED') {
                return ctx.reply('⛔ SECURITY_VETO: SOC_TACTICAL session is not authorized. Type /start to initialize.');
            }
        }

        const executionMode = state.mode;
        const sessionId = `telegram_${chatId}_chat_${executionMode}`;
        await dispatchAsync(ctx, message, sessionId, executionMode);
    });

    bot.on('callback_query', async (ctx) => {
        if (!ctx.callbackQuery || !ctx.callbackQuery.data) return;

        const data = ctx.callbackQuery.data;
        const chatId = ctx.chat.id.toString();
        const state = sessionStates.get(chatId) || { mode: null, authState: null };

        if (data === 'mode_sandbox') {
            const userId = ctx.from ? ctx.from.id.toString() : chatId;
            try {
                const { initializeGuest } = require('../memory_systems/guestMemoryManager');
                await initializeGuest(userId, ctx.from ? ctx.from.username : 'unknown');
            } catch (err) {
                console.error('[-] Guest memory init error:', err.message);
            }
            sessionStates.set(chatId, { mode: 'SANDBOX', authState: null });
            await ctx.editMessageText(
                `🟢 <b>Welcome to the Wingman Sandbox.</b>\n\n` +
                `Here you can consult with me about cybersecurity, code, or anything else under a strict air-gap boundary.\n\n` +
                `<b>Commands:</b>\n` +
                `/nickname &lt;name&gt; - Change how I call you\n` +
                `/persona &lt;role&gt; - Customize my roleplay persona\n` +
                `/start - Show this help message`,
                { parse_mode: 'HTML' }
            );
            try { await ctx.answerCbQuery(); } catch (e) {}
            return;
        }

        if (data === 'mode_tactical') {
            if (!isAuthorized(ctx)) {
                try { await ctx.answerCbQuery("⛔ Access Denied: SOC Tactical Center requires operator authorization.", { show_alert: true }); } catch (e) {}
                await ctx.reply("⛔ Access Denied: SOC Tactical Center requires operator authorization.");
                return;
            }
            sessionStates.set(chatId, { mode: null, authState: 'PENDING_PIN' });
            await ctx.editMessageText(`🔴 <b>SOC TACTICAL SELECTED</b>\n\nProvide Secondary Authorization PIN:`, { parse_mode: 'HTML' });
            try { await ctx.answerCbQuery(); } catch (e) {}
            return;
        }

        
        const kineticActions = [
            'confirm_block_',
            'wingman_analyze_',
            'wingman_playbook_',
            'wingman_block_',
            'approve_evolution_',
            'evolution_defer',
            'approve_'
        ];

        const isKinetic = kineticActions.some(action => data.startsWith(action) || data === action);
        if (isKinetic) {
            if (!isAuthorized(ctx)) {
                try { await ctx.answerCbQuery("⛔ Access Denied: Unauthorized Operator.", { show_alert: true }); } catch (e) {}
                return;
            }
            if (!state || state.mode !== 'SOC_TACTICAL' || state.authState !== 'AUTHENTICATED') {
                try {
                    await ctx.answerCbQuery("⛔ Access Denied: Authenticated SOC_TACTICAL session required.", { show_alert: true });
                } catch (e) {}
                await ctx.reply('⛔ SECURITY_VETO: This action requires an authenticated SOC_TACTICAL session. Type /start to initialize.');
                return;
            }
        }

        if (data.startsWith('confirm_block_')) {
            const ip = data.replace('confirm_block_', '');
            try {
                const { KernelStriker } = require('../blue_swarm/kernelStriker');
                const striker = new KernelStriker();
                await striker.blockIp(ip);
                await ctx.editMessageText(`✅ IP <code>${escapeHTML(ip)}</code> blocked at OS level via KernelStriker.`, { parse_mode: 'HTML' });
            } catch (e) {
                await ctx.editMessageText(`❌ Block failed: ${e.message}`);
            }
        } else if (data.startsWith('wingman_analyze_')) {
            const alertId = data.replace('wingman_analyze_', '');
            const sessionId = `telegram_callback_${ctx.chat.id}`;
            let response = '';
            try {
                const result = await processMessage(`Analyze alert ${alertId} in full detail`, sessionId, (t) => response += t, 'telegram_operator');
                response = result.finalResponse || response;
            } catch (e) {
                response = `Error: ${e.message}`;
            }
            for (const chunk of splitMessage(response).slice(0, 3)) {
                await ctx.reply(chunk);
            }
        } else if (data.startsWith('wingman_playbook_')) {
            const alertId = data.replace('wingman_playbook_', '');
            const sessionId = `telegram_callback_${ctx.chat.id}`;
            let response = '';
            try {
                const result = await processMessage(`Execute the remediation playbook for alert ${alertId}`, sessionId, (t) => response += t, 'telegram_operator');
                response = result.finalResponse || response;
            } catch (e) {
                response = `Error: ${e.message}`;
            }
            await ctx.reply(response.substring(0, MAX_TELEGRAM_MSG));
        } else if (data.startsWith('wingman_block_')) {
            const ip = data.replace('wingman_block_', '');
            try {
                const { KernelStriker } = require('../blue_swarm/kernelStriker');
                const striker = new KernelStriker();
                await striker.blockIp(ip);
                await ctx.reply(`✅ IP ${ip} blocked.`);
            } catch (e) {
                await ctx.reply(`❌ Block failed: ${e.message}`);
            }
        } else if (data === 'cancel_action') {
            await ctx.editMessageText('❌ Operation cancelled.');
        } else if (data.startsWith('approve_evolution_')) {
            const targetPhase = data.replace('approve_evolution_', '');
            try {
                const { executePhaseTransition, checkEvolutionReadiness } = require('./wingmanEvolution');
                const readiness = await checkEvolutionReadiness();
                if (!readiness.ready) {
                    await ctx.editMessageText('❌ Evolution conditions no longer met. State may have changed.');
                } else {
                    await ctx.editMessageText(`🚀 <b>EVOLUTION APPROVED</b>\n\nTransition to <b>${targetPhase}</b> executing...`, { parse_mode: 'HTML' });
                    await executePhaseTransition(targetPhase, 'telegram_approve', null);
                    await ctx.reply(`✅ Evolution to <b>${targetPhase}</b> complete. I am growing.`, { parse_mode: 'HTML' });
                }
            } catch (e) {
                await ctx.reply(`❌ Evolution failed: ${e.message}`);
            }
        } else if (data === 'evolution_defer') {
            await ctx.editMessageText('⏳ Evolution deferred. I will ask again when conditions are still met.');
        } else if (data.endsWith('_dynamic') && data.startsWith('approve_')) {
            const alertId = data.replace('approve_', '').replace('_dynamic', '');
            await ctx.editMessageText(`⚡ <b>DYNAMIC PLAYBOOK EXECUTING</b>\n\nAlert <code>${escapeHTML(alertId)}</code> mitigation in progress. Monitor logs for completion status.`, { parse_mode: 'HTML' });
            try {
                const { Connection, Client } = require('@temporalio/client');
                const connection = await Connection.connect();
                const client = new Client({ connection });
                await client.workflow.start('pentestPipeline', {
                    taskQueue: 'bayezid-ir',
                    workflowId: `dynamic-playbook-${alertId}-${Date.now()}`,
                    args: [{
                        alertId: alertId,
                        initialPayload: { trigger: 'telegram_dynamic_playbook' },
                        sourceIp: '127.0.0.1',
                        targetAsset: 'telegram_operator'
                    }]
                });
            } catch (err) {
                await ctx.reply(`❌ Failed to trigger dynamic playbook workflow: ${err.message}`);
            }
        }
        try { await ctx.answerCbQuery(); } catch (e) {}
    });
};
const sendProactiveAlert = async (message, keyboard = null) => {
    const chatId = TELEGRAM_CHAT_ID;
    if (!chatId) return;
    const token = TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const opts = { chat_id: chatId, text: message, parse_mode: 'HTML' };
    if (keyboard) opts.reply_markup = { inline_keyboard: keyboard };
    try {
        if (bot && botActive) {
            await bot.telegram.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {})
            });
        } else {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, opts);
        }
    } catch (e) {
        console.error('[-] Telegram proactive alert failed:', e.message);
    }
};
const sendEnhancedAlert = async (alertData, osintData) => {
    const ip = alertData.extracted_ip || alertData.sourceIp || 'Unknown';
    const alertId = alertData.id || alertData.alertId || 'N/A';
    const message = `🚨 <b>BAYEZID SOC ALERT</b> 🚨\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔴 <b>Severity:</b> ${alertData.severity || 'UNKNOWN'}\n` +
        `🎯 <b>Threat:</b> ${alertData.threat_type || alertData.eventType || 'Unknown'}\n` +
        `🌐 <b>Source IP:</b> <code>${ip}</code>\n` +
        `🌍 <b>Origin:</b> ${osintData?.country || 'Unknown'}\n` +
        `📊 <b>CVSS:</b> ${alertData.cvss_score || 'N/A'}\n` +
        `🤖 <b>Confidence:</b> ${alertData.confidence_score || 'N/A'}\n\n` +
        `📝 <b>Report:</b>\n<i>${(alertData.detailed_report || alertData.report || 'No details').substring(0, 500)}</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⚙️ <i>Engine: ${alertData.engine_used || 'Bayezid AI'}</i>`;
    const keyboard = [
        [
            { text: '🔍 Full Analysis', callback_data: `wingman_analyze_${alertId}` },
            { text: '⚡ Run Playbook', callback_data: `wingman_playbook_${alertId}` }
        ],
        [
            { text: '⛔ Block IP', callback_data: `wingman_block_${ip}` },
            { text: '✅ False Positive', callback_data: 'cancel_action' }
        ]
    ];
    await sendProactiveAlert(message, keyboard);
};
const startTelegramBot = () => {
    if (!TELEGRAM_BOT_TOKEN) {
        console.log('[📱] Telegram Bot Token not set. Wingman Telegram disabled.');
        return;
    }
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    setupCommands(bot);
    bot.launch().then(() => {
        botActive = true;
        console.log('[📱] Wingman Telegram Bot launched and listening.');
    }).catch(e => {
        if (e.message.includes('getaddrinfo') || e.message.includes('ENOTFOUND') || e.message.includes('ETIMEDOUT')) {
            console.warn('[📱] Telegram Bot: Network/DNS resolution failed (Offline). Running in degraded mode without Telegram uplink.');
        } else {
            console.error('[📱] Telegram Bot launch failed:', e.message);
        }
    });
    process.once('SIGINT', () => { if (bot) bot.stop('SIGINT'); });
    process.once('SIGTERM', () => { if (bot) bot.stop('SIGTERM'); });
};
const stopTelegramBot = () => {
    if (bot) {
        bot.stop();
        botActive = false;
    }
};
module.exports = {
    startTelegramBot,
    stopTelegramBot,
    sendProactiveAlert,
    sendEnhancedAlert,
    bot: () => bot
};
