const calculateSuccess = (attackerPower, defenderSecurity) => {
    let chance = 0.40; // 40% base
    chance += (attackerPower * 0.1);
    chance -= (defenderSecurity * 0.05);
    
    // Clamp chance between 5% and 95%
    chance = Math.max(0.05, Math.min(0.95, chance));
    
    return Math.random() < chance;
};

const formatTime = (ms) => {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    
    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
};

module.exports = {
    calculateSuccess,
    formatTime
};
