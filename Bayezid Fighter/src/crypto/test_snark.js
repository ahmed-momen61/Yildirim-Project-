const { veritasChain, proofGenerationQueue } = require('./veritasProof.js');

async function run() {
    console.log("Waiting for poseidon to initialize...");
    await new Promise(r => setTimeout(r, 1000));

    console.log("Adding mock decision to veritas chain...");
    
    veritasChain.recordDecision("MOCK_DECISION", { target: "192.168.1.100", action: "isolate" }, { operator: "TEST_OPERATOR", roeTokenSecret: "TEST_SECRET" });

    
    await new Promise(r => setTimeout(r, 5000));
    
    console.log("\nVerifying chain...");
    const status = veritasChain.getStatus();
    console.dir(status, { depth: null });
    
    process.exit(0);
}

run();
