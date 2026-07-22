/* ==========================================================
   BRAWL ANALYTICS
   UI MANAGER

   Responsabilità:
   - Aggiornare elementi HTML
   - Mostrare informazioni utente
   - Gestire messaggi

   NON contiene:
   - Calcoli analytics
   - Lettura CSV
   - Gestione dati

========================================================== */

let toastTimeout = null;

/*
    Aggiorna numero video analizzati
*/

function updateVideoCount(
    count
){

    document.querySelectorAll(
        ".video-count"
    ).forEach(
        element=>{

            element.textContent =
            count;

        }
    );

}

/*
    Aggiorna Virality Score
*/

function updateScore(
    score
){

    document.querySelectorAll(
        ".score-value"
    ).forEach(
        element=>{

            element.textContent =
            score;

        }
    );

}

/*
    Aggiorna formato migliore
*/

function updateBestFormat(
    format
){

    document.querySelectorAll(
        ".best-format"
    ).forEach(
        element=>{

            element.textContent =
            format;

        }
    );

}

/*
    Mostra messaggio toast
*/

function showMessage(
    message
){

    const container = document.getElementById("toast-container");

    if(!container){

        return;

    }

    let toast = document.getElementById("toast");

    if(!toast){

        toast = createElement("div", "toast", "");
        toast.id = "toast";
        toast.setAttribute("role", "status");
        container.appendChild(toast);

    }

    toast.textContent =
    message;

    toast.classList.remove(
        "hidden"
    );

    if(toastTimeout){

        clearTimeout(
            toastTimeout
        );

    }

    toastTimeout =
    setTimeout(
        ()=>{

            toast.classList.add(
                "hidden"
            );

        },

        2500

    );

}

/*
    Aggiorna una statistica generica
*/

function updateStat(
    selector,
    value
){

    const element =
    document.querySelector(
        selector
    );

    if(!element){

        console.warn(
            "Element not found:",
            selector
        );

        return;

    }

    element.textContent =
    value;

}

/*
    Crea elemento HTML dinamico
*/

function createElement(
    tag,
    className,
    text=""
){

    const element =
    document.createElement(
        tag
    );

    if(className){

        element.className =
        className;

    }

    element.textContent =
    text;

    return element;

}

export {

    updateVideoCount,

    updateScore,

    updateBestFormat,

    updateStat,

    createElement,

    showMessage

};
