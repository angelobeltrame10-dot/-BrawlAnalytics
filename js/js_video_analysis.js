import { loadChannelProfile } from "./js_storage.js";
import { analyzeVirality } from "./js_virality_engine.js";
import { ensureTrendsLoaded } from "./js_trends.js";
import { escapeHtml } from "./js_html_utils.js";
import { createModal as createFormatModal } from "./js_formats_manager.js?v=20260827-idea-fix";
import { loadCustomFormats, saveCustomFormats } from "./js_storage.js";
import { getAuthHeaders } from "./js_auth_fetch.js";

let initialized = false;
let cachedChannelProfile = null;
let activeUploadTimer = null;
let cachedReportState = null;
const baseQuestions = [
    ["How original is your video?", ["Completely original", "Mostly original", "Mostly reused"]],
    ["How original is the idea?", ["Completely original", "Inspired by another creator", "Copy of another creator"]],
    ["Which format best describes this video?", null],
    ["Write a short description of your video.", null]
];

// Store user's answers for virality analysis
let userAnswers = {
    videoOriginality: null,
    ideaOriginality: null,
    format: null,
    description: null
};

// Store uploaded video file for insights analysis
let uploadedVideoFile = null;
let uploadedVideoPreviewUrl = null;

// Optional title supplied by the upload flow; kept separate from analysis inputs.


// Track video analysis error state.
// FIX: this used to stay null forever because extractVideoInsights()
// swallowed every failure internally and just returned null, so
// nothing ever assigned to this variable. That made `aiFailed`
// in renderResults() always falsy, so the app silently fell back to
// generic virality-engine text instead of showing the AI-specific
// insights (or an honest error banner) whenever the worker failed.
let analysisError = null;
let analysisRunId = 0;

// Video insights worker endpoint (must include the analyze path)
const VIDEO_INSIGHTS_WORKER_URL = "https://video-analysis.angeskicollab10.workers.dev/analyze-video";

function invalidateChannelProfileCache(){
    cachedChannelProfile = null;
}

async function getDynamicQuestions() {
    // Usa TUTTI i formati personalizzati salvati (sempre aggiornati, indipendentemente dal video count)
    // invece di filtrare per videoCount dal channelProfile. Questo risolve il bug per cui
    // un formato appena creato (senza video associati) non appare nella domanda 3 finché
    // non si ricarica un nuovo CSV.
    const customFormats = await loadCustomFormats();
    const customFormatNames = customFormats.map(f => f.name).filter(Boolean);
    
    // Formati di fallback solo se l'utente non ha ancora nessun formato personalizzato
    const fallbackFormats = ["Trickshot", "Challenge", "Funny Moments", "Ranked", "Guide", "Story", "Meme", "Other"];
    const formatOptions = customFormatNames.length > 0 
        ? [...customFormatNames, "Other"] 
        : fallbackFormats;

    return [
        baseQuestions[0],
        baseQuestions[1],
        ["Which format best describes this video?", formatOptions],
        baseQuestions[3]
    ];
}

function initVideoAnalysis(isReady = true){

    const section = document.getElementById("video-analysis");
    const flow = document.getElementById("va-flow");

    if(!section || !flow){

        return;

    }

    section.hidden = false;

    if(!isReady){

        flow.innerHTML = `
            <div class="va-card va-upload-card">
                <span class="va-step">01 — VIDEO UPLOAD</span>
                <h3>Upload your channel CSV first</h3>
                <div class="va-dropzone" style="min-height:180px;cursor:default;opacity:.9">
                    <span class="va-upload-icon">⛔</span>
                    <strong>Video analysis is locked</strong>
                    <small>Upload your YouTube Studio CSV first to unlock this experience.</small>
                </div>
            </div>`;

        return;

    }

    if(initialized){

        // Restore cached report if the flow was cleared (e.g. by a
        // refreshDashboard / setActiveTab cycle while the section was hidden).
        if(!flow.innerHTML.trim() && cachedReportState){
            flow.innerHTML = cachedReportState.html;
            if (cachedReportState.useRealData) animateScore(cachedReportState.reportData.score);
            setupSignalAnimation(flow, cachedReportState.signals, cachedReportState.labOptions);
            setupVideoEditLab(flow, cachedReportState.videoDuration, cachedReportState.baseViews, cachedReportState.retentionBaseline, cachedReportState.recommendedEnd, cachedReportState.shortCutPenalty);
            setupResultActions(flow, cachedReportState.reportData);
        }
        return;

    }

    initialized = true;
    renderUpload(flow);

}

function renderUpload(flow){

    // Invalidate any in-flight analysis before replacing its UI.
    analysisRunId += 1;
    cachedReportState = null;

    flow.innerHTML = `
        <div class="va-card va-upload-card">
            <span class="va-step">01 — VIDEO UPLOAD</span>
            <h3>Add your next Short</h3>
            <label class="va-dropzone" id="va-dropzone">
                <input id="va-video-input" type="file" accept="video/*">
                <span class="va-upload-icon">↑</span>
                <strong>Drop your video here</strong>
                <small>or browse files from your device · MP4, MOV</small>
            </label>
            <div class="va-upload-progress" id="va-upload-progress" hidden>
                <div><span id="va-file-name">brawl-short.mp4</span><span id="va-upload-value">0%</span></div>
                <p><i id="va-upload-bar"></i></p>
                <small id="va-upload-copy">Preparing secure upload…</small>
            </div>
        </div>`;

    const input = document.getElementById("va-video-input");
    const dropzone = document.getElementById("va-dropzone");

    input.addEventListener("change", event=> startUpload(event.target.files?.[0], flow));

    ["dragenter", "dragover"].forEach(eventName=>{

        dropzone.addEventListener(eventName, event=>{

            event.preventDefault();
            dropzone.classList.add("is-dragging");

        });

    });

    ["dragleave", "drop"].forEach(eventName=>{

        dropzone.addEventListener(eventName, event=>{

            event.preventDefault();
            dropzone.classList.remove("is-dragging");

        });

    });

    dropzone.addEventListener("drop", event=> startUpload(event.dataTransfer.files?.[0], flow));

}

// True se l'utente (non-Pro) ha già esaurito la quota giornaliera di video
// analyses secondo la cache sincronizzata da get_usage_status. In quel caso
// apre subito il modale upgrade. La guardia finale resta comunque
// try_consume_usage sul backend.
async function videoAnalysisQuotaBlocked(){
    try {
        const sub = await import("./js_subscription.js?v=20260827-idea-fix");
        if (!sub.isProPlan(sub.getCurrentPlan()) && sub.getRemainingVideoAnalyses() <= 0) {
            sub.openUpgradeModal();
            return true;
        }
    } catch (err) {
        console.warn("Subscription precheck failed, continuing:", err);
    }
    return false;
}

async function startUpload(file, flow){

    if(!file){
        return;
    }

    // Blocca già alla selezione del file: se la quota è esaurita apri il
    // modale upgrade e non avviare l'upload (attualmente il blocco arrivava
    // solo al click su "Create my report").
    if (await videoAnalysisQuotaBlocked()) {
        return;
    }

    // Store the uploaded video file for insights analysis.
    if (uploadedVideoPreviewUrl) URL.revokeObjectURL(uploadedVideoPreviewUrl);
    uploadedVideoFile = file;
    uploadedVideoPreviewUrl = URL.createObjectURL(file);
        userAnswers.title = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();

    if (activeUploadTimer) {
        clearInterval(activeUploadTimer);
        activeUploadTimer = null;
    }

    const fileNameEl = document.getElementById("va-file-name");
    const dropzoneEl = document.getElementById("va-dropzone");
    const progressEl = document.getElementById("va-upload-progress");
    const barEl = document.getElementById("va-upload-bar");
    const valueEl = document.getElementById("va-upload-value");
    const copyEl = document.getElementById("va-upload-copy");

    if (!dropzoneEl || !progressEl || !barEl || !valueEl) {
        console.error("Video analysis: upload elements not found in DOM");
        return;
    }

    fileNameEl.textContent = file.name;
    dropzoneEl.hidden = true;
    progressEl.hidden = false;

    let value = 0;

    activeUploadTimer = setInterval(()=>{

        value = Math.min(100, value + 10 + Math.random() * 12);
        barEl.style.width = `${value}%`;
        valueEl.textContent = `${Math.round(value)}%`;
        if (copyEl) {
            copyEl.textContent = value < 70 ? "Encrypting upload and preparing workspace…" : "Video ready — opening context wizard…";
        }

        if(value >= 100){

            clearInterval(activeUploadTimer);
            activeUploadTimer = null;

            setTimeout(()=> renderWizard(flow, 0), 450);

        }

    }, 190);

}

function resetVideoAnalysisState(){

    if (activeUploadTimer) {
        clearInterval(activeUploadTimer);
        activeUploadTimer = null;
    }

    initialized = false;
    cachedChannelProfile = null;
    analysisError = null;
    uploadedVideoFile = null;
    if (uploadedVideoPreviewUrl) {
        URL.revokeObjectURL(uploadedVideoPreviewUrl);
        uploadedVideoPreviewUrl = null;
    }

    userAnswers = {
        videoOriginality: null,
        ideaOriginality: null,
        format: null,
        description: null,
        title: null
    };

}

/**
 * Handle "Other" format selection by showing format creation modal
 */
async function handleOtherFormatSelection(flow, currentIndex) {
    console.log("Other format selected, attempting to show format creation modal");
    
    // Store the current wizard state to resume after format creation
    const savedIndex = currentIndex;
    const formatsBefore = await loadCustomFormats();
    const formatCountBefore = formatsBefore.length;
    
    console.log(`Formats before modal: ${formatCountBefore}`);
    
    // Show format creation modal
    try {
        createFormatModal();
        console.log("Format modal function called successfully");
        
        // Verify modal was created
        setTimeout(() => {
            const modalOverlay = document.getElementById('format-modal-overlay');
            console.log(`Modal overlay exists: ${!!modalOverlay}, has active class: ${modalOverlay?.classList.contains('active')}`);
        }, 100);
    } catch (error) {
        console.error("Error calling createFormatModal:", error);
    }
    
    // Listen for format creation completion
    const checkForFormatCreation = setInterval(async () => {
        const formatsAfter = await loadCustomFormats();
        const modalOverlay = document.getElementById('format-modal-overlay');
        
        // If modal is closed, check if a new format was created
        if (!modalOverlay || !modalOverlay.classList.contains('active')) {
            clearInterval(checkForFormatCreation);
            
            // Check if a new format was actually created
            if (formatsAfter.length > formatCountBefore) {
                // A new format was created, use it
                const newFormat = formatsAfter[formatsAfter.length - 1];
                userAnswers.format = newFormat.name;
                console.log(`Format created: ${newFormat.name}, continuing to next step`);
                
                // Refresh the wizard with updated formats and move to next step
                cachedChannelProfile = null; // Force reload of channel profile
                await renderWizard(flow, savedIndex + 1);
            } else {
                // No format was created (user cancelled), return to format selection
                console.log(`Format creation cancelled, returning to format selection`);
                cachedChannelProfile = null;
                await renderWizard(flow, savedIndex);
            }
        }
    }, 500);
}

async function renderWizard(flow, index){

    let questions;
    try {
        questions = await getDynamicQuestions();
    } catch (error) {
        console.error("Video analysis: failed to load dynamic questions.", error);
        questions = baseQuestions;
    }

    const [title, options] = questions[index];
    const dots = questions.map((_, dotIndex)=> `<i class="${dotIndex <= index ? "active" : ""}"></i>`).join("");
    let choices = "";

    if(options){

        const className = index === 2 ? "va-formats" : "va-options";

        choices = `<div class="${className}">${options.map(option=> `<button type="button">${option}<span>→</span></button>`).join("")}</div>`;

    }
    else{

        choices = `<textarea id="va-description" placeholder="Example: A fast-paced Colt trickshot in Brawl Ball with a surprising finish."></textarea><button class="va-primary" id="va-report" type="button">Create my report <span>→</span></button>`;

    }

    flow.innerHTML = `
        <div class="va-card va-wizard-card">
            <div class="va-wizard-top"><span class="va-step">02 — CONTEXT · ${index + 1} OF ${questions.length}</span><div class="va-dots">${dots}</div></div>
            <div class="va-question"><h3>${title}</h3><p>Quick context lets the scoring engine personalise this report.</p>${choices}</div>
        </div>`;

    flow.querySelectorAll(".va-options button, .va-formats button").forEach(button=>{
        button.addEventListener("click", ()=>{
            button.classList.add("selected");
            const selectedText = button.textContent.trim().replace("→", "").trim();
            
            // Handle "Other" format selection
            if (index === 2 && selectedText === "Other") {
                handleOtherFormatSelection(flow, index);
                return;
            }
            
            if (index === 0) userAnswers.videoOriginality = selectedText;
            else if (index === 1) userAnswers.ideaOriginality = selectedText;
            else if (index === 2) userAnswers.format = selectedText;

            setTimeout(()=> renderWizard(flow, index + 1), 260);
        });
    });

    document.getElementById("va-report")?.addEventListener("click", async ()=> {

        const reportBtn = document.getElementById("va-report");
        const descElement = document.getElementById("va-description");
        if (descElement) userAnswers.description = descElement.value.trim();

        reportBtn.disabled = true;

        renderAnalysis(flow, uploadedVideoFile);
    });

}

/**
 * Extract video insights using the video insights worker.
 *
 * FIX: this now THROWS a structured { type, message } error on any
 * failure (network error, non-2xx response, malformed JSON, or a
 * success:false payload) instead of quietly logging and returning
 * null. Swallowing the error here was the root cause of the bug:
 * the caller (renderAnalysis) had no way to know an error happened,
 * so `analysisError` was never set and the UI never showed the
 * AI-specific failure state — it just silently fell back to
 * generic data with no explanation.
 */
async function extractVideoInsights(videoFile) {
    if (!videoFile) {
        throw { type: "upload", message: "No video file was found for analysis." };
    }

    const formData = new FormData();
    formData.append('video', videoFile);

    let response;
    try {
        response = await fetch(VIDEO_INSIGHTS_WORKER_URL, {
            method: 'POST',
            headers: await getAuthHeaders(),
            body: formData
        });
    } catch (error) {
        throw { type: "network_error", message: error?.message || "Unable to reach the video analysis service." };
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        throw {
            type: response.status >= 500 ? "server_error" : "invalid_response",
            message: `The analysis service returned an unreadable response (HTTP ${response.status}).`
        };
    }

    if (!response.ok) {
        // The backend returns { code: "usage_limit" } (HTTP 429) when the
        // daily quota for video analysis is exhausted. Surface it as a
        // distinct, catchable type so the UI can open the upgrade modal
        // instead of misleading the user with a generic busy/rate-limit error.
        if (payload?.code === "usage_limit") {
            throw {
                type: "usage_limit",
                code: "usage_limit",
                message: "Daily video analysis limit reached."
            };
        }
        const errInfo = payload?.errors || payload?.error || {};
        console.error("Video insights worker error:", payload);
        throw {
            type: errInfo.type || (response.status === 429 ? "rate_limit" : response.status >= 500 ? "server_error" : "api_error"),
            message: errInfo.message || `The analysis service returned HTTP ${response.status}.`
        };
    }

    if (payload?.success && payload?.data) {
        return payload.data;
    }

    console.error("Video insights extraction failed:", payload?.errors);
    throw {
        type: payload?.errors?.type || "unknown_error",
        message: payload?.errors?.message || "Video insights extraction failed."
    };
}

/**
 * Get user-friendly error message based on error type
 */
function getErrorMessage(error) {
    if (!error) return 'An unknown error occurred during video analysis.';
    
    const messages = {
        'usage_limit': 'You have reached your daily limit of video analyses. Upgrade your plan for unlimited analyses.',
        'missing_api_key': 'The AI video analysis service is not configured. Please contact the administrator.',
        'rate_limit': 'The AI service is currently busy. Please try again in a few minutes.',
        'server_error': 'The analysis service is temporarily unavailable (server error). Please try again later.',
        'network_error': 'Unable to connect to the analysis service. Please check your internet connection.',
        'timeout': 'The analysis request timed out. Please try again.',
        'api_error': `Analysis service error: ${error.message}`,
        'invalid_response': `Invalid response from analysis service: ${error.message}`,
        'unknown_error': `An unexpected error occurred: ${error.message}`,
        'upload': error.message || 'There was a problem with the uploaded video file.'
    };
    
    return messages[error.type] || messages['unknown_error'];
}

/**
 * Render error state with banner and basic user data
 */
function renderErrorState(flow, error) {
    const errorMessage = getErrorMessage(error);
    
    flow.innerHTML = `
        <div class="va-results">
            <div class="va-error-banner">
                <div class="va-error-icon">⚠️</div>
                <div class="va-error-content">
                    <h4>AI video analysis unavailable</h4>
                    <p>${escapeHtml(errorMessage)}</p>
                </div>
            </div>
            
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">VIRALITY ANALYSIS · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
                    <h3>Limited analysis</h3>
                    <p>The AI service could not complete the video reading, but the context you provided is still available.</p>
                </div>
                <button class="va-outline" id="va-restart" type="button">Analyze another video →</button>
            </div>
            
            <div class="va-basic-data">
                <div class="va-section-title">
                    <div>
                        <span class="va-step">PROVIDED CONTEXT</span>
                        <h3>Basic information</h3>
                    </div>
                    <p>Data based on your questionnaire responses.</p>
                </div>
                <div class="va-basic-data-grid">
                    <div class="va-basic-item">
                        <span>Video originality</span>
                        <strong>${escapeHtml(userAnswers.videoOriginality || 'Not specified')}</strong>
                    </div>
                    <div class="va-basic-item">
                        <span>Idea originality</span>
                        <strong>${escapeHtml(userAnswers.ideaOriginality || 'Not specified')}</strong>
                    </div>
                    <div class="va-basic-item">
                        <span>Format</span>
                        <strong>${escapeHtml(userAnswers.format || 'Not specified')}</strong>
                    </div>
                    <div class="va-basic-item">
                        <span>Description</span>
                        <strong>${escapeHtml(userAnswers.description || 'No description')}</strong>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById("va-restart").addEventListener("click", () => {
        analysisError = null;
        renderUpload(flow);
    });
}

async function renderAnalysis(flow, videoFile = null){

    // The upload flow owns the file reference. If it is ever missing, return to
    // the upload step instead of rendering a misleading "no video" report.
    if (!videoFile) {
        analysisError = null;
        renderUpload(flow);
        return;
    }

    // Secondo checkpoint (in più rispetto a startUpload): se la quota è
    // esaurita tra la selezione del file e il click su "Create my report",
    // blocca comunque. La vera guardia resta try_consume_usage sul backend.
    if (await videoAnalysisQuotaBlocked()) {
        renderUpload(flow);
        return;
    }

    const runId = ++analysisRunId;
    const steps = ["Reading video", "Detecting the hook", "Reading on-screen text", "Comparing with previous Shorts", "Reading current trends", "Estimating virality", "Writing your AI report"];
    const viralityStepIndex = steps.indexOf("Estimating virality");
    cachedReportState = null;

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">AI VIDEO INTELLIGENCE · PRIMARY SIGNAL</span>
            <h3>AI is reading your Short<span class="va-loading">...</span></h3>
            <p>We’re examining the actual frames, pacing, audio and ending before scoring anything.</p>
            <div class="va-analysis-list">${steps.map((step, i) => `<div data-step="${i}">${step}</div>`).join("")}</div>
            <div class="va-progress"><i id="va-analysis-bar"></i></div>
            <small id="va-analysis-copy">Initializing workspace</small>
        </div>`;

    let stepIndex = 0;
    let videoInsights = null;
    let trendsAnalysis = null;
    let allDataReady = false;
    let reportPromise = null;
    let reportResult = null;
    let waitingTick = 0;
    const WAITING_COPY = [
        "AI is checking the opening hook…",
        "AI is mapping visual energy and scene changes…",
        "AI is reviewing the ending for retention leaks…",
        "AI is turning the video evidence into a report…"
    ];
    analysisError = null;

    const insightsPromise = videoFile
        ? extractVideoInsights(videoFile)
            .then(result => {
                if (runId === analysisRunId) {
                    videoInsights = result;
                    console.log("AI video analysis completed successfully");
                }
            })
            .catch(error => {
                if (runId !== analysisRunId) return;
                console.error("Video insights extraction failed:", error);
                videoInsights = null;
                analysisError = (error && error.type)
                    ? error
                    : { type: "unknown_error", message: error?.message || String(error) };

                // Quota giornaliera esaurita: apri subito il modale upgrade così
                // l'utente capisce il motivo invece di vedere un fallback muto.
                if (analysisError?.code === "usage_limit") {
                    import("./js_subscription.js?v=20260827-idea-fix")
                        .then(mod => mod.openUpgradeModal())
                        .catch(err => console.warn("Open upgrade modal failed:", err));
                }
            })
        : Promise.resolve().then(() => {
            analysisError = { type: "upload", message: "No video file was found for analysis." };
        });

    // Trends are part of the data needed to calculate the virality score.
    // Wait for both sources before checking the final scoring step.
    const trendsPromise = ensureTrendsLoaded()
        .then(result => { trendsAnalysis = result; })
        .catch(error => {
            console.warn("Video analysis: trends unavailable", error);
            trendsAnalysis = null;
        });

    Promise.allSettled([insightsPromise, trendsPromise]).then(() => {
        if (runId === analysisRunId) allDataReady = true;
    });

    const progressTimer = setInterval(() => {
        if (runId !== analysisRunId) {
            clearInterval(progressTimer);
            return;
        }

        const rows = flow.querySelectorAll(".va-analysis-list div");
        const progressBar = flow.querySelector("#va-analysis-bar");
        const progressCopy = flow.querySelector("#va-analysis-copy");

        // Do not advance into estimating virality until video and trends data
        // have both settled. This keeps the checkmark honest. The copy rotates
        // roughly every 5 seconds so the user sees the analysis is still alive.
        if (stepIndex === viralityStepIndex && !allDataReady) {
            if (progressCopy && waitingTick % 4 === 0) {
                progressCopy.textContent = WAITING_COPY[(waitingTick / 4) % WAITING_COPY.length];
            }
            waitingTick++;
            return;
        }

        // The score calculation starts only after every input is ready. The
        // following writing step cannot complete until the real report exists.
        if (stepIndex === viralityStepIndex && allDataReady) {
            rows[stepIndex].classList.add("done");
            if (progressBar) progressBar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
            if (progressCopy) progressCopy.textContent = steps[stepIndex];
            stepIndex++;
            reportPromise = analyzeVirality(userAnswers, trendsAnalysis, videoInsights)
                .then(result => { reportResult = result; })
                .catch(error => {
                    console.error("Video virality report failed:", error);
                    reportResult = { success: false };
                });
            return;
        }

        if (stepIndex === steps.length - 1 && !reportResult) {
            if (progressCopy) progressCopy.textContent = WAITING_COPY[waitingTick % WAITING_COPY.length];
            waitingTick++;
            return;
        }

        if (stepIndex < rows.length) {
            rows[stepIndex].classList.add("done");
            if (progressBar) progressBar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
            if (progressCopy) progressCopy.textContent = steps[stepIndex];
            stepIndex++;
            return;
        }

        clearInterval(progressTimer);
        setTimeout(() => {
            if (runId === analysisRunId) {
                renderResults(flow, videoInsights, runId, trendsAnalysis, reportResult);
            }
        }, 450);
    }, 1200);
    setInterval(() => {
        if (runId !== analysisRunId) return;
        const copy = flow.querySelector("#va-analysis-copy");
        if (copy) copy.textContent = WAITING_COPY[waitingTick++ % WAITING_COPY.length];
    }, 5000);

}

function toPercentScore(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(100, numericValue > 1 ? numericValue : numericValue * 100));
}

function mergeInsightItems(...itemGroups) {
    const seen = new Set();
    const merged = [];

    itemGroups
        .flat()
        .filter(Boolean)
        .forEach(item => {
            const cleanedItem = String(item).trim();
            if (!cleanedItem) return;
            const lookupKey = cleanedItem.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
            if (seen.has(lookupKey)) return;
            seen.add(lookupKey);
            merged.push(cleanedItem);
        });

    return merged;
}

function buildBreakdown(result, videoInsights = null, useRealData = false) {
    if (useRealData && result?.scoreBreakdown) {
        const breakdown = [
            ["Originality", Math.round(result.scoreBreakdown.originality.score)],
            ["Trend", Math.round(result.scoreBreakdown.trend.score)],
            ["Format", Math.round(result.scoreBreakdown.format.score)],
            ["Competition", Math.round(result.scoreBreakdown.competition.score)],
            ["Retention", Math.round(result.scoreBreakdown.retention.score)]
        ];

        if (videoInsights?.hookStrength != null) {
            breakdown.splice(2, 0, ["Hook", Math.round(toPercentScore(videoInsights.hookStrength))]);
        }

        return breakdown;
    }

    return [
        ["Hook", 94],
        ["Originality", 86],
        ["Trend", 91],
        ["Retention", 83],
        ["Format", 89],
        ["Competition", 76]
    ];
}

function pdfSafeText(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[^\x20-\x7E]/g, "?");
}

function wrapPdfText(value, maxChars = 92) {
    const text = pdfSafeText(value).replace(/\s+/g, " ").trim();
    if (!text) return [""];

    const lines = [];
    let current = "";
    text.split(" ").forEach(word => {
        if (word.length > maxChars) {
            if (current) {
                lines.push(current);
                current = "";
            }
            for (let index = 0; index < word.length; index += maxChars) {
                lines.push(word.slice(index, index + maxChars));
            }
            return;
        }

        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxChars) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    });

    if (current) lines.push(current);
    return lines;
}

function buildPdfReportLines(report = {}) {
    const lines = [];
    const add = value => wrapPdfText(value).forEach(line => lines.push(line));
    const addSection = (title, values) => {
        lines.push("");
        lines.push(title.toUpperCase());
        const items = Array.isArray(values) ? values.filter(Boolean) : [];
        if (items.length === 0) {
            lines.push("- None reported.");
            return;
        }
        items.forEach(item => add(`- ${item}`));
    };
    const addAnswer = (label, value) => add(`${label}: ${value || "Not specified"}`);

    lines.push("BRAWL ANALYTICS | VIDEO ANALYSIS REPORT");
    lines.push(`Generated: ${new Date().toLocaleDateString("en-US")}`);
    lines.push("");
    lines.push("VIDEO CONTEXT");
    add(`Video title: ${report.videoTitle || "Untitled video"}`);
    add("Description provided before analysis:");
    add(report.description || "No description provided.");
    addAnswer("Video originality", report.answers?.videoOriginality);
    addAnswer("Idea originality", report.answers?.ideaOriginality);
    addAnswer("Format", report.answers?.format);
    lines.push("");
    lines.push("ANALYSIS SNAPSHOT");
    add(`Virality score: ${report.score ?? "-"}/100`);
    add(`Confidence: ${report.confidence ?? "-"}%`);
    add(`Estimated view range: ${report.viewRange || "-"}`);
    if (report.aiDegraded) add("Note: qualitative AI fallback values were used; interpret this report cautiously.");

    lines.push("");
    lines.push("SCORE BREAKDOWN");
    const breakdown = Array.isArray(report.breakdown) ? report.breakdown : [];
    ["Originality", "Trend", "Format", "Competition", "Retention"].forEach(category => {
        const item = breakdown.find(entry => String(entry?.[0]).toLowerCase() === category.toLowerCase());
        add(`${category}: ${item ? item[1] : "-"}/100`);
    });

    addSection("Strengths", report.strengths);
    addSection("Weaknesses", report.weaknesses);
    addSection("Critical issues", report.criticalIssues);
    addSection("Action plan", report.actionPlan);

    lines.push("");
    lines.push("DISCLAIMER");
    add("AI-generated, not a guarantee of future performance.");
    return lines;
}

function escapePdfLiteral(value) {
    return pdfSafeText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createPdfDocument(lines) {
    const pageLines = [];
    for (let index = 0; index < lines.length; index += 48) {
        pageLines.push(lines.slice(index, index + 48));
    }
    if (pageLines.length === 0) pageLines.push([""]);

    const pageObjectNumbers = pageLines.map((_, index) => 3 + index * 2);
    const contentObjectNumbers = pageLines.map((_, index) => 4 + index * 2);
    const fontObjectNumber = 3 + pageLines.length * 2;
    const objects = [];

    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(" ")}] /Count ${pageLines.length} >>`);

    pageLines.forEach((page, index) => {
        const stream = [
            "q",
            "0.95 0.99 0.98 rg",
            "0 0 612 792 re f",
            "0.16 0.42 0.34 rg",
            "50 758 512 24 re f",
            "Q",
            "BT",
            "/F1 11 Tf",
            "0.10 0.16 0.14 rg",
            "50 748 Td",
            "14 TL",
            ...page.map((line, lineIndex) => {
                const isHeader = lineIndex === 0 && page[0].includes("BRAWL ANALYTICS");
                return `${isHeader ? "/F1 16 Tf" : "/F1 11 Tf"}\n(${escapePdfLiteral(line)}) Tj\nT*`;
            }),
            "ET"
        ].join("\n");

        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumbers[index]} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });

    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets[index + 1] = pdf.length;
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index++) {
        pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
}

function downloadReportAsPdf(report) {
    const pdf = createPdfDocument(buildPdfReportLines(report));
    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `brawl-analytics-report-${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderResults(flow, videoInsights = null, runId = analysisRunId, trendsAnalysis = null, reportResultOverride = null){

    if (runId !== analysisRunId) return;
    
    // Don't return early - always show full dashboard, just add error banner if AI failed.
    // FIX: analysisError is now actually populated on failure (see
    // extractVideoInsights/renderAnalysis above), so this check works.
    const aiFailed = !videoInsights && !!analysisError && analysisError.type !== "upload";

    // Recupera i trend reali (dalla cache se già caricati in questa
    // sessione, altrimenti li scarica ora): prima questo valore era
    // SEMPRE null, quindi l'AI non confrontava mai titolo/descrizione
    // del video con i trend attuali di Brawl Stars — trendAlignment e
    // semanticTrendSimilarity restavano sempre sui valori di default.
    const resolvedTrendsAnalysis = trendsAnalysis || await ensureTrendsLoaded();

    if (runId !== analysisRunId) return;

    const result = reportResultOverride || await analyzeVirality(
        userAnswers,
        resolvedTrendsAnalysis,
        videoInsights
    );

    if (runId !== analysisRunId) return;
    
    // Use real results or fallback to placeholders if analysis failed
    const useRealData = result.success;
    
    const score = useRealData ? result.viralityScore : null;
    const reportVideoTitle = userAnswers.title || uploadedVideoFile?.name?.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled video";
    const confidence = useRealData ? result.confidence : null;
    const viewRange = useRealData ? result.viewRange.formatted : "DEMO — unavailable";
    const scoreCategory = useRealData ? result.scoreCategory.label : "Analysis unavailable";
    const scoreIcon = useRealData ? result.scoreCategory.icon : "—";
    
    const breakdown = buildBreakdown(result, videoInsights, useRealData);
    
    const strengths = mergeInsightItems(videoInsights?.strengths || [], useRealData && result.strengths ? result.strengths : [], useRealData ? [] : ["DEMO — no real strengths available"]);
    
    const weaknesses = mergeInsightItems(videoInsights?.weaknesses || [], useRealData && result.weaknesses ? result.weaknesses : [], useRealData ? [] : ["DEMO — no real weaknesses available"]);
    
    const technicalIssues = mergeInsightItems(
        videoInsights?.technicalIssues || [],
        [],
        []
    );
    
    const criticalIssues = mergeInsightItems(
        [],
        useRealData && result.criticalIssues ? result.criticalIssues : [],
        []
    );
    
    const summary = useRealData && result.summary ? result.summary : "Analysis unavailable — no real result was returned.";
    const actionPlan = useRealData && result.actionPlan ? result.actionPlan : ["DEMO — action plan unavailable until analysis succeeds."];
    const aiRecommendations = mergeInsightItems(
        videoInsights?.weaknesses || [],
        videoInsights?.technicalIssues || [],
        useRealData ? result.criticalIssues || [] : [],
        useRealData ? result.actionPlan || [] : ["AI recommendations will appear when the video analysis succeeds."]
    ).slice(0, 4);
    const detectedDuration = Number(videoInsights?.durationSeconds || videoInsights?.duration || uploadedVideoFile?.duration);
    const videoDuration = Number.isFinite(detectedDuration) && detectedDuration > 0
        ? detectedDuration
        : Math.max(6, Number(videoInsights?.energyCurve?.length) || 30);
    const recommendedEnd = Math.max(1, Math.min(videoDuration, Number(videoInsights?.recommendedEndTimestamp) || videoDuration));
    const durationDecision = videoInsights?.durationDecision || "uncertain";
    const durationReason = videoInsights?.durationReason || "AI could not determine a safer edit point from the available evidence.";
    const baseViews = Number(result?.viewRange?.baseline) || 10000;
    const retentionBaseline = Math.max(25, Math.min(92, 72 - (videoInsights?.deadMoments || 0) * 2));

    // Show an error only for a real service failure; a missing-file state is handled before analysis starts.
    const analysisFailed = !videoInsights && !!analysisError && analysisError.type !== "upload";
    const errorBannerHtml = analysisFailed ? `
        <div class="va-error-banner">
            <div class="va-error-icon">⚠️</div>
            <div class="va-error-content">
                <h4>AI video analysis unavailable</h4>
                <p>${escapeHtml(getErrorMessage(analysisError))}</p>
            </div>
        </div>
    ` : '';

    flow.innerHTML = `
        <div class="va-results">
            ${errorBannerHtml}
            <div class="va-results-hero"><div><span class="va-eyebrow">${useRealData ? "VIRALITY ANALYSIS" : "SIMULATED REPORT"} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</span><h3>Your Short has <span class="va-emphasis">${escapeHtml(String(scoreCategory).toLowerCase())}</span> viral potential.</h3><p>${escapeHtml(useRealData ? summary : "All values below are demonstrative placeholders, ready to be connected to a real analysis engine later.")}</p></div><div class="va-result-actions"><button class="va-primary" id="va-download-pdf" type="button">Download report as PDF</button><button class="va-outline" id="va-restart" type="button">Analyse another video →</button></div></div>
            <div class="va-score-grid"><article class="va-metric va-score"><span>VIRALITY SCORE</span><strong><b id="va-score-value">0</b><small>/ 100</small></strong><i>${escapeHtml(`${scoreIcon} ${scoreCategory}`)}</i><p>${useRealData ? "Based on originality, trend alignment, format performance, and historical context." : "Strong early signals, format fit and audience relevance."}</p></article><article class="va-metric"><span>CONFIDENCE</span><strong>${escapeHtml(`${confidence}%`)}</strong><i>${useRealData ? (confidence >= 70 ? "High confidence" : confidence >= 40 ? "Moderate confidence" : "Low confidence") : "High confidence"}</i><div class="va-progress"><i style="width:${confidence}%"></i></div><p>${useRealData ? "Based on historical data volume and consistency." : "Based on available simulated signals."}</p></article><article class="va-metric va-views"><span>ESTIMATED VIEWS</span><strong>${escapeHtml(String(viewRange))}</strong><p>This range is an estimate, not a guarantee.</p><div class="va-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article></div>
            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div><p>${useRealData ? "How each factor contributed to your score." : "Where the simulated score comes from."}</p></div>
            <div class="va-breakdown">${breakdown.map(([name,value])=> `<div><p><span>${escapeHtml(String(name))}</span><strong>${value}</strong></p><div class="va-progress"><i style="width:${value}%"></i></div></div>`).join("")}</div>
            <div class="va-insights"><article class="va-insight good"><span>✦</span><h4>Strengths</h4><ul>${strengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></article><article class="va-insight weak"><span>↗</span><h4>Weaknesses</h4><ul>${weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></article>${technicalIssues.length > 0 ? `<article class="va-insight critical"><span>⚙️</span><h4>Technical issues</h4><ul>${technicalIssues.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul></article>` : ''}${criticalIssues.length > 0 ? `<article class="va-insight critical"><span>!</span><h4>Critical issues</h4><ul>${criticalIssues.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul></article>` : ''}</div>
            <section class="va-signal-animation-shell" id="va-signal-animation" aria-label="Interactive animation — retention lab and creative signals"></section>
            <section class="va-channel"><span class="va-channel-mark">B</span><div><span>HISTORICAL CONTEXT</span><h3>How this video compares to your past Shorts.</h3><p>${useRealData && result.predictionContext ? `This video is predicted to perform ${result.predictionContext.comparison.toLowerCase()} compared to your historical content.` : "This video is stronger than <strong>82%</strong> of your previous Shorts and uses a format that historically works well for your channel."}</p></div><strong>${useRealData && result.predictionContext ? `P${result.predictionContext.percentile}` : "+18%"}<small>${useRealData ? "percentile vs<br>your history" : "above your average<br>demo score"}</small></strong></section>
            <div class="va-end-grid"><aside><span>EDUCATIONAL TIP</span><h4 id="va-tip">Trending topics usually perform best within 48 hours.</h4><button id="va-next-tip" type="button">Show another tip →</button></aside><section class="va-faq"><span class="va-step">FAQ</span><h3>A few good questions</h3><details open><summary>Why is this only a prediction? <b>+</b></summary><p>Performance depends on timing, audience behaviour and distribution. A score is a decision aid, not a promise.</p></details><details><summary>How accurate is the score? <b>+</b></summary><p>${useRealData ? "Accuracy depends on your channel's historical data volume and consistency. More data = higher confidence." : "Analysis data is unavailable."}</p></details><details><summary>How is the Virality Score calculated? <b>+</b></summary><p>${useRealData ? "The score combines originality, trend alignment, format performance, channel history, and competition factors using dynamic weighting." : "Analysis data is unavailable."}</p></details><details><summary>Can the prediction be wrong? <b>+</b></summary><p>Yes. Use it to spot opportunities and refine your creative process.</p></details></section></div>
        </div>`;

    if (useRealData) animateScore(score);
    const signals = getAnimationSignals(videoInsights, result, retentionBaseline, videoDuration);
    const labOptions = {
        videoDuration,
        recommendedEnd,
        baseViews,
        retentionBaseline,
        durationDecision,
        durationReason,
        aiRecommendations,
        shortCutPenalty: Number(videoInsights?.shortCutPenalty) || 0,
        uploadedVideoPreviewUrl
    };
    setupSignalAnimation(flow, signals, labOptions);
    setupVideoEditLab(flow, videoDuration, baseViews, retentionBaseline, recommendedEnd, labOptions.shortCutPenalty);
    setupResultActions(flow, {
        score,
        confidence,
        viewRange,
        breakdown,
        strengths,
        weaknesses,
        criticalIssues: [...technicalIssues, ...criticalIssues],
        actionPlan,
        videoTitle: reportVideoTitle,
        description: userAnswers.description,
        answers: { ...userAnswers },
        aiDegraded: Boolean(useRealData && result.aiDegraded)
    });

    // Cache the rendered report so it can be restored after a tab switch
    // even if the flow innerHTML gets cleared by an intermediate event.
    cachedReportState = {
        html: flow.innerHTML,
        labOptions,
        videoDuration,
        baseViews,
        retentionBaseline,
        recommendedEnd,
        shortCutPenalty: Number(videoInsights?.shortCutPenalty) || 0,
        reportData: {
            score,
            confidence,
            viewRange,
            breakdown,
            strengths,
            weaknesses,
            criticalIssues: [...technicalIssues, ...criticalIssues],
            actionPlan,
            videoTitle: reportVideoTitle,
            description: userAnswers.description,
            answers: { ...userAnswers },
            aiDegraded: Boolean(useRealData && result.aiDegraded)
        },
        useRealData,
        signals
    };
}

function formatCompactNumber(value) {
    const numeric = Math.max(0, Number(value) || 0);
    return numeric >= 1000000 ? `${(numeric / 1000000).toFixed(1)}M` : numeric >= 1000 ? `${(numeric / 1000).toFixed(1)}K` : Math.round(numeric).toString();
}

// Signals shown in the single animation section (the retention lab is the
// first slide and is rendered separately). Values are recomputed live as the
// user drags the trim point in the lab, so every animation reacts to the same
// real input the retention lab does.
function getAnimationSignals(videoInsights, result, retentionBaseline, videoDuration) {
    // toPercentScore() returns 0 for missing values, so check presence first:
    // real insights without a hook reading get 0, a demo report keeps a
    // representative baseline so the animation stays meaningful.
    const rawHook = videoInsights?.hookStrength;
    const hook = rawHook == null ? (videoInsights ? 0 : 70) : toPercentScore(rawHook);
    const duration = Number(videoInsights?.durationSeconds || videoInsights?.duration || videoDuration);
    const idealDuration = Number(videoInsights?.idealDuration || videoInsights?.recommendedDuration);
    const durationRisk = duration > 0 && idealDuration > 0 ? Math.max(0, Math.min(100, 100 - Math.abs(duration - idealDuration) / duration * 100)) : 50;
    const originality = Number(result?.scoreBreakdown?.originality?.score);
    const trend = Number(result?.scoreBreakdown?.trend?.score);
    return [
        { id: "hook", label: "Hook", value: hook, baseline: hook, priority: hook > 0 ? 100 - hook : 0, description: "The first seconds decide whether viewers stop scrolling." },
        { id: "duration", label: "Video length", value: durationRisk, baseline: durationRisk, priority: 100 - durationRisk, idealDuration: Number.isFinite(idealDuration) && idealDuration > 0 ? idealDuration : null, description: "The edit length is compared with the strongest duration pattern." },
        { id: "originality", label: "Originality", value: Number.isFinite(originality) ? originality : 50, baseline: Number.isFinite(originality) ? originality : 50, priority: Number.isFinite(originality) ? 100 - originality : 0, description: "Distinctive creative choices make the Short easier to remember." },
        { id: "trend", label: "Trend fit", value: Number.isFinite(trend) ? trend : 50, baseline: Number.isFinite(trend) ? trend : 50, priority: Number.isFinite(trend) ? 100 - trend : 0, description: "Relevant timing and topic framing can improve discovery." }
    ].sort((a, b) => b.priority - a.priority);
}

function renderSignalAnimation(signal, index, labOptions = null) {
    const value = Math.round(Math.max(0, Math.min(100, signal.value)));
    const maxSeconds = Math.round(Number(labOptions?.videoDuration) || 30);
    const visual = signal.id === "hook"
        ? `<div class="va-hook-beat"><i></i><i></i><i></i><b>0.0s</b><b>1.0s</b><b>2.0s</b></div>`
        : signal.id === "duration"
            ? `<div class="va-duration-ruler"><span>0s</span><i style="--marker:100%"></i><b class="va-cut-label">YOUR CUT</b><span>${maxSeconds}s</span></div>`
            : signal.id === "trend"
                ? `<div class="va-trend-network"><i></i><i></i><i></i><b>LIVE</b></div>`
                : `<div class="va-originality-scanner"><i></i><b>UNIQUE ANGLE</b></div>`;
    return `<article class="va-signal-animation va-signal-animation--${signal.id}" data-signal-id="${signal.id}" aria-label="${escapeHtml(signal.label)} animation">
        <div class="va-signal-visual" style="--signal-value:${value}%" aria-hidden="true"><span class="va-signal-orbit"></span><span class="va-signal-core" data-signal-core>${value}<small>%</small></span><span class="va-signal-pulse"></span><span class="va-signal-glint"></span></div>
        <div class="va-signal-copy"><span class="va-step">PRIMARY CREATIVE SIGNAL</span><h3>${escapeHtml(signal.label)}</h3><p data-signal-note>${escapeHtml(signal.description)}</p>${visual}</div>
    </article>`;
}

function renderLabSlideHtml({ videoDuration, recommendedEnd, baseViews, retentionBaseline, durationDecision, durationReason, aiRecommendations, uploadedVideoPreviewUrl }) {
    return `<section class="va-ai-lab" data-duration="${videoDuration}" data-recommended-end="${recommendedEnd}" data-base-views="${baseViews}" data-retention="${retentionBaseline}">
            <div class="va-lab-heading"><div><span class="va-step">AI VIDEO COACH · RETENTION LAB</span><h3>Make this exact cut stronger</h3><p>Drag the trim point — the other animations react to the same cut.</p></div><span class="va-ai-pulse">● LIVE EVIDENCE</span></div>
        <div class="va-edit-preview"><div class="va-video-frame"><video id="va-uploaded-video" controls preload="metadata" playsinline src="${uploadedVideoPreviewUrl || ""}" aria-label="Your uploaded video"></video><div class="va-video-overlay"><small>YOUR UPLOADED VIDEO</small><b id="va-video-marker">Recommended end · ${recommendedEnd.toFixed(1)}s</b></div></div><div class="va-timeline"><div class="va-timeline-track"><i id="va-trim-fill"></i><span id="va-trim-handle"></span><b id="va-recommended-marker" style="left:${(recommendedEnd / videoDuration) * 100}%">AI</b></div><div class="va-timeline-labels"><span>0:00</span><span id="va-duration-label">${videoDuration.toFixed(1)}s</span></div><label for="va-trim-range">Choose the final cut point (the clip starts at 0:00)</label><input id="va-trim-range" type="range" min="0.1" max="${videoDuration.toFixed(2)}" step="0.1" value="${videoDuration.toFixed(2)}" aria-label="Video ending point in seconds"><output id="va-trim-label" for="va-trim-range">0:00 — ${videoDuration.toFixed(1)}s</output><button class="va-primary va-export-video" id="va-export-video" type="button">Export trimmed video <span>↓</span></button></div></div>
        <div class="va-duration-guidance"><strong>${durationDecision === "shorten" ? "Shorten only to the marked point" : durationDecision === "keep" ? "Keep the current length" : "Review the marked point before trimming"}</strong><p>${escapeHtml(durationReason)}</p></div>
        <div class="va-lab-metrics"><div><span>RETENTION</span><strong id="va-retention-value">${retentionBaseline}%</strong><p id="va-retention-note">Current cut baseline</p></div><div><span>SWIPE-AWAY</span><strong id="va-swipe-value">${computeSwipeAway(retentionBaseline)}%</strong><div class="va-mini-chart" id="va-swipe-chart" aria-label="Swipe-away curve"></div><p>Viewers who leave before the end</p></div><div><span>ESTIMATED VIEWS</span><strong id="va-lab-views">${formatCompactNumber(baseViews)}</strong><p id="va-views-note">Prediction at current length</p></div></div>
        <div class="va-ai-actions"><h4>AI edit notes</h4><ul>${aiRecommendations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    </section>`;
}

/*
 * Swipe-away is NOT the complement of average retention. Average % viewed is
 * inflated by the viewers who watch the whole Short, so the share of viewers
 * who leave before the end is always higher than (100 - retention). We model
 * the completion rate as a fraction of retention (Shorts-typical range) and
 * derive swipe-away from that.
 */
function computeSwipeAway(retention) {
    const safeRetention = Math.max(20, Math.min(95, Number(retention) || 0));
    const completion = Math.max(25, Math.min(70, Math.round(safeRetention * 0.62)));
    return Math.max(30, 100 - completion);
}

// State shared with setupVideoEditLab so the trim slider can refresh every
// animation in the single section with the current cut decision.
let activeSignalState = { signals: [], labOptions: null };

function refreshSignalSlides(flow, cut) {
    const shell = flow?.querySelector("#va-signal-animation");
    if (!shell || !activeSignalState.signals.length) return;
    const { signals } = activeSignalState;
    const videoDuration = Math.max(1, Number(cut.videoDuration) || 1);
    const hookWindow = Math.max(1.2, Math.min(3, videoDuration * 0.12));
    signals.forEach(signal => {
        let value = signal.baseline;
        let note = signal.description;
        if (signal.id === "duration") {
            const ideal = signal.idealDuration || videoDuration;
            value = ideal > 0 ? Math.max(0, Math.min(100, 100 - Math.abs(cut.cut - ideal) / ideal * 100)) : 50;
            note = signal.idealDuration
                ? `Your cut lands at ${cut.cut.toFixed(1)}s — your strongest length pattern sits near ${ideal.toFixed(1)}s.`
                : `Your cut lands at ${cut.cut.toFixed(1)}s of ${videoDuration.toFixed(1)}s.`;
        } else if (signal.id === "hook") {
            if (cut.cut <= hookWindow) {
                value = Math.round(signal.baseline * Math.max(0, cut.cut / hookWindow));
                note = `This cut removes part of your opening hook — the first ${hookWindow.toFixed(1)}s decide whether viewers stay.`;
            }
        }
        const slide = shell.querySelector(`[data-signal-id="${signal.id}"]`);
        if (!slide) return;
        const core = slide.querySelector("[data-signal-core]");
        if (core) core.innerHTML = `${Math.round(value)}<small>%</small>`;
        const visualEl = slide.querySelector(".va-signal-visual");
        if (visualEl) visualEl.style.setProperty("--signal-value", `${Math.round(value)}%`);
        const noteEl = slide.querySelector("[data-signal-note]");
        if (noteEl) noteEl.textContent = note;
        if (signal.id === "duration") {
            const ruler = slide.querySelector(".va-duration-ruler i");
            if (ruler) ruler.style.setProperty("--marker", `${Math.round(Math.max(6, cut.keep * 100))}%`);
            const cutLabel = slide.querySelector(".va-cut-label");
            if (cutLabel) cutLabel.textContent = `YOUR CUT · ${cut.cut.toFixed(1)}s`;
        }
        if (signal.id === "hook") {
            const bars = slide.querySelectorAll(".va-hook-beat i");
            const baseHeights = [26, 42, 34];
            bars.forEach((bar, index) => bar.style.setProperty("--beat", `${Math.round(baseHeights[index] * Math.max(0.06, value / 100))}px`));
        }
    });
}

function setupSignalAnimation(flow, signals, labOptions = null) {
    const shell = flow.querySelector("#va-signal-animation");
    if (!shell || !Array.isArray(signals) || signals.length === 0) return;

    activeSignalState = { signals, labOptions };

    // ONE animation section: the interactive retention lab is the first slide,
    // the other creative signals follow. The arrows cycle all of them.
    const slideCount = signals.length + 1;
    let activeIndex = 0;

    const labHtml = labOptions ? renderLabSlideHtml(labOptions) : "";
    shell.innerHTML = `
        <div class="va-signal-slides">
            <div class="va-signal-slide va-signal-slide--lab" data-slide-index="0">${labHtml}</div>
            ${signals.map((signal, index) => `<div class="va-signal-slide" data-slide-index="${index + 1}">${renderSignalAnimation(signal, index + 1, labOptions)}</div>`).join("")}
        </div>
        <div class="va-signal-controls"><button type="button" data-signal-prev aria-label="Previous animation">←</button><span data-signal-counter>1 / ${slideCount}</span><button type="button" data-signal-next aria-label="Next animation">→</button></div>`;

    const slides = [...shell.querySelectorAll(".va-signal-slide")];
    const counter = shell.querySelector("[data-signal-counter]");
    const prev = shell.querySelector("[data-signal-prev]");
    const next = shell.querySelector("[data-signal-next]");

    const show = index => {
        activeIndex = (index + slideCount) % slideCount;
        slides.forEach((slide, i) => slide.classList.toggle("is-active", i === activeIndex));
        counter.textContent = `${activeIndex + 1} / ${slideCount}`;
        shell.classList.toggle("is-lab-active", activeIndex === 0);
    };

    prev.addEventListener("click", () => show(activeIndex - 1));
    next.addEventListener("click", () => show(activeIndex + 1));

    // Pointer parallax keeps the visual style of the signal cards. Keyboard
    // navigation stays scoped to the cards so arrow keys on the trim slider or
    // the video controls never advance the carousel by accident.
    slides.forEach(slide => {
        const card = slide.querySelector(".va-signal-animation");
        if (!card) return;
        card.setAttribute("tabindex", "0");
        card.addEventListener("keydown", event => {
            if (event.key === "ArrowRight") show(activeIndex + 1);
            if (event.key === "ArrowLeft") show(activeIndex - 1);
        });
        card.addEventListener("pointermove", event => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty("--pointer-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
            card.style.setProperty("--pointer-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
        });
        card.addEventListener("pointerleave", event => {
            event.currentTarget.style.removeProperty("--pointer-x");
            event.currentTarget.style.removeProperty("--pointer-y");
        });
    });

    show(0);
}

function setupVideoEditLab(flow, videoDuration, baseViews, retentionBaseline, recommendedEnd = videoDuration, shortCutPenalty = 0) {
    const range = flow.querySelector("#va-trim-range");
    const video = flow.querySelector("#va-uploaded-video");
    const exportButton = flow.querySelector("#va-export-video");
    let selectedDuration = videoDuration;
    const formatTime = seconds => {
        const value = Math.max(0, Number(seconds) || 0);
        return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
    };
    const exportTrimmedVideo = async () => {
        if (!uploadedVideoFile || !video) return;
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream || !window.AudioContext) {
            alert("Video export is not supported by this browser. Try Chrome or Edge.");
            return;
        }
        exportButton.disabled = true;
        exportButton.textContent = "Preparing export…";
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1920;
        canvas.height = video.videoHeight || 1080;
        const context = canvas.getContext("2d");
        const stream = canvas.captureStream(30);
        const audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(video);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);
        source.connect(audioContext.destination);
        destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        const finished = new Promise((resolve, reject) => {
            recorder.onerror = () => reject(new Error("Recording failed"));
            recorder.onstop = () => resolve();
        });
        video.currentTime = 0;
        await new Promise(resolve => {
            if (video.readyState >= 2) resolve();
            else video.addEventListener("canplay", resolve, { once: true });
        });
        await video.play();
        recorder.start();
        const draw = () => {
            if (recorder.state !== "recording") return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (video.currentTime >= selectedDuration || video.ended) {
                video.pause();
                recorder.stop();
            } else requestAnimationFrame(draw);
        };
        draw();
        try {
            await finished;
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `brawl-analytics-cut-${selectedDuration.toFixed(1)}s.webm`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error("Video export failed", error);
            alert("Impossibile esportare il video. Riprova con Chrome o Edge.");
        } finally {
            source.disconnect();
            audioContext.close();
            exportButton.disabled = false;
            exportButton.innerHTML = "Export trimmed video <span>↓</span>";
        }
    };
    exportButton?.addEventListener("click", exportTrimmedVideo);
    if (!range) return;
    const update = () => {
        const duration = Math.max(0.1, Math.min(videoDuration, Number(range.value) || videoDuration));
        selectedDuration = duration;
        const keep = duration / videoDuration;
        const recommendedKeep = Math.max(.45, Math.min(1, recommendedEnd / videoDuration));
        const tooShort = keep < Math.max(.62, recommendedKeep - .08);
        const removesProtectedEnding = keep < recommendedKeep;
        const safeTrim = keep >= recommendedKeep && keep < .98;
        const improvement = safeTrim ? Math.min(8, (1 - keep) * 18) : 0;
        const penalty = removesProtectedEnding ? Math.max(8, shortCutPenalty || 18) * (recommendedKeep - keep) / recommendedKeep : 0;
        const retention = Math.round(Math.max(20, Math.min(94, retentionBaseline + improvement - penalty)));
        const swipeAway = computeSwipeAway(retention);
        const viewsFactor = removesProtectedEnding ? Math.max(.35, 1 - penalty / 100) : 1 + (retention - retentionBaseline) * .012;
        const views = baseViews * viewsFactor;
        const percentage = Math.max(0, Math.min(100, keep * 100));
        flow.querySelector("#va-trim-fill").style.width = `${percentage}%`;
        flow.querySelector("#va-trim-handle").style.left = `${percentage}%`;
        flow.querySelector("#va-trim-label").textContent = `0:00 — ${formatTime(duration)} (${duration.toFixed(1)}s)`;
        flow.querySelector("#va-duration-label").textContent = `${duration.toFixed(1)}s`;
        flow.querySelector("#va-retention-value").textContent = `${retention}%`;
        flow.querySelector("#va-swipe-value").textContent = `${swipeAway}%`;
        flow.querySelector("#va-lab-views").textContent = formatCompactNumber(views);
        flow.querySelector("#va-retention-note").textContent = removesProtectedEnding ? "Penalty: an essential setup or reveal may be missing" : safeTrim ? "Potential lift from removing a safe dead moment" : tooShort ? "Very short — not automatically better" : "Current cut baseline";
        flow.querySelector("#va-views-note").textContent = removesProtectedEnding ? "Views fall because the payoff/context was cut" : safeTrim ? "Prediction after a safe trim" : "Prediction at this edit length";
        flow.querySelector("#va-video-marker").textContent = `Recommended end · ${recommendedEnd.toFixed(1)}s`;
        const previewVideo = flow.querySelector("#va-uploaded-video");
        if (previewVideo) {
            previewVideo.currentTime = Math.min(previewVideo.currentTime, duration);
            previewVideo.classList.toggle("is-too-short", removesProtectedEnding);
            previewVideo.ontimeupdate = () => {
                if (previewVideo.currentTime >= selectedDuration) {
                    previewVideo.pause();
                    previewVideo.currentTime = selectedDuration;
                }
            };
        }
        const chart = flow.querySelector("#va-swipe-chart");
        if (chart) {
            // The curve ends exactly at the swipe-away value and rises
            // monotonically, so the chart always matches the number.
            chart.style.setProperty("--curve", `${Math.max(12, swipeAway)}%`);
            chart.setAttribute("aria-label", `Swipe-away ${swipeAway}%`);
        }
        // The trim point is the real input behind the whole section: refresh
        // every animation slide with the current cut decision.
        refreshSignalSlides(flow, { cut: duration, keep, retention, swipeAway, views, videoDuration });
    };
    range.addEventListener("input", update);
    update();
}

function animateScore(targetScore = 92){

    const counter = document.getElementById("va-score-value");
    let value = 0;

    const timer = setInterval(()=>{

        value = Math.min(targetScore, value + 2);
        counter.textContent = value;

        if(value === targetScore){

            clearInterval(timer);

        }

    }, 25);

}

function setupResultActions(flow, reportData = null){

    document.getElementById("va-download-pdf")?.addEventListener("click", () => {
        if (reportData) downloadReportAsPdf(reportData);
    });

    document.getElementById("va-restart").addEventListener("click", ()=> renderUpload(flow));

    const tips = ["Trending topics usually perform best within 48 hours.", "Schedule your Shorts instead of publishing immediately.", "Avoid long static endings.", "Create a visual change in the first second."];
    let index = 0;

    document.getElementById("va-next-tip").addEventListener("click", ()=>{

        index = (index + 1) % tips.length;
        document.getElementById("va-tip").textContent = tips[index];

    });

    // FAQ smooth toggle: intercept the default instant close and animate it.
    flow.querySelectorAll(".va-faq details").forEach(details => {
        const summary = details.querySelector("summary");
        if (!summary) return;

        summary.addEventListener("click", e => {
            e.preventDefault();

            if (details.open) {
                // Closing: animate content out, then remove open attribute.
                const p = details.querySelector(":scope > p");
                if (p) {
                    p.style.transition = "opacity .22s ease, transform .22s ease";
                    p.style.opacity = "0";
                    p.style.transform = "translateY(-6px)";
                    p.addEventListener("transitionend", () => {
                        details.removeAttribute("open");
                        // Reset inline styles so the CSS [open] animation works on next open.
                        p.style.transition = "";
                        p.style.opacity = "";
                        p.style.transform = "";
                    }, { once: true });
                } else {
                    details.removeAttribute("open");
                }
            } else {
                // Opening: set open attribute, CSS animation handles the fade-in.
                details.setAttribute("open", "");
            }
        });
    });

}

export {

    initVideoAnalysis,
    resetVideoAnalysisState,
    invalidateChannelProfileCache

};
