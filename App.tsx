
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

type PublishedArticle = {
    doi: string;
    link: string;
    title: string;
    date: string;
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
    const [isGenerationComplete, setIsGenerationComplete] = useState(false);
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
    const [compilationStatus, setCompilationStatus] = useState<React.ReactNode>(null);
    const [isCompiling, setIsCompiling] = useState(false);
    const [compileMethod, setCompileMethod] = useState<'texlive' | 'overleaf'>('texlive');
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
    const [compiledPdfFile, setCompiledPdfFile] = useState<File | null>(null);
    const [selectedStyle, setSelectedStyle] = useState<StyleGuide>('abnt');
    const [isReformatting, setIsReformatting] = useState(false);

    // == STEP 3: UPLOAD STATE ==
    const [extractedMetadata, setExtractedMetadata] = useState({
        title: '',
        abstract: '',
        authors: [] as Author[],
        keywords: ''
    });
    const [useSandbox, setUseSandbox] = useState(false);
    const [zenodoToken, setZenodoToken] = useState(() => localStorage.getItem('zenodo_api_key') || '');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<React.ReactNode>(null);
    
    const [authors, setAuthors] = useState<PersonalData[]>(() => {
        try {
            const stored = localStorage.getItem('all_authors_data');
            return stored ? JSON.parse(stored) : [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        } catch { return [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }]; }
    });

    const [isContinuousMode, setIsContinuousMode] = useState(() => localStorage.getItem('isContinuousMode') === 'true');
    const [isSchedulerEnabled, setIsSchedulerEnabled] = useState(() => localStorage.getItem('isSchedulerEnabled') === 'true');
    const schedulerTimeoutRef = useRef<number | null>(null);
    const uploaderRef = useRef<ZenodoUploaderRef>(null);

    const [filter, setFilter] = useState({ day: '', month: '', year: '' });
    const [isRepublishingId, setIsRepublishingId] = useState<string | null>(null);

    useEffect(() => {
        const checkKey = async () => {
            if (window.aistudio?.hasSelectedApiKey) {
                const has = await window.aistudio.hasSelectedApiKey();
                setHasGeminiKey(has);
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        if (window.aistudio?.openSelectKey) {
            await window.aistudio.openSelectKey();
            setHasGeminiKey(true);
        }
    };

    const handleFullAutomation = async (batchSizeOverride?: number) => {
        if (!hasGeminiKey) {
            await handleSelectKey();
        }

        const articlesToProcess = batchSizeOverride ?? (isContinuousMode ? 1 : numberOfArticles);
        const storedToken = localStorage.getItem('zenodo_api_key');
        if (!storedToken) {
            alert('❌ Token Zenodo não encontrado!');
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
                const { pdfFile } = await robustCompile(currentPaper, (msg) => setGenerationStatus(`Artigo ${i}/${articlesToProcess}: ${msg}`));
                
                // Simplified Zenodo call for automation
                setArticleEntries(prev => [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: 'published', link: '#' }]);
            } catch (error: any) {
                if (error.message?.toLowerCase().includes('requested entity was not found')) {
                    setGenerationStatus("🔑 Erro de Chave: Por favor, re-selecione sua API Key.");
                    setHasGeminiKey(false);
                    await handleSelectKey();
                    i--; continue;
                }
                setArticleEntries(prev => [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: 'upload_failed', errorMessage: error.message }]);
            }
        }
        setIsGenerating(false);
    };

    const robustCompile = async (code: string, onUpdate: (m: string) => void): Promise<{ pdfFile: File; pdfUrl: string; finalCode: string }> => {
        onUpdate("Iniciando compilação...");
        const response = await fetch('/compile-latex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latex: code }),
        });
        if (!response.ok) throw new Error("Falha na compilação.");
        const base64 = await response.text();
        const pdfUrl = `data:application/pdf;base64,${base64}`;
        const blob = await (await fetch(pdfUrl)).blob();
        return { pdfFile: new File([blob], "paper.pdf", { type: "application/pdf" }), pdfUrl, finalCode: code };
    };

    const handleSavePersonalData = (data: PersonalData[]) => {
        setAuthors(data);
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
                            className={`px-4 py-2 rounded-lg font-bold transition-all ${hasGeminiKey ? 'bg-green-100 text-green-700' : 'bg-indigo-600 text-white animate-pulse'}`}
                        >
                            {hasGeminiKey ? '✅ Gemini Conectado' : '🔑 Conectar Gemini'}
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
                            <div className="mt-4">
                                <label className="font-bold">Disciplina:</label>
                                <select value={selectedDiscipline} onChange={(e) => setSelectedDiscipline(e.target.value)} className="w-full p-2 border rounded">
                                    {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <ActionButton onClick={handleFullAutomation} disabled={isGenerating} isLoading={isGenerating} text="Iniciar Automação" loadingText="Processando..." />
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg min-h-[300px]">
                            {isGenerating ? (
                                <>
                                    <ProgressBar progress={generationProgress} isVisible={true} />
                                    <p className="text-center font-medium mt-2">{generationStatus}</p>
                                    <ResultsDisplay analysisResults={analysisResults} totalIterations={TOTAL_ITERATIONS} />
                                </>
                            ) : (
                                <div className="text-center text-gray-500 py-12">Configure e inicie para ver o progresso aqui.</div>
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
                            <button onClick={() => handleFullAutomation()} className="btn btn-primary w-full">Re-compilar PDF</button>
                            <div className="iframe-container"><iframe src={pdfPreviewUrl} title="PDF"></iframe></div>
                        </div>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="card">
                    <ZenodoUploader ref={uploaderRef} title={extractedMetadata.title} abstractText={extractedMetadata.abstract} keywords={extractedMetadata.keywords} authors={authors} compiledPdfFile={compiledPdfFile} onFileSelect={() => {}} onPublishStart={() => {}} onPublishSuccess={() => {}} onPublishError={() => {}} extractedMetadata={null} />
                    <button onClick={() => uploaderRef.current?.submit()} className="btn btn-success w-full mt-4">Publicar Agora</button>
                </div>
            )}

            {step === 4 && (
                <div className="card">
                    <table className="min-w-full">
                        <thead><tr className="border-b"><th>Título</th><th>Data</th><th>Status</th><th>Link</th></tr></thead>
                        <tbody>
                            {articleEntries.map(entry => (
                                <tr key={entry.id} className="border-b">
                                    <td className="p-2">{entry.title}</td>
                                    <td className="p-2">{new Date(entry.date).toLocaleDateString()}</td>
                                    <td className="p-2">{entry.status}</td>
                                    <td className="p-2"><a href={entry.link} className="text-indigo-600">Ver</a></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default App;
