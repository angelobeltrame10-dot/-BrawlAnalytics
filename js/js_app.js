/* ==========================================================
   BRAWL ANALYTICS
   APPLICATION BOOT

   Responsabilità:
   - Avvio applicazione
   - Inizializzazione moduli principali (navbar + auth)
   - Scelta schermata iniziale in base alla sessione Supabase

   NON contiene:
   - Dashboard logic
   - Analytics
   - Navigazione dettagliata

========================================================== */



import {

    initNavigation,
    switchToAppMode

}
from "./js_navigation.js";



import {

    showLanding,
    showApp

}
from "./js_router.js";



import {

    initializeAuth,
    isLoggedIn

}
from "./js_auth.js";

import { loadPublicStats } from "./js_public_stats.js";
import { initScrollReveal } from "./js_scroll_reveal.js";
import { initHeroChartLine } from "./js_hero_chart.js";
import { initLayout417 } from "./js_layout417.js";



/*
    Avvio applicazione
*/

async function startApp(){



    /*
        Crea navbar
    */


    initNavigation();




    /*
        Recupera/ripristina la sessione Supabase (se l'utente era
        già loggato in una visita precedente, getSession() la
        trova subito: è questo che rende il login persistente).
    */


    await initializeAuth();




    /*
        Mostra la schermata iniziale corretta
    */

    if(isLoggedIn()){

        showApp();

        switchToAppMode();

    }
    else{

        showLanding();

    }

    initScrollReveal();
    initHeroChartLine();
    initLayout417();
    loadPublicStats();

    // Prevent default browser behavior for file drops globally
    // This stops the browser from downloading files when dragged
    document.addEventListener("dragover", event => {
        event.preventDefault();
        event.stopPropagation();
    });

    document.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();
    });




}




document.addEventListener(

    "DOMContentLoaded",

    startApp

);