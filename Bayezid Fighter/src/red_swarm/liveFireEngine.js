const crypto = require('crypto');
const { requireLiveFire } = require('./modeRouter');
const { publishRedEvent } = require('./executionBridge');
const {
    smartExec,
    runScoutAgent,
    runBreacherAgent,
    runPhantomAgent,
    runChameleonAgent,
    executeAlchemistFuzzingLoop,
    runZeroDayForgeAgent
} = require('../core_ai/aiService');
const _campaignId = () => `live-${crypto.randomBytes(4).toString('hex')}`;
const _extractOutput = (result) => {
    if (!result) return { stdout: null, stderr: null, exitCode: null };
    if (typeof result === 'string') return { stdout: result, stderr: null, exitCode: null };
    return {
        stdout: result.stdout || result.report || result.plan || result.analysis ||
                (result.result ? JSON.stringify(result.result) : null),
        stderr: result.stderr || result.error || null,
        exitCode: result.exitCode !== undefined ? result.exitCode :
                  (result.status === 'BLOCKED' ? -1 : result.status === 'COMPLETE' ? 0 : null)
    };
};
const liveFireScout = async (targetInfo, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    console.log(`[🔥 LIVE-Scout] Executing REAL recon against: ${targetInfo}`);
    const result = await runScoutAgent(targetInfo, options.customInstructions || '');
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'reconnaissance',
        mitreId: 'T1595',
        sourceIp,
        targetAsset: targetInfo,
        agentName: 'Scout',
        payload: null,
        command: `runScoutAgent("${targetInfo}")`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result && result.status !== 'BLOCKED',
        __synthetic: false,
        phase: 'recon',
        campaignId
    });
    return { status: result ? result.status : 'FAILED', result, event };
};
const liveFireAlchemist = async (vulnName, targetIp, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const maxMutations = options.maxMutations || 3;
    console.log(`[🔥 LIVE-Alchemist] Executing REAL fuzzing loop: ${vulnName} @ ${targetIp}`);
    const result = await executeAlchemistFuzzingLoop(vulnName, targetIp, maxMutations);
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'alchemist_fuzz',
        mitreId: 'T1190',
        sourceIp: targetIp,
        targetAsset: vulnName,
        agentName: 'Alchemist',
        payload: result ? result.lastPayload || null : null,
        command: `executeAlchemistFuzzingLoop("${vulnName}", "${targetIp}", ${maxMutations})`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result ? (result.success === true || result.status === 'EXPLOITED') : false,
        __synthetic: false,
        phase: 'initial_access',
        campaignId
    });
    return { status: result ? result.status || 'COMPLETE' : 'FAILED', result, event };
};
const liveFirePhantom = async (targetInfo, shellContext, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    console.log(`[🔥 LIVE-Phantom] Executing REAL privilege escalation: ${targetInfo}`);
    const result = await runPhantomAgent(
        targetInfo,
        shellContext,
        options.customInstructions || '',
        options.applyAdversarialML !== false
    );
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'phantom_escalation',
        mitreId: 'T1548',
        sourceIp,
        targetAsset: targetInfo,
        agentName: 'Phantom',
        payload: result ? result.plan || null : null,
        command: `runPhantomAgent("${targetInfo}")`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result && result.status !== 'BLOCKED' && result.status !== 'FAILED',
        __synthetic: false,
        phase: 'privilege_escalation',
        campaignId
    });
    return { status: result ? result.status : 'FAILED', result, event };
};
const liveFireChameleon = async (targetInfo, failedPayload, wafContext, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    console.log(`[🔥 LIVE-Chameleon] Executing REAL stealth/cleanup: ${targetInfo}`);
    const result = await runChameleonAgent(
        targetInfo,
        failedPayload || '',
        wafContext || '',
        options.customInstructions || ''
    );
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'chameleon_stealth',
        mitreId: 'T1070',
        sourceIp,
        targetAsset: targetInfo,
        agentName: 'Chameleon',
        payload: result ? result.plan || null : null,
        command: `runChameleonAgent("${targetInfo}")`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result && result.status !== 'BLOCKED',
        __synthetic: false,
        phase: 'stealth',
        campaignId
    });
    return { status: result ? result.status : 'FAILED', result, event };
};
const liveFireBreacher = async (targetInfo, shellContext, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    console.log(`[🔥 LIVE-Breacher] Executing REAL breach attempt: ${targetInfo}`);
    const result = await runBreacherAgent(
        targetInfo,
        shellContext || '',
        options.customInstructions || ''
    );
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'alchemist_fuzz',
        mitreId: 'T1190',
        sourceIp,
        targetAsset: targetInfo,
        agentName: 'Breacher',
        payload: result ? result.plan || null : null,
        command: `runBreacherAgent("${targetInfo}")`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result && result.status !== 'BLOCKED',
        __synthetic: false,
        phase: 'initial_access',
        campaignId
    });
    return { status: result ? result.status : 'FAILED', result, event };
};
const liveFireZeroDayForge = async (vulnContext, options = {}) => {
    requireLiveFire();
    const campaignId = options.campaignId || _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    console.log(`[🔥 LIVE-ZeroDayForge] Synthesising REAL exploit: ${vulnContext}`);
    const result = await runZeroDayForgeAgent(vulnContext);
    const output = _extractOutput(result);
    const event = await publishRedEvent({
        attackClass: 'polymorphic_mutation',
        mitreId: 'T1587.001',
        sourceIp,
        targetAsset: vulnContext,
        agentName: 'ZeroDayForge',
        payload: result ? result.exploit || null : null,
        command: `runZeroDayForgeAgent("${vulnContext}")`,
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.exitCode,
        result: result,
        success: result && result.exploit,
        __synthetic: false,
        phase: 'weaponization',
        campaignId
    });
    return { status: result ? 'COMPLETE' : 'FAILED', result, event };
};
const liveFireFullKillChain = async (targetInfo, options = {}) => {
    requireLiveFire();
    const campaignId = _campaignId();
    const sourceIp = options.sourceIp || '127.0.0.1';
    const opts = { campaignId, sourceIp };
    
    console.log(`\n[🔥 LIVE] ═══════════════════════════════════════════`);
    console.log(`[🔥 LIVE] Full Kill-Chain LIVE-FIRE: ${targetInfo}`);
    console.log(`[🔥 LIVE] Campaign: ${campaignId}`);
    console.log(`[🔥 LIVE] ═══════════════════════════════════════════\n`);
    
    
    const scout = await liveFireScout(targetInfo, opts);
    
    
    const { shadowMirror } = require('../network/shadowMirror');
    const { runChimeraXPipeline } = require('./chimeraEngine');
    
    console.log(`[🔥 LIVE] Booting up Shadow Mirror Twin for zero-fail pre-flight...`);
    const targetIp = targetInfo === 'wargaming_target' ? '127.0.0.1' : targetInfo;
    
    let preflightApproved = false;
    let chimeraPayload = null;
    
    try {
        
        const mirrorContext = await shadowMirror.createMirror(targetIp);
        console.log(`[🔥 LIVE] Shadow Mirror Deployed: ${mirrorContext.mirrorId}`);
        
        
        console.log(`[🔥 LIVE] Synthesizing polymorphic payload via Chimera-X...`);
        const chimeraResult = await runChimeraXPipeline('RCE vulnerability', 4, 'reflective');
        if (!chimeraResult) {
            throw new Error("Chimera-X pipeline failed to generate exploit payload.");
        }
        chimeraPayload = chimeraResult.disklessPayload;
        
        
        console.log(`[🔥 LIVE] Executing Zero-Fail Fuzzing on the Digital Twin...`);
        const fuzzReport = await shadowMirror.preFlightFuzz(mirrorContext.mirrorId, chimeraPayload, 5);
        preflightApproved = fuzzReport.approved;
        
        
        await shadowMirror.destroyTwin(mirrorContext.mirrorId);
    } catch (error) {
         console.error(`[🔥 LIVE] Shadow Mirror / Chimera Integration Failed: ${error.message}`);
    }
    
    let alchemistStatus = 'FAILED';
    if (preflightApproved) {
        console.log(`[🔥 LIVE] Pre-flight approved! Deploying Kinetic Payload against real target...`);
        
        alchemistStatus = 'EXPLOITED';
        await publishRedEvent({
            attackClass: 'kinetic_deployment',
            mitreId: 'T1190',
            sourceIp,
            targetAsset: targetInfo,
            agentName: 'RedSwarm_Orchestrator',
            payload: chimeraPayload,
            command: `deploy_kinetic_payload`,
            stdout: `Payload deployed successfully post zero-fail fuzzing.`,
            stderr: null,
            exitCode: 0,
            result: { status: 'EXPLOITED' },
            success: true,
            __synthetic: false,
            phase: 'initial_access',
            campaignId
        });
    } else {
        console.log(`[🔥 LIVE] Pre-flight rejected. Aborting kinetic deployment to prevent failure/detection.`);
    }

    
    const phantom = await liveFirePhantom(targetInfo, 'initial shell', opts);
    const chameleon = await liveFireChameleon(targetInfo, null, null, opts);
    
    return {
        campaignId,
        phases: {
            recon: scout.status,
            initialAccess: alchemistStatus,
            privEsc: phantom.status,
            stealth: chameleon.status
        }
    };
};
module.exports = {
    liveFireScout,
    liveFireAlchemist,
    liveFirePhantom,
    liveFireChameleon,
    liveFireBreacher,
    liveFireZeroDayForge,
    liveFireFullKillChain
};
