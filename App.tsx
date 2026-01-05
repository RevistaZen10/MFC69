
import React, { useState, useEffect } from 'react';
import { generateInitialPaper, analyzePaper, improvePaper, generatePaperTitle } from './services/geminiService';
import type { Language, PaperSource, PersonalData } from './types';
import { LANGUAGES, AVAILABLE_MODELS, getAllDisciplines, getRandomTopic } from './constants';

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
    
    const [hasGeminiKey, setHasGeminiKey] = useState(false);

    const [language, setLanguage] = useState<Language>('en');
    const [generationModel, setGenerationModel] = useState('gemini-3-pro-preview');
    const [analysisModel, setAnalysisModel] = useState('gemini-3-flash-preview');
    const [pageCount, setPageCount] = useState(10);
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(0);
    const [generationStatus, setGenerationStatus] = useState('');
    const [paperSources, setPaperSources] = useState<PaperSource[]>([]);
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

        const checkKey = async () => {
            if (window.aistudio?.hasSelectedApiKey) {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setHasGeminiKey(hasKey);
            } else {
                const envKey = process.env.API_KEY;
                setHasGeminiKey(!!(envKey && envKey !== 'undefined' && envKey !== 'null' && envKey !== ''));
            }
        };
        checkKey();
    }, []);

    const handleConnectKey = async () => {
        if (window.aistudio?.openSelectKey) {
            await window.aistudio.openSelectKey();
            setHasGeminiKey(true);
        } else {
            setIsApiModalOpen(true);
        }
    };

    const handleFullAutomation = async () => {
        if (!hasGeminiKey) {
            await handleConnectKey();
            // In aistudio env, process.env.API_KEY is updated after selection
        }
        
        setIsGenerating(true);
        setGenerationStatus("Preparando Motores Gemini 3...");
        setGenerationProgress(5);
        
        try {
            const topic = getRandomTopic(selectedDiscipline);
            const title = await generatePaperTitle(topic, language, analysisModel, selectedDiscipline);
            
            setGenerationStatus("Gerando Artigo Científico (Thinking Active)...");
            setGenerationProgress(30);
            const { paper, sources } = await generateInitialPaper(title, language, pageCount, generationModel, authors);
            
            setGenerationStatus("Análise de Rigor Acadêmico...");
            setGenerationProgress(60);
            const analysis = await analyzePaper(paper, pageCount, analysisModel);
            
            setGenerationStatus("Refinando Código LaTeX...");
            setGenerationProgress(85);
            const improved = await improvePaper(paper, analysis, language, generationModel);
            
            setLatexCode(improved);
            setPaperSources(sources);
            setGenerationStatus("Concluído! Artigo Gerado com Sucesso.");
            setGenerationProgress(100);
            setStep(2);
        } catch (error: any) {
            setGenerationStatus(`Erro: ${error.message}`);
            alert(`Falha Crítica: ${error.message}.`);
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
                        <p>Estado da Arte: <strong>Gemini 3 High Performance</strong></p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <button 
                            onClick={handleConnectKey} 
                            className={`px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-2 ${hasGeminiKey ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-indigo-600 text-white animate-pulse'}`}
                        >
                            {hasGeminiKey ? "✓ Gemini 3 Conectado" : "Conectar API Key"}
                        </button>
                        <button onClick={() => setIsPersonalDataModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full" title="Autores">👤</button>
                        <button onClick={() => setIsApiModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full" title="Configurações">⚙️</button>
                    </div>
                </div>
            </div>

            <div className="workflow-steps">
                {[1,2,3,4].map(i => (
                    <div key={i} className={getStepCardClass(i)} onClick={() => setStep(i)}>
                        <div className="step-number">{i}</div>
                        <div className="step-title">{['Configurar', 'Revisar', 'Publicar', 'Histórico'][i-1]}</div>
                    </div>
                ))}
            </div>

            {step === 1 && (
                <div className="card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <LanguageSelector languages={LANGUAGES} selectedLanguage={language} onSelect={setLanguage} />
                            <ModelSelector models={AVAILABLE_MODELS} selectedModel={generationModel} onSelect={setGenerationModel} label="Motor de Geração Principal:" />
                            <div className="mt-4">
                                <label className="block text-sm font-bold mb-2">Disciplina de Pesquisa:</label>
                                <select value={selectedDiscipline} onChange={e => setSelectedDiscipline(e.target.value)} className="w-full p-2 border rounded shadow-inner">
                                    {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <div className="mt-8 text-center">
                                <ActionButton onClick={handleFullAutomation} disabled={isGenerating} isLoading={isGenerating} text="Iniciar Gerador IA" loadingText="IA Pensando..." />
                            </div>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-lg flex flex-col justify-center border-2 border-dashed border-gray-200 min-h-[300px]">
                            {isGenerating ? (
                                <div className="space-y-4">
                                    <ProgressBar progress={generationProgress} isVisible={true} />
                                    <p className="text-center font-bold text-indigo-600 animate-pulse">{generationStatus}</p>
                                    <p className="text-xs text-center text-gray-400">Modelos Gemini 3 Pro utilizam cadeias de pensamento para maior precisão.</p>
                                </div>
                            ) : (
                                <div className="text-center text-gray-500">
                                    <p className="text-6xl mb-4">🧬</p>
                                    <p className="font-bold text-lg mb-2">Pronto para Geração Avançada</p>
                                    <p className="text-sm">Utilizando os novos modelos Gemini 3 para obter os melhores resultados científicos e fundamentação teórica sólida.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="card">
                    <LatexCompiler code={latexCode} onCodeChange={setLatexCode} />
                    <div className="mt-6 flex gap-4">
                        <button onClick={() => setStep(3)} className="btn btn-success flex-1 shadow-md">Seguir para Publicação (DOI)</button>
                        <button onClick={() => setStep(1)} className="btn bg-gray-100 flex-1 hover:bg-gray-200 border">Voltar e Ajustar</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
