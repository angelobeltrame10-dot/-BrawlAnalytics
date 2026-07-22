/* ==========================================================
   BRAWL ANALYTICS
   NAVIGATION CONTROLLER

   Responsabilità:
   - Gestione navbar
   - Cambio link visibili
   - Collegamento Home/App

========================================================== */

import {

    showLanding,
    showApp

}
from "./js_router.js";

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

            <span class="logo__mark">
                B
            </span>

            <span class="logo__text">
                Brawl<strong>Analytics</strong>
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

        </div>

    </div>

    `;

    const logo =
    document.getElementById(
        "nav-logo"
    );

    const login =
    document.getElementById(
        "nav-login"
    );

    const signup =
    document.getElementById(
        "nav-signup"
    );

    const home =
    document.getElementById(
        "nav-home"
    );

    login?.addEventListener(

        "click",

        ()=>{

            showApp();

            switchToAppMode();

        }

    );

    signup?.addEventListener(

        "click",

        ()=>{

            showApp();

            switchToAppMode();

        }

    );

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

    document.addEventListener(

        "click",

        event=>{

            const action =
            event.target.closest("[data-action]")?.dataset.action;

            if(action === "login" || action === "signup"){

                showApp();
                switchToAppMode();

            }

        }

    );

}

function switchToAppMode(){

    document
    .getElementById(
        "nav-login"
    )
    ?.classList.add(
        "hidden"
    );

    document
    .getElementById(
        "nav-signup"
    )
    ?.classList.add(
        "hidden"
    );

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
        "nav-login"
    )
    ?.classList.remove(
        "hidden"
    );

    document
    .getElementById(
        "nav-signup"
    )
    ?.classList.remove(
        "hidden"
    );

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
