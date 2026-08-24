// Slack Events API endpoint for the RevOps bot ("Revie").
//
// Slack pushes events here the instant someone @mentions the bot in a channel or DMs it.
// Slack requires a 2xx ack within 3 seconds, so we verify + ack immediately and do the
// real work (👀 reaction → agent answer → in-thread reply → ✅) in after(), which runs
// once the response has been sent. Point the Slack app's Event Subscriptions Request URL
// at https://<production-domain>/api/slack/events.
import { after } from "next/server";
import { verifySlackSignature, answerQuestion, postMessage, addReaction } from "../../../../lib/slack-bot";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds — the agent loop runs inside after()

type SlackEvent = {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel: string;
  channel_type?: string;
  ts: string;
  thread_ts?: string;
};

// Best-effort dedupe of Slack redeliveries within a warm instance.
const seen = new Set<string>();

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return new Response("bad signature", { status: 401 });
  }

  const body = JSON.parse(raw) as { type: string; challenge?: string; event_id?: string; event?: SlackEvent };

  // Slack's one-time URL verification handshake
  if (body.type === "url_verification") {
    return Response.json({ challenge: body.challenge });
  }

  // Retries carry the same payload — ack them without reprocessing.
  if (req.headers.get("x-slack-retry-num")) return new Response("ok");
  if (body.event_id) {
    if (seen.has(body.event_id)) return new Response("ok");
    seen.add(body.event_id);
    if (seen.size > 500) seen.clear();
  }

  const ev = body.event;
  const isMention = ev?.type === "app_mention";
  const isDm = ev?.type === "message" && ev.channel_type === "im" && !ev.subtype;
  if (!ev || (!isMention && !isDm) || ev.bot_id || !ev.text) return new Response("ok");

  const question = ev.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const threadTs = ev.thread_ts ?? ev.ts;

  after(async () => {
    try {
      await addReaction(ev.channel, ev.ts, "eyes");
      const answer = await answerQuestion(question, { channel: ev.channel, thread_ts: ev.thread_ts });
      // channels: reply in-thread; DMs: reply inline
      await postMessage(ev.channel, answer, isDm ? undefined : threadTs);
      await addReaction(ev.channel, ev.ts, "white_check_mark");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await postMessage(
        ev.channel,
        `:warning: Sorry — I hit an error answering that (\`${msg.slice(0, 140)}\`). Try again, or ask Tai.`,
        isDm ? undefined : threadTs,
      ).catch(() => {});
    }
  });

  return new Response("ok");
}
