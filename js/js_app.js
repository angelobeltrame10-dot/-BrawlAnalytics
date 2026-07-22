/* ==========================================================
   BRAWL ANALYTICS
   APPLICATION BOOT

   Responsabilità:
   - Avvio applicazione
   - Inizializzazione moduli principali

   NON contiene:
   - Dashboard logic
   - Analytics
   - Navigazione dettagliata

========================================================== */



import {

    initNavigation

}
from "./js_navigation.js";



import {

    showLanding

}
from "./js_router.js";




/*
    Avvio applicazione

*/

function startApp(){



    /*
        Crea navbar
    */


    initNavigation();






    /*
        Mostra schermata iniziale
    */


    showLanding();




}




document.addEventListener(

    "DOMContentLoaded",

    startApp

);
