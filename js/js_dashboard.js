/* ==========================================================
   BRAWL ANALYTICS
   DASHBOARD CONTROLLER

   Responsabilità:
   - Avvio dashboard
   - Gestione upload CSV
   - Coordinamento moduli
   - Gestione stato dati

   NON contiene:
   - Parsing CSV
   - Calcoli analytics
   - Manipolazione UI diretta

========================================================== */



import {

    parseCSV

}
from "./js_csv-parser.js";


import { generaIdeeConAI, generaIdeeSuFormatSingolo } from "./js_api.js";

import { showAnalysis } from "./js_router.js";

import { initFormatsManager, renderFormatCards, getEffectiveAssociatedVideos } from "./js_formats_manager.js";

import { initSubscription, consumeIdeaGeneration } from "./js_subscription.js";

import { initTrends, setupTrendsRefresh, setupTrendsTabNavigation, setupCreatorTrendsRetry } from "./js_trends.js";

import {

    calculateViralityScore,
    getVideoCount,
    getBestFormat

}
from "./js_analytics.js";

import { initHookAnalyzer } from "./js_hook_analyzer.js";

import { initAICoach } from "./js_ai_coach.js";

import { initTitleOptimizer } from "./js_title_optimizer.js";

import {

    classifyVideosEffective,
    getFormatRanking,
    getTopFormat,
    getTopFormats

}
from "./js_fomats.js";



import {

    updateVideoCount,
    updateScore,
    updateBestFormat,
    showMessage

}
from "./js_ui.js";


import {

    initVideoAnalysis

}
from "./js_video_analysis.js";

import { reconcilePredictions } from "./js_learning_engine.js";


import {

    saveDashboardData,
    loadDashboardData,
    saveCustomFormats,
    loadCustomFormats,
    saveChannelProfile,
    loadChannelProfile,
    saveGeneratedIdeas,
    loadGeneratedIdeas

} 
from "./js_storage.js";

import { getVideoTitle, getVideoViews, getVideoRetention } from "./js_csv_fields.js";
import { buildChannelProfile } from "./js_channel_profile.js";


/*
    Stato principale dashboard

    In futuro potrà arrivare da:
    - database
    - account utente
    - cloud storage
*/

let dashboardData = [];

let uploadInitialized = false;

let customFormatsInitialized = false;

let ideaGenerationInitialized = false;

let activeTab = "overview";

let customFormats = [];

// ID YouTube: sempre esattamente 11 caratteri alfanumerici (+ "-"/"_").
// Se getVideoTitle() restituisce sistematicamente qualcosa che rispetta
// questo pattern, quasi certamente non è un titolo ma l'ID grezzo che
// YouTube Studio mette nella colonna "Contenuti" quando il CSV non ha
// anche una colonna "Titolo" separata con il testo leggibile.
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

async function cleanupVideoAssociations(currentVideos) {
    const formats = await loadCustomFormats();
    const currentVideoTitles = new Set(currentVideos.map(v => getVideoTitle(v)));

    let hasChanges = false;

    formats.forEach(format => {
        if (Array.isArray(format.associatedVideos) && format.associatedVideos.length > 0) {
            const originalCount = format.associatedVideos.length;
            format.associatedVideos = format.associatedVideos.filter(title => currentVideoTitles.has(title));

            if (format.associatedVideos.length !== originalCount) {
                hasChanges = true;
            }
        }
    });

    if (hasChanges) {
        await saveCustomFormats(formats);
        customFormats = formats;
    }
}

// Le chiamate AI (rilevamento formati) ora richiedono tempo reale di
// rete: questa guardia impedisce di avviare un secondo upload mentre
// il precedente sta ancora completando l'analisi.
let isUploadingCSV = false;




/*
    Avvio dashboard

    Viene chiamata quando
    app.html viene caricata
*/


async function refreshChannelProfileIfNeeded(){

    if (!Array.isArray(dashboardData) || dashboardData.length === 0) {
        return;
    }

    try {

        customFormats = await loadCustomFormats();
        const channelProfile = await buildChannelProfile(dashboardData, customFormats);
        await saveChannelProfile(channelProfile);

    }
    catch (error) {

        console.error("Dashboard: impossibile aggiornare il channel profile dopo una modifica ai formati.", error);

    }

}

async function initDashboard(){

    setupUpload();
    setupTabs();
    setupCustomFormats();
    setupIdeaGeneration();
    initFormatsManager();
    setupTrendsRefresh();
    setupTrendsTabNavigation();
    setupCreatorTrendsRetry();
    initSubscription();

    window.addEventListener("brawl:formats-changed", async () => {
        await refreshChannelProfileIfNeeded();
        refreshDashboard();
    });

    customFormats = await loadCustomFormats();

    const savedData = await loadDashboardData();

    dashboardData = Array.isArray(savedData) ? savedData : [];

    await refreshDashboard();

}



function setupTabs(){

    const tabs =
    document.querySelectorAll(
        ".app-tab"
    );

    tabs.forEach(
        tab=>{

            tab.addEventListener(
                "click",
                ()=> setActiveTab(
                    tab.dataset.tab
                )
            );

        }
    );

    setActiveTab(
        activeTab
    );

}


function setActiveTab(tab){

    activeTab = tab;

    document.querySelectorAll(
        ".app-tab"
    ).forEach(
        button=>{

            button.classList.toggle(
                "active",
                button.dataset.tab === tab
            );

        }
    );

    const sections = {

        overview: document.getElementById("overview-section"),

        videos: document.getElementById("videos-section") || document.getElementById("video-analysis"),

        formats: document.getElementById("formats-section"),

        ideas: document.getElementById("ideas-section"),

        trends: document.getElementById("trends-section"),

        hook: document.getElementById("hook-section"),

        coach: document.getElementById("coach-section"),

        title: document.getElementById("title-section")

    };

    Object.entries(
        sections
    ).forEach(
        ([key, section])=>{

            if(section){

                section.hidden =
                key !== tab;

            }

        }
    );

    if(tab === "videos"){

        initVideoAnalysis(
            dashboardData.length > 0
        );

        // Toggle blocked state for video analysis
        const videoAnalysis = document.getElementById("video-analysis");
        const videoAnalysisBlocked = document.getElementById("video-analysis-blocked");
        
        if (videoAnalysis && videoAnalysisBlocked) {
            if (dashboardData.length > 0) {
                videoAnalysis.hidden = false;
                videoAnalysisBlocked.hidden = true;
            } else {
                videoAnalysis.hidden = true;
                videoAnalysisBlocked.hidden = false;
            }
        }

    }

    if(tab === "formats"){

        renderFormatCards();

    }

    if(tab === "ideas"){

        // Toggle blocked state for ideas section
        const ideaList = document.querySelector(".idea-list");
        const ideasBlocked = document.getElementById("ideas-blocked");
        const generateIdeasBtn = document.getElementById("generate-ideas-btn");
        
        if (ideaList && ideasBlocked) {
            if (dashboardData.length > 0) {
                ideaList.style.display = "flex";
                ideasBlocked.hidden = true;
                if (generateIdeasBtn) generateIdeasBtn.disabled = false;
                // Populate format filter dropdown
                populateFormatFilter();
            } else {
                ideaList.style.display = "none";
                ideasBlocked.hidden = false;
                if (generateIdeasBtn) generateIdeasBtn.disabled = true;
            }
        }

    }

    if(tab === "trends"){
        initTrends();
    }

    if(tab === "hook"){
        initHookAnalyzer();
    }

    if(tab === "coach"){
        initAICoach();
    }

    if(tab === "title"){
        initTitleOptimizer();
    }

}


function formatCompactNumber(value){

    const amount = Number(value) || 0;

    if(amount >= 1000000){

        return `${(amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 1)}M`;

    }

    if(amount >= 1000){

        return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;

    }

    return `${Math.round(amount)}`;

}


function renderFormatRows(){

    const formatViews = {};
    const formatCounts = {};

    customFormats.forEach(format => {
        const effectiveVideos = getEffectiveAssociatedVideos(format, customFormats, dashboardData);
        const titleSet = new Set(effectiveVideos);

        let sumViews = 0;
        dashboardData.forEach(video => {
            if (titleSet.has(getVideoTitle(video))) {
                sumViews += getVideoViews(video);
            }
        });

        formatViews[format.name] = sumViews;
        formatCounts[format.name] = effectiveVideos.length;
    });

    const entries = Object.entries(formatCounts)
        .filter(([, count]) => count > 0)
        .sort(([nameA], [nameB]) => (formatViews[nameB] || 0) - (formatViews[nameA] || 0));

    if (entries.length === 0) {
        document.querySelectorAll(".format-list").forEach(list => {
            list.innerHTML = `<div class="format-list-empty">No format data yet — upload a CSV or create a format.</div>`;
        });
        return;
    }

    const maxViews = Math.max(...entries.map(([name]) => formatViews[name] || 0), 1);

    const html = entries.map(([name, count], index) => {
        const views = formatViews[name] || 0;
        const percentage = Math.round((views / maxViews) * 100);
        const isBest = index === 0;

        return `
            <div class="format-row ${isBest ? "best-format" : ""}">
                <div class="format-row-rank">${index + 1}</div>
                <div class="format-row-main">
                    <div class="format-row-name">
                        ${name}
                        ${isBest ? `<span class="format-row-badge">Best</span>` : ""}
                    </div>
                    <div class="format-row-bar">
                        <div class="format-row-bar-fill" style="width:${percentage}%"></div>
                    </div>
                </div>
                <div class="format-row-stats">
                    <span class="format-row-views">${formatCompactNumber(views)} views</span>
                    <span class="format-row-count">${count} video${count === 1 ? "" : "s"}</span>
                </div>
            </div>`;
    }).join("");

    document.querySelectorAll(".format-list").forEach(list => {
        list.innerHTML = html;
    });

}


function renderIdeaHtml(ideas, topFormat) {

    if (!ideas || ideas.length === 0) {
        return `<div class="p-4 text-center">No ideas yet — click "Generate New Ideas" to create some.</div>`;
    }

    return ideas.map((idea, index) => `
        <article class="idea-card fade-up" style="animation-delay: ${index * 0.1}s">
            <div class="idea-header">
                <span class="idea-tag">${idea.format || topFormat || "Format"}</span>
                <span class="idea-score">${90 - index * 3}</span>
            </div>
            <div class="idea-body">
                ${idea.text || idea}
            </div>
        </article>
    `).join("");

}

// Chiamata da refreshDashboard()/tab switch: legge SOLO la cache
// (Supabase), MAI l'AI. Risolve il bug del consumo ad ogni refresh/tab.
async function renderIdeasFromCache() {

    const ideaLists = document.querySelectorAll(".idea-list");
    if (!ideaLists.length) return;

    const cached = await loadGeneratedIdeas();

    const html = cached && cached.ideas.length > 0
        ? renderIdeaHtml(cached.ideas, cached.topFormat)
        : renderIdeaHtml([], null);

    ideaLists.forEach(list => { list.innerHTML = html; });

}

// Chiamata SOLO dal click su "Generate New Ideas" (dopo consumeIdeaGeneration).
async function generateIdeasWithAI() {
 
    const ideaLists = document.querySelectorAll(".idea-list");
    if (!ideaLists.length) return;
 
    const loadingHtml = `<div class="p-4 text-center">Generating personalized ideas with AI...</div>`;
    ideaLists.forEach(list => { list.innerHTML = loadingHtml; });
 
    const videos = getDashboardData();
    const classified = classifyVideosEffective(videos, customFormats);
    const topFormats = getTopFormats(classified, customFormats, 3);
    const topFormat = topFormats[0] || "Gameplay";
 
    const topVideos = videos
        .slice()
        .sort((a, b) => getVideoViews(b) - getVideoViews(a))
        .slice(0, 5);
 
    // Leggi il filtro formato selezionato
    const filterSelect = document.getElementById('ideas-format-filter');
    const selectedFormat = filterSelect ? filterSelect.value : 'all';
    
    // Leggi il livello di creatività selezionato (default Medium = 0.7)
    const creativitySlider = document.getElementById('creativity-slider');
    let creativity = 0.7;
    if (creativitySlider) {
        const sliderValue = creativitySlider.value;
        if (sliderValue === 'low') creativity = 0.4;
        else if (sliderValue === 'medium') creativity = 0.7;
        else if (sliderValue === 'high') creativity = 1.0;
    }
 
    let ideeGenerate = [];
    if (videos.length > 0) {
        if (selectedFormat === 'all') {
            // Comportamento default: 1 idea per ciascuno dei top-3 formati
            if (topFormats.length > 0) {
                ideeGenerate = await generaIdeeConAI(topVideos, topFormats);
            }
        } else {
            // Formato specifico selezionato: tutte 3 idee per quel formato
            ideeGenerate = await generaIdeeSuFormatSingolo(topVideos, selectedFormat, creativity);
        }
    }
 
    if (ideeGenerate && ideeGenerate.length > 0) {
 
        await saveGeneratedIdeas(ideeGenerate, selectedFormat === 'all' ? topFormat : selectedFormat);
        ideaLists.forEach(list => { list.innerHTML = renderIdeaHtml(ideeGenerate, selectedFormat === 'all' ? topFormat : selectedFormat); });
 
    } else {
 
        // L'AI non ha restituito nulla di utilizzabile: usiamo un
        // fallback statico, ma — a differenza di prima — lo SALVIAMO
        // comunque. L'utilizzo giornaliero è già stato consumato per
        // questa generazione, quindi lo stato mostrato ora deve
        // rimanere coerente anche dopo un refresh/ritorno sul sito,
        // invece di sparire lasciando "No ideas yet".
        console.warn("generaIdeeConAI ha restituito 0 idee: uso fallback statico (verrà comunque salvato).");
 
        const fallback = [
            { text: "Try a double wall-bounce trickshot using Rico on the new Brawl Ball map.", format: selectedFormat === 'all' ? "Trickshot" : selectedFormat },
            { text: "Can you win a Solo Showdown match without picking up a single Power Cube?", format: selectedFormat === 'all' ? "Challenge" : selectedFormat },
            { text: "Compile 3 clips where players accidentally super into the poison gas.", format: selectedFormat === 'all' ? "Funny Moments" : selectedFormat }
        ];
 
        await saveGeneratedIdeas(fallback, selectedFormat === 'all' ? topFormat || "Mixed" : selectedFormat);
        ideaLists.forEach(list => { list.innerHTML = renderIdeaHtml(fallback, selectedFormat === 'all' ? topFormat || "Mixed" : selectedFormat); });
 
    }
 
}


/*
    Configurazione upload CSV
*/


function setupUpload(){

    const input =
    document.getElementById(
        "csv-input"
    );

    const dropzone =
    document.getElementById(
        "csv-dropzone"
    );

    const uploadAnotherBtn =
    document.getElementById(
        "upload-another-btn"
    );

    const uploadPanel =
    document.getElementById(
        "upload-panel"
    );

    if(
        !input ||
        !dropzone
    ){

        return;

    }

    if(uploadInitialized){

        return;

    }

    /*
        Apertura selettore file
    */

    dropzone.addEventListener(

        "click",

        ()=>{

            input.click();

        }

    );

    /*
        Upload another CSV button
    */

    if(uploadAnotherBtn){
        uploadAnotherBtn.addEventListener(
            "click",
            ()=>{
                input.click();
            }
        );
    }

    /*
        Cambio file selezionato
    */

    input.addEventListener(

        "change",

        event=>{

            const file =

            event.target.files?.[0];

            if(file){

                input.value = "";

                handleCSVUpload(
                    file
                );

            }

        }

    );

    /*
        Drag and drop events
    */

    dropzone.addEventListener(

        "dragover",

        event=>{

            event.preventDefault();

            event.stopPropagation();

            dropzone.classList.add("drag-over");

        }

    );

    dropzone.addEventListener(

        "dragleave",

        event=>{

            event.preventDefault();

            event.stopPropagation();

            dropzone.classList.remove("drag-over");

        }

    );

    dropzone.addEventListener(

        "drop",

        event=>{

            event.preventDefault();

            event.stopPropagation();

            dropzone.classList.remove("drag-over");

            const files = event.dataTransfer?.files;

            console.log("Drop event triggered, files:", files);

            if(files && files.length > 0){

                const file = files[0];

                console.log("Processing file:", file.name, file.type);

                handleCSVUpload(

                    file

                );

            } else {

                console.log("No files found in drop event");

            }

        }

    );

    uploadInitialized = true;

}



/*
    Gestione caricamento CSV

    Punto centrale:
    File
     ↓
    Parser
     ↓
    Analytics
     ↓
    UI
*/

async function handleCSVUpload(file){

    if(isUploadingCSV){

        showMessage(
            "Upload already in progress"
        );

        return;

    }

    isUploadingCSV = true;

    try{

        showMessage(
            "Reading CSV..."
        );



        dashboardData =
        await parseCSV(
            file
        );


        if(
            dashboardData.length === 0
        ){


            showMessage(
                "No data found"
            );


            return;


        }



        console.log(
            "Dashboard data:",
            dashboardData
        );

        /*
            Diagnostica: avvisa SUBITO se il CSV non sembra contenere
            titoli reali (solo ID YouTube grezzi nella colonna usata come
            titolo), invece di lasciare che l'utente lo scopra più tardi
            da un dropdown pieno di stringhe tipo "Z7-_zMJSXxk" o da una
            dashboard AI che non trova mai nessun formato.
        */
        const titleSample = dashboardData.slice(0, 50);
        const idLikeCount = titleSample.filter(
            video => YOUTUBE_ID_PATTERN.test(String(getVideoTitle(video)).trim())
        ).length;

        if (titleSample.length > 0 && idLikeCount / titleSample.length > 0.5) {

            console.warn(
                "Il CSV caricato non sembra contenere titoli reali: la colonna usata come titolo restituisce ID YouTube grezzi, es.:",
                getVideoTitle(titleSample[0]),
                "— verifica se il CSV ha una colonna \"Titolo\" con il testo leggibile del video."
            );

            showMessage("Il CSV non sembra contenere titoli reali (solo ID) — controlla l'export");

        }

        /*
            Salva dati localmente

            In futuro:
            sostituibile con database
        */


        await saveDashboardData(dashboardData);

        /*
            Show analysis screen with AI format detection
        */
        await showAnalysis(dashboardData);

        /*
            L'analisi AI (js_channel_analysis.js) può aver salvato
            nuovi formati personalizzati in storage. La variabile
            customFormats in memoria è stata caricata una sola volta
            all'avvio del modulo, quindi va ricaricata qui: altrimenti
            la dashboard continuerebbe a mostrare/contare i video con
            i formati vecchi, ignorando quelli appena rilevati.
        */
        customFormats = await loadCustomFormats();
        await cleanupVideoAssociations(dashboardData);
        const channelProfile = await buildChannelProfile(dashboardData, customFormats);
        await saveChannelProfile(channelProfile);
        await reconcilePredictions(dashboardData);

        /*
            Aggiorna interfaccia dopo analysis
        */
        refreshDashboard();

        showMessage(
            "Analysis completed"
        );



    }



    catch(error){


        console.error(
            "Dashboard error:",
            error
        );



        showMessage(
            "CSV loading error"
        );


    }

    finally{

        isUploadingCSV = false;

    }


}




/*
    Aggiorna tutta la dashboard

    Coordina:
    dati → analytics → UI
*/

function setupCustomFormats(){

    const formatInput = document.getElementById("custom-format-input");
    const formatList = document.getElementById("custom-format-list");

    if(!formatInput || !formatList){

        return;

    }

    if(customFormatsInitialized){

        return;

    }

    customFormatsInitialized = true;

    const renderCustomFormats = () => {

        const html = customFormats.length > 0
            ? customFormats.map((entry, index) => `
                <div class="ai-chip">
                    <span>${entry.name}</span>
                    <button type="button" data-remove-format="${index}">×</button>
                </div>`).join("")
            : '<div class="ai-empty-state">Add your first custom format</div>';

        formatList.innerHTML = html;

        formatList.querySelectorAll("[data-remove-format]").forEach(button => {

            button.addEventListener("click", async () => {

                const index = Number(button.getAttribute("data-remove-format"));
                customFormats.splice(index, 1);
                await saveCustomFormats(customFormats);
                renderCustomFormats();
                await refreshDashboard();
            });

        });

    };

    renderCustomFormats();

    formatInput.addEventListener("keydown", async event => {

    if(event.key === "Enter"){

        event.preventDefault();

        const value = formatInput.value.trim();
        if(!value) return;

        const parts = value.split(":");
        const name = parts[0].trim();
        const keywords = (parts[1] || "").split(",").map(item => item.trim()).filter(Boolean);

        if(!name || keywords.length === 0){
            showMessage("Use Name:keyword1,keyword2");
            return;
        }

        customFormats.push({ name, keywords });
        await saveCustomFormats(customFormats);
        formatInput.value = "";
        renderCustomFormats();
        await refreshDashboard();

    }

});

}

/*
    Collega il bottone
    "Genera Nuove Idee"
    alla generazione AI
*/

function populateFormatFilter(){
    const filterSelect = document.getElementById('ideas-format-filter');
    if(!filterSelect) return;
    
    // Clear existing options except "All"
    filterSelect.innerHTML = '<option value="all">All formats</option>';
    
    // Add each custom format as an option
    customFormats.forEach(format => {
        if(format && format.name){
            const option = document.createElement('option');
            option.value = format.name;
            option.textContent = format.name;
            filterSelect.appendChild(option);
        }
    });
}

function setupIdeaGeneration(){

    const button = document.getElementById("generate-ideas-btn");

    if(!button){

        return;

    }

    if(ideaGenerationInitialized){

        return;

    }

    ideaGenerationInitialized = true;

    button.addEventListener("click", async ()=>{

    if(dashboardData.length === 0){
        showMessage("Upload a CSV first");
        return;
    }

    const allowed = await consumeIdeaGeneration();

    if(!allowed){
        return;
    }

    button.disabled = true;

    await generateIdeasWithAI();

    button.disabled = false;

    showMessage("Ideas updated");

});

}

function calculateGrowthRate(videos){

    const videosWithDate = videos.filter(v => v["Data pubblicazione"] instanceof Date);
    const pool = videosWithDate.length >= 2 ? videosWithDate : videos;

    if (pool.length < 2) {
        return { rate: null, reason: "insufficient-data" };
    }

    const sorted = videosWithDate.length >= 2
        ? [...videosWithDate].sort((a, b) => a["Data pubblicazione"].getTime() - b["Data pubblicazione"].getTime())
        : pool;

    const midPoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midPoint);
    const secondHalf = sorted.slice(midPoint);

    const avg = arr => arr.length > 0
        ? arr.reduce((sum, v) => sum + getVideoViews(v), 0) / arr.length
        : 0;

    const firstAvg = avg(firstHalf);
    const secondAvg = avg(secondHalf);

    if (firstAvg <= 0) {
        return { rate: null, reason: "no-baseline" };
    }

    const rate = ((secondAvg - firstAvg) / firstAvg) * 100;

    return {
        rate,
        reason: "ok",
        firstAvg: Math.round(firstAvg),
        secondAvg: Math.round(secondAvg),
        usedDates: videosWithDate.length >= 4
    };

}

async function refreshDashboard(){

    // Rete di sicurezza: qualunque cosa abbia aggiornato i formati
    // personalizzati in storage (analisi AI, creazione/rename manuale
    // da un'altra vista), la dashboard riparte sempre dalla versione
    // più recente invece che da una copia in memoria potenzialmente
    // obsoleta.
    customFormats = await loadCustomFormats();

    const count = getVideoCount(dashboardData);
    updateVideoCount(count);

    const score = calculateViralityScore(dashboardData);
    updateScore(score);

    const format = getBestFormat(dashboardData, customFormats);
    updateBestFormat(format);

    const totalViews = dashboardData.reduce(
        (sum, video) => sum + getVideoViews(video),
        0
    );

    const retentionValues = dashboardData.map(video => getVideoRetention(video));

    const averageRetention = retentionValues.length > 0
        ? retentionValues.reduce((sum, value) => sum + value, 0) / retentionValues.length
        : 0;

    const totalViewsElement = document.querySelector(".total-views");
    if (totalViewsElement) {
        totalViewsElement.textContent = formatCompactNumber(totalViews);
    }

    const averageRetentionElement = document.querySelector(".average-retention");
    if (averageRetentionElement) {
        averageRetentionElement.textContent = `${Math.round(averageRetention)}%`;
    }

    // Calculate additional stats
    const avgViewsPerVideo = totalViews / dashboardData.length;
    const avgViewsElement = document.querySelector(".avg-views-per-video");
    if (avgViewsElement) {
        avgViewsElement.textContent = formatCompactNumber(avgViewsPerVideo);
    }

    const bestVideo = dashboardData.length > 0
    ? dashboardData.reduce((best, video) => getVideoViews(video) > getVideoViews(best) ? video : best, dashboardData[0])
    : null;
    const bestVideoViewsElement = document.querySelector(".best-video-views");
    if (bestVideoViewsElement) {
        bestVideoViewsElement.textContent = bestVideo ? formatCompactNumber(getVideoViews(bestVideo)) : "0";
    }

    const growth = calculateGrowthRate(dashboardData);
    const growthRateElement = document.querySelector(".growth-rate");
    const growthLabelElement = document.querySelector(".growth-rate-label");

    if (growthRateElement) {
        if (growth.rate === null) {
            growthRateElement.textContent = "N/A";
            growthRateElement.classList.remove("growth-positive", "growth-negative");
            if (growthLabelElement) growthLabelElement.textContent = "Not enough data yet";
        } else {
            const sign = growth.rate >= 0 ? "+" : "";
            growthRateElement.textContent = `${sign}${growth.rate.toFixed(1)}%`;
            growthRateElement.classList.toggle("growth-positive", growth.rate >= 0);
            growthRateElement.classList.toggle("growth-negative", growth.rate < 0);
            if (growthLabelElement) {
                growthLabelElement.textContent = growth.rate >= 0
                    ? `Avg views per video rising (${growth.firstAvg} → ${growth.secondAvg})`
                    : `Avg views per video falling (${growth.firstAvg} → ${growth.secondAvg})`;
            }
        }
    }

    // Toggle upload UI based on whether data is loaded
    const dropzone = document.getElementById("csv-dropzone");
    const uploadAnotherBtn = document.getElementById("upload-another-btn");
    const uploadPanelTitle = document.querySelector("#upload-panel .panel-title");
    const uploadPanelSubtitle = document.querySelector("#upload-panel .panel-subtitle");
    const progressBar = document.getElementById("upload-progress");

    if (dashboardData.length > 0) {
        // Hide upload box, show upload another button
        if (dropzone) dropzone.style.display = "none";
        if (uploadAnotherBtn) uploadAnotherBtn.style.display = "block";
        if (progressBar) progressBar.parentElement.style.display = "none";
        if (uploadPanelTitle) uploadPanelTitle.textContent = "Data Loaded";
        if (uploadPanelSubtitle) uploadPanelSubtitle.textContent = "Upload a new CSV to replace current data";
    } else {
        // Show upload box, hide upload another button
        if (dropzone) dropzone.style.display = "flex";
        if (uploadAnotherBtn) uploadAnotherBtn.style.display = "none";
        if (progressBar) progressBar.parentElement.style.display = "block";
        if (uploadPanelTitle) uploadPanelTitle.textContent = "Upload your YouTube Studio CSV";
        if (uploadPanelSubtitle) uploadPanelSubtitle.textContent = "Your data stays in your browser.";
    }

    renderFormatRows();
    await renderIdeasFromCache();
    setActiveTab(activeTab);

    if (dashboardData.length > 0) {
        initVideoAnalysis(true);
    } else {
        initVideoAnalysis(false);
    }

}


/*
    Accesso ai dati

    Utile per:
    - grafici
    - AI
    - esportazione
*/

export function getDashboardData(){


    return [...dashboardData];

}


function getAiInsights(){

    const videos = getDashboardData();

    if(!videos.length){
        return {
            summary: "Upload a CSV to unlock AI insights.",
            topFormat: "—",
            topVideos: []
        };
    }

    const classified = classifyVideosEffective(videos, customFormats);
    const topFormat = getTopFormat(classified, customFormats) || "—";

    const topVideos = classified
        .slice()
        .sort((a, b) => getVideoViews(b) - getVideoViews(a))
        .slice(0, 3)
        .map(video => ({
            title: getVideoTitle(video),
            views: getVideoViews(video),
            format: video.format
        }));

    return {
        summary: `Your strongest signal is ${topFormat}.`,
        topFormat,
        topVideos
    };

}


export {

    initDashboard,
    getAiInsights

};