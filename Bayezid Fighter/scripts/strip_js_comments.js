const fs = require('fs');
const path = require('path');
const strip = require('strip-comments');

function stripCommentsFromFile(filePath) {
    try {
        const originalContent = fs.readFileSync(filePath, 'utf8');
        const strippedContent = strip(originalContent);
        if (originalContent !== strippedContent) {
            fs.writeFileSync(filePath, strippedContent, 'utf8');
            console.log(`Stripped comments from: ${filePath}`);
        }
    } catch (e) {
        console.error(`Failed to strip comments from ${filePath}: ${e.message}`);
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
            stripCommentsFromFile(filePath);
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
        console.log(`Scanning JS files in: ${dir}`);
        walkDir(dir);
    }
});
console.log('JS comment stripping complete.');
