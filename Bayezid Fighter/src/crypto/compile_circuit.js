const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const run = (cmd) => {
    console.log(`\n[⚙️] Running: ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit', cwd: __dirname });
    } catch (e) {
        console.error(`[❌] Command failed: ${cmd}`);
        process.exit(1);
    }
};
const main = () => {
    const isWindows = os.platform() === 'win32';
    const circomBin = isWindows ? path.join(__dirname, 'bin', 'circom.exe') : path.join(__dirname, 'bin', 'circom');
    const snarkjsBin = isWindows ? path.join(__dirname, '../../node_modules', '.bin', 'snarkjs.cmd') : path.join(__dirname, '../../node_modules', '.bin', 'snarkjs');
    if (!fs.existsSync(path.join(__dirname, 'circuits'))) {
        fs.mkdirSync(path.join(__dirname, 'circuits'), { recursive: true });
    }
    run(`"${circomBin}" circuits/decision_proof.circom --r1cs --wasm --sym -o circuits/`);
    run(`"${snarkjsBin}" powersoftau new bn128 12 circuits/pot12_0000.ptau -v`);
    run(`"${snarkjsBin}" powersoftau contribute circuits/pot12_0000.ptau circuits/pot12_0001.ptau --name="First contribution" -v -e="random text"`);
    run(`"${snarkjsBin}" powersoftau prepare phase2 circuits/pot12_0001.ptau circuits/pot12_final.ptau -v`);
    run(`"${snarkjsBin}" groth16 setup circuits/decision_proof.r1cs circuits/pot12_final.ptau circuits/decision_proof_0000.zkey`);
    run(`"${snarkjsBin}" zkey contribute circuits/decision_proof_0000.zkey circuits/decision_proof_final.zkey --name="Second contribution" -v -e="random text 2"`);
    run(`"${snarkjsBin}" zkey export verificationkey circuits/decision_proof_final.zkey circuits/verification_key.json`);
    console.log('\n[✅] Phase 7 ZK-SNARK Circuit Compilation & Trusted Setup Complete!');
};
if (require.main === module) {
    main();
}
