/* ==========================================================
   BRAWL ANALYTICS
   HOOK & CONCEPT ANALYZER — Pro only
   Due modalità, stesso schema di risposta:
   - "Write it"     → testo, Groq openai/gpt-oss-120b (Worker AI generico)
   - "Upload video" → video reale, Gemini (Worker video-analysis)
========================================================== */

import { getCurrentPlan, isProPlan, openUpgradeModal } from "./js_subscription.js?v=20260825-profile-18";
import { loadChannelProfile } from "./js_storage.js";
import { getAuthHeaders } from "./js_auth_fetch.js";
import { escapeHtml } from "./js_trends.js";

const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";
const HOOK_VIDEO_ENDPOINT = "https://video-analysis.angeskicollab10.workers.dev/analyze-hook-video";

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
let activeMode = "video";
let uploadedHookVideoFile = null;
let activeUploadTimer = null;

export function initHookAnalyzer(){
    activeMode = "video";
    if(initialized){
        renderInput();
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
            <div class="hook-mode-tabs">
                <button type="button" class="hook-mode-tab ${activeMode === "video" ? "active" : ""}" data-mode="video">🎬 Upload video</button>
                <button type="button" class="hook-mode-tab ${activeMode === "text" ? "active" : ""}" data-mode="text">✏️ Write it</button>
            </div>
            <div id="hook-mode-content"></div>
        </div>`;

    flow.querySelectorAll(".hook-mode-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            activeMode = btn.dataset.mode;
            renderInput();
        });
    });

    if(activeMode === "video"){
        renderVideoMode();
    } else {
        renderTextMode();
    }
}

function renderVideoMode(){
    const content = document.getElementById("hook-mode-content");
    if(!content) return;

    content.innerHTML = `
        <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">Upload your Short and Gemini will analyze the actual opening seconds — same scoring as the text mode.</p>
        <label class="va-dropzone" id="hook-dropzone">
            <input id="hook-video-input" type="file" accept="video/*">
            <span class="va-upload-icon">↑</span>
            <strong>Drop your video here</strong>
            <small>or browse files from your device · MP4, MOV</small>
        </label>
        <div class="va-upload-progress" id="hook-upload-progress" hidden>
            <div><span id="hook-file-name">short.mp4</span><span id="hook-upload-value">0%</span></div>
            <p><i id="hook-upload-bar"></i></p>
            <small id="hook-upload-copy">Preparing secure upload…</small>
        </div>`;

    const input = document.getElementById("hook-video-input");
    const dropzone = document.getElementById("hook-dropzone");

    input.addEventListener("change", event => startHookVideoUpload(event.target.files?.[0]));

    ["dragenter", "dragover"].forEach(eventName => {
        dropzone.addEventListener(eventName, event => {
            event.preventDefault();
            dropzone.classList.add("is-dragging");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, event => {
            event.preventDefault();
            dropzone.classList.remove("is-dragging");
        });
    });

    dropzone.addEventListener("drop", event => startHookVideoUpload(event.dataTransfer.files?.[0]));
}

function renderTextMode(){
    const content = document.getElementById("hook-mode-content");
    if(!content) return;

    content.innerHTML = `
        <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">Describe the first seconds of your Short. The AI will evaluate how strong your opening concept is.</p>
        <textarea id="hook-input" class="hook-textarea" placeholder='Describe the first seconds of your Short.

Example:
I pretend that the new Brawler is completely broken.
I immediately show an impossible clip while saying:
"Everyone thinks this is fake..."
Then I reveal what actually happened.'></textarea>
        <button class="va-primary" id="hook-analyze-btn" type="button">Analyze Concept <span>→</span></button>`;

    document.getElementById("hook-analyze-btn").addEventListener("click", handleTextAnalyzeClick);
}

function startHookVideoUpload(file){
    if(!file) return;

    uploadedHookVideoFile = file;

    if(activeUploadTimer){
        clearInterval(activeUploadTimer);
        activeUploadTimer = null;
    }

    const fileNameEl = document.getElementById("hook-file-name");
    const dropzoneEl = document.getElementById("hook-dropzone");
    const progressEl = document.getElementById("hook-upload-progress");
    const barEl = document.getElementById("hook-upload-bar");
    const valueEl = document.getElementById("hook-upload-value");
    const copyEl = document.getElementById("hook-upload-copy");

    if(!dropzoneEl || !progressEl || !barEl || !valueEl) return;

    fileNameEl.textContent = file.name;
    dropzoneEl.hidden = true;
    progressEl.hidden = false;

    let value = 0;

    activeUploadTimer = setInterval(() => {
        value = Math.min(100, value + 10 + Math.random() * 12);
        barEl.style.width = `${value}%`;
        valueEl.textContent = `${Math.round(value)}%`;
        if(copyEl){
            copyEl.textContent = value < 70 ? "Encrypting upload…" : "Video ready — starting Gemini analysis…";
        }

        if(value >= 100){
            clearInterval(activeUploadTimer);
            activeUploadTimer = null;
            setTimeout(() => handleVideoAnalyzeClick(), 400);
        }
    }, 190);
}

async function getChannelProfile() {
    if (channelProfileCache) return channelProfileCache;
    channelProfileCache = await loadChannelProfile();
    return channelProfileCache;
}

async function handleTextAnalyzeClick(){
    const input = document.getElementById("hook-input");
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
        const channelProfile = await getChannelProfile();

        const response = await fetch(AI_ENDPOINT, {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
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

        renderResults(data, "text");
    }
    catch(error){
        console.error("Hook Analyzer error:", error);
        renderError();
    }
}

async function handleVideoAnalyzeClick(){

    if(!uploadedHookVideoFile){
        return;
    }

    if(!isProPlan(getCurrentPlan())){
        openUpgradeModal();
        return;
    }

    renderLoading();

    try{
        const formData = new FormData();
        formData.append("video", uploadedHookVideoFile);

        const response = await fetch(HOOK_VIDEO_ENDPOINT, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: formData
        });

        if (response.status === 429) {
            renderRateLimitError();
            return;
        }

        const payload = await response.json();

        if(!response.ok || payload?.error || payload?.success === false){
            const msg = String(payload?.errors?.message || payload?.error?.message || payload?.error || "");
            if (msg.toLowerCase().includes("rate limit")) {
                renderRateLimitError();
                return;
            }
            throw new Error(msg || `HTTP ${response.status}`);
        }

        renderResults(payload.data, "video");
    }
    catch(error){
        console.error("Hook Analyzer (video) error:", error);
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
    const label = activeMode === "video" ? "Reading your video with Gemini" : "Analyzing your opening concept";

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">HOOK & CONCEPT ANALYZER</span>
            <h3>${label}<span class="va-loading">...</span></h3>
            <p id="hook-loading-text">${LOADING_MESSAGES[0]}</p>
        </div>`;

    let index = 0;
    if(loadingTimer) clearInterval(loadingTimer);

    loadingTimer = setInterval(() => {
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

function renderResults(result, source = "text"){
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

    const sourceLabel = source === "video" ? "FROM YOUR VIDEO · GEMINI" : "FROM YOUR DESCRIPTION · GROQ";

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">HOOK & CONCEPT ANALYSIS — ${sourceLabel}</span>
                    <h3>Your opening concept is <span class="va-emphasis">${getQualitative(hookScore).toLowerCase()}</span>.</h3>
                    <p>${escapeHtml(result.finalSummary || "")}</p>
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
                    <strong style="font-size:1.2rem;margin-top:1.4rem">${escapeHtml(result.emotionalTrigger || "Not detected")}</strong>
                </article>
                <article class="va-metric">
                    <span>VIEWER CURIOSITY</span>
                    <strong style="font-size:1.5rem;margin-top:1.4rem;text-transform:capitalize">${escapeHtml(result.viewerCuriosity || "—")}</strong>
                </article>
                <article class="va-metric">
                    <span>EXPECTED RETENTION</span>
                    <strong style="font-size:1.5rem;margin-top:1.4rem;text-transform:capitalize">${escapeHtml(result.expectedRetention || "—")}</strong>
                </article>
            </div>

            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div></div>
            <div class="va-breakdown">${breakdown.map(([name, value]) => scoreRow(name, value)).join("")}</div>

            <section class="hook-action-plan">
                <div class="va-section-title hook-action-plan__heading"><div><span class="va-step">INSIGHTS</span><h3>What to change before publishing</h3></div><p>Turn the score into one clear edit.</p></div>
                <section class="hook-first-impression">
                    <span class="hook-plan-icon">01</span>
                    <div><span class="va-step">FIRST IMPRESSION</span><p>${escapeHtml(result.predictedFirstImpression || "No prediction available")}</p></div>
                </section>
                <div class="hook-decision-grid">
                    <article class="hook-decision hook-decision--keep"><span class="hook-plan-icon">02</span><div><span class="va-step">KEEP</span><h4>What already works</h4><ul>${(result.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join("") || "<li>No specific strengths detected.</li>"}</ul></div></article>
                    <article class="hook-decision hook-decision--fix"><span class="hook-plan-icon">03</span><div><span class="va-step">FIX</span><h4>What costs attention</h4><ul>${(result.weaknesses || []).map(w => `<li>${escapeHtml(w)}</li>`).join("") || "<li>No specific weaknesses detected.</li>"}</ul></div></article>
                </div>
                ${(result.missedOpportunities || []).length > 0 ? `<article class="hook-plan-list"><span class="hook-plan-icon">04</span><div><span class="va-step">OPPORTUNITIES</span><h4>One more angle to test</h4><ul>${result.missedOpportunities.map(o => `<li>${escapeHtml(o)}</li>`).join("")}</ul></div></article>` : ""}
                ${(result.recommendedImprovements || []).length > 0 ? `<article class="hook-plan-list hook-plan-list--accent"><span class="hook-plan-icon">05</span><div><span class="va-step">NEXT EDIT</span><h4>Recommended improvements</h4><ul>${result.recommendedImprovements.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div></article>` : ""}
            </section>

            <div class="va-section-title"><div><span class="va-step">IMPROVED HOOKS</span><h3>Choose a stronger opening</h3></div><p>Three directions, ready to test.</p></div>
            <div class="hook-versions-grid">
                <section class="hook-version-card"><span class="va-step">A · SAFE IMPROVEMENT</span><p>${escapeHtml(result.improvedHookVersionA || "")}</p><button class="btn btn-outline btn-sm" id="hook-copy-a" type="button">Copy</button></section>
                <section class="hook-version-card"><span class="va-step">B · AGGRESSIVE</span><p>${escapeHtml(result.improvedHookVersionB || "")}</p><button class="btn btn-outline btn-sm" id="hook-copy-b" type="button">Copy</button></section>
                <section class="hook-version-card hook-version-card--featured"><span class="va-step">C · HIGHEST POTENTIAL</span><p>${escapeHtml(result.improvedHookVersionC || "")}</p><button class="btn btn-primary btn-sm" id="hook-copy-c" type="button">Copy</button></section>
            </div>
        </div>`;

    document.getElementById("hook-restart").addEventListener("click", () => {
        uploadedHookVideoFile = null;
        renderInput();
    });
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