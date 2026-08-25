/* ==========================================================
   BRAWL ANALYTICS
   VIRALITY ENGINE — v3 orchestrator

   Coordina tutti i livelli:
   1) AI qualitativa (js_virality_ai.js) — invariato
   2) Feature extraction (js_feature_extraction.js) — ampliato
   3) Dynamic weights (js_dynamic_weights.js) — nuovo, ora usato
   4) Adaptive scoring (js_dynamic_scoring.js) — media pesata + calibrazione
   5) Prediction (js_view_prediction.js + js_confidence.js)
   6) Learning (js_learning_engine.js) — logga la predizione per
      la futura riconciliazione col CSV

   API pubblica invariata: analyzeVirality(proposal, trendsAnalysis)
   resta compatibile con js_video_analysis.js esistente.
========================================================== */

import { loadChannelProfile } from "./js_storage.js";
import { loadCalibrationStats } from "./js_calibration.js";
import { analyzeVideoWithAI } from "./js_virality_ai.js";
import { extractFeatures } from "./js_feature_extraction.js";
import { calculateViralityScore, calculateScoreBreakdown, getScoreQualitative, getScoreCategory } from "./js_dynamic_scoring.js";
import { calculateConfidence, getConfidenceQualitative, getConfidenceFactors } from "./js_confidence.js";
import { predictViewRange, formatViewRange, getPredictionContext } from "./js_view_prediction.js";
import { generateStrengths, generateWeaknesses, generateCriticalIssues, generateSummary, generateActionPlan } from "./js_report_generator.js";
import { logPrediction } from "./js_learning_engine.js?v=20260825-1";

export async function analyzeVirality(proposal, trendsAnalysis = null, videoInsights = null) {
    const channelProfile = await loadChannelProfile();

    if (!channelProfile) {
        return { error: "No channel data available. Please upload a CSV first." };
    }

    try {
        const calibrationStats = await loadCalibrationStats();

        // Livello 1: AI qualitativa (solo enum/label, mai numeri finali)
        const aiAnalysis = await analyzeVideoWithAI(proposal, channelProfile, trendsAnalysis);

        // Livello 2: Feature extraction (with video insights if available)
        const features = extractFeatures(proposal, aiAnalysis, channelProfile, trendsAnalysis, videoInsights);

        // Livello 4: Adaptive scoring (usa Livello 3 internamente)
        const viralityScore = calculateViralityScore(features, proposal.format, calibrationStats);
        const scoreBreakdown = calculateScoreBreakdown(features, proposal.format, calibrationStats);
        const scoreQualitative = getScoreQualitative(viralityScore);
        const scoreCategory = getScoreCategory(viralityScore);

        // Livello 5: Confidence + View Prediction
        const confidence = calculateConfidence(features, channelProfile, proposal, calibrationStats);
        const confidenceQualitative = getConfidenceQualitative(confidence);
        const confidenceFactors = getConfidenceFactors(features, channelProfile, proposal, calibrationStats);

        const viewRange = predictViewRange(features, channelProfile, proposal, confidence, calibrationStats);
        const formattedViewRange = formatViewRange(viewRange);
        const predictionContext = getPredictionContext(viewRange, channelProfile, proposal);

        // Report testuale (derivato da soglie sulle feature, non da LLM)
        const strengths = generateStrengths(scoreBreakdown, features, viralityScore);
        const weaknesses = generateWeaknesses(scoreBreakdown, features, viralityScore);
        const criticalIssues = generateCriticalIssues(scoreBreakdown, features, viralityScore);
        const summary = generateSummary(viralityScore, features, scoreBreakdown);
        const actionPlan = generateActionPlan(features, scoreBreakdown, viralityScore);

        // Livello 6: logga questa predizione per la futura riconciliazione.
        // Fire-and-forget: un fallimento nel logging non deve mai bloccare
        // la risposta all'utente.
        logPrediction(proposal, features, viralityScore, confidence, viewRange)
            .catch(error => console.error("Learning engine: log fallito (non bloccante).", error));

        return {
            success: true,
            viralityScore,
            scoreQualitative,
            scoreCategory,
            scoreBreakdown,
            confidence,
            confidenceQualitative,
            confidenceFactors,
            viewRange: {
                min: viewRange.min,
                max: viewRange.max,
                formatted: formattedViewRange,
                baseline: viewRange.baseline
            },
            predictionContext,
            strengths,
            weaknesses,
            criticalIssues,
            summary,
            actionPlan,
            aiAnalysis,
            calibrationStatus: calibrationStats.ready
                ? `Calibrated on ${calibrationStats.global.sampleCount} resolved predictions from your channel`
                : "Not calibrated yet — predictions will improve as you upload updated CSVs over time",
            features: {
                originality: {
                    video: features.videoOriginality,
                    idea: features.ideaOriginality,
                    composite: (features.videoOriginality + features.ideaOriginality) / 2
                },
                trend: {
                    alignment: features.trendAlignment,
                    semanticSimilarity: features.semanticTrendSimilarity,
                    googleTrendsOverlap: features.googleTrendsOverlap
                },
                format: {
                    strength: features.formatStrength,
                    suitability: features.formatSuitability,
                    historical: features.historicalPerformance,
                    novelty: features.formatNovelty,
                    stability: features.formatStability
                },
                channel: {
                    consistency: features.channelConsistency,
                    historicalFit: features.historicalFit,
                    creatorTrendsOverlap: features.creatorTrendsOverlap
                },
                retention: features.retentionSignal,
                durationFit: features.durationFit,
                innovation: features.innovation,
                competition: features.competition,
                topicFreshness: features.topicFreshness
            }
        };

    } catch (error) {
        console.error("Virality analysis error:", error);
        return { error: "Analysis failed: " + error.message };
    }
}

export function validateProposal(proposal) {
    const required = ["videoOriginality", "ideaOriginality", "format", "description"];
    const missing = required.filter(field => !proposal[field]);
    return missing.length > 0 ? { valid: false, missing } : { valid: true };
}

export function generateScoreExplanation(result) {
    if (!result.success || !result.scoreBreakdown) return "Unable to generate explanation.";

    const breakdown = result.scoreBreakdown;
    const explanations = [];

    if (breakdown.originality.score >= 70) explanations.push("High originality contributes positively to your score.");
    else if (breakdown.originality.score <= 40) explanations.push("Low originality is significantly reducing your score.");

    if (breakdown.trend.score >= 70) explanations.push("Strong trend alignment boosts viral potential.");
    else if (breakdown.trend.score <= 40) explanations.push("Weak trend alignment limits viral potential.");

    if (breakdown.format.score >= 70) explanations.push("Your chosen format has strong historical performance.");
    else if (breakdown.format.score <= 40) explanations.push("Your chosen format underperforms historically.");

    if (breakdown.retention.score >= 70) explanations.push("This format retains viewers well on your channel.");
    else if (breakdown.retention.score <= 40) explanations.push("This format tends to lose viewers faster than your average.");

    if (breakdown.format.calibration) {
        explanations.push(`This score has been adjusted based on ${breakdown.format.calibration.sampleCount} real outcomes tracked on your channel.`);
    }

    return explanations.join(" ");
}