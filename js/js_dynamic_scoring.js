/* ==========================================================
   BRAWL ANALYTICS
   ADAPTIVE SCORING ENGINE

   Produces transparent category scores, contextual weights, and a
   smooth critical-risk penalty. The penalty is continuous around the
   former thresholds, with a hard ceiling only for truly extreme input.
========================================================== */

import { getDynamicWeights } from "./js_dynamic_weights.js";
import { getCorrectionFactor } from "./js_calibration.js";

function toScore100(value01) {
    return Math.max(0, Math.min(100, value01 * 100));
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// High risk when value is below threshold; sigmoid avoids a binary jump.
function lowValueRisk(value, threshold, steepness = 12) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return 1 / (1 + Math.exp((numeric - threshold) * steepness));
}

/**
 * Returns smooth penalty metadata for the former critical-failure cases.
 * `maxScore` is reserved for extreme values, not the ordinary threshold.
 */
export function getCriticalFailurePenalty(features) {
    const reasons = [];
    let multiplier = 1;

    const minOriginality = Math.min(
        Number(features.videoOriginality ?? 0.5),
        Number(features.ideaOriginality ?? 0.5)
    );
    const originalityRisk = lowValueRisk(minOriginality, 0.15, 18);
    if (originalityRisk > 0.08) {
        multiplier *= 1 - 0.85 * originalityRisk;
        reasons.push("Extremely low originality");
    }

    const formatRisk = lowValueRisk(features.historicalPerformance, 0.4, 12)
        * lowValueRisk(features.videoOriginality, 0.6, 10);
    if (formatRisk > 0.08) {
        multiplier *= 1 - 0.45 * formatRisk;
        reasons.push("Weak format track record combined with low originality");
    }

    const saturationRisk = lowValueRisk(features.trendAlignment, 0.2, 16)
        * lowValueRisk(features.competition, 0.25, 16);
    if (saturationRisk > 0.08) {
        multiplier *= 1 - 0.35 * saturationRisk;
        reasons.push("No trend alignment in a saturated market");
    }

    const qualityRisk = lowValueRisk(features.videoQuality ?? 0.5, 0.25, 16)
        * lowValueRisk(features.hookStrength ?? 0.5, 0.25, 16);
    if (qualityRisk > 0.08) {
        multiplier *= 1 - 0.35 * qualityRisk;
        reasons.push("Low production quality and poor hook");
    }

    let maxScore = null;
    if (minOriginality <= 0.05 && Math.max(
        Number(features.videoOriginality ?? 0),
        Number(features.ideaOriginality ?? 0)
    ) <= 0.10) {
        maxScore = 15;
    } else if (
        (features.videoQuality ?? 0.5) <= 0.05
        && (features.hookStrength ?? 0.5) <= 0.05
    ) {
        maxScore = 25;
    }

    return {
        multiplier: clamp(multiplier, 0.15, 1),
        reason: reasons.join("; "),
        maxScore
    };
}

export function calculateScoreBreakdown(features, format, calibrationStats = null) {
    let formatScore01 = Math.max(0, Math.min(1, features.historicalPerformance / 1.5));

    let calibrationInfo = null;
    if (calibrationStats?.ready) {
        const correction = getCorrectionFactor(calibrationStats, format);
        if (correction.trust > 0) {
            const nudge = Math.max(-0.3, Math.min(0.3, (correction.factor - 1) * correction.trust));
            formatScore01 = Math.max(0, Math.min(1, formatScore01 + nudge));
            calibrationInfo = {
                source: correction.source,
                sampleCount: correction.sampleCount,
                appliedNudge: nudge
            };
        }
    }

    const videoQuality = features.videoQuality ?? 0.5;
    const hookStrength = features.hookStrength ?? 0.5;
    const audioQuality = features.audioQuality ?? 0.5;
    const retentionRisk = features.retentionRisk ?? 0.5;
    const semanticReliability = clamp(Number(features.semanticTrendReliability ?? 1), 0.2, 1);
    const textReliability = clamp(Number(features.textSignalReliability ?? 1), 0, 1);

    const trendWeights = {
        alignment: 0.42,
        semantic: 0.48 * semanticReliability,
        lexical: 0.10 * textReliability
    };
    const trendWeightTotal = Object.values(trendWeights).reduce((sum, value) => sum + value, 0);
    const trendScore01 = trendWeightTotal > 0
        ? (
            (features.trendAlignment ?? 0.5) * trendWeights.alignment
            + (features.semanticTrendSimilarity ?? 0.5) * trendWeights.semantic
            + (features.googleTrendsOverlap ?? 0.3) * trendWeights.lexical
        ) / trendWeightTotal
        : 0.5;

    const retentionScore01 = clamp(
        (features.retentionSignal * 0.35)
        + (videoQuality * 0.25)
        + (hookStrength * 0.2)
        + (audioQuality * 0.1)
        + ((retentionRisk - 0.5) * 0.1),
        0,
        1
    );

    // Creator overlap is more stable than lexical Google overlap. The latter
    // contributes only a small, length-adjusted component.
    const overlapWeights = {
        creator: 0.8,
        google: 0.2 * textReliability
    };
    const overlapTotal = overlapWeights.creator + overlapWeights.google;
    const overlapScore01 = (
        (features.creatorTrendsOverlap ?? 0.5) * overlapWeights.creator
        + (features.googleTrendsOverlap ?? 0.3) * overlapWeights.google
    ) / overlapTotal;

    return {
        originality: { score: toScore100((features.videoOriginality + features.ideaOriginality) / 2) },
        trend: { score: toScore100(trendScore01) },
        format: { score: toScore100(formatScore01), calibration: calibrationInfo },
        channel: { score: toScore100(features.channelConsistency) },
        competition: { score: toScore100(features.competition) },
        retention: { score: toScore100(retentionScore01) },
        trendsOverlap: { score: toScore100(overlapScore01) }
    };
}

export function calculateViralityScore(features, format = "", calibrationStats = null) {
    const breakdown = calculateScoreBreakdown(features, format, calibrationStats);
    const weights = getDynamicWeights(features, format, calibrationStats);

    let score =
        breakdown.originality.score * weights.originality
        + breakdown.trend.score * weights.trend
        + breakdown.format.score * weights.format
        + breakdown.channel.score * weights.channel
        + breakdown.competition.score * weights.competition
        + breakdown.retention.score * weights.retention
        + breakdown.trendsOverlap.score * weights.trendsOverlap;

    score = Math.round(Math.max(0, Math.min(100, score)));

    const criticalPenalty = getCriticalFailurePenalty(features);
    score = Math.round(score * criticalPenalty.multiplier);
    if (criticalPenalty.maxScore !== null) {
        score = Math.min(score, criticalPenalty.maxScore);
    }

    return score;
}

export function getScoreQualitative(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Strong";
    if (score >= 55) return "Good";
    if (score >= 40) return "Moderate";
    if (score >= 25) return "Weak";
    return "Poor";
}

export function getScoreCategory(score) {
    if (score >= 85) return { label: "High potential", icon: "↗" };
    if (score >= 70) return { label: "Strong potential", icon: "↑" };
    if (score >= 55) return { label: "Good potential", icon: "→" };
    if (score >= 40) return { label: "Moderate potential", icon: "→" };
    if (score >= 25) return { label: "Low potential", icon: "↓" };
    return { label: "Very low potential", icon: "↘" };
}
