/**
 * Wakeup AI - Logic Script
 * Handles Speech Recognition, Puter.js AI Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    // No API Keys needed! Puter.js handles auth.
};

const state = {
    topic: '',
    isRecording: false,
    transcriptLog: [],
    aiLog: [],
    chatHistory: [],
    recognition: null,
    dummyStream: null,
    silenceTimer: null,
    isProcessingAI: false,
    pendingBuffer: "",
    lastAiCallTime: 0,
    // Speech & Trigger State
    transcriptOffset: 0,
    aiTriggerBuffer: "",
    aiTriggerTimer: null
};

// --- DOM Elements ---
const screens = {
    // 'setup' is the default underlying layer now
    meeting: document.getElementById('meeting-screen'),
    end: document.getElementById('end-screen')
};

const inputs = {
    topic: document.getElementById('topic-input')
};

const buttons = {
    start: document.getElementById('start-btn'),

    quickReplyMeeting: document.getElementById('quick-reply-meeting-btn'),
    endMeeting: document.getElementById('end-meeting-btn'),
    micToggle: document.getElementById('mic-toggle-btn'),
    download: document.getElementById('download-btn'),
    clearExit: document.getElementById('clear-exit-btn')
};

const displays = {
    topic: document.getElementById('display-topic'),
    transcriptFeed: document.getElementById('transcript-feed'),
    aiFeed: document.getElementById('ai-feed'),
    status: document.getElementById('status-text'),
    visualizerBars: document.querySelectorAll('.bar'),
    statWords: document.getElementById('stat-words'),
    statInsights: document.getElementById('stat-insights'),
    toast: document.getElementById('toast')
};

// --- Initialization ---

function init() {
    // Check protocol
    if (window.location.protocol === 'file:') {
        showToast("⚠️ Run via Local Server to save permissions!");
    }

    // Disclaimer & Tips
    console.log("Note: Browser Speech API does not support Speaker Diarization.");
    showToast("Tip: For Laptop Audio, increase volume & place Mic closer!", 5000);

    // Event Listeners
    buttons.start.addEventListener('click', startSession);

    if (buttons.quickReplyMeeting) buttons.quickReplyMeeting.addEventListener('click', quickReply);

    buttons.endMeeting.addEventListener('click', endSession);
    buttons.micToggle.addEventListener('click', toggleMic);
    buttons.download.addEventListener('click', downloadTranscript);
    buttons.clearExit.addEventListener('click', clearAndExit);

    // Spacebar to toggle mic
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            toggleMic();
        }
    });

    // Device Check & Advice
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
        showToast("📱 Mobile Text: For capturing Laptop Audio, it is better to open this app on your Laptop Browser!", 8000);
    }

    // Setup Speech Recognition
    setupSpeechRecognition();
}

function setupSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showToast("Speech API not supported in this browser. Use Chrome/Edge.");
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
        state.isRecording = true;
        updateMicUI(true);
    };

    state.recognition.onend = () => {
        // Android/Chrome often resets the internal buffer on restart.
        // We must reset our offset tracking to match the new session.
        state.transcriptOffset = 0;

        // Auto-restart if we shouldn't have stopped
        if (state.isRecording) {
            setTimeout(() => {
                if (state.isRecording) {
                    try {
                        state.recognition.start();
                    } catch (e) {
                        console.warn("Re-start failed:", e);
                        updateMicUI(false);
                        state.isRecording = false;
                    }
                }
            }, 100);
        } else {
            updateMicUI(false);
        }
    };

    state.recognition.onresult = handleSpeechResult;

    state.recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return;
        }
        console.error("Speech Error:", event.error);

        // Show capturing errors
        if (event.error === 'network' || event.error === 'audio-capture' || event.error === 'not-allowed') {
            showToast("⚠️ Speech Error: " + event.error);
        }

        if (event.error === 'not-allowed') {
            state.isRecording = false;
            updateMicUI(false);
        }
    };
}

// Hack to force "High Sensitive" Audio Mode
// NOTE: Disabled on Mobile because it causes "Audio Focus" contention with Speech API
async function setupAudioMode() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
        console.log("Skipping 'Dummy Stream' hack on mobile to prevent conflict.");
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    try {
        if (state.dummyStream) {
            state.dummyStream.getTracks().forEach(t => t.stop());
        }

        // Request raw audio to disable system Noise Gate/Cancel
        // KEEP THIS STREAM OPEN to force the OS audio session into "Raw" mode
        state.dummyStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            }
        });

        console.log("Audio mode set to High Sensitivity (Stream Open)");
    } catch (e) {
        console.warn("Could not set audio mode:", e);
    }
}

// --- Puter.js AI Integration ---

async function startSession() {
    const topic = inputs.topic.value.trim();

    if (!topic) {
        showToast("Please enter a meeting topic.");
        return;
    }

    // Puter Auth Check
    if (!puter.auth.isSignedIn()) {
        showToast("Signing in to Puter...", 2000);
        await puter.auth.signIn();
    }

    // Try to force high sensitivity audio
    await setupAudioMode();

    state.topic = topic;
    state.chatHistory = [];
    state.transcriptLog = [];
    state.aiLog = [];
    state.transcriptOffset = 0;
    state.aiTriggerBuffer = "";
    clearTimeout(state.aiTriggerTimer);

    // Clear feeds
    displays.transcriptFeed.innerHTML = '';
    displays.aiFeed.innerHTML = '';
    displays.topic.textContent = topic;

    // Switch Screen
    switchScreen('meeting');

    // Start Mic
    try {
        state.recognition.start();
    } catch (e) {
        console.error(e);
    }
}

async function streamAIResponse(element) {
    const systemMessage = {
        role: "system",
        content: `You are an AI assistant in a meeting. The topic is: "${state.topic}".
        RULES:
        1. Format response using bullet points (- point).
        2. Technical/Code commands MUST be in triple backticks (e.g. \`\`\`npm install\`\`\`) on a new line.
        3. Be concise (1-2 sentences per point).
        4. IGNORE inputs that are just the user reading your previous response aloud.`
    };

    // Keep context window manageable (System + Last 20 messages)
    const recentHistory = state.chatHistory.slice(-20);
    const messages = [systemMessage, ...recentHistory];

    try {
        console.time("AI_Latency");
        // Use Puter.js Chat Streaming - Request GPT-4o-mini for speed
        const response = await puter.ai.chat(messages, {
            stream: true,
            model: 'gpt-4o-mini'
        });

        element.innerHTML = ""; // Clear loading dots
        let finalOutput = "";
        let firstToken = true;

        for await (const part of response) {
            if (firstToken) {
                console.timeEnd("AI_Latency");
                firstToken = false;
            }
            const text = part?.text || "";
            if (text) {
                finalOutput += text;
                element.innerHTML = parseMarkdown(finalOutput);
                scrollToBottom(displays.aiFeed);
            }
        }

        return finalOutput;

    } catch (error) {
        console.error(error);
        element.textContent = `Error: ${error.message}`;
        return null;
    }
}

// --- Quick Reply Logic ---

async function quickReply() {
    // 1. Check pending buffer first
    let text = state.aiTriggerBuffer.trim();

    // 2. If empty, check recent transcript (Context)
    if (!text && state.transcriptLog.length > 0) {
        // Take last 3 entries to get enough context
        const last = state.transcriptLog.slice(-3).map(i => i.text).join(" ");
        text = last.trim();
    }

    if (!text) {
        showToast("No text to reply to!");
        return;
    }

    // Force send
    showToast("⚡ Sending Quick Reply...");
    state.aiTriggerBuffer = ""; // Clear buffer so it doesn't send again automatically
    clearTimeout(state.aiTriggerTimer); // Stop auto-timer

    await triggerAI(text, "QUICK");
}

async function triggerAI(text, type = "SPEECH") {
    if (state.isProcessingAI) return;

    let instruction = text;
    if (type === "QUICK") {
        instruction = `[System: User clicked 'Quick Reply'. Answer this immediately and briefly (1-2 sentences).]\n\n${text}`;
    }

    state.isProcessingAI = true;

    // UI: "Analyzing..." or "..."
    const aiMessageId = `ai-msg-${Date.now()}`;
    const aiContainer = document.createElement('div');
    aiContainer.className = 'ai-message';
    aiContainer.id = aiMessageId;
    // Visual cue for quick reply
    aiContainer.innerHTML = (type === "QUICK") ? "<em>⚡ Quick Reply...</em>" : "<em>Thinking...</em>";
    displays.aiFeed.appendChild(aiContainer);
    scrollToBottom(displays.aiFeed);

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


function endSession() {
    state.isRecording = false;
    state.recognition.stop();

    if (state.dummyStream) {
        state.dummyStream.getTracks().forEach(t => t.stop());
        state.dummyStream = null;
    }

    // Calculate Stats
    const totalWords = state.transcriptLog.reduce((acc, log) => acc + log.text.split(' ').length, 0);
    displays.statWords.textContent = `${totalWords} words`;
    displays.statInsights.textContent = `${state.aiLog.length} generated`;

    switchScreen('end');
}

function toggleMic() {
    if (state.isRecording) {
        state.isRecording = false;
        state.recognition.stop();
        showToast("Microphone paused.");
    } else {
        state.recognition.start();
        showToast("Microphone active.");
    }
}

// (Globals removed, moved to state)

function handleSpeechResult(event) {
    let finalTranscript = '';
    let interimTranscript = '';
    let newFinalText = '';

    for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }

    if (finalTranscript.length > state.transcriptOffset) {
        newFinalText = finalTranscript.substring(state.transcriptOffset);
        state.transcriptOffset = finalTranscript.length;
    }

    // UI: Append inline to avoid fragmentation
    updateTranscriptUI(newFinalText, interimTranscript);

    // Visualize
    if (interimTranscript.length > 0 || newFinalText.length > 0) {
        simulateVisualizer(true);
    } else {
        simulateVisualizer(false);
    }

    // Smart AI Triggering
    if (newFinalText) {
        const cleanChunk = newFinalText; // Keep spaces
        if (cleanChunk.trim().length > 0) {
            state.aiTriggerBuffer += cleanChunk;

            // Log for transcript record
            const timestamp = new Date().toLocaleTimeString();
            state.transcriptLog.push({ timestamp, text: cleanChunk.trim() });

            // Check for sentence completion
            if (/[.?!]$/.test(cleanChunk.trim())) {
                flushAiBuffer();
            } else {
                // Debounce: Wait 1s silence, then send
                clearTimeout(state.aiTriggerTimer);
                state.aiTriggerTimer = setTimeout(flushAiBuffer, 1500);
            }
        }
    }
}

function flushAiBuffer() {
    clearTimeout(state.aiTriggerTimer);
    if (state.aiTriggerBuffer.trim().length > 2) {
        triggerAI(state.aiTriggerBuffer.trim());
        state.aiTriggerBuffer = "";
    }
}

function updateTranscriptUI(finalText, interimText) {
    // 1. Handle Final Text (Append to last final paragraph if exists)
    if (finalText) {
        let lastFinal = document.querySelector('.transcript-segment.final:last-of-type');

        // Create new paragraph if none exists or length is getting too huge
        if (!lastFinal || lastFinal.textContent.length > 500) {
            lastFinal = document.createElement('p');
            lastFinal.className = 'transcript-segment final';
            // Insert before interim node if it exists, otherwise append
            const interimNode = document.getElementById('interim-node');
            if (interimNode) {
                displays.transcriptFeed.insertBefore(lastFinal, interimNode);
            } else {
                displays.transcriptFeed.appendChild(lastFinal);
            }
        }

        lastFinal.textContent += finalText;
        scrollToBottom(displays.transcriptFeed);
    }

    // 2. Handle Interim (DISABLED per user request: Only show final text)
    /*
    let interimNode = document.getElementById('interim-node');
    if (!interimNode) {
        interimNode = document.createElement('p');
        interimNode.id = 'interim-node';
        interimNode.className = 'transcript-segment interim';
        displays.transcriptFeed.appendChild(interimNode);
    }

    interimNode.textContent = interimText;

    if (!interimText) {
        // Don't remove node to keep layout stable, just clear text
        interimNode.textContent = "";
    } else {
        scrollToBottom(displays.transcriptFeed);
    }
    */
}

// --- Helpers & UI ---

function switchScreen(screenName) {
    Object.values(screens).forEach(el => {
        if (!el) return;
        el.classList.remove('active');
        setTimeout(() => {
            if (!el.classList.contains('active')) el.style.display = 'none';
        }, 400);
    });

    const target = screens[screenName];
    if (target) {
        target.style.display = 'flex';
        // Small delay to allow display flex to apply before opacity transition
        setTimeout(() => {
            target.classList.add('active');
        }, 50);
    }
}

function updateMicUI(isActive) {
    const btn = buttons.micToggle;
    if (isActive) {
        btn.classList.add('active');
        displays.status.textContent = "Listening...";
        simulateVisualizer(true);
    } else {
        btn.classList.remove('active');
        displays.status.textContent = "Paused";
        simulateVisualizer(false);
    }
}

function scrollToBottom(element) {
    element.scrollTo({
        top: element.scrollHeight,
        behavior: 'smooth'
    });
}

function showToast(msg) {
    const t = displays.toast;
    t.textContent = msg;
    t.classList.add('show');
    t.classList.remove('hidden');
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.classList.add('hidden'), 300);
    }, 3000);
}

function simulateVisualizer(active) {
    displays.visualizerBars.forEach(bar => {
        if (active) {
            bar.style.animationDuration = `${Math.random() * 0.5 + 0.2}s`;
            bar.style.transform = `scaleY(${Math.random() * 0.8 + 0.2})`;
        } else {
            bar.style.transform = 'scaleY(0.1)';
        }
    });

    if (active && state.isRecording) {
        requestAnimationFrame(() => simulateVisualizer(true));
    }
}

function parseMarkdown(text) {
    if (!text) return "";
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Code Blocks
    html = html.replace(/```([\s\S]*?)```/g, '<div class="code-box">$1</div>');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Lists
    const lines = html.split('\n');
    let inList = false;
    let newHtml = "";

    lines.forEach(line => {
        if (line.trim().startsWith('- ')) {
            if (!inList) {
                newHtml += "<ul>";
                inList = true;
            }
            newHtml += `<li>${line.trim().substring(2)}</li>`;
        } else {
            if (inList) {
                newHtml += "</ul>";
                inList = false;
            }
            newHtml += line + "<br>";
        }
    });
    if (inList) newHtml += "</ul>";

    return newHtml;
}

// --- Data Management ---

function downloadTranscript() {
    const lines = [];
    lines.push(`MEETING: ${state.topic}`);
    lines.push(`DATE: ${new Date().toLocaleString()}`);
    lines.push('--- TRANSCRIPT ---');
    state.transcriptLog.forEach(item => {
        lines.push(`[${item.timestamp}] User: ${item.text}`);
    });
    lines.push('\n--- AI INSIGHTS ---');
    state.aiLog.forEach(item => {
        lines.push(`[${item.timestamp}] AI: ${item.text}`);
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `Meeting_Transcript_${Date.now()}.txt`;
    a.click();

    URL.revokeObjectURL(url);
    showToast("Transcript downloaded.");
}

function clearAndExit() {
    sessionStorage.clear();
    location.reload();
}



// Run
window.addEventListener('load', init);
