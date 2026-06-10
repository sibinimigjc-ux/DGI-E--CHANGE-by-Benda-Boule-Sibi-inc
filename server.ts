import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON and URLencoded parsing with increased payload limits for scanned document images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Gemini-powered Document Corner Detection using background server-side API call (Zéro Déformation)
  app.post("/api/detect-corners", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Missing image payload" });
      }

      let base64Data = image;
      let mimeType = "image/jpeg";
      const matches = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      }

      // Model priority queue prioritizing gemini-3.5-flash and avoiding deprecated models
      const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-flash"];
      let lastError: any = null;
      let response: any = null;

      for (const modelName of modelsToTry) {
        try {
          console.log(`[Detect Corners] Attempting document corner detection using model: ${modelName}...`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType
                }
              },
              {
                text: "Identify the four exact corners of the main sheet of paper/document in this photo. " +
                      "Ignore background items like floor tiles, desks, keys, books, carpets, or shadows. " +
                      "Return the four corners as normalized coordinate percentages from 0 to 100 where (0,0) is top-left of the image, and (100,100) is bottom-right. " +
                      "The response MUST be valid JSON structure with 'corners' property mapping to an array of exactly 4 coordinates in clockwise order: " +
                      "1. Top-Left corner, 2. Top-Right corner, 3. Bottom-Right corner, 4. Bottom-Left corner."
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  corners: {
                    type: Type.ARRAY,
                    description: "Coordinates of the four page corners in clockwise order (TL, TR, BR, BL)",
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER, description: "X coordinate percentage (0 to 100)" },
                        y: { type: Type.NUMBER, description: "Y coordinate percentage (0 to 100)" }
                      },
                      required: ["x", "y"]
                    }
                  }
                },
                required: ["corners"]
              }
            }
          });
          
          if (response) {
            console.log(`[Detect Corners] Success using model: ${modelName}`);
            break;
          }
        } catch (err: any) {
          console.warn(`[Detect Corners] Model ${modelName} failed or busy:`, err.message || err);
          lastError = err;
        }
      }

      if (response) {
        const resultText = response.text || "";
        console.log(`[Detect Corners] Gemini output:`, resultText);
        const parsed = JSON.parse(resultText);
        return res.json(parsed);
      }

      // Ultimate Graceful Fallback: Return robust safe averages instead of crashing
      console.warn("[Detect Corners] All API models were unavailable. Applying clean fallback card frame coordinates to prevent crash.", lastError);
      return res.json({
        corners: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 }
        ],
        fallback: true
      });
    } catch (err: any) {
      console.error("[Detect Corners] Critical Failure:", err);
      // Fallback response with basic margins to absolute safeguard the system
      return res.json({
        corners: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 }
        ],
        fallback: true,
        error: err.message
      });
    }
  });

  // Microsoft Lens style server-side OCR proxy using Gemini models
  app.post("/api/ocr", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Missing image payload" });
      }

      let base64Data = image;
      let mimeType = "image/jpeg";
      const matches = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      }

      const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-flash"];
      let lastError: any = null;
      let response: any = null;

      for (const modelName of modelsToTry) {
        try {
          console.log(`[OCR] Attempting high-precision OCR using model: ${modelName}...`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType
                }
              },
              {
                text: "Effectue une reconnaissance optique de caractères (OCR) de haute précision en français sur cette image de document fiscal. Extrais l'intégralité du texte imprimé, dactylographié ou manuscrit visible de manière brute, exacte et sans aucune modification, fioriture ni bavardage. Rends uniquement le texte brut extrait du document."
              }
            ]
          });

          if (response) {
            console.log(`[OCR] Success using model: ${modelName}`);
            break;
          }
        } catch (err: any) {
          console.warn(`[OCR] Model ${modelName} failed or busy:`, err.message || err);
          lastError = err;
        }
      }

      if (response) {
        const extractedText = response.text || "";
        console.log(`[OCR] Successfully extracted ${extractedText.length} characters.`);
        return res.json({ text: extractedText });
      }

      // Return graceful offline fallback string for search and manual editing
      console.warn("[OCR] All API models overloaded. Returning clean error bypass placeholder.", lastError);
      return res.json({ 
        text: "Texte non extrait (Service d'extraction temporairement surchargé). Veuillez saisir ou retenter l'extraction.",
        fallback: true
      });
    } catch (err: any) {
      console.error("[OCR] Gemini OCR processing failure:", err);
      return res.json({ 
        text: "Texte non extrait (Erreur de communication serveur). Veuillez retenter l'extraction.",
        fallback: true
      });
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
