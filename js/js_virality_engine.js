/* ==========================================================
   BRAWL ANALYTICS
   VIRALITY ENGINE

   Main orchestrator for the complete virality prediction pipeline.
   Integrates all modules: Channel Profile, AI, Features, Scoring,
   Confidence, and View Prediction.
========================================================== */

import { loadChannelProfile } from "./js_storage.js";
import { analyzeVideoWithAI } from "./js_virality_ai.js";
import { extractFeatures } from "./js_feature_extraction.js";
import { calculateViralityScore, calculateScoreBreakdown, getScoreQualitative, getScoreCategory } from "./js_dynamic_scoring.js";
import { calculateConfidence, getConfidenceQualitative, getConfidenceFactors } from "./js_confidence.js";
import { predictViewRange, formatViewRange, getPredictionContext } from "./js_view_prediction.js";
import { generateStrengths, generateWeaknesses, generateCriticalIssues, generateSummary, generateActionPlan } from "./js_report_generator.js";

/**
 * Main entry point for virality analysis.
 *
 * trendsAnalysis contiene l'analisi semantica dei trend del giorno.
 * Se è null significa che il chiamante non l'ha recuperata.
 * Non rappresenta "nessun trend disponibile", ma "trend non forniti".
 */

export async function analyzeVirality(proposal, trendsAnalysis = null) {
    // Load Channel Profile
    const channelProfile = await loadChannelProfile();
    
    if (!channelProfile) {
        return {
            error: "No channel data available. Please upload a CSV first."
        };
    }
    
    try {
        // Step 1: AI Qualitative Analysis
        const aiAnalysis = await analyzeVideoWithAI(proposal, channelProfile, trendsAnalysis);
        
        // Step 2: Feature Extraction
        const features = extractFeatures(proposal, aiAnalysis, channelProfile, trendsAnalysis);
        
        // Step 3: Dynamic Scoring
        const viralityScore = calculateViralityScore(features);
        const scoreBreakdown = calculateScoreBreakdown(features);
        const scoreQualitative = getScoreQualitative(viralityScore);
        const scoreCategory = getScoreCategory(viralityScore);
        
        // Step 4: Confidence Calculation
        const confidence = calculateConfidence(features, channelProfile, proposal);
        const confidenceQualitative = getConfidenceQualitative(confidence);
        const confidenceFactors = getConfidenceFactors(features, channelProfile, proposal);
        
        // Step 5: View Prediction
        const viewRange = predictViewRange(features, channelProfile, proposal, confidence);
        const formattedViewRange = formatViewRange(viewRange);
        const predictionContext = getPredictionContext(viewRange, channelProfile, proposal);
        
        // Step 6: Generate Report (strengths, weaknesses, summary from score, not LLM)
        const strengths = generateStrengths(scoreBreakdown, features, viralityScore);
        const weaknesses = generateWeaknesses(scoreBreakdown, features, viralityScore);
        const criticalIssues = generateCriticalIssues(scoreBreakdown, features, viralityScore);
        const summary = generateSummary(viralityScore, features, scoreBreakdown);
        const actionPlan = generateActionPlan(features, scoreBreakdown, viralityScore);
        
        // Step 7: Compile Results
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
            features: {
                // Internal features for debugging (not exposed to UI)
                originality: {
                    video: features.videoOriginality,
                    idea: features.ideaOriginality,
                    composite: (features.videoOriginality + features.ideaOriginality) / 2
                },
                trend: {
                    alignment: features.trendAlignment,
                    semanticSimilarity: features.semanticTrendSimilarity
                },
                format: {
                    strength: features.formatStrength,
                    suitability: features.formatSuitability,
                    historical: features.historicalPerformance,
                    novelty: features.formatNovelty
                },
                channel: {
                    consistency: features.channelConsistency,
                    historicalFit: features.historicalFit
                },
                innovation: features.innovation,
                competition: features.competition,
                topicFreshness: features.topicFreshness
            }
        };
        
    } catch (error) {
        console.error("Virality analysis error:", error);
        return {
            error: "Analysis failed: " + error.message
        };
    }
}

/**
 * Simplified analysis for quick predictions (without AI).
 * Uses only statistical features, no LLM analysis.
 */
export async function analyzeViralityQuick(proposal) {

    const channelProfile = await loadChannelProfile();
    
    if (!channelProfile) {
        return {
            error: "No channel data available. Please upload a CSV first."
        };
    }
    
    try {
        // Use default AI analysis for quick mode
        const defaultAIAnalysis = {
            videoOriginality: "medium",
            ideaOriginality: "medium",
            trendAnalysis: {
                alignment: "moderate",
                relevance: "medium",
                explanation: "Quick analysis - no trend data"
            },
            formatAnalysis: {
                suitability: "fair",
                historicalPerformance: "unknown",
                explanation: "Quick analysis - no detailed format assessment"
            },
            innovation: "medium",
            competition: "medium",
            overallPotential: "medium",
            strengths: ["Uses established format"],
            weaknesses: ["Limited differentiation"],
            criticalIssues: [],
            summary: "Quick analysis shows moderate potential"
        };
        
        // Extract features with default AI analysis
        const features = extractFeatures(proposal, defaultAIAnalysis, channelProfile, []);
        
        // Calculate scores
        const viralityScore = calculateViralityScore(features);
        const confidence = calculateConfidence(features, channelProfile, proposal);
        const viewRange = predictViewRange(features, channelProfile, proposal, confidence);
        
        return {
            success: true,
            viralityScore,
            scoreQualitative: getScoreQualitative(viralityScore),
            scoreCategory: getScoreCategory(viralityScore),
            confidence,
            confidenceQualitative: getConfidenceQualitative(confidence),
            viewRange: {
                min: viewRange.min,
                max: viewRange.max,
                formatted: formatViewRange(viewRange),
                baseline: viewRange.baseline
            },
            mode: "quick"
        };
        
    } catch (error) {
        console.error("Quick virality analysis error:", error);
        return {
            error: "Quick analysis failed: " + error.message
        };
    }
}

/**
 * Validates that a proposal has all required fields.
 */
export function validateProposal(proposal) {
    const required = ['videoOriginality', 'ideaOriginality', 'format', 'description'];
    const missing = required.filter(field => !proposal[field]);
    
    if (missing.length > 0) {
        return {
            valid: false,
            missing
        };
    }
    
    return { valid: true };
}

/**
 * Gets explanation for why a score was calculated.
 */
export function generateScoreExplanation(result) {
    if (!result.success || !result.scoreBreakdown) {
        return "Unable to generate explanation.";
    }
    
    const breakdown = result.scoreBreakdown;
    const explanations = [];
    
    // Originality explanation
    if (breakdown.originality.score >= 70) {
        explanations.push("High originality contributes positively to your score.");
    } else if (breakdown.originality.score <= 40) {
        explanations.push("Low originality is significantly reducing your score.");
    }
    
    // Trend explanation
    if (breakdown.trend.score >= 70) {
        explanations.push("Strong trend alignment boosts viral potential.");
    } else if (breakdown.trend.score <= 40) {
        explanations.push("Weak trend alignment limits viral potential.");
    }
    
    // Format explanation
    if (breakdown.format.score >= 70) {
        explanations.push("Your chosen format has strong historical performance.");
    } else if (breakdown.format.score <= 40) {
        explanations.push("Your chosen format underperforms historically.");
    }
    
    // Channel explanation
    if (breakdown.channel.score >= 70) {
        explanations.push("Your channel's consistency supports predictable performance.");
    } else if (breakdown.channel.score <= 40) {
        explanations.push("Channel inconsistency makes predictions less reliable.");
    }
    
    return explanations.join(" ");
}
