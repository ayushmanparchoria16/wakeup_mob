/**
 * Wakeup AI - Logic Script
 * Handles Speech Recognition, Gemini API Streaming, and UI State
 */

// --- Configuration & State ---
const CONFIG = {
    MODEL_NAME: 'llama-3.3-70b-versatile', // Updated to latest Llama 3.3
    API_URL: 'https://api.groq.com/openai/v1/chat/completions',
    DEFAULT_KEY: '' // Cleared for GitHub security (User must enter key)
};

const state = {
    apiKey: '',
    topic: '',
    isRecording: false,
    transcriptLog: [],
    aiLog: [],
    chatHistory: [], // Now stores { role: "user"|"assistant", content: "..." }
    recognition: null,
    silenceTimer: null,
    isProcessingAI: false,
    pendingBuffer: "",
    lastAiCallTime: 0
};

// --- DOM Elements ---
const screens = {
    setup: document.getElementById('setup-screen'),
    meeting: document.getElementById('meeting-screen'),
    end: document.getElementById('end-screen')
};

const inputs = {
    apiKey: document.getElementById('api-key-input'),
    topic: document.getElementById('topic-input')
};

const buttons = {
    start: document.getElementById('start-btn'),
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
        console.warn("Running from file:// system. Browser may ask for mic permission repeatedly.");
    }

    // Load API Key from local storage or use default
    const storedKey = localStorage.getItem('wakeup_ai_api_key') || CONFIG.DEFAULT_KEY;
    if (storedKey) {
        inputs.apiKey.value = storedKey;
    }

    // Disclaimer
    console.log("Note: Browser Speech API does not support Speaker Diarization (User 1 vs User 2).");

    // Event Listeners
    buttons.start.addEventListener('click', startSession);
    buttons.endMeeting.addEventListener('click', endSession);
    buttons.micToggle.addEventListener('click', toggleMic);
    buttons.download.addEventListener('click', downloadTranscript);
    buttons.clearExit.addEventListener('click', clearAndExit);

    // Spacebar to toggle mic
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
            e.preventDefault(); // Prevent scrolling
            toggleMic();
        }
    });

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
        // Auto-restart if we shouldn't have stopped
        if (state.isRecording) {
            // Small delay to prevent rapid restart loops or "already started" errors
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
        if (event.error === 'not-allowed') {
            showToast("Microphone access denied.");
            state.isRecording = false;
            updateMicUI(false);
        }
    };
}

// --- Core Logic ---

async function startSession() {
    const key = inputs.apiKey.value.trim() || CONFIG.DEFAULT_KEY;
    const topic = inputs.topic.value.trim();

    if (!key) {
        showToast("Please enter a Grok API Key.");
        return;
    }
    if (!topic) {
        showToast("Please enter a meeting topic.");
        return;
    }

    // Save key
    localStorage.setItem('wakeup_ai_api_key', key);

    state.apiKey = key;
    state.topic = topic;
    state.chatHistory = [];
    state.transcriptLog = [];
    state.aiLog = [];
    transcriptOffset = 0;
    aiTriggerBuffer = "";
    clearTimeout(aiTriggerTimer);

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

function endSession() {
    state.isRecording = false;
    state.recognition.stop();

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

let transcriptOffset = 0;
let aiTriggerBuffer = "";
let aiTriggerTimer = null;

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

    if (finalTranscript.length > transcriptOffset) {
        newFinalText = finalTranscript.substring(transcriptOffset);
        transcriptOffset = finalTranscript.length;
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
            aiTriggerBuffer += cleanChunk;

            // Log for transcript record
            const timestamp = new Date().toLocaleTimeString();
            state.transcriptLog.push({ timestamp, text: cleanChunk.trim() });

            // Check for sentence completion
            if (/[.?!]$/.test(cleanChunk.trim())) {
                flushAiBuffer();
            } else {
                // Debounce: Wait 1s silence, then send
                clearTimeout(aiTriggerTimer);
                aiTriggerTimer = setTimeout(flushAiBuffer, 1500);
            }
        }
    }
}

function flushAiBuffer() {
    clearTimeout(aiTriggerTimer);
    if (aiTriggerBuffer.trim().length > 2) {
        triggerAI(aiTriggerBuffer.trim());
        aiTriggerBuffer = "";
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

    // 2. Handle Interim (Always update the specific node)
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
}

// --- Helpers & UI ---

function switchScreen(screenName) {
    Object.values(screens).forEach(el => {
        el.classList.remove('active');
        setTimeout(() => {
            if (!el.classList.contains('active')) el.style.display = 'none';
        }, 400);
    });

    const target = screens[screenName];
    target.style.display = 'flex';
    setTimeout(() => {
        target.classList.add('active');
    }, 50);
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

// --- AI Integration (Grok / OpenAI Compatible) ---

async function triggerAI(userText) {
    if (!state.pendingBuffer) state.pendingBuffer = "";

    if (userText.length < 2) return;

    state.pendingBuffer += (state.pendingBuffer.length > 0 ? " " : "") + userText;

    if (state.isProcessingAI) {
        console.log("AI Busy: Buffering ->", state.pendingBuffer);
        return;
    }

    state.isProcessingAI = true;

    try {
        while (state.pendingBuffer.length > 0) {
            const textToProcess = state.pendingBuffer;
            state.pendingBuffer = "";

            if (textToProcess.length < 5) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            // Rate Limit Check
            const now = Date.now();
            const MIN_INTERVAL = 3000; // Grok is usually faster/less strict, but keeping safety
            const timeSinceLast = now - state.lastAiCallTime;
            if (timeSinceLast < MIN_INTERVAL) {
                await new Promise(r => setTimeout(r, MIN_INTERVAL - timeSinceLast));
            }
            state.lastAiCallTime = Date.now();

            console.log("Processing (Grok):", textToProcess);

            // Update History (OpenAI Format)
            state.chatHistory.push({
                role: "user",
                content: textToProcess
            });

            // UI Setup
            const aiMessageId = `ai-msg-${Date.now()}`;
            const aiContainer = document.createElement('div');
            aiContainer.className = 'ai-message';
            aiContainer.id = aiMessageId;
            aiContainer.textContent = "...";
            displays.aiFeed.appendChild(aiContainer);
            scrollToBottom(displays.aiFeed);

            const fullResponseText = await streamAIResponse(aiContainer);

            if (fullResponseText) {
                // OpenAI uses 'assistant', Gemini used 'model'
                state.chatHistory.push({
                    role: "assistant",
                    content: fullResponseText
                });
                state.aiLog.push({ timestamp: new Date().toLocaleTimeString(), text: fullResponseText });
            }

            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {
        console.error("AI Loop Error:", e);
    } finally {
        state.isProcessingAI = false;
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

    const messages = [systemMessage, ...state.chatHistory];

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.apiKey}`
            },
            body: JSON.stringify({
                model: CONFIG.MODEL_NAME,
                messages: messages,
                stream: true,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`API Error ${response.status}: ${err}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let finalOutput = "";

        element.innerHTML = ""; // Clear loading dots

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.substring(6));
                        const content = json.choices[0]?.delta?.content || "";
                        if (content) {
                            finalOutput += content;
                            element.innerHTML = parseMarkdown(finalOutput);
                            scrollToBottom(displays.aiFeed);
                        }
                    } catch (e) {
                        console.warn("Parse error", e);
                    }
                }
            }
        }
        return finalOutput;

    } catch (error) {
        console.error(error);
        element.textContent = `Error: ${error.message}`;
        return null; // Return null to signal failure
    }
}

function parseMarkdown(text) {
    if (!text) return "";

    // Escape HTML first to prevent XSS (basic)
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 1. Code Blocks / Commands (```command``` or `command`)
    // We strictly look for code blocks or commands.
    html = html.replace(/```([\s\S]*?)```/g, '<div class="code-box">$1</div>');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // 2. Bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 3. Lists (- item)
    // We split by newline, check for lines starting with "- ", and wrap them.
    // This is a simple parser.
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

// Note: The above JSON parsing is brittle for a stream. 
// A better way for browser fetch stream of JSON:
// The Gemini API returns a format like `[{...}, \r\n {...}]`.
// For the sake of this demo, we will use a more robust recursive parser or just wait for the full response if streaming is too hard without a library.
// BUT, the prompt asks for Streaming.
// Let's improve the streaming parser.
// We can use a simpler approach: accumulate the buffer, try to parse JSON. If it fails, wait for more data.
// However, the `streamGenerateContent` returns a list of objects. `[{...}, \n {...}]`. 
// Actually, it usually sends `data: {json}` events if using SSE, but standard REST returns a singular JSON list that grows? 
// No, standard REST standard is an array of objects. `[`, `{...}`, `,`, `{...}`, `]`
// Let's stick to the Regex for "text" parts, as it's surprisingly effective for extracting content from complex JSON streams without full parsing logic.

// --- Helper Functions ---

function switchScreen(screenName) {
    Object.values(screens).forEach(el => {
        el.classList.remove('active');
        setTimeout(() => {
            if (!el.classList.contains('active')) el.style.display = 'none';
        }, 400); // Wait for fade out
    });

    const target = screens[screenName];
    target.style.display = 'flex';
    // Small delay to allow display flex to apply before opacity transition
    setTimeout(() => {
        target.classList.add('active');
    }, 50);
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
