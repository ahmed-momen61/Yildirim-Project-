const { execSync } = require('child_process');
const os = require('os');
const activateKillSwitch = () => {
    console.error('\n[☠️] ========================================== [☠️]');
    console.error('[☠️] CRITICAL ALERT: SYSTEM KILL SWITCH ACTIVATED');
    console.error('[☠️] REASON: UNEXPECTED SWARM BEHAVIOR OR ROE VIOLATION');
    console.error('[☠️] ========================================== [☠️]\n');
    try {
        console.error('[☠️] Flushing Redis Memory Buffers...');
        execSync('redis-cli flushall', { stdio: 'ignore' });
    } catch (e) {
        console.error('[⚠️] Failed to flush Redis.');
    }
    try {
        if (os.platform() === 'linux') {
            console.error('[☠️] Detaching eBPF GUILLOTINE Probes...');
            const defaultIntf = execSync("ip route show default | awk '/default/ {print $5}'").toString().trim() || 'eth0';
            execSync(`sudo ip link set dev ${defaultIntf} xdpgeneric off`, { stdio: 'ignore' });
            execSync('sudo rm -f /sys/fs/bpf/bayezid_blocklist', { stdio: 'ignore' });
            execSync('sudo rm -f /sys/fs/bpf/bayezid_neural_weights', { stdio: 'ignore' });
        }
    } catch (e) {
        console.error('[⚠️] Failed to detach eBPF probes.');
    }
    try {
        console.error('[☠️] Engaging Telegram Emergency Alert...');
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (token && chatId) {
            const msg = "🚨 FATAL: THE KILL SWITCH HAS BEEN ENGAGED. BAYEZID SWARM TERMINATED.";
            execSync(`curl -s -X POST https://api.telegram.org/bot${token}/sendMessage -d chat_id=${chatId} -d text="${encodeURIComponent(msg)}"`, { stdio: 'ignore' });
        }
    } catch (e) {
        console.error('[⚠️] Failed to send Telegram alert.');
    }
    console.error('[☠️] Terminating Process Group (SIGKILL). Goodbye.');
    process.kill(-process.pid, 'SIGKILL');
};
module.exports = { activateKillSwitch };
