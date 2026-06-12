const axios = require('axios');

class CausalRCA {
    constructor() {
        this.structuralPatches = {
            'UnrestrictedDockerSocket': 'chmod 660 /var/run/docker.sock',
            'ExposedSSHKey': 'rm -f /root/.ssh/id_rsa && ssh-keygen -t rsa -N "" -f /root/.ssh/id_rsa',
            'MissingContextWrappers': 'iptables -A INPUT -p tcp --dport 2222 -j DROP', 
            'HardcodedCredentials': 'export DB_PASSWORD=$(openssl rand -base64 32)'
        };
    }

    analyzeRootCause = async (attackOutcome, environmentState) => {
        console.log(`\n[🧠] CAUSAL RCA: Querying Python Causal Engine via HTTP...`);
        try {
            const verifyPayload = {
                action_type: 'ISOLATE_NODE',
                target_node: environmentState.targetNode || environmentState.compromisedNode || 'bayezid_digital_twin',
                service_dependency_events: environmentState.serviceDependencyEvents || [
                    { node: 'bayezid_digital_twin', is_critical: 1 }
                ]
            };
            const response = await axios.post('http://127.0.0.1:8002/api/v1/causal/verify-action', verifyPayload);
            const data = response.data;
            console.log(`[🛰️] Python Causal Engine response:`, data);
            
            const rootCause = data.root_cause || attackOutcome || 'Unknown';
            const structuralPatch = data.structural_patch || this.structuralPatches[rootCause] || 'echo "Manual patching required"';
            
            return {
                rootCause,
                structuralPatch,
                downtimeRisk: data.downtime_risk || 0,
                recommendation: data.recommendation || 'APPROVE'
            };
        } catch (error) {
            console.warn(`[⚠️] Failed to query Python Causal Engine: ${error.message}. Running degraded fallback...`);
            const possibleCauses = {
                'PrivilegeEscalation': 'UnrestrictedDockerSocket',
                'LateralPivot': 'ExposedSSHKey',
                'InitialAccess': 'WeakPassword',
                'Evasion': 'MissingContextWrappers'
            };
            const rootCause = possibleCauses[attackOutcome] || 'Unknown';
            const structuralPatch = this.structuralPatches[rootCause] || 'echo "Manual patching required"';
            return {
                rootCause,
                structuralPatch,
                downtimeRisk: 0.5,
                recommendation: 'APPROVE'
            };
        }
    };
}

module.exports = { CausalRCA };

