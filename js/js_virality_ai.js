/* ==========================================================
   BRAWL ANALYTICS
   VIRALITY AI COMMUNICATION MODULE

   Handles AI communication for qualitative virality analysis.
   The LLM provides qualitative reasoning, not numerical scores.
========================================================== */

const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";
const AI_MODEL = "llama-3.3-70b-versatile";

/**
 * Calls the AI worker with a structured request.
 */
async function callAIWorker(messages, options = {}) {
    const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            messages,
            model: AI_MODEL,
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 2048
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return data.choices?.[0]?.message?.content || data.result?.response || "";
}

/**
 * Extracts JSON from AI response, handling markdown code blocks.
 */
function extractJSON(text) {
    if (!text) return null;
    
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    
    // Try to find JSON object
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
        try {
            return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
        } catch (e) {
            // Try array instead
        }
    }
    
    // Try JSON array
    const arrayStart = cleaned.indexOf("[");
    const arrayEnd = cleaned.lastIndexOf("]");
    
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        try {
            return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
        } catch (e) {
            console.error("Failed to parse JSON from AI response:", e);
            return null;
        }
    }
    
    // Try parsing the whole text
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("Failed to parse JSON from AI response:", e);
        return null;
    }
}

/**
 * Analyzes a video proposal using AI for qualitative assessment.
 * Returns ONLY structured features, not strengths/weaknesses/summary.
 */
export async function analyzeVideoWithAI(proposal, channelProfile, currentTrends = []) {
    const { videoOriginality, ideaOriginality, format, description } = proposal;
    
    // Build context from channel profile
    const channelContext = buildChannelContext(channelProfile);
    
    // Build trends context for semantic comparison
    const trendsContext = buildTrendsContext(currentTrends);
    
    const promptText = `
You are analyzing a proposed Brawl Stars YouTube Short for a specific creator. Your role is to extract STRUCTURED FEATURES ONLY.

CREATOR CONTEXT:
${channelContext}

CURRENT TRENDS:
${trendsContext}

VIDEO PROPOSAL:
- Video Originality: ${videoOriginality}
- Idea Originality: ${ideaOriginality}
- Selected Format: ${format}
- Description: "${description}"

Analyze this proposal and return ONLY structured features. DO NOT generate strengths, weaknesses, summary, or critical issues. These will be generated separately.

Focus on these features:
1. trendAlignment: How well does the content align with current trends? (strong/moderate/weak/none)
2. semanticTrendSimilarity: Numerical similarity (0.0-1.0) between description and trends
3. formatSuitability: How suitable is the format for this content? (excellent/good/fair/poor)
4. historicalFit: How well does this fit the creator's historical patterns? (strong/moderate/weak)
5. innovation: How innovative is this idea? (high/medium/low)
6. competition: How competitive/saturated is this topic? (low/medium/high)
7. topicFreshness: How fresh is this topic for the creator? (high/medium/low)
8. formatNovelty: Is this format new for the creator? (high/medium/low)

Return ONLY a valid JSON object with this exact schema:
{
  "trendAlignment": "strong|moderate|weak|none",
  "semanticTrendSimilarity": 0.0-1.0,
  "formatSuitability": "excellent|good|fair|poor",
  "historicalFit": "strong|moderate|weak",
  "innovation": "high|medium|low",
  "competition": "low|medium|high",
  "topicFreshness": "high|medium|low",
  "formatNovelty": "high|medium|low"
}

All string values must be lowercase. semanticTrendSimilarity must be a number between 0 and 1.
`;

    try {
        const response = await callAIWorker([
            { 
                role: "system", 
                content: "You are an expert YouTube Shorts analyst specializing in Brawl Stars content. You provide qualitative analysis only, never numerical scores. Return ONLY valid JSON." 
            },
            { role: "user", content: promptText }
        ], { temperature: 0.5, maxTokens: 2048 });

        const analysis = extractJSON(response);
        
        if (!analysis) {
            console.error("Failed to parse AI analysis response");
            return getDefaultAnalysis();
        }
        
        return validateAnalysis(analysis);
        
    } catch (error) {
        console.error("Error during AI analysis:", error);
        return getDefaultAnalysis();
    }
}

/**
 * Builds context string from channel profile.
 */
function buildChannelContext(profile) {
    if (!profile) return "No channel data available.";
    
    const topFormats = profile.bestFormats.slice(0, 3).join(", ") || "None detected";
    const avgViews = profile.averageViews > 0 ? `${Math.round(profile.averageViews / 1000)}K average views` : "No view data";
    
    return `
- Channel: ${profile.channelName}
- Total Videos: ${profile.totalVideos}
- Performance: ${avgViews}
- Best Formats: ${topFormats}
- Average Retention: ${Math.round(profile.averageRetention)}%
`;
}

/**
 * Builds context string from current trends.
 */
function buildTrendsContext(trends) {
    if (!Array.isArray(trends) || trends.length === 0) {
        return "No trend data available.";
    }
    
    return trends.slice(0, 5).join(", ");
}

/**
 * Validates and sanitizes AI analysis response.
 */
function validateAnalysis(analysis) {
    const defaults = getDefaultAnalysis();
    
    // Ensure all required fields exist
    return {
        trendAlignment: isValidEnum(analysis.trendAlignment, ["strong", "moderate", "weak", "none"]) ? analysis.trendAlignment : defaults.trendAlignment,
        semanticTrendSimilarity: typeof analysis.semanticTrendSimilarity === "number" ? Math.max(0, Math.min(1, analysis.semanticTrendSimilarity)) : defaults.semanticTrendSimilarity,
        formatSuitability: isValidEnum(analysis.formatSuitability, ["excellent", "good", "fair", "poor"]) ? analysis.formatSuitability : defaults.formatSuitability,
        historicalFit: isValidEnum(analysis.historicalFit, ["strong", "moderate", "weak"]) ? analysis.historicalFit : defaults.historicalFit,
        innovation: isValidEnum(analysis.innovation, ["high", "medium", "low"]) ? analysis.innovation : defaults.innovation,
        competition: isValidEnum(analysis.competition, ["low", "medium", "high"]) ? analysis.competition : defaults.competition,
        topicFreshness: isValidEnum(analysis.topicFreshness, ["high", "medium", "low"]) ? analysis.topicFreshness : defaults.topicFreshness,
        formatNovelty: isValidEnum(analysis.formatNovelty, ["high", "medium", "low"]) ? analysis.formatNovelty : defaults.formatNovelty
    };
}

/**
 * Checks if a value is in the allowed enum values.
 */
function isValidEnum(value, allowed) {
    return allowed.includes(value);
}

/**
 * Returns default analysis when AI fails.
 */
function getDefaultAnalysis() {
    return {
        trendAlignment: "moderate",
        semanticTrendSimilarity: 0.5,
        formatSuitability: "fair",
        historicalFit: "moderate",
        innovation: "medium",
        competition: "medium",
        topicFreshness: "medium",
        formatNovelty: "medium"
    };
}
