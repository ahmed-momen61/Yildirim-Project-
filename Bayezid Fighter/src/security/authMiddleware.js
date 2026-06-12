const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../api/prismaClient');
const JWT_SECRET = process.env.JWT_SECRET;
const MASTER_SCOPE_KEY = process.env.MASTER_SCOPE_KEY || 'bayezid-scope-default-key';
const ROLE_BITS = {
    VIEWER: 0b0001,
    JUNIOR_ANALYST: 0b0011,
    SENIOR_ANALYST: 0b0111,
    RED_OPERATOR: 0b1011,
    ADMIN: 0b1111,
};
const ROUTE_POLICY = {
    'POST:/api/v1/drill/live-fire': 'RED_OPERATOR',
    'POST:/api/v1/redswarm/engage': 'RED_OPERATOR',
    'POST:/api/v1/redswarm/scout': 'RED_OPERATOR',
    'POST:/api/v1/redswarm/breach': 'RED_OPERATOR',
    'POST:/api/v1/redswarm/phantom': 'RED_OPERATOR',
    'POST:/api/v1/redswarm/chameleon': 'RED_OPERATOR',
    'POST:/api/v1/red/chimera-x': 'RED_OPERATOR',
    'POST:/api/v1/red/hydra-c2': 'RED_OPERATOR',
    'POST:/api/v1/red/forge': 'RED_OPERATOR',
    'POST:/api/v1/red/phantom-ml': 'RED_OPERATOR',
    'POST:/api/v1/red/alchemist': 'RED_OPERATOR',
    'POST:/api/v1/bridge/approve-fix': 'SENIOR_ANALYST',
    'POST:/api/v1/bridge/isolate': 'SENIOR_ANALYST',
    'POST:/api/v1/config/set-autonomy': 'ADMIN',
    'POST:/api/v1/shadow-mirror/zero-fail': 'RED_OPERATOR',
    'POST:/api/v2/roe/issue': 'ADMIN',
    'POST:/api/v2/roe/revoke': 'SENIOR_ANALYST',
    'POST:/api/v2/auth/rotate-key': 'ADMIN',
    'GET:/api/v2/auth/audit': 'ADMIN',
    'POST:/api/v2/blue/ebpf/activate-probe': 'SENIOR_ANALYST',
    'POST:/api/v2/blue/predict-lateral': 'JUNIOR_ANALYST',
    'POST:/api/v2/blue/causal-rca': 'JUNIOR_ANALYST',
    'POST:/api/v2/blue/pre-emptive-harden': 'SENIOR_ANALYST',
    'GET:/api/v2/blue/threat-heatmap': 'VIEWER',
    'POST:/api/v2/red/llvm-forge': 'RED_OPERATOR',
    'POST:/api/v2/red/stealth-lateral': 'RED_OPERATOR',
    'GET:/api/v2/red/adversarial-coverage': 'VIEWER',
    'POST:/api/v2/mirror/auto-create': 'RED_OPERATOR',
    'POST:/api/v2/mirror/stateful-replay': 'RED_OPERATOR',
    'POST:/api/v2/mirror/blue-validation': 'SENIOR_ANALYST',
    'GET:/api/v2/analytics/mitre-coverage': 'VIEWER',
    'GET:/api/v2/analytics/purple-scorecard': 'VIEWER',
    'POST:/api/v2/socket/operator-approve': 'RED_OPERATOR',
    'POST:/api/v2/veritas/prove-operation': 'RED_OPERATOR',
    'GET:/api/v2/veritas/export-compliance/:format': 'VIEWER',
    'GET:/api/v2/brain/training-metrics': 'VIEWER',
    'POST:/api/v2/brain/force-train': 'ADMIN',
    'GET:/api/v2/brain/data-quality': 'VIEWER',
    'POST:/api/v1/wingman/chat': 'JUNIOR_ANALYST',
    'GET:/api/v1/wingman/session/:id': 'JUNIOR_ANALYST',
    'DELETE:/api/v1/wingman/session/:id': 'SENIOR_ANALYST',
    'POST:/api/v1/wingman/tools': 'VIEWER',
    'POST:/api/v1/osint/investigate': 'JUNIOR_ANALYST',
    'GET:/api/v1/osint/graph': 'VIEWER',
    'GET:/api/v1/osint/investigations': 'VIEWER',
    'POST:/api/v1/osint/recon/nmap': 'RED_OPERATOR'
};
const authMiddleware = async(req, res, next) => {
    const routeKey = `${req.method}:${req.path.replace(/\/$/, '')}`;
    const requiredRole = ROUTE_POLICY[routeKey];
    if (!requiredRole) return next(); 
    const bearer = req.headers['authorization'];
    if (!bearer?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing bearer token' });
    }
    try {
        if (!JWT_SECRET) throw new Error("JWT_SECRET missing");
        const decoded = jwt.verify(bearer.slice(7), JWT_SECRET);
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!user) return res.status(401).json({ error: 'Unknown user' });
        const userBits = ROLE_BITS[user.role] ?? 0;
        const reqBits = ROLE_BITS[requiredRole] ?? 0b1111;
        if ((userBits & reqBits) !== reqBits) {
            return res.status(403).json({ error: `Role ${user.role} cannot access ${routeKey}` });
        }
        req.operator = user;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
let IPCIDR;
try { IPCIDR = require('ip-cidr'); } catch (e) { IPCIDR = null; }
const computeScopeHash = (target, salt) => {
    return crypto.createHmac('sha256', MASTER_SCOPE_KEY)
        .update(target + salt)
        .digest('hex');
};
const enforceRoE = async(req, res, next) => {
    const roeTokenId = req.headers['x-roe-token'];
    if (!roeTokenId) {
        return res.status(403).json({ error: 'ROE_MISSING', message: 'No RoE token provided. Offensive operations require a valid Rules of Engagement token.' });
    }
    try {
        const roe = await prisma.roeToken.findUnique({ where: { id: roeTokenId } });
        if (!roe) {
            return res.status(403).json({ error: 'ROE_NOT_FOUND', message: 'RoE token does not exist.' });
        }
        if (roe.revokedAt) {
            return res.status(403).json({ error: 'ROE_REVOKED', message: `RoE token was revoked at ${roe.revokedAt.toISOString()}.` });
        }
        const now = new Date();
        if (now < roe.notBefore) {
            return res.status(403).json({ error: 'ROE_NOT_YET_VALID', message: `RoE token is not valid until ${roe.notBefore.toISOString()}.` });
        }
        if (now > roe.expiresAt) {
            return res.status(403).json({ error: 'ROE_EXPIRED', message: `RoE token expired at ${roe.expiresAt.toISOString()}.` });
        }
        if (roe.operationsUsed >= roe.maxOperations) {
            return res.status(429).json({ error: 'ROE_BUDGET_EXHAUSTED', message: `RoE operation budget exhausted (${roe.operationsUsed}/${roe.maxOperations}).` });
        }
        if (req.operator && roe.issuedToUserId !== req.operator.id) {
            return res.status(403).json({ error: 'ROE_OWNERSHIP_VIOLATION', message: 'This RoE token was not issued to your user account.' });
        }
        const { targetInfo, targetIp, targetAsset } = req.body;
        const target = targetInfo || targetIp || targetAsset;
        if (target) {
            const computedHash = computeScopeHash(target, roe.salt);
            if (computedHash !== roe.targetScopeHash) {
                if (roe.targetCidr && IPCIDR) {
                    try {
                        const cidr = new IPCIDR(roe.targetCidr);
                        if (!cidr.contains(target)) {
                            return res.status(403).json({ error: 'TARGET_SCOPE_VIOLATION', message: 'Requested target is outside authorized RoE scope and CIDR range.' });
                        }
                    } catch (e) {
                        return res.status(403).json({ error: 'TARGET_SCOPE_VIOLATION', message: 'Target scope hash mismatch and CIDR validation failed.' });
                    }
                } else {
                    return res.status(403).json({ error: 'TARGET_SCOPE_VIOLATION', message: 'Requested target is outside authorized RoE scope.' });
                }
            }
        }
        req.roeToken = roe;
        next();
    } catch (err) {
        console.error('[!] RoE Enforcement Error:', err.message);
        return res.status(500).json({ error: 'ROE_CHECK_FAILED', message: 'Internal error during RoE verification.' });
    }
};
const logRoEOperation = async(roeToken, agentName, targetIp, command, outcome, veritasBlockIndex) => {
    try {
        await prisma.roeToken.update({
            where: { id: roeToken.id },
            data: { operationsUsed: { increment: 1 } }
        });
        await prisma.operationLedger.create({
            data: {
                roeTokenId: roeToken.id,
                agentName,
                targetIp: targetIp || 'unknown',
                commandHash: crypto.createHash('sha256').update(command || 'N/A').digest('hex'),
                outcome,
                veritasBlock: veritasBlockIndex || null
            }
        });
    } catch (e) {
        console.error('[-] RoE Ledger Error:', e.message);
    }
};
const authSocketMiddleware = (requiredRole) => {
    return async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (!token) return next(new Error('Authentication error'));
        try {
            if (!JWT_SECRET) throw new Error("JWT_SECRET missing");
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
            if (!user) return next(new Error('Unknown user'));
            const userBits = ROLE_BITS[user.role] ?? 0;
            const reqBits = ROLE_BITS[requiredRole] ?? 0b1111;
            if ((userBits & reqBits) !== reqBits) {
                return next(new Error(`Role ${user.role} insufficient for ${requiredRole} namespace`));
            }
            socket.user = user;
            next();
        } catch (e) {
            return next(new Error('Authentication error'));
        }
    };
};
module.exports = { authMiddleware, enforceRoE, logRoEOperation, computeScopeHash, authSocketMiddleware };