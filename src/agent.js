/**
 * Node.js Voice Agent — AssemblyAI Universal-3.6 Pro Realtime
 *
 * Terminal-based voice agent that:
 *  1. Captures mic audio via `mic`
 *  2. Streams PCM to AssemblyAI Universal-3.6 Pro Realtime WebSocket
 *  3. Detects end-of-turn via AssemblyAI's model-based turn detection (semantic context + voice activity)
 *  4. Generates a response with OpenAI GPT-4o
 *  5. Speaks the reply with AssemblyAI Text-to-Speech (assemblyai-tts-1), played through SoX
 *  6. Lets the user barge in: a real turn during playback cancels the reply
 *
 * Requires SoX for playback: brew install sox (macOS) or sudo apt install sox (Linux).
 * Use headphones: the mic keeps streaming while the agent talks.
 *
 * Run: node src/agent.js
 */

import "dotenv/config";
import mic from "mic";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import OpenAI from "openai";
import { AssemblyAI } from "assemblyai";

// ── Config ────────────────────────────────────────────────────────────────────

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SAMPLE_RATE = 16000;

// AssemblyAI Universal-3.6 Pro Realtime WebSocket URL
// universal-3-6-pro: turn detection combines semantic context with voice activity
const AAI_WS_URL =
  `wss://streaming.assemblyai.com/v3/ws` +
  `?speech_model=universal-3-6-pro` +
  `&encoding=pcm_s16le` +
  `&sample_rate=${SAMPLE_RATE}` +
  `&min_turn_silence=300` +
  `&max_turn_silence=1500` +
  `&token=${ASSEMBLYAI_API_KEY}`;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

let micInstance = null;
let aaiWs = null;

// ── AssemblyAI WebSocket ──────────────────────────────────────────────────────

function connectToAssemblyAI() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(AAI_WS_URL, { headers: { Authorization: ASSEMBLYAI_API_KEY } });

    ws.on("open", () => {
      console.log("Connected to AssemblyAI Universal-3.6 Pro Realtime");
      resolve(ws);
    });

    ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());

      // AssemblyAI v3 event types: "Begin", "Turn", "Termination"
      if (msg.type === "Begin") {
        console.log(`Session ID: ${msg.id}`);
        return;
      }

      // Barge-in: the user talks over the agent.
      // In the AssemblyAI "message" handler, before the end_of_turn branch:
      if (msg.type === "Turn" && player) {
        const words = msg.transcript.split(/\s+/).filter(Boolean).length;
        if (words >= 2) bargeIn(); // ignore one-word backchannels like "mhm"
      }

      if (msg.type === "Turn") {
        if (msg.transcript) {
          // Show rolling transcript; end_of_turn=false means still speaking
          process.stdout.write(`\r${msg.end_of_turn ? "[final]" : "[partial]"} ${msg.transcript}   `);
        }

        // A turn that ends while the agent is still talking was a backchannel; skip it
        if (msg.end_of_turn && msg.transcript?.trim() && !player) {
          process.stdout.write("\n");
          const utterance = msg.transcript.trim();
          console.log(`\nUser: ${utterance}`);

          const reply = await generateResponse(utterance);
          console.log(`Assistant: ${reply}`);

          // Conversation context: prime the model with the agent's last reply
          // so the next user turn is transcribed in context
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "UpdateConfiguration", agent_context: reply }));
          }

          // The mic keeps streaming while the agent talks, so the user can barge in
          await speak(reply);
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
    if (aaiWs?.readyState === WebSocket.OPEN) {
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

// Text-to-speech for the terminal agent: one AssemblyAI session for the whole conversation
const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });

const tts = client.tts.session({
  voiceId: "49c443a4-8a1d-5f7e-b70b-98bdbd9823c3", // Audrey
  language: "english",
});

let player = null; // the SoX process playing the current reply

async function speak(text) {
  // SoX reads raw 24 kHz, 16-bit, mono PCM from stdin and plays it
  const proc = spawn("play", ["-q", "-t", "raw", "-r", "24000", "-e", "signed", "-b", "16", "-c", "1", "-"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  player = proc;
  proc.stdin.on("error", () => {}); // the player was stopped by a barge-in
  const finished = new Promise((resolve) => proc.on("close", resolve));

  // speak() sends the text, flushes it and yields the audio as it is synthesized.
  // The loop ends at the reply's FlushDone, or at once after cancel().
  for await (const chunk of tts.speak(text)) {
    proc.stdin.write(chunk);
  }
  proc.stdin.end();
  await finished; // wait until the reply has finished playing
  if (player === proc) player = null;
}

// Barge-in: the user talks over the agent
function bargeIn() {
  tts.cancel();   // stops synthesis and ends the speak() loop at once
  player?.kill(); // stops the audio already handed to the player
  player = null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Voice Agent — AssemblyAI Universal-3.6 Pro Realtime + OpenAI GPT-4o + AssemblyAI Text-to-Speech");
  console.log("Use headphones so the mic doesn't hear the agent. Press Ctrl+C to quit.\n");

  await tts.connect(); // waits for the Begin frame

  // The session closes after two idle minutes; keep it open between turns
  setInterval(() => tts.keepAlive(), 60_000);

  aaiWs = await connectToAssemblyAI();
  startMic();

  // Ctrl+C: end the text-to-speech session cleanly
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    stopMic();
    aaiWs.close();
    await tts.close(); // sends Terminate and waits for the session summary
    process.exit(0);
  });
}

main().catch(console.error);
