import { proxyActivities, defineSignal, defineQuery, setHandler, condition } from '@temporalio/workflow';
const { alertTriage, threatScoping, containmentPlan, containmentExec, eradication, irReport, checkContainmentGate } = proxyActivities({
    startToCloseTimeout: '5 minutes',
    retry: {
        maximumAttempts: 3
    }
});
export const approveContainmentSignal = defineSignal('approveContainment');
export const rejectContainmentSignal = defineSignal('rejectContainment');
export const updateLedgerSignal = defineSignal('updateLedger');
export const getLedgerQuery = defineQuery('getLedger');
export async function pentestPipeline(input) {
    const ledger = {
        alertId: input.alertId,
        status: 'OPEN',
        threatScore: 0,
        affectedAssets: [input.targetAsset],
        containmentActions: [],
        causalVerdicts: [],
        logs: [`Pipeline started for Alert ${input.alertId}`]
    };
    setHandler(getLedgerQuery, () => ledger);
    setHandler(updateLedgerSignal, (updates) => {
        Object.assign(ledger, updates);
        ledger.logs.push(`Ledger updated via signal`);
    });
    let containmentApproved = false;
    let containmentRejected = false;
    setHandler(approveContainmentSignal, () => {
        containmentApproved = true;
        ledger.logs.push(`Containment manually APPROVED by Operator`);
    });
    setHandler(rejectContainmentSignal, () => {
        containmentRejected = true;
        ledger.logs.push(`Containment manually REJECTED by Operator`);
    });
    try {
        ledger.logs.push('Phase 1: Alert Triage');
        const triageResult = await alertTriage(input);
        ledger.threatScore = triageResult.threatScore;
        if (triageResult.isFalsePositive) {
            ledger.status = 'CLOSED';
            ledger.logs.push('Alert triaged as False Positive. Closing pipeline.');
            return ledger;
        }
        ledger.logs.push('Phase 2: Threat Scoping');
        const scopeResult = await threatScoping(input.sourceIp, ledger.affectedAssets);
        ledger.affectedAssets = Array.from(new Set([...ledger.affectedAssets, ...scopeResult.newAssets]));
        ledger.logs.push('Phase 3: Containment Plan generation');
        const planResult = await containmentPlan(ledger);
        ledger.containmentActions = planResult.proposedActions;
        ledger.logs.push('Executing Causal Engine Gate Check before containment...');
        for (const action of ledger.containmentActions) {
            const verdict = await checkContainmentGate(action, ledger.affectedAssets);
            ledger.causalVerdicts.push(verdict);
            if (!verdict.approved) {
                ledger.logs.push(`CAUSAL VETO: Action '${action}' rejected. Reason: ${verdict.justification}`);
                containmentRejected = true;
            }
        }
        if (!containmentRejected && planResult.requiresHumanApproval) {
            ledger.logs.push('Waiting for human operator approval to proceed with containment...');
            await condition(() => containmentApproved || containmentRejected, '10 minutes');
        }
        if (containmentRejected) {
            ledger.logs.push('Containment aborted. Proceeding directly to report generation.');
            ledger.status = 'OPEN';
        }
        else {
            ledger.logs.push('Phase 4: Containment Execution');
            await containmentExec(ledger.containmentActions, ledger.alertId);
            ledger.status = 'CONTAINED';
            ledger.logs.push('Phase 5: Eradication');
            await eradication(ledger.affectedAssets, input.sourceIp);
            ledger.status = 'ERADICATED';
        }
        ledger.logs.push('Phase 6: Incident Report Generation');
        await irReport(ledger);
    }
    catch (err) {
        ledger.logs.push(`PIPELINE ERROR: ${err.message}`);
        ledger.status = 'OPEN';
    }
    return ledger;
}
