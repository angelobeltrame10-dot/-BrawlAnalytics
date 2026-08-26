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


import { generaIdeeConAI, generaIdeeSuFormatSingolo } from "./js_api.js?v=20260825-profile-18";

import { showAnalysis } from "./js_router.js?v=20260826-router-fix";

import { initFormatsManager, renderFormatCards, getEffectiveAssociatedVideos } from "./js_formats_manager.js?v=20260825-profile-18";

import { initSubscription } from "./js_subscription.js?v=20260825-profile-18";

import { initTrends, setupTrendsRefresh, setupTrendsTabNavigation, setupCreatorTrendsRetry, escapeHtml } from "./js_trends.js";

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
from "./js_video_analysis.js?v=20260825-profile-18";

import { reconcilePredictions, loadPredictionHistory } from "./js_learning_engine.js?v=20260825-1";


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
import { getSupabaseClient } from "./js_supabase_client.js";


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

let dashboardInitialized = false;

const CSV_EMPTY_STATES = {
    formats: {
        icon: "📊",
        title: "Your format map starts with your CSV",
        body: "Upload a Lifetime YouTube Studio CSV first so we can detect your formats and compare them with real channel performance.",
        cta: "Upload CSV to unlock Formats"
    },
    ideas: {
        icon: "💡",
        title: "Your next ideas need your channel context",
        body: "Upload a Lifetime YouTube Studio CSV first so the Idea Generator can build original suggestions around the formats and performance patterns that are yours.",
        cta: "Upload CSV to unlock ideas"
    },
    videos: {
        icon: "🎬",
        title: "Video Analysis starts with your channel history",
        body: "Upload a Lifetime YouTube Studio CSV first so this report can compare your video with your own formats, retention and past Shorts.",
        cta: "Upload CSV to unlock Video Analysis"
    },
    hook: {
        icon: "🪝",
        title: "Give your hook a channel baseline",
        body: "Upload a Lifetime YouTube Studio CSV first so hook feedback can be grounded in the audience and formats that already work for you. Pro access is still required for this tool.",
        cta: "Upload CSV to continue"
    },
    coach: {
        icon: "🧭",
        title: "Your coach needs your channel history",
        body: "Upload a Lifetime YouTube Studio CSV first so the Personal AI Coach can give advice based on your real publishing patterns. Pro access is still required for this tool.",
        cta: "Upload CSV to continue"
    },
    title: {
        icon: "✍️",
        title: "Title advice starts with your history",
        body: "Upload a Lifetime YouTube Studio CSV first so title recommendations can use your formats, audience response and historical performance. Pro access is still required for this tool.",
        cta: "Upload CSV to continue"
    }
};

let csvEmptyStateNavigationInitialized = false;
let onboardingChecklistInitialized = false;
let onboardingDismissalLoaded = false;
let onboardingDismissedAt = null;
let onboardingUserId = null;
const ONBOARDING_VIDEO_THRESHOLD = 10;
const ONBOARDING_REAPPEAR_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const ONBOARDING_STORAGE_PREFIX = "brawl-onboarding-dismissed:";

function renderCsvRequiredState(target, stateKey) {
    if (!target) return;
    const state = CSV_EMPTY_STATES[stateKey];
    if (!state) return;

    target.innerHTML = `
        <div class="csv-empty-state">
            <div class="csv-empty-icon" aria-hidden="true">${state.icon}</div>
            <span class="csv-empty-eyebrow">CHANNEL CONTEXT REQUIRED</span>
            <h3>${escapeHtml(state.title)}</h3>
            <p>${escapeHtml(state.body)}</p>
            <button type="button" class="csv-empty-cta" data-go-upload>${escapeHtml(state.cta)} →</button>
        </div>`;
}

function setupCsvEmptyStateNavigation() {
    if (csvEmptyStateNavigationInitialized) return;
    csvEmptyStateNavigationInitialized = true;

    document.addEventListener("click", event => {
        const button = event.target.closest("[data-go-upload]");
        if (!button) return;

        event.preventDefault();
        setActiveTab(button.dataset.onboardingTab || "overview");
        const targetId = button.dataset.onboardingTarget || "upload-panel";
        window.requestAnimationFrame(() => {
            document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    });
}

function getOnboardingStorageKey(userId = onboardingUserId) {
    return `${ONBOARDING_STORAGE_PREFIX}${userId || "anonymous"}`;
}

async function loadOnboardingDismissal() {
    if (onboardingDismissalLoaded) return onboardingDismissedAt;

    try {
        const supabase = await getSupabaseClient();
        // getSession() legge la sessione da localStorage senza chiamate di
        // rete (getUser() fallisce offline con ERR_INTERNET_DISCONNECTED).
        let user = null;
        if (supabase) {
            const { data: sessionData } = await supabase.auth.getSession();
            user = sessionData?.session?.user || null;
        }
        onboardingUserId = user?.id || null;

        if (supabase && onboardingUserId) {
            const { data, error } = await supabase
                .from("profiles")
                .select("onboarding_checklist_dismissed_at")
                .eq("id", onboardingUserId)
                .maybeSingle();

            if (!error) {
                onboardingDismissedAt = data?.onboarding_checklist_dismissed_at || null;
                onboardingDismissalLoaded = true;
                if (onboardingDismissedAt) {
                    localStorage.setItem(getOnboardingStorageKey(), onboardingDismissedAt);
                } else {
                    localStorage.removeItem(getOnboardingStorageKey());
                }
                return onboardingDismissedAt;
            }
        }
    } catch (error) {
        console.warn("Dashboard: onboarding dismissal could not be loaded from the account.", error);
    }

    onboardingDismissedAt = localStorage.getItem(getOnboardingStorageKey());
    onboardingDismissalLoaded = true;
    return onboardingDismissedAt;
}

async function persistOnboardingDismissal() {
    const timestamp = new Date().toISOString();
    onboardingDismissedAt = timestamp;
    localStorage.setItem(getOnboardingStorageKey(), timestamp);

    try {
        const supabase = await getSupabaseClient();
        if (!supabase || !onboardingUserId) return false;

        const { error } = await supabase
            .from("profiles")
            .update({ onboarding_checklist_dismissed_at: timestamp })
            .eq("id", onboardingUserId);

        if (error) {
            console.warn("Dashboard: account onboarding dismissal was not saved.", error);
            return false;
        }
        return true;
    } catch (error) {
        console.warn("Dashboard: onboarding dismissal could not be persisted.", error);
        return false;
    }
}

async function renderOnboardingChecklist() {
    const panel = document.getElementById("onboarding-checklist");
    if (!panel) return;

    const channelProfile = await loadChannelProfile();
    const profileCount = Number(channelProfile?.totalVideos);
    const totalVideos = Number.isFinite(profileCount) ? profileCount : dashboardData.length;

    if (totalVideos >= ONBOARDING_VIDEO_THRESHOLD) {
        panel.hidden = true;
        return;
    }

    const dismissedAt = await loadOnboardingDismissal();
    const dismissedTime = dismissedAt ? new Date(dismissedAt).getTime() : NaN;
    const recentlyDismissed = Number.isFinite(dismissedTime)
        && Date.now() - dismissedTime < ONBOARDING_REAPPEAR_AFTER_MS;

    panel.hidden = recentlyDismissed;
}

function setupOnboardingChecklist() {
    if (onboardingChecklistInitialized) return;
    const panel = document.getElementById("onboarding-checklist");
    if (!panel) return;

    onboardingChecklistInitialized = true;
    panel.addEventListener("click", event => {
        const dismissButton = event.target.closest("#onboarding-dismiss");
        if (!dismissButton) return;
        panel.hidden = true;
        persistOnboardingDismissal();
    });
}

async function initDashboard(){

    if (!dashboardInitialized) {
        dashboardInitialized = true;
        setupUpload();
        setupTabs();
        setupCsvEmptyStateNavigation();
        setupOnboardingChecklist();
        setupCustomFormats();
        setupIdeaGeneration();
        initFormatsManager();
        setupTrendsRefresh();
        setupTrendsTabNavigation();
        setupCreatorTrendsRetry();

        window.addEventListener("brawl:formats-changed", async () => {
            await refreshChannelProfileIfNeeded();
            refreshDashboard();
        });
    }

    initSubscription();
    customFormats = await loadCustomFormats();
    const savedData = await loadDashboardData();
    dashboardData = Array.isArray(savedData) ? savedData : [];
    await refreshDashboard();
}



function setupTabs(){

    const appScreen = document.querySelector(".app-screen");
    const appTabs = document.querySelector(".app-tabs");
    let dashboardMenuButton = document.getElementById("dashboard-menu-button");
    let dashboardMenuBackdrop = document.getElementById("dashboard-menu-backdrop");

    if (appScreen && appTabs && !dashboardMenuButton) {
        dashboardMenuButton = document.createElement("button");
        dashboardMenuButton.type = "button";
        dashboardMenuButton.id = "dashboard-menu-button";
        dashboardMenuButton.className = "dashboard-menu-button";
        dashboardMenuButton.setAttribute("aria-label", "open dashboard sections");
        dashboardMenuButton.setAttribute("aria-expanded", "false");
        dashboardMenuButton.innerHTML = "<span></span><span></span><span></span>";
        appScreen.insertBefore(dashboardMenuButton, appTabs);

        const dashboardMenuClose = document.createElement("button");
        dashboardMenuClose.type = "button";
        dashboardMenuClose.className = "dashboard-menu-close";
        dashboardMenuClose.setAttribute("aria-label", "close dashboard sections");
        dashboardMenuClose.textContent = "×";
        appTabs.insertBefore(dashboardMenuClose, appTabs.firstChild);

        dashboardMenuBackdrop = document.createElement("div");
        dashboardMenuBackdrop.id = "dashboard-menu-backdrop";
        dashboardMenuBackdrop.className = "dashboard-menu-backdrop";
        appScreen.insertBefore(dashboardMenuBackdrop, appTabs.nextSibling);

        const closeDashboardMenu = () => {
            appTabs.classList.remove("dashboard-tabs-open");
            dashboardMenuBackdrop.classList.remove("open");
            dashboardMenuButton.setAttribute("aria-expanded", "false");
            document.body.classList.remove("dashboard-menu-open");
        };

        const openDashboardMenu = () => {
            appTabs.classList.add("dashboard-tabs-open");
            dashboardMenuBackdrop.classList.add("open");
            dashboardMenuButton.setAttribute("aria-expanded", "true");
            document.body.classList.add("dashboard-menu-open");
        };

        dashboardMenuButton.addEventListener("click", () => {
            if (appTabs.classList.contains("dashboard-tabs-open")) closeDashboardMenu();
            else openDashboardMenu();
        });
        dashboardMenuClose.addEventListener("click", closeDashboardMenu);
        dashboardMenuBackdrop.addEventListener("click", closeDashboardMenu);
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") closeDashboardMenu();
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 780) closeDashboardMenu();
        });

        appTabs.querySelectorAll(".app-tab").forEach(tab => {
            tab.addEventListener("click", closeDashboardMenu);
        });
    }

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

    // On mobile, scroll to the top of the dashboard when switching sections
    if(window.innerWidth <= 780){
        const appScreen = document.querySelector('.app-screen');
        if(appScreen){
            appScreen.scrollIntoView({behavior:'smooth', block:'start'});
        }
    }

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

        const videoAnalysis = document.getElementById("video-analysis");
        const videoAnalysisBlocked = document.getElementById("video-analysis-blocked");
        
        if (dashboardData.length > 0) {
            initVideoAnalysis(true);
            if (videoAnalysis) videoAnalysis.hidden = false;
            if (videoAnalysisBlocked) videoAnalysisBlocked.hidden = true;
        } else {
            if (videoAnalysis) videoAnalysis.hidden = true;
            if (videoAnalysisBlocked) {
                videoAnalysisBlocked.hidden = false;
                renderCsvRequiredState(videoAnalysisBlocked, "videos");
            }
        }

    }

    if(tab === "formats"){

        const formatsContainer = document.getElementById("formats-container");
        if (dashboardData.length > 0) {
            renderFormatCards();
        } else {
            renderCsvRequiredState(formatsContainer, "formats");
        }

    }

    if(tab === "ideas"){

        const ideaList = document.querySelector(".idea-list");
        const ideasBlocked = document.getElementById("ideas-blocked");
        const generateIdeasBtn = document.getElementById("generate-ideas-btn");
        
        if (ideaList && ideasBlocked) {
            if (dashboardData.length > 0) {
                ideaList.style.display = "flex";
                ideasBlocked.hidden = true;
                if (generateIdeasBtn) generateIdeasBtn.disabled = false;
                populateFormatFilter();
            } else {
                ideaList.style.display = "none";
                ideasBlocked.hidden = false;
                if (generateIdeasBtn) generateIdeasBtn.disabled = true;
                renderCsvRequiredState(ideasBlocked, "ideas");
            }
        }

    }

    if(tab === "trends"){
        initTrends();
    }

    if(tab === "hook"){
        if (dashboardData.length > 0) {
            initHookAnalyzer();
        } else {
            renderCsvRequiredState(document.getElementById("hook-flow"), "hook");
        }
    }

    if(tab === "coach"){
        if (dashboardData.length > 0) {
            initAICoach();
        } else {
            renderCsvRequiredState(document.getElementById("coach-flow"), "coach");
        }
    }

    if(tab === "title"){
        if (dashboardData.length > 0) {
            initTitleOptimizer();
        } else {
            renderCsvRequiredState(document.getElementById("title-optimizer-flow"), "title");
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
                        ${escapeHtml(name)}
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
                <span class="idea-tag">${escapeHtml(idea.format || topFormat || "Format")}</span>
                <span class="idea-score">${90 - index * 3}</span>
            </div>
            <div class="idea-body">
                ${escapeHtml(idea.text || idea)}
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

// Chiamata SOLO dal click su "Generate New Ideas".
// Ritorna true se la generazione è stata bloccata dalla quota giornaliera
// (così il chiamante può sopprimere il toast "Ideas updated"), false altrimenti.
async function generateIdeasWithAI() {
 
    const ideaLists = document.querySelectorAll(".idea-list");
    if (!ideaLists.length) return false;
 
    // Pre-check rapido lato client (stato sincronizzato da get_usage_status):
    // se la quota giornaliera per le idee è già a 0, apri subito il modale
    // upgrade invece di avviare una generazione che il server rifiuterebbe.
    try {
        const sub = await import("./js_subscription.js?v=20260825-profile-18");
        if (!sub.isProPlan(sub.getCurrentPlan()) && sub.getRemainingIdeaGenerations() <= 0) {
            sub.openUpgradeModal();
            // Non svuotare la lista: lascia visibili le ultime idee generate
            // (rilette dallo storage) invece di "No ideas yet".
            await renderIdeasFromCache();
            showMessage("Daily idea limit reached. Upgrade to keep generating.");
            return true;
        }
    } catch (err) {
        console.warn("Ideas subscription precheck failed, continuing:", err);
    }
 
    const IDEA_GEAR_PATH = "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z";
    const loadingHtml = `
        <div class="idea-generating" role="status" aria-live="polite">
            <div class="idea-generating__gears" aria-hidden="true">
                <svg class="idea-gear idea-gear--big" viewBox="0 0 24 24"><path d="${IDEA_GEAR_PATH}"/></svg>
                <svg class="idea-gear idea-gear--small" viewBox="0 0 24 24"><path d="${IDEA_GEAR_PATH}"/></svg>
            </div>
            <p>generating your ideas…</p>
        </div>`;
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
    let quotaExhausted = false;
    if (videos.length > 0) {
        try {
            if (selectedFormat === 'all') {
                // Comportamento default: 1 idea per ciascuno dei top-3 formati
                if (topFormats.length > 0) {
                    ideeGenerate = await generaIdeeConAI(topVideos, topFormats);
                }
            } else {
                // Formato specifico selezionato: tutte 3 idee per quel formato
                ideeGenerate = await generaIdeeSuFormatSingolo(topVideos, selectedFormat, creativity);
            }
        } catch (error) {
            if (error?.code === "usage_limit") {
                // Quota giornaliera esaurita: apri il modale upgrade e mostra lo
                // stato reale, invece di ingannare l'utente con idee fasulle.
                quotaExhausted = true;
                console.warn("Ideas: quota giornaliera esaurita.", error.message);
                const { openUpgradeModal } = await import("./js_subscription.js?v=20260825-profile-18");
                openUpgradeModal();
                showMessage("Daily idea limit reached. Upgrade to keep generating.");
                // Niente idee fasulle e niente "No ideas yet": ripristina le
                // ultime idee generate (lettura dallo storage) al posto del
                // segnaposto "generating…" che abbiamo appena mostrato.
                await renderIdeasFromCache();
            } else {
                // Altri errori AI: comportamento legacy — logga e lascia
                // ideeGenerate vuoto, così si scende al fallback statico.
                console.error("Ideas: generazione fallita.", error);
            }
        }
    }
 
    if (quotaExhausted) {
        return true;
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
                    <span>${escapeHtml(entry.name)}</span>
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

    button.disabled = true;

    // generateIdeasWithAI() ritorna true quando la generazione è stata
    // bloccata dalla quota giornaliera: in quel caso NON mostriamo il toast
    // "Ideas updated", già sostituito dal messaggio di limite raggiunto.
    const blockedByQuota = await generateIdeasWithAI();

    button.disabled = false;

    if(!blockedByQuota){
        showMessage("Ideas updated");
    }

});

}

function formatHistoryViews(value){
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? formatCompactNumber(numeric) : "—";
}

async function renderPredictionHistory(){
    const list = document.getElementById("prediction-history-list");
    const status = document.getElementById("prediction-history-status");
    if (!list) return;
    const history = await loadPredictionHistory(8);
    if (!history.length) {
        list.innerHTML = '<div class="history-empty">No predictions logged yet.</div>';
        if (status) status.textContent = "no data yet";
        return;
    }
    list.innerHTML = history.map(item => {
        const title = escapeHtml(item.video_title || "Untitled prediction");
        const format = escapeHtml(item.format || "—");
        const score = Number.isFinite(Number(item.virality_score)) ? Math.round(Number(item.virality_score)) : "—";
        const baseline = formatHistoryViews(item.predicted_baseline);
        const actual = item.resolved ? formatHistoryViews(item.actual_views) : "pending";
        const date = item.created_at ? new Date(item.created_at).toLocaleDateString() : "—";
        const state = item.resolved ? "resolved" : "waiting for a new CSV";
        return `<article class="prediction-history-row">
            <div class="prediction-history-main"><strong>${title}</strong><span>${format} · ${date}</span></div>
            <div class="prediction-history-metric"><small>score</small><b>${score}</b></div>
            <div class="prediction-history-metric"><small>forecast</small><b>${baseline}</b></div>
            <div class="prediction-history-metric"><small>actual</small><b>${actual}</b></div>
            <span class="prediction-history-state ${item.resolved ? "is-resolved" : ""}">${state}</span>
        </article>`;
    }).join("");
    if (status) status.textContent = `${history.length} recent`;
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
    await renderPredictionHistory();
    await renderIdeasFromCache();
    await renderOnboardingChecklist();
    setActiveTab(activeTab);

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
