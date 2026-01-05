
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import type { Language, AnalysisResult, PaperSource, StyleGuide, PersonalData } from '../types';
import { LANGUAGES } from '../constants';
import { ARTICLE_TEMPLATE } from './articleTemplate';

const BABEL_LANG_MAP: Record<Language, string> = {
    en: 'english',
    pt: 'brazilian',
    es: 'spanish',
    fr: 'french',
};

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
    // IMPORTANTE: Buscar a API_KEY dentro da função para refletir mudanças do diálogo
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'undefined' || apiKey === '') {
        throw new Error("API Key não encontrada. Use o botão 'Conectar Gemini' no topo.");
    }

    // Criar nova instância a cada chamada para garantir o uso da chave atual
    const ai = new GoogleGenAI({ apiKey });
    
    // Ativa o pensamento profundo se for um modelo da série 2.5 ou 3
    const isThinkingModel = model.includes('2.5') || model.includes('3');
    
    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: [{ parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
                ...(config.jsonOutput && { responseMimeType: "application/json" }),
                ...(config.responseSchema && { responseSchema: config.responseSchema }),
                ...(config.googleSearch && { tools: [{ googleSearch: {} }] }),
                ...(isThinkingModel && {
                    thinkingConfig: {
                        // Budget balanceado para modelos 2.5
                        thinkingBudget: model.includes('native-audio') ? 24576 : 12000 
                    }
                })
            },
        });
        return response;
    } catch (error: any) {
        console.error("Gemini API Error Details:", error);
        throw new Error(`Erro na API (${model}): ${error.message || 'Falha na requisição'}`);
    }
}

export async function generatePaperTitle(topic: string, language: Language, model: string, discipline: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const response = await callModel(model, `Pesquisador Sênior em ${discipline}.`, `Gere um título científico para: "${topic}" em ${languageName}. Sem aspas.`);
    return response.text?.trim().replace(/"/g, '') || 'Untitled Paper';
}

export async function generateInitialPaper(title: string, language: Language, pageCount: number, model: string, authorDetails: PersonalData[]): Promise<{ paper: string, sources: PaperSource[] }> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const babelLanguage = BABEL_LANG_MAP[language];
    const authorsStr = authorDetails.map(a => `${a.name} (${a.affiliation})`).join(' \\and ');
    
    let template = ARTICLE_TEMPLATE.replace('% Babel package will be added dynamically based on language', `\\usepackage[${babelLanguage}]{babel}`)
                                  .replace('__ALL_AUTHORS_LATEX_BLOCK__', authorsStr);

    const response = await callModel(model, `Escritor acadêmico especialista em LaTeX. Pense profundamente. Idioma: ${languageName}.`, `Escreva o artigo completo para "${title}" usando este template:\n${template}`, { googleSearch: true });
    
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    const paper = paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
    
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.filter(c => c.web).map(c => ({ 
        uri: c.web.uri, 
        title: c.web.title 
    })) || [];

    return { paper, sources };
}

export async function analyzePaper(paperContent: string, pageCount: number, model: string): Promise<AnalysisResult> {
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
                        improvement: { type: Type.STRING } 
                    },
                    required: ["topicNum", "score", "improvement"],
                },
            },
        },
        required: ["analysis"],
    };

    const response = await callModel(model, `Analista científico rigoroso. Retorno JSON.`, `Analise este artigo LaTeX:\n${paperContent}`, { jsonOutput: true, responseSchema });
    return JSON.parse(response.text || '{"analysis": []}');
}

export async function improvePaper(paperContent: string, analysis: AnalysisResult, language: Language, model: string): Promise<string> {
    const feedback = analysis.analysis.filter(a => a.score < 8.5).map(a => `- ${a.improvement}`).join('\n');
    const response = await callModel(model, `Editor acadêmico. Refine o LaTeX.`, `Melhorias:\n${feedback}\n\nCódigo:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}

export async function fixLatexPaper(paperContent: string, compilationError: string, model: string): Promise<string> {
    const response = await callModel(model, `Corretor de sintaxe LaTeX.`, `Erro:\n${compilationError}\n\nCódigo:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}

export async function reformatPaperWithStyleGuide(paperContent: string, styleGuide: StyleGuide, model: string): Promise<string> {
    const response = await callModel(model, `Normas ${styleGuide}.`, `Aplique as normas ${styleGuide} nas citações deste código:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}
