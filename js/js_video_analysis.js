import { loadChannelProfile } from "./js_storage.js";
import { analyzeVirality } from "./js_virality_engine.js";
import { ensureTrendsLoaded, escapeHtml } from "./js_trends.js";
import { createModal as createFormatModal } from "./js_formats_manager.js?v=20260825-profile-18";
import { loadCustomFormats, saveCustomFormats } from "./js_storage.js";
import { getAuthHeaders } from "./js_auth_fetch.js";

let initialized = false;
let cachedChannelProfile = null;
let activeUploadTimer = null; 
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

// Track video analysis error state.
// FIX: this used to stay null forever because extractVideoInsights()
// swallowed every failure internally and just returned null, so
// nothing ever assigned to this variable. That made `geminiFailed`
// in renderResults() always falsy, so the app silently fell back to
// generic virality-engine text instead of showing the Gemini-specific
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

        return;

    }

    initialized = true;
    renderUpload(flow);

}

function renderUpload(flow){

    // Invalidate any in-flight analysis before replacing its UI.
    analysisRunId += 1;

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
        const sub = await import("./js_subscription.js?v=20260825-profile-18");
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

    // Store the uploaded video file for insights analysis
    uploadedVideoFile = file;

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

    userAnswers = {
        videoOriginality: null,
        ideaOriginality: null,
        format: null,
        description: null
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
 * Gemini-specific failure state — it just silently fell back to
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
        'missing_api_key': 'The AI video analysis service is not configured. Please contact the administrator to set up the Gemini API key.',
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
                    <h4>Video analysis unavailable</h4>
                    <p>${escapeHtml(errorMessage)}</p>
                </div>
            </div>
            
            <div class="va-results-hero">
                <div>
                    <span class="va-eyebrow">VIRALITY ANALYSIS · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</span>
                    <h3>Limited analysis</h3>
                    <p>AI video analysis is unavailable, but you can still see results based on the context you provided.</p>
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

    // Secondo checkpoint (in più rispetto a startUpload): se la quota è
    // esaurita tra la selezione del file e il click su "Create my report",
    // blocca comunque. La vera guardia resta try_consume_usage sul backend.
    if (await videoAnalysisQuotaBlocked()) {
        renderUpload(flow);
        return;
    }

    const runId = ++analysisRunId;
    const steps = ["Reading video", "Detecting hook", "Detecting on-screen text", "Comparing with previous Shorts", "Reading current trends", "Estimating virality", "Writing report"];
    const viralityStepIndex = steps.indexOf("Estimating virality");

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">BRAWL ANALYTICS ENGINE</span>
            <h3>Building your report<span class="va-loading">...</span></h3>
            <p>We're mapping the signals that shape a great Brawl Stars Short.</p>
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
        "Waiting for all signals…",
        "Still gathering trend data…",
        "The engine is still working…",
        "Almost there — scoring needs every signal…"
    ];

    analysisError = null;

    const insightsPromise = videoFile
        ? extractVideoInsights(videoFile)
            .then(result => {
                if (runId === analysisRunId) {
                    videoInsights = result;
                    console.log("Gemini API: Analysis completed successfully");
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
                    import("./js_subscription.js?v=20260825-profile-18")
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
            if (progressCopy) progressCopy.textContent = "Writing report…";
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

}

function toPercentScore(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(100, numericValue > 1 ? numericValue : numericValue * 100));
}

function mergeInsightItems(primaryItems = [], secondaryItems = [], fallbackItems = []) {
    const seen = new Set();
    const merged = [];

    [primaryItems, secondaryItems, fallbackItems]
        .flat()
        .filter(Boolean)
        .forEach(item => {
            const cleanedItem = String(item).trim();
            if (!cleanedItem) return;
            const lookupKey = cleanedItem.toLowerCase();
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

async function renderResults(flow, videoInsights = null, runId = analysisRunId, trendsAnalysis = null, reportResultOverride = null){

    if (runId !== analysisRunId) return;
    
    // Don't return early - always show full dashboard, just add error banner if Gemini failed.
    // FIX: analysisError is now actually populated on failure (see
    // extractVideoInsights/renderAnalysis above), so this check works.
    const geminiFailed = !videoInsights && !!analysisError;

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
    const usedVideoInsights = !!videoInsights;
    
    const score = useRealData ? result.viralityScore : 72;
    const confidence = useRealData ? result.confidence : 75;
    const viewRange = useRealData ? result.viewRange.formatted : "50K – 200K";
    const scoreCategory = useRealData ? result.scoreCategory.label : "Strong potential";
    const scoreIcon = useRealData ? result.scoreCategory.icon : "↑";
    
    const breakdown = buildBreakdown(result, videoInsights, useRealData);
    
    const strengths = mergeInsightItems(
        videoInsights?.strengths || [],
        useRealData && result.strengths ? result.strengths : [],
        ["Excellent hook", "Trending topic detected", "Strong format for your channel", "Good pacing"]
    );
    
    const weaknesses = mergeInsightItems(
        videoInsights?.weaknesses || [],
        useRealData && result.weaknesses ? result.weaknesses : [],
        ["Ending is slightly too long", "Few text overlays", "Audio could be more dynamic"]
    );
    
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
    
    const summary = useRealData && result.summary ? result.summary : 
        (usedVideoInsights ? "This video shows strong viral potential based on visual analysis, format alignment and trend relevance." : "This video shows strong viral potential based on its format alignment and trend relevance.");
    const actionPlan = useRealData && result.actionPlan ? result.actionPlan : ["Move the first text overlay earlier.", "Reduce the ending by 8 seconds.", "Add subtitles during the middle section.", "Strengthen the first 2 seconds."];

    // Generate error banner HTML if Gemini failed
    const errorBannerHtml = geminiFailed ? `
        <div class="va-error-banner">
            <div class="va-error-icon">⚠️</div>
            <div class="va-error-content">
                <h4>Video analysis unavailable</h4>
                <p>${escapeHtml(getErrorMessage(analysisError))}</p>
            </div>
        </div>
    ` : '';

    flow.innerHTML = `
        <div class="va-results">
            ${errorBannerHtml}
            <div class="va-results-hero"><div><span class="va-eyebrow">${useRealData ? "VIRALITY ANALYSIS" : "SIMULATED REPORT"} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</span><h3>Your Short has <span class="va-emphasis">${escapeHtml(String(scoreCategory).toLowerCase())}</span> viral potential.</h3><p>${escapeHtml(useRealData ? summary : "All values below are demonstrative placeholders, ready to be connected to a real analysis engine later.")}</p></div><button class="va-outline" id="va-restart" type="button">Analyse another video →</button></div>
            <div class="va-score-grid"><article class="va-metric va-score"><span>VIRALITY SCORE</span><strong><b id="va-score-value">0</b><small>/ 100</small></strong><i>${escapeHtml(`${scoreIcon} ${scoreCategory}`)}</i><p>${useRealData ? "Based on originality, trend alignment, format performance, and historical context." : "Strong early signals, format fit and audience relevance."}</p></article><article class="va-metric"><span>CONFIDENCE</span><strong>${escapeHtml(`${confidence}%`)}</strong><i>${useRealData ? (confidence >= 70 ? "High confidence" : confidence >= 40 ? "Moderate confidence" : "Low confidence") : "High confidence"}</i><div class="va-progress"><i style="width:${confidence}%"></i></div><p>${useRealData ? "Based on historical data volume and consistency." : "Based on available simulated signals."}</p></article><article class="va-metric va-views"><span>ESTIMATED VIEWS</span><strong>${escapeHtml(String(viewRange))}</strong><p>This range is an estimate, not a guarantee.</p><div class="va-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article></div>
            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div><p>${useRealData ? "How each factor contributed to your score." : "Where the simulated score comes from."}</p></div>
            <div class="va-breakdown">${breakdown.map(([name,value])=> `<div><p><span>${escapeHtml(String(name))}</span><strong>${value}</strong></p><div class="va-progress"><i style="width:${value}%"></i></div></div>`).join("")}</div>
            <div class="va-insights"><article class="va-insight good"><span>✦</span><h4>Strengths</h4><ul>${strengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></article><article class="va-insight weak"><span>↗</span><h4>Weaknesses</h4><ul>${weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></article>${technicalIssues.length > 0 ? `<article class="va-insight critical"><span>⚙️</span><h4>Technical issues</h4><ul>${technicalIssues.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul></article>` : ''}${criticalIssues.length > 0 ? `<article class="va-insight critical"><span>!</span><h4>Critical issues</h4><ul>${criticalIssues.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul></article>` : ''}</div>
            <section class="va-suggestions"><div><span class="va-step">ACTION PLAN</span><h3>Recommendations</h3><p>${useRealData ? "Based on your analysis results." : "A future engine can make these recommendations unique to every upload."}</p></div><ol>${actionPlan.map((item, index) => `<li><b>0${index + 1}</b> ${escapeHtml(item)}</li>`).join("")}</ol></section>
            <section class="va-channel"><span class="va-channel-mark">B</span><div><span>HISTORICAL CONTEXT</span><h3>How this video compares to your past Shorts.</h3><p>${useRealData && result.predictionContext ? `This video is predicted to perform ${result.predictionContext.comparison.toLowerCase()} compared to your historical content.` : "This video is stronger than <strong>82%</strong> of your previous Shorts and uses a format that historically works well for your channel."}</p></div><strong>${useRealData && result.predictionContext ? `P${result.predictionContext.percentile}` : "+18%"}<small>${useRealData ? "percentile vs<br>your history" : "above your average<br>demo score"}</small></strong></section>
            <div class="va-end-grid"><aside><span>EDUCATIONAL TIP</span><h4 id="va-tip">Trending topics usually perform best within 48 hours.</h4><button id="va-next-tip" type="button">Show another tip →</button></aside><section class="va-faq"><span class="va-step">FAQ</span><h3>A few good questions</h3><details open><summary>Why is this only a prediction? <b>+</b></summary><p>Performance depends on timing, audience behaviour and distribution. A score is a decision aid, not a promise.</p></details><details><summary>How accurate is the score? <b>+</b></summary><p>${useRealData ? "Accuracy depends on your channel's historical data volume and consistency. More data = higher confidence." : "This demo uses placeholder data. The production score can be calibrated against your data."}</p></details><details><summary>How is the Virality Score calculated? <b>+</b></summary><p>${useRealData ? "The score combines originality, trend alignment, format performance, channel history, and competition factors using dynamic weighting." : "A future version can combine video, content, trend and channel signals transparently."}</p></details><details><summary>Can the prediction be wrong? <b>+</b></summary><p>Yes. Use it to spot opportunities and refine your creative process.</p></details></section></div>
        </div>`;

    animateScore(score);
    setupResultActions(flow);

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

function setupResultActions(flow){

    document.getElementById("va-restart").addEventListener("click", ()=> renderUpload(flow));

    const tips = ["Trending topics usually perform best within 48 hours.", "Schedule your Shorts instead of publishing immediately.", "Avoid long static endings.", "Create a visual change in the first second."];
    let index = 0;

    document.getElementById("va-next-tip").addEventListener("click", ()=>{

        index = (index + 1) % tips.length;
        document.getElementById("va-tip").textContent = tips[index];

    });

}

export {

    initVideoAnalysis,
    resetVideoAnalysisState,
    invalidateChannelProfileCache

};
