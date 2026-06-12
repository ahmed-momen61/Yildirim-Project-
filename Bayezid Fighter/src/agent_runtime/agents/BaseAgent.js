
'use strict';

class BaseAgent {
        constructor(options) {
        if (!options.agentId) throw new Error('[BaseAgent] agentId is required');

        this.agentId = options.agentId;
        this.role = options.role || 'Unspecified Role';
        this.requiredTools = options.requiredTools || [];
        this.timeoutMs = options.timeoutMs || 30000;

        
        this.runtime = null;
    }

        setRuntime(runtimeContext) {
        this.runtime = runtimeContext;
    }

        async execute(task, context) {
        throw new Error(`[${this.agentId}] execute() must be implemented by subclass.`);
    }

        async evaluate(task, output) {
        
        const confidence = typeof output.confidence === 'number' ? output.confidence : 1.0;
        
        if (confidence >= 0.65) {
            return { acceptable: true, score: confidence, feedback: 'Confidence meets threshold.' };
        }

        return {
            acceptable: false,
            score: confidence,
            feedback: 'Confidence too low. Review evidence, request more context, or try an alternative tool.'
        };
    }

        async executeWithFeedback(task, feedback, iteration) {
        
        const contextualTask = {
            ...task,
            _reflection_iteration: iteration,
            _reflection_feedback: feedback
        };
        
        
        return this.execute(contextualTask, { traceId: 'reflection-retry', pipelineState: {} });
    }

    
    
    

        async callTool(toolName, params, context) {
        if (!this.runtime || !this.runtime.toolRouter) {
            throw new Error(`[${this.agentId}] ToolRouter not available.`);
        }

        if (!this.requiredTools.includes(toolName)) {
            console.warn(`[${this.agentId}] Warning: Calling tool '${toolName}' not in requiredTools list.`);
        }

        return this.runtime.toolRouter.call(
            toolName, 
            params, 
            this.agentId, 
            context?.traceId || 'unknown-trace'
        );
    }

        async callLLM(systemPrompt, userPrompt, options = {}) {
        
        
        
        
        
        
        console.log(`[🧠] ${this.agentId} calling LLM (Mocked for integration)...`);
        
        
        
        

        return {
            content: `[Mock LLM Response for ${this.agentId}] Processed task.`,
            confidence: 0.85,
            parsed_json: { action: 'PROCEED', reasoning: 'Standard LLM analysis simulated.' }
        };
    }
}

module.exports = BaseAgent;
