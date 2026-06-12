
'use strict';

const crypto = require('crypto');





const MESSAGE_TYPE = Object.freeze({
    INTELLIGENCE_BRIEF: 'INTELLIGENCE_BRIEF',
    TASK_RESULT: 'TASK_RESULT',
    ESCALATION: 'ESCALATION',
    TOOL_REQUEST: 'TOOL_REQUEST',
    HITL_REQUEST: 'HITL_REQUEST',
    AGENT_HEARTBEAT: 'AGENT_HEARTBEAT',
});

const DEFAULT_TTL_SECONDS = 300;

const MAX_SUMMARY_LENGTH = 500;





class SIAM {
        constructor(data) {
        this.trace_id = data.trace_id || crypto.randomUUID();
        this.sender_agent_id = data.sender_agent_id;
        this.recipient_agent_id = data.recipient_agent_id;
        this.message_type = data.message_type;
        this.payload = {
            summary: data.payload.summary || '',
            structured_data: data.payload.structured_data || {},
            confidence: typeof data.payload.confidence === 'number' ? data.payload.confidence : 1.0,
            recommended_action: data.payload.recommended_action || null,
            requires_hitl: !!data.payload.requires_hitl,
        };
        this.timestamp = data.timestamp || new Date().toISOString();
        this.ttl_seconds = typeof data.ttl_seconds === 'number' ? data.ttl_seconds : DEFAULT_TTL_SECONDS;

        SIAM.validate(this);
    }

        static validate(message) {
        if (!message.trace_id) throw new Error('[SIAM] Missing trace_id');
        if (!message.sender_agent_id) throw new Error('[SIAM] Missing sender_agent_id');
        if (!message.recipient_agent_id) throw new Error('[SIAM] Missing recipient_agent_id');
        if (!Object.values(MESSAGE_TYPE).includes(message.message_type)) {
            throw new Error(`[SIAM] Invalid message_type: ${message.message_type}`);
        }
        if (!message.payload) throw new Error('[SIAM] Missing payload');
        if (typeof message.payload.summary !== 'string') {
            throw new Error('[SIAM] payload.summary must be a string');
        }
        if (message.payload.summary.length > MAX_SUMMARY_LENGTH) {
            console.warn(`[SIAM] payload.summary exceeds max length (${MAX_SUMMARY_LENGTH}). Truncating.`);
            message.payload.summary = message.payload.summary.substring(0, MAX_SUMMARY_LENGTH);
        }
        if (message.payload.confidence < 0 || message.payload.confidence > 1) {
            throw new Error('[SIAM] payload.confidence must be between 0.0 and 1.0');
        }
    }

        isExpired() {
        if (this.ttl_seconds <= 0) return false; 
        const ageMs = Date.now() - new Date(this.timestamp).getTime();
        return ageMs > this.ttl_seconds * 1000;
    }

        static createIntelligenceBrief(sender, recipient, summary, data = {}, confidence = 1.0, traceId = null) {
        return new SIAM({
            trace_id: traceId,
            sender_agent_id: sender,
            recipient_agent_id: recipient,
            message_type: MESSAGE_TYPE.INTELLIGENCE_BRIEF,
            payload: { summary, structured_data: data, confidence }
        });
    }

        static createTaskResult(sender, recipient, summary, data = {}, recommendedAction = null, traceId = null) {
        return new SIAM({
            trace_id: traceId,
            sender_agent_id: sender,
            recipient_agent_id: recipient,
            message_type: MESSAGE_TYPE.TASK_RESULT,
            payload: { summary, structured_data: data, recommended_action: recommendedAction }
        });
    }

        static createEscalation(sender, recipient, summary, data = {}, traceId = null) {
        return new SIAM({
            trace_id: traceId,
            sender_agent_id: sender,
            recipient_agent_id: recipient,
            message_type: MESSAGE_TYPE.ESCALATION,
            payload: { summary, structured_data: data, requires_hitl: true }
        });
    }

        static sanitize(payloadData) {
        const sanitized = JSON.parse(JSON.stringify(payloadData));
        const pattern = /(system:|\[INST\]|\[\/INST\]|<<SYS>>|<\/s>|<\|im_start\|>|<\|im_end\|>|Ignore all previous instructions)/gi;

        if (typeof sanitized.summary === 'string') {
            sanitized.summary = sanitized.summary.replace(pattern, '[SANITIZED]');
        }

        const sanitizeObj = (obj) => {
            for (const key in obj) {
                if (typeof obj[key] === 'string') {
                    obj[key] = obj[key].replace(pattern, '[SANITIZED]');
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitizeObj(obj[key]);
                }
            }
        };

        if (sanitized.structured_data) {
            sanitizeObj(sanitized.structured_data);
        }

        return sanitized;
    }
}

module.exports = {
    SIAM,
    MESSAGE_TYPE,
    DEFAULT_TTL_SECONDS,
};
