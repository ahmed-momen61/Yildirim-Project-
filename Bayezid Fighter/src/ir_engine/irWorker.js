const { Worker } = require('@temporalio/worker');
const path = require('path');
const activities = require('./irActivities'); 
const runWorker = async () => {
    console.log('[🛡️] Booting Bayezid Temporal IR Worker...');
    const worker = await Worker.create({
        workflowsPath: path.resolve(__dirname, 'irWorkflow.ts'),
        activities,
        taskQueue: 'bayezid-ir',
    });
    console.log('[🛡️] Temporal Worker Listening on Task Queue: bayezid-ir');
    await worker.run();
}
if (require.main === module) {
    runWorker().catch(err => {
        console.error('[-] Worker Error:', err);
        process.exit(1);
    });
}
module.exports = { runWorker };
