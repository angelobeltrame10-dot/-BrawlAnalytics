/* ==========================================================
   BRAWL ANALYTICS
   PERSONAL AI COACH — Pro only feature
========================================================== */

import { getCurrentPlan, openUpgradeModal } from "./js_subscription.js";
import { loadChannelProfile, loadDashboardData } from "./js_storage.js";


const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";

const LOADING_MESSAGES = [
    "Analyzing your channel history...",
    "Identifying performance patterns...",
    "Generating personalized insights...",
    "Developing strategic recommendations...",
    "Almost done..."
];

// Static, always-true best-practice tips. These are NOT AI generated:
// they encode facts about how Shorts/the BS creator space behave, so
// they show up reliably even if the LLM output skips them.
const PLAYBOOK_TIPS = [
    {
        icon: "📅",
        title: "Schedule, don't rush",
        text: "Finishing the edit doesn't mean it's time to publish. Queue the Short for a consistent time slot — evenings and weekends usually perform best — instead of posting the moment it's ready."
    },
    {
        icon: "🧬",
        title: "Copied ideas have a ceiling",
        text: "Reusing another Brawl Stars creator's idea caps performance — roughly the low tens of thousands of views at best. Copy the structure or the clips too, and it usually performs even worse."
    },
    {
        icon: "🎯",
        title: "Own idea, own format, own style",
        text: "Inspiration from trends is fine — duplication isn't. Channels that break out consistently combine a personal angle with a format and edit viewers recognize as theirs."
    },
    {
        icon: "🔁",
        title: "Consistency beats perfection",
        text: "A predictable upload rhythm trains both the algorithm and your audience faster than occasional 'perfect' uploads with long gaps in between."
    },
    {
        icon: "⏱",
        title: "Win the first 2 seconds",
        text: "Most retention drop-off on Shorts happens almost immediately. Lead with the payoff or the hook — don't build up to it."
    }
];

let initialized = false;
let loadingTimer = null;
let channelProfileCache = null;


export function initAICoach(){

    if(initialized){
        return;
    }

    initialized = true;
    renderInput();

}


function renderInput(){

    const flow = document.getElementById("coach-flow");
    if(!flow) return;

    flow.innerHTML = `
        <div class="va-card">
            <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">Your dedicated YouTube strategist. The AI will analyze your entire channel history to provide personalized recommendations.</p>
            <button class="va-primary" id="coach-analyze-btn" type="button">Generate Insights <span>→</span></button>
        </div>`;

    document.getElementById("coach-analyze-btn").addEventListener("click", handleAnalyzeClick);

}

async function getChannelProfile() {
    if (channelProfileCache) return channelProfileCache;
    channelProfileCache = await loadChannelProfile();
    return channelProfileCache;
}

async function handleAnalyzeClick(){

    if(getCurrentPlan() !== "pro"){
        openUpgradeModal();
        return;
    }

    renderLoading();

    try{
        // Get channel profile for personalized analysis
        const channelProfile = await getChannelProfile();

        if (!channelProfile) {
            renderError("Please upload your CSV data first to generate personalized insights.");
            return;
        }

        // Prepare historical data
        const videos = await loadDashboardData();
        
        const historicalData = {
            videos: videos.slice(-20), // Last 20 videos for recent performance
            uploadFrequency: calculateUploadFrequency(videos)
        };

        const response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "personal_coach",
                channelProfile: channelProfile,
                historicalData: historicalData,
                recentAnalyses: [] // Can be expanded to track previous analyses
            })
        });

        const data = await response.json();

        if(!response.ok || data?.error){
            throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
        }

        renderResults(data);

    }
    catch(error){

        console.error("AI Coach error:", error);
        renderError();

    }

}

function calculateUploadFrequency(videos) {
    if (!Array.isArray(videos) || videos.length < 2) {
        return "Unknown";
    }

    // Simple calculation: average days between uploads
    // This is a placeholder - actual implementation would need date parsing
    return "Regular";
}

function renderLoading(){

    const flow = document.getElementById("coach-flow");

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">PERSONAL AI COACH</span>
            <h3>Analyzing your channel<span class="va-loading">...</span></h3>
            <p id="coach-loading-text">${LOADING_MESSAGES[0]}</p>
        </div>`;

    let index = 0;

    if(loadingTimer) clearInterval(loadingTimer);

    loadingTimer = setInterval(()=>{

        index = (index + 1) % LOADING_MESSAGES.length;
        const el = document.getElementById("coach-loading-text");

        if(!el){
            clearInterval(loadingTimer);
            return;
        }

        el.textContent = LOADING_MESSAGES[index];

    }, 900);

}

function renderError(message){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("coach-flow");

    flow.innerHTML = `
        <div class="va-card" style="text-align:center">
            <p>${message || "Something went wrong while generating insights. Please try again."}</p>
            <button class="va-outline" id="coach-retry-btn" type="button" style="margin-top:1rem">Try again</button>
        </div>`;

    document.getElementById("coach-retry-btn").addEventListener("click", renderInput);

}

/*
    Renders a single list card (formats / insights / recommendations)
    with a consistent, styled look instead of a raw <ul> dropped inside
    a generic banner.
*/
function listCard(title, icon, items, variant = ""){

    if(!items || items.length === 0) return "";

    return `
        <div class="coach-list-card ${variant}">
            <h4>${icon ? `<span>${icon}</span>` : ""}${title}</h4>
            <ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>
        </div>`;

}

function renderResults(result){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("coach-flow");

    const originalityLevel = (result.originalityRisk?.level || "medium").toLowerCase();
    const originalityLabel = { low: "Low risk", medium: "Medium risk", high: "High risk" }[originalityLevel] || "Medium risk";
    const originalityIcon = { low: "✓", medium: "⚠", high: "⛔" }[originalityLevel] || "⚠";

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">PERSONAL AI COACH</span>
                    <h3>Channel Analysis Complete</h3>
                    <p>Here are your personalized insights and recommendations.</p>
                </div>
                <button class="va-outline" id="coach-restart" type="button">Refresh Insights →</button>
            </div>

            <!-- Overall Rating -->
            <div class="va-score-grid">
                <article class="va-metric va-score">
                    <span>OVERALL RATING</span>
                    <strong><b>${result.overallCreatorRating || "B"}</b></strong>
                    <i>Based on consistency, originality & execution</i>
                </article>
            </div>

            <!-- Insight Cards -->
            <div class="va-section-title"><div><span class="va-step">INSIGHTS</span><h3>Channel Analysis</h3></div></div>
            
            <div class="coach-insights-grid">
                <article class="coach-card coach-strength">
                    <span class="coach-icon">🏆</span>
                    <h4>Biggest Strength</h4>
                    <p>${result.biggestStrength || "Analyzing..."}</p>
                </article>

                <article class="coach-card coach-weakness">
                    <span class="coach-icon">⚠</span>
                    <h4>Biggest Weakness</h4>
                    <p>${result.biggestWeakness || "Analyzing..."}</p>
                </article>

                <article class="coach-card coach-progress">
                    <span class="coach-icon">📈</span>
                    <h4>Recent Progress</h4>
                    <p>${result.recentProgress || "Insufficient data"}</p>
                </article>

                <article class="coach-card coach-opportunity">
                    <span class="coach-icon">🔥</span>
                    <h4>Current Opportunity</h4>
                    <p>${result.currentOpportunity || "Continue current strategy"}</p>
                </article>
            </div>

            <!-- Originality Risk -->
            <div class="coach-alert coach-alert-${originalityLevel}">
                <span class="coach-alert-icon">${originalityIcon}</span>
                <div>
                    <h4>Originality Risk — ${originalityLabel}</h4>
                    <p>${result.originalityRisk?.explanation || ""}</p>
                </div>
            </div>

            <!-- Upload Timing -->
            <div class="coach-timing-box">
                <span class="coach-timing-icon">📅</span>
                <div>
                    <h4>Publishing & Scheduling</h4>
                    <p>${result.uploadTimingAdvice || ""}</p>
                </div>
            </div>

            <!-- Strategy Section -->
            <div class="va-section-title"><div><span class="va-step">STRATEGY</span><h3>AI Strategy</h3></div></div>
            <section class="banner" style="margin-bottom:1.5rem">
                <p style="color:var(--color-text)">${result.aiStrategy || "Developing strategy..."}</p>
            </section>

            <!-- Next Week Recommendation -->
            <div class="va-section-title"><div><span class="va-step">ACTION</span><h3>Next Week Recommendation</h3></div></div>
            <section class="banner" style="margin-bottom:1.5rem">
                <p style="color:var(--color-text)">${result.nextWeekRecommendation || "Maintain upload schedule"}</p>
            </section>

            <!-- Performance Patterns -->
            <div class="va-section-title"><div><span class="va-step">PATTERNS</span><h3>Performance Patterns</h3></div></div>
            <div class="coach-patterns-grid">
                <article class="coach-pattern-card">
                    <span>Best Day</span>
                    <strong>${result.performancePatterns?.bestDay || "Unknown"}</strong>
                </article>
                <article class="coach-pattern-card">
                    <span>Ideal Duration</span>
                    <strong>${result.performancePatterns?.idealDuration || 58}s</strong>
                </article>
            </div>

            ${listCard("Winning Formats", "✅", result.performancePatterns?.winningFormats)}
            ${listCard("Formats to Avoid", "⚠", result.performancePatterns?.weakFormats, "weak")}
            ${listCard("Key Insights", "💡", result.keyInsights)}

            <!-- Platform Playbook (static, always-true advice) -->
            <div class="va-section-title"><div><span class="va-step">PLAYBOOK</span><h3>What Actually Moves the Needle</h3></div><p>Battle-tested principles, not generic tips.</p></div>
            <div class="coach-playbook">
                ${PLAYBOOK_TIPS.map(tip => `
                    <article class="coach-playbook-item">
                        <span>${tip.icon}</span>
                        <div>
                            <h5>${tip.title}</h5>
                            <p>${tip.text}</p>
                        </div>
                    </article>
                `).join("")}
            </div>

            ${listCard("Strategic Recommendations", "🧭", result.longTermRecommendations)}
        </div>`;

    document.getElementById("coach-restart").addEventListener("click", handleAnalyzeClick);

}