
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
    // IMPORTANTE: Buscar a API_KEY diretamente de process.env.API_KEY
    // Se for injetada via dialog ou Cloudflare, ela estará disponível aqui.
    let apiKey = process.env.API_KEY;
    
    // Tratamento para strings que representam 'vazio' ou 'indefinido' provenientes do ambiente
    if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey === '') {
        throw new Error("API Key não encontrada. Clique no botão 'Conectar Gemini' no topo para selecionar uma chave válida.");
    }

    // Criar nova instância a cada chamada conforme diretrizes para garantir o uso da chave mais recente
    const ai = new GoogleGenAI({ apiKey });
    
    // Ativa o pensamento profundo (Thinking Config) para modelos da série 2.5
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
                        thinkingBudget: 16000 
                    }
                })
            },
        });
        return response;
    } catch (error: any) {
        console.error("Gemini API Error Detail:", error);
        
        // Erro comum de cota ou projeto não pago ao usar modelos preview
        if (error.message?.includes("Requested entity was not found")) {
            throw new Error("Sua chave de API pode não ter acesso a este modelo. Tente selecionar uma chave de um projeto com faturamento ativado.");
        }
        
        throw new Error(`Erro na API (${model}): ${error.message || 'Falha na comunicação com a IA'}`);
    }
}

export async function generatePaperTitle(topic: string, language: Language, model: string, discipline: string): Promise<string> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const response = await callModel(model, `Pesquisador Sênior em ${discipline}.`, `Gere um título científico para: "${topic}" em ${languageName}. Retorne apenas o texto, sem aspas.`);
    return response.text?.trim().replace(/"/g, '') || 'Untitled Paper';
}

export async function generateInitialPaper(title: string, language: Language, pageCount: number, model: string, authorDetails: PersonalData[]): Promise<{ paper: string, sources: PaperSource[] }> {
    const languageName = LANGUAGES.find(l => l.code === language)?.name || 'English';
    const babelLanguage = BABEL_LANG_MAP[language];
    const authorsStr = authorDetails.map(a => `${a.name} (${a.affiliation})`).join(' \\and ');
    
    let template = ARTICLE_TEMPLATE.replace('% Babel package will be added dynamically based on language', `\\usepackage[${babelLanguage}]{babel}`)
                                  .replace('__ALL_AUTHORS_LATEX_BLOCK__', authorsStr);

    const response = await callModel(model, `Escritor acadêmico especialista em LaTeX. Use raciocínio profundo para densidade científica. Idioma: ${languageName}.`, `Escreva o artigo completo para "${title}" usando rigorosamente este template:\n${template}`, { googleSearch: true });
    
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

    const response = await callModel(model, `Analista de periódicos científicos. Retorno JSON rigoroso.`, `Analise este artigo LaTeX:\n${paperContent}`, { jsonOutput: true, responseSchema });
    return JSON.parse(response.text || '{"analysis": []}');
}

export async function improvePaper(paperContent: string, analysis: AnalysisResult, language: Language, model: string): Promise<string> {
    const feedback = analysis.analysis.filter(a => a.score < 8.5).map(a => `- ${a.improvement}`).join('\n');
    const response = await callModel(model, `Editor-chefe acadêmico. Refine o LaTeX aplicando as melhorias solicitadas.`, `Melhorias:\n${feedback}\n\nCódigo:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}

export async function fixLatexPaper(paperContent: string, compilationError: string, model: string): Promise<string> {
    const response = await callModel(model, `Especialista em depuração de LaTeX.`, `Corrija o código abaixo com base no erro de compilação:\nErro:\n${compilationError}\n\nCódigo:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}

export async function reformatPaperWithStyleGuide(paperContent: string, styleGuide: StyleGuide, model: string): Promise<string> {
    const response = await callModel(model, `Formatador de normas ${styleGuide}.`, `Aplique estritamente as normas ${styleGuide} nas citações deste código:\n${paperContent}`);
    const text = response.text || '';
    const paperMatch = text.match(/```latex\s*([\s\S]*?)\s*```/);
    return paperMatch ? paperMatch[1].trim() : text.replace(/```latex|```/g, '').trim();
}
