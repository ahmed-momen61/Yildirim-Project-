const { veritasChain } = require('../crypto/veritasProof');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
class IrAuditSession {
  constructor({ alertId, sourceIp, alertType }) {
    this.metadata = { alertId, sourceIp, alertType };
    this.sessionDir = path.join('./ir_sessions', alertId);
    this.workflowLogPath = path.join(this.sessionDir, 'workflow.jsonl');
    this.phases = [];
    this.actions = [];
    this.startTime = Date.now();
  }
  async initialize() {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this._appendEntry({ event: 'SESSION_START', alertId: this.metadata.alertId, sourceIp: this.metadata.sourceIp, alertType: this.metadata.alertType });
  }
  _appendEntry(entry) {
    try {
      fs.appendFileSync(this.workflowLogPath, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
    } catch (err) {
      console.error(`[IrAuditSession] Failed to write entry: ${err.message}`);
    }
  }
  async logPhaseStart(phaseName) {
    this._appendEntry({ event: 'PHASE_START', phase: phaseName });
  }
  async logPhaseComplete(phaseName, result) {
    this._appendEntry({ event: 'PHASE_COMPLETE', phase: phaseName, result });
    this.phases.push({ phase: phaseName, result, completedAt: Date.now() });
  }
  async logActionTaken(actionType, target, details) {
    this._appendEntry({ event: 'ACTION_TAKEN', actionType, target, details });
    this.actions.push({ actionType, target, details, timestamp: Date.now() });
  }
  async finalize() {
    const durationMs = Date.now() - this.startTime;
    this._appendEntry({ event: 'SESSION_END', durationMs });
    try {
      const fileBuffer = fs.readFileSync(this.workflowLogPath);
      const hash = createHash('sha256').update(fileBuffer).digest('hex');
      await veritasChain.recordDecision(
        'IR_SESSION_COMPLETED',
        { alertId: this.metadata.alertId, evidenceHash: hash, phaseCount: this.phases.length, actionCount: this.actions.length },
        { operator: 'IrAuditSession' }
      );
      const summary = {
        alertId: this.metadata.alertId,
        evidenceHash: hash,
        phaseCount: this.phases.length,
        actionCount: this.actions.length,
        durationMs,
        veritasAnchored: true
      };
      fs.writeFileSync(path.join(this.sessionDir, 'ir_summary.json'), JSON.stringify(summary, null, 2));
      return summary;
    } catch (err) {
      console.error(`[IrAuditSession] Finalization failed: ${err.message}`);
      return { error: err.message };
    }
  }
}
module.exports = { IrAuditSession };
