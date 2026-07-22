/* ==========================================================
   BRAWL ANALYTICS
   CSV PARSER

   Gestisce:
   - Lettura file CSV
   - Conversione dati
   - Pulizia dati YouTube Studio
========================================================== */

/*
    Campi che YouTube Studio esporta come NUMERI
    ma che nel CSV arrivano sempre come stringhe.

    Vanno convertiti con Number(), altrimenti
    ogni calcolo/ordinamento/statistica fatto
    più avanti nell'app tratta questi valori
    come testo (es. "1000" < "99" perché
    confrontati come stringhe).
*/
const NUMERIC_FIELDS = [

    "Durata",

    "Visualizzazioni \"engaged\"",

    "Percentuale media visualizzata (%)",

    "Spettatori unici",

    "Ha continuato a guardare (%)",

    "Media di visualizzazioni per spettatore",

    "Nuovi spettatori",

    "Spettatori di ritorno",

    "Spettatori occasionali",

    "Spettatori abituali",

    "Visualizzazioni",

    "Tempo di visualizzazione (ore)",

    "Iscritti"

];

/*
    La prima riga dati del CSV di YouTube Studio
    non è un video: è la riga di riepilogo del
    canale ("Contenuti" = "Totale").

    Se non viene rimossa, entra nelle statistiche
    come se fosse un video con 6+ milioni di
    visualizzazioni, falsando ogni media, ogni
    "video migliore" e ogni calcolo di viralità.
*/
function isTotaleRow(row){

    const id = (row["Contenuti"] || "")

    .trim()

    .toLowerCase();

    return id === "" || id === "totale";

}

/*
    Converte un numero in formato stringa
    ("1234", "92.44", "") in un vero Number.

    Le celle vuote (es. "Spettatori unici" non
    è sempre valorizzato da YouTube Studio)
    diventano null invece di NaN, così il resto
    del codice può distinguere "dato mancante"
    da "dato zero".
*/
function toNumberOrNull(value){

    if(

        value === undefined ||

        value === null ||

        String(value).trim() === ""

    ){

        return null;

    }

    const parsed = Number(value);

    return Number.isNaN(parsed)

        ? null

        : parsed;

}

/*
    "Durata di visualizzazione media" arriva
    come stringa "0:00:23" (H:MM:SS).

    La convertiamo in secondi totali, così è
    utilizzabile in calcoli e confronti con
    "Durata" (che invece è già in secondi).
*/
function parseDurataToSeconds(value){

    if(!value || typeof value !== "string"){

        return null;

    }

    const parts = value

    .trim()

    .split(":")

    .map(Number);

    if(

        parts.some(

            part=> Number.isNaN(part)

        )

    ){

        return null;

    }

    // supporta sia H:MM:SS che MM:SS
    while(parts.length < 3){

        parts.unshift(0);

    }

    const [hours, minutes, seconds] = parts;

    return (

        hours * 3600 +

        minutes * 60 +

        seconds

    );

}

/*
    "Ora pubblicazione video" arriva come
    "Jun 22, 2026". Alcuni video (bozze/non
    pubblicati, vedi righe senza data nel CSV)
    hanno questo campo vuoto.

    Restituisce un vero oggetto Date, oppure
    null se la data manca o non è valida.
*/
function parsePublishDate(value){

    if(!value || String(value).trim() === ""){

        return null;

    }

    const parsed = new Date(value);

    return isNaN(

        parsed.getTime()

    )

        ? null

        : parsed;

}

/*
    Legge un file CSV

    Restituisce una Promise
    con i dati elaborati
*/

function parseCSVText(text){

    if(

        typeof Papa !== "undefined" &&

        Papa &&

        typeof Papa.parse === "function"

    ){

        const results = Papa.parse(

            text,

            {

                header: true,

                skipEmptyLines: true

            }

        );

        if(results.errors?.length){

            console.warn(

                "CSV warnings:",

                results.errors

            );

        }

        return results.data;

    }

    const normalizedText = String(text || "")

    .replace(/^\uFEFF/, "");

    if(normalizedText.trim() === ""){

        return [];

    }

    const rows = [];

    let currentRow = [];

    let currentValue = "";

    let inQuotes = false;

    for(let index = 0; index < normalizedText.length; index += 1){

        const char = normalizedText[index];

        const nextChar = normalizedText[index + 1];

        if(char === '"'){

            if(inQuotes && nextChar === '"'){

                currentValue += '"';

                index += 1;

            }

            else{

                inQuotes = !inQuotes;

            }

            continue;

        }

        if(char === "," && !inQuotes){

            currentRow.push(currentValue);

            currentValue = "";

            continue;

        }

        if((char === "\n" || char === "\r") && !inQuotes){

            if(char === "\r" && nextChar === "\n"){

                index += 1;

            }

            currentRow.push(currentValue);

            rows.push(currentRow);

            currentRow = [];

            currentValue = "";

            continue;

        }

        currentValue += char;

    }

    if(currentValue.length > 0 || currentRow.length > 0){

        currentRow.push(currentValue);

        rows.push(currentRow);

    }

    if(rows.length === 0){

        return [];

    }

    const headers = rows[0].map(header=> String(header).trim());

    return rows.slice(1)

    .filter(row=> row.some(cell=> String(cell).trim() !== ""))

    .map(row=>{

        const parsedRow = {};

        headers.forEach((header, index)=>{

            parsedRow[header] = row[index] ?? "";

        });

        return parsedRow;

    });

}


function parseCSV(file){

    if(!file){

        return Promise.reject(
            new Error(
                "No CSV file provided."
            )
        );

    }

    return new Promise(

        (resolve, reject)=>{

            const reader = new FileReader();

            reader.onload = ()=>{

                try{

                    const parsedData =

                    parseCSVText(

                        reader.result

                    );

                    const cleanedData =

                    cleanCSVData(

                        parsedData

                    );

                    resolve(

                        cleanedData

                    );

                }

                catch(error){

                    reject(error);

                }

            };

            reader.onerror = ()=>{

                reject(

                    reader.error ||

                    new Error(
                        "Unable to read the selected CSV file."
                    )

                );

            };

            reader.readAsText(file);

        }

    );

}

/*
    Pulizia dati CSV

    Rimuove:
    - righe vuote
    - la riga di riepilogo "Totale"
    - spazi inutili

    Converte:
    - i campi numerici (visualizzazioni, iscritti, ecc.) in Number
    - "Durata di visualizzazione media" in secondi
    - "Ora pubblicazione video" in un vero oggetto Date
*/

function cleanCSVData(
    data
){

    return data

    .filter(

        row=>{

            return Object.values(row)

            .some(

                value=>

                value &&

                String(value)

                .trim() !== ""

            );

        }

    )

    .filter(

        row=> !isTotaleRow(row)

    )

    .map(

        row=>{

            const cleanRow = {};

            Object.keys(row)

            .forEach(

                key=>{

                    const trimmedKey = key.trim();

                    cleanRow[trimmedKey] =

                    typeof row[key] === "string"

                        ? row[key].trim()

                        : row[key];

                }

            );

            NUMERIC_FIELDS.forEach(

                field=>{

                    if(field in cleanRow){

                        cleanRow[field] =

                        toNumberOrNull(

                            cleanRow[field]

                        );

                    }

                }

            );

            cleanRow[

                "Durata di visualizzazione media (secondi)"

            ] = parseDurataToSeconds(

                cleanRow["Durata di visualizzazione media"]

            );

            cleanRow[

                "Data pubblicazione"

            ] = parsePublishDate(

                cleanRow["Ora pubblicazione video"]

            );

            return cleanRow;

        }

    );

}

export {

    parseCSV,

    parseCSVText

};