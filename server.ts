import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };

import { GoogleGenAI, Modality } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini
const getGeminiClient = async (apiKey?: string) => {
  // Ensure we have a valid string and not "null" or "undefined" as a string
  let key = (apiKey && apiKey !== 'null' && apiKey !== 'undefined' && apiKey.trim() !== '') ? apiKey.trim() : process.env.GEMINI_API_KEY;
  
  if (!key || key.trim() === '') {
    // Try fetching from Firestore system config
    try {
      const configDoc = await admin.firestore().collection('config').doc('system_config').get();
      if (configDoc.exists) {
        const firestoreKey = configDoc.data()?.gemini_api_key;
        if (firestoreKey && firestoreKey.trim() !== '') {
          key = firestoreKey.trim();
          console.log("Gemini: Fetched API Key from Firestore system_config");
        }
      }
    } catch (err) {
      console.warn("Gemini: Failed to fetch API Key from Firestore:", err);
    }
  }

  if (!key || key.trim() === '') {
    throw new Error("GEMINI_API_KEY is missing. Please set it in the Admin Dashboard or environment variables.");
  }

  // Mask key for logging
  const maskedKey = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "****";
  console.log(`Gemini: Initializing with key ${maskedKey}`);

  return new GoogleGenAI({ apiKey: key });
};

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore();

// Middleware to verify Firebase ID Token
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthenticated: Missing authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Unauthenticated: Invalid token' });
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy" });
  });

  // Gemini Recap Endpoint (Server-side to bypass region restrictions)
  app.post("/api/gemini/recap", async (req, res) => {
    const { transcript, apiKey } = req.body;
    if (!transcript) return res.status(400).json({ error: "Missing transcript" });

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        console.log(`Gemini Recap: Generating server-side (Attempt ${attempt + 1})...`);
        const ai = await getGeminiClient(apiKey);
        
        const prompt = `You are a professional cinematic movie recap narrator. 
        Summarize the following English transcript into a high-fidelity, engaging, and dramatic Burmese narrative script.
        The output should be suitable for a movie recap video.
        
        Transcript:
        ${transcript}
        
        Output Format:
        Title: [Cinematic Title]
        Content: [Burmese Recap Content]`;

        let response;
        try {
          // Try Pro model first
          response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: [{ parts: [{ text: prompt }] }]
          });
        } catch (proError: any) {
          // Fallback to Flash if Pro fails with quota or high demand errors
          const isQuotaError = proError.message?.includes("429") || proError.message?.includes("RESOURCE_EXHAUSTED");
          const isUnavailableError = proError.message?.includes("503") || proError.message?.includes("UNAVAILABLE");
          
          if (isQuotaError || isUnavailableError) {
            console.warn(`Gemini Recap: Pro model ${isQuotaError ? 'quota exceeded' : 'unavailable'}, falling back to Flash...`);
            try {
              response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: [{ parts: [{ text: prompt }] }]
              });
            } catch (flashError: any) {
              const isFlashUnavailable = flashError.message?.includes("503") || flashError.message?.includes("UNAVAILABLE") || flashError.message?.includes("429");
              if (isFlashUnavailable) {
                console.warn(`Gemini Recap: Flash model also unavailable, falling back to Flash Lite...`);
                response = await ai.models.generateContent({
                  model: "gemini-3.1-flash-lite-preview",
                  contents: [{ parts: [{ text: prompt }] }]
                });
              } else {
                throw flashError;
              }
            }
          } else {
            throw proError;
          }
        }

        const text = response.text || "";
        const titleMatch = text.match(/Title:\s*(.+)/i);
        const contentMatch = text.match(/Content:\s*([\s\S]+)/i);

        return res.json({
          title: titleMatch ? titleMatch[1].trim() : "Movie Recap (Burmese)",
          content: contentMatch ? contentMatch[1].trim() : text
        });
      } catch (error: any) {
        attempt++;
        const errorMsg = error.message || "";
        const isRetryable = errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE") || errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED");
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`Gemini Recap: Error ${errorMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Recap Error:", error);
        if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
          return res.status(429).json({ error: "Gemini API Quota ပြည့်သွားပါပြီ။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini API Quota Exceeded. Please try again later.)" });
        } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
          return res.status(503).json({ error: "Gemini စနစ်တွင် အသုံးပြုသူ များပြားနေပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini is experiencing high demand. Please try again later.)" });
        } else {
          return res.status(500).json({ error: errorMsg });
        }
      }
    }
  });

  // Gemini Translation Endpoint
  app.post("/api/gemini/translate", async (req, res) => {
    const { text, targetLanguage, apiKey } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ error: "Missing text or target language" });

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        console.log(`Gemini Translate: Translating to ${targetLanguage} server-side (Attempt ${attempt + 1})...`);
        const ai = await getGeminiClient(apiKey);
        
        const prompt = `Translate the following English text into ${targetLanguage}. 
        The translation should be natural, engaging, and suitable for a movie recap narration.
        
        Text:
        ${text}
        
        Output: [Translated Text Only]`;

        let response;
        try {
          // Try Pro model first
          response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: [{ parts: [{ text: prompt }] }]
          });
        } catch (proError: any) {
          // Fallback to Flash if Pro fails with quota or high demand errors
          const isQuotaError = proError.message?.includes("429") || proError.message?.includes("RESOURCE_EXHAUSTED");
          const isUnavailableError = proError.message?.includes("503") || proError.message?.includes("UNAVAILABLE");
          
          if (isQuotaError || isUnavailableError) {
            console.warn(`Gemini Translate: Pro model ${isQuotaError ? 'quota exceeded' : 'unavailable'}, falling back to Flash...`);
            try {
              response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: [{ parts: [{ text: prompt }] }]
              });
            } catch (flashError: any) {
              const isFlashUnavailable = flashError.message?.includes("503") || flashError.message?.includes("UNAVAILABLE") || flashError.message?.includes("429");
              if (isFlashUnavailable) {
                console.warn(`Gemini Translate: Flash model also unavailable, falling back to Flash Lite...`);
                response = await ai.models.generateContent({
                  model: "gemini-3.1-flash-lite-preview",
                  contents: [{ parts: [{ text: prompt }] }]
                });
              } else {
                throw flashError;
              }
            }
          } else {
            throw proError;
          }
        }

        return res.json({ translatedText: response.text });
      } catch (error: any) {
        attempt++;
        const errorMsg = error.message || "";
        const isRetryable = errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE") || errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED");
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`Gemini Translate: Error ${errorMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Translate Error:", error);
        if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
          return res.status(429).json({ error: "Gemini API Quota ပြည့်သွားပါပြီ။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။" });
        } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
          return res.status(503).json({ error: "Gemini စနစ်တွင် အသုံးပြုသူ များပြားနေပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။" });
        } else {
          return res.status(500).json({ error: errorMsg });
        }
      }
    }
  });

  // Gemini TTS Endpoint (Server-side to bypass region restrictions)
  app.post("/api/gemini/tts", async (req, res) => {
    const { text, config, apiKey } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    try {
      console.log("Gemini TTS: Generating server-side...");
      const ai = await getGeminiClient(apiKey);
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.voiceName || 'Zephyr'
              }
            }
          }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data received");

      res.json({ audioData: base64Audio });
    } catch (error: any) {
      console.error("Gemini TTS Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate TTS" });
    }
  });

  // Gemini Video Analysis Endpoint (Server-side to bypass region restrictions)
  app.post("/api/gemini/video-analyze", async (req, res) => {
    const { videoBase64, mimeType, prompt, apiKey, style } = req.body;
    if (!videoBase64) return res.status(400).json({ error: "Missing video data" });

    const maxRetries = 5;
    let attempt = 0;

    const styleDefinitions = `
- Warm: Use a gentle, friendly, and soft tone.
- Professional: Use formal, authoritative, and clear language (News Anchor style).
- Excited: Use high-energy, enthusiastic, and fast-paced narration.
- Angry: Use a sharp, intense, and aggressive tone.
- Sad: Use a slow, emotional, and somber tone.
- Whisper: Use a quiet, intimate, and low-volume narrative style.
`;

    const jsonPrompt = `You are the content generator for "Vlogs By Saw". Your primary task is to analyze the uploaded video deeply and provide a response strictly in JSON format.

### CORE TASKS:
1. RECAP (ဇာတ်လမ်းအကျဉ်းချုပ်): This is your PRIMARY output. Create a detailed summary focusing on the main story points and the emotions conveyed in the video. If the Style is 'Warm', use a gentle and friendly storytelling tone. If 'Excited', use high-energy Burmese. If 'Sad', use emotional/slow Burmese. For other styles, use the appropriate tone in Burmese. Ensure the output is in natural, flowing Burmese script.
2. TRANSCRIPT: Provide a full audio transcription.
3. OCR: Extract visible on-screen text.

### STYLE INSTRUCTION INTERPRETATION:
${styleDefinitions}

### OUTPUT JSON SCHEMA:
{
  "recap": "string",
  "transcript": "string",
  "on_screen_text": ["string"]
}

Note: ALL output fields must be in accurate, natural Burmese. Do not include any text other than the JSON object. Return ONLY raw JSON.

Original request: ${prompt || "Analyze the video deeply, focusing on the story and emotions for the recap."}
Style to use for recap: ${style || 'Professional'}`;

    while (attempt < maxRetries) {
      try {
        console.log(`Gemini Video Analyze: Processing server-side (Attempt ${attempt + 1})...`);
        const ai = await getGeminiClient(apiKey);
        
        let response;
        const contentParams = {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType || 'video/mp4',
                    data: videoBase64,
                  },
                },
                {
                  text: jsonPrompt,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json"
          }
        };

        try {
          // Try Pro model first
          response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            ...contentParams
          });
        } catch (proError: any) {
          // Fallback to Flash if Pro fails with quota or high demand errors
          const isQuotaError = proError.message?.includes("429") || proError.message?.includes("RESOURCE_EXHAUSTED");
          const isUnavailableError = proError.message?.includes("503") || proError.message?.includes("UNAVAILABLE");
          
          if (isQuotaError || isUnavailableError) {
            console.warn(`Gemini Video Analyze: Pro model ${isQuotaError ? 'quota exceeded' : 'unavailable'}, falling back to Flash...`);
            try {
              response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                ...contentParams
              });
            } catch (flashError: any) {
              const isFlashUnavailable = flashError.message?.includes("503") || flashError.message?.includes("UNAVAILABLE") || flashError.message?.includes("429");
              if (isFlashUnavailable) {
                console.warn(`Gemini Video Analyze: Flash model also unavailable, falling back to Flash Lite...`);
                response = await ai.models.generateContent({
                  model: "gemini-3.1-flash-lite-preview",
                  ...contentParams
                });
              } else {
                throw flashError;
              }
            }
          } else {
            throw proError;
          }
        }

        const resultText = response.text || "";
        try {
          const jsonResult = JSON.parse(resultText);
          return res.json(jsonResult);
        } catch (parseErr) {
          console.error("Failed to parse Gemini JSON response:", resultText);
          // If parsing fails, return the raw text as transcript in a JSON structure
          return res.json({
            transcript: resultText,
            on_screen_text: []
          });
        }
      } catch (error: any) {
        attempt++;
        const errorMsg = error.message || "";
        const isRetryable = errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE") || errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED");
        
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`Gemini Video Analyze: Error ${errorMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Gemini Video Analyze Error:", error);
        if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
          return res.status(429).json({ error: "Gemini API Quota ပြည့်သွားပါပြီ။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini API Quota Exceeded. Please try again later.)" });
        } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
          return res.status(503).json({ error: "Gemini စနစ်တွင် အသုံးပြုသူ များပြားနေပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini is experiencing high demand. Please try again later.)" });
        } else {
          return res.status(500).json({ error: errorMsg });
        }
      }
    }
  });

  // Gemini URL Analysis Endpoint (Server-side to bypass region restrictions)
  app.post("/api/gemini/analyze-url", async (req, res) => {
    const { url, prompt, apiKey } = req.body;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    try {
      console.log("Gemini URL Analyze: Processing server-side for", url);
      const ai = await getGeminiClient(apiKey);
      
      let response;
      const contentParams = {
        contents: prompt || `Analyze this YouTube video and provide a detailed transcript or a very thorough summary of what is being said and shown: ${url}`,
        config: {
          tools: [{ urlContext: {} }]
        }
      };

      try {
        // Try Pro model first
        response = await ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          ...contentParams
        });
      } catch (proError: any) {
        // Fallback to Flash if Pro fails with quota or high demand errors
        const isQuotaError = proError.message?.includes("429") || proError.message?.includes("RESOURCE_EXHAUSTED");
        const isUnavailableError = proError.message?.includes("503") || proError.message?.includes("UNAVAILABLE");
        
        if (isQuotaError || isUnavailableError) {
          console.warn(`Gemini URL Analyze: Pro model ${isQuotaError ? 'quota exceeded' : 'unavailable'}, falling back to Flash...`);
          response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            ...contentParams
          });
        } else {
          throw proError;
        }
      }

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini URL Analyze Error:", error);
      const errorMsg = error.message || "Failed to analyze URL";
      if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        res.status(429).json({ error: "Gemini API Quota ပြည့်သွားပါပြီ။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini API Quota Exceeded. Please try again later.)" });
      } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
        res.status(503).json({ error: "Gemini စနစ်တွင် အသုံးပြုသူ များပြားနေပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Gemini is experiencing high demand. Please try again later.)" });
      } else {
        res.status(500).json({ error: errorMsg });
      }
    }
  });

  // YouTube Transcript Endpoint
  app.get("/api/youtube-transcript", async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: "Missing video URL" });
    }

    const extractVideoId = (url: string) => {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
      const match = url.match(regex);
      return match ? match[1] : null;
    };

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const isShorts = videoUrl.includes('/shorts/');
    if (isShorts) {
      console.log(`YouTube Transcript: Shorts link detected for ${videoId}, standardizing to watch URL.`);
    }

    try {
      console.log("YouTube Transcript: Fetching real data for", videoId);
      
      let transcript = null;
      
      // Method 1: Try youtube-transcript library
      try {
        const pkg = await import('youtube-transcript');
        const YoutubeTranscript = pkg.YoutubeTranscript || (pkg as any).default;
        
        if (YoutubeTranscript && typeof YoutubeTranscript.fetchTranscript === 'function') {
          // Try fetching without language restriction first to get whatever is available
          try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId);
          } catch (langErr) {
            // Fallback to English if default fails
            try {
              transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
            } catch (enErr) {
              console.warn(`YouTube Transcript: Library failed for ${videoId} (en):`, enErr.message);
            }
          }
        }
      } catch (e) {
        console.log(`YouTube Transcript: Library method for ${videoId} failed, attempting advanced scraping...`);
      }

      // Method 2: Advanced Scraping Fallback (Enhanced)
      if (!transcript || transcript.length === 0) {
        try {
          const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          ];
          const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
          
          let html = '';
          let usedProxy = false;

          // Try direct fetch with optimized headers
          try {
            const response = await fetch(watchUrl, {
              headers: {
                'User-Agent': randomUA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
              }
            });
            if (response.ok) {
              html = await response.text();
              if (html && html.includes('ytInitialPlayerResponse')) {
                console.log("YouTube Transcript: Direct fetch successful");
              } else {
                html = ''; // Reset if it's a bot detection page
              }
            }
          } catch (e) {
            console.warn("YouTube Transcript: Direct fetch failed, trying proxy rotation...");
          }

          // Proxy rotation if direct fetch fails
          if (!html) {
            const proxies = [
              `https://api.allorigins.win/get?url=${encodeURIComponent(watchUrl)}`,
              `https://corsproxy.io/?${encodeURIComponent(watchUrl)}`,
              `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(watchUrl)}`,
              `https://proxy.cors.sh/${watchUrl}`
            ];

            for (const proxyUrl of proxies) {
              try {
                console.log(`YouTube Transcript: Trying proxy ${proxyUrl.split('?')[0]}...`);
                const proxyRes = await fetch(proxyUrl);
                if (proxyRes.ok) {
                  if (proxyUrl.includes('allorigins')) {
                    const proxyData = await proxyRes.json();
                    html = proxyData.contents;
                  } else {
                    html = await proxyRes.text();
                  }
                  
                  if (html && html.includes('ytInitialPlayerResponse')) {
                    console.log(`YouTube Transcript: Proxy ${proxyUrl.split('?')[0]} successful`);
                    usedProxy = true;
                    break;
                  }
                }
              } catch (pErr) {
                console.warn(`YouTube Transcript: Proxy ${proxyUrl.split('?')[0]} failed`);
              }
            }
          }

          if (html) {
            transcript = await parseTranscriptFromHtml(html, usedProxy);
          }
        } catch (scrapeError) {
          console.error("YouTube Transcript: Advanced scraping failed:", scrapeError);
        }
      }

      async function parseTranscriptFromHtml(html: string, useProxy: boolean) {
        const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/s;
        const match = html.match(regex);
        if (match) {
          try {
            const playerResponse = JSON.parse(match[1]);
            const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            
            if (tracks && tracks.length > 0) {
              const track = tracks.find((t: any) => t.languageCode === 'en') || 
                            tracks.find((t: any) => t.languageCode === 'en-US') ||
                            tracks.find((t: any) => t.languageCode.startsWith('en')) ||
                            tracks[0];
              
              let transcriptUrl = track.baseUrl;
              let xmlResponse;

              if (useProxy) {
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(transcriptUrl)}`;
                const pRes = await fetch(proxyUrl);
                if (pRes.ok) {
                  const pData = await pRes.json();
                  xmlResponse = pData.contents;
                }
              }

              if (!xmlResponse) {
                const res = await fetch(transcriptUrl);
                xmlResponse = await res.text();
              }
              
              if (xmlResponse) {
                const textRegex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
                const results = [];
                let m;
                while ((m = textRegex.exec(xmlResponse)) !== null) {
                  results.push({
                    text: m[3]
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/&nbsp;/g, ' '),
                    offset: parseFloat(m[1]) * 1000,
                    duration: parseFloat(m[2]) * 1000
                  });
                }
                return results;
              }
            }
          } catch (e) {
            console.error("Error parsing player response:", e);
          }
        }
        return null;
      }

      if (!transcript || transcript.length === 0) {
        return res.status(404).json({ error: "No transcript found. Please ensure the video has English captions enabled." });
      }

      res.json({ transcript });
    } catch (error: any) {
      console.error("YouTube Transcript Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch transcript" });
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

  // API 404 handler - MUST be before Vite middleware
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
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
