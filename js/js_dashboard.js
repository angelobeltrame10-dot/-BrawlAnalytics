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


import { generaIdeeConAI } from "./js_api.js";

import { showAnalysis } from "./js_router.js";

import { initFormatsManager, renderFormatCards } from "./js_formats_manager.js";

import { initSubscription, consumeIdeaGeneration } from "./js_subscription.js";

import {

    calculateViralityScore,
    getVideoCount,
    getBestFormat

}
from "./js_analytics.js";


import {

    classifyVideos,
    detectFormat,
    getFormatRanking,
    getTopFormat

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



import {

    saveDashboardData,
    loadDashboardData,
    saveCustomFormats,
    loadCustomFormats,
    saveChannelProfile,
    loadChannelProfile

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

let customFormats = [...loadCustomFormats()];

// ID YouTube: sempre esattamente 11 caratteri alfanumerici (+ "-"/"_").
// Se getVideoTitle() restituisce sistematicamente qualcosa che rispetta
// questo pattern, quasi certamente non è un titolo ma l'ID grezzo che
// YouTube Studio mette nella colonna "Contenuti" quando il CSV non ha
// anche una colonna "Titolo" separata con il testo leggibile.
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function cleanupVideoAssociations(currentVideos) {
    const formats = loadCustomFormats();
    const currentVideoTitles = new Set(currentVideos.map(v => getVideoTitle(v)));
    
    let hasChanges = false;
    
    formats.forEach(format => {
        if (Array.isArray(format.associatedVideos) && format.associatedVideos.length > 0) {
            const originalCount = format.associatedVideos.length;
            // Keep only videos that still exist in the current dataset
            format.associatedVideos = format.associatedVideos.filter(title => currentVideoTitles.has(title));
            
            if (format.associatedVideos.length !== originalCount) {
                hasChanges = true;
                console.log(`Cleaned up ${originalCount - format.associatedVideos.length} removed videos from format "${format.name}"`);
            }
        }
    });
    
    if (hasChanges) {
        saveCustomFormats(formats);
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


function initDashboard(){

    setupUpload();

    setupTabs();

    setupCustomFormats();

    setupIdeaGeneration();

    initFormatsManager();

    /*
        Piano utente + utilizzi odierni: una sola volta
        all'avvio, poi tutto resta in cache nel modulo.
    */
    initSubscription();

    /*
        Recupera dati salvati
    */

    const savedData =
    loadDashboardData();

    if(
    Array.isArray(savedData) &&
    savedData.length > 0
    ){

        dashboardData =
        savedData;

        refreshDashboard();

    }

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

        ideas: document.getElementById("ideas-section")

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
            } else {
                ideaList.style.display = "none";
                ideasBlocked.hidden = false;
                if (generateIdeasBtn) generateIdeasBtn.disabled = true;
            }
        }

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

    const classified =
    classifyVideos(
        dashboardData,
        customFormats
    );

    const ranking =
    getFormatRanking(
        classified,
        customFormats
    );

    // Calculate views per format
    const formatViews = {};
    classified.forEach(video => {
        const format = video.format || "Other";
        if (!formatViews[format]) {
            formatViews[format] = 0;
        }
        formatViews[format] += getVideoViews(video);
    });

    const entries =
    Object.entries(ranking)
    .filter(([name]) => name !== "Other") // Remove "Other" from display
    .sort(
        ([nameA], [nameB]) => {
            // Sort by views in descending order
            const viewsA = formatViews[nameA] || 0;
            const viewsB = formatViews[nameB] || 0;
            return viewsB - viewsA;
        }
    );

    const maxViews =
    entries.length > 0
        ? Math.max(...entries.map(([name]) => formatViews[name] || 0))
        : 1;

    const html = entries.map(
        ([name, count], index)=>{

            const views = formatViews[name] || 0;
            const percentage =
            maxViews > 0
                ? Math.round((views / maxViews) * 100)
                : 0;

            const label =
            index === 0
                ? "best-format"
                : "";

            return `
                <div class="format-row">
                    <div class="format-name ${label}">${name}</div>
                    <div class="bar">
                        <div class="bar-fill" style="width:${percentage}%"></div>
                    </div>
                    <div class="format-value">${formatCompactNumber(views)} views</div>
                </div>`;

        }
    ).join("");

    document.querySelectorAll(
        ".format-list"
    ).forEach(
        list=>{

            list.innerHTML =
            html || `
                <div class="format-row">
                    <div class="format-name">No format data yet</div>
                </div>`;

        }
    );

}


async function renderIdeaCards() {
    const ideaLists = document.querySelectorAll(".idea-list");
    if (!ideaLists.length) return;

    // Svuotiamo la lista e mostriamo uno stato di caricamento temporaneo
    const loadingHtml = `<div class="p-4 text-center">Generazione idee personalizzate con l'AI in corso...</div>`;
    ideaLists.forEach(list => { list.innerHTML = loadingHtml; });

    const videos = getDashboardData();
    const classified = classifyVideos(videos, customFormats);
    const topFormat = getTopFormat(classified, customFormats) || "Gameplay";
    
    // Prendiamo i 5 migliori video per dare contesto all'AI
    const topVideos = videos
        .slice()
        .sort((a, b) => getVideoViews(b) - getVideoViews(a))
        .slice(0, 5);

    // Chiamata all'API del Cloudflare Worker
    let ideeGenerate = [];
    if (videos.length > 0) {
        ideeGenerate = await generaIdeeConAI(topVideos, topFormat);
    }

    let resultHtml;

    // Se l'AI ha restituito delle idee con successo, le usiamo!
    if (ideeGenerate && ideeGenerate.length > 0) {
        resultHtml = ideeGenerate.map((idea, index) => `
            <article class="idea-card fade-up" style="animation-delay: ${index * 0.1}s">
                <div class="idea-header">
                    <span class="idea-tag">${topFormat} Format</span>
                    <span class="idea-score">${90 - index * 3}</span>
                </div>
                <div class="idea-body">
                    ${idea}
                </div>
            </article>
        `).join("");
    } else {
        // FALLBACK: Se l'AI è disattivata o la chiamata fallisce, mostriamo le idee statiche standard
        resultHtml = `
            <article class="idea-card">
                <div class="idea-header">
                    <span class="idea-tag">Trickshot</span>
                    <span class="idea-score">94</span>
                </div>
                <div class="idea-body">
                    Try a double wall-bounce trickshot using Rico on the new Brawl Ball map.
                </div>
            </article>
            <article class="idea-card">
                <div class="idea-header">
                    <span class="idea-tag">Challenge</span>
                    <span class="idea-score">89</span>
                </div>
                <div class="idea-body">
                    Can you win a Solo Showdown match without picking up a single Power Cube?
                </div>
            </article>
            <article class="idea-card">
                <div class="idea-header">
                    <span class="idea-tag">FunnyMoment</span>
                    <span class="idea-score">88</span>
                </div>
                <div class="idea-body">
                    Compile 3 clips where players accidentally super into the poison gas.
                </div>
            </article>
        `;
    }

    ideaLists.forEach(list => { list.innerHTML = resultHtml; });
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


        saveDashboardData(
            dashboardData
        );

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
        customFormats = loadCustomFormats();

        /*
            Pulisci le associazioni video nei formati che non esistono più
            nel nuovo CSV. Questo rimuove automaticamente i video che
            sono stati eliminati dal dataset mantenendo le associazioni
            valide.
        */
        cleanupVideoAssociations(dashboardData);

        /*
            Build and save Channel Profile for Virality Engine
        */
        const channelProfile = buildChannelProfile(dashboardData, customFormats);
        saveChannelProfile(channelProfile);

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

            button.addEventListener("click", () => {

                const index = Number(button.getAttribute("data-remove-format"));
                customFormats.splice(index, 1);
                saveCustomFormats(customFormats);
                renderCustomFormats();
                refreshDashboard();

            });

        });

    };

    renderCustomFormats();

    formatInput.addEventListener("keydown", event => {

        if(event.key === "Enter"){

            event.preventDefault();

            const value = formatInput.value.trim();
            if(!value){

                return;

            }

            const parts = value.split(":");
            const name = parts[0].trim();
            const keywords = (parts[1] || "").split(",").map(item => item.trim()).filter(Boolean);

            if(!name || keywords.length === 0){

                showMessage("Use Name:keyword1,keyword2");

                return;

            }

            customFormats.push({ name, keywords });
            saveCustomFormats(customFormats);
            formatInput.value = "";
            renderCustomFormats();
            refreshDashboard();

        }

    });

}

/*
    Collega il bottone
    "Genera Nuove Idee"
    alla generazione AI
*/

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

        /*
            Verifica E consuma l'utilizzo in un'unica chiamata
            atomica su Supabase. Se il piano Free ha già usato le
            3 generazioni odierne, non parte NESSUNA chiamata AI:
            consumeIdeaGeneration() apre da sola la Upgrade Modal.
        */
        const allowed = await consumeIdeaGeneration();

        if(!allowed){

            return;

        }

        button.disabled = true;

        await renderIdeaCards();

        button.disabled = false;

        showMessage("Ideas updated");

    });

}

async function refreshDashboard(){

    // Rete di sicurezza: qualunque cosa abbia aggiornato i formati
    // personalizzati in storage (analisi AI, creazione/rename manuale
    // da un'altra vista), la dashboard riparte sempre dalla versione
    // più recente invece che da una copia in memoria potenzialmente
    // obsoleta.
    customFormats = loadCustomFormats();

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

    const bestVideo = dashboardData.reduce((best, video) => 
        getVideoViews(video) > getVideoViews(best) ? video : best, dashboardData[0]);
    const bestVideoViewsElement = document.querySelector(".best-video-views");
    if (bestVideoViewsElement && bestVideo) {
        bestVideoViewsElement.textContent = formatCompactNumber(getVideoViews(bestVideo));
    }

    // Calculate growth rate (simple comparison of first half vs second half)
    let growthRate = 0;
    if (dashboardData.length >= 4) {
        const midPoint = Math.floor(dashboardData.length / 2);
        const firstHalfViews = dashboardData.slice(0, midPoint).reduce((sum, v) => sum + getVideoViews(v), 0);
        const secondHalfViews = dashboardData.slice(midPoint).reduce((sum, v) => sum + getVideoViews(v), 0);
        if (firstHalfViews > 0) {
            growthRate = ((secondHalfViews - firstHalfViews) / firstHalfViews) * 100;
        }
    }
    const growthRateElement = document.querySelector(".growth-rate");
    if (growthRateElement) {
        const sign = growthRate >= 0 ? "+" : "";
        growthRateElement.textContent = `${sign}${growthRate.toFixed(1)}%`;
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
    await renderIdeaCards();
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


    const topFormat = getTopFormat(classifyVideos(videos, customFormats), customFormats) || "—";

    const topVideos = videos
        .slice()
        .sort((a, b) => getVideoViews(b) - getVideoViews(a))
        .slice(0, 3)
        .map(video => ({
            title: getVideoTitle(video),
            views: getVideoViews(video),
            format: video.format || detectFormat(video, customFormats)
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