const os = require('os');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const CIRCOM_VERSION = 'v2.1.9';
const BIN_DIR = path.join(__dirname, 'bin');
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
const getDownloadUrl = () => {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'win32') return `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-windows-amd64.exe`;
    if (platform === 'linux' && arch === 'arm64') return `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-linux-arm64`;
    if (platform === 'linux') return `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-linux-amd64`;
    if (platform === 'darwin' && arch === 'arm64') return `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-macos-arm64`;
    if (platform === 'darwin') return `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-macos-amd64`;
    throw new Error(`Unsupported platform: ${platform} ${arch}`);
};
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        console.log(`[⬇️] Downloading ${url}...`);
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download, status code: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`[✅] Download complete: ${dest}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
};
const setup = async () => {
    try {
        const url = getDownloadUrl();
        const ext = os.platform() === 'win32' ? '.exe' : '';
        const dest = path.join(BIN_DIR, `circom${ext}`);
        if (!fs.existsSync(dest)) {
            await downloadFile(url, dest);
            if (os.platform() !== 'win32') {
                fs.chmodSync(dest, 0o755); 
            }
        } else {
            console.log(`[✅] Circom binary already exists at ${dest}`);
        }
        console.log(`[✅] Setup complete. You can run circom using: ${dest}`);
    } catch (e) {
        console.error(`[❌] Setup failed: ${e.message}`);
    }
};
if (require.main === module) {
    setup();
}
