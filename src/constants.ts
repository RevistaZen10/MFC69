
import type { LanguageOption, AnalysisTopic, StyleGuideOption } from './types';

// Otimização de Cota para modelos 2.5
export const TOTAL_ITERATIONS = 2;

export const LANGUAGES: LanguageOption[] = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'pt', name: 'Português', flag: '🇧🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
];

export const AVAILABLE_MODELS: {name: string, description: string}[] = [
    { name: 'gemini-2.5-flash-native-audio-preview-09-2025', description: 'Google: Gemini 2.5 Pro (Máxima Precisão)' },
    { name: 'gemini-2.5-flash-preview-tts', description: 'Google: Gemini 2.5 Flash (Veloz)' },
    { name: 'grok-2-latest', description: 'x.ai: Advanced reasoning (Requires API Key)' },
];

export const STYLE_GUIDES: StyleGuideOption[] = [
    { key: 'abnt', name: 'ABNT', description: 'Associação Brasileira de Normas Técnicas NBR 6023' },
    { key: 'apa', name: 'APA', description: 'American Psychological Association 7th Edition' },
    { key: 'mla', name: 'MLA', description: 'Modern Language Association 9th Edition' },
    { key: 'ieee', name: 'IEEE', description: 'Institute of Electrical and Electronics Engineers' },
];

export const ANALYSIS_TOPICS: AnalysisTopic[] = [
    { num: 0, name: 'TOPIC FOCUS', desc: 'Foco central.' },
    { num: 1, name: 'WRITING CLARITY', desc: 'Gramática e legibilidade.' },
    { num: 2, name: 'METHODOLOGICAL RIGOR', desc: 'Validez metodológica.' },
    { num: 3, name: 'ORIGINALITY', desc: 'Contribuição acadêmica.' },
    { num: 4, name: 'LITERATURE REVIEW', desc: 'Uso de fontes e contexto.' },
    { num: 5, name: 'METHODOLOGY CLARITY', desc: 'Clareza e reprodutibilidade.' },
    { num: 6, name: 'RESULTS PRESENTATION', desc: 'Organização dos resultados.' },
    { num: 7, name: 'DISCUSSION DEPTH', desc: 'Interpretação e teoria.' },
    { num: 8, name: 'ABSTRACT QUALITY', desc: 'Resumo conciso.' },
    { num: 9, name: 'INTRODUCTION QUALITY', desc: 'Contexto e problema.' },
    { num: 10, name: 'CONCLUSION QUALITY', desc: 'Achados e futuro.' },
    { num: 11, name: 'ARGUMENTATION STRENGTH', desc: 'Lógica e evidências.' },
    { num: 12, name: 'COHERENCE AND FLOW', desc: 'Transições e fluxo.' },
    { num: 13, name: 'STRUCTURE', desc: 'Estrutura LaTeX.' },
    { num: 14, name: 'REFERENCES', desc: 'Formatação.' },
    { num: 15, name: 'SCOPE AND BOUNDARIES', desc: 'Definição do escopo.' },
    { num: 16, name: 'SCIENTIFIC HONESTY', desc: 'Honestidade científica.' },
    { num: 17, name: 'TITLE-CONTENT ALIGNMENT', desc: 'Alinhamento título-conteúdo.' },
    { num: 18, name: 'STATEMENT OF LIMITATIONS', desc: 'Limitações.' },
    { num: 20, name: 'PRACTICAL IMPLICATIONS', desc: 'Relevância prática.' },
    { num: 21, name: 'TERMINOLOGY', desc: 'Terminologia técnica.' },
    { num: 23, name: 'LATEX ACCURACY', desc: 'Compilabilidade.' },
    { num: 24, name: 'STRATEGIC REFINEMENT', desc: 'Melhorias cirúrgicas.' },
    { num: 25, name: 'THEORETICAL FOUNDATION', desc: 'Base teórica.' },
    { num: 26, name: 'SCIENTIFIC CONTENT ACCURACY', desc: 'Precisão científica.' },
    { num: 27, name: 'DEPTH OF CRITICAL ANALYSIS', desc: 'Análise crítica.' },
    { num: 28, name: 'PAGE COUNT', desc: 'Adesão ao tamanho.' }
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

export const DISCIPLINE_AUTHORS: Record<string, string> = {
    "Mathematics": "MATH, 10",
    "History of Humanity": "HISTORY, 10",
    "Geography": "GEOGRAPHY, 10",
    "Biology": "BIOLOGY, 10",
    "Chemistry": "CHEMISTRY, 10",
    "Physics": "PHYSICS, 10",
    "Astronomy & Astrophysics": "ASTRO, 10",
    "Philosophy": "PHILOSOPHY, 10",
    "Literature": "LITERATURE, 10"
};

export const ALL_TOPICS_BY_DISCIPLINE: Record<string, string[]> = {
  "History of Humanity": [ "Hominin Evolution", "Paleolithic", "Neolithic Revolution", "Ancient Egypt", "Medieval Europe", "World War II" ],
  "Mathematics": [ "Set Theory", "Riemann Zeta Function", "Category Theory", "Topology", "Fractals" ],
  "Geography": [ "Geomorphology", "Climate Change", "Urbanization", "Geopolitics" ],
  "Biology": [ "CRISPR", "Cellular Respiration", "Phylogenetics", "Immune System" ],
  "Chemistry": [ "Quantum Chemistry", "Organic Synthesis", "Thermodynamics" ],
  "Physics": [ "Quantum Field Theory", "General Relativity", "Condensed Matter" ],
  "Astronomy & Astrophysics": [ "Black Holes", "James Webb Findings", "Dark Energy" ],
  "Philosophy": [ "Stoicism", "Existentialism", "Analytic Philosophy" ],
  "Literature": [ "Modernism", "Post-colonialism", "Shakespearean Drama" ]
};

export const getAllDisciplines = (): string[] => {
    return Object.keys(ALL_TOPICS_BY_DISCIPLINE);
};

export const getRandomTopic = (discipline: string): string => {
    const topics = ALL_TOPICS_BY_DISCIPLINE[discipline];
    if (topics && topics.length > 0) {
        return topics[Math.floor(Math.random() * topics.length)];
    }
    return '';
};

export const SEMANTIC_SCHOLAR_API_BASE_URL = 'https://api.semanticscholar.org/graph/v1';
