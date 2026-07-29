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
from "./js_router.js";

import {

    openAuthModal,
    isLoggedIn

}
from "./js_auth.js";

import { resetVideoAnalysisState } from "./js_video_analysis.js";

import { getCurrentPlan, openUpgradeModal } from "./js_subscription.js";

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

                <img src="assets/favicon.ico" alt="Brawl Analytics logo" width="32" height="32">

            <span class="logo__text">
                Brawl<strong>Analytics</strong> - BETA
            </span>

        </a>

        <nav class="navlinks">

            <a
                href="#faq"
                id="nav-faq"
            >
                FAQ
            </a>


            <button
                class="btn btn-ghost hidden"
                id="nav-home"
            >
                Home
            </button>


            <a
                href="https://mail.google.com/mail/?view=cm&fs=1&to=angeskicollab10@gmail.com" target="_blank" rel="noopener"
                id="nav-faq"
            >
                contact
            </a>

        </nav>

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

                <span class="user-email" id="nav-user-email"></span>

                <button class="btn btn-outline btn-sm plan-badge" id="nav-plan-badge" type="button">FREE</button>

                <button class="btn btn-outline btn-sm" id="nav-logout">
                    Logout
                </button>

            </div>

        </div>

    </div>

    `;

    const logo =
    document.getElementById(
        "nav-logo"
    );

    const home =
    document.getElementById(
        "nav-home"
    );

    document.getElementById("nav-plan-badge")?.addEventListener("click", ()=>{
        if(getCurrentPlan() !== "pro"){
            openUpgradeModal();
        }
    });

    home?.addEventListener(

        "click",

        ()=>{

            showLanding();

            switchToHomeMode();

        }

    );

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

    document
    .getElementById(
        "nav-home"
    )
    ?.classList.remove(
        "hidden"
    );

    document
    .getElementById(
        "nav-faq"
    )
    ?.classList.add(
        "hidden"
    );

}

function switchToHomeMode(){

    document
    .getElementById(
        "nav-home"
    )
    ?.classList.add(
        "hidden"
    );

    document
    .getElementById(
        "nav-faq"
    )
    ?.classList.remove(
        "hidden"
    );

}

export {

    initNavigation,
    switchToAppMode,
    switchToHomeMode

};