import { VoiceOption } from './types';

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'zephyr', name: 'Burmese Female (အမျိုးသမီး) - Zephyr', gender: 'female', voiceName: 'Zephyr' },
  { id: 'kore', name: 'Burmese Male (အမျိုးသား) - Kore', gender: 'male', voiceName: 'Kore' },
  { id: 'puck', name: 'Burmese Male (အမျိုးသား) - Puck', gender: 'male', voiceName: 'Puck' },
  { id: 'charon', name: 'Burmese Male (အမျိုးသား) - Charon', gender: 'male', voiceName: 'Charon' },
  { id: 'fenrir', name: 'Burmese Male (အမျိုးသား) - Fenrir', gender: 'male', voiceName: 'Fenrir' },
  { id: 'aoede', name: 'Burmese Female (အမျိုးသမီး) - Aoede', gender: 'female', voiceName: 'Aoede' },
  { id: 'orpheus', name: 'Burmese Male (အမျိုးသား) - Orpheus', gender: 'male', voiceName: 'Orpheus' },
  { id: 'hermes', name: 'Burmese Male (အမျိုးသား) - Hermes', gender: 'male', voiceName: 'Hermes' },
  { id: 'hestia', name: 'Burmese Female (အမျိုးသမီး) - Hestia', gender: 'female', voiceName: 'Hestia' },
  { id: 'helios', name: 'Burmese Male (အမျိုးသား) - Helios', gender: 'male', voiceName: 'Helios' },
  { id: 'artemis', name: 'Burmese Female (အမျိုးသမီး) - Artemis', gender: 'female', voiceName: 'Artemis' },
  { id: 'athena', name: 'Burmese Female (အမျိုးသမီး) - Athena', gender: 'female', voiceName: 'Athena' },
  { id: 'ares', name: 'Burmese Male (အမျိုးသား) - Ares', gender: 'male', voiceName: 'Ares' },
  { id: 'hephaestus', name: 'Burmese Male (အမျိုးသား) - Hephaestus', gender: 'male', voiceName: 'Hephaestus' },
  { id: 'dionysus', name: 'Burmese Male (အမျိုးသား) - Dionysus', gender: 'male', voiceName: 'Dionysus' },
  { id: 'demeter', name: 'Burmese Female (အမျိုးသမီး) - Demeter', gender: 'female', voiceName: 'Demeter' },
  { id: 'persephone', name: 'Burmese Female (အမျိုးသမီး) - Persephone', gender: 'female', voiceName: 'Persephone' },
  { id: 'hades', name: 'Burmese Male (အမျိုးသား) - Hades', gender: 'male', voiceName: 'Hades' },
  { id: 'poseidon', name: 'Burmese Male (အမျိုးသား) - Poseidon', gender: 'male', voiceName: 'Poseidon' },
  { id: 'hera', name: 'Burmese Female (အမျိုးသမီး) - Hera', gender: 'female', voiceName: 'Hera' },
  { id: 'zeus', name: 'Burmese Male (အမျိုးသား) - Zeus', gender: 'male', voiceName: 'Zeus' },
  { id: 'calliope', name: 'Burmese Female (အမျိုးသမီး) - Calliope', gender: 'female', voiceName: 'Calliope' },
  { id: 'clio', name: 'Burmese Female (အမျိုးသမီး) - Clio', gender: 'female', voiceName: 'Clio' },
  { id: 'erato', name: 'Burmese Female (အမျိုးသမီး) - Erato', gender: 'female', voiceName: 'Erato' },
  { id: 'euterpe', name: 'Burmese Female (အမျိုးသမီး) - Euterpe', gender: 'female', voiceName: 'Euterpe' },
  { id: 'melpomene', name: 'Burmese Female (အမျိုးသမီး) - Melpomene', gender: 'female', voiceName: 'Melpomene' },
  { id: 'polyhymnia', name: 'Burmese Female (အမျိုးသမီး) - Polyhymnia', gender: 'female', voiceName: 'Polyhymnia' },
  { id: 'terpsichore', name: 'Burmese Female (အမျိုးသမီး) - Terpsichore', gender: 'female', voiceName: 'Terpsichore' },
  { id: 'thalia', name: 'Burmese Female (အမျိုးသမီး) - Thalia', gender: 'female', voiceName: 'Thalia' },
  { id: 'urania', name: 'Burmese Female (အမျိုးသမီး) - Urania', gender: 'female', voiceName: 'Urania' },
];

export const MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash (Latest)' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Experimental)' },
];

// Define which voices are supported by which models
const STABLE_VOICES = ['zephyr', 'kore', 'puck', 'charon', 'fenrir'];
const ALL_VOICES = VOICE_OPTIONS.map(v => v.id);

export const MODEL_VOICE_MAPPING: Record<string, string[]> = {
  'gemini-2.5-flash-preview-tts': ALL_VOICES,
  'gemini-1.5-flash': STABLE_VOICES,
  'gemini-1.5-pro': STABLE_VOICES,
  'gemini-2.0-flash-exp': ALL_VOICES,
};

export const DEFAULT_RULES = [
  { id: '1', original: 'Vlogs By Saw', replacement: 'ဗလော့ ဘိုင် စော' },
  { id: '2', original: 'AI', replacement: 'အေအိုင်' },
  { id: '3', original: 'မေတ္တာ', replacement: 'မစ်တာ' },
  { id: '4', original: 'သစ္စာ', replacement: 'သစ်စာ' },
  { id: '5', original: 'ပြဿနာ', replacement: 'ပရတ်သနာ' },
  { id: '6', original: 'ဥက္က', replacement: 'အုတ်က' },
  { id: '7', original: 'ဦးနှောက်', replacement: 'အုန်းနှောက်' },
  { id: '8', original: 'တက္ကသိုလ်', replacement: 'တက်ကသိုလ်' },
];

export const GEMINI_MODELS = {
  VERIFY: 'gemini-3-flash-preview',
  LIVE: 'gemini-2.5-flash-native-audio-preview-12-2025',
  TTS: 'gemini-2.5-flash-preview-tts',
};
