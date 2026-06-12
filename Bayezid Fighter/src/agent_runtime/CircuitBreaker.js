
'use strict';

const { EventEmitter } = require('events');

const CB_STATE = Object.freeze({
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
});

class CircuitOpenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CircuitOpenError';
    }
}

class CircuitBreaker extends EventEmitter {
        constructor(options = {}) {
        super();
        this.name = options.name || 'UnnamedCircuit';
        this.failureThreshold = options.failureThreshold || 3;
        this.resetTimeoutMs = options.resetTimeoutMs || 60000;
        this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 1;

        this.state = CB_STATE.CLOSED;
        this.consecutiveFailures = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;

        
        this.totalSuccesses = 0;
        this.totalFailures = 0;
        this.totalRejections = 0;
    }

        async execute(asyncFn) {
        if (this.state === CB_STATE.OPEN) {
            const timeSinceTrip = Date.now() - this.lastFailureTime;
            if (timeSinceTrip > this.resetTimeoutMs) {
                
                this._transitionTo(CB_STATE.HALF_OPEN);
            } else {
                
                this.totalRejections++;
                this.emit('rejected', { name: this.name, state: this.state });
                throw new CircuitOpenError(`Circuit [${this.name}] is OPEN. Fast-failing request.`);
            }
        }

        if (this.state === CB_STATE.HALF_OPEN) {
            if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
                this.totalRejections++;
                this.emit('rejected', { name: this.name, state: this.state });
                throw new CircuitOpenError(`Circuit [${this.name}] is HALF_OPEN and max probes reached. Fast-failing.`);
            }
            this.halfOpenAttempts++;
        }

        try {
            
            const result = await asyncFn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure(err);
            throw err;
        }
    }

        _onSuccess() {
        this.totalSuccesses++;
        this.consecutiveFailures = 0;
        if (this.state === CB_STATE.HALF_OPEN) {
            
            this._transitionTo(CB_STATE.CLOSED);
        }
        this.emit('success', { name: this.name });
    }

        _onFailure(err) {
        this.totalFailures++;
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();

        this.emit('failure', { name: this.name, error: err.message, count: this.consecutiveFailures });

        if (this.state === CB_STATE.HALF_OPEN) {
            
            this._transitionTo(CB_STATE.OPEN);
        } else if (this.state === CB_STATE.CLOSED && this.consecutiveFailures >= this.failureThreshold) {
            
            this._transitionTo(CB_STATE.OPEN);
        }
    }

        _transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        if (newState === CB_STATE.HALF_OPEN) {
            this.halfOpenAttempts = 0;
        }
        this.emit('stateChange', { name: this.name, from: oldState, to: newState });
    }

        getState() {
        return this.state;
    }

        getStats() {
        return {
            name: this.name,
            state: this.state,
            consecutiveFailures: this.consecutiveFailures,
            totalSuccesses: this.totalSuccesses,
            totalFailures: this.totalFailures,
            totalRejections: this.totalRejections,
            lastFailureTime: this.lastFailureTime,
        };
    }

        reset() {
        const oldState = this.state;
        this.state = CB_STATE.CLOSED;
        this.consecutiveFailures = 0;
        this.lastFailureTime = null;
        this.halfOpenAttempts = 0;
        this.emit('stateChange', { name: this.name, from: oldState, to: CB_STATE.CLOSED, reason: 'manual_reset' });
    }
}

module.exports = CircuitBreaker;
