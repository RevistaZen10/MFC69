
import React, { useState, useEffect, useRef } from 'react';
import { generateInitialPaper, analyzePaper, improvePaper, generatePaperTitle, fixLatexPaper, reformatPaperWithStyleGuide } from './services/geminiService';
import type { Language, IterationAnalysis, PaperSource, AnalysisResult, StyleGuide, ArticleEntry, PersonalData } from './types';
import { LANGUAGES, AVAILABLE_MODELS, ANALYSIS_TOPICS, ALL_TOPICS_BY_DISCIPLINE, getAllDisciplines, getRandomTopic, FIX_OPTIONS, STYLE_GUIDES, TOTAL_ITERATIONS, DISCIPLINE_AUTHORS } from './constants';


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
    
    // Verificação de chave prioritária: Cloudflare (process.env.API_KEY)
    const [hasGeminiKey, setHasGeminiKey] = useState(() => {
        const envKey = process.env.API_KEY;
        return !!(envKey && envKey !== 'undefined' && envKey !== '');
    });

    const [language, setLanguage] = useState<Language>('en');
    // Modelos atualizados para gemini-3-flash-preview conforme diretrizes
    const [generationModel, setGenerationModel] = useState('gemini-3-flash-preview');
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

    const [latexCode, setLatexCode] = useState(`% O código LaTeX gerado aparecerá aqui.`);
    const [compilationStatus, setCompilationStatus] = useState<React.ReactNode>(null);
    const [isCompiling, setIsCompiling] = useState(false);
    const [compileMethod, setCompileMethod] = useState<'texlive' | 'overleaf'>('texlive');
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
    const [compiledPdfFile, setCompiledPdfFile] = useState<File | null>(null);
    const [selectedStyle, setSelectedStyle] = useState<StyleGuide>('abnt');
    const [isReformatting, setIsReformatting] = useState(false);

    const [extractedMetadata, setExtractedMetadata] = useState({
        title: '', abstract: '', authors: [] as Author[], keywords: ''
    });
    const [useSandbox, setUseSandbox] = useState(false);
    const [zenodoToken, setZenodoToken] = useState(() => localStorage.getItem('zenodo_api_key') || '');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<React.ReactNode>(null);
    const [keywordsInput, setKeywordsInput] = useState('');
    
    const [authors, setAuthors] = useState<PersonalData[]>(() => {
        try {
            const stored = localStorage.getItem('all_authors_data');
            const parsed = stored ? JSON.parse(stored) : [];
            return parsed.length > 0 ? parsed : [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        } catch {
            return [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        }
    });

    const [isContinuousMode, setIsContinuousMode] = useState(() => localStorage.getItem('isContinuousMode') === 'true');
    const [isSchedulerEnabled, setIsSchedulerEnabled] = useState(() => localStorage.getItem('isSchedulerEnabled') === 'true');
    const uploaderRef = useRef<ZenodoUploaderRef>(null);

    useEffect(() => {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }, []);

    const handleConnectKey = async () => {
        if (hasGeminiKey) return; 
        if (window.aistudio?.openSelectKey) {
            await window.aistudio.openSelectKey();
            setHasGeminiKey(true);
        } else {
            setIsApiModalOpen(true);
        }
    };

    const handleFullAutomation = async () => {
        if (!hasGeminiKey) {
            alert("Por favor, configure a GEMINI_API_KEY no Cloudflare.");
            return;
        }
        setIsGenerating(true);
        setGenerationStatus("Iniciando geração automática...");
        try {
            const topic = getRandomTopic(selectedDiscipline);
            const title = await generatePaperTitle(topic, language, analysisModel, selectedDiscipline);
            setGeneratedTitle(title);
            const { paper, sources } = await generateInitialPaper(title, language, pageCount, generationModel, authors);
            setFinalLatexCode(paper);
            setPaperSources(sources);
            setGenerationStatus("Concluído!");
            setIsGenerationComplete(true);
        } catch (error: any) {
            setGenerationStatus(`Erro: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const getStepCardClass = (id: number) => `step-card cursor-pointer ${step === id ? 'active' : ''} ${step > id ? 'completed' : ''}`;

    return (
        <div className="container">
            <ApiKeyModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} onSave={() => { setHasGeminiKey(true); setIsApiModalOpen(false); }} />
            <PersonalDataModal isOpen={isPersonalDataModalOpen} onClose={() => setIsPersonalDataModalOpen(false)} onSave={(d) => { setAuthors(d); setIsPersonalDataModalOpen(false); }} initialData={authors} />
            
            <div className="main-header">
                <div className="flex justify-between items-center">
                    <div>
                        <h1>🔬 Fluxo Integrado de Publicação Científica</h1>
                        <p>Automação via Cloudflare GEMINI_API_KEY</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <button 
                            onClick={handleConnectKey} 
                            disabled={hasGeminiKey}
                            className={`px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-2 ${hasGeminiKey ? 'bg-green-100 text-green-700 border border-green-200 cursor-default' : 'bg-indigo-600 text-white animate-pulse'}`}
                        >
                            {hasGeminiKey ? "Gemini Conectado" : "Conectar Gemini"}
                        </button>
                        <button onClick={() => setIsApiModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full">⚙️</button>
                    </div>
                </div>
            </div>

            <div className="workflow-steps">
                {[1,2,3,4].map(i => (
                    <div key={i} className={getStepCardClass(i)} onClick={() => setStep(i)}>
                        <div className="step-number">{i}</div>
                        <div className="step-title">{['Gerar', 'Revisar', 'Publicar', 'Histórico'][i-1]}</div>
                    </div>
                ))}
            </div>

            {step === 1 && (
                <div className="card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <LanguageSelector languages={LANGUAGES} selectedLanguage={language} onSelect={setLanguage} />
                            <ModelSelector models={AVAILABLE_MODELS} selectedModel={generationModel} onSelect={setGenerationModel} label="Geração:" />
                            <select value={selectedDiscipline} onChange={e => setSelectedDiscipline(e.target.value)} className="w-full p-2 border rounded">
                                {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <div className="mt-6 text-center">
                                <ActionButton onClick={handleFullAutomation} disabled={isGenerating} isLoading={isGenerating} text="Gerar Artigo" loadingText="Trabalhando..." />
                            </div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                            {isGenerating ? (
                                <><ProgressBar progress={generationProgress} isVisible={true} /><p className="text-center">{generationStatus}</p></>
                            ) : (
                                <div className="text-center p-8">Configurações prontas. Chave detectada automaticamente via Cloudflare.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="card">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <LatexCompiler code={latexCode} onCodeChange={setLatexCode} />
                        <div className="space-y-6">
                            <button onClick={() => setStep(3)} className="btn btn-success w-full">Seguir para Publicação</button>
                        </div>
                    </div>
                </div>
            )}
            
            {step === 4 && (
                <div className="card">
                    <h2 className="text-2xl font-bold mb-4">Artigos Publicados</h2>
                    {articleEntries.map(a => <div key={a.id} className="border-b p-4">{a.title} - {a.status}</div>)}
                </div>
            )}
        </div>
    );
};

export default App;
