const axios = require('axios');

const SHODAN_BASE    = 'https://api.shodan.io';
const CENSYS_BASE    = 'https://search.censys.io/api';
const GITHUB_BASE    = 'https://api.github.com';

const queryShodanOwnASN = async (asn) => {
  if (!process.env.SHODAN_API_KEY) {
    return { asn, total: 0, matches: [], note: 'Shodan API Key not configured', source: 'shodan' };
  }
  const response = await axios.get(`${SHODAN_BASE}/shodan/host/search`, {
    params: {
      key:   process.env.SHODAN_API_KEY,
      query: `asn:${asn}`,
      facets: 'port,product,country'
    }
  });
  return { asn, total: response.data.total, matches: response.data.matches, source: 'shodan' };
};

const queryShodanForOrg = async (orgName) => {
  if (!process.env.SHODAN_API_KEY) {
    return { orgName, total: 0, matches: [], note: 'Shodan API Key not configured', source: 'shodan' };
  }
  const response = await axios.get(`${SHODAN_BASE}/shodan/host/search`, {
    params: {
      key:   process.env.SHODAN_API_KEY,
      query: `org:"${orgName}"`,
      facets: 'port,product'
    }
  });
  return { orgName, total: response.data.total, matches: response.data.matches, source: 'shodan' };
};

const queryCensysForDomain = async (domain) => {
  if (!process.env.CENSYS_API_ID || !process.env.CENSYS_API_SECRET) {
    return { domain, results: [], note: 'Censys credentials not configured', source: 'censys' };
  }
  const response = await axios.post(`${CENSYS_BASE}/v2/hosts/search`, {
    q: `parsed.names: ${domain}`,
    per_page: 50
  }, {
    auth: {
      username: process.env.CENSYS_API_ID,
      password: process.env.CENSYS_API_SECRET
    }
  });
  return { domain, results: response.data.result?.hits, source: 'censys' };
};

const { resolveNmapBinary } = require('../utils/crossPlatform');

const queryGitHubForAlias = async (alias) => {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
  };
  const [userRes, searchRes] = await Promise.allSettled([
    axios.get(`${GITHUB_BASE}/users/${alias}`, { headers }),
    axios.get(`${GITHUB_BASE}/search/commits?q=author:${alias}`, { headers })
  ]);
  return {
    alias,
    profile:  userRes.status === 'fulfilled' ? userRes.value.data : null,
    commits:  searchRes.status === 'fulfilled' ? searchRes.value.data?.total_count : 0,
    source: 'github'
  };
};

const discoverOwnSubdomains = async (rootDomain) => {
  if (!process.env.SHODAN_API_KEY) {
    return { rootDomain, subdomains: [], tags: [], note: 'Shodan API Key not configured', source: 'shodan_passive_dns' };
  }
  const response = await axios.get(`https://api.shodan.io/dns/domain/${rootDomain}`, {
    params: { key: process.env.SHODAN_API_KEY }
  });
  
  return {
    rootDomain,
    subdomains: response.data?.subdomains || [],
    tags:       response.data?.tags       || [],
    source: 'shodan_passive_dns'
  };
};

const scanOwnSubnet = async (subnet, authorization) => {
  if (!authorization || !authorization.authorisedBy) {
    throw new Error('Active scanning requires explicit authorisation record. Aborting.');
  }
  if (new Date(authorization.expiresAt) < new Date()) {
    throw new Error('Authorisation expired. Renew before scanning.');
  }

  const NMAP = resolveNmapBinary();
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  const { stdout } = await execFileAsync(
    NMAP, ['-sV', '-T3', '-oX', '-', subnet],
    { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
  );
  return { subnet, nmapXml: stdout, authorisedBy: authorization.authorisedBy, scanAt: new Date().toISOString() };
};

module.exports = {
  queryShodanOwnASN,
  queryShodanForOrg,
  queryCensysForDomain,
  queryGitHubForAlias,
  discoverOwnSubdomains,
  scanOwnSubnet
};
