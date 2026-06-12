const serviceQueues = {};

const rateGuard = async (service, callback, options = {}) => {
  const maxRetries = options.maxRetries || 3;
  const initialDelay = options.initialDelay || 1500;
  
  if (!serviceQueues[service]) {
    let minInterval = 1000;
    if (service === 'hibp' || service === 'leak_lookup') {
      minInterval = 1600;
    } else if (service === 'hudsonrock' || service === 'intelx') {
      minInterval = 1000;
    } else if (service === 'flare') {
      minInterval = 2000;
    }
    
    serviceQueues[service] = {
      lastRequestTime: 0,
      minInterval: options.minInterval || minInterval
    };
  }

  const queue = serviceQueues[service];

  const now = Date.now();
  const timeSinceLast = now - queue.lastRequestTime;
  if (timeSinceLast < queue.minInterval) {
    const delay = queue.minInterval - timeSinceLast;
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  let attempt = 0;
  while (true) {
    try {
      queue.lastRequestTime = Date.now();
      const result = await callback();
      return result;
    } catch (error) {
      attempt++;
      const isRateLimit = error.response && (error.response.status === 429 || error.response.status === 403);
      if (attempt >= maxRetries) {
        throw error;
      }
      
      const backoffDelay = isRateLimit 
        ? initialDelay * Math.pow(2, attempt) + Math.random() * 1000
        : 1000 * attempt;
        
      console.warn(`[RateGuard] Service ${service} request failed (Status: ${error.response?.status || 'network_error'}). Retrying in ${backoffDelay}ms (Attempt ${attempt}/${maxRetries})...`);
      await new Promise((resolve) => {
        setTimeout(resolve, backoffDelay);
      });
    }
  }
};

module.exports = { rateGuard };
