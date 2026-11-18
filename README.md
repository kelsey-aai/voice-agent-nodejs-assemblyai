# Node.js voice agent with AssemblyAI STT 3.7 Realtime Agent

Companion code for the blog post **[Node.js voice agent with AssemblyAI STT 3.7 Realtime Agent](https://www.assemblyai.com/blog/node-js-voice-agent-with-assemblyai)**.

Build a real-time voice agent in Node.js with [AssemblyAI STT 3.7 Realtime Agent](https://www.assemblyai.com/products/streaming-speech-to-text) (`assemblyai-stt-3-7-realtime-agent`) for speech-to-text and AssemblyAI Text-to-Speech for the agent's voice. There's no Python and no framework: one WebSocket in, one TTS session out, and an LLM in between.

The companion repo has two modes:

- **Terminal agent** (`src/agent.js`): mic input through the `mic` package, replies played through SoX.
- **Browser agent** (`src/server.js`): a Node.js WebSocket server with a browser UI on `getUserMedia`.

## Why AssemblyAI STT 3.7 Realtime Agent for a Node.js voice agent?

AssemblyAI STT 3.7 Realtime Agent is the speech-to-text model the docs recommend for [voice agents](https://www.assemblyai.com/solutions/voice-agents). It's trained on real voice-agent and telephony conversations, and it uses what the agent and the user said in earlier turns as context for each new turn.

The failures it targets are the ones that break an agent mid-call: a misheard account number, a quiet "yes" that never arrives, or a voice from the TV that the LLM answers. On AssemblyAI's English voice-agent benchmark (12,460 scenarios, 522 speakers, telephony audio with no, low or heavy noise), here's how it compares with Universal-3.6 Pro Realtime:

<table style="width:100%; border-collapse:collapse; font-family:Arial, sans-serif; font-size:15px;">
  <thead>
    <tr style="background-color:#1E56A0; color:#fff;">
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">Metric (vs Universal-3.6 Pro Realtime)</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">Universal-3.6 Pro Realtime</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">AssemblyAI STT 3.7 Realtime Agent</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">Change</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">Number error rate (Voice Code Bench)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">11.28%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">2.27%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−80%</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">Entity miss rate (Voice Code Bench)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">23.28%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">11.00%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−53%</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">Words added while the user is silent (per 1,000 words)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">2.53</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">1.34</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−47%</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">One- and two-word replies dropped</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">0.29%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">0.18%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−38%</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">Word error rate</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">5.19%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">4.46%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−14%</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">Words that change between partial and final</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">3.24%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">1.01%</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−69%</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">False end-of-turn events</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">—</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">—</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−12%</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">Time from end of speech to final transcript (latency benchmark)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">172 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">86 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">−50%</td>
    </tr>
  </tbody>
</table>


*Source: the [AssemblyAI STT 3.7 Realtime Agent research post](https://www.assemblyai.com/blog/assemblyai-stt-3-7-realtime-agent-research), Nov 2026. Number error rate and entity miss rate are measured on Voice Code Bench, a set of recordings dense in numbers and codes. The last row comes from a separate latency benchmark.*

Among the streaming systems AssemblyAI measured on the same voice-agent benchmark, STT 3.7 Realtime Agent has the lowest normalized word error rate (4.42%, 26% below the next provider) at every noise level, and the lowest entity error rate (13.25%, 20% below the next provider). It also drops the fewest short responses.

For a Node.js developer, the practical upside is that you don't run a separate VAD library. The model decides when the user has finished, and entity-aware endpointing holds the turn open while someone reads out a phone number or an email address.

> Previous model: `universal-3-6-pro` (Universal-3.6 Pro Realtime) is still fully supported. To upgrade, change the `speech_model` value; the endpoint and message types stay the same.


## Quick start

```bash
git clone https://github.com/kelsey-aai/voice-agent-nodejs-assemblyai
cd voice-agent-nodejs-assemblyai

npm install
cp .env.example .env
# Add ASSEMBLYAI_API_KEY and OPENAI_API_KEY to .env
```

Run the terminal agent, or the browser agent:

```bash
npm start          # terminal agent: speak into your mic, Ctrl+C to quit
npm run server     # browser agent: open http://localhost:3000
```

## Connect to the AssemblyAI WebSocket

Open a WebSocket to `wss://streaming.assemblyai.com/v3/ws` and set the model with the `speech_model` query parameter. Your API key goes in the `Authorization` header. The `token` query parameter is only for temporary tokens, so never put your permanent key in the URL.

```javascript
import WebSocket from "ws";

const AAI_WS_URL =
  "wss://streaming.assemblyai.com/v3/ws" +
  "?speech_model=assemblyai-stt-3-7-realtime-agent" +
  "&encoding=pcm_s16le" +
  "&sample_rate=16000";

const aaiWs = new WebSocket(AAI_WS_URL, {
  headers: { Authorization: process.env.ASSEMBLYAI_API_KEY },
});
```

Leave out `min_turn_silence` and `max_turn_silence` unless you have a reason to set them. Their defaults now come from the `mode` preset, covered in the tuning section below.

## Handle turns

The session sends a `Begin` message, then for each user turn a `SpeechStarted` message, partial `Turn` messages and one final `Turn` with `end_of_turn: true`. Each `Turn` re-transcribes the whole turn, so replace what you show instead of appending. Send only the final to your LLM.

```javascript
aaiWs.on("message", async (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "Begin") {
    console.log(`Session: ${msg.id}`);
  }

  if (msg.type === "Turn" && !msg.end_of_turn) {
    process.stdout.write(`\r${msg.transcript}`); // partial: replace, don't append
  }

  if (msg.type === "Turn" && msg.end_of_turn && msg.transcript.trim()) {
    const reply = await generateResponse(msg.transcript);
    await speak(reply);
  }
});
```

## Send audio

From the browser, convert the Web Audio float samples to 16-bit PCM and send each buffer to your server, which forwards it to AssemblyAI:

```javascript
processor.onaudioprocess = (e) => {
  const float32 = e.inputBuffer.getChannelData(0);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
  }
  ws.send(int16.buffer);
};
```

From the terminal, the `mic` package already produces raw 16 kHz PCM:

```javascript
const micStream = micInstance.getAudioStream();
micStream.on("data", (chunk) => {
  aaiWs.send(chunk); // raw PCM s16le bytes
});
```

## Speak replies with AssemblyAI Text-to-Speech

The turn handler ends with `speak(reply)`. Implement it with the [AssemblyAI Text-to-Speech API](https://www.assemblyai.com/products/text-to-speech), so the whole agent runs on one AssemblyAI key apart from your LLM. Its `assemblyai-tts-1` model is built for conversational voice agents and trained on millions of hours of audio, including real conversational data. Install the JavaScript SDK and SoX:

```bash
npm install assemblyai   # 4.43.1 or later
# SoX plays the raw audio stream: brew install sox (macOS) or sudo apt install sox (Linux)
```

Open one TTS session when the agent starts and reuse it for every reply. `speak()` streams the reply as raw 24 kHz, 16-bit mono PCM while it's synthesized, so the terminal agent pipes each chunk into SoX and playback starts with the first chunk. The sample sets `aai-kyla`, the docs' default English voice. You can pick another in the [voices guide](https://www.assemblyai.com/docs/tts/voices).

```javascript
// Text-to-speech for the terminal agent: one AssemblyAI session for the whole conversation
import { spawn } from "node:child_process";
import { AssemblyAI } from "assemblyai";

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

const tts = client.tts.session({
  voiceId: "aai-kyla",
  language: "english",
});
await tts.connect(); // waits for the Begin frame

// The session closes after two idle minutes; keep it open between turns
setInterval(() => tts.keepAlive(), 60_000);

let player = null; // the SoX process playing the current reply

async function speak(text) {
  // SoX reads raw 24 kHz, 16-bit, mono PCM from stdin and plays it
  const proc = spawn("play", ["-q", "-t", "raw", "-r", "24000", "-e", "signed", "-b", "16", "-c", "1", "-"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  player = proc;
  proc.stdin.on("error", () => {}); // the player was stopped by a barge-in
  const finished = new Promise((resolve) => proc.on("close", resolve));

  // speak() sends the text, flushes it and yields audio as it is synthesized.
  // The loop ends at the reply's FlushDone, or at once after cancel().
  for await (const chunk of tts.speak(text)) {
    proc.stdin.write(chunk);
  }
  proc.stdin.end();
  await finished; // wait until the reply has finished playing
  if (player === proc) player = null;
}
```

### Barge-in

To let the user interrupt, keep the mic streaming while the agent talks (use headphones, or the mic will hear the speakers) and cancel the reply when a real turn starts. `cancel()` stops synthesis and ends the `speak()` loop at once, and killing the player stops the audio it already holds. Ignoring one-word turns keeps a "mhm" from cutting the agent off.

```javascript
// Barge-in: the user talks over the agent
function bargeIn() {
  tts.cancel();   // stops synthesis and ends the speak() loop at once
  player?.kill(); // stops the audio already handed to the player
  player = null;
}

// In the AssemblyAI "message" handler, before the end_of_turn branch:
if (msg.type === "Turn" && player) {
  const words = msg.transcript.split(/\s+/).filter(Boolean).length;
  if (words >= 2) bargeIn(); // ignore one-word backchannels like "mhm"
}
```

On STT 3.7 Realtime Agent, `interruption_delay` defaults to `0` in every mode, so the first partial of a new turn arrives soon after the user starts talking. If you'd rather stop playback on any speech, act on the `SpeechStarted` message instead. The docs describe it as a reliable barge-in signal, because background noise alone doesn't trigger it.

When the agent shuts down, close the session so it ends cleanly:

```javascript
// Ctrl+C: end the text-to-speech session cleanly
process.on("SIGINT", async () => {
  await tts.close(); // sends Terminate and waits for the session summary
  process.exit(0);
});
```

### Speak in the browser

The browser server speaks replies the same way. Open one session per browser connection on the server, where the API key already lives, and forward each chunk to the page as a binary WebSocket message:

```javascript
// src/server.js: speak each reply to the browser that asked for it.
// One text-to-speech session per browser connection; the server keeps the API key.
const tts = client.tts.session({
  voiceId: "aai-kyla",
  language: "english",
});
await tts.connect();

for await (const chunk of tts.speak(reply)) {
  browserWs.send(chunk); // binary message: raw 24 kHz 16-bit PCM
}
```

The audio is raw PCM with no header, so an `<audio>` element can't play it. Decode it on the page with the Web Audio API and schedule each chunk after the previous one:

```javascript
// Browser page: set ws.binaryType = "arraybuffer", then call playPcm() for each binary message
const playCtx = new AudioContext(); // resume it inside a click handler
let playAt = 0;

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
}
```

To stream LLM tokens into the session with `generate()` and `flush()`, see the Text-to-Speech quickstart. A session closes after two idle minutes and lasts at most an hour.

## Tuning turn detection

STT 3.7 Realtime Agent doesn't end turns on silence alone. When the user pauses, the model checks whether what they've said reads as finished, and it holds the turn open if they're partway through an entity. Pick a `mode` preset first. The presets set the two silence windows for you (values from the [turn detection docs](https://www.assemblyai.com/docs/streaming/turn-detection)):

<table style="width:100%; border-collapse:collapse; font-family:Arial, sans-serif; font-size:15px;">
  <thead>
    <tr style="background-color:#1E56A0; color:#fff;">
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">mode</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">min_turn_silence</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">max_turn_silence</th>
      <th style="padding:10px 14px; text-align:left; border:1px solid #ccc;">Use it when</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">min_latency</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">128 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">640 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">Short, fast exchanges where speed matters most</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">balanced (default)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">128 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">1,280 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">Most voice agents</td>
    </tr>
    <tr>
      <td style="padding:10px 14px; border:1px solid #ccc;">max_accuracy</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">512 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">2,560 ms</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">Deliberate speakers, long entities, noisy audio</td>
    </tr>
    <tr style="background-color:#f5f5f5;">
      <td style="padding:10px 14px; border:1px solid #ccc;">manual (Agent model only)</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">—</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">10,000 ms safety net</td>
      <td style="padding:10px 14px; border:1px solid #ccc;">Your own VAD, push-to-talk or turn model decides</td>
    </tr>
  </tbody>
</table>


Set the mode on the URL (`&mode=max_accuracy`), or change it mid-stream. When your agent has just asked for a callback number, raise `min_turn_silence` for that one answer, then re-apply the mode to restore its defaults:

```javascript
// Before capturing the entity
aaiWs.send(JSON.stringify({ type: "UpdateConfiguration", min_turn_silence: 1000 }));

// After the answer, re-apply your mode to restore its defaults
aaiWs.send(JSON.stringify({ type: "UpdateConfiguration", mode: "balanced" }));
```

### Bring your own turn detection

If your client should decide when every turn ends, connect with `mode=manual` and send `ForceEndpoint` when your detector fires. Manual mode works only on `assemblyai-stt-3-7-realtime-agent`. Each `ForceEndpoint` gets exactly one formatted final `Turn` back, which is an empty one if no turn was in progress. The server still ends a turn after 10,000 ms of silence as a safety net.

```javascript
const MANUAL_URL =
  "wss://streaming.assemblyai.com/v3/ws" +
  "?speech_model=assemblyai-stt-3-7-realtime-agent" +
  "&encoding=pcm_s16le&sample_rate=16000&mode=manual";

// When your VAD or push-to-talk button decides the user is done:
aaiWs.send(JSON.stringify({ type: "ForceEndpoint" }));
```

For the full picture of how endpointing trades speed against cut-offs, see our guide to [turn detection for voice agents](https://www.assemblyai.com/blog/turn-detection-endpointing-voice-agent).

## Keyterm prompting mid-session

Inject domain vocabulary after the session starts, without reconnecting. The field is `keyterms_prompt`, and it takes up to 100 terms. Here's why it matters for product names and SKUs: [keyterm prompting for real-time accuracy](https://www.assemblyai.com/blog/keyterm-prompting-real-time-accuracy).

```javascript
aaiWs.send(JSON.stringify({
  type: "UpdateConfiguration",
  keyterms_prompt: ["AssemblyAI", "Kubernetes", "your-product-name"],
}));
```

## Give the model your agent's last reply

Send your agent's last reply as `agent_context` after each agent turn. The model uses it as context for the next user turn, which helps most on short replies and spelled-out entities. Each update replaces the previous value, up to 1,750 characters. The model also carries recent user turns forward on its own.

```javascript
aaiWs.send(JSON.stringify({
  type: "UpdateConfiguration",
  agent_context: "Thanks! What's the email address on your account?",
}));
```

## Use the JavaScript SDK from TypeScript

The repo uses the raw `ws` package, so it runs as plain JavaScript with no type checks in the way. If you'd rather use the SDK's streaming transcriber from TypeScript, there's a temporary gap: the `StreamingSpeechModel` type in `assemblyai` 4.43.1 doesn't list the 3.7 model IDs yet, so passing `"assemblyai-stt-3-7-realtime-agent"` fails type checking. The server accepts the value, so widen it to `string` and cast it:

```typescript
import { AssemblyAI, type StreamingSpeechModel } from "assemblyai";

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

const model: string = "assemblyai-stt-3-7-realtime-agent";

const transcriber = client.streaming.transcriber({
  sampleRate: 16_000,
  speechModel: model as StreamingSpeechModel, // remove the cast when the SDK type catches up
});

transcriber.on("turn", (turn) => {
  if (turn.end_of_turn) console.log(`User: ${turn.transcript}`);
});

await transcriber.connect();
```

The repo includes this as `examples/sdk-transcriber.ts`. Run `npm run typecheck` to check it.


## Requirements

- Node.js 18+
- `npm install` installs `ws`, `openai`, `assemblyai`, `mic` and `dotenv`
- SoX for audio playback: `brew install sox` (macOS) or `sudo apt install sox` (Linux)

## Deploy to Railway, Render or Fly.io

```bash
# Set ASSEMBLYAI_API_KEY and OPENAI_API_KEY in the platform dashboard, then:
npm run server
```

The browser server is stateless per connection. Each browser WebSocket gets its own AssemblyAI connection, TTS session and conversation history. Speech-to-text is billed at $0.45/hr on session duration; current rates for every add-on are on the [pricing page](https://www.assemblyai.com/pricing).

## Where to go next

The same speech model runs under other stacks. To put this agent on a phone number, see the [Twilio phone agent tutorial](https://www.assemblyai.com/blog/twilio-phone-agent-with-assemblyai), which streams Twilio's 8 kHz μ-law audio straight into STT 3.7 Realtime Agent. If you'd rather hand telephony and orchestration to a platform, the [Vapi voice agent guide](https://www.assemblyai.com/blog/vapi-voice-agent-with-assemblyai) covers what Vapi's AssemblyAI transcriber supports today. To weigh speech-to-text options for an agent in general, start with [how to choose an STT API for voice agents](https://www.assemblyai.com/blog/choosing-a-stt-api-for-voice-agents).

The bigger shift in this release is what the model is trained to ignore. A Node.js agent with no VAD library now relies on the speech model to tell a quiet "yes" from a voice in the background, and STT 3.7 Realtime Agent was built and measured on both sides of that trade-off.

## Resources

- [Companion repo: voice-agent-nodejs-assemblyai](https://github.com/kelsey-aai/voice-agent-nodejs-assemblyai)
- [AssemblyAI Node.js SDK](https://github.com/AssemblyAI/assemblyai-node-sdk)

## License

MIT
