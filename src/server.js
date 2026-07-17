/**
 * Node.js Voice Agent — Browser + WebSocket Server variant
 *
 * Architecture:
 *   Browser (getUserMedia) ──► this server (ws://localhost:3000/stream)
 *                                    │ PCM audio
 *                                    ▼
 *                        AssemblyAI Universal-3.5 Pro Realtime
 *                                    │ transcript + turn events
 *                                    ▼
 *                               OpenAI GPT-4o
 *                                    │ text
 *                                    ▼
 *                            ElevenLabs TTS → audio
 *                                    │
 *                                    ▼
 *                         Browser (AudioContext playback)
 *
 * Run: node src/server.js
 * Open: http://localhost:3000
 */

import "dotenv/config";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname } from "path";
import WebSocket, { WebSocketServer } from "ws";
import OpenAI from "openai";
import { ElevenLabsClient } from "elevenlabs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

// ── Serve the browser UI ──────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Agent — AssemblyAI Universal-3.5 Pro Realtime</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    h1 { font-size: 1.4rem; }
    #status { color: #666; margin: 8px 0; }
    #transcript { background: #f5f5f5; border-radius: 8px; padding: 16px; min-height: 120px;
                  font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; }
    button { padding: 12px 28px; font-size: 1rem; border-radius: 8px; border: none;
             background: #2563eb; color: white; cursor: pointer; margin-top: 12px; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    button#stop { background: #dc2626; }
    .partial { color: #999; }
    .user { color: #1d4ed8; }
    .assistant { color: #15803d; }
  </style>
</head>
<body>
  <h1>Voice Agent — AssemblyAI Universal-3.5 Pro Realtime</h1>
  <p id="status">Ready</p>
  <div id="transcript"></div>
  <button id="start">Start</button>
  <button id="stop" disabled>Stop</button>

  <script>
    const statusEl = document.getElementById('status');
    const transcriptEl = document.getElementById('transcript');
    const startBtn = document.getElementById('start');
    const stopBtn = document.getElementById('stop');

    let ws, mediaStream, audioContext, processor, source;
    let partialEl = null;

    function appendLine(text, cls) {
      if (partialEl) { partialEl.remove(); partialEl = null; }
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text + '\\n';
      transcriptEl.appendChild(span);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function updatePartial(text) {
      if (!partialEl) { partialEl = document.createElement('span'); partialEl.className = 'partial'; transcriptEl.appendChild(partialEl); }
      partialEl.textContent = text;
    }

    startBtn.addEventListener('click', async () => {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext({ sampleRate: 16000 });
      source = audioContext.createMediaStreamSource(mediaStream);

      // ScriptProcessor to get raw PCM
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
        }
        ws.send(int16.buffer);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);

      ws = new WebSocket('ws://localhost:${PORT}/stream');
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => statusEl.textContent = 'Connected — speak now';
      ws.onclose = () => statusEl.textContent = 'Disconnected';

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'partial') { updatePartial(msg.text); return; }
        if (msg.type === 'user') { appendLine('You: ' + msg.text, 'user'); return; }
        if (msg.type === 'assistant') { appendLine('AI: ' + msg.text, 'assistant'); return; }
        if (msg.type === 'audio') {
          // Decode base64 MP3 and play
          const binary = atob(msg.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          audioContext.decodeAudioData(bytes.buffer, (buf) => {
            const src = audioContext.createBufferSource();
            src.buffer = buf; src.connect(audioContext.destination); src.start();
          });
        }
      };

      startBtn.disabled = true;
      stopBtn.disabled = false;
    });

    stopBtn.addEventListener('click', () => {
      ws?.close();
      processor?.disconnect();
      source?.disconnect();
      mediaStream?.getTracks().forEach(t => t.stop());
      audioContext?.close();
      startBtn.disabled = false;
      stopBtn.disabled = true;
      statusEl.textContent = 'Stopped';
    });
  </script>
</body>
</html>`;

// ── HTTP server (serve UI) ────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: "/stream" });

wss.on("connection", (browserWs) => {
  console.log("Browser connected");

  const messages = [
    {
      role: "system",
      content:
        "You are a helpful voice assistant. Keep every reply under 2 sentences. " +
        "Speak naturally. Never use markdown or special characters.",
    },
  ];

  // Connect to AssemblyAI
  const aaiUrl =
    `wss://streaming.assemblyai.com/v3/ws` +
    `?speech_model=universal-3-5-pro` +
    `&encoding=pcm_s16le` +
    `&sample_rate=16000` +
    `&min_turn_silence=300` +
    `&max_turn_silence=1500` +
    `&token=${ASSEMBLYAI_API_KEY}`;

  const aaiWs = new WebSocket(aaiUrl);

  aaiWs.on("open", () => console.log("AssemblyAI connected"));

  aaiWs.on("message", async (data) => {
    // AssemblyAI v3 event types: "Begin", "Turn", "Termination"
    const msg = JSON.parse(data.toString());

    if (msg.type === "Begin") {
      console.log(`Session: ${msg.id}`);
      return;
    }

    if (msg.type === "Turn") {
      if (msg.transcript && !msg.end_of_turn) {
        // Partial transcript — update UI in real-time
        browserWs.send(JSON.stringify({ type: "partial", text: msg.transcript }));
        return;
      }

      if (msg.end_of_turn) {
        const utterance = msg.transcript?.trim();
        if (!utterance) return;

        browserWs.send(JSON.stringify({ type: "user", text: utterance }));

        // Generate LLM response
        messages.push({ role: "user", content: utterance });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          max_tokens: 150,
          temperature: 0.7,
        });
        const reply = completion.choices[0].message.content.trim();
        messages.push({ role: "assistant", content: reply });

        browserWs.send(JSON.stringify({ type: "assistant", text: reply }));

        // TTS via ElevenLabs — stream audio back as base64
        const audioStream = await elevenlabs.generate({
          voice: ELEVENLABS_VOICE_ID,
          text: reply,
          model_id: "eleven_turbo_v2_5",
          output_format: "mp3_44100_128",
        });

        const chunks = [];
        for await (const chunk of audioStream) chunks.push(chunk);
        const audioBase64 = Buffer.concat(chunks).toString("base64");
        browserWs.send(JSON.stringify({ type: "audio", data: audioBase64 }));
      }
    }
  });

  // Forward browser audio bytes → AssemblyAI
  browserWs.on("message", (data) => {
    if (aaiWs.readyState === WebSocket.OPEN) {
      aaiWs.send(data);
    }
  });

  browserWs.on("close", () => {
    console.log("Browser disconnected");
    aaiWs.close();
  });

  aaiWs.on("error", (err) => console.error("AssemblyAI error:", err.message));
  browserWs.on("error", (err) => console.error("Browser WS error:", err.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Open the URL in your browser to start the voice agent.");
});
