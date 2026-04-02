import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { YoutubeTranscript } = require("youtube-transcript");

console.log("Server: Starting initialization...");

const firebaseConfigPath = new URL("./firebase-applet-config.json", import.meta.url);
console.log("Server: Reading Firebase config from", firebaseConfigPath.toString());

const firebaseConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, "utf-8")
);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Server: Initializing Firebase Admin...");
// Initialize Firebase Admin
try {
  if (!admin.apps.length) {
    // In AI Studio / Cloud Run, we should try to initialize without explicit config first
    // to use the default service account and project. This is the most reliable way.
    const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    const configProjectId = firebaseConfig.projectId;
    const isGenericProject = configProjectId === "gen-lang-client-0124631662";

    console.log("Server: Env Project ID:", envProjectId);
    console.log("Server: Config Project ID:", configProjectId);

    if (envProjectId) {
      admin.initializeApp({
        projectId: envProjectId,
      });
      console.log("Server: Firebase Admin initialized with environment project ID:", envProjectId);
    } else if (!isGenericProject) {
      admin.initializeApp({
        projectId: configProjectId,
      });
      console.log("Server: Firebase Admin initialized for project", configProjectId);
    } else {
      admin.initializeApp();
      console.log("Server: Firebase Admin initialized with default credentials");
    }
  }
} catch (err) {
  console.error("Server: Failed to initialize Firebase Admin:", err);
  // Last resort fallback
  try {
    if (!admin.apps.length) admin.initializeApp();
  } catch (innerErr) {
    console.error("Server: Final fallback for Firebase Admin failed:", innerErr);
  }
}

const dbId = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "remixed-firestore-database-id" 
  ? firebaseConfig.firestoreDatabaseId 
  : "(default)";

console.log(`Server: Initializing Firestore with database ID: "${dbId}"`);
let db: admin.firestore.Firestore;
try {
  // Use getFirestore() for default database, or getFirestore(dbId) for named ones
  db = (dbId === "default" || dbId === "(default)") ? getFirestore() : getFirestore(dbId);
  console.log("Server: Firestore initialized successfully");
} catch (err) {
  console.error("Server: Failed to initialize Firestore:", err);
  // Fallback to default if named fails
  db = getFirestore();
}

// Authentication Middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying ID token:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Helper: Fetch with Retry
async function fetchWithRetry(url: string, options: any, retries = 3, backoff = 1000): Promise<any> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && retries > 0 && (response.status === 429 || response.status >= 500)) {
      console.warn(`Fetch failed with ${response.status}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch error: ${error}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

// Helper: Get Best API Key from Firestore
async function getBestApiKey(type: string, req: express.Request) {
  try {
    console.log(`Server: Fetching best API key for type: ${type}...`);
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('is_active', '==', true)
      .where('is_full', '==', false)
      .orderBy('usage_count', 'asc')
      .limit(1)
      .get();

    if (keysSnapshot.empty) {
      console.log(`Server: No active API keys found for type: ${type}`);
      return null;
    }

    const keyDoc = keysSnapshot.docs[0];
    const data = keyDoc.data();
    console.log(`Server: Found API key: ${keyDoc.id} (Index: ${data.index || 0})`);
    
    // Update usage count asynchronously
    keyDoc.ref.update({
      usage_count: admin.firestore.FieldValue.increment(1),
      last_used_at: admin.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error("Error updating key usage:", err));

    return {
      key: data.key,
      index: data.index || 0,
      id: keyDoc.id
    };
  } catch (error) {
    console.error(`Error getting best ${type} API key:`, error);
    if (error instanceof Error && error.message.includes('NOT_FOUND')) {
      console.warn("Server: Firestore collection 'api_keys' or database not found. Check configuration.");
    }
    return null;
  }
}

// Helper: Mark Key as Full
async function markKeyAsFull(type: string, index: number) {
  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('index', '==', index)
      .limit(1)
      .get();

    if (!keysSnapshot.empty) {
      await keysSnapshot.docs[0].ref.update({ 
        is_full: true, 
        last_full_at: admin.firestore.FieldValue.serverTimestamp() 
      });
    }
  } catch (error) {
    console.error(`Error marking ${type} key #${index} as full:`, error);
  }
}

// Helper: Increment Key Usage
async function incrementKeyUsage(type: string, index: number) {
  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('index', '==', index)
      .limit(1)
      .get();

    if (!keysSnapshot.empty) {
      await keysSnapshot.docs[0].ref.update({ 
        usage_count: admin.firestore.FieldValue.increment(1),
        last_used_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error(`Error incrementing ${type} key #${index} usage:`, error);
  }
}

// Security Audit Log Helper
const logSecurityEvent = async (userId: string, email: string, action: string, details: any) => {
  try {
    await db.collection('security_logs').add({
      userId,
      email,
      action,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: 'server-side',
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

// Helper: Extract YouTube Video ID
function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null;
  const cleanUrl = url.trim();
  // If it's already an 11-char ID
  if (cleanUrl.length === 11 && !cleanUrl.includes('/') && !cleanUrl.includes('.')) return cleanUrl;
  
  // Improved regex to handle shorts, embed, watch, etc.
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = cleanUrl.match(regex);
  return match ? match[1] : null;
}

const app = express();

async function startServer() {
  const PORT = 3000;

  // 1. Content Security Policy (CSP) and Security Headers
  const frameAncestors = [
    "'self'",
    process.env.APP_URL,
    process.env.SHARED_APP_URL,
    "https://ai.studio",
    "https://*.google.com",
    "https://*.run.app"
  ].filter(Boolean) as string[];

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://picsum.photos", "https://*.googleusercontent.com", "https://www.gstatic.com"],
        connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "wss://*.run.app"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: frameAncestors,
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false, // Allow embedding in AI Studio iframe
  }));

  // 2. CORS Restriction
  const allowedOrigins = [
    process.env.APP_URL,
    process.env.SHARED_APP_URL,
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    credentials: true
  }));

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy" });
  });

  // YouTube Recap Endpoint
  app.post("/api/youtube-recap", authenticate, async (req, res) => {
    const { url, apiKey: userApiKey } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "YouTube URL is required" });
    }

    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube URL. Could not extract video ID." });
    }

    let apiKey = userApiKey;
    if (!apiKey) {
      try {
        const bestKeyData = await getBestApiKey('gemini', req);
        if (bestKeyData) {
          apiKey = bestKeyData.key;
        }
      } catch (err) {
        console.error("YouTube Recap: Error fetching global API key:", err);
      }
    }

    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY.trim();
    }

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key for processing" });
    }

    try {
      console.log(`YouTube Recap: Fetching transcript for video ID: ${videoId}...`);
      // Pass the extracted video ID instead of the full URL to be safe
      const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
      const rawTranscript = transcriptItems.map((item: any) => item.text).join(" ");

      if (!rawTranscript) {
        throw new Error("Could not extract transcript from this video. It might be disabled or unavailable.");
      }

      console.log(`YouTube Recap: Processing transcript with Gemini (Length: ${rawTranscript.length})...`);
      
      const ai = new GoogleGenAI({ apiKey });
      const model = ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{
          parts: [{
            text: `Act as a high-speed professional transcriber and scriptwriter. 
            Clean up the following raw YouTube transcript: fix punctuation, remove filler words, and structure it into a clear, engaging Burmese script suitable for a Vlog narration. 
            The output MUST be in Burmese language.
            
            RAW TRANSCRIPT:
            ${rawTranscript}`
          }]
        }],
        config: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
        }
      });

      const result = await model;
      const cleanedScript = result.text;

      res.json({ 
        success: true, 
        transcript: rawTranscript,
        cleanedScript: cleanedScript 
      });
    } catch (error: any) {
      console.error("YouTube Recap Error:", error);
      res.status(500).json({ error: error.message || "Failed to process YouTube video" });
    }
  });

  // Example protected route
  app.get("/api/user/profile", authenticate, async (req, res) => {
    const userId = (req as any).user.uid;
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        res.json(userDoc.data());
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Gemini API Proxy
  app.post("/api/proxy", authenticate, async (req, res) => {
    let { apiKey, model, contents, generationConfig } = req.body;
    let activeKeyIndex = -1;
    let isUsingGlobalKey = false;

    // If no API key provided by user, try to get from Firestore (Global Config)
    if (!apiKey) {
      try {
        const bestKeyData = await getBestApiKey('gemini', req);
        if (bestKeyData) {
          apiKey = bestKeyData.key;
          activeKeyIndex = bestKeyData.index;
          isUsingGlobalKey = true;
          console.log(`Gemini Proxy: Using Global Key #${activeKeyIndex + 1}`);
        }
      } catch (err) {
        console.error("Gemini Proxy: Error fetching global API key:", err);
      }
    }

    // Fallback to environment variable if still missing
    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY.trim();
      console.log("Gemini Proxy: Using environment variable API Key");
    }

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key. Please configure it in Settings or Firestore." });
    }

    const maxKeyRetries = isUsingGlobalKey ? 3 : 1;
    let keyRetries = 0;

    while (keyRetries < maxKeyRetries) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const { apiKey: _, model: __, ...geminiBody } = req.body;
        
        const response = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(geminiBody)
        });

        const data = await response.json();

        if (!response.ok) {
          // If Quota/Rate Limit error and using global key, rotate and retry
          if ((response.status === 429 || response.status === 403) && isUsingGlobalKey && activeKeyIndex !== -1) {
            console.warn(`Gemini Proxy: Key #${activeKeyIndex + 1} failed with ${response.status}. Rotating...`);
            await markKeyAsFull('gemini', activeKeyIndex);
            
            const nextKeyData = await getBestApiKey('gemini', req);
            if (nextKeyData) {
              apiKey = nextKeyData.key;
              activeKeyIndex = nextKeyData.index;
              keyRetries++;
              continue;
            }
          }
          
          console.error("Gemini Proxy: API Error:", data);
          return res.status(response.status).json(data);
        }

        // Success! Increment usage count if global key
        if (isUsingGlobalKey && activeKeyIndex !== -1) {
          await incrementKeyUsage('gemini', activeKeyIndex);
        }

        return res.json(data);
      } catch (error) {
        console.error("Gemini Proxy: Network Error:", error);
        return res.status(500).json({ error: "Failed to proxy request to Gemini" });
      }
    }
    
    res.status(500).json({ error: "All available Gemini API keys are exhausted." });
  });

  // Gemini TTS Proxy (Returns Binary Audio)
  app.post("/api/tts", authenticate, async (req, res) => {
    let { apiKey, text, config, modelId } = req.body;
    let activeKeyIndex = -1;
    let isUsingGlobalKey = false;

    if (!apiKey) {
      try {
        const bestKeyData = await getBestApiKey('gemini', req); // TTS uses Gemini keys
        if (bestKeyData) {
          apiKey = bestKeyData.key;
          activeKeyIndex = bestKeyData.index;
          isUsingGlobalKey = true;
          console.log(`Gemini TTS Proxy: Using Global Key #${activeKeyIndex + 1}`);
        }
      } catch (err) {
        console.error("Gemini TTS Proxy: Error fetching global API key from Firestore:", err);
      }
    }

    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY.trim();
    }

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key" });
    }

    // Prioritize user-selected model, then fallback to others
    const models = modelId 
      ? [modelId, "gemini-2.5-flash-preview-tts", "gemini-3-flash-preview", "gemini-3.1-pro-preview"]
      : ["gemini-2.5-flash-preview-tts", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
    
    let modelIndex = 0;
    const maxAttempts = 3;
    let attempts = 0;

    while (attempts < maxAttempts && modelIndex < models.length) {
      attempts++;
      const currentModel = models[modelIndex];
      
      try {
        console.log(`Gemini TTS Proxy: Attempting with model ${currentModel}...`);
        const isTTSModel = currentModel.includes("tts");
        const ai = new GoogleGenAI({ apiKey });
        const stream = await ai.models.generateContentStream({
          model: currentModel,
          contents: [{ 
            parts: [{ 
              text: isTTSModel 
                ? text 
                : `Generate high-quality speech for the provided text. Additionally, generate accurate SRT (SubRip) subtitles for the speech. Wrap the SRT content in [SRT]...[/SRT] tags.\n\nText: ${text}` 
            }] 
          }],
          config: {
            // Removing responseMimeType: 'application/json' as it conflicts with responseModalities: [Modality.AUDIO]
            // and causes 500 errors on some models.
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: config.voiceName
                }
              }
            }
          }
        });

        // Set headers for streaming
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Transfer-Encoding', 'chunked');

        let base64AudioAccumulator = "";
        let srtContentAccumulator = "";
        let audioMimeType = "audio/pcm";
        let hasReceivedAudio = false;

        for await (const chunk of stream) {
          // Log response keys for debugging as requested
          console.log("Gemini TTS Proxy: Chunk Keys:", Object.keys(chunk));
          if (chunk.candidates?.[0]?.content?.parts) {
            console.log("Gemini TTS Proxy: Part Types:", chunk.candidates[0].content.parts.map(p => p.inlineData ? 'inlineData' : (p.text ? 'text' : 'unknown')));
          }

          if (chunk.candidates?.[0]?.content?.parts) {
            for (const part of chunk.candidates[0].content.parts) {
              if (part.inlineData?.data) {
                base64AudioAccumulator += part.inlineData.data;
                audioMimeType = part.inlineData.mimeType || audioMimeType;
                hasReceivedAudio = true;
                // Send audio chunk to frontend
                res.write(JSON.stringify({ type: 'audio', data: part.inlineData.data, mimeType: audioMimeType }) + '\n');
              } else if (part.text) {
                // Extract SRT from tags if present
                const srtMatch = part.text.match(/\[SRT\]([\s\S]*?)\[\/SRT\]/);
                const srtPart = srtMatch ? srtMatch[1].trim() : part.text;
                srtContentAccumulator += srtPart;
                res.write(JSON.stringify({ type: 'srt', data: srtPart }) + '\n');
              }
            }
          }
        }

        if (!hasReceivedAudio) {
          console.error("Gemini TTS Proxy: Audio missing from Gemini response.");
          throw new Error("Audio missing from Gemini response.");
        }

        // Success! Increment usage count if global key
        if (isUsingGlobalKey && activeKeyIndex !== -1) {
          await incrementKeyUsage('gemini', activeKeyIndex);
        }

        res.end();
        return;

      } catch (error: any) {
        console.error(`Gemini TTS Proxy: Attempt ${attempts}/${maxAttempts} with model ${currentModel} failed:`, error);
        
        const status = error.status || (error.message?.includes('503') ? 503 : 500);
        const isRetryable = status === 429 || status === 403 || status === 503;
        
        if (isRetryable) {
          if (status === 503 && modelIndex === 0) {
            console.warn("Gemini TTS Proxy: Pro model failed with 503. Falling back to Flash model...");
            modelIndex++;
            attempts = 0; // Reset attempts for the new model
            continue;
          }

          if (attempts < maxAttempts) {
            console.warn(`Gemini TTS Proxy: Retryable error ${status}. Retrying...`);
            
            // Rotate key if using global keys and it's a quota/auth error
            if (isUsingGlobalKey && activeKeyIndex !== -1 && (status === 429 || status === 403)) {
              await markKeyAsFull('gemini', activeKeyIndex);
              const nextKeyData = await getBestApiKey('gemini', req);
              if (nextKeyData) {
                apiKey = nextKeyData.key;
                activeKeyIndex = nextKeyData.index;
              }
            }
            
            // Wait with exponential backoff
            const delay = Math.pow(2, attempts) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        // If we already started writing to the response, we can't send a 500 status
        if (res.headersSent) {
          res.write(JSON.stringify({ type: 'error', message: error.message || "Streaming failed" }) + '\n');
          res.end();
          return;
        }

        return res.status(status).json({ 
          error: error.message || "Failed to proxy request to Gemini",
          status: status
        });
      }
    }
    
    res.status(500).json({ error: "All available Gemini API keys are exhausted for TTS." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
