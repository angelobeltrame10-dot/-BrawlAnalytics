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

const BASE_WEIGHTS = {
    originality: 0.20,
    trend: 0.18,
    format: 0.20,
    channel: 0.12,
    competition: 0.08,
    retention: 0.14,
    trendsOverlap: 0.08
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

/**
 * Calcola i pesi dinamici per la proposta corrente. Le regole sono
 * esplicite e commentate — ognuna riflette un'euristica dichiarata
 * dal progetto (es. "nei Tutorial la retention pesa di più").
 */
export function getDynamicWeights(features, format = "") {
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
    if (features.googleTrendsOverlap >= 0.6) {
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

    // Alta competizione: differenziarsi (originalità) e cavalcare il
    // trend giusto contano di più della semplice forza del formato.
    if (features.competition > 0.7) {
        w.originality += 0.05;
        w.trend += 0.05;
        w.format -= 0.05;
        w.competition -= 0.05;
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