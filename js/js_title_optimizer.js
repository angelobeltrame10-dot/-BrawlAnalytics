/* ==========================================================
   BRAWL ANALYTICS
   TITLE OPTIMIZER — Pro only, reuse gating/popup/stile esistenti
========================================================== */

import { getCurrentPlan, isProPlan, openUpgradeModal } from "./js_subscription.js?v=20260825-profile-18";
import { loadChannelProfile } from "./js_storage.js";
import { ensureTrendsLoaded } from "./js_trends.js";
import { getAuthHeaders } from "./js_auth_fetch.js";
import { escapeHtml } from "./js_trends.js";

const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";

const LOADING_MESSAGES = [
    "Analyzing your title...",
    "Evaluating click potential...",
    "Checking SEO optimization...",
    "Generating alternatives...",
    "Almost done..."
];

let initialized = false;
let loadingTimer = null;
let channelProfileCache = null;

export function initTitleOptimizer(){

    if(initialized){
        return;
    }

    initialized = true;
    renderInput();

}

function renderInput(){

    const flow = document.getElementById("title-optimizer-flow");
    if(!flow) return;

    flow.innerHTML = `
        <div class="va-card">
            <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">Enter your YouTube Short title. The AI will analyze it and generate optimized alternatives based on your channel's historical performance.</p>
            <input id="title-input" class="hook-textarea" type="text" placeholder="Enter your title..." style="width: 100%; min-height: 60px; padding: 1rem; border: var(--border); border-radius: var(--radius-md); background: var(--color-background); color: var(--color-text); font-size: 1rem; resize: none;">
            <button class="va-primary" id="title-analyze-btn" type="button">Analyze Title <span>→</span></button>
        </div>`;

    document.getElementById("title-analyze-btn").addEventListener("click", handleAnalyzeClick);

}

async function getChannelProfile() {
    if (channelProfileCache) return channelProfileCache;
    channelProfileCache = await loadChannelProfile();
    return channelProfileCache;
}

async function handleAnalyzeClick(){

    const input = document.getElementById("title-input");
    const text = input?.value.trim();

    if(!text){
        input?.focus();
        return;
    }

    if(!isProPlan(getCurrentPlan())){
        openUpgradeModal();
        return;
    }

    renderLoading();

    try{
        // Get channel profile for personalized analysis
        const channelProfile = await getChannelProfile();

        // Get current trends for trend detection
        const currentTrends = await ensureTrendsLoaded();

        const response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                type: "title_optimizer",
                title: text,
                channelProfile: channelProfile,
                currentTrends: currentTrends
            })
        });

        if (response.status === 429) {
            renderRateLimitError();
            return;
        }

        const data = await response.json();
        if(!response.ok || data?.error){
            const msg = String(data?.error?.message || data?.error || "");
            if (msg.toLowerCase().includes("rate limit")) {
                renderRateLimitError();
                return;
            }
            throw new Error(msg || `HTTP ${response.status}`);
        }

        renderResults(data);
    }
    catch(error){
        console.error("Title Optimizer error:", error);
        renderError();
    }
}

function renderRateLimitError(){
    if(loadingTimer) clearInterval(loadingTimer);
    const flow = document.getElementById("title-optimizer-flow");
    flow.innerHTML = `
        <div class="va-card" style="text-align:center">
            <span style="font-size:2rem;display:block;margin-bottom:1rem">⏳</span>
            <h3 style="margin-bottom:.75rem">High demand right now</h3>
            <p style="color:var(--color-text-muted)">Lots of creators are using the AI right now. Please wait a minute and try again.</p>
            <button class="va-outline" id="title-retry-btn" type="button" style="margin-top:1rem">Try again</button>
        </div>`;
    document.getElementById("title-retry-btn").addEventListener("click", renderInput);
}

function renderLoading(){

    const flow = document.getElementById("title-optimizer-flow");

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">TITLE OPTIMIZER</span>
            <h3>Analyzing your title<span class="va-loading">...</span></h3>
            <p id="title-loading-text">${LOADING_MESSAGES[0]}</p>
        </div>`;

    let index = 0;

    if(loadingTimer) clearInterval(loadingTimer);

    loadingTimer = setInterval(()=>{

        index = (index + 1) % LOADING_MESSAGES.length;
        const el = document.getElementById("title-loading-text");

        if(!el){
            clearInterval(loadingTimer);
            return;
        }

        el.textContent = LOADING_MESSAGES[index];

    }, 900);

}

function renderError(){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("title-optimizer-flow");

    flow.innerHTML = `
        <div class="va-card" style="text-align:center">
            <p>Something went wrong while analyzing your title. Please try again.</p>
            <button class="va-outline" id="title-retry-btn" type="button" style="margin-top:1rem">Try again</button>
        </div>`;

    document.getElementById("title-retry-btn").addEventListener("click", renderInput);

}

function scoreRow(label, value){

    const safeValue = Number(value) || 0;
    return `<div><p><span>${label}</span><strong>${safeValue}</strong></p><div class="va-progress"><i style="width:${safeValue}%"></i></div></div>`;

}

function getQualitative(score){

    if(score >= 85) return "Excellent";
    if(score >= 70) return "Strong";
    if(score >= 55) return "Good";
    if(score >= 40) return "Moderate";
    if(score >= 25) return "Weak";
    return "Poor";

}

function renderResults(result){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("title-optimizer-flow");

    const overallScore = Number(result.overallScore) || 0;
    const ctrPrediction = Number(result.ctrPrediction) || 0;
    const curiosity = Number(result.curiosity) || 0;
    const emotion = Number(result.emotion) || 0;
    const clarity = Number(result.clarity) || 0;
    const seo = Number(result.seo) || 0;

    const breakdown = [
        ["Overall Score", overallScore],
        ["CTR Prediction", ctrPrediction],
        ["Curiosity", curiosity],
        ["Emotional Impact", emotion],
        ["Clarity", clarity],
        ["SEO", seo]
    ];

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">TITLE OPTIMIZATION</span>
                    <h3>Your title is <span class="va-emphasis">${getQualitative(overallScore).toLowerCase()}</span>.</h3>
                    <p>${escapeHtml(result.summary || "")}</p>
                </div>
                <button class="va-outline" id="title-restart" type="button">Analyze another title →</button>
            </div>

            <!-- Overall Score -->
            <div class="va-score-grid">
                <article class="va-metric va-score">
                    <span>OVERALL SCORE</span>
                    <strong><b>${overallScore}</b><small>/ 100</small></strong>
                    <i>${getQualitative(overallScore)}</i>
                </article>
            </div>

            <!-- Score Breakdown -->
            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div></div>
            <div class="va-breakdown">${breakdown.map(([name, value]) => scoreRow(name, value)).join("")}</div>

            <!-- Key Metrics Cards -->
            <div class="va-section-title"><div><span class="va-step">METRICS</span><h3>Key Metrics</h3></div></div>
            
            <div class="coach-insights-grid">
                <article class="coach-card">
                    <span class="coach-icon">🎯</span>
                    <h4>CTR Prediction</h4>
                    <strong style="font-size:1.5rem;margin-top:0.5rem;text-transform:capitalize">${escapeHtml(result.ctrLevel || "—")}</strong>
                    <small style="color:var(--color-text-muted)">${ctrPrediction}/100</small>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">🔍</span>
                    <h4>SEO Level</h4>
                    <strong style="font-size:1.5rem;margin-top:0.5rem;text-transform:capitalize">${escapeHtml(result.seoLevel || "—")}</strong>
                    <small style="color:var(--color-text-muted)">${seo}/100</small>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">📏</span>
                    <h4>Length</h4>
                    <strong style="font-size:1.5rem;margin-top:0.5rem;text-transform:capitalize">${escapeHtml(result.length || "—")}</strong>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">📱</span>
                    <h4>Mobile Friendly</h4>
                    <strong style="font-size:1.5rem;margin-top:0.5rem">${result.mobileFriendly ? "✓ Yes" : "⚠ No"}</strong>
                </article>
            </div>

            <!-- Detailed Analysis Cards -->
            <div class="va-section-title"><div><span class="va-step">INSIGHTS</span><h3>Detailed Analysis</h3></div></div>
            
            <div class="coach-insights-grid">
                <article class="coach-card">
                    <span class="coach-icon">🤔</span>
                    <h4>Curiosity</h4>
                    <p>${escapeHtml(result.curiosityExplanation || "No explanation provided")}</p>
                    <strong style="margin-top:0.5rem">${curiosity}/100</strong>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">💭</span>
                    <h4>Emotional Impact</h4>
                    <p>Dominant emotion: <span style="text-transform:capitalize">${escapeHtml(result.emotionType || "unknown")}</span></p>
                    <strong style="margin-top:0.5rem">${emotion}/100</strong>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">👥</span>
                    <h4>Audience Match</h4>
                    <p>Target: <span style="text-transform:capitalize">${escapeHtml(result.audience || "general")}</span></p>
                    <p style="color:var(--color-text-muted);margin-top:0.25rem;font-size:0.9rem">${escapeHtml(result.audienceExplanation || "")}</p>
                </article>

                <article class="coach-card">
                    <span class="coach-icon">🔍</span>
                    <h4>Clarity</h4>
                    <p>How quickly viewers understand the title</p>
                    <strong style="margin-top:0.5rem">${clarity}/100</strong>
                </article>
            </div>

            ${result.historicalInsights ? `
            <!-- Personalization -->
            <div class="coach-timing-box">
                <span class="coach-timing-icon">📊</span>
                <div>
                    <h4>Historical Insights</h4>
                    <p>${escapeHtml(result.historicalInsights)}</p>
                </div>
            </div>` : ""}

            ${(result.trendsDetected && result.trendsDetected.length > 0) || (result.trendsMissed && result.trendsMissed.length > 0) ? `
            <!-- Trends -->
            <div class="coach-timing-box">
                <span class="coach-timing-icon">🔥</span>
                <div>
                    <h4>Trend Detection</h4>
                    ${result.trendsDetected && result.trendsDetected.length > 0 ? `
                    <p><strong>Trends detected:</strong> ${result.trendsDetected.map(escapeHtml).join(", ")}</p>` : ""}
                    ${result.trendsMissed && result.trendsMissed.length > 0 ? `
                    <p style="color:var(--color-text-muted);margin-top:0.25rem"><strong>Trends you could include:</strong> ${result.trendsMissed.map(escapeHtml).join(", ")}</p>` : ""}
                </div>
            </div>` : ""}

            ${result.lengthSuggestion ? `
            <!-- Length Suggestion -->
            <div class="coach-timing-box">
                <span class="coach-timing-icon">📝</span>
                <div>
                    <h4>Length Suggestion</h4>
                    <p>${escapeHtml(result.lengthSuggestion)}</p>
                </div>
            </div>` : ""}

            <!-- Alternatives -->
            <div class="va-section-title"><div><span class="va-step">ALTERNATIVES</span><h3>Optimized Title Alternatives</h3></div></div>
            
            ${renderAlternativesCategory("Curiosity", result.alternatives?.curiosity, "🤔")}
            ${renderAlternativesCategory("Emotional", result.alternatives?.emotional, "💭")}
            ${renderAlternativesCategory("Competitive", result.alternatives?.competitive, "🏆")}
            ${renderAlternativesCategory("Funny", result.alternatives?.funny, "😄")}
            ${renderAlternativesCategory("Viral", result.alternatives?.viral, "🚀")}
            ${renderAlternativesCategory("Safe", result.alternatives?.safe, "🛡️")}
        </div>`;

    document.getElementById("title-restart").addEventListener("click", renderInput);

}

function renderAlternativesCategory(categoryName, alternatives, icon = "") {
    if (!alternatives || alternatives.length === 0) return "";
    
    return `
        <div style="margin-bottom: 1.5rem;">
            <div class="va-section-title" style="margin-bottom: 1rem;"><div><span class="va-step">${escapeHtml(icon)}</span><h3>${escapeHtml(categoryName)}</h3></div></div>
            <div class="coach-insights-grid">
                ${alternatives.map((alt, index) => `
                    <article class="coach-card">
                        <span class="coach-icon">${index + 1}</span>
                        <h4 style="font-size: 1rem; margin-bottom: 0.5rem;">${escapeHtml(alt.title || "")}</h4>
                        <p style="color:var(--color-text-muted);font-size:0.9rem;margin-bottom:0.75rem">${escapeHtml(alt.reason || "")}</p>
                        <button class="btn btn-outline btn-sm" data-title="${encodeURIComponent(alt.title || "")}" type="button">Copy</button>
                    </article>
                `).join("")}
            </div>
        </div>
    `;
}

// Event delegation for copy buttons
document.addEventListener("click", (e) => {
    if (e.target.matches("[data-title]")) {
        const title = decodeURIComponent(e.target.dataset.title);
        navigator.clipboard?.writeText(title);
    }
});
