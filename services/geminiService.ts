
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import type { Language, AnalysisResult, PaperSource, StyleGuide, SemanticScholarPaper, PersonalData } from '../types';
import { ANALYSIS_TOPICS, LANGUAGES, FIX_OPTIONS, STYLE_GUIDES, SEMANTIC_SCHOLAR_API_BASE_URL } from '../constants';
import { ARTICLE_TEMPLATE } from './articleTemplate';

const BABEL_LANG_MAP: Record<Language, string> = {
    en: 'english',
    pt: 'brazilian',
    es: 'spanish',
    fr: 'french',
};

// Gerenciador de Chaves ultra-cirúrgico
const KeyManager = {
    keys: [] as string[],
    currentIndex: 0,
    initialized: false,

    loadKeys: function() {
        const envKey = process.env.API_KEY;
        
        // REGRA ABSOLUTA: Se a chave do Cloudflare existir, use APENAS ela para evitar erro de duplicidade
        if (envKey && typeof envKey === 'string' && envKey !== 'undefined' && envKey !== '') {
            this.keys = [envKey];
            this.currentIndex = 0;
            this.initialized = true;
            return;
        }

        // Caso contrário, carrega do LocalStorage (Fallback)
        const storedKeys = localStorage.getItem('gemini_api_keys');
        const legacyKey = localStorage.getItem('gemini_api_key');
        let newKeys: string[] = [];

        if (storedKeys) {
            try {
                const parsed = JSON.parse(storedKeys);
                if (Array.isArray(parsed)) {
                    parsed.forEach(k => {
                        if (k && k !== 'undefined' && k !== '') newKeys.push(k);
                    });
                }
            } catch (e) {}
        }
        
        if (legacyKey && legacyKey !== 'undefined' && legacyKey !== '' && !newKeys.includes(legacyKey)) {
            newKeys.push(legacyKey);
        }

        this.keys = newKeys;
        this.initialized = true;
    },

    getCurrentKey: function(): string {
        if (!this.initialized) this.loadKeys();
        if (this.keys.length === 0) {
            throw new Error("Chave API Gemini não encontrada no Cloudflare ou LocalStorage.");
        }
        return this.keys[this.currentIndex];
    },

    rotate: function(): boolean {
        if (this.keys.length <= 1) return false;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return true;
    }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRateLimitHandling<T>(apiCall: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 5; 
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await apiCall();
        } catch (error: any) {
            const msg = error?.message?.toLowerCase() || '';
            if (attempt === MAX_RETRIES || msg.includes('quota') || msg.includes('limit')) {
                // Tenta rotacionar se houver mais de uma chave (LocalStorage)
                if (KeyManager.rotate()) continue;
                throw error;
            }
            await delay(Math.pow(2, attempt) * 1000);
        }
    }
    throw new Error("Falha na API.");
}

async function callModel(
    model: string,
    systemInstruction: string,
    userPrompt: string,
    config: {
        jsonOutput?: boolean;
        responseSchema?: any;
        googleSearch?: boolean;
    } = {}
): Promise<GenerateContentResponse> {
    if (model.startsWith('gemini-')) {
        // Inicializa o cliente com a chave prioritária (Cloudflare)
        const ai = new GoogleGenAI({ apiKey: KeyManager.getCurrentKey() });
        return withRateLimitHandling(() => ai.models.generateContent({
            model: model,
            contents: userPrompt,
            config: {
                systemInstruction: systemInstruction,
                ...(config.jsonOutput && { responseMimeType: "application/json" }),
                ...(config.responseSchema && { responseSchema: config.responseSchema }),
                ...(config.googleSearch && { tools: [{ googleSearch: {} }] }),
            },
        }));
    } else if (model.startsWith('grok-')) {
        const apiKey = localStorage.getItem('xai_api_key');
        if (!apiKey) throw new Error("Chave x.ai não encontrada.");
        const apiCall = async () => {
            const res = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }],
                    temperature: 0,
                })
            });
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            return { candidates: [{ content: { parts: [{ text }] } }], text } as any;
        };
        return withRateLimitHandling(apiCall);
    }
    throw new Error(`Modelo não suportado: ${model}`);
}

export async function generatePaperTitle(topic: string, language: Language, model: string, discipline: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const response = await callModel(model, `Atue como pesquisador em ${discipline}.`, `Gere um título para: "${topic}". Idioma: ${languageName}. Apenas o texto.`);
    return response.text?.trim().replace(/"/g, '') || 'Untitled Paper';
}

function postProcessLatex(latexCode: string): string {
    let code = latexCode;
    code = code.replace(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g, '');
    code = code.replace(/\\includegraphics\s*(\[.*?\])?\s*\{.*?\}/g, '');
    if (!code.includes('\\end{document}')) code += '\n\\end{document}';
    return code;
}

function extractLatexFromResponse(text: string): string {
    const match = text.match(/```latex\s*([\s\S]*?)\s*```/);
    if (match) return match[1].trim();
    return text.replace(/```latex|```/g, '').trim();
}

export async function generateInitialPaper(title: string, language: Language, pageCount: number, model: string, authorDetails: PersonalData[]): Promise<{ paper: string, sources: PaperSource[] }> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const babelLanguage = BABEL_LANG_MAP[language];
    const latexAuthorsBlock = authorDetails.map(a => `${a.name}\\\\ ${a.affiliation}`).join(' \\and\n');
    let template = ARTICLE_TEMPLATE.replace('% Babel package will be added dynamically based on language', `\\usepackage[${babelLanguage}]{babel}`)
                                  .replace('__ALL_AUTHORS_LATEX_BLOCK__', latexAuthorsBlock);
    const response = await callModel(model, `Escreva um artigo acadêmico em LaTeX. Idioma: ${languageName}.`, `Título: "${title}". Use o template:\n${template}`, { googleSearch: true });
    const paper = extractLatexFromResponse(response.text || '');
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.filter(c => c.web).map(c => ({ uri: c.web.uri, title: c.web.title })) || [];
    return { paper: postProcessLatex(paper), sources };
}

export async function analyzePaper(paperContent: string, pageCount: number, model: string): Promise<AnalysisResult> {
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            analysis: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: { topicNum: { type: Type.NUMBER }, score: { type: Type.NUMBER }, improvement: { type: Type.STRING } },
                    required: ["topicNum", "score", "improvement"],
                },
            },
        },
        required: ["analysis"],
    };
    const response = await callModel(model, `Analise o artigo científico seguindo o esquema JSON rigorosamente.`, paperContent, { jsonOutput: true, responseSchema });
    return JSON.parse(response.text || '{}');
}

export async function improvePaper(paperContent: string, analysis: AnalysisResult, language: Language, model: string): Promise<string> {
    const feedback = analysis.analysis.filter(a => a.score < 8.5).map(a => `- ${a.improvement}`).join('\n');
    const response = await callModel(model, `Editor acadêmico: melhore o LaTeX com base no feedback. Retorne apenas o código.`, `Feedback:\n${feedback}\n\nCódigo:\n${paperContent}`);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}

export async function fixLatexPaper(paperContent: string, compilationError: string, model: string): Promise<string> {
    const response = await callModel(model, `Corrija erros de LaTeX baseando-se no log de erro.`, `Erro:\n${compilationError}\n\nCódigo:\n${paperContent}`);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}

export async function reformatPaperWithStyleGuide(paperContent: string, styleGuide: StyleGuide, model: string): Promise<string> {
    const response = await callModel(model, `Reformate referências para o estilo ${styleGuide}.`, paperContent);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}
