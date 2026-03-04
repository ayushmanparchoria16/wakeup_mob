/**
 * Wakeup AI - Logic Script
 * Handles Speech Recognition, Puter.js AI Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    // Audio Analysis Settings
    MIN_DECIBELS: -45, // Threshold for detecting speech
    SILENCE_DELAY_MS: 1500, // How long to wait in silence before sending audio
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
    mediaRecorder: null,
    audioChunks: [],
    stream: null,

    // VAD Logic Context
    isSpeaking: false,
    silenceStartTime: 0,
    analysisInterval: null,

    isProcessingAI: false,
    pendingBuffer: "",
    lastAiCallTime: 0,

    transcriptAccumulator: "",
    currentUser: null,

    micMode: 'INTERVIEWER', // 'INTERVIEWER' or 'USER'
    lastFinishedMode: null
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
    forgotEmail: document.getElementById('forgot-email')
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
    switchAccount: document.getElementById('switch-account-link')
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
    forgotForm: document.getElementById('forgot-form')
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
    if (buttons.screenshot) buttons.screenshot.addEventListener('click', captureScreenshotAndSolve);
    buttons.download.addEventListener('click', downloadTranscript);
    buttons.clearExit.addEventListener('click', clearAndExit);

    // Auth Listeners
    setupAuthListeners();

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

        // 1. Setup AudioContext for visualizer and simple VAD
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = state.audioContext.createMediaStreamSource(state.stream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.minDecibels = CONFIG.MIN_DECIBELS;
        state.analyser.fftSize = 256;
        source.connect(state.analyser);

        // 2. Setup MediaRecorder to capture the actual audio blobs
        setupMediaRecorder();

        // 3. Start our custom silence detection loop
        startSilenceDetectionLoop();

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

function setupMediaRecorder() {
    state.mediaRecorder = new MediaRecorder(state.stream);
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            state.audioChunks.push(event.data);
        }
    };

    state.mediaRecorder.onstop = async () => {
        if (state.audioChunks.length === 0) return;

        // Combine chunks into a single Blob
        const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });

        // Reset chunks for the next recording
        state.audioChunks = [];

        // Restart recorder immediately if we are still logically "recording"
        if (state.isRecording && state.mediaRecorder.state === 'inactive') {
            state.mediaRecorder.start();
        }

        // Process the audio we just captured
        const modeForThisChunk = state.lastFinishedMode || state.micMode;
        if (!state.isProcessingAI || modeForThisChunk === 'USER') {
            processAudioWithPuter(audioBlob, modeForThisChunk);
        }
    };
}

function startSilenceDetectionLoop() {
    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);

    const checkVolume = () => {
        if (!state.isRecording) {
            state.analysisInterval = requestAnimationFrame(checkVolume);
            return;
        }

        state.analyser.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const averageVolume = sum / dataArray.length;

        // Visualizer Update
        simulateVisualizerVolume(averageVolume);

        // Simple VAD Logic based on volume threshold
        // We define 'speech' as volume > 10 (adjust as needed based on testing)
        const isCurrentlySpeaking = averageVolume > 10;

        if (isCurrentlySpeaking) {
            if (!state.isSpeaking) {
                // Just started speaking
                state.isSpeaking = true;
                updateVadUI(true);
            }
            // Reset silence timer
            state.silenceStartTime = 0;
        } else {
            if (state.isSpeaking) {
                // Just started silence
                if (state.silenceStartTime === 0) {
                    state.silenceStartTime = Date.now();
                } else if (Date.now() - state.silenceStartTime > CONFIG.SILENCE_DELAY_MS) {
                    // Silence has lasted long enough, update UI
                    state.isSpeaking = false;
                    updateVadUI(false);
                    state.silenceStartTime = 0;

                    // We no longer auto-stop the recorder on silence.
                    // The user must manually toggle the mic to submit the recording.
                }
            }
        }

        state.analysisInterval = requestAnimationFrame(checkVolume);
    };

    state.analysisInterval = requestAnimationFrame(checkVolume);
}

async function processAudioWithPuter(audioBlob, mode) {
    if (audioBlob.size < 1000) return; // Ignore empty/tiny blobs

    // We can show an interim UI here since audio has ended
    updateTranscriptUI("Transcribing...", "", mode);

    try {
        console.log(`Sending audio to Puter (${mode})...`);
        const response = await puter.ai.speech2txt(audioBlob);

        const finalTranscript = response.text || response;

        if (finalTranscript && finalTranscript.trim().length > 3) {
            const cleanText = finalTranscript.trim();
            console.log(`Transcription (${mode}):`, cleanText);

            // Log it
            const timestamp = new Date().toLocaleTimeString();
            state.transcriptLog.push({ timestamp, text: cleanText, mode: mode });

            // Add final text to UI feed permanently
            addTranscriptBubble(cleanText, mode);

            // Send to Assistant ONLY if Interviewer
            if (mode === 'INTERVIEWER') {
                // If it's an interviewer, trigger AI
                triggerAI(cleanText);
            }
        } else {
            // Clear the "Transcribing..." text if nothing was found
            const tempEl = document.getElementById('temp-transcript');
            if (tempEl) tempEl.innerHTML = "";
        }

    } catch (err) {
        if (!state.isRecording) {
            console.log("Transcription aborted due to session end.");
            return;
        }

        console.error("Transcription Failed:", err);
        showToast("Transcription error: " + err.message);

        const tempEl = document.getElementById('temp-transcript');
        if (tempEl) tempEl.innerHTML = "<span style='color:red'>Transcription failed</span>";
    }
}



// --- Main Session Logic ---

async function startSession() {
    if (!state.currentUser) {
        showToast("Please login first.");
        switchScreen('auth');
        return;
    }

    const topic = inputs.topic.value.trim();
    if (!topic) {
        showToast("Please enter a meeting topic.");
        return;
    }

    // Auth Puter
    if (!puter.auth.isSignedIn()) {
        await puter.auth.signIn();
    }

    // Init Audio pipeline using the new mobile-friendly method
    const audioOk = await setupMobileFriendlyAudio();
    if (!audioOk) return;

    state.topic = topic;
    state.transcriptAccumulator = "";
    state.chatHistory = [];
    state.transcriptLog = [];
    state.aiLog = [];

    // UI
    displays.transcriptFeed.innerHTML = '';
    displays.aiFeed.innerHTML = '';
    displays.topic.textContent = topic;
    switchScreen('meeting');

    // Start
    state.isRecording = true;
    state.micMode = 'INTERVIEWER';
    state.lastFinishedMode = null;

    try {
        if (state.mediaRecorder && state.mediaRecorder.state === 'inactive') {
            state.mediaRecorder.start();
        }
        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }
        updateMicUI();
    } catch (e) { console.error(e); }
}


function checkAndTriggerAI() {
    // Logic:
    // If VAD said "Speech End" (Silence detected)
    // AND we have accumulated text
    // THEN Send to AI

    const text = state.transcriptAccumulator.trim();
    if (text.length > 5 && !state.isProcessingAI) {
        console.log("Triggering AI on silence...");

        // Commit text to transcript log
        const timestamp = new Date().toLocaleTimeString();
        state.transcriptLog.push({ timestamp, text: text });

        // Clear accumulator for next question
        state.transcriptAccumulator = "";
        updateTranscriptUI("", ""); // Clear input view

        // Add final text to UI feed permanently
        addTranscriptBubble(text);

        triggerAI(text);
    }
}


// --- AI Integration ---

async function triggerAI(text, type = "SPEECH") {
    if (state.isProcessingAI) return;

    let instruction = text;

    // --- CLIENT-SIDE LOOP DETECTION ---
    // Check if the user is just reading the last AI response
    const lastMessage = state.chatHistory.length > 0 ? state.chatHistory[state.chatHistory.length - 1] : null;
    if (lastMessage && lastMessage.role === 'assistant') {
        if (isSelfLoop(instruction, lastMessage.content)) {
            console.warn("Loop detected: User is reading back the last AI response.");

            // Show brief feedback
            const feedbackId = `ignore-msg-${Date.now()}`;
            const feedbackDiv = document.createElement('div');
            feedbackDiv.className = 'ai-message';
            feedbackDiv.id = feedbackId;
            feedbackDiv.style.opacity = "0.6";
            feedbackDiv.style.fontStyle = "italic";
            feedbackDiv.innerText = "(Self-correction/Reading detected - Skipped)";
            displays.aiFeed.appendChild(feedbackDiv);

            // Remove after a moment
            setTimeout(() => {
                if (feedbackDiv.parentNode) feedbackDiv.remove();
            }, 2500);

            return; // STOP HERE
        }
    }

    state.isProcessingAI = true;

    // UI creation
    const aiMessageId = `ai-msg-${Date.now()}`;
    const aiContainer = document.createElement('div');
    aiContainer.className = 'ai-message';
    aiContainer.id = aiMessageId;
    aiContainer.innerHTML = (type === "QUICK") ? "<em>⚡ Quick Reply...</em>" : "<em>Thinking...</em>";
    displays.aiFeed.appendChild(aiContainer);
    // scrollToBottom(displays.aiFeed); // REMOVED: We scroll when text arrives now

    state.chatHistory.push({ role: "user", content: instruction });

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
    // SYSTEM PROMPT FOR ROBUSTNESS
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
        1. You are receiving a transcript of the Interviewer. It may have errors (e.g. "board process" -> "boot process").
        2. **FIRST STEP**: decoding the question. Output it in this format:
           [QUESTION: Your understanding of the question?]
        3. **SECOND STEP**: Answer directly. Do not repeat the question or say "I understood this". Just start the answer.
        
        ANSWERING RULES:
        1. Start with [QUESTION: ...].
        2. Then answer professionally and concisely.
        3. Technical commands in \`\`\`code blocks\`\`\`.
        `
    };

    const recentHistory = state.chatHistory.slice(-15); // Context Window
    const messages = [systemMessage, ...recentHistory];

    try {
        const response = await puter.ai.chat(messages, {
            stream: true,
            model: 'gpt-4o-mini'
        });

        element.innerHTML = "";
        let finalOutput = "";
        let hasScrolled = false;

        // Hide AI Panel Header to give more space
        const aiHeader = document.querySelector('.ai-panel .panel-header');
        if (aiHeader) aiHeader.style.display = 'none';

        for await (const part of response) {
            const text = part?.text || "";
            if (text) {
                finalOutput += text;

                // Check for QUESTION tag
                const qMatch = finalOutput.match(/^\[QUESTION:\s*(.*?)\]/s);
                let htmlContent = "";

                if (qMatch) {
                    // Tag is complete, separate it
                    const qText = qMatch[1];
                    const answerText = finalOutput.substring(qMatch[0].length).trim();

                    const qHtml = `<div style="color: #FFD700; font-weight: bold; margin-bottom: 8px; font-size: 0.95em;">${parseMarkdown(qText)}</div>`;
                    const aHtml = parseMarkdown(answerText);

                    htmlContent = qHtml + aHtml;

                    // Smart Scroll: Snap to top of answer ONCE
                    if (!hasScrolled && (!finalOutput.startsWith("[") || finalOutput.length > 8)) {
                        // Safer manual scroll:
                        const container = displays.aiFeed;
                        const elTop = element.offsetTop;
                        container.scrollTo({ top: elTop - 20, behavior: 'smooth' }); // -20 for padding
                        hasScrolled = true;
                    }
                } else {
                    // Tag not complete or not present yet.
                    if (finalOutput.startsWith("[")) {
                        if (finalOutput.length < 50) {
                            element.innerHTML = "<em>Thinking...</em>";
                            continue;
                        }
                    }

                    // Fallback
                    htmlContent = parseMarkdown(finalOutput);

                    // Smart Scroll Fallback
                    if (!hasScrolled && finalOutput.length > 5) {
                        const container = displays.aiFeed;
                        const elTop = element.offsetTop;
                        container.scrollTo({ top: elTop - 20, behavior: 'smooth' });
                        hasScrolled = true;
                    }
                }

                element.innerHTML = htmlContent;
            }
        }

        return finalOutput;

    } catch (err) {
        console.error("AI Error:", err);
        element.innerHTML = "<span style='color:red'>AI Error</span>";
        return null;
    }
}

async function captureScreenshotAndSolve() {
    if (state.isProcessingAI) {
        showToast("Wait for AI to finish thinking...");
        return;
    }

    try {
        showToast("Select screen/window to capture...", 4000);
        // Request screen capture
        const captureStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: "window"
            },
            audio: false
        });

        // Create a video element to play the stream
        const video = document.createElement('video');
        video.srcObject = captureStream;
        video.play();

        // Wait for video to load metadata
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve();
            };
        });

        // Wait a tiny bit more for the first frame to render properly
        await new Promise(resolve => setTimeout(resolve, 500));

        // Create canvas and draw the frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Stop the capture stream immediately after grabbing frame
        captureStream.getTracks().forEach(track => track.stop());

        // Get Data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

        // Show AI is thinking
        state.isProcessingAI = true;
        const aiMessageId = `ai-msg-${Date.now()}`;
        const aiContainer = document.createElement('div');
        aiContainer.className = 'ai-message';
        aiContainer.id = aiMessageId;
        aiContainer.innerHTML = "<em>Analyzing screen image...</em>";
        displays.aiFeed.appendChild(aiContainer);

        // Scroll
        scrollToBottom(displays.aiFeed);

        // Prepare message for Puter AI Vision
        const visionPrompt = "Analyze this image from a technical interview or problem. It contains a question or code. Act as an expert candidate, extract the problem, and provide a clear, concise step-by-step solution.";

        state.chatHistory.push({ role: "user", content: "[User sent a screenshot]" });

        const messages = [
            {
                role: "system",
                content: `You are an expert technical candidate. You will be given an image. Read the text, understand the problem, and output the solution in Markdown. Keep it strictly focused on solving the problem shown.`
            },
            {
                role: "user",
                content: [
                    { type: "text", text: visionPrompt },
                    { type: "image_url", image_url: { url: dataUrl } }
                ]
            }
        ];

        // Send to Puter API
        const response = await puter.ai.chat(messages, {
            model: 'gpt-4o-mini'
        });

        // Handle response (Assuming unary response for vision for simplicity, or stream if supported)
        let finalOutput = "";
        if (response && response.message && response.message.content) {
            finalOutput = response.message.content;
        } else if (typeof response === "string") {
            finalOutput = response;
        } else {
            finalOutput = response?.text || "Could not analyze the image.";
        }

        aiContainer.innerHTML = parseMarkdown(finalOutput);

        state.chatHistory.push({ role: "assistant", content: finalOutput });
        state.aiLog.push({ timestamp: new Date().toLocaleTimeString(), text: finalOutput });

    } catch (err) {
        console.error("Screenshot Capture Failed:", err);
        if (err.name === 'NotAllowedError') {
            showToast("Screen capture cancelled.");
        } else {
            showToast("Screenshot capture failed.");
        }
    } finally {
        state.isProcessingAI = false;
    }
}

async function quickReply() {
    // Use whatever is in accumulator OR last transcript
    let text = state.transcriptAccumulator.trim();
    if (!text && state.transcriptLog.length > 0) {
        text = state.transcriptLog[state.transcriptLog.length - 1].text;
    }

    if (text) {
        await triggerAI(text, "QUICK");
        state.transcriptAccumulator = ""; // Clear buffer
    } else {
        showToast("Nothing to reply to!");
    }
}


// --- Helper Functions ---

function toggleMic() {
    if (!state.isRecording) {
        // First manual start (if stopped completely)
        state.isRecording = true;
        state.micMode = 'INTERVIEWER';
        state.lastFinishedMode = null;

        if (state.mediaRecorder && state.mediaRecorder.state === 'inactive') {
            state.mediaRecorder.start();
        }
        if (state.audioContext && state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }
        updateMicUI();
        return;
    }

    // Capture the mode we are ending
    state.lastFinishedMode = state.micMode;

    // Toggle the active mode
    state.micMode = (state.micMode === 'INTERVIEWER') ? 'USER' : 'INTERVIEWER';
    updateMicUI();

    // Trigger chunk processing by stopping the recorder manually.
    // The onstop event will push the audio blob via processAudioWithPuter,
    // and instantly restart the recorder because state.isRecording is still true.
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
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

    const prefix = mode === 'USER' ? 'You' : 'Inv';
    const strongTag = mode === 'USER' ? `<strong style="color: #64ffda;">${prefix}:</strong>` : `<strong>${prefix}:</strong>`;

    tempEl.innerHTML = `${strongTag} ${finalT} <span style='color:#888'>${interimT}</span>`;
    if (mode === 'USER') tempEl.classList.add('user-segment');
    scrollToBottom(displays.transcriptFeed);

    if (finalT || interimT) {
        const trHeader = document.querySelector('.transcript-panel .panel-header');
        if (trHeader) trHeader.style.display = 'none';
    }
}

function addTranscriptBubble(text, mode = 'INTERVIEWER') {
    let tempEl = document.getElementById('temp-transcript');
    if (tempEl) tempEl.remove();

    const p = document.createElement('p');
    p.className = 'transcript-segment final';
    if (mode === 'USER') p.classList.add('user-segment');

    const prefix = mode === 'USER' ? 'You' : 'Inv';
    const strongTag = mode === 'USER' ? `<strong style="color: #64ffda;">${prefix}:</strong>` : `<strong>${prefix}:</strong>`;

    p.innerHTML = `${strongTag} ${text}`;
    displays.transcriptFeed.appendChild(p);
    scrollToBottom(displays.transcriptFeed);
}

function updateMicUI() {
    if (state.isRecording) {
        buttons.micToggle.classList.add('active');
        if (state.micMode === 'INTERVIEWER') {
            displays.status.innerHTML = "Listening to Interviewer...";
            buttons.micToggle.style.backgroundColor = "#f44336"; // Red to signify "recording interviewer"
        } else {
            displays.status.innerHTML = "Recording Your Answer...";
            buttons.micToggle.style.backgroundColor = "transparent"; // Grey-like/default look
            buttons.micToggle.style.border = "2px solid rgba(255,255,255,0.3)";
        }
    } else {
        buttons.micToggle.classList.remove('active');
        buttons.micToggle.style.backgroundColor = "";
        buttons.micToggle.style.border = "";
        displays.status.innerHTML = "Mic Paused";
    }
}

function switchScreen(name) {
    const target = screens[name];

    // Hide all others
    Object.values(screens).forEach(s => {
        if (s !== target) {
            s.classList.remove('active');
            setTimeout(() => {
                // Double check it hasn't become active again in the meantime
                if (!s.classList.contains('active')) {
                    s.style.display = 'none';
                }
            }, 400);
        }
    });

    if (target) {
        // Ensure it's visible immediately
        target.style.display = 'flex';
        // Small delay to allow display change to render before adding opacity transition
        requestAnimationFrame(() => {
            target.classList.add('active');
        });
    }

    // Special Case: Hide the initial header/logo area if moving to meeting
    const mainHeader = document.querySelector('body > .app-container > header');
    if (mainHeader) {
        if (name === 'meeting') {
            mainHeader.style.display = 'none';
        } else if (name === 'setup' || name === 'end') {
            // You might want to show it again on end screen
            mainHeader.style.display = 'block';
        }
    }
}

function simulateVisualizerVolume(data) {
    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const val = Math.min(rms * 5, 1); // Boost

    displays.visualizerBars.forEach(bar => {
        bar.style.transform = `scaleY(${Math.max(0.1, val + Math.random() * 0.2)})`;
    });
}

// ... Keep existing parseMarkdown, downloadTranscript, clearExit ...
function parseMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/```([\s\S]*?)```/g, '<div class="code-box">$1</div>');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return html.replace(/\n/g, '<br>');
}

function downloadTranscript() {
    let output = "INTERVIEW Q&A SESSION LOG\n";
    output += "=========================\n\n";

    // Combine both logs into one array so we can sort chronologically
    let combinedLogs = [];

    state.transcriptLog.forEach(entry => {
        combinedLogs.push({
            time: entry.timestamp,
            speaker: (entry.mode === 'USER') ? "YOU" : "INTERVIEWER",
            text: entry.text,
            type: 'speech'
        });
    });

    state.aiLog.forEach(entry => {
        // Strip the [QUESTION: ...] wrapper if it exists for cleaner reading
        let cleanText = entry.text;
        const qMatch = cleanText.match(/^\[QUESTION:\s*(.*?)\]/s);
        if (qMatch) {
            cleanText = cleanText.substring(qMatch[0].length).trim();
        }

        combinedLogs.push({
            time: entry.timestamp,
            speaker: "AI ASSISTANT",
            text: cleanText,
            type: 'ai'
        });
    });

    // Sort by timestamp string (This relies on toLocaleTimeString being sortable, 
    // but since they are generated sequentially in a session, their array index order + time works fine.
    // For safer parsing we rely on the fact they were inserted sequentially anyway).
    // A simpler approach: Just sort by string comparison of timestamp or assume pushing order is close enough.
    // To be perfectly safe, since they might be pushed out of exact ms order, we'll sort.
    combinedLogs.sort((a, b) => {
        // Create dummy dates to parse the times correctly
        const timeA = new Date('1970/01/01 ' + a.time);
        const timeB = new Date('1970/01/01 ' + b.time);
        return timeA - timeB;
    });

    combinedLogs.forEach(entry => {
        output += `[${entry.time}] ${entry.speaker}:\n`;
        output += `${entry.text}\n\n`;
    });

    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'interview_qa.txt';
    a.click();
}

function clearAndExit() {
    location.reload();
}


function endSession() {
    state.isRecording = false;

    // Stop custom loops and processes
    cancelAnimationFrame(state.analysisInterval);

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }

    // Stop all media tracks to release the microphone
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
    }

    if (state.audioContext) {
        state.audioContext.close();
    }

    switchScreen('end');

    // Restore AI header for next time
    const aiHeader = document.querySelector('.ai-panel .panel-header');
    if (aiHeader) aiHeader.style.display = 'flex';

    const trHeader = document.querySelector('.transcript-panel .panel-header');
    if (trHeader) trHeader.style.display = 'flex';

    // Populate stats (basic for now)
    const totalWords = state.transcriptLog.reduce((acc, l) => acc + l.text.split(' ').length, 0);
    displays.statWords.textContent = totalWords + " words";
    displays.statInsights.textContent = state.aiLog.length + " generated";

    // Auto-update usage in backend
    if (state.currentUser && totalWords > 0) {
        // Assume roughly 150 words per minute
        const estMinutes = Math.max(1, (totalWords / 150)).toFixed(1);
        try {
            const params = new URLSearchParams();
            params.append('action', 'updateUsage');
            params.append('email', state.currentUser.email);
            params.append('minutes', estMinutes);

            fetch(GOOGLE_URL, {
                method: 'POST',
                body: params,
                redirect: 'follow'
            });
        } catch (e) { }
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

    // Normalize: lowercase, remove punctuation, extra whitespace
    const cleanUser = userText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
    const cleanAI = lastAiText.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();

    // 0. EXACT MATCH (Always ignore)
    if (cleanUser === cleanAI) return true;

    // 1. SAFEGUARD: Strong Question Words
    // If the user starts with a question word, they are likely asking a follow-up, 
    // even if they repeat words from the answer (e.g. "Why uses React?").
    const questionWords = ["why", "how", "what", "when", "where", "who", "which", "can", "could", "would", "explain", "tell", "elaborate"];
    const firstWord = cleanUser.split(" ")[0];
    if (questionWords.includes(firstWord)) return false;

    // 2. Length check. 
    // Short utterances (< 3 words) are ambiguous if not exact matches. default to processing.
    const userWords = cleanUser.split(" ");
    if (userWords.length < 3) return false;

    // 3. Phrase Reading Detection (Long Substring)
    // If the user text is a direct substring of the AI text, it's likely a reading.
    // BUT only if it's a *significant* length to avoid matching common phrases like "is a".
    if (cleanAI.includes(cleanUser)) {
        // If the matching phrase is > 15 chars OR > 80% of the AI's length (if AI response was short)
        if (cleanUser.length > 20 || cleanUser.length > cleanAI.length * 0.8) {
            return true;
        }
    }

    // 4. Word Overlap (Fuzzy Match)
    // Check if the user is saying a "bag of words" that is entirely contained in the AI response.
    const aiWords = new Set(cleanAI.split(" "));
    let matchCount = 0;

    userWords.forEach(w => {
        if (aiWords.has(w)) matchCount++;
    });

    const similarity = matchCount / userWords.length;

    // Only ignore if similarity is VERY high (> 90%), meaning almost NO new words were introduced.
    if (similarity > 0.9) return true;

    return false;
}

// --- Missing Helpers ---

function scrollToBottom(element) {
    element.scrollTo({
        top: element.scrollHeight,
        behavior: 'smooth'
    });
}

function showToast(msg, duration = 3000) {
    const t = displays.toast;
    t.textContent = msg;
    t.classList.add('show');
    t.classList.remove('hidden');
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.classList.add('hidden'), 300);
    }, duration);
}

window.addEventListener('load', init);

// --- Feedback Logic ---
let currentRating = 0;

document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', (e) => {
        currentRating = parseInt(e.target.dataset.value);
        document.querySelectorAll('.star').forEach(s => {
            const val = parseInt(s.dataset.value);
            s.textContent = val <= currentRating ? 'star' : 'star_outline';
            if (val <= currentRating) {
                s.style.color = '#FFD700';
            } else {
                s.style.color = '';
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submit-feedback-btn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async (e) => {
            const btn = e.target;
            const comment = document.getElementById('feedback-comment').value.trim();
            if (currentRating === 0 && !comment) {
                showToast("Please provide a rating or a comment");
                return;
            }
            setLoading(btn, true);
            try {
                const params = new URLSearchParams();
                params.append('action', 'submitFeedback');
                params.append('email', state.currentUser ? state.currentUser.email : 'guest');
                params.append('topic', state.topic || 'Untitled Session');
                params.append('rating', currentRating);
                params.append('comment', comment);

                const res = await fetch(GOOGLE_URL, {
                    method: 'POST',
                    body: params,
                    redirect: 'follow'
                });
                const textData = await res.text();
                const data = JSON.parse(textData);
                if (data.status === 'success') {
                    showToast("Feedback submitted successfully.");
                    document.getElementById('feedback-section').innerHTML = "<p style='color: var(--success); text-align: center; padding: 20px 0;'>Thank you for your feedback!</p>";
                } else {
                    showToast("Failed to submit feedback: " + data.message);
                }
            } catch (err) {
                showToast("Error submitting feedback.");
                console.error(err);
            } finally {
                setLoading(btn, false);
            }
        });
    }
});
