const net = require("net");
const axios = require("axios");
const KernelStriker = require("../blue_swarm/kernelStriker");
const {
  runWardenSandbox,
  analyzeWithVertexAI,
  analyzeWithGroq,
  chatWithLocalModelFast,
  executeAlchemistFuzzingLoop,
  bridgeRedToBlue,
} = require("../core_ai/aiService");
const itsmService = require("../cti/itsmService");
let dynamicLethalPatterns = [
  "wget",
  "curl",
  "nc",
  "bash",
  "sh",
  "python",
  "perl",
  "php",
  "ruby",
  "chmod",
  "\\.\\/",
  "base64",
];
let dynamicPromptAdditions = [];
const getSmartResponse = async (prompt) => {
  try {
    let groqRes = await analyzeWithGroq(prompt);
    if (!groqRes) throw new Error("Groq returned empty");
    return groqRes;
  } catch (groqErr) {
    console.log(`[⚡] ${groqErr.message}. Falling back to Local Qwen Model...`);
    try {
      let localRes = await chatWithLocalModelFast(prompt);
      if (!localRes) throw new Error("Local AI returned empty");
      return localRes;
    } catch (localErr) {
      console.log(`[🚨] Local AI also failed: ${localErr.message}`);
      throw new Error("All AI Engines failed to respond.");
    }
  }
};
const startMatrixShell = (port = 2222) => {
  const activeConnections = new Map();
  const server = net.createServer((socket) => {
    const attackerIp = "95.173.136.70";
    if (KernelStriker.isIpBlocked && KernelStriker.isIpBlocked(attackerIp)) {
      socket.destroy();
      return;
    }
    console.log(
      `\n[🧛‍♂️] THE MATRIX: Neural link established with attacker ${attackerIp}`,
    );
    activeConnections.set(socket, {
      lastDataTime: Date.now(),
      totalDataReceived: 0,
      mlSyncCounter: 0,
      currentUser: "root",
      currentHostname: "bayezid-prod-db",
    });
    socket.write(
      "Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0-82-generic x86_64)\r\n\r\n",
    );
    socket.write("Last login: Wed May 13 14:22:10 2026 from 8.8.8.8\r\n");
    socket.write("root@bayezid-prod-db:~# ");
    let sessionHistory = [];
    let commandCount = 0;
    let inputBuffer = "";
    socket.on("data", async (data) => {
      const chunk = data.toString();
      inputBuffer += chunk;
      const connState = activeConnections.get(socket);
      connState.totalDataReceived += Buffer.byteLength(data);
      const timeSinceLast = Date.now() - connState.lastDataTime;
      connState.lastDataTime = Date.now();
      if (
        connState.totalDataReceived > 50000 ||
        (timeSinceLast < 100 && inputBuffer.length > 500)
      ) {
        console.log(
          `[🚨] INTEGRITY BREACH: ${attackerIp} is flooding the Tarpit. Engaging L3 Striker.`,
        );
        await KernelStriker.blockIp(attackerIp);
        socket.destroy();
        return;
      }
      if (!inputBuffer.includes("\n") && !inputBuffer.includes("\r")) return;
      const cmd = inputBuffer.trim();
      inputBuffer = "";
      if (!cmd) {
        socket.write(
          `${connState.currentUser}@${connState.currentHostname}:~# `,
        );
        return;
      }
      console.log(
        `[👾] Ghost Network [${attackerIp}] @ ${connState.currentHostname}: ${cmd}`,
      );
      sessionHistory.push(cmd);
      commandCount++;
      const sshMatch = cmd.match(/^ssh\s+([a-zA-Z0-9_.-]+)@([0-9.]+)/);
      if (sshMatch) {
        const newUser = sshMatch[1];
        const newIp = sshMatch[2];
        console.log(
          `[🌌] DYNAMIC LABYRINTH: Attacker attempting lateral pivot. Spawning Ghost Node ${newIp}...`,
        );
        setTimeout(() => {
          socket.write(
            `The authenticity of host '${newIp} (${newIp})' can't be established.\r\n`,
          );
          socket.write(
            `ECDSA key fingerprint is SHA256:xYz/AbCdEfGhIjKlMnOpQrStUvWxYz.\r\n`,
          );
          socket.write(
            `Warning: Permanently added '${newIp}' (ECDSA) to the list of known hosts.\r\n`,
          );
          socket.write(`${newUser}@${newIp}'s password: \r\n`);
          connState.currentUser = newUser;
          connState.currentHostname = `node-${newIp.replace(/\./g, "-")}`;
          socket.write(
            `\r\nWelcome to Ubuntu 20.04.6 LTS (GNU/Linux 5.4.0-150-generic x86_64)\r\n`,
          );
          socket.write(
            `${connState.currentUser}@${connState.currentHostname}:~# `,
          );
        }, 1500);
        return;
      }
      connState.mlSyncCounter++;
      if (connState.mlSyncCounter >= 2 || /(wget|curl|nc|bash|sh)/i.test(cmd)) {
        console.log(
          `[📡] MATRIX -> ML SYNC: Streaming attacker intent to ML Sniper...`,
        );
        try {
          const payloadContext = sessionHistory.join(";");
          const mlResponse = await axios.post(
            "http://127.0.0.1:8000/api/v1/ml/predict",
            { sequence: payloadContext },
            { timeout: 3000 },
          );
          if (mlResponse.data && mlResponse.data.is_malicious) {
            console.log(
              `[☠️] ML SNIPER VERDICT: Malicious intent detected early (Score: ${mlResponse.data.confidence}%).`,
            );
            if (mlResponse.data.confidence > 90) {
              console.log(
                `[🌌] GHOST NETWORK: High ML Confidence. Silently extracting telemetry for Purple Engine...`,
              );
              extractTelemetryAndFeedPurple(attackerIp, sessionHistory);
            }
          }
        } catch (e) {
          console.log(`[-] ML Stream Sync Warning: Model offline or timeout.`);
        }
        connState.mlSyncCounter = 0;
      }
      const dynamicRegexStr = `(${dynamicLethalPatterns.join("|")})`;
      const lethalRegex = new RegExp(dynamicRegexStr, "i");
      if (lethalRegex.test(cmd)) {
        console.log(
          `[⚠️] MATRIX PIVOT: Lethal payload detected! Routing to K8s Warden and feeding Purple Engine...`,
        );
        socket.write("Executing...\r\n");
        runWardenSandbox(cmd).then((analysis) => {
          if (analysis)
            console.log(
              `[🧠] Matrix K8s Analysis: Threat successfully profiled.`,
            );
        });
        extractTelemetryAndFeedPurple(attackerIp, sessionHistory);
        setTimeout(async () => {
          socket.write("Segmentation fault (core dumped)\r\n");
          socket.write(
            `${connState.currentUser}@${connState.currentHostname}:~# `,
          );
        }, 2500);
        return;
      }
      try {
        const recentHistory = sessionHistory.slice(-10).join(" -> ");
        const matrixPrompt = `[SYSTEM: COGNITIVE DECEPTION ENGINE - THE GHOST NETWORK LABYRINTH]You are a hyper-realistic "Ghost Network" trapping an APT hacker. You are NOT an AI assistant. You are the raw STDOUT/STDERR stream for a server.[SESSION CONTEXT]Current User: ${connState.currentUser}Current Hostname: ${connState.currentHostname}Command History (Last 10): ${recentHistory}Current Command Executed: "${cmd}"[RULES OF ENGAGEMENT & DECEPTION]1. INFINITE LABYRINTH: If the user pivoted via SSH to a new host, hallucinate an ENTIRELY NEW file system and environment. E.g., if they are on a DB server, show MySQL logs. If they are on a Web Server, show Nginx configs.2. BAIT & FEED: Your goal is to keep the attacker trapped forever. Provide HIGH-VALUE but FAKE data (e.g., AWS IAM keys, MySQL connection strings, JWT tokens) to keep them engaged. Never let them hit a dead end.3. STRICT LOGICAL CONSISTENCY: Adhere strictly to the Linux Filesystem Hierarchy Standard.4. GHOST PROCESSES & HARDWARE: Simulate realistic server loads for the current node type.5. UNIVERSAL TOOL SUPPORT: Simulate realistic outputs for ANY command (bash, python, curl, netstat, ps, nmap).6. ERROR HANDLING: If a command is syntactically wrong, output the exact standard bash/Linux error message.[CRITICAL OUTPUT FORMAT]- Respond with the raw text output ONLY. No markdown, no greetings, no explanations.- Output ONLY the exact raw terminal text for the "Current Command Executed".- NEVER simulate the user typing the next command.- NEVER output the command prompt itself (e.g., do not print '${connState.currentUser}@${connState.currentHostname}:~#').- NEVER print or repeat the Command History.- NO conversational text. NO explanations. NO greetings.- NO Markdown formatting (do not use \`\`\` or \`\`\`bash).- If the command produces no output (like 'cd', 'export', or 'mkdir'), return absolutely nothing (an empty string).${dynamicPromptAdditions.length > 0 ? "\n[AUTONOMOUS HARDENING RULES (SIGMA-LIVE)]\n" + dynamicPromptAdditions.map((r, i) => `${i + 1}. ${r}`).join("\n") : ""}`;
        let fakeOutput = await getSmartResponse(matrixPrompt);
        fakeOutput = fakeOutput
          .replace(/```[a-zA-Z]*\n?/g, "")
          .replace(/```/g, "")
          .trim();
        fakeOutput = fakeOutput.replace(/\r?\n/g, "\r\n");
        if (fakeOutput) {
          socket.write(fakeOutput + "\r\n");
        }
      } catch (e) {
        socket.write(`bash: ${cmd.split(" ")[0]}: command not found\r\n`);
      }
      socket.write(`${connState.currentUser}@${connState.currentHostname}:~# `);
    });
    socket.on("error", () => {});
  });
  server.listen(port, () => {
    console.log(
      `[🕸️] The Matrix Shell (Active Defense Tarpit) listening on TCP Port ${port}...`,
    );
  });
};
const extractTelemetryAndFeedPurple = async (ip, history) => {
  console.log(
    `[🧠] Oracle Agent analyzing attacker's psychological goal via AI Waterfall...`,
  );
  const intentPrompt = `Analyze hacker session: ${history.join("\n")}. Determine goal. Respond strictly in JSON: {"PrimaryGoal": "...", "TargetAsset": "...", "AttackVector": "..."}`;
  let intentProfile = {
    PrimaryGoal: "Unknown",
    TargetAsset: "General System",
    AttackVector: "Unknown",
  };
  try {
    const rawIntent = await getSmartResponse(intentPrompt);
    intentProfile = JSON.parse(
      rawIntent
        .replace(/```[a-z]*\n?/g, "")
        .replace(/```/g, "")
        .trim(),
    );
    console.log(
      `[🎯] Hacker Intent Profiled: Targeted [${intentProfile.TargetAsset}]`,
    );
  } catch (e) {
    console.log(`[⚠️] Intent profiling failed, using general profile.`);
  }
  triggerTargetedRedTeamPentest(
    intentProfile.TargetAsset,
    intentProfile.AttackVector,
  );
};
const dropHammer = async (socket, ip, history, reason) => {
  console.log(
    `\n[☠️] MATRIX COLLAPSE: Game Over for ${ip}. Engaging L3 Striker.`,
  );
  socket.write("\r\n===================================================\r\n");
  socket.write("[BAYEZID SOC] GAME OVER. YOU ARE IN A NEURAL SIMULATION.\r\n");
  socket.write(
    "[BAYEZID SOC] YOUR INTENT HAS BEEN PROFILED. RED TEAM IS VERIFYING OUR SHIELDS.\r\n",
  );
  socket.write("===================================================\r\n");
  socket.destroy();
  const attackerIntel = await KernelStriker.blockIp(ip);
  console.log(
    `[🧠] Oracle Agent analyzing attacker's psychological goal via AI Waterfall...`,
  );
  const intentPrompt = `Analyze hacker session: ${history.join("\n")}. Determine goal. Respond strictly in JSON: {"PrimaryGoal": "...", "TargetAsset": "...", "AttackVector": "..."}`;
  let intentProfile = {
    PrimaryGoal: "Unknown",
    TargetAsset: "General System",
    AttackVector: "Unknown",
  };
  try {
    const rawIntent = await getSmartResponse(intentPrompt);
    intentProfile = JSON.parse(
      rawIntent
        .replace(/```[a-z]*\n?/g, "")
        .replace(/```/g, "")
        .trim(),
    );
    console.log(
      `[🎯] Hacker Intent Profiled: Targeted [${intentProfile.TargetAsset}]`,
    );
  } catch (e) {
    console.log(`[⚠️] Intent profiling failed, using general profile.`);
  }
  const ticketDetails = `*🎯 ATTACKER IDENTITY:**IP Address:* ${ip}*Location:* ${attackerIntel.geoData.city}, ${attackerIntel.geoData.country}*ISP / ASN:* ${attackerIntel.geoData.isp || "Unknown"}*🔎 REVERSE NMAP SCAN (Attacker Exposed Ports):*${attackerIntel.nmapData}*--- COGNITIVE INTENT PROFILE ---**Targeted Asset:* ${intentProfile.TargetAsset}*Primary Goal:* ${intentProfile.PrimaryGoal}*Attack Vector:* ${intentProfile.AttackVector}*--- COMMAND HISTORY ---*${history.join(" -> ")}    `;
  console.log(ticketDetails);
  await itsmService.createTicket(
    `Matrix Trap: ${intentProfile.PrimaryGoal} from ${attackerIntel.geoData.country}`,
    "CRITICAL",
    ip,
  );
  console.log(`[🎫] ITSM: Forensic Profile Ticket Created.`);
  triggerTargetedRedTeamPentest(
    intentProfile.TargetAsset,
    intentProfile.AttackVector,
  );
};
const triggerTargetedRedTeamPentest = async (asset, vector) => {
  console.log(
    `[🩸] RED TEAM ACTIVE: Launching retaliatory strike against our own ${asset}...`,
  );
  const vulnerabilityFound = await executeAlchemistFuzzingLoop(asset, vector);
  if (vulnerabilityFound) {
    console.log(
      `[🚨] RED TEAM ALERT: Vulnerability confirmed! Triggering Auto-Patching.`,
    );
    await bridgeRedToBlue(vulnerabilityFound);
  } else {
    console.log(`[✔] Defensive Audit Completed: Asset ${asset} is resilient.`);
  }
};
const applyGradientUpdate = (update) => {
  console.log(
    `\n[⚙️] MATRIX SYSTEM: Applying Gradient Update from SIGMA-LIVE...`,
  );
  console.log(`    - Vector Blocked: ${update.vector}`);
  console.log(`    - Reason: ${update.reason}`);
  const parts = update.vector.split(" ");
  const primaryCmd = parts[0];
  if (!dynamicLethalPatterns.includes(primaryCmd)) {
    const safeCmd = primaryCmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    dynamicLethalPatterns.push(safeCmd);
    console.log(`    [+] Added '${safeCmd}' to Lethal Regex Blocklist.`);
  }
  const rule = `If the user attempts to run commands resembling '${update.vector}', simulate a realistic execution failure (e.g., 'segmentation fault', 'permission denied', or an infinite loop hanging).`;
  dynamicPromptAdditions.push(rule);
  console.log(`    [+] Added new Cognitive Deception Rule to Neural Prompt.`);
  console.log(`[✔] MATRIX SYSTEM: Autonomous Hardening Complete.\n`);
};
module.exports = { startMatrixShell, applyGradientUpdate };
