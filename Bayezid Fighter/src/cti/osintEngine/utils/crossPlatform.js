const os = require('os');
const path = require('path');

const resolveTorBinary = () => {
  if (os.platform() === 'win32') {
    return process.env.TOR_WIN_PATH || path.join(__dirname, '..', '..', '..', 'bin', 'win', 'tor.exe');
  }
  return process.env.TOR_LINUX_PATH || '/usr/bin/tor';
};

const resolveGitBinary = () => {
  if (os.platform() === 'win32') {
    return process.env.GIT_WIN_PATH || 'C:\\Program Files\\Git\\bin\\git.exe';
  }
  return 'git';
};

const resolveNmapBinary = () => {
  if (os.platform() === 'win32') {
    return process.env.NMAP_WIN_PATH || 'C:\\Program Files (x86)\\Nmap\\nmap.exe';
  }
  return 'nmap';
};

module.exports = {
  resolveTorBinary,
  resolveGitBinary,
  resolveNmapBinary
};
