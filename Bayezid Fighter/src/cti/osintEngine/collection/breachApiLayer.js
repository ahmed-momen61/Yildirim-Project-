const axios = require('axios');
const querystring = require('querystring');
const { rateGuard } = require('../utils/rateGuard');

const queryLeakLookup = async (queryValue, queryType) => {
  if (!process.env.LEAK_LOOKUP_API_KEY) {
    return { queryValue, queryType, breaches: [], note: 'Leak-Lookup API Key not configured', source: 'leak_lookup' };
  }

  console.log(`[OSINT: BREACH] Querying Leak-Lookup for target: ${queryValue}...`);

  
  const mappedType = queryType === 'email' ? 'email_address' : queryType === 'ip' ? 'ipaddress' : 'domain';

  return rateGuard('leak_lookup', async () => {
    const response = await axios.post(
      'https://leak-lookup.com/api/search',
      querystring.stringify({
        key: process.env.LEAK_LOOKUP_API_KEY,
        type: mappedType,
        query: queryValue
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );

    const data = response.data;
    if (data.error === 'false' && data.message) {
      const breaches = Object.keys(data.message);
      return { queryValue, queryType, breaches, raw: data.message, source: 'leak_lookup' };
    }

    return { queryValue, queryType, breaches: [], raw: data, source: 'leak_lookup' };
  });
};

const queryIntelX = async (term) => {
  if (!process.env.INTELX_API_KEY) {
    return { term, records: [], note: 'IntelX API Key not configured', source: 'intelx' };
  }

  console.log(`[OSINT: BREACH] Querying IntelX for target: ${term}...`);

  return rateGuard('intelx', async () => {
    const initRes = await axios.post(
      `https://api.intelx.io/intelligent/search?key=${process.env.INTELX_API_KEY}`,
      {
        term,
        maxresults: 50,
        media: 0,
        timeout: 10
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const searchId = initRes.data?.id;
    if (!searchId) {
      return { term, records: [], note: 'Failed to initialize search', source: 'intelx' };
    }

    let records = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
      const res = await axios.get(
        `https://api.intelx.io/intelligent/search/result?key=${process.env.INTELX_API_KEY}&id=${searchId}&limit=50`,
        { timeout: 10000 }
      );
      if (res.data?.records && res.data.records.length > 0) {
        records = res.data.records;
        break;
      }
    }

    return { term, records, source: 'intelx' };
  });
};

const queryAllBreachSources = async (indicators) => {
  const results = { leak_lookup: [], intelx: [] };

  for (const email of indicators.emails || []) {
    const ll = await queryLeakLookup(email, 'email').catch((e) => ({ error: e.message, email, source: 'leak_lookup' }));
    const ix = await queryIntelX(email).catch((e) => ({ error: e.message, term: email, source: 'intelx' }));
    results.leak_lookup.push(ll);
    results.intelx.push(ix);
  }

  for (const domain of indicators.domains || []) {
    const ll = await queryLeakLookup(domain, 'domain').catch((e) => ({ error: e.message, domain, source: 'leak_lookup' }));
    const ix = await queryIntelX(domain).catch((e) => ({ error: e.message, term: domain, source: 'intelx' }));
    results.leak_lookup.push(ll);
    results.intelx.push(ix);
  }

  for (const ip of indicators.ips || []) {
    const ll = await queryLeakLookup(ip, 'ip').catch((e) => ({ error: e.message, ip, source: 'leak_lookup' }));
    const ix = await queryIntelX(ip).catch((e) => ({ error: e.message, term: ip, source: 'intelx' }));
    results.leak_lookup.push(ll);
    results.intelx.push(ix);
  }

  return results;
};

module.exports = {
  queryLeakLookup,
  queryIntelX,
  queryAllBreachSources
};
