/**
 * TypeScript: AssemblyAI STT 3.7 Realtime Agent through the JavaScript SDK.
 *
 * The SDK's StreamingSpeechModel type (assemblyai 4.43.1) doesn't list the
 * 3.7 model IDs yet. The server accepts them, so widen the string and cast it.
 * Drop the cast once the SDK type includes "assemblyai-stt-3-7-realtime-agent".
 *
 * Type-check: npm run typecheck
 */
import "dotenv/config";
import { AssemblyAI, type StreamingSpeechModel } from "assemblyai";

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

const model: string = "assemblyai-stt-3-7-realtime-agent";

const transcriber = client.streaming.transcriber({
  sampleRate: 16_000,
  speechModel: model as StreamingSpeechModel, // remove the cast when the SDK type catches up
});

transcriber.on("open", ({ id }) => console.log(`Session ${id}`));
transcriber.on("turn", (turn) => {
  if (turn.end_of_turn) console.log(`User: ${turn.transcript}`);
});
transcriber.on("error", (err) => console.error(err));

await transcriber.connect();
// Stream 16 kHz, 16-bit mono PCM with transcriber.sendAudio(chunk), then:
// await transcriber.close();
