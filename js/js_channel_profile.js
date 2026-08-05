/* ==========================================================
   BRAWL ANALYTICS
   CHANNEL PROFILE MODULE

   Builds a structured Channel Profile from CSV data for use
   by the Virality Engine. This profile serves as the historical
   baseline for all predictions.
========================================================== */

import { getVideoTitle, getVideoViews, getVideoRetention } from "./js_csv_fields.js";
import { classifyVideosEffective, getFormatRanking } from "./js_fomats.js";
import { loadCustomFormats } from "./js_storage.js";

/**
 * Builds a Channel Profile from video data and custom formats.
 * This profile represents the historical behavior of the channel.
 */
export async function buildChannelProfile(videos, customFormats = []) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return createEmptyProfile();
    }

    const formats = customFormats.length > 0 ? customFormats : await loadCustomFormats();
    const classifiedVideos = classifyVideosEffective(videos, formats);
    const formatRanking = getFormatRanking(classifiedVideos, formats);

    const views = videos.map(v => getVideoViews(v)).filter(v => v > 0);
    const retentions = videos.map(v => getVideoRetention(v)).filter(v => v > 0);

    const totalVideos = videos.length;
    const averageViews = views.length > 0 ? views.reduce((a, b) => a + b, 0) / views.length : 0;
    const medianViews = calculateMedian(views);
    const averageRetention = retentions.length > 0 ? retentions.reduce((a, b) => a + b, 0) / retentions.length : 0;

    const durations = videos
        .map(v => v["Durata"] || v.duration || 0)
        .filter(d => d > 0);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const idealDuration = calculateIdealDuration(durations);

    const formatPerformance = calculateFormatPerformance(classifiedVideos, formatRanking);

    // Calcola totalViews per ogni formato
    const formatsWithTotalViews = Object.entries(formatPerformance).map(([name, stats]) => {
        const formatVideos = classifiedVideos.filter(v => v.format === name);
        const totalViews = formatVideos.reduce((sum, v) => sum + getVideoViews(v), 0);
        return [name, { ...stats, totalViews }];
    });

    const sortedFormats = formatsWithTotalViews
        .sort((a, b) => b[1].totalViews - a[1].totalViews);

    const bestFormats = sortedFormats.slice(0, 3).map(([name]) => name);
    const worstFormats = sortedFormats.slice(-3).map(([name]) => name).reverse();

    return {
        channelName: extractChannelName(videos),
        totalVideos,
        averageViews,
        medianViews,
        averageRetention,
        averageDuration,
        idealDuration,
        bestFormats,
        worstFormats,
        formatPerformance,
        historicalVideos: classifiedVideos.map(video => ({
            title: getVideoTitle(video),
            views: getVideoViews(video),
            retention: getVideoRetention(video),
            duration: video["Durata"] || video.duration || 0,
            format: video.format || "Unknown",
            publishedAt: video["Data pubblicazione"] instanceof Date
                ? video["Data pubblicazione"].toISOString()
                : null
        }))
    };
}

/**
 * Creates an empty Channel Profile for when no data is available.
 */
function createEmptyProfile() {
    return {
        channelName: "Unknown",
        totalVideos: 0,
        averageViews: 0,
        medianViews: 0,
        averageRetention: 0,
        averageDuration: 0,
        idealDuration: 58, // Default optimal Short duration
        bestFormats: [],
        worstFormats: [],
        formatPerformance: {},
        historicalVideos: []
    };
}

/**
 * Extracts channel name from video data (if available).
 */
function extractChannelName(videos) {
    // Try to find channel name from common CSV fields
    const firstVideo = videos[0];
    if (!firstVideo) return "Unknown";

    const channelFields = ["Canale", "Channel", "channel", "canale"];
    for (const field of channelFields) {
        if (firstVideo[field]) {
            return String(firstVideo[field]).trim();
        }
    }

    return "Unknown";
}

/**
 * Calculates median value from an array of numbers.
 */
function calculateMedian(values) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    return sorted[mid];
}

/**
 * Calculates ideal duration based on historical performance.
 * Uses the duration of top-performing videos as a baseline.
 */
function calculateIdealDuration(durations) {
    if (durations.length === 0) return 58; // Default optimal Short duration
    
    // For YouTube Shorts, optimal duration is typically 50-60 seconds
    // We'll use the median as a baseline, constrained to reasonable bounds
    const median = calculateMedian(durations);
    
    // Constrain to 30-60 seconds range for Shorts
    return Math.max(30, Math.min(60, median));
}

/**
 * Calculates performance metrics for each format.
 */
function calculateFormatPerformance(classifiedVideos, formatRanking) {
    const performance = {};

    // Group videos by format
    const formatGroups = {};
    classifiedVideos.forEach(video => {
        const format = video.format || "Other";
        if (!formatGroups[format]) {
            formatGroups[format] = [];
        }
        formatGroups[format].push(video);
    });

    // Calculate metrics for each format
    Object.entries(formatGroups).forEach(([format, formatVideos]) => {
        const views = formatVideos.map(v => getVideoViews(v)).filter(v => v > 0);
        const retentions = formatVideos.map(v => getVideoRetention(v)).filter(v => v > 0);

        const totalViews = views.reduce((a, b) => a + b, 0);
        const averageViews = views.length > 0 ? totalViews / views.length : 0;
        const medianViews = calculateMedian(views);
        const averageRetention = retentions.length > 0 ? retentions.reduce((a, b) => a + b, 0) / retentions.length : 0;
        const videoCount = formatVideos.length;

        performance[format] = {
            videoCount,
            totalViews,
            averageViews,
            medianViews,
            averageRetention
        };
    });

    return performance;
}

/**
 * Gets available formats from the Channel Profile.
 * This is used to populate the dynamic format selector.
 */
export function getAvailableFormats(channelProfile) {
    if (!channelProfile?.formatPerformance) {
        return [];
    }

    return Object.keys(channelProfile.formatPerformance)
        .filter(format => (channelProfile.formatPerformance[format]?.videoCount || 0) > 0)
        .sort((a, b) => {
            const perfA = channelProfile.formatPerformance[a];
            const perfB = channelProfile.formatPerformance[b];

            // Ordina per totalViews PRIMA (criterio principale)
            if ((perfB?.totalViews ?? 0) !== (perfA?.totalViews ?? 0)) {
                return (perfB?.totalViews ?? 0) - (perfA?.totalViews ?? 0);
            }
            // Tie-breaker: averageViews
            if ((perfB?.averageViews ?? 0) !== (perfA?.averageViews ?? 0)) {
                return (perfB?.averageViews ?? 0) - (perfA?.averageViews ?? 0);
            }
            // Tie-breaker finale: videoCount
            return (perfB?.videoCount ?? 0) - (perfA?.videoCount ?? 0);
        });
}

/**
 * Gets statistics for a specific format from the Channel Profile.
 */
export function getFormatStatistics(channelProfile, formatName) {
    if (!channelProfile || !formatName) {
        return null;
    }

    if (channelProfile.formatPerformance?.[formatName]) {
        return channelProfile.formatPerformance[formatName];
    }

    const matchingVideos = (channelProfile.historicalVideos || []).filter(video => video.format === formatName);
    if (matchingVideos.length === 0) {
        return null;
    }

    const views = matchingVideos.map(video => video.views || 0).filter(value => value > 0);
    const retentions = matchingVideos.map(video => video.retention || 0).filter(value => value > 0);
    const totalViews = views.reduce((a, b) => a + b, 0);

    return {
        videoCount: matchingVideos.length,
        totalViews,
        averageViews: views.length > 0 ? totalViews / views.length : 0,
        medianViews: calculateMedian(views),
        averageRetention: retentions.length > 0 ? retentions.reduce((a, b) => a + b, 0) / retentions.length : 0
    };
}

/**
 * Calculates channel consistency score based on view variance.
 * Higher consistency = more predictable performance.
 */
export function calculateChannelConsistency(channelProfile) {
    if (!channelProfile || channelProfile.historicalVideos.length < 2) {
        return 0.5; // Default medium consistency for new channels
    }

    const views = channelProfile.historicalVideos
        .map(v => v.views)
        .filter(v => v > 0);

    if (views.length < 2) return 0.5;
    
    const mean = views.reduce((a, b) => a + b, 0) / views.length;
    const variance = views.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / views.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation (lower = more consistent)
    const cv = mean > 0 ? stdDev / mean : 1;
    
    // Convert to consistency score (0-1, higher = more consistent)
    return Math.max(0, Math.min(1, 1 - cv));
}
