import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, Wand2, Key, Settings, User, LogIn, LogOut, ShieldCheck, ShieldAlert, Shield, CheckCircle2, XCircle, History, Wrench, Plus, Trash2, Download, Play, Music, FileText, Eye, EyeOff, Cloud, RefreshCw, Zap, X, ExternalLink, Calendar, Clock, Mail, Wifi, Save, Lock, Info, ArrowRight, ChevronRight, Youtube, Search, Upload, Video, Volume2, ChevronDown, Languages } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ContentInput } from './components/ContentInput';
import { PronunciationRules } from './components/PronunciationRules';
import { VoiceConfig } from './components/VoiceConfig';
import { OutputPreview } from './components/OutputPreview';
import { MiniAudioPlayer } from './components/MiniAudioPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { GeminiTTSService } from './services/geminiService';
import { TTSConfig, AudioResult, PronunciationRule, HistoryItem, GlobalSettings, AuthorizedUser, SystemConfig } from './types';
import { DEFAULT_RULES, VOICE_OPTIONS } from './constants';
import { pcmToWav } from './utils/audioUtils';
import { db, storage, auth, signInAnonymously, signOut, onAuthStateChanged, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, handleFirestoreError, OperationType, collection, query, where, orderBy, addDoc, deleteDoc, getDocs, limit, ref, uploadString, getDownloadURL } from './firebase';

type Tab = 'generate' | 'history' | 'tools' | 'admin' | 'vbs-admin' | 'youtube-recap' | 'youtube-transcript';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const role = localStorage.getItem('vbs_role');
    return role === 'ADMIN' ? 'generate' : 'youtube-transcript';
  });
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [text, setText] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [saveToHistory, setSaveToHistory] = useState(false);
  const [config, setConfig] = useState<TTSConfig>({
    voiceId: 'zephyr',
    speed: 1.0,
    pitch: 0,
    volume: 80
  });
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sign in anonymously is restricted in the console, so we skip it for now.
  // The app will function in bypass mode using localStorage for the API Key.
  
  const [newApiKey, setNewApiKey] = useState('');
  const [localApiKey, setLocalApiKey] = useState<string | null>(localStorage.getItem('VLOGS_BY_SAW_API_KEY'));
  const [apiSwitch, setApiSwitch] = useState<'admin' | 'personal'>(localStorage.getItem('VBS_API_SWITCH') as 'admin' | 'personal' || 'admin');
  const [isUpdatingKey, setIsUpdatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [profile, setProfile] = useState<AuthorizedUser | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    allow_global_key: false,
    total_generations: 0
  });
  const [systemLive, setSystemLive] = useState<boolean>(true);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Global Rules & History
  const [globalRules, setGlobalRules] = useState<PronunciationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(false); // Default to false to bypass loading screen if env vars missing
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname === '/vbs-admin');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER' | null>(localStorage.getItem('vbs_role') as any || null);

  // Auth & Access State (Custom)
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordStep, setShowPasswordStep] = useState(false);
  const [pendingUser, setPendingUser] = useState<AuthorizedUser | null>(null);
  const [isAccessGranted, setIsAccessGranted] = useState(localStorage.getItem('vbs_access_granted') === 'true');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(localStorage.getItem('vbs_access_code'));
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('vbs_role') === 'ADMIN');
  const [isSessionSynced, setIsSessionSynced] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isProcessingYoutube, setIsProcessingYoutube] = useState(false);
  const [youtubeTranscriptUrl, setYoutubeTranscriptUrl] = useState('');
  const [rawTranscript, setRawTranscript] = useState('');
  const [videoAnalysis, setVideoAnalysis] = useState<{
    transcript: string;
    on_screen_text: string[];
    recap: string;
  } | null>(null);
  const [recapStyle, setRecapStyle] = useState<'Warm' | 'Professional' | 'Excited' | 'Angry' | 'Sad' | 'Whisper'>('Professional');
  const [isFetchingTranscript, setIsFetchingTranscript] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isVideoProcessing, setIsVideoProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showManualInput, setShowManualInput] = useState(true); // Default to true now
  const [manualTranscript, setManualTranscript] = useState('');
  const [showTranscriptGuide, setShowTranscriptGuide] = useState(false);
  const [recapManualText, setRecapManualText] = useState('');
  const [recapText, setRecapText] = useState('');
  const [sourceType, setSourceType] = useState<'file' | 'link'>('file');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [missionLogs, setMissionLogs] = useState<{ time: string; msg: string }[]>([]);

  const addMissionLog = useCallback((msg: string) => {
    // Filter out technical terms from logs
    let filteredMsg = msg
      .replace(/Gemini 3\.1 Pro/gi, "AI")
      .replace(/Gemini Recap/gi, "ဇာတ်လမ်းအကျဉ်းချုပ်")
      .replace(/Gemini/gi, "AI")
      .replace(/API Key/gi, "စနစ်သော့")
      .replace(/Pro/gi, "AI");

    // If it's a technical error message, simplify it
    if (filteredMsg.includes("RESOURCE_EXHAUSTED") || filteredMsg.includes("quota") || filteredMsg.includes("429")) {
      filteredMsg = "အမှား: စနစ်အသုံးပြုမှု ပမာဏ ပြည့်သွားပါပြီ။ ခဏစောင့်ပြီးမှ ပြန်ကြိုးစားပါ။";
    } else if (filteredMsg.includes("UNAVAILABLE") || filteredMsg.includes("high demand") || filteredMsg.includes("503")) {
      filteredMsg = "အမှား: စနစ် အလွန်အလုပ်များနေပါသည်။ ခဏစောင့်ပြီးမှ ပြန်ကြိုးစားပါ။";
    } else if (filteredMsg.includes("ApiError") || filteredMsg.includes("fetch") || filteredMsg.includes("network")) {
      filteredMsg = "အမှား: စနစ် ချိတ်ဆက်မှု မအောင်မြင်ပါ။";
    }

    const now = new Date();
    const time = `T+${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setMissionLogs(prev => [...prev, { time, msg: filteredMsg }].slice(-6));
  }, []);

  const StarChartAnimation = () => (
    <div className="fixed inset-0 z-[100] bg-brand-black/90 backdrop-blur-xl flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <div 
            key={i}
            className="absolute bg-white rounded-full animate-star-float"
            style={{
              width: Math.random() * 3 + 'px',
              height: Math.random() * 3 + 'px',
              left: Math.random() * 100 + '%',
              top: Math.random() * 100 + '%',
              animationDelay: Math.random() * 10 + 's',
              opacity: Math.random()
            }}
          />
        ))}
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-32 h-32 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin mb-8 shadow-[0_0_30px_rgba(139,92,246,0.5)]" />
        <h2 className="text-2xl font-bold text-white font-mono tracking-[0.2em] animate-pulse text-center px-4">ဗီဒီယိုကို စစ်ဆေးနေပါသည်...</h2>
        <p className="mt-4 text-brand-purple font-mono text-sm tracking-widest uppercase">Processing Data Star-Chart</p>
        <div className="mt-8 flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-2 h-2 bg-brand-purple rounded-full animate-bounce" style={{ animationDelay: i * 0.2 + 's' }} />
          ))}
        </div>
      </div>
    </div>
  );

  // Handle Anonymous Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        setIsAuthReady(true);
      } else {
        signInAnonymously(auth).then(() => {
          setIsAuthReady(true);
        }).catch((err) => {
          console.error("Failed to sign in anonymously (Silent Auth Fallback):", err);
          // Proceed anyway to allow UI testing
          setIsAuthReady(true);
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const isRoute = window.location.pathname === '/vbs-admin' || window.location.pathname === '/admin';
      
      // RBAC Redirect: If user is not ADMIN and tries to access admin route, redirect to home
      if (isRoute && userRole !== 'ADMIN') {
        window.location.href = '/';
        return;
      }
      
      setIsAdminRoute(isRoute);
    };
    
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [userRole]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Ensure session document exists for security rules
  useEffect(() => {
    if (isAccessGranted && isAuthReady && auth.currentUser && accessCode) {
      const syncSession = async () => {
        try {
          // If admin, ensure SAW-ADMIN-2026 exists first (bootstrap)
          if (isAdmin && accessCode === 'SAW-ADMIN-2026') {
            const adminDocRef = doc(db, 'users', 'SAW-ADMIN-2026');
            const adminDoc = await getDoc(adminDocRef);
            if (!adminDoc.exists()) {
              await setDoc(adminDocRef, {
                id: 'SAW-ADMIN-2026',
                label: 'Default Admin',
                isActive: true,
                role: 'admin',
                createdAt: new Date().toISOString()
              });
              console.log('Admin bootstrapped successfully');
            }
          }

          await setDoc(doc(db, 'sessions', auth.currentUser!.uid), {
            accessCode: accessCode,
            createdAt: new Date().toISOString()
          });
          setIsSessionSynced(true);
          console.log('Session synced for access code:', accessCode);
        } catch (e) {
          console.error('Failed to sync session:', e);
          setIsSessionSynced(false);
        }
      };
      syncSession();
    } else {
      setIsSessionSynced(false);
    }
  }, [isAccessGranted, isAuthReady, accessCode, isAdmin]);

  // Check for existing session
  useEffect(() => {
    const granted = localStorage.getItem('vbs_access_granted') === 'true';
    const code = localStorage.getItem('vbs_access_code');
    if (granted && code) {
      setIsAccessGranted(true);
      setAccessCode(code);
      
      // Fetch profile data directly from server for reliability without auth dependencies
      getDocFromServer(doc(db, 'users', code)).then(async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as AuthorizedUser;
          setProfile(data);
          
          // Sync API Key from Firestore to LocalStorage if missing locally
          if (data.api_key_stored && !localStorage.getItem('VLOGS_BY_SAW_API_KEY')) {
            localStorage.setItem('VLOGS_BY_SAW_API_KEY', data.api_key_stored);
            setLocalApiKey(data.api_key_stored);
          }
        } else {
          // If the code is no longer in users, log out
          if (code !== 'preview-user') {
            handleLogout();
          }
        }
      }).catch(err => {
        console.error('Failed to restore profile:', err);
      });
    }
  }, [isAuthReady]);

  // Listen for Global Settings
  useEffect(() => {
    // Load from localStorage first
    const savedSettings = localStorage.getItem('vbs_global_settings');
    if (savedSettings) {
      try {
        setGlobalSettings(JSON.parse(savedSettings));
        setIsConfigLoading(false);
      } catch (e) {
        console.error('Error parsing local global settings:', e);
      }
    }

    if (!isAccessGranted || !isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as GlobalSettings;
        setGlobalSettings(data);
        localStorage.setItem('vbs_global_settings', JSON.stringify(data));
        setIsConfigLoading(false);
      } else {
        setIsConfigLoading(false);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'settings/global');
      setIsConfigLoading(false);
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Listen for System Config from Firestore
  useEffect(() => {
    if (!isAuthReady) return;
    
    const unsubscribe = onSnapshot(doc(db, 'config', 'system_config'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemConfig;
        setSystemConfig(data);
        setSystemLive(data.system_live ?? true);
        console.log('System config synced from cloud');
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'config/system_config');
    });
    
    return () => unsubscribe();
  }, [isAuthReady]);

  // Listen for Global Rules
  useEffect(() => {
    // Load from localStorage first
    const savedRules = localStorage.getItem('vbs_global_rules');
    if (savedRules) {
      try {
        setGlobalRules(JSON.parse(savedRules));
      } catch (e) {
        console.error('Error parsing local global rules:', e);
      }
    }

    if (!isAccessGranted || !isAuthReady) {
      return;
    }
    
    const unsubscribe = onSnapshot(collection(db, 'globalRules'), (snapshot) => {
      const rules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PronunciationRule));
      setGlobalRules(rules);
      localStorage.setItem('vbs_global_rules', JSON.stringify(rules));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'globalRules');
    });
    return () => unsubscribe();
  }, [isAccessGranted, isAuthReady]);

  // Fetch History
  useEffect(() => {
    if (isAccessGranted && isAuthReady && accessCode && activeTab === 'history') {
      setIsHistoryLoading(true);
      const q = query(collection(db, 'history'), where('userId', '==', accessCode), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryItem));
        setHistory(items);
        setIsHistoryLoading(false);
      }, (err) => {
        console.error('Failed to load history (Silent Fallback):', err);
        setIsHistoryLoading(false);
      });
      return () => unsubscribe();
    }
  }, [isAccessGranted, isAuthReady, accessCode, activeTab]);

  // Seed default admin if collection is empty
  useEffect(() => {
    if (!isAuthReady || !auth.currentUser) return;
    const seedDefaultAdmin = async () => {
      try {
        console.log('Checking for default admin...');
        const adminDoc = await getDocFromServer(doc(db, 'users', 'SAW-ADMIN-2026'));
        if (!adminDoc.exists()) {
          console.log('Seeding default admin Access Code...');
          const defaultAdmin: AuthorizedUser = {
            id: 'SAW-ADMIN-2026',
            label: 'Default Admin',
            isActive: true,
            role: 'admin',
            createdAt: new Date().toISOString(),
            createdBy: 'system'
          };
          await setDoc(doc(db, 'users', defaultAdmin.id), defaultAdmin);
          console.log('Default admin seeded successfully.');
        }
      } catch (err) {
        console.error('Failed to seed default admin:', err);
      }
    };
    
    // Only seed if we are on the login screen or admin screen
    if (!isAccessGranted) {
      seedDefaultAdmin();
    }
  }, [isAccessGranted, isAuthReady, userId]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isVerifyingCode) return;
    
    const code = accessCodeInput.trim();
    const password = passwordInput.trim();
    
    if (!code) {
      setError('ဝင်ရောက်ရန် ကုဒ်ရိုက်ထည့်ပါ');
      return;
    }

    if (showPasswordStep && !password) {
      setError('စကားဝှက် ရိုက်ထည့်ပါ');
      return;
    }

    setIsVerifyingCode(true);
    setError(null);

    try {
      // Hardcoded RBAC Logic (Master Admin)
      const ADMIN_CODE = 'saw_vlogs_2026';
      const USER_CODE = 'saw_user_2026';

      let role: 'ADMIN' | 'USER' | null = null;

      // Step 1: Access Code Verification
      if (!showPasswordStep) {
        if (code === ADMIN_CODE) {
          role = 'ADMIN';
        } else if (code === USER_CODE) {
          role = 'USER';
        } else {
          // Check Firestore users collection
          try {
            const userDoc = await getDocFromServer(doc(db, 'users', code));
            if (userDoc.exists()) {
              const foundUser = userDoc.data() as AuthorizedUser;
              
              if (!foundUser.isActive) {
                setError('ဤ ID မှာ ပိတ်ထားခြင်း ခံထားရပါသည်။');
                setIsVerifyingCode(false);
                return;
              }
              
              // Check Expiry
              if (foundUser.expiryDate) {
                const expiry = new Date(foundUser.expiryDate);
                const now = new Date();
                if (now > expiry) {
                  setError('ဤ ID မှာ သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ Admin ကို ဆက်သွယ်ပါ။');
                  setIsVerifyingCode(false);
                  return;
                }
              }

              // If user has a password, go to password step
              if (foundUser.password) {
                setPendingUser(foundUser);
                setShowPasswordStep(true);
                setIsVerifyingCode(false);
                return;
              }

              // No password, just login
              role = foundUser.role.toUpperCase() as 'ADMIN' | 'USER';
            }
          } catch (e) {
            console.error('Error fetching user from Firestore:', e);
          }
        }
      } else {
        // Step 2: Password Verification
        if (pendingUser && pendingUser.password === password) {
          role = pendingUser.role.toUpperCase() as 'ADMIN' | 'USER';
        } else {
          setError('စကားဝှက် မှားယွင်းနေပါသည်။');
          setIsVerifyingCode(false);
          return;
        }
      }

      if (role) {
        setUserRole(role);
        setIsAdmin(role === 'ADMIN');
        setIsAccessGranted(true);
        setAccessCode(code);
        localStorage.setItem('vbs_role', role);
        localStorage.setItem('vbs_access_granted', 'true');
        localStorage.setItem('vbs_access_code', code);
        
        if (role === 'ADMIN') {
          setToast({ message: 'အက်ဒမင်အဖြစ် ဝင်ရောက်ပြီးပါပြီ', type: 'success' });
        } else {
          setActiveTab('youtube-transcript');
          setToast({ message: 'အသုံးပြုသူအဖြစ် ဝင်ရောက်ပြီးပါပြီ', type: 'success' });
        }
      } else {
        setError('မှားယွင်းသော ကုဒ်ဖြစ်ပါသည်။');
        return;
      }

      setTimeout(() => setToast(null), 2000);
    } catch (err: any) {
      console.error('Access Code Verification Error:', err);
      setError(`ဝင်ရောက်မှု မအောင်မြင်ပါ: ${err.message || 'အမည်မသိ အမှားအယွင်း'}`);
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAccessGranted(false);
    setAccessCode(null);
    setIsAdmin(false);
    setUserRole(null);
    setAccessCodeInput('');
    setPasswordInput('');
    setShowPasswordStep(false);
    setPendingUser(null);
    localStorage.removeItem('vbs_access_granted');
    localStorage.removeItem('vbs_access_code');
    localStorage.removeItem('vbs_role');
    localStorage.removeItem('is_admin_auth');
    // We do NOT remove the API Key on logout as per safety requirements
    setLocalApiKey(null);
    setActiveTab('generate');
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPasswordInput === 'saw_vlogs_2026') {
      setIsAdmin(true);
      setAccessCode('SAW-ADMIN-2026');
      localStorage.setItem('is_admin_auth', 'true');
      localStorage.setItem('vbs_access_code', 'SAW-ADMIN-2026');
      localStorage.setItem('vbs_access_granted', 'true');
      setIsAdminModalOpen(false);
      setAdminPasswordInput('');
      setToast({ message: "Welcome, Saw!", type: 'success' });
      setTimeout(() => setToast(null), 2000);
    } else {
      setToast({ message: "စကားဝှက် မှားယွင်းနေပါသည်။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
    }
  };

  const handleFetchTranscript = async () => {
    const url = youtubeTranscriptUrl.trim();
    if (!url) return;
    
    addMissionLog(`YOUTUBE URL လက်ခံရရှိပါသည်: ${url.substring(0, 30)}...`);
    
    // Check for Admin API Keys if in Admin mode
    if (apiSwitch === 'admin' && !systemConfig?.rapidapi_key) {
      setToast({ message: "စနစ်စီမံခန့်ခွဲသူမှ RapidAPI Key ထည့်သွင်းထားခြင်း မရှိပါ။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
      addMissionLog("အမှား: စနစ်ပြင်ဆင်မှု လိုအပ်နေပါသည်။");
      return;
    }
    
    setIsFetchingTranscript(true);
    setIsVideoProcessing(true); // Trigger Star-Chart animation
    setError(null);
    setRawTranscript('');
    
    const extractVideoId = (url: string) => {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
      const match = url.match(regex);
      return match ? match[1] : null;
    };

    const videoId = extractVideoId(url);
    if (!videoId) {
      setToast({ message: "YouTube URL မှားယွင်းနေပါသည်။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
      addMissionLog("အမှား: မှားယွင်းသော YOUTUBE URL ဖြစ်နေပါသည်။");
      setIsFetchingTranscript(false);
      return;
    }

    const isShorts = url.includes('/shorts/');
    if (isShorts) {
      addMissionLog("Shorts ဗီဒီယိုကို စစ်ဆေးနေပါသည်...");
    }

    const fetchViaRapidAPI = async () => {
      const rapidKey = localStorage.getItem('rapidapi_key') || systemConfig?.rapidapi_key;
      if (!rapidKey) throw new Error("RapidAPI Key missing");
      
      addMissionLog("စာသားများ ထုတ်ယူနေပါသည်...");
      const response = await fetch(`https://youtube-video-subtitles-list.p.rapidapi.com/get_subtitles?video_id=${videoId}&locale=en`, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': rapidKey,
          'x-rapidapi-host': 'youtube-video-subtitles-list.p.rapidapi.com'
        }
      });
      
      const data = await response.json();
      
      if (data && typeof data === 'object' && data.message === "Transcript not available") {
        throw new Error("ဤ Video တွင် Transcript ပိတ်ထားပါသဖြင့် Video File Upload စနစ်ကို အသုံးပြုပေးပါ။");
      }

      if (!response.ok) throw new Error(`RapidAPI Error: ${response.statusText}`);
      
      // Assuming the API returns an array of subtitle objects with 'text' property
      if (data && Array.isArray(data)) {
        addMissionLog("စာသားများ ထုတ်ယူမှု အောင်မြင်ပါသည်။");
        return data.map((t: any) => t.text).join(' ');
      }
      throw new Error("Invalid response from RapidAPI");
    };

    const fetchViaServer = async () => {
      const response = await fetch(`/api/youtube-transcript?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      if (!response.ok || !data.transcript) throw new Error(data.error || "Server fetch failed");
      return data.transcript.map((t: any) => t.text).join(' ');
    };

    const fetchViaClientProxy = async () => {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      // Try multiple proxies
      const proxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(watchUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(watchUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(watchUrl)}`,
        `https://proxy.cors.sh/${watchUrl}`
      ];

      let html = '';
      for (const proxyUrl of proxies) {
        try {
          console.log(`App: Trying client proxy ${proxyUrl.split('?')[0]}...`);
          const response = await fetch(proxyUrl);
          if (response.ok) {
            if (proxyUrl.includes('allorigins')) {
              const data = await response.json();
              html = data.contents;
            } else {
              html = await response.text();
            }
            
            if (html && html.includes('ytInitialPlayerResponse')) {
              console.log(`App: Client proxy ${proxyUrl.split('?')[0]} successful`);
              break;
            } else {
              html = ''; // Reset if bot detected
            }
          }
        } catch (e) {
          console.warn(`App: Client proxy ${proxyUrl.split('?')[0]} failed`);
        }
      }

      if (!html) throw new Error("Could not fetch YouTube page via any proxy. This video may be restricted or unavailable.");
      
      const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/s;
      const match = html.match(regex);
      if (!match) throw new Error("Could not find player response in HTML. YouTube might have changed their page structure.");
      
      const playerResponse = JSON.parse(match[1]);
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      if (!tracks || tracks.length === 0) {
        // Check if captions are disabled
        if (playerResponse?.captions) {
          throw new Error("Transcript ပိတ်ထားပါသဖြင့် အလိုအလျောက် ဖတ်၍မရပါ။");
        }
        throw new Error("No caption tracks found for this video.");
      }
      
      const track = tracks.find((t: any) => t.languageCode === 'en') || 
                    tracks.find((t: any) => t.languageCode === 'en-US') ||
                    tracks.find((t: any) => t.languageCode.startsWith('en')) ||
                    tracks[0];
      
      // Fetch transcript XML via proxy
      let xml = '';
      for (const proxyUrl of proxies) {
        try {
          let targetUrl = '';
          if (proxyUrl.includes('allorigins')) {
            targetUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(track.baseUrl)}`;
          } else if (proxyUrl.includes('corsproxy.io')) {
            targetUrl = `https://corsproxy.io/?${encodeURIComponent(track.baseUrl)}`;
          } else if (proxyUrl.includes('codetabs')) {
            targetUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(track.baseUrl)}`;
          } else {
            targetUrl = `https://proxy.cors.sh/${track.baseUrl}`;
          }

          const transcriptRes = await fetch(targetUrl);
          if (transcriptRes.ok) {
            if (proxyUrl.includes('allorigins')) {
              const transcriptData = await transcriptRes.json();
              xml = transcriptData.contents;
            } else {
              xml = await transcriptRes.text();
            }
            if (xml && xml.includes('<text')) break;
          }
        } catch (e) {
          console.warn(`Client transcript proxy failed:`, e);
        }
      }

      if (!xml) throw new Error("Failed to fetch transcript XML via any proxy");
      
      const textRegex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
      let fullText = "";
      let m;
      while ((m = textRegex.exec(xml)) !== null) {
        fullText += m[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ') + " ";
      }
      if (!fullText) throw new Error("Transcript is empty");
      return fullText.trim();
    };

    const rapidKey = localStorage.getItem('rapidapi_key') || systemConfig?.rapidapi_key;
    if (apiSwitch === 'admin' && rapidKey) {
      addMissionLog("အချက်အလက်များ ထုတ်ယူရန် ကြိုးစားနေပါသည်...");
      try {
        const text = await fetchViaRapidAPI();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
        setIsFetchingTranscript(false);
        setIsVideoProcessing(false);
        addMissionLog("အချက်အလက်များ ထုတ်ယူမှု အောင်မြင်ပါသည်။");
        return;
      } catch (rapidErr) {
        console.warn("RapidAPI fetch failed, trying fallbacks...", rapidErr);
        if (isShorts) {
          addMissionLog("Shorts ဗီဒီယိုကို စစ်ဆေးနေပါသည်...");
          try {
            const apiKey = getEffectiveApiKey();
            // Call server-side endpoint to bypass region restrictions and handle key more robustly
            const response = await fetch('/api/gemini/analyze-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                url,
                apiKey // Pass if available, server will use its own if not
              })
            });

            if (!response.ok) {
              const errData = await response.json();
              const errorMsg = errData.error || "Failed to analyze URL via server";
              
              if (errorMsg.includes("API key not valid") || errorMsg.includes("API_KEY_INVALID")) {
                throw new Error("Gemini API Key မမှန်ကန်ပါ။ Admin Dashboard တွင် API Key ကို ပြန်လည်စစ်ဆေးပေးပါ။ (Invalid Gemini API Key. Please check your settings.)");
              }
              
              throw new Error(errorMsg);
            }

            const data = await response.json();
            const summary = data.text || "Failed to generate summary from video.";
            setRawTranscript(summary);
            addMissionLog("ဗီဒီယို စစ်ဆေးမှု အောင်မြင်ပါသည်။");
            setIsFetchingTranscript(false);
            setIsVideoProcessing(false);
            return;
          } catch (visionErr) {
            console.error("Gemini Vision Error:", visionErr);
            addMissionLog("ဗီဒီယို စစ်ဆေးမှု မအောင်မြင်ပါ။ အခြားနည်းလမ်းဖြင့် ကြိုးစားနေပါသည်...");
          }
        } else {
          addMissionLog("အခြားနည်းလမ်းဖြင့် ကြိုးစားနေပါသည်...");
        }
      }
    }

    try {
      // Try server next
      try {
        const text = await fetchViaServer();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
      } catch (serverErr) {
        console.warn("Server fetch failed, trying client proxy...", serverErr);
        const text = await fetchViaClientProxy();
        setRawTranscript(text);
        setRetryCount(0);
        setShowManualInput(false);
      }
    } catch (err: any) {
      console.error("YouTube Transcript Error:", err);
      const newRetryCount = retryCount + 1;
      setRetryCount(newRetryCount);
      
      if (err.message.includes("Transcript ပိတ်ထားပါသဖြင့်")) {
        setError(err.message);
        setShowManualInput(true);
      } else if (newRetryCount >= 3) {
        setShowManualInput(true);
        setError("အလိုအလျောက် ဖတ်၍မရပါ။ ကျေးဇူးပြု၍ youtube-transcript.io ကဲ့သို့ site များမှ စာသားကို Copy ကူးပြီး ဤနေရာတွင် Paste လုပ်ပေးပါ။");
      } else {
        setError(`YouTube က Transcript ထုတ်ပေးဖို့ ငြင်းဆိုထားပါသည် (Retry ${newRetryCount}/3).`);
      }
    } finally {
      setIsFetchingTranscript(false);
      setIsVideoProcessing(false);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedExtensions = ['.mp4', '.mkv', '.mov'];
      const fileName = file.name.toLowerCase();
      const isAllowedExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
      const allowedMimeTypes = ['video/mp4', 'video/x-matroska', 'video/quicktime'];
      
      if (!allowedMimeTypes.includes(file.type) && !isAllowedExtension) {
        setToast({ 
          message: "ဗီဒီယိုဖိုင်အမျိုးအစား မမှန်ကန်ပါ။ ကျေးဇူးပြု၍ .mp4, .mkv သို့မဟုတ် .mov ဖိုင်များကိုသာ အသုံးပြုပါ။", 
          type: 'error' 
        });
        setTimeout(() => setToast(null), 2000);
        // Clear the input value so the user can try again with the same file if they want
        e.target.value = '';
        return;
      }

      // Check file size (500MB limit)
      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        setToast({ 
          message: "ဖိုင်အရွယ်အစား ကြီးမားလွန်းပါသည်။ ကျေးဇူးပြု၍ 500MB ထက်နည်းသော ဖိုင်ကိုသာ အသုံးပြုပါ။", 
          type: 'error' 
        });
        setTimeout(() => setToast(null), 2000);
        e.target.value = '';
        return;
      }
      
      setVideoFile(file);
      addMissionLog(`ဗီဒီယိုဖိုင် လက်ခံရရှိပါသည်: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    }
  };

  const processVideoFile = async () => {
    if (!videoFile) return;
    
    // Check for Gemini API Key
    const apiKey = systemConfig?.gemini_api_key;
    if (!apiKey) {
      setToast({ message: "စနစ်စီမံခန့်ခွဲသူမှ Gemini API Key ထည့်သွင်းထားခြင်း မရှိပါ။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
      addMissionLog("အမှား: စနစ်ပြင်ဆင်မှု လိုအပ်နေပါသည်။");
      return;
    }

    setIsVideoProcessing(true);
    setError(null);
    setRawTranscript('');
    addMissionLog("ဗီဒီယိုကို စစ်ဆေးနေပါသည်...");

    // Check file size (Cloud Run limit is ~32MB, base64 adds ~33% overhead)
    // We'll limit to 20MB to be safe.
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (videoFile.size > MAX_FILE_SIZE) {
      const errorMsg = `ဗီဒီယိုဖိုင် ၂၀ မီဂါဘိုက်ထက် ကြီးနေပါသည်။ ကျေးဇူးပြု၍ ချုံ့ပေးပါ။`;
      setError(errorMsg);
      addMissionLog(`အမှား: ${errorMsg}`);
      setIsVideoProcessing(false);
      return;
    }

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          if (!result) {
            reject(new Error("ဗီဒီယိုဖိုင် ဖတ်၍မရပါ။ (Failed to read video file)."));
            return;
          }
          const parts = result.split(',');
          if (parts.length > 1) {
            resolve(parts[1]);
          } else {
            reject(new Error("ဗီဒီယိုဒေတာ ထုတ်ယူ၍မရပါ။ (Failed to extract base64 from file)."));
          }
        };
        reader.onerror = () => reject(new Error("ဖိုင်ဖတ်ရာတွင် အမှားရှိနေပါသည်။ (File reader error)."));
        reader.readAsDataURL(videoFile);
      });

      // Basic validation of base64 string
      if (!base64 || base64.length < 10) {
        throw new Error('ဗီဒီယိုဒေတာ မှားယွင်းနေပါသည်။ (Invalid video data).');
      }

      console.log('Video Analysis Start:', { mimeType: videoFile.type, base64Length: base64.length });

      const fetchWithRetry = async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
        const res = await fetch(url, options);
        const contentType = res.headers.get("content-type");
        
        if (contentType && contentType.includes("text/html") && retries > 0) {
          console.warn(`Received HTML response from ${url}, server might be restarting. Retrying in 3s... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          return fetchWithRetry(url, options, retries - 1);
        }
        return res;
      };

      const response = await fetchWithRetry("/api/gemini/video-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoBase64: base64,
          mimeType: videoFile.type || 'video/mp4',
          prompt: "Please provide a detailed transcript or a very thorough summary of what is being said and happening in this video. If there is speech, transcribe it accurately. If there is no speech, describe the visual events in detail. Output the result in English. Focus on capturing all spoken dialogue for script generation.",
          apiKey: apiKey,
          style: recapStyle
        })
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textError = await response.text();
        console.error("Server returned non-JSON response:", textError);
        if (textError.includes("Please wait while your application starts")) {
          throw new Error("စနစ် စတင်နေဆဲဖြစ်ပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Server is still starting up. Please try again in a few seconds).");
        }
        throw new Error("Server error: Received non-JSON response. The server might be down or returning an HTML error page.");
      }

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Server-side video analysis failed");
      }

      const resultData = await response.json();
      if (resultData && resultData.transcript) {
        setRawTranscript(resultData.transcript);
        setVideoAnalysis(resultData);
        if (resultData.recap) {
          setRecapText(resultData.recap);
          addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်ယူပြီးပါပြီ။");
        }
        setToast({ message: "ဗီဒီယို စစ်ဆေးမှု အောင်မြင်ပါသည်။", type: 'success' });
        setTimeout(() => setToast(null), 2000);
      } else {
        throw new Error("Gemini returned an empty or invalid response.");
      }
    } catch (err: any) {
      console.error("Video Processing Error:", err);
      setError(`ဗီဒီယို စစ်ဆေးရန် မအောင်မြင်ပါ - ${err.message}`);
      addMissionLog(`အမှား: ဗီဒီယို စစ်ဆေးမှု မအောင်မြင်ပါ - ${err.message}`);
      setToast({ message: "စစ်ဆေးမှု မအောင်မြင်ပါ။ မှတ်တမ်းတွင် ကြည့်ရှုပါ။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
    } finally {
      setIsVideoProcessing(false);
    }
  };

  const handleYoutubeUrlProcess = async () => {
    if (!youtubeUrl.trim()) return;
    
    // 1. URL PARSING
    const extractVideoId = (url: string) => {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
      const match = url.match(regex);
      return match ? match[1] : null;
    };

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setToast({ message: "မှားယွင်းသော YouTube Link ဖြစ်နေပါသည်။ ကျေးဇူးပြု၍ Shorts, Standard သို့မဟုတ် Shortened URL ကို အသုံးပြုပါ။", type: 'error' });
      setTimeout(() => setToast(null), 3000);
      addMissionLog("အမှား: မှားယွင်းသော YouTube Link ဖြစ်နေပါသည်။");
      return;
    }

    const apiKey = systemConfig?.gemini_api_key;
    if (!apiKey) {
      setToast({ message: "စနစ်စီမံခန့်ခွဲသူမှ Gemini API Key ထည့်သွင်းထားခြင်း မရှိပါ။", type: 'error' });
      setTimeout(() => setToast(null), 2000);
      addMissionLog("အမှား: စနစ်ပြင်ဆင်မှု လိုအပ်နေပါသည်။");
      return;
    }

    setIsVideoProcessing(true);
    setError(null);
    setRawTranscript('');
    setRecapText('');
    addMissionLog("YouTube ဗီဒီယိုကို စစ်ဆေးနေပါသည်...");

    try {
      // Use normalized URL for better backend processing
      const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      const response = await fetch("/api/gemini/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: normalizedUrl,
          apiKey: apiKey,
          prompt: `Analyze this YouTube video deeply. 
          1. Create a detailed summary (RECAP) in natural, flowing Burmese script. 
          2. Focus on the main story points and emotions.
          3. Use a tone that matches the style: ${recapStyle}.
          4. Also provide a full transcript in English if possible.
          
          Return the result in this JSON format:
          {
            "recap": "မြန်မာလို ဇာတ်လမ်းအကျဉ်းချုပ်...",
            "transcript": "Full English transcript..."
          }`
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "YouTube analysis failed");
      }

      const resultData = await response.json();
      let text = resultData.text;
      
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.recap) {
            setRecapText(parsed.recap);
            setRawTranscript(parsed.transcript || "");
            addMissionLog("YouTube ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်ယူပြီးပါပြီ။");
            handleGenerate(parsed.recap);
          } else {
            setRecapText(text);
            addMissionLog("YouTube ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်ယူပြီးပါပြီ။");
            handleGenerate(text);
          }
        } else {
          setRecapText(text);
          addMissionLog("YouTube ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်ယူပြီးပါပြီ။");
          handleGenerate(text);
        }
      } catch (e) {
        setRecapText(text);
        addMissionLog("YouTube ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်ယူပြီးပါပြီ။");
        handleGenerate(text);
      }

    } catch (err: any) {
      console.error("YouTube URL Process Error:", err);
      setError(err.message || "YouTube စစ်ဆေးမှု မအောင်မြင်ပါ။");
      addMissionLog(`အမှား: ${err.message || "YouTube စစ်ဆေးမှု မအောင်မြင်ပါ။"}`);
    } finally {
      setIsVideoProcessing(false);
    }
  };

  const handleYoutubeRecap = async (providedText?: string) => {
    // Priority: 1. providedText (from transcript tab), 2. recapManualText (from recap tab)
    const textToSummarize = typeof providedText === 'string' ? providedText : recapManualText.trim();
    
    if (!textToSummarize) return;

    addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှုကို စတင်နေပါသည်...");

    // Check for Admin API Keys if in Admin mode
    if (apiSwitch === 'admin' && (!systemConfig?.rapidapi_key || !systemConfig?.gemini_api_key || !systemConfig?.openai_api_key)) {
      setError("စနစ်စီမံခန့်ခွဲသူမှ API Keys များ ထည့်သွင်းထားခြင်း မရှိပါ။");
      addMissionLog("အမှား: စနစ်ပြင်ဆင်မှု လိုအပ်နေပါသည်။");
      return;
    }
    
    setIsProcessingYoutube(true);
    setError(null);
    setText('');
    setResult(null);
    
      const fetchWithRetry = async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
        const res = await fetch(url, options);
        const contentType = res.headers.get("content-type");
        
        if (contentType && contentType.includes("text/html") && retries > 0) {
          console.warn(`Received HTML response from ${url}, server might be restarting. Retrying in 3s... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          return fetchWithRetry(url, options, retries - 1);
        }
        return res;
      };

      try {
        const fullText = textToSummarize;
        
        addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးနေပါသည်...");
        
        const response = await fetchWithRetry('/api/gemini/recap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            transcript: fullText,
            apiKey: getEffectiveApiKey()
          })
        });

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const textError = await response.text();
          if (textError.includes("Please wait while your application starts")) {
            throw new Error("စနစ် စတင်နေဆဲဖြစ်ပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Server is still starting up. Please try again in a few seconds).");
          }
          throw new Error("Server error: Received non-JSON response. The server might be down or returning an HTML error page.");
        }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate recap");
      }

      const data = await response.json();
      const summary = data.recap; // Updated to use 'recap' from server response
      
      if (summary) {
        addMissionLog("ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှု အောင်မြင်ပါသည်။");
        setText(summary);
        setActiveTab('generate');
        handleGenerate(summary);
      }
    } catch (err: any) {
      console.error("YouTube Recap Error:", err);
      addMissionLog(`အမှား: ${err.message || "ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှု မအောင်မြင်ပါ။"}`);
      setError(err.message || "ဇာတ်လမ်းအကျဉ်းချုပ် ဖန်တီးမှု မအောင်မြင်ပါ။");
    } finally {
      setIsProcessingYoutube(false);
    }
  };

  const handleTranslate = async (textToTranslate: string, lang: 'Burmese' | 'Hindi') => {
    if (!textToTranslate) return;
    setIsTranslating(true);
    setError(null);
    addMissionLog(`${lang} ဘာသာသို့ ပြန်ဆိုနေပါသည်...`);

    const fetchWithRetry = async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
      const res = await fetch(url, options);
      const contentType = res.headers.get("content-type");
      
      if (contentType && contentType.includes("text/html") && retries > 0) {
        console.warn(`Received HTML response from ${url}, server might be restarting. Retrying in 3s... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        return fetchWithRetry(url, options, retries - 1);
      }
      return res;
    };

    try {
      const response = await fetchWithRetry('/api/gemini/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToTranslate,
          targetLanguage: lang,
          apiKey: getEffectiveApiKey()
        })
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textError = await response.text();
        if (textError.includes("Please wait while your application starts")) {
          throw new Error("စနစ် စတင်နေဆဲဖြစ်ပါသည်။ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ။ (Server is still starting up. Please try again in a few seconds).");
        }
        throw new Error("Server error: Received non-JSON response. The server might be down or returning an HTML error page.");
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Translation failed');

      setTranslatedText(data.translatedText);
      addMissionLog(`ဘာသာပြန်ဆိုမှု အောင်မြင်ပါသည်။`);
      setToast({ message: "ဘာသာပြန်ဆိုမှု အောင်မြင်ပါသည်။", type: 'success' });
    } catch (err: any) {
      setError(err.message);
      addMissionLog(`ဘာသာပြန်ဆိုမှု အမှား: ${err.message}`);
      setToast({ message: err.message, type: 'error' });
    } finally {
      setIsTranslating(false);
    }
  };

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const search = historySearch.toLowerCase();
    return history.filter(item => 
      item.text.toLowerCase().includes(search) || 
      item.config.voiceId.toLowerCase().includes(search)
    );
  }, [history, historySearch]);

  const handleClearApiKey = () => {
    localStorage.removeItem('VLOGS_BY_SAW_API_KEY');
    localStorage.removeItem('VBS_API_SWITCH');
    setLocalApiKey(null);
    setApiSwitch('admin');
    setToast({ message: 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ Website ကို ပြန်ဖွင့်ပါမည်။ (Settings saved. Reloading page...)', type: 'success' });
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  const maskApiKey = (key: string | undefined) => {
    if (!key) return 'Not Set';
    if (showApiKey) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const getEffectiveApiKey = useCallback(() => {
    // If Admin Key is selected, use the Global System Key
    if (apiSwitch === 'admin') {
      // Priority 1: systemConfig from Admin Dashboard
      if (systemConfig?.gemini_api_key) {
        console.log("App: Using Gemini API Key from System Config (Admin Mode)");
        return systemConfig.gemini_api_key.trim();
      }
      // Priority 2: globalSettings (Legacy fallback)
      if (globalSettings.allow_global_key && globalSettings.global_system_key) {
        console.log("App: Using Global System API Key (Legacy Admin Mode)");
        return globalSettings.global_system_key.trim();
      }
      console.warn("App: Admin Mode selected but no Admin API Key configured");
      return null;
    }

    // If Personal Key is selected, use the key from Local Storage
    const storedKey = localStorage.getItem('VLOGS_BY_SAW_API_KEY');
    if (storedKey) {
      console.log("App: Using API Key from LocalStorage (Personal Mode)");
      return storedKey.trim();
    }

    if (profile?.api_key_stored) {
      console.log("App: Using API Key from Firestore Profile (Personal Mode Fallback)");
      return profile.api_key_stored.trim();
    }
    
    // Ultimate Fallback to Environment Variable
    if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
      console.log("App: Using Environment Variable API Key");
      return process.env.GEMINI_API_KEY.trim();
    }
    
    console.warn("App: No effective API Key found");
    return null;
  }, [profile, globalSettings, apiSwitch]);

  const handleUpdateGlobalSettings = async (updates: Partial<GlobalSettings>) => {
    try {
      await updateDoc(doc(db, 'settings', 'global'), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/global');
    }
  };

  const handleSaveApiKeyFromModal = async (key: string, selectedSwitch: 'admin' | 'personal') => {
    const trimmedKey = key.trim();
    setIsUpdatingKey(true);
    try {
      // 1. Save switch preference
      localStorage.setItem('VBS_API_SWITCH', selectedSwitch);
      setApiSwitch(selectedSwitch);

      // 2. Save personal key if provided
      if (selectedSwitch === 'personal' && trimmedKey) {
        localStorage.setItem('VLOGS_BY_SAW_API_KEY', trimmedKey);
        setLocalApiKey(trimmedKey);
      }
      
      setToast({ message: 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ Website ကို ပြန်ဖွင့်ပါမည်။ (Settings saved. Reloading page...)', type: 'success' });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      console.error('Save API Key Error:', err);
      setToast({ message: 'Failed to save API Key', type: 'error' });
      setTimeout(() => setToast(null), 2000);
    } finally {
      setIsUpdatingKey(false);
    }
  };

  const handleAddGlobalRule = async () => {
    const original = prompt('Enter original text:');
    const replacement = prompt('Enter replacement text:');
    if (original && replacement) {
      try {
        await addDoc(collection(db, 'globalRules'), {
          original,
          replacement,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'globalRules');
      }
    }
  };

  const handleDeleteGlobalRule = async (id: string) => {
    if (window.confirm('ဤစည်းမျဉ်းကို ဖျက်လိုပါသလား? (Delete this rule?)')) {
      try {
        await deleteDoc(doc(db, 'globalRules', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `globalRules/${id}`);
      }
    }
  };

  const handleUpdateGlobalRule = async (id: string, updates: Partial<PronunciationRule>) => {
    try {
      await updateDoc(doc(db, 'globalRules', id), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `globalRules/${id}`);
    }
  };

  const handleGenerate = async (textOverride?: string) => {
    console.log("App: Generate Voice Button Clicked");
    
    const textToProcess = textOverride || text;

    if (!textToProcess.trim()) {
      setError('ကျေးဇူးပြု၍ အသံပြောင်းရန် စာသားအချို့ ရိုက်ထည့်ပါ။ (Please enter some text to generate voiceover.)');
      return;
    }

    // Use the effective API key based on the switch setting
    const effectiveKey = getEffectiveApiKey();
    
    if (apiSwitch === 'admin' && (!systemConfig?.rapidapi_key || !systemConfig?.gemini_api_key || !systemConfig?.openai_api_key)) {
      setError("စနစ် ပြင်ဆင်မှု လိုအပ်နေပါသည်။ (System maintenance: API Keys not configured by Admin.)");
      return;
    }
    
    if (!effectiveKey) {
      console.warn("App: Generation blocked - No effective API Key found. Opening settings modal.");
      if (apiSwitch === 'personal') {
        setToast({ message: 'ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။', type: 'error' });
        setTimeout(() => setToast(null), 2000);
      } else {
        setToast({ message: 'Admin Key မရှိသေးပါ။ ကျေးဇူးပြု၍ ခဏစောင့်ပါ သို့မဟုတ် ကိုယ်ပိုင် Key သုံးပါ။', type: 'error' });
        setTimeout(() => setToast(null), 2000);
      }
      setIsApiKeyModalOpen(true);
      setError('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResult(null);

    console.log("App: Starting voiceover generation process with key...");

    try {
      const isMock = systemConfig?.mock_mode || false;
      const ttsService = new GeminiTTSService(effectiveKey || '');
      
      console.log("App: Applying pronunciation rules...");
      // Apply pronunciation rules sequentially: Default -> Global Admin -> User Custom
      let processedText = textToProcess;
      
      // 1. Default Rules
      DEFAULT_RULES.forEach(rule => {
        const regex = new RegExp(rule.original, 'gi');
        processedText = processedText.replace(regex, rule.replacement);
      });

      // 2. Global Admin Rules
      globalRules.forEach(rule => {
        const regex = new RegExp(rule.original, 'gi');
        processedText = processedText.replace(regex, rule.replacement);
      });
      
      // 3. User Custom Rules
      customRules.split('\n').forEach((line) => {
        const parts = line.split('->').map(p => p.trim());
        if (parts.length === 2) {
          const regex = new RegExp(parts[0], 'gi');
          processedText = processedText.replace(regex, parts[1]);
        }
      });

      console.log("App: Text processed, calling TTS service...");
      const audioResult = await ttsService.generateTTS(processedText, config, isMock);
      
      if (audioResult.isSimulation) {
        console.warn("App: Received simulation result (fallback triggered)");
        setError("မှတ်ချက်: စနစ် ချိတ်ဆက်မှု နှေးကွေးနေသဖြင့် စမ်းသပ်မှု ရလဒ်ကိုသာ ပြသပေးထားပါသည်။");
      } else {
        console.log("App: TTS generation successful, updating state...");
      }
      
      setResult(audioResult);

      // Save to History (Asynchronous if enabled)
      if (saveToHistory && accessCode && !audioResult.isSimulation) {
        console.log("App: Saving to history (Asynchronous)...");
        // We don't await this to ensure immediate result display
        const saveHistory = async () => {
          try {
            // 1. Upload Audio to Storage
            const audioFileName = `audio/${accessCode}/${Date.now()}.wav`;
            const audioRef = ref(storage, audioFileName);
            await uploadString(audioRef, audioResult.audioData, 'base64');
            const audioStorageUrl = await getDownloadURL(audioRef);

            // 2. Upload SRT to Storage
            const srtFileName = `srt/${accessCode}/${Date.now()}.srt`;
            const srtRef = ref(storage, srtFileName);
            await uploadString(srtRef, audioResult.srtContent);
            const srtStorageUrl = await getDownloadURL(srtRef);

            // 3. Save to Firestore
            await addDoc(collection(db, 'history'), {
              userId: accessCode,
              text: textToProcess.length > 1000 ? textToProcess.substring(0, 1000) + '...' : textToProcess,
              audioStorageUrl: audioStorageUrl,
              srtStorageUrl: srtStorageUrl,
              createdAt: new Date().toISOString(),
              config: config
            });
            
            // Update total generations
            await updateDoc(doc(db, 'settings', 'global'), {
              total_generations: (globalSettings.total_generations || 0) + 1
            });
            console.log("App: History saved successfully in background");
          } catch (storageErr) {
            console.error('Error saving to history in background:', storageErr);
          }
        };
        
        saveHistory();
      }
    } catch (err: any) {
      console.error("App: Generation failed with error:", err);
      setError(err.message || 'အမည်မသိ အမှားတစ်ခု ဖြစ်ပွားခဲ့ပါသည်။');
    } finally {
      console.log("App: Generation process finished (Cleaning up loading state)");
      setIsLoading(false);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    if (window.confirm('ဤမှတ်တမ်းကို ဖျက်လိုပါသလား? (Delete this history record?)')) {
      try {
        await deleteDoc(doc(db, 'history', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `history/${id}`);
      }
    }
  };

  const handleDownloadAudio = async (dataOrUrl: string, filename: string) => {
    try {
      let base64Data = dataOrUrl;
      if (dataOrUrl.startsWith('http')) {
        const response = await fetch(dataOrUrl);
        const blob = await response.blob();
        base64Data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result?.split(',')[1];
            resolve(base64 || '');
          };
          reader.readAsDataURL(blob);
        });
      }

      if (!base64Data || typeof base64Data !== 'string') {
        throw new Error("Invalid audio data for download");
      }

      // Clean up the base64 string (remove whitespace/newlines and potential data URL prefix)
      const cleanBase64 = base64Data.replace(/^data:audio\/[^;]+;base64,/, '').replace(/\s/g, '');
      
      let binaryString;
      try {
        binaryString = window.atob(cleanBase64);
      } catch (e) {
        throw new Error("Failed to decode base64 data for download. The string might be malformed.");
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Download error:', error);
      setToast({
        message: `အသံဖိုင် ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားရှိနေပါသည်။ (${error.message})`,
        type: 'error'
      });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleDownloadSRT = async (contentOrUrl: string, filename: string) => {
    let content = contentOrUrl;
    if (contentOrUrl.startsWith('http')) {
      const response = await fetch(contentOrUrl);
      content = await response.text();
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playFromHistory = async (item: HistoryItem) => {
    try {
      let audioData = '';
      let srtContent = item.srtContent || '';

      // If we have storage URLs, fetch the data
      if (item.audioStorageUrl) {
        const response = await fetch(item.audioStorageUrl);
        const blob = await response.blob();
        // Convert blob to base64 for AudioResult
        audioData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result?.split(',')[1];
            resolve(base64 || '');
          };
          reader.readAsDataURL(blob);
        });
      }

      if (item.srtStorageUrl && !srtContent) {
        const response = await fetch(item.srtStorageUrl);
        srtContent = await response.text();
      }

      if (!audioData || typeof audioData !== 'string') {
        throw new Error("Invalid audio data from history");
      }

      // Clean up the base64 string (remove whitespace/newlines and potential data URL prefix)
      const cleanBase64 = audioData.replace(/^data:audio\/[^;]+;base64,/, '').replace(/\s/g, '');
      
      let binaryString;
      try {
        binaryString = window.atob(cleanBase64);
      } catch (e) {
        throw new Error("Failed to decode base64 audio from history. The string might be malformed.");
      }

      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const wavBlob = pcmToWav(bytes, 24000);
      const url = URL.createObjectURL(wavBlob);
      
      setResult({
        audioUrl: url,
        audioData: audioData,
        srtContent: srtContent,
        subtitles: GeminiTTSService.parseSRT(srtContent)
      });
      setActiveTab('generate');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Error playing from history:', err);
      setError(`မှတ်တမ်းမှ အသံဖိုင် ဖွင့်၍မရပါ - ${err.message}`);
      setToast({ message: 'မှတ်တမ်းမှ အသံဖိုင် ဖွင့်၍မရပါ။', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleBackToApp = () => {
    if (isAdminRoute) {
      window.location.href = '/';
    } else {
      setActiveTab(isAdmin ? 'generate' : 'youtube-transcript');
    }
  };

  return (
    <div className="min-h-screen bg-brand-black text-slate-300 font-sans selection:bg-brand-violet/30 selection:text-brand-violet relative overflow-hidden">
      {/* Cinematic Background Elements */}
      <div className="fixed inset-0 grid-bg pointer-events-none opacity-20" />
      <div className="fixed inset-0 scanline pointer-events-none" />
      
      <div className="relative z-10">
        <Header 
          isDarkMode={isDarkMode} 
          toggleTheme={() => setIsDarkMode(!isDarkMode)} 
          onOpenTools={() => setIsApiKeyModalOpen(true)}
          isAccessGranted={isAccessGranted}
          isAdmin={isAdmin}
          onLogout={handleLogout}
          onBack={isAccessGranted ? handleBackToApp : undefined}
        />

        <main className="flex-1 container mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-20 sm:pb-24 overflow-x-hidden">
        {isConfigLoading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <RefreshCw size={48} className="text-brand-violet animate-spin mb-4 shadow-[0_0_15px_rgba(139,92,246,0.3)]" />
            <p className="text-slate-400 font-medium font-mono uppercase tracking-widest">စနစ်ကို စတင်နေပါသည်...</p>
          </div>
        ) : isAdminRoute ? (
          <AdminDashboard 
            isAuthReady={isAuthReady} 
            isAdmin={isAdmin}
            isSessionSynced={isSessionSynced}
            onLogout={handleLogout}
            onConfigUpdate={setSystemConfig}
          />
        ) : !isAccessGranted ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-24 h-24 bg-brand-violet/10 text-brand-violet rounded-3xl flex items-center justify-center mb-8 border border-brand-violet/20 shadow-[0_0_30px_rgba(139,92,246,0.3)] neon-glow-violet">
              <Lock size={48} strokeWidth={1.5} />
            </div>
            
            <div className="w-full max-w-md space-y-8 bg-brand-dark/80 backdrop-blur-xl border border-white/5 p-10 rounded-[2.5rem] shadow-2xl inner-glow">
              <div>
                <h2 className="text-3xl font-black tracking-tighter text-white font-mono uppercase">VLOGS BY SAW</h2>
                <p className="text-brand-violet text-[10px] font-bold uppercase tracking-[0.4em] mt-2">Access Restricted</p>
              </div>

              <p className="text-slate-400 text-sm font-sans font-bold">
                ဝင်ရောက်ရန် ကုဒ်ရိုက်ထည့်ပါ
              </p>
              
              <form onSubmit={handleLogin} className="space-y-6">
                {!showPasswordStep ? (
                  <div className="relative group">
                    <Key className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-violet transition-colors" size={20} />
                    <input
                      type="text"
                      value={accessCodeInput}
                      onChange={(e) => setAccessCodeInput(e.target.value)}
                      placeholder="Access Code..."
                      className="w-full bg-brand-black/50 border border-white/10 rounded-2xl pl-14 pr-6 py-5 text-lg font-mono text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-violet/50 transition-all inner-glow"
                    />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 p-4 bg-brand-violet/5 border border-brand-violet/10 rounded-2xl">
                      <div className="w-10 h-10 bg-brand-violet/10 rounded-xl flex items-center justify-center text-brand-violet">
                        <User size={20} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Access Code</p>
                        <p className="text-sm font-bold text-white font-mono">{accessCodeInput}</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowPasswordStep(false);
                          setPasswordInput('');
                        }}
                        className="text-[10px] font-bold text-brand-violet hover:underline uppercase tracking-widest"
                      >
                        Change
                      </button>
                    </div>
                    <div className="relative group">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-violet transition-colors" size={20} />
                      <input
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="စကားဝှက်..."
                        autoFocus
                        className="w-full bg-brand-black/50 border border-white/10 rounded-2xl pl-14 pr-6 py-5 text-lg font-mono text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-violet/50 transition-all inner-glow"
                      />
                    </div>
                  </div>
                )}
                
                {error && (
                  <div className="text-red-500 text-sm font-medium flex items-center justify-center gap-2 font-sans bg-red-500/10 py-3 rounded-xl border border-red-500/20">
                    <AlertCircle size={16} /> {error}
                  </div>
                )}
                
                <button
                  type="submit"
                  disabled={isVerifyingCode || (!showPasswordStep ? !accessCodeInput.trim() : !passwordInput.trim()) || !isAuthReady}
                  className="w-full py-5 bg-brand-violet text-white rounded-2xl font-bold text-lg hover:bg-brand-violet/90 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-violet/30 font-mono uppercase tracking-widest btn-pulse neon-glow-violet"
                >
                  {isVerifyingCode || !isAuthReady ? (
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      {!isAuthReady && <span className="text-sm font-mono">ချိတ်ဆက်နေပါသည်...</span>}
                    </div>
                  ) : (
                    <>
                      <LogIn size={20} />
                      <span>{showPasswordStep ? "ဝင်ရောက်မည်" : "ဆက်လက်လုပ်ဆောင်မည်"}</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tab Navigation - Professional Grid Layout */}
            {!(!systemLive && !isAdmin) && (
              <div className="max-w-4xl mx-auto">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-brand-dark/50 backdrop-blur-xl rounded-[2.5rem] border border-white/5 shadow-2xl inner-glow">
                  {[
                    { id: 'youtube-transcript', label: 'ဗီဒီယို Recap', icon: FileText, sub: 'Source' },
                    { id: 'youtube-recap', label: 'ဇာတ်လမ်းအကျဉ်း', icon: Youtube, sub: 'Recap' },
                    { id: 'generate', label: 'အသံထည့်သွင်းခြင်း', icon: Wand2, sub: 'Generate' },
                    { id: 'history', label: 'မှတ်တမ်းဟောင်း', icon: History, sub: 'History' },
                    ...(isAdmin ? [
                      { id: 'tools', label: 'ကိရိယာများ', icon: Wrench, sub: 'Tools' },
                      { id: 'admin', label: 'အက်ဒမင်', icon: Shield, sub: 'Admin' }
                    ] : [])
                  ].map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id as Tab)}
                        className={`group relative flex items-center gap-4 p-4 rounded-2xl transition-all duration-500 overflow-hidden ${
                          isActive 
                            ? 'bg-brand-violet text-white shadow-[0_0_25px_rgba(139,92,246,0.4)]' 
                            : 'bg-white/5 text-slate-400 border border-white/5 hover:border-brand-violet/30 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {/* Active Glow Effect */}
                        {isActive && (
                          <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent animate-pulse" />
                        )}
                        
                        {/* Icon Container (Soft Rounded Square) */}
                        <div className={`relative z-10 w-12 h-12 shrink-0 rounded-xl flex items-center justify-center transition-all duration-500 ${
                          isActive 
                            ? 'bg-white/20 text-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-105' 
                            : 'bg-brand-black/50 text-slate-500 group-hover:bg-brand-violet/10 group-hover:text-brand-violet group-hover:scale-110'
                        }`}>
                          <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
                        </div>

                        {/* Label Container - Perfectly Left Aligned */}
                        <div className="relative z-10 flex flex-col items-start min-w-0">
                          <span className={`text-xs sm:text-sm font-bold font-sans truncate w-full transition-colors duration-300 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
                            {item.label}
                          </span>
                          <span className={`text-[9px] font-mono uppercase tracking-[0.2em] transition-opacity duration-300 ${isActive ? 'opacity-70 text-white' : 'opacity-30'}`}>
                            {item.sub}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isAdmin && !systemLive && (
              <div className="flex justify-center">
                <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full flex items-center gap-2 text-red-500 text-xs font-bold font-mono animate-pulse">
                  <AlertCircle size={14} />
                  SYSTEM IS CURRENTLY OFFLINE FOR USERS
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {!systemLive && !isAdmin ? (
                <motion.div
                  key="offline"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="max-w-2xl mx-auto py-20 text-center space-y-8"
                >
                  <div className="relative inline-block">
                    <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full animate-pulse" />
                    <div className="relative w-24 h-24 bg-slate-900 border-2 border-red-500/50 rounded-3xl flex items-center justify-center text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                      <Wifi size={48} className="animate-bounce" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
                      စနစ်ကို ခေတ္တပိတ်ထားပါသည်။
                    </h2>
                    <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                      ခဏအကြာမှ ပြန်လည်ကြိုးစားပေးပါ။
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-[0.3em]">System is temporarily offline</p>
                  </div>
                  
                  {/* Admin Login Shortcut for testing */}
                  <div className="pt-8">
                    <button
                      onClick={() => setIsAdminModalOpen(true)}
                      className="text-xs font-bold text-slate-400 hover:text-brand-purple transition-colors flex items-center gap-2 mx-auto uppercase tracking-widest font-mono"
                    >
                      <Lock size={12} /> Admin Override
                    </button>
                  </div>
                </motion.div>
              ) : (
                <>
                  {activeTab === 'generate' && (
                <motion.div
                  key="generate"
                  initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-brand-violet/10 text-brand-violet rounded-2xl flex items-center justify-center mb-4 border border-brand-violet/20 shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                      <Volume2 size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-3xl font-extrabold text-white font-sans tracking-tight">အသံထည့်သွင်းခြင်း</h2>
                    <p className="text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Voiceover Generation Console</p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    {/* Column 1: Configuration */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-300 hover:neon-border-violet inner-glow">
                        <VoiceConfig 
                          config={config} 
                          setConfig={setConfig} 
                          isDarkMode={isDarkMode} 
                          recapStyle={recapStyle}
                          setRecapStyle={setRecapStyle}
                        />
                        <div className="mt-8">
                          <PronunciationRules
                            rules={DEFAULT_RULES}
                            globalRules={globalRules}
                            customRules={customRules}
                            setCustomRules={setCustomRules}
                            isAdmin={isAdmin}
                            onOpenTools={() => setIsApiKeyModalOpen(true)}
                            showCustomRules={false}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Input & Process */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-300 hover:neon-border-violet inner-glow">
                        <ContentInput text={text} setText={setText} isDarkMode={isDarkMode} />
                        
                        <div className="space-y-4 mt-8">
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/5 shadow-sm transition-all duration-300">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-brand-violet/10 rounded-lg text-brand-violet">
                                <History size={18} strokeWidth={1.5} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-white font-sans">မှတ်တမ်းသိမ်းဆည်းမည်</p>
                                <p className="text-[10px] text-slate-500 font-mono uppercase">Sync to Mission Logs</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSaveToHistory(!saveToHistory)}
                              className={`w-12 h-6 rounded-full transition-all relative ${saveToHistory ? 'bg-brand-violet' : 'bg-slate-800'}`}
                            >
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${saveToHistory ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>

                          <button
                            onClick={() => handleGenerate()}
                            disabled={isLoading || !text.trim()}
                            className={`w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] bg-brand-violet hover:bg-brand-violet/90 text-white shadow-brand-violet/40 hover:ring-2 hover:ring-brand-violet/50 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] font-mono uppercase tracking-widest btn-pulse neon-glow-violet`}
                          >
                            {isLoading ? (
                              <RefreshCw size={28} className="animate-spin" />
                            ) : (
                              <Zap size={28} strokeWidth={1.5} />
                            )}
                            <div className="flex flex-col items-center">
                              <span className="flex items-baseline gap-3 font-sans">
                                {isLoading ? 'ဖန်တီးနေပါသည်...' : 'အသံထုတ်ယူမည်'}
                                <span className="text-sm font-medium opacity-60 font-mono">
                                  ({Math.ceil(text.length / 3000) || 1} UNIT)
                                </span>
                              </span>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Column 3: Output */}
                    <div className="lg:col-span-1 space-y-8">
                      <div className="bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-300 hover:neon-border-cyan inner-glow">
                        <OutputPreview 
                          result={result} 
                          isLoading={isLoading} 
                          globalVolume={config.volume}
                        />
                        {error && (
                          <div className="mt-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                            <AlertCircle size={20} className="shrink-0 mt-0.5" />
                            <p className="text-sm font-medium">{error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'history' && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-5xl mx-auto space-y-6"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-brand-purple/10 text-brand-purple rounded-2xl flex items-center justify-center mb-4 border border-brand-purple/20 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                      <History size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">မှတ်တမ်းဟောင်း</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Generation History Archive</p>
                  </div>

                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                      <div>
                        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
                          <History className="text-brand-purple" /> မှတ်တမ်းဟောင်း
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">ယခင်က ဖန်တီးထားသော အသံများကို စီမံခန့်ခွဲရန်</p>
                      </div>
                      
                      <div className="relative flex-1 max-w-md">
                        <input
                          type="text"
                          placeholder="Search history by text..."
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all pr-12 placeholder:text-slate-400"
                        />
                        <Wand2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" />
                      </div>
                    </div>

                    {isHistoryLoading ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div className="w-10 h-10 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin" />
                        <p className="text-slate-500 dark:text-slate-400 font-medium">Loading history...</p>
                      </div>
                    ) : filteredHistory.length === 0 ? (
                      <div className="text-center py-24 bg-slate-50 dark:bg-slate-950 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                        <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400 dark:text-slate-600">
                          <History size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-400">No results found</h3>
                        <p className="text-slate-500 dark:text-slate-600 text-sm mt-1">Try adjusting your search or generate something new!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {filteredHistory.map((item) => (
                          <div key={item.id} className="group bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 transition-all hover:bg-slate-100 dark:hover:bg-slate-900 hover:border-brand-purple/30">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                              <div className="flex-1 min-w-0 space-y-3">
                                <div className="flex items-center gap-3">
                                  <span className="px-2 py-0.5 bg-brand-purple/20 text-brand-purple rounded text-[10px] font-bold uppercase tracking-wider">
                                    {item.config.voiceId}
                                  </span>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                    {new Date(item.createdAt).toLocaleString()}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-200 line-clamp-2 leading-relaxed">
                                  {item.text}
                                </p>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0">
                                <button 
                                  onClick={() => playFromHistory(item)}
                                  className="flex items-center gap-2 px-4 py-2 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20"
                                >
                                  <Play size={14} fill="currentColor" /> Play
                                </button>
                                <div className="h-8 w-[1px] bg-white/10 mx-1" />
                                <button 
                                  onClick={() => handleDownloadAudio(item.audioStorageUrl || '', `narration-${item.id}.mp3`)}
                                  className="p-2.5 bg-blue-500/10 text-blue-500 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-blue-500/20"
                                  title="Download MP3"
                                >
                                  <Music size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDownloadSRT(item.srtStorageUrl || item.srtContent || '', `subtitles-${item.id}.srt`)}
                                  className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl hover:bg-amber-500 hover:text-white transition-all border border-amber-500/20"
                                  title="Download SRT"
                                >
                                  <FileText size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteHistory(item.id)}
                                  className="p-2.5 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-500/20"
                                  title="Delete"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'tools' && (
                <motion.div
                  key="tools"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-4xl mx-auto space-y-8"
                >
                  {/* Profile Card */}
                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 mb-6 sm:mb-8 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-brand-purple/20 text-brand-purple rounded-2xl flex items-center justify-center text-2xl sm:text-3xl font-bold shadow-inner border border-brand-purple/20 shrink-0">
                        {accessCode?.charAt(0).toUpperCase() || 'V'}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 mb-2">
                          <h3 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-white truncate max-w-full">User ID: {accessCode}</h3>
                          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                            <CheckCircle2 size={10} className="sm:w-3 sm:h-3" /> Authorized Access
                          </span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm flex items-center justify-center sm:justify-start gap-2">
                          <Clock size={12} className="sm:w-3.5 sm:h-3.5" /> Session active via Access Code
                        </p>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-all flex items-center justify-center gap-2"
                      >
                        <LogOut size={14} /> Sign Out
                      </button>
                    </div>
                  </div>

                  {/* Gemini API Key Section */}
                  <div 
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300 cursor-pointer hover:border-brand-purple/30 group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple group-hover:scale-110 transition-transform">
                          <Key size={20} />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Gemini API Key</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Configure your personal Google AI Studio key</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest ${localApiKey ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          <div className={`w-2.5 h-2.5 rounded-full ${localApiKey ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                          {localApiKey ? 'CONNECTED' : 'No API Key found'}
                        </div>
                        <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </div>

                  {/* Admin Login Section */}
                  {!isAdmin && (
                    <div 
                      onClick={() => setIsAdminModalOpen(true)}
                      className="bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl transition-colors duration-300 cursor-pointer hover:border-brand-purple/30 group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple group-hover:scale-110 transition-transform">
                            <Shield size={20} />
                          </div>
                          <div>
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">Admin Login</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Access administrative dashboard and settings</p>
                          </div>
                        </div>
                        <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'admin' && isAdmin && (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <AdminDashboard 
                    isAuthReady={isAuthReady} 
                    isAdmin={isAdmin}
                    isSessionSynced={isSessionSynced}
                    onLogout={handleLogout} 
                    onConfigUpdate={(config) => {
                      setSystemConfig(config);
                      setSystemLive(config.system_live ?? true);
                    }}
                  />
                </motion.div>
              )}

              {activeTab === 'youtube-transcript' && (
                <motion.div
                  key="youtube-transcript"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-4xl mx-auto space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-brand-violet/10 text-brand-violet rounded-2xl flex items-center justify-center mb-4 border border-brand-violet/20 shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                      <FileText size={32} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-3xl font-extrabold text-white font-sans tracking-tight">ဗီဒီယိုအရင်းအမြစ်</h2>
                    <p className="text-slate-400 text-sm mt-2 font-mono uppercase tracking-widest">Original Script Extraction Unit</p>
                  </div>

                  <div className="bg-brand-dark/80 backdrop-blur-xl border border-white/5 rounded-3xl p-6 sm:p-10 shadow-2xl transition-all duration-300 hover:neon-border-violet inner-glow">
                    {/* Source Selection Tabs */}
                    <div className="flex items-center gap-4 mb-8 p-1.5 bg-white/5 rounded-2xl border border-white/5">
                      <button
                        onClick={() => setSourceType('file')}
                        className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sourceType === 'file' ? 'bg-brand-violet text-white shadow-lg shadow-brand-violet/20' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <Upload size={14} />
                        Video File
                      </button>
                      <button
                        onClick={() => setSourceType('link')}
                        className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${sourceType === 'link' ? 'bg-brand-violet text-white shadow-lg shadow-brand-violet/20' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        <Youtube size={14} />
                        YouTube Link
                      </button>
                    </div>

                    {sourceType === 'file' ? (
                      /* Unified Upload Area */
                      <div className="w-full space-y-8 p-10 bg-white/2 rounded-2xl border border-white/5 hover:border-brand-violet/30 transition-all duration-500 gradient-border">
                        <div className="flex flex-col items-center text-center space-y-4">
                          <div className="w-20 h-20 bg-brand-violet/10 rounded-full flex items-center justify-center border border-brand-violet/20 shadow-[0_0_30px_rgba(139,92,246,0.2)]">
                            <Upload size={32} className="text-brand-violet" strokeWidth={1.5} />
                          </div>
                          <h3 className="text-xl font-bold text-white uppercase tracking-widest font-mono">ဗီဒီယိုဖိုင်တင်ရန်</h3>
                          <p className="text-slate-400 text-xs font-mono">ဗီဒီယိုဖိုင်ကို ဤနေရာတွင် တင်ပေးပါ။</p>
                        </div>

                        <div className="space-y-6">
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">ဗီဒီယိုဖိုင် (.mp4, .mkv, .mov)</label>
                            <div className="relative group">
                              <input
                                type="file"
                                accept="video/mp4,video/x-matroska,video/quicktime"
                                onChange={handleVideoUpload}
                                className="hidden"
                                id="video-upload"
                              />
                              <label
                                htmlFor="video-upload"
                                className="w-full h-24 bg-brand-black/50 border-2 border-dashed border-white/10 rounded-2xl flex items-center justify-center cursor-pointer hover:border-brand-violet/50 hover:bg-brand-violet/5 transition-all group relative overflow-hidden"
                              >
                                <div className="absolute inset-0 bg-brand-violet/5 opacity-0 group-hover:opacity-100 transition-opacity animate-pulse" />
                                {videoFile ? (
                                  <span className="text-sm font-mono text-brand-violet truncate px-6 relative z-10">{videoFile.name}</span>
                                ) : (
                                  <div className="flex flex-col items-center gap-2 text-slate-500 group-hover:text-brand-violet relative z-10">
                                    <Plus size={24} strokeWidth={1.5} />
                                    <span className="text-xs font-mono uppercase tracking-widest">ဖိုင်ရွေးချယ်ရန်</span>
                                  </div>
                                )}
                              </label>
                            </div>
                          </div>
                          
                          <button
                            onClick={processVideoFile}
                            disabled={isVideoProcessing || !videoFile}
                            className="w-full py-5 bg-brand-violet hover:bg-brand-violet/90 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-brand-violet/30 font-mono uppercase tracking-widest btn-pulse neon-glow-violet"
                          >
                            {isVideoProcessing ? (
                              <RefreshCw size={24} className="animate-spin" />
                            ) : (
                              <Zap size={24} strokeWidth={1.5} />
                            )}
                            <span>စာသားထုတ်ယူမည်</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* YouTube Link Area */
                      <div className="w-full space-y-8 p-10 bg-white/2 rounded-2xl border border-white/5 hover:border-brand-violet/30 transition-all duration-500 gradient-border">
                        <div className="flex flex-col items-center text-center space-y-4">
                          <div className="w-20 h-20 bg-brand-violet/10 rounded-full flex items-center justify-center border border-brand-violet/20 shadow-[0_0_30px_rgba(139,92,246,0.2)]">
                            <Youtube size={32} className="text-brand-violet" strokeWidth={1.5} />
                          </div>
                          <h3 className="text-xl font-bold text-white uppercase tracking-widest font-mono">YouTube Link</h3>
                          <p className="text-slate-400 text-xs font-mono">YouTube ဗီဒီယို Link ကို ဤနေရာတွင် ထည့်သွင်းပါ။</p>
                        </div>

                        <div className="space-y-6">
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">YouTube URL</label>
                            <div className="relative group">
                              <input
                                type="text"
                                value={youtubeUrl}
                                onChange={(e) => setYoutubeUrl(e.target.value)}
                                placeholder="https://www.youtube.com/watch?v=..."
                                className="w-full bg-brand-black/50 border border-white/10 rounded-2xl p-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-violet/50 transition-all font-mono"
                              />
                            </div>
                          </div>
                          
                          <button
                            onClick={handleYoutubeUrlProcess}
                            disabled={isVideoProcessing || !youtubeUrl.trim()}
                            className="w-full py-5 bg-brand-violet hover:bg-brand-violet/90 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-brand-violet/30 font-mono uppercase tracking-widest btn-pulse neon-glow-violet"
                          >
                            {isVideoProcessing ? (
                              <>
                                <RefreshCw size={24} className="animate-spin" />
                                <span>YouTube ဗီဒီယိုကို စစ်ဆေးနေပါသည်...</span>
                              </>
                            ) : (
                              <>
                                <Zap size={24} strokeWidth={1.5} />
                                <span>Link ကို စစ်ဆေးပြီး အကျဉ်းချုပ်မည်</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {rawTranscript && (
                      <div className="mt-12 space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">
                        {videoAnalysis?.on_screen_text && videoAnalysis.on_screen_text.length > 0 && (
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-brand-cyan uppercase tracking-widest px-1 font-mono">ဗီဒီယိုပေါ်ရှိ စာသားများ (On-Screen Text)</label>
                            <div className="flex flex-wrap gap-2 p-1">
                              {videoAnalysis.on_screen_text.map((t, i) => (
                                <span key={i} className="px-4 py-1.5 bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 rounded-full text-[11px] font-mono shadow-[0_0_10px_rgba(34,211,238,0.1)]">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">ထုတ်ယူထားသော စာသားများ (English Transcript)</label>
                          <div className="w-full h-48 bg-brand-black/50 border border-white/5 rounded-2xl p-6 text-sm text-slate-400 overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-white/10 font-mono inner-glow">
                            {rawTranscript}
                          </div>
                        </div>

                        {recapText && (
                          <div className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-700">
                            <label className="text-[10px] font-bold text-brand-cyan uppercase tracking-widest px-1 font-mono">ဇာတ်လမ်းအကျဉ်းချုပ် ({recapStyle.toUpperCase()} RECAP)</label>
                            <textarea
                              value={recapText}
                              onChange={(e) => setRecapText(e.target.value)}
                              className="w-full h-64 bg-brand-cyan/5 border border-brand-cyan/20 rounded-2xl p-8 text-sm text-white overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-brand-cyan/20 font-sans focus:outline-none focus:ring-2 focus:ring-brand-cyan/50 transition-all resize-none shadow-[0_0_20px_rgba(34,211,238,0.05)] inner-glow"
                              placeholder="ဇာတ်လမ်းအကျဉ်းချုပ်..."
                            />
                            <button
                              onClick={() => {
                                setText(recapText);
                                setActiveTab('generate');
                                setToast({ message: "အကျဉ်းချုပ်ကို Voiceover Console သို့ ပို့လိုက်ပါပြီ။", type: 'success' });
                              }}
                              className="w-full py-5 bg-brand-cyan/10 hover:bg-brand-cyan text-brand-cyan hover:text-brand-black rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 border border-brand-cyan/30 hover:border-brand-cyan shadow-lg shadow-brand-cyan/10 font-mono uppercase tracking-widest"
                            >
                              <Zap size={24} />
                              အသံထုတ်ယူရန် ပေးပို့မည်
                            </button>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <button
                            onClick={() => handleTranslate(rawTranscript, 'Burmese')}
                            disabled={isTranslating}
                            className="py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 font-sans uppercase tracking-widest"
                          >
                            {isTranslating ? <RefreshCw size={18} className="animate-spin" /> : <Languages size={18} />}
                            မြန်မာဘာသာသို့ ပြန်ဆိုမည်
                          </button>
                          <button
                            onClick={() => handleTranslate(rawTranscript, 'Hindi')}
                            disabled={isTranslating}
                            className="py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-orange-600/20 font-sans uppercase tracking-widest"
                          >
                            {isTranslating ? <RefreshCw size={18} className="animate-spin" /> : <Languages size={18} />}
                            Hindi ဘာသာသို့ ပြန်ဆိုမည်
                          </button>
                        </div>

                        {translatedText && (
                          <div className="space-y-2 animate-in fade-in zoom-in duration-300">
                            <label className="text-[10px] font-bold text-brand-purple uppercase tracking-widest px-1 font-mono">ဘာသာပြန်ဆိုထားသော စာသားများ</label>
                            <div className="w-full h-48 bg-brand-purple/5 border border-brand-purple/20 rounded-2xl p-6 text-sm text-slate-900 dark:text-slate-200 overflow-y-auto leading-relaxed scrollbar-thin scrollbar-thumb-brand-purple/20 font-sans">
                              {translatedText}
                            </div>
                            <button
                              onClick={() => {
                                setText(translatedText);
                                setActiveTab('generate');
                                setToast({ message: "စာသားများကို Voiceover Console သို့ ပို့လိုက်ပါပြီ။", type: 'success' });
                              }}
                              className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-3 shadow-lg shadow-brand-purple/20 font-mono uppercase tracking-widest"
                            >
                              <Zap size={20} />
                              အသံထုတ်ယူရန် ပေးပို့မည်
                            </button>
                          </div>
                        )}

                        <div className="relative py-4">
                          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-800"></div></div>
                          <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-mono text-slate-400 bg-white dark:bg-slate-900 px-4">OR</div>
                        </div>

                        <button
                          onClick={() => handleYoutubeRecap(rawTranscript)}
                          disabled={isProcessingYoutube}
                          className="w-full py-4 bg-slate-800 dark:bg-slate-950 text-white rounded-2xl font-bold text-lg hover:bg-slate-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg font-mono uppercase tracking-widest"
                        >
                          {isProcessingYoutube ? (
                            <>
                              <RefreshCw size={20} className="animate-spin" />
                              <span>အကျဉ်းချုပ်နေပါသည်...</span>
                            </>
                          ) : (
                            <>
                              <Wand2 size={20} />
                              <span>အကျဉ်းချုပ်ပြီး အသံထုတ်ယူမည်</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {error && (
                      <div className="mt-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              {activeTab === 'youtube-recap' && (
                <motion.div
                  key="youtube-recap"
                  initial={{ opacity: 0, x: 100, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="max-w-2xl mx-auto space-y-8"
                >
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                      <Youtube size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tighter uppercase">ဇာတ်လမ်းအကျဉ်း</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-mono">ဗီဒီယိုကို အကျဉ်းချုပ်ပြီး အသံဖလှယ်ပေးမည်</p>
                  </div>

                  <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-3xl p-6 sm:p-10 shadow-2xl transition-colors duration-300">
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 font-mono">စာသားများ ထည့်သွင်းရန်</label>
                          <textarea
                            value={recapManualText}
                            onChange={(e) => setRecapManualText(e.target.value)}
                            placeholder="အကျဉ်းချုပ်လိုသော စာသားများကို ဤနေရာတွင် ထည့်သွင်းပါ..."
                            className="w-full h-48 bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-xl p-4 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all resize-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 px-1 font-mono">YouTube ဗီဒီယိုအောက်ရှိ '...More' -&gt; 'Show Transcript' မှ စာသားများကို ကူးယူနိုင်ပါသည်။</p>
                        </div>
                      </div>

                      {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 text-red-500 font-mono">
                          <AlertCircle size={20} className="shrink-0 mt-0.5" />
                          <p className="text-sm font-medium">{error}</p>
                        </div>
                      )}

                      <button
                        onClick={() => handleYoutubeRecap()}
                        disabled={isProcessingYoutube || !recapManualText.trim()}
                        className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg hover:bg-brand-purple/90 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-lg shadow-brand-purple/20 hover:ring-2 hover:ring-brand-purple/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] font-mono uppercase tracking-widest"
                      >
                        {isProcessingYoutube ? (
                          <>
                            <RefreshCw size={20} className="animate-spin" />
                            <span>အကျဉ်းချုပ်နေပါသည်...</span>
                          </>
                        ) : (
                          <>
                            <Wand2 size={20} />
                            <span>အကျဉ်းချုပ်ပြီး အသံထုတ်ယူမည်</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>

            {/* Mission Log Panel */}
            <div className="max-w-4xl mx-auto mt-8">
              <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-4 shadow-2xl">
                <div className="flex items-center gap-2 mb-2 border-b border-slate-800 pb-2">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">စနစ်လည်ပတ်မှု မှတ်တမ်း</span>
                </div>
                <div className="space-y-1 h-24 overflow-y-auto custom-scrollbar">
                  {missionLogs.length === 0 ? (
                    <p className="text-[10px] text-slate-600 font-mono italic">စနစ်မှ ညွှန်ကြားချက်များကို စောင့်ဆိုင်းနေပါသည်...</p>
                  ) : (
                    missionLogs.map((log, idx) => (
                      <div key={idx} className="flex gap-3 text-[10px] font-mono">
                        <span className="text-emerald-500/70 shrink-0">{log.time}</span>
                        <span className="text-slate-300">{log.msg}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>

      {/* Settings Integrated into Tools Tab */}
      {/* Toast Notification */}
      <ApiKeyModal 
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKeyFromModal}
        onClear={handleClearApiKey}
        initialKey={localApiKey || ''}
        initialSwitch={apiSwitch}
      />

      {/* Admin Login Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            >
              <div className="p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-purple/10 text-brand-purple rounded-xl flex items-center justify-center">
                      <Shield size={20} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">အက်ဒမင် ဝင်ရောက်ခွင့်</h3>
                  </div>
                  <button 
                    onClick={() => setIsAdminModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">အက်ဒမင် စကားဝှက်</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type="password"
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        placeholder="အက်ဒမင် စကားဝှက် ထည့်သွင်းပါ..."
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all"
                        autoFocus
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2"
                  >
                    <LogIn size={20} /> အက်ဒမင်အဖြစ် ဝင်ရောက်မည်
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-16 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 z-50 border backdrop-blur-xl ${
              toast.type === 'success' 
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
                : 'bg-red-500/20 border-red-500/30 text-red-400'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <footer className="fixed bottom-0 left-0 right-0 z-[100] bg-white/5 dark:bg-slate-950/5 backdrop-blur-md border-t border-slate-200/10 dark:border-slate-800/10 py-3 px-4 flex flex-col items-center justify-center text-center pointer-events-none">
        <div className="text-[9px] sm:text-[10px] font-mono text-slate-500 dark:text-slate-400 tracking-[0.3em] uppercase opacity-70">
          © 2026 Vlogs By Saw | Created by Saw Yan Aung
        </div>
        <div className="text-[8px] sm:text-[9px] font-mono text-slate-400/60 dark:text-slate-500/60 tracking-[0.2em] mt-1 opacity-60">
          မြန်မာနိုင်ငံအတွက် အဆင့်မြင့် AI နည်းပညာဖြင့် ဖန်တီးထားပါသည်
        </div>
      </footer>
    </div>
  );
}
