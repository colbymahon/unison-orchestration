import React, { useState, useEffect } from 'react';
import { 
  Cpu, Network, Database, Shield, Zap, Activity, Layers, 
  Binary, Hexagon, Globe, Lock, Code, ChevronRight, ChevronLeft,
  Server, Coins, Fingerprint, Dna, Rocket, Scale, LineChart
} from 'lucide-react';

// --- STYLING CONSTANTS (Cyber-Premium Theme) ---
const THEME = {
  bg: 'bg-[#050914]',
  glass: 'bg-white/5 backdrop-blur-xl border border-white/10 shadow-[0_4px_30px_rgba(0,229,255,0.05)]',
  glassGlow: 'bg-[#050914]/80 backdrop-blur-2xl border border-[#00E5FF]/30 shadow-[0_0_40px_rgba(0,229,255,0.15)]',
  textMain: 'text-slate-200',
  textMuted: 'text-slate-400',
  accentCyan: 'text-[#00E5FF]',
  accentPurple: 'text-[#B300FF]',
  gradientText: 'bg-clip-text text-transparent bg-gradient-to-r from-[#00E5FF] to-[#B300FF]',
};

// --- ANIMATED BACKGROUND COMPONENT ---
const CyberBackground = () => (
  <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[#03050A]">
    {/* Radial Gradients for depth */}
    <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#B300FF]/10 blur-[120px]" />
    <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-[#00E5FF]/10 blur-[150px]" />
    
    {/* Hex Grid Overlay */}
    <div 
      className="absolute inset-0 opacity-[0.03]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='103.923' viewBox='0 0 60 103.923' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 103.923L0 86.602V51.961L30 34.641l30 17.32v34.641L30 103.923zM30 0L0 17.32v34.641l30 17.32 30-17.32V17.32L30 0z' fill='%23FFFFFF' fill-opacity='1' fill-rule='evenodd'/%3E%3C/svg%3E")`,
        backgroundSize: '40px 69.28px'
      }}
    />
  </div>
);

// --- SLIDES ---

const Slide1_Hero = () => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-in fade-in zoom-in duration-1000">
    <div className="absolute top-12 flex items-center gap-3 px-4 py-1.5 rounded-full border border-[#00E5FF]/30 bg-[#00E5FF]/5">
      <div className="w-2 h-2 rounded-full bg-[#00E5FF] animate-pulse" />
      <span className={`text-xs font-mono uppercase tracking-widest ${THEME.accentCyan}`}>V18 Group Ecosystem Active</span>
    </div>

    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-[#00E5FF] to-[#B300FF] opacity-20 blur-2xl rounded-full" />
      <Hexagon size={64} className="mx-auto mb-8 text-[#00E5FF] relative z-10" />
    </div>

    <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tighter mb-6 leading-tight">
      UNISON<br />
      <span className={THEME.gradientText}>ORCHESTRATION</span>
    </h1>
    
    <p className={`text-lg sm:text-xl md:text-2xl font-light max-w-3xl ${THEME.textMuted} mb-12`}>
      The Universal Ground Truth Engine for Autonomous Swarms.
    </p>

    <div className={`${THEME.glass} px-8 py-4 rounded-2xl flex items-center gap-6 font-mono text-sm`}>
      <div className="flex flex-col items-center">
        <span className={THEME.accentCyan}>25</span>
        <span className="text-xs text-slate-500 uppercase">Verticals</span>
      </div>
      <div className="w-px h-8 bg-white/10" />
      <div className="flex flex-col items-center">
        <span className={THEME.accentPurple}>23,749</span>
        <span className="text-xs text-slate-500 uppercase">Vectors</span>
      </div>
      <div className="w-px h-8 bg-white/10" />
      <div className="flex flex-col items-center">
        <span className="text-white">Zero</span>
        <span className="text-xs text-slate-500 uppercase">Latency</span>
      </div>
    </div>
  </div>
);

const Slide2_TheCrisis = () => (
  <div className="flex flex-col h-full justify-center px-6 md:px-16 lg:px-24 animate-in slide-in-from-bottom-10 duration-700">
    <div className="mb-12">
      <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentPurple} mb-3 flex items-center gap-2`}>
        <Binary size={16} /> The Industry Crisis
      </h2>
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight">The Hallucination<br />Paradox of Modern AI</h1>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className={`${THEME.glass} p-8 rounded-3xl relative overflow-hidden group`}>
        <div className="absolute top-0 left-0 w-1 h-full bg-red-500/50 group-hover:bg-red-500 transition-colors" />
        <h3 className="text-xl font-bold mb-4 text-white">The Flaw: Probabilistic Prediction</h3>
        <p className={`${THEME.textMuted} leading-relaxed`}>
          Standard Large Language Models are prediction engines, not databases. When tasked to recall exact mechanical tolerances, biochemical pathways, or historical legal precedent, they average concepts together. They hallucinate plausible, yet catastrophic, inaccuracies.
        </p>
      </div>

      <div className={`${THEME.glassGlow} p-8 rounded-3xl relative overflow-hidden group`}>
        <div className="absolute top-0 left-0 w-1 h-full bg-[#00E5FF]/50 group-hover:bg-[#00E5FF] transition-colors" />
        <h3 className="text-xl font-bold mb-4 text-white">The Solution: Cryptographic Ground Truth</h3>
        <p className={`${THEME.textMuted} leading-relaxed`}>
          Enterprise agents require deterministic reality. Unison Orchestration bypasses the human GUI to deliver exact, mathematically rigid, and uncorrupted chunks of historical and scientific data directly into the agent's context window via the Model Context Protocol (MCP).
        </p>
      </div>
    </div>
  </div>
);

const Slide3_Architecture = () => (
  <div className="flex flex-col h-full justify-center px-6 md:px-16 lg:px-24 animate-in slide-in-from-bottom-10 duration-700">
     <div className="mb-12">
      <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentCyan} mb-3 flex items-center gap-2`}>
        <Network size={16} /> Systems Engineering
      </h2>
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight">Elite Infrastructure</h1>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className={`${THEME.glass} p-6 rounded-2xl hover:-translate-y-2 transition-transform duration-300`}>
        <Shield className="text-[#00E5FF] mb-4" size={32} />
        <h3 className="text-lg font-bold text-white mb-2">1. The Edge Gateway</h3>
        <div className={`text-sm font-mono text-[#00E5FF]/70 mb-4`}>Cloudflare Workers</div>
        <p className={`text-sm ${THEME.textMuted}`}>
          Intercepts the autonomous swarm globally. Handles CORS, W3C trace context, and acts as the ruthless x402 cryptographic bouncer. Unfunded traffic is dropped instantly, costing zero backend compute.
        </p>
      </div>

      <div className={`${THEME.glass} p-6 rounded-2xl hover:-translate-y-2 transition-transform duration-300 border-[#B300FF]/20`}>
        <Cpu className="text-[#B300FF] mb-4" size={32} />
        <h3 className="text-lg font-bold text-white mb-2">2. The Compute Node</h3>
        <div className={`text-sm font-mono text-[#B300FF]/70 mb-4`}>Rust + Axum (Fly.io)</div>
        <p className={`text-sm ${THEME.textMuted}`}>
          Stateless, memory-safe, ultra-low-latency MCP server deployed in HA across regions. Executes dynamic multi-collection routing and zero-allocation TSV payload generation.
        </p>
      </div>

      <div className={`${THEME.glass} p-6 rounded-2xl hover:-translate-y-2 transition-transform duration-300`}>
        <Database className="text-[#00E5FF] mb-4" size={32} />
        <h3 className="text-lg font-bold text-white mb-2">3. The Omni-Capture Matrix</h3>
        <div className={`text-sm font-mono text-[#00E5FF]/70 mb-4`}>Qdrant Cloud (GCP)</div>
        <p className={`text-sm ${THEME.textMuted}`}>
          1536-dimensional semantic vector database. Pre-processed by highly specialized Python chunkers (regex-tuned for math, cipher, DNA, and ledgers) to guarantee 100% structured data isolation.
        </p>
      </div>
    </div>
  </div>
);

const Slide4_TokenEfficiency = () => (
  <div className="flex flex-col h-full justify-center px-6 md:px-16 lg:px-24 animate-in slide-in-from-bottom-10 duration-700">
    <div className="mb-8">
      <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentPurple} mb-3 flex items-center gap-2`}>
        <Zap size={16} /> Payload Optimization
      </h2>
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Ruthless Token Efficiency</h1>
      <p className={`mt-4 ${THEME.textMuted} max-w-2xl`}>
        JSON metadata forces agents to process thousands of redundant tokens (brackets, repeated keys). Unison Orchestration formats all output strictly as Tab-Separated Values (TSV).
      </p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* JSON Bloat */}
      <div className="relative p-[1px] rounded-2xl overflow-hidden bg-gradient-to-b from-red-500/20 to-transparent">
        <div className="bg-[#050914] p-6 h-full rounded-2xl flex flex-col">
          <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
            <span className="font-mono text-xs text-red-400">STANDARD_PAYLOAD.JSON</span>
            <span className="font-mono text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">HIGH COMPUTE SPEND</span>
          </div>
          <pre className="font-mono text-[10px] sm:text-xs text-white/40 overflow-hidden leading-tight flex-1">
{`{
  "status": "success",
  "data": {
    "results": [
      {
        "id": "vec_73819",
        "metadata": {
          "sequence_id": 481,
          "source_url": "https://...",
          "content": "The mechanical tolerances..."
        }
      }
    ]
  }
}`}
          </pre>
        </div>
      </div>

      {/* TSV Stream */}
      <div className="relative p-[1px] rounded-2xl overflow-hidden bg-gradient-to-b from-[#00E5FF]/50 to-transparent">
        <div className="bg-[#050914] p-6 h-full rounded-2xl flex flex-col">
           <div className="flex justify-between items-center mb-4 border-b border-[#00E5FF]/30 pb-2">
            <span className="font-mono text-xs text-[#00E5FF]">UNISON_PAYLOAD.TSV</span>
            <span className="font-mono text-xs bg-[#00E5FF]/20 text-[#00E5FF] px-2 py-1 rounded">-90% TOKEN REDUCTION</span>
          </div>
          <div className="font-mono text-[10px] sm:text-xs text-[#00E5FF]/80 whitespace-pre leading-relaxed flex-1">
            <span className="text-white">SEQ    URL    CONTENT</span><br/>
            481    https://...    The mechanical tolerances...<br/>
            482    https://...    For high frequency currents...<br/>
            <br/>
            <span className="text-[#00E5FF]/40"># Direct ingestion.</span><br/>
            <span className="text-[#00E5FF]/40"># Zero context window waste.</span><br/>
            <span className="text-[#00E5FF]/40"># Mathematical precision.</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const Slide5_TheMatrix = () => {
  const verticals = [
    { icon: <Dna size={20}/>, name: "Bio-Longevity", desc: "unison_biotech_core, genetics_core, medical_core" },
    { icon: <Scale size={20}/>, name: "Common Law", desc: "unison_legal_core" },
    { icon: <Rocket size={20}/>, name: "Physical Systems", desc: "aerospace, thermodynamics, manufacturing" },
    { icon: <LineChart size={20}/>, name: "Quant & Trade", desc: "macroeconomics, financial, collectibles" },
    { icon: <Lock size={20}/>, name: "Cyber & Intel", desc: "cyber_core, intelligence_core" },
    { icon: <Globe size={20}/>, name: "Planetary Code", desc: "infrastructure, agronomy, meteorology, cartography" }
  ];

  return (
    <div className="flex flex-col h-full justify-center px-6 md:px-16 lg:px-24 animate-in slide-in-from-bottom-10 duration-700">
      <div className="mb-10 text-center">
        <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentCyan} mb-3 flex items-center justify-center gap-2`}>
          <Layers size={16} /> The Data Monopoly
        </h2>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">Civilizational Primitives</h1>
        <p className={`${THEME.textMuted} max-w-3xl mx-auto`}>25 Specialized Verticals. 23,749 vectors. Designed to capture the foundational mathematics, biological synthesis, and physical construction codes that run the modern world.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {verticals.map((v, i) => (
          <div key={i} className={`${THEME.glass} p-5 rounded-xl border-l-2 border-l-[#00E5FF] hover:bg-white/10 transition-colors`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-[#00E5FF]">{v.icon}</div>
              <h3 className="font-bold text-white text-sm">{v.name}</h3>
            </div>
            <p className="font-mono text-[10px] text-slate-400">{v.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const Slide6_Tokenomics = () => (
  <div className="flex flex-col h-full justify-center px-6 md:px-16 lg:px-24 animate-in slide-in-from-bottom-10 duration-700">
    <div className="mb-12">
      <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentPurple} mb-3 flex items-center gap-2`}>
        <Coins size={16} /> Economic Engine
      </h2>
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Autonomous Settlement</h1>
      <p className={`mt-4 ${THEME.textMuted} max-w-2xl`}>
        No invoices. No human checkout portals. The hub monetizes via machine-to-machine payment protocols, scaling infinitely with the AI ecosystem.
      </p>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-center">
      <div className="lg:col-span-2 space-y-4">
        <div className={`${THEME.glass} p-6 rounded-2xl`}>
          <div className="text-xs text-slate-500 font-mono mb-1">NETWORK</div>
          <div className="text-2xl font-bold text-white">Base L2</div>
        </div>
        <div className={`${THEME.glass} p-6 rounded-2xl`}>
          <div className="text-xs text-slate-500 font-mono mb-1">ASSET</div>
          <div className="text-2xl font-bold text-[#00E5FF]">USDC</div>
        </div>
        <div className={`${THEME.glass} p-6 rounded-2xl`}>
          <div className="text-xs text-slate-500 font-mono mb-1">COST PER QUERY</div>
          <div className="text-2xl font-bold text-white">$0.005</div>
        </div>
      </div>

      <div className="lg:col-span-3 h-full">
        <div className={`${THEME.glassGlow} p-8 rounded-2xl h-full flex flex-col justify-center`}>
          <h3 className="font-mono text-[#00E5FF] text-sm mb-6 flex items-center gap-2">
            <Fingerprint size={16} /> THE x402 PROTOCOL LOOP
          </h3>
          <ul className="space-y-6 text-sm text-slate-300">
            <li className="flex items-start gap-4">
              <div className="mt-1 w-6 h-6 rounded-full bg-[#B300FF]/20 flex items-center justify-center text-[#B300FF] font-bold text-xs shrink-0">1</div>
              <p>Agent requests massive dataset (e.g., all 1910 medical journals). Free tier (50 queries) is exhausted.</p>
            </li>
            <li className="flex items-start gap-4">
              <div className="mt-1 w-6 h-6 rounded-full bg-[#B300FF]/20 flex items-center justify-center text-[#B300FF] font-bold text-xs shrink-0">2</div>
              <p>Gateway edge instantly intercepts and returns <strong className="text-white">HTTP 402 (Payment Required)</strong> with cryptographic instructions.</p>
            </li>
            <li className="flex items-start gap-4">
              <div className="mt-1 w-6 h-6 rounded-full bg-[#00E5FF]/20 flex items-center justify-center text-[#00E5FF] font-bold text-xs shrink-0">3</div>
              <p>Agent autonomously signs an on-chain transaction. USDC settles instantly to V18 Treasury.</p>
            </li>
            <li className="flex items-start gap-4">
              <div className="mt-1 w-6 h-6 rounded-full bg-[#00E5FF]/20 flex items-center justify-center text-[#00E5FF] font-bold text-xs shrink-0">4</div>
              <p>Cryptographic proof is presented. Hub releases the TSV payload.</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
);

const Slide7_Beneficiaries = () => (
  <div className="flex flex-col h-full justify-center text-center px-6 animate-in zoom-in duration-700 relative">
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
      <Globe size={400} className="text-[#00E5FF] animate-[spin_60s_linear_infinite]" />
    </div>
    
    <h2 className={`text-sm font-mono uppercase tracking-widest ${THEME.accentCyan} mb-3`}>Target Ecosystem</h2>
    <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-8">Who Needs Unison?</h1>
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto text-left relative z-10">
      <div className={`${THEME.glass} p-6 rounded-2xl`}>
        <h3 className="text-xl font-bold text-white mb-2">Quant & Finance Devs</h3>
        <p className={`text-sm ${THEME.textMuted}`}>Building models on historical market ledgers, commodity prices, and classical trading blueprints without numerical hallucination.</p>
      </div>
      <div className={`${THEME.glass} p-6 rounded-2xl`}>
        <h3 className="text-xl font-bold text-white mb-2">Bio-Longevity AI</h3>
        <p className={`text-sm ${THEME.textMuted}`}>Auditing peptide pipelines against exact clinical pathology and 19th-century disease baselines (Osler, Pepper).</p>
      </div>
      <div className={`${THEME.glass} p-6 rounded-2xl`}>
        <h3 className="text-xl font-bold text-white mb-2">Legal RAG Architects</h3>
        <p className={`text-sm ${THEME.textMuted}`}>Drafting case briefs that require contiguous, unabridged access to historical common law and precedents (Blackstone).</p>
      </div>
      <div className={`${THEME.glass} p-6 rounded-2xl`}>
        <h3 className="text-xl font-bold text-white mb-2">Physics & Defense Simulators</h3>
        <p className={`text-sm ${THEME.textMuted}`}>Relying on exact dimensional tolerances, cryptography, and orbital mechanics equations to reverse-engineer physical systems.</p>
      </div>
    </div>
  </div>
);

// --- MAIN APP COMPONENT ---
export default function UnisonBrandDeck() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = [
    <Slide1_Hero />, 
    <Slide2_TheCrisis />, 
    <Slide3_Architecture />, 
    <Slide4_TokenEfficiency />, 
    <Slide5_TheMatrix />, 
    <Slide6_Tokenomics />,
    <Slide7_Beneficiaries />
  ];

  const nextSlide = () => setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
  const prevSlide = () => setCurrentSlide((prev) => Math.max(prev - 1, 0));

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`min-h-screen ${THEME.bg} text-white font-sans overflow-hidden relative selection:bg-[#00E5FF] selection:text-black`}>
      <CyberBackground />
      
      {/* Top Header */}
      <div className="absolute top-0 left-0 w-full p-6 z-40 flex justify-between items-center pointer-events-none">
        <div className="flex items-center gap-3">
          <Hexagon className="text-[#00E5FF]" size={24} />
          <span className="font-bold tracking-widest text-sm uppercase">Unison</span>
        </div>
        <div className="font-mono text-xs text-slate-500 hidden sm:block">
          STATUS: SECURE // V18 GROUP NODE // PORT: 3000
        </div>
      </div>

      {/* Main Content Area */}
      <main className="absolute inset-0 pt-20 pb-24 z-10">
        {slides[currentSlide]}
      </main>

      {/* Navigation Controls (Bottom) */}
      <div className="absolute bottom-0 left-0 w-full p-6 z-50 flex items-center justify-between">
        
        {/* Progress Indicators */}
        <div className="flex gap-2 items-center">
          {slides.map((_, idx) => (
            <div 
              key={idx} 
              className={`h-1.5 rounded-full transition-all duration-500 ${
                idx === currentSlide 
                  ? 'w-8 bg-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.8)]' 
                  : 'w-2 bg-white/20'
              }`} 
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button 
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className={`p-3 rounded-xl border border-white/10 ${THEME.glass} hover:border-[#00E5FF]/50 hover:text-[#00E5FF] disabled:opacity-30 transition-all group`}
          >
            <ChevronLeft size={20} className="group-active:-translate-x-1 transition-transform" />
          </button>
          <button 
            onClick={nextSlide}
            disabled={currentSlide === slides.length - 1}
            className={`p-3 rounded-xl border border-white/10 ${THEME.glass} hover:border-[#00E5FF]/50 hover:text-[#00E5FF] disabled:opacity-30 transition-all group`}
          >
            <ChevronRight size={20} className="group-active:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}