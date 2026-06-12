const { exec } = require("child_process");
const os = require("os");
const axios = require("axios");
const util = require("util");
const path = require("path");
const fs = require("fs");
const execPromise = util.promisify(exec);
const zmq = require("zeromq");

const zmqPub = new zmq.Publisher();
zmqPub.bindSync("tcp://127.0.0.1:5556");
console.log("[🛡️] KERNEL STRIKER: Bound ZMQ PUB Socket on tcp://127.0.0.1:5556");
const validateIP = (ip) => {
  try {
    if (typeof ip !== "string") return false;
    if (/[;|&$`><()]/.test(ip)) throw new Error(`INVALID_IP_REJECTED: ${ip}`);
    const ipv4 =
      /^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/;
    if (!ipv4.test(ip)) throw new Error(`INVALID_IP_REJECTED: ${ip}`);
    const parts = ip.split(".").map(Number);
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    ) {
      throw new Error(`SELF_LOCKOUT_PREVENTED: RFC-1918/loopback IP ${ip}`);
    }
    return true;
  } catch (e) {
    console.error(`[🛑] IP Validation Failed: ${e.message}`);
    return false;
  }
};
const ttlRegistry = new Map();
const BLOCK_DURATION_MS = 24 * 60 * 60 * 1000;
const platform = os.platform();
let ebpfInitialized = false;
let defaultInterface = "eth0";
const ipToHex = (ip) => {
  return ip
    .split(".")
    .map((octet) => parseInt(octet, 10).toString(16).padStart(2, "0"))
    .join(" ");
};
const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Recon Timeout")), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timeoutId),
  );
};
const getDefaultInterface = async () => {
  try {
    const { stdout } = await execPromise(
      "ip route show default | awk '/default/ {print $5}'",
    );
    const intf = stdout.trim();
    return intf || "eth0";
  } catch (e) {
    return "eth0";
  }
};
const initEBPF = async () => {
  if (platform !== "linux") return;
  try {
    defaultInterface = await getDefaultInterface();
    console.log(
      `\n[⚙️] EBPF INIT: Forging xdp_striker.c and targeting NIC [${defaultInterface}]...`,
    );
    const ebpfPath = path.join(__dirname, "ebpf_module", "xdp_striker.c");
    const objPath = path.join(__dirname, "ebpf_module", "xdp_striker.o");
    if (!fs.existsSync(ebpfPath)) {
      console.log(
        `[⚠️] EBPF file not found at ${ebpfPath}. Falling back to iptables/ufw.`,
      );
      return;
    }
    await execPromise(`clang -O2 -target bpf -c "${ebpfPath}" -o "${objPath}"`);
    await execPromise(
      `sudo ip link set dev ${defaultInterface} xdpgeneric off`,
    ).catch(() => {});
    await execPromise(`sudo rm -f /sys/fs/bpf/bayezid_blocklist`).catch(
      () => {},
    );
    await execPromise(
      `sudo ip link set dev ${defaultInterface} xdpgeneric obj "${objPath}" sec xdp_drop`,
    );
    await execPromise(
      `sudo bpftool map pin name blocklist /sys/fs/bpf/bayezid_blocklist`,
    ).catch((e) => {
      console.log(`[⚠️] Map pinning bypassed (already pinned or unsupported).`);
    });
    console.log(
      `[🟢] EBPF GUILLOTINE LOADED on ${defaultInterface}. L3 Zero-latency drop active.`,
    );
    ebpfInitialized = true;
  } catch (error) {
    console.error(
      `[⚠️] EBPF Initialization Failed. Falling back to native OS Firewall. Error:`,
      error.message,
    );
    ebpfInitialized = false;
  }
};
const traceAttackerAsync = async (ip) => {
  if (!validateIP(ip)) {
    console.error(`[🛑] REJECTED: Invalid IP "${ip}" in traceAttackerAsync.`);
    return null;
  }
  console.log(
    `[🔍] COUNTER-RECON: Initiating Reverse OSINT on ${ip} (Running in background)...`,
  );
  const geoPromise = axios
    .get(
      `http://ip-api.com/json/${ip}?fields=status,country,city,isp,as,proxy`,
      { timeout: 3000 },
    )
    .then((res) => res.data)
    .catch(() => ({ status: "fail", error: "GeoIP Failed" }));
  const nmapCommand = `nmap -Pn -F -T4 ${ip} | grep open || echo "No open ports found"`;
  const nmapPromise = execPromise(nmapCommand)
    .then(({ stdout }) => stdout.trim())
    .catch(() => "Nmap Failed");
  const [geo, ports] = await Promise.allSettled([
    withTimeout(geoPromise, 3000),
    withTimeout(nmapPromise, 5000),
  ]);
  const intel = {
    geo: geo.status === "fulfilled" ? geo.value : geo.reason,
    open_ports: ports.status === "fulfilled" ? ports.value : ports.reason,
  };
  console.log(`[📊] COUNTER-RECON COMPLETE for ${ip}:`, JSON.stringify(intel));
  return intel;
};
let ttlIntervalId = null;

const KernelStriker = {
  blockIp: async (ip) => {
    if (!validateIP(ip)) {
      console.error(`[🛑] REJECTED: Invalid IP "${ip}" in blockIp.`);
      return { blocked: false, reason: "invalid_ip" };
    }
    let cmd = "";
    console.log(
      `\n[⚡] STRIKE ORDER: Preparing to execute ${ip} at Kernel Level...`,
    );
    if (platform === "linux") {
      if (ebpfInitialized) {
        const hexIp = ipToHex(ip);
        cmd = `sudo bpftool map update pinned /sys/fs/bpf/bayezid_blocklist key hex ${hexIp} value hex 01 00 00 00`;
        console.log(`[🔪] GUILLOTINE PROTOCOL: Dropping via eBPF Map Update`);
      } else {
        cmd = `sudo iptables -A INPUT -s ${ip} -j DROP`;
      }
    } else if (platform === "win32") {
      cmd = `powershell.exe -Command "New-NetFirewallRule -DisplayName 'Bayezid_Drop_${ip}' -Direction Inbound -Action Block -RemoteAddress ${ip}"`;
    } else {
      console.log(
        `[🛡️] OS Striker: OS ${platform} not explicitly supported for blocking yet.`,
      );
    }
    try {
      if (cmd) {
        await execPromise(cmd);
        console.log(
          `[☠️] KINETIC EXECUTION: IP ${ip} eradicated at Network Layer L3 (${platform.toUpperCase()}).`,
        );
        ttlRegistry.set(ip, Date.now());
      }
      
      zmqPub.send(["BLOCK_IP", JSON.stringify({ ip })]);
      console.log(`[⚡] ZMQ PUB: Broadcasted BLOCK_IP command for ${ip} to native enforcers`);
      
    } catch (err) {
      console.error(
        `[⚠️] Striker Error blocking ${ip} on ${platform}:`,
        err.message,
      );
    }
    traceAttackerAsync(ip).catch((e) => console.error("Recon error", e));
    return {
      blocked: true,
      method: ebpfInitialized ? "eBPF" : "Firewall",
      timestamp: Date.now(),
    };
  },
  unblockIp: (ip) => {
    if (!validateIP(ip)) {
      console.error(`[🛑] REJECTED: Invalid IP "${ip}" in unblockIp.`);
      return;
    }
    let cmd = "";
    if (platform === "linux") {
      if (ebpfInitialized) {
        const hexIp = ipToHex(ip);
        cmd = `sudo bpftool map delete pinned /sys/fs/bpf/bayezid_blocklist key hex ${hexIp}`;
      } else {
        cmd = `sudo iptables -D INPUT -s ${ip} -j DROP`;
      }
    } else if (platform === "win32") {
      cmd = `powershell.exe -Command "Remove-NetFirewallRule -DisplayName 'Bayezid_Drop_${ip}'"`;
    }
    exec(cmd, (err) => {
      if (!err) {
        console.log(`[♻️] OS Striker: IP ${ip} unblocked. TTL expired.`);
        ttlRegistry.delete(ip);
      }
    });
  },
  startTtlDaemon: () => {
    initEBPF();
    ttlIntervalId = setInterval(
      () => {
        const now = Date.now();
        for (const [ip, timestamp] of ttlRegistry.entries()) {
          if (now - timestamp >= BLOCK_DURATION_MS) {
            KernelStriker.unblockIp(ip);
          }
        }
      },
      60 * 60 * 1000,
    );
    console.log(
      `[🛡️] OS-Agnostic Striker TTL Daemon initialized on [${platform.toUpperCase()}].`,
    );
  },
  stopTtlDaemon: () => {
    if (ttlIntervalId) {
      clearInterval(ttlIntervalId);
      ttlIntervalId = null;
    }
    try {
      zmqPub.close();
    } catch(e) {}
  }
};
module.exports = KernelStriker;
