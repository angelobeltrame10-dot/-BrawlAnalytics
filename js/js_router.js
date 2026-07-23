/* ==========================================================
   BRAWL ANALYTICS
   SCREEN ROUTER

   Responsibilities
   - Home/App navigation
   - Lazy loading HTML pages
   - Analysis screen
   - Dashboard startup

========================================================== */

import {
    initDashboard
} from "./js_dashboard.js";

import {
    simulateChannelAnalysis
} from "./js_channel_analysis.js";


let currentScreen = "landing";

let homeLoaded = false;
let appLoaded = false;
let analysisLoaded = false;


/* ==========================================================
   Helpers
========================================================== */

function getScreen(id) {

    return document.getElementById(id);

}

function hideAllScreens() {

    const landing = getScreen("landing-screen");
    const analysis = getScreen("analysis-screen");
    const app = getScreen("app-screen");

    if (landing) landing.hidden = true;
    if (analysis) analysis.hidden = true;
    if (app) app.hidden = true;

}

async function loadHtml(container, path) {

    const response = await fetch(path);

    if (!response.ok) {

        throw new Error(`Unable to load ${path}`);

    }

    container.innerHTML = await response.text();

}


/* ==========================================================
   LANDING
========================================================== */

export async function showLanding() {

    const landing = getScreen("landing-screen");

    if (!landing) {

        return;

    }

    hideAllScreens();

    landing.hidden = false;

    currentScreen = "landing";

    if (homeLoaded) {

        return;

    }

    try {

        await loadHtml(
            landing,
            "../pages/pages_home.html"
        );

        homeLoaded = true;

    }

    catch (error) {

        console.error("Router error:", error);

        landing.innerHTML = `
            <div class="panel">
                Unable to load home page.
            </div>
        `;

    }

}


/* ==========================================================
   DASHBOARD
========================================================== */

export async function showApp() {

    const app = getScreen("app-screen");

    if (!app) {

        return;

    }

    hideAllScreens();

    app.hidden = false;

    currentScreen = "app";

    if (!appLoaded) {

        try {

            await loadHtml(
                app,
                "../pages/pages_app.html"
            );

            appLoaded = true;

        }

        catch (error) {

            console.error("Router error:", error);

            app.innerHTML = `
                <div class="panel">
                    Unable to load application.
                </div>
            `;

            return;

        }

    }

    await initDashboard();

}


/* ==========================================================
   ANALYSIS
========================================================== */

export async function showAnalysis(videoData = []) {

    const analysis = getScreen("analysis-screen");

    if (!analysis) {

        return;

    }

    hideAllScreens();

    analysis.hidden = false;

    currentScreen = "analysis";

    if (!analysisLoaded) {

        try {

            await loadHtml(
                analysis,
                "../pages/pages_analyzing.html"
            );

            analysisLoaded = true;

        }

        catch (error) {

            console.error("Router error:", error);

            analysis.innerHTML = `
                <div class="panel">
                    Unable to load analysis page.
                </div>
            `;

            return;

        }

    }

    try {

        await simulateChannelAnalysis(videoData);

    }

    catch (error) {

        console.error("Channel analysis error:", error);

    }

    analysis.hidden = true;

    await showApp();

}


/* ==========================================================
   Current Screen
========================================================== */

export function getCurrentScreen() {

    return currentScreen;

}