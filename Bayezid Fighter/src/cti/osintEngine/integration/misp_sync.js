const axios = require('axios');

const publishToMISP = async (iocData) => {
  const mispUrl = process.env.MISP_URL;
  const mispKey = process.env.MISP_API_KEY;
  if (!mispUrl || !mispKey) {
    console.log('[MISP-Sync] MISP configuration missing. Skipping sync.');
    return null;
  }

  try {
    let eventId = process.env.MISP_EVENT_ID;
    
    if (!eventId) {
      const eventResponse = await axios.post(`${mispUrl}/events/add`, {
        Event: {
          info: 'Bayezid SOAR OSINT Attributed IOCs',
          threat_level_id: '3',
          analysis: '1',
          distribution: '0'
        }
      }, {
        headers: {
          'Authorization': mispKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      eventId = eventResponse.data?.Event?.id;
    }

    if (!eventId) {
      throw new Error('Failed to create or obtain MISP Event ID');
    }

    const attributeResponse = await axios.post(`${mispUrl}/attributes/add/${eventId}`, {
      Attribute: {
        type: iocData.type === 'ip' ? 'ip-dst' : iocData.type === 'domain' ? 'domain' : 'sha256',
        value: iocData.value,
        comment: `Bayezid OSINT Engine - Confidence: ${iocData.confidence} | Sources: ${iocData.sources.join(', ')}`,
        to_ids: true
      }
    }, {
      headers: {
        'Authorization': mispKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log(`[MISP-Sync] Successfully synced ${iocData.type} IOC ${iocData.value} to MISP Event ${eventId}`);
    return attributeResponse.data;
  } catch (error) {
    console.error(`[MISP-Sync] Failed to publish to MISP:`, error.message);
    return null;
  }
};

const fetchFromMISP = async () => {
  const mispUrl = process.env.MISP_URL;
  const mispKey = process.env.MISP_API_KEY;
  if (!mispUrl || !mispKey) return [];

  try {
    const response = await axios.post(`${mispUrl}/attributes/restSearch`, {
      returnFormat: 'json',
      limit: 100,
      to_ids: true
    }, {
      headers: {
        'Authorization': mispKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const attributes = response.data?.response?.Attribute || [];
    return attributes.map((attr) => ({
      type: attr.type === 'ip-dst' || attr.type === 'ip-src' ? 'ip' : attr.type,
      value: attr.value,
      comment: attr.comment
    }));
  } catch (error) {
    console.error('[MISP-Sync] Failed to fetch attributes from MISP:', error.message);
    return [];
  }
};

module.exports = { publishToMISP, fetchFromMISP };
