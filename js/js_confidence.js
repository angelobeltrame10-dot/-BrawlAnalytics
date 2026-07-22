/* ==========================================================
   BRAWL ANALYTICS
   CONFIDENCE CALCULATION MODULE

   Calculates prediction confidence independently from Virality Score.
   Confidence measures how reliable the prediction is.
========================================================== */

import { getFormatStatistics } from "./js_channel_profile.js";

/**
 * Calculates confidence score (0-100) for the prediction.
 * Confidence is independent from the Virality Score.
 * Now considers similarity to historical videos.
 */
export function calculateConfidence(features, channelProfile, proposal) {
    const factors = {
        dataVolume: calculateDataVolumeConfidence(channelProfile),
        formatHistory: calculateFormatHistoryConfidence(proposal.format, channelProfile),
        channelConsistency: calculateChannelConsistencyConfidence(features.channelConsistency),
        trendAlignment: calculateTrendAlignmentConfidence(features.trendAlignment),
        formatNovelty: calculateFormatNoveltyConfidence(proposal.format, channelProfile),
        historicalSimilarity: calculateHistoricalSimilarityConfidence(features, channelProfile, proposal)
    };
    
    // Weight the factors - increased weight for historical similarity
    const weights = {
        dataVolume: 0.25,
        formatHistory: 0.20,
        channelConsistency: 0.15,
        trendAlignment: 0.10,
        formatNovelty: 0.10,
        historicalSimilarity: 0.20
    };
    
    const weightedConfidence = (
        factors.dataVolume * weights.dataVolume +
        factors.formatHistory * weights.formatHistory +
        factors.channelConsistency * weights.channelConsistency +
        factors.trendAlignment * weights.trendAlignment +
        factors.formatNovelty * weights.formatNovelty +
        factors.historicalSimilarity * weights.historicalSimilarity
    );
    
    return Math.round(weightedConfidence * 100);
}

/**
 * Calculates confidence based on data volume.
 * More historical data = higher confidence.
 */
function calculateDataVolumeConfidence(profile) {
    if (!profile || profile.totalVideos === 0) {
        return 0.2; // Very low confidence with no data
    }
    
    // Confidence increases with more videos, but caps at 50 videos
    const videoCount = profile.totalVideos;
    
    if (videoCount >= 50) return 1.0;
    if (videoCount >= 30) return 0.9;
    if (videoCount >= 20) return 0.8;
    if (videoCount >= 15) return 0.7;
    if (videoCount >= 10) return 0.6;
    if (videoCount >= 5) return 0.5;
    if (videoCount >= 3) return 0.4;
    
    return 0.3;
}

/**
 * Calculates confidence based on format history.
 * More videos in the same format = higher confidence.
 */
function calculateFormatHistoryConfidence(format, profile) {
    const stats = getFormatStatistics(profile, format);
    
    if (!stats || stats.videoCount === 0) {
        return 0.4; // Lower confidence for new/unknown formats
    }
    
    const videoCount = stats.videoCount;
    
    // Confidence increases with more format-specific videos
    if (videoCount >= 20) return 1.0;
    if (videoCount >= 10) return 0.9;
    if (videoCount >= 5) return 0.8;
    if (videoCount >= 3) return 0.7;
    
    return 0.6;
}

/**
 * Calculates confidence based on channel consistency.
 * More consistent channels = higher confidence.
 */
function calculateChannelConsistencyConfidence(consistencyScore) {
    // consistencyScore is already 0-1 from feature extraction
    // Higher consistency = higher confidence
    return consistencyScore;
}

/**
 * Calculates confidence based on trend alignment.
 * Strong trend alignment = higher confidence.
 */
function calculateTrendAlignmentConfidence(trendAlignment) {
    // trendAlignment is already 0-1 from feature extraction
    // Strong trend alignment gives us more confidence in trend-based predictions
    return trendAlignment;
}

/**
 * Calculates confidence based on format novelty.
 * New formats = lower confidence.
 */
function calculateFormatNoveltyConfidence(format, profile) {
    const stats = getFormatStatistics(profile, format);
    
    if (!stats || stats.videoCount === 0) {
        return 0.5; // Medium confidence for new formats
    }
    
    // If the format is well-established, confidence is higher
    if (stats.videoCount >= 5) return 1.0;
    
    return 0.7;
}

/**
 * Gets a qualitative assessment of confidence.
 */
export function getConfidenceQualitative(confidence) {
    if (confidence >= 85) return "Very high";
    if (confidence >= 70) return "High";
    if (confidence >= 55) return "Moderate";
    if (confidence >= 40) return "Low";
    return "Very low";
}

/**
 * Gets confidence factors for explainability.
 */
export function getConfidenceFactors(features, channelProfile, proposal) {
    return {
        dataVolume: {
            score: Math.round(calculateDataVolumeConfidence(channelProfile) * 100),
            label: "Historical Data",
            description: channelProfile.totalVideos >= 30 
                ? "Strong historical data available" 
                : channelProfile.totalVideos >= 10 
                    ? "Moderate historical data" 
                    : "Limited historical data"
        },
        formatHistory: {
            score: Math.round(calculateFormatHistoryConfidence(proposal.format, channelProfile) * 100),
            label: "Format History",
            description: getFormatHistoryDescription(proposal.format, channelProfile)
        },
        channelConsistency: {
            score: Math.round(features.channelConsistency * 100),
            label: "Channel Consistency",
            description: features.channelConsistency >= 0.7 
                ? "Highly consistent channel" 
                : features.channelConsistency >= 0.5 
                    ? "Moderately consistent channel" 
                    : "Variable channel performance"
        },
        trendAlignment: {
            score: Math.round(features.trendAlignment * 100),
            label: "Trend Alignment",
            description: features.trendAlignment >= 0.7 
                ? "Strong trend alignment" 
                : features.trendAlignment >= 0.4 
                    ? "Moderate trend alignment" 
                    : "Weak trend alignment"
        },
        formatNovelty: {
            score: Math.round(calculateFormatNoveltyConfidence(proposal.format, channelProfile) * 100),
            label: "Format Familiarity",
            description: getFormatNoveltyDescription(proposal.format, channelProfile)
        },
        historicalSimilarity: {
            score: Math.round(calculateHistoricalSimilarityConfidence(features, channelProfile, proposal) * 100),
            label: "Historical Similarity",
            description: getHistoricalSimilarityDescription(features, channelProfile, proposal)
        }
    };
}

/**
 * Gets description for historical similarity.
 */
function getHistoricalSimilarityDescription(features, channelProfile, proposal) {
    const similarity = calculateHistoricalSimilarityConfidence(features, channelProfile, proposal);
    
    if (similarity >= 0.8) {
        return "Video very similar to historical content - high confidence";
    }
    if (similarity >= 0.6) {
        return "Video moderately similar to historical content";
    }
    if (similarity >= 0.4) {
        return "Video somewhat different from historical content";
    }
    return "Video significantly different from historical content - lower confidence";
}

/**
 * Gets description for format history.
 */
function getFormatHistoryDescription(format, profile) {
    const stats = getFormatStatistics(profile, format);
    
    if (!stats || stats.videoCount === 0) {
        return "New format with no history";
    }
    
    if (stats.videoCount >= 10) {
        return "Well-established format with strong history";
    }
    
    if (stats.videoCount >= 5) {
        return "Established format with good history";
    }
    
    return "Emerging format with limited history";
}

/**
 * Gets description for format novelty.
 */
function getFormatNoveltyDescription(format, profile) {
    const stats = getFormatStatistics(profile, format);
    
    if (!stats || stats.videoCount === 0) {
        return "New format - higher uncertainty";
    }
    
    if (stats.videoCount >= 5) {
        return "Familiar format - reliable predictions";
    }
    
    return "Developing format - moderate uncertainty";
}

/**
 * Calculates confidence based on similarity to historical videos.
 * Higher similarity = higher confidence.
 */
function calculateHistoricalSimilarityConfidence(features, channelProfile, proposal) {
    if (!channelProfile || !channelProfile.historicalVideos || channelProfile.historicalVideos.length === 0) {
        return 0.3; // Low confidence with no history
    }
    
    let similarityScore = 0;
    
    // Format similarity
    const formatMatches = channelProfile.historicalVideos.filter(v => v.format === proposal.format);
    const formatRatio = formatMatches.length / channelProfile.historicalVideos.length;
    similarityScore += formatRatio * 0.4;
    
    // Historical fit from AI
    similarityScore += features.historicalFit * 0.3;
    
    // Topic freshness (reversed - higher freshness = lower confidence for new topics)
    similarityScore += (1 - features.topicFreshness) * 0.2;
    
    // Format novelty (reversed - higher novelty = lower confidence)
    similarityScore += (1 - features.formatNovelty) * 0.1;
    
    return Math.min(1.0, similarityScore);
}
