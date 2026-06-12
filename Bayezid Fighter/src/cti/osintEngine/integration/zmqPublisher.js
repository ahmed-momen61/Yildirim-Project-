const zmq = require('zeromq');

const ZMQ_TACTICAL_ENDPOINT = process.env.ZMQ_IOC_ENDPOINT || 'tcp://127.0.0.1:5558';
const ZMQ_TOPIC             = 'bayezid_tactical_feed';

const sock = new zmq.Publisher();
sock.connect(ZMQ_TACTICAL_ENDPOINT);

const publishConfirmedIOC = async (iocData) => {
  if (iocData.confidence < 0.70) {
    console.log(`[ZMQ-IOC] Confidence ${iocData.confidence} below 0.70 publication threshold. Not publishing.`);
    return;
  }

  try {
    const payload = JSON.stringify({
      topic:           'OSINT_CONFIRMED_IOC',
      timestamp:       new Date().toISOString(),
      ioc_type:        iocData.type,
      ioc_value:       iocData.value,
      confidence:      iocData.confidence,
      sources:         iocData.sources,
      action_required: 'DEFENSIVE_BLOCK',
      hypothesis_ref:  iocData.hypothesisRef || null
    });

    await sock.send([ZMQ_TOPIC, payload]);

    console.log(`[ZMQ-IOC] Published ${iocData.type} IOC: ${iocData.value} (confidence: ${iocData.confidence}) → Blue Swarm`);
  } catch (error) {
    console.error(`[ZMQ-IOC] Failed to publish IOC to ZeroMQ:`, error.message);
  }
};

module.exports = { publishConfirmedIOC };

