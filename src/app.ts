import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";

const DEV_WHITELIST = [
  "http://localhost:8100",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8101",
  "https://sorbitodeverdad.com"
];

// Production frontend URLs from env (comma-separated)
const PROD_ORIGINS = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...DEV_WHITELIST, ...PROD_ORIGINS]);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, Vercel health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    // Allow any vercel.app preview deploy
    if (origin.endsWith(".vercel.app")) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "50mb" }));

  app.get("/", (_req, res) => {
    res.send("Sorbito de Verdad API: Sirviendo la esencia, sorbo a sorbo.");
  });

  routerApi(app);

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}
