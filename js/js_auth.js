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
import { switchToAppMode, switchToHomeMode } from "./js_navigation.js?v=20260825-profile-18";
import { showApp } from "./js_router.js?v=20260826-router-fix";


let currentUser = null;
let currentSession = null;
let authInitialized = false;
let modalMode = "login"; // "login" | "signup"

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
let failedLoginAttempts = Number(sessionStorage.getItem("brawl-login-failed-attempts") || 0);
let loginLockedUntil = Number(sessionStorage.getItem("brawl-login-locked-until") || 0);

function persistLoginGuard(){
    sessionStorage.setItem("brawl-login-failed-attempts", String(failedLoginAttempts));
    sessionStorage.setItem("brawl-login-locked-until", String(loginLockedUntil));
}

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

function getLoginLockMessage(){
    const minutes = Math.max(1, Math.ceil((loginLockedUntil - Date.now()) / 60000));
    return `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function isInvalidLoginError(error){
    const message = String(error?.message || "").toLowerCase();
    return message.includes("invalid login credentials")
        || message.includes("invalid credentials")
        || message.includes("user not found");
}

async function login(email, password){

    if(loginLockedUntil > Date.now()){
        return { success:false, error:getLoginLockMessage(), locked:true };
    }

    if(loginLockedUntil && loginLockedUntil <= Date.now()){
        failedLoginAttempts = 0;
        loginLockedUntil = 0;
        persistLoginGuard();
    }

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
            if(isInvalidLoginError(error)){
                failedLoginAttempts += 1;
                if(failedLoginAttempts >= MAX_LOGIN_ATTEMPTS){
                    loginLockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
                    persistLoginGuard();
                    return { success:false, error:getLoginLockMessage(), locked:true };
                }
                persistLoginGuard();
                const remaining = MAX_LOGIN_ATTEMPTS - failedLoginAttempts;
                return {
                    success:false,
                    error:`${mapAuthError(error)} ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
                };
            }
            return { success:false, error: mapAuthError(error) };
        }

        failedLoginAttempts = 0;
        loginLockedUntil = 0;
        persistLoginGuard();
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

    document.getElementById("nav-profile-btn")?.addEventListener("click", ()=>{

        if(isLoggedIn()){
            openProfileModal();
        }

    });

    // Setup context-aware dashboard button on homepage
    document.getElementById("dashboard-or-login-btn")?.addEventListener("click", async ()=>{
        if(isLoggedIn()){
            // User is logged in, navigate to dashboard
            try {
                const { showApp } = await import("./js_router.js?v=20260826-router-fix");
                showApp();
                switchToAppMode(); // Update navbar to show Home instead of FAQ/About
            } catch (error) {
                console.error("Failed to load router:", error);
            }
        } else {
            // User is not logged in, show login modal
            openAuthModal("login");
        }
    });

    // Setup signup/profile button on homepage
    document.getElementById("signup-or-logout-btn")?.addEventListener("click", async ()=>{
        if(isLoggedIn()){
            openProfileModal();
        } else {
            openAuthModal("signup");
        }
    });

}

function updateAuthUI(){

    const loggedIn = isLoggedIn();

    document.getElementById("nav-login")?.classList.toggle("hidden", loggedIn);
    document.getElementById("nav-signup")?.classList.toggle("hidden", loggedIn);
    document.getElementById("nav-user-menu")?.classList.toggle("hidden", !loggedIn);

    // Update profile avatar
    if(loggedIn && currentUser){
        const email = currentUser.email || "";
        const initial = email.charAt(0).toUpperCase() || "U";
        const avatar = document.getElementById("nav-user-avatar");
        if(avatar) avatar.textContent = initial;
    }

    // Update context-aware dashboard button on homepage
    const dashboardBtn = document.getElementById("dashboard-or-login-btn");
    if(dashboardBtn){
        if(loggedIn){
            dashboardBtn.textContent = "Dashboard";
            dashboardBtn.classList.remove("btn-primary");
            dashboardBtn.classList.add("btn-outline");
        } else {
            dashboardBtn.textContent = "Login";
            dashboardBtn.classList.remove("btn-outline");
            dashboardBtn.classList.add("btn-primary");
        }
    }

    // Update signup/profile button on homepage
    const signupLogoutBtn = document.getElementById("signup-or-logout-btn");
    if(signupLogoutBtn){
        if(loggedIn){
            signupLogoutBtn.textContent = "Profile";
            signupLogoutBtn.classList.remove("btn-outline");
            signupLogoutBtn.classList.add("btn-primary");
        } else {
            signupLogoutBtn.textContent = "Sign up";
            signupLogoutBtn.classList.remove("btn-primary");
            signupLogoutBtn.classList.add("btn-outline");
        }
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
            <div class="auth-curtain">
                <span class="auth-curtain-brand"><i></i>brawl analytics</span>
                <div class="auth-curtain-radar" aria-hidden="true">
                    <span class="auth-radar-ring auth-radar-ring--1"></span>
                    <span class="auth-radar-ring auth-radar-ring--2"></span>
                    <span class="auth-radar-ring auth-radar-ring--3"></span>
                    <span class="auth-radar-sweep"></span>
                    <span class="auth-radar-blip auth-radar-blip--1"></span>
                    <span class="auth-radar-blip auth-radar-blip--2"></span>
                    <span class="auth-radar-core"></span>
                </div>
                <div class="auth-curtain-foot">
                    <p class="auth-curtain-caption">analyze · predict · publish</p>
                    <div class="auth-curtain-socials">
                    <a href="https://www.tiktok.com/@brawl_analytics?is_from_webapp=1&amp;sender_device=pc" target="_blank" rel="noopener" tabindex="-1" aria-label="TikTok">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.8 3c.3 1.8 1.3 3 3.2 3.2v2.4c-1.2 0-2.3-.4-3.2-1v6.2a5.2 5.2 0 1 1-4.5-5.1v2.5a2.7 2.7 0 1 0 2 2.6V3h2.5Z" fill="currentColor"/></svg>
                    </a>
                    <a href="https://www.instagram.com/shiftmindset2026?utm_source=ig_web_button_share_sheet&amp;igsi=ZDNlZDc0MzIxNw==" target="_blank" rel="noopener" tabindex="-1" aria-label="Instagram">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>
                    </a>
                    </div>
                </div>
            </div>
            <div class="auth-content">
            <h2 class="auth-title" id="auth-modal-title">Create an account</h2>
            <p class="auth-switch">
                <span id="auth-switch-text">Already have an account?</span>
                <a href="#" id="auth-switch-link">Log in</a>
            </p>

            <div id="auth-message" class="auth-error" hidden></div>

            <div class="auth-panels">

                <form class="auth-form auth-login-form" id="auth-login-panel" hidden>
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

    const authModal = document.querySelector("#auth-modal-overlay .auth-modal");

    document.getElementById("auth-modal-title").textContent = mode === "login" ? "Welcome back" : "Create an account";
    document.getElementById("auth-switch-text").textContent = mode === "login" ? "Don't have an account?" : "Already have an account?";
    document.getElementById("auth-switch-link").textContent = mode === "login" ? "Sign up" : "Log in";

    hideAuthMessage();

    if(!loginPanel || !signupPanel || !authModal){
        return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const outgoing = mode === "login" ? signupPanel : loginPanel;
    const incoming = mode === "login" ? loginPanel : signupPanel;
    const isFirstRender = previousMode === mode || (loginPanel.hidden && signupPanel.hidden);

    // First render or reduced motion: place the curtain and form directly.
    if(isFirstRender || reduceMotion){
        authModal.classList.toggle("is-signup", mode === "signup");
        authModal.classList.toggle("curtain-to-right", mode === "login");
        authModal.classList.toggle("curtain-to-left", mode === "signup");
        loginPanel.hidden = mode !== "login";
        signupPanel.hidden = mode !== "signup";
        return;
    }

    const goingToSignup = mode === "signup";
    const exitClass = goingToSignup ? "auth-form-exit-left" : "auth-form-exit-right";
    const enterClass = goingToSignup ? "auth-form-enter-from-right" : "auth-form-enter-from-left";

    // Keep the previous layout for one frame. Then the mint curtain crosses
    // the old form while the next form slides in underneath it.
    incoming.hidden = false;
    incoming.classList.add(enterClass);
    outgoing.classList.add(exitClass);
    void incoming.offsetHeight;

    requestAnimationFrame(()=>{
        authModal.classList.toggle("is-signup", goingToSignup);
        authModal.classList.toggle("curtain-to-right", !goingToSignup);
        authModal.classList.toggle("curtain-to-left", goingToSignup);
        incoming.classList.remove(enterClass);
    });

    setTimeout(()=>{
        outgoing.hidden = true;
        outgoing.classList.remove(exitClass);
    }, 620);

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
            // Check if user was trying to access dashboard
            const dashboardBtn = document.getElementById("dashboard-or-login-btn");
            const wasDashboardIntent = dashboardBtn && dashboardBtn.textContent === "Dashboard";
            
            playSuccessTransition(async () => {
                closeAuthModal();
                // If user was trying to access dashboard, redirect there after login
                if(wasDashboardIntent){
                    try {
                        const { showApp } = await import("./js_router.js?v=20260826-router-fix");
                        showApp();
                    } catch (error) {
                        console.error("Failed to navigate to dashboard after login:", error);
                    }
                }
            });
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

/* ==========================================================
   PROFILE MODAL — multi-screen
   Screen 1: main (avatar, plan, credits, stats, buttons)
   Screen 2: password change
   Each button navigates to its own screen.
========================================================== */

let profileScreen = "main"; // "main" | "password"

function injectProfileModal(){

    if(document.getElementById("profile-modal-overlay")){
        return;
    }

    const overlay = document.createElement("div");
    overlay.id = "profile-modal-overlay";
    overlay.className = "modal-overlay";

    overlay.innerHTML = `
        <div class="modal profile-modal">
            <button type="button" class="profile-close" id="profile-modal-close" aria-label="Close">×</button>

            <!-- MAIN SCREEN -->
            <div id="profile-screen-main" class="profile-screen">
                <div class="profile-modal-header">
                    <div class="profile-modal-avatar" id="profile-avatar-large"></div>
                    <div class="profile-modal-info">
                        <div class="profile-modal-email" id="profile-email-display"></div>
                        <div class="profile-modal-plan" id="profile-plan-display">FREE PLAN</div>
                    </div>
                </div>

                <!-- Plan expiration (PRO only) -->
                <div id="profile-pro-info" class="profile-pro-info" hidden>
                    <div class="profile-pro-row">
                        <span class="profile-pro-label">Plan started</span>
                        <span class="profile-pro-value" id="profile-plan-started">—</span>
                    </div>
                    <div class="profile-pro-row">
                        <span class="profile-pro-label">Renews / expires</span>
                        <span class="profile-pro-value" id="profile-plan-expires">—</span>
                    </div>
                </div>

                <!-- Daily credits -->
                <div class="profile-section-title">Daily Credits</div>
                <div class="profile-credits">
                    <div class="profile-credit-item">
                        <span class="profile-credit-icon">🎬</span>
                        <div class="profile-credit-info">
                            <span class="profile-credit-label">Video analyses</span>
                            <span class="profile-credit-value" id="profile-video-credits">—</span>
                        </div>
                    </div>
                    <div class="profile-credit-item">
                        <span class="profile-credit-icon">💡</span>
                        <div class="profile-credit-info">
                            <span class="profile-credit-label">Idea generations</span>
                            <span class="profile-credit-value" id="profile-idea-credits">—</span>
                        </div>
                    </div>
                </div>

                <!-- Total stats -->
                <div class="profile-section-title">Your Stats</div>
                <div class="profile-stats">
                    <div class="profile-stat-item">
                        <span class="profile-stat-value" id="profile-total-ideas">0</span>
                        <span class="profile-stat-label">Ideas generated</span>
                    </div>
                    <div class="profile-stat-item">
                        <span class="profile-stat-value" id="profile-total-videos">0</span>
                        <span class="profile-stat-label">Videos analyzed</span>
                    </div>
                </div>

                <!-- Action buttons -->
                <div class="profile-actions">
                    <button type="button" class="btn btn-primary" id="profile-upgrade-btn">⬆ Upgrade to Pro</button>
                    <button type="button" class="btn btn-outline profile-menu-btn" id="profile-goto-password">🔑 Change Password</button>
                    <button type="button" class="btn btn-outline profile-menu-btn profile-logout-btn" id="profile-logout-btn">Logout</button>
                </div>
            </div>

            <!-- PASSWORD SCREEN -->
            <div id="profile-screen-password" class="profile-screen" hidden>
                <button type="button" class="profile-back-btn" id="profile-back-btn">← Back</button>
                <h3 class="profile-screen-title">Change Password</h3>
                <div id="profile-message" class="profile-message" hidden></div>
                <form id="profile-password-form">
                    <div class="profile-field">
                        <label for="profile-current-password">Current password</label>
                        <input type="password" id="profile-current-password" placeholder="Enter current password" autocomplete="current-password">
                    </div>
                    <div class="profile-field">
                        <label for="profile-new-password">New password</label>
                        <input type="password" id="profile-new-password" placeholder="Min 6 characters" autocomplete="new-password">
                    </div>
                    <div class="profile-field">
                        <label for="profile-confirm-new-password">Confirm new password</label>
                        <input type="password" id="profile-confirm-new-password" placeholder="Confirm new password" autocomplete="new-password">
                    </div>
                    <div class="profile-actions">
                        <button type="submit" class="btn btn-primary" id="profile-save-btn">Update Password</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("profile-modal-close").addEventListener("click", closeProfileModal);
    overlay.addEventListener("click", event => {
        if(event.target === overlay) closeProfileModal();
    });

    // Navigation between screens
    document.getElementById("profile-goto-password").addEventListener("click", () => showProfileScreen("password"));
    document.getElementById("profile-back-btn").addEventListener("click", () => showProfileScreen("main"));

    // Upgrade button → opens existing upgrade modal
    document.getElementById("profile-upgrade-btn").addEventListener("click", async () => {
        closeProfileModal();
        try {
            const { openUpgradeModal } = await import("./js_subscription.js?v=20260825-profile-18");
            openUpgradeModal();
        } catch(e) { console.error("Failed to open upgrade modal:", e); }
    });

    // Password form
    document.getElementById("profile-password-form").addEventListener("submit", event => {
        event.preventDefault();
        handlePasswordChange();
    });

    // Logout
    document.getElementById("profile-logout-btn").addEventListener("click", async () => {
        const result = await logout();
        if(!result.success) console.error("Logout error:", result.error);
        closeProfileModal();
    });

}

function showProfileScreen(screen){
    profileScreen = screen;
    document.getElementById("profile-screen-main").hidden = screen !== "main";
    document.getElementById("profile-screen-password").hidden = screen !== "password";
    // Clear message when switching
    const msg = document.getElementById("profile-message");
    if(msg) msg.hidden = true;
}

async function openProfileModal(){

    injectProfileModal();
    showProfileScreen("main");
    const user = getCurrentUser();
    if(!user) return;

    const email = user.email || "";
    const initial = email.charAt(0).toUpperCase() || "U";

    document.getElementById("profile-avatar-large").textContent = initial;
    document.getElementById("profile-email-display").textContent = email;

    // Ricarica lo stato da Supabase: il profilo deve riflettere sempre il
    // piano corrente del DB (anche aprendolo dalla landing prima che la
    // dashboard abbia inizializzato lo stato, o dopo modifiche manuali).
    try {
        const { refreshUsageStatus } = await import("./js_subscription.js?v=20260825-profile-18");
        await refreshUsageStatus();
    } catch(e) {
        console.warn("Profile: unable to refresh subscription status", e);
    }

    // Populate plan info
    populateProfilePlanInfo();

    // Populate credits
    populateProfileCredits();

    // Populate total stats
    populateProfileStats();

    // Clear password form
    ["profile-current-password", "profile-new-password", "profile-confirm-new-password"].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = "";
    });

    document.getElementById("profile-modal-overlay")?.classList.add("active");

}

function closeProfileModal(){
    document.getElementById("profile-modal-overlay")?.classList.remove("active");
}

async function populateProfilePlanInfo(){

    try {
        const { getCurrentPlan, isProPlan, getSubscriptionStatus } = await import("./js_subscription.js?v=20260825-profile-18");
        const plan = getCurrentPlan();
        const { currentPeriodEnd, proStartedAt } = getSubscriptionStatus();

        const planLabel = document.getElementById("profile-plan-display");
        const proInfo = document.getElementById("profile-pro-info");
        const upgradeBtn = document.getElementById("profile-upgrade-btn");

        if(isProPlan(plan)){
            if(planLabel) planLabel.textContent = "PRO PLAN";
            if(proInfo) proInfo.hidden = false;

            const endDate = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
            const startDate = proStartedAt ? new Date(proStartedAt) : null;
            const fmt = { year: 'numeric', month: 'short', day: 'numeric' };
            const startedEl = document.getElementById("profile-plan-started");
            const expiresEl = document.getElementById("profile-plan-expires");
            if(startedEl) startedEl.textContent = startDate ? startDate.toLocaleDateString('en-US', fmt) : "not available yet";
            // Prefer the real Stripe period end; otherwise derive it as
            // pro_started_at + 30 days (monthly) / 365 days (annual).
            let end = currentPeriodEnd;
            if(!end && startDate) end = new Date(startDate.getTime() + (plan === "pro_a" ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();
            if(expiresEl) expiresEl.textContent = end ? new Date(end).toLocaleDateString('en-US', fmt) : "not available yet";

            if(upgradeBtn) upgradeBtn.hidden = true; // already pro

        } else {
            if(planLabel) planLabel.textContent = "FREE PLAN";
            if(proInfo) proInfo.hidden = true;
            if(upgradeBtn) upgradeBtn.hidden = false;
        }

    } catch(e) {
        console.warn("Profile: unable to load plan info", e);
    }

}

async function populateProfileCredits(){

    try {
        const { getRemainingVideoAnalyses, getRemainingIdeaGenerations, getCurrentPlan, isProPlan } = await import("./js_subscription.js?v=20260825-profile-18");
        const plan = getCurrentPlan();
        const videoEl = document.getElementById("profile-video-credits");
        const ideaEl = document.getElementById("profile-idea-credits");

        if(isProPlan(plan)){
            if(videoEl) videoEl.textContent = "∞ Unlimited";
            if(ideaEl) ideaEl.textContent = "∞ Unlimited";
        } else {
            const v = getRemainingVideoAnalyses();
            const i = getRemainingIdeaGenerations();
            if(videoEl) videoEl.textContent = `${v} / 1 remaining today`;
            if(ideaEl) ideaEl.textContent = `${i} / 3 remaining today`;
        }

    } catch(e) {
        console.warn("Profile: unable to load credits", e);
    }

}

async function populateProfileStats(){

    try {
        const supabase = await getSupabaseClient();
        if(!supabase) return;

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return;

        const { data: stats } = await supabase
            .from("profiles")
            .select("total_ideas_generated, total_videos_analyzed")
            .eq("id", user.id)
            .maybeSingle();

        const ideasEl = document.getElementById("profile-total-ideas");
        const videosEl = document.getElementById("profile-total-videos");

        if(ideasEl) ideasEl.textContent = stats?.total_ideas_generated || 0;
        if(videosEl) videosEl.textContent = stats?.total_videos_analyzed || 0;

    } catch(e) {
        console.warn("Profile: unable to load stats", e);
    }

}

async function handlePasswordChange(){

    const currentPassword = document.getElementById("profile-current-password").value;
    const newPassword = document.getElementById("profile-new-password").value;
    const confirmPassword = document.getElementById("profile-confirm-new-password").value;
    const msg = document.getElementById("profile-message");
    const saveBtn = document.getElementById("profile-save-btn");

    if(!currentPassword || !newPassword || !confirmPassword){
        if(msg){ msg.textContent = "Please fill in all fields."; msg.className = "profile-message error"; msg.hidden = false; }
        return;
    }

    if(newPassword.length < 6){
        if(msg){ msg.textContent = "New password must be at least 6 characters."; msg.className = "profile-message error"; msg.hidden = false; }
        return;
    }

    if(newPassword !== confirmPassword){
        if(msg){ msg.textContent = "New passwords do not match."; msg.className = "profile-message error"; msg.hidden = false; }
        return;
    }

    if(currentPassword === newPassword){
        if(msg){ msg.textContent = "New password must be different from current password."; msg.className = "profile-message error"; msg.hidden = false; }
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Updating...";

    try{
        const supabase = await getSupabaseClient();
        if(!supabase){
            if(msg){ msg.textContent = "Auth service unavailable."; msg.className = "profile-message error"; msg.hidden = false; }
            return;
        }

        // Verify current password
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: currentUser.email,
            password: currentPassword
        });

        if(signInError){
            if(msg){ msg.textContent = "Current password is incorrect."; msg.className = "profile-message error"; msg.hidden = false; }
            return;
        }

        // Update password
        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

        if(updateError){
            if(msg){ msg.textContent = mapAuthError(updateError); msg.className = "profile-message error"; msg.hidden = false; }
        } else {
            if(msg){ msg.textContent = "Password updated successfully!"; msg.className = "profile-message success"; msg.hidden = false; }
            ["profile-current-password", "profile-new-password", "profile-confirm-new-password"].forEach(id => {
                const el = document.getElementById(id);
                if(el) el.value = "";
            });
        }

    } catch(error){
        if(msg){ msg.textContent = "Something went wrong. Please try again."; msg.className = "profile-message error"; msg.hidden = false; }
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Update Password";
    }

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
    closeAuthModal,
    openProfileModal,
    closeProfileModal
};