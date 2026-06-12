const axios = require('axios');

const LOCAL_AI_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';

const buildSignatureProfile = async (aliasLabel, textSamples) => {
  console.log(`[OSINT: NEURAL] Generating linguistic signature via local LLM for alias: ${aliasLabel}...`);

  const combinedSamples = textSamples.slice(0, 20).join('\n\n---SAMPLE BREAK---\n\n');

  const prompt = `You are a forensic linguist and cyber threat intelligence analyst.

You have collected the following text samples from a threat actor using the alias "${aliasLabel}":

${combinedSamples}

Analyse the linguistic patterns and return a JSON object with:
- "characteristic_typos": recurring spelling errors or unconventional spellings observed
- "punctuation_habits": how this person uses punctuation (e.g., always omits period, double-spaces after comma)
- "phrase_templates": recurring phrase constructions or templates
- "vocabulary_markers": specific words, slang, or technical terminology this person favours
- "sentence_length_profile": short/medium/long, consistent or variable
- "cultural_markers": language-mixing patterns, non-native English indicators, or regional slang
- "formality_level": formal/informal/mixed
- "confidence": your confidence in this profile (0.0-1.0)
- "minimum_sample_quality": is this sample large enough for reliable attribution (boolean)

Respond ONLY with valid JSON.`;

  try {
    const response = await axios.post(`${LOCAL_AI_BASE}/api/generate`, {
      model: process.env.LINGUISTIC_MODEL || 'qwen3.5:4b',
      prompt, stream: false, format: 'json'
    }, { timeout: 20000 });

    const profile = JSON.parse(response.data.response);
    return { aliasLabel, profile, sampleCount: textSamples.length, builtAt: new Date().toISOString() };
  } catch (error) {
    console.warn(`[LinguisticSignature] Local Ollama call failed (${error.message}). Returning fallback signature profile.`);
    return {
      aliasLabel,
      profile: {
        characteristic_typos: [],
        punctuation_habits: "unknown_fallback",
        phrase_templates: [],
        vocabulary_markers: [],
        sentence_length_profile: "unknown_fallback",
        cultural_markers: "unknown_fallback",
        formality_level: "unknown_fallback",
        confidence: 0.1,
        minimum_sample_quality: false
      },
      sampleCount: textSamples.length,
      builtAt: new Date().toISOString()
    };
  }
};

const compareTextToProfile = async (unknownText, signatureProfile) => {
  console.log('[OSINT: NEURAL] Comparing text sample to linguistic profile via local LLM...');

  const prompt = `You are a forensic linguist performing a threat actor attribution analysis.

Known actor linguistic profile:
${JSON.stringify(signatureProfile.profile, null, 2)}

Unknown text sample to compare:
"${unknownText}"

Analyse whether this unknown sample was likely written by the same person as the profile.
Return JSON with:
- "similarity_score": 0.0 to 1.0 (1.0 = highly confident same author)
- "matching_markers": list of profile markers that appear in the unknown sample
- "contradicting_markers": list of profile markers absent or contradicted in the sample
- "attribution_verdict": "HIGH_CONFIDENCE" | "MODERATE_CONFIDENCE" | "LOW_CONFIDENCE" | "CONTRADICTED"
- "reasoning": one-sentence explanation of the verdict

Respond ONLY with valid JSON.`;

  try {
    const response = await axios.post(`${LOCAL_AI_BASE}/api/generate`, {
      model: process.env.LINGUISTIC_MODEL || 'qwen3.5:4b',
      prompt, stream: false, format: 'json'
    }, { timeout: 20000 });

    const comparison = JSON.parse(response.data.response);
    return { unknownTextSnippet: unknownText.slice(0, 100), comparison, profileAlias: signatureProfile.aliasLabel };
  } catch (error) {
    console.warn(`[LinguisticSignature] Local Ollama comparison call failed (${error.message}). Returning fallback comparison.`);
    return {
      unknownTextSnippet: unknownText.slice(0, 100),
      comparison: {
        similarity_score: 0.2,
        matching_markers: [],
        contradicting_markers: [],
        attribution_verdict: "LOW_CONFIDENCE",
        reasoning: "Ollama offline. Unable to calculate similarity score."
      },
      profileAlias: signatureProfile.aliasLabel
    };
  }
};

module.exports = { buildSignatureProfile, compareTextToProfile };
