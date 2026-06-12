const { isAllowedTarget } = require('./securityGovernor');

const governorMiddleware = (req, res, next) => {
  const targetInfo = req.body?.targetInfo || req.body?.target || req.body?.targetIp || req.body?.targetAsset || '';
  const targetStr = typeof targetInfo === 'string' ? targetInfo : (targetInfo.ip || targetInfo.host || '');
  if (targetStr && !isAllowedTarget(targetStr)) {
    return res.status(403).json({ status: 'BLOCKED', message: 'Governor Lockout' });
  }
  next();
};

module.exports = governorMiddleware;
