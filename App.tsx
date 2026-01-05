
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
// Fix: Import ZenodoUploader component and its Ref type to resolve the "Cannot find name 'ZenodoUploader'" error.
import ZenodoUploader, { type ZenodoUploaderRef } from './components/ZenodoUploader';
import PersonalDataModal from './components/PersonalDataModal'; // Import the new PersonalDataModal

// This is needed for the pdf.js script loaded in index.html
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
    date: string; // Added date
};

// Main App Component
const App: React.FC = () => {
    // Overall workflow step
    const [step, setStep] = useState(1);
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isPersonalDataModalOpen, setIsPersonalDataModalOpen] = useState(false); // New state for personal data modal
    
    // DETECÇÃO CIRÚRGICA DA CHAVE NO CLOUDFLARE
    const [hasGeminiKey, setHasGeminiKey] = useState(() => {
        const envKey = process.env.API_KEY;
        const storedKey = localStorage.getItem('gemini_api_key');
        const storedMultiKeys = localStorage.getItem('gemini_api_keys');
        return !!((envKey && envKey !== 'undefined' && envKey !== '') || storedKey || (storedMultiKeys && JSON.parse(storedMultiKeys).length > 0));
    });

    // == STEP 1: GENERATION STATE ==
    const [language, setLanguage] = useState<Language>('en');
    const [generationModel, setGenerationModel] = useState('gemini-2.5-flash');
    const [analysisModel, setAnalysisModel] = useState('gemini-2.5-flash');
    // REMOVIDAS AS OPÇÕES DE 30, 60, 100 PAGINAS. PADRÃO FIXO EM 10.
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
    // Replaced publishedArticles with articleEntries
    const [articleEntries, setArticleEntries] = useState<ArticleEntry[]>(() => {
        try {
            const stored = localStorage.getItem('article_entries_log');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });
    const [selectedDiscipline, setSelectedDiscipline] = useState<string>(getAllDisciplines()[0]); // Default to the first discipline


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
    // Initialize Zenodo token from localStorage
    const [zenodoToken, setZenodoToken] = useState(() => localStorage.getItem('zenodo_api_key') || '');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<React.ReactNode>(null);
    const [keywordsInput, setKeywordsInput] = useState('');
    
    // State for author personal data, loaded from localStorage
    const [authors, setAuthors] = useState<PersonalData[]>(() => {
        try {
            const stored = localStorage.getItem('all_authors_data');
            const parsed = stored ? JSON.parse(stored) : [];
            if (parsed.length === 0) {
                // Default to a single author if no data found
                return [{ 
                    name: 'SÉRGIO DE ANDRADE, PAULO', 
                    affiliation: 'Faculdade de Guarulhos (FG)', 
                    orcid: '0009-0004-2555-3178' 
                }];
            }
            return parsed;
        } catch {
            return [{ 
                name: 'SÉRGIO DE ANDRADE, PAULO', 
                affiliation: 'Faculdade de Guarulhos (FG)', 
                orcid: '0009-0004-2555-3178' 
            }];
        }
    });

    // == AUTOMATION & SCHEDULER STATE ==
    const [isContinuousMode, setIsContinuousMode] = useState(() => {
        return localStorage.getItem('isContinuousMode') === 'true';
    });
    const [isSchedulerEnabled, setIsSchedulerEnabled] = useState(() => {
        return localStorage.getItem('isSchedulerEnabled') === 'true';
    });
    const schedulerTimeoutRef = useRef<number | null>(null);
    const uploaderRef = useRef<ZenodoUploaderRef>(null);

    // == STEP 4: PUBLISHED ARTICLES STATE ==
    const [filter, setFilter] = useState({ day: '', month: '', year: '' });
    const [isRepublishingId, setIsRepublishingId] = useState<string | null>(null); // New state for republishing specific item
    
    // Effect for pdf.js worker
    useEffect(() => {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    }, []);
    
    // Update zenodoToken in localStorage whenever it changes
    useEffect(() => {
        if (zenodoToken) {
            localStorage.setItem('zenodo_api_key', zenodoToken);
        } else {
            localStorage.removeItem('zenodo_api_key');
        }
    }, [zenodoToken]);

    // Effect to save all author personal data to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('all_authors_data', JSON.stringify(authors));
        } catch (error) {
            console.error("Failed to save author data to localStorage", error);
        }
    }, [authors]);

    // Effect to automatically update authors based on selected discipline
    useEffect(() => {
        const fixedAuthor1 = {
            name: 'Revista, Zen',
            affiliation: 'Faculdade de Guarulhos (FG)',
            orcid: '0009-0007-6299-2008'
        };

        const author2Name = DISCIPLINE_AUTHORS[selectedDiscipline] || 'RESEARCHER, 10';
        const dynamicAuthor2 = {
            name: author2Name,
            affiliation: 'Faculdade de Guarulhos (FG)',
            orcid: '0009-0007-6299-2008'
        };

        setAuthors([fixedAuthor1, dynamicAuthor2]);
    }, [selectedDiscipline]);

    // Effect to save all article entries to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('article_entries_log', JSON.stringify(articleEntries));
        } catch (error) {
            console.error("Failed to save article entries to localStorage", error);
        }
    }, [articleEntries]);

    // Effect for the automatic scheduler
    useEffect(() => {
        if (!isSchedulerEnabled || isGenerating) {
            if (schedulerTimeoutRef.current) {
                clearTimeout(schedulerTimeoutRef.current);
                schedulerTimeoutRef.current = null;
            }
            return;
        }

        const scheduleNextRun = () => {
            if (schedulerTimeoutRef.current) clearTimeout(schedulerTimeoutRef.current);

            const now = new Date();
            
            const fiveAM = new Date(now);
            fiveAM.setHours(5, 0, 0, 0);
            
            const noon = new Date(now);
            noon.setHours(12, 0, 0, 0);

            const nextDayFiveAM = new Date(now);
            nextDayFiveAM.setDate(now.getDate() + 1);
            nextDayFiveAM.setHours(5, 0, 0, 0);

            let nextRunTime;
            if (now < fiveAM) {
                nextRunTime = fiveAM;
            } else if (now < noon) {
                nextRunTime = noon;
            } else {
                nextRunTime = nextDayFiveAM;
            }
            
            const delay = nextRunTime.getTime() - now.getTime();
            console.log(`Scheduling next automatic run at ${nextRunTime.toLocaleString()} (in ${Math.round(delay/1000/60)} minutes)`);

            schedulerTimeoutRef.current = window.setTimeout(() => {
                console.log("Scheduler triggered! Starting automatic run...");
                // Start with 1 article, continuous mode will handle the loop if enabled,
                // otherwise it's just 1 scheduled article.
                if (!isGenerating) handleFullAutomation(1); 
                scheduleNextRun();
            }, delay);
        };

        scheduleNextRun();

        return () => {
            if (schedulerTimeoutRef.current) {
                clearTimeout(schedulerTimeoutRef.current);
                schedulerTimeoutRef.current = null;
            }
        };
    }, [isSchedulerEnabled, isGenerating]);


    const getScoreClass = (score: number) => {
        if (score >= 9.5) return 'bg-blue-600'; // MESTRE DOS GÊNIOS
        if (score >= 8.5) return 'bg-green-500';
        if (score >= 7.0) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    const robustCompile = async (
        codeToCompile: string,
        onStatusUpdate: (message: string) => void
    ): Promise<{ pdfFile: File; pdfUrl: string; finalCode: string; }> => {
        console.group("🔍 DEBUG: Starting Robust Compile");
        console.log("Original Code Length:", codeToCompile.length);
        console.log("👇👇👇 FULL LATEX CODE BELOW 👇👇👇");
        console.log(codeToCompile);
        console.log("👆👆👆 FULL LATEX CODE ABOVE 👆👆👆");
        
        const MAX_COMPILE_ATTEMPTS = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt++) {
            try {
                onStatusUpdate(`⏳ Compilando (Tentativa ${attempt}/${MAX_COMPILE_ATTEMPTS})...`);
                console.log(`Attempt ${attempt}: Sending request to /compile-latex`);
                
                const response = await fetch('/compile-latex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latex: codeToCompile }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    console.error(`Attempt ${attempt} FAILED. Server error:`, errorData);
                    throw new Error(errorData.error || `Falha na compilação (tentativa ${attempt}).`);
                }
                
                const base64Pdf = await response.text();
                console.log(`Attempt ${attempt} SUCCESS. PDF received.`);
                const pdfUrl = `data:application/pdf;base64,${base64Pdf}`;
                const blob = await (await fetch(pdfUrl)).blob();
                const file = new File([blob], "paper.pdf", { type: "application/pdf" });
                
                console.groupEnd();
                return { pdfFile: file, pdfUrl, finalCode: codeToCompile };

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Compilation attempt ${attempt} failed:`, lastError.message);
                if (attempt < MAX_COMPILE_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        
        if (lastError) {
            onStatusUpdate(`⚠️ Compilação falhou. Tentando corrigir o código com IA (Modelo: ${analysisModel})...`);
            console.log("Initiating AI Fix...");
            console.log("Error Reason (Full Log sent to AI):", lastError.message);
            
            let fixedCode = '';
            try {
                fixedCode = await fixLatexPaper(codeToCompile, lastError.message, analysisModel);
                console.log("AI Fix Generated. New Code Length:", fixedCode.length);
                console.log("👇👇👇 FIXED LATEX CODE BELOW 👇👇👇");
                console.log(fixedCode);
                console.log("👆👆👆 FIXED LATEX CODE ABOVE 👆👆👆");
            } catch (fixError) {
                const fixErrorMessage = fixError instanceof Error ? fixError.message : String(fixError);
                console.error("AI Fix Failed:", fixErrorMessage);
                throw new Error(`A compilação falhou e a tentativa de correção automática também falhou. Erro original: ${lastError.message}. Erro da correção: ${fixErrorMessage}`);
            }

            onStatusUpdate(`✅ Código corrigido. Tentando compilação final...`);
            try {
                const response = await fetch('/compile-latex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latex: fixedCode }),
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    console.error("Final Compilation Failed:", errorData);
                    throw new Error(errorData.error || 'A compilação final falhou mesmo após a correção automática.');
                }
                const base64Pdf = await response.text();
                const pdfUrl = `data:application/pdf;base64,${base64Pdf}`;
                const blob = await (await fetch(pdfUrl)).blob();
                const file = new File([blob], "paper.pdf", { type: "application/pdf" });
                console.groupEnd();
                return { pdfFile: file, pdfUrl, finalCode: fixedCode };
            } catch (finalCompileError) {
                const finalErrorMessage = finalCompileError instanceof Error ? finalCompileError.message : String(finalCompileError);
                console.error("Final Error:", finalErrorMessage);
                console.groupEnd();
                throw new Error(`A compilação falhou após a correção automática. Erro final: ${finalErrorMessage}`);
            }
        }
        console.groupEnd();
        throw new Error("Falha na compilação após todas as tentativas.");
    };

    const handleFullAutomation = async (batchSizeOverride?: number) => {
        // Important: In Continuous Mode, we default to a batch size of 1 to allow for cooldowns between papers.
        // This ensures "GERAR APENAS UM ARTIGO POR VEZ" as requested.
        const articlesToProcess = batchSizeOverride ?? (isContinuousMode ? 1 : numberOfArticles);
        const storedToken = localStorage.getItem('zenodo_api_key');
        if (!storedToken) {
            alert('❌ Token Zenodo não encontrado! Por favor, configure-o nas definições (ícone de engrenagem) antes de iniciar.');
            return;
        }
        setZenodoToken(storedToken);

        // Check if author details are present
        const hasValidAuthor = authors.some(author => author.name && author.affiliation && author.orcid);
        if (authors.length === 0 || !hasValidAuthor) {
            alert('❌ Dados pessoais do autor (Nome, Afiliação, ORCID) não encontrados ou incompletos! Por favor, configure-os no ícone de "pessoa" antes de iniciar.');
            setIsPersonalDataModalOpen(true);
            return;
        }

        isGenerationCancelled.current = false;
        setIsGenerating(true);
        setUploadStatus(null);
        setStep(1);
        
        for (let i = 1; i <= articlesToProcess; i++) {
            if (isGenerationCancelled.current) break;
            
            const articleEntryId = crypto.randomUUID();
            let temporaryTitle = `Artigo ${i} (Geração do Título Falhou)`;
            let currentPaper = '';

            try {
                setIsGenerationComplete(false);
                setGenerationProgress(0);
                setAnalysisResults([]);
                setPaperSources([]);
                setGeneratedTitle('');
                setFinalLatexCode('');

                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Gerando um título inovador para ${selectedDiscipline} (Modelo: ${analysisModel})...`);
                setGenerationProgress(5);
                // Use getRandomTopic with selectedDiscipline
                const randomTopic = getRandomTopic(selectedDiscipline);
                // Pass selectedDiscipline to the title generator
                temporaryTitle = await generatePaperTitle(randomTopic, language, analysisModel, selectedDiscipline);
                setGeneratedTitle(temporaryTitle);

                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Gerando a primeira versão (Modelo: ${generationModel})...`);
                setGenerationProgress(15);
                const { paper: initialPaper, sources } = await generateInitialPaper(
                    temporaryTitle, 
                    language, 
                    pageCount, 
                    generationModel, 
                    authors // Pass dynamic authors array
                );
                currentPaper = initialPaper;
                setPaperSources(sources);

                for (let iter = 1; iter <= TOTAL_ITERATIONS; iter++) {
                    if (isGenerationCancelled.current) throw new Error("Operação cancelada pelo usuário.");
                    setGenerationProgress(15 + (iter / TOTAL_ITERATIONS) * 75);
                    setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Analisando (iteração ${iter}/${TOTAL_ITERATIONS}) (Modelo: ${analysisModel})...`);
                    const analysisResult = await analyzePaper(currentPaper, pageCount, analysisModel);
                    const validAnalysisItems = analysisResult.analysis.filter(res => ANALYSIS_TOPICS.some(topic => topic.num === res.topicNum));
                    setAnalysisResults(prev => [...prev, { iteration: iter, results: validAnalysisItems.map(res => ({ topic: ANALYSIS_TOPICS.find(t => t.num === res.topicNum)!, score: res.score, scoreClass: getScoreClass(res.score), improvement: res.improvement })) }]);
                    if (!validAnalysisItems.some(res => res.score < 7.0)) break;
                    if (iter < TOTAL_ITERATIONS) {
                        setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Refinando com base no feedback ${iter}... (Modelo: ${generationModel})`);
                        currentPaper = await improvePaper(currentPaper, analysisResult, language, generationModel);
                    }
                }

                if (isGenerationCancelled.current) continue;

                setFinalLatexCode(currentPaper);
                setGenerationProgress(95);
                let compiledFile: File | null = null;
                const compilationUpdater = (message: string) => setGenerationStatus(`Artigo ${i}/${articlesToProcess}: ${message}`);
                const { pdfFile, finalCode } = await robustCompile(currentPaper, compilationUpdater);
                compiledFile = pdfFile;
                currentPaper = finalCode;

                if (isGenerationCancelled.current) continue;

                setGenerationStatus(`Artigo ${i}/${articlesToProcess}: Publicando no Zenodo...`);
                setGenerationProgress(98);
                const metadataForUpload = extractMetadata(currentPaper, true);
                const keywordsForUpload = currentPaper.match(/\\keywords\{([^}]+)\}/)?.[1] || '';
                let publishedResult: PublishedArticle | null = null;
                
                // Helper to wrap URL with proxy for Zenodo calls in automation loop
                const proxied = (url: string) => `/zenodo-proxy?target=${encodeURIComponent(url)}`;

                for (let attempt = 1; attempt <= 10; attempt++) {
                    if (isGenerationCancelled.current) break;
                    try {
                        const baseUrl = useSandbox ? 'https://sandbox.zenodo.org/api' : 'https://zenodo.org/api';
                        // Use proxy for creation
                        const createResponse = await fetch(proxied(`${baseUrl}/deposit/depositions`), { method: 'POST', headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                        if (!createResponse.ok) throw new Error(`Erro ${createResponse.status} ao criar depósito.`);
                        const deposit = await createResponse.json();
                        
                        const bucketUrl = deposit.links.bucket;
                        if (!bucketUrl) throw new Error('Could not find bucket URL in Zenodo API response.');

                        const uploadResponse = await fetch(proxied(`${bucketUrl}/paper.pdf`), {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${storedToken}`,
                                'Content-Type': 'application/octet-stream'
                            },
                            body: compiledFile
                        });

                        if (!uploadResponse.ok) {
                            const errorText = await uploadResponse.text();
                            throw new Error(`Falha no upload do PDF: ${uploadResponse.status} - ${errorText}`);
                        }
                        
                        const creators = authors.filter(a => a.name).map(author => ({
                            name: author.name,
                            orcid: author.orcid || undefined // Affiliation intentionally omitted for Zenodo
                        }));

                        const metadataPayload = { metadata: { title: metadataForUpload.title, upload_type: 'publication', publication_type: 'article', description: metadataForUpload.abstract, creators: creators, keywords: keywordsForUpload.split(',').map(k => k.trim()).filter(k => k) } };
                        // Use proxy for metadata update
                        const metadataResponse = await fetch(proxied(`${baseUrl}/deposit/depositions/${deposit.id}`), { method: 'PUT', headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(metadataPayload) });
                        if (!metadataResponse.ok) throw new Error('Falha ao atualizar metadados');
                        // Use proxy for publish
                        const publishResponse = await fetch(proxied(`${baseUrl}/deposit/depositions/${deposit.id}/actions/publish`), { method: 'POST', headers: { 'Authorization': `Bearer ${storedToken}` } });
                        if (!publishResponse.ok) throw new Error('Falha ao publicar');
                        const published = await publishResponse.json();
                        publishedResult = { doi: published.doi, link: useSandbox ? `https://sandbox.zenodo.org/records/${deposit.id}` : `https://zenodo.org/records/${deposit.id}`, title: metadataForUpload.title, date: new Date().toISOString() };
                        break;
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : `Tentativa ${attempt} falhou.`;
                        if (attempt === 10) throw new Error(`Falha ao enviar para o Zenodo após 10 tentativas. Erro final: ${errorMessage}`);
                        const delayTime = 15000 + (5000 * (attempt - 1));
                        setGenerationStatus(`Artigo ${i}/${articlesToProcess}: ❌ ${errorMessage} Aguardando ${delayTime / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delayTime));
                    }
                }
                
                if (publishedResult) {
                    setArticleEntries(prev => [...prev, { id: articleEntryId, title: metadataForUpload.title, date: publishedResult.date, status: 'published', doi: publishedResult.doi, link: publishedResult.link }]);
                } else if (!isGenerationCancelled.current) {
                     throw new Error("Não foi possível publicar no Zenodo após todas as tentativas.");
                }

            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : `Ocorreu um erro desconhecido no artigo ${i}.`;
                console.error(`Error processing article ${i}:`, error);

                // Critical Error Handling: Stop automation on quota errors OR when rotation loop exhausted.
                const lowerMsg = errorMessage.toLowerCase();
                if (
                    lowerMsg.includes('quota') || 
                    lowerMsg.includes('exhausted') || 
                    lowerMsg.includes('rotation loop')
                ) {
                    setGenerationStatus(`🛑 Limite de cota atingido em TODAS as chaves de API. A automação será pausada.`);
                    setArticleEntries(prev => [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: 'upload_failed', latexCode: currentPaper, errorMessage: `Pausado por limite de cota global: ${errorMessage}` }]);
                    isGenerationCancelled.current = true; 
                    break;
                }

                // Resilient Handling for other errors
                const status = errorMessage.includes('compilação') ? 'compilation_failed' : 'upload_failed';
                setArticleEntries(prev => [...prev, { id: articleEntryId, title: temporaryTitle, date: new Date().toISOString(), status: status, latexCode: currentPaper, errorMessage: errorMessage }]);
                
                let pauseDuration = 3000;
                if (lowerMsg.includes('network') || lowerMsg.includes('fetch')) {
                    setGenerationStatus(`🔌 Problema de rede detectado. Pausando por 1 minuto...`);
                    pauseDuration = 60000;
                } else {
                     setGenerationStatus(`❌ Erro no artigo ${i}: ${errorMessage}. Continuando para o próximo em 3s...`);
                }
                await new Promise(resolve => setTimeout(resolve, pauseDuration));
                continue; // Continue to the next article in the loop for non-quota errors
            }
            
            // After processing an article, introduce a cooldown before starting the next one
            // in a manual batch to prevent hitting API rate limits.
            // This does not apply to the very last article in the batch or to continuous mode.
            if (!isContinuousMode && i < articlesToProcess && !isGenerationCancelled.current) {
                const cooldownSeconds = 60; // 60 seconds to safely reset per-minute quota
                setGenerationStatus(`Artigo ${i}/${articlesToProcess} concluído. Pausando por ${cooldownSeconds}s para evitar limites de taxa...`);
                await new Promise(resolve => setTimeout(resolve, cooldownSeconds * 1000));
            }
        } // end for loop

        setIsGenerating(false); // Stop generation state regardless of how the loop ended.

        if (isGenerationCancelled.current) {
            // Check if the stop was due to quota or manual cancellation
            setGenerationStatus(prevStatus => {
                if (prevStatus.includes('Limite de cota')) {
                    return prevStatus; // Keep the quota message
                }
                return "❌ Automação cancelada pelo usuário."; // Default manual cancellation message
            });
        } else if (isContinuousMode) {
            setGenerationStatus(`✅ Ciclo concluído. Pausa de 1 minuto antes do próximo artigo (Modo Contínuo)...`);
            setTimeout(() => {
                // Double-check flags before re-starting
                if (isContinuousMode && !isGenerationCancelled.current) {
                    // Start next cycle with just 1 article to keep cooldowns active
                    // This STRICTLY ensures "GERAR APENAS UM ARTIGO POR VEZ" is followed in the recursion
                    handleFullAutomation(1);
                }
            }, 60000); // STRICTLY 60 seconds (1 minute) pause
        } else {
            // This is for a normal, single batch completion
            setGenerationProgress(100);
            setGenerationStatus(`✅ Processo concluído! ${articlesToProcess} artigos processados.`);
            setStep(4);
        }
    };


    const handleRepublishPending = async (articleId: string) => {
        setIsRepublishingId(articleId);
        setUploadStatus(null);
        
        const articleToRepublish = articleEntries.find(entry => entry.id === articleId);
        if (!articleToRepublish || !articleToRepublish.latexCode) {
            setUploadStatus(<div className="status-message status-error">❌ Erro: Artigo ou código LaTeX não encontrado para republicação.</div>);
            setIsRepublishingId(null);
            return;
        }
    
        const storedToken = localStorage.getItem('zenodo_api_key');
        if (!storedToken) {
            setUploadStatus(<div className="status-message status-error">❌ Token Zenodo não encontrado! Por favor, configure-o nas definições (ícone de engrenagem).</div>);
            setIsRepublishingId(null);
            return;
        }
        setZenodoToken(storedToken);

        // Check if author details are present
        const hasValidAuthor = authors.some(author => author.name && author.affiliation && author.orcid);
        if (authors.length === 0 || !hasValidAuthor) {
            setUploadStatus(<div className="status-message status-error">❌ Dados pessoais do autor (Nome, Afiliação, ORCID) não encontrados ou incompletos! Por favor, configure-os no ícone de "pessoa".</div>);
            setIsPersonalDataModalOpen(true);
            setIsRepublishingId(null);
            return;
        }
        
        // Helper to wrap URL with proxy for republishing
        const proxied = (url: string) => `/zenodo-proxy?target=${encodeURIComponent(url)}`;
    
        try {
            setUploadStatus(<div className="status-message status-info">⏳ Iniciando republicação para "{articleToRepublish.title}"...</div>);
    
            let compiledFile: File | null = null;
            let finalCodeAfterFix = articleToRepublish.latexCode;
    
            try {
                const compilationUpdater = (message: string) => {
                    setUploadStatus(<div className="status-message status-info">⏳ Compilando para republicação: {message}</div>);
                };
                const { pdfFile, finalCode } = await robustCompile(articleToRepublish.latexCode, compilationUpdater);
                compiledFile = pdfFile;
                finalCodeAfterFix = finalCode;
            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : 'Falha na compilação para republicação.';
                setUploadStatus(<div className="status-message status-error">❌ Falha na compilação: {errorMessage}</div>);
                setArticleEntries(prev => prev.map(entry => 
                    entry.id === articleId ? { ...entry, status: 'compilation_failed', errorMessage: errorMessage, date: new Date().toISOString(), latexCode: finalCodeAfterFix } : entry
                ));
                setIsRepublishingId(null);
                return;
            }
    
            setUploadStatus(<div className="status-message status-info">🚀 Publicando no Zenodo...</div>);
            const metadataForUpload = extractMetadata(finalCodeAfterFix, true);
            const keywordsForUpload = finalCodeAfterFix.match(/\\keywords\{([^}]+)\}/)?.[1] || '';
    
            const MAX_UPLOAD_RETRIES = 5;
            let publishedResult: PublishedArticle | null = null;
    
            for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
                try {
                    const baseUrl = useSandbox ? 'https://sandbox.zenodo.org/api' : 'https://zenodo.org/api';
                    
                    const createResponse = await fetch(proxied(`${baseUrl}/deposit/depositions`), {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    });
                    if (!createResponse.ok) throw new Error(`Erro ${createResponse.status}: Falha ao criar depósito.`);
                    const deposit = await createResponse.json();
    
                    const bucketUrl = deposit.links.bucket;
                    if (!bucketUrl) throw new Error('Could not find bucket URL in Zenodo API response.');
                    const uploadResponse = await fetch(proxied(`${bucketUrl}/paper.pdf`), {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${storedToken}`,
                            'Content-Type': 'application/octet-stream',
                        },
                        body: compiledFile
                    });
                    if (!uploadResponse.ok) {
                        const errorText = await uploadResponse.text();
                        throw new Error(`Falha no upload do PDF: ${uploadResponse.status} - ${errorText}`);
                    }
    
                    const keywordsArray = keywordsForUpload.split(',').map(k => k.trim()).filter(k => k);
                    const creators = authors.filter(a => a.name).map(author => ({
                        name: author.name,
                        orcid: author.orcid || undefined // Affiliation intentionally omitted for Zenodo
                    }));

                    const metadataPayload = {
                        metadata: {
                            title: metadataForUpload.title,
                            upload_type: 'publication',
                            publication_type: 'article',
                            description: metadataForUpload.abstract,
                            creators: creators, // Use dynamic author details
                            keywords: keywordsArray.length > 0 ? keywordsArray : undefined
                        }
                    };
                    const metadataResponse = await fetch(proxied(`${baseUrl}/deposit/depositions/${deposit.id}`), {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${storedToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(metadataPayload)
                    });
                    if (!metadataResponse.ok) throw new Error('Falha ao atualizar metadados');
    
                    const publishResponse = await fetch(proxied(`${baseUrl}/deposit/depositions/${deposit.id}/actions/publish`), {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${storedToken}` }
                    });
                    if (!publishResponse.ok) throw new Error('Falha ao publicar');
                    const published = await publishResponse.json();
    
                    const zenodoLink = useSandbox ? `https://sandbox.zenodo.org/records/${deposit.id}` : `https://zenodo.org/records/${deposit.id}`;
                    publishedResult = { 
                        doi: published.doi, 
                        link: zenodoLink, 
                        title: metadataForUpload.title,
                        date: new Date().toISOString()
                    };
                    break;
    
                } catch (error: any) {
                    const errorMessage = error instanceof Error ? error.message : `Tentativa ${attempt} falhou.`;
                    if (attempt === MAX_UPLOAD_RETRIES) {
                        throw new Error(`Falha ao enviar para o Zenodo após ${MAX_UPLOAD_RETRIES} tentativas. Erro final: ${errorMessage}`);
                    }
                    const delayTime = 15000 + (5000 * (attempt - 1));
                    setUploadStatus(<div className="status-message status-error">❌ ${errorMessage} Aguardando ${delayTime / 1000}s para tentar novamente...</div>);
                    await new Promise(resolve => setTimeout(resolve, delayTime));
                }
            }
    
            if (publishedResult) {
                setUploadStatus(<div className="status-message status-success">✅ Publicado com sucesso! DOI: {publishedResult.doi}</div>);
                setArticleEntries(prev => prev.map(entry => 
                    entry.id === articleId ? { 
                        ...entry, 
                        status: 'published', 
                        doi: publishedResult.doi, 
                        link: publishedResult.link, 
                        date: publishedResult.date,
                        latexCode: undefined,
                        errorMessage: undefined 
                    } : entry
                ));
            } else {
                throw new Error("Não foi possível publicar no Zenodo após todas as tentativas.");
            }
    
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : 'Um erro desconhecido ocorreu durante a republicação.';
            setUploadStatus(<div className="status-message status-error">❌ Erro na republicação: {errorMessage}</div>);
            setArticleEntries(prev => prev.map(entry => 
                entry.id === articleId ? { ...entry, status: 'upload_failed', errorMessage: errorMessage, date: new Date().toISOString() } : entry
            ));
        } finally {
            setIsRepublishingId(null);
        }
    };
    
    const handleProceedToCompile = () => {
        isGenerationCancelled.current = true;
        setLatexCode(finalLatexCode);
        setStep(2);
    }
    
    const extractMetadata = (code: string, returnData = false) => {
        // Use greedy matching (.*) to capture title even if it contains nested braces on the same line.
        const titleMatch = code.match(/\\title\{(.*)\}/);
        
        // Robust cleaning function for LaTeX strings
        const cleanLatexString = (str: string) => {
            if (!str) return '';
            let s = str;
            // 1. Remove standard formatting commands with backslash
            // Recursively remove common formatting commands: \textit{word} -> word, \textbf{word} -> word
            for(let i=0; i<3; i++) {
                s = s.replace(/\\(textit|textbf|emph|textsc|textsf|text|underline)\{([^}]+)\}/g, '$2');
            }
            
            // 2. Extra Robustness: Remove formatting commands WITHOUT backslash
            // This handles cases where '\' might have been stripped prematurely or input was malformed (e.g. textit{Word})
            s = s.replace(/(textit|textbf|emph|textsc|textsf|text|underline)\{([^}]+)\}/g, '$2');

            // 3. Remove escaped characters: \& -> &, \% -> %, \$ -> $
            s = s.replace(/\\([&%$#_{}])/g, '$1');

            // 4. Remove remaining braces if they are just grouping { }
            s = s.replace(/\\{([^}]+)\\}/g, '$1'); // Fixed Regex for brace removal

            // 5. Finally remove remaining backslashes (like in \'e -> 'e)
            s = s.replace(/\\/g, ''); 
            
            return s.trim();
        };

        const title = titleMatch ? cleanLatexString(titleMatch[1]) : 'Untitled Paper';
        
        const abstractMatch = code.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
        let abstractText = abstractMatch ? abstractMatch[1] : '';
        abstractText = abstractText.replace(/\\noindent\s*/g, '');
        abstractText = cleanLatexString(abstractText);
        
        // Use dynamic author details for metadata extraction
        // The `authors` state already holds the necessary ZenodoAuthor[] structure
        const currentAuthors: Author[] = authors.map(a => ({
            name: a.name,
            affiliation: a.affiliation,
            orcid: a.orcid
        }));
        
        const keywordsMatch = code.match(/\\keywords\{([^}]+)\}/) || code.match(/Palavras-chave:}\s*([^\n]+)/);
        const keywords = keywordsMatch ? keywordsMatch[1] : '';

        const metadata = { title, abstract: abstractText, authors: currentAuthors, keywords };

        if (returnData) {
            return metadata;
        }

        setKeywordsInput(keywords);
        setExtractedMetadata(metadata);
        return metadata;
    }

    const handleCompileLaTeX = async () => {
        setIsCompiling(true);
        setCompilationStatus(<div className="status-message status-info">⏳ Iniciando...</div>);
        setPdfPreviewUrl('');
        setCompiledPdfFile(null);
    
        if (compileMethod === 'texlive') {
            try {
                const statusUpdater = (message: string) => {
                    const isError = message.includes('falhou') || message.includes('Erro');
                    const className = isError ? 'status-error' : 'status-info';
                    setCompilationStatus(<div className={`status-message ${className}`}>{message}</div>);
                };
    
                const { pdfFile, pdfUrl, finalCode } = await robustCompile(latexCode, statusUpdater);
                
                setPdfPreviewUrl(pdfUrl);
                setCompiledPdfFile(pdfFile);
                setLatexCode(finalCode);
                setCompilationStatus(
                    <div className="status-message status-success">✅ PDF compilado com sucesso!</div>
                );
    
            } catch (error: any) {
                setCompilationStatus(<div className="status-message status-error">❌ Erro Final: {error?.message}</div>);
            } finally {
                setIsCompiling(false);
            }
        } else { // overleaf
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = 'https://www.overleaf.com/docs';
            form.target = '_blank';
            const input = document.createElement('textarea');
            input.name = 'snip';
            input.value = latexCode;
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
            setCompilationStatus(<div className="status-message status-info">📝 Overleaf aberto! Compile e carregue o PDF abaixo. <input type="file" id="manualPdfUpload" accept=".pdf" onChange={handleManualPDFUpload} /></div>);
            setIsCompiling(false);
        }
    };
    
    const handleManualPDFUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setCompiledPdfFile(file);
        const url = URL.createObjectURL(file);
        setPdfPreviewUrl(url);
         setCompilationStatus(<div className="status-message status-success">✅ PDF carregado!</div>);
    };

    const handleApplyStyleGuide = async () => {
        setIsReformatting(true);
        setCompilationStatus(<div className="status-message status-info">🤖 Aplicando estilo...</div>);
        try {
            const reformattedCode = await reformatPaperWithStyleGuide(latexCode, selectedStyle, generationModel);
            setLatexCode(reformattedCode);
            setCompilationStatus(<div className="status-message status-success">✅ Estilo aplicado!</div>);
        } catch (error: any) {
            setCompilationStatus(<div className="status-message status-error">❌ Erro: {error?.message}</div>);
        } finally {
            setIsReformatting(false);
        }
    };

    const handleProceedToUpload = () => {
        if (!compiledPdfFile) return alert('❌ PDF não compilado!');
        extractMetadata(latexCode);
        setStep(3);
    };

    const getStepCardClass = (stepNum: number) => {
        let classes = 'step-card cursor-pointer';
        if (step === stepNum) classes += ' active';
        if (step > stepNum) classes += ' completed';
        return classes;
    };
    
    const handleToggleContinuousMode = () => {
        const newStatus = !isContinuousMode;
        setIsContinuousMode(newStatus);
        setNumberOfArticles(1); 
        localStorage.setItem('isContinuousMode', String(newStatus));
        if (!newStatus) isGenerationCancelled.current = true;
    };

    const handleToggleScheduler = () => {
        const newStatus = !isSchedulerEnabled;
        setIsSchedulerEnabled(newStatus);
        localStorage.setItem('isSchedulerEnabled', String(newStatus));
    };

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFilter(prev => ({ ...prev, [name]: value }));
    };

    const handleSavePersonalData = (data: PersonalData[]) => {
        setAuthors(data);
        setIsPersonalDataModalOpen(false);
    };

    const handleClearArticleEntries = () => {
        if (window.confirm("Tem certeza?")) {
            setArticleEntries([]);
            localStorage.removeItem('article_entries_log');
        }
    };

    const handleConnectKey = async () => {
        if (window.aistudio?.openSelectKey) {
            await window.aistudio.openSelectKey();
            setHasGeminiKey(true);
        } else {
            setIsApiModalOpen(true);
        }
    };

    const WORKFLOW_STEPS = [
        { id: 1, title: 'Gerar Artigo', status: 'Configure a IA' },
        { id: 2, title: 'Compilar & Revisar', status: 'Gerar PDF e editar' },
        { id: 3, title: 'Publicar no Zenodo', status: 'Obter DOI' },
        { id: 4, title: 'Artigos Publicados', status: 'Ver e filtrar' }
    ];
    
    return (
        <div className="container">
            <ApiKeyModal 
                isOpen={isApiModalOpen} 
                onClose={() => setIsApiModalOpen(false)} 
                onSave={(keys) => { 
                    if (keys.gemini.length > 0) localStorage.setItem('gemini_api_key', keys.gemini[0]);
                    if (keys.zenodo) setZenodoToken(keys.zenodo); 
                    setIsApiModalOpen(false); 
                    setHasGeminiKey(true);
                }} 
            />
            <PersonalDataModal
                isOpen={isPersonalDataModalOpen}
                onClose={() => setIsPersonalDataModalOpen(false)}
                onSave={handleSavePersonalData}
                initialData={authors}
            />
            <div className="main-header">
                <div className="flex justify-between items-center">
                    <div>
                        <h1>🔬 Fluxo Integrado de Publicação Científica</h1>
                        <p>AI Generator → LaTeX Compiler → Zenodo</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        <button 
                            onClick={handleConnectKey} 
                            className={`px-4 py-2 rounded-lg font-bold transition-all shadow-sm flex items-center gap-2 ${hasGeminiKey ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-indigo-600 text-white animate-pulse'}`}
                        >
                            {hasGeminiKey ? "Gemini Conectado" : "Conectar Gemini"}
                        </button>
                        <button onClick={() => setIsPersonalDataModalOpen(true)} className="p-2 rounded-full hover:bg-gray-200 transition-colors" title="Dados Pessoais"><svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></button>
                        <button onClick={() => setIsApiModalOpen(true)} className="p-2 rounded-full hover:bg-gray-200 transition-colors" title="API Config"><svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
                    </div>
                </div>
            </div>

            <div className="workflow-steps">
                {WORKFLOW_STEPS.map(s => (<div key={s.id} className={getStepCardClass(s.id)} onClick={() => setStep(s.id)}><div className="step-number">{s.id}</div><div className="step-title">{s.title}</div><div className="step-status">{s.status}</div></div>))}
            </div>

            {step === 1 && (
                <div className="card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <LanguageSelector languages={LANGUAGES} selectedLanguage={language} onSelect={setLanguage} />
                            <ModelSelector models={AVAILABLE_MODELS} selectedModel={generationModel} onSelect={setGenerationModel} label="Geração:" />
                            <select value={selectedDiscipline} onChange={(e) => setSelectedDiscipline(e.target.value)} className="w-full p-2 border rounded">
                                {getAllDisciplines().map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <div className="mt-6 text-center">
                                <ActionButton onClick={() => handleFullAutomation()} disabled={isGenerating} isLoading={isGenerating} text="Gerar Artigo" loadingText="Trabalhando..." />
                            </div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                            {isGenerating ? (
                                <><ProgressBar progress={generationProgress} isVisible={true} /><p className="text-center">{generationStatus}</p></>
                            ) : (
                                <div className="text-center p-8">Configure as opções e comece.</div>
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
                            <StyleGuideSelector guides={STYLE_GUIDES} selectedGuide={selectedStyle} onSelect={setSelectedStyle} />
                            <button onClick={handleApplyStyleGuide} disabled={isReformatting} className="btn btn-primary w-full">Aplicar Estilo</button>
                            <button onClick={handleCompileLaTeX} disabled={isCompiling} className="btn btn-primary w-full">Compilar LaTeX</button>
                            {pdfPreviewUrl && <button onClick={handleProceedToUpload} className="btn btn-success w-full">Publicar</button>}
                        </div>
                    </div>
                </div>
            )}
            
            {step === 3 && (
                 <div className="card">
                    <ZenodoUploader 
                        ref={uploaderRef} 
                        title={extractedMetadata.title} 
                        abstractText={extractedMetadata.abstract} 
                        keywords={extractedMetadata.keywords} 
                        authors={authors} 
                        compiledPdfFile={compiledPdfFile} 
                        onFileSelect={() => {}} 
                        onPublishStart={() => setIsUploading(true)} 
                        onPublishSuccess={(res) => setUploadStatus(<div className="status-success">✅ Sucesso! DOI: {res.doi}</div>)} 
                        onPublishError={(msg) => setUploadStatus(<div className="status-error">❌ {msg}</div>)} 
                        extractedMetadata={extractedMetadata} />
                    <button onClick={() => uploaderRef.current?.submit()} disabled={isUploading} className="btn btn-success w-full mt-6">Publicar no Zenodo</button>
                    {uploadStatus}
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
