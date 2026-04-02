import React, { useState } from 'react';
import { Youtube, Sparkles, Copy, Loader2, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { getIdToken } from '../firebase';

interface YouTubeRecapProps {
  isDarkMode: boolean;
  onCopy: (text: string) => void;
}

export const YouTubeRecap: React.FC<YouTubeRecapProps> = ({ isDarkMode, onCopy }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transcript: string; cleanedScript: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Unauthenticated. Please sign in.");

      const response = await fetch('/api/youtube-recap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ url })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to process video");

      setResult(data);
    } catch (err: any) {
      console.error("YouTube Recap Error:", err);
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    onCopy(result.cleanedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8">
      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-2xl transition-colors duration-300">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
            <Youtube size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">YouTube Recap</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Paste a YouTube link to generate a Burmese script instantly.</p>
          </div>
        </div>

        <form onSubmit={handleGenerate} className="space-y-6">
          <div className="relative">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-4 text-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-purple/20"
          >
            {isLoading ? (
              <>
                <Loader2 size={24} className="animate-spin" />
                Processing Transcript...
              </>
            ) : (
              <>
                <Sparkles size={24} />
                Generate Burmese Script
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-500 text-sm font-medium">
            <AlertCircle size={20} />
            {error}
          </div>
        )}
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-2xl transition-colors duration-300"
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={20} className="text-green-500" />
              Generated Script (Burmese)
            </h3>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl font-bold text-sm hover:bg-brand-purple/90 transition-all"
            >
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              Copy to Generator
            </button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-h-[500px] overflow-y-auto custom-scrollbar">
            <p className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap text-lg">
              {result.cleanedScript}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
};
