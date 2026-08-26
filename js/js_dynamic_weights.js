/* ==========================================================
   BRAWL ANALYTICS
   DYNAMIC WEIGHTS MODULE — v3 (Livello 3)

   Decide QUANTO conta ogni categoria di feature nello score
   finale, in base al CONTESTO della proposta (formato, feature
   estratte). Puramente basato su regole esplicite — nessun
   modello, nessun training: solo if/else leggibili e commentati.

   Le categorie pesate corrispondono 1:1 ai sotto-punteggi che
   js_dynamic_scoring.js produce in calculateScoreBreakdown().
========================================================== */

const SAMPLE_SHRINKAGE_K = 9;

const BASE_WEIGHTS = {
    originality: 0.22,
    trend: 0.20,
    format: 0.20,
    channel: 0.05,
    competition: 0.08,
    retention: 0.18,
    trendsOverlap: 0.07
};

/**
 * Normalizza un oggetto pesi affinché la somma sia esattamente 1.
 */
function normalize(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const normalized = {};
    Object.keys(weights).forEach(key => { normalized[key] = weights[key] / total; });
    return normalized;
}

function sampleTrust(sampleCount) {
    const n = Math.max(0, Number(sampleCount) || 0);
    return n / (n + SAMPLE_SHRINKAGE_K);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getFeatureAdjustment(calibrationStats, featureName, featureValue) {
    const byFeature = calibrationStats?.byFeature || {};
    const high = byFeature[`${featureName}:high`];
    const low = byFeature[`${featureName}:low`];
    if (!high && !low) return 0;

    let errorSignal;
    let trust;
    if (high && low) {
        errorSignal = Number(high.meanError || 0) - Number(low.meanError || 0);
        trust = Math.min(sampleTrust(high.sampleCount), sampleTrust(low.sampleCount));
    } else {
        const selected = Number(featureValue) >= 0.67 ? high : low;
        if (!selected) return 0;
        errorSignal = Number(selected.meanError || 0);
        trust = sampleTrust(selected.sampleCount);
    }

    // Keep learned adjustments deliberately small: calibration should
    // correct contextual rules, not replace them after a few outcomes.
    return clamp(errorSignal * trust * 0.12, -0.05, 0.05);
}

/**
 * Calcola i pesi dinamici per la proposta corrente. Le regole sono
 * esplicite e commentate — ognuna riflette un'euristica dichiarata
 * dal progetto (es. "nei Tutorial la retention pesa di più").
 */
export function getDynamicWeights(features, format = "", calibrationStats = null) {
    const w = { ...BASE_WEIGHTS };
    const formatLower = String(format || "").toLowerCase();

    // Tutorial/Guide: la retention è il segnale che conta di più,
    // perché il valore del video dipende dal seguirlo fino in fondo.
    if (formatLower.includes("guide") || formatLower.includes("tutorial")) {
        w.retention += 0.10;
        w.trend -= 0.04;
        w.competition -= 0.02;
        w.originality -= 0.04;
    }

    // Challenge: l'originalità dell'idea è il differenziatore principale
    // (le challenge si copiano facilmente, chi ha l'angolo originale vince).
    if (formatLower.includes("challenge")) {
        w.originality += 0.10;
        w.format -= 0.05;
        w.channel -= 0.05;
    }

    // Contenuti legati a novità di gioco (nuovo Brawler/evento): il
    // rilevamento lo facciamo dal testo descrizione più avanti in
    // js_dynamic_scoring.js; qui gestiamo il caso via trend overlap
    // già alto, segno che la proposta è legata all'attualità.
    if ((features.googleTrendsOverlap ?? 0) >= 0.6) {
        w.trendsOverlap += 0.08;
        w.format -= 0.04;
        w.channel -= 0.04;
    }

    // Formato ancora senza storico solido: il canale/formato contano
    // meno (non abbiamo dati affidabili), l'originalità e il trend
    // diventano i segnali principali.
    if (features.historicalPerformance < 0.5 && features.formatStrength < 0.4) {
        w.format -= 0.06;
        w.originality += 0.03;
        w.trend += 0.03;
    }

    // Canale poco consistente: il segnale "channel" è rumoroso, meglio
    // ridurne il peso e spostarlo su segnali più diretti alla proposta.
    if (features.channelConsistency < 0.3) {
        w.channel -= 0.06;
        w.retention += 0.03;
        w.originality += 0.03;
    }

    // Formato molto stabile storicamente: possiamo fidarci di più del
    // dato "format", quindi gli diamo più peso.
    if (features.formatStability >= 0.75) {
        w.format += 0.05;
        w.competition -= 0.02;
        w.trend -= 0.03;
    }

    // Video analysis forte: se l'AI video mostra qualità alta, spostiamo
    // peso verso segnali di contenuto e retention e riduciamo l'impatto
    // del canale storico.
    if (features.videoQuality >= 0.8 || features.hookStrength >= 0.75) {
        w.retention += 0.05;
        w.originality += 0.03;
        w.channel -= 0.04;
    }

    // Alta competizione: differenziarsi (originalità) e cavalcare il
    // trend giusto contano di più della semplice forza del formato.
    // competition is normalized as opportunity: low value means a saturated,
    // highly competitive topic.
    if (features.competition < 0.3) {
        w.originality += 0.05;
        w.trend += 0.05;
        w.format -= 0.05;
        w.competition -= 0.05;
    }

    // Short descriptions provide weak lexical evidence. Reduce the overlap
    // category and return the weight to direct signals.
    const textReliability = clamp(Number(features.textSignalReliability ?? 1), 0, 1);
    if (textReliability < 1) {
        const reduction = (1 - textReliability) * 0.06;
        w.trendsOverlap -= reduction;
        w.trend += reduction * 0.55;
        w.originality += reduction * 0.45;
    }

    // A degraded qualitative response should not make the trend category
    // look as authoritative as a fully validated response.
    const semanticReliability = clamp(Number(features.semanticTrendReliability ?? 1), 0, 1);
    if (semanticReliability < 1) {
        const reduction = (1 - semanticReliability) * 0.04;
        w.trend -= reduction;
        w.channel += reduction;
        w.originality += reduction;
    }

    // Feature calibration is an incremental, sample-shrunk nudge. It uses
    // high/low outcome buckets populated by resolve_prediction().
    if (calibrationStats?.ready) {
        [
            ["trend", "trendAlignment", features.trendAlignment],
            ["format", "formatStrength", features.formatStrength],
            ["retention", "retentionSignal", features.retentionSignal],
            ["originality", "videoOriginality", features.videoOriginality],
            ["competition", "competition", features.competition],
            ["trendsOverlap", "creatorTrendsOverlap", features.creatorTrendsOverlap]
        ].forEach(([category, featureName, featureValue]) => {
            w[category] += getFeatureAdjustment(calibrationStats, featureName, featureValue);
        });
    }

    // Clamp difensivo: nessun peso deve mai andare sotto zero per
    // combinazioni estreme di regole sovrapposte.
    Object.keys(w).forEach(key => { w[key] = Math.max(0.02, w[key]); });

    return normalize(w);
}

/**
 * Espone i pesi di base (utile per debug/UI "spiega la predizione").
 */
export function getBaseWeights() {
    return { ...BASE_WEIGHTS };
}