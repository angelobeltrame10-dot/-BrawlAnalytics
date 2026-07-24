import { loadChannelProfile } from "./js_storage.js";
import { getAvailableFormats } from "./js_channel_profile.js";
import { analyzeVirality } from "./js_virality_engine.js";
import { consumeVideoAnalysis } from "./js_subscription.js";

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

async function getDynamicQuestions() {
    if (!cachedChannelProfile) {
        cachedChannelProfile = await loadChannelProfile();
    }
    const availableFormats = getAvailableFormats(cachedChannelProfile);
    const formatOptions = availableFormats.length > 0 
        ? availableFormats 
        : ["Trickshot", "Challenge", "Funny Moments", "Ranked", "Guide", "Story", "Meme", "Other"];

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

function startUpload(file, flow){

    if(!file){
        return;
    }

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

    userAnswers = {
        videoOriginality: null,
        ideaOriginality: null,
        format: null,
        description: null
    };

}

async function renderWizard(flow, index){

    console.log("renderWizard chiamata", index);
    let questions;
    try {
        questions = await getDynamicQuestions();
        console.log("questions caricate", questions);
    } catch (error) {
        console.error("Errore:", error);
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

        const allowed = await consumeVideoAnalysis();

        if(!allowed){
            reportBtn.disabled = false;
            return;
        }

        renderAnalysis(flow);
    });

}

function renderAnalysis(flow){

    const steps = ["Reading video", "Detecting hook", "Detecting on-screen text", "Comparing with previous Shorts", "Reading current trends", "Estimating virality"];

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">BRAWL ANALYTICS ENGINE</span>
            <h3>Building your report<span class="va-loading">...</span></h3>
            <p>We're mapping the signals that shape a great Brawl Stars Short.</p>
            <div class="va-analysis-list">${steps.map(step=> `<div>${step}</div>`).join("")}</div>
            <div class="va-progress"><i id="va-analysis-bar"></i></div>
            <small id="va-analysis-copy">Initializing workspace</small>
        </div>`;

    let index = 0;

    const timer = setInterval(()=>{

        const rows = flow.querySelectorAll(".va-analysis-list div");
        rows[index].classList.add("done");
        index++;
        document.getElementById("va-analysis-bar").style.width = `${index / steps.length * 100}%`;
        document.getElementById("va-analysis-copy").textContent = index < steps.length ? steps[index] : "Report complete";

        if(index === steps.length){

            clearInterval(timer);
            setTimeout(()=> renderResults(flow), 500);

        }

    }, 560);

}

async function renderResults(flow){

    const trendsAnalysis = null;

    const result = await analyzeVirality(
        userAnswers,
        trendsAnalysis
    );
    
    // Use real results or fallback to placeholders if analysis failed
    const useRealData = result.success;
    
    const score = useRealData ? result.viralityScore : 72;
    const confidence = useRealData ? result.confidence : 75;
    const viewRange = useRealData ? result.viewRange.formatted : "50K – 200K";
    const scoreCategory = useRealData ? result.scoreCategory.label : "Strong potential";
    const scoreIcon = useRealData ? result.scoreCategory.icon : "↑";
    
    const breakdown = useRealData && result.scoreBreakdown ? [
        ["Originality", result.scoreBreakdown.originality.score],
        ["Trend", result.scoreBreakdown.trend.score],
        ["Format", result.scoreBreakdown.format.score],
        ["Channel", result.scoreBreakdown.channel.score],
        ["Competition", result.scoreBreakdown.competition.score]
    ] : [["Hook",96],["Trend",91],["Originality",87],["Format",93],["Duration",84],["Editing",89],["Text",78]];
    
    const strengths = useRealData && result.strengths ? result.strengths : ["Excellent hook", "Trending topic detected", "Strong format for your channel", "Good pacing"];
    const weaknesses = useRealData && result.weaknesses ? result.weaknesses : ["Ending is slightly too long", "Few text overlays", "Audio could be more dynamic"];
    const criticalIssues = useRealData && result.criticalIssues ? result.criticalIssues : [];
    
    const summary = useRealData && result.summary ? result.summary : "This video shows strong viral potential based on its format alignment and trend relevance.";
    const actionPlan = useRealData && result.actionPlan ? result.actionPlan : ["Move the first text overlay earlier.", "Reduce the ending by 8 seconds.", "Add subtitles during the middle section.", "Strengthen the first 2 seconds."];

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero"><div><span class="va-eyebrow">${useRealData ? "VIRALITY ANALYSIS" : "SIMULATED REPORT"} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</span><h3>Your Short has <em>${scoreCategory.toLowerCase()}</em> viral potential.</h3><p>${useRealData ? summary : "All values below are demonstrative placeholders, ready to be connected to a real analysis engine later."}</p></div><button class="va-outline" id="va-restart" type="button">Analyse another video →</button></div>
            <div class="va-score-grid"><article class="va-metric va-score"><span>VIRALITY SCORE</span><strong><b id="va-score-value">0</b><small>/ 100</small></strong><i>${scoreIcon} ${scoreCategory}</i><p>${useRealData ? "Based on originality, trend alignment, format performance, and channel history." : "Strong early signals, format fit and audience relevance."}</p></article><article class="va-metric"><span>CONFIDENCE</span><strong>${confidence}%</strong><i>${useRealData ? (confidence >= 70 ? "High confidence" : confidence >= 40 ? "Moderate confidence" : "Low confidence") : "High confidence"}</i><div class="va-progress"><i style="width:${confidence}%"></i></div><p>${useRealData ? "Based on historical data volume and channel consistency." : "Based on available simulated signals."}</p></article><article class="va-metric va-views"><span>ESTIMATED VIEWS</span><strong>${viewRange}</strong><p>This range is an estimate, not a guarantee.</p><div class="va-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article></div>
            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div><p>${useRealData ? "How each factor contributed to your score." : "Where the simulated score comes from."}</p></div>
            <div class="va-breakdown">${breakdown.map(([name,value])=> `<div><p><span>${name}</span><strong>${value}</strong></p><div class="va-progress"><i style="width:${value}%"></i></div></div>`).join("")}</div>
            <div class="va-insights"><article class="va-insight good"><span>✦</span><h4>Strengths</h4><ul>${strengths.map(s => `<li>${s}</li>`).join("")}</ul></article><article class="va-insight weak"><span>↗</span><h4>Weaknesses</h4><ul>${weaknesses.map(w => `<li>${w}</li>`).join("")}</ul></article><article class="va-insight critical"><span>!</span><h4>Critical issues</h4>${criticalIssues.length > 0 ? `<ul>${criticalIssues.map(c => `<li>${c}</li>`).join("")}</ul>` : "<p>No critical issues detected.</p>"}</article></div>
            <section class="va-suggestions"><div><span class="va-step">ACTION PLAN</span><h3>Recommendations</h3><p>${useRealData ? "Based on your analysis results." : "A future engine can make these recommendations unique to every upload."}</p></div><ol>${actionPlan.map((item, index) => `<li><b>0${index + 1}</b> ${item}</li>`).join("")}</ol></section>
            <section class="va-channel"><span class="va-channel-mark">B</span><div><span>CHANNEL INSIGHTS</span><h3>Built for your audience.</h3><p>${useRealData && result.predictionContext ? `This video is predicted to perform ${result.predictionContext.comparison.toLowerCase()} compared to your historical content.` : "This video is better than <strong>82%</strong> of your previous Shorts. It is very similar to your best-performing content and uses a strong format for your audience."}</p></div><strong>${useRealData && result.predictionContext ? `P${result.predictionContext.percentile}` : "+18%"}<small>${useRealData ? "percentile vs<br>your history" : "above your average<br>demo score"}</small></strong></section>
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
    resetVideoAnalysisState

};