/* ==========================================================
   BRAWL ANALYTICS
   VIEW PREDICTION MODULE — v3 (parte del Livello 5)

   Stima l'intervallo di views atteso. Resta interamente
   deterministico e in spazio lineare (NIENTE distribuzione
   log-normale, NIENTE bootstrap): baseline dai video simili +
   moltiplicatore da feature + correzione da calibrazione reale +
   ampiezza dell'intervallo guidata dalla confidence e, quando
   disponibile, dallo spread di errore realmente osservato.
========================================================== */

import { getCorrectionFactor, getTypicalErrorSpread } from "./js_calibration.js";

const RECENCY_HALF_LIFE_DAYS = 120;
const MAX_BASELINE_MULTIPLIER = 2.2;
const MAX_RANGE_WIDTH = 2.0;
const MIN_RANGE_WIDTH = 1.2;

function recencyWeight(publishedAtIso, now) {
    if (!publishedAtIso) return 0.6; // nessuna data nota: peso neutro-medio
    const publishedAt = new Date(publishedAtIso).getTime();
    if (Number.isNaN(publishedAt)) return 0.6;

    const days = Math.abs(now - publishedAt) / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

function getPercentile(values, percentile) {
    if (!values.length) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const rank = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);

    if (lower === upper) return sorted[lower];

    const weight = rank - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

/**
 * Trova i video storici più simili alla proposta, pesati per: match
 * di formato, fit storico dichiarato dall'AI, freschezza del topic e
 * recency (video più vecchi contano meno).
 */
function findSimilarVideosScored(features, channelProfile, proposal, now) {
    if (!channelProfile?.historicalVideos?.length) return [];

    return channelProfile.historicalVideos
        .map(video => {
            let similarity = 0;

            if (video.format === proposal.format) similarity += 0.45;
            if (features.historicalFit >= 0.75) similarity += 0.3;
            else if (features.historicalFit >= 0.45) similarity += 0.15;

            similarity += (1 - features.topicFreshness) * 0.2;
            similarity *= recencyWeight(video.publishedAt, now);

            return { video, similarity };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .filter(item => item.similarity >= 0.35)
        .slice(0, 8);
}

function findSimilarVideos(features, channelProfile, proposal, now) {
    return findSimilarVideosScored(features, channelProfile, proposal, now).map(item => item.video);
}

/**
 * Baseline pesata per similarity con un cap anti-outlier basato sul
 * P75 del pool storico, più conservativa dei casi virali fuori scala.
 */
function calculateBaseline(scoredSimilarVideos, channelProfile) {
    if (!scoredSimilarVideos?.length) {
        return channelProfile.averageViews > 0 ? channelProfile.averageViews : 100;
    }

    const views = scoredSimilarVideos
        .map(item => Number(item.video?.views || 0))
        .filter(value => value > 0);

    if (views.length === 0) {
        return channelProfile.averageViews > 0 ? channelProfile.averageViews : 100;
    }

    const sorted = [...views].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const p75 = getPercentile(sorted, 75);

    const totalWeight = scoredSimilarVideos.reduce((sum, item) => sum + Math.max(0.1, item.similarity || 0.1), 0);
    const weightedViews = scoredSimilarVideos.reduce((sum, item) => {
        const weight = Math.max(0.1, item.similarity || 0.1);
        return sum + (Number(item.video?.views || 0) * weight);
    }, 0);

    const weightedAverage = totalWeight > 0 ? weightedViews / totalWeight : median;
    // Reduced cap multipliers for more conservative predictions
    const cap = Math.max(1000, Math.round(Math.max(median * 1.8, p75 * 1.15, (channelProfile?.averageViews || 1000) * 1.15)));

    return Math.min(weightedAverage, cap);
}

/**
 * Moltiplicatore lineare che sposta il baseline in base alle feature
 * qualitative della proposta, ma con impatto più ridotto e clamp stretto.
 * Reduced impact range for more conservative predictions.
 */
function calculatePerformanceMultiplier(features) {
    const videoQuality = features.videoQuality ?? 0.5;
    const hookStrength = features.hookStrength ?? 0.5;
    const audioQuality = features.audioQuality ?? 0.5;
    const retentionRisk = features.retentionRisk ?? 0.5;

    const impact =
        (features.videoOriginality - 0.5) * 0.10 +
        (features.trendAlignment - 0.5) * 0.06 +
        (Math.min(1.5, features.historicalPerformance) - 1.0) * 0.08 +
        (features.innovation - 0.5) * 0.05 +
        (0.5 - features.competition) * 0.04 +
        (features.retentionSignal - 0.5) * 0.05 +
        (features.googleTrendsOverlap - 0.3) * 0.03 +
        (videoQuality - 0.5) * 0.18 +
        (hookStrength - 0.5) * 0.12 +
        (audioQuality - 0.5) * 0.05 +
        (retentionRisk - 0.5) * 0.08;

    return Math.max(0.55, Math.min(1.50, 1.0 + impact));
}

function getBaselineCap(channelProfile, scoredSimilarVideos, baseline) {
    const averageViews = Math.max(channelProfile?.averageViews || 1000, 1000);
    const observedViews = scoredSimilarVideos.reduce((max, item) => {
        const views = Number(item.video?.views || 0);
        return views > max ? views : max;
    }, 0);

    const p75 = getPercentile(
        scoredSimilarVideos.map(item => Number(item.video?.views || 0)).filter(value => value > 0),
        75
    );
    // Reduced multipliers for more conservative baseline cap
    const channelCap = Math.max(1000, averageViews * 1.15, p75 * 1.15);
    const observedCap = observedViews > 0 ? Math.max(channelCap, observedViews * 1.05) : channelCap;

    return Math.max(1000, Math.min(observedCap, channelCap + 3000));
}

/**
 * Ampiezza dell'intervallo (fattore moltiplicativo, non additivo):
 * combina confidence, numero di simili trovati, e — quando affidabile
 * — lo spread di errore REALMENTE osservato per quel formato invece
 * di una stima indovinata. L'ampiezza è resa più stretta e asimmetrica.
 */
function calculateRangeWidth(confidence, similarVideoCount, channelProfile, calibrationStats, format) {
    const normalizedConfidence = Math.max(0, Math.min(1, confidence / 100));
    let downside = 1.16 + (1 - normalizedConfidence) * 0.18;
    let upside = 1.08 + (1 - normalizedConfidence) * 0.10;

    if (similarVideoCount < 3) {
        downside *= 1.06;
        upside *= 1.03;
    } else if (similarVideoCount < 5) {
        downside *= 1.03;
        upside *= 1.02;
    }

    if (channelProfile.totalVideos < 2) {
        downside *= 1.04;
        upside *= 1.02;
    }

    if (calibrationStats?.ready) {
        const spread = getTypicalErrorSpread(calibrationStats, format);
        const correction = getCorrectionFactor(calibrationStats, format);
        const calibratedDownside = Math.max(1.1, 1 + spread * 0.35);
        const calibratedUpside = Math.max(1.05, 1 + spread * 0.22);
        downside = downside * (1 - correction.trust) + calibratedDownside * correction.trust;
        upside = upside * (1 - correction.trust) + calibratedUpside * correction.trust;
    }

    return {
        width: Math.max(MIN_RANGE_WIDTH, Math.min(MAX_RANGE_WIDTH, (downside + upside) / 2)),
        downside: Math.max(MIN_RANGE_WIDTH, Math.min(MAX_RANGE_WIDTH, downside)),
        upside: Math.max(1.08, Math.min(1.45, upside))
    };
}

/**
 * Predice il range [min, max] di views. calibrationStats è opzionale
 * (output di js_calibration.js::loadCalibrationStats); se assente il
 * motore usa i default prudenti — nessuna rottura per canali nuovi.
 */
export function predictViewRange(features, channelProfile, proposal, confidence, calibrationStats = null) {
    const now = Date.now();
    const scoredSimilarVideos = findSimilarVideosScored(features, channelProfile, proposal, now);
    const similarVideos = scoredSimilarVideos.map(item => item.video);

    let baseline = calculateBaseline(scoredSimilarVideos, channelProfile);
    baseline *= calculatePerformanceMultiplier(features);

    // Correzione da calibrazione: sposta il baseline verso ciò che il
    // canale ha realmente mostrato in passato per questo formato,
    // ma con un peso ridotto e un cap realistico per evitare picchi
    // da dati sporadici o da valori troppo ottimistici.
    if (calibrationStats?.ready) {
        const correction = getCorrectionFactor(calibrationStats, proposal.format);
        baseline *= 1 + (correction.factor - 1) * correction.trust * 0.6;
    }

    baseline = Math.min(baseline, getBaselineCap(channelProfile, scoredSimilarVideos, baseline));

    const range = calculateRangeWidth(confidence, scoredSimilarVideos.length, channelProfile, calibrationStats, proposal.format);

    const minViews = Math.round(baseline / range.downside);
    const maxViews = Math.round(baseline * range.upside);

    const floor = Math.max(50, (channelProfile.averageViews || 0) * 0.05);

    return {
        min: Math.max(floor, minViews),
        max: Math.max(floor * 2, maxViews),
        baseline: Math.round(baseline),
        rangeWidth: range.width,
        downsideMultiplier: range.downside,
        upsideMultiplier: range.upside,
        similarVideoCount: scoredSimilarVideos.length
    };
}

export function formatViewCount(views) {
    if (views >= 1000000) return `${(views / 1000000).toFixed(views % 1000000 === 0 ? 0 : 1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(views % 1000 === 0 ? 0 : 1)}K`;
    return `${Math.round(views)}`;
}

export function formatViewRange(range) {
    return `${formatViewCount(range.min)} – ${formatViewCount(range.max)}`;
}

export function getComparableVideos(proposal, channelProfile) {
    if (!channelProfile?.historicalVideos) return [];
    const matches = channelProfile.historicalVideos.filter(v => v.format === proposal.format);
    // Ridotto da 5 a 2 per formati con pochi video
    const pool = matches.length >= 2 ? matches : channelProfile.historicalVideos;
    return [...pool].sort((a, b) => b.views - a.views).slice(0, 5);
}

export function calculatePredictionPercentile(range, channelProfile) {
    if (!channelProfile?.historicalVideos?.length) {
        return 50;
    }

    const views = channelProfile.historicalVideos.map(v => v.views).filter(v => v > 0).sort((a, b) => a - b);
    if (views.length === 0) return 50;

    const baseline = range.baseline;

    if (baseline >= views[views.length - 1]) {
        return 100;
    }

    if (baseline <= views[0]) {
        return 0;
    }

    let countBelow = 0;
    for (let i = 0; i < views.length; i++) {
        if (views[i] <= baseline) {
            countBelow = i + 1;
        } else {
            break;
        }
    }

    return Math.round((countBelow / views.length) * 100);
}

export function getPredictionContext(range, channelProfile, proposal) {
    try {
        const comparableVideos = getComparableVideos(proposal, channelProfile);
        const percentile = calculatePredictionPercentile(range, channelProfile);

        return {
            baseline: range.baseline,
            min: range.min,
            max: range.max,
            percentile,
            comparableVideos: comparableVideos.map(v => ({ title: v.title, views: v.views, format: v.format })),
            comparison: percentile >= 70 ? "Above average" : percentile >= 40 ? "Around average" : "Below average"
        };
    } catch (error) {
        console.error("Prediction Context Calculation Error:", error);
        // Return fallback values on error
        return {
            baseline: range.baseline || 0,
            min: range.min || 0,
            max: range.max || 0,
            percentile: 50, // Fallback to middle percentile
            comparableVideos: [],
            comparison: "Around average"
        };
    }
}