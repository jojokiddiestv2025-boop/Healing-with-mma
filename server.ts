import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      // Fallback for local dev or if using default credentials
      admin.initializeApp({
        projectId: "healing-with-mma"
      });
    }
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
}

const db = admin.firestore();
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function createServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // API Routes
  app.get("/api/subscription/status/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const doc = await db.collection("subscriptions").doc(userId).get();
      
      if (!doc.exists) {
        return res.json({ isPremium: false, hasUsedTrial: false, expiresAt: null });
      }

      const data = doc.data() as any;
      const now = new Date();
      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
      const isPremium = data.isPremium === 1 && expiresAt && expiresAt > now;

      res.json({ isPremium, hasUsedTrial: data.hasUsedTrial === 1, expiresAt: data.expiresAt });
    } catch (error) {
      console.error("Error fetching subscription:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/subscription/use-trial", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    try {
      await db.collection("subscriptions").doc(userId).set({
        hasUsedTrial: 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true });
    } catch (error) {
      console.error("Error using trial:", error);
      res.status(500).json({ error: "Internal server error" });
    }
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

        await db.collection("subscriptions").doc(userId).set({
          isPremium: 1,
          expiresAt: expiresAt.toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

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
  app.post("/api/payment/webhook", async (req, res) => {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY || "")
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.success") {
      const { metadata } = event.data;
      const userId = metadata?.user_id;

      if (userId) {
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);

        await db.collection("subscriptions").doc(userId).set({
          isPremium: 1,
          expiresAt: expiresAt.toISOString(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
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
