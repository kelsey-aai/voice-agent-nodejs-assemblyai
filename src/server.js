/**
 * Node.js Voice Agent — Browser + WebSocket Server variant
 *
 * Architecture:
 *   Browser (getUserMedia) ──► this server (ws://localhost:3000/stream)
 *                                    │ PCM audio
 *                                    ▼
 *                        AssemblyAI Universal-3.6 Pro Realtime
 *                                    │ transcript + turn events
 *                                    ▼
 *                               OpenAI GPT-4o
 *                                    │ text
 *                                    ▼
 *                   AssemblyAI Text-to-Speech (one session per browser)
 *                                    │ raw 24 kHz 16-bit PCM, binary WS messages
 *                                    ▼
 *                     Browser (Web Audio playback, barge-in)
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
import { AssemblyAI } from "assemblyai";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });

// ── Serve the browser UI ──────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Agent — AssemblyAI Universal-3.6 Pro Realtime</title>
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
  <h1>Voice Agent — AssemblyAI Universal-3.6 Pro Realtime</h1>
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

    // Playback of the agent's voice: raw 24 kHz 16-bit PCM, scheduled chunk after chunk
    let playCtx = null;
    let playAt = 0;
    const scheduled = new Set();

    function playPcm(arrayBuffer) {
      const pcm = new Int16Array(arrayBuffer);
      const buffer = playCtx.createBuffer(1, pcm.length, 24000);
      buffer.copyToChannel(Float32Array.from(pcm, (s) => s / 32768), 0);

      const src = playCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(playCtx.destination);
      playAt = Math.max(playAt, playCtx.currentTime); // schedule after the previous chunk
      src.start(playAt);
      playAt += buffer.duration;
      scheduled.add(src);
      src.onended = () => scheduled.delete(src);
    }

    // Barge-in: drop the audio that is already scheduled
    function stopPlayback() {
      for (const src of scheduled) {
        try { src.stop(); } catch (e) { /* already finished */ }
      }
      scheduled.clear();
      if (playCtx) playAt = playCtx.currentTime;
    }

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
      playCtx = new AudioContext();
      await playCtx.resume(); // inside the click handler, so the browser allows audio
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
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
        if (e.data instanceof ArrayBuffer) { playPcm(e.data); return; } // agent audio
        const msg = JSON.parse(e.data);
        if (msg.type === 'interrupt') { stopPlayback(); return; }
        if (msg.type === 'partial') { updatePartial(msg.text); return; }
        if (msg.type === 'user') { appendLine('You: ' + msg.text, 'user'); return; }
        if (msg.type === 'assistant') { appendLine('AI: ' + msg.text, 'assistant'); return; }
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
      stopPlayback();
      playCtx?.close();
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

wss.on("connection", async (browserWs) => {
  console.log("Browser connected");

  // Speak each reply to the browser that asked for it.
  // One text-to-speech session per browser connection; the server keeps the API key.
  const tts = client.tts.session({
    voiceId: "49c443a4-8a1d-5f7e-b70b-98bdbd9823c3", // Audrey
    language: "english",
  });
  let speaking = false; // a reply is being synthesized for this browser

  // Barge-in: the user talks over the agent
  function bargeIn() {
    tts.cancel(); // stops synthesis and ends the speak() loop at once
    speaking = false;
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "interrupt" })); // page drops scheduled audio
    }
  }

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
    `?speech_model=universal-3-6-pro` +
    `&encoding=pcm_s16le` +
    `&sample_rate=16000` +
    `&min_turn_silence=300` +
    `&max_turn_silence=1500` +
    `&token=${ASSEMBLYAI_API_KEY}`;

  const aaiWs = new WebSocket(aaiUrl, { headers: { Authorization: ASSEMBLYAI_API_KEY } });

  aaiWs.on("open", () => console.log("AssemblyAI connected"));

  aaiWs.on("message", async (data) => {
    // AssemblyAI v3 event types: "Begin", "Turn", "Termination"
    const msg = JSON.parse(data.toString());

    if (msg.type === "Begin") {
      console.log(`Session: ${msg.id}`);
      return;
    }

    // Barge-in check, before the end_of_turn branch
    if (msg.type === "Turn" && speaking) {
      const words = msg.transcript.split(/\s+/).filter(Boolean).length;
      if (words >= 2) bargeIn(); // ignore one-word backchannels like "mhm"
    }

    if (msg.type === "Turn") {
      if (msg.transcript && !msg.end_of_turn) {
        // Partial transcript — update UI in real-time
        browserWs.send(JSON.stringify({ type: "partial", text: msg.transcript }));
        return;
      }

      if (msg.end_of_turn) {
        const utterance = msg.transcript?.trim();
        if (!utterance || speaking) return; // empty, or a backchannel while the agent talks

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

        // Conversation context: prime the model with the agent's last reply
        // so the next user turn is transcribed in context
        if (aaiWs.readyState === WebSocket.OPEN) {
          aaiWs.send(JSON.stringify({ type: "UpdateConfiguration", agent_context: reply }));
        }

        // AssemblyAI Text-to-Speech: forward each chunk as a binary message
        speaking = true;
        try {
          for await (const chunk of tts.speak(reply)) {
            if (browserWs.readyState !== WebSocket.OPEN) break;
            browserWs.send(chunk); // binary message: raw 24 kHz 16-bit PCM
          }
        } catch (err) {
          console.error("TTS error:", err.message);
        } finally {
          speaking = false;
        }
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
    clearInterval(keepAlive);
    tts.close().catch(() => {}); // sends Terminate and waits for the session summary
  });

  aaiWs.on("error", (err) => console.error("AssemblyAI error:", err.message));
  browserWs.on("error", (err) => console.error("Browser WS error:", err.message));

  // Open the text-to-speech session; it closes after two idle minutes, so keep it alive
  const keepAlive = setInterval(() => tts.keepAlive(), 60_000);
  try {
    await tts.connect(); // waits for the Begin frame
  } catch (err) {
    console.error("TTS connect error:", err.message);
    browserWs.close();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Open the URL in your browser to start the voice agent.");
});
