import { GoogleGenAI, Modality, Type, GenerateContentResponse } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";
import { getIdToken } from "../firebase";

export class GeminiTTSService {
  private apiKey: string;

  constructor(apiKey?: string) {
    const rawKey = apiKey || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') || '';
    this.apiKey = rawKey.trim();
    console.log("GeminiTTSService: Initialized with key:", this.apiKey ? `Present (Starts with ${this.apiKey.substring(0, 4)}...)` : "Missing");
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    if (!this.apiKey) {
      console.error("GeminiTTSService: Cannot verify connection - API Key is empty");
      return { isValid: false, error: "Empty API Key" };
    }

    try {
      console.log("GeminiTTSService: Verifying connection via proxy...");
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Unauthenticated: No ID Token");

      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          apiKey: this.apiKey,
          model: GEMINI_MODELS.VERIFY,
          contents: [{ parts: [{ text: "Hello" }] }]
        })
      });

      if (response.ok) {
        return { isValid: true };
      } else {
        const data = await response.json();
        return { isValid: false, error: data.error || "Proxy verification failed", status: response.status };
      }
    } catch (err: any) {
      console.error("GeminiTTSService: Verification failed:", err);
      return { isValid: false, error: err.message, status: err.status };
    }
  }

  async generateTTS(text: string, config: TTSConfig, useProxy: boolean = true): Promise<AudioResult> {
    console.log("TTS Service: Starting generation...", { 
      useProxy,
      textLength: text.length,
      hasKey: !!this.apiKey,
      keyPreview: this.apiKey ? `${this.apiKey.substring(0, 4)}...` : 'none'
    });

    if (!useProxy) {
      console.log("TTS Service: Direct Mode Enabled. Bypassing Proxy...");
      return this.generateTTSDirect(text, config);
    }

    if (!this.apiKey) {
      throw new Error("API Key missing. Please configure it in Settings.");
    }

    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS[0];
    
    // Request Validation (Error 400 Fix)
    const speed = Math.max(0.25, Math.min(4.0, parseFloat(String(config.speed)) || 1.0));
    const pitch = Math.max(-20.0, Math.min(20.0, parseFloat(String(config.pitch)) || 0.0));
    const volume = Math.max(0, Math.min(100, parseFloat(String(config.volume)) || 80));

    console.log("TTS Service: Sending request to Gemini TTS Proxy (Binary)...", { speed, pitch, volume });

    try {
      const idToken = await getIdToken();
      if (!idToken) {
        throw new Error("Unauthenticated: No ID Token. Please enable Anonymous Auth in Firebase Console.");
      }

      // Retry logic as requested
      let retries = 0;
      const maxRetries = 2;
      let lastError = null;

      while (retries <= maxRetries) {
        try {
          console.log(`TTS Service: Attempt ${retries + 1} of ${maxRetries + 1}...`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

          const response = await fetch("/api/tts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({
              apiKey: this.apiKey,
              text: text,
              modelId: config.modelId,
              config: {
                ...config,
                speed,
                pitch,
                volume,
                voiceName: voice.voiceName
              }
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Proxy error: ${response.status}` }));
            throw new Error(errorData.error || `Proxy error: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) throw new Error("Response body is not readable");

          let srtContent = "";
          const audioChunks: Uint8Array[] = [];
          let audioMimeType = "audio/pcm";
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line);
                
                if (chunk.type === 'srt') {
                  srtContent += chunk.data;
                } else if (chunk.type === 'audio') {
                  const binaryString = atob(chunk.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  audioChunks.push(bytes);
                  audioMimeType = chunk.mimeType || audioMimeType;
                } else if (chunk.type === 'error') {
                  throw new Error(chunk.message);
                }
              } catch (e) {
                console.warn("Failed to parse stream chunk:", e);
              }
            }
          }

          // Combine audio chunks
          const totalLength = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
          const combinedAudio = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of audioChunks) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
          }

          if (combinedAudio.length === 0) {
            throw new Error("No audio data received from Gemini");
          }

          console.log("TTS Service: Received streamed response", { 
            audioLength: combinedAudio.length,
            srtLength: srtContent.length 
          });

          let wavBlob: Blob;
          if (audioMimeType.includes('wav')) {
            wavBlob = new Blob([combinedAudio], { type: "audio/wav" });
          } else {
            // Wrap in WAV header
            wavBlob = pcmToWav(combinedAudio, 24000);
          }

          if (wavBlob.size < 100) {
            throw new Error('Generated audio file is corrupted or empty.');
          }

          try {
            // Convert Blob to Data URI to avoid "The operation is insecure" errors in browsers
            const audioDataUri = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(wavBlob);
            });

            const subtitles = GeminiTTSService.parseSRT(srtContent);

            // If subtitles are empty, try to generate mock ones as fallback
            const finalSubtitles = subtitles.length > 0 ? subtitles : this.generateMockSRT(text, (combinedAudio.length) / 48000);
            const finalSrtContent = subtitles.length > 0 ? srtContent : finalSubtitles.map(s => 
              `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
            ).join('\n');

            // Convert combinedAudio to base64 for storage/history
            const base64Audio = btoa(String.fromCharCode(...combinedAudio));

            return {
              audioUrl: audioDataUri, // Use Data URI as the primary URL
              audioData: base64Audio,
              audioDataUri,
              wavBlob: wavBlob,
              srtContent: finalSrtContent,
              subtitles: finalSubtitles
            };
          } catch (e) {
            console.error("Failed to create audio Data URI:", e);
            throw new Error("Failed to create audio Data URI");
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`TTS Service: Attempt ${retries + 1} failed:`, err.message);
          retries++;
          if (retries <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
          }
        }
      }

      throw lastError || new Error("Failed after multiple retries");
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("TTS Service: Proxy API call failed. Full error details:", errorMsg);
      
      if (err instanceof TypeError && errorMsg === "Load failed") {
        console.error("TTS Service: Network error or connection reset.");
      } else if (err.name === "AbortError") {
        console.error("TTS Service: Request was aborted (timeout).");
      }

      throw err;
    }
  }

  private async generateTTSDirect(text: string, config: TTSConfig): Promise<AudioResult> {
    if (!this.apiKey) {
      throw new Error("API Key is required for Direct Mode. Please configure it in Settings.");
    }

    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS[0];
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    
    // Reverting to Gemini 3 models as they support multimodal output (Audio + SRT)
    // Gemini 1.5 models do NOT support audio output via this API, which was causing 500 errors.
    const models = ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-2.5-flash-preview-tts"];
    let lastError = null;

    for (const modelName of models) {
      try {
        console.log(`TTS Service: Direct Mode - Attempting with model ${modelName}...`);
        
        const isTTSModel = modelName.includes("tts");
        
        const response = await ai.models.generateContent({
          model: modelName,
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
                  voiceName: voice.voiceName
                }
              }
            }
          }
        });

        // Log response keys for debugging
        console.log("TTS Service: Direct Mode - Response Keys:", Object.keys(response));
        
        let base64Audio = "";
        let srtContent = "";
        let audioMimeType = "audio/pcm";

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              base64Audio += part.inlineData.data;
              audioMimeType = part.inlineData.mimeType || audioMimeType;
            } else if (part.text) {
              // Extract SRT from tags if present
              const srtMatch = part.text.match(/\[SRT\]([\s\S]*?)\[\/SRT\]/);
              if (srtMatch) {
                srtContent += srtMatch[1].trim();
              } else {
                srtContent += part.text;
              }
            }
          }
        }

        if (!base64Audio) {
          console.error("TTS Service: Direct Mode - Audio missing from Gemini response. Model:", modelName);
          throw new Error("Audio missing from Gemini response.");
        }

        const binaryString = atob(base64Audio);
        const combinedAudio = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          combinedAudio[i] = binaryString.charCodeAt(i);
        }

        let wavBlob: Blob;
        if (audioMimeType.includes('wav')) {
          wavBlob = new Blob([combinedAudio], { type: "audio/wav" });
        } else {
          wavBlob = pcmToWav(combinedAudio, 24000);
        }

        const audioDataUri = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(wavBlob);
        });

        const subtitles = GeminiTTSService.parseSRT(srtContent);
        const finalSubtitles = subtitles.length > 0 ? subtitles : this.generateMockSRT(text, (combinedAudio.length) / 48000);
        const finalSrtContent = subtitles.length > 0 ? srtContent : finalSubtitles.map(s => 
          `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
        ).join('\n');

        return {
          audioUrl: audioDataUri, // Use Data URI as the primary URL
          audioData: base64Audio,
          audioDataUri,
          wavBlob: wavBlob,
          srtContent: finalSrtContent,
          subtitles: finalSubtitles
        };

      } catch (err: any) {
        lastError = err;
        console.warn(`TTS Service: Direct Mode - Model ${modelName} failed:`, err.message);
        // Continue to next model
      }
    }

    throw lastError || new Error("Direct API call failed for all models");
  }

  static parseSRT(srt: string): SRTSubtitle[] {
    const blocks = srt.trim().split(/\n\s*\n/);
    return blocks.map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const index = parseInt(lines[0]);
      const [startTime, endTime] = lines[1].split(' --> ');
      const text = lines.slice(2).join('\n');
      return { index, startTime, endTime, text };
    }).filter((s): s is SRTSubtitle => s !== null);
  }

  private generateMockSRT(text: string, duration: number): SRTSubtitle[] {
    const totalChars = text.length;
    const charPerSec = totalChars / duration;
    
    // Commander's Order: Max 1.5 - 2.0 seconds per segment.
    // We calculate a dynamic character limit based on the speaking rate.
    const maxCharsForTwoSeconds = Math.floor(charPerSec * 1.8); 
    const MAX_PHRASE_CHARS = Math.max(12, Math.min(25, maxCharsForTwoSeconds));

    // 1. Split text into meaningful phrases (Burmese phrase-aware)
    const segments = this.splitTextIntoPhrases(text, MAX_PHRASE_CHARS);
    const subtitles: SRTSubtitle[] = [];
    
    const TOTAL_DURATION = duration; 
    const MAX_SEGMENT_DURATION = 2.0; 
    const MIN_SEGMENT_DURATION = 0.8; 
    
    // First pass: calculate raw durations
    let rawDurations = segments.map(s => (s.length / totalChars) * TOTAL_DURATION);
    
    // Second pass: enforce constraints
    let totalAssigned = 0;
    let adjustedDurations = rawDurations.map(d => {
      // Clamp duration between min and max
      const adj = Math.max(MIN_SEGMENT_DURATION, Math.min(d, MAX_SEGMENT_DURATION));
      totalAssigned += adj;
      return adj;
    });

    // Scale to fit total duration exactly
    const scaleFactor = TOTAL_DURATION / totalAssigned;
    adjustedDurations = adjustedDurations.map(d => d * scaleFactor);

    let currentTime = 0;

    segments.forEach((segmentText, index) => {
      const formattedText = this.applyInternalLineBreaks(segmentText, 45);
      const segmentDuration = adjustedDurations[index];
      
      const startTime = currentTime;
      let endTime = currentTime + segmentDuration;
      
      // Ensure the last segment ends exactly at 40.000
      if (index === segments.length - 1) {
        endTime = TOTAL_DURATION;
      }

      subtitles.push({
        index: index + 1,
        startTime: formatTime(startTime),
        endTime: formatTime(endTime),
        text: formattedText
      });
      
      currentTime = endTime;
    });

    return subtitles;
  }

  private isBurmeseDependent(char: string): boolean {
    if (!char) return false;
    const code = char.charCodeAt(0);
    // Burmese dependent characters (vowels, medials, asat, etc.)
    // Range: \u102B-\u103E
    return (code >= 0x102B && code <= 0x103E);
  }

  private getSafeSplitIndex(text: string, index: number): number {
    let safeIndex = index;
    while (safeIndex < text.length && this.isBurmeseDependent(text[safeIndex])) {
      safeIndex++;
    }
    return safeIndex;
  }

  private splitTextIntoPhrases(text: string, maxChars: number = 28): string[] {
    // Burmese phrase markers and punctuation
    const punctuation = ['။', '၊'];
    
    // First, split by punctuation which are definitive breaks
    let segments: string[] = [text];

    punctuation.forEach(p => {
      let nextTemp: string[] = [];
      segments.forEach(s => {
        const parts = s.split(p);
        parts.forEach((part, i) => {
          let trimmed = part.trim();
          if (trimmed) {
            // Add the punctuation back if it's not the last part
            if (i < parts.length - 1) trimmed += p;
            nextTemp.push(trimmed);
          }
        });
      });
      segments = nextTemp;
    });

    // Now further split long segments by spaces, markers or character limits
    // Reduced limit for short, punchy fragments (TikTok/Reels style)
    const MAX_PHRASE_CHARS = maxChars; 
    const MIN_PHRASE_CHARS = Math.floor(maxChars / 3);
    const markers = ['ကြောင့်', 'ပြီး', 'ဆို', 'ကို', 'မှာ', 'ဖြင့်', 'လျှင်', 'သော်လည်း', 'သဖြင့်', '၍', '၏', '၌', 'မှ', 'သို့', 'နှင့်', 'လည်း', 'ပင်', 'သာ', 'ကော', 'ပါ', 'ဦး', 'တော့', 'လေ', 'ပေါ့', 'နော်', 'ဖြစ်', 'သည်', '၏', 'က', 'ကို', 'မှ'];

    let intermediateSegments: string[] = [];
    segments.forEach(s => {
      if (s.length <= MAX_PHRASE_CHARS) {
        intermediateSegments.push(s);
      } else {
        let subCurrent = s;
        while (subCurrent.length > MAX_PHRASE_CHARS) {
          // 1. Try splitting at space first for phrase integrity
          let splitIdx = subCurrent.lastIndexOf(' ', MAX_PHRASE_CHARS);
          
          // 2. If no space, try markers
          if (splitIdx === -1) {
            for (const marker of markers) {
              const idx = subCurrent.lastIndexOf(marker, MAX_PHRASE_CHARS);
              if (idx > splitIdx) splitIdx = idx + marker.length;
            }
          }

          if (splitIdx !== -1 && splitIdx > 10) {
            // Ensure we don't split a cluster even at a marker/space
            splitIdx = this.getSafeSplitIndex(subCurrent, splitIdx);
            intermediateSegments.push(subCurrent.substring(0, splitIdx).trim());
            subCurrent = subCurrent.substring(splitIdx).trim();
          } else {
            // 3. Fallback to character limit with safe split
            const safeIdx = this.getSafeSplitIndex(subCurrent, MAX_PHRASE_CHARS);
            intermediateSegments.push(subCurrent.substring(0, safeIdx).trim());
            subCurrent = subCurrent.substring(safeIdx).trim();
          }
        }
        if (subCurrent) intermediateSegments.push(subCurrent);
      }
    });

    // Final pass: Combine segments that are too short to ensure natural reading flow
    let finalSegments: string[] = [];
    let currentBuffer = "";

    intermediateSegments.forEach((seg) => {
      if (currentBuffer === "") {
        currentBuffer = seg;
      } else if (currentBuffer.length + seg.length < MAX_PHRASE_CHARS) {
        // Combine if the result is still within a reasonable phrase length
        // Use space if it's not already ending with punctuation
        const separator = /[။၊]$/.test(currentBuffer) ? "" : " ";
        currentBuffer += separator + seg;
      } else {
        finalSegments.push(currentBuffer.trim());
        currentBuffer = seg;
      }
    });
    
    if (currentBuffer) {
      if (currentBuffer.length < MIN_PHRASE_CHARS && finalSegments.length > 0) {
        const separator = /[။၊]$/.test(finalSegments[finalSegments.length - 1]) ? "" : " ";
        finalSegments[finalSegments.length - 1] += separator + currentBuffer;
      } else {
        finalSegments.push(currentBuffer.trim());
      }
    }

    return finalSegments.filter(s => s.length > 0);
  }

  private splitTextIntoSegments(text: string, maxWords: number, maxChars: number): string[] {
    // This is now a legacy method, but we'll keep it for compatibility if needed
    return this.splitTextIntoPhrases(text);
  }

  private applyInternalLineBreaks(text: string, maxCharsPerLine: number): string {
    if (text.length <= maxCharsPerLine) return text;
    
    // Find a good place to split (e.g., middle space)
    const mid = Math.floor(text.length / 2);
    const spaceBefore = text.lastIndexOf(' ', mid);
    const spaceAfter = text.indexOf(' ', mid);
    
    let splitIdx = -1;
    if (spaceBefore !== -1 && spaceAfter !== -1) {
      splitIdx = (mid - spaceBefore < spaceAfter - mid) ? spaceBefore : spaceAfter;
    } else {
      splitIdx = spaceBefore !== -1 ? spaceBefore : spaceAfter;
    }
    
    if (splitIdx !== -1) {
      const safeSplitIdx = this.getSafeSplitIndex(text, splitIdx);
      // If we adjusted the split index, we might have moved past a space, 
      // so we handle the newline carefully
      if (safeSplitIdx === splitIdx) {
        return text.substring(0, splitIdx).trim() + '\n' + text.substring(splitIdx + 1).trim();
      } else {
        return text.substring(0, safeSplitIdx).trim() + '\n' + text.substring(safeSplitIdx).trim();
      }
    }
    
    // No space found, split at mid but ensure it's safe
    const safeMid = this.getSafeSplitIndex(text, mid);
    if (safeMid >= text.length - 1) return text; // Don't split if it's too close to the end
    return text.substring(0, safeMid).trim() + '\n' + text.substring(safeMid).trim();
  }
}
