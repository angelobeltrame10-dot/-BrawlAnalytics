/* ==========================================================
   BRAWL ANALYTICS
   NAVIGATION CONTROLLER

   Responsabilità:
   - Gestione navbar
   - Cambio link visibili
   - Collegamento Home/App

   Login/Signup/Logout non sono più gestiti qui: il click sui
   bottoni (#nav-login, #nav-signup, #nav-logout) e lo stato
   Avatar/Email sono interamente responsabilità di js_auth.js.
   Qui reagiamo solo al RISULTATO (eventi "brawl:login-success"
   e "brawl:logout") per decidere quale schermata mostrare.
========================================================== */

import {

    showLanding,
    showApp

}
from "./js_router.js?v=20260826-router-fix";

import {

    openAuthModal,
    isLoggedIn

}
from "./js_auth.js?v=20260825-profile-18";

import { resetVideoAnalysisState } from "./js_video_analysis.js?v=20260825-profile-18";

import { getCurrentPlan, isProPlan, openUpgradeModal } from "./js_subscription.js?v=20260825-profile-18";

function initNavigation(){

    const navbar =

    document.getElementById(
        "navbar"
    );

    if(!navbar){

        return;

    }

    navbar.innerHTML = `

    <div class="navbar__inner">

        <a
            href="#"
            class="logo"
            id="nav-logo"
        >

                <img src="assets/favicon.svg" alt="Brawl Analytics logo" width="32" height="32">

            <span class="logo__text">
                Brawl<strong>Analytics</strong>
            </span>

        </a>

        <nav class="navlinks">

            <a href="#" id="nav-home" class="nav-home-top">Home</a>

            <a href="#dashboard" id="nav-dashboard">Dashboard</a>

            <a href="#faq" id="nav-faq">FAQ</a>

            <a href="about.html" id="nav-about">About</a>

            <a href="#pricing" id="nav-pricing">Pricing</a>

            <a href="https://mail.google.com/mail/?view=cm&fs=1&to=angeskicollab10@gmail.com" target="_blank" rel="noopener" id="nav-contact">Contact</a>

            <button class="nav-drawer-close" id="nav-drawer-close" type="button" aria-label="close navigation">×</button>

        </nav>

        <button class="menu-button" id="nav-menu-button" type="button" aria-label="open navigation" aria-expanded="false">
            <span></span>
            <span></span>
            <span></span>
        </button>

        <div class="navbar__actions">

            <button
                class="btn btn-primary"
                id="nav-login"
            >
                Login
            </button>

            <button
                class="btn btn-outline"
                id="nav-signup"
            >
                Sign up
            </button>

            <div class="user-menu hidden" id="nav-user-menu">

                <button class="profile-icon-btn" id="nav-profile-btn" type="button" aria-label="Open profile">
                    <span class="profile-avatar" id="nav-user-avatar"></span>
                </button>

            </div>

        </div>

    </div>

    <div class="nav-drawer-backdrop" id="nav-drawer-backdrop"></div>

    `;

    const logo = document.getElementById("nav-logo");
    const home = document.getElementById("nav-home");
    const dashboard = document.getElementById("nav-dashboard");
    const navlinks = document.querySelector("#navbar .navlinks");
    const menuButton = document.getElementById("nav-menu-button");
    const drawerClose = document.getElementById("nav-drawer-close");
    const drawerBackdrop = document.getElementById("nav-drawer-backdrop");

    const closeDrawer = () => {
        navlinks?.classList.remove("open");
        drawerBackdrop?.classList.remove("open");
        menuButton?.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-drawer-open");
    };

    const openDrawer = () => {
        navlinks?.classList.add("open");
        drawerBackdrop?.classList.add("open");
        menuButton?.setAttribute("aria-expanded", "true");
        document.body.classList.add("nav-drawer-open");
    };

    menuButton?.addEventListener("click", openDrawer);
    drawerClose?.addEventListener("click", closeDrawer);
    drawerBackdrop?.addEventListener("click", closeDrawer);
    navlinks?.querySelectorAll("a, button").forEach(link => link.addEventListener("click", closeDrawer));
    document.addEventListener("click", event => {
        // Close the drawer when tapping anywhere outside it (backdrop included),
        // regardless of z-index/pointer-events of the overlay.
        if (!document.body.classList.contains("nav-drawer-open")) return;
        if (navlinks?.contains(event.target)) return;
        if (menuButton?.contains(event.target)) return;
        closeDrawer();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeDrawer();
    });
    window.addEventListener("resize", () => {
        if (window.innerWidth > 780) closeDrawer();
    });

    document.getElementById("nav-plan-badge")?.addEventListener("click", ()=>{
        if(!isProPlan(getCurrentPlan())){
            openUpgradeModal();
        }
    });

    // Wire Pricing buttons on landing page
    document.getElementById("pricing-free-btn")?.addEventListener("click", () => {
        if (isLoggedIn()) {
            showApp();
            switchToAppMode();
        } else {
            openAuthModal("signup");
        }
    });

    const openPricing = () => {
        if (isLoggedIn()) {
            openUpgradeModal();
        } else {
            openAuthModal("signup");
        }
    };

    document.getElementById("pricing-pro-btn")?.addEventListener("click", openPricing);
    document.getElementById("pricing-pro-annual-btn")?.addEventListener("click", openPricing);

    document.getElementById("pricing-enterprise-btn")?.addEventListener("click", () => {
        window.open("https://mail.google.com/mail/?view=cm&fs=1&to=angeskicollab10@gmail.com", "_blank");
    });

    home?.addEventListener("click", (e) => {
        e.preventDefault();
        showLanding();
        switchToHomeMode();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    dashboard?.addEventListener("click", (e) => {
        e.preventDefault();
        if (isLoggedIn()) {
            showApp();
            switchToAppMode();
        } else {
            openAuthModal("login");
        }
    });

    logo?.addEventListener(

        "click",

        event=>{

            event.preventDefault();

            showLanding();

            switchToHomeMode();

        }

    );

    /*
        Risultato dell'autenticazione (dispatchati da js_auth.js):
        entra in dashboard dopo login/signup riuscito, torna alla
        landing dopo logout.
    */

    window.addEventListener(
        "brawl:login-success",
        ()=>{

            resetVideoAnalysisState();
            showApp();
            switchToAppMode();

        }
    );

    window.addEventListener(
        "brawl:logout",
        ()=>{

            resetVideoAnalysisState();
            showLanding();
            switchToHomeMode();

        }
    );

    /*
        Bottoni "Login"/"Sign up" fuori dalla navbar (hero landing,
        link "Dashboard" nel footer): se l'utente è già loggato
        vanno direttamente in dashboard, altrimenti aprono il modal.
    */

    document.addEventListener(

        "click",

        event=>{

            const action =
            event.target.closest("[data-action]")?.dataset.action;

            if(action === "login" || action === "signup"){

                if(isLoggedIn()){

                    showApp();
                    switchToAppMode();

                }
                else{

                    openAuthModal(action);

                }

            }

        }

    );

}

function switchToAppMode(){
    ["nav-faq", "nav-pricing", "nav-about", "nav-dashboard"].forEach(id =>
        document.getElementById(id)?.classList.add("hidden")
    );
    ["nav-home", "nav-contact"].forEach(id =>
        document.getElementById(id)?.classList.remove("hidden")
    );
}

function switchToHomeMode(){
    ["nav-faq", "nav-pricing", "nav-about", "nav-home", "nav-dashboard", "nav-contact"].forEach(id =>
        document.getElementById(id)?.classList.remove("hidden")
    );
}

export {

    initNavigation,
    switchToAppMode,
    switchToHomeMode

};