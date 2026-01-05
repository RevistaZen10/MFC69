
import type { LanguageOption, StyleGuideOption } from '../types';

export const LANGUAGES: LanguageOption[] = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'pt', name: 'Português', flag: '🇧🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
];

export const AVAILABLE_MODELS: {name: string, description: string}[] = [
    { name: 'gemini-3-pro-preview', description: 'Google: Gemini 3 Pro (Complex Reasoning & Higher Quality)' },
    { name: 'gemini-3-flash-preview', description: 'Google: Gemini 3 Flash (Fast & Efficient)' },
    { name: 'grok-2-latest', description: 'x.ai: Grok-2 (Requires separate Key)' },
];

export const STYLE_GUIDES: StyleGuideOption[] = [
    { key: 'abnt', name: 'ABNT', description: 'Associação Brasileira de Normas Técnicas NBR 6023' },
    { key: 'apa', name: 'APA', description: 'American Psychological Association 7th Edition' },
    { key: 'mla', name: 'MLA', description: 'Modern Language Association 9th Edition' },
    { key: 'ieee', name: 'IEEE', description: 'Institute of Electrical and Electronics Engineers' },
];

export const FIX_OPTIONS: { key: string; label: string; description: string }[] = [
    {
        key: 'escape_chars',
        label: 'Fix Character Escaping',
        description: 'Scans the document for special LaTeX characters (like %, $, _, &) that were not correctly escaped and fixes them.'
    },
    {
        key: 'citation_mismatch',
        label: 'Fix Citation Mismatches',
        description: 'Ensures that every \\cite{...} command in the text has a corresponding \\bibitem entry in the bibliography, and vice-versa.'
    },
    {
        key: 'preamble_check',
        label: 'Verify Preamble',
        description: 'Checks if the document preamble uses only the allowed packages in the correct order as specified by the generation rules.'
    }
];
