pragma circom 2.0.0;

include "../../../node_modules/circomlib/circuits/poseidon.circom";

// Decision Proof Circuit for Absolute Symphony / Veritas Audit
template DecisionProof() {
    // Private Inputs (The Secrets)
    signal input decisionPlaintext;
    signal input operatorId;
    signal input roeTokenSecret;
    
    // Public Inputs (The Hashes to verify against)
    signal input decisionHash;
    signal input operatorIdHash;
    signal input targetScopeHash;

    // Component instances
    component hashDecision = Poseidon(1);
    component hashOperator = Poseidon(1);
    component hashScope = Poseidon(2);

    // Compute decision hash and constrain
    hashDecision.inputs[0] <== decisionPlaintext;
    decisionHash === hashDecision.out;

    // Compute operator ID hash and constrain
    hashOperator.inputs[0] <== operatorId;
    operatorIdHash === hashOperator.out;

    // Compute target scope hash (combining token secret and operator) and constrain
    hashScope.inputs[0] <== roeTokenSecret;
    hashScope.inputs[1] <== operatorId;
    targetScopeHash === hashScope.out;
}

// In circom, inputs specified in the public array become the public inputs of the circuit.
component main {public [decisionHash, operatorIdHash, targetScopeHash]} = DecisionProof();
