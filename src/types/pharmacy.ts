export type SeverityLevel = 'Contraindicated' | 'Major' | 'Moderate' | 'Minor' | 'None' | 'Unknown';

export interface CypProfile {
  substrates: string[];
  inhibitors: string[];
  inducers: string[];
}

export interface DrugTarget {
  name: string;
  type: 'Enzyme' | 'Receptor' | 'Transporter' | 'Ion Channel' | 'Target Protein';
  action: 'Inhibitor' | 'Agonist' | 'Antagonist' | 'Activator' | 'Substrate' | 'Binder';
  organism?: string;
  uniprotId?: string;
}

export interface DosageGuideline {
  indication: string;
  doseAdult: string;
  doseElderly?: string;
  renalAdjustment?: string;
  hepaticAdjustment?: string;
}

export interface DrugPharmacology {
  mechanismOfAction: string;
  targets: DrugTarget[];
  pharmacokinetics?: {
    absorption?: string;
    bioavailability?: string;
    proteinBinding?: string;
    distributionVolume?: string;
    metabolism?: string;
    cypEnzymes?: CypProfile;
    eliminationRoute?: string;
    halfLife?: string;
    clearance?: string;
  };
  indications?: string[];
  dosageGuidelines?: DosageGuideline[];
  contraindications?: string[];
  boxedWarning?: string;
  adverseEffects?: {
    common?: string[];
    serious?: string[];
  };
}

export interface DrugMonograph {
  id: string;
  ddinterId: string;
  name: string;
  brandNames: string[];
  atcCode: string;
  atcCategory: string;
  therapeuticClass: string;
  pubchemCid?: number;
  drugBankId?: string;
  molecularFormula: string;
  molecularWeight: number;
  smiles: string;
  description: string;
  pharmacology: DrugPharmacology;
  sourceOrigin: 'DDInter v2.0' | 'DDInter v2.0 (Internal Database)';
  lastUpdated: string;
  casNumber?: string;
  iupacName?: string;
  inchi?: string;
  drugType?: string;
  structureSvg?: string;
  usefulLinks?: Record<string, string>;
  officialUrl?: string;
  liveSynced?: boolean;
  ddinterCounts?: { ddi: number; dfi: number; ddsi: number };
  liveInteractions?: any[];
  liveDdsi?: any[];
  liveDfi?: any[];
  proteinSequence?: string;
}

export interface DiseaseDDSIItem {
  id: number;
  drugId: string;
  drugName: string;
  level: string | number;
  severityLabel: 'Major' | 'Moderate' | 'Minor' | 'Unknown';
  text: string;
  references?: string;
}

export interface DiseaseClinicalMonograph {
  indonesianName: string;
  organSystem: string;
  urgencyLevel: 'Kronis Terkontrol' | 'Progresif / Perlu Pemantauan' | 'Potensi Akut / Emergensi' | string;
  overview: string;
  ddinterOfficialUrl: string;
  ddinterWarningSummary: string;
  ddinterSeverityDistribution: {
    major: number;
    moderate: number;
    minor: number;
    total: number;
  };
  ddinterOfficialReferences?: string[];
  clinicalReferences?: string[];
}

export interface DiseaseInfo {
  id: string;
  name: string;
  indonesianName?: string;
  organSystem?: string;
  urgencyLevel?: string;
  contraindicatedDrugsCount: number;
  sampleWarning?: string;
  ddsiRecords?: DiseaseDDSIItem[];
  sourceOrigin: 'DDInter v2.0 (ddinter2.scbdd.com)' | string;
  ddinterOfficialUrl?: string;
  clinicalMonograph?: DiseaseClinicalMonograph;
}

export interface DrugInteraction {
  id: string;
  drugA: { id: string; name: string; atcCode?: string; ddinterId?: string };
  drugB: { id: string; name: string; atcCode?: string; ddinterId?: string };
  ddinterId?: string;
  severity: SeverityLevel;
  level: 'Severe' | 'Moderate' | 'Minor' | string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  evidenceLevel: 'A' | 'B' | 'C' | 'D' | string;
  onset: 'Rapid' | 'Delayed' | 'Unspecified' | string;
  source?: string;
  mechanismTags?: string[];
  officialUrl?: string;
  references?: string[];
  alternatives?: Record<string, { name: string; ddinterId?: string; atc?: string }[]>;
  cypMetabolism?: Record<string, Record<string, number>>;
  officialInteractId?: string;
}

export interface FoodInteraction {
  id: string;
  drugId: string;
  drugName: string;
  foodItem: string;
  foodCategory: 'Buah/Jus' | 'Susu/Kalsium' | 'Alkohol' | 'Kafein' | 'Herbal' | 'Makanan Berlemak' | 'Kalium' | 'Tiramina' | 'Garam/Natrium' | string;
  severity: SeverityLevel;
  effect: string;
  mechanism: string;
  recommendation: string;
  references?: string[];
  source?: string;
}

export interface DiseaseContraindication {
  id: string;
  drugId: string;
  drugName: string;
  diseaseId: string;
  diseaseName: string;
  severity: 'Major' | 'Moderate';
  risk: string;
  mechanism: string;
  management: string;
  references?: string[];
  source?: string;
}

export interface TherapeuticDuplication {
  id: string;
  drugA: string;
  drugB: string;
  therapeuticClass: string;
  atcGroup: string;
  concern: string;
  recommendation: string;
  references?: string[];
  source?: string;
}

export interface RegimenAnalysisResult {
  analyzedDrugs: DrugMonograph[];
  analyzedDiseases: DiseaseInfo[];
  drugInteractions: DrugInteraction[];
  foodInteractions: FoodInteraction[];
  diseaseInteractions: DiseaseContraindication[];
  therapeuticDuplications: TherapeuticDuplication[];
  riskScore: number; // 0 to 100
  riskLevel: 'Aman' | 'Rendah' | 'Perhatian Sedang' | 'Risiko Tinggi / Kritis';
  summary: string;
  fromCache: boolean;
  latencyMs: number;
  executionTimeMs?: number;
  timestamp: string;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRatePercent: number;
  memoryUsageKb: number;
  averageLatencySavedMs: number;
  recentKeys: {
    key: string;
    hits: number;
    ttlRemainingSec: number;
    source: string;
    sizeBytes: number;
  }[];
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  fromCache: boolean;
  executionTimeMs: number;
}

export interface DDInterOfficialStats {
  totalApprovedDrugs: number;
  totalDistinctDrugs: number;
  totalDDIRecords: number;
  distinctDdiMechanisms: number;
  totalDFIRecords: number;
  dfiFoodsCount: number;
  dfiMechanismsCount: number;
  totalDDSIRecords: number;
  totalUniqueDiseases: number;
  ddsiDetailedInfoCount: number;
  totalDuplicationRecords: number;
  duplicationCombinationDrugs: number;
  duplicationPharmClasses: number;
  totalLiteraturePieces: number;
  literatureDdi: number;
  literatureDfi: number;
  literatureDdsi: number;
  databaseSizeBytes?: number;
  portalUrl?: string;
  citation?: string;
  generatedAt?: string;
}

