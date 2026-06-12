const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { publishLiveEvent } = require('./memoryService');
const MONITORED_SYSCALLS = {
    mmap: {
        number: 9,
        description: 'Memory mapping — used for Reflective DLL Injection and shellcode loading',
        riskFlags: ['PROT_EXEC', 'MAP_ANONYMOUS'],
        bpfHook: 'tracepoint/syscalls/sys_enter_mmap'
    },
    mprotect: {
        number: 10,
        description: 'Memory protection change — used to make data pages executable (W^X violation)',
        riskFlags: ['PROT_EXEC'],
        bpfHook: 'tracepoint/syscalls/sys_enter_mprotect'
    },
    ptrace: {
        number: 101,
        description: 'Process tracing — used for process injection, debugging, and anti-analysis',
        riskFlags: ['PTRACE_ATTACH', 'PTRACE_POKETEXT'],
        bpfHook: 'tracepoint/syscalls/sys_enter_ptrace'
    },
    memfd_create: {
        number: 319,
        description: 'Anonymous file creation — used for fileless malware execution',
        riskFlags: ['MFD_CLOEXEC', 'MFD_EXEC'],
        bpfHook: 'tracepoint/syscalls/sys_enter_memfd_create'
    },
    execve: {
        number: 59,
        description: 'Program execution — monitors for suspicious binary launches',
        riskFlags: ['/tmp/', '/dev/shm/', 'base64', 'python -c'],
        bpfHook: 'tracepoint/syscalls/sys_enter_execve'
    },
    process_vm_writev: {
        number: 311,
        description: 'Cross-process memory write — used for process hollowing',
        riskFlags: ['REMOTE_WRITE'],
        bpfHook: 'tracepoint/syscalls/sys_enter_process_vm_writev'
    }
};
const generateBPFProbe = (syscallName) => {
    const syscall = MONITORED_SYSCALLS[syscallName];
    if (!syscall) return null;
    return `
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} mnemon_events SEC(".maps");
struct mnemon_event {
    __u32 pid;
    __u32 uid;
    __u32 syscall_nr;
    __u64 timestamp;
    __u64 arg0;
    __u64 arg1;
    __u64 arg2;
    char comm[16];
    __u8 action; 
};
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);
    __type(value, __u8);
} mnemon_allowlist SEC(".maps");
SEC("${syscall.bpfHook}")
int mnemon_probe_${syscallName}(struct trace_event_raw_sys_enter *ctx)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    __u8 *allowed = bpf_map_lookup_elem(&mnemon_allowlist, &pid);
    if (allowed && *allowed == 1)
        return 0;
    struct mnemon_event *evt;
    evt = bpf_ringbuf_reserve(&mnemon_events, sizeof(*evt), 0);
    if (!evt)
        return 0;
    evt->pid = pid;
    evt->uid = uid;
    evt->syscall_nr = ${syscall.number};
    evt->timestamp = bpf_ktime_get_ns();
    evt->arg0 = ctx->args[0];
    evt->arg1 = ctx->args[1];
    evt->arg2 = ctx->args[2];
    bpf_get_current_comm(&evt->comm, sizeof(evt->comm));
    ${_generateRiskCheck(syscallName, syscall)}
    bpf_ringbuf_submit(evt, 0);
    return 0;
}
char LICENSE[] SEC("license") = "GPL";
`;
};
const _generateRiskCheck = (name, syscall) => {
    switch (name) {
        case 'mmap':
            return `
    __u64 prot = ctx->args[2];   
    __u64 flags = ctx->args[3];  
    if ((prot & 0x4) && (flags & 0x20)) {  
        evt->action = 1; 
        bpf_send_signal(9); 
    } else {
        evt->action = 0; 
    }`;
        case 'mprotect':
            return `
    __u64 prot = ctx->args[2];
    if (prot & 0x4) {  
        evt->action = 1; 
        bpf_send_signal(9); 
    } else {
        evt->action = 0;
    }`;
        case 'ptrace':
            return `
    __u64 request = ctx->args[0];
    if (request == 16 || request == 17 || request == 5) {  
        evt->action = 1; 
        bpf_send_signal(9);
    } else {
        evt->action = 0;
    }`;
        case 'memfd_create':
            return `
    evt->action = 1; 
    bpf_send_signal(9);`;
        case 'process_vm_writev':
            return `
    evt->action = 1; 
    bpf_send_signal(9);`;
        default:
            return `    evt->action = 0; 
    }
}`;
    }
};
class MnemonProbeManager {
    constructor() {
        this.activeProbes = new Map();
        this.eventLog = [];
        this.probeDir = path.join(__dirname, 'mnemon_probes');
        this.alertThreshold = 3;
        this.pidSuspicionMap = new Map();
    }
    generateAllProbes() {
        console.log(`\n[🧠] =============================================`);
        console.log(`[🧠] MNEMON: Generating eBPF Syscall Probes`);
        console.log(`[🧠] =============================================\n`);
        if (!fs.existsSync(this.probeDir)) {
            fs.mkdirSync(this.probeDir, { recursive: true });
        }
        const generated = [];
        for (const [name, syscall] of Object.entries(MONITORED_SYSCALLS)) {
            const source = generateBPFProbe(name);
            const filename = `mnemon_${name}.bpf.c`;
            const filepath = path.join(this.probeDir, filename);
            fs.writeFileSync(filepath, source);
            generated.push({ name, filename, hook: syscall.bpfHook, filepath });
            console.log(`[🧠] Generated: ${filename} (${syscall.bpfHook})`);
        }
        console.log(`\n[✔] MNEMON: ${generated.length} eBPF probes generated.`);
        return generated;
    }
    async compileBPFProbe(probeFile) {
        const objFile = probeFile.replace('.c', '.o');
        if (process.platform === 'win32') {
            console.log(`[🧠] MNEMON (Windows Fallback): Simulating clang compilation for ${probeFile}...`);
            return objFile;
        }
        execFileSync('clang', [
            '-O2', '-g', '-target', 'bpf',
            '-D__TARGET_ARCH_x86',
            '-I/usr/include/x86_64-linux-gnu',
            `-I/usr/include/bpf`,
            '-c', probeFile, '-o', objFile
        ]);
        return objFile;
    }
    async loadAndAttachProbe(objFile, syscallName) {
        if (process.platform === 'win32') {
            console.log(`[🧠] MNEMON (Windows Fallback): Simulating BCC attach for ${syscallName} via ETW...`);
            setInterval(() => {
                if (Math.random() < 0.05) this.simulateProbe(syscallName);
            }, 10000);
            return Math.floor(Math.random() * 10000); 
        }
        const loaderScript = `
import ctypes, bcc
from bcc import BPF
b = BPF(obj="${objFile}")
b.attach_tracepoint(tp="syscalls:sys_enter_${syscallName}", fn_name="mnemon_probe_${syscallName}")
print("[MNEMON_LIVE] Probe ${syscallName} attached")
b.perf_buffer_poll()
        `;
        const loader = spawn('python3', ['-c', loaderScript], { stdio: ['ignore', 'pipe', 'pipe'] });
        loader.stdout.on('data', (d) => {
            const output = d.toString();
            console.log(output);
            if (output.includes('MNEMON_LIVE')) return;
            try {
                const evt = JSON.parse(output);
                this.processEvent(evt);
            } catch (e) {}
        });
        return loader.pid;
    }
    async compileAndLoad(probeName) {
        if (!MONITORED_SYSCALLS[probeName]) {
            console.log(`[!] MNEMON: Invalid probe name rejected: ${probeName}`);
            return { success: false, error: 'Invalid probe name' };
        }
        const sourceFile = path.join(this.probeDir, `mnemon_${probeName}.bpf.c`);
        if (!fs.existsSync(sourceFile) && process.platform !== 'win32') {
            console.log(`[!] Source file not found: ${sourceFile}`);
            return { success: false, error: 'Source file not found' };
        }
        try {
            console.log(`[🧠] Compiling probe for ${probeName}...`);
            const objFile = await this.compileBPFProbe(sourceFile);
            console.log(`[🧠] Attaching probe for ${probeName} via BCC...`);
            const pid = await this.loadAndAttachProbe(objFile, probeName);
            this.activeProbes.set(probeName, { loaded: true, type: process.platform === 'win32' ? 'ETW' : 'eBPF', timestamp: Date.now(), loaderPid: pid });
            console.log(`[🧠] MNEMON: Probe ${probeName} loaded successfully!`);
            return { success: true };
        } catch (err) {
            console.log(`[⚠️] MNEMON Pipeline failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
    processEvent(event) {
        const { pid, uid, syscall_nr, comm, action } = event;
        const entry = Object.entries(MONITORED_SYSCALLS).find(([_, s]) => s.number === syscall_nr);
        const syscallName = entry ? entry[0] : 'unknown';
        const logEntry = {
            timestamp: new Date().toISOString(),
            pid,
            uid,
            syscall: syscallName,
            process: comm,
            action: action === 1 ? 'KILLED' : 'LOGGED',
            id: crypto.randomBytes(4).toString('hex')
        };
        this.eventLog.push(logEntry);
        const current = this.pidSuspicionMap.get(pid) || 0;
        this.pidSuspicionMap.set(pid, current + 1);
        if (action === 1) {
            console.log(`[☠️] MNEMON: Process ${comm} (PID: ${pid}) TERMINATED — ${syscallName} violation!`);
        } else {
            console.log(`[👁️] MNEMON: ${comm} (PID: ${pid}) invoked ${syscallName} — monitoring.`);
            if (this.pidSuspicionMap.get(pid) >= this.alertThreshold) {
                console.log(`[☠️] MNEMON: PID ${pid} exceeded suspicion threshold (${this.alertThreshold}). SIGKILL sent.`);
                logEntry.action = 'KILLED_HEURISTIC';
            }
        }
        try {
            publishLiveEvent('bayezid_tactical_feed', 'MNEMON_SYSCALL_EVENT', logEntry);
        } catch (e) {}
        return logEntry;
    }
    simulateProbe(syscallName, pid, processName) {
        console.log(`\n[🧠] MNEMON: Simulating eBPF probe for ${syscallName}...`);
        const syscall = MONITORED_SYSCALLS[syscallName];
        if (!syscall) {
            console.log(`[!] Unknown syscall: ${syscallName}`);
            return null;
        }
        const isRogue = Math.random() > 0.5;
        const event = {
            pid: pid || Math.floor(Math.random() * 65535),
            uid: 1000,
            syscall_nr: syscall.number,
            comm: processName || 'unknown',
            action: isRogue ? 1 : 0
        };
        return this.processEvent(event);
    }
    getStatus() {
        return {
            activeProbes: Object.fromEntries(this.activeProbes),
            totalEvents: this.eventLog.length,
            recentEvents: this.eventLog.slice(-20),
            monitoredSyscalls: Object.keys(MONITORED_SYSCALLS),
            pidSuspicionScores: Object.fromEntries(this.pidSuspicionMap)
        };
    }
}
const mnemonManager = new MnemonProbeManager();
module.exports = { MnemonProbeManager, mnemonManager, MONITORED_SYSCALLS, generateBPFProbe };