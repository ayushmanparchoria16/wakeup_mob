/**
 * Interviewbold - Logic Script
 * Handles Speech Recognition, Puter.js AI Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    // Audio Analysis Settings
    MIN_DECIBELS: -45, // Threshold for detecting speech
    SILENCE_DELAY_MS: 1200, // How long to wait in silence before sending audio
    AI_PROXY_URL: "https://interviewbold.ayushmanparchoria16.workers.dev",
};

const state = {
    topic: '',
    isRecording: false,
    transcriptLog: [],
    aiLog: [],
    chatHistory: [],

    // Mobile Audio Pipeline
    audioContext: null,
    analyser: null,
    recognition: null,
    stream: null,

    // VAD Logic Context
    isSpeaking: false,
    silenceStartTime: 0,
    analysisInterval: null,

    isProcessingAI: false,
    pendingBuffer: "",
    lastAiCallTime: 0,

    currentSessionBuffer: "",
    currentUser: null,
    deepgramKey: localStorage.getItem('deepgram_api_key') || '',
    deepgramSocket: null,
    mediaRecorder: null,

    micMode: 'SPEECH',
    activeRecMode: 'SPEECH',
    lastFinishedMode: null,
    forceNewBubble: false,
    usageRefreshInterval: null,
    isDemoMode: false,
    demoKey: "",
    demoProviderEmail: "",
    demoResponsesCount: 0,
    pendingScreenshots: []
};

// --- Mobile & Modal Controls ---
function openSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeSubscriptionModal() {
    const modal = document.getElementById('subscription-modal');
    if (modal) modal.classList.add('hidden');
}

function openUpiModal() {
    if (!state.currentUser) return showToast("Please login first");
    
    // Hide sub modal if open
    closeSubscriptionModal();

    // Pre-fill email
    const upiEmailInput = document.getElementById('upi-email');
    if (upiEmailInput) upiEmailInput.value = state.currentUser.email;

    // Expiry calculation
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 31);
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    const formatted = expiryDate.toLocaleDateString('en-IN', options);
    const el = document.getElementById('upi-expiry-date');
    if (el) el.textContent = formatted;

    const upiModal = document.getElementById('upi-modal');
    if (upiModal) upiModal.classList.remove('hidden');
}

function switchMeetingTab(tabId) {
    const panels = {
        ai: document.getElementById('ai-panel'),
        transcript: document.getElementById('transcript-panel')
    };
    const tabs = {
        ai: document.getElementById('tab-ai'),
        transcript: document.getElementById('tab-transcript')
    };

    // Update active classes
    Object.keys(panels).forEach(key => {
        if (key === tabId) {
            panels[key].classList.add('active');
            tabs[key].classList.add('active');
        } else {
            panels[key].classList.remove('active');
            tabs[key].classList.remove('active');
        }
    });

    // Scroll to bottom of new active feed
    if (tabId === 'ai') scrollToBottom(document.getElementById('ai-feed'));
    else scrollToBottom(document.getElementById('transcript-feed'));
}


// --- DOM Elements ---
const screens = {
    auth: document.getElementById('auth-screen'),
    setup: document.getElementById('setup-screen'),
    meeting: document.getElementById('meeting-screen'),
    end: document.getElementById('end-screen')
};

const inputs = {
    topic: document.getElementById('topic-input'),
    loginEmail: document.getElementById('login-email'),
    loginPass: document.getElementById('login-password'),
    regName: document.getElementById('register-name'),
    regEmail: document.getElementById('register-email'),
    regPass: document.getElementById('register-password'),
    forgotEmail: document.getElementById('forgot-email'),
    deepgramKey: document.getElementById('deepgram-key-input')
};

const buttons = {
    start: document.getElementById('start-btn'),
    quickReplyMeeting: document.getElementById('quick-reply-meeting-btn'),
    endMeeting: document.getElementById('end-session-btn'),
    micToggle: document.getElementById('mic-toggle-btn'),
    screenshot: document.getElementById('screenshot-btn'),
    download: document.getElementById('download-btn'),
    clearExit: document.getElementById('clear-exit-btn'),
    // Auth buttons
    tabLogin: document.getElementById('tab-login'),
    tabReg: document.getElementById('tab-register'),
    login: document.getElementById('login-btn'),
    register: document.getElementById('register-btn'),
    forgotLink: document.getElementById('forgot-password-link'),
    forgotSubmit: document.getElementById('forgot-btn'),
    backLogin: document.getElementById('back-to-login-btn'),
    logout: document.getElementById('logout-link'),
    switchAccount: document.getElementById('switch-account-link'),
    connectPuter: document.getElementById('connect-puter-btn'),
    initByokBtn: document.getElementById('init-byok-btn'),
    startDemoBtn: document.getElementById('start-demo-btn'),
    showDevCardBtn: document.getElementById('show-dev-card-btn'),
    changeKeysBtn: document.getElementById('change-keys-btn'),
    upgradePremiumLink: document.getElementById('upgrade-premium-link'),
    validateKey: document.getElementById('validate-key-btn'),
    // Subscription/UPI
    subscribeMain: document.getElementById('open-subscription-modal-btn'),
    submitUpi: document.getElementById('submit-upi-btn')
};

const displays = {
    topic: document.getElementById('display-topic'),
    userName: document.getElementById('user-display-name'),
    transcriptFeed: document.getElementById('transcript-feed'),
    aiFeed: document.getElementById('ai-feed'),
    status: document.getElementById('status-text'),
    vadStatus: document.getElementById('vad-status'),
    visualizerBars: document.querySelectorAll('.bar'),
    statWords: document.getElementById('stat-words'),
    statInsights: document.getElementById('stat-insights'),
    toast: document.getElementById('toast'),
    // Forms
    loginForm: document.getElementById('login-form'),
    regForm: document.getElementById('register-form'),
    forgotForm: document.getElementById('forgot-form'),
    keyStatus: document.getElementById('key-status'),
    dgStatusContainer: document.getElementById('dg-status-container'),
    dgSetupSteps: document.getElementById('deepgram-setup-steps'),
    puterConnectArea: document.getElementById('puter-connect-area'),
    gatedMeetingArea: document.getElementById('gated-meeting-area'),
    resourceCard: document.getElementById('resource-status-card'),
    puterResetArea: document.getElementById('puter-reset-area'),
    onboardingOptions: document.getElementById('onboarding-options'),
    devCardOptions: document.getElementById('dev-card-options'),
    byokSetupArea: document.getElementById('byok-setup-area'),
    activeSessionOptions: document.getElementById('active-session-options'),
    premiumBadge: document.getElementById('premium-badge'),
    premiumExpiry: document.getElementById('premium-expiry'),
    upiModal: document.getElementById('upi-modal')
};

// --- Initialization ---

function init() {
    // Initialize Paddle
    try {
        if (typeof Paddle !== 'undefined') {
            Paddle.Initialize({
                token: "live_7bd4c07bde83385e5960f2c8cda",
                environment: "production"
            });
        }
    } catch (err) {
        console.error("Paddle initialization failed:", err);
    }

    // Check local storage for user
    const savedUser = localStorage.getItem('interviewbold_user');
    if (savedUser) {
        try {
            state.currentUser = JSON.parse(savedUser);
            displays.userName.textContent = state.currentUser.displayName || state.currentUser.email.split('@')[0];
            switchScreen('setup');

            // Background refresh to catch manual SubscriptionStatus changes
            const params = new URLSearchParams();
            params.append('action', 'getUser');
            params.append('email', state.currentUser.email);
            fetch(GOOGLE_URL, { method: 'POST', body: params })
                .then(r => r.json())
                .then(data => {
                    if (data.status === 'success' && data.user) {
                        state.currentUser = data.user;
                        localStorage.setItem('interviewbold_user', JSON.stringify(data.user));
                        checkSetupStatus(); // refresh UI based on latest tier
                    }
                }).catch(e => console.error("Silent user refresh failed", e));

        } catch (e) {
            console.error("Failed to parse user", e);
            switchScreen('auth');
        }
    } else {
        switchScreen('auth');
    }

    // Check protocol
    if (window.location.protocol === 'file:') {
        showToast("⚠️ Run via Local Server to save permissions!");
    }

    // Event Listeners
    buttons.start.addEventListener('click', startSession);
    if (buttons.quickReplyMeeting) buttons.quickReplyMeeting.addEventListener('click', quickReply);
    buttons.endMeeting.addEventListener('click', endSession);
    buttons.micToggle.addEventListener('click', toggleMic);
    buttons.download.addEventListener('click', downloadTranscript);
    buttons.clearExit.addEventListener('click', clearAndExit);

    if (buttons.validateKey) {
        buttons.validateKey.addEventListener('click', handleKeyValidation);
    }

    if (buttons.submitUpi) {
        buttons.submitUpi.addEventListener('click', handleUPIPaymentSubmit);
    }

    if (buttons.initByokBtn) {
        buttons.initByokBtn.addEventListener('click', (e) => {
            e.preventDefault();
            buttons.initByokBtn.classList.add('hidden');
            displays.byokSetupArea.classList.remove('hidden');
        });
    }

    if (inputs.deepgramKey) {
        inputs.deepgramKey.addEventListener('input', () => {
            // Reset "Saved" state if key changes
            state.deepgramKey = "";
            localStorage.removeItem('deepgram_api_key');

            if (buttons.validateKey) {
                buttons.validateKey.innerHTML = 'Verify';
                buttons.validateKey.style.borderColor = "";
                buttons.validateKey.style.color = "";
            }
            if (displays.dgSetupSteps) displays.dgSetupSteps.classList.remove('hidden');
            if (displays.dgStatusContainer) displays.dgStatusContainer.classList.add('hidden');

            checkSetupStatus();
        });
    }

    // Auth Listeners
    setupAuthListeners();

    if (buttons.screenshot) {
        buttons.screenshot.addEventListener('click', () => {
            if (window.electronAPI) window.electronAPI.takeScreenshot();
            else showToast("Screenshot only available in Desktop App");
        });
    }

    if (buttons.switchAccount) {
        buttons.switchAccount.addEventListener('click', async (e) => {
            e.preventDefault();
            showToast("Clearing AI Account data...", 2000);

            try {
                if (puter.auth.isSignedIn()) {
                    puter.auth.signOut();
                }
            } catch (err) {
                console.warn("Puter signout failed:", err);
            }

            // Aggressively clear local and session storage
            const savedUser = localStorage.getItem('interviewbold_user');
            const savedDeepgram = localStorage.getItem('deepgram_api_key');
            localStorage.clear();
            sessionStorage.clear();

            // Restore our user and key
            if (savedUser) localStorage.setItem('interviewbold_user', savedUser);
            if (savedDeepgram) localStorage.setItem('deepgram_api_key', savedDeepgram);

            // Clear all cookies
            document.cookie.split(";").forEach((c) => {
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
            });

            setTimeout(() => {
                showToast("Account data cleared. Please start a session to login again.", 3000);
                setTimeout(() => {
                    window.location.reload(true);
                }, 1500);
            }, 1000);
        });
    }

    // Start usage refreshing if we're in setup screen
    if (screens.setup.classList.contains('active')) {
        startUsageRefresh();
    }

    // Feedback Listeners
    setupFeedbackListeners();

    // Spacebar to toggle mic
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT' && screens.meeting.classList.contains('active')) {
            e.preventDefault();
            toggleMic();
        }
    });

    if (buttons.connectPuter) {
        buttons.connectPuter.addEventListener('click', async () => {
            await puter.auth.signIn();
            checkSetupStatus();
        });
    }

    if (buttons.changeKeysBtn) {
        buttons.changeKeysBtn.addEventListener('click', (e) => {
            e.preventDefault();
            displays.gatedMeetingArea.classList.add('hidden');
            displays.onboardingOptions.classList.remove('hidden');
            buttons.initByokBtn.classList.add('hidden');
            displays.byokSetupArea.classList.remove('hidden');
            if (inputs.deepgramKey) {
                inputs.deepgramKey.focus();
            }
        });
    }

    if (buttons.startDemoBtn) {
        buttons.startDemoBtn.addEventListener('click', () => {
            showToast("Initializing Demo Mode...", 2000);
            startSession(true);
        });
    }

    // Initial check
    checkSetupStatus();
}

/**
 * Checks if both Puter and Deepgram are ready to show the meeting setup
 */
function checkSetupStatus() {
    // Ensure we have a user
    if (!state.currentUser) return;

    const isPuterReady = puter.auth.isSignedIn();
    const isDeepgramReady = !!state.deepgramKey;
    const isPremium = state.currentUser?.SubscriptionStatus === 'Active';

    const isDemo = !!state.isDemoMode;

    // Puter Toggle - Mandatory for Free/BYOK. Auto-Ready for Paid/Demo.
    if (isPuterReady || isPremium || isDemo) {
        if (displays.puterConnectArea) displays.puterConnectArea.classList.add('hidden');
        if (displays.resourceCard) displays.resourceCard.classList.remove('hidden');
        if (displays.puterResetArea) displays.puterResetArea.classList.remove('hidden');
        // Trigger a refresh of the actual numbers
        updateResourceStatus();
    } else {
        if (displays.puterConnectArea) displays.puterConnectArea.classList.remove('hidden');
        if (displays.resourceCard) displays.resourceCard.classList.add('hidden');
        if (displays.puterResetArea) displays.puterResetArea.classList.add('hidden');
    }

    // Tier Logic
    const demoSessionsDone = parseInt(state.currentUser?.DemoSessionsDone || 0);

    // 1. Premium UI
    if (isPremium) {
        if (displays.premiumBadge) displays.premiumBadge.classList.remove('hidden');
        if (displays.premiumExpiry && state.currentUser.SubscriptionExpiry) {
            const d = new Date(state.currentUser.SubscriptionExpiry);
            if (!isNaN(d)) {
                displays.premiumExpiry.textContent = "Expires: " + d.toLocaleDateString();
                displays.premiumExpiry.classList.remove('hidden');
            }
        }
        // Hide onboarding options (Subscribe/Demo/BYOK)
        if (displays.onboardingOptions) displays.onboardingOptions.classList.add('hidden');
        // Show Start Session area
        if (displays.gatedMeetingArea) displays.gatedMeetingArea.classList.remove('hidden');
        // Hide Upgrade/Change Keys links since they are premium
        if (displays.activeSessionOptions) displays.activeSessionOptions.classList.add('hidden');
    } else {
        if (displays.premiumBadge) displays.premiumBadge.classList.add('hidden');
        if (displays.premiumExpiry) displays.premiumExpiry.classList.add('hidden');
        if (displays.activeSessionOptions) displays.activeSessionOptions.classList.remove('hidden');

        // 2. Demo & BYOK Gating
        if (displays.onboardingOptions) displays.onboardingOptions.classList.remove('hidden');

        // Hide Demo if BYOK is ready
        const demoCard = document.querySelector('.demo-card');
        if (demoCard) {
            if (isDeepgramReady || demoSessionsDone >= 3) {
                demoCard.classList.add('hidden');
            } else {
                demoCard.classList.remove('hidden');
                // Update demo text
                const demoP = demoCard.querySelector('p');
                if (demoP) demoP.innerHTML = `Free 5 questions per session.<br><small>(${3 - demoSessionsDone} sessions remaining)</small>`;
            }
        }

        // Show Start Session if BYOK is ready (and Puter is ready)
        if (isDeepgramReady && isPuterReady) {
            if (displays.gatedMeetingArea) displays.gatedMeetingArea.classList.remove('hidden');
            // Show BYOK status
            if (displays.dgStatusContainer) displays.dgStatusContainer.classList.remove('hidden');
            if (buttons.validateKey) {
                buttons.validateKey.innerHTML = '<span class="material-icons-round" style="font-size: 16px; color: #4ade80;">check_circle</span> Verified';
                buttons.validateKey.style.borderColor = "#4ade80";
                buttons.validateKey.style.color = "#4ade80";
            }
        } else {
            if (displays.gatedMeetingArea) displays.gatedMeetingArea.classList.add('hidden');
            // If they are not ready, revert button label if no key
            if (!isDeepgramReady && buttons.validateKey) {
                buttons.validateKey.innerHTML = 'Verify';
            }
        }
    }

    // Puter & Resources Logic
    if (isPuterReady) {
        if (displays.puterConnectArea) displays.puterConnectArea.classList.add('hidden');
        if (displays.resourceCard) displays.resourceCard.classList.remove('hidden');
        if (displays.puterResetArea) displays.puterResetArea.classList.remove('hidden');
        updateResourceStatus();
    } else {
        if (displays.puterConnectArea) displays.puterConnectArea.classList.remove('hidden');
        if (displays.resourceCard) displays.resourceCard.classList.add('hidden');
        if (displays.puterResetArea) displays.puterResetArea.classList.add('hidden');
    }

    // Auto-login to Puter if possible
    if (!isPuterReady && !state.isPuterChecking) {
        state.isPuterChecking = true;
        puter.auth.isSignedIn() ? checkSetupStatus() : null;
    }
}

// --- Auth Logic ---
function setupAuthListeners() {
    // Tabs
    buttons.tabLogin.addEventListener('click', () => {
        buttons.tabLogin.classList.add('active');
        buttons.tabReg.classList.remove('active');
        displays.loginForm.classList.remove('hidden');
        displays.regForm.classList.add('hidden');
        displays.forgotForm.classList.add('hidden');
    });

    buttons.tabReg.addEventListener('click', () => {
        buttons.tabReg.classList.add('active');
        buttons.tabLogin.classList.remove('active');
        displays.regForm.classList.remove('hidden');
        displays.loginForm.classList.add('hidden');
        displays.forgotForm.classList.add('hidden');
    });

    // Forgot Password Flow
    buttons.forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        displays.loginForm.classList.add('hidden');
        displays.forgotForm.classList.remove('hidden');
        buttons.tabLogin.classList.remove('active');
        buttons.tabReg.classList.remove('active');
    });

    buttons.backLogin.addEventListener('click', () => {
        displays.forgotForm.classList.add('hidden');
        displays.loginForm.classList.remove('hidden');
        buttons.tabLogin.classList.add('active');
    });

    // Submit Actions
    buttons.login.addEventListener('click', handleLogin);
    buttons.register.addEventListener('click', handleRegister);
    buttons.logout.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
    });
    buttons.forgotSubmit.addEventListener('click', handleForgotPassword);
}

async function handleLogin() {
    const email = inputs.loginEmail.value.trim();
    const pass = inputs.loginPass.value;

    if (!email || !pass) return showToast("Please enter email and password");

    setLoading(buttons.login, true);

    try {
        const params = new URLSearchParams();
        params.append('action', 'login');
        params.append('email', email);
        params.append('password', pass);

        const res = await fetch(GOOGLE_URL, {
            method: 'POST',
            body: params,
            redirect: 'follow'
        });

        const textData = await res.text();
        let data;
        try {
            data = JSON.parse(textData);
        } catch (e) {
            console.error("Raw response:", textData);
            throw new Error("Invalid JSON response from server");
        }

        if (data.status === 'success') {
            state.currentUser = data.user;
            localStorage.setItem('interviewbold_user', JSON.stringify(data.user));
            displays.userName.textContent = data.user.displayName;
            switchScreen('setup');
            checkSetupStatus();
            startUsageRefresh();
            showToast("Login successful!");
        } else {
            showToast(data.message || "Login failed");
        }
    } catch (err) {
        showToast("Error connecting to server");
        console.error(err);
    } finally {
        setLoading(buttons.login, false);
    }
}

async function handleRegister() {
    const name = inputs.regName.value.trim();
    const email = inputs.regEmail.value.trim();
    const pass = inputs.regPass.value;

    if (!email || !pass) return showToast("Email and password required");

    setLoading(buttons.register, true);

    try {
        const params = new URLSearchParams();
        params.append('action', 'register');
        params.append('email', email);
        params.append('password', pass);
        params.append('displayName', name || email.split('@')[0]);

        const res = await fetch(GOOGLE_URL, {
            method: 'POST',
            body: params,
            redirect: 'follow'
        });

        const textData = await res.text();
        let data;
        try {
            data = JSON.parse(textData);
        } catch (e) {
            console.error("Raw response:", textData);
            throw new Error("Invalid JSON response from server");
        }

        if (data.status === 'success') {
            showToast("Registration successful! Please login.");
            buttons.tabLogin.click(); // Switch to login tab
            inputs.loginEmail.value = email; // Pre-fill email
        } else {
            showToast(data.message || "Registration failed");
        }
    } catch (err) {
        showToast("Error connecting to server");
        console.error(err);
    } finally {
        setLoading(buttons.register, false);
    }
}

async function handleForgotPassword() {
    const email = inputs.forgotEmail.value.trim();
    if (!email) return showToast("Please enter your email");

    setLoading(buttons.forgotSubmit, true);

    try {
        const params = new URLSearchParams();
        params.append('action', 'forgotPassword');
        params.append('email', email);

        const res = await fetch(GOOGLE_URL, {
            method: 'POST',
            body: params,
            redirect: 'follow'
        });

        const textData = await res.text();
        let data;
        try {
            data = JSON.parse(textData);
        } catch (e) {
            console.error("Raw response:", textData);
            throw new Error("Invalid JSON response from server");
        }

        if (data.status === 'success') {
            showToast(data.message || "A temporary password was sent.", 4000);
            buttons.backLogin.click();
        } else {
            // Still show a generic message for security if desired, or error.
            showToast(data.message || "If this email exists, a reset link was sent.", 4000);
            buttons.backLogin.click();
        }
    } catch (err) {
        showToast("Error connecting to server");
        console.error(err);
    } finally {
        setLoading(buttons.forgotSubmit, false);
    }
}

async function handleLogout() {
    if (puter.auth.isSignedIn()) {
        puter.auth.signOut();
    }

    if (state.currentUser) {
        try {
            const params = new URLSearchParams();
            params.append('action', 'logout');
            params.append('email', state.currentUser.email);

            await fetch(GOOGLE_URL, {
                method: 'POST',
                body: params,
                redirect: 'follow'
            });
        } catch (e) { }
    }

    state.currentUser = null;
    localStorage.removeItem('interviewbold_user');
    inputs.topic.value = '';
    switchScreen('auth');
    stopUsageRefresh();
    showToast("Logged out successfully");
}

function setLoading(btn, isLoading) {
    if (isLoading) {
        btn.classList.add('btn-loading');
    } else {
        btn.classList.remove('btn-loading');
    }
}

// --- Audio & VAD Setup ---

async function setupMobileFriendlyAudio() {
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // 1. Setup AudioContext for visualizer
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = state.audioContext.createMediaStreamSource(state.stream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.minDecibels = CONFIG.MIN_DECIBELS;
        state.analyser.fftSize = 256;
        source.connect(state.analyser);

        // 2. Start our custom visualizer loop
        startVisualizerLoop();

        showToast("Audio Ready!");
        displays.vadStatus.textContent = "VAD: Ready";
        displays.vadStatus.classList.remove('hidden');
        return true;

    } catch (e) {
        console.error("Audio Setup Failed:", e);
        showToast("Audio Access Denied: " + e.message);
        return false;
    }
}

// --- Deepgram Implementation ---
function initDeepgram() {
    return new Promise((resolve, reject) => {
        const activeKey = state.isDemoMode ? state.demoKey : state.deepgramKey;
        if (!activeKey) {
            showToast("Deepgram API Key is missing!");
            return reject("No Key");
        }

        // Add debug status indicator if not present
        let debugStatus = document.getElementById('asr-debug-status');
        if (!debugStatus) {
            debugStatus = document.createElement('div');
            debugStatus.id = 'asr-debug-status';
            debugStatus.style.cssText = "font-size: 11px; color: #888; padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 10px; background: rgba(0,0,0,0.2);";
            displays.transcriptFeed.prepend(debugStatus);
        }
        debugStatus.textContent = "Connecting to Deepgram...";
        state.chunkCount = 0;

        console.log("Initializing Deepgram...");
        const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&filler_words=true&keepalive=true';
        state.deepgramSocket = new WebSocket(url, ['token', activeKey]);

        state.deepgramSocket.onopen = () => {
            console.log("✅ Deepgram WebSocket opened");
            debugStatus.textContent = "✅ Connected. Waiting for Audio...";
            debugStatus.style.color = "#4ade80";
            displays.vadStatus.textContent = "VAD: Listening (Deepgram)";
            displays.vadStatus.classList.remove('hidden');

            // Remove placeholder immediately on connect
            const placeholder = displays.transcriptFeed.querySelector('.placeholder-text');
            if (placeholder) placeholder.remove();
            resolve();
        };

        state.deepgramSocket.onmessage = (message) => {
            try {
                const received = JSON.parse(message.data);
                if (received.type === 'Metadata') return;

                if (!received.channel || !received.channel.alternatives) return;

                const transcript = received.channel.alternatives[0].transcript;
                if (transcript) {
                    debugStatus.textContent = `📡 Receiving: "${transcript.substring(0, 20)}..."`;
                    debugStatus.style.color = "#64ffda";
                }

                if (transcript && received.is_final) {
                    const text = transcript.trim();
                    if (text.length > 0) {
                        state.currentSessionBuffer += text + " ";
                        state.transcriptLog.push({
                            timestamp: new Date().toLocaleTimeString(),
                            text: text,
                            mode: 'SPEECH'
                        });
                        addTranscriptBubble(text, 'SPEECH');
                        updateTranscriptUI("", "", 'SPEECH');

                        state.pendingBuffer = "";
                        state.silenceStartTime = 0;
                    }
                } else if (transcript) {
                    updateTranscriptUI("", transcript.trim(), 'SPEECH');
                    state.pendingBuffer = transcript.trim();
                    state.silenceStartTime = Date.now();
                    updateVadUI(true);
                }
            } catch (e) {
                console.error("Deepgram message parse error:", e);
            }
        };

        state.deepgramSocket.onerror = (err) => {
            console.error("❌ Deepgram WebSocket Error:", err);
            debugStatus.textContent = "❌ Connection Error - Check Key";
            debugStatus.style.color = "#ff5252";
            reject(err);
        };

        state.deepgramSocket.onclose = (event) => {
            console.log("Deepgram WebSocket closed:", event.code, event.reason);
            debugStatus.textContent = `⚠️ Closed (${event.code})`;
            debugStatus.style.color = "#fbbf24";

            // Simple re-connection logic for unexpected closure
            if (event.code !== 1000 && state.isRecording) {
                console.log("Attempting re-connection...");
                setTimeout(() => {
                    if (state.isRecording && (!state.deepgramSocket || state.deepgramSocket.readyState !== 1)) {
                        initDeepgram().catch(e => console.error("Re-connection failed:", e));
                    }
                }, 2000);
            }
        };
    });
}

async function startStreaming() {
    try {
        if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        // Try to find a supported mimeType
        const types = ['audio/webm; codecs=opus', 'audio/webm', 'audio/ogg; codecs=opus', 'audio/wav'];
        let mimeType = types.find(t => MediaRecorder.isTypeSupported(t));

        console.log("Using MimeType:", mimeType);
        state.mediaRecorder = new MediaRecorder(state.stream, { mimeType });

        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && state.deepgramSocket?.readyState === 1) {
                state.deepgramSocket.send(event.data);
                state.chunkCount++;

                const debugStatus = document.getElementById('asr-debug-status');
                if (debugStatus && state.chunkCount % 4 === 0) { // Update every ~1s
                    debugStatus.textContent = `✅ Streaming: ${state.chunkCount} chunks sent`;
                    debugStatus.style.color = "#4ade80";
                }
            }
        };

        state.mediaRecorder.onerror = (e) => {
            console.error("MediaRecorder Error:", e);
            const debugStatus = document.getElementById('asr-debug-status');
            if (debugStatus) debugStatus.textContent = "❌ Mic Stream Error";
        };
        state.mediaRecorder.onstart = () => console.log("MediaRecorder Started");

        state.mediaRecorder.start(250);
    } catch (err) {
        console.error("Microphone Error:", err);
        showToast("Could not access microphone");
    }
}

function stopStreaming() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
    state.mediaRecorder = null;

    if (state.deepgramSocket) {
        state.deepgramSocket.close();
        state.deepgramSocket = null;
    }

    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
        state.stream = null;
    }
}

// --- Visualizer Loop ---
function startVisualizerLoop() {
    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    const checkVolume = () => {
        if (!state.isRecording) {
            state.analysisInterval = requestAnimationFrame(checkVolume);
            return;
        }

        // Silence Check (Responsive Finalization)
        if (state.pendingBuffer && (Date.now() - state.silenceStartTime > CONFIG.SILENCE_DELAY_MS)) {
            const text = state.pendingBuffer;
            state.pendingBuffer = "";
            state.silenceStartTime = 0;
            state.currentSessionBuffer += text + " ";
            state.transcriptLog.push({
                timestamp: new Date().toLocaleTimeString(),
                text: text,
                mode: 'SPEECH'
            });
            addTranscriptBubble(text, 'SPEECH');
            updateTranscriptUI("", "", 'SPEECH');
        }

        state.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const averageVolume = sum / dataArray.length;
        simulateVisualizerVolume(averageVolume);
        state.analysisInterval = requestAnimationFrame(checkVolume);
    };
    state.analysisInterval = requestAnimationFrame(checkVolume);
}

// Init Deepgram Key UI
if (inputs.deepgramKey) inputs.deepgramKey.value = state.deepgramKey;

// --- Tab Switching (Login/Register) ---
// --- Main Session Logic ---
async function startSession(isDemo = false) {
    if (!state.currentUser) {
        showToast("Please login first.");
        switchScreen('auth');
        return;
    }

    state.isDemoMode = isDemo === true;
    state.demoResponsesCount = 0;

    if (state.isDemoMode) {
        const demoSessionsDone = parseInt(state.currentUser?.DemoSessionsDone || 0);
        if (demoSessionsDone >= 3) {
            showToast("Demo Limit Reached (3 sessions). Please Subscribe or use BYOK.", 5000);
            return;
        }

        showToast("Fetching Demo Access...", 2000);
        try {
            const params = new URLSearchParams();
            params.append('action', 'getDemoKey');
            params.append('email', state.currentUser.email);
            const res = await fetch(GOOGLE_URL, { method: 'POST', body: params });
            const data = await res.json();
            if (data.status === 'success') {
                state.demoKey = data.apiKey; // Use separate key for demo
                state.demoProviderEmail = data.providerEmail || ""; // Capture provider email
                // Ensure the UI input doesn't show this key
                if (inputs.deepgramKey) {
                    inputs.deepgramKey.placeholder = "Demo Key Active...";
                }
            } else {
                showToast("Demo unavailable right now. " + (data.message || ""));
                return;
            }
        } catch (e) {
            showToast("Failed to fetch Demo session details.");
            console.error(e);
            return;
        }
    } else {
        const isPremium = state.currentUser?.SubscriptionStatus === 'Active';

        // Save Deepgram Key
        if (inputs.deepgramKey) {
            state.deepgramKey = inputs.deepgramKey.value.trim() || localStorage.getItem('deepgram_api_key') || "";
            if (state.deepgramKey) localStorage.setItem('deepgram_api_key', state.deepgramKey);
        }

        if (!state.deepgramKey && !isPremium) {
            showToast("Please enter a Deepgram API Key or Subscribe");
            return;
        }

        // If Premium user, and they don't have a BYOK key configured, 
        // silently grab a pooled demo key for them without the 5-Q limit
        if (isPremium && !state.deepgramKey) {
            try {
                const params = new URLSearchParams();
                params.append('action', 'getDemoKey');
                params.append('email', state.currentUser.email);
                const res = await fetch(GOOGLE_URL, { method: 'POST', body: params });
                const data = await res.json();
                if (data.status === 'success') {
                    state.deepgramKey = data.apiKey;
                } else {
                    showToast("Failed to acquire active Premium key. Please check your setup.");
                    return;
                }
            } catch (e) {
                showToast("Premium key routing failed.");
                console.error(e);
                return;
            }
        }
    }

    const topic = inputs.topic.value.trim() || "Untitled Interview";
    state.topic = topic;

    // Puter Login routing
    const isPremium = state.currentUser?.SubscriptionStatus === 'Active';
    if (!isPremium && !state.isDemoMode && !puter.auth.isSignedIn()) {
        await puter.auth.signIn();
    }

    const audioOk = await setupMobileFriendlyAudio();
    if (!audioOk) return;

    state.chatHistory = [];
    state.transcriptLog = [];
    state.aiLog = [];

    displays.transcriptFeed.innerHTML = '';
    displays.aiFeed.innerHTML = '';
    displays.topic.textContent = topic;
    switchScreen('meeting');

    state.isRecording = true;
    state.micMode = 'SPEECH';
    state.activeRecMode = 'SPEECH';
    state.lastFinishedMode = null;

    // Trigger Deepgram and Streaming automatically on start
    initDeepgram().then(() => {
        startStreaming();
    });

    if (state.audioContext?.state === 'suspended') state.audioContext.resume();
    updateMicUI();
}

async function handleKeyValidation() {
    const key = inputs.deepgramKey.value.trim();
    if (!key) return showToast("Please enter a key first");

    setLoading(buttons.validateKey, true);

    // Attempt validation via WebSocket (CORS-friendly & Functional Test)
    try {
        const socket = new WebSocket('wss://api.deepgram.com/v1/listen', ['token', key]);

        const validationPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                socket.onopen = null;
                socket.onerror = null;
                socket.close();
                reject(new Error("Validation timeout"));
            }, 5000);

            socket.onopen = () => {
                clearTimeout(timeout);
                socket.close();
                resolve(true);
            };

            socket.onerror = () => {
                clearTimeout(timeout);
                reject(new Error("Connection failed"));
            };
        });

        await validationPromise;

        state.deepgramKey = key;
        localStorage.setItem('deepgram_api_key', key);

        // UI Updates
        buttons.validateKey.innerHTML = '<span class="material-icons-round" style="font-size: 16px; color: #4ade80;">check_circle</span> Verified';
        buttons.validateKey.style.borderColor = "#4ade80";
        buttons.validateKey.style.color = "#4ade80";

        if (displays.dgSetupSteps) displays.dgSetupSteps.classList.add('hidden');
        if (displays.dgStatusContainer) displays.dgStatusContainer.classList.remove('hidden');

        // Silent Persistence
        saveDeepgramKeySilently(key);

        checkSetupStatus();
        startUsageRefresh();
    } catch (err) {
        console.error("Deepgram Validation Error:", err);
        showToast("❌ Invalid Key or Connection Issue", 3000);
        buttons.validateKey.innerHTML = 'Verify';
        buttons.validateKey.style.borderColor = "";
        buttons.validateKey.style.color = "";
        checkSetupStatus();
    } finally {
        setLoading(buttons.validateKey, false);
    }
}

async function saveDeepgramKeySilently(key) {
    if (!state.currentUser || !state.currentUser.email) return;

    try {
        const params = new URLSearchParams();
        params.append('action', 'saveDeepgramKey');
        params.append('email', state.currentUser.email);
        params.append('apiKey', key);

        await fetch(GOOGLE_URL, {
            method: 'POST',
            body: params,
            redirect: 'follow'
        });
        console.log("Deepgram key persisted silently.");
    } catch (e) {
        console.warn("Silent key persistence failed:", e);
    }
}

// --- AI Integration ---
async function triggerAI(text, type = "SPEECH") {
    if (state.isProcessingAI) return;

    if (state.isDemoMode) {
        if (state.demoResponsesCount >= 5) {
            showToast("Demo Limit Reached (5/5). Please Subscribe for unlimited access.", 5000);

            // Optionally auto-end the session after limit is reached
            setTimeout(endSession, 3000);
            return;
        }
        state.demoResponsesCount++;
        showToast(`Demo Response ${state.demoResponsesCount}/5`, 2000);
    }

    const lastMessage = state.chatHistory.length > 0 ? state.chatHistory[state.chatHistory.length - 1] : null;
    if (lastMessage && lastMessage.role === 'assistant') {
        if (isSelfLoop(text, lastMessage.content)) {
            const feed = displays.aiFeed;
            const feedbackDiv = document.createElement('div');
            feedbackDiv.className = 'ai-message';
            feedbackDiv.style.opacity = "0.6";
            feedbackDiv.style.fontStyle = "italic";
            feedbackDiv.innerText = "(Reading detected - Skipped AI)";
            feed.appendChild(feedbackDiv);
            scrollToBottom(feed);
            setTimeout(() => { if (feedbackDiv.parentNode) feedbackDiv.remove(); }, 2500);
            return;
        }
    }

    state.isProcessingAI = true;
    const aiContainer = document.createElement('div');
    aiContainer.className = 'ai-message';
    displays.aiFeed.appendChild(aiContainer);
    scrollToBottom(displays.aiFeed);

    state.chatHistory.push({ role: "user", content: text });

    try {
        const fullResponseText = await streamAIResponse(aiContainer);
        if (fullResponseText) {
            state.chatHistory.push({ role: "assistant", content: fullResponseText });
            state.aiLog.push({ timestamp: new Date().toLocaleTimeString(), text: fullResponseText });
        }
    } finally {
        state.isProcessingAI = false;
    }
}

async function streamAIResponse(element, retries = 2) {
    const isPremium = state.currentUser?.SubscriptionStatus === 'Active';
    const useProxy = isPremium || state.isDemoMode;
    const model = 'gpt-4o-mini';

    const systemMessage = {
        role: "system",
        content: `You are an experienced job candidate in a high-stakes job interview. The topic is: "${state.topic}".

        TONE & STYLE:
        - **Speak like a HUMAN, not an AI.**
        - **USE SIMPLE INDIAN ENGLISH.** Keep vocabulary very easy and common.
        - **AVOID complex words** like: *fascinating, nuances, intricate, meticulous, pivotal, realm*.
        - Use simple words like: *boring, details, hard, careful, main, area*.
        - Be conversational, confident, and slightly informal but professional.
        - **AVOID** robotic openers like "Certainly", "Here is an answer", "To answer your question", "It sounds like you asked...".
        - **AVOID** textbook definitions. Don't say "React is a library...". Say "I use React to..." or "The reason I choose React is...".
        - Use "I" statements. Talk about *your* experience and *your* approach.
        
        CONTEXT AWARENESS:
        1. You are receiving a transcript from a local Speech-to-Text engine. It WILL contain phonetic mistakes, garbled words, and missing context (e.g., "board process" -> "boot process", "re act" -> "React").
        2. **FIRST STEP - SMART RECONSTRUCTION**: You MUST first analyze the raw transcript and deduce what the interviewer *actually* asked based on context, technical terms, and sound-alike words. Frame the correct question logically.
        3. Output your reconstructed question in EXACTLY this format:
           [QUESTION: The corrected, reconstructed question]
        4. **SECOND STEP**: Answer the reconstructed question directly. Do not say "I understood this". Just start the answer.

        UNIVERSAL CODE FORMATTING RULE:
        - Apply professional standards (e.g., PEP 8 for Python) to ALL technology and languages.
        - **NEVER mash multiple statements onto one line.**
        - Use clear indentation and logical line breaks for every step.
        - Ensure all code is extremely readable and well-organized.

        CRITICAL: LOOP DETECTION / IGNORE
        - If the INPUT text is simply a reading (or paraphrasing) of your LAST output, DO NOT generate a new answer.
        - Output exactly: [IGNORE]
        - **EXCEPTION**: If there is no previous conversation history (first message), NEVER ignore. Answer it.
        
        ANSWERING RULES:
        1. Start with [QUESTION: ...].
        2. Then answer professionally and concisely.
        3. Technical commands in \`\`\`code blocks\`\`\`.
        `
    };
    const messages = [systemMessage, ...state.chatHistory.slice(-15)];

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            let response;
            if (useProxy) {
                // Call Cloudflare Proxy (No login required)
                const res = await fetch(CONFIG.AI_PROXY_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages, model, stream: true })
                });
                if (!res.ok) throw new Error("Proxy Error: " + res.status);
                response = res.body;
            } else {
                // Call Puter SDK (User login required)
                response = await puter.ai.chat(messages, { stream: true, model });
            }

            element.innerHTML = "";
            let finalOutput = "";
            let hasScrolled = false;

            if (useProxy) {
                // Handle standard OpenAI SSE from Cloudflare
                const reader = response.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    for (const line of lines) {
                        if (line.trim().startsWith('data: ')) {
                            const dataStr = line.trim().substring(6);
                            if (dataStr === '[DONE]') break;
                            try {
                                const data = JSON.parse(dataStr);
                                const content = data.choices[0].delta.content || "";
                                finalOutput += content;

                                // Early exit for [IGNORE]
                                if (finalOutput.trim().startsWith("[IGNORE]")) {
                                    element.innerHTML = "<em>(Reading detected - ignored)</em>";
                                    return null;
                                }

                                updateAIBubble(element, finalOutput, hasScrolled);
                            } catch (e) { }
                        }
                    }
                }
            } else {
                // Handle Puter SDK stream
                for await (const part of response) {
                    const text = part?.text || "";
                    if (text) {
                        finalOutput += text;
                        updateAIBubble(element, finalOutput, hasScrolled);
                    }
                }
            }
            return finalOutput;
        } catch (err) {
            console.error(`AI Error (Attempt ${attempt}):`, err);
            if (attempt > retries) {
                element.innerHTML = "<span style='color:red'>AI Connection Error - Please try again</span>";
                return null;
            }
            await new Promise(res => setTimeout(res, 1000));
            element.innerHTML = `<span style='color:orange'>Retrying AI connection (${attempt}/${retries})...</span>`;
        }
    }
}

function updateAIBubble(element, finalOutput, hasScrolled) {
    // Robust Regex: Handle leading whitespace/newlines that some models prefix
    const qMatch = finalOutput.match(/\[QUESTION:\s*(.*?)\]/s);
    let htmlContent = "";

    if (qMatch) {
        // Separate thinking tag from answer
        const qText = qMatch[1];
        const answerText = finalOutput.substring(finalOutput.indexOf(qMatch[0]) + qMatch[0].length).trim();

        const qHtml = `<div style="color: #FFD700; font-weight: bold; margin-bottom: 8px; font-size: 0.95em;">${parseMarkdown(qText)}</div>`;
        const aHtml = parseMarkdown(answerText);
        htmlContent = qHtml + aHtml;

        // Smart Scroll: Snap to top of answer ONCE it's substantially started
        if (!hasScrolled && answerText.length > 5) {
            const container = displays.aiFeed;
            const elTop = element.offsetTop;
            container.scrollTo({ top: elTop - 20, behavior: 'smooth' });
            hasScrolled = true;
        }
    } else {
        // Tag not complete or not present yet.
        // Show "Thinking..." while the tag is still being formed to prevent raw tag flicker
        if (finalOutput.trim().startsWith("[") && finalOutput.length < 60) {
            element.innerHTML = "<em>Thinking...</em>";
            return;
        }

        // Fallback or while tag is being typed
        htmlContent = parseMarkdown(finalOutput);

        // Standard Scroll Fallback
        if (!hasScrolled && finalOutput.length > 20) {
            const container = displays.aiFeed;
            const elTop = element.offsetTop;
            container.scrollTo({ top: elTop - 20, behavior: 'smooth' });
            hasScrolled = true;
        }
    }

    element.innerHTML = htmlContent;
}

async function quickReply() {
    let text = state.currentSessionBuffer.trim();
    if (!text && state.transcriptLog.length > 0) {
        text = state.transcriptLog[state.transcriptLog.length - 1].text;
    }
    if (text) {
        await triggerAI(text, "QUICK");
        state.currentSessionBuffer = "";
    } else {
        showToast("Nothing to reply to!");
    }
}

// --- Helper Functions ---
function toggleMic() {
    if (!state.isRecording) {
        state.isRecording = true;
        state.micMode = 'SPEECH';
        state.activeRecMode = 'SPEECH';

        initDeepgram().then(() => {
            startStreaming();
        });

        if (state.audioContext?.state === 'suspended') state.audioContext.resume();
        updateMicUI();
        showToast("Deepgram Started - Click again to Answer Now");
        return;
    }

    // "Answer Now" Logic
    const finalPayload = (state.currentSessionBuffer + (state.pendingBuffer || "")).trim();

    if (state.pendingScreenshots && state.pendingScreenshots.length > 0) {
        analyzePendingScreenshots(finalPayload);

        // Comprehensive Buffer Release
        state.currentSessionBuffer = "";
        state.pendingBuffer = "";
        state.silenceStartTime = 0;
        state.forceNewBubble = true;
        updateTranscriptUI("", "", 'SPEECH');

        showToast("Analyzing screenshots...");
        return;
    }

    if (finalPayload.length > 0) {
        triggerAI(finalPayload);

        // Comprehensive Buffer Release
        state.currentSessionBuffer = "";
        state.pendingBuffer = "";
        state.silenceStartTime = 0;
        state.forceNewBubble = true;

        // Clear UI temp area
        updateTranscriptUI("", "", 'SPEECH');

        showToast("Answering Now...");
    } else {
        showToast("Nothing to answer yet - Keep talking!");
    }
}

function updateVadUI(isSpeaking) {
    if (isSpeaking) {
        displays.vadStatus.textContent = "VAD: Speaking";
        displays.vadStatus.classList.add('speaking');
    } else {
        displays.vadStatus.textContent = "VAD: Silence";
        displays.vadStatus.classList.remove('speaking');
    }
}

function updateTranscriptUI(finalT, interimT, mode = 'INTERVIEWER') {
    let tempEl = document.getElementById('temp-transcript');
    if (!tempEl) {
        tempEl = document.createElement('p');
        tempEl.id = 'temp-transcript';
        tempEl.style.opacity = '0.7';
        displays.transcriptFeed.appendChild(tempEl);
    }
    const prefix = 'You'; // Simplified single prefix
    const strongTag = `<strong style="color: #64ffda;">${prefix}:</strong>`;
    tempEl.innerHTML = `${strongTag} ${finalT} <span style='color:#888'>${interimT}</span>`;
    tempEl.classList.add('user-segment');
    scrollToBottom(displays.transcriptFeed);
    if (finalT || interimT) {
        const trHeader = document.querySelector('.transcript-panel .panel-header');
        if (trHeader) trHeader.style.display = 'none';
    }
}

function addTranscriptBubble(text, mode = 'INTERVIEWER') {
    let tempEl = document.getElementById('temp-transcript');
    if (tempEl) tempEl.remove();

    const feed = displays.transcriptFeed;

    // Always create a new bubble for new chunks as requested
    state.forceNewBubble = false; // Reset the flag anyway
    const p = document.createElement('p');
    p.className = 'transcript-segment final user-segment';
    p.dataset.mode = mode;
    const prefix = 'You';
    const strongTag = `<strong style="color: #64ffda;">${prefix}:</strong>`;
    p.innerHTML = `${strongTag} ${text}`;
    feed.appendChild(p);

    scrollToBottom(feed);
}

function updateMicUI() {
    if (state.isRecording) {
        buttons.micToggle.classList.add('active');
        displays.status.innerHTML = "Listening...";
        buttons.micToggle.style.backgroundColor = "var(--primary)"; // Constant active color
        buttons.micToggle.style.border = "none";
    } else {
        buttons.micToggle.classList.remove('active');
        buttons.micToggle.style.backgroundColor = "";
        buttons.micToggle.style.border = "";
        displays.status.innerHTML = "Mic Paused";
    }
}

function switchScreen(name) {
    const target = screens[name];
    Object.values(screens).forEach(s => {
        if (s !== target) {
            s.classList.remove('active');
            setTimeout(() => { if (!s.classList.contains('active')) s.style.display = 'none'; }, 400);
        }
    });
    if (target) {
        target.style.display = 'flex';
        requestAnimationFrame(() => target.classList.add('active'));
    }
    const mainHeader = document.querySelector('body > .app-container > header');
    if (mainHeader) mainHeader.style.display = (name === 'meeting') ? 'none' : 'block';
}

function simulateVisualizerVolume(avgVolume) {
    const val = Math.min(avgVolume / 128, 1);
    displays.visualizerBars.forEach(bar => {
        bar.style.transform = `scaleY(${Math.max(0.1, val + Math.random() * 0.2)})`;
    });
}

function parseMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```([\s\S]*?)```/g, '<div class="code-box">$1</div>');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html.replace(/\n/g, '<br>');
}

function downloadTranscript() {
    let output = "INTERVIEW Q&A SESSION LOG\n=========================\n\n";
    let combinedLogs = [];
    state.transcriptLog.forEach(entry => combinedLogs.push({ time: entry.timestamp, speaker: (entry.mode === 'USER') ? "YOU" : "INTERVIEWER", text: entry.text }));
    state.aiLog.forEach(entry => {
        let cleanText = entry.text;
        const qMatch = cleanText.match(/^\[QUESTION:\s*(.*?)\]/s);
        if (qMatch) cleanText = cleanText.substring(qMatch[0].length).trim();
        combinedLogs.push({ time: entry.timestamp, speaker: "AI ASSISTANT", text: cleanText });
    });
    combinedLogs.sort((a, b) => new Date('1970/01/01 ' + a.time) - new Date('1970/01/01 ' + b.time));
    combinedLogs.forEach(entry => output += `[${entry.time}] ${entry.speaker}:\n${entry.text}\n\n`);
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'interview_qa.txt'; a.click();
}

function clearAndExit() { location.reload(); }

function endSession() {
    // Demo Cleanup
    if (state.isDemoMode) {
        state.isDemoMode = false;
        state.demoKey = "";
        state.demoProviderEmail = "";
        if (state.currentUser) {
            state.currentUser.DemoSessionsDone = (parseInt(state.currentUser.DemoSessionsDone) || 0) + 1;
            localStorage.setItem('interviewbold_user', JSON.stringify(state.currentUser));
        }
        if (inputs.deepgramKey) {
            inputs.deepgramKey.placeholder = "Paste Key Here";
        }
    }

    state.isRecording = false;
    cancelAnimationFrame(state.analysisInterval);
    if (state.recognition) state.recognition.stop();
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    if (state.audioContext) state.audioContext.close();
    switchScreen('end');
    const aiHeader = document.querySelector('.ai-panel .panel-header');
    if (aiHeader) aiHeader.style.display = 'flex';
    const trHeader = document.querySelector('.transcript-panel .panel-header');
    if (trHeader) trHeader.style.display = 'flex';
    const totalWords = state.transcriptLog.reduce((acc, l) => acc + l.text.split(' ').length, 0);
    displays.statWords.textContent = totalWords + " words";
    displays.statInsights.textContent = state.aiLog.length + " generated";
    if (state.currentUser && totalWords > 0) {
        const estMinutes = Math.max(1, (totalWords / 150)).toFixed(1);
        const params = new URLSearchParams();
        params.append('action', 'updateUsage');
        params.append('email', state.currentUser.email);
        params.append('minutes', estMinutes);
        if (state.demoProviderEmail) {
            params.append('providerEmail', state.demoProviderEmail);
        }

        // --- Continuous Subscription Validation & Logging ---
        const isPremium = state.currentUser?.SubscriptionStatus === 'Active';
        params.append('reasoningMode', isPremium ? 'Premium' : (state.isDemoMode ? 'Demo' : 'BYOK'));

        fetch(GOOGLE_URL, { method: 'POST', body: params, redirect: 'follow' })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'success' && data.SubscriptionStatus) {
                    const oldStatus = state.currentUser.SubscriptionStatus;
                    state.currentUser.SubscriptionStatus = data.SubscriptionStatus;
                    if (oldStatus === 'Active' && data.SubscriptionStatus === 'Free') {
                        showToast("Subscription has ended. Reverting to Free tier.", 5000);
                    }
                    localStorage.setItem('interviewbold_user', JSON.stringify(state.currentUser));
                    checkSetupStatus();
                }
            }).catch(() => { });
    }

    // Auto-Upload Transcript to Google Drive
    if (state.transcriptLog.length > 0) {
        showToast("Saving session transcript securely...", 4000);

        // 1. Compile the Document exactly like the download file
        let output = "INTERVIEW Q&A SESSION LOG\n";
        output += "=========================\n\n";

        let combinedLogs = [];
        state.transcriptLog.forEach(entry => {
            combinedLogs.push({
                time: entry.timestamp,
                speaker: (entry.mode === 'USER') ? "YOU" : "INTERVIEWER",
                text: entry.text
            });
        });
        state.aiLog.forEach(entry => {
            let cleanText = entry.text;
            const qMatch = cleanText.match(/^\[QUESTION:\s*(.*?)\]/s);
            if (qMatch) cleanText = cleanText.substring(qMatch[0].length).trim();
            combinedLogs.push({ time: entry.timestamp, speaker: "AI ASSISTANT", text: cleanText });
        });

        combinedLogs.sort((a, b) => {
            return new Date('1970/01/01 ' + a.time) - new Date('1970/01/01 ' + b.time);
        });

        combinedLogs.forEach(entry => {
            output += `[${entry.time}] ${entry.speaker}:\n${entry.text}\n\n`;
        });

        // 2. Send to Backend
        try {
            const params = new URLSearchParams();
            params.append('action', 'uploadTranscript');
            params.append('email', state.currentUser ? state.currentUser.email : "guest");
            params.append('topic', state.topic || "Untitled Session");
            params.append('transcript', output);

            fetch(GOOGLE_URL, {
                method: 'POST',
                body: params,
                redirect: 'follow'
            }).then(response => response.text())
                .then(text => {
                    try {
                        const data = JSON.parse(text);
                        if (data.status === 'success') {
                            showToast("Transcript saved securely!");
                            console.log("Drive URL:", data.url);
                        } else {
                            console.error("Upload error response:", data.message);
                        }
                    } catch (e) {
                        console.error("Failed to parse upload response", text);
                    }
                });
        } catch (err) {
            console.error("Error initiating transcript upload", err);
        }
    }
    checkSetupStatus();
}

function isSelfLoop(userText, lastAiText) {
    if (!lastAiText || !userText) return false;
    const cleanUser = userText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const cleanAI = lastAiText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    if (cleanUser === cleanAI) return true;
    const questionWords = ["why", "how", "what", "when", "where", "who", "which", "can", "could", "would", "explain", "tell", "elaborate"];
    if (questionWords.includes(cleanUser.split(" ")[0])) return false;
    if (cleanUser.split(" ").length < 3) return false;
    if (cleanAI.includes(cleanUser) && (cleanUser.length > 20 || cleanUser.length > cleanAI.length * 0.8)) return true;
    const aiWords = new Set(cleanAI.split(" "));
    let matchCount = 0;
    cleanUser.split(" ").forEach(w => { if (aiWords.has(w)) matchCount++; });
    return (matchCount / cleanUser.split(" ").length) > 0.9;
}

function scrollToBottom(element) {
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
}

function showToast(msg, duration = 3000) {
    const t = displays.toast;
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    t.classList.remove('hidden');
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.classList.add('hidden'), 300);
    }, duration);
}

window.receiveDesktopScreenshot = async function (dataUrl) {
    if (!dataUrl?.startsWith('data:')) return showToast("Capture failed");

    state.pendingScreenshots.push(dataUrl);

    const container = document.getElementById('staged-screenshots-container');
    if (container) {
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.height = '60px';
        img.style.borderRadius = '4px';
        img.style.border = '1px solid rgba(255,255,255,0.2)';
        container.appendChild(img);
    }

    showToast(`Screenshot staged (${state.pendingScreenshots.length}). Press Mic to analyze.`, 4000);
};

async function analyzePendingScreenshots(textContext) {
    if (state.isProcessingAI) return;
    state.isProcessingAI = true;

    const urls = [...state.pendingScreenshots];
    state.pendingScreenshots = [];

    const container = document.getElementById('staged-screenshots-container');
    if (container) container.innerHTML = '';

    showToast("Analyzing screenshots...");

    const aiCard = document.createElement('div');
    aiCard.className = 'ai-message vision-card';
    displays.aiFeed.appendChild(aiCard);
    scrollToBottom(displays.aiFeed);

    try {
        const contentArray = [
            { type: "text", text: textContext ? `Context: ${textContext}\nSolve this:` : "Solve this:" }
        ];

        urls.forEach(url => {
            contentArray.push({ type: "image_url", image_url: { url: url } });
        });

        const messages = [
            { role: "system", content: "You are an expert technical candidate. Analyze the provided screenshots (and any spoken context) to extract and solve the exact problem or question in Markdown." },
            { role: "user", content: contentArray }
        ];

        const isPremium = state.currentUser?.SubscriptionStatus === 'Active';
        const useProxy = isPremium || state.isDemoMode;
        const model = 'gpt-4o';

        let response;
        if (useProxy) {
            const res = await fetch(CONFIG.AI_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, model, stream: true })
            });
            if (!res.ok) throw new Error("Proxy Error: " + res.status);
            response = res.body;
        } else {
            response = await puter.ai.chat(messages, { stream: true, model });
        }

        let fullResponse = "";
        if (useProxy) {
            const reader = response.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('data: ')) {
                        const dataStr = line.trim().substring(6);
                        if (dataStr === '[DONE]') break;
                        try {
                            const data = JSON.parse(dataStr);
                            const content = data.choices[0].delta.content || "";
                            fullResponse += content;
                            aiCard.innerHTML = parseMarkdown(fullResponse);
                            scrollToBottom(displays.aiFeed);
                        } catch (e) { }
                    }
                }
            }
        } else {
            for await (const part of response) {
                fullResponse += part?.text || "";
                aiCard.innerHTML = parseMarkdown(fullResponse);
                scrollToBottom(displays.aiFeed);
            }
        }

        state.aiLog.push(fullResponse);
        state.chatHistory.push({ role: "assistant", content: fullResponse });
        showToast("Solution generated!");
    } catch (err) {
        showToast("Vision Error: " + err.message);
        aiCard.innerHTML = "<span style='color:red'>Vision Error</span>";
    } finally {
        state.isProcessingAI = false;
    }
}

let currentRating = 0;
function setupFeedbackListeners() {
    document.querySelectorAll('.star').forEach(star => {
        star.addEventListener('click', (e) => {
            currentRating = parseInt(e.target.dataset.value);
            document.querySelectorAll('.star').forEach(s => {
                const val = parseInt(s.dataset.value);
                s.textContent = val <= currentRating ? 'star' : 'star_outline';
                s.style.color = val <= currentRating ? '#FFD700' : '';
            });
        });
    });

    const submitBtn = document.getElementById('submit-feedback-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async (e) => {
            const btn = e.target;
            const comment = document.getElementById('feedback-comment').value.trim();
            if (currentRating === 0 && !comment) return showToast("Please provide a rating or a comment");

            setLoading(btn, true);
            try {
                const params = new URLSearchParams();
                params.append('action', 'submitFeedback');
                params.append('email', state.currentUser ? state.currentUser.email : 'guest');
                params.append('topic', state.topic || 'Untitled Session');
                params.append('rating', currentRating);
                params.append('comment', comment);

                const res = await fetch(GOOGLE_URL, { method: 'POST', body: params, redirect: 'follow' });
                const data = JSON.parse(await res.text());
                if (data.status === 'success') {
                    showToast("Feedback submitted successfully.");
                    document.getElementById('feedback-section').innerHTML = "<p style='color: var(--success); text-align: center; padding: 20px 0;'>Thank you for your feedback!</p>";
                } else {
                    showToast("Failed: " + data.message);
                }
            } catch (err) {
                showToast("Error submitting feedback.");
            } finally {
                setLoading(btn, false);
            }
        });
    }
}

// --- Resource Monitoring ---

async function startUsageRefresh() {
    if (state.usageRefreshInterval) stopUsageRefresh();

    // Initial fetch
    updateResourceStatus();

    // Set interval for every 5 minutes
    state.usageRefreshInterval = setInterval(updateResourceStatus, 5 * 60 * 1000);
}

function stopUsageRefresh() {
    if (state.usageRefreshInterval) {
        clearInterval(state.usageRefreshInterval);
        state.usageRefreshInterval = null;
    }
}

async function updateResourceStatus() {
    const card = document.getElementById('resource-status-card');
    const dgDisplay = document.getElementById('dg-usage');
    const dgIndicator = document.getElementById('dg-indicator');
    const dgProjectName = document.getElementById('dg-project-name');

    const puterBar = document.getElementById('puter-usage-bar');
    const puterUsageText = document.getElementById('puter-usage-text');
    const puterQuotaText = document.getElementById('puter-quota-text');

    const refreshTime = document.getElementById('usage-refresh-time');

    if (!card) return;

    // Connectivity Check
    if (!navigator.onLine) {
        refreshTime.textContent = "Offline";
        if (dgDisplay) {
            dgDisplay.textContent = "Network Lost";
            if (dgIndicator) dgIndicator.style.background = 'var(--text-muted)';
        }
        if (puterUsageText) puterUsageText.textContent = "Offline";
        if (puterQuotaText) puterQuotaText.textContent = "Please check your connection";
        return;
    }

    // Update Refresh Time
    const now = new Date();
    refreshTime.textContent = `Updated: ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // 1. Fetch Deepgram Usage
    if (state.deepgramKey) {
        fetchDeepgramUsage().then(usage => {
            if (usage) {
                // Simplified status display
                if (usage.status === 403 || usage.remaining === 0) {
                    dgDisplay.textContent = "Limited Access";
                    if (dgIndicator) dgIndicator.style.background = 'var(--text-muted)';
                } else {
                    dgDisplay.textContent = "Connected";
                    if (dgIndicator) dgIndicator.style.background = '#4ade80';
                }
            } else {
                dgDisplay.textContent = "Error";
                if (dgIndicator) dgIndicator.style.background = 'var(--danger)';
            }
        });
    } else {
        dgDisplay.textContent = "Key Required";
        if (dgIndicator) dgIndicator.style.background = 'var(--text-muted)';
    }

    // 2. Fetch Puter Usage
    fetchPuterUsage().then(usage => {
        if (usage && usage.percentage !== undefined) {
            if (puterBar) puterBar.style.width = `${usage.percentage}%`;
            if (puterUsageText) puterUsageText.textContent = `${usage.usedDisplay} Used`;
            if (puterQuotaText) puterQuotaText.textContent = `${Math.round(usage.percentage)}% of ${usage.quotaDisplay}`;

            // Color coding the bar
            if (usage.percentage > 90) puterBar.style.background = 'var(--danger)';
            else if (usage.percentage > 70) puterBar.style.background = '#f59e0b';
            else puterBar.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        } else {
            if (puterUsageText) puterUsageText.textContent = "Sign-in required";
            if (puterQuotaText) puterQuotaText.textContent = "Connect Puter.js to see resources";
            if (puterBar) puterBar.style.width = '0%';
        }
    });
}

async function fetchDeepgramUsage() {
    try {
        const userEmail = state.currentUser ? encodeURIComponent(state.currentUser.email) : "";
        const url = `${GOOGLE_URL}?action=getDeepgramUsage&apiKey=${encodeURIComponent(state.deepgramKey)}&userEmail=${userEmail}`;
        console.log("Deepgram Proxy Fetching:", url);

        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow'
        });


        if (!res.ok) {
            console.error("Deepgram Proxy HTTP Error:", res.status);
            throw new Error("Proxy error");
        }

        const text = await res.text();
        console.log("Deepgram Proxy Response Raw:", text);
        const json = JSON.parse(text);

        if (json.status === 'success') {
            // ... (debug logs omitted for brevity in target)
            return json.data;
        } else {
            console.warn("Deepgram Proxy API Error:", json.message);
            if (json.message && json.message.toLowerCase().includes("expired")) {
                showToast("Premium session expired. Please refresh your status.", 5000);
                if (state.currentUser) {
                    state.currentUser.SubscriptionStatus = "Free";
                    localStorage.setItem('interviewbold_user', JSON.stringify(state.currentUser));
                    checkSetupStatus();
                }
            }
        }

        return null;
    } catch (err) {
        console.error("Deepgram Proxy Catch Error:", err);
        return null;
    }
}

async function fetchPuterUsage() {
    try {
        if (typeof puter === 'undefined') return null;
        if (!puter.auth.isSignedIn()) return null;

        const usage = await puter.auth.getMonthlyUsage();
        if (usage && usage.allowanceInfo) {
            const allowance = usage.allowanceInfo;
            const quota = allowance.monthUsageAllowance || 50000000; // Default to $0.50 if not found
            const remaining = allowance.remaining || 0;
            const used = quota - remaining;
            const percentage = (used / quota) * 100;

            return {
                usedDisplay: `$${(used / 100000000).toFixed(2)}`,
                quotaDisplay: `$${(quota / 100000000).toFixed(2)}`,
                percentage: Math.min(100, Math.max(0, percentage))
            };
        }
        return null;
    } catch (err) {
        console.warn("Puter Usage Fetch Error:", err);
        return null;
    }
}

function isSelfLoop(userText, lastAiText) {
    if (!lastAiText || !userText) return false;

    // Normalize: lowercase, remove punctuation, extra whitespace
    const cleanUser = userText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const cleanAI = lastAiText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();

    // 0. EXACT MATCH (Always ignore)
    if (cleanUser === cleanAI) return true;

    // 1. SAFEGUARD: Strong Question Words
    const questionWords = ["why", "how", "what", "when", "where", "who", "which", "can", "could", "would", "explain", "tell", "elaborate"];
    const firstWord = cleanUser.split(" ")[0];
    if (questionWords.includes(firstWord)) return false;

    // 2. Length check. 
    const userWords = cleanUser.split(" ");
    if (userWords.length < 3) return false;

    // 3. Phrase Reading Detection (Long Substring)
    if (cleanAI.includes(cleanUser)) {
        if (cleanUser.length > 20 || cleanUser.length > cleanAI.length * 0.8) {
            return true;
        }
    }

    // 4. Word Overlap (Fuzzy Match)
    const aiWords = new Set(cleanAI.split(" "));
    let matchCount = 0;
    userWords.forEach(w => {
        if (aiWords.has(w)) matchCount++;
    });

    const similarity = matchCount / userWords.length;
    if (similarity > 0.9) return true;

    return false;
}

function parseMarkdown(text) {
    if (!text) return "";

    // 1. Initial cleanup: handle basic characters
    let html = text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // 2. Multi-line Code Blocks (```language\n code \n ```)
    // Using a non-greedy catch-all to correctly identify segments
    const codeBlocks = [];
    html = html.replace(/```(?:[a-zA-Z]*)\n?([\s\S]*?)```/g, (match, code) => {
        const id = `CODE_BLOCK_${codeBlocks.length}`;
        codeBlocks.push(`<div class="code-box"><pre><code>${code.trim()}</code></pre></div>`);
        return id;
    });

    // 3. Inline Elements
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');

    // 4. Group lists
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // 5. Handle Newlines (Outside code blocks)
    html = html.replace(/\n/g, '<br>');

    // 6. Re-insert code blocks
    codeBlocks.forEach((block, index) => {
        html = html.replace(`CODE_BLOCK_${index}`, block);
    });

    return html;
}

/**
 * PADDLE CHECKOUT INTEGRATION
 */
function openPaddleCheckout() {
    if (typeof Paddle === 'undefined') {
        showToast("Payment system loading, please wait...");
        return;
    }

    const userEmail = state.currentUser ? state.currentUser.email : "";

    // NOTE: Replace 'pri_placeholder' with your actual Paddle Price ID from the dashboard
    const PRICE_ID = "pri_01knh7qwtvzdkhc4qhsk700vmk";

    if (PRICE_ID === "pri_placeholder") {
        showToast("Checkout is being configured. Please check back in a few minutes.");
        console.warn("Paddle Price ID is missing. Please update script.js with your 'pri_...' ID.");
        return;
    }

    // Detect if we're inside the Electron EXE or Android Capacitor App
    const isNativeApp = !!(window.electronAPI || (window.Capacitor && window.Capacitor.platform !== 'web'));

    Paddle.Checkout.open({
        items: [
            {
                priceId: PRICE_ID,
                quantity: 1
            }
        ],
        customer: {
            email: userEmail
        },
        settings: {
            // Use 'hosted' for native apps to trigger system browser, 
            // use 'overlay' for regular web users.
            displayMode: isNativeApp ? "hosted" : "overlay",
            theme: "dark",
            locale: "en"
        }
    });
}

/**
 * MANUAL UPI PAYMENT SUBMISSION
 */
async function handleUPIPaymentSubmit() {
    const utr = document.getElementById('upi-utr').value.trim();
    const vpa = document.getElementById('upi-vpa').value.trim() || "N/A";
    const email = state.currentUser ? state.currentUser.email : "";

    if (!utr) {
        return showToast("Please enter the UTR / Transaction ID");
    }

    if (utr.length < 8) {
        return showToast("Please enter a valid Transaction ID");
    }

    setLoading(buttons.submitUpi, true);

    try {
        const params = new URLSearchParams();
        params.append('action', 'submitManualPayment');
        params.append('email', email);
        params.append('utr', utr);
        params.append('upiId', vpa);

        const res = await fetch(GOOGLE_URL, {
            method: 'POST',
            body: params,
            redirect: 'follow'
        });

        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message, 5000);
            displays.upiModal.classList.add('hidden');

            // Increment local expiry display immediately if possible
            if (state.currentUser) {
                const newExpiry = new Date();
                newExpiry.setDate(newExpiry.getDate() + 31);
                state.currentUser.SubscriptionExpiry = newExpiry.toISOString();
                localStorage.setItem('interviewbold_user', JSON.stringify(state.currentUser));
                checkSetupStatus();
            }
        } else {
            showToast(data.message || "Failed to submit payment details");
        }
    } catch (err) {
        console.error("UPI Submit Error:", err);
        showToast("Error connecting to payment server");
    } finally {
        setLoading(buttons.submitUpi, false);
    }
}

window.addEventListener('load', init);
