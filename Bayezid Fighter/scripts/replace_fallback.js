const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    content = content.replace(/llama3\.1:latest/g, 'qwen3.5:4b');
    content = content.replace(/qwen2\.5-coder:latest/g, 'qwen3.5:4b');
    content = content.replace(/llama-3\.1-8b-instant/g, 'qwen3.5:4b');

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    }
}

function walk(dir) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            if (file === 'node_modules' || file === '.git') return;
            walk(filePath);
        } else if (filePath.endsWith('.js')) {
            replaceInFile(filePath);
        }
    });
}

const targetDirs = [
    path.join(__dirname, '..', 'src', 'core_ai'),
    path.join(__dirname, '..', 'src', 'cti')
];

targetDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
        walk(dir);
    }
});
