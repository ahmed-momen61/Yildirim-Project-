const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let errors = 0;

function checkSyntax(filePath) {
    try {
        execSync(`node --check "${filePath}"`, { stdio: 'ignore' });
    } catch (e) {
        console.error(`Syntax Error in: ${filePath}`);
        errors++;
    }
}

function walkDir(dir) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            if (file === 'node_modules' || file === '.git') return;
            walkDir(filePath);
        } else if (filePath.endsWith('.js')) {
            checkSyntax(filePath);
        }
    });
}

const targetDirs = [
    path.join(__dirname, '..', 'src'),
    path.join(__dirname, '..', 'scripts'),
    path.join(__dirname, '..', 'broker')
];

targetDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
        walkDir(dir);
    }
});

if (errors === 0) {
    console.log("Syntax Sweep Complete: No syntax errors found in JS files.");
} else {
    console.log(`Syntax Sweep Complete: ${errors} errors found.`);
    process.exit(1);
}
