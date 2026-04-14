import React from 'react';
import { Trash2, Clipboard } from 'lucide-react';

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  isDarkMode: boolean;
}

export const ContentInput: React.FC<ContentInputProps> = ({ text, setText, isDarkMode }) => {
  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
    } catch (err) {
      console.error('Failed to read clipboard');
    }
  };

  return (
    <div className="bg-brand-dark/50 border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-300 hover:neon-border-violet inner-glow">
      <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
        <h2 className="text-sm font-bold flex items-center gap-2 text-white font-mono uppercase tracking-widest">
          <div className="w-2 h-2 bg-brand-violet rounded-full animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.8)]" />
          ဇာတ်လမ်းအကျဉ်း
          <span className="text-[10px] bg-brand-violet/20 text-brand-violet px-2 py-0.5 rounded-full font-mono border border-brand-violet/30">
            MY / EN
          </span>
        </h2>
        <div className="flex gap-4">
          <button
            onClick={handlePaste}
            className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-brand-violet transition-colors font-mono uppercase tracking-wider btn-pulse"
          >
            <Clipboard size={14} /> ကူးယူမည်
          </button>
          <button
            onClick={() => setText('')}
            className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-red-500 transition-colors font-mono uppercase tracking-wider btn-pulse"
          >
            <Trash2 size={14} /> ဖျက်မည်
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="စာသားများကို ဤနေရာတွင် ရိုက်ထည့်ပါ..."
        className="w-full h-80 bg-brand-black/50 border border-white/5 rounded-2xl p-6 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-violet/50 resize-none custom-scrollbar transition-all duration-300 font-sans text-sm leading-relaxed inner-glow"
      />

      <div className="mt-3 flex justify-end">
        <span className="text-xs text-slate-500 font-mono">
          {text.length} လုံး
        </span>
      </div>
    </div>
  );
};
