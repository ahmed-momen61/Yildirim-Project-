const axios = require('axios');

const analyseEmailStructure = async (email) => {
  console.log(`[OSINT: NEURAL] Analyzing email structure via local LLM for email: ${email}...`);

  const [localPart, domain] = email.split('@');

  const leet_normalised = localPart
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's');

  const hasYear = /(?:19|20)\d{2}/.test(localPart);
  const yearMatch = localPart.match(/(?:19|20)(\d{2})/);

  const prompt = `You are a OSINT analyst. Analyse this email address local-part: "${localPart}".
Provide JSON with:
- "probable_alias_base": the core alias stripped of numbers/separators
- "numeric_suffix_meaning": what any numbers likely represent (year, sequence, etc.)
- "disposable_pattern": boolean, is this consistent with a temp/throwaway email pattern
- "linguistic_origin_hint": probable cultural/linguistic origin of the local-part construction
- "similar_known_patterns": patterns this matches from common threat actor naming conventions
Respond ONLY with valid JSON.`;

  let aiAnalysis = {
    probable_alias_base: localPart.replace(/\d+/g, ''),
    numeric_suffix_meaning: hasYear ? "probable_year" : "none",
    disposable_pattern: /temp|mailinator|yopmail|throwaway|disposable/i.test(domain),
    linguistic_origin_hint: "unknown",
    similar_known_patterns: []
  };

  try {
    const LOCAL_AI_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
    const response = await axios.post(`${LOCAL_AI_BASE}/api/generate`, {
      model: process.env.ALIAS_ANALYSIS_MODEL || 'qwen2.5-coder:7b',
      prompt, stream: false, format: 'json'
    }, { timeout: 10000 });

    const parsed = JSON.parse(response.data.response);
    aiAnalysis = { ...aiAnalysis, ...parsed };
  } catch (error) {
    console.warn(`[EmailIntelligence] Local Ollama call failed (${error.message}). Using rule-based fallback.`);
  }

  return {
    email, localPart, domain, leet_normalised,
    hasYearSuffix: hasYear,
    estimatedYear: yearMatch ? `19${yearMatch[1]} or 20${yearMatch[1]}` : null,
    aiAnalysis
  };
};

module.exports = { analyseEmailStructure };
