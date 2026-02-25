import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";





const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function createServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("--- [SERVER] Setting up Vite middleware for development ---");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("--- [SERVER] Vite middleware setup complete ---");
  } else {
    console.log("--- [SERVER] Setting up static file serving for production ---");
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
    console.log("--- [SERVER] Static file serving setup complete ---");
  }

  return { app, PORT };
}

// For local running
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  createServer().then(({ app, PORT }) => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

// Export for Vercel
export default async (req: any, res: any) => {
  const { app } = await createServer();
  return app(req, res);
};
