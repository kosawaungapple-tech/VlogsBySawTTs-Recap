import React, { useState } from 'react';
import { ChevronDown, Volume2, Info, Settings, Sliders } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';
import { motion, AnimatePresence } from 'motion/react';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  isDarkMode: boolean;
  recapStyle: 'Warm' | 'Professional' | 'Excited' | 'Angry' | 'Sad' | 'Whisper';
  setRecapStyle: (style: 'Warm' | 'Professional' | 'Excited' | 'Angry' | 'Sad' | 'Whisper') => void;
}

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ config, setConfig, isDarkMode, recapStyle, setRecapStyle }) => {
  const [isSlidersOpen, setIsSlidersOpen] = useState(false);

  const handleChange = (key: keyof TTSConfig, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  return (
    <div className="bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-[32px] p-8 shadow-2xl transition-all duration-300 hover:neon-border-violet inner-glow">
      <div className="flex flex-col items-center text-center mb-8 border-b border-white/5 pb-6">
        <div className="w-12 h-12 bg-brand-violet/10 text-brand-violet rounded-xl flex items-center justify-center mb-2 border border-brand-violet/20 shadow-[0_0_15px_rgba(139,92,246,0.3)]">
          <Settings size={24} strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-bold text-white font-mono tracking-tighter uppercase">အသံထည့်သွင်းခြင်း</h2>
      </div>
      
      <div className="space-y-8">
        {/* Recap Style Selection */}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-400 font-mono uppercase tracking-widest">
            ဇာတ်လမ်းပုံစံ (Recap Style)
          </label>
          <div className="flex flex-wrap gap-2">
            {(['Warm', 'Professional', 'Excited', 'Angry', 'Sad', 'Whisper'] as const).map((style) => (
              <button
                key={style}
                onClick={() => setRecapStyle(style)}
                className={`py-1.5 px-4 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${
                  recapStyle === style 
                    ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan shadow-[0_0_10px_rgba(34,211,238,0.2)]' 
                    : 'bg-white/5 text-slate-500 border-white/10 hover:border-white/30'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Voice Selection */}
        <div className="group">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-4 group-hover:text-brand-violet transition-colors font-mono uppercase tracking-widest">
            <Volume2 size={16} className="text-brand-violet" strokeWidth={1.5} />
            အသံရွေးချယ်ရန်
          </label>
          <div className="relative">
            <select
              value={config.voiceId}
              onChange={(e) => handleChange('voiceId', e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white appearance-none focus:outline-none focus:ring-2 focus:ring-brand-violet/50 transition-all cursor-pointer font-sans text-sm"
            >
              {VOICE_OPTIONS.map((voice) => (
                <option key={voice.id} value={voice.id} className="bg-brand-black text-white">
                  {voice.name}
                </option>
              ))}
            </select>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
              <ChevronDown size={20} />
            </div>
          </div>
        </div>

        {/* Sliders Accordion */}
        <div className="border border-white/5 rounded-2xl overflow-hidden">
          <button 
            onClick={() => setIsSlidersOpen(!isSlidersOpen)}
            className="w-full px-6 py-4 flex items-center justify-between bg-white/5 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Sliders size={18} className="text-brand-violet" />
              <span className="text-sm font-bold text-white font-mono uppercase tracking-widest">အဆင့်မြင့် ဆက်တင်များ</span>
            </div>
            <ChevronDown 
              size={20} 
              className={`text-slate-400 transition-transform duration-300 ${isSlidersOpen ? 'rotate-180' : ''}`} 
            />
          </button>
          
          <AnimatePresence>
            {isSlidersOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <div className="p-6 space-y-6 bg-white/2">
                  <Slider
                    label="အမြန်နှုန်း"
                    value={config.speed}
                    min={0.25}
                    max={4.0}
                    step={0.05}
                    suffix="x"
                    onChange={(v) => handleChange('speed', v)}
                    isDarkMode={true}
                    compact
                  />
                  <Slider
                    label="အသံအနိမ့်အမြင့်"
                    value={config.pitch}
                    min={-20.0}
                    max={20.0}
                    step={0.5}
                    suffix=""
                    onChange={(v) => handleChange('pitch', v)}
                    isDarkMode={true}
                    compact
                  />
                  <Slider
                    label="အသံပမာဏ"
                    value={config.volume}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    onChange={(v) => handleChange('volume', v)}
                    isDarkMode={true}
                    compact
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 bg-brand-violet/5 border border-brand-violet/10 rounded-xl font-mono">
          <Info size={14} className="text-brand-violet shrink-0" />
          <p className="text-[10px] text-slate-400">
            အပြောင်းအလဲများသည် နောက်တစ်ကြိမ်တွင် အကျိုးသက်ရောက်မည်ဖြစ်သည်။
          </p>
        </div>
      </div>
    </div>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (val: number) => void;
  isDarkMode: boolean;
  compact?: boolean;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, suffix, onChange, isDarkMode, compact }) => {
  return (
    <div className={`group ${compact ? 'space-y-2' : 'space-y-4'}`}>
      <div className="flex justify-between items-center">
        <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-bold text-slate-400 group-hover:text-brand-violet transition-colors font-mono uppercase tracking-wider`}>{label}</span>
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-brand-violet font-mono`}>
          {value > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်' || label === 'Semitones') ? `+${value}` : value}
          {suffix}
        </span>
      </div>
      <div className="relative flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={`w-full ${compact ? 'h-1' : 'h-1.5'} bg-white/5 rounded-full appearance-none cursor-pointer accent-brand-violet hover:bg-white/10 transition-all`}
          style={{
            background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${( (value - min) / (max - min) ) * 100}%, rgba(255, 255, 255, 0.05) ${( (value - min) / (max - min) ) * 100}%, rgba(255, 255, 255, 0.05) 100%)`
          }}
        />
      </div>
    </div>
  );
};
