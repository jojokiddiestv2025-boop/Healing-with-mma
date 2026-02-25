import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("database.sqlite");
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    userId TEXT PRIMARY KEY,
    isPremium INTEGER DEFAULT 0,
    hasUsedTrial INTEGER DEFAULT 0,
    expiresAt TEXT,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // API Routes
  app.get("/api/subscription/status/:userId", (req, res) => {
    const { userId } = req.params;
    const row = db.prepare("SELECT * FROM subscriptions WHERE userId = ?").get(userId) as any;
    
    if (!row) {
      return res.json({ isPremium: false, hasUsedTrial: false, expiresAt: null });
    }

    const now = new Date();
    const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
    const isPremium = row.isPremium === 1 && expiresAt && expiresAt > now;

    res.json({ isPremium, hasUsedTrial: row.hasUsedTrial === 1, expiresAt: row.expiresAt });
  });

  app.post("/api/subscription/use-trial", (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    db.prepare(`
      INSERT INTO subscriptions (userId, hasUsedTrial)
      VALUES (?, 1)
      ON CONFLICT(userId) DO UPDATE SET
        hasUsedTrial = 1,
        updatedAt = CURRENT_TIMESTAMP
    `).run(userId);

    res.json({ success: true });
  });

  // Paystack Verification
  app.post("/api/payment/initialize", async (req, res) => {
    const { userId, email } = req.body;
    if (!userId || !email) return res.status(400).json({ error: "userId and email required" });

    if (!PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    try {
      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email,
          amount: 5000 * 100, // ₦5,000 in kobo
          callback_url: `${APP_URL}/api/payment/callback`,
          metadata: {
            user_id: userId,
            custom_fields: [
              {
                display_name: "User ID",
                variable_name: "user_id",
                value: userId
              }
            ]
          }
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      res.json({ authorization_url: response.data.data.authorization_url });
    } catch (error) {
      console.error("Paystack initialization error:", error);
      res.status(500).json({ error: "Failed to initialize payment" });
    }
  });

  app.get("/api/payment/callback", async (req, res) => {
    const { reference } = req.query;
    const userId = req.cookies.pending_payment_user_id;

    if (!reference || !userId) {
      return res.redirect("/?payment_error=missing_data");
    }

    if (!PAYSTACK_SECRET_KEY) {
      console.error("PAYSTACK_SECRET_KEY is missing");
      return res.redirect("/?payment_error=server_config");
    }

    try {
      const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        },
      });

      if (response.data.status && response.data.data.status === "success") {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        db.prepare(`
          INSERT INTO subscriptions (userId, isPremium, expiresAt)
          VALUES (?, 1, ?)
          ON CONFLICT(userId) DO UPDATE SET
            isPremium = 1,
            expiresAt = ?,
            updatedAt = CURRENT_TIMESTAMP
        `).run(userId, expiresAt.toISOString(), expiresAt.toISOString());

        res.clearCookie("pending_payment_user_id");
        return res.redirect("/?payment_success=true");
      } else {
        return res.redirect("/?payment_error=verification_failed");
      }
    } catch (error) {
      console.error("Paystack verification error:", error);
      return res.redirect("/?payment_error=api_error");
    }
  });

  // Paystack Webhook
  app.post("/api/payment/webhook", (req, res) => {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY || "")
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.success") {
      const { reference, metadata, customer } = event.data;
      // Try to get userId from metadata first, then fallback to email if we used it as an ID
      const userId = metadata?.user_id;

      if (userId) {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        db.prepare(`
          INSERT INTO subscriptions (userId, isPremium, expiresAt)
          VALUES (?, 1, ?)
          ON CONFLICT(userId) DO UPDATE SET
            isPremium = 1,
            expiresAt = ?,
            updatedAt = CURRENT_TIMESTAMP
        `).run(userId, expiresAt.toISOString(), expiresAt.toISOString());
        
        console.log(`Webhook: Premium granted to user ${userId}`);
      }
    }

    res.status(200).send("Webhook received");
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
