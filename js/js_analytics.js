/* ==========================================================
   BRAWL ANALYTICS
   ANALYTICS ENGINE

   Responsabilità:
   - Calcolo statistiche video
   - Calcolo Virality Score
   - Analisi performance
   - Collegamento formati

   NON contiene:
   - Modifica HTML
   - Lettura CSV
   - Gestione file

========================================================== */



import { classifyVideosEffective, getTopFormat } from "./js_fomats.js";

import { getVideoViews } from "./js_csv_fields.js";



/*
    Conta numero video analizzati
*/

function getVideoCount(
    videos
){


    return Array.isArray(videos)

    ? videos.length

    : 0;

}



/*
    Converte valore numerico

    Gestisce valori YouTube CSV:

    "10,000"
    "10.000"
    "10"
*/

function parseNumber(
    value
){


    if(!value){

        return 0;

    }



    return Number(

        String(value)

        .replace(
            /,/g,
            ""
        )

        .replace(
            /\./g,
            ""

        )

    ) || 0;


}




/*
    Calcola Virality Score

    Versione iniziale:

    views
    +
    engagement

    In futuro:
    retention
    watch time
    crescita
*/

function calculateViralityScore(
    videos
){



    if(
        !Array.isArray(videos) ||
        videos.length === 0
    ){

        return 0;

    }





    const analyzed =

    videos.map(
        video => {


            const views = getVideoViews(video);



            const likes =

            parseNumber(

                video.likes ||

                video.Likes ||

                video["Likes"]

            );



            const comments =

            parseNumber(

                video.comments ||

                video.Comments ||

                video["Comments"]

            );



            return {

                views,

                likes,

                comments


            };


        }

    );



    const totalViews =

    analyzed.reduce(

        (sum,video)=>

        sum + video.views,

        0

    );





    const totalLikes =

    analyzed.reduce(

        (sum,video)=>

        sum + video.likes,

        0

    );





    const totalComments =

    analyzed.reduce(

        (sum,video)=>

        sum + video.comments,

        0

    );




    const engagement =

    totalLikes +

    (totalComments * 2);




    /*
        Formula iniziale

        Non definitiva.
        Verrà migliorata
        con dati reali.
    */


    let score =

    (

        (totalViews / 1000)

        +

        (engagement / 100)

    );





    score =

    Math.round(
        score
    );





    if(score > 100){

        score = 100;

    }



    return score;


}



/*
    Restituisce formato
    migliore

*/

function getBestFormat(videos, customFormats = []) {
    const classified = classifyVideosEffective(videos, customFormats);
    return getTopFormat(classified, customFormats);
}












export {
    getVideoCount,
    calculateViralityScore,
    getBestFormat
};