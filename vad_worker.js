importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');

let session = null;
let isLoaded = false;

// Config for Silero VAD
// Using a reliable CDN for v4 model
const MODEL_URLS = [
    'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/silero_vad.onnx',
    'https://raw.githubusercontent.com/snakers4/silero-vad/master/files/silero_vad.onnx'
];

async function loadModel() {
    try {
        // Set WASM paths to CDN if not local
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

        // Initialize session
        let arrayBuffer = null;

        for (const url of MODEL_URLS) {
            try {
                console.log(`Attempting to load VAD model from: ${url}`);
                const response = await fetch(url);
                if (response.ok) {
                    arrayBuffer = await response.arrayBuffer();
                    break;
                }
                console.warn(`Fetch failed for ${url}: ${response.status}`);
            } catch (e) {
                console.warn(`Failed to fetch ${url}`, e);
            }
        }

        if (!arrayBuffer) {
            throw new Error("Could not fetch VAD model from any source.");
        }

        session = await ort.InferenceSession.create(arrayBuffer, { executionProviders: ['wasm'] });
        isLoaded = true;
        postMessage({ type: 'LOADED' });
        console.log("VAD Model Loaded Worker");
    } catch (e) {
        console.error("Failed to load VAD model:", e);
        postMessage({ type: 'ERROR', message: e.message });
    }
}

// Internal VAD state
let h = null; // Hidden state
let c = null; // Cell state
const sr = 16000; // Silero expects 16k
let state = {
    isSpeech: false,
    silenceCounter: 0,
    speechCounter: 0,
    // Thresholds
    threshold: 0.5,
    minSpeechFrames: 3, // ~90ms
    minSilenceFrames: 40 // ~1.2s of silence to trigger "End"
};

// Helpers for Tensor creation
function createTensor(audioData) {
    const size = audioData.length;
    const tensor = new ort.Tensor('float32', audioData, [1, size]);
    return tensor;
}

// Reset states
function resetState() {
    h = new ort.Tensor('float32', new Float32Array(2 * 1 * 64).fill(0), [2, 1, 64]);
    c = new ort.Tensor('float32', new Float32Array(2 * 1 * 64).fill(0), [2, 1, 64]);
    state.silenceCounter = 0;
    state.speechCounter = 0;
    state.isSpeech = false;
}

self.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'INIT') {
        await loadModel();
        resetState();
    }

    if (msg.type === 'PROCESS') {
        if (!isLoaded || !session) return;

        try {
            const inputTensor = createTensor(msg.audio);

            // Run inference
            // Silero VAD inputs: input, sr, h, c
            const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(sr)]));

            const feeds = {
                'input': inputTensor,
                'sr': srTensor,
                'h': h,
                'c': c
            };

            const results = await session.run(feeds);

            // Output: output, hn, cn
            const probability = results.output.data[0];
            h = results.hn;
            c = results.cn;

            // Logic for "Speech Detected" vs "Silence"
            handleProbability(probability);

        } catch (err) {
            console.error(err);
        }
    }

    if (msg.type === 'RESET') {
        resetState();
    }
};

function handleProbability(prob) {
    const isFrameSpeech = prob > state.threshold;

    if (isFrameSpeech) {
        state.speechCounter++;
        state.silenceCounter = 0;

        if (state.speechCounter >= state.minSpeechFrames) {
            if (!state.isSpeech) {
                state.isSpeech = true;
                postMessage({ type: 'SPEECH_START' });
            }
        }
    } else {
        state.silenceCounter++;
        state.speechCounter = 0; // strict reset on silence frame? Or loose? Silero usually robust.

        if (state.silenceCounter >= state.minSilenceFrames) {
            if (state.isSpeech) {
                state.isSpeech = false;
                postMessage({ type: 'SPEECH_END' });
            }
        }
    }
}
