const { monitorDarkWebForOrganisation } = require('./collection/torMonitor');
const { cloneAndExtract }               = require('./collection/gitForensics');
const { queryAllBreachSources }         = require('./collection/breachApiLayer');
const { queryShodanOwnASN, queryGitHubForAlias, queryCensysForDomain, discoverOwnSubdomains, scanOwnSubnet } = require('./collection/surfaceAggregator');
const { profileAlias, searchAliasVariantsOnSurface } = require('./analysis/aliasProfiler');
const { analyseEmailStructure }         = require('./analysis/emailIntelligence');
const { buildSignatureProfile, compareTextToProfile } = require('./analysis/linguisticSignature');
const { generateHypotheses }            = require('./analysis/hypothesisEngine');
const { ArtifactGraph }                 = require('./graph/artifactGraph');
const { injectOsintEntityIntoGNN }      = require('./graph/gnnOsintBridge');
const { publishConfirmedIOC }           = require('./integration/zmqPublisher');
const { publishToMISP }                 = require('./integration/misp_sync');
const { saveInvestigation, getInvestigation, listInvestigations } = require('./utils/persistence');
const axios                             = require('axios');

const OTX_BASE = 'https://otx.alienvault.com/api/v1/indicators';

const enrichWithOSINT = async (ipAddress) => {
  const isInternal = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(ipAddress);
  if (isInternal) {
    return { ip: ipAddress, note: 'Internal IP — skipping external OSINT', reputation_score: 'INTERNAL' };
  }

  
  const [otxResult, breachResult] = await Promise.allSettled([
    axios.get(`${OTX_BASE}/IPv4/${ipAddress}/general`, {
      headers: { 'X-OTX-API-KEY': process.env.OTX_API_KEY }, timeout: 8000
    }),
    queryAllBreachSources({ ips: [ipAddress] })
  ]);

  const otx = otxResult.status === 'fulfilled' ? otxResult.value.data : null;
  const breachHits = breachResult.status === 'fulfilled' ? breachResult.value : { leak_lookup: [], intelx: [] };

  const leakLookupHits = breachHits.leak_lookup?.[0]?.breaches?.length || 0;
  const intelxHits = breachHits.intelx?.[0]?.records?.length || 0;
  const totalBreachHits = leakLookupHits + intelxHits;

  const pulseCount  = otx?.pulse_info?.count || 0;
  const riskScore   = pulseCount > 10 || totalBreachHits > 0 ? 'CRITICAL RISK' : pulseCount > 0 ? 'HIGH RISK' : 'LOW RISK';

  if (riskScore === 'CRITICAL RISK') {
    publishConfirmedIOC({
      type: 'ip',
      value: ipAddress,
      confidence: 0.9,
      sources: ['otx', 'breach_intel']
    }).catch(() => {});
    
    publishToMISP({
      type: 'ip',
      value: ipAddress,
      confidence: 0.9,
      sources: ['otx', 'breach_intel']
    }).catch(() => {});
  }

  return {
    ip:                     ipAddress,
    country:                otx?.base_indicator?.country_name || 'Unknown',
    city:                   otx?.base_indicator?.city         || 'Unknown',
    reputation_score:       riskScore,
    otx_pulses:             pulseCount,
    hr_stealer_hits:        totalBreachHits,
    threat_actor_suspicion: pulseCount > 0 || totalBreachHits > 0 ? 'Confirmed Malicious Activity' : 'Clean',
    known_malicious_activity: `Reported in ${pulseCount} OTX pulses; ${totalBreachHits} community breach hits`
  };
};

const extractEmailsFromBreachResults = (breachHits) => {
  const emails = new Set();
  for (const hit of (breachHits.leak_lookup || [])) {
    if (hit.email) {
      emails.add(hit.email);
    }
    if (hit.exposedAccounts && Array.isArray(hit.exposedAccounts)) {
      for (const acc of hit.exposedAccounts) {
        emails.add(acc);
      }
    }
  }
  for (const hit of (breachHits.intelx || [])) {
    const records = hit.records || [];
    for (const rec of records) {
      if (rec.name && rec.name.includes('@')) {
        emails.add(rec.name);
      }
    }
  }
  return [...emails];
};

const runDeepInvestigation = async (seed, seedType = 'ip') => {
  console.log(`\n[🕵️] OSINT Engine: Beginning deep investigation of ${seedType}: ${seed}`);
  const graph = new ArtifactGraph();
  const artifacts = {
    ips: [],
    domains: [],
    emails: [],
    aliases: [],
    darkWebMentions: [],
    gitFindings: [],
    breachHits: {},
    hypotheses: null
  };

  const seedNodeId = graph.addNode(seedType, seed, 1.0, ['investigation_seed']);

  if (seedType === 'ip') {
    artifacts.ips.push(seed);
  } else if (seedType === 'domain') {
    artifacts.domains.push(seed);
  } else if (seedType === 'alias') {
    artifacts.aliases.push(seed);
  }

  
  const sweepInput = {
    emails: seedType === 'email' ? [seed] : [],
    domains: seedType === 'domain' ? [seed] : [],
    ips: seedType === 'ip' ? [seed] : []
  };
  const breachHits = await queryAllBreachSources(sweepInput).catch(() => ({ leak_lookup: [], intelx: [] }));
  artifacts.breachHits = breachHits;

  const foundEmails = extractEmailsFromBreachResults(breachHits);
  if (seedType === 'email') {
    foundEmails.push(seed);
  }

  
  let aliasProfiling = null;
  if (seedType === 'alias') {
    aliasProfiling = await profileAlias(seed).catch(() => null);
    if (aliasProfiling) {
      artifacts.aliases.push(aliasProfiling);
    }
  }

  for (const email of foundEmails) {
    const emailAnalysis = await analyseEmailStructure(email).catch(() => null);
    if (emailAnalysis) {
      const emailNodeId = graph.addNode('email', email, 0.9, ['breach_api']);
      graph.addEdge(seedNodeId, emailNodeId, 'associated_email', 0.85);
      artifacts.emails.push({ email, analysis: emailAnalysis });

      const aliasBase = emailAnalysis.aiAnalysis?.probable_alias_base;
      if (aliasBase && aliasBase.length > 2) {
        const profile = await profileAlias(aliasBase).catch(() => null);
        if (profile) {
          const aliasNodeId = graph.addNode('alias', aliasBase, 0.8, ['ai_profiler']);
          graph.addEdge(emailNodeId, aliasNodeId, 'alias_owner', 0.8);
          artifacts.aliases.push(profile);
        }
      }
    }
  }

  
  const darkWebHits = await monitorDarkWebForOrganisation({ searchTerms: [seed] }).catch(() => []);
  for (const hit of darkWebHits) {
    const darkNodeId = graph.addNode('dark_web_post', hit.title || hit.url, 0.7, ['ahmia']);
    graph.addEdge(seedNodeId, darkNodeId, 'mentioned_in', 0.75);
    artifacts.darkWebMentions.push(hit);
  }

  
  const surfaceRecon = {
    shodan: null,
    censys: null,
    github: null,
    alias_variants: []
  };

  if (seedType === 'domain') {
    surfaceRecon.censys = await queryCensysForDomain(seed).catch(() => null);
    surfaceRecon.shodan = await discoverOwnSubdomains(seed).catch(() => null);
  } else if (seedType === 'alias') {
    surfaceRecon.github = await queryGitHubForAlias(seed).catch(() => null);
    if (aliasProfiling && aliasProfiling.analysis?.variants) {
      surfaceRecon.alias_variants = await searchAliasVariantsOnSurface(aliasProfiling.analysis.variants, { queryGitHubForAlias }).catch(() => []);
    }
  }

  
  const snippets = darkWebHits.map((h) => h.snippet).filter(Boolean);
  const signatureTextSamples = snippets.length > 0 ? snippets : [`Sample post from threat actor ${seed}`];
  const linguisticSignature = await buildSignatureProfile(seed, signatureTextSamples).catch(() => null);

  const hypotheses = await generateHypotheses({ seed, seedType, artifacts }).catch(() => null);
  artifacts.hypotheses = hypotheses;

  const aiForensics = {
    alias_profiling: aliasProfiling,
    linguistic_signature: linguisticSignature,
    hypothesis_engine: hypotheses
  };

  
  console.log('[OSINT: GRAPH] Artifact relationships mapped successfully.');

  const finalReport = {
    
    target_info: {
      seed,
      type: seedType
    },
    breach_intelligence: {
      leak_lookup: breachHits.leak_lookup || [],
      intelx: breachHits.intelx || []
    },
    dark_web_mentions: darkWebHits,
    surface_recon: surfaceRecon,
    ai_forensics: aiForensics,
    artifact_graph: graph.toD3Format(),

    
    seed,
    seedType,
    graph: graph.toD3Format(),
    artifacts: {
      ips: artifacts.ips,
      domains: artifacts.domains,
      emails: artifacts.emails,
      aliases: artifacts.aliases,
      darkWebMentions: darkWebHits,
      gitFindings: artifacts.gitFindings,
      breachHits: {
        leak_lookup: breachHits.leak_lookup || [],
        intelx: breachHits.intelx || [],
        hibp: (breachHits.leak_lookup || []).map((ll) => ({
          email: ll.queryType === 'email' ? ll.queryValue : undefined,
          domain: ll.queryType === 'domain' ? ll.queryValue : undefined,
          breaches: ll.breaches || []
        })),
        hudson_rock: (breachHits.intelx || []).map((ix) => ({
          ip: ix.term,
          domain: ix.term,
          stealerData: {
            total: ix.records?.length || 0
          }
        }))
      },
      hypotheses: hypotheses
    },
    investigatedAt: new Date().toISOString()
  };

  await saveInvestigation(seed, finalReport).catch(() => {});

  const overallConfidence = hypotheses?.hypotheses?.primary_hypothesis?.confidence || 0;
  if (artifacts.ips.length > 0) {
    const ipHostnameMap = {};
    const ipServicesMap = {};
    for (const ip of artifacts.ips) {
      ipHostnameMap[ip] = seedType === 'domain' ? seed : '';
      ipServicesMap[ip] = [];
    }
    injectOsintEntityIntoGNN({
      confirmedIPs: artifacts.ips,
      ipHostnameMap,
      ipServicesMap
    }, overallConfidence);
  }

  return finalReport;
};

module.exports = {
  enrichWithOSINT,
  runDeepInvestigation,
  listInvestigations,
  getInvestigation,
  discoverOwnSubdomains,
  scanOwnSubnet
};
