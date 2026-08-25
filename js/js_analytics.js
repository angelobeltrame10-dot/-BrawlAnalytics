/* ==========================================================
   BRAWL ANALYTICS
   ANALYTICS ENGINE

   Responsabilità:
   - Calcolo statistiche video
   - Calcolo Virality Score
   - Analisi performance
   - Collegamento formati

   NON contiene:
   - Modifica HTML
   - Lettura CSV
   - Gestione file

========================================================== */



import { classifyVideosEffective, getTopFormat } from "./js_fomats.js";

import { getVideoViews } from "./js_csv_fields.js";



/*
    Conta numero video analizzati
*/

function getVideoCount(
    videos
){


    return Array.isArray(videos)

    ? videos.length

    : 0;

}



/*
    Converte valore numerico

    Gestisce valori YouTube CSV:

    "10,000"
    "10.000"
    "10"
*/

function parseNumber(
    value
){


    if(!value){

        return 0;

    }



    return Number(

        String(value)

        .replace(
            /,/g,
            ""
        )

        .replace(
            /\./g,
            ""

        )

    ) || 0;


}




/*
    Calcola Virality Score

    Versione iniziale:

    views
    +
    engagement

    In futuro:
    retention
    watch time
    crescita
*/

function calculateViralityScore(
    videos
){



    if(
        !Array.isArray(videos) ||
        videos.length === 0
    ){

        return 0;

    }





    const analyzed =

    videos.map(
        video => {


            const views = getVideoViews(video);



            const likes =

            parseNumber(

                video.likes ||

                video.Likes ||

                video["Likes"]

            );



            const comments =

            parseNumber(

                video.comments ||

                video.Comments ||

                video["Comments"]

            );



            return {

                views,

                likes,

                comments


            };


        }

    );



    const totalViews =

    analyzed.reduce(

        (sum,video)=>

        sum + video.views,

        0

    );





    const totalLikes =

    analyzed.reduce(

        (sum,video)=>

        sum + video.likes,

        0

    );





    const totalComments =

    analyzed.reduce(

        (sum,video)=>

        sum + video.comments,

        0

    );




    const engagement =

    totalLikes +

    (totalComments * 2);




    /*
        Formula iniziale

        Non definitiva.
        Verrà migliorata
        con dati reali.
    */


    let score =

    (

        (totalViews / 1000)

        +

        (engagement / 100)

    );





    score =

    Math.round(
        score
    );





    if(score > 100){

        score = 100;

    }



    return score;


}



/*
    Restituisce formato
    migliore

*/

function getBestFormat(videos, customFormats = []) {
    const classified = classifyVideosEffective(videos, customFormats);
    return getTopFormat(classified, customFormats);
}


/*
    Statistiche generali

    Preparata per dashboard
    avanzata futura
*/

function getAnalyticsSummary(
    videos
){



    return {


        videos:

        getVideoCount(
            videos
        ),



        score:

        calculateViralityScore(
            videos
        ),



        bestFormat:

        getBestFormat(
            videos
        )


    };


}


/* ==========================================================
   VIDEO ANALYSIS DEMO

   UI-only workflow. Every result is simulated intentionally,
   so a real video-analysis engine can replace these values later.
========================================================== */

let videoAnalysisInitialized = false;

const VIDEO_QUESTIONS = [

    ["How original is your video?", ["Completely original", "Mostly original", "Mostly reused"]],
    ["How original is the idea?", ["Completely original", "Inspired by another creator", "Copy of another creator"]],
    ["Which format best describes this video?", ["Trickshot", "Challenge", "Funny Moments", "Ranked", "Guide", "Story", "Meme", "Other"]],
    ["Write a short description of your video.", null]

];

function initVideoAnalysis(){

    const section =
    document.getElementById("video-analysis");

    const flow =
    document.getElementById("va-flow");

    if(!section || !flow){

        return;

    }

    section.hidden = false;

    if(videoAnalysisInitialized){

        return;

    }

    videoAnalysisInitialized = true;

    renderVideoUpload(flow);

}

function renderVideoUpload(flow){

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
                <small>Simulating a secure upload…</small>
            </div>
        </div>`;

    const input =
    document.getElementById("va-video-input");

    const dropzone =
    document.getElementById("va-dropzone");

    input.addEventListener(
        "change",
        event=> startVideoUpload(event.target.files?.[0], flow)
    );

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

    dropzone.addEventListener(
        "drop",
        event=> startVideoUpload(event.dataTransfer.files?.[0], flow)
    );

}

function startVideoUpload(file, flow){

    if(!file){

        return;

    }

    document.getElementById("va-file-name").textContent = file.name;
    document.getElementById("va-dropzone").hidden = true;
    document.getElementById("va-upload-progress").hidden = false;

    let value = 0;

    const timer = setInterval(()=>{

        value = Math.min(100, value + 10 + Math.random() * 12);
        document.getElementById("va-upload-bar").style.width = `${value}%`;
        document.getElementById("va-upload-value").textContent = `${Math.round(value)}%`;

        if(value >= 100){

            clearInterval(timer);
            setTimeout(()=> renderVideoQuestion(flow, 0), 450);

        }

    }, 190);

}

function renderVideoQuestion(flow, index){

    const [title, options] = VIDEO_QUESTIONS[index];
    const dots = VIDEO_QUESTIONS.map((_, dotIndex)=>
        `<i class="${dotIndex <= index ? "active" : ""}"></i>`
    ).join("");

    const answers = options
        ? `<div class="${index === 2 ? "va-formats" : "va-options"}">${options.map(option=> `<button type="button">${option}<span>→</span></button>`).join("")}</div>`
        : `<textarea placeholder="Example: A fast-paced Colt trickshot in Brawl Ball with a surprising finish."></textarea><button class="va-primary" id="va-create-report" type="button">Create my report <span>→</span></button>`;

    flow.innerHTML = `
        <div class="va-card va-wizard-card">
            <div class="va-wizard-top"><span class="va-step">02 — CONTEXT · ${index + 1} OF 4</span><div class="va-dots">${dots}</div></div>
            <div class="va-question"><h3>${title}</h3><p>Quick context lets the future scoring engine personalise this report.</p>${answers}</div>
        </div>`;

    flow.querySelectorAll(".va-options button, .va-formats button")
    .forEach(button=>{

        button.addEventListener("click", ()=>{

            button.classList.add("selected");
            setTimeout(()=> renderVideoQuestion(flow, index + 1), 250);

        });

    });

    document.getElementById("va-create-report")
    ?.addEventListener("click", ()=> renderVideoAnalysis(flow));

}

function renderVideoAnalysis(flow){

    const steps = [
        "Reading video",
        "Detecting hook",
        "Detecting on-screen text",
        "Comparing with previous Shorts",
        "Reading current trends",
        "Estimating virality",
        "Writing report"
    ];

    flow.innerHTML = `
        <div class="va-analysis">
            <div class="va-radar"><i></i></div>
            <span class="va-eyebrow">BRAWL ANALYTICS ENGINE</span>
            <h3>Building your report<span class="va-loading">...</span></h3>
            <p>We’re mapping the signals that shape a great Brawl Stars Short.</p>
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
            setTimeout(()=> renderVideoResults(flow), 500);

        }

    }, 560);

}

function renderVideoResults(flow){

    const breakdown = [["Hook",96],["Trend",91],["Originality",87],["Format",93],["Duration",84],["Editing",89],["Text",78]];

    flow.innerHTML = `
        <div class="va-results">
            <div class="va-results-hero"><div><span class="va-eyebrow">SIMULATED REPORT</span><h3>Your Short has <span class="va-emphasis">strong</span> viral potential.</h3><p>Every value below is demonstrative placeholder data, ready for a future analysis engine.</p></div><button class="va-outline" id="va-restart" type="button">Analyse another video →</button></div>
            <div class="va-score-grid"><article class="va-metric va-score"><span>VIRALITY SCORE</span><strong><b id="va-score-value">0</b><small>/ 100</small></strong><i>↗ High potential</i><p>Strong early signals, format fit and audience relevance.</p></article><article class="va-metric"><span>CONFIDENCE</span><strong>94%</strong><i>High confidence</i><div class="va-progress"><i style="width:94%"></i></div><p>Based on available simulated signals.</p></article><article class="va-metric va-views"><span>ESTIMATED VIEWS</span><strong>120K <b>–</b> 350K</strong><p>This range is an estimate, not a guarantee.</p></article></div>
            <div class="va-section-title"><div><span class="va-step">SIGNAL MAP</span><h3>Score breakdown</h3></div><p>Where the simulated score comes from.</p></div>
            <div class="va-breakdown">${breakdown.map(([name,value])=> `<div><p><span>${name}</span><strong>${value}</strong></p><div class="va-progress"><i style="width:${value}%"></i></div></div>`).join("")}</div>
            <div class="va-insights"><article class="va-insight good"><span>✦</span><h4>Strengths</h4><ul><li>Excellent hook</li><li>Trending topic detected</li><li>Strong format for your channel</li><li>Good pacing</li></ul></article><article class="va-insight weak"><span>↗</span><h4>Weaknesses</h4><ul><li>Ending is slightly too long</li><li>Few text overlays</li><li>Audio could be more dynamic</li></ul></article><article class="va-insight critical"><span>!</span><h4>Critical issues</h4><p>No critical signals found in this demo. This area will flag reused content and weak openings.</p></article></div>
            <section class="va-suggestions"><div><span class="va-step">ACTION PLAN</span><h3>AI-ready suggestions</h3><p>A future engine can make these recommendations unique to every upload.</p></div><ol><li><b>01</b> Move the first text overlay earlier.</li><li><b>02</b> Reduce the ending by 8 seconds.</li><li><b>03</b> Add subtitles during the middle section.</li><li><b>04</b> Strengthen the first 2 seconds.</li></ol></section>
            <section class="va-channel"><span class="va-channel-mark">B</span><div><span>CHANNEL INSIGHTS</span><h3>Built for your audience.</h3><p>This video is better than <strong>82%</strong> of your previous Shorts. It is very similar to your best-performing content and uses a strong format for your audience.</p></div><strong>+18%<small>above your average<br>demo score</small></strong></section>
            <div class="va-end-grid"><aside><span>EDUCATIONAL TIP</span><h4 id="va-tip">Trending topics usually perform best within 48 hours.</h4><button id="va-next-tip" type="button">Show another tip →</button></aside><section class="va-faq"><span class="va-step">FAQ</span><h3>A few good questions</h3><details open><summary>Why is this only a prediction? <b>+</b></summary><p>Performance depends on timing, audience behaviour and distribution. A score is a decision aid, not a promise.</p></details><details><summary>How accurate is the score? <b>+</b></summary><p>This demo uses placeholder data. The production score can be calibrated against your data.</p></details><details><summary>How is the Virality Score calculated? <b>+</b></summary><p>A future version can combine video, content, trend and channel signals transparently.</p></details><details><summary>Can the prediction be wrong? <b>+</b></summary><p>Yes. Use it to spot opportunities and refine your creative process.</p></details></section></div>
        </div>`;

    animateDemoScore();

    document.getElementById("va-restart")
    .addEventListener("click", ()=> renderVideoUpload(flow));

    const tips = ["Trending topics usually perform best within 48 hours.", "Schedule your Shorts instead of publishing immediately.", "Avoid long static endings.", "Create a visual change in the first second."];

    let tipIndex = 0;

    document.getElementById("va-next-tip")
    .addEventListener("click", ()=>{

        tipIndex = (tipIndex + 1) % tips.length;
        document.getElementById("va-tip").textContent = tips[tipIndex];

    });

}

function animateDemoScore(){

    const counter =
    document.getElementById("va-score-value");

    let value = 0;

    const timer = setInterval(()=>{

        value = Math.min(92, value + 2);
        counter.textContent = value;

        if(value === 92){

            clearInterval(timer);

        }

    }, 25);

}









export {

    getVideoCount,

    calculateViralityScore,

    getBestFormat,

    getAnalyticsSummary,

    initVideoAnalysis

};