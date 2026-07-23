/* ==========================================================
   BRAWL ANALYTICS
   SUPABASE CLIENT

   Punto unico di configurazione Supabase. Sostituisci i due
   valori sotto con quelli del tuo progetto (Project Settings →
   API su supabase.com).

   Il client viene caricato in modo LAZY (import dinamico, solo
   alla prima richiesta reale) invece che con un import statico
   in cima al file. Con un import statico, ogni apertura del
   sito — anche solo per vedere la landing page, senza toccare
   la dashboard — dipenderebbe dal caricamento via rete della
   libreria da esm.sh PRIMA che qualsiasi script dell'app possa
   girare: se quella richiesta fallisce (offline, CDN bloccato,
   rete lenta/instabile), l'intero grafo di moduli ES (incluso
   js_app.js, che importa js_dashboard.js che importa questo
   file) non parte e la pagina resta bianca — è la causa più
   probabile dell'errore "non riesco a vedere index.html".

   Con l'import dinamico, un problema di rete blocca solo le
   funzioni che usano davvero Supabase (gestite con try/catch
   in js_subscription.js), non l'intero sito.
========================================================== */

const SUPABASE_URL = "https://jbeglrlnxlwhvogldhzk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiZWdscmxueGx3aHZvZ2xkaHprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2OTQ4MTUsImV4cCI6MjEwMDI3MDgxNX0.aqkw4e2jPgxRN4fYZGEg2uev3ALPB1rP8ScpNO7IQl0";

let clientPromise = null;

/*
    Restituisce il client Supabase, creandolo al primo utilizzo.
    Ritorna null (invece di lanciare un'eccezione) se il
    caricamento della libreria o la creazione del client
    falliscono, così il chiamante può degradare in modo
    controllato invece di rompere l'intera pagina.
*/
export function getSupabaseClient(){

    if(!clientPromise){

        clientPromise = import("https://esm.sh/@supabase/supabase-js@2")
            .then(module => module.createClient(SUPABASE_URL, SUPABASE_ANON_KEY))
            .catch(error => {

                console.error("Supabase: impossibile caricare il client.", error);
                clientPromise = null;
                return null;

            });

    }

    return clientPromise;

}