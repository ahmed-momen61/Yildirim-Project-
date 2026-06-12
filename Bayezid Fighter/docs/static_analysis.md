# 📊 Bayezid SOAR Environment V1.0 (Apex Edition) - Static Analysis

## Project Overview
The Bayezid Hybrid SOC Environment is an advanced, autonomous Security Orchestration, Automation, and Response (SOAR) engine. It is designed to operate seamlessly across cloud intelligence (Gemini/Groq) and local air-gapped machine learning (Ollama/Qwen). It features a 17-agent Swarm AI, multi-agent reinforcement learning, and ring-0 packet execution.

## 🗂️ Codebase Metrics
*   **Total Backend JS Files:** 157 files
*   **Total Frontend JS/JSX Files:** 72 files
*   **Total Python ML Engine Files:** 8 files (LoRA, PPO, FGSM, GNN, LLVM)
*   **Total C/eBPF Files:** 2 files (`xdp_striker.c`, `ebpf_neural_net.c`)
*   **Total API Endpoints:** 84
*   **Database Schema:** Prisma ORM (PostgreSQL)

## 🧠 The Neural Architecture (Phase 10)

1.  **Continuous Q-Learning (The Digital Twin):**
    *   `warGamesRL.js`: A specialized environment where AI agents autonomously simulate zero-day attacks (e.g., eBPF buffer overflows, LLVM-IR mutation) millions of times to generate novel exploit strategies before they happen in reality.
2.  **eBPF Neural Execution Engine (NEE):**
    *   `ebpf_neural_net.c`: A ring-0 perceptron that performs highly restricted tensor math (hard-sigmoid) directly on packet features. It operates at microsecond speeds, dropping malicious network packets via `XDP_DROP` without interacting with the OS firewall.
3.  **The Swarm Hive Mind (Federated MARL):**
    *   `swarmHiveMind.js`: A decentralized, UDP/TCP Gossip protocol that allows disparate Bayezid SOC instances globally to share neural weight updates instantly when a new zero-day is discovered.
4.  **The Wingman's Master-Class (DPO):**
    *   `bayezidBrain.js` & `massive_swarm_training_v2.js`: The central intelligence dataset contains over **159,000 highly specialized vectors**. The Wingman has been optimized via Direct Preference Optimization (DPO) on 40,000 AST/CLI surgery loops.

## 🤖 The 17-Agent Swarm Registry

| Agent Name | Role & Domain Focus |
| :--- | :--- |
| **The Wingman** | Chief Copilot. AST Code Surgery, Operator Chat, DPO. |
| **Scout** | Reconnaissance & port footprinting. |
| **Breacher** | Exploit synthesis & initial access. |
| **Phantom** | Evasion, log scrubbing, Adversarial ML (FGSM). |
| **Chameleon** | Dynamic payload polymorphism (LLVM-IR). |
| **ZeroDayForge** | Autonomous exploit generation against memory scanners. |
| **Alchemist** | Cognitive protocol fuzzing & state mutation. |
| **Mirage** | Deception networks & honeypot deployment. |
| **ShadowRouter** | Covert eBPF network tunneling. |
| **ForensicRCA** | Constraint-based causal discovery DAGs. |
| **Overlord** | Swarm supervision & tactical coordination. |
| **Action** | Playbook and response logic execution. |
| **Scribe / StealthScribe**| Forensic reporting / Covert intelligence documentation. |
| **Auditor** | Remediation code review & auto-patching. |
| **Veto** | AI Ethics, Operations Security (OPSEC) safety gating. |
| **Warden** | Kubernetes sandbox escape vector profiling. |

## ⚡ Waterfall Fallback Resilience
The Wingman API pipeline features an impenetrable **Waterfall Resilience Architecture**:
1.  **Google Gemini 2.0 Flash:** Primary Intelligence (Retries with Exponential Backoff: 4s, 8s, 12s on Quota/429 errors).
2.  **Groq API (llama3-70b):** Secondary Failover.
3.  **Local AI (Ollama qwen2.5-coder:7b):** Air-gapped absolute fallback (Sanitizes metadata to prevent `400 Bad Request` errors).
