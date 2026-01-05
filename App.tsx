
import React, { useState, useEffect, useRef } from 'react';
import { generateInitialPaper, analyzePaper, improvePaper, generatePaperTitle, fixLatexPaper, reformatPaperWithStyleGuide } from './services/geminiService';
import type { Language, IterationAnalysis, PaperSource, AnalysisResult, StyleGuide, ArticleEntry, PersonalData } from './types';
import { LANGUAGES, AVAILABLE_MODELS, ALL_TOPICS_BY_DISCIPLINE, getAllDisciplines, getRandomTopic, STYLE_GUIDES, TOTAL_ITERATIONS } from './constants';

import LanguageSelector from './components/LanguageSelector';
import ModelSelector from './components/ModelSelector';
import ActionButton from './components/ActionButton';
import ProgressBar from './components/ProgressBar';
import LatexCompiler from './components/LatexCompiler';
import ApiKeyModal from './components/ApiKeyModal';
import PersonalDataModal from './components/PersonalDataModal';

declare const pdfjsLib: any;
declare const window: any;

const App: React.FC = () => {
    const [step, setStep] = useState(1);
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isPersonalDataModalOpen, setIsPersonalDataModalOpen] = useState(false);
    
    const [hasGeminiKey, setHasGeminiKey] = useState(() => {
        const envKey = process.env.API_KEY;
        return !!(envKey && envKey !== 'undefined' && envKey !== '');
    });

    const [language, setLanguage] = useState<Language>('en');
    const [generationModel, setGenerationModel] = useState('gemini-2.5-pro-preview');
    const [analysisModel, setAnalysisModel] = useState('gemini-2.5-flash-preview');
    const [pageCount, setPageCount] = useState(10);
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('');
    const [generatedTitle, setGeneratedTitle] = useState('');
    const [paperSources, setPaperSources] = useState<PaperSource[]>([]);
    const [finalLatexCode, setFinalLatexCode] = useState('');
    const [selectedDiscipline, setSelectedDiscipline] = useState<string>(getAllDisciplines()[0]);

    const [latexCode, setLatexCode] = useState(`% O código LaTeX gerado aparecerá aqui.`);
    
    const [authors, setAuthors] = useState<PersonalData[]>(() => {
        try {
            const stored = localStorage.getItem('all_authors_data');
            const parsed = stored ? JSON.parse(stored) : [];
            return parsed.length > 0 ? parsed : [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        } catch {
            return [{ name: 'SÉRGIO DE ANDRADE, PAULO', affiliation: 'Faculdade de Guarulhos (FG)', orcid: '0009-0004-2555-3178' }];
        }
    });

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
        setGenerationStatus("Gerando título com Gemini 2.5...");
        setGenerationProgress(10);
        
        try {
            const topic = getRandomTopic(selectedDiscipline);
            const title = await generatePaperTitle(topic, language, analysisModel, selectedDiscipline);
            setGeneratedTitle(title);
            
            setGenerationStatus("Escrevendo artigo (Gemini 2.5 Pro Thinking)...");
            setGenerationProgress(40);
            const { paper, sources } = await generateInitialPaper(title, language, pageCount, generationModel, authors);
            
            setGenerationStatus("Analisando qualidade rigorosa...");
            setGenerationProgress(70);
            const analysis = await analyzePaper(paper, pageCount, analysisModel);
            
            setGenerationStatus("Refinando código LaTeX...");
            setGenerationProgress(90);
            const improved = await improvePaper(paper, analysis, language, generationModel);
            
            setFinalLatexCode(improved);
            setLatexCode(improved);
            setPaperSources(sources);
            setGenerationStatus("Concluído com Gemini 2.5 Pro!");
            setGenerationProgress(100);
            setStep(2);
        } catch (error: any) {
            setGenerationStatus(`Erro: ${error.message}`);
            console.error("Workflow Error:", error);
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
                        <p>IA: Gemini 2.5 Pro (Thinking Enabled)</p>
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
                            <ModelSelector models={AVAILABLE_MODELS} selectedModel={generationModel} onSelect={setGenerationModel} label="Geração (Sugestão: 2.5 Pro):" />
                            <select value={selectedDiscipline} onChange={e => setSelectedDiscipline(e.target.value)} className="w-full p-2 border rounded mb-4 mt-4">
                                {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <div className="mt-6 text-center">
                                <ActionButton onClick={handleFullAutomation} disabled={isGenerating} isLoading={isGenerating} text="Iniciar Gerador 2.5 Pro" loadingText="IA Pensando..." />
                            </div>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-lg flex flex-col justify-center border-2 border-dashed border-gray-200">
                            {isGenerating ? (
                                <div className="space-y-4">
                                    <ProgressBar progress={generationProgress} isVisible={true} />
                                    <p className="text-center font-bold text-indigo-600 animate-pulse">{generationStatus}</p>
                                </div>
                            ) : (
                                <div className="text-center text-gray-500">
                                    <p className="mb-2">Aguardando início...</p>
                                    <p className="text-xs">Utilizando Gemini 2.5 Pro para máxima densidade científica.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="card">
                    <LatexCompiler code={latexCode} onCodeChange={setLatexCode} />
                    <div className="mt-4 flex gap-4">
                        <button onClick={() => setStep(3)} className="btn btn-success flex-1">Seguir para Publicação</button>
                        <button onClick={() => setStep(1)} className="btn bg-gray-200 flex-1">Voltar</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
