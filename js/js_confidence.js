/* ==========================================================
   BRAWL ANALYTICS
   CONFIDENCE MODULE — v3

   Calcola la confidence (0-100) indipendentemente dallo score.
   Novità: include un fattore "learnedAccuracy" basato sulle
   statistiche reali di errore accumulate (js_calibration.js) —
   più il motore ha predizioni risolte per quel formato, più la
   confidence dichiarata è "guadagnata" sui dati reali invece che
   stimata a priori.
========================================================== */

import { getFormatStatistics } from "./js_channel_profile.js";
import { getTypicalErrorSpread } from "./js_calibration.js";

function dataVolumeConfidence(profile) {
    const n = profile?.totalVideos || 0;
    // Ridotti i threshold per permettere canali con meno video di avere alta confidence
    if (n >= 10) return 1.0;
    if (n >= 5) return 0.75;
    if (n >= 3) return 0.55;
    if (n >= 2) return 0.4;
    return 0.25;
}

function formatHistoryConfidence(format, profile) {
    const stats = getFormatStatistics(profile, format);
    if (!stats || stats.videoCount === 0) return 0.35;
    // Rimosso il blocco minimo: basta 2+ video per avere alta confidence
    if (stats.videoCount >= 2) return 1.0;
    return 0.55;
}

function historicalSimilarityConfidence(features, channelProfile, proposal) {
    if (!channelProfile?.historicalVideos?.length) return 0.3;

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
 * Quanto possiamo fidarci delle statistiche di calibrazione per questo
 * formato: cresce con il numero di predizioni risolte, e diminuisce se
 * lo spread tipico dell'errore è alto (formato storicamente imprevedibile).
 */
function learnedAccuracyConfidence(calibrationStats, format) {
    if (!calibrationStats?.ready) return 0.3;

    const formatStats = calibrationStats.byFormat[format];
    const sampleCount = formatStats?.sampleCount ?? calibrationStats.global.sampleCount;
    const spread = getTypicalErrorSpread(calibrationStats, format);

    const sampleTrust = Math.min(1, sampleCount / 5); // Ridotto da 15 a 5 per formati con pochi video
    const spreadPenalty = Math.max(0, 1 - spread); // spread alto → penalità

    return Math.max(0.2, Math.min(1, sampleTrust * 0.7 + spreadPenalty * 0.3));
}

export function calculateConfidence(features, channelProfile, proposal, calibrationStats = null) {
    const factors = {
        dataVolume: dataVolumeConfidence(channelProfile),
        formatHistory: formatHistoryConfidence(proposal.format, channelProfile),
        channelConsistency: features.channelConsistency,
        historicalSimilarity: historicalSimilarityConfidence(features, channelProfile, proposal),
        learnedAccuracy: learnedAccuracyConfidence(calibrationStats, proposal.format)
    };

    const weights = {
        dataVolume: 0.18,
        formatHistory: 0.20,
        channelConsistency: 0.14,
        historicalSimilarity: 0.20,
        learnedAccuracy: 0.28
    };

    const weighted = Object.keys(factors).reduce((sum, key) => sum + factors[key] * weights[key], 0);
    return Math.round(Math.max(0, Math.min(1, weighted)) * 100);
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

    return {
        dataVolume: {
            score: Math.round(dataVolumeConfidence(channelProfile) * 100),
            label: "Historical Data",
            description: channelProfile.totalVideos >= 30 ? "Strong historical data available" : "Limited historical data"
        },
        formatHistory: {
            score: Math.round(formatHistoryConfidence(proposal.format, channelProfile) * 100),
            label: "Format History",
            description: `Based on videos classified under "${proposal.format}"`
        },
        channelConsistency: {
            score: Math.round(features.channelConsistency * 100),
            label: "Channel Consistency"
        },
        historicalSimilarity: {
            score: Math.round(historicalSimilarityConfidence(features, channelProfile, proposal) * 100),
            label: "Historical Similarity"
        },
        learnedAccuracy: {
            score: Math.round(learnedAccuracyConfidence(calibrationStats, proposal.format) * 100),
            label: "Learned Accuracy",
            description: formatStats
                ? `Calibrated on ${formatStats.sampleCount} resolved predictions for this format`
                : "Not enough resolved predictions yet for this format — using channel-wide defaults"
        }
    };
}