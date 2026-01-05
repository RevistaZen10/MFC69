
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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to identify errors that should trigger a re-selection
function isKeyError(error: any): boolean {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return errorMessage.includes('requested entity was not found');
}

async function withRateLimitHandling<T>(apiCall: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await apiCall();
        } catch (error: any) {
            const errStr = error?.message?.toLowerCase() || '';
            if (isKeyError(error)) throw error; // Let App handle re-selection
            if (attempt === MAX_RETRIES) throw error;
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            await delay(backoff);
        }
    }
    throw new Error("API call failed after retries.");
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
    // Determine standard models based on user intent
    let targetModel = model;
    if (model === 'gemini-2.5-flash' || model === 'gemini-2.0-flash' || model === 'gemini-2.0-flash-lite') {
        targetModel = 'gemini-3-flash-preview';
    } else if (model === 'gemini-2.5-pro' || model === 'gemini-3-pro-preview') {
        targetModel = 'gemini-3-pro-preview';
    }

    return withRateLimitHandling(async () => {
        // ALWAYS create a new instance right before use
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: targetModel,
            contents: userPrompt,
            config: {
                systemInstruction: systemInstruction,
                ...(config.jsonOutput && { responseMimeType: "application/json" }),
                ...(config.responseSchema && { responseSchema: config.responseSchema }),
                ...(config.googleSearch && { tools: [{ googleSearch: {} }] }),
            },
        });
        return response;
    });
}

export async function generatePaperTitle(topic: string, language: Language, model: string, discipline: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const systemInstruction = `Act as an expert academic researcher in ${discipline}. Generate a single, compelling, high-impact scientific paper title.`;
    const userPrompt = `Topic: "${topic}" in ${discipline}. Language: ${languageName}. Constraint: Return ONLY the title text. No quotes.`;

    const response = await callModel(model, systemInstruction, userPrompt);
    return response.text?.trim().replace(/"/g, '') || 'Untitled Paper';
}

function postProcessLatex(latexCode: string): string {
    let code = latexCode;
    code = code.replace(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g, '');
    code = code.replace(/\\includegraphics\s*(\[.*?\])?\s*\{.*?\}/g, '');
    code = code.replace(/\\captionof\s*\{figure\}\s*\{.*?\}/g, '');
    code = code.replace(/,?\s+&\s+/g, ' and ');
    code = code.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g, '');

    const environments = ['itemize', 'enumerate', 'description'];
    environments.forEach(env => {
        const beginRegex = new RegExp(`\\\\begin\\{${env}\\}`, 'g');
        const endRegex = new RegExp(`\\\\end\\{${env}\\}`, 'g');
        const openCount = (code.match(beginRegex) || []).length;
        const closeCount = (code.match(endRegex) || []).length;
        if (openCount > closeCount) {
            const closingTags = `\\end{${env}}`.repeat(openCount - closeCount);
            const docEndIdx = code.lastIndexOf('\\end{document}');
            if (docEndIdx !== -1) {
                code = code.substring(0, docEndIdx) + `\n${closingTags}\n` + code.substring(docEndIdx);
            } else {
                code += `\n${closingTags}`;
            }
        }
    });

    if (!code.includes('\\end{document}')) code += '\n\\end{document}';
    const docClassIdx = code.indexOf('\\documentclass');
    if (docClassIdx > 0) code = code.substring(docClassIdx);
    return code;
}

function extractLatexFromResponse(text: string): string {
    if (!text) return '';
    const match = text.match(/```latex\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return match[1].trim();
    let cleaned = text.trim();
    if (cleaned.startsWith('```latex')) cleaned = cleaned.substring(8);
    else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
    return cleaned.trim();
}

async function fetchSemanticScholarPapers(query: string, limit: number = 5): Promise<SemanticScholarPaper[]> {
    try {
        const fields = 'paperId,title,authors,abstract,url';
        const response = await fetch(`/semantic-proxy?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.data || [];
    } catch {
        return [];
    }
}

export async function generateInitialPaper(title: string, language: Language, pageCount: number, model: string, authorDetails: PersonalData[]): Promise<{ paper: string, sources: PaperSource[] }> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const babelLanguage = BABEL_LANG_MAP[language];
    const referenceCount = 10;

    const semanticScholarPapers = await fetchSemanticScholarPapers(title, referenceCount);
    const semanticScholarContext = semanticScholarPapers.length > 0
        ? "\n\n**Academic Sources:**\n" + semanticScholarPapers.map(p => `- Title: ${p.title}\n Authors: ${p.authors.map(a => a.name).join(', ')}`).join('\n')
        : "";

    const latexAuthorsBlock = authorDetails.map(author => {
        const name = author.name || 'Unknown Author';
        const affiliation = author.affiliation ? `\\\\ ${author.affiliation}` : '';
        const orcid = author.orcid ? `\\\\ \\small ORCID: \\url{https://orcid.org/${author.orcid}}` : '';
        return `${name}${affiliation}${orcid}`;
    }).join(' \\and\n');

    const pdfAuthorNames = authorDetails.map(a => a.name).filter(Boolean).join(', ');

    const systemInstruction = `Act as an expert AI LaTeX scientific writer. Write a complete, rigorous paper based on the title. Use valid LaTeX. No images. Language: ${languageName}. Generate ${referenceCount} unique academic references as plain paragraphs.`;

    let template = ARTICLE_TEMPLATE.replace('% Babel package will be added dynamically based on language', `\\usepackage[${babelLanguage}]{babel}`)
        .replace('[INSERT REFERENCE COUNT]', String(referenceCount))
        .replace('[INSERT NEW REFERENCE LIST HERE]', Array.from({ length: referenceCount }, (_, i) => `\\noindent [REF ${i + 1} PLACEHOLDER] \\par`).join('\n\n'))
        .replace('__ALL_AUTHORS_LATEX_BLOCK__', latexAuthorsBlock)
        .replace('pdfauthor={__PDF_AUTHOR_NAMES_PLACEHOLDER__}', `pdfauthor={${pdfAuthorNames}}`);

    const userPrompt = `Title: "${title}". ${semanticScholarContext}\n\n**Template:**\n\`\`\`latex\n${template}\n\`\`\``;

    const response = await callModel(model, systemInstruction, userPrompt, { googleSearch: true });
    let paper = extractLatexFromResponse(response.text || '');
    return { paper: postProcessLatex(paper), sources: [] };
}

export async function analyzePaper(paperContent: string, pageCount: number, model: string): Promise<AnalysisResult> {
    const systemInstruction = `Act as an expert academic reviewer. Return JSON only: { "analysis": [ { "topicNum": number, "score": number, "improvement": string } ] }. Evaluate 28 criteria.`;
    
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            analysis: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        topicNum: { type: Type.NUMBER },
                        score: { type: Type.NUMBER },
                        improvement: { type: Type.STRING },
                    },
                    required: ["topicNum", "score", "improvement"],
                },
            },
        },
        required: ["analysis"],
    };

    const response = await callModel(model, systemInstruction, paperContent.substring(0, 10000), {
        jsonOutput: true,
        responseSchema: responseSchema
    });

    try {
        const text = response.text || '{}';
        const cleaned = text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        return JSON.parse(cleaned) as AnalysisResult;
    } catch {
        return { analysis: [] };
    }
}

export async function improvePaper(paperContent: string, analysis: AnalysisResult, language: Language, model: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const points = analysis.analysis.filter(a => a.score < 8.5).map(a => `- ${a.improvement}`).join('\n');

    const systemInstruction = `Act as an expert LaTeX editor. Refine the body content based on: ${points}. Return valid LaTeX body only. Language: ${languageName}.`;
    const userPrompt = `Refine this content:\n${paperContent}`;

    const response = await callModel(model, systemInstruction, userPrompt);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}

export async function fixLatexPaper(paperContent: string, compilationError: string, model: string): Promise<string> {
    const systemInstruction = `Fix the following LaTeX compilation error. Return the full fixed document. Error: ${compilationError}`;
    const response = await callModel(model, systemInstruction, paperContent);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}

export async function reformatPaperWithStyleGuide(paperContent: string, styleGuide: StyleGuide, model: string): Promise<string> {
    const systemInstruction = `Reformat the References section of this paper to ${styleGuide.toUpperCase()} style. Return the full document.`;
    const response = await callModel(model, systemInstruction, paperContent);
    return postProcessLatex(extractLatexFromResponse(response.text || ''));
}
