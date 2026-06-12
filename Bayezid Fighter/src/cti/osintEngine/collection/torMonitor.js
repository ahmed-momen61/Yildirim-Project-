const { execFile, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const cheerio = require('cheerio');
const { resolveTorBinary } = require('../utils/crossPlatform');

const TOR_SOCKS5_PORT = process.env.TOR_SOCKS5_PORT || 9050;
const TOR_CONTROL_PORT = process.env.TOR_CONTROL_PORT || 9051;

const TOR_PROXY_URL = `socks5h://127.0.0.1:${TOR_SOCKS5_PORT}`;

const createTorAxios = () => {
  const agent = new SocksProxyAgent(TOR_PROXY_URL);
  return axios.create({
    httpAgent: agent,
    httpsAgent: agent,
    timeout: 45000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0' }
  });
};

const rotateTorCircuit = async () => {
  const net = require('net');
  return new Promise((resolve) => {
    const sock = net.connect(TOR_CONTROL_PORT, '127.0.0.1', () => {
      sock.write(`AUTHENTICATE "${process.env.TOR_CONTROL_PASSWORD || ''}"\r\nSIGNAL NEWNYM\r\nQUIT\r\n`);
      sock.end();
      resolve();
    });
    sock.on('error', resolve); 
  });
};

const AHMIA_ONION = 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion';

const searchAhmiaForTerm = async (term) => {
  try {
    console.log(`[OSINT: DARKNET] Routing Ahmia search via Tor SOCKS5 for term: ${term}...`);
    const torClient = createTorAxios();
    const response = await torClient.get(
      `${AHMIA_ONION}/search/?q=${encodeURIComponent(term)}`
    );
    const $ = cheerio.load(response.data);
    const results = [];
    $('li.result').each((_, el) => {
      const title = $(el).find('h4').text().trim();
      const url   = $(el).find('a').attr('href') || '';
      const snippet = $(el).find('p').text().trim();
      if (title && snippet) results.push({ title, url, snippet, source: 'ahmia', term });
    });
    return results;
  } catch (error) {
    console.error(`[TorMonitor] Ahmia search failed for ${term}:`, error.message);
    return [];
  }
};

const monitorDarkWebForOrganisation = async (config) => {
  const allResults = [];
  await rotateTorCircuit();

  for (const term of [...(config.searchTerms || []), ...(config.cveTechnologies || [])]) {
    const hits = await searchAhmiaForTerm(term);
    allResults.push(...hits);
    await new Promise((resolve) => {
      setTimeout(resolve, 3000 + Math.random() * 2000);
    });
  }
  return allResults;
};

module.exports = {
  monitorDarkWebForOrganisation,
  createTorAxios,
  rotateTorCircuit
};
