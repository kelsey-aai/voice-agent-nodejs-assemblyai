/**
 * Node.js Voice Agent — AssemblyAI Universal-3.5 Pro Realtime
 *
 * Terminal-based voice agent that:
 *  1. Captures mic audio via `mic`
 *  2. Streams PCM to AssemblyAI Universal-3.5 Pro Realtime WebSocket
 *  3. Detects end-of-turn via AssemblyAI's punctuation-based turn detection
 *  4. Generates a response with OpenAI GPT-4o
 *  5. Speaks the reply via ElevenLabs TTS
 *
 * Run: node src/agent.js
 */

import "dotenv/config";
import mic from "mic";
import WebSocket from "ws";
import { createWriteStream } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";
import { ElevenLabsClient } from "elevenlabs";

const execAsync = promisify(exec);

// ── Config ────────────────────────────────────────────────────────────────────

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // "George"

const SAMPLE_RATE = 16000;

// AssemblyAI Universal-3.5 Pro Realtime WebSocket URL
// universal-3-5-pro: ~150ms P50 latency, punctuation-based turn detection
const AAI_WS_URL =
  `wss://streaming.assemblyai.com/v3/ws` +
  `?speech_model=universal-3-5-pro` +
  `&encoding=pcm_s16le` +
  `&sample_rate=${SAMPLE_RATE}` +
  `&min_turn_silence=300` +
  `&max_turn_silence=1500` +
  `&token=${ASSEMBLYAI_API_KEY}`;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

// ── Conversation history ──────────────────────────────────────────────────────

const messages = [
  {
    role: "system",
    content:
      "You are a helpful voice assistant. Keep every reply under 2 sentences. " +
      "Speak naturally. Never use markdown, bullet points, or special characters.",
  },
];

// ── State ─────────────────────────────────────────────────────────────────────

let isSpeaking = false; // suppress mic while TTS plays
let micInstance = null;
let aaiWs = null;

// ── AssemblyAI WebSocket ──────────────────────────────────────────────────────

function connectToAssemblyAI() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(AAI_WS_URL);

    ws.on("open", () => {
      console.log("Connected to AssemblyAI Universal-3.5 Pro Realtime");
      resolve(ws);
    });

    ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());

      // AssemblyAI v3 event types: "Begin", "Turn", "Termination"
      if (msg.type === "Begin") {
        console.log(`Session ID: ${msg.id}`);
        return;
      }

      if (msg.type === "Turn") {
        if (msg.transcript) {
          // Show rolling transcript; end_of_turn=false means still speaking
          process.stdout.write(`\r${msg.end_of_turn ? "[final]" : "[partial]"} ${msg.transcript}   `);
        }

        if (msg.end_of_turn && msg.transcript?.trim()) {
          process.stdout.write("\n");
          const utterance = msg.transcript.trim();
          console.log(`\nUser: ${utterance}`);

          // Pause mic during response generation + TTS
          isSpeaking = true;
          stopMic();

          const reply = await generateResponse(utterance);
          console.log(`Assistant: ${reply}`);

          await speak(reply);

          // Resume mic after speaking
          isSpeaking = false;
          startMic();
        }
        return;
      }

      if (msg.type === "Termination") {
        console.log("Session terminated");
      }
    });

    ws.on("error", (err) => {
      console.error("AssemblyAI WS error:", err.message);
      reject(err);
    });

    ws.on("close", (code, reason) => {
      console.log(`AssemblyAI WS closed: ${code} ${reason}`);
    });
  });
}

// ── Mic capture ───────────────────────────────────────────────────────────────

function startMic() {
  if (micInstance) return;

  micInstance = mic({
    rate: String(SAMPLE_RATE),
    channels: "1",
    encoding: "signed-integer",
    bitwidth: "16",
    endian: "little",
    device: "default",
  });

  const micStream = micInstance.getAudioStream();

  micStream.on("data", (chunk) => {
    if (!isSpeaking && aaiWs?.readyState === WebSocket.OPEN) {
      aaiWs.send(chunk);
    }
  });

  micStream.on("error", (err) => {
    console.error("Mic error:", err.message);
  });

  micInstance.start();
  console.log("Mic started — speak now...\n");
}

function stopMic() {
  if (!micInstance) return;
  micInstance.stop();
  micInstance = null;
}

// ── LLM ───────────────────────────────────────────────────────────────────────

async function generateResponse(userText) {
  messages.push({ role: "user", content: userText });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 150,
    temperature: 0.7,
  });

  const reply = completion.choices[0].message.content.trim();
  messages.push({ role: "assistant", content: reply });
  return reply;
}

// ── TTS ───────────────────────────────────────────────────────────────────────

async function speak(text) {
  // Stream audio from ElevenLabs and play via system audio
  const audioStream = await elevenlabs.generate({
    voice: ELEVENLABS_VOICE_ID,
    text,
    model_id: "eleven_turbo_v2_5",
    output_format: "mp3_44100_128",
  });

  // Write to a temp file and play with afplay (macOS) / aplay (Linux)
  const tmpFile = `/tmp/aai_tts_${Date.now()}.mp3`;
  await streamToFile(audioStream, tmpFile);

  const playCmd =
    process.platform === "darwin"
      ? `afplay "${tmpFile}"`
      : `aplay "${tmpFile}" 2>/dev/null || mpg123 "${tmpFile}" 2>/dev/null`;

  await execAsync(playCmd);
}

function streamToFile(readable, path) {
  return new Promise((resolve, reject) => {
    const writeStream = createWriteStream(path);
    readable.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Voice Agent — AssemblyAI Universal-3.5 Pro Realtime + OpenAI GPT-4o + ElevenLabs");
  console.log("Press Ctrl+C to quit.\n");

  aaiWs = await connectToAssemblyAI();
  startMic();

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    stopMic();
    aaiWs.close();
    process.exit(0);
  });
}

main().catch(console.error);
