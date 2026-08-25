/* ==========================================================
   BRAWL ANALYTICS
   PERSONAL AI COACH — Pro only feature
========================================================== */

import { getCurrentPlan, isProPlan, openUpgradeModal } from "./js_subscription.js?v=20260825-profile-18";
import { loadChannelProfile, loadDashboardData } from "./js_storage.js";
import { getVideoViews } from "./js_csv_fields.js";
import { escapeHtml } from "./js_trends.js";
import { getAuthHeaders } from "./js_auth_fetch.js";

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
let coachChatContext = "";
let coachChatRequestInFlight = false;
let companionMessageTimer = null;
const COMPANION_MESSAGES = [
    ["your coach has a note", "make the next upload easier to win."],
    ["one useful question", "which format deserves another test?"],
    ["before you publish", "check the first two seconds again."],
    ["small change, clearer signal", "change one variable in the next Short."]
];


export function initAICoach(){

    if(initialized){
        return;
    }

    initialized = true;
    renderInput();

}


function renderInput(){

    if(companionMessageTimer) {
        clearInterval(companionMessageTimer);
        companionMessageTimer = null;
    }

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

    if(!isProPlan(getCurrentPlan())){
        openUpgradeModal();
        return;
    }

    renderLoading();

    try{
        const channelProfile = await getChannelProfile();

        if (!channelProfile) {
            renderError("Please upload your CSV data first to generate personalized insights.");
            return;
        }

        const videos = await loadDashboardData();
        const historicalData = buildHistoricalData(videos);

        const response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                type: "personal_coach",
                channelProfile: channelProfile,
                historicalData: historicalData,
                recentAnalyses: []
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

const RECENT_VIDEO_WINDOW = 10;
const MIN_VIDEOS_FOR_RECENT_TREND = 2;

function buildHistoricalData(videos) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return { hasSufficientRecentData: false, recentVideoCount: 0, averageRecentViews: null, uploadFrequency: "Unknown" };
    }

    const withDates = videos.filter(v => v["Data pubblicazione"] instanceof Date);
    const sorted = withDates.length >= 2
        ? [...withDates].sort((a, b) => a["Data pubblicazione"].getTime() - b["Data pubblicazione"].getTime())
        : videos;

    const recent = sorted.slice(-RECENT_VIDEO_WINDOW);
    const recentViews = recent.map(v => getVideoViews(v)).filter(v => v > 0);

    const hasSufficientRecentData = recent.length >= MIN_VIDEOS_FOR_RECENT_TREND && recentViews.length >= MIN_VIDEOS_FOR_RECENT_TREND;
    const averageRecentViews = recentViews.length > 0
        ? Math.round(recentViews.reduce((sum, v) => sum + v, 0) / recentViews.length)
        : null;

    let uploadFrequency = "Unknown";
    if (withDates.length >= 2) {
        const first = sorted[0]["Data pubblicazione"].getTime();
        const last = sorted[sorted.length - 1]["Data pubblicazione"].getTime();
        const daySpan = Math.max(1, (last - first) / (1000 * 60 * 60 * 24));
        const perWeek = (withDates.length / daySpan) * 7;
        uploadFrequency = perWeek >= 1
            ? `~${perWeek.toFixed(1)} uploads/week`
            : `~${(perWeek * 4.345).toFixed(1)} uploads/month`;
    }

    return { hasSufficientRecentData, recentVideoCount: recent.length, averageRecentViews, uploadFrequency };
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
            <p>${escapeHtml(message || "Something went wrong while generating insights. Please try again.")}</p>
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
            <ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>`;

}

function renderResults(result){

    if(loadingTimer) clearInterval(loadingTimer);

    const flow = document.getElementById("coach-flow");
    if(!flow) return;

    const rating = String(result.overallCreatorRating || "B");
    const winningFormats = Array.isArray(result.performancePatterns?.winningFormats)
        ? result.performancePatterns.winningFormats.slice(0, 3)
        : [];
    const keyInsights = Array.isArray(result.keyInsights) ? result.keyInsights.slice(0, 3) : [];
    const originalityLevel = ["low", "medium", "high"].includes(String(result.originalityRisk?.level).toLowerCase())
        ? String(result.originalityRisk.level).toLowerCase()
        : "medium";

    coachChatContext = [
        `Overall rating: ${rating}`,
        `Biggest strength: ${result.biggestStrength || "not available"}`,
        `Biggest weakness: ${result.biggestWeakness || "not available"}`,
        `Current opportunity: ${result.currentOpportunity || "not available"}`,
        `Next week recommendation: ${result.nextWeekRecommendation || "not available"}`,
        `Recent progress: ${result.recentProgress || "not available"}`,
        `Winning formats: ${winningFormats.join(", ") || "not available"}`
    ].join("\n");

    flow.innerHTML = `
        <div class="va-results coach-report">
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">PERSONAL AI COACH</span>
                    <h3>Your channel, in focus</h3>
                    <p>A short briefing with the signals that deserve your attention first.</p>
                </div>
                <button class="va-outline" id="coach-restart" type="button">Refresh insights →</button>
            </div>

            <section class="coach-priority-card">
                <div class="coach-rating-block">
                    <span class="va-step">OVERALL RATING</span>
                    <strong>${escapeHtml(rating)}</strong>
                    <small>based on consistency, originality and execution</small>
                </div>
                <div class="coach-priority-copy">
                    <span class="va-step">PRIORITY MOVE</span>
                    <h3>${escapeHtml(result.nextWeekRecommendation || "Keep your next upload focused.")}</h3>
                    <p>${escapeHtml(result.aiStrategy || "Use your strongest format and make one clear improvement at a time.")}</p>
                </div>
            </section>

            <div class="va-section-title"><div><span class="va-step">THE SIGNALS</span><h3>What matters most</h3></div><p>Useful context, without the noise.</p></div>
            <div class="coach-insights-grid coach-insights-grid--compact">
                <article class="coach-card coach-strength">
                    <span class="coach-icon">↑</span>
                    <h4>Keep doing this</h4>
                    <p>${escapeHtml(result.biggestStrength || "Your strongest signal is still being measured.")}</p>
                </article>
                <article class="coach-card coach-weakness">
                    <span class="coach-icon">→</span>
                    <h4>Fix this next</h4>
                    <p>${escapeHtml(result.biggestWeakness || "No clear weakness has been identified yet.")}</p>
                </article>
                <article class="coach-card coach-opportunity">
                    <span class="coach-icon">*</span>
                    <h4>Try this opportunity</h4>
                    <p>${escapeHtml(result.currentOpportunity || "Keep testing your strongest format with a fresh angle.")}</p>
                </article>
                <article class="coach-card coach-progress">
                    <span class="coach-icon">~</span>
                    <h4>Recent progress</h4>
                    <p>${escapeHtml(result.recentProgress || "More recent uploads are needed to measure a trend.")}</p>
                </article>
            </div>

            <section class="coach-action-strip">
                <div>
                    <span class="va-step">PUBLISHING NOTE</span>
                    <h3>Make the next upload easier to win.</h3>
                    <p>${escapeHtml(result.uploadTimingAdvice || "Schedule uploads in a consistent time slot instead of publishing immediately after editing.")}</p>
                </div>
                <span class="coach-risk coach-risk-${originalityLevel}">${originalityLevel} originality risk</span>
            </section>

            ${winningFormats.length ? `
                <section class="coach-list-card coach-list-card--primary">
                    <h4><span>+</span>Formats worth repeating</h4>
                    <ul>${winningFormats.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                </section>` : ""}

            ${keyInsights.length ? `
                <section class="coach-list-card">
                    <h4><span>i</span>Keep these in mind</h4>
                    <ul>${keyInsights.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                </section>` : ""}

            <div class="coach-companion-wrap">
                <button type="button" class="coach-companion" id="coach-companion-trigger" aria-controls="coach-chat-panel" aria-expanded="false">
                    <span class="coach-robot" aria-hidden="true">◉</span>
                    <span class="coach-companion-bubble"><strong>your coach has a note</strong><small>Ask me what to do next.</small></span>
                </button>
                <section class="coach-chat-panel" id="coach-chat-panel" hidden aria-label="Chat with your AI coach">
                    <header class="coach-chat-header">
                        <div><span class="coach-robot coach-robot--small" aria-hidden="true">◉</span><div><strong>personal coach</strong><small>grounded in this report</small></div></div>
                        <button type="button" class="coach-chat-close" id="coach-chat-close" aria-label="Close coach chat">×</button>
                    </header>
                    <div class="coach-chat-messages" id="coach-chat-messages" role="log" aria-live="polite">
                        <div class="coach-chat-message coach-chat-message--ai">Hi, I'm your personal coach. Ask me about your next Short, your formats or how to improve this report.</div>
                    </div>
                    <form class="coach-chat-form" id="coach-chat-form">
                        <textarea id="coach-chat-input" rows="2" maxlength="2000" placeholder="Ask your coach a question…" required></textarea>
                        <button type="submit" class="va-primary">Send <span>→</span></button>
                    </form>
                </section>
            </div>
        </div>`;

    document.getElementById("coach-restart")?.addEventListener("click", handleAnalyzeClick);
    setupCoachChat();
    startCompanionMessageRotation();

}

function startCompanionMessageRotation(){
    const title = document.querySelector("#coach-companion-trigger .coach-companion-bubble strong");
    const copy = document.querySelector("#coach-companion-trigger .coach-companion-bubble small");
    if(!title || !copy) return;

    let index = 0;
    if(companionMessageTimer) clearInterval(companionMessageTimer);
    companionMessageTimer = setInterval(() => {
        index = (index + 1) % COMPANION_MESSAGES.length;
        title.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
        copy.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
        title.textContent = COMPANION_MESSAGES[index][0];
        copy.textContent = COMPANION_MESSAGES[index][1];
    }, 4200);
}

function setupCoachChat(){
    const trigger = document.getElementById("coach-companion-trigger");
    const panel = document.getElementById("coach-chat-panel");
    const close = document.getElementById("coach-chat-close");
    const form = document.getElementById("coach-chat-form");
    const input = document.getElementById("coach-chat-input");

    if(!trigger || !panel || !form || !input) return;

    const setOpen = open => {
        panel.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if(open) setTimeout(() => input.focus(), 50);
    };

    trigger.addEventListener("click", () => setOpen(panel.hidden));
    close?.addEventListener("click", () => setOpen(false));
    form.addEventListener("submit", handleCoachChatSubmit);
}

function appendCoachMessage(text, role){
    const messages = document.getElementById("coach-chat-messages");
    if(!messages) return;
    const message = document.createElement("div");
    message.className = `coach-chat-message coach-chat-message--${role}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
}

async function handleCoachChatSubmit(event){
    event.preventDefault();
    if(coachChatRequestInFlight) return;

    const input = document.getElementById("coach-chat-input");
    const form = document.getElementById("coach-chat-form");
    const submit = form?.querySelector("button[type=submit]");
    const message = input?.value.trim();
    if(!message) return;

    coachChatRequestInFlight = true;
    appendCoachMessage(message, "user");
    input.value = "";
    if(submit) submit.disabled = true;

    try{
        const response = await fetch(`${AI_ENDPOINT}/coach-chat`, {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ message, context: coachChatContext })
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok || !data.reply){
            throw new Error(data?.error || `HTTP ${response.status}`);
        }
        appendCoachMessage(String(data.reply), "ai");
    } catch(error){
        console.error("AI Coach chat error:", error);
        appendCoachMessage("I couldn't reach the coach right now. Please try again in a moment.", "ai");
    } finally{
        coachChatRequestInFlight = false;
        if(submit) submit.disabled = false;
        input?.focus();
    }

}