import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cookieParser from "cookie-parser";
import crypto from "crypto";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Session-based premium access. No database needed.
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function createServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // API Routes
  app.get("/api/subscription/status/:userId", (req, res) => {
    if (req.cookies.premium_session === 'true') {
      return res.json({ isPremium: true });
    }
    return res.json({ isPremium: false });
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
        // Set a cookie to grant premium access for this session for 1 hour
        res.cookie('premium_session', 'true', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 3600 * 1000 // 1 hour
        });

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
