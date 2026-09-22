import "dotenv/config";
import express from "express";
import { registerProviderRoutes } from "./providerRoutes";
import { registerVaultRoutes } from "./vaultRoutes";

const app = express();

app.set("trust proxy", 1);

const allowedOrigin = process.env.CORS_ORIGIN?.trim();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigin) return next();
  if (origin !== allowedOrigin) return res.status(403).json({ error: "Origin is not allowed." });
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

registerProviderRoutes(app);
registerVaultRoutes(app);

export default app;
