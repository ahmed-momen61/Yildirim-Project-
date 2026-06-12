const axios = require('axios');

const LOCAL_AI_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';

const generateHypotheses = async (investigationPayload) => {
  console.log(`[OSINT: NEURAL] Generating intelligence hypothesis via local LLM for seed: ${investigationPayload.seed}...`);

  const artifactSummary = JSON.stringify(investigationPayload.artifacts, null, 2);

  const prompt = `You are a senior Cyber Threat Intelligence analyst for a Security Operations Centre.

Investigation seed: "${investigationPayload.seed}" (type: ${investigationPayload.seedType})

Correlated artifact data collected:
${artifactSummary}

Using deductive reasoning and the evidence above, generate a JSON object containing:
- "primary_hypothesis": {
    "statement": "the most probable interpretation of this actor's identity, origin, or campaign",
    "confidence": 0.0-1.0,
    "evidence_chain": ["evidence point 1", "evidence point 2", ...],
    "gaps": ["what evidence is missing to confirm"]
  }
- "alternative_hypotheses": array of up to 3 alternative interpretations with lower confidence
- "recommended_next_pivots": array of specific investigative actions to pursue next (e.g., "Query HIBP for email X", "Search Ahmia for alias variant Y")
- "actor_profile": {
    "probable_origin_region": "...",
    "technical_skill_level": "script_kiddie | intermediate | advanced | nation_state",
    "motivation_hypothesis": "financial | hacktivism | espionage | ransomware",
    "infrastructure_pattern": description of observed C2/hosting patterns
  }
- "confidence_basis": short explanation of what drives the overall confidence level

Respond ONLY with valid JSON. Do not fabricate evidence not present in the artifact data.`;

  try {
    const response = await axios.post(`${LOCAL_AI_BASE}/api/generate`, {
      model: process.env.HYPOTHESIS_MODEL || 'qwen2.5-coder:7b',
      prompt, stream: false, format: 'json'
    }, { timeout: 30000 });

    const hypotheses = JSON.parse(response.data.response);
    return {
      seed: investigationPayload.seed,
      hypotheses,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn(`[HypothesisEngine] Local Ollama call failed (${error.message}). Returning fallback hypothesis.`);
    
    const artifactList = investigationPayload.artifacts || {};
    const breachHitsCount = (artifactList.breachHits?.hibp?.length || 0) + (artifactList.breachHits?.hudson_rock?.length || 0);
    const emailCount = artifactList.emails?.length || 0;
    const darkWebMentionsCount = artifactList.darkWebMentions?.length || 0;

    let statement = `Attributed investigation on ${investigationPayload.seedType} ${investigationPayload.seed}. No high-confidence anomalies found.`;
    let confidence = 0.3;
    let skillLevel = "intermediate";

    if (breachHitsCount > 0 || emailCount > 0 || darkWebMentionsCount > 0) {
      statement = `Attributed Threat Actor identified associated with domain/IP/emails exposed in ${breachHitsCount} breach records and ${darkWebMentionsCount} dark web sources.`;
      confidence = 0.7;
      skillLevel = "intermediate";
    }

    return {
      seed: investigationPayload.seed,
      hypotheses: {
        primary_hypothesis: {
          statement,
          confidence,
          evidence_chain: [
            `Total email pivots: ${emailCount}`,
            `Total dark web hits: ${darkWebMentionsCount}`,
            `Total breach repository records: ${breachHitsCount}`
          ],
          gaps: ["Awaiting active network validation log correlation."]
        },
        alternative_hypotheses: [],
        recommended_next_pivots: [
          "Validate target external endpoints on censys and shodan",
          "Cross-reference source IP indicators in MISP and OpenCTI repositories"
        ],
        actor_profile: {
          probable_origin_region: "unknown",
          technical_skill_level: skillLevel,
          motivation_hypothesis: breachHitsCount > 0 ? "financial" : "espionage",
          infrastructure_pattern: "Observed utilizing compromised cloud VPS hosts or VPN node networks"
        },
        confidence_basis: "Heuristic estimation computed locally due to Ollama service offline status"
      },
      generatedAt: new Date().toISOString()
    };
  }
};

module.exports = { generateHypotheses };
