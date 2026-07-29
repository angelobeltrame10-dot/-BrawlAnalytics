/* ==========================================================
   BRAWL ANALYTICS
   AUTH MODULE (Supabase Authentication)

   Responsabilità:
   - Login / Sign up / Logout
   - Persistenza sessione (getSession + onAuthStateChange)
   - UI del modal di autenticazione
   - Sincronizzazione navbar (Login/Signup vs Avatar/Email/Logout)
   - Transizioni animate Login <-> Sign Up e success overlay

   NON contiene:
   - Router (js_router.js)
   - Dashboard / Analytics / AI
   - Creazione del profilo utente: viene fatta automaticamente
     dal trigger DB "handle_new_user" (vedi sql_auth_setup.sql),
     mai da qui — un insert lato client verrebbe comunque
     bloccato dalla RLS e duplicherebbe una logica che deve
     restare atomica con la creazione dell'utente Auth.
========================================================== */

import { getSupabaseClient } from "./js_supabase_client.js";

import { resetStorageCache } from "./js_storage.js";


let currentUser = null;
let currentSession = null;
let authInitialized = false;
let modalMode = "login"; // "login" | "signup"

/* ==========================================================
   GETTERS PUBBLICI
========================================================== */

function getCurrentUser(){
    return currentUser;
}

function isLoggedIn(){
    return currentUser !== null;
}

/* ==========================================================
   INIZIALIZZAZIONE
========================================================== */

async function initializeAuth(){

    if(authInitialized){
        return;
    }
    authInitialized = true;

    injectAuthModal();
    setupNavAuthButtons();

    const supabase = await getSupabaseClient();

    if(!supabase){
        updateAuthUI();
        return;
    }

    // Supabase mantiene la sessione in localStorage di default:
    // getSession() basta per ripristinare l'utente al refresh o
    // alla riapertura del browser (autenticazione persistente).
    const { data, error } = await supabase.auth.getSession();

    if(!error && data?.session){
        currentSession = data.session;
        currentUser = data.session.user;
    }

    updateAuthUI();

    // Sincronizza automaticamente la UI ad ogni cambio di stato:
    // login, logout, refresh token, cambio in un'altra tab, ecc.
    supabase.auth.onAuthStateChange((event, session)=>{

        currentSession = session;
        currentUser = session?.user || null;

        updateAuthUI();

        if(event === "SIGNED_IN"){
            window.dispatchEvent(new CustomEvent("brawl:login-success"));
        }

        if(event === "SIGNED_OUT"){
            window.dispatchEvent(new CustomEvent("brawl:logout"));
        }

    });

}

/* ==========================================================
   ERRORI: messaggi leggibili per gli errori Supabase più comuni
========================================================== */

function mapAuthError(error){

    const msg = String(error?.message || "").toLowerCase();

    if(msg.includes("email not confirmed") || msg.includes("not confirmed")){
        return "Please confirm your email before logging in. Check your inbox.";
    }

    if(msg.includes("already registered") || msg.includes("already exists") || msg.includes("user already registered")){
        return "An account with this email already exists.";
    }

    if(msg.includes("rate limit") || msg.includes("too many")){
        return "Too many attempts. Please try again in a few minutes.";
    }

    if(msg.includes("invalid login credentials")){
        return "Incorrect email or password.";
    }

    if(msg.includes("user not found")){
        return "No account found with this email.";
    }

    if((msg.includes("invalid") && msg.includes("email")) || msg.includes("unable to validate email")){
        return "Please enter a valid email address.";
    }

    if(msg.includes("password") && (msg.includes("6") || msg.includes("short") || msg.includes("weak"))){
        return "Password must be at least 6 characters long.";
    }

    if(msg.includes("failed to fetch") || msg.includes("network")){
        return "Connection error. Please check your network.";
    }

    return error?.message || "Something went wrong. Please try again.";

}

/* ==========================================================
   LOGIN
========================================================== */

async function login(email, password){

    if(!navigator.onLine){
        return { success:false, error:"No internet connection. Please try again." };
    }

    if(!email || !password){
        return { success:false, error:"Enter your email and password." };
    }

    const supabase = await getSupabaseClient();

    if(!supabase){
        return { success:false, error:"Auth service unavailable. Please try again later." };
    }

    try{

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if(error){
            return { success:false, error: mapAuthError(error) };
        }

        currentSession = data.session;
        currentUser = data.user;

        updateAuthUI();

        return { success:true, user: data.user };

    }
    catch(error){

        return { success:false, error: mapAuthError(error) };

    }

}

/* ==========================================================
   SIGN UP
========================================================== */

async function signup(email, password, confirmPassword){

    if(!navigator.onLine){
        return { success:false, error:"No internet connection. Please try again." };
    }

    if(!email || !password){
        return { success:false, error:"Enter your email and password." };
    }

    if(password.length < 6){
        return { success:false, error:"Password must be at least 6 characters long." };
    }

    if(password !== confirmPassword){
        return { success:false, error:"Passwords do not match." };
    }

    const supabase = await getSupabaseClient();

    if(!supabase){
        return { success:false, error:"Auth service unavailable. Please try again later." };
    }

    try{

        const { data, error } = await supabase.auth.signUp({ email, password });

        if(error){
            return { success:false, error: mapAuthError(error) };
        }

        // Conferma email disabilitata: Supabase restituisce già una
        // sessione attiva → l'utente risulta loggato immediatamente.
        if(data.session){

            currentSession = data.session;
            currentUser = data.user;
            updateAuthUI();

            return { success:true, user:data.user, needsEmailConfirmation:false };

        }

        // Conferma email abilitata: nessuna sessione finché l'utente
        // non clicca il link ricevuto via email.
        return { success:true, user:data.user, needsEmailConfirmation:true };

    }
    catch(error){

        return { success:false, error: mapAuthError(error) };

    }

}

/* ==========================================================
   LOGOUT
========================================================== */

async function logout(){

    const supabase = await getSupabaseClient();

    if(!supabase){
        return { success:false, error:"Auth service unavailable. Please try again later." };
    }

    try{

        const { error } = await supabase.auth.signOut();

        if(error){
            return { success:false, error: mapAuthError(error) };
        }

        currentUser = null;
        currentSession = null;
        resetStorageCache();

        updateAuthUI();

        return { success:true };

    }
    catch(error){

        return { success:false, error: mapAuthError(error) };

    }

}

/* ==========================================================
   NAVBAR: Login / Sign up / Logout / Avatar / Email
========================================================== */

function setupNavAuthButtons(){

    document.getElementById("nav-login")?.addEventListener("click", ()=>{

        if(!isLoggedIn()){
            openAuthModal("login");
        }

    });

    document.getElementById("nav-signup")?.addEventListener("click", ()=>{

        if(!isLoggedIn()){
            openAuthModal("signup");
        }

    });

    document.getElementById("nav-logout")?.addEventListener("click", async ()=>{

        const result = await logout();

        if(!result.success){
            console.error("Logout error:", result.error);
        }

    });

}

function updateAuthUI(){

    const loggedIn = isLoggedIn();

    document.getElementById("nav-login")?.classList.toggle("hidden", loggedIn);
    document.getElementById("nav-signup")?.classList.toggle("hidden", loggedIn);
    document.getElementById("nav-user-menu")?.classList.toggle("hidden", !loggedIn);

    if(loggedIn && currentUser){

        const email = currentUser.email || "";
        const initial = email.charAt(0).toUpperCase() || "U";

        const avatar = document.getElementById("nav-user-avatar");
        const emailLabel = document.getElementById("nav-user-email");

        if(avatar) avatar.textContent = initial;
        if(emailLabel) emailLabel.textContent = email;

    }

}


/* ==========================================================
   MODAL: markup + comportamento
========================================================== */

function injectAuthModal(){

    if(document.getElementById("auth-modal-overlay")){
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = "auth-modal-overlay";
    overlay.className = "modal-overlay";

    overlay.innerHTML = `
        <div class="modal auth-modal">
            <button type="button" class="auth-close" id="auth-modal-close" aria-label="Close">×</button>

            <h2 class="auth-title" id="auth-modal-title">Create an account</h2>
            <p class="auth-switch">
                <span id="auth-switch-text">Already have an account?</span>
                <a href="#" id="auth-switch-link">Log in</a>
            </p>

            <div id="auth-message" class="auth-error" hidden></div>

            <div class="auth-panels">

                <form class="auth-form" id="auth-login-panel" hidden>
                    <input type="email" class="auth-input" id="login-email" placeholder="Email" required autocomplete="email">
                    <div class="auth-password-field">
                        <input type="password" class="auth-input" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
                        <button type="button" class="auth-eye-toggle" data-target="login-password">👁</button>
                    </div>
                    <button type="submit" class="auth-submit-btn" id="auth-submit-btn-login">Login</button>
                </form>

                <form class="auth-form" id="auth-signup-panel" hidden>
                    <input type="email" class="auth-input" id="signup-email" placeholder="Email" required autocomplete="email">
                    <div class="auth-password-field">
                        <input type="password" class="auth-input" id="signup-password" placeholder="Enter your password" required autocomplete="new-password">
                        <button type="button" class="auth-eye-toggle" data-target="signup-password">👁</button>
                    </div>
                    <div class="auth-password-field">
                        <input type="password" class="auth-input" id="signup-confirm-password" placeholder="Confirm your password" required autocomplete="new-password">
                        <button type="button" class="auth-eye-toggle" data-target="signup-confirm-password">👁</button>
                    </div>
                    <label class="auth-checkbox">
                        <input type="checkbox" id="signup-terms">
                        <span>I agree to the <a href="../legal/terms.html" target="_blank" rel="noopener">Terms &amp; Conditions</a></span>
                    </label>
                    <button type="submit" class="auth-submit-btn" id="auth-submit-btn-signup">Create account</button>
                </form>

                <div class="auth-success-overlay" id="auth-success-overlay">
                    <div class="auth-success-spinner"></div>
                </div>

            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("auth-modal-close").addEventListener("click", closeAuthModal);

    overlay.addEventListener("click", event=>{
        if(event.target === overlay){
            closeAuthModal();
        }
    });

    document.getElementById("auth-switch-link").addEventListener("click", event=>{
        event.preventDefault();
        setAuthMode(modalMode === "login" ? "signup" : "login");
    });

    document.getElementById("auth-login-panel").addEventListener("submit", event=>{
        event.preventDefault();
        handleAuthSubmit();
    });

    document.getElementById("auth-signup-panel").addEventListener("submit", event=>{
        event.preventDefault();
        handleAuthSubmit();
    });

    overlay.querySelectorAll(".auth-eye-toggle").forEach(button=>{
        button.addEventListener("click", ()=>{
            const target = document.getElementById(button.dataset.target);
            if(!target) return;
            target.type = target.type === "password" ? "text" : "password";
            button.textContent = target.type === "password" ? "👁" : "🙈";
        });
    });

    setAuthMode(modalMode);

}

/*
    Cambia modalità login/signup con una transizione animata
    (fade + slide + scale). Al primo render, o se prefers-reduced-motion
    è attivo, esegue uno swap istantaneo senza animazione.
*/
function setAuthMode(mode){

    const previousMode = modalMode;
    modalMode = mode;

    const loginPanel = document.getElementById("auth-login-panel");
    const signupPanel = document.getElementById("auth-signup-panel");

    document.getElementById("auth-modal-title").textContent = mode === "login" ? "Welcome back" : "Create an account";
    document.getElementById("auth-switch-text").textContent = mode === "login" ? "Don't have an account?" : "Already have an account?";
    document.getElementById("auth-switch-link").textContent = mode === "login" ? "Sign up" : "Log in";

    hideAuthMessage();

    if(!loginPanel || !signupPanel){
        return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const outgoing = mode === "login" ? signupPanel : loginPanel;
    const incoming = mode === "login" ? loginPanel : signupPanel;

    // Primo render (nessun form ancora visibile) o reduced-motion:
    // swap istantaneo, nessuna animazione.
    if(previousMode === mode || outgoing.hidden || reduceMotion){
        loginPanel.hidden = mode !== "login";
        signupPanel.hidden = mode !== "signup";
        return;
    }

    const goingToSignup = mode === "signup";
    const exitClass = goingToSignup ? "auth-form-exit-left" : "auth-form-exit-right";
    const enterClass = goingToSignup ? "auth-form-enter-from-right" : "auth-form-enter-from-left";

    incoming.hidden = false;
    incoming.classList.add(enterClass);
    outgoing.classList.add(exitClass);

    // Forza un reflow prima di rimuovere la classe di ingresso, così
    // il browser applica davvero lo stato iniziale prima di animare.
    void incoming.offsetHeight;

    requestAnimationFrame(()=>{
        incoming.classList.remove(enterClass);
    });

    setTimeout(()=>{
        outgoing.hidden = true;
        outgoing.classList.remove(exitClass);
    }, 300);

}

function clearAuthForms(){

    ["login-email", "login-password", "signup-email", "signup-password", "signup-confirm-password"].forEach(id=>{

        const field = document.getElementById(id);
        if(field){
            field.value = "";
        }

    });

}

function showAuthMessage(text, type = "error"){

    const box = document.getElementById("auth-message");
    if(!box) return;

    box.textContent = text;
    box.className = type === "success" ? "auth-success" : "auth-error";
    box.hidden = false;

}

function hideAuthMessage(){

    const box = document.getElementById("auth-message");
    if(box){
        box.hidden = true;
    }

}

/*
    Mostra brevemente uno spinner sopra il form (fade + scale) prima
    di eseguire il callback (tipicamente closeAuthModal). Se l'overlay
    non è presente in DOM per qualche motivo, esegue subito il callback.
*/
function playSuccessTransition(callback){

    const overlay = document.getElementById("auth-success-overlay");

    if(!overlay){
        callback();
        return;
    }

    overlay.classList.add("active");

    setTimeout(()=>{
        overlay.classList.remove("active");
        callback();
    }, 450);

}

async function handleAuthSubmit(){

    const submitBtn = document.getElementById(modalMode === "login" ? "auth-submit-btn-login" : "auth-submit-btn-signup");
    submitBtn.disabled = true;

    hideAuthMessage();

    if(modalMode === "login"){

        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;

        const result = await login(email, password);

        if(result.success){
            clearAuthForms();
            playSuccessTransition(closeAuthModal);
        }
        else{
            showAuthMessage(result.error);
        }

    }
    else{

        const termsChecked = document.getElementById("signup-terms")?.checked;

        if(!termsChecked){
            showAuthMessage("Please accept the Terms & Conditions to continue.");
            submitBtn.disabled = false;
            return;
        }

        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;
        const confirmPassword = document.getElementById("signup-confirm-password").value;

        const result = await signup(email, password, confirmPassword);

        if(result.success){

            if(result.needsEmailConfirmation){
                showAuthMessage("Account created! Check your email to confirm before logging in.", "success");
            }
            else{
                showAuthMessage("Account created successfully!", "success");
                clearAuthForms();
                setTimeout(()=> playSuccessTransition(closeAuthModal), 500);
            }

        }
        else{
            showAuthMessage(result.error);
        }

    }

    submitBtn.disabled = false;

}


function openAuthModal(mode = "login"){

    injectAuthModal(); // rete di sicurezza se chiamato prima di initializeAuth()
    setAuthMode(mode);
    document.getElementById("auth-modal-overlay")?.classList.add("active");

}

function closeAuthModal(){

    document.getElementById("auth-modal-overlay")?.classList.remove("active");
    hideAuthMessage();
    clearAuthForms();

}

export {

    initializeAuth,
    login,
    signup,
    logout,
    getCurrentUser,
    isLoggedIn,
    updateAuthUI,
    openAuthModal,
    closeAuthModal

};