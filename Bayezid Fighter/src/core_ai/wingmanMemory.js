const acorn = require('acorn');
const walk = require('acorn-walk');
const prisma = require('../api/prismaClient');
const DEFAULT_PROFILE = {
    code_style: {
        js_declarations: 'const',           
        function_style: 'arrow',            
        async_pattern: 'async_await',       
        error_handling: 'try_catch',        
        comment_style: 'inline',            
        indent: 4,
        quotes: 'single',
        semicolons: true,
        observed_count: 0
    },
    operational_preferences: {
        confirmation_threshold: 'HIGH_RISK_ONLY',  
        language_preference: 'auto',                
        response_verbosity: 'detailed',             
        notification_hours: 'always',               
        preferred_engine: 'LOCAL'
    },
    strategic_goals: [],
    observed_patterns: [],
    last_updated: null
};
const detectLanguage = (text) => {
    if (!text || text.length < 3) return 'en';
    const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    const totalChars = arabicChars + latinChars;
    if (totalChars === 0) return 'en';
    const arabicRatio = arabicChars / totalChars;
    if (arabicRatio > 0.6) return 'ar';                    
    if (arabicRatio > 0.15 && latinChars > 0) return 'fr_ar';  
    return 'en';
};
const extractCodeStyle = (sourceCode) => {
    try {
        const ast = acorn.parse(sourceCode, {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            allowHashBang: true
        });
        const metrics = {
            const_count: 0, let_count: 0, var_count: 0,
            arrow_count: 0, function_count: 0,
            async_count: 0, await_count: 0,
            try_catch_count: 0,
            single_quote: 0, double_quote: 0,
            semicolons: 0, no_semicolons: 0
        };
        walk.simple(ast, {
            VariableDeclaration(node) {
                if (node.kind === 'const') metrics.const_count++;
                if (node.kind === 'let') metrics.let_count++;
                if (node.kind === 'var') metrics.var_count++;
            },
            ArrowFunctionExpression() { metrics.arrow_count++; },
            FunctionExpression() { metrics.function_count++; },
            FunctionDeclaration() { metrics.function_count++; },
            AwaitExpression() { metrics.await_count++; },
            TryStatement() { metrics.try_catch_count++; },
            Literal(node) {
                if (typeof node.value === 'string' && node.raw) {
                    if (node.raw.startsWith("'")) metrics.single_quote++;
                    if (node.raw.startsWith('"')) metrics.double_quote++;
                }
            }
        });
        return metrics;
    } catch (e) {
        return null; 
    }
};
const applyMetricsToProfile = (profile, metrics) => {
    if (!metrics) return profile;
    const decay = 0.95;
    const updated = JSON.parse(JSON.stringify(profile));
    const totalDecls = metrics.const_count + metrics.let_count + metrics.var_count;
    if (totalDecls > 0) {
        if (metrics.const_count > metrics.let_count && metrics.const_count > metrics.var_count) {
            updated.code_style.js_declarations = 'const';
        } else if (metrics.let_count > metrics.var_count) {
            updated.code_style.js_declarations = 'let';
        } else if (metrics.var_count > 0) {
            updated.code_style.js_declarations = 'var';
        }
    }
    const totalFns = metrics.arrow_count + metrics.function_count;
    if (totalFns > 0) {
        updated.code_style.function_style = metrics.arrow_count >= metrics.function_count ? 'arrow' : 'traditional';
    }
    if (metrics.await_count > 0) {
        updated.code_style.async_pattern = 'async_await';
    }
    if (metrics.try_catch_count > 0) {
        updated.code_style.error_handling = 'try_catch';
    }
    const totalQuotes = metrics.single_quote + metrics.double_quote;
    if (totalQuotes > 0) {
        updated.code_style.quotes = metrics.single_quote >= metrics.double_quote ? 'single' : 'double';
    }
    updated.code_style.observed_count++;
    updated.last_updated = new Date().toISOString();
    return updated;
};
const extractCodeBlocksFromMessage = (text) => {
    const codeBlocks = [];
    const regex = /```[\w]*\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        codeBlocks.push(match[1]);
    }
    return codeBlocks;
};
const updateStyleFromMessage = async (sessionId, userMessage) => {
    const codeBlocks = extractCodeBlocksFromMessage(userMessage);
    if (codeBlocks.length === 0) return null;
    let session;
    try {
        session = await prisma.wingmanSession.findUnique({ where: { id: sessionId } });
    } catch (e) { return null; }
    let profile = session?.styleProfile || JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    if (typeof profile === 'string') profile = JSON.parse(profile);
    for (const code of codeBlocks) {
        const metrics = extractCodeStyle(code);
        if (metrics) {
            profile = applyMetricsToProfile(profile, metrics);
        }
    }
    const lang = detectLanguage(userMessage);
    if (lang !== 'en') {
        profile.operational_preferences.language_preference = lang;
    }
    try {
        await prisma.wingmanSession.update({
            where: { id: sessionId },
            data: { styleProfile: profile }
        });
    } catch (e) {  }
    return profile;
};
const extractGoalsFromMessages = (messages) => {
    const goalKeywords = [
        'priority', 'focus on', 'want to', 'need to', 'my goal',
        'this week', 'important', 'target', 'objective', 'plan',
        'هدف', 'أولوية', 'عايز', 'محتاج', 'ركز على'
    ];
    const goals = [];
    for (const msg of messages) {
        if (msg.role !== 'user') continue;
        const lower = (msg.content || '').toLowerCase();
        if (goalKeywords.some(k => lower.includes(k))) {
            const sentences = msg.content.split(/[.!?\n]/);
            for (const sentence of sentences) {
                if (goalKeywords.some(k => sentence.toLowerCase().includes(k)) && sentence.trim().length > 10) {
                    goals.push(sentence.trim());
                }
            }
        }
    }
    return [...new Set(goals)].slice(-10);
};
const buildProfileAddendum = (profile) => {
    if (!profile || !profile.code_style) return '';
    const cs = profile.code_style;
    const op = profile.operational_preferences;
    let addendum = `\nOPERATOR PROFILE (learned from ${cs.observed_count} code observations):\n`;
    addendum += `- Coding style: prefers ${cs.js_declarations} declarations, ${cs.function_style} functions, ${cs.async_pattern}, ${cs.quotes} quotes\n`;
    if (op.language_preference === 'ar') {
        addendum += `- Language: Operator prefers Arabic responses (رد بالعربي)\n`;
    } else if (op.language_preference === 'fr_ar') {
        addendum += `- Language: Operator uses Franco-Arabic (el 3araby kda)\n`;
    } else {
        addendum += `- Language: Respond in English (JARVIS mode)\n`;
    }
    addendum += `- Verbosity: ${op.response_verbosity}\n`;
    addendum += `- Confirmation preference: ${op.confirmation_threshold}\n`;
    if (profile.strategic_goals && profile.strategic_goals.length > 0) {
        addendum += `- Current strategic focus: ${profile.strategic_goals.slice(-3).join(' | ')}\n`;
    }
    return addendum;
};
module.exports = {
    detectLanguage,
    extractCodeStyle,
    updateStyleFromMessage,
    extractGoalsFromMessages,
    buildProfileAddendum,
    DEFAULT_PROFILE,
    extractCodeBlocksFromMessage,
    applyMetricsToProfile
};
