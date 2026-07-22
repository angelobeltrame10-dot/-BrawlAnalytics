/* ==========================================================
   BRAWL ANALYTICS
   FEATURE EXTRACTION MODULE

   Transforms raw data into structured features for the scoring engine.
   This intermediate layer is mandatory before any score calculation.
========================================================== */

import { calculateChannelConsistency, getFormatStatistics } from "./js_channel_profile.js";

/**
 * Extracts all features from the complete analysis pipeline.
 * Combines: Channel Profile, Questionnaire, LLM Analysis, Trends
 * NO keyword matching - uses AI semantic similarity
 */
export function extractFeatures(proposal, aiAnalysis, channelProfile, currentTrends = []) {
    return {
        // Originality features (from questionnaire)
        videoOriginality: normalizeOriginality(proposal.videoOriginality),
        ideaOriginality: normalizeOriginality(proposal.ideaOriginality),
        
        // Trend features (from AI analysis - semantic comparison only)
        trendAlignment: normalizeTrendAlignment(aiAnalysis.trendAlignment),
        semanticTrendSimilarity: aiAnalysis.semanticTrendSimilarity || 0.5,
        
        // Format features (from channel profile + AI)
        formatStrength: calculateFormatStrength(proposal.format, channelProfile),
        formatSuitability: normalizeSuitability(aiAnalysis.formatSuitability),
        formatNovelty: normalizeLevel(aiAnalysis.formatNovelty),
        
        // Channel features (from channel profile)
        channelConsistency: calculateChannelConsistency(channelProfile),
        historicalPerformance: calculateHistoricalPerformance(proposal.format, channelProfile),
        historicalFit: normalizeHistoricalFit(aiAnalysis.historicalFit),
        
        // Innovation features (from AI)
        innovation: normalizeLevel(aiAnalysis.innovation),
        competition: normalizeCompetition(aiAnalysis.competition),
        topicFreshness: normalizeLevel(aiAnalysis.topicFreshness),
        
        // Multimedia features (reserved for future use)
        multimediaFeatures: null // Future: hook, editing, OCR, etc.
    };
}

/**
 * Normalizes originality from questionnaire to 0-1 scale.
 */
function normalizeOriginality(value) {
    const mapping = {
        "Completely original": 1.0,
        "Mostly original": 0.7,
        "Mostly reused": 0.3,
        "Inspired by another creator": 0.5,
        "Copy of another creator": 0.1
    };
    return mapping[value] || 0.5;
}

/**
 * Normalizes trend alignment from AI to 0-1 scale.
 */
function normalizeTrendAlignment(alignment) {
    const mapping = {
        "strong": 1.0,
        "moderate": 0.6,
        "weak": 0.3,
        "none": 0.0
    };
    return mapping[alignment] || 0.5;
}

/**
 * Normalizes historical fit from AI to 0-1 scale.
 */
function normalizeHistoricalFit(fit) {
    const mapping = {
        "strong": 1.0,
        "moderate": 0.6,
        "weak": 0.3
    };
    return mapping[fit] || 0.5;
}

/**
 * Calculates format strength based on historical performance.
 */
function calculateFormatStrength(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    
    if (!stats || stats.videoCount === 0) {
        return 0.5; // Neutral for unknown formats
    }
    
    // Strength based on both view performance and consistency
    const viewScore = Math.min(1.0, stats.averageViews / Math.max(1, channelProfile.averageViews));
    const countScore = Math.min(1.0, stats.videoCount / Math.max(1, channelProfile.totalVideos));
    
    // Weighted average (views more important than count)
    return (viewScore * 0.7) + (countScore * 0.3);
}

/**
 * Normalizes format suitability from AI to 0-1 scale.
 */
function normalizeSuitability(suitability) {
    const mapping = {
        "excellent": 1.0,
        "good": 0.8,
        "fair": 0.5,
        "poor": 0.2
    };
    return mapping[suitability] || 0.5;
}

/**
 * Calculates historical performance for the selected format.
 */
function calculateHistoricalPerformance(format, channelProfile) {
    const stats = getFormatStatistics(channelProfile, format);
    
    if (!stats || stats.videoCount === 0) {
        return 0.5; // Neutral for unknown formats
    }
    
    // Compare format average to channel average
    if (channelProfile.averageViews > 0) {
        return Math.min(1.0, stats.averageViews / channelProfile.averageViews);
    }
    
    return 0.5;
}

/**
 * Normalizes level-based values (high/medium/low) to 0-1 scale.
 */
function normalizeLevel(level) {
    const mapping = {
        "high": 1.0,
        "medium": 0.5,
        "low": 0.0
    };
    return mapping[level] || 0.5;
}

/**
 * Normalizes competition (reversed: low competition = high score).
 */
function normalizeCompetition(competition) {
    const mapping = {
        "low": 1.0,    // Low competition is good
        "medium": 0.5,
        "high": 0.0    // High competition is bad
    };
    return mapping[competition] || 0.5;
}

/**
 * Calculates a composite originality score from multiple signals.
 */
export function calculateCompositeOriginality(features) {
    const weights = {
        videoOriginality: 0.4,
        ideaOriginality: 0.4,
        innovation: 0.2
    };
    
    return (
        features.videoOriginality * weights.videoOriginality +
        features.ideaOriginality * weights.ideaOriginality +
        features.innovation * weights.innovation
    );
}

/**
 * Calculates a composite trend score from multiple signals.
 */
export function calculateCompositeTrendScore(features) {
    const weights = {
        trendAlignment: 0.6,
        trendSimilarity: 0.4
    };
    
    return (
        features.trendAlignment * weights.trendAlignment +
        features.trendSimilarity * weights.trendSimilarity
    );
}

/**
 * Calculates a composite format score from multiple signals.
 */
export function calculateCompositeFormatScore(features) {
    const weights = {
        formatStrength: 0.5,
        formatSuitability: 0.3,
        historicalPerformance: 0.2
    };
    
    return (
        features.formatStrength * weights.formatStrength +
        features.formatSuitability * weights.formatSuitability +
        features.historicalPerformance * weights.historicalPerformance
    );
}

/**
 * Gets feature importance weights based on context.
 * Weights change dynamically based on the proposal characteristics.
 */
export function getDynamicWeights(features) {
    const baseWeights = {
        originality: 0.25,
        trend: 0.25,
        format: 0.25,
        channel: 0.15,
        competition: 0.10
    };
    
    // If video is mostly copied, originality becomes critical
    if (features.videoOriginality < 0.3) {
        baseWeights.originality = 0.40;
        baseWeights.format = 0.20;
        baseWeights.trend = 0.20;
        baseWeights.channel = 0.10;
        baseWeights.competition = 0.10;
    }
    
    // If format has poor historical performance, reduce its weight
    if (features.historicalPerformance < 0.5) {
        baseWeights.format = 0.15;
        baseWeights.originality = 0.35;
        baseWeights.trend = 0.30;
        baseWeights.channel = 0.10;
        baseWeights.competition = 0.10;
    }
    
    // If channel has low consistency, reduce channel weight
    if (features.channelConsistency < 0.3) {
        baseWeights.channel = 0.05;
        baseWeights.originality = 0.30;
        baseWeights.trend = 0.30;
        baseWeights.format = 0.25;
        baseWeights.competition = 0.10;
    }
    
    // If competition is high, increase trend and originality weight
    if (features.competition > 0.7) {
        baseWeights.originality = 0.35;
        baseWeights.trend = 0.30;
        baseWeights.format = 0.20;
        baseWeights.channel = 0.10;
        baseWeights.competition = 0.05;
    }
    
    return baseWeights;
}
