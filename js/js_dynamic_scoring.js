/* ==========================================================
   BRAWL ANALYTICS
   DYNAMIC SCORING ENGINE

   Calculates Virality Score using multipliers and rule-based logic.
   NOT a weighted average - uses sequential multipliers with critical failures.
========================================================== */

/**
 * Calculates the Virality Score (0-100) from extracted features.
 * Uses multiplier-based approach with critical failure caps.
 */
export function calculateViralityScore(features) {
    // Step 1: Check for critical failures first
    const criticalFailure = checkCriticalFailures(features);
    if (criticalFailure) {
        return criticalFailure.maxScore;
    }
    
    // Step 2: Start with base score
    let score = 50; // Base score starting point
    
    // Step 3: Apply multipliers sequentially
    score = applyOriginalityMultiplier(score, features);
    score = applyTrendMultiplier(score, features);
    score = applyFormatMultiplier(score, features);
    score = applyChannelMultiplier(score, features);
    score = applyCompetitionMultiplier(score, features);
    score = applyInnovationMultiplier(score, features);
    
    // Step 4: Apply final scaling
    score = applyFinalScaling(score, features);
    
    // Step 5: Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Checks for critical failures that cap the maximum score.
 * These conditions prevent high scores regardless of other factors.
 */
function checkCriticalFailures(features) {
    // Critical failure: Completely copied video
    if (features.videoOriginality <= 0.2 && features.ideaOriginality <= 0.2) {
        return { hasFailure: true, reason: "Completely copied content", maxScore: 15 };
    }
    
    // Critical failure: Completely copied video with poor format
    if (features.videoOriginality <= 0.2 && features.historicalPerformance <= 0.3) {
        return { hasFailure: true, reason: "Copied content with poor format", maxScore: 10 };
    }
    
    // Critical failure: Format with terrible historical performance
    if (features.historicalPerformance <= 0.2) {
        return { hasFailure: true, reason: "Format with terrible historical performance", maxScore: 25 };
    }
    
    // Critical failure: No trend alignment AND high competition
    if (features.trendAlignment <= 0.2 && features.competition <= 0.3) {
        return { hasFailure: true, reason: "No trend alignment in saturated market", maxScore: 20 };
    }
    
    // Critical failure: Very low originality
    if (features.videoOriginality <= 0.1) {
        return { hasFailure: true, reason: "Extremely low originality", maxScore: 20 };
    }
    
    return null;
}

/**
 * Applies originality multiplier.
 * Low originality severely limits the score.
 */
function applyOriginalityMultiplier(score, features) {
    const avgOriginality = (features.videoOriginality + features.ideaOriginality) / 2;
    
    if (avgOriginality <= 0.3) {
        // Severe penalty for low originality
        return score * 0.4;
    } else if (avgOriginality <= 0.5) {
        // Moderate penalty
        return score * 0.7;
    } else if (avgOriginality >= 0.9) {
        // Bonus for high originality
        return score * 1.2;
    }
    
    return score;
}

/**
 * Applies trend multiplier.
 * Effect depends on format strength (dynamic weighting).
 */
function applyTrendMultiplier(score, features) {
    const trendScore = (features.trendAlignment + features.semanticTrendSimilarity) / 2;
    
    // If format is strong, trend matters less
    if (features.formatStrength >= 0.8) {
        if (trendScore >= 0.7) return score * 1.1;
        if (trendScore <= 0.3) return score * 0.9;
    }
    // If format is weak, trend matters more
    else if (features.formatStrength <= 0.4) {
        if (trendScore >= 0.7) return score * 1.3;
        if (trendScore <= 0.3) return score * 0.7;
    }
    // Normal format strength
    else {
        if (trendScore >= 0.7) return score * 1.2;
        if (trendScore <= 0.3) return score * 0.8;
    }
    
    return score;
}

/**
 * Applies format multiplier.
 * Historical performance is a strong signal.
 */
function applyFormatMultiplier(score, features) {
    // Format strength is the primary factor
    if (features.historicalPerformance >= 1.5) {
        return score * 1.4;
    } else if (features.historicalPerformance >= 1.2) {
        return score * 1.25;
    } else if (features.historicalPerformance >= 0.8) {
        return score * 1.1;
    } else if (features.historicalPerformance <= 0.3) {
        return score * 0.5;
    } else if (features.historicalPerformance <= 0.5) {
        return score * 0.7;
    }
    
    return score;
}

/**
 * Applies channel multiplier.
 * Consistency affects reliability of predictions.
 */
function applyChannelMultiplier(score, features) {
    if (features.channelConsistency >= 0.8) {
        return score * 1.1;
    } else if (features.channelConsistency <= 0.3) {
        return score * 0.9;
    }
    
    return score;
}

/**
 * Applies competition multiplier.
 * High competition reduces potential.
 */
function applyCompetitionMultiplier(score, features) {
    if (features.competition <= 0.2) {
        // High competition - severe penalty
        return score * 0.7;
    } else if (features.competition <= 0.4) {
        // Moderate competition
        return score * 0.85;
    } else if (features.competition >= 0.8) {
        // Low competition - bonus
        return score * 1.15;
    }
    
    return score;
}

/**
 * Applies innovation multiplier.
 */
function applyInnovationMultiplier(score, features) {
    if (features.innovation >= 0.8) {
        return score * 1.1;
    } else if (features.innovation <= 0.2) {
        return score * 0.9;
    }
    
    return score;
}

/**
 * Applies final scaling to ensure realistic distribution.
 */
function applyFinalScaling(score, features) {
    // Apply slight compression to prevent extreme values
    // This makes it harder to reach 100 or 0
    const compressed = 50 + (score - 50) * 0.9;
    
    return compressed;
}

/**
 * Calculates a detailed score breakdown for explainability.
 */
export function calculateScoreBreakdown(features) {
    const criticalFailure = checkCriticalFailures(features);
    
    if (criticalFailure) {
        return {
            criticalFailure: {
                reason: criticalFailure.reason,
                maxScore: criticalFailure.maxScore
            },
            originality: { score: 0, multiplier: 0 },
            trend: { score: 0, multiplier: 0 },
            format: { score: 0, multiplier: 0 },
            channel: { score: 0, multiplier: 0 },
            competition: { score: 0, multiplier: 0 },
            innovation: { score: 0, multiplier: 0 }
        };
    }
    
    return {
        criticalFailure: null,
        originality: {
            score: Math.round(((features.videoOriginality + features.ideaOriginality) / 2) * 100),
            multiplier: getOriginalityMultiplier(features)
        },
        trend: {
            score: Math.round(((features.trendAlignment + features.semanticTrendSimilarity) / 2) * 100),
            multiplier: getTrendMultiplier(features)
        },
        format: {
            score: Math.round(features.historicalPerformance * 100),
            multiplier: getFormatMultiplier(features)
        },
        channel: {
            score: Math.round(features.channelConsistency * 100),
            multiplier: getChannelMultiplier(features)
        },
        competition: {
            score: Math.round(features.competition * 100),
            multiplier: getCompetitionMultiplier(features)
        },
        innovation: {
            score: Math.round(features.innovation * 100),
            multiplier: getInnovationMultiplier(features)
        }
    };
}

function getOriginalityMultiplier(features) {
    const avgOriginality = (features.videoOriginality + features.ideaOriginality) / 2;
    if (avgOriginality <= 0.3) return 0.4;
    if (avgOriginality <= 0.5) return 0.7;
    if (avgOriginality >= 0.9) return 1.2;
    return 1.0;
}

function getTrendMultiplier(features) {
    const trendScore = (features.trendAlignment + features.semanticTrendSimilarity) / 2;
    if (features.formatStrength >= 0.8) {
        if (trendScore >= 0.7) return 1.1;
        if (trendScore <= 0.3) return 0.9;
    } else if (features.formatStrength <= 0.4) {
        if (trendScore >= 0.7) return 1.3;
        if (trendScore <= 0.3) return 0.7;
    } else {
        if (trendScore >= 0.7) return 1.2;
        if (trendScore <= 0.3) return 0.8;
    }
    return 1.0;
}

function getFormatMultiplier(features) {
    if (features.historicalPerformance >= 1.5) return 1.4;
    if (features.historicalPerformance >= 1.2) return 1.25;
    if (features.historicalPerformance >= 0.8) return 1.1;
    if (features.historicalPerformance <= 0.3) return 0.5;
    if (features.historicalPerformance <= 0.5) return 0.7;
    return 1.0;
}

function getChannelMultiplier(features) {
    if (features.channelConsistency >= 0.8) return 1.1;
    if (features.channelConsistency <= 0.3) return 0.9;
    return 1.0;
}

function getCompetitionMultiplier(features) {
    if (features.competition <= 0.2) return 0.7;
    if (features.competition <= 0.4) return 0.85;
    if (features.competition >= 0.8) return 1.15;
    return 1.0;
}

function getInnovationMultiplier(features) {
    if (features.innovation >= 0.8) return 1.1;
    if (features.innovation <= 0.2) return 0.9;
    return 1.0;
}

/**
 * Gets a qualitative assessment of the score.
 */
export function getScoreQualitative(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Strong";
    if (score >= 55) return "Good";
    if (score >= 40) return "Moderate";
    if (score >= 25) return "Weak";
    return "Poor";
}

/**
 * Gets a score category for UI display.
 */
export function getScoreCategory(score) {
    if (score >= 85) return { label: "High potential", icon: "↗" };
    if (score >= 70) return { label: "Strong potential", icon: "↑" };
    if (score >= 55) return { label: "Good potential", icon: "→" };
    if (score >= 40) return { label: "Moderate potential", icon: "→" };
    if (score >= 25) return { label: "Low potential", icon: "↓" };
    return { label: "Very low potential", icon: "↘" };
}
