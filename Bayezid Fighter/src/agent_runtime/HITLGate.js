
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');





const GATE_TYPE = Object.freeze({
        BLOCKING_APPROVAL: 'BLOCKING_APPROVAL',
        BLOCKING_REVIEW: 'BLOCKING_REVIEW',
        ADVISORY_FLAG: 'ADVISORY_FLAG',
});

const GATE_DECISION = Object.freeze({
    APPROVED: 'APPROVED',
    DENIED: 'DENIED',
    MODIFIED: 'MODIFIED',
    ESCALATED: 'ESCALATED',
    TIMEOUT: 'TIMEOUT',
});

const GATE_TRIGGER = Object.freeze({
        IRREVERSIBLE_ACTION: 'IRREVERSIBLE_ACTION',
        LOW_CONFIDENCE: 'LOW_CONFIDENCE',
        NOVEL_SITUATION: 'NOVEL_SITUATION',
        REGULATORY_EXPOSURE: 'REGULATORY_EXPOSURE',
        AGENT_REQUEST: 'AGENT_REQUEST',
});

const DEFAULT_POLICY = Object.freeze({
    [GATE_TRIGGER.IRREVERSIBLE_ACTION]: GATE_TYPE.BLOCKING_APPROVAL,
    [GATE_TRIGGER.LOW_CONFIDENCE]: GATE_TYPE.BLOCKING_REVIEW,
    [GATE_TRIGGER.NOVEL_SITUATION]: GATE_TYPE.ADVISORY_FLAG,
    [GATE_TRIGGER.REGULATORY_EXPOSURE]: GATE_TYPE.BLOCKING_APPROVAL,
    [GATE_TRIGGER.AGENT_REQUEST]: GATE_TYPE.BLOCKING_REVIEW,
});

const DEFAULT_TIMEOUT_MS = 300_000;

const CONFIDENCE_THRESHOLD = 0.70;

const HITL_REQUEST_CHANNEL = 'bayezid:hitl:requests';

const HITL_RESPONSE_PREFIX = 'bayezid:hitl:response:';

const HITL_PENDING_KEY = 'bayezid:hitl:pending';






class HITLGate extends EventEmitter {
        constructor(redisClient = null, options = {}) {
        super();
        this.redisClient = redisClient;
        this.policy = options.policy || { ...DEFAULT_POLICY };
        this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.confidenceThreshold = options.confidenceThreshold || CONFIDENCE_THRESHOLD;

                this._pendingGates = new Map();

                this._timeoutHandles = new Map();

                this._stats = {
            totalRequests: 0,
            approved: 0,
            denied: 0,
            modified: 0,
            escalated: 0,
            timedOut: 0,
            advisoryBypassed: 0,
        };

        
        this._setupRedisSubscription();
    }

    
    
    

        evaluateGateRequired(actionContext) {
        const { actionType, confidence, isNovel, hasRegulatoryImplication, riskLevel } = actionContext;

        
        if (riskLevel === 'CRITICAL' || ['ZMQ_BLOCK', 'WINGMAN_EXEC', 'ACCOUNT_DISABLE', 'NODE_ISOLATE'].includes(actionType)) {
            return {
                required: true,
                gateType: this.policy[GATE_TRIGGER.IRREVERSIBLE_ACTION],
                trigger: GATE_TRIGGER.IRREVERSIBLE_ACTION,
            };
        }

        
        if (hasRegulatoryImplication) {
            return {
                required: true,
                gateType: this.policy[GATE_TRIGGER.REGULATORY_EXPOSURE],
                trigger: GATE_TRIGGER.REGULATORY_EXPOSURE,
            };
        }

        
        if (typeof confidence === 'number' && confidence < this.confidenceThreshold) {
            return {
                required: true,
                gateType: this.policy[GATE_TRIGGER.LOW_CONFIDENCE],
                trigger: GATE_TRIGGER.LOW_CONFIDENCE,
            };
        }

        
        if (isNovel) {
            return {
                required: true,
                gateType: this.policy[GATE_TRIGGER.NOVEL_SITUATION],
                trigger: GATE_TRIGGER.NOVEL_SITUATION,
            };
        }

        
        return { required: false, gateType: null, trigger: null };
    }

        async requestApproval(request) {
        this._stats.totalRequests++;

        const gateId = crypto.randomUUID();
        const trigger = request.trigger || GATE_TRIGGER.AGENT_REQUEST;
        const gateType = this.policy[trigger] || GATE_TYPE.BLOCKING_APPROVAL;

        const gateRequest = {
            gate_id: gateId,
            gate_type: gateType,
            trigger: trigger,
            requesting_agent: request.agentId,
            action: {
                type: request.action.type,
                target: request.action.target,
                params: request.action.params || {},
            },
            context: {
                reasoning_trace: request.context.trace || 'No reasoning trace provided.',
                confidence: request.context.confidence || 0,
                alternatives_considered: request.context.alternatives || [],
            },
            consequences: {
                if_approved: request.consequences.approve || 'Action will be executed.',
                if_denied: request.consequences.deny || 'Action will be skipped.',
            },
            trace_id: request.traceId || crypto.randomUUID(),
            timeout_behavior: GATE_DECISION.DENIED,
            timeout_ms: this.timeoutMs,
            created_at: new Date().toISOString(),
            status: 'PENDING',
        };

        console.log(`\n[🚦] ════════════════════════════════════════════════════`);
        console.log(`[🚦] HITL GATE OPENED: ${gateId.substring(0, 8)}`);
        console.log(`[🚦] Agent: ${request.agentId}`);
        console.log(`[🚦] Action: ${request.action.type} → ${request.action.target}`);
        console.log(`[🚦] Gate Type: ${gateType}`);
        console.log(`[🚦] Confidence: ${(request.context.confidence * 100).toFixed(1)}%`);
        console.log(`[🚦] Timeout: ${this.timeoutMs / 1000}s → AUTO-DENY`);
        console.log(`[🚦] ════════════════════════════════════════════════════\n`);

        this.emit('gateOpened', gateRequest);

        
        if (gateType === GATE_TYPE.ADVISORY_FLAG) {
            this._stats.advisoryBypassed++;
            this.emit('gateBypassed', gateRequest);
            await this._publishToWarRoom(gateRequest, 'ADVISORY');
            return new HITLGateResult(gateId, GATE_DECISION.APPROVED, {
                auto: true,
                reason: 'Advisory gate — auto-approved with human notification.',
                gate_type: gateType,
                reviewed_by: 'SYSTEM_AUTO',
                timestamp: new Date().toISOString(),
            });
        }

        
        this._pendingGates.set(gateId, gateRequest);
        await this._publishToWarRoom(gateRequest, 'BLOCKING');

        return new Promise((resolve) => {
            
            const timeoutHandle = setTimeout(() => {
                if (this._pendingGates.has(gateId)) {
                    this._pendingGates.delete(gateId);
                    this._timeoutHandles.delete(gateId);
                    this._stats.timedOut++;

                    const result = new HITLGateResult(gateId, GATE_DECISION.TIMEOUT, {
                        auto: true,
                        reason: `Gate timed out after ${this.timeoutMs / 1000}s — auto-DENIED (fail-closed).`,
                        gate_type: gateType,
                        reviewed_by: 'SYSTEM_TIMEOUT',
                        timestamp: new Date().toISOString(),
                    });

                    console.log(`[🚦] GATE ${gateId.substring(0, 8)} TIMED OUT → AUTO-DENIED`);
                    this.emit('gateTimeout', { gateId, request: gateRequest });
                    resolve(result);
                }
            }, this.timeoutMs);

            this._timeoutHandles.set(gateId, timeoutHandle);

            
            gateRequest._resolve = resolve;
        });
    }

        resolveGate(gateId, decision, details = {}) {
        const gateRequest = this._pendingGates.get(gateId);
        if (!gateRequest) {
            console.warn(`[🚦] Gate ${gateId} not found or already resolved.`);
            return false;
        }

        
        const timeoutHandle = this._timeoutHandles.get(gateId);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            this._timeoutHandles.delete(gateId);
        }

        
        switch (decision) {
            case GATE_DECISION.APPROVED: this._stats.approved++; break;
            case GATE_DECISION.DENIED: this._stats.denied++; break;
            case GATE_DECISION.MODIFIED: this._stats.modified++; break;
            case GATE_DECISION.ESCALATED: this._stats.escalated++; break;
        }

        const result = new HITLGateResult(gateId, decision, {
            auto: false,
            reason: details.comment || `Human decision: ${decision}`,
            gate_type: gateRequest.gate_type,
            reviewed_by: details.reviewer || 'WAR_ROOM_OPERATOR',
            modifications: details.modifications || null,
            timestamp: new Date().toISOString(),
        });

        console.log(`[🚦] GATE ${gateId.substring(0, 8)} RESOLVED → ${decision} by ${details.reviewer || 'WAR_ROOM_OPERATOR'}`);
        this.emit('gateResolved', { gateId, decision, result });

        
        this._pendingGates.delete(gateId);
        if (typeof gateRequest._resolve === 'function') {
            gateRequest._resolve(result);
        }

        return true;
    }

        getPendingGates() {
        const pending = [];
        for (const [gateId, request] of this._pendingGates) {
            pending.push({
                gate_id: gateId,
                gate_type: request.gate_type,
                trigger: request.trigger,
                agent: request.requesting_agent,
                action: request.action,
                confidence: request.context.confidence,
                created_at: request.created_at,
                timeout_ms: request.timeout_ms,
                elapsed_ms: Date.now() - new Date(request.created_at).getTime(),
            });
        }
        return pending;
    }

        getStats() {
        return {
            ...this._stats,
            pending: this._pendingGates.size,
            approvalRate: this._stats.totalRequests > 0
                ? ((this._stats.approved + this._stats.advisoryBypassed) / this._stats.totalRequests * 100).toFixed(1) + '%'
                : 'N/A',
        };
    }

        async shutdown() {
        console.log(`[🚦] HITLGate shutting down — auto-denying ${this._pendingGates.size} pending gates...`);
        for (const [gateId] of this._pendingGates) {
            this.resolveGate(gateId, GATE_DECISION.DENIED, {
                reviewer: 'SYSTEM_SHUTDOWN',
                comment: 'System shutdown — gate auto-denied (fail-closed).',
            });
        }
        for (const [, handle] of this._timeoutHandles) {
            clearTimeout(handle);
        }
        this._timeoutHandles.clear();
    }

    
    
    

        async _publishToWarRoom(gateRequest, mode) {
        if (!this.redisClient || !this.redisClient.isOpen) {
            console.warn('[🚦] Redis unavailable — HITL gate published to console only.');
            return;
        }

        try {
            const message = JSON.stringify({
                type: 'HITL_GATE_REQUEST',
                mode: mode,
                gate: {
                    gate_id: gateRequest.gate_id,
                    gate_type: gateRequest.gate_type,
                    trigger: gateRequest.trigger,
                    agent: gateRequest.requesting_agent,
                    action: gateRequest.action,
                    reasoning: gateRequest.context.reasoning_trace,
                    confidence: gateRequest.context.confidence,
                    alternatives: gateRequest.context.alternatives_considered,
                    consequences: gateRequest.consequences,
                    timeout_ms: gateRequest.timeout_ms,
                    created_at: gateRequest.created_at,
                },
            });

            await this.redisClient.publish(HITL_REQUEST_CHANNEL, message);

            
            await this.redisClient.hSet(
                HITL_PENDING_KEY,
                gateRequest.gate_id,
                message
            );

            console.log(`[🚦] Gate ${gateRequest.gate_id.substring(0, 8)} published to War Room (${mode}).`);
        } catch (err) {
            console.error(`[🚦] Failed to publish HITL gate to Redis: ${err.message}`);
        }
    }

        async _setupRedisSubscription() {
        if (!this.redisClient || !this.redisClient.isOpen) {
            console.warn('[🚦] Redis not available — HITL responses must be resolved via direct API call.');
            return;
        }

        try {
            
            const subscriber = this.redisClient.duplicate();
            await subscriber.connect();

            await subscriber.subscribe('bayezid:hitl:responses', (message) => {
                try {
                    const response = JSON.parse(message);
                    if (response.gate_id && response.decision) {
                        this.resolveGate(response.gate_id, response.decision, {
                            reviewer: response.reviewer || 'WAR_ROOM',
                            comment: response.comment || '',
                            modifications: response.modifications || null,
                        });

                        // Clean up the pending hash
                        this.redisClient.hDel(HITL_PENDING_KEY, response.gate_id).catch(() => {});
                    }
                } catch (err) {
                    console.error(`[🚦] Failed to parse HITL response: ${err.message}`);
                }
            });

            console.log('[🚦] HITLGate subscribed to War Room response channel.');
        } catch (err) {
            console.warn(`[🚦] Could not subscribe to HITL responses: ${err.message}`);
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// HITLGateResult — Immutable result object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Immutable result of a HITL gate decision.
 */
class HITLGateResult {
    /**
     * @param {string} gateId
     * @param {string} decision - One of GATE_DECISION values
     * @param {Object} details
     * @param {boolean} details.auto - Whether this was an automatic decision
     * @param {string} details.reason - Human-readable reason
     * @param {string} details.gate_type - Original gate type
     * @param {string} details.reviewed_by - Who/what made the decision
     * @param {Object|null} [details.modifications] - Modified parameters
     * @param {string} details.timestamp - ISO8601 timestamp
     */
    constructor(gateId, decision, details) {
        /** @readonly */
        this.gateId = gateId;
        /** @readonly */
        this.decision = decision;
        /** @readonly */
        this.approved = decision === GATE_DECISION.APPROVED;
        /** @readonly */
        this.denied = decision === GATE_DECISION.DENIED || decision === GATE_DECISION.TIMEOUT;
        /** @readonly */
        this.auto = details.auto;
        /** @readonly */
        this.reason = details.reason;
        /** @readonly */
        this.gateType = details.gate_type;
        /** @readonly */
        this.reviewedBy = details.reviewed_by;
        /** @readonly */
        this.modifications = details.modifications || null;
        /** @readonly */
        this.timestamp = details.timestamp;

        Object.freeze(this);
    }

    /**
     * Returns a concise summary for logging.
     * @returns {string}
     */
    toString() {
        return `[HITL ${this.gateId.substring(0, 8)}] ${this.decision} by ${this.reviewedBy} (${this.auto ? 'auto' : 'human'})`;
    }
}






module.exports = {
    HITLGate,
    HITLGateResult,
    GATE_TYPE,
    GATE_DECISION,
    GATE_TRIGGER,
    DEFAULT_POLICY,
    CONFIDENCE_THRESHOLD,
};
