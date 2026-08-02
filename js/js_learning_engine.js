/* ==========================================================
   BRAWL ANALYTICS
   LEARNING ENGINE — v3 (Livello 6)

   Responsabilità:
   1) Salvare ogni predizione fatta (logPrediction), non appena
      l'utente riceve un report di Video Analysis.
   2) Quando un nuovo CSV viene caricato, confrontare le
      predizioni salvate e non ancora risolte con i video ora
      presenti nel CSV (match per titolo esatto): se un video
      proposto in passato è stato pubblicato, ne conosciamo ora
      le views reali → calcoliamo l'errore.
   3) Aggregare gli errori in calibration_stats (media incrementale
      per formato e globale), che js_calibration.js userà per
      correggere le predizioni future.

   Nessun training ML: solo salvataggio, matching per titolo, e
   aggiornamento di medie — tutto ispezionabile e spiegabile.
========================================================== */

import { getSupabaseClient } from "./js_supabase_client.js";
import { getVideoTitle, getVideoViews } from "./js_csv_fields.js";

/**
 * Salva una predizione appena generata, in attesa di essere risolta
 * in futuro quando il video comparirà (se comparirà) in un CSV.
 */
export async function logPrediction(proposal, features, viralityScore, confidence, viewRange) {
    try {
        const supabase = await getSupabaseClient();
        if (!supabase) return false;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        const videoTitle = extractTitleFromProposal(proposal);
        if (!videoTitle) return false; // senza titolo/descrizione non c'è nulla da matchare in futuro

        const { error } = await supabase.from("prediction_log").insert({
            user_id: user.id,
            video_title: videoTitle,
            format: proposal.format,
            predicted_baseline: viewRange.baseline,
            predicted_min: viewRange.min,
            predicted_max: viewRange.max,
            virality_score: viralityScore,
            confidence,
            features
        });

        if (error) console.error("Learning engine: logPrediction fallito.", error);
        return !error;

    } catch (error) {
        console.error("Learning engine: logPrediction fallito.", error);
        return false;
    }
}

/**
 * La descrizione o il titolo del video proposto sono l'unico testo
 * disponibile al momento della predizione; usiamo la forma
 * normalizzata come chiave di match, dato che non abbiamo ancora un
 * titolo reale finché il video non viene pubblicato e appare in un CSV.
 */
function extractTitleFromProposal(proposal) {
    const sourceText = String(proposal?.description || proposal?.title || "").trim();
    return sourceText.toLowerCase().slice(0, 200) || null;
}

function normalizeTitleForMatching(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function calculateTitleMatchScore(candidateTitle, predictionTitle) {
    const normalizedCandidate = normalizeTitleForMatching(candidateTitle);
    const normalizedPrediction = normalizeTitleForMatching(predictionTitle);

    if (!normalizedCandidate || !normalizedPrediction) return 0;
    if (normalizedCandidate === normalizedPrediction) return 1;

    const candidateTokens = new Set(normalizedCandidate.split(" "));
    const predictionTokens = new Set(normalizedPrediction.split(" "));
    const overlap = [...candidateTokens].filter(token => predictionTokens.has(token)).length;
    const union = new Set([...candidateTokens, ...predictionTokens]).size;

    return union > 0 ? overlap / union : 0;
}

/**
 * Da chiamare ad ogni CSV upload (dopo che dashboardData è aggiornato).
 * Cerca predizioni non risolte il cui testo è contenuto nei titoli
 * reali del CSV appena caricato; se trova un match, risolve la
 * predizione con le views reali e aggiorna le statistiche aggregate.
 */
export async function reconcilePredictions(videos) {
    try {
        const supabase = await getSupabaseClient();
        if (!supabase) return { resolved: 0 };

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { resolved: 0 };

        const { data: pending, error } = await supabase
            .from("prediction_log")
            .select("id, video_title, format, predicted_baseline")
            .eq("user_id", user.id)
            .eq("resolved", false);

        if (error || !pending || pending.length === 0) return { resolved: 0 };

        const realTitles = videos.map(v => ({
            title: normalizeTitleForMatching(getVideoTitle(v)),
            views: getVideoViews(v)
        }));

        let resolvedCount = 0;
        const errorsByFormat = {}; // formato -> array di error ratio
        const globalErrors = [];

        for (const prediction of pending) {

            const match = realTitles.reduce((bestMatch, candidate) => {
                if (candidate.views <= 0) return bestMatch;

                const score = calculateTitleMatchScore(candidate.title, prediction.video_title);
                if (score > bestMatch.score) {
                    return { ...candidate, score };
                }

                return bestMatch;
            }, { score: 0, views: 0 });

            if (!match || match.score < 0.3 || match.views <= 0) continue;

            const errorRatio = (match.views - prediction.predicted_baseline) / prediction.predicted_baseline;

            await supabase.from("prediction_log")
                .update({
                    actual_views: match.views,
                    resolved: true,
                    error_ratio: errorRatio,
                    resolved_at: new Date().toISOString()
                })
                .eq("id", prediction.id);

            resolvedCount++;
            globalErrors.push(errorRatio);
            (errorsByFormat[prediction.format] ||= []).push(errorRatio);
        }

        if (resolvedCount > 0) {
            await updateCalibrationStats(supabase, user.id, "global", "global", globalErrors);

            for (const [format, errors] of Object.entries(errorsByFormat)) {
                await updateCalibrationStats(supabase, user.id, "format", format, errors);
            }
        }

        return { resolved: resolvedCount };

    } catch (error) {
        console.error("Learning engine: reconcilePredictions fallito.", error);
        return { resolved: 0 };
    }
}

/**
 * Aggiorna (o crea) una riga di calibration_stats fondendo gli errori
 * nuovi con quelli già accumulati, tramite media pesata sul numero di
 * campioni — equivalente a un aggiornamento incrementale della media,
 * senza dover rileggere tutta la storia grezza ogni volta.
 */
async function updateCalibrationStats(supabase, userId, dimensionType, dimensionKey, newErrors) {
    if (newErrors.length === 0) return;

    const { data: existing } = await supabase
        .from("calibration_stats")
        .select("sample_count, mean_error, mean_abs_error")
        .eq("user_id", userId)
        .eq("dimension_type", dimensionType)
        .eq("dimension_key", dimensionKey)
        .maybeSingle();

    const newMean = newErrors.reduce((a, b) => a + b, 0) / newErrors.length;
    const newAbsMean = newErrors.reduce((a, b) => a + Math.abs(b), 0) / newErrors.length;

    let mergedSampleCount = newErrors.length;
    let mergedMean = newMean;
    let mergedAbsMean = newAbsMean;

    if (existing && existing.sample_count > 0) {
        const totalCount = existing.sample_count + newErrors.length;
        mergedMean = (existing.mean_error * existing.sample_count + newMean * newErrors.length) / totalCount;
        mergedAbsMean = (existing.mean_abs_error * existing.sample_count + newAbsMean * newErrors.length) / totalCount;
        mergedSampleCount = totalCount;
    }

    await supabase.from("calibration_stats").upsert({
        user_id: userId,
        dimension_type: dimensionType,
        dimension_key: dimensionKey,
        sample_count: mergedSampleCount,
        mean_error: mergedMean,
        mean_abs_error: mergedAbsMean,
        updated_at: new Date().toISOString()
    });
}