/* ==========================================================
   BRAWL ANALYTICS
   ADAPTIVE SCORING ENGINE — v3 (Livello 4)

   Sostituisce i moltiplicatori sequenziali fissi con una media
   pesata dei sotto-punteggi, dove i pesi arrivano da
   js_dynamic_weights.js (contestuali) e il sotto-punteggio
   "format" viene corretto dal fattore di calibrazione appreso
   (js_calibration.js), quando disponibile e affidabile.

   Nessuna black-box: ogni sotto-punteggio e ogni peso sono
   ispezionabili in calculateScoreBreakdown().
========================================================== */

import { getDynamicWeights } from "./js_dynamic_weights.js";
import { getCorrectionFactor } from "./js_calibration.js";

function toScore100(value01) {
    return Math.max(0, Math.min(100, value01 * 100));
}

/**
 * Individua condizioni di fallimento critico che impongono un tetto
 * massimo al punteggio, indipendentemente dalla media pesata.
 */
function checkCriticalFailures(features) {
    if (features.videoOriginality <= 0.15 && features.ideaOriginality <= 0.15) {
        return { reason: "Extremely low originality", maxScore: 15 };
    }

    // "Format terribile" è affidabile solo se historicalPerformance
    // riflette dati reali (non il default neutro 0.5): qui è basso
    // per davvero solo se il canale ha già video in quel formato.
    if (features.historicalPerformance <= 0.25 && features.videoOriginality < 0.6) {
        return { reason: "Weak format track record combined with low originality", maxScore: 30 };
    }

    if (features.trendAlignment <= 0.2 && features.competition <= 0.25) {
        return { reason: "No trend alignment in a saturated market", maxScore: 25 };
    }

    if ((features.videoQuality ?? 0.5) <= 0.25 && (features.hookStrength ?? 0.5) <= 0.25) {
        return { reason: "Low production quality and poor hook", maxScore: 25 };
    }

    return null;
}

/**
 * Breakdown per sotto-categoria: ogni voce ha uno score 0-100 e,
 * quando applicabile, il dettaglio della correzione di calibrazione
 * usata (per la UI "spiega la predizione").
 */
export function calculateScoreBreakdown(features, format, calibrationStats = null) {

    let formatScore01 = Math.max(0, Math.min(1, features.historicalPerformance / 1.5));

    let calibrationInfo = null;
    if (calibrationStats?.ready) {
        const correction = getCorrectionFactor(calibrationStats, format);
        if (correction.trust > 0) {
            // Nudge proporzionale alla fiducia: più campioni abbiamo per
            // questo formato, più il punteggio si sposta verso ciò che
            // il canale ha realmente mostrato in passato.
            const nudge = Math.max(-0.3, Math.min(0.3, (correction.factor - 1) * correction.trust));
            formatScore01 = Math.max(0, Math.min(1, formatScore01 + nudge));
            calibrationInfo = { source: correction.source, sampleCount: correction.sampleCount, appliedNudge: nudge };
        }
    }

    const videoQuality = features.videoQuality ?? 0.5;
    const hookStrength = features.hookStrength ?? 0.5;
    const audioQuality = features.audioQuality ?? 0.5;
    const retentionRisk = features.retentionRisk ?? 0.5;

    const retentionScore01 = Math.max(
        0,
        Math.min(
            1,
            (features.retentionSignal * 0.35) +
            (videoQuality * 0.25) +
            (hookStrength * 0.2) +
            (audioQuality * 0.1) +
            ((retentionRisk - 0.5) * 0.1)
        )
    );

    return {
        originality: { score: toScore100((features.videoOriginality + features.ideaOriginality) / 2) },
        trend: { score: toScore100((features.trendAlignment + features.semanticTrendSimilarity) / 2) },
        format: { score: toScore100(formatScore01), calibration: calibrationInfo },
        channel: { score: toScore100(features.channelConsistency) },
        competition: { score: toScore100(features.competition) },
        retention: { score: toScore100(retentionScore01) },
        trendsOverlap: { score: toScore100((features.creatorTrendsOverlap + features.googleTrendsOverlap) / 2) }
    };
}

/**
 * Punteggio finale 0-100: media pesata (pesi dinamici contestuali) dei
 * sotto-punteggi, poi vincolata da eventuali critical failure.
 */
export function calculateViralityScore(features, format = "", calibrationStats = null) {
    const breakdown = calculateScoreBreakdown(features, format, calibrationStats);
    const weights = getDynamicWeights(features, format);

    let score =
        breakdown.originality.score * weights.originality +
        breakdown.trend.score * weights.trend +
        breakdown.format.score * weights.format +
        breakdown.channel.score * weights.channel +
        breakdown.competition.score * weights.competition +
        breakdown.retention.score * weights.retention +
        breakdown.trendsOverlap.score * weights.trendsOverlap;

    score = Math.round(Math.max(0, Math.min(100, score)));

    const criticalFailure = checkCriticalFailures(features);
    if (criticalFailure) {
        return Math.min(score, criticalFailure.maxScore);
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