import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { attachReportMetadata, buildPostGameCoachMessages, buildReviewChatMessages, parseJsonObject, withInferredReviewType } from "@riftcoach/ai";
import { CoachReportJsonSchema, type CoachChatInput, type CoachReportInput } from "@riftcoach/core";
import { redact } from "../security/redact";

interface ReportRequestBody {
  model?: string;
  input: CoachReportInput;
}

interface ChatRequestBody {
  model?: string;
  input: CoachChatInput;
}

export async function coachRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/coach/report", async (request: FastifyRequest<{ Body: ReportRequestBody }>, reply: FastifyReply) => {
    const authResult = requireAuth(request);
    if (!authResult.ok) return reply.code(401).send({ error: authResult.error });

    const body = request.body;
    if (!body?.input?.match?.sessionId) return reply.code(400).send({ error: "Missing CoachReportInput" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({
        error: "OPENAI_API_KEY is not configured on the RiftCoach API server. Cloud report generation cannot run."
      });
    }

    try {
      const model = body.model || process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1-mini";
      const messages = buildPostGameCoachMessages(body.input);
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: messages.map((message) => ({ role: message.role, content: message.content })),
          max_output_tokens: cleanOutputTokenLimit(process.env.OPENAI_MAX_OUTPUT_TOKENS),
          text: {
            format: {
              type: "json_schema",
              name: "coach_report",
              strict: true,
              schema: CoachReportJsonSchema
            }
          }
        })
      });

      if (!response.ok) {
        const text = await response.text();
        request.log.error({ status: response.status, body: redact(text.slice(0, 500)) }, "OpenAI request failed");
        return reply.code(502).send({ error: `OpenAI request failed with HTTP ${response.status}.` });
      }

      const responseJson = (await response.json()) as any;
      const outputText = extractOutputText(responseJson);
      const payload = withInferredReviewType(parseJsonObject(outputText), body.input);
      const report = attachReportMetadata({ payload, sessionId: body.input.match.sessionId, provider: "openai-proxy", model });
      return reply.send(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: redact(message) }, "Coach report generation failed");
      return reply.code(500).send({ error: `Cloud report generation failed: ${redact(message)}` });
    }
  });

  app.post("/v1/coach/chat", async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
    const authResult = requireAuth(request);
    if (!authResult.ok) return reply.code(401).send({ error: authResult.error });

    const body = request.body;
    if (!body?.input?.report?.id || !body.input.userMessage?.trim()) return reply.code(400).send({ error: "Missing CoachChatInput" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({
        error: "OPENAI_API_KEY is not configured on the RiftCoach API server. Cloud review chat cannot run."
      });
    }

    try {
      const model = body.model || process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1-mini";
      const messages = buildReviewChatMessages(body.input);
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: messages.map((message) => ({ role: message.role, content: message.content })),
          max_output_tokens: cleanOutputTokenLimit(process.env.OPENAI_CHAT_MAX_OUTPUT_TOKENS ?? process.env.OPENAI_MAX_OUTPUT_TOKENS)
        })
      });

      if (!response.ok) {
        const text = await response.text();
        request.log.error({ status: response.status, body: redact(text.slice(0, 500)) }, "OpenAI chat request failed");
        return reply.code(502).send({ error: `OpenAI chat request failed with HTTP ${response.status}.` });
      }

      const responseJson = (await response.json()) as any;
      return reply.send({
        content: extractOutputText(responseJson).trim(),
        sources: body.input.webSources ?? [],
        warnings: body.input.webWarnings ?? []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: redact(message) }, "Coach review chat failed");
      return reply.code(500).send({ error: `Cloud review chat failed: ${redact(message)}` });
    }
  });
}

function cleanOutputTokenLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8192;
  return Math.min(65536, Math.max(1024, Math.round(parsed)));
}

function requireAuth(request: FastifyRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.RIFTCOACH_API_TOKEN;
  if (!expected) return { ok: true };
  const header = request.headers.authorization;
  if (header === `Bearer ${expected}`) return { ok: true };
  return { ok: false, error: "Unauthorized" };
}

function extractOutputText(responseJson: any): string {
  if (typeof responseJson?.output_text === "string") return responseJson.output_text;
  const content = responseJson?.output?.flatMap((item: any) => item?.content ?? [])?.find((item: any) => item?.type === "output_text" || item?.text);
  if (typeof content?.text === "string") return content.text;
  if (typeof content === "string") return content;
  throw new Error("OpenAI response did not contain output text.");
}
