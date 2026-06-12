# Security Policy for Bayezid Hybrid SOC Environment

Security is the foundational pillar of the Bayezid Hybrid SOC Environment. As an advanced Cognitive SOC Orchestrator designed to detect, analyze, and autonomously mitigate cyber threats, we hold our own architecture to the highest security standards. 

We take all security vulnerabilities seriously and appreciate the efforts of the cybersecurity community and researchers in keeping this project secure.

## Supported Versions

Currently, only the latest minor releases of the `0.3.x` branch receive active security updates and patches. 

| Version | Supported          | Notes |
| ------- | ------------------ | ----- |
| 0.3.x   | :white_check_mark: | Active Development & Security Patches (Current: V0.3.4) |
| 0.2.x   | :x:                | Deprecated. Please upgrade to 0.3.x |
| 0.1.x   | :x:                | Deprecated. Initial Proof of Concept |

## Reporting a Vulnerability

If you discover a security vulnerability within Bayezid, **please do not open a public issue.** Public disclosure puts the environment and its users at risk before a patch can be applied.

Instead, please report the vulnerability privately via email to the lead developer: aa2301532@tkh.edu.eg | ahmedmoamen2200@gmail.com

### What to include in your report:
To help us triage and resolve the issue quickly, please include:
1. **Description:** A clear description of the vulnerability and its potential impact.
2. **Steps to Reproduce:** A detailed proof-of-concept (PoC) or step-by-step guide to replicate the issue.
3. **Environment Details:** The Bayezid version, Node.js version, Python version, and whether Cloud AI or Local Fallback was active.
4. **Suggested Mitigation:** (Optional) Any insights on how to patch the vulnerability.

### Our Response SLA:
* **Acknowledgment:** You can expect an initial response acknowledging receipt of your report within **48 hours**.
* **Triage & Assessment:** We will confirm the vulnerability and provide an estimated timeline for the fix within **5 business days**.
* **Resolution:** Once patched, we will notify you and mention your contribution in the release notes (unless you prefer to remain anonymous).

---

## ⚠️ Project-Specific Security Scope

Given that Bayezid is a cybersecurity defense tool featuring intentional deception and dynamic execution, please note the following context before reporting:

### **In-Scope (Critical Vulnerabilities):**
* **Warden Sandbox Escapes:** Any method that allows a payload to break out of the isolated Docker environment (`runWardenSandbox`) and execute arbitrary code on the Host OS.
* **ML Model Poisoning:** Exploiting the Continuous Feedback Loop (`/api/v1/ml/feedback`) to successfully inject malicious persistence without triggering the Kinetic Filter or Warden verifications.
* **Bridge API Authentication Bypass:** Unauthorized access to the Blue/Red Team Bridge orchestration endpoints.
* **Prompt Injection / Jailbreaking:** Successfully manipulating the AI Agents (e.g., The Overlord, The Chameleon) to execute unintended, destructive shell commands on the host outside of the designated red-team scope.

### **Out-of-Scope (Not a Vulnerability):**
* **Interacting with Port 2222:** This is the **Cognitive Mirage Agent (High-Interaction Honeypot)**. It is *designed* to accept malicious input and fake an environment.
* **Phantom Stack Probes (Port 8080):** This is an anti-fingerprinting sinkhole. Unresponsiveness or deceptive banners here are intended behaviors.
* **Denial of Service (DoS) via Payload Spam:** Bayezid utilizes an In-Memory ML Hash Cache that drops redundant payloads in <0.01ms. Testing this with standard DoS tools is expected behavior, not a vulnerability.

## Responsible Disclosure
We ask that you do not share details of the vulnerability publicly or with third parties until a fix has been officially released. We are committed to working with security researchers to validate and patch issues safely.
