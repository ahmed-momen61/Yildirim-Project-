
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const path = require('path');





const MAX_CONCURRENT_AGENTS = 10;

const MAX_REFLECTION_ITERATIONS = 3;

const DEFAULT_AGENT_TIMEOUT_MS = 30_000;

const MIN_ACCEPTANCE_CONFIDENCE = 0.65;

const PIPELINE_MODE = Object.freeze({
        SEQUENTIAL: 'SEQUENTIAL',
        FAN_OUT: 'FAN_OUT',
        HIERARCHICAL: 'HIERARCHICAL',
});

const AGENT_STATE = Object.freeze({
    IDLE: 'IDLE',
    EXECUTING: 'EXECUTING',
    REFLECTING: 'REFLECTING',
    WAITING_HITL: 'WAITING_HITL',
    CIRCUIT_OPEN: 'CIRCUIT_OPEN',
    ERROR: 'ERROR',
});






const BANNER = `
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║    ██████╗ ██╗  ██╗██╗███╗   ███╗███████╗██████╗  █████╗            ║
║   ██╔════╝██║  ██║██║████╗ ████║██╔════╝██╔══██╗██╔══██╗           ║
║   ██║     ███████║██║██╔████╔██║█████╗  ██████╔╝███████║           ║
║   ██║     ██╔══██║██║██║╚██╔╝██║██╔══╝  ██╔══██╗██╔══██║           ║
║   ╚██████╗██║  ██║██║██║ ╚═╝ ██║███████╗██║  ██║██║  ██║           ║
║    ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝           ║
║                                                                      ║
║              ╔═╗┌─┐┌─┐┌┐┌┌┬┐  ╦═╗┬ ┬┌┐┌┌┬┐┬┌┬┐┌─┐                ║
║              ╠═╣│ ┬├┤ │││ │   ╠╦╝│ ││││ │ ││││├┤                 ║
║              ╩ ╩└─┘└─┘┘└┘ ┴   ╩╚═└─┘┘└┘ ┴ ┴┴ ┴└─┘                ║
║                                                                      ║
║   CHIMERA-OMEGA v1.0  •  Hierarchical Multi-Agent Orchestration     ║
║   Bayezid SOAR — Cognitive Layer                                     ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`;






class AgentRuntime extends EventEmitter {
        constructor(config) {
        super();

        if (!config) {
            throw new Error('[AgentRuntime] Configuration object is required.');
        }

        this.redisClient = config.redisClient || null;
        this.toolRouter = config.toolRouter || null;
        this.hitlGate = config.hitlGate || null;

        
        const opts = config.options || {};
        this.maxConcurrentAgents = opts.maxConcurrentAgents || MAX_CONCURRENT_AGENTS;
        this.maxReflectionIterations = opts.maxReflectionIterations || MAX_REFLECTION_ITERATIONS;
        this.defaultAgentTimeoutMs = opts.defaultAgentTimeoutMs || DEFAULT_AGENT_TIMEOUT_MS;
        this.minAcceptanceConfidence = opts.minAcceptanceConfidence || MIN_ACCEPTANCE_CONFIDENCE;

                this._agents = new Map();

                this._circuitBreakers = new Map();

                this._fallbackChains = new Map();

                this._agentStates = new Map();

                this._traceLog = [];

                this._initialized = false;

                this._stats = {
            totalPipelines: 0,
            successfulPipelines: 0,
            failedPipelines: 0,
            totalAgentExecutions: 0,
            totalReflections: 0,
            totalFallbacks: 0,
            totalToolCalls: 0,
            averagePipelineDurationMs: 0,
        };
    }

    
    
    

        async initialize() {
        console.log(BANNER);
        console.log('[⚡] AgentRuntime initializing...');

        
        if (this.redisClient) {
            try {
                if (!this.redisClient.isOpen) {
                    await this.redisClient.connect();
                }
                await this.redisClient.ping();
                console.log('[✔] Redis: Connected and responsive.');
            } catch (err) {
                console.warn(`[⚠️] Redis: Connection failed (${err.message}). Running in memory-only mode.`);
                this.redisClient = null;
            }
        } else {
            console.warn('[⚠️] Redis: Not configured. Running in memory-only mode.');
        }

        
        if (this.toolRouter) {
            const tools = this.toolRouter.listTools();
            console.log(`[✔] ToolRouter: ${tools.length} tools registered.`);
        } else {
            console.warn('[⚠️] ToolRouter: Not configured. Agents will have no tool access.');
        }

        
        if (this.hitlGate) {
            console.log('[✔] HITLGate: Operational. War Room CLI integration active.');
        } else {
            console.warn('[⚠️] HITLGate: Not configured. All actions will require manual tool-call gating.');
        }

        this._initialized = true;
        console.log('[⚡] AgentRuntime initialization complete.\n');
    }

    
    
    

        registerAgent(agent, options = {}) {
        if (!agent || !agent.agentId || typeof agent.execute !== 'function') {
            throw new Error('[AgentRuntime] Agent must have agentId (string) and execute (async function).');
        }

        if (this._agents.has(agent.agentId)) {
            console.warn(`[AgentRuntime] Agent ${agent.agentId} already registered — replacing.`);
        }

        
        this._agents.set(agent.agentId, agent);
        this._agentStates.set(agent.agentId, AGENT_STATE.IDLE);

        
        let CircuitBreaker;
        try {
            CircuitBreaker = require('./CircuitBreaker');
        } catch (e) {
            
            CircuitBreaker = null;
        }

        if (CircuitBreaker) {
            const cb = new CircuitBreaker({
                name: agent.agentId,
                failureThreshold: options.circuitBreakerThreshold || 3,
                resetTimeoutMs: options.circuitBreakerResetMs || 60_000,
            });

            cb.on('stateChange', (event) => {
                console.log(`[⚡] CircuitBreaker [${agent.agentId}]: ${event.from} → ${event.to}`);
                if (event.to === 'OPEN') {
                    this._agentStates.set(agent.agentId, AGENT_STATE.CIRCUIT_OPEN);
                }
            });

            this._circuitBreakers.set(agent.agentId, cb);
        }

        
        this._fallbackChains.set(
            agent.agentId,
            options.fallbackChain || ['HUMAN']
        );

        
        if (typeof agent.setRuntime === 'function') {
            agent.setRuntime({
                toolRouter: this.toolRouter,
                hitlGate: this.hitlGate,
                redisClient: this.redisClient,
                emitTrace: this._emitTrace.bind(this),
                delegateTo: this._delegateToAgent.bind(this),
            });
        }

        console.log(`[✔] Agent registered: ${agent.agentId} (role: ${agent.role || 'unspecified'})`);
        this.emit('agentRegistered', { agentId: agent.agentId, role: agent.role });
    }

        getAgent(agentId) {
        return this._agents.get(agentId) || null;
    }

        listAgents() {
        const agents = [];
        for (const [agentId, agent] of this._agents) {
            agents.push({
                agentId,
                role: agent.role || 'unspecified',
                state: this._agentStates.get(agentId) || AGENT_STATE.IDLE,
                circuitBreakerState: this._circuitBreakers.has(agentId)
                    ? this._circuitBreakers.get(agentId).getState()
                    : 'N/A',
                requiredTools: agent.requiredTools || [],
            });
        }
        return agents;
    }

    
    
    

        async orchestrate(incidentEvent, options = {}) {
        if (!this._initialized) {
            throw new Error('[AgentRuntime] Runtime not initialized. Call initialize() first.');
        }

        const traceId = crypto.randomUUID();
        const startTime = Date.now();
        const mode = options.mode || PIPELINE_MODE.HIERARCHICAL;
        this._stats.totalPipelines++;

        console.log(`\n[🎯] ════════════════════════════════════════════════════`);
        console.log(`[🎯] PIPELINE STARTED: ${traceId.substring(0, 8)}`);
        console.log(`[🎯] Alert: ${incidentEvent.alertId || 'unknown'}`);
        console.log(`[🎯] Type: ${incidentEvent.eventType || 'unknown'}`);
        console.log(`[🎯] Severity: ${incidentEvent.severity || 'unknown'}`);
        console.log(`[🎯] Mode: ${mode}`);
        console.log(`[🎯] ════════════════════════════════════════════════════\n`);

        
        const pipelineState = {
            trace_id: traceId,
            alert_id: incidentEvent.alertId,
            incident: incidentEvent,
            mode: mode,
            phase: 'INTAKE',
            agent_outputs: {},
            tool_calls: [],
            hitl_decisions: [],
            errors: [],
            started_at: new Date().toISOString(),
            completed_at: null,
        };

        this.emit('pipelineStarted', { traceId, incidentEvent, mode });
        this._traceLog = [];

        let finalResult;

        try {
            switch (mode) {
                case PIPELINE_MODE.HIERARCHICAL:
                    finalResult = await this._runHierarchical(pipelineState, options);
                    break;

                case PIPELINE_MODE.FAN_OUT:
                    finalResult = await this._runFanOut(pipelineState, options);
                    break;

                case PIPELINE_MODE.SEQUENTIAL:
                    finalResult = await this._runSequential(pipelineState, options);
                    break;

                default:
                    throw new Error(`[AgentRuntime] Unknown pipeline mode: ${mode}`);
            }

            pipelineState.phase = 'COMPLETED';
            pipelineState.completed_at = new Date().toISOString();
            this._stats.successfulPipelines++;

            
            
            if (this.redisClient && this.redisClient.isOpen && pipelineState.agent_outputs) {
                try {
                    const traceData = {
                        trace_id: pipelineState.trace_id,
                        alert_id: pipelineState.alert_id,
                        incident: pipelineState.incident,
                        agent_outputs: pipelineState.agent_outputs,
                        tool_calls: pipelineState.tool_calls,
                        timestamp: pipelineState.completed_at
                    };
                    
                    await this.redisClient.lPush(
                        'bayezid:training_backlog:raw', 
                        JSON.stringify(traceData)
                    );
                    console.log(`[📚] Agentic Feedback Loop: Harvested trace ${traceId.substring(0, 8)} to training backlog.`);
                } catch (harvestErr) {
                    console.warn(`[⚠️] Failed to harvest trace to training backlog: ${harvestErr.message}`);
                }
            }

        } catch (err) {
            pipelineState.phase = 'FAILED';
            pipelineState.errors.push({
                error: err.message,
                stack: err.stack,
                timestamp: new Date().toISOString(),
            });
            this._stats.failedPipelines++;

            console.error(`[❌] Pipeline ${traceId.substring(0, 8)} FAILED: ${err.message}`);

            finalResult = {
                success: false,
                error: err.message,
                agent_outputs: pipelineState.agent_outputs,
                recommendation: 'ESCALATE_TO_HITL',
            };
        }

        const durationMs = Date.now() - startTime;
        this._updateAverageDuration(durationMs);

        const pipelineResult = new PipelineResult(
            traceId,
            pipelineState.phase === 'COMPLETED',
            finalResult,
            {
                duration_ms: durationMs,
                agents_invoked: Object.keys(pipelineState.agent_outputs).length,
                tool_calls: pipelineState.tool_calls.length,
                hitl_decisions: pipelineState.hitl_decisions.length,
                errors: pipelineState.errors.length,
                trace: this._traceLog,
            }
        );

        console.log(`\n[🎯] ════════════════════════════════════════════════════`);
        console.log(`[🎯] PIPELINE ${pipelineResult.success ? 'COMPLETED' : 'FAILED'}: ${traceId.substring(0, 8)}`);
        console.log(`[🎯] Duration: ${durationMs}ms`);
        console.log(`[🎯] Agents: ${Object.keys(pipelineState.agent_outputs).length}`);
        console.log(`[🎯] Tool Calls: ${pipelineState.tool_calls.length}`);
        console.log(`[🎯] HITL Decisions: ${pipelineState.hitl_decisions.length}`);
        console.log(`[🎯] ════════════════════════════════════════════════════\n`);

        
        if (this.redisClient && this.redisClient.isOpen) {
            try {
                await this.redisClient.set(
                    `bayezid:pipeline:${traceId}`,
                    JSON.stringify(pipelineResult),
                    { EX: 86400 } 
                );
            } catch (err) {
                console.warn(`[⚠️] Failed to store pipeline result in Redis: ${err.message}`);
            }
        }

        this.emit('pipelineCompleted', pipelineResult);
        return pipelineResult;
    }

    
    
    

        async _runHierarchical(pipelineState, options) {
        const orchestratorId = options.orchestratorAgentId || 'IncidentCommanderAgent';
        const orchestrator = this._agents.get(orchestratorId);

        if (!orchestrator) {
            console.warn(`[⚠️] Orchestrator ${orchestratorId} not registered. Falling back to FAN_OUT mode.`);
            return this._runFanOut(pipelineState, options);
        }

        pipelineState.phase = 'ORCHESTRATING';

        
        const result = await this._executeAgent(
            orchestratorId,
            {
                type: 'ORCHESTRATE',
                incident: pipelineState.incident,
                available_agents: this.listAgents().filter(a => a.agentId !== orchestratorId),
                available_tools: this.toolRouter ? this.toolRouter.listTools() : [],
            },
            pipelineState
        );

        pipelineState.agent_outputs[orchestratorId] = result;
        return result;
    }

        async _runFanOut(pipelineState, options) {
        pipelineState.phase = 'FAN_OUT';

        const agentIds = options.agentWhitelist || [...this._agents.keys()];
        const tasks = agentIds.map(agentId => ({
            agentId,
            task: {
                type: 'ANALYZE',
                incident: pipelineState.incident,
            },
        }));

        
        const results = await this._executeParallel(tasks, pipelineState);

        
        const merged = {
            success: true,
            agent_outputs: {},
            consensus: null,
            recommendation: null,
        };

        const recommendations = [];
        const confidences = [];

        for (const [agentId, result] of Object.entries(results)) {
            merged.agent_outputs[agentId] = result;
            pipelineState.agent_outputs[agentId] = result;

            if (result && result.recommendation) {
                recommendations.push(result.recommendation);
            }
            if (result && typeof result.confidence === 'number') {
                confidences.push(result.confidence);
            }
        }

        
        if (recommendations.length > 0) {
            const votes = {};
            for (const rec of recommendations) {
                votes[rec] = (votes[rec] || 0) + 1;
            }
            merged.recommendation = Object.entries(votes)
                .sort((a, b) => b[1] - a[1])[0][0];
        }

        
        if (confidences.length > 0) {
            merged.averageConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        }

        return merged;
    }

        async _runSequential(pipelineState, options) {
        pipelineState.phase = 'SEQUENTIAL';

        const agentIds = options.agentWhitelist || [...this._agents.keys()];
        let previousOutput = null;

        for (const agentId of agentIds) {
            const task = {
                type: 'ANALYZE',
                incident: pipelineState.incident,
                previous_agent_output: previousOutput,
            };

            const result = await this._executeAgent(agentId, task, pipelineState);
            pipelineState.agent_outputs[agentId] = result;
            previousOutput = result;
        }

        return {
            success: true,
            agent_outputs: pipelineState.agent_outputs,
            final_output: previousOutput,
        };
    }

    
    
    

        async _executeAgent(agentId, task, pipelineState) {
        const agent = this._agents.get(agentId);
        if (!agent) {
            throw new Error(`[AgentRuntime] Agent ${agentId} not registered.`);
        }

        this._stats.totalAgentExecutions++;
        this._agentStates.set(agentId, AGENT_STATE.EXECUTING);

        const startTime = Date.now();
        this.emit('agentExecutionStarted', { agentId, traceId: pipelineState.trace_id });

        console.log(`[🤖] Agent ${agentId}: EXECUTING`);

        try {
            
            const circuitBreaker = this._circuitBreakers.get(agentId);
            let output;

            const executeFn = async () => {
                
                const context = {
                    traceId: pipelineState.trace_id,
                    pipelineState: {
                        phase: pipelineState.phase,
                        agent_outputs: pipelineState.agent_outputs,
                    },
                    toolRouter: this.toolRouter,
                    hitlGate: this.hitlGate,
                    delegateTo: (targetAgentId, delegatedTask) =>
                        this._delegateToAgent(targetAgentId, delegatedTask, pipelineState),
                };

                
                const result = await this._withTimeout(
                    agent.execute(task, context),
                    agent.timeoutMs || this.defaultAgentTimeoutMs,
                    `Agent ${agentId} execution timed out`
                );

                return result;
            };

            if (circuitBreaker) {
                output = await circuitBreaker.execute(executeFn);
            } else {
                output = await executeFn();
            }

            
            if (agent.evaluate && typeof agent.evaluate === 'function') {
                output = await this._reflectionLoop(agent, task, output, pipelineState);
            }

            const durationMs = Date.now() - startTime;
            this._agentStates.set(agentId, AGENT_STATE.IDLE);

            this._emitTrace({
                type: 'AGENT_EXECUTION',
                agent_id: agentId,
                trace_id: pipelineState.trace_id,
                input_summary: this._summarize(task),
                output_summary: this._summarize(output),
                confidence: output?.confidence || null,
                duration_ms: durationMs,
                status: 'SUCCESS',
            });

            console.log(`[🤖] Agent ${agentId}: COMPLETED (${durationMs}ms, confidence: ${output?.confidence || 'N/A'})`);
            this.emit('agentExecutionCompleted', { agentId, durationMs, output });

            return output;

        } catch (err) {
            const durationMs = Date.now() - startTime;
            this._agentStates.set(agentId, AGENT_STATE.ERROR);

            this._emitTrace({
                type: 'AGENT_EXECUTION',
                agent_id: agentId,
                trace_id: pipelineState.trace_id,
                input_summary: this._summarize(task),
                output_summary: null,
                error: err.message,
                duration_ms: durationMs,
                status: 'FAILURE',
            });

            console.error(`[❌] Agent ${agentId}: FAILED (${err.message})`);
            pipelineState.errors.push({
                agent_id: agentId,
                error: err.message,
                timestamp: new Date().toISOString(),
            });

            
            return this._executeFallback(agentId, task, pipelineState, err);
        }
    }

        async _reflectionLoop(agent, task, output, pipelineState) {
        let currentOutput = output;

        for (let i = 0; i < this.maxReflectionIterations; i++) {
            try {
                const evaluation = await agent.evaluate(task, currentOutput);

                
                if (!evaluation || evaluation.acceptable !== false) {
                    return currentOutput; 
                }

                if (typeof evaluation.score === 'number' && evaluation.score >= this.minAcceptanceConfidence) {
                    return currentOutput; 
                }

                
                this._stats.totalReflections++;
                this._agentStates.set(agent.agentId, AGENT_STATE.REFLECTING);

                console.log(`[🔄] Agent ${agent.agentId}: Reflecting (iteration ${i + 1}/${this.maxReflectionIterations}). Feedback: ${evaluation.feedback || 'none'}`);

                
                if (typeof agent.executeWithFeedback === 'function') {
                    currentOutput = await agent.executeWithFeedback(task, evaluation.feedback, i + 1);
                } else {
                    
                    const context = {
                        traceId: pipelineState.trace_id,
                        reflection_feedback: evaluation.feedback,
                        iteration: i + 1,
                    };
                    currentOutput = await agent.execute(task, context);
                }

            } catch (reflectionErr) {
                console.warn(`[⚠️] Agent ${agent.agentId}: Reflection error (${reflectionErr.message}). Using last output.`);
                return currentOutput;
            }
        }

        console.warn(`[⚠️] Agent ${agent.agentId}: Max reflection iterations reached. Using best output.`);
        return currentOutput;
    }

        async _executeFallback(failedAgentId, task, pipelineState, originalError) {
        const chain = this._fallbackChains.get(failedAgentId) || ['HUMAN'];
        this._stats.totalFallbacks++;

        console.log(`[🔄] Fallback chain for ${failedAgentId}: [${chain.join(' → ')}]`);
        this.emit('fallbackTriggered', { failedAgentId, chain });

        for (const fallbackId of chain) {
            if (fallbackId === 'HUMAN') {
                
                console.log(`[🚦] Escalating to HITL — all agent fallbacks exhausted for ${failedAgentId}.`);

                if (this.hitlGate) {
                    const hitlResult = await this.hitlGate.requestApproval({
                        agentId: failedAgentId,
                        action: {
                            type: 'MANUAL_ANALYSIS_REQUIRED',
                            target: pipelineState.incident.alertId || 'unknown',
                        },
                        context: {
                            trace: `Agent ${failedAgentId} failed: ${originalError.message}. Fallback chain exhausted.`,
                            confidence: 0,
                            alternatives: [],
                        },
                        consequences: {
                            approve: 'Human takes over the analysis manually.',
                            deny: 'Incident left unprocessed — potential threat persistence.',
                        },
                        trigger: 'AGENT_REQUEST',
                        traceId: pipelineState.trace_id,
                    });

                    pipelineState.hitl_decisions.push({
                        gate_id: hitlResult.gateId,
                        decision: hitlResult.decision,
                        agent: failedAgentId,
                        reason: 'Fallback chain exhausted',
                    });

                    return {
                        success: false,
                        fallback: 'HUMAN',
                        hitl_decision: hitlResult.decision,
                        original_error: originalError.message,
                        recommendation: 'MANUAL_ANALYSIS_REQUIRED',
                    };
                }

                
                return {
                    success: false,
                    fallback: 'HUMAN',
                    original_error: originalError.message,
                    recommendation: 'ESCALATE_TO_HITL',
                };
            }

            
            const fallbackAgent = this._agents.get(fallbackId);
            if (!fallbackAgent) {
                console.warn(`[⚠️] Fallback agent ${fallbackId} not registered. Skipping.`);
                continue;
            }

            const fallbackCB = this._circuitBreakers.get(fallbackId);
            if (fallbackCB && fallbackCB.getState() === 'OPEN') {
                console.warn(`[⚠️] Fallback agent ${fallbackId} circuit is OPEN. Skipping.`);
                continue;
            }

            try {
                console.log(`[🔄] Attempting fallback: ${failedAgentId} → ${fallbackId}`);
                const result = await this._executeAgent(fallbackId, task, pipelineState);
                result._fallback_from = failedAgentId;
                return result;
            } catch (fallbackErr) {
                console.error(`[❌] Fallback agent ${fallbackId} also failed: ${fallbackErr.message}`);
                continue;
            }
        }

        
        return {
            success: false,
            fallback: 'ALL_EXHAUSTED',
            original_error: originalError.message,
            recommendation: 'ESCALATE_TO_HITL',
        };
    }

    
    
    

        async _delegateToAgent(targetAgentId, task, pipelineState) {
        console.log(`[📨] Delegation: → ${targetAgentId}`);

        const result = await this._executeAgent(targetAgentId, task, pipelineState);
        pipelineState.agent_outputs[targetAgentId] = result;

        return result;
    }

    
    
    

        async _executeParallel(tasks, pipelineState) {
        const results = {};
        const concurrencyLimit = this.maxConcurrentAgents;

        
        for (let i = 0; i < tasks.length; i += concurrencyLimit) {
            const chunk = tasks.slice(i, i + concurrencyLimit);
            const chunkResults = await Promise.allSettled(
                chunk.map(({ agentId, task }) =>
                    this._executeAgent(agentId, task, pipelineState)
                        .then(result => ({ agentId, result }))
                )
            );

            for (const settled of chunkResults) {
                if (settled.status === 'fulfilled') {
                    results[settled.value.agentId] = settled.value.result;
                } else {
                    
                    const agentId = chunk[chunkResults.indexOf(settled)]?.agentId || 'unknown';
                    results[agentId] = {
                        success: false,
                        error: settled.reason?.message || 'Unknown error',
                    };
                }
            }
        }

        return results;
    }

    
    
    

        async _withTimeout(promise, timeoutMs, message) {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            const result = await Promise.race([promise, timeoutPromise]);
            clearTimeout(timeoutHandle);
            return result;
        } catch (err) {
            clearTimeout(timeoutHandle);
            throw err;
        }
    }

        _emitTrace(traceEvent) {
        const fullTrace = {
            ...traceEvent,
            timestamp: new Date().toISOString(),
            runtime_id: 'bayezid_chimera_omega',
        };

        this._traceLog.push(fullTrace);
        this.emit('traceEmitted', fullTrace);
    }

        _summarize(obj, maxLen = 200) {
        if (!obj) return 'null';
        const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
    }

        _updateAverageDuration(durationMs) {
        const total = this._stats.successfulPipelines + this._stats.failedPipelines;
        if (total <= 1) {
            this._stats.averagePipelineDurationMs = durationMs;
        } else {
            this._stats.averagePipelineDurationMs =
                (this._stats.averagePipelineDurationMs * (total - 1) + durationMs) / total;
        }
    }

        getStats() {
        return {
            ...this._stats,
            registered_agents: this._agents.size,
            circuit_breakers: Object.fromEntries(
                [...this._circuitBreakers.entries()].map(([id, cb]) => [id, cb.getState()])
            ),
            hitl_stats: this.hitlGate ? this.hitlGate.getStats() : null,
        };
    }

        async shutdown() {
        console.log('\n[⚡] AgentRuntime shutting down...');

        
        if (this.hitlGate) {
            await this.hitlGate.shutdown();
        }

        
        for (const agentId of this._agents.keys()) {
            this._agentStates.set(agentId, AGENT_STATE.IDLE);
        }

        
        for (const cb of this._circuitBreakers.values()) {
            cb.reset();
        }

        console.log('[⚡] AgentRuntime shutdown complete.');
    }
}






class PipelineResult {
        constructor(traceId, success, result, metadata) {
                this.traceId = traceId;
                this.success = success;
                this.result = result;
                this.metadata = metadata;
                this.timestamp = new Date().toISOString();

        Object.freeze(this);
    }
}






module.exports = {
    AgentRuntime,
    PipelineResult,
    PIPELINE_MODE,
    AGENT_STATE,
    MAX_CONCURRENT_AGENTS,
    MAX_REFLECTION_ITERATIONS,
    DEFAULT_AGENT_TIMEOUT_MS,
    MIN_ACCEPTANCE_CONFIDENCE,
};
