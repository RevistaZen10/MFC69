
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import type { Language, AnalysisResult, PaperSource, StyleGuide, SemanticScholarPaper, PersonalData } from '../types';
import { ANALYSIS_TOPICS, LANGUAGES, FIX_OPTIONS, STYLE_GUIDES, SEMANTIC_SCHOLAR_API_BASE_URL } from '../constants';
import { ARTICLE_TEMPLATE } from './articleTemplate'; // Import the single article template

const BABEL_LANG_MAP: Record<Language, string> = {
    en: 'english',
    pt: 'brazilian',
    es: 'spanish',
    fr: 'french',
};

// Internal Key Manager to track rotation state
const KeyManager = {
    keys: [] as string[],
    currentIndex: 0,
    initialized: false,

    loadKeys: function() {
        const envKey = process.env.API_KEY;
        const storedKeys = localStorage.getItem('gemini_api_keys');
        const legacyKey = localStorage.getItem('gemini_api_key');
        
        let newKeys: string[] = [];

        // PRIORIDADE 1: Variável de Ambiente do Cloudflare (GEMINI_API_KEY)
        if (envKey && typeof envKey === 'string' && envKey !== 'undefined' && envKey !== '') {
            newKeys.push(envKey);
        }

        // PRIORIDADE 2: Chaves salvas no LocalStorage
        if (storedKeys) {
            try {
                const parsed = JSON.parse(storedKeys);
                if (Array.isArray(parsed)) {
                    parsed.forEach(k => {
                        if (k && k !== 'undefined' && k !== '' && !newKeys.includes(k)) {
                            newKeys.push(k);
                        }
                    });
                }
            } catch (e) {
                // Ignore parse error
            }
        }
        
        if (legacyKey && legacyKey !== 'undefined' && legacyKey !== '' && !newKeys.includes(legacyKey)) {
            newKeys.push(legacyKey);
        }

        this.keys = newKeys;

        if (!this.initialized && this.keys.length > 0) {
            // Se houver chave do Cloudflare, ela será a primeira (index 0)
            this.currentIndex = 0;
            this.initialized = true;
        } else if (this.keys.length > 0) {
            if (this.currentIndex >= this.keys.length) {
                this.currentIndex = 0;
            }
        }
    },

    getCurrentKey: function(): string {
        this.loadKeys(); 
        if (this.keys.length === 0) {
            throw new Error("Chave API Gemini não encontrada. Verifique o cadastro no Cloudflare ou use o ícone de engrenagem.");
        }
        return this.keys[this.currentIndex];
    },

    rotate: function(): boolean {
        if (this.keys.length <= 1) return false;
        
        const prevIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        console.warn(`🔄 Rotating API Key: Switching from index ${prevIndex} to ${this.currentIndex}`);
        return true;
    }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wrapper to create client with the CURRENT active key
function getAiClient(): GoogleGenAI {
    const apiKey = KeyManager.getCurrentKey();
    return new GoogleGenAI({ apiKey });
}

// Helper to identify errors that should trigger a key rotation (Quota, Rate Limit, Suspension)
function isRotationTrigger(error: any): boolean {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
        errorMessage.includes('429') || 
        errorMessage.includes('quota') || 
        errorMessage.includes('limit') || 
        errorMessage.includes('exhausted') ||
        errorMessage.includes('403') || 
        errorMessage.includes('permission denied') ||
        errorMessage.includes('suspended') ||
        errorMessage.includes('consumer') // often appears in suspension messages
    );
}

// Executes an AI model call with automatic key rotation on Quota/429 errors
async function executeWithKeyRotation<T>(
    operation: (client: GoogleGenAI) => Promise<T>, 
    modelName: string
): Promise<T> {
    
    // Ensure keys are loaded. 
    KeyManager.loadKeys(); 

    const maxAttempts = KeyManager.keys.length > 0 ? KeyManager.keys.length : 1;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const client = getAiClient();
            return await withRateLimitHandling(() => operation(client));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
            const shouldRotate = isRotationTrigger(error);

            if (shouldRotate && KeyManager.keys.length > 1) {
                console.warn(`⚠️ API Key exhausted. Attempting to rotate...`);
                KeyManager.rotate();
                console.log("Waiting 10 seconds before trying next key...");
                await delay(10000); 
                continue; 
            }

            if (attempt === maxAttempts - 1) {
                if (shouldRotate) {
                    throw new Error(`All Gemini API Keys exhausted (Quota/Suspended). Last error: ${errorMessage}`);
                }
                throw error;
            }
            
            throw error; 
        }
    }
    
    throw new Error("All Gemini API Keys exhausted.");
}

async function withRateLimitHandling<T>(apiCall: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 5; 
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await apiCall(); // Success!
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
            
            if (errorMessage.includes('limit: 0') || errorMessage.includes('quota exceeded for metric')) {
                 throw new Error(`API Quota Exceeded (Limit: 0) or Model Unavailable: ${errorMessage}`);
            }

            const shouldRotate = isRotationTrigger(error);
            const hasBackupKeys = KeyManager.keys.length > 1;

            if (shouldRotate && hasBackupKeys) {
                throw error;
            }

            if (attempt === MAX_RETRIES) {
                if (shouldRotate) {
                    throw new Error(`Quota Exceeded or Key Suspended: ${errorMessage}`);
                 }
                 if (errorMessage.includes('503') || errorMessage.includes('overloaded')) {
                    throw new Error("The AI model is temporarily overloaded. Please try again in a few moments.");
                 }
                throw error;
            }

            let backoffTime;
            if (shouldRotate) {
                backoffTime = 8000 + Math.random() * 4000;
            } else {
                backoffTime = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            }
            
            console.log(`Waiting for ${backoffTime.toFixed(0)}ms before retrying...`);
            await delay(backoffTime);
        }
    }
    throw new Error("API call failed after internal retries.");
}

// Central dispatcher for different AI models
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
        try {
            return await executeWithKeyRotation(async (aiClient) => {
                return aiClient.models.generateContent({
                    model: model,
                    contents: userPrompt,
                    config: {
                        systemInstruction: systemInstruction,
                        ...(config.jsonOutput && { responseMimeType: "application/json" }),
                        ...(config.responseSchema && { responseSchema: config.responseSchema }),
                        ...(config.googleSearch && { tools: [{ googleSearch: {} }] }),
                    },
                });
            }, model);
        } catch (error) {
            const errStr = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            const isQuotaExhausted = errStr.includes('exhausted') || errStr.includes('quota') || errStr.includes('limit') || errStr.includes('429');

            if (isQuotaExhausted && model === 'gemini-2.5-flash') {
                const fallbackModel = 'gemini-2.0-flash';
                return await executeWithKeyRotation(async (aiClient) => {
                    return aiClient.models.generateContent({
                        model: fallbackModel,
                        contents: userPrompt,
                        config: {
                            systemInstruction: systemInstruction,
                            ...(config.jsonOutput && { responseMimeType: "application/json" }),
                            ...(config.responseSchema && { responseSchema: config.responseSchema }),
                            ...(config.googleSearch && { tools: [{ googleSearch: {} }] }),
                        },
                    });
                }, fallbackModel);
            }
            throw error;
        }
    } else if (model.startsWith('grok-')) {
        const apiKey = localStorage.getItem('xai_api_key');
        if (!apiKey) {
            throw new Error("x.ai API key not found. Please set it in the settings modal (gear icon).");
        }
        const messages = [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt }
        ];
        const apiCall = async () => {
            const response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: false,
                    temperature: 0,
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`x.ai API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }
            const data = await response.json();
            const text = data.choices?.[0]?.message?.content || '';
            const reconstructedResponse = {
                candidates: [{
                    content: { parts: [{ text: text }], role: 'model' },
                    finishReason: 'STOP',
                    index: 0,
                    safetyRatings: [],
                    groundingMetadata: { groundingChunks: [] }
                }],
                functionCalls: [],
                get text() {
                    return this.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
                }
            };
            return reconstructedResponse as GenerateContentResponse;
        };
        return withRateLimitHandling(apiCall);
    } else {
        throw new Error(`Unsupported model: ${model}`);
    }
}


export async function generatePaperTitle(topic: string, language: Language, model: string, discipline: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const systemInstruction = `Act as an expert academic researcher in ${discipline}. Generate a single, compelling, high-impact scientific paper title.`;
    const userPrompt = `Topic: "${topic}" in ${discipline}. Task: Generate a single, novel, specific, high-impact research title. Language: **${languageName}**. Constraint: Return ONLY the title text. No quotes.`;
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
            const diff = openCount - closeCount;
            const closingTags = `\\end{${env}}`.repeat(diff);
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

function stripLatexComments(text: string): string {
    return text.replace(/(^|[^\\])%.*$/gm, '$1').trim();
}

function extractDocumentBody(latex: string): string {
    const beginTag = '\\begin{document}';
    const endTag = '\\end{document}';
    const startIndex = latex.indexOf(beginTag);
    const endIndex = latex.lastIndexOf(endTag);
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        return latex.substring(startIndex + beginTag.length, endIndex).trim();
    }
    return latex;
}

function extractStrategicContext(latex: string): { text: string, isTruncated: boolean } {
    let combined = "";
    const abstractMatch = latex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i);
    if (abstractMatch) combined += "\\section*{Abstract}\n" + abstractMatch[1].trim() + "\n\n";
    const introMatch = latex.match(/\\section\{(?:Introduction|Introdução)\}([\s\S]*?)(?=\\section\{)/i);
    if (introMatch) {
        combined += "\\section{Introduction}\n" + introMatch[1].trim() + "\n\n";
        combined += "\n% ... [MIDDLE SECTIONS OMITTED FOR EFFICIENCY] ...\n\n";
    }
    const conclusionMatch = latex.match(/\\section\{(?:Conclusion|Conclusão|Considerações Finais)\}([\s\S]*?)(?=\\section\{|\\end\{document\})/i);
    if (conclusionMatch) combined += "\\section{Conclusion}\n" + conclusionMatch[1].trim() + "\n\n";
    if (combined.length < 500) return { text: extractDocumentBody(latex), isTruncated: false };
    return { text: combined, isTruncated: true };
}

async function fetchSemanticScholarPapers(query: string, limit: number = 5): Promise<SemanticScholarPaper[]> {
    try {
        const fields = 'paperId,title,authors,abstract,url'; 
        const response = await fetch(`/semantic-proxy?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`);
        if (!response.ok) throw new Error(`Proxy error: ${response.status}`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error("Error fetching Semantic Scholar:", error);
        return [];
    }
}

export async function generateInitialPaper(title: string, language: Language, pageCount: number, model: string, authorDetails: PersonalData[]): Promise<{ paper: string, sources: PaperSource[] }> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const babelLanguage = BABEL_LANG_MAP[language];
    const referenceCount = 10;
    const referencePlaceholders = Array.from({ length: referenceCount }, (_, i) => `[INSERT REFERENCE ${i + 1} HERE]`).join('\n\n');
    const semanticScholarPapers = await fetchSemanticScholarPapers(title, referenceCount);
    const semanticScholarContext = semanticScholarPapers.length > 0
        ? "\n\n**Additional Academic Sources from Semantic Scholar:**\n" +
          semanticScholarPapers.map(p => `- Title: ${p.title}\n  Authors: ${p.authors.map(a => a.name).join(', ')}\n  Abstract: ${p.abstract || 'N/A'}\n  URL: ${p.url}`).join('\n---\n')
        : "";
    const latexAuthorsBlock = authorDetails.map((author) => {
        const name = author.name || 'Unknown Author';
        const affiliation = author.affiliation ? `\\\\ ${author.affiliation}` : '';
        const orcid = author.orcid ? `\\\\ \\small ORCID: \\url{https://orcid.org/${author.orcid}}` : '';
        return `${name}${affiliation}${orcid}`;
    }).join(' \\and\n'); 
    const pdfAuthorNames = authorDetails.map(a => a.name).filter(Boolean).join(', ');
    const systemInstruction = `Act as a world-class AI specialized in generating LaTeX scientific papers. Write a complete, rigorous paper based on the title, strictly following the provided LaTeX template. **Rules:** NO IMAGES. NO URLs. NO bibitem. Format as plain paragraphs. Language: **${languageName}**.`;
    let templateWithBabelAndAuthor = ARTICLE_TEMPLATE.replace('% Babel package will be added dynamically based on language', `\\usepackage[${babelLanguage}]{babel}`).replace('[INSERT REFERENCE COUNT]', String(referenceCount)).replace('[INSERT NEW REFERENCE LIST HERE]', referencePlaceholders);
    templateWithBabelAndAuthor = templateWithBabelAndAuthor.replace('__ALL_AUTHORS_LATEX_BLOCK__', latexAuthorsBlock);
    templateWithBabelAndAuthor = templateWithBabelAndAuthor.replace('pdfauthor={__PDF_AUTHOR_NAMES_PLACEHOLDER__}', `pdfauthor={${pdfAuthorNames}}`);
    const userPrompt = `Title: "${title}". ${semanticScholarContext}\n**Template:**\n\`\`\`latex\n${templateWithBabelAndAuthor}\n\`\`\``;
    const response = await callModel(model, systemInstruction, userPrompt, { googleSearch: true });
    let paper = extractLatexFromResponse(response.text || '');
    if (!paper.includes('\\end{document}')) paper += '\n\\end{document}';
    const sources: PaperSource[] = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.filter(chunk => chunk.web).map(chunk => ({ uri: chunk.web.uri, title: chunk.web.title })) || [];
    return { paper: postProcessLatex(paper), sources };
}

function cleanJsonOutput(text: string): string {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '');
    if (cleaned.includes("nobreak\nobreak")) throw new Error("Repetition loop detected.");
    return cleaned.trim();
}

export async function analyzePaper(paperContent: string, pageCount: number, model: string): Promise<AnalysisResult> {
    const systemInstruction = `Act as an expert academic reviewer. Perform a rigorous, objective analysis. Return ONLY valid JSON. Schema: { "analysis": [ { "topicNum": number, "score": number, "improvement": string } ] }`;
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
    const estimatedPagesFromChars = Math.max(1, Math.round(paperContent.length / 3000));
    let cleanPaper = stripLatexComments(paperContent);
    cleanPaper = cleanPaper.replace(/\\section\{(?:References|Referências)\}[\s\S]*$/, '');
    const hasUnfilledPlaceholders = cleanPaper.includes('[INSERT NEW CONTENT');
    const contextObj = extractStrategicContext(cleanPaper);
    const paperToAnalyze = contextObj.text;
    const truncationNote = contextObj.isTruncated ? `\n\n**NOTE:** Text is an extract of a ${estimatedPagesFromChars}-page doc.` : "";
    const finalSystemInstruction = systemInstruction + truncationNote;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await callModel(model, finalSystemInstruction, paperToAnalyze, { jsonOutput: true, responseSchema: responseSchema });
            const jsonText = cleanJsonOutput(response.text || '');
            const result = JSON.parse(jsonText) as AnalysisResult;
            if (hasUnfilledPlaceholders) {
                const structureTopicIndex = result.analysis.findIndex(a => a.topicNum === 13);
                const critique = { topicNum: 13, score: 2.0, improvement: "CRITICAL: The document contains unfinished template placeholders." };
                if (structureTopicIndex !== -1) result.analysis[structureTopicIndex] = critique;
                else result.analysis.push(critique);
            }
            return result;
        } catch (error) {
            if (attempt === 3) throw error;
            await delay(2000);
        }
    }
    throw new Error("Unexpected error in analysis loop.");
}

export async function improvePaper(paperContent: string, analysis: AnalysisResult, language: Language, model: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const improvementPoints = analysis.analysis.filter(item => item.score < 8.5).map(item => {
        const topic = ANALYSIS_TOPICS.find(t => t.num === item.topicNum);
        return `- **${topic?.name || 'UNKNOWN'}**: ${item.improvement}`;
    }).join('\n');
    const systemInstruction = `Act as an expert LaTeX editor. Refine the provided paper body. Return valid LaTeX body (starts with \\begin{document}). Language: **${languageName}**.`;
    const cleanPaper = stripLatexComments(paperContent);
    const docStartIndex = cleanPaper.indexOf('\\begin{document}');
    let preamble = "";
    let bodyToImprove = cleanPaper;
    if (docStartIndex !== -1) {
        preamble = cleanPaper.substring(0, docStartIndex);
        bodyToImprove = cleanPaper.substring(docStartIndex);
    }
    const userPrompt = `Context Preamble: ${preamble}\nBody: ${bodyToImprove}\nFeedback: ${improvementPoints}\nTask: Return IMPROVED body.`;
    const response = await callModel(model, systemInstruction, userPrompt);
    let improvedBody = extractLatexFromResponse(response.text || '');
    if (docStartIndex !== -1 && !improvedBody.includes('\\documentclass')) {
        return postProcessLatex(preamble + "\n" + improvedBody);
    } 
    return postProcessLatex(improvedBody);
}

export async function fixLatexPaper(paperContent: string, compilationError: string, model: string): Promise<string> {
    const systemInstruction = `Act as an expert LaTeX debugger. Fix compilation errors. Return full valid LaTeX document.`;
    const userPrompt = `Error: ${compilationError}\nCode:\n\`\`\`latex\n${paperContent}\n\`\`\``;
    const response = await callModel(model, systemInstruction, userPrompt);
    let paper = extractLatexFromResponse(response.text || '');
    if (!paper.includes('\\end{document}')) paper += '\n\\end{document}';
    return postProcessLatex(paper);
}

export async function reformatPaperWithStyleGuide(paperContent: string, styleGuide: StyleGuide, model: string): Promise<string> {
    const styleGuideInfo = STYLE_GUIDES.find(g => g.key === styleGuide);
    const systemInstruction = `Act as academic editor. Reformat ONLY the References section according to ${styleGuideInfo?.name}.`;
    const userPrompt = `Reformat references.\nDocument:\n\`\`\`latex\n${paperContent}\n\`\`\``;
    const response = await callModel(model, systemInstruction, userPrompt);
    let paper = extractLatexFromResponse(response.text || '');
    if (!paper.includes('\\end{document}')) paper += '\n\\end{document}';
    return postProcessLatex(paper);
}
