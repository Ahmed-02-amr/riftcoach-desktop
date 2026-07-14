import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { coachRoutes } from "./routes/coach";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info"
  }
});

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
});

app.get("/health", async () => ({ ok: true, service: "riftcoach-api", time: new Date().toISOString() }));
await app.register(coachRoutes);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  app.log.info(`RiftCoach API listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
