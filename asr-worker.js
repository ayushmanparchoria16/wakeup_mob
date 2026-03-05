import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';

// Force use of remote models since we are in a browser environment
env.allowLocalModels = false;

let transcriber = null;

async function loadModel() {
    if (transcriber) return;

    self.postMessage({ status: 'loading', message: 'Loading Whisper Tiny (75MB)...' });

    try {
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
            device: 'webgpu', // Try WebGPU first
        });
        self.postMessage({ status: 'ready', message: 'Local ASR Ready' });
    } catch (err) {
        console.warn('WebGPU failed, falling back to WASM/CPU:', err);
        try {
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                device: 'wasm',
            });
            self.postMessage({ status: 'ready', message: 'Local ASR Ready (CPU)' });
        } catch (err2) {
            self.postMessage({ status: 'error', message: 'Failed to load model: ' + err2.message });
        }
    }
}

self.onmessage = async (e) => {
    const { type, audio } = e.data;

    if (type === 'load') {
        await loadModel();
    } else if (type === 'transcribe') {
        if (!transcriber) return;

        try {
            const output = await transcriber(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'english',
                task: 'transcribe',
                return_timestamps: false,
            });
            self.postMessage({ status: 'transcript', text: output.text });
        } catch (err) {
            self.postMessage({ status: 'error', message: 'Transcription failed: ' + err.message });
        }
    }
};
