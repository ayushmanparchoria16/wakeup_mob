/**
 * Wakeup AI - Logic Script
 * Handles Speech Recognition, Puter.js AI Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    // Audio Analysis Settings
    MIN_DECIBELS: -45, // Threshold for detecting speech
    SILENCE_DELAY_MS: 1200, // How long to wait in silence before sending audio
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
    forceNewBubble: false
};

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
    validateKey: document.getElementById('validate-key-btn')
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
    keyStatus: document.getElementById('key-status')
};

// --- Initialization ---

function init() {
    // Check local storage for user
    const savedUser = localStorage.getItem('wakeup_user');
    if (savedUser) {
        try {
            state.currentUser = JSON.parse(savedUser);
            displays.userName.textContent = state.currentUser.displayName || state.currentUser.email.split('@')[0];
            switchScreen('setup');
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

    if (inputs.deepgramKey) {
        inputs.deepgramKey.addEventListener('input', () => {
            // Auto-disable start if key changes
            buttons.start.disabled = true;
            displays.keyStatus.classList.add('hidden');
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
            const savedUser = localStorage.getItem('wakeup_user');
            localStorage.clear();
            sessionStorage.clear();

            // Restore our user
            if (savedUser) {
                localStorage.setItem('wakeup_user', savedUser);
            }

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

    // Feedback Listeners
    setupFeedbackListeners();

    // Spacebar to toggle mic
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT' && screens.meeting.classList.contains('active')) {
            e.preventDefault();
            toggleMic();
        }
    });
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
            localStorage.setItem('wakeup_user', JSON.stringify(data.user));
            displays.userName.textContent = data.user.displayName;
            switchScreen('setup');
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
    localStorage.removeItem('wakeup_user');
    inputs.topic.value = '';
    switchScreen('auth');
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
async function initDeepgram() {
    if (!state.deepgramKey) {
        showToast("Deepgram API Key is missing!");
        return;
    }

    console.log("Initializing Deepgram...");
    const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&filler_words=true';
    state.deepgramSocket = new WebSocket(url, ['token', state.deepgramKey]);

    state.deepgramSocket.onopen = () => {
        console.log("✅ Deepgram WebSocket opened");
        displays.vadStatus.textContent = "VAD: Listening (Deepgram)";
        displays.vadStatus.classList.remove('hidden');
    };

    state.deepgramSocket.onmessage = (message) => {
        try {
            const received = JSON.parse(message.data);
            if (received.type === 'Metadata') {
                console.log("Deepgram Metadata:", received);
                return;
            }

            if (!received.channel || !received.channel.alternatives) return;

            const transcript = received.channel.alternatives[0].transcript;
            console.log("Deepgram Transcript:", transcript, "Final:", received.is_final);

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
            } else {
                updateVadUI(false);
            }
        } catch (e) {
            console.error("Deepgram message parse error:", e);
        }
    };

    state.deepgramSocket.onerror = (err) => {
        console.error("❌ Deepgram WebSocket Error:", err);
        showToast("Deepgram Connection Error");
    };

    state.deepgramSocket.onclose = (event) => {
        console.log("Deepgram WebSocket closed:", event.code, event.reason);
        if (event.code !== 1000 && state.isRecording) {
            showToast("Deepgram Connection Closed Unexpectedly");
        }
    };
}

async function startStreaming() {
    try {
        if (!state.stream) {
            state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
            ? 'audio/webm; codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg; codecs=opus');

        console.log("Using MimeType:", mimeType);
        state.mediaRecorder = new MediaRecorder(state.stream, { mimeType });

        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && state.deepgramSocket?.readyState === 1) {
                state.deepgramSocket.send(event.data);
                // Visual heartbeat for data sending
                displays.vadStatus.style.borderBottom = "2px solid #64ffda";
                setTimeout(() => displays.vadStatus.style.borderBottom = "none", 100);
            }
        };

        state.mediaRecorder.onerror = (e) => console.error("MediaRecorder Error:", e);
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
async function startSession() {
    if (!state.currentUser) {
        showToast("Please login first.");
        switchScreen('auth');
        return;
    }

    // Save Deepgram Key
    if (inputs.deepgramKey) {
        state.deepgramKey = inputs.deepgramKey.value.trim();
        localStorage.setItem('deepgram_api_key', state.deepgramKey);
    }

    if (!state.deepgramKey) {
        showToast("Please enter a Deepgram API Key");
        return;
    }

    const topic = inputs.topic.value.trim() || "Untitled Meeting";
    state.topic = topic;

    if (!puter.auth.isSignedIn()) await puter.auth.signIn();

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
        buttons.start.disabled = false;
        buttons.start.title = "Start Meeting";
        displays.keyStatus.classList.remove('hidden');
        showToast("✅ Deepgram Key Validated!", 2000);
    } catch (err) {
        console.error("Deepgram Validation Error:", err);
        showToast("❌ Invalid Key or Connection Issue", 3000);
        buttons.start.disabled = true;
        displays.keyStatus.classList.add('hidden');
    } finally {
        setLoading(buttons.validateKey, false);
    }
}

// --- AI Integration ---
async function triggerAI(text, type = "SPEECH") {
    if (state.isProcessingAI) return;

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

async function streamAIResponse(element) {
    const systemMessage = {
        role: "system",
        content: `You are an experienced job candidate. Topic: "${state.topic}". Style: HUMAN, SIMPLE INDIAN ENGLISH. Avoid robotic openers. Reconstruction: Deduce actual question from phonetic errors. Format: [QUESTION: ...] followed by answer.`
    };
    const messages = [systemMessage, ...state.chatHistory.slice(-15)];
    try {
        const response = await puter.ai.chat(messages, { stream: true, model: 'gpt-4o-mini' });
        element.innerHTML = "";
        let finalOutput = "";
        let hasScrolled = false;
        for await (const part of response) {
            const text = part?.text || "";
            if (text) {
                finalOutput += text;
                const qMatch = finalOutput.match(/^\[QUESTION:\s*(.*?)\]/s);
                if (qMatch) {
                    const qText = qMatch[1];
                    const answerText = finalOutput.substring(qMatch[0].length).trim();
                    element.innerHTML = `<div style="color: #FFD700; font-weight: bold; margin-bottom: 8px;">${parseMarkdown(qText)}</div>${parseMarkdown(answerText)}`;
                } else {
                    element.innerHTML = parseMarkdown(finalOutput);
                }
                if (!hasScrolled && finalOutput.length > 20) {
                    displays.aiFeed.scrollTo({ top: element.offsetTop - 20, behavior: 'smooth' });
                    hasScrolled = true;
                }
            }
        }
        return finalOutput;
    } catch (err) {
        console.error("AI Error:", err);
        element.innerHTML = "<span style='color:red'>AI Error</span>";
        return null;
    }
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
        fetch(GOOGLE_URL, { method: 'POST', body: params, redirect: 'follow' }).catch(() => { });
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
    showToast("Analyzing screenshot...", 5000);
    try {
        const messages = [
            { role: "system", content: "You are an expert technical candidate. Solve the problem in the image step-by-step in Markdown." },
            { role: "user", content: [{ type: "text", text: "Solve this:" }, { type: "image_url", image_url: { url: dataUrl } }] }
        ];
        const response = await puter.ai.chat(messages, { stream: true, model: 'gpt-4o' });
        let fullResponse = "";
        const aiCard = document.createElement('div');
        aiCard.className = 'ai-message vision-card';
        displays.aiFeed.appendChild(aiCard);
        displays.aiFeed.scrollTo({ top: aiCard.offsetTop - 20, behavior: 'smooth' });
        for await (const part of response) {
            fullResponse += part?.text || "";
            aiCard.innerHTML = parseMarkdown(fullResponse);
        }
        state.aiLog.push(fullResponse);
        state.chatHistory.push({ role: "assistant", content: fullResponse });
        showToast("Solution generated!");
    } catch (err) {
        showToast("Vision Error: " + err.message);
    }
};

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

window.addEventListener('load', init);
