/**
 * Wakeup AI - Logic Script
 * Handles Speech Recognition, Puter.js AI Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    // VAD Settings
    SAMPLE_RATE: 16000,
    FRAME_SIZE: 512, // 32ms at 16kHz
};

const state = {
    topic: '',
    isRecording: false,
    transcriptLog: [],
    aiLog: [],
    chatHistory: [],
    recognition: null, // Web Speech API
    audioContext: null, // For VAD
    vadWorker: null,

    // VAD Logic
    isSpeaking: false, // True if VAD detecting speech
    silenceStartTime: 0,

    isProcessingAI: false,
    pendingBuffer: "",
    lastAiCallTime: 0,

    // For "Pause" handling
    transcriptAccumulator: "", // Accumulates text while speaking + short pauses
};

// --- DOM Elements ---
const screens = {
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
    vadStatus: document.getElementById('vad-status'),
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

    console.log("Note: Browser Speech API does not support Speaker Diarization.");
    showToast("Tip: Use Headphones for best VAD performance!", 5000);

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

    // Check VAD support
    if (!window.Worker) {
        showToast("Web Workers not supported. VAD will not function.");
    }
}

// --- Audio & VAD Setup ---

async function setupAudioProcessing() {
    try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: CONFIG.SAMPLE_RATE,
            latencyHint: 'interactive'
        });

        // Mobile browsers often ignore the requested sampleRate in the constructor
        const actualRate = state.audioContext.sampleRate;
        console.log(`Audio Context Created. Requested: ${CONFIG.SAMPLE_RATE}, Actual: ${actualRate}`);

        // Load VAD Worker
        try {
            state.vadWorker = new Worker('./vad_worker.js');
            state.vadWorker.onerror = (err) => {
                console.error("VAD Worker Error:", err);
                showToast("Error loading VAD Worker. Check console.");
            };
        } catch (workerErr) {
            console.error("Worker Creation Failed:", workerErr);
            showToast("Failed to initialize VAD. Browser might block workers.");
            return false;
        }

        state.vadWorker.onmessage = handleVadMessage;
        state.vadWorker.postMessage({ type: 'INIT' });

        // Get Stream
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const source = state.audioContext.createMediaStreamSource(stream);

        // Worklet or ScriptProcessor (simpler for single file)
        const processor = state.audioContext.createScriptProcessor(CONFIG.FRAME_SIZE, 1, 1);

        source.connect(processor);
        processor.connect(state.audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (!state.isRecording) return;

            const inputData = e.inputBuffer.getChannelData(0);

            // --- SMART DOWNSAMPLER ---
            // "The Funnel": If audio is too fast (e.g. 48k on mobile), slow it down to 16k
            let vadInput = inputData;

            if (actualRate !== CONFIG.SAMPLE_RATE) {
                vadInput = downsampleBuffer(inputData, actualRate, CONFIG.SAMPLE_RATE);
            }

            state.vadWorker.postMessage({
                type: 'PROCESS',
                audio: vadInput
            });

            // Visualize
            simulateVisualizerVolume(inputData);
        };

        // Notify debug
        showToast(`Audio Ready: ${actualRate}Hz`);
        return true;

    } catch (e) {
        console.error("Audio Setup Failed:", e);
        showToast("Audio Access Denied: " + e.message);
        return false;
    }
}

// Helper: The "Funnel" that shrinks audio
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) {
        return buffer;
    }
    if (outSampleRate > sampleRate) {
        // Upsampling not supported/needed
        return buffer;
    }
    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        // Use average value of accumulated samples (simple downsampling)
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

function handleVadMessage(e) {
    const msg = e.data;
    if (msg.type === 'SPEECH_START') {
        state.isSpeaking = true;
        updateVadUI(true);
    }
    else if (msg.type === 'SPEECH_END') {
        state.isSpeaking = false;
        updateVadUI(false);
        // VAD says User finished speaking.
        // Trigger AI if we have enough text and it's been silent for a moment.
        // NOTE: VAD handles the "silence duration" inside the worker (currently ~1.2s).
        // So if we get SPEECH_END, it means silence WAS > 1.2s.

        // Check if we have pending transcript
        checkAndTriggerAI();
    }
    else if (msg.type === 'LOADED') {
        console.log("VAD Model Ready");
        displays.vadStatus.textContent = "VAD: Ready";
        displays.vadStatus.classList.remove('hidden');
    }
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
    state.recognition.lang = 'en-IN';

    state.recognition.onstart = () => {
        // state.isRecording is managed by startSession
    };

    state.recognition.onresult = (event) => {
        let interim = '';
        let hasFinal = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                state.transcriptAccumulator += " " + event.results[i][0].transcript;
                hasFinal = true;
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        // Update UI
        updateTranscriptUI(state.transcriptAccumulator, interim);

        // If we got a final result AND VAD says we are silent, trigger AI immediately.
        // This fixes the race condition where Speech API finalizes AFTER VAD detects silence.
        if (hasFinal && !state.isSpeaking) {
            checkAndTriggerAI();
        }
    };

    state.recognition.onerror = (e) => {
        console.warn("Speech Rec Error:", e.error);

        // Filter out common minor errors
        if (e.error === 'no-speech') return;

        if (e.error === 'network') {
            showToast("Network Error: Transcript may stop.");
        } else if (e.error === 'not-allowed') {
            showToast("Microphone Blocked. Check permissions.");
        } else {
            showToast(`Speech Error: ${e.error}`);
        }
    };

    state.recognition.onend = () => {
        // Only restart if we are still logically "recording"
        if (state.isRecording) {
            console.log("Speech API ended, attempting restart...");
            try {
                // Determine if we need a slight delay to prevent crash-loops
                // (e.g. if error was 'no-speech', restart is fast. If 'network', maybe wait)
                state.recognition.start();
            } catch (e) {
                console.warn("Restart failed:", e);
                // If immediate restart fails, try again shortly with a backoff
                setTimeout(() => {
                    if (state.isRecording) {
                        try { state.recognition.start(); } catch (e) { }
                    }
                }, 1000);
            }
        }
    };
}


// --- Main Session Logic ---

async function startSession() {
    const topic = inputs.topic.value.trim();
    if (!topic) {
        showToast("Please enter a meeting topic.");
        return;
    }

    // Auth Puter
    if (!puter.auth.isSignedIn()) {
        await puter.auth.signIn();
    }

    // Init Audio
    const audioOk = await setupAudioProcessing();
    if (!audioOk) return;

    setupSpeechRecognition();

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
    try {
        state.recognition.start();
        updateMicUI(true);
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
           
        CRITICAL: LOOP DETECTION
        - If the INPUT text is simply a reading (or paraphrasing) of your LAST output, DO NOT generate a new answer.
        - Output exactly: [IGNORE]
        
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

        for await (const part of response) {
            const text = part?.text || "";
            if (text) {
                finalOutput += text;

                // Check for IGNORE tag early
                if (finalOutput.startsWith("[IGNORE]")) {
                    element.innerHTML = "<em>(Reading detected - ignored)</em>";
                    element.style.opacity = "0.5";
                    continue;
                }

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

                    // Scroll once we have the answer started
                    if (!hasScrolled && answerText.length > 5) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        hasScrolled = true;
                    }
                } else {
                    // Tag not complete or not present yet.
                    // If it looks like a tag is starting, wait a bit (don't show raw brackets)
                    if (finalOutput.startsWith("[")) {
                        // Just show thinking until we close the bracket or get enough text to know it's not a tag
                        if (finalOutput.length < 50) { // arbitrary buffer
                            element.innerHTML = "<em>Thinking...</em>";
                            continue;
                        }
                    }
                    // Fallback to normal display if no tag found after buffer
                    htmlContent = parseMarkdown(finalOutput);
                    if (!hasScrolled && finalOutput.length > 5) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        hasScrolled = true;
                    }
                }

                element.innerHTML = htmlContent;
            }
        }

        if (finalOutput.includes("[IGNORE]")) {
            setTimeout(() => {
                if (element.parentNode) element.remove();
            }, 2000);
            return null; // Don't save to history
        }

        // Clean up the Q tag from the stored history? 
        // User wants to save the ENTIRE thing (including [QUESTION]) so the AI 
        // sees the pattern in history and continues to output it.

        return finalOutput;
    } catch (err) {
        console.error("AI Error:", err);
        element.innerHTML = "<span style='color:red'>AI Error</span>";
        return null;
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
    if (state.isRecording) {
        state.isRecording = false;
        state.recognition.stop();
        if (state.audioContext) state.audioContext.suspend();
        updateMicUI(false);
    } else {
        state.isRecording = true;
        state.recognition.start();
        if (state.audioContext) state.audioContext.resume();
        updateMicUI(true);
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

function updateTranscriptUI(finalT, interimT) {
    // Updates the "Current Input" view (could be a floating bubble or just the feed)
    // For now we just append to feed but ideally we want to see what is "being typing"

    // We'll use a temporary element at the bottom of feed
    let tempEl = document.getElementById('temp-transcript');
    if (!tempEl) {
        tempEl = document.createElement('p');
        tempEl.id = 'temp-transcript';
        tempEl.style.opacity = '0.7';
        displays.transcriptFeed.appendChild(tempEl);
    }

    tempEl.innerHTML = `<strong>Inv:</strong> ${finalT} <span style='color:#888'>${interimT}</span>`;
    scrollToBottom(displays.transcriptFeed);
}

function addTranscriptBubble(text) {
    let tempEl = document.getElementById('temp-transcript');
    if (tempEl) tempEl.remove(); // Remove temp

    const p = document.createElement('p');
    p.className = 'transcript-segment final';
    p.innerHTML = `<strong>Inv:</strong> ${text}`;
    displays.transcriptFeed.appendChild(p);
    scrollToBottom(displays.transcriptFeed);
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

function updateMicUI(on) {
    if (on) {
        buttons.micToggle.classList.add('active');
        displays.status.textContent = "Listening...";
    } else {
        buttons.micToggle.classList.remove('active');
        displays.status.textContent = "Paused";
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
    let output = "INTERVIEW Q&A SESSION\n\n";

    state.chatHistory.forEach(msg => {
        if (msg.role === 'assistant') {
            let content = msg.content;
            let question = "Unknown Question";
            let answer = content;

            // Parse [QUESTION: ...]
            const qMatch = content.match(/^\[QUESTION:\s*(.*?)\]/s);
            if (qMatch) {
                question = qMatch[1].trim();
                answer = content.substring(qMatch[0].length).trim();
            }

            output += `QUESTION: ${question}\n`;
            output += `ANSWER: ${answer}\n`;
            output += "--------------------------------------------------\n\n";
        }
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
    if (state.recognition) state.recognition.stop();
    if (state.audioContext) state.audioContext.close();
    switchScreen('end');
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





