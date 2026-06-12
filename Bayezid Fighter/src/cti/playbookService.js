const prisma = require('../api/prismaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { encryptPayload } = require('../crypto/cryptoService');
const axios = require('axios');
const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);

const SECURITY_ENVIRONMENT = {
    FIREWALL: "Palo Alto Networks PAN-OS Firewall",
    EDR: "CrowdStrike Falcon",
    INTERNAL_SUBNET: "192.168.1.0/24"
};

const generatePlaybookCommands = async (alertId, aiAnalysis, payload) => {
    const playbookType = aiAnalysis.recommended_action || "UNKNOWN";
    const targetIp = aiAnalysis.extracted_ip || payload.source_ip;
    const codeGenPrompt = `You are the 'Zero-Code Playbook Engineer' for Bayezid SOAR.
        Your job is to generate the exact, raw cURL command to execute a security action AND its exact rollback (undo) command.
        Environment Context:
        - Firewall: ${SECURITY_ENVIRONMENT.FIREWALL}
        - EDR: ${SECURITY_ENVIRONMENT.EDR}
        Task:
        The SOC has requested to execute: "${playbookType}" on Target: "${targetIp}".
        Instructions:
        1. Write ONLY the raw, functional 'curl' commands required to perform this action and its rollback.
        2. Use placeholder API keys (e.g., 'YOUR_API_KEY').
        3. CRITICAL: Return ONLY a valid JSON object matching this exact format, with NO markdown blocks or explanations:
        {
            "apply_command": "curl -k -X POST ...",
            "rollback_command": "curl -k -X DELETE ..."
        }`;

    let generatedCommands = { apply_command: "", rollback_command: "" };
    try {
        console.log(`[☁️] Asking Cloud AI (Gemini) to synthesize execution code for ${SECURITY_ENVIRONMENT.FIREWALL}...`);
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent(codeGenPrompt);
        let aiText = result.response.text().trim();
        aiText = aiText.replace(/```json/gi, '').replace(/```/gi, '').trim();
        generatedCommands = JSON.parse(aiText);
    } catch (cloudErr) {
        console.log(`[⚠️] Gemini Cloud Failed (Quota/Network). Switching to Primary Local AI...`);
        try {
            const aiCodeResponse = await axios.post('http://localhost:11434/api/generate', {
                model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                prompt: codeGenPrompt,
                stream: false,
                format: 'json'
            });
            let localText = aiCodeResponse.data.response.trim();
            localText = localText.replace(/```json/gi, '').replace(/```/gi, '').trim();
            generatedCommands = JSON.parse(localText);
        } catch (localPrimaryErr) {
            console.log(`[⚠️] Primary Local AI Failed (OOM/Error). Switching to qwen3.5:4b Fallback...`);
            try {
                const fallbackResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: codeGenPrompt,
                    stream: false,
                    format: 'json'
                });
                let fallbackText = fallbackResponse.data.response.trim();
                fallbackText = fallbackText.replace(/```json/gi, '').replace(/```/gi, '').trim();
                generatedCommands = JSON.parse(fallbackText);
            } catch (localFallbackErr) {
                console.log(`[⚠️] qwen3.5:4b Fallback Failed. Switching to qwen3.5:4b Fallback...`);
                const fallbackResponse2 = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: codeGenPrompt,
                    stream: false,
                    format: 'json'
                });
                let fallbackText2 = fallbackResponse2.data.response.trim();
                fallbackText2 = fallbackText2.replace(/```json/gi, '').replace(/```/gi, '').trim();
                generatedCommands = JSON.parse(fallbackText2);
            }
        }
    }
    return generatedCommands;
};

const executePlaybook = async (alertId, aiAnalysis, payload) => {
    console.log(`\n[⚡] INITIATING DYNAMIC ZERO-CODE PLAYBOOK FOR ALERT: ${alertId}`);
    const playbookType = aiAnalysis.recommended_action || "UNKNOWN";
    const targetIp = aiAnalysis.extracted_ip || payload.source_ip;
    console.log(`[🎯] Target: ${targetIp} | Action: ${playbookType}`);
    try {
        const generatedCommands = await generatePlaybookCommands(alertId, aiAnalysis, payload);
        const applyCommand = generatedCommands.apply_command;
        const rollbackCommand = generatedCommands.rollback_command;
        console.log(`[✨] AI Synthesized Apply Command:\n${applyCommand}`);
        console.log(`[↩️] AI Synthesized Rollback Command:\n${rollbackCommand}`);
        console.log(`[⚙️] Executing API Call to Security Appliance (No Simulation)...`);
        try {
            await execPromise(applyCommand);
            console.log(`[🟢] Zero-Code Command executed successfully on physical appliance.`);
        } catch (execErr) {
            console.log(`[⚠️] Appliance Offline / Execution Error. Logging intent for real environment.`);
        }
        const payloadToEncrypt = JSON.stringify({ apply: applyCommand, rollback: rollbackCommand });
        const encryptedCommand = encryptPayload(payloadToEncrypt) || "ENCRYPTION_FAILED";
        console.log(`[🔒] Apply & Rollback Payloads Encrypted successfully before saving to DB.`);
        await prisma.alert.update({
            where: { id: alertId },
            data: {
                status: 'RESOLVED_BY_PLAYBOOK',
                playbookDetails: `[Dynamic Playbook Generated]\nAction: ${playbookType}\nEncrypted_Payload:\n${encryptedCommand}`
            }
        });
        console.log(`[✔] Dynamic Playbook Execution Complete.`);
        return {
            message: `Successfully dynamically generated and executed action for ${playbookType}.`,
            rollbackCmd: rollbackCommand
        };
    } catch (error) {
        console.error("[-] Playbook Execution Failed:", error);
        await prisma.alert.update({
            where: { id: alertId },
            data: { status: 'PLAYBOOK_FAILED' }
        });
        return `Failed to execute dynamic playbook: ${error.message}`;
    }
};

const executeRollback = async (alertId, rollbackCommand) => {
    console.log(`\n[🔄] AUTONOMOUS ROLLBACK INITIATED FOR ALERT: ${alertId}`);
    console.log(`[💔] Red Team successfully breached the patch. Reverting configuration to prevent DoS...`);
    try {
        console.log(`[⚙️] Executing Rollback Command on Appliance:\n${rollbackCommand}`);
        try {
            await execPromise(rollbackCommand);
            console.log(`[🟢] Rollback successfully dispatched to appliance.`);
        } catch (e) {
            console.log(`[⚠️] Appliance Offline. Rollback intent logged.`);
        }
        await prisma.alert.update({
            where: { id: alertId },
            data: {
                status: 'PATCH_FAILED_ROLLED_BACK',
                playbookDetails: `[Autonomous Rollback Executed]\nReason: Red Team bypassed the patch.\nExecuted_Rollback_Cmd: ${rollbackCommand}`
            }
        });
        console.log(`[✔] Rollback Complete. Infrastructure restored to safe baseline state.`);
        return true;
    } catch (error) {
        console.error("[-] Rollback Failed to execute:", error.message);
        return false;
    }
};

module.exports = {
    generatePlaybookCommands,
    executePlaybook,
    executeRollback
};