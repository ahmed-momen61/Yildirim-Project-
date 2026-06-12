const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { resolveGitBinary } = require('../utils/crossPlatform');

const execFileAsync = promisify(execFile);

const cloneAndExtract = async (repoUrl, options = {}) => {
  const GIT = resolveGitBinary();
  const tmpDir = path.join(os.tmpdir(), `bayezid_git_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const artifacts = { emails: [], names: [], timestamps: [], commits: 0, authorMap: {} };

  try {
    await execFileAsync(GIT, ['clone', '--bare', '--depth', String(options.depth || 200), repoUrl, tmpDir], {
      timeout: 120000
    });

    const { stdout: logRaw } = await execFileAsync(
      GIT,
      ['log', '--format=%ae|%an|%at|%H', '--all'],
      { cwd: tmpDir, maxBuffer: 20 * 1024 * 1024 }
    );

    const entries = logRaw.trim().split('\n').filter(Boolean).map((line) => {
      const [email, name, ts, hash] = line.split('|');
      return { email: email?.trim(), name: name?.trim(), timestamp: parseInt(ts) * 1000, hash };
    });

    artifacts.emails    = [...new Set(entries.map((e) => e.email).filter(Boolean))];
    artifacts.names     = [...new Set(entries.map((e) => e.name).filter(Boolean))];
    artifacts.commits   = entries.length;

    for (const entry of entries) {
      if (!entry.email) continue;
      if (!artifacts.authorMap[entry.email]) {
        artifacts.authorMap[entry.email] = { name: entry.name, firstSeen: entry.timestamp, lastSeen: entry.timestamp, commitCount: 0 };
      }
      const a = artifacts.authorMap[entry.email];
      a.commitCount++;
      if (entry.timestamp < a.firstSeen) a.firstSeen = entry.timestamp;
      if (entry.timestamp > a.lastSeen)  a.lastSeen  = entry.timestamp;
    }

    try {
      const { stdout: configRaw } = await execFileAsync(GIT, ['config', '--list'], { cwd: tmpDir });
      const configEmails = [...configRaw.matchAll(/email\s*=\s*(.+)/gi)].map((m) => m[1].trim());
      artifacts.emails = [...new Set([...artifacts.emails, ...configEmails])];
    } catch (_) {}

    return { repoUrl, artifacts, scannedAt: new Date().toISOString() };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
};

module.exports = { cloneAndExtract };
