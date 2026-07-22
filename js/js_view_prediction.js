/* ==========================================================
   BRAWL ANALYTICS
   VIEW PREDICTION MODULE

   Estimates predicted view range based on historical data.
   Returns an interval, not a single number. Wider intervals
   for lower confidence predictions.
========================================================== */

import { getFormatStatistics } from "./js_channel_profile.js";

/**
 * Predicts view range based on similar historical videos.
 * Returns an interval [min, max] that widens with lower confidence.
 */
export function predictViewRange(features, channelProfile, proposal, confidence) {
    // Find similar videos from history
    const similarVideos = findSimilarVideos(features, channelProfile, proposal);
    
    // Calculate baseline from similar videos
    const baseline = calculateBaselineFromSimilar(similarVideos, channelProfile);
    
    // Calculate expected performance multiplier based on features
    const performanceMultiplier = calculatePerformanceMultiplier(features);
    
    // Calculate base prediction
    const basePrediction = baseline * performanceMultiplier;
    
    // Calculate uncertainty based on confidence and similarity
    const uncertainty = calculateUncertainty(confidence, similarVideos.length, channelProfile);
    
    // Calculate range
    const rangeMultiplier = 1 + uncertainty;
    const minViews = Math.round(basePrediction / rangeMultiplier);
    const maxViews = Math.round(basePrediction * rangeMultiplier);
    
    // Ensure minimum floor
    const floor = Math.max(100, (channelProfile.averageViews || 0) * 0.1);
    
    return {
        min: Math.max(floor, minViews),
        max: Math.max(floor * 2, maxViews),
        baseline: Math.round(basePrediction),
        rangeMultiplier,
        similarVideoCount: similarVideos.length
    };
}

/**
 * Calculates performance multiplier based on features.
 */
function calculatePerformanceMultiplier(features) {
    const baseMultiplier = 1.0;
    
    // Originality impact
    const originalityImpact = (features.videoOriginality - 0.5) * 0.3;
    
    // Trend impact
    const trendImpact = (features.trendAlignment - 0.5) * 0.2;
    
    // Format impact
    const formatImpact = (features.historicalPerformance - 1.0) * 0.25;
    
    // Innovation impact
    const innovationImpact = (features.innovation - 0.5) * 0.15;
    
    // Competition impact (reversed)
    const competitionImpact = (0.5 - features.competition) * 0.1;
    
    const totalImpact = originalityImpact + trendImpact + formatImpact + 
                       innovationImpact + competitionImpact;
    
    return baseMultiplier + totalImpact;
}

/**
 * Calculates uncertainty based on confidence and similar video count.
 * Lower confidence = wider prediction interval.
 */
function calculateUncertainty(confidence, similarVideoCount, channelProfile) {
    // Confidence is 0-100, convert to 0-1
    const normalizedConfidence = confidence / 100;
    
    // Base uncertainty
    let uncertainty = 1.0 - normalizedConfidence;
    
    // Increase uncertainty if few similar videos
    if (similarVideoCount < 3) {
        uncertainty *= 1.5;
    } else if (similarVideoCount < 5) {
        uncertainty *= 1.2;
    }
    
    // Increase uncertainty for new channels
    if (channelProfile.totalVideos < 10) {
        uncertainty *= 1.3;
    }
    
    // Increase uncertainty for inconsistent channels
    if (channelProfile.totalVideos > 0) {
        const views = channelProfile.historicalVideos.map(v => v.views).filter(v => v > 0);
        if (views.length > 3) {
            const mean = views.reduce((a, b) => a + b, 0) / views.length;
            const variance = views.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / views.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
            
            // Higher coefficient of variation = more uncertainty
            uncertainty *= (1 + cv * 0.5);
        }
    }
    
    // Clamp uncertainty to reasonable bounds
    return Math.max(0.2, Math.min(1.5, uncertainty));
}

/**
 * Finds videos similar to the current proposal from historical data.
 * Considers format, historical fit, and topic freshness.
 */
function findSimilarVideos(features, channelProfile, proposal) {
    if (!channelProfile || !channelProfile.historicalVideos || channelProfile.historicalVideos.length === 0) {
        return [];
    }
    
    const historicalVideos = channelProfile.historicalVideos;
    
    // Score each video for similarity
    const scoredVideos = historicalVideos.map(video => {
        let similarityScore = 0;
        
        // Format match (highest weight)
        if (video.format === proposal.format) {
            similarityScore += 0.5;
        }
        
        // Historical fit consideration
        if (features.historicalFit >= 0.7) {
            similarityScore += 0.3;
        } else if (features.historicalFit >= 0.4) {
            similarityScore += 0.15;
        }
        
        // Topic freshness (reversed - similar topics have lower freshness)
        similarityScore += (1 - features.topicFreshness) * 0.2;
        
        return { video, similarityScore };
    });
    
    // Sort by similarity and return top matches
    scoredVideos.sort((a, b) => b.similarityScore - a.similarityScore);
    
    // Return videos with similarity above threshold
    return scoredVideos
        .filter(item => item.similarityScore >= 0.3)
        .slice(0, 10)
        .map(item => item.video);
}

/**
 * Calculates baseline view count from similar videos.
 */
function calculateBaselineFromSimilar(similarVideos, channelProfile) {
    if (similarVideos.length === 0) {
        // Fallback to channel average
        return channelProfile.averageViews || 0;
    }
    
    // Calculate weighted average of similar videos
    const views = similarVideos.map(v => v.views).filter(v => v > 0);
    
    if (views.length === 0) {
        return channelProfile.averageViews || 0;
    }
    
    // Use median to reduce impact of outliers
    const sortedViews = [...views].sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedViews.length / 2);
    
    if (sortedViews.length % 2 === 0) {
        return (sortedViews[medianIndex - 1] + sortedViews[medianIndex]) / 2;
    }
    
    return sortedViews[medianIndex];
}

/**
 * Formats view numbers for display (e.g., "120K", "1.5M").
 */
export function formatViewCount(views) {
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(views % 1000000 === 0 ? 0 : 1)}M`;
    }
    if (views >= 1000) {
        return `${(views / 1000).toFixed(views % 1000 === 0 ? 0 : 1)}K`;
    }
    return `${Math.round(views)}`;
}

/**
 * Formats view range for display.
 */
export function formatViewRange(range) {
    const min = formatViewCount(range.min);
    const max = formatViewCount(range.max);
    return `${min} – ${max}`;
}

/**
 * Gets comparable historical videos for context.
 */
export function getComparableVideos(proposal, channelProfile, features) {
    if (!channelProfile || !channelProfile.historicalVideos) {
        return [];
    }
    
    const historicalVideos = channelProfile.historicalVideos;
    
    // Filter by format
    const formatMatches = historicalVideos.filter(v => 
        v.format === proposal.format
    );
    
    // If we have enough format matches, use those
    if (formatMatches.length >= 5) {
        return formatMatches
            .sort((a, b) => b.views - a.views)
            .slice(0, 5);
    }
    
    // Otherwise, use top performing videos overall
    return historicalVideos
        .sort((a, b) => b.views - a.views)
        .slice(0, 5);
}

/**
 * Calculates percentile of prediction relative to historical data.
 */
export function calculatePredictionPercentile(range, channelProfile) {
    if (!channelProfile || !channelProfile.historicalVideos || channelProfile.historicalVideos.length === 0) {
        return 50; // Default to median
    }
    
    const views = channelProfile.historicalVideos.map(v => v.views).filter(v => v > 0);
    views.sort((a, b) => a - b);
    
    const baseline = range.baseline;
    
    // Find where baseline falls in the distribution
    let percentile = 0;
    for (let i = 0; i < views.length; i++) {
        if (baseline <= views[i]) {
            percentile = (i / views.length) * 100;
            break;
        }
    }
    
    // If baseline is higher than all historical videos
    if (baseline > views[views.length - 1]) {
        percentile = 100;
    }
    
    return Math.round(percentile);
}

/**
 * Gets prediction context for explainability.
 */
export function getPredictionContext(range, channelProfile, proposal) {
    const comparableVideos = getComparableVideos(proposal, channelProfile, {});
    const percentile = calculatePredictionPercentile(range, channelProfile);
    
    return {
        baseline: range.baseline,
        min: range.min,
        max: range.max,
        percentile,
        comparableVideos: comparableVideos.map(v => ({
            title: v.title,
            views: v.views,
            format: v.format
        })),
        comparison: percentile >= 70 
            ? "Above average" 
            : percentile >= 40 
                ? "Around average" 
                : "Below average"
    };
}
