/* ==========================================================
   BRAWL ANALYTICS
   FEATURE EXTRACTION MODULE — v3.1 (Livello 2)

   Trasforma proposal + AI analysis + channel profile in feature
   numeriche 0-1 (o 0-1.5 per historicalPerformance, che può
   superare la media canale). Nessun calcolo di score qui: solo
   estrazione/normalizzazione.

   FIX v3.1 (bug "best format riceve 33"):
   - calculateHistoricalPerformance() usava un bonus di dominanza
     ancorato alla MEDIANA dei formati: con pochi formati (2-4) la
     mediana è instabile e può escludere il formato migliore dal
     bonus per un solo video di scarto, facendolo collassare al
     semplice rapporto averageViews/canaleAverageViews — spesso
     < 1 se la media del canale è alzata da un singolo video virale
     in un ALTRO formato. Risultato: il "best format" (per views
     totali/numero video) finiva con un ratio basso e quindi uno
     score Format ~33, mentre formati minori con pochi video ma
     fortunati restavano vicini/sopra 1.0 e prendevano score più alti.
   - Ora usiamo il MASSIMO tra il confronto vs media canale e il
     confronto vs mediana dei formati (quando disponibile e con
     abbastanza campioni), pesato per numero di video del formato
     (Wilson-like shrinkage): un formato con pochi video non riceve
     mai un ratio "gonfiato" né "schiacciato" in modo eccessivo.
   - Aggiunto un pavimento minimo (floor) proporzionale alla
     numerosità campionaria, per evitare che formati con pochissimi
     video (1-2) crollino sotto 0.3 per rumore statistico puro.
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

    if (videoInsights) {
        baseFeatures.videoQuality = normalizeScore(videoInsights.overallQuality);
        baseFeatures.hookStrength = normalizeScore(videoInsights.hookStrength);
        baseFeatures.visualClarity = normalizeScore(videoInsights.visualClarity);
        baseFeatures.audioQuality = normalizeScore(videoInsights.audioQuality);
        baseFeatures.retentionRisk = normalizeRetentionRisk(videoInsights.retentionRisk);
        baseFeatures.hasSubtitles = Boolean(videoInsights.hasSubtitles);
    } else {
        baseFeatures.videoQuality = 0.5;
        baseFeatures.hookStrength = 0.5;
        baseFeatures.visualClarity = 0.5;
        baseFeatures.audioQuality = 0.5;
        baseFeatures.retentionRisk = 0.5;
        baseFeatures.hasSubtitles = false;
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

    // Usa totalViews per determinare la forza del formato (criterio principale)
    const viewScore = Math.min(1.0, stats.totalViews / Math.max(1, channelProfile.averageViews * channelProfile.totalVideos));
    const countScore = Math.min(1.0, stats.videoCount / Math.max(1, channelProfile.totalVideos));
    return (viewScore * 0.7) + (countScore * 0.3);
}

function normalizeSuitability(suitability) {
    return { excellent: 1.0, good: 0.8, fair: 0.5, poor: 0.2 }[suitability] ?? 0.5;
}

/**
 * Calcola la mediana di un array numerico (helper puro, nessuna
 * dipendenza dal resto del modulo).
 */
function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * historicalPerformance — QUANTO il formato scelto performa rispetto
 * al resto del canale, in scala 0-1.5 (1.0 = performa esattamente
 * come la media/mediana; >1.0 = sopra; <1.0 = sotto).
 *
 * FIX v3.1: prima usava SOLO channelProfile.averageViews come
 * riferimento. Se la media del canale è alzata da un singolo video
 * virale (comune: un solo Short esplode a 2M mentre il resto sta
 * su 20-50K), QUALSIASI formato — incluso il migliore in assoluto —
 * finisce con un ratio < 1, spesso intorno a 0.4-0.6, che nello
 * score finale (formatScore01 = ratio / 1.5) produce un punteggio
 * Format bloccato sui 30 anche per il formato oggettivamente top.
 *
 * Ora il riferimento è il MASSIMO tra:
 *   (a) media del formato / media del canale (comportamento storico)
 *   (b) media del formato / mediana delle medie di TUTTI i formati
 *       (più robusta agli outlier di un singolo video)
 * — e il risultato finale è una media pesata tra questo ratio e 1.0,
 * dove il peso del ratio cresce con la numerosità campionaria del
 * formato (shrinkage): un formato con 1-2 video non può schizzare a
 * 1.5 né crollare a 0 solo per rumore statistico, mentre un formato
 * con 15+ video riflette quasi integralmente il suo ratio reale.
 */
function calculateHistoricalPerformance(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    if (!stats || stats.videoCount === 0) return 0.5;
    if (!(channelProfile.averageViews > 0)) return 0.5;

    // Ratio (a): vs media canale — basato su totalViews
    const totalChannelViews = channelProfile.averageViews * channelProfile.totalVideos;
    const ratioVsChannelTotal = totalChannelViews > 0 ? stats.totalViews / totalChannelViews : 0.5;

    // Ratio (b): vs mediana dei totalViews-per-formato, se disponibile
    // con abbastanza formati da essere significativa.
    let ratioVsFormatMedian = ratioVsChannelTotal;
    const allFormatStats = channelProfile.formatPerformance
        ? Object.values(channelProfile.formatPerformance).filter(s => s.totalViews > 0)
        : [];

    // Rimosso il blocco minimo di 2 formati: basta 1+ formato per il confronto
    if (allFormatStats.length >= 1) {
        const medianFormatTotalViews = median(allFormatStats.map(s => s.totalViews));
        if (medianFormatTotalViews > 0) {
            ratioVsFormatMedian = stats.totalViews / medianFormatTotalViews;
        }
    }

    // Usiamo il riferimento più favorevole al formato tra i due (il
    // canale può essere "falsato" da un outlier, la mediana dei
    // formati è più stabile in quel caso specifico).
    const rawRatio = Math.max(ratioVsChannelTotal, ratioVsFormatMedian);

    // Shrinkage verso 1.0 in base alla numerosità campionaria: con
    // pochi video il ratio grezzo è rumoroso, quindi lo tiriamo verso
    // il centro; con molti video ci fidiamo quasi del tutto del dato.
    // Rimosso il blocco minimo di 8 video: basta 2+ video per avere fiducia.
    const sampleTrust = Math.min(1, stats.videoCount / 4); // pieno affidamento da 4+ video
    const shrunkRatio = 1 + (rawRatio - 1) * (0.35 + sampleTrust * 0.65);

    // Bonus di dominanza (comportamento precedente, mantenuto ma reso
    // meno dipendente dalla sola mediana grezza): se il formato è
    // chiaramente il migliore del canale per un margine sostanziale,
    // aggiunge un piccolo extra — ma parte da shrunkRatio, non da un
    // ratio potenzialmente già schiacciato dall'outlier del canale.
    let performanceBonus = 0;

    if (allFormatStats.length > 1) {
        const allTotalViews = allFormatStats.map(s => s.totalViews);
        const maxFormatViews = Math.max(...allTotalViews);
        const medianFormatViews = median(allTotalViews);

        if (medianFormatViews > 0 && stats.totalViews > medianFormatViews) {
            const dominanceRatio = stats.totalViews / medianFormatViews;
            performanceBonus = Math.min(0.4, (dominanceRatio - 1) * 0.3) * sampleTrust;
        }

        if (stats.totalViews === maxFormatViews && medianFormatViews > 0 && stats.totalViews > medianFormatViews * 2) {
            performanceBonus += 0.2 * sampleTrust;
        }
    }

    // Floor: anche nel caso peggiore, un formato con dati reali non
    // scende sotto 0.35 solo per un singolo video sfortunato — evita
    // gli score "33" percepiti come ingiustamente punitivi.
    // Rimosso il blocco minimo: basta 2+ video per non andare in fallback.
    const floor = stats.videoCount >= 2 ? 0.35 : 0.45;

    return Math.max(floor, Math.min(1.5, shrunkRatio + performanceBonus));
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

    if (views.length < 2) return 0.5;

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