
import React, { useState, useEffect, useRef } from 'react';
import { generateInitialPaper, analyzePaper, improvePaper, generatePaperTitle, fixLatexPaper, reformatPaperWithStyleGuide } from './services/geminiService';
import type { Language, IterationAnalysis, PaperSource, AnalysisResult, StyleGuide, ArticleEntry, PersonalData } from './types';
import { LANGUAGES, AVAILABLE_MODELS, ANALYSIS_TOPICS, getAllDisciplines, getRandomTopic, TOTAL_ITERATIONS, DISCIPLINE_AUTHORS, STYLE_GUIDES } from './constants';

import LanguageSelector from './components/LanguageSelector';
import ModelSelector from './components/ModelSelector';
import PageSelector from './components/PageSelector';
import ActionButton from './components/ActionButton';
import ProgressBar from './components/ProgressBar';
import ResultsDisplay from './components/ResultsDisplay';
import SourceDisplay from './components/SourceDisplay';
import LatexCompiler from './components/LatexCompiler';
import ApiKeyModal from './components/ApiKeyModal';
import StyleGuideSelector from './components/StyleGuideSelector';
import ZenodoUploader, { type ZenodoUploaderRef } from './components/ZenodoUploader';
import PersonalDataModal from './components/PersonalDataModal';

declare const pdfjsLib: any;
declare const window: any;

type Author = {
    name: string;
    affiliation: string;
    orcid: string;
};

const App: React.FC = () => {
    const [step, setStep] = useState(1);
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isPersonalDataModalOpen, setIsPersonalDataModalOpen] = useState(false);
    const [hasGeminiKey, setHasGeminiKey] = useState(false);

    // == STEP 1: GENERATION STATE ==
    const [language, setLanguage] = useState<Language>('en');
    const [generationModel, setGenerationModel] = useState('gemini-3-pro-preview');
    const [analysisModel, setAnalysisModel] = useState('gemini-3-flash-preview');
    const [pageCount, setPageCount] = useState(10);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('');
    const [generatedTitle, setGeneratedTitle] = useState('');
    const [analysisResults, setAnalysisResults] = useState<IterationAnalysis[]>([]);
    const [paperSources, setPaperSources] = useState<PaperSource[]>([]);
    const [finalLatexCode, setFinalLatexCode] = useState('');
    const isGenerationCancelled = useRef(false);
    const [numberOfArticles, setNumberOfArticles] = useState(1);
    const [articleEntries, setArticleEntries] = useState<ArticleEntry[]>(() => {
        try {
            const stored = localStorage.getItem('article_entries_log');
            return stored ? JSON.parse(stored) : [];
        } catch { return []; }
    });
    const [selectedDiscipline, setSelectedDiscipline] = useState<string>(getAllDisciplines()[0]);

    // == STEP 2: COMPILE STATE ==
    const [latexCode, setLatexCode] = useState(`% O código LaTeX gerado aparecerá aqui.`);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
    const [compiledPdfFile, setCompiledPdfFile] = useState<File | null>(null);

    const [authors, setAuthors] = useState<PersonalData[]>(() => {
        try {
            const stored = localStorage.getItem('all_authors_data');
            return stored ? JSON.parse(stored) : [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        } catch { return [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }]; }
    });

    const [isContinuousMode, setIsContinuousMode] = useState(() => localStorage.getItem('isContinuousMode') === 'true');
    const uploaderRef = useRef<ZenodoUploaderRef>(null);

    // Efeito para verificar se já existe uma chave ou se estamos no AI Studio
    useEffect(() => {
        const checkKey = async () => {
            // Se já existe uma chave injetada via Cloudflare env, consideramos conectado
            if (process.env.API_KEY && process.env.API_KEY !== "undefined") {
                setHasGeminiKey(true);
                return;
            }

            // Caso contrário, tenta a API do AI Studio
            if (window.aistudio?.hasSelectedApiKey) {
                try {
                    const has = await window.aistudio.hasSelectedApiKey();
                    setHasGeminiKey(has);
                } catch (e) {
                    console.error("Erro ao verificar chave no AI Studio:", e);
                }
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        if (window.aistudio?.openSelectKey) {
            try {
                await window.aistudio.openSelectKey();
                setHasGeminiKey(true);
            } catch (e) {
                alert("Falha ao abrir o seletor de chaves. Verifique se o bloqueador de popups está ativo.");
            }
        } else {
            alert("⚠️ Ambiente Não Suportado:\n\nO seletor de chaves nativo só funciona dentro do Google AI Studio ou Cloudflare Pages com a integração ativa.\n\nSe você está no Cloudflare Pages, configure a variável de ambiente GEMINI_API_KEY no seu painel de controle.");
        }
    };

    const handleFullAutomation = async (batchSizeOverride?: number) => {
        if (!hasGeminiKey) {
            await handleSelectKey();
            if (!hasGeminiKey && !process.env.API_KEY) return;
        }

        const articlesToProcess = batchSizeOverride ?? (isContinuousMode ? 1 : numberOfArticles);
        const storedToken = localStorage.getItem('zenodo_api_key');
        if (!storedToken) {
            alert('❌ Token Zenodo não encontrado nas configurações (ícone de engrenagem)!');
            return;
        }

        isGenerationCancelled.current = false;
        setIsGenerating(true);
        setStep(1);
        
        for (let i = 1; i <= articlesToProcess; i++) {
            if (isGenerationCancelled.current) break;
            const articleEntryId = crypto.randomUUID();
            let temporaryTitle = `Artigo ${i}`;
            let currentPaper = '';

            try {
                setGenerationProgress(5);
                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Gerando título...`);
                const randomTopic = getRandomTopic(selectedDiscipline);
                temporaryTitle = await generatePaperTitle(randomTopic, language, analysisModel, selectedDiscipline);
                setGeneratedTitle(temporaryTitle);

                setGenerationProgress(15);
                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Gerando conteúdo inicial...`);
                const { paper: initialPaper } = await generateInitialPaper(temporaryTitle, language, pageCount, generationModel, authors);
                currentPaper = initialPaper;

                for (let iter = 1; iter <= TOTAL_ITERATIONS; iter++) {
                    if (isGenerationCancelled.current) break;
                    setGenerationProgress(15 + (iter / TOTAL_ITERATIONS) * 75);
                    setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Analisando iteração ${iter}...`);
                    const analysis = await analyzePaper(currentPaper, pageCount, analysisModel);
                    
                    if (iter < TOTAL_ITERATIONS) {
                        setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Refinando iteração ${iter}...`);
                        currentPaper = await improvePaper(currentPaper, analysis, language, generationModel);
                    }
                }

                setFinalLatexCode(currentPaper);
                setGenerationProgress(95);
                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Compilando PDF...`);
                const { pdfUrl } = await robustCompile(currentPaper, (msg) => setGenerationStatus(`Artigo ${i}/${articlesToProcess}: ${msg}`));
                setPdfPreviewUrl(pdfUrl);
                
                setArticleEntries(prev => {
                    const newLog = [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: 'published' as const, link: '#' }];
                    localStorage.setItem('article_entries_log', JSON.stringify(newLog));
                    return newLog;
                });
            } catch (error: any) {
                console.error(error);
                if (error.message?.toLowerCase().includes('requested entity was not found')) {
                    setGenerationStatus("🔑 Erro de Chave: Por favor, re-selecione sua API Key.");
                    setHasGeminiKey(false);
                    await handleSelectKey();
                    i--; continue;
                }
                setArticleEntries(prev => {
                    const newLog = [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: 'upload_failed' as const, errorMessage: error.message }];
                    localStorage.setItem('article_entries_log', JSON.stringify(newLog));
                    return newLog;
                });
            }
        }
        setIsGenerating(false);
        setGenerationProgress(100);
    };

    const robustCompile = async (code: string, onUpdate: (m: string) => void): Promise<{ pdfFile: File; pdfUrl: string; finalCode: string }> => {
        onUpdate("Iniciando compilação...");
        const response = await fetch('/compile-latex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latex: code }),
        });
        if (!response.ok) throw new Error("Falha na compilação do LaTeX.");
        const base64 = await response.text();
        const pdfUrl = `data:application/pdf;base64,${base64}`;
        const res = await fetch(pdfUrl);
        const blob = await res.blob();
        const file = new File([blob], "paper.pdf", { type: "application/pdf" });
        setCompiledPdfFile(file);
        return { pdfFile: file, pdfUrl, finalCode: code };
    };

    const handleSavePersonalData = (data: PersonalData[]) => {
        setAuthors(data);
        localStorage.setItem('all_authors_data', JSON.stringify(data));
        setIsPersonalDataModalOpen(false);
    };

    return (
        <div className="container">
            <ApiKeyModal 
                isOpen={isApiModalOpen} 
                onClose={() => setIsApiModalOpen(false)} 
                onSave={(keys) => { 
                    if (keys.zenodo) localStorage.setItem('zenodo_api_key', keys.zenodo); 
                    if (keys.xai) localStorage.setItem('xai_api_key', keys.xai); 
                    setIsApiModalOpen(false); 
                }} 
            />
            <PersonalDataModal isOpen={isPersonalDataModalOpen} onClose={() => setIsPersonalDataModalOpen(false)} onSave={handleSavePersonalData} initialData={authors} />
            
            <div className="main-header">
                <div className="flex justify-between items-center">
                    <div>
                        <h1>🔬 Fluxo de Publicação Científica</h1>
                        <p>AI Generator → LaTeX → Zenodo</p>
                    </div>
                    <div className="flex gap-4 items-center">
                        <button 
                            onClick={handleSelectKey} 
                            className={`px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-2 ${hasGeminiKey ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-indigo-600 text-white animate-pulse'}`}
                        >
                            {hasGeminiKey ? (
                                <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg> Gemini Conectado</>
                            ) : (
                                <><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg> Conectar Gemini</>
                            )}
                        </button>
                        <button onClick={() => setIsPersonalDataModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full" title="Dados Pessoais"><svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></button>
                        <button onClick={() => setIsApiModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full" title="Configurações API"><svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                    </div>
                </div>
            </div>

            <div className="workflow-steps">
                {['Gerar', 'Compilar', 'Publicar', 'Histórico'].map((title, i) => (
                    <div key={i} className={`step-card ${step === i + 1 ? 'active' : ''}`} onClick={() => setStep(i + 1)}>
                        <div className="step-number">{i + 1}</div>
                        <div className="step-title">{title}</div>
                    </div>
                ))}
            </div>

            {step === 1 && (
                <div className="card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <LanguageSelector languages={LANGUAGES} selectedLanguage={language} onSelect={setLanguage} />
                            <ModelSelector models={AVAILABLE_MODELS} selectedModel={generationModel} onSelect={setGenerationModel} label="Modelo de Geração:" />
                            <PageSelector options={[10]} selectedPageCount={pageCount} onSelect={setPageCount} />
                            <div className="mt-4 mb-6">
                                <label className="font-bold mb-2 block">Disciplina de Pesquisa:</label>
                                <select value={selectedDiscipline} onChange={(e) => setSelectedDiscipline(e.target.value)} className="w-full p-3 border rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-indigo-500">
                                    {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <ActionButton onClick={handleFullAutomation} disabled={isGenerating} isLoading={isGenerating} text="Iniciar Geração Automática" loadingText="IA Trabalhando..." />
                        </div>
                        <div className="bg-gray-50 p-6 rounded-xl min-h-[400px] border border-gray-200">
                            {isGenerating ? (
                                <>
                                    <h3 className="text-lg font-bold text-gray-800 mb-4">Status da Geração</h3>
                                    <ProgressBar progress={generationProgress} isVisible={true} />
                                    <p className="text-center font-medium mt-4 text-indigo-700">{generationStatus}</p>
                                    <div className="mt-6">
                                        <ResultsDisplay analysisResults={analysisResults} totalIterations={TOTAL_ITERATIONS} />
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                                    <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                    <p className="text-center">Aguardando configurações.<br/>Clique em "Iniciar" para começar a mágica.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            {step === 2 && (
                <div className="card">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <LatexCompiler code={latexCode} onCodeChange={setLatexCode} />
                        <div className="space-y-4">
                            <h3 className="text-xl font-bold">Pré-visualização do PDF</h3>
                            <div className="iframe-container shadow-inner bg-gray-100 rounded-lg flex items-center justify-center">
                                {pdfPreviewUrl ? (
                                    <iframe src={pdfPreviewUrl} title="PDF Preview" className="w-full h-full rounded-lg"></iframe>
                                ) : (
                                    <p className="text-gray-400">Gere um artigo primeiro para ver o PDF aqui.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="card max-w-2xl mx-auto">
                    <ZenodoUploader 
                        ref={uploaderRef} 
                        title={generatedTitle} 
                        abstractText="Resumo gerado automaticamente pela IA." 
                        keywords="AI, Research, LaTeX" 
                        authors={authors} 
                        compiledPdfFile={compiledPdfFile} 
                        onFileSelect={() => {}} 
                        onPublishStart={() => {}} 
                        onPublishSuccess={(res) => alert(`Sucesso! DOI: ${res.doi}`)} 
                        onPublishError={(msg) => alert(`Erro: ${msg}`)} 
                        extractedMetadata={null} 
                    />
                    <button onClick={() => uploaderRef.current?.submit()} className="btn btn-success w-full mt-6 py-4 text-xl">🚀 Publicar no Zenodo</button>
                </div>
            )}

            {step === 4 && (
                <div className="card overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold">Histórico de Publicações</h2>
                        <button onClick={() => { localStorage.removeItem('article_entries_log'); setArticleEntries([]); }} className="text-red-600 hover:text-red-800 text-sm font-semibold">Limpar Histórico</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Título</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {articleEntries.length === 0 ? (
                                    <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-500">Nenhum artigo encontrado.</td></tr>
                                ) : (
                                    articleEntries.map(entry => (
                                        <tr key={entry.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{entry.title}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(entry.date).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${entry.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                    {entry.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-600 font-bold"><a href={entry.link} target="_blank" rel="noreferrer">Ver no Zenodo</a></td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
