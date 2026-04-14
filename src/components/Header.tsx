import React from 'react';
import { Sun, Moon, Settings, Mic2, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onOpenTools: () => void;
  isAccessGranted: boolean;
  isAdmin: boolean;
  onLogout: () => void;
  onBack?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  isDarkMode, 
  toggleTheme, 
  onOpenTools,
  isAccessGranted,
  isAdmin,
  onLogout,
  onBack
}) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-brand-black/80 backdrop-blur-md transition-all duration-300">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {onBack && (
            <button 
              onClick={onBack}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-slate-400 hover:text-white border border-white/5 hover:border-brand-violet/30 group/back hover:shadow-[0_0_15px_rgba(139,92,246,0.2)]"
            >
              <ArrowLeft size={16} className="group-hover/back:-translate-x-1 transition-transform" />
              <span className="text-[10px] font-bold uppercase tracking-widest font-mono hidden sm:inline">Back to App</span>
            </button>
          )}
          
          <div className="flex items-center gap-4 group cursor-pointer" onClick={onBack}>
          <div className="w-12 h-12 bg-brand-violet rounded-2xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(139,92,246,0.5)] group-hover:scale-110 transition-transform duration-500">
            <Mic2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-white font-mono leading-none">
              VLOGS BY SAW
            </h1>
            <p className="text-[10px] font-bold text-brand-violet tracking-[0.3em] uppercase mt-1">
              Cinematic AI Engine
            </p>
          </div>
        </div>
      </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-slate-400 hover:text-white border border-white/5 hover:border-brand-violet/30"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-slate-300" />}
          </button>
          {isAccessGranted && (
            <div className="flex items-center gap-2 sm:gap-4">
              {isAdmin && (
                <button 
                  onClick={() => window.location.pathname = '/vbs-admin'}
                  className="px-4 py-2 bg-brand-violet/10 text-brand-violet border border-brand-violet/20 rounded-xl text-[10px] font-bold uppercase hover:bg-brand-violet hover:text-white transition-all btn-pulse font-mono tracking-widest"
                >
                  အက်ဒမင်
                </button>
              )}
              <button 
                onClick={onOpenTools}
                className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-slate-400 hover:text-white border border-white/5 hover:border-brand-violet/30"
                title="Settings"
              >
                <Settings size={20} />
              </button>
              <div className="flex items-center gap-4 pl-4 border-l border-white/5">
                <button 
                  onClick={onLogout}
                  className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-colors whitespace-nowrap font-mono"
                >
                  ထွက်ရန်
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
