/* ==========================================================
   BRAWL ANALYTICS
   STORAGE MANAGER

   Responsabilità:
   - Salvare dati dashboard
   - Recuperare dati salvati
   - Eliminare dati
   - Persistire impostazioni AI
   - Persistire formati personalizzati

   Attualmente:
   localStorage

   Futuro:
   database / cloud
========================================================== */

const STORAGE_KEY =
"brawl_analytics_data";

const CUSTOM_FORMATS_KEY =
"brawl_custom_formats";

const CHANNEL_PROFILE_KEY =
"brawl_channel_profile";

/*
    Salva dati dashboard

    Riceve:
    array di video
*/

function saveDashboardData(
    data
){

    if(data == null){

        return false;

    }

    try{

        localStorage.setItem(

            STORAGE_KEY,

            JSON.stringify(data)

        );

        return true;

    }

    catch(error){

        console.error(

            "Storage save error:",

            error

        );

        return false;

    }

}

/*
    Recupera dati salvati

    Se non esistono
    restituisce array vuoto
*/

function loadDashboardData(){

    try{

        const saved =

        localStorage.getItem(

            STORAGE_KEY

        );

        if(!saved){

            return [];

        }

        const data =

        JSON.parse(saved);

        return Array.isArray(data)
            ? data
            : [];

    }

    catch(error){

        console.error(

            "Storage load error:",

            error

        );

        return [];

    }

}

/*
    Cancella dati salvati
*/

function clearDashboardData(){

    try{

        localStorage.removeItem(

            STORAGE_KEY

        );

        return true;

    }

    catch(error){

        console.error(

            "Storage clear error:",

            error

        );

        return false;

    }

}

function saveCustomFormats(
    formats
){

    try{

        const normalized =
        Array.isArray(formats)
            ? formats
            : [];

        localStorage.setItem(

            CUSTOM_FORMATS_KEY,

            JSON.stringify(normalized)

        );

        return true;

    }

    catch(error){

        console.error(

            "Custom formats save error:",

            error

        );

        return false;

    }

}

function loadCustomFormats(){

    try{

        const saved =
        localStorage.getItem(
            CUSTOM_FORMATS_KEY
        );

        if(!saved){

            return [];

        }

        const parsed =
        JSON.parse(saved);

        return Array.isArray(parsed)
            ? parsed
            : [];

    }

    catch(error){

        console.error(

            "Custom formats load error:",

            error

        );

        return [];

    }

}

function clearCustomFormats(){

    try{

        localStorage.removeItem(
            CUSTOM_FORMATS_KEY
        );

        return true;

    }

    catch(error){

        console.error(

            "Custom formats clear error:",

            error

        );

        return false;

    }

}

function saveChannelProfile(profile){

    try{

        localStorage.setItem(
            CHANNEL_PROFILE_KEY,
            JSON.stringify(profile)
        );

        return true;

    }

    catch(error){

        console.error(
            "Channel profile save error:",
            error
        );

        return false;

    }

}

function loadChannelProfile(){

    try{

        const saved =
            localStorage.getItem(CHANNEL_PROFILE_KEY);

        if(!saved){

            return null;

        }

        const parsed =
            JSON.parse(saved);

        return parsed || null;

    }

    catch(error){

        console.error(
            "Channel profile load error:",
            error
        );

        return null;

    }

}

function clearChannelProfile(){

    try{

        localStorage.removeItem(CHANNEL_PROFILE_KEY);

        return true;

    }

    catch(error){

        console.error(
            "Channel profile clear error:",
            error
        );

        return false;

    }

}

export {

    STORAGE_KEY,

    CUSTOM_FORMATS_KEY,

    CHANNEL_PROFILE_KEY,

    saveDashboardData,

    loadDashboardData,

    clearDashboardData,

    saveCustomFormats,

    loadCustomFormats,

    clearCustomFormats,

    saveChannelProfile,

    loadChannelProfile,

    clearChannelProfile

};