/* ==========================================================
   BRAWL ANALYTICS
   AUTH MODULE (Supabase Authentication)

   Responsabilità:
   - Login / Sign up / Logout
   - Persistenza sessione (getSession + onAuthStateChange)
   - UI del modal di autenticazione
   - Sincronizzazione navbar (Login/Signup vs Avatar/Email/Logout)

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
        <div class="modal">
            <div class="modal-header">
                <h3 class="modal-title" id="auth-modal-title">Login</h3>
                <p class="modal-subtitle" id="auth-modal-subtitle">Access your Brawl Analytics dashboard.</p>
            </div>

            <div class="auth-tabs">
                <button type="button" class="auth-tab active" id="auth-tab-login">Login</button>
                <button type="button" class="auth-tab" id="auth-tab-signup">Sign up</button>
            </div>

            <div id="auth-message" class="auth-error" hidden></div>

            <form class="modal-body auth-panel" id="auth-login-panel">
                <div class="modal-field">
                    <label class="modal-label">Email</label>
                    <input type="email" class="modal-input" id="login-email" placeholder="you@example.com" required autocomplete="email">
                </div>
                <div class="modal-field">
                    <label class="modal-label">Password</label>
                    <input type="password" class="modal-input" id="login-password" placeholder="••••••••" required autocomplete="current-password">
                </div>
            </form>

            <form class="modal-body auth-panel" id="auth-signup-panel" hidden>
                <div class="modal-field">
                    <label class="modal-label">Email</label>
                    <input type="email" class="modal-input" id="signup-email" placeholder="you@example.com" required autocomplete="email">
                </div>
                <div class="modal-field">
                    <label class="modal-label">Password</label>
                    <input type="password" class="modal-input" id="signup-password" placeholder="••••••••" required autocomplete="new-password">
                </div>
                <div class="modal-field">
                    <label class="modal-label">Confirm password</label>
                    <input type="password" class="modal-input" id="signup-confirm-password" placeholder="••••••••" required autocomplete="new-password">
                </div>
            </form>

            <div class="modal-footer">
                <button class="modal-btn modal-btn-cancel" id="auth-modal-close">Cancel</button>
                <button class="modal-btn modal-btn-confirm" id="auth-submit-btn">Login</button>
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

    document.getElementById("auth-tab-login").addEventListener("click", ()=> setAuthMode("login"));
    document.getElementById("auth-tab-signup").addEventListener("click", ()=> setAuthMode("signup"));

    document.getElementById("auth-submit-btn").addEventListener("click", handleAuthSubmit);

    // Invio con Enter dentro i campi: intercettiamo il submit
    // nativo del <form> per evitare il reload della pagina.
    document.getElementById("auth-login-panel").addEventListener("submit", event=>{
        event.preventDefault();
        handleAuthSubmit();
    });

    document.getElementById("auth-signup-panel").addEventListener("submit", event=>{
        event.preventDefault();
        handleAuthSubmit();
    });

}

function setAuthMode(mode){

    modalMode = mode;

    document.getElementById("auth-tab-login").classList.toggle("active", mode === "login");
    document.getElementById("auth-tab-signup").classList.toggle("active", mode === "signup");

    document.getElementById("auth-login-panel").hidden = mode !== "login";
    document.getElementById("auth-signup-panel").hidden = mode !== "signup";

    document.getElementById("auth-modal-title").textContent = mode === "login" ? "Login" : "Create account";
    document.getElementById("auth-modal-subtitle").textContent = mode === "login"
        ? "Access your Brawl Analytics dashboard."
        : "Create your account to get started.";

    document.getElementById("auth-submit-btn").textContent = mode === "login" ? "Login" : "Create account";

    hideAuthMessage();

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

async function handleAuthSubmit(){

    const submitBtn = document.getElementById("auth-submit-btn");
    submitBtn.disabled = true;

    hideAuthMessage();

    if(modalMode === "login"){

        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;

        const result = await login(email, password);

        if(result.success){
            clearAuthForms();
            closeAuthModal();
        }
        else{
            showAuthMessage(result.error);
        }

    }
    else{

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
                setTimeout(closeAuthModal, 900);
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