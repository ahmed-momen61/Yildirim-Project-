const VALID_MODES = ['SIMULATED', 'LIVE_FIRE'];
const DEFAULT_MODE = 'SIMULATED';
const getExecutionMode = () => {
    let raw = (process.env.BAYEZID_EXECUTION_MODE || DEFAULT_MODE).toUpperCase().trim();
    if (raw === 'LIVE_FIRE') {
        if (process.env.BAYEZID_ROE_TOKEN !== 'b4y3z1d_k1n3t1c_0v3rr1d3_99x') {
            console.warn(`[ModeRouter] 🚨 FATAL: LIVE_FIRE mode requested but BAYEZID_ROE_TOKEN is missing or invalid. Falling back to SIMULATED.`);
            raw = 'SIMULATED';
        }
    }
    if (!VALID_MODES.includes(raw)) {
        console.warn(`[ModeRouter] Invalid BAYEZID_EXECUTION_MODE="${raw}". Falling back to SIMULATED.`);
        return DEFAULT_MODE;
    }
    return raw;
};
const isLiveFire = () => getExecutionMode() === 'LIVE_FIRE';
const isSimulated = () => getExecutionMode() === 'SIMULATED';
const requireLiveFire = () => {
    const mode = getExecutionMode();
    if (mode !== 'LIVE_FIRE') {
        throw new Error(`[ModeRouter] Operation requires LIVE_FIRE mode. Current mode: ${mode}`);
    }
};
const requireSimulated = () => {
    const mode = getExecutionMode();
    if (mode !== 'SIMULATED') {
        throw new Error(`[ModeRouter] Operation requires SIMULATED mode. Current mode: ${mode}`);
    }
};
const setExecutionMode = (newMode) => {
    const normalised = (newMode || '').toUpperCase().trim();
    if (!VALID_MODES.includes(normalised)) {
        throw new Error(`[ModeRouter] Invalid mode: "${newMode}". Must be one of: ${VALID_MODES.join(', ')}`);
    }
    const previous = getExecutionMode();
    process.env.BAYEZID_EXECUTION_MODE = normalised;
    const emoji = normalised === 'LIVE_FIRE' ? '🔥' : '🧪';
    console.log(`[${emoji} ModeRouter] Execution mode switched: ${previous} → ${normalised}`);
    return { previousMode: previous, currentMode: normalised };
};
const getModeStatus = () => ({
    currentMode: getExecutionMode(),
    isLiveFire: isLiveFire(),
    isSimulated: isSimulated(),
    validModes: VALID_MODES,
    ebpfMode: process.env.BAYEZID_EBPF_MODE || 'monitor'
});
module.exports = {
    getExecutionMode,
    isLiveFire,
    isSimulated,
    requireLiveFire,
    requireSimulated,
    setExecutionMode,
    getModeStatus,
    VALID_MODES
};
