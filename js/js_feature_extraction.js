/* ==========================================================
   BRAWL ANALYTICS
   FEATURE EXTRACTION MODULE — v3 (Livello 2)

   Trasforma proposal + AI analysis + channel profile in feature
   numeriche 0-1 (o 0-1.5 per historicalPerformance, che può
   superare la media canale). Nessun calcolo di score qui: solo
   estrazione/normalizzazione.

   Novità v3 rispetto alla versione precedente:
   - retentionSignal e durationFit: dati già presenti nel Channel
     Profile ma mai collegati allo score, ora feature vere.
   - creatorTrendsOverlap: sovrapposizione deterministica tra la
     descrizione proposta e i format/keyword storici del canale.
   - googleTrendsOverlap: sovrapposizione testuale (parole in
     comune) tra descrizione e trend correnti — deterministico,
     nessun embedding.
   - formatStability: quanto il formato scelto ha una varianza di
     views bassa nel tempo (più stabile = più prevedibile).
========================================================== */

import { calculateChannelConsistency, getFormatStatistics } from "./js_channel_profile.js";

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "of", "in", "for", "on",
    "with", "at", "by", "from", "to", "and", "but", "or", "this", "that",
    "i", "you", "he", "she", "it", "we", "they", "my", "your"
]);

/**
 * Tokenizza una stringa in parole significative (>2 caratteri, senza
 * stop word), usata per tutte le sovrapposizioni testuali deterministiche.
 */
function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Jaccard overlap tra due insiemi di token: |intersezione| / |unione|.
 * Deterministico, zero costo, nessuna chiamata esterna.
 */
function jaccardOverlap(tokensA, tokensB) {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    setA.forEach(token => { if (setB.has(token)) intersection++; });

    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
}

export function extractFeatures(proposal, aiAnalysis, channelProfile, currentTrends = [], videoInsights = null) {
    const baseFeatures = {
        videoOriginality: normalizeOriginality(proposal.videoOriginality),
        ideaOriginality: normalizeOriginality(proposal.ideaOriginality),

        trendAlignment: normalizeTrendAlignment(aiAnalysis.trendAlignment),
        semanticTrendSimilarity: aiAnalysis.semanticTrendSimilarity ?? 0.5,

        formatStrength: calculateFormatStrength(proposal.format, channelProfile),
        formatSuitability: normalizeSuitability(aiAnalysis.formatSuitability),
        formatNovelty: normalizeLevel(aiAnalysis.formatNovelty),

        channelConsistency: calculateChannelConsistency(channelProfile),
        historicalPerformance: calculateHistoricalPerformance(proposal.format, channelProfile),
        historicalFit: normalizeHistoricalFit(aiAnalysis.historicalFit),

        innovation: normalizeLevel(aiAnalysis.innovation),
        competition: normalizeCompetition(aiAnalysis.competition),
        topicFreshness: normalizeLevel(aiAnalysis.topicFreshness),

        // ---- Nuove feature deterministiche v3 ----
        retentionSignal: calculateRetentionSignal(proposal.format, channelProfile),
        durationFit: calculateDurationFit(channelProfile),
        creatorTrendsOverlap: calculateCreatorTrendsOverlap(proposal, channelProfile),
        googleTrendsOverlap: calculateGoogleTrendsOverlap(proposal, currentTrends),
        formatStability: calculateFormatStability(proposal.format, channelProfile),

        multimediaFeatures: null
    };

    // Integrate video insights if available
    if (videoInsights) {
        baseFeatures.multimediaFeatures = {
            hookStrength: normalizeScore(videoInsights.hookStrength),
            visualClarity: normalizeScore(videoInsights.visualClarity),
            editingPace: normalizeEditingPace(videoInsights.editingPace),
            sceneChanges: normalizeCount(videoInsights.sceneChanges),
            averageShotDuration: normalizeDuration(videoInsights.averageShotDuration),
            deadMoments: normalizeCount(videoInsights.deadMoments),
            retentionRisk: normalizeRetentionRisk(videoInsights.retentionRisk),
            energyCurve: videoInsights.energyCurve || [],
            hasSubtitles: videoInsights.hasSubtitles || false,
            subtitleQuality: normalizeScore(videoInsights.subtitleQuality),
            textDensity: normalizeLevel(videoInsights.textDensity),
            audioQuality: normalizeScore(videoInsights.audioQuality),
            musicPresence: normalizePresence(videoInsights.musicPresence),
            voicePresence: normalizePresence(videoInsights.voicePresence),
            emotionLevel: normalizeScore(videoInsights.emotionLevel),
            surpriseMoments: normalizeCount(videoInsights.surpriseMoments),
            replayValue: normalizeScore(videoInsights.replayValue),
            visualOriginality: normalizeScore(videoInsights.visualOriginality),
            clarityOfObjective: normalizeScore(videoInsights.clarityOfObjective),
            hasCTA: videoInsights.hasCTA || false,
            endingStrength: normalizeScore(videoInsights.endingStrength),
            loopPotential: normalizeScore(videoInsights.loopPotential),
            thumbnailTimestamp: videoInsights.thumbnailTimestamp || 0,
            category: videoInsights.category || 'Other',
            estimatedDifficulty: normalizeLevel(videoInsights.estimatedDifficulty),
            contentComplexity: normalizeLevel(videoInsights.contentComplexity),
            overallQuality: normalizeScore(videoInsights.overallQuality),
            technicalIssues: videoInsights.technicalIssues || [],
            strengths: videoInsights.strengths || [],
            weaknesses: videoInsights.weaknesses || []
        };
    }

    return baseFeatures;
}

function normalizeOriginality(value) {
    const mapping = {
        "Completely original": 1.0, "Mostly original": 0.7,
        "Mostly reused": 0.3, "Inspired by another creator": 0.5,
        "Copy of another creator": 0.1
    };
    return mapping[value] ?? 0.5;
}

function normalizeTrendAlignment(alignment) {
    return { strong: 1.0, moderate: 0.6, weak: 0.3, none: 0.0 }[alignment] ?? 0.5;
}

function normalizeHistoricalFit(fit) {
    return { strong: 1.0, moderate: 0.6, weak: 0.3 }[fit] ?? 0.5;
}

function calculateFormatStrength(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    if (!stats || stats.videoCount === 0) return 0.5;

    const viewScore = Math.min(1.0, stats.averageViews / Math.max(1, channelProfile.averageViews));
    const countScore = Math.min(1.0, stats.videoCount / Math.max(1, channelProfile.totalVideos));
    return (viewScore * 0.7) + (countScore * 0.3);
}

function normalizeSuitability(suitability) {
    return { excellent: 1.0, good: 0.8, fair: 0.5, poor: 0.2 }[suitability] ?? 0.5;
}

function calculateHistoricalPerformance(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    if (!stats || stats.videoCount === 0) return 0.5;
    if (channelProfile.averageViews > 0) {
        return Math.min(1.5, stats.averageViews / channelProfile.averageViews);
    }
    return 0.5;
}

function normalizeLevel(level) {
    return { high: 1.0, medium: 0.5, low: 0.0 }[level] ?? 0.5;
}

function normalizeCompetition(competition) {
    return { low: 1.0, medium: 0.5, high: 0.0 }[competition] ?? 0.5;
}

/**
 * Confronta la retention media del formato scelto con la retention
 * media del canale. >0.5 = il formato trattiene meglio della media.
 */
function calculateRetentionSignal(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    if (!stats?.averageRetention || !channelProfile?.averageRetention) return 0.5;

    const ratio = stats.averageRetention / channelProfile.averageRetention;
    return Math.max(0, Math.min(1, 0.5 + (ratio - 1) * 0.8));
}

/**
 * Vicinanza tra durata media del canale e durata ideale calcolata
 * (channelProfile.idealDuration, già esistente ma prima inutilizzata).
 */
function calculateDurationFit(channelProfile) {
    if (!channelProfile?.averageDuration || !channelProfile?.idealDuration) return 0.5;
    const diff = Math.abs(channelProfile.averageDuration - channelProfile.idealDuration);
    return Math.max(0, 1 - diff / 30);
}

/**
 * Sovrapposizione deterministica tra la descrizione del video proposto
 * e i titoli storici del formato scelto: quanto il video "suona" come
 * ciò che il creator ha già fatto in quel formato (parole in comune).
 */
function calculateCreatorTrendsOverlap(proposal, channelProfile) {
    if (!channelProfile?.historicalVideos?.length) return 0.5;

    const proposalTokens = tokenize(proposal.description);
    const sameFormatVideos = channelProfile.historicalVideos.filter(v => v.format === proposal.format);
    if (sameFormatVideos.length === 0 || proposalTokens.length === 0) return 0.5;

    const historicalTokens = sameFormatVideos.flatMap(v => tokenize(v.title));
    return jaccardOverlap(proposalTokens, historicalTokens);
}

/**
 * Sovrapposizione testuale tra descrizione proposta e trend correnti
 * (parole in comune) — sostituisce l'approccio "chiedi all'AI un
 * numero a caso" con un conteggio verificabile.
 */
function calculateGoogleTrendsOverlap(proposal, currentTrends) {
    if (!Array.isArray(currentTrends) || currentTrends.length === 0) return 0.3; // neutro-basso: nessun dato

    const proposalTokens = tokenize(proposal.description);
    const trendTokens = currentTrends.flatMap(t => tokenize(t));
    if (proposalTokens.length === 0 || trendTokens.length === 0) return 0.3;

    return Math.min(1, jaccardOverlap(proposalTokens, trendTokens) * 3); // scala l'overlap (tipicamente basso)
}

/**
 * Stabilità del formato: coefficiente di variazione delle views dei
 * video di quel formato (basso CV = alta stabilità = predizioni più
 * affidabili). 1 = perfettamente stabile, 0 = altamente volatile.
 */
function calculateFormatStability(format, channelProfile) {
    if (!channelProfile?.historicalVideos?.length) return 0.5;

    const views = channelProfile.historicalVideos
        .filter(v => v.format === format)
        .map(v => v.views)
        .filter(v => v > 0);

    if (views.length < 3) return 0.5;

    const mean = views.reduce((a, b) => a + b, 0) / views.length;
    const variance = views.reduce((sum, v) => sum + (v - mean) ** 2, 0) / views.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;

    return Math.max(0, Math.min(1, 1 - cv * 0.5));
}

// ---- Helper functions for video insights normalization ----

function normalizeScore(score) {
    const num = Number(score);
    if (!Number.isFinite(num)) return 0.5;
    return Math.max(0, Math.min(1, num / 100));
}

function normalizeEditingPace(pace) {
    const mapping = { 'slow': 0.3, 'medium': 0.5, 'fast': 0.8 };
    return mapping[pace] || 0.5;
}

function normalizeCount(count) {
    const num = Number(count);
    if (!Number.isFinite(num) || num < 0) return 0;
    // Normalize counts (assuming reasonable max of 20 for most counts)
    return Math.min(1, num / 20);
}

function normalizeDuration(duration) {
    const num = Number(duration);
    if (!Number.isFinite(num) || num < 0) return 0.5;
    // Normalize duration (assuming optimal range 2-10 seconds)
    if (num >= 2 && num <= 10) return 1.0;
    if (num < 2) return num / 2;
    return Math.max(0, 1 - (num - 10) / 20);
}

function normalizeRetentionRisk(risk) {
    const mapping = { 'low': 0.8, 'medium': 0.5, 'high': 0.2 };
    return mapping[risk] || 0.5;
}

function normalizePresence(presence) {
    const mapping = { 'none': 0.0, 'background': 0.5, 'dominant': 1.0 };
    return mapping[presence] || 0.5;
}