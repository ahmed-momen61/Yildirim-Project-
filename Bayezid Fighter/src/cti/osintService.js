const {
  enrichWithOSINT,
  runDeepInvestigation,
  listInvestigations,
  getInvestigation,
  discoverOwnSubdomains,
  scanOwnSubnet
} = require('./osintEngine/index');
const axios = require('axios');
const OTX_API_KEY = process.env.OTX_API_KEY;
const OTX_BASE_URL = 'https://otx.alienvault.com/api/v1/indicators';

const analyzeHash = async (fileHash) => {
  try {
    const response = await axios.get(`${OTX_BASE_URL}/file/${fileHash}/general`, {
      headers: {
        'X-OTX-API-KEY': OTX_API_KEY
      },
      timeout: 10000
    });
    return {
      success: true,
      hash: fileHash,
      malicious_reports: response.data.pulse_info ? response.data.pulse_info.count : 0,
      malware_family: response.data.base_indicator.malware_family || 'Unknown'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  enrichWithOSINT,
  analyzeHash,
  runDeepInvestigation,
  listInvestigations,
  getInvestigation,
  discoverOwnSubdomains,
  scanOwnSubnet
};