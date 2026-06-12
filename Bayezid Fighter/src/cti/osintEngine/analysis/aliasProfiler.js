const axios = require('axios');

const LOCAL_AI_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const ALIAS_MODEL   = process.env.ALIAS_ANALYSIS_MODEL || 'qwen2.5-coder:7b';

const profileAlias = async (alias) => {
  console.log(`[OSINT: NEURAL] Analyzing alias variation profiling via local LLM for alias: ${alias}...`);

  const prompt = `You are a cyber threat intelligence analyst performing OSINT attribution research on a confirmed threat actor.

Alias under investigation: "${alias}"

Analyse this alias and provide a JSON object with the following fields:
- "linguistic_family": probable language background deduced from character patterns (e.g., "arabic_romanised", "cyrillic_transliteration", "english_leet")
- "construction_pattern": how the alias is built (e.g., "noun_number", "keyboard_walk", "initials_year")
- "entropy_note": any entropy or randomness observations
- "variants": array of 15 structurally plausible alias variants this actor might use on other platforms, applying: leet substitutions (a→@, e→3, i→1, s→$, o→0), number appending (birth years 1985-2005, common: 123, 1337, 0x), separator variations (_, -, .), case permutations, and linguistic reversals
- "confidence": your confidence in the linguistic analysis (0.0-1.0)

Respond ONLY with valid JSON. No preamble. No explanation outside the JSON.`;

  try {
    const response = await axios.post(`${LOCAL_AI_BASE}/api/generate`, {
      model: ALIAS_MODEL,
      prompt,
      stream: false,
      format: 'json'
    }, { timeout: 15000 });

    const parsed = JSON.parse(response.data.response);
    return { alias, analysis: parsed };
  } catch (error) {
    console.warn(`[AliasProfiler] Local Ollama call failed (${error.message}). Applying rule-based variant fallback.`);
    const basicVariants = [
      `${alias}123`,
      `${alias}1337`,
      `${alias}_0x`,
      `${alias}.xyz`,
      alias.replace(/a/gi, '@'),
      alias.replace(/e/gi, '3'),
      alias.replace(/s/gi, '$'),
      alias.replace(/o/gi, '0'),
      alias.replace(/i/gi, '1'),
      `anti_${alias}`,
      `the_${alias}`,
      `${alias}_admin`,
      `${alias}_sec`,
      alias.split('').reverse().join(''),
      `${alias}2026`
    ];
    return {
      alias,
      analysis: {
        linguistic_family: "unknown_fallback",
        construction_pattern: "unknown_fallback",
        entropy_note: "Ollama offline. Rule-based permutation applied.",
        variants: [...new Set(basicVariants)],
        confidence: 0.5
      }
    };
  }
};

const searchAliasVariantsOnSurface = async (variants, surfaceAggregator) => {
  const findings = [];
  for (const variant of variants.slice(0, 10)) {
    const ghResult = await surfaceAggregator.queryGitHubForAlias(variant).catch(() => null);
    if (ghResult?.profile) {
      findings.push({ variant, platform: 'github', data: ghResult.profile });
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
  }
  return findings;
};

module.exports = { profileAlias, searchAliasVariantsOnSurface };
