const getCognitiveMode = () => {
    return (process.env.BAYEZID_COGNITIVE_MODE || 'CLOUD_WATERFALL').toUpperCase();
};
module.exports = { getCognitiveMode };
