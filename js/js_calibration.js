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

export const SAMPLE_SHRINKAGE_K = 9;

function sampleTrust(sampleCount) {
    const n = Math.max(0, Number(sampleCount) || 0);
    return n / (n + SAMPLE_SHRINKAGE_K);
}

function clampError(value, min = -0.35, max = 0.5) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

/**
 * Carica tutte le righe di calibration_stats dell'utente corrente e le
 * organizza in una struttura pronta all'uso: { global, byFormat }.
 * Ritorna una struttura "vuota ma valida" se non ci sono ancora dati,
 * così il chiamante non deve gestire null ovunque.
 */
export async function loadCalibrationStats() {
    const empty = {
        ready: false,
        global: { meanError: 0, meanAbsError: 0, sampleCount: 0 },
        byFormat: {},
        byFeature: {}
    };

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

        const result = {
            ready: false,
            global: { meanError: 0, meanAbsError: 0, sampleCount: 0 },
            byFormat: {},
            byFeature: {}
        };

        data.forEach(row => {
            const entry = {
                meanError: Number(row.mean_error) || 0,
                meanAbsError: Number(row.mean_abs_error) || 0,
                sampleCount: Math.max(0, Number(row.sample_count) || 0)
            };

            if (row.dimension_type === "global") {
                result.global = entry;
            } else if (row.dimension_type === "format") {
                result.byFormat[row.dimension_key] = entry;
            } else if (row.dimension_type === "feature") {
                result.byFeature[row.dimension_key] = entry;
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
        return { factor: 1.0, trust: 0, source: "none", sampleCount: 0 };
    }

    const formatStats = calibrationStats.byFormat?.[format];
    if (formatStats && formatStats.sampleCount > 0) {
        const clampedError = clampError(formatStats.meanError);
        return {
            factor: 1 + clampedError * 0.6,
            trust: sampleTrust(formatStats.sampleCount) * 0.65,
            source: "format",
            sampleCount: formatStats.sampleCount
        };
    }

    const globalStats = calibrationStats.global || {};
    const clampedGlobal = clampError(globalStats.meanError, -0.25, 0.4);
    return {
        factor: 1 + clampedGlobal * 0.4,
        trust: sampleTrust(globalStats.sampleCount) * 0.45,
        source: "global",
        sampleCount: globalStats.sampleCount || 0
    };
}

/**
 * Errore assoluto medio per formato — usato da js_confidence.js per
 * stimare quanto è "largo" storicamente lo scarto delle predizioni,
 * senza bootstrap: solo una media già calcolata.
 */
export function getTypicalErrorSpread(calibrationStats, format) {
    if (!calibrationStats?.ready) return 0.4;

    const globalSpread = Math.max(
        0.2,
        Math.min(0.7, Number(calibrationStats.global?.meanAbsError) || 0.3)
    );
    const formatStats = calibrationStats.byFormat?.[format];
    if (!formatStats || formatStats.sampleCount <= 0) return globalSpread;

    const formatSpread = Math.max(0.2, Math.min(0.7, Number(formatStats.meanAbsError) || 0.3));
    const trust = sampleTrust(formatStats.sampleCount);
    return formatSpread * trust + globalSpread * (1 - trust);
}

export function getFeatureCalibration(calibrationStats, featureName) {
    if (!calibrationStats?.ready) return null;
    const byFeature = calibrationStats.byFeature || {};
    return {
        high: byFeature[`${featureName}:high`] || null,
        low: byFeature[`${featureName}:low`] || null
    };
}