const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

const daemons = {
    causalEngine: { script: 'ml_engine/causal_engine.py', process: null, name: 'Causal Engine', port: 8002 },
    mlSniper: { script: 'ml_engine/main.py', process: null, name: 'ML Sniper', port: 8000 },
    gnnOracle: { script: 'ml_engine/gnn_oracle.py', process: null, name: 'GNN Oracle', port: 8001 },
    llvmMutator: { script: 'ml_engine/llvm_mutator.py', process: null, name: 'LLVM Mutator', port: 8003 },
    wingmanCli: { isNode: true, script: 'src/broker/wingman_cli.js', process: null, name: 'Wingman CLI' },
    warRoomCli: { isNode: true, script: 'src/broker/war_room_cli.js', process: null, name: 'War Room CLI' },
    mispDocker: { isDocker: true, cmd: 'docker-compose -f misp-local/docker-compose.yml up', process: null, name: 'MISP Server', port: 8088 }
};

let currentDelay = 1000;
const MAX_DELAY = 30000;
let isShuttingDown = false;
let currentExecutable = os.platform() === 'win32' ? 'py' : 'python3';
const win32Fallbacks = ['py', 'python', 'python3'];
let win32FallbackIdx = 0;

const spawnDaemon = (key) => {
    const daemon = daemons[key];
    if (!daemon || daemon.process) {
        return;
    }
    
    if (os.platform() === 'win32') {
        console.log(`[🚀] Spawning ${daemon.name} in a popped-up terminal window...`);
        let execCmd = '';
        if (daemon.isDocker) {
            if (key === 'mispDocker') {
                execCmd = 'docker-compose -f misp-local\\docker-compose.yml up -d db redis && timeout /t 15 /nobreak && docker-compose -f misp-local\\docker-compose.yml up';
            } else {
                execCmd = daemon.cmd.replace(/\//g, '\\');
            }
        } else if (daemon.isNode) {
            const winScript = daemon.script.replace(/\//g, '\\');
            execCmd = `node ${winScript}`;
        } else {
            const winScript = daemon.script.replace(/\//g, '\\');
            execCmd = `${currentExecutable} ${winScript}`;
        }
        
        daemon.process = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title ${daemon.name} && ${execCmd}" -Wait`
        ], {
            cwd: path.join(__dirname, '../../')
        });
    } else {
        if (daemon.isDocker) {
            console.log(`[🐳] Starting ${daemon.name} daemon via Docker on port ${daemon.port}...`);
            let cmdStr = daemon.cmd;
            if (key === 'mispDocker') {
                cmdStr = 'docker-compose -f misp-local/docker-compose.yml up -d db redis && sleep 15 && docker-compose -f misp-local/docker-compose.yml up';
            }
            daemon.process = spawn('sh', ['-c', cmdStr], {
                stdio: 'inherit',
                cwd: path.join(__dirname, '../../')
            });
        } else if (daemon.isNode) {
            const scriptPath = path.join(__dirname, '../../', daemon.script);
            console.log(`[🟢] Starting ${daemon.name} on Node: node ${scriptPath}`);
            daemon.process = spawn('node', [scriptPath], {
                stdio: 'inherit',
                cwd: path.join(__dirname, '../../')
            });
        } else {
            const scriptPath = path.join(__dirname, '../../', daemon.script);
            console.log(`[🐍] Starting ${daemon.name} daemon on port ${daemon.port}: ${currentExecutable} ${scriptPath}`);
            daemon.process = spawn(currentExecutable, [scriptPath], {
                stdio: 'inherit',
                cwd: path.join(__dirname, '../../')
            });
        }
    }
    
    daemon.process.on('error', (err) => {
        console.error(`[🚀] ${daemon.name} spawn error:`, err.message);
        
        if (!daemon.isDocker && !daemon.isNode && os.platform() === 'win32' && err.code === 'ENOENT' && win32FallbackIdx < win32Fallbacks.length - 1) {
            win32FallbackIdx++;
            currentExecutable = win32Fallbacks[win32FallbackIdx];
            console.log(`[🐍] Retrying on Windows with fallback executable: ${currentExecutable}`);
            daemon.process = null;
            spawnDaemon(key);
            return;
        }
        
        daemon.process = null;
        if (!isShuttingDown) {
            setTimeout(() => spawnDaemon(key), 5000);
        }
    });
    
    daemon.process.on('close', (code) => {
        daemon.process = null;
        if (!isShuttingDown) {
            console.warn(`[🚀] ${daemon.name} daemon window was closed or exited with code ${code}. Restarting in 5s...`);
            setTimeout(() => spawnDaemon(key), 5000);
        }
    });
};

const checkHttpHealth = (port) => new Promise((resolve) => {
    const http = require('http');
    const options = {
        hostname: '127.0.0.1',
        port: port,
        path: '/health',
        method: 'GET',
        timeout: 500
    };
    const req = http.request(options, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => {
        const rootOptions = { ...options, path: '/' };
        const rootReq = http.request(rootOptions, (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        rootReq.on('error', () => resolve(false));
        rootReq.end();
    });
    req.end();
});

const waitForDaemons = async () => {
    const ports = [8000, 8001, 8002, 8003];
    console.log(`[🔍] HEALTH CHECK: Verifying Python daemons are online via HTTP...`);
    let retries = 90; 
    while (retries > 0) {
        let allReady = true;
        for (const port of ports) {
            const ready = await checkHttpHealth(port);
            if (!ready) {
                allReady = false;
                break;
            }
        }
        if (allReady) {
            console.log(`[✅] HEALTH CHECK: All Python daemons are online and healthy.`);
            return true;
        }
        console.log(`[⏳] HEALTH CHECK: Daemons warming up (checking HTTP endpoints)... Retrying in 1s (${retries}s left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
    }
    console.warn(`[⚠️] HEALTH CHECK WARNING: Not all Python daemons responded. Proceeding anyway.`);
    return false;
};

let readyPromise = null;
const ready = () => {
    if (!readyPromise) {
        readyPromise = new Promise(async (resolve) => {
            const ports = [8000, 8001, 8002];
            console.log(`[🔍] READY CHECK: Verifying Python daemons (8000, 8001, 8002) are online...`);
            const startTime = Date.now();
            while (Date.now() - startTime < 60000) {
                let allReady = true;
                for (const port of ports) {
                    const healthy = await checkHttpHealth(port);
                    if (!healthy) {
                        allReady = false;
                        break;
                    }
                }
                if (allReady) {
                    console.log(`[✅] READY CHECK: Python daemons are online and healthy.`);
                    resolve(true);
                    return;
                }
                await new Promise(r => setTimeout(r, 500));
            }
            console.warn(`[⚠️] READY CHECK TIMEOUT: Python daemons failed to initialize in 60s.`);
            resolve(false);
        });
    }
    return readyPromise;
};

const spawnCausalEngine = async () => {
    isShuttingDown = false;
    for (const key of Object.keys(daemons)) {
        spawnDaemon(key);
    }
};

const getCausalEngineStatus = () => {
    const status = {};
    for (const [key, daemon] of Object.entries(daemons)) {
        status[key] = {
            running: daemon.process !== null,
            pid: daemon.process ? daemon.process.pid : null,
            name: daemon.name,
            port: daemon.port
        };
    }
    return status;
};

const stopCausalEngine = () => {
    isShuttingDown = true;
    for (const [key, daemon] of Object.entries(daemons)) {
        console.log(`[🚀] Stopping ${daemon.name} daemon...`);
        if (daemon.process) {
            daemon.process.kill();
            daemon.process = null;
        }
        if (daemon.isDocker) {
            try {
                const { execSync } = require('child_process');
                execSync('docker-compose -f misp-local/docker-compose.yml down', { stdio: 'ignore' });
            } catch (e) {}
        }
        if (os.platform() === 'win32') {
            try {
                const { execSync } = require('child_process');
                execSync(`taskkill /F /FI "WINDOWTITLE eq ${daemon.name}"`, { stdio: 'ignore' });
                execSync(`taskkill /F /FI "WINDOWTITLE eq ${daemon.name}*"`, { stdio: 'ignore' });
                
                if (!daemon.isDocker && daemon.script) {
                    const escapedScript = daemon.script.replace(/\//g, '\\\\');
                    execSync(`powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escapedScript}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`, { stdio: 'ignore' });
                }
            } catch (e) {}
        }
    }
};

module.exports = {
    spawnCausalEngine,
    getCausalEngineStatus,
    stopCausalEngine,
    ready
};
