
import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap, ArrowRight, CheckCircle2, Loader2, RotateCcw, Sparkles,
  MessageSquare, Network, Copy, ArrowLeft, Target,
  AlertTriangle, X, Brain, Rocket, Swords, Grid, Edit3, Download, Volume2, VolumeX
} from 'lucide-react';
import { marked } from 'marked';
import { AppState, MicroTask, TaskStatus, VelocityPoint, AgentType, ChatMessage, VerificationStatus, BenchmarkData, AgentPersonality, ProjectDNA } from './types';
import { generatePlan, draftTaskContent, generateVisual, chatWithAgent, generateIntervention, generateFollowUp, synthesizeDNA } from './geminiService';
import { VelocityChart } from './components/VelocityChart';

// --- Audio Engine (Sonic Cortex) ---

class AudioEngine {
  ctx: AudioContext | null = null;
  noiseNode: AudioBufferSourceNode | null = null;
  gainNode: GainNode | null = null;
  isPlaying: boolean = false;

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContext();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
      this.gainNode.gain.value = 0;
    }
  }

  playFocusNoise() {
    if (this.isPlaying) return;
    this.init();
    if (!this.ctx || !this.gainNode) return;

    if (this.ctx.state === 'suspended') this.ctx.resume();

    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise algorithm
      data[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5; 
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;
    
    // Lowpass filter for "Focus" warmth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 350; 

    this.noiseNode.connect(filter);
    filter.connect(this.gainNode);
    this.noiseNode.start();
    this.isPlaying = true;
    
    // Fade in
    this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 2);
  }

  stop() {
    if (!this.isPlaying || !this.ctx || !this.gainNode) return;
    
    this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.ctx.currentTime);
    this.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1);
    
    setTimeout(() => {
        this.noiseNode?.stop();
        this.noiseNode = null;
        this.isPlaying = false;
    }, 1100);
  }
}

const sonicCortex = new AudioEngine();

// --- Utils ---

const extractCodeBlock = (text: string): string | null => {
    const match = text.match(/```[\s\S]*?```/);
    if (match) {
        return match[0].replace(/```\w*\n?/, '').replace(/```$/, '').trim();
    }
    return null;
};

const downloadArtifact = (filename: string, content: string) => {
    const element = document.createElement('a');
    const file = new Blob([content], {type: 'text/markdown'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
};

declare const mermaid: any;

// --- Sub-Components ---

const Logo = ({ animate = false, small = false }: { animate?: boolean, small?: boolean }) => (
  <div className={`flex items-center gap-2 font-mono tracking-tighter select-none cursor-pointer hover:opacity-80 transition-opacity ${small ? 'text-lg' : 'text-xl'}`}>
    <div className={`relative flex items-center justify-center ${small ? 'w-6 h-6' : 'w-8 h-8'} bg-gradient-to-br from-neon-blue to-neon-purple rounded-lg shadow-[0_0_15px_rgba(139,92,246,0.5)] ${animate ? 'animate-pulse' : ''}`}>
      <Zap className={`${small ? 'w-3 h-3' : 'w-5 h-5'} text-white fill-white ${animate ? 'animate-bounce' : ''}`} />
    </div>
    <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">KINETIC</span>
  </div>
);

const MermaidDiagram = ({ code }: { code: string }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current && code) {
            const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
            containerRef.current.innerHTML = `<div class="mermaid" id="${id}">${code}</div>`;
            try {
                mermaid.run({ nodes: [document.getElementById(id)!] });
            } catch(e) {
                console.error("Mermaid error", e);
            }
        }
    }, [code]);

    return <div ref={containerRef} className="flex justify-center py-8 w-full overflow-x-auto" />;
};

const TypingIndicator = () => (
    <div className="flex items-center gap-1 p-2">
        <div className="w-1.5 h-1.5 bg-neon-blue rounded-full animate-bounce"></div>
        <div className="w-1.5 h-1.5 bg-neon-blue rounded-full animate-bounce delay-75"></div>
        <div className="w-1.5 h-1.5 bg-neon-blue rounded-full animate-bounce delay-150"></div>
    </div>
);

// --- Functional Components ---

// 1. Onboarding Component
const Onboarding = ({ 
    dna, setDna, onComplete 
}: { 
    dna: ProjectDNA, setDna: React.Dispatch<React.SetStateAction<ProjectDNA>>, onComplete: () => void 
}) => {
    const [history, setHistory] = useState<{question: string, answer: string}[]>([]);
    const [currentQ, setCurrentQ] = useState("What is the core problem you are solving?");
    const [answer, setAnswer] = useState("");
    const [loading, setLoading] = useState(false);

    const handleNext = async () => {
        if (!answer.trim()) return;
        setLoading(true);
        const newHist = [...history, { question: currentQ, answer }];
        setHistory(newHist);
        setAnswer("");

        if (newHist.length < 3) {
            try {
                const next = await generateFollowUp(newHist);
                setCurrentQ(next);
            } catch (e) {
                setCurrentQ("Who is the specific target audience?");
            }
            setLoading(false);
        } else {
            setCurrentQ("Synthesizing Project DNA...");
            try {
                const finalDNA = await synthesizeDNA(newHist, dna.rawContext);
                setDna(finalDNA);
                onComplete();
            } catch (e) {
                onComplete();
            }
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-obsidian p-6 relative">
             <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
            <div className="w-full max-w-2xl bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-12 backdrop-blur-xl shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-4 z-10">
                {/* Progress Bar */}
                <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-neon-blue to-neon-purple transition-all duration-500" style={{ width: `${((history.length) / 4) * 100}%` }}></div>

                <div className="flex items-center gap-4 mb-8">
                    <div className="p-4 bg-slate-800 rounded-2xl shadow-[0_0_20px_rgba(59,130,246,0.2)]"><Brain className="w-8 h-8 text-neon-blue animate-pulse-slow"/></div>
                    <div>
                        <h2 className="text-3xl font-bold text-white">Protocol: DNA Extraction</h2>
                        <p className="text-slate-400">Phase {history.length + 1} of 4</p>
                    </div>
                </div>

                {/* History */}
                <div className="space-y-6 mb-8 max-h-[30vh] overflow-y-auto custom-scrollbar pr-2">
                    {history.map((h, i) => (
                        <div key={i} className="opacity-50 hover:opacity-80 transition-opacity">
                            <div className="text-sm font-bold text-neon-blue mb-1">AGENT</div>
                            <div className="text-slate-300 mb-2">{h.question}</div>
                            <div className="pl-4 border-l-2 border-slate-700 text-slate-500 italic">{h.answer}</div>
                        </div>
                    ))}
                </div>

                {/* Active Question */}
                <div className="mb-6">
                    <div className="text-lg font-bold text-white mb-4 animate-in fade-in key={currentQ}">
                        {loading ? <TypingIndicator /> : currentQ}
                    </div>
                    <textarea 
                        className="w-full h-32 bg-black/30 border border-slate-700 rounded-xl p-4 text-white focus:border-neon-blue outline-none resize-none font-mono text-sm focus:ring-1 focus:ring-neon-blue/50 transition-all"
                        placeholder="Deep dive..."
                        autoFocus
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNext(); }}}
                    />
                </div>

                {/* Controls */}
                <div className="flex justify-between items-center mt-8">
                    <div className="text-xs text-slate-500 uppercase tracking-widest font-bold flex items-center gap-2">
                        {loading ? <><Loader2 className="w-3 h-3 animate-spin"/> NEURAL SYNC...</> : 'AWAITING INPUT'}
                    </div>
                    <button onClick={handleNext} disabled={loading || !answer} className="flex items-center gap-2 bg-white text-black px-8 py-4 rounded-xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50 hover:scale-105 active:scale-95">
                        {loading ? 'CALCULATING...' : 'NEXT'} 
                        {!loading && <ArrowRight className="w-5 h-5"/>}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 2. Mission Brief Component
const MissionBrief = ({ dna, setDna, onLaunch, isGenerating }: { dna: ProjectDNA, setDna: any, onLaunch: () => void, isGenerating: boolean }) => (
    <div className="flex items-center justify-center min-h-screen bg-obsidian p-6 relative">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
        <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-300 z-10 relative">
            <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-neon-purple/20 rounded-xl"><Target className="w-8 h-8 text-neon-purple"/></div>
                <div>
                    <h2 className="text-3xl font-bold text-white">Mission Briefing</h2>
                    <p className="text-slate-400">Confirm strategic parameters before launch.</p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-4">
                    {['Problem', 'Audience'].map((field) => (
                        <div key={field} className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase">{field}</label>
                            <input 
                                className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-sm text-white focus:border-neon-purple outline-none" 
                                value={(dna as any)[field.toLowerCase()]} 
                                onChange={e => setDna({...dna, [field.toLowerCase()]: e.target.value})} 
                            />
                        </div>
                    ))}
                </div>
                <div className="space-y-4">
                    {['Tone', 'AntiGoals'].map((field) => {
                        const fieldKey = field.charAt(0).toLowerCase() + field.slice(1);
                        return (
                            <div key={field} className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">{field === 'AntiGoals' ? 'Avoid (Anti-Goals)' : field}</label>
                                <input 
                                    className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-sm text-white focus:border-neon-purple outline-none" 
                                    value={(dna as any)[fieldKey]} 
                                    onChange={e => setDna({...dna, [fieldKey]: e.target.value})} 
                                />
                            </div>
                        );
                    })}
                </div>
                <div className="md:col-span-2 space-y-1">
                       <label className="text-xs font-bold text-slate-500 uppercase block mb-2">RAW CONTEXT DUMP (OPTIONAL)</label>
                       <textarea 
                            className="w-full h-20 bg-black/20 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 focus:border-slate-600 outline-none resize-none"
                            placeholder="Paste existing materials, notes, or raw data here..."
                            value={dna.rawContext}
                            onChange={(e) => setDna({...dna, rawContext: e.target.value})}
                       />
                </div>
            </div>
            
            <div className="flex justify-end">
                <button onClick={onLaunch} disabled={isGenerating} className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:scale-105 transition-transform flex items-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                    {isGenerating ? <Loader2 className="w-5 h-5 animate-spin"/> : <Rocket className="w-5 h-5"/>}
                    {isGenerating ? 'GENERATING PLAN...' : 'LAUNCH MISSION'}
                </button>
            </div>
        </div>
    </div>
);

// 3. Main Application Orchestrator
export default function App() {
    // --- State ---
    const [appState, setAppState] = useState<AppState>(AppState.IDLE);
    const [dna, setDna] = useState<ProjectDNA>({ audience: '', problem: '', tone: '', antiGoals: '', stakes: '', rawContext: '' });
    const [tasks, setTasks] = useState<MicroTask[]>([]);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    
    // Editor State
    const [editorContent, setEditorContent] = useState('');
    const [viewMode, setViewMode] = useState<'EDIT' | 'PREVIEW' | 'VISUAL'>('EDIT');
    const [previewHtml, setPreviewHtml] = useState('');
    const [visualCode, setVisualCode] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    
    // UI State
    const [showChat, setShowChat] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [isChatting, setIsChatting] = useState(false);
    const [showMissionBrief, setShowMissionBrief] = useState(false);
    const [showToast, setShowToast] = useState<{message: string, persona: AgentPersonality} | null>(null);
    const [audioEnabled, setAudioEnabled] = useState(false);

    // Flow State
    const [velocityData, setVelocityData] = useState<VelocityPoint[]>([]);
    const [flowState, setFlowState] = useState(false);
    const [combo, setCombo] = useState(0);
    const keystrokesRef = useRef(0);
    const lastKeystrokeRef = useRef(0);

    // --- Effects ---

    // Load & Init
    useEffect(() => {
        const saved = localStorage.getItem('kinetic_state');
        if (saved) {
            const data = JSON.parse(saved);
            setDna(data.dna);
            setTasks(data.tasks);
            if (data.tasks.length > 0) setAppState(AppState.DASHBOARD);
        }
        
        // Init velocity loop
        const interval = setInterval(() => {
            setVelocityData(prev => {
                const score = Math.min(100, keystrokesRef.current * 12); // Amplified for visual feedback
                const newPoints = [...prev, { time: Date.now().toString(), score }];
                return newPoints.slice(-50); 
            });
            
            if (Date.now() - lastKeystrokeRef.current > 3000) {
                setCombo(0);
                setFlowState(false);
            }
            keystrokesRef.current = 0;
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Audio State Manager
    useEffect(() => {
        if (appState === AppState.WORKING && audioEnabled) {
            sonicCortex.playFocusNoise();
        } else {
            sonicCortex.stop();
        }
    }, [appState, audioEnabled]);

    // Auto Save Logic
    useEffect(() => {
        if (appState === AppState.WORKING && currentTaskId) {
            const timer = setTimeout(() => {
                setTasks(prev => prev.map(t => t.id === currentTaskId ? { ...t, content: editorContent } : t));
                localStorage.setItem('kinetic_state', JSON.stringify({ dna, tasks: tasks.map(t => t.id === currentTaskId ? { ...t, content: editorContent } : t) }));
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [editorContent, currentTaskId, appState]);

    // Preview Logic
    useEffect(() => {
        if (viewMode === 'PREVIEW') {
            Promise.resolve(marked.parse(editorContent)).then(setPreviewHtml);
        }
        if (viewMode === 'VISUAL') {
            generateVisual(editorContent).then(setVisualCode);
        }
    }, [viewMode, editorContent]);

    // Intervention Logic
    useEffect(() => {
        if (appState !== AppState.WORKING || !currentTaskId) return;
        const interval = setInterval(async () => {
            const now = Date.now();
            // If user is stuck (low combo) but has content
            if (combo < 3 && editorContent.length > 100 && !isGenerating) {
                 const intervention = await generateIntervention(editorContent, dna);
                 if (intervention) {
                     setShowToast({ message: intervention.message, persona: intervention.agentPersona });
                     const msg: ChatMessage = { 
                         id: crypto.randomUUID(), role: 'ai', text: intervention.message, 
                         timestamp: now, senderName: intervention.agentPersona, personality: intervention.agentPersona 
                     };
                     setTasks(prev => prev.map(t => t.id === currentTaskId ? { ...t, chatHistory: [...t.chatHistory, msg] } : t));
                     setTimeout(() => setShowToast(null), 8000);
                 }
            }
        }, 60000); // Check every minute
        return () => clearInterval(interval);
    }, [currentTaskId, editorContent, dna, combo, isGenerating]);

    // --- Handlers ---

    const handleKeystroke = () => {
        lastKeystrokeRef.current = Date.now();
        keystrokesRef.current += 1;
        setCombo(prev => {
            const newCombo = prev + 1;
            if (newCombo > 15) setFlowState(true);
            return newCombo;
        });
    };

    const toggleAudio = () => {
        setAudioEnabled(!audioEnabled);
    };

    const handleLaunch = async () => {
        setIsGenerating(true);
        try {
            const plan = await generatePlan(dna);
            const newTasks: MicroTask[] = plan.map(p => ({ 
                ...p, id: crypto.randomUUID(), status: TaskStatus.PENDING, 
                verificationStatus: VerificationStatus.PENDING, chatHistory: [], 
                agentType: p.agentType as AgentType 
            }));
            setTasks(newTasks);
            setShowMissionBrief(false);
            // Auto-start first task
            if (newTasks.length > 0) {
                // Allow a brief delay for UI animation
                setTimeout(() => enterTask(newTasks[0].id, newTasks), 500);
            } else {
                setAppState(AppState.DASHBOARD);
            }
        } catch(e) {
            alert("Mission Generation Failed. Please Retry.");
        } finally {
            setIsGenerating(false);
        }
    };

    const enterTask = async (taskId: string, currentTaskList = tasks) => {
        // Save current if needed
        if (currentTaskId) {
             const updatedTasks = currentTaskList.map(t => t.id === currentTaskId ? { ...t, content: editorContent } : t);
             setTasks(updatedTasks);
             currentTaskList = updatedTasks;
        }

        const task = currentTaskList.find(t => t.id === taskId);
        if (!task) return;

        setCurrentTaskId(taskId);
        setEditorContent(task.content || '');
        setAppState(AppState.WORKING);
        setViewMode('EDIT');
        setAudioEnabled(true); // Auto-enable audio on entry

        if (!task.content) {
            setIsGenerating(true);
            const previousWork = currentTaskList.filter(t => t.status === TaskStatus.COMPLETED).map(t => t.content).join('\n---\n');
            try {
                const draft = await draftTaskContent(task, dna, previousWork);
                setEditorContent(draft);
                setTasks(prev => prev.map(t => t.id === taskId ? { ...t, content: draft, status: TaskStatus.IN_PROGRESS } : t));
            } catch(e) {
                setEditorContent("// Error generating draft. Please use the chat to request a new one.");
            } finally {
                setIsGenerating(false);
            }
        }
    };

    const handleExitTask = () => {
        if (currentTaskId) {
            setTasks(prev => {
                const updated = prev.map(t => t.id === currentTaskId ? { ...t, content: editorContent } : t);
                localStorage.setItem('kinetic_state', JSON.stringify({ dna, tasks: updated }));
                return updated;
            });
        }
        setAppState(AppState.DASHBOARD);
    };

    const handleCompleteTask = () => {
        if (currentTaskId) {
             setTasks(prev => {
                const updated = prev.map(t => t.id === currentTaskId ? { ...t, content: editorContent, status: TaskStatus.COMPLETED } : t);
                localStorage.setItem('kinetic_state', JSON.stringify({ dna, tasks: updated }));
                return updated;
            });
            setAppState(AppState.DASHBOARD);
        }
    };

    const handleChatSubmit = async () => {
        if (!chatInput.trim() || !currentTaskId) return;
        const task = tasks.find(t => t.id === currentTaskId);
        if (!task) return;

        const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: chatInput, timestamp: Date.now(), senderName: 'You' };
        setTasks(prev => prev.map(t => t.id === currentTaskId ? { ...t, chatHistory: [...t.chatHistory, userMsg] } : t));
        setChatInput('');
        setIsChatting(true);

        try {
            const response = await chatWithAgent(chatInput, task, editorContent, dna);
            const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: 'ai', text: response, timestamp: Date.now(), senderName: task.agentType, personality: 'DEFAULT' };
            setTasks(prev => prev.map(t => t.id === currentTaskId ? { ...t, chatHistory: [...t.chatHistory, aiMsg] } : t));
        } catch(e) {
             // handle error
        } finally {
            setIsChatting(false);
        }
    };

    const applyCodeBlock = (text: string) => {
        const code = extractCodeBlock(text);
        if (code) {
            setEditorContent(code);
            setViewMode('EDIT');
        }
    };
    
    const resetApp = () => {
        if (window.confirm("Resetting will delete all progress. Confirm?")) {
            localStorage.removeItem('kinetic_state');
            setAppState(AppState.IDLE);
            setDna({ audience: '', problem: '', tone: '', antiGoals: '', stakes: '', rawContext: '' });
            setTasks([]);
            setCurrentTaskId(null);
            setEditorContent('');
            sonicCortex.stop();
        }
    };

    // --- Render Logic ---

    if (appState === AppState.IDLE) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-obsidian text-white p-6 relative overflow-hidden">
               <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
               <div className="z-10 flex flex-col items-center max-w-2xl text-center animate-in fade-in zoom-in duration-700">
                   <Logo animate />
                   <h1 className="text-7xl font-black tracking-tighter mt-8 mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500 drop-shadow-2xl">KINETIC</h1>
                   <p className="text-slate-400 text-xl mb-8 max-w-lg">The high-velocity momentum engine.</p>
                   <button onClick={() => setAppState(AppState.DNA_EXTRACTION)} className="group relative px-8 py-4 bg-white text-black font-bold text-lg rounded-xl overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                       <span className="flex items-center gap-2 relative z-10">INITIATE SEQUENCE <ArrowRight className="w-5 h-5"/></span>
                   </button>
               </div>
            </div>
        );
    }

    if (appState === AppState.DNA_EXTRACTION) {
        if (showMissionBrief) return <MissionBrief dna={dna} setDna={setDna} onLaunch={handleLaunch} isGenerating={isGenerating} />;
        return <Onboarding dna={dna} setDna={setDna} onComplete={() => setShowMissionBrief(true)} />;
    }

    // Trajectory / Dashboard View
    if (appState === AppState.DASHBOARD) {
        return (
            <div className="flex min-h-screen bg-obsidian text-slate-200 relative">
                 <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none"></div>
                
                <div className="w-20 border-r border-slate-800 bg-charcoal/80 backdrop-blur flex flex-col items-center py-6 gap-8 z-20">
                    <Logo small />
                    <div className="flex-1"></div>
                    <button onClick={resetApp} className="p-3 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-xl transition-colors"><RotateCcw className="w-5 h-5"/></button>
                </div>
                
                <div className="flex-1 p-12 flex flex-col items-center relative overflow-y-auto">
                    <div className="z-10 w-full max-w-2xl relative">
                        <h1 className="text-4xl font-black text-center text-white tracking-tight mb-16 drop-shadow-lg">MISSION TRAJECTORY</h1>
                        
                        {/* Visual Path Line */}
                        <svg className="absolute left-0 top-20 bottom-0 w-full h-full pointer-events-none z-0" style={{ overflow: 'visible' }}>
                            <path 
                                d={`M -84 50 ${tasks.map((_, i) => `L -84 ${110 + (i * 160)}`).join(' ')}`}
                                stroke="#1e293b" 
                                strokeWidth="4" 
                                fill="none"
                                className="md:block hidden"
                            />
                             <path 
                                d={`M -84 50 ${tasks.map((t, i) => t.status === TaskStatus.COMPLETED ? `L -84 ${110 + (i * 160)}` : '').join(' ')}`}
                                stroke="#10b981" 
                                strokeWidth="4" 
                                fill="none"
                                className="md:block hidden transition-all duration-1000"
                                strokeDasharray="10 5"
                            />
                        </svg>

                        <div className="space-y-12">
                        {tasks.map((task, i) => (
                            <div key={task.id} className="relative group md:ml-0 ml-10">
                                {/* Timeline Node */}
                                <div className={`absolute -left-[41px] md:-left-[93px] top-1/2 transform -translate-y-1/2 w-6 h-6 rounded-full border-4 transition-all duration-300 z-10 ${task.status === TaskStatus.COMPLETED ? 'bg-neon-green border-obsidian shadow-[0_0_15px_#10b981]' : task.status === TaskStatus.IN_PROGRESS ? 'bg-neon-blue border-obsidian animate-pulse' : 'bg-slate-800 border-slate-600'}`}></div>
                                
                                <div 
                                    onClick={() => enterTask(task.id)}
                                    className={`relative p-6 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden ${task.status === TaskStatus.IN_PROGRESS ? 'bg-slate-900/90 border-neon-blue shadow-[0_0_40px_rgba(59,130,246,0.2)] scale-105' : 'bg-slate-900/40 border-slate-800 hover:bg-slate-900/80 hover:border-slate-600 hover:scale-[1.02]'}`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{task.agentType} // {task.estimatedMinutes}m</span>
                                        {task.status === TaskStatus.COMPLETED && <CheckCircle2 className="w-5 h-5 text-neon-green"/>}
                                    </div>
                                    <h3 className={`text-xl font-bold mb-1 ${task.status === TaskStatus.IN_PROGRESS ? 'text-white' : 'text-slate-300'}`}>{task.title}</h3>
                                    <p className="text-slate-400 text-sm line-clamp-2">{task.description}</p>
                                    
                                    {/* Active Glow Line */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-neon-blue to-neon-purple transition-opacity duration-300 ${task.status === TaskStatus.IN_PROGRESS ? 'opacity-100' : 'opacity-0'}`}></div>
                                </div>
                            </div>
                        ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Working View (The Tunnel)
    return (
        <div className="flex h-screen bg-obsidian overflow-hidden text-slate-200 relative">
             <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none"></div>

            {/* Toast */}
            {showToast && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in">
                    <div className="bg-slate-900 border border-neon-accent shadow-[0_0_30px_rgba(244,63,94,0.3)] px-6 py-4 rounded-2xl flex items-center gap-4 max-w-lg">
                        <div className="p-2 bg-neon-accent/20 rounded-full"><AlertTriangle className="w-6 h-6 text-neon-accent"/></div>
                        <div>
                            <div className="text-xs font-bold text-neon-accent uppercase mb-1">{showToast.persona} INTERVENTION</div>
                            <p className="text-sm font-medium text-white">{showToast.message}</p>
                        </div>
                        <button onClick={() => setShowToast(null)}><X className="w-4 h-4 text-slate-500 hover:text-white"/></button>
                    </div>
                </div>
            )}

            {/* Focus Sidebar */}
            <div className="w-16 bg-charcoal/90 backdrop-blur border-r border-slate-800 flex flex-col items-center py-6 z-20">
                <button onClick={handleExitTask} className="p-2 text-slate-500 hover:text-white mb-8"><ArrowLeft className="w-6 h-6"/></button>
                <div className="flex-1"></div>
                <button onClick={toggleAudio} className={`p-3 rounded-full mb-6 transition-all ${audioEnabled ? 'text-neon-blue bg-neon-blue/10 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'text-slate-600 hover:text-slate-400'}`}>
                    {audioEnabled ? <Volume2 className="w-5 h-5"/> : <VolumeX className="w-5 h-5"/>}
                </button>
                <div className={`w-2 h-2 rounded-full mb-4 transition-all duration-500 ${flowState ? 'bg-neon-accent animate-ping shadow-[0_0_10px_#f43f5e]' : 'bg-slate-700'}`}></div>
            </div>

            {/* Main Tunnel */}
            <div className="flex-1 flex flex-col relative z-10">
                {/* HUD Header */}
                <div className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/80 backdrop-blur z-30">
                    <div>
                         <h2 className="font-bold text-white flex items-center gap-3">
                             <span className="text-slate-500 text-xs uppercase tracking-widest bg-slate-800 px-2 py-1 rounded">OBJECTIVE</span> 
                             {tasks.find(t => t.id === currentTaskId)?.title}
                         </h2>
                    </div>
                    <div className="flex items-center gap-3">
                         <div className="flex bg-slate-800/50 rounded-lg p-1 border border-slate-700">
                             <button onClick={() => setViewMode('EDIT')} className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all ${viewMode === 'EDIT' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}><Edit3 className="w-3 h-3 inline mr-1"/> EDIT</button>
                             <button onClick={() => setViewMode('PREVIEW')} className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all ${viewMode === 'PREVIEW' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}><Copy className="w-3 h-3 inline mr-1"/> PREVIEW</button>
                             <button onClick={() => setViewMode('VISUAL')} className={`px-4 py-1.5 rounded-md text-[10px] font-bold transition-all ${viewMode === 'VISUAL' ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}><Network className="w-3 h-3 inline mr-1"/> VISUAL</button>
                         </div>
                         <button onClick={() => downloadArtifact(tasks.find(t=>t.id===currentTaskId)?.title || 'draft', editorContent)} className="ml-2 p-2 text-slate-400 hover:text-neon-blue hover:bg-neon-blue/10 rounded-lg transition-colors"><Download className="w-5 h-5"/></button>
                         <button onClick={() => setShowChat(!showChat)} className={`ml-2 p-2 rounded-lg transition-colors ${showChat ? 'text-neon-blue bg-neon-blue/10' : 'text-slate-400 hover:text-white'}`}><MessageSquare className="w-5 h-5"/></button>
                    </div>
                </div>

                {/* Editor Canvas */}
                <div className={`flex-1 relative overflow-hidden transition-all duration-1000 ${flowState ? 'shadow-[inset_0_0_150px_rgba(139,92,246,0.15)]' : ''}`}>
                    {isGenerating && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-obsidian/90 z-50 backdrop-blur-sm animate-in fade-in">
                            <Loader2 className="w-12 h-12 text-neon-blue animate-spin mb-4"/>
                            <p className="font-mono text-sm text-neon-blue animate-pulse uppercase tracking-widest">Synthesizing Draft...</p>
                        </div>
                    )}

                    <div className="h-full overflow-y-auto custom-scrollbar">
                         <div className="max-w-4xl mx-auto p-12 pb-48 min-h-full">
                             {viewMode === 'EDIT' ? (
                                 <textarea 
                                     value={editorContent} 
                                     onChange={(e) => { setEditorContent(e.target.value); handleKeystroke(); }}
                                     className={`w-full h-[80vh] bg-transparent resize-none outline-none font-mono leading-relaxed text-lg selection:bg-neon-blue/30 placeholder:text-slate-700 transition-colors duration-500 ${flowState ? 'text-slate-100 drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]' : 'text-slate-300'}`}
                                     placeholder="Execute..."
                                     spellCheck={false}
                                 />
                             ) : viewMode === 'PREVIEW' ? (
                                 <div className="prose prose-invert prose-lg max-w-none markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                             ) : (
                                 <MermaidDiagram code={visualCode} />
                             )}
                         </div>
                    </div>

                    {/* Velocity Footer */}
                    <div className="absolute bottom-0 left-0 right-0 h-64 pointer-events-none z-10 opacity-60">
                        <div className="w-full h-full mask-gradient-b">
                            <VelocityChart data={velocityData} />
                        </div>
                    </div>

                    {/* Complete Fab */}
                    <div className="absolute bottom-8 right-8 z-20">
                         <button 
                            onClick={handleCompleteTask}
                            className="group bg-white text-black pl-6 pr-2 py-2 rounded-full font-bold hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,255,255,0.25)] flex items-center gap-2"
                         >
                             COMPLETE SPRINT 
                             <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center group-hover:bg-neon-green transition-colors">
                                 <CheckCircle2 className="w-5 h-5 text-white"/>
                             </div>
                         </button>
                    </div>
                </div>
            </div>

            {/* Chat Panel */}
            {showChat && (
                <div className="w-96 border-l border-slate-800 bg-charcoal/95 backdrop-blur flex flex-col z-40 shadow-2xl animate-in slide-in-from-right duration-300">
                    <div className="p-4 border-b border-slate-800 font-bold text-xs text-slate-500 tracking-wider flex justify-between items-center">
                        <span>ACTIVE AGENT LINK</span>
                        <span className="text-neon-blue">{tasks.find(t => t.id === currentTaskId)?.agentType}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900/50 custom-scrollbar">
                        {tasks.find(t => t.id === currentTaskId)?.chatHistory.map((msg) => {
                            const codeBlock = extractCodeBlock(msg.text);
                            return (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <span className="text-[10px] text-slate-500 mb-1 uppercase font-bold">{msg.senderName}</span>
                                <div className={`p-3 rounded-xl text-sm max-w-[90%] ${msg.role === 'user' ? 'bg-neon-blue/10 text-neon-blue border border-neon-blue/20 rounded-tr-sm' : 'bg-slate-800 border border-slate-700 text-slate-300 rounded-tl-sm'}`}>
                                    <div className="whitespace-pre-wrap">{msg.text}</div>
                                    {codeBlock && msg.role === 'ai' && (
                                        <button 
                                            onClick={() => applyCodeBlock(msg.text)}
                                            className="mt-3 w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-neon-blue py-2 rounded-lg text-xs font-bold transition-colors border border-slate-700"
                                        >
                                            <Copy className="w-3 h-3"/> APPLY TO CANVAS
                                        </button>
                                    )}
                                </div>
                            </div>
                            );
                        })}
                        {isChatting && (
                            <div className="flex flex-col items-start">
                                <span className="text-[10px] text-slate-500 mb-1 uppercase font-bold">{tasks.find(t => t.id === currentTaskId)?.agentType}</span>
                                <div className="bg-slate-800 border border-slate-700 rounded-xl rounded-tl-sm">
                                    <TypingIndicator />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-4 bg-charcoal border-t border-slate-800">
                        <div className="relative">
                            <input 
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 pr-10 text-sm text-white focus:border-neon-blue outline-none focus:ring-1 focus:ring-neon-blue/50 transition-all"
                                placeholder="Command Agent..."
                            />
                            <button onClick={handleChatSubmit} className="absolute right-2 top-2 p-1 text-slate-400 hover:text-white"><ArrowRight className="w-4 h-4"/></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
