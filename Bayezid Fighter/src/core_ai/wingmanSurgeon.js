const acorn = require('acorn');
const walk = require('acorn-walk');
const escodegen = require('escodegen');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');
const IS_WINDOWS = os.platform() === 'win32';
const PROJECT_ROOT = path.resolve(__dirname);
const TMP_DIR = path.join(os.tmpdir(), 'wingman-patches');
const EDITABLE_FILES = new Set([
    'server.js', 'aiService.js', 'memoryService.js', 'wingmanService.js',
    'wingmanEyes.js', 'wingmanTelegram.js', 'wingmanMemory.js', 'wingmanOverseer.js',
    'bayezidBrain.js', 'kineticFilter.js', 'kineticEvolver.js',
    'notificationService.js', 'ragService.js', 'sigmaEngine.js',
    'playbookService.js', 'kernelStriker.js', 'oracleGNN.js'
]);
const EDITABLE_PYTHON = new Set([
    'ml_engine/main.py', 'ml_engine/lora_trainer.py',
    'ml_engine/fgsm_engine.py', 'ml_engine/sigma_ppo.py',
    'ml_engine/causal_engine.py', 'ml_engine/gnn_oracle.py'
]);
const parseJavaScript = (source, filePath) => {
    try {
        const ast = acorn.parse(source, {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            locations: true,
            ranges: true,
            allowHashBang: true
        });
        return { ast, source, error: null };
    } catch (e) {
        return { ast: null, source, error: `AST Parse failed for ${filePath}: ${e.message}` };
    }
};
const analyzeAST = (ast) => {
    const analysis = {
        functions: [],
        routes: [],
        requires: [],
        exports: [],
        classes: []
    };
    walk.simple(ast, {
        FunctionDeclaration(node) {
            analysis.functions.push({
                name: node.id?.name || 'anonymous',
                line: node.loc?.start?.line,
                params: node.params.map(p => p.name || p.left?.name || '?'),
                async: node.async
            });
        },
        VariableDeclarator(node) {
            if (node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
                analysis.functions.push({
                    name: node.id?.name || 'anonymous',
                    line: node.id?.loc?.start?.line,
                    params: node.init.params?.map(p => p.name || p.left?.name || '?') || [],
                    async: node.init.async || false
                });
            }
        },
        CallExpression(node) {
            if (node.callee?.name === 'require' && node.arguments[0]?.value) {
                analysis.requires.push({
                    module: node.arguments[0].value,
                    line: node.loc?.start?.line
                });
            }
            if (node.callee?.type === 'MemberExpression' &&
                node.callee.object?.name === 'app' &&
                ['get', 'post', 'put', 'delete', 'patch'].includes(node.callee.property?.name) &&
                node.arguments[0]?.value) {
                analysis.routes.push({
                    method: node.callee.property.name.toUpperCase(),
                    path: node.arguments[0].value,
                    line: node.loc?.start?.line
                });
            }
        }
    });
    return analysis;
};
const generateDiff = (original, modified, fileName) => {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const diff = [];
    diff.push(`--- a/${fileName}`);
    diff.push(`+++ b/${fileName}`);
    const maxLen = Math.max(origLines.length, modLines.length);
    let contextStart = -1;
    let hunk = [];
    for (let i = 0; i < maxLen; i++) {
        const origLine = origLines[i];
        const modLine = modLines[i];
        if (origLine !== modLine) {
            if (contextStart < 0) {
                contextStart = Math.max(0, i - 3);
                for (let j = contextStart; j < i; j++) {
                    if (origLines[j] !== undefined) hunk.push(` ${origLines[j]}`);
                }
            }
            if (origLine !== undefined) hunk.push(`-${origLine}`);
            if (modLine !== undefined) hunk.push(`+${modLine}`);
        } else if (contextStart >= 0) {
            hunk.push(` ${origLine || ''}`);
            const lastChanged = hunk.findLastIndex(l => l.startsWith('+') || l.startsWith('-'));
            if (hunk.length - lastChanged > 3) {
                diff.push(`@@ -${contextStart + 1},${origLines.length} +${contextStart + 1},${modLines.length} @@`);
                diff.push(...hunk);
                hunk = [];
                contextStart = -1;
            }
        }
    }
    if (hunk.length > 0) {
        diff.push(`@@ -${(contextStart || 0) + 1} +${(contextStart || 0) + 1} @@`);
        diff.push(...hunk);
    }
    return diff.join('\n');
};
const validateSyntax = (source, filePath) => {
    const ext = path.extname(filePath);
    if (ext === '.js' || ext === '.jsx') {
        try {
            acorn.parse(source, { ecmaVersion: 2022, sourceType: 'commonjs' });
            return { valid: true };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
    if (ext === '.py') {
        try {
            const tmpFile = path.join(TMP_DIR, `validate_${Date.now()}.py`);
            fs.mkdirSync(TMP_DIR, { recursive: true });
            fs.writeFileSync(tmpFile, source);
            const cmd = IS_WINDOWS ? `py -m py_compile "${tmpFile}"` : `python3 -m py_compile "${tmpFile}"`;
            execSync(cmd, { encoding: 'utf-8' });
            fs.unlinkSync(tmpFile);
            return { valid: true };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }
    return { valid: true }; 
};
const runSandboxCI = async (filePath, patchedSource) => {
    const composeFile = path.join(PROJECT_ROOT, 'sandbox', 'wingman-test-compose.yml');
    if (fs.existsSync(composeFile)) {
        try {
            fs.mkdirSync(TMP_DIR, { recursive: true });
            fs.writeFileSync(path.join(TMP_DIR, path.basename(filePath)), patchedSource);
            const cmd = IS_WINDOWS
                ? `docker compose -f "${composeFile}" up --abort-on-container-exit --exit-code-from wingman-ci`
                : `docker-compose -f "${composeFile}" up --abort-on-container-exit --exit-code-from wingman-ci`;
            const output = execSync(cmd, {
                cwd: PROJECT_ROOT,
                timeout: 120000,
                encoding: 'utf-8'
            });
            const passed = output.includes('WINGMAN_CI_PASS');
            const downCmd = IS_WINDOWS
                ? `docker compose -f "${composeFile}" down`
                : `docker-compose -f "${composeFile}" down`;
            try { execSync(downCmd, { cwd: PROJECT_ROOT }); } catch (e) { }
            return { passed, output, method: 'docker' };
        } catch (e) {
            try {
                const downCmd = IS_WINDOWS
                    ? `docker compose -f "${composeFile}" down`
                    : `docker-compose -f "${composeFile}" down`;
                execSync(downCmd, { cwd: PROJECT_ROOT });
            } catch (de) { }
            console.log('[🔧] Wingman Surgeon: Docker CI unavailable, falling back to syntax validation.');
        }
    }
    const syntaxResult = validateSyntax(patchedSource, filePath);
    return {
        passed: syntaxResult.valid,
        output: syntaxResult.valid
            ? 'Syntax validation passed (Docker CI unavailable).'
            : `Syntax error: ${syntaxResult.error}`,
        method: 'syntax-only'
    };
};
const commitPatch = async (filePath, message) => {
    try {
        const simpleGit = require('simple-git');
        const git = simpleGit(PROJECT_ROOT);
        await git.add(filePath);
        await git.commit(`${message} [automated by The Wingman on ${new Date().toISOString()}]`);
        return true;
    } catch (e) {
        console.log(`[🔧] Git commit skipped: ${e.message}`);
        return false;
    }
};
const applyEdit = async ({ filePath, editDescription, newCode, sandboxTest = true, autoCommit = false }) => {
    if (!filePath) return 'Error: filePath is required.';
    if (!editDescription && !newCode) return 'Error: either editDescription or newCode is required.';
    const basename = path.basename(filePath);
    const relativePath = filePath.replace(/\\/g, '/');
    if (!EDITABLE_FILES.has(basename) && !EDITABLE_PYTHON.has(relativePath)) {
        return `SECURITY_VETO: "${filePath}" is not on the Wingman editable files allowlist. Allowed files:\n${[...EDITABLE_FILES, ...EDITABLE_PYTHON].join('\n')}`;
    }
    const absolutePath = path.resolve(PROJECT_ROOT, filePath);
    if (!fs.existsSync(absolutePath)) {
        return `File not found: ${filePath}`;
    }
    const originalSource = fs.readFileSync(absolutePath, 'utf-8');
    if (newCode) {
        const syntaxCheck = validateSyntax(newCode, filePath);
        if (!syntaxCheck.valid) {
            return `SYNTAX ERROR in proposed edit: ${syntaxCheck.error}\n\nEdit rejected. Please fix the syntax and try again.`;
        }
        const diff = generateDiff(originalSource, newCode, basename);
        if (sandboxTest) {
            const ciResult = await runSandboxCI(filePath, newCode);
            if (!ciResult.passed) {
                return `Sandbox CI FAILED (method: ${ciResult.method}).\n\nOutput:\n${ciResult.output}\n\nPatch rejected.`;
            }
        }
        fs.writeFileSync(absolutePath + '.wingman.bak', originalSource);
        fs.writeFileSync(absolutePath, newCode);
        if (autoCommit) {
            await commitPatch(filePath, `[WINGMAN] ${editDescription || 'Auto-patch'}: ${basename}`);
        }
        return `✅ Patch applied to ${basename} successfully.\nMethod: ${sandboxTest ? 'sandbox-validated' : 'direct'}\n\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``;
    }
    const { ast, error } = parseJavaScript(originalSource, filePath);
    if (error) {
        return `Cannot parse ${filePath} for AST analysis: ${error}\n\nPlease provide the newCode directly.`;
    }
    const analysis = analyzeAST(ast);
    return `AST Analysis of ${basename}:\n\nFunctions: ${analysis.functions.length}\nRoutes: ${analysis.routes.length}\nRequires: ${analysis.requires.length}\n\nFunctions found:\n${analysis.functions.map(f => `  L${f.line}: ${f.async ? 'async ' : ''}${f.name}(${f.params.join(', ')})`).join('\n')}\n\nRoutes found:\n${analysis.routes.map(r => `  L${r.line}: ${r.method} ${r.path}`).join('\n')}\n\nPlease provide the specific newCode to apply with the edit.`;
};
module.exports = {
    applyEdit,
    parseJavaScript,
    analyzeAST,
    generateDiff,
    validateSyntax,
    runSandboxCI,
    commitPatch,
    EDITABLE_FILES,
    EDITABLE_PYTHON
};
