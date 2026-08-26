/* ==========================================================
   BRAWL ANALYTICS
   CONFIDENCE MODULE — v4

   Confidence is earned from historical sample size, format history,
   channel consistency, calibration accuracy, and the reliability of
   the qualitative AI input.
========================================================== */

import { getFormatStatistics } from "./js_channel_profile.js";
import { getTypicalErrorSpread } from "./js_calibration.js";

const SAMPLE_SHRINKAGE_K = 9;
const AI_DEGRADED_PENALTY_POINTS = 18;

function sampleTrust(sampleCount) {
    const n = Math.max(0, Number(sampleCount) || 0);
    return n / (n + SAMPLE_SHRINKAGE_K);
}

function dataVolumeConfidence(profile) {
    return sampleTrust(profile?.totalVideos || 0);
}

function formatHistoryConfidence(format, profile) {
    const stats = getFormatStatistics(profile, format);
    if (!stats || stats.videoCount <= 0) return 0;
    return sampleTrust(stats.videoCount);
}

function historicalSimilarityConfidence(features, channelProfile, proposal) {
    if (!channelProfile?.historicalVideos?.length) return 0;

    const formatMatches = channelProfile.historicalVideos.filter(v => v.format === proposal.format);
    const formatRatio = formatMatches.length / channelProfile.historicalVideos.length;

    return Math.min(1.0,
        formatRatio * 0.4 +
        features.historicalFit * 0.3 +
        (1 - features.topicFreshness) * 0.15 +
        features.formatStability * 0.15
    );
}

/**
 * Confidence in learned calibration follows the same n/(n+k) curve as
 * the historical feature calculations. A small sample never saturates.
 */
function learnedAccuracyConfidence(calibrationStats, format) {
    if (!calibrationStats?.ready) return 0;

    const formatStats = calibrationStats.byFormat?.[format];
    const sampleCount = formatStats?.sampleCount ?? calibrationStats.global?.sampleCount ?? 0;
    const spread = getTypicalErrorSpread(calibrationStats, format);
    const spreadPenalty = Math.max(0, 1 - spread);

    return Math.max(0.05, Math.min(1,
        sampleTrust(sampleCount) * 0.7 + spreadPenalty * 0.3
    ));
}

export function calculateConfidence(features, channelProfile, proposal, calibrationStats = null, aiDegraded = features?.aiDegraded) {
    const qualitativeAiDegraded = Boolean(aiDegraded);
    const factors = {
        dataVolume: dataVolumeConfidence(channelProfile),
        formatHistory: formatHistoryConfidence(proposal.format, channelProfile),
        channelConsistency: features.channelConsistency,
        historicalSimilarity: historicalSimilarityConfidence(features, channelProfile, proposal),
        learnedAccuracy: learnedAccuracyConfidence(calibrationStats, proposal.format)
    };

    const weights = {
        dataVolume: 0.22,
        formatHistory: 0.22,
        channelConsistency: 0.16,
        historicalSimilarity: 0.20,
        learnedAccuracy: 0.20
    };

    const weighted = Object.keys(factors).reduce((sum, key) => sum + factors[key] * weights[key], 0);
    const aiPenalty = qualitativeAiDegraded ? AI_DEGRADED_PENALTY_POINTS / 100 : 0;

    return Math.round(Math.max(0, Math.min(1, weighted - aiPenalty)) * 100);
}

export function getConfidenceQualitative(confidence) {
    if (confidence >= 85) return "Very high";
    if (confidence >= 70) return "High";
    if (confidence >= 55) return "Moderate";
    if (confidence >= 40) return "Low";
    return "Very low";
}

export function getConfidenceFactors(features, channelProfile, proposal, calibrationStats = null) {
    const formatStats = calibrationStats?.byFormat?.[proposal.format];
    const historicalSampleCount = Math.max(0, Number(channelProfile?.totalVideos) || 0);
    const formatSampleCount = Math.max(0, Number(getFormatStatistics(channelProfile, proposal.format)?.videoCount) || 0);
    const calibrationSampleCount = Math.max(
        0,
        Number(formatStats?.sampleCount ?? calibrationStats?.global?.sampleCount) || 0
    );

    return {
        dataVolume: {
            score: Math.round(dataVolumeConfidence(channelProfile) * 100),
            sampleCount: historicalSampleCount,
            label: "Historical Data",
            description: historicalSampleCount > 0
                ? `Based on ${historicalSampleCount} historical video${historicalSampleCount === 1 ? "" : "s"}`
                : "No historical videos loaded yet"
        },
        formatHistory: {
            score: Math.round(formatHistoryConfidence(proposal.format, channelProfile) * 100),
            sampleCount: formatSampleCount,
            label: "Format History",
            description: formatSampleCount > 0
                ? `Based on ${formatSampleCount} video${formatSampleCount === 1 ? "" : "s"} classified under \"${proposal.format}\"`
                : `No historical videos classified under \"${proposal.format}\"`
        },
        channelConsistency: {
            score: Math.round((features.channelConsistency ?? 0) * 100),
            label: "Channel Consistency"
        },
        historicalSimilarity: {
            score: Math.round(historicalSimilarityConfidence(features, channelProfile, proposal) * 100),
            label: "Historical Similarity"
        },
        learnedAccuracy: {
            score: Math.round(learnedAccuracyConfidence(calibrationStats, proposal.format) * 100),
            sampleCount: calibrationSampleCount,
            label: "Learned Accuracy",
            description: calibrationSampleCount > 0
                ? `Calibrated on ${calibrationSampleCount} resolved prediction${calibrationSampleCount === 1 ? "" : "s"}`
                : "No resolved predictions yet — using conservative defaults"
        },
        aiReliability: {
            score: features.aiDegraded ? 20 : 100,
            label: "Qualitative AI Reliability",
            description: features.aiDegraded
                ? `AI analysis used fallback values; confidence reduced by ${AI_DEGRADED_PENALTY_POINTS} points`
                : "All qualitative AI fields were returned and validated"
        }
    };
}

export function getConfidenceSampleSummary(features, channelProfile, calibrationStats = null, aiDegraded = features?.aiDegraded) {
    const videoCount = Math.max(0, Number(channelProfile?.totalVideos) || 0);
    const resolvedCount = Math.max(0, Number(calibrationStats?.global?.sampleCount) || 0);
    const aiNote = aiDegraded ? " Qualitative AI fallback reduced confidence." : "";
    return `Based on ${videoCount} historical video${videoCount === 1 ? "" : "s"}`
        + (resolvedCount > 0 ? ` and ${resolvedCount} resolved prediction${resolvedCount === 1 ? "" : "s"}.` : ".")
        + aiNote;
}
