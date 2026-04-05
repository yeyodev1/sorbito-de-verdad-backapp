import dotenv from "dotenv";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";

dotenv.config();

const port = process.env.PORT || 8100;
const { app, server } = createApp();

// Initiate DB connection (non-blocking for startup)
dbConnect().catch(error => {
  console.error("Failed to connect to MongoDB during startup:", error);
});

// For Vercel/serverless environments, we export the app.
// For local development, we listen on the configured port.
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  server.timeout = 10 * 60 * 1000;
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

export default app;
