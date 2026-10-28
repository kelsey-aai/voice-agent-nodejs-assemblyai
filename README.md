# Node.js voice agent with AssemblyAI Universal-3.6 Pro Realtime

Build a real-time voice agent in **Node.js** using the **AssemblyAI Universal-3.6 Pro Realtime model** (`universal-3-6-pro`) for speech-to-text and **AssemblyAI Text-to-Speech** for the agent's voice — no Python required, no heavy framework dependencies.

Companion code for the blog post **[Node.js voice agent with AssemblyAI Universal-3.6 Pro Realtime](https://www.assemblyai.com/blog/node-js-voice-agent-with-assemblyai)**.

Two modes in one repo:

1. **Terminal agent** (`src/agent.js`) — mic input via `mic`, plays the agent's voice through SoX, with barge-in
2. **Browser server** (`src/server.js`) — Node.js WebSocket server with a browser UI using `getUserMedia` and Web Audio playback

## Why AssemblyAI Universal-3.6 Pro Realtime for Node.js?

| Metric | AssemblyAI Universal-3.6 Pro Realtime | Deepgram Flux |
|--------|---------------------------------------|---------------|
| EN Word error rate (voice-agent benchmark) | **5.19%** | 13.50% |
| Median time to final transcript (Pipecat) | **307 ms** | — |
| Turn detection combining semantic context and voice activity | ✅ | ❌ (VAD only) |
| Context Carryover | ✅ | ❌ |
| Mid-session prompting | ✅ | ❌ |

*WER figures from AssemblyAI's English voice-agent benchmark of 12,460 scripted voice-agent scenarios; latency from [Pipecat's open STT benchmark](https://github.com/pipecat-ai/stt-benchmark) (time from end of speech to final transcript).*

Universal-3.6 Pro Realtime's turn detection eliminates the need for a separate VAD library — the model combines semantic context with voice activity to decide when a speaker has actually finished, not just when they've gone quiet.

> **Heads up on model IDs:** this repo uses `universal-3-6-pro`, the current streaming default. `universal-3-5-pro` stays available if you need to pin the previous model; if you're still on the legacy `u3-rt-pro` ID, switch to `universal-3-6-pro`.

## Architecture

```
Terminal mode:
  Mic (mic npm) → PCM s16le → AssemblyAI WS → Turn(end_of_turn=true) → GPT-4o
      → AssemblyAI Text-to-Speech session → raw 24 kHz PCM → SoX (play)
  A Turn with 2+ words while the agent talks → tts.cancel() + stop SoX (barge-in)

Browser mode:
  getUserMedia → ScriptProcessor → PCM s16le → ws://server/stream
                                                     │
                                     AssemblyAI Universal-3.6 Pro Realtime
                                                     │ Turn event
                                               OpenAI GPT-4o
                                                     │ text
                                   AssemblyAI Text-to-Speech (one session per browser)
                                                     │ raw 24 kHz 16-bit PCM (binary WS messages)
                                     ◄── Browser Web Audio playback
```

## Quick start

```bash
git clone https://github.com/kelsey-aai/voice-agent-nodejs-assemblyai
cd voice-agent-nodejs-assemblyai

npm install
cp .env.example .env
# Edit .env with your API keys
```

`.env` needs two keys: `ASSEMBLYAI_API_KEY` (speech-to-text and text-to-speech) and `OPENAI_API_KEY` (the LLM). The terminal agent also needs SoX for playback: `brew install sox` (macOS) or `sudo apt install sox` (Linux).

### Terminal agent

```bash
npm start
# Speak into your mic — Ctrl+C to quit
```

### Browser agent

```bash
npm run server
# Open http://localhost:3000
```

## AssemblyAI WebSocket URL

```js
const AAI_WS_URL =
  `wss://streaming.assemblyai.com/v3/ws` +
  `?speech_model=universal-3-6-pro` +
  `&encoding=pcm_s16le` +
  `&sample_rate=16000` +
  `&min_turn_silence=300` +   // ms of silence before the speculative end-of-turn check
  `&max_turn_silence=1500` +  // hard ceiling: turn ends after this much silence regardless
  `&token=${ASSEMBLYAI_API_KEY}`;
```

## Turn detection

AssemblyAI v3 uses three event types. Handle them like this:

```js
ws.on("message", async (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "Begin") {
    // Session started — msg.id is the session ID
    console.log(`Session: ${msg.id}`);
  }

  if (msg.type === "Turn" && !msg.end_of_turn) {
    // Partial transcript — update your UI in real time
    process.stdout.write(`\r${msg.transcript}`);
  }

  if (msg.type === "Turn" && msg.end_of_turn) {
    // End-of-turn detected — respond now
    const reply = await generateResponse(msg.transcript);
    await speak(reply);
  }
});
```

## Sending audio

**Browser** (`getUserMedia` + `ScriptProcessor`):

```js
processor.onaudioprocess = (e) => {
  const float32 = e.inputBuffer.getChannelData(0);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
  }
  ws.send(int16.buffer);
};
```

**Terminal** (`mic` package):

```js
const micStream = micInstance.getAudioStream();
micStream.on("data", (chunk) => {
  aaiWs.send(chunk); // raw PCM s16le bytes
});
```

## Speak replies with AssemblyAI Text-to-Speech

The turn handler above ends with `speak(reply)`. It's implemented with the [AssemblyAI Text-to-Speech API](https://www.assemblyai.com/products/text-to-speech) through the JavaScript SDK (`assemblyai` 4.42.0 or later), so the whole agent runs on one AssemblyAI key apart from your LLM. The `assemblyai-tts-1` model is built for conversational voice agents.

```bash
npm install assemblyai   # 4.42.0 or later
# SoX plays the raw audio stream: brew install sox (macOS) or sudo apt install sox (Linux)
```

`src/agent.js` opens one text-to-speech session when the agent starts and reuses it for every reply. `speak()` streams the reply's audio as raw 24 kHz, 16-bit mono PCM while it's synthesized, and the agent pipes each chunk straight into SoX:

```js
const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

const tts = client.tts.session({
  voiceId: "49c443a4-8a1d-5f7e-b70b-98bdbd9823c3", // Audrey
  language: "english",
});
await tts.connect(); // waits for the Begin frame

// The session closes after two idle minutes; keep it open between turns
setInterval(() => tts.keepAlive(), 60_000);

async function speak(text) {
  const proc = spawn("play", ["-q", "-t", "raw", "-r", "24000", "-e", "signed", "-b", "16", "-c", "1", "-"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  // ...
  for await (const chunk of tts.speak(text)) {
    proc.stdin.write(chunk);
  }
  // ...
}
```

**Barge-in.** The mic keeps streaming while the agent talks (use headphones, or the mic will hear the speakers). When a turn of two or more words arrives during playback, the agent calls `tts.cancel()`, which stops synthesis and ends the `speak()` loop at once, and kills the SoX player. One-word turns like "mhm" are ignored. On Ctrl+C, `tts.close()` ends the session cleanly.

**Browser agent.** `src/server.js` opens one session per browser connection on the server, where the API key lives, and forwards each chunk to the page as a binary WebSocket message. The page decodes the raw PCM with the Web Audio API and schedules each chunk after the previous one. On barge-in the server cancels the session's reply and tells the page to drop the audio it already scheduled.

To pick a different voice, change `voiceId` (see the [voices guide](https://www.assemblyai.com/docs/tts/voices)). For streaming LLM tokens into the session with `generate()` and `flush()`, see the [Text-to-Speech quickstart](https://www.assemblyai.com/docs/tts/getting-started/quickstart). A session closes after two idle minutes and lasts at most an hour; the [limits page](https://www.assemblyai.com/docs/tts/limits) has the details.

## Tuning turn detection

Universal-3.6 Pro Realtime uses end-of-turn detection that combines semantic context with voice activity. Steer it with a high-level `mode` preset, then fine-tune the two silence windows:

| Parameter | Default | Lower → | Higher → |
|-----------|---------|---------|---------|
| `mode` | `balanced` | `min_latency` = fastest | `max_accuracy` = cleanest transcripts |
| `min_turn_silence` | 300 ms | Snappier turns | Fewer split entities (e.g. emails) |
| `max_turn_silence` | 1500 ms | Faster cutoff | More thinking time for deliberate speakers |

> Note: `end_of_turn_confidence_threshold` does **not** apply to Universal-3.6 Pro Realtime — it belongs to the older `universal-streaming` models. Turn detection here is handled by the model, controlled by the silence windows above.

## Keyterm prompting (mid-session)

Inject domain-specific vocabulary after the session starts without restarting:

```js
ws.send(JSON.stringify({
  type: "UpdateConfiguration",
  keyterms: ["AssemblyAI", "Universal-3.6 Pro Realtime", "your-product-name"],
}));
```

## Conversation context (mid-session)

Universal-3.6 Pro Realtime can transcribe each user turn in the context of what your agent just said — after your agent asks a question, the model is primed for the answer, which sharpens short replies and spelled-out entities. Push your agent's last reply with the same `UpdateConfiguration` message after each agent turn (both `src/agent.js` and `src/server.js` do this):

```js
ws.send(JSON.stringify({
  type: "UpdateConfiguration",
  agent_context: "Thanks! What's the email address on your account?",
}));
```

## Requirements

- Node.js 18+
- `npm install` installs: `ws`, `openai`, `assemblyai`, `mic`, `dotenv`
- SoX for audio playback: `brew install sox` (macOS) or `sudo apt install sox` (Linux)

## Deploy to Railway, Render, or Fly.io

```bash
# Set environment variables in the platform dashboard, then:
npm run server
```

The browser server is stateless per-connection — each WebSocket session has its own AssemblyAI connection and conversation history.

## Resources

- [Universal-3.6 Pro Realtime streaming API reference](https://www.assemblyai.com/docs/api-reference/streaming-api/universal-3-pro-streaming)
- [AssemblyAI Node.js SDK](https://github.com/AssemblyAI/assemblyai-node-sdk)
- [AssemblyAI Text-to-Speech quickstart](https://www.assemblyai.com/docs/tts/getting-started/quickstart)
- [Blog post: Node.js voice agent with AssemblyAI Universal-3.6 Pro Realtime](https://www.assemblyai.com/blog/node-js-voice-agent-with-assemblyai)
- [AssemblyAI Playground](https://www.assemblyai.com/playground)
- [ws — Node.js WebSocket library](https://github.com/websockets/ws)

---

<div class="blog-cta_component">
  <div class="blog-cta_title">Build a Node.js voice agent in 15 minutes</div>
  <div class="blog-cta_rt w-richtext">
    <p>Connect to Universal-3.6 Pro Realtime over a plain WebSocket from Node.js — no SDK, no framework, built-in turn detection and context carryover.</p>
  </div>
  <a href="https://www.assemblyai.com/dashboard/signup" class="button w-button">Sign up free</a>
</div>

<div class="blog-cta_component">
  <div class="blog-cta_title">Watch turn detection live</div>
  <div class="blog-cta_rt w-richtext">
    <p>Stream audio through Universal-3.6 Pro Realtime in the Playground and see partial transcripts, turn detection, and context carryover as they happen.</p>
  </div>
  <a href="https://www.assemblyai.com/playground" class="button w-button">Try playground</a>
</div>

<div class="blog-cta_component">
  <div class="blog-cta_title">Start streaming from Node.js free</div>
  <div class="blog-cta_rt w-richtext">
    <p>Get a free AssemblyAI account and connect to Universal-3.6 Pro Realtime from your Node.js app in under 15 minutes — $0.45/hr, keyterm prompting included, no credit card.</p>
  </div>
  <a href="https://www.assemblyai.com/dashboard/signup" class="button w-button">Sign up free</a>
</div>
