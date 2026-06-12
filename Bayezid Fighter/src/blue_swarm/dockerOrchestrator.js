const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const isolateAndReplace = async (containerName, baseImage) => {
    console.log(`\n[🐳 DOCKER HEAL] Initiating isolation and replacement pipeline for container: ${containerName}`);
    const timestamp = Date.now();
    const forensicImage = `forensics_${containerName}_${timestamp}`;
    const isolatedName = `isolated_${containerName}_${timestamp}`;
    
    const status = {
        success: false,
        containerName,
        forensicImage,
        isolatedName,
        newContainerId: null,
        logs: []
    };

    try {
        console.log(`[🐳 DOCKER HEAL] [1/4] Pausing container ${containerName}...`);
        await execPromise(`docker pause ${containerName}`);
        status.logs.push(`SUCCESS: Paused container ${containerName}`);

        console.log(`[🐳 DOCKER HEAL] [2/4] Committing forensic snapshot to ${forensicImage}...`);
        await execPromise(`docker commit ${containerName} ${forensicImage}`);
        status.logs.push(`SUCCESS: Created forensic snapshot image: ${forensicImage}`);

        console.log(`[🐳 DOCKER HEAL] [3/4] Renaming original container to ${isolatedName}...`);
        await execPromise(`docker rename ${containerName} ${isolatedName}`);
        status.logs.push(`SUCCESS: Renamed container to ${isolatedName}`);

        console.log(`[🐳 DOCKER HEAL] [4/4] Starting pristine container replacement using image ${baseImage}...`);
        const { stdout } = await execPromise(`docker run -d --name ${containerName} ${baseImage}`);
        status.newContainerId = stdout.trim();
        status.logs.push(`SUCCESS: Started replacement container (ID: ${status.newContainerId})`);
        
        status.success = true;
        console.log(`[🐳 DOCKER HEAL] SUCCESS: Container ${containerName} auto-healed and replaced. Forensic image: ${forensicImage}\n`);
    } catch (e) {
        console.error(`[🐳 DOCKER HEAL] PIPELINE CRITICAL ERROR:`, e.message);
        status.logs.push(`ERROR: ${e.message}`);
        
        try {
            console.log(`[🐳 DOCKER HEAL] Attempting cleanup: Unpausing original container ${containerName}...`);
            await execPromise(`docker unpause ${containerName}`);
        } catch (unpauseErr) {
            
        }
    }
    
    return status;
};

module.exports = {
    isolateAndReplace
};
