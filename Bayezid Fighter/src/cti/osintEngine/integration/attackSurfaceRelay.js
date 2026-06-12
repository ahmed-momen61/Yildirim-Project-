const generateRedTeamScopePackage = async (osintFindings, authorisationMetadata) => {
  if (!authorisationMetadata || !authorisationMetadata.authorisedBy) {
    throw new Error('Active scoping requires explicit authorisation record. Aborting.');
  }

  return {
    packageType:   'AUTHORISED_SELF_ASSESSMENT_SCOPE',
    generatedAt:   new Date().toISOString(),
    authorisedBy:  authorisationMetadata.authorisedBy,
    approvalStatus: 'REQUIRES_HUMAN_SIGN_OFF',

    targetScope: {
      ips:         osintFindings.ownExposedIPs     || [],
      domains:     osintFindings.ownExposedDomains || [],
      services:    osintFindings.ownExposedPorts   || [],
      outOfScope:  'ALL third-party infrastructure. Any asset not listed above. NO EXCEPTIONS.'
    },

    briefing: {
      exposedCredentials:   osintFindings.breachHits || {},
      visibleAdminPanels:   osintFindings.adminPanelsFound || [],
      shodanFingerprints:   osintFindings.shodanMatches    || [],
      recommendedTests:     ['credential stuffing simulation', 'exposed panel access test', 'service version exploit check']
    },

    legalNotice: 'This scope package authorises testing ONLY against listed assets. Any deviation constitutes unauthorised computer access under applicable law.'
  };
};

module.exports = { generateRedTeamScopePackage };
