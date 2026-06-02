export interface Collection {
  id: string;
  label: string;
  vectors: number;
  category: string;
  description: string;
  sources: string[];
  sampleTsv: string;
  color: "cyan" | "purple" | "emerald" | "amber";
}

export const COLLECTIONS: Collection[] = [
  {
    id: "unison_medical_core",
    label: "Medical Core",
    vectors: 4527,
    category: "Life Sciences",
    description:
      "Clinical pathology tables, pharmacological dosages, anatomical reference data, and surgical procedure matrices drawn from canonical public-domain medical texts.",
    sources: ["William Osler", "Pepper's System of Medicine", "Gray's Anatomy", "Manual of Surgery"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
med_001\tunison_medical_core\tPharmacology\tMorphine sulfate dosage table: adult oral 10-30mg q4h; IV 2-4mg q4h; pediatric 0.1-0.2mg/kg q4h. Peak effect: oral 90min, IV 20min.
med_002\tunison_medical_core\tPathology\tPneumonia differential: Streptococcus pneumoniae (30-35%), Haemophilus influenzae (10-15%), Mycoplasma pneumoniae (15-20%). Lobar consolidation on CXR.`,
  },
  {
    id: "unison_manufacturing_core",
    label: "Manufacturing Core",
    vectors: 3374,
    category: "Engineering",
    description:
      "CNC machining parameters, metallurgy phase diagrams, tooling sequences, and material removal rate equations from foundational machine-shop practice references.",
    sources: ["Rose Modern Machine-Shop Practice"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
mfg_001\tunison_manufacturing_core\tCNC\tHigh-speed steel drill speeds (RPM): aluminum 3000-8000, mild steel 600-1200, stainless 300-600, cast iron 400-800. Feed rate: 0.002-0.006 in/rev.
mfg_002\tunison_manufacturing_core\tMetallurgy\tAnnealing temperature table: low-carbon steel 800-900°C, high-carbon steel 750-800°C, copper 600-650°C. Cooling: furnace cool at ≤50°C/hr.`,
  },
  {
    id: "unison_public_domain",
    label: "Public Domain Core",
    vectors: 3700,
    category: "Strategy & Philosophy",
    description:
      "Strategic and philosophical frameworks from Sun Tzu, Clausewitz, Musashi, Machiavelli, and Taylor — structured as dense TSV for agent consumption.",
    sources: ["Sun Tzu", "Clausewitz On War", "Musashi Book of Five Rings", "Machiavelli", "Taylor Principles"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
pub_001\tunison_public_domain\tStrategy\tSun Tzu Chapter 3: "Supreme excellence consists in breaking the enemy's resistance without fighting." Key principle: strategic positioning over direct confrontation.
pub_002\tunison_public_domain\tPhilosophy\tClausewitz: "War is merely the continuation of policy by other means." Friction in war: fog of uncertainty, chance, physical exertion.`,
  },
  {
    id: "unison_chemistry_core",
    label: "Chemistry Core",
    vectors: 1774,
    category: "Physical Sciences",
    description:
      "Stoichiometric formulas, elemental tables, synthesis equations, and molecular weight data from Mendeleev's Principles of Chemistry.",
    sources: ["Mendeleev Principles of Chemistry"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
chem_001\tunison_chemistry_core\tPeriodic\tPeriod 4 transition metals: Ti(47.9) V(50.9) Cr(52.0) Mn(54.9) Fe(55.8) Co(58.9) Ni(58.7) Cu(63.5) Zn(65.4). Electron config: [Ar]3d^n4s^2.
chem_002\tunison_chemistry_core\tStoichiometry\tCombustion of ethane: 2C2H6 + 7O2 → 4CO2 + 6H2O. ΔH = -1559.8 kJ/mol. Theoretical yield CO2: 44g per 30g ethane burned.`,
  },
  {
    id: "unison_macroeconomics_core",
    label: "Macroeconomics Core",
    vectors: 1765,
    category: "Finance & Trade",
    description:
      "Tariff schedules, trade pricing matrices, division-of-labour frameworks, and market mechanism tables from Adam Smith's Wealth of Nations.",
    sources: ["Adam Smith Wealth of Nations"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
econ_001\tunison_macroeconomics_core\tTrade\tSmith Book IV Chapter 2: Absolute advantage in trade—export goods where domestic labour cost < foreign labour cost. Pin factory: 18 operations, 10 workers, 48,000 pins/day vs. 1/worker solo.
econ_002\tunison_macroeconomics_core\tPricing\tMarket price vs. natural price: short-run deviation driven by demand shocks. Long-run convergence to natural price = sum of wages + profit + rent.`,
  },
  {
    id: "unison_financial_core",
    label: "Financial Core",
    vectors: 1564,
    category: "Finance & Trade",
    description:
      "Ledger-row protection schemas, trading blueprints, and numerical market grids from Mackay's Extraordinary Popular Delusions, plus SEC EDGAR 10-K institutional tier (AAPL, MSFT, TSLA, NVDA, AMZN FY2025/2026).",
    sources: ["Mackay Extraordinary Popular Delusions 1841", "SEC EDGAR 10-K FY2025/2026"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
fin_001\tunison_financial_core\tMarket\tSouth Sea Bubble chronology: 1720 Jan share price £128 → Jun peak £1,050 → Dec collapse £124. Volume surge pattern: parabolic 30-day advance, distribution phase, cliff-edge decline.
fin_002\tunison_financial_core\tRisk\tTulip mania price index 1636-37: Semper Augustus peak 10,000 florins (=10 years skilled craftsman wages). Futures contracts on undelivered bulbs—first recorded derivatives crash.`,
  },
  {
    id: "unison_engineering_core",
    label: "Engineering Core",
    vectors: 1608,
    category: "Engineering",
    description:
      "Electrical specs, dimensional tolerances, naval architecture data, maritime engineering tables, and ArXiv cs.AI research from Tesla and canonical engineering references.",
    sources: ["Nikola Tesla", "Bourne Handbook", "Nares Seamanship", "Douglas Naval Architecture", "ArXiv cs.AI"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
eng_001\tunison_engineering_core\tElectrical\tTesla coil resonance: f = 1/(2π√LC). L=inductance(H), C=capacitance(F). Secondary coil Q-factor target: >100 for efficient energy transfer. Skin depth: δ = √(2ρ/ωμ).
eng_002\tunison_engineering_core\tNaval\tDisplacement formula: D = L×B×T×Cb×ρ. Cb (block coefficient) cargo vessels 0.75-0.85, destroyers 0.45-0.55. Reserve buoyancy minimum 15% for ocean-going.`,
  },
  {
    id: "unison_legal_core",
    label: "Legal Core",
    vectors: 50994,
    category: "Law",
    description:
      "Supreme Court (SCOTUS) opinions, judicial holdings, and case law precedent sourced from CourtListener v4 — 500+ opinions including Glossip v. Oklahoma, Louisiana v. Callais, Whitton v. Dixon, Wisconsin Bell v. US (2025-2026 term). Institutional-tier x402 pricing.",
    sources: ["CourtListener SCOTUS Opinions 2025-2026", "Blackstone Commentaries", "Holmes The Common Law"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
leg_001\tunison_legal_core\tSCOTUS\tGlossip v. Oklahoma (2025): reversed; majority held the Eighth Amendment does not categorically prohibit execution methods. Dissent: Sotomayor argued burden of proof misallocated to prisoner challenging method.
leg_002\tunison_legal_core\tSCOTUS\tLouisiana v. Callais (2026): redistricting challenge. Court applied Shaw v. Reno racial gerrymandering framework. Strict scrutiny triggered when race is predominant factor in district line-drawing.`,
  },
  {
    id: "unison_edgar_institutional",
    label: "EDGAR Institutional",
    vectors: 360,
    category: "Finance & Trade",
    description:
      "SEC EDGAR 10-K institutional-tier filings for AAPL, MSFT, TSLA, NVDA, AMZN (FY2025/2026). High-fidelity financial statement data for agent-grounded equity analysis.",
    sources: ["SEC EDGAR 10-K FY2025", "SEC EDGAR 10-K FY2026"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
edgar_001\tunison_edgar_institutional\tEquity\tApple Inc. FY2025 10-K: Revenue $391.0B (+6% YoY), Net income $93.7B, EPS $6.08 diluted. Services segment $96.2B (25% of revenue). Cash and equivalents $53.8B.
edgar_002\tunison_edgar_institutional\tEquity\tNVIDIA FY2026 10-K: Revenue $130.5B (+114% YoY), Data Center $115.2B (88% of revenue). Gross margin 74.8%. GAAP EPS $2.94.`,
  },
  {
    id: "unison_astrophysics_core",
    label: "Astrophysics Core",
    vectors: 593,
    category: "Physical Sciences",
    description:
      "Orbital mechanics equations, celestial navigation tables, physics constants, and Newtonian gravitational formulas from Newton's Principia (Motte translation).",
    sources: ["Newton Principia Mathematica (Motte trans.)"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
astro_001\tunison_astrophysics_core\tOrbital\tKepler Third Law: T²∝a³. For solar orbit: T(years) = a(AU)^1.5. Earth a=1AU T=1yr; Mars a=1.524AU T=1.881yr; Jupiter a=5.203AU T=11.86yr.
astro_002\tunison_astrophysics_core\tGravitation\tNewton: F = Gm₁m₂/r². G=6.674×10⁻¹¹ N·m²/kg². Escape velocity: v_e = √(2GM/r). Earth: 11.2 km/s. Moon: 2.38 km/s.`,
  },
  {
    id: "unison_mathematics_core",
    label: "Mathematics Core",
    vectors: 585,
    category: "Formal Sciences",
    description:
      "Symbolic logic notation, formal proof schemas, algebraic reasoning frameworks, and set theory foundations from De Morgan's Formal Logic.",
    sources: ["De Morgan Formal Logic", "Granville Calculus Excerpt"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
math_001\tunison_mathematics_core\tLogic\tDe Morgan laws: ¬(A∧B)≡¬A∨¬B; ¬(A∨B)≡¬A∧¬B. Modus ponens: [P∧(P→Q)]→Q. Modus tollens: [¬Q∧(P→Q)]→¬P. Contrapositive: (P→Q)≡(¬Q→¬P).
math_002\tunison_mathematics_core\tCalculus\tTaylor series: f(x)=Σ[f^(n)(a)/n!](x-a)^n. e^x=1+x+x²/2!+x³/3!+… sin(x)=x-x³/3!+x⁵/5!-… Radius convergence: lim|a_{n+1}/a_n|.`,
  },
  {
    id: "unison_biotech_core",
    label: "Biotech Core",
    vectors: 476,
    category: "Life Sciences",
    description:
      "Amino acid sequences, metabolic pathway matrices, pharmacological interaction tables, and biochemical synthesis routes from Thatcher's Plant Life.",
    sources: ["Thatcher Plant Life"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
bio_001\tunison_biotech_core\tMetabolism\tGlycolysis summary: Glucose(6C) → 2 Pyruvate(3C). Net yield: 2ATP, 2NADH. Key enzymes: hexokinase, phosphofructokinase (rate-limiting), pyruvate kinase. Inhibited by ATP, citrate.
bio_002\tunison_biotech_core\tAmino Acids\tEssential amino acids (human): His, Ile, Leu, Lys, Met, Phe, Thr, Trp, Val. pKa values: Asp(3.65), Glu(4.25), His(6.0), Cys(8.18), Lys(10.53), Arg(12.48).`,
  },
  {
    id: "unison_architecture_core",
    label: "Architecture Core",
    vectors: 414,
    category: "Engineering",
    description:
      "Building codes, material stress tables, structural load equations, and architectural proportion systems from Vitruvius's Ten Books on Architecture.",
    sources: ["Vitruvius Ten Books on Architecture"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
arch_001\tunison_architecture_core\tStructural\tVitruvius column proportions—Doric: height=6×diameter. Ionic: height=8×diameter. Corinthian: height=10×diameter. Entasis correction factor: 1/4 of lower diameter added at mid-column.
arch_002\tunison_architecture_core\tMaterials\tRoman concrete (opus caementicium): volcanic pozzolana + lime + seawater. Compressive strength: 30-40 MPa. Tensile: ~5 MPa. Superior sulfate resistance vs. modern OPC.`,
  },
  {
    id: "unison_agronomy_core",
    label: "Agronomy Core",
    vectors: 330,
    category: "Life Sciences",
    description:
      "Soil chemistry tables (N-P-K and pH), crop yield matrices, irrigation physics, and soil amendment protocols from King's The Soil.",
    sources: ["King's The Soil"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
agro_001\tunison_agronomy_core\tSoilChemistry\tOptimal soil pH by crop: corn 6.0-6.8, wheat 6.0-7.0, soybeans 6.0-7.0, potatoes 4.8-5.4, blueberries 4.5-5.0. Lime application: 1 ton/acre raises pH by ~0.5 in loam.
agro_002\tunison_agronomy_core\tNPK\tN-P-K deficiency symptoms: Nitrogen=yellowing of older leaves, slow growth; Phosphorus=purple tint, delayed maturity; Potassium=brown leaf margins, weak stems.`,
  },
  {
    id: "unison_dtc_core",
    label: "DTC Core",
    vectors: 324,
    category: "Commerce",
    description:
      "Step-by-step fulfillment processes, supply chain routing matrices, and direct-response conversion formulas from public-domain commerce texts.",
    sources: ["Gutenberg #43659"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
dtc_001\tunison_dtc_core\tFulfillment\tOrder-to-ship SLA table: standard 3-5 days, expedited 1-2 days, same-day <4hr cutoff 2PM local. Pick accuracy target ≥99.8%. Pack station throughput: 150-200 units/hr/operator.
dtc_002\tunison_dtc_core\tConversion\tDirect response formula (AIDA): Attention (headline)→Interest (problem statement)→Desire (benefit stack)→Action (CTA). Response rate benchmarks: direct mail 2-5%, email 0.5-2%.`,
  },
  {
    id: "unison_thermodynamics_core",
    label: "Thermodynamics Core",
    vectors: 256,
    category: "Physical Sciences",
    description:
      "Heat transfer laws, Carnot engine efficiency equations, thermodynamic cycle tables, and entropy derivations from Carnot's Motive Power of Heat.",
    sources: ["Carnot Motive Power of Heat"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
thermo_001\tunison_thermodynamics_core\tCycles\tCarnot efficiency: η = 1 - T_cold/T_hot (absolute temperatures). Steam cycle at T_hot=500K, T_cold=300K: η_max = 40%. Real steam turbines: η ≈ 35-42%.
thermo_002\tunison_thermodynamics_core\tHeatTransfer\tFourier's law: q = -kA(dT/dx). Thermal conductivity k(W/m·K): copper 401, aluminum 237, steel 50, concrete 1.7, air 0.026.`,
  },
  {
    id: "unison_collectibles_core",
    label: "Collectibles Core",
    vectors: 196,
    category: "Commerce",
    description:
      "Vintage Pokémon TCG checklists, alphanumeric card numbers, set variant matrices, parallel tracking, and break probability grids for Base Era sets.",
    sources: ["Pokémon TCG Base Era Reference Data"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
col_001\tunison_collectibles_core\tPokemonTCG\tBase Set 1999 (102 cards): Charizard #4/102 Holo Rare. PSA 10 population: 3,283. Market ref: $350-$500 raw NM, $2,000-$8,000 PSA 10. Shadowless variant commands 3-5× premium.
col_002\tunison_collectibles_core\tBreakProbability\tBase Set booster pack odds: Holo Rare 1/3 packs, Rare 1/2 packs, Uncommon 3/pack, Common 5/pack. Charizard pull rate from sealed box (36 packs): ~8% expected.`,
  },
  {
    id: "unison_aerospace_core",
    label: "Aerospace Core",
    vectors: 145,
    category: "Engineering",
    description:
      "Flight dynamics equations, aerodynamic coefficient tables, airfoil performance data, and lift/drag polar matrices from Fage's The Aeroplane.",
    sources: ["Fage The Aeroplane"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
aero_001\tunison_aerospace_core\tAerodynamics\tLift equation: L = ½ρV²SCl. Drag: D = ½ρV²SCd. Cl_max NACA 2412 ≈ 1.6 at α=16°. Stall speed: V_s = √(2W/ρSCl_max). L/D ratio typical cruise: 12-18.
aero_002\tunison_aerospace_core\tPropulsion\tThrust equation: F = ṁ(V_e - V_0) + (P_e - P_a)A_e. Specific impulse: I_sp = F/(ṁg₀). Turbojet cruise I_sp ≈ 3000s; rocket I_sp ≈ 300-450s.`,
  },
  {
    id: "unison_intelligence_core",
    label: "Intelligence Core",
    vectors: 145,
    category: "Strategy & Philosophy",
    description:
      "OSINT/HUMINT tradecraft frameworks, clandestine field protocols, operational security hierarchies, and counter-intelligence methods from Grant's Spies & Secret Service.",
    sources: ["Grant Spies & Secret Service"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
intel_001\tunison_intelligence_core\tOSINT\tSource reliability matrix: A=completely reliable, B=usually reliable, C=fairly reliable, D=not usually reliable, E=unreliable, F=cannot be judged. Information credibility: 1=confirmed, 2=probably true, 3=possibly true, 4=doubtful, 5=improbable.
intel_002\tunison_intelligence_core\tTradecraft\tDead drop protocol: concealment site selected 72hr prior, signal (chalk mark/coin placement) triggers retrieval within 24hr window. Surveillance detection route minimum 45min before site approach.`,
  },
  {
    id: "unison_cyber_core",
    label: "Cyber Core",
    vectors: 140,
    category: "Formal Sciences",
    description:
      "Foundational cryptography algorithms, historical cipher matrices, early telegraphic protocols, and key exchange frameworks from Robinson's 1897 treatise.",
    sources: ["Robinson Telegraphic Ciphers 1897"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
cyber_001\tunison_cyber_core\tCryptography\tVigenère cipher key schedule: plaintext_i XOR key[i mod len(key)]. Kasiski test: repeated ciphertext trigrams → likely key length divisors. Index of coincidence: English IC≈0.065, random IC≈0.038.
cyber_002\tunison_cyber_core\tProtocol\tMorse code timing ratios: dot=1 unit, dash=3 units, intra-char gap=1 unit, inter-char gap=3 units, word gap=7 units. WPM=words/min at 1 word=50 dots standard.`,
  },
  {
    id: "unison_genetics_core",
    label: "Genetics Core",
    vectors: 237,
    category: "Life Sciences",
    description:
      "Mendelian inheritance ratios, phenotypic probability matrices, hybridisation outcome tables, and dominant/recessive probability grids from Mendel's Experiments.",
    sources: ["Mendel Experiments on Plant Hybridisation"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
gen_001\tunison_genetics_core\tInheritance\tMonohybrid cross (Aa×Aa): genotype ratio 1AA:2Aa:1aa. Phenotype ratio 3 dominant: 1 recessive. Dihybrid (AaBb×AaBb): 9A_B_:3A_bb:3aaB_:1aabb. Chi-square goodness-of-fit: χ²=Σ(O-E)²/E.
gen_002\tunison_genetics_core\tProbability\tMendel pea trait table: seed shape (round dominant), seed color (yellow dominant), pod shape (inflated dominant). F2 ratios deviate <2% from theoretical 3:1 across 10,000+ observations.`,
  },
  {
    id: "unison_cartography_core",
    label: "Cartography Core",
    vectors: 501,
    category: "Formal Sciences",
    description:
      "Oceanic navigation methods, celestial fix procedures, dead reckoning formulas, and surveying principles from Bowditch's American Practical Navigator.",
    sources: ["Bowditch American Practical Navigator"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
cart_001\tunison_cartography_core\tCelestialNav\tSextant altitude correction: dip correction = -0.97√(h_eye_meters) arcminutes. Refraction at 0° altitude: ~34 arcminutes. Sun lower limb SD (average): 16.1 arcminutes. Time-altitude method accuracy: ±0.5nm.
cart_002\tunison_cartography_core\tDeadReckoning\tDR position update: new_lat = old_lat + (speed × cos(course) × time)/60. new_lon = old_lon + (speed × sin(course) × time)/(60 × cos(lat)). Leeway correction: typically 3-8° downwind.`,
  },
  {
    id: "unison_materials_core",
    label: "Materials Core",
    vectors: 82,
    category: "Physical Sciences",
    description:
      "X-ray diffraction tables, atomic lattice parameters, crystal structure data, and d-spacing references from Bragg's X Rays and Crystal Structure.",
    sources: ["Bragg X Rays and Crystal Structure"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
mat_001\tunison_materials_core\tCrystalStructure\tCommon crystal systems: cubic (NaCl a=5.64Å, Fe a=2.87Å), hexagonal (Zn a=2.66Å c=4.95Å), FCC (Cu a=3.61Å), BCC (W a=3.16Å). Bragg's law: nλ=2d·sinθ.
mat_002\tunison_materials_core\tXRD\tX-ray diffraction peak positions for iron (Fe): (110) 2θ=44.67°, (200) 2θ=65.02°, (211) 2θ=82.33°. CuKα radiation λ=1.5406Å. d-spacing: d=a/√(h²+k²+l²).`,
  },
  {
    id: "unison_linguistics_core",
    label: "Linguistics Core",
    vectors: 486,
    category: "Formal Sciences",
    description:
      "Linguistic theory frameworks, phonetic shift principles, grammatical analysis tables, and language structure schemas from Sapir's Language.",
    sources: ["Sapir's Language: An Introduction to the Study of Speech"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
ling_001\tunison_linguistics_core\tPhonetics\tSapir vowel classification: high (i, u), mid (e, o), low (a). Consonant manner: stops (p,b,t,d,k,g), fricatives (f,v,s,z,sh,zh), nasals (m,n,ng), liquids (l,r). Grimm's Law: PIE *p,t,k → PGmc f,θ,x.
ling_002\tunison_linguistics_core\tMorphology\tAgglutinative vs inflectional: Turkish verb stem + tense + person = single word. English: mostly isolating. Polysynthetic: Inuit single word encodes full sentence. Morpheme types: free (cat), bound (-s, -ed).`,
  },
  {
    id: "unison_meteorology_core",
    label: "Meteorology Core",
    vectors: 129,
    category: "Physical Sciences",
    description:
      "Atmospheric pressure laws, weather pattern matrices, Beaufort scale data, and meteorological observation frameworks from Waldo's Elementary Meteorology.",
    sources: ["Waldo Elementary Meteorology"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
met_001\tunison_meteorology_core\tPressure\tStandard atmosphere: 1013.25 hPa at sea level, 0°C. Pressure lapse rate: ~1.2 hPa/10m below 1km. Beaufort scale 12 levels: 0(calm<1kt)→12(hurricane≥64kt). Buys-Ballot's Law: NH low pressure = wind from SW.
met_002\tunison_meteorology_core\tFronts\tCold front: temperature drop 5-10°C/hr, pressure rise after passage, wind shift W→NW, cumulonimbus development. Warm front: gradual pressure fall, stratus/nimbostratus, continuous precipitation 200-400km ahead.`,
  },
  {
    id: "unison_infrastructure_core",
    label: "Infrastructure Core",
    vectors: 2548,
    category: "Engineering",
    description:
      "Civil engineering load tables, power grid impedance matrices, structural tolerances, hydraulic flow data, and geotechnical bearing capacity parameters from historical industrial texts. Premium-tier x402 pricing.",
    sources: ["Gutenberg Industrial Engineering Reference", "ASCE Transactions"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
infra_001\tunison_infrastructure_core\tLoadLimits\tASCE bridge load ratings: H-10 (10-ton truck), H-15 (15-ton), H-20 (20-ton standard), HS-20 (20-ton + semi-trailer). Live load distribution factor: S/5.5 for concrete deck, S/6.0 for timber.
infra_002\tunison_infrastructure_core\tStructural\tReinforced concrete beam design: b×d minimum for M_u = 0.85f'c×A_s(d-a/2). Cover requirements: interior 0.75in, exterior 1.5in, corrosive environment 2in minimum ACI 318.`,
  },
  {
    id: "unison_tactical_history",
    label: "Tactical History",
    vectors: 1267,
    category: "Strategy & Philosophy",
    description:
      "Classical military strategy, historical defense theory, and geopolitical statecraft from Clausewitz's On War. Covers friction, fog of war, center of gravity, decisive points, and the relationship between war and political policy.",
    sources: ["Clausewitz On War (Gutenberg)"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
tac_001\tunison_tactical_history\tStrategy\tClausewitz: "War is not merely a political act, but also a real political instrument, a continuation of political commerce, a carrying out of the same by other means." Center of gravity: the hub of all power and movement on which everything depends.
tac_002\tunison_tactical_history\tFriction\tClausewitz on friction: "Everything in war is simple, but the simplest thing is difficult." Cumulative effect of small impediments degrades plans. Coup d'oeil: rapid intuitive assessment of tactical situation.`,
  },
  {
    id: "unison_philosophy_core",
    label: "Philosophy Core",
    vectors: 878,
    category: "Strategy & Philosophy",
    description:
      "Epistemological frameworks, classical dialectics, and foundational philosophy from Plato's Republic. Covers justice, the allegory of the cave, philosopher-kings, the tripartite soul, and the theory of forms.",
    sources: ["Plato The Republic (Gutenberg)"],
    color: "purple",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
phil_001\tunison_philosophy_core\tEpistemology\tPlato Republic Book VII: Allegory of the cave — prisoners mistake shadows for reality. Philosophical education = turning the soul from shadows toward the sun (the Form of the Good). Knowledge vs. opinion: knowledge is of being, opinion of becoming.
phil_002\tunison_philosophy_core\tEthics\tPlato: The tripartite soul — reason (logos), spirit (thumos), appetite (epithumia). Justice in the soul: each part performing its proper function. Philosopher-kings rule through wisdom, not desire.`,
  },
  {
    id: "unison_psychology_core",
    label: "Psychology Core",
    vectors: 1211,
    category: "Life Sciences",
    description:
      "Foundational behavioral science and cognitive architecture from William James's Principles of Psychology. Covers consciousness, habit formation, attention, memory, emotion, and the stream of thought.",
    sources: ["William James Principles of Psychology Vol. 1 (Gutenberg)"],
    color: "emerald",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
psy_001\tunison_psychology_core\tConsciousness\tJames: "The stream of thought. It is nothing jointed; it flows. A 'river' or a 'stream' are the metaphors by which it is most naturally described." Personal consciousness = continuous, constantly changing, sensibly continuous.
psy_002\tunison_psychology_core\tHabit\tJames on habit: "The great thing in all education is to make our nervous system our ally instead of our enemy." Habit formation: repetition → neural pathway consolidation → automatic execution below conscious threshold.`,
  },
  {
    id: "unison_canonical_history",
    label: "Canonical History",
    vectors: 3131,
    category: "Strategy & Philosophy",
    description:
      "Ancient textual codices, interlinear translation structures, and historical linguistic records from the KJV Bible. Prevents cross-translation interpolation drift in automated historical and paleographic analysis.",
    sources: ["KJV Bible (Gutenberg pg10)"],
    color: "amber",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
can_001\tunison_canonical_history\tGenesis\tGenesis 1:1-3: "In the beginning God created the heaven and the earth. And the earth was without form, and void; and darkness was upon the face of the deep." Hebrew: בְּרֵאשִׁ֖ית — bereshit, 'in the beginning / at the head of.'
can_002\tunison_canonical_history\tProverbs\tProverbs 22:7: "The rich ruleth over the poor, and the borrower is servant to the lender." Masoretic Text cross-reference: LXX Proverbs 22:7 parallel structure preserved. Economic governance principle.`,
  },
  {
    id: "unison_spatial_geometry",
    label: "Spatial Geometry",
    vectors: 10,
    category: "Engineering",
    description:
      "Vector topologies, mesh coordinate parameters, parametric 3D modeling primitives, and computational geometry algorithms. Covers UV spheres, Bezier patches, BVH trees, CSG operations, SDF volumes, and LOD chains. Premium-tier x402 pricing.",
    sources: ["Wavefront OBJ Primitive Specification", "Computational Geometry Reference"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
geo_001\tunison_spatial_geometry\tMeshPrimitive\tUnit cube OBJ: 8 vertices at (0,0,0)→(1,1,1); 6 quad faces; CCW winding right-handed coordinate system; identity transform matrix [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]; all face normals outward; flat shading.
geo_002\tunison_spatial_geometry\tSubdivision\tCatmull-Clark subdivision: 3 levels from 64-quad base mesh → 4096 quads; crease sharpness on border edges; C2 continuity on smooth regions; half-edge data structure O(1) neighbor traversal.`,
  },
  {
    id: "unison_additive_manufacturing",
    label: "Additive Manufacturing",
    vectors: 8,
    category: "Engineering",
    description:
      "G-code structural syntax tokens, slicing optimization parameters, polymer thermal boundary conditions, and layer deposition metrics. Covers FDM/SLA/SLS/DMLS/WAAM across PLA, PETG, ABS, PEEK, Ti6Al4V, and continuous carbon fiber. Premium-tier x402 pricing.",
    sources: ["Industrial Slicer Parameter Reference", "Polymer Processing Handbook"],
    color: "cyan",
    sampleTsv: `chunk_id\tcollection\tcategory\tcontent
add_001\tunison_additive_manufacturing\tFDM\tPEEK ultra-performance profile: 400°C nozzle (ruby tip); 120°C enclosed chamber mandatory; 0.15mm layer; 20mm/s; 120°C chamber; gyroid infill; tensile 100MPa; flexural modulus 3.7GPa. Amorphous vs crystalline: anneal post-print for Tg 300°C+.
add_002\tunison_additive_manufacturing\tDMLS\tTi6Al4V DMLS: 200W fiber laser; argon atmosphere <10ppm O2; 0.03mm layer; stress relief anneal 800°C/2h post-build; tensile 1100MPa after HIP; HIP cycle: 920°C/1000bar Ar/2h eliminates 99.9% internal porosity.`,
  },
];

/**
 * Authoritative live vector total — updated 2026-06-02 Phase 1g/1h expansion.
 * 31 active collections (25 original + legal expansion + 6 new Phase 1g nodes).
 * Key deltas: legal_core +49,630 (CourtListener SCOTUS), infrastructure +2,536,
 * tactical +1,267, canonical +3,131, psychology +1,211, philosophy +878,
 * mathematics +100, linguistics +388, cartography +410, meteorology +80,
 * genetics +100, spatial_geometry +10, additive_manufacturing +8.
 */
export const TOTAL_VECTORS = 83_758;
export const TOTAL_COLLECTIONS = COLLECTIONS.length;
