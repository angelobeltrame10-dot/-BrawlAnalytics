/* ==========================================================
   BRAWL ANALYTICS
   HOOK & CONCEPT ANALYZER — Pro only, riusa gating/popup/stile esistenti
========================================================== */

import { getCurrentPlan, openUpgradeModal } from "./js_subscription.js";
import { loadChannelProfile } from "./js_storage.js";

const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";

const LOADING_MESSAGES = [
    "Analyzing your opening concept...",
    "Evaluating emotional triggers...",
    "Measuring scroll stopping power...",
    "Generating improved versions...",
    "Almost done..."
];

let initialized = false;
let loadingTimer = null;
let channelProfileCache = null;

export function initHookAnalyzer(){

    if(initialized){
        return;
    }

    initialized = true;
    renderInput();

}

function renderInput(){

    const flow = document.getElementById("hook-flow");
    if(!flow) return;

    flow.innerHTML = `
        <div class="va-card">
            <h3 style="margin-bottom: 1rem;">Hook & Concept Analyzer</h3>
            <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">Describe the first seconds of your Short. The AI will evaluate how strong your opening concept is.</p>
            <textarea id="hook-input" class="hook-textarea" placeholder='Describe the first seconds of your Short.

Example:
I pretend that the new Brawler is completely broken.
I immediately show an impossible clip while saying:
"Everyone thinks this is fake..."
Then I reveal what actually happened.

The AI will evaluate how strong this opening concept is.'></textarea>
            <button class="va-primary" id="hook-analyze-btn" type="button">Analyze Concept <span>→</span></button>
        </div>`;

    document.getElementById("hook-analyze-btn").addEventListener("click", handleAnalyzeClick);

}

async function getChannelProfile() {
    if (channelProfileCache) return channelProfileCache;
    channelProfileCache = await loadChannelProfile();
    return channelProfileCache;
}

async function handleAnalyzeClick(){

    const input = document.getElementById("hook-input");
    const text = input?.value.trim();

    if(!text){
        input?.focus();
        return;
    }

    if(getCurrentPlan() !== "pro"){
        openUpgradeModal();
        return;
    }

    renderLoading();

    try{
        // Get channel profile for personalized analysis
        const channelProfile = await getChannelProfile();

        const response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "hook_analysis",
                concept: text,
                channelProfile: channelProfile
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
        console.error("AI Coach error:", error);
        renderError();
    }
}

function renderRateLimitError(){
    if(loadingTimer) clearInterval(loadingTimer);
    const flow = document.getElementById("hook-flow");
    flow.innerHTML = `
        <div class="va-card" style="text-align:center">
            <span style="font-size:2rem;display:block;margin-bottom:1rem">⏳</span>
            <h3 style="margin-bottom:.75rem">High demand right now</h3>
            <p style="color:var(--color-text-muted)">Lots of creators are using the AI right now. Please wait a minute and try again.</p>
            <button class="va-outline" id="coach-retry-btn" type="button" style="margin-top:1rem">Try again</button>
        </div>`;
    document.getElementById("coach-retry-btn").addEventListener("click", renderInput);
}

function renderLoading(){

    const flow = document.getElementById("hook-flow");

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">HOOK & CONCEPT ANALYZER</span>
            <h3>Analyzing your opening concept<span class="va-loading">...</span></h3>
            <p id="hook-loading-text">${LOADING_MESSAGES[0]}</p>
        </div>`;

    let index = 0;

    if(loadingTimer) clearInterval(loadingTimer);

    loadingTimer = setInterval(()=>{

        index = (index + 1) % LOADING_MESSAGES.length;
        const el = document.getElementById("hook-loading-text");

        if(!el){
            clearInterval(loadingTimer);
            return;
        }

        el.textContent = LOADING_MESSAGES[index];

    }, 900);

}

function renderError(){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("hook-flow");

    flow.innerHTML = `
        <div class="va-card" style="text-align:center">
            <p>Something went wrong while analyzing your hook. Please try again.</p>
            <button class="va-outline" id="hook-retry-btn" type="button" style="margin-top:1rem">Try again</button>
        </div>`;

    document.getElementById("hook-retry-btn").addEventListener("click", renderInput);

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

    const flow = document.getElementById("hook-flow");

    const hookScore = Number(result.hookScore) || 0;
    const curiosityScore = Number(result.curiosityScore) || 0;
    const scrollStopScore = Number(result.scrollStopScore) || 0;
    const originalityScore = Number(result.originalityScore) || 0;
    const clarityScore = Number(result.clarityScore) || 0;

    const breakdown = [
        ["Hook Score", hookScore],
        ["Curiosity", curiosityScore],
        ["Scroll Stop", scrollStopScore],
        ["Originality", originalityScore],
        ["Clarity", clarityScore]
    ];

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">HOOK & CONCEPT ANALYSIS</span>
                    <h3>Your opening concept is <em>${getQualitative(hookScore).toLowerCase()}</em>.</h3>
                    <p>${result.finalSummary || ""}</p>
                </div>
                <button class="va-outline" id="hook-restart" type="button">Analyze another concept →</button>
            </div>

            <div class="va-score-grid">
                <article class="va-metric va-score">
                    <span>HOOK SCORE</span>
                    <strong><b>${hookScore}</b><small>/ 100</small></strong>
                    <i>${getQualitative(hookScore)}</i>
                </article>
                <article class="va-metric">
                    <span>EMOTIONAL TRIGGER</span>
                    <strong style="font-size:1.2rem;margin-top:1.4rem">${result.emotionalTrigger || "Not detected"}</strong>
                </article>
                <article class="va-metric">
                    <span>VIEWER CURIOSITY</span>
                    <strong style="font-size:1.5rem;margin-top:1.4rem;text-transform:capitalize">${result.viewerCuriosity || "—"}</strong>
                </article>
                <article class="va-metric">
                    <span>EXPECTED RETENTION</span>
                    <strong style="font-size:1.5rem;margin-top:1.4rem;text-transform:capitalize">${result.expectedRetention || "—"}</strong>
                </article>
            </div>

            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div></div>
            <div class="va-breakdown">${breakdown.map(([name, value]) => scoreRow(name, value)).join("")}</div>

            <div class="va-section-title"><div><span class="va-step">INSIGHTS</span><h3>Predicted First Impression</h3></div></div>
            <section class="banner" style="margin-bottom:1.5rem">
                <p style="color:var(--color-text)">${result.predictedFirstImpression || "No prediction available"}</p>
            </section>

            <div class="va-insights">
                <article class="va-insight good"><span>✦</span><h4>Strengths</h4><ul>${(result.strengths || []).map(s => `<li>${s}</li>`).join("") || "<p>No specific strengths detected.</p>"}</ul></article>
                <article class="va-insight weak"><span>↗</span><h4>Weaknesses</h4><ul>${(result.weaknesses || []).map(w => `<li>${w}</li>`).join("") || "<p>No specific weaknesses detected.</p>"}</ul></article>
            </div>

            ${(result.missedOpportunities || []).length > 0 ? `
            <div class="va-section-title"><div><span class="va-step">OPPORTUNITIES</span><h3>Missed Opportunities</h3></div></div>
            <section class="banner" style="margin-bottom:1.5rem">
                <ul style="margin-top:.5rem">${result.missedOpportunities.map(o => `<li>${o}</li>`).join("")}</ul>
            </section>` : ""}

            ${(result.recommendedImprovements || []).length > 0 ? `
            <div class="va-section-title"><div><span class="va-step">IMPROVEMENTS</span><h3>Recommended Improvements</h3></div></div>
            <section class="banner" style="margin-bottom:1.5rem">
                <ul style="margin-top:.5rem">${result.recommendedImprovements.map(i => `<li>${i}</li>`).join("")}</ul>
            </section>` : ""}

            <div class="va-section-title"><div><span class="va-step">IMPROVED HOOKS</span><h3>3 Enhanced Versions</h3></div></div>
            
            <section class="banner" style="margin-bottom:1rem">
                <strong>Version A — Safe Improvement</strong>
                <p style="color:var(--color-text);margin-top:.5rem">${result.improvedHookVersionA || ""}</p>
                <button class="btn btn-outline btn-sm" id="hook-copy-a" type="button" style="margin-top:.75rem">Copy</button>
            </section>

            <section class="banner" style="margin-bottom:1rem">
                <strong>Version B — Aggressive</strong>
                <p style="color:var(--color-text);margin-top:.5rem">${result.improvedHookVersionB || ""}</p>
                <button class="btn btn-outline btn-sm" id="hook-copy-b" type="button" style="margin-top:.75rem">Copy</button>
            </section>

            <section class="banner" style="margin-bottom:1.5rem">
                <strong>Version C — Highest Viral Potential</strong>
                <p style="color:var(--color-text);margin-top:.5rem">${result.improvedHookVersionC || ""}</p>
                <button class="btn btn-outline btn-sm" id="hook-copy-c" type="button" style="margin-top:.75rem">Copy</button>
            </section>
        </div>`;

    document.getElementById("hook-restart").addEventListener("click", renderInput);
    document.getElementById("hook-copy-a").addEventListener("click", () => {
        navigator.clipboard?.writeText(result.improvedHookVersionA || "");
    });
    document.getElementById("hook-copy-b").addEventListener("click", () => {
        navigator.clipboard?.writeText(result.improvedHookVersionB || "");
    });
    document.getElementById("hook-copy-c").addEventListener("click", () => {
        navigator.clipboard?.writeText(result.improvedHookVersionC || "");
    });

}