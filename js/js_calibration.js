/* ==========================================================
   BRAWL ANALYTICS
   CALIBRATION MODULE — v3

   Legge le statistiche di errore accumulate da js_learning_engine.js
   (tabella calibration_stats) e le trasforma in un fattore di
   correzione da applicare al baseline/score. Pura lettura + media
   pesata: NESSUN training, nessuna regressione — solo aritmetica
   su numeri già aggregati nel database.
========================================================== */

import { getSupabaseClient } from "./js_supabase_client.js";

const MIN_SAMPLES_TO_TRUST_FORMAT = 2;

/**
 * Carica tutte le righe di calibration_stats dell'utente corrente e le
 * organizza in una struttura pronta all'uso: { global, byFormat }.
 * Ritorna una struttura "vuota ma valida" se non ci sono ancora dati,
 * così il chiamante non deve gestire null ovunque.
 */
export async function loadCalibrationStats() {
    const empty = { ready: false, global: { meanError: 0, sampleCount: 0 }, byFormat: {} };

    try {
        const supabase = await getSupabaseClient();
        if (!supabase) return empty;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return empty;

        const { data, error } = await supabase
            .from("calibration_stats")
            .select("dimension_type, dimension_key, sample_count, mean_error, mean_abs_error")
            .eq("user_id", user.id);

        if (error || !data || data.length === 0) return empty;

        const result = { ready: false, global: { meanError: 0, sampleCount: 0 }, byFormat: {} };

        data.forEach(row => {
            if (row.dimension_type === "global") {
                result.global = { meanError: row.mean_error, meanAbsError: row.mean_abs_error, sampleCount: row.sample_count };
            } else if (row.dimension_type === "format") {
                result.byFormat[row.dimension_key] = {
                    meanError: row.mean_error,
                    meanAbsError: row.mean_abs_error,
                    sampleCount: row.sample_count
                };
            }
        });

        result.ready = result.global.sampleCount > 0;
        return result;

    } catch (error) {
        console.error("Calibration: loadCalibrationStats fallita.", error);
        return empty;
    }
}

/**
 * Calcola il fattore correttivo (moltiplicativo) da applicare al
 * baseline predetto, usando le statistiche di errore per quel formato
 * se abbastanza affidabili, altrimenti il fallback globale.
 *
 * meanError è definito come (actual - predicted) / predicted, quindi
 * un fattore correttivo di (1 + meanError) sposta il baseline verso
 * ciò che il canale ha REALMENTE mostrato in passato per quel formato.
 */
export function getCorrectionFactor(calibrationStats, format) {
    if (!calibrationStats?.ready) {
        return { factor: 1.0, trust: 0, source: "none" };
    }

    const formatStats = calibrationStats.byFormat[format];

    if (formatStats && formatStats.sampleCount >= MIN_SAMPLES_TO_TRUST_FORMAT) {
        const clampedError = Math.max(-0.35, Math.min(0.5, formatStats.meanError));
        return {
            factor: 1 + clampedError * 0.6,
            trust: Math.min(0.55, formatStats.sampleCount / 5), // Ridotto da 25 a 5 per formati con pochi video
            source: "format",
            sampleCount: formatStats.sampleCount
        };
    }

    // Fallback: correzione globale, più prudente (peso ridotto) perché
    // meno specifica del formato richiesto.
    const clampedGlobal = Math.max(-0.25, Math.min(0.4, calibrationStats.global.meanError));
    return {
        factor: 1 + clampedGlobal * 0.4,
        trust: Math.min(0.35, calibrationStats.global.sampleCount / 10), // Ridotto da 45 a 10
        source: "global",
        sampleCount: calibrationStats.global.sampleCount
    };
}

/**
 * Errore assoluto medio per formato — usato da js_confidence.js per
 * stimare quanto è "largo" storicamente lo scarto delle predizioni,
 * senza bootstrap: solo una media già calcolata.
 */
export function getTypicalErrorSpread(calibrationStats, format) {
    if (!calibrationStats?.ready) return 0.4; // default prudente

    const formatStats = calibrationStats.byFormat[format];
    if (formatStats && formatStats.sampleCount >= MIN_SAMPLES_TO_TRUST_FORMAT) {
        return Math.max(0.2, Math.min(0.7, formatStats.meanAbsError));
    }

    return Math.max(0.2, Math.min(0.7, calibrationStats.global.meanAbsError || 0.3));
}