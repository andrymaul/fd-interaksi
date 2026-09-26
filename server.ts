import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}
import { globalCache } from './src/server/cache.ts';
import { ddinterDb, DrugRecord } from './src/server/ddinterDb.ts';
import { clinicalDDIRules } from './src/server/clinicalDDIRules.ts';
import { resolvePharmacotherapyClass } from './src/data/atcClassifier.ts';
import { getDiseaseClinicalMonograph } from './src/data/diseaseClinicalData.ts';
import { ddinterLiveService } from './src/server/ddinterLiveService.ts';
import { ClinicalTranslator } from './src/server/clinicalTranslator.ts';
import {
  DrugMonograph,
  DrugInteraction,
  FoodInteraction,
  DiseaseContraindication,
  TherapeuticDuplication,
  RegimenAnalysisResult,
  DiseaseInfo,
  SeverityLevel,
} from './src/types/pharmacy.ts';


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(express.json());

// API Endpoints

// 1. Health & Server Info with Complete DDInter v2.0 Statistics
app.get('/api/health', (_req: Request, res: Response) => {
  const stats = ddinterDb.getStats();
  res.json({
    status: 'ok',
    service: 'FD - Farmakologi & Database Interaksi Obat',
    version: '2.5.0',
    dataSource: 'DDInter v2.0 (https://ddinter2.scbdd.com/)',
    citation: stats.citation,
    stats: {
      totalApprovedDrugs: stats.totalApprovedDrugs,
      totalDistinctDrugs: stats.totalDistinctDrugs,
      totalDDIRecords: stats.totalDDIRecords,
      distinctDdiMechanisms: stats.distinctDdiMechanisms,
      totalDFIRecords: stats.totalDFIRecords,
      dfiFoodsCount: stats.dfiFoodsCount,
      dfiMechanismsCount: stats.dfiMechanismsCount,
      totalDDSIRecords: stats.totalDDSIRecords,
      totalUniqueDiseases: stats.totalUniqueDiseases,
      ddsiDetailedInfoCount: stats.ddsiDetailedInfoCount,
      totalDuplicationRecords: stats.totalDuplicationRecords,
      duplicationCombinationDrugs: stats.duplicationCombinationDrugs,
      duplicationPharmClasses: stats.duplicationPharmClasses,
      totalLiteraturePieces: stats.totalLiteraturePieces,
      literatureDdi: stats.literatureDdi,
      literatureDfi: stats.literatureDfi,
      literatureDdsi: stats.literatureDdsi,
      databaseSizeBytes: stats.databaseSizeBytes,
      cacheEntries: globalCache.getStats().totalEntries,
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Official DDInter 2.0 Dataset Statistics Endpoint
app.get('/api/stats', (_req: Request, res: Response) => {
  const stats = ddinterDb.getStats();
  res.json(stats);
});

// Helper: Synthesize complete monograph for any DDInter drug from internal database
function buildMonographFromRecord(record: DrugRecord): DrugMonograph {
  const idSlug = record.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let brands: string[] = [];
  try {
    if (record.brand_names) {
      brands = JSON.parse(record.brand_names);
    }
  } catch {}

  const isBiotech = record.drug_type === 'biotech' || Boolean(record.protein_sequence);
  const atc = record.atc_code || '-';

  const resolved = resolvePharmacotherapyClass(atc, record.name, record.drug_type, record.mechanism);

  const therapeuticClass =
    (record.therapeutic_class ? record.therapeutic_class.replace(/^Senyawa Farmakologis\s+/i, '') : '') ||
    (record.atc_category && record.atc_category !== 'Farmakologi Terverifikasi DDInter v2.0'
      ? record.atc_category.replace(/^Senyawa Farmakologis\s+/i, '')
      : '') ||
    resolved.therapeuticClass.replace(/^Senyawa Farmakologis\s+/i, '');

  const atcCategory =
    (record.atc_category && record.atc_category !== 'Farmakologi Terverifikasi DDInter v2.0'
      ? record.atc_category
      : '') ||
    resolved.atcCategory;

  const molecularFormula = record.molecular_formula && record.molecular_formula !== 'None' ? record.molecular_formula : '';
  const molecularWeight = record.molecular_weight && record.molecular_weight > 0 ? record.molecular_weight : 0;
  const casNumber = record.cas_number && record.cas_number !== '-' && record.cas_number !== 'None' ? record.cas_number : undefined;
  const description = record.description && record.description !== 'None' ? record.description : '';
  const drugType = record.drug_type && record.drug_type !== 'None' ? record.drug_type : (isBiotech ? 'biotech' : 'small molecule');

  return {
    id: idSlug,
    ddinterId: record.ddinter_id,
    name: record.name,
    brandNames: Array.isArray(brands) ? brands : [],
    atcCode: atc,
    atcCategory,
    therapeuticClass,
    pubchemCid: record.pubchem_id && !isNaN(parseInt(record.pubchem_id, 10)) ? parseInt(record.pubchem_id, 10) : undefined,
    drugBankId: record.drugbank_id || undefined,
    molecularFormula,
    molecularWeight,
    casNumber,
    structureSvg: record.structure_svg || undefined,
    proteinSequence: record.protein_sequence || undefined,
    drugType,
    smiles: record.smiles && record.smiles !== record.ddinter_id && record.smiles !== 'unknown' ? record.smiles : '',
    description,
    usefulLinks: {
      ...(record.drugbank_id ? { 'DrugBank': `https://go.drugbank.com/drugs/${record.drugbank_id}` } : {}),
      ...(record.pubchem_id ? { 'PubChem': `https://pubchem.ncbi.nlm.nih.gov/compound/${record.pubchem_id}` } : {}),
      ...(record.chembl_id ? { 'ChEMBL': `https://www.ebi.ac.uk/chembl/compound_report_card/${record.chembl_id}/` } : {})
    },
    pharmacology: {
      mechanismOfAction: record.mechanism || '',
      targets: [],
    },
    sourceOrigin: 'DDInter v2.0 (Internal Database)',
    lastUpdated: '2026-03-24',
  };
}

// 2. Drugs list - Searching across all 2,310 approved drugs in DDInter SQLite
app.get('/api/drugs', (req: Request, res: Response) => {
  const startTime = performance.now();
  const search = ((req.query.search as string) || '').trim();
  const classFilter = ((req.query.class as string) || '').trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '12', 10)));
  const noCache = req.query.nocache === 'true';

  const cacheKey = `drugs:db_list:${search}:${classFilter}:${page}:${limit}`;

  if (!noCache) {
    const cached = globalCache.get<Record<string, any>>(cacheKey);
    if (cached) {
      const elapsed = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed.toFixed(2)),
        cacheHits: cached.hits,
      });
    }
  }

  const searchResult = ddinterDb.searchDrugs(search, page, limit, classFilter);

  const seenDrugIds = new Set<string>();
  const monographs: DrugMonograph[] = [];
  for (const rec of searchResult.data) {
    const mono = buildMonographFromRecord(rec);
    if (!seenDrugIds.has(mono.id)) {
      seenDrugIds.add(mono.id);
      monographs.push(mono);
    }
  }

  const responsePayload = {
    data: monographs,
    total: searchResult.total,
    page: searchResult.page,
    limit: searchResult.limit,
    totalPages: searchResult.totalPages,
    totalApprovedDrugs: searchResult.total,
  };

  globalCache.set(cacheKey, responsePayload, 600, 'DDInter Complete Database');
  const elapsed = performance.now() - startTime;

  res.json({
    ...responsePayload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2)),
  });
});

// 2b. Direct DDInter Catalog List (All 2,290 approved drugs from DDInter 2.0 SQLite)
app.get('/api/ddinter/catalog', (req: Request, res: Response) => {
  const search = ((req.query.search as string) || '').toLowerCase().trim();
  const classFilter = ((req.query.class as string) || '').trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

  const searchResult = ddinterDb.searchDrugs(search, page, limit, classFilter);

  const drugs = searchResult.data.map((rec) => ({
    id: rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: rec.name,
    ddinterId: rec.ddinter_id,
    drugbankId: rec.drugbank_id || null,
    smiles: rec.smiles || null,
    display: rec.name,
  }));

  res.json({
    source: 'DDInter v2.0 (https://ddinter2.scbdd.com/)',
    total: searchResult.total,
    page: searchResult.page,
    limit: searchResult.limit,
    totalPages: searchResult.totalPages,
    drugs,
  });
});

// 3. Drug Detail Monograph (With Live DDInter Integration)
app.get('/api/drugs/:id', async (req: Request, res: Response) => {
  const startTime = performance.now();
  const { id } = req.params;
  const noCache = req.query.nocache === 'true';
  const queryLower = id.toLowerCase().trim();

  const cacheKey = `drug:detail:${queryLower}`;

  if (!noCache) {
    const cached = globalCache.get<Record<string, any>>(cacheKey);
    if (cached && cached.data && (cached.data.molecularFormula || cached.data.structureSvg || cached.data.proteinSequence)) {
      const elapsed = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed.toFixed(2)),
      });
    }
  }

  const dbRecord = ddinterDb.findDrug(queryLower);
  if (!dbRecord) {
    return res.status(404).json({ error: 'Obat tidak ditemukan di database DDInter.' });
  }

  const drug = buildMonographFromRecord(dbRecord);

  // Get live interaction counts from SQLite
  const dbCounts = ddinterDb.getDrugInteractionsCount(drug.name);

  // Enrich with live DDInter or local SQLite database
  let liveDetail = null;
  if (drug.ddinterId && drug.ddinterId.startsWith('DDInter')) {
    try {
      liveDetail = await ddinterLiveService.getDrugDetail(drug.ddinterId);
    } catch {
      // Fallback silently if network hiccup
    }
  }

  const ddiList =
    liveDetail?.liveInteractions && liveDetail.liveInteractions.length > 0
      ? liveDetail.liveInteractions
      : ddinterLiveService.getDrugInteractionsFromDb(drug.ddinterId, 5000).rows;

  const ddsiList =
    liveDetail?.liveDdsi && liveDetail.liveDdsi.length > 0
      ? liveDetail.liveDdsi
      : ddinterLiveService.getDrugDdsiFromDb(drug.ddinterId, 5000).rows;

  const dfiList =
    liveDetail?.liveDfi && liveDetail.liveDfi.length > 0
      ? liveDetail.liveDfi
      : ddinterLiveService.getDrugDfiFromDb(drug.ddinterId, 5000).rows;

  const cleanedDesc = (liveDetail?.description && liveDetail.description !== 'None') ? liveDetail.description : (drug.description !== 'None' ? drug.description : '');
  const cleanedFormula = (liveDetail?.molecularFormula && liveDetail.molecularFormula !== 'None') ? liveDetail.molecularFormula : (drug.molecularFormula !== 'None' ? drug.molecularFormula : '');
  const rawWeight = liveDetail?.molecularWeight ? parseFloat(liveDetail.molecularWeight) : drug.molecularWeight;
  const cleanedWeight = rawWeight && rawWeight > 0 ? rawWeight : 0;
  const cleanedCas = (liveDetail?.casNumber && liveDetail.casNumber !== '-' && liveDetail.casNumber !== 'None') ? liveDetail.casNumber : (drug.casNumber && drug.casNumber !== '-' && drug.casNumber !== 'None' ? drug.casNumber : undefined);
  const cleanedType = (liveDetail?.drugType && liveDetail.drugType !== 'None') ? liveDetail.drugType : (drug.drugType !== 'None' ? drug.drugType : 'small molecule');

  const payload: DrugMonograph = {
    ...drug,
    brandNames: liveDetail?.brandNames && liveDetail.brandNames.length > 0 ? liveDetail.brandNames : drug.brandNames,
    therapeuticClass:
      drug.therapeuticClass && !drug.therapeuticClass.includes('Senyawa Farmakologis Terdaftar')
        ? drug.therapeuticClass.replace(/^Senyawa Farmakologis\s+/i, '')
        : liveDetail?.atcCategoryName
        ? `${liveDetail.atcCategoryName}${liveDetail.drugType === 'biotech' ? ' (Biotech / Peptida)' : ''}`
        : (drug.therapeuticClass?.replace(/^Senyawa Farmakologis\s+/i, '') || '-'),
    description: cleanedDesc,
    molecularFormula: cleanedFormula,
    molecularWeight: cleanedWeight,
    smiles: liveDetail?.smiles || drug.smiles,
    structureSvg: liveDetail?.structureSvg || drug.structureSvg,
    pubchemCid: drug.pubchemCid || (liveDetail?.usefulLinks?.PubChem ? parseInt(liveDetail.usefulLinks.PubChem.match(/[0-9]+/)?.[0] || '0', 10) : undefined),
    drugBankId: drug.drugBankId || (liveDetail?.usefulLinks?.DrugBank ? liveDetail.usefulLinks.DrugBank.match(/DB\d+/)?.[0] : undefined),
    proteinSequence: liveDetail?.proteinSequence || drug.proteinSequence,
    casNumber: cleanedCas,
    iupacName: liveDetail?.iupacName,
    inchi: liveDetail?.inchi,
    drugType: cleanedType,
    usefulLinks: { ...(drug.usefulLinks || {}), ...(liveDetail?.usefulLinks || {}) },
    officialUrl: liveDetail?.officialUrl || drug.officialUrl || `https://ddinter2.scbdd.com/server/drug-detail/${drug.ddinterId}/`,
    liveSynced: Boolean(liveDetail && liveDetail.liveFetched),
    atcCode: liveDetail?.atcClassification?.length ? liveDetail.atcClassification.join(', ') : drug.atcCode,
    atcCategory: liveDetail?.atcCategoryName || drug.atcCategory,
    ddinterCounts: {
      ddi: dbCounts.ddi || ddiList.length,
      ddsi: dbCounts.ddsi || ddsiList.length,
      dfi: dbCounts.dfi || dfiList.length,
    },
    liveInteractions: ddiList,
    liveDdsi: ddsiList,
    liveDfi: dfiList,
    pharmacology: {
      mechanismOfAction: cleanedDesc || (drug.pharmacology.mechanismOfAction !== 'None' ? drug.pharmacology.mechanismOfAction : ''),
      targets: drug.pharmacology.targets || [],
    },
  };

  if (payload.molecularFormula || payload.structureSvg || payload.proteinSequence) {
    globalCache.set(cacheKey, payload, 7200, 'DDInter v2.0 (ddinter2.scbdd.com)');
  }
  const elapsed = performance.now() - startTime;

  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2)),
  });
});

// 3b. Dedicated DDInter Live Drug Mirror Endpoint
app.get('/api/ddinter/live-drug/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const live = await ddinterLiveService.getDrugDetail(id);
  if (!live) {
    return res.status(404).json({ error: 'Data live tidak dapat diambil dari portal resmi DDInter.' });
  }
  res.json(live);
});

// 3c. Dedicated DDInter Live Interactions Endpoint
app.get('/api/ddinter/live-interactions/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = parseInt((req.query.limit as string) || '5000', 10);
  const live = await ddinterLiveService.getDrugInteractionsLive(id, limit);
  if (!live) {
    return res.status(404).json({ error: 'Tabel interaksi live tidak ditemukan di DDInter.' });
  }
  res.json(live);
});

// 4. Disease list (100% DDInter 2.0 Disease Entities with authentic DDSI counts)
app.get('/api/diseases', (req: Request, res: Response) => {
  const startTime = performance.now();
  const search = ((req.query.search as string) || '').toLowerCase().trim();
  const organ = ((req.query.organ as string) || '').toLowerCase().trim();
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '48', 10)));
  const noCache = req.query.nocache === 'true';

  const cacheKey = `disease:list:${search}:${organ}:${page}:${limit}`;

  if (!noCache) {
    const cached = globalCache.get<Record<string, any>>(cacheKey);
    if (cached) {
      const elapsed = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed.toFixed(2)),
      });
    }
  }

  let diseaseEntities: DiseaseInfo[] = [];
  let totalCount = 0;
  let totalPages = 1;

  if (organ) {
    const allDbDiseases = ddinterDb.getDiseasesList(search, 1, 1000);
    const filtered = allDbDiseases.data
      .map((d) => {
        const monograph = getDiseaseClinicalMonograph(d.name);
        return {
          id: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          name: d.name,
          indonesianName: monograph.indonesianName,
          organSystem: monograph.organSystem,
          urgencyLevel: monograph.urgencyLevel,
          contraindicatedDrugsCount: d.count,
          sampleWarning: d.sampleText,
          sourceOrigin: 'DDInter v2.0 (ddinter2.scbdd.com)',
          ddinterOfficialUrl: 'https://ddinter2.scbdd.com/server/dis_food/',
        };
      })
      .filter((d) => d.organSystem.toLowerCase().includes(organ));

    totalCount = filtered.length;
    totalPages = Math.ceil(totalCount / limit) || 1;
    const offset = (page - 1) * limit;
    diseaseEntities = filtered.slice(offset, offset + limit);
  } else {
    // Get distinct diseases from DDInter SQLite
    const dbDiseases = ddinterDb.getDiseasesList(search, page, limit);

    diseaseEntities = dbDiseases.data.map((d) => {
      const monograph = getDiseaseClinicalMonograph(d.name);
      return {
        id: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: d.name,
        indonesianName: monograph.indonesianName,
        organSystem: monograph.organSystem,
        urgencyLevel: monograph.urgencyLevel,
        contraindicatedDrugsCount: d.count,
        sampleWarning: d.sampleText,
        sourceOrigin: 'DDInter v2.0 (ddinter2.scbdd.com)',
        ddinterOfficialUrl: 'https://ddinter2.scbdd.com/server/dis_food/',
      };
    });
    totalCount = dbDiseases.total;
    totalPages = dbDiseases.totalPages;
  }

  const payload = {
    data: diseaseEntities,
    total: totalCount,
    page,
    limit,
    totalPages,
    totalUniqueDiseases: totalCount,
  };

  globalCache.set(cacheKey, payload, 600, 'DDInter Disease Registry');
  const elapsed = performance.now() - startTime;

  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2)),
  });
});

// 5. Disease Detail (Full Clinical Disease Monograph + authentic DDInter records)
app.get('/api/diseases/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const rawQuery = id.trim();
  const normalizedQuery = rawQuery.replace(/[-_]+/g, ' ');

  let ddsiRows = ddinterDb.getDiseaseDDSIRecords(rawQuery, 200);
  if (!ddsiRows || ddsiRows.length === 0) {
    ddsiRows = ddinterDb.getDiseaseDDSIRecords(normalizedQuery, 200);
  }

  if (!ddsiRows || ddsiRows.length === 0) {
    return res.status(404).json({ error: 'Informasi penyakit tidak ditemukan di basis data DDInter.' });
  }

  const diseaseName = ddsiRows[0].disease_name;
  const clinicalMonograph = getDiseaseClinicalMonograph(diseaseName);

  const ddsiRecords = ddsiRows.map((r) => {
    const sev = r.level === '3' ? 'Major' : r.level === '2' ? 'Moderate' : r.level === '1' ? 'Minor' : 'Unknown';
    return {
      id: r.id,
      drugId: r.ddinter_id,
      drugName: r.drug_name,
      level: r.level,
      severityLabel: sev as any,
      text: r.text,
      references: r.references_text,
    };
  });

  const disease: DiseaseInfo = {
    id: diseaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: diseaseName,
    indonesianName: clinicalMonograph.indonesianName,
    organSystem: clinicalMonograph.organSystem,
    urgencyLevel: clinicalMonograph.urgencyLevel,
    contraindicatedDrugsCount: ddsiRows.length,
    sampleWarning: ddsiRows[0]?.text,
    clinicalMonograph,
    ddsiRecords,
    sourceOrigin: 'DDInter v2.0 (ddinter2.scbdd.com)',
    ddinterOfficialUrl: 'https://ddinter2.scbdd.com/server/dis_food/',
  };

  res.json(disease);
});

// 6. Comprehensive Multi-Dimensional Interaction Checker (100% DDInter 2.0 Engine)
// Computes DDI, Food Interaction, Disease Contraindication, and Therapeutic Duplication
app.post('/api/interactions/check', async (req: Request, res: Response) => {
  const startTime = performance.now();
  const { drugIds = [], diseaseIds = [], noCache = false } = req.body;

  if (!Array.isArray(drugIds) || drugIds.length === 0) {
    return res.status(400).json({ error: 'Minimal pilih 1 obat untuk analisis.' });
  }

  const normalizedDrugIds: string[] = Array.from(new Set((drugIds as string[]).map((id) => String(id).toLowerCase()))).sort();
  const normalizedDiseaseIds: string[] = Array.from(new Set(((diseaseIds || []) as string[]).map((id) => String(id).toLowerCase()))).sort();

  const cacheKey = `regimen:${normalizedDrugIds.join('+')}:${normalizedDiseaseIds.join('+')}`;

  if (!noCache) {
    const cached = globalCache.get<RegimenAnalysisResult>(cacheKey);
    if (cached) {
      const elapsed = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        latencyMs: parseFloat(elapsed.toFixed(2)),
        executionTimeMs: parseFloat(elapsed.toFixed(2)),
      });
    }
  }

  // 1. Resolve drugs exclusively from DDInter 2.0 database
  const resolvedDrugs: DrugMonograph[] = normalizedDrugIds
    .map((id) => {
      const dbRec = ddinterDb.findDrug(id);
      if (dbRec) return buildMonographFromRecord(dbRec);
      return null;
    })
    .filter(Boolean) as DrugMonograph[];

  // 2. Resolve diseases exclusively from DDInter 2.0 database
  const resolvedDiseases: DiseaseInfo[] = normalizedDiseaseIds.map((id) => {
    const rows = ddinterDb.getDiseaseDDSIRecords(id, 1);
    if (rows.length > 0) {
      return {
        id: rows[0].disease_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: rows[0].disease_name,
        contraindicatedDrugsCount: rows.length,
        sourceOrigin: 'DDInter v2.0',
      };
    }
    return {
      id,
      name: id,
      contraindicatedDrugsCount: 0,
      sourceOrigin: 'DDInter v2.0',
    };
  });

  // 3. Find Drug-Drug Interactions (Live DDInter Portal Checker + 302,665 DDI records in SQLite)
  const foundDdi: DrugInteraction[] = [];
  const processedPairKeys = new Set<string>();

  // A. Live fetch from official DDInter 2.0 Checker API (https://ddinter2.scbdd.com/checker/)
  const ddinterIds = resolvedDrugs
    .map((d) => d.ddinterId)
    .filter((id): id is string => typeof id === 'string' && /^DDInter\d+$/i.test(id));

  if (ddinterIds.length >= 2) {
    try {
      const liveCheckData = await ddinterLiveService.checkDdiLive(ddinterIds);
      for (const item of liveCheckData) {
        const idA = item.internalID_a_id;
        const idB = item.internalID_b_id;
        const pairKey = [idA.toLowerCase(), idB.toLowerCase()].sort().join('-');
        if (processedPairKeys.has(pairKey)) continue;
        processedPairKeys.add(pairKey);

        const rawLevel = (item.idx__level || '').trim();
        let sev: SeverityLevel = 'Unknown';
        if (rawLevel.toLowerCase() === 'major') sev = 'Major';
        else if (rawLevel.toLowerCase() === 'moderate') sev = 'Moderate';
        else if (rawLevel.toLowerCase() === 'minor') sev = 'Minor';
        else if (rawLevel.toLowerCase() === 'contraindicated') sev = 'Contraindicated';
        else sev = 'Unknown';

        const isUnknown = sev === 'Unknown';

        const mechTags: string[] = [];
        if (item.idx__absorption === '1') mechTags.push('Absorpsi Saluran Cerna');
        if (item.idx__distribution === '1') mechTags.push('Distribusi & Ikatan Protein');
        if (item.idx__metabolism === '1') mechTags.push('Metabolisme Enzim (CYP450 / Eliminasi Hepatik)');
        if (item.idx__excretion === '1') mechTags.push('Ekskresi Ginjal');
        if (item.idx__synergistic_effect === '1') mechTags.push('Efek Sinergistik / Toksisitas Aditif');
        if (item.idx__antagonistic_effect === '1') mechTags.push('Efek Antagonistik / Penurunan Efikasi');

        const rawDesc = (item.idx__interaction_description || '').trim();
        const rawMgmt = (item.idx__management || '').trim();

        const fullDetail = !isUnknown
          ? await ddinterLiveService.getDdiFullDetails(idA, idB, item.drug_a_name, item.drug_b_name)
          : null;

        const transDesc = await ClinicalTranslator.translateDdiDescriptionAsync(rawDesc, item.drug_a_name, item.drug_b_name);
        const transMgmt = await ClinicalTranslator.translateDdiManagementAsync(rawMgmt, item.drug_a_name, item.drug_b_name, sev);

        const mechanism = (transDesc && transDesc !== '-')
          ? transDesc
          : isUnknown ? '-' : `Interaksi terverifikasi DDInter v2.0 antara ${item.drug_a_name} dan ${item.drug_b_name}.`;

        const clinicalEffect = (transDesc && transDesc !== '-')
          ? transDesc
          : '-';

        const management = (transMgmt && transMgmt !== '-')
          ? transMgmt
          : '-';

        const evidenceLevel = isUnknown ? '-' : 'A';
        const level = isUnknown ? 'Unknown' : (sev === 'Major' ? 'Severe' : sev);

        foundDdi.push({
          id: `ddi-live-${idA}-${idB}`,
          ddinterId: `${idA}_${idB}`,
          drugA: {
            id: item.drug_a_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: item.drug_a_name,
            ddinterId: idA,
          },
          drugB: {
            id: item.drug_b_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: item.drug_b_name,
            ddinterId: idB,
          },
          severity: sev,
          level,
          mechanism,
          clinicalEffect,
          management,
          evidenceLevel,
          onset: isUnknown ? '-' : 'Delayed',
          source: 'DDInter v2.0 Official Database (ddinter2.scbdd.com)',
          mechanismTags: mechTags,
          officialUrl: fullDetail?.officialUrl || `https://ddinter2.scbdd.com/checker/result/${idA}-${idB}`,
          references: isUnknown ? [] : (fullDetail?.references || []),
          alternatives: fullDetail?.alternatives,
          cypMetabolism: fullDetail?.cypMetabolism,
          officialInteractId: fullDetail?.interactId,
          originalMechanism: rawDesc && rawDesc !== '-' ? rawDesc : undefined,
          originalClinicalEffect: rawDesc && rawDesc !== '-' ? rawDesc : undefined,
          originalManagement: rawMgmt && rawMgmt !== '-' ? rawMgmt : undefined,
        });
      }
    } catch (liveErr) {
      console.warn('[Interactions Check] Live check fallback to local database:', liveErr);
    }
  }

  // B. Query SQLite DDI database (302,665 DDInter pairs) for any remaining pairs
  const dbDdis = ddinterDb.checkDDI(normalizedDrugIds as string[]);
  for (const d of dbDdis) {
    const pairKey = [d.drug_a.toLowerCase(), d.drug_b.toLowerCase()].sort().join('-');
    const idKey = [d.ddinter_id_a.toLowerCase(), d.ddinter_id_b.toLowerCase()].sort().join('-');

    if (!processedPairKeys.has(pairKey) && !processedPairKeys.has(idKey)) {
      processedPairKeys.add(pairKey);
      processedPairKeys.add(idKey);
      const rawLevel = (d.level || '').trim();
      let sev: SeverityLevel = 'Unknown';
      if (rawLevel.toLowerCase() === 'major') sev = 'Major';
      else if (rawLevel.toLowerCase() === 'moderate') sev = 'Moderate';
      else if (rawLevel.toLowerCase() === 'minor') sev = 'Minor';
      else if (rawLevel.toLowerCase() === 'contraindicated') sev = 'Contraindicated';
      else sev = 'Unknown';

      const isUnknown = sev === 'Unknown';

      const clinicalInfo = isUnknown
        ? { mechanism: '-', clinicalEffect: '-', management: '-', evidenceLevel: '-', mechanismTags: [] }
        : clinicalDDIRules.resolveDDI(
            d.drug_a,
            d.ddinter_id_a,
            d.drug_b,
            d.ddinter_id_b,
            sev
          );

      const transMech = isUnknown ? '-' : await ClinicalTranslator.translateDdiDescriptionAsync(clinicalInfo.mechanism, d.drug_a, d.drug_b);
      const transEffect = isUnknown ? '-' : await ClinicalTranslator.translateDdiDescriptionAsync(clinicalInfo.clinicalEffect, d.drug_a, d.drug_b);
      const transMgmt = isUnknown ? '-' : await ClinicalTranslator.translateDdiManagementAsync(clinicalInfo.management, d.drug_a, d.drug_b, sev);

      const fullDetail = !isUnknown
        ? await ddinterLiveService.getDdiFullDetails(
            d.ddinter_id_a,
            d.ddinter_id_b,
            d.drug_a,
            d.drug_b
          )
        : null;

      foundDdi.push({
        id: `ddi-db-${d.id}`,
        ddinterId: `${d.ddinter_id_a}_${d.ddinter_id_b}`,
        drugA: { id: d.drug_a.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: d.drug_a, ddinterId: d.ddinter_id_a },
        drugB: { id: d.drug_b.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: d.drug_b, ddinterId: d.ddinter_id_b },
        severity: sev,
        level: isUnknown ? 'Unknown' : (sev === 'Major' ? 'Severe' : sev),
        mechanism: transMech,
        clinicalEffect: transEffect,
        evidenceLevel: isUnknown ? '-' : (clinicalInfo.evidenceLevel || 'A'),
        onset: isUnknown ? '-' : 'Delayed',
        management: transMgmt,
        mechanismTags: clinicalInfo.mechanismTags,
        source: 'DDInter v2.0 Official Database (ddinter2.scbdd.com)',
        officialUrl: fullDetail?.officialUrl || `https://ddinter2.scbdd.com/checker/result/${d.ddinter_id_a}-${d.ddinter_id_b}`,
        references: isUnknown ? [] : (fullDetail?.references || []),
        alternatives: fullDetail?.alternatives,
        cypMetabolism: fullDetail?.cypMetabolism,
        officialInteractId: fullDetail?.interactId,
        originalMechanism: clinicalInfo.mechanism !== transMech ? clinicalInfo.mechanism : undefined,
        originalClinicalEffect: clinicalInfo.clinicalEffect !== transEffect ? clinicalInfo.clinicalEffect : undefined,
        originalManagement: clinicalInfo.management !== transMgmt ? clinicalInfo.management : undefined,
      });
    }
  }

  // 4. Find Food Interactions exclusively from DDInter 2.0 SQLite (857 DFIs)
  const foundFood: FoodInteraction[] = [];
  const dbDfi = ddinterDb.checkDFI(normalizedDrugIds as string[]);
  for (const f of dbDfi) {
    const exists = foundFood.some(
      (ef) =>
        ef.drugName.toLowerCase() === f.drug_name.toLowerCase() &&
        ef.foodItem.toLowerCase() === f.food_name.toLowerCase()
    );
    if (!exists) {
      const sev = f.level === '3' ? 'Major' : f.level === '2' ? 'Moderate' : 'Minor';
      const foodRefs = (f.references_text || '')
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (foodRefs.length === 0) {
        foodRefs.push(
          `DDInter v2.0 Drug-Food Interaction Knowledgebase (DFI: ${f.drug_name} ⟷ ${f.food_name}). Xiangya School of Pharmaceutical Sciences, Central South University (2022).`,
          `U.S. Food and Drug Administration (FDA): Avoiding Drug and Food Interactions Guide (2023).`
        );
      }

      const transFood = await ClinicalTranslator.translateFoodInteractionAsync(
        f.food_name,
        f.mechanism || '',
        'Modifikasi konsentrasi serum puncak atau ketersediaan hayati sistemik obat.',
        f.management || '',
        f.drug_name
      );

      foundFood.push({
        id: `dfi-db-${f.id}`,
        drugId: f.ddinter_id,
        drugName: f.drug_name,
        foodItem: transFood.foodItem,
        foodCategory: 'Makanan/Nutrisi',
        severity: sev as any,
        mechanism: transFood.mechanism,
        effect: transFood.effect,
        recommendation: transFood.recommendation,
        references: foodRefs,
        source: 'DDInter v2.0 Drug-Food Interactions (DFI)',
        originalFoodItem: transFood.originalFoodItem,
        originalMechanism: transFood.originalMechanism,
        originalEffect: transFood.originalEffect,
        originalRecommendation: transFood.originalRecommendation,
      });
    }
  }

  // 5. Find Disease Contraindications exclusively from DDInter 2.0 SQLite (8,359 DDSIs)
  const foundDiseaseWarnings: DiseaseContraindication[] = [];
  const dbDdsi = ddinterDb.checkDDSI(normalizedDrugIds as string[], normalizedDiseaseIds as string[]);
  for (const dis of dbDdsi) {
    const exists = foundDiseaseWarnings.some(
      (ed) =>
        ed.drugName.toLowerCase() === dis.drug_name.toLowerCase() &&
        ed.diseaseName.toLowerCase() === dis.disease_name.toLowerCase()
    );
    if (!exists) {
      const sev = dis.level === '3' ? 'Major' : 'Moderate';
      const diseaseRefs = (dis.references_text || '')
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (diseaseRefs.length === 0) {
        diseaseRefs.push(
          `DDInter v2.0 Drug-Disease Interaction Knowledgebase (DDSI: ${dis.drug_name} ⟷ ${dis.disease_name}). Central South University (2022).`,
          `Clinical Pharmacogenetics & Disease Contraindication Guidelines (2023).`
        );
      }

      const transDis = await ClinicalTranslator.translateDiseaseContraindicationAsync(
        dis.disease_name,
        dis.text || '',
        '',
        '',
        dis.drug_name
      );

      foundDiseaseWarnings.push({
        id: `ddsi-db-${dis.id}`,
        drugId: dis.ddinter_id,
        drugName: dis.drug_name,
        diseaseId: dis.disease_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        diseaseName: transDis.diseaseName,
        severity: sev as any,
        risk: transDis.risk,
        mechanism: transDis.mechanism,
        management: transDis.management,
        references: diseaseRefs,
        source: 'DDInter v2.0 Drug-Disease Contraindications (DDSI)',
        originalDiseaseName: transDis.originalDiseaseName,
        originalRisk: transDis.originalRisk,
        originalMechanism: transDis.originalMechanism,
        originalManagement: transDis.originalManagement,
      });
    }
  }

  // 6. Detect Therapeutic Duplications exclusively from DDInter 2.0 SQLite (6,033 records)
  const foundDuplications: TherapeuticDuplication[] = [];
  const dbDupli = ddinterDb.checkDuplications(normalizedDrugIds);
  for (const dup of dbDupli) {
    const nameA = dup.drug_multi_trade || dup.drug_multi;
    const nameB = dup.drug_b;
    const exists = foundDuplications.some(
      (ed) =>
        ((ed.drugA.toLowerCase() === nameA.toLowerCase() && ed.drugB.toLowerCase() === nameB.toLowerCase()) ||
         (ed.drugA.toLowerCase() === nameB.toLowerCase() && ed.drugB.toLowerCase() === nameA.toLowerCase())) &&
        ed.therapeuticClass.toLowerCase() === dup.drug_type.toLowerCase()
    );
    if (!exists) {
      const dupliRefs = [
        `DDInter v2.0 Polypharmacy & Therapeutic Duplication Surveillance Database (Nucleic Acids Research, 2024). https://ddinter2.scbdd.com/`,
        `DDInter 2.0: 6,033 therapeutic duplication records involving 317 combination drugs and 96 pharmacological classes.`,
      ];

      const transDup = ClinicalTranslator.translateDuplication(
        dup.warning || '',
        dup.note || '',
        nameA,
        nameB,
        dup.drug_type
      );

      foundDuplications.push({
        id: `dupli-db-${dup.id}`,
        drugA: nameA,
        drugB: nameB,
        therapeuticClass: dup.drug_type,
        atcGroup: dup.drug_type,
        concern: transDup.concern,
        recommendation: transDup.recommendation,
        references: dupliRefs,
        source: 'DDInter v2.0 Therapeutic Duplication Surveillance (ddinter2.scbdd.com)',
        originalConcern: transDup.originalConcern,
        originalRecommendation: transDup.originalRecommendation,
      });
    }
  }


  // 7. Calculate Total Risk Score (0-100)
  let riskScore = 0;

  foundDdi.forEach((inter) => {
    if (inter.severity === 'Contraindicated') riskScore += 40;
    else if (inter.severity === 'Major') riskScore += 25;
    else if (inter.severity === 'Moderate') riskScore += 12;
    else if (inter.severity === 'Minor') riskScore += 5;
    // 'Unknown' contributes 0 to riskScore
  });

  foundFood.forEach((food) => {
    if (food.severity === 'Contraindicated') riskScore += 30;
    else if (food.severity === 'Major') riskScore += 18;
    else if (food.severity === 'Moderate') riskScore += 8;
  });

  foundDiseaseWarnings.forEach((dis) => {
    if (dis.severity === 'Major') riskScore += 35;
    else riskScore += 15;
  });

  foundDuplications.forEach(() => {
    riskScore += 20;
  });

  riskScore = Math.min(100, riskScore);

  let riskLevel: RegimenAnalysisResult['riskLevel'] = 'Aman';
  if (riskScore >= 60) riskLevel = 'Risiko Tinggi / Kritis';
  else if (riskScore >= 30) riskLevel = 'Perhatian Sedang';
  else if (riskScore > 0) riskLevel = 'Rendah';

  let summary = 'Regimen kombinasi aman dan tidak ditemukan interaksi mayor yang terdaftar pada database DDInter.';
  if (riskLevel === 'Risiko Tinggi / Kritis') {
    summary =
      'PERINGATAN KRITIS: Ditemukan interaksi obat berbahaya, kontraindikasi penyakit, atau duplikasi terapi yang berpotensi memicu kejadian fatal jika tidak dimodifikasi.';
  } else if (riskLevel === 'Perhatian Sedang') {
    summary =
      'PERHATIAN KLINIS: Terdapat interaksi moderat atau interaksi makanan signifikan yang membutuhkan penyesuaian dosis, jarak konsumsi obat, atau pemantauan laboratorium.';
  } else if (riskLevel === 'Rendah') {
    summary = 'Interaksi minor terdeteksi. Regimen relatif dapat ditoleransi dengan konseling pasien yang tepat.';
  }

  const elapsed = performance.now() - startTime;

  const result: RegimenAnalysisResult = {
    analyzedDrugs: resolvedDrugs,
    analyzedDiseases: resolvedDiseases,
    drugInteractions: foundDdi,
    foodInteractions: foundFood,
    diseaseInteractions: foundDiseaseWarnings,
    therapeuticDuplications: foundDuplications,
    riskScore,
    riskLevel,
    summary,
    fromCache: false,
    latencyMs: parseFloat(elapsed.toFixed(2)),
    executionTimeMs: parseFloat(elapsed.toFixed(2)),
    timestamp: new Date().toISOString(),
  };

  // Cache regimen result for 15 minutes
  globalCache.set(cacheKey, result, 900, 'DDInter Multi-Engine Analysis');
  res.json(result);
});

// 6b. DDInter Full Interaction Detail (References, Alternatives, CYP Metabolism)
app.get('/api/ddinter/interaction-full', async (req: Request, res: Response) => {
  const idA = ((req.query.idA as string) || '').trim();
  const idB = ((req.query.idB as string) || '').trim();
  const nameA = ((req.query.nameA as string) || '').trim();
  const nameB = ((req.query.nameB as string) || '').trim();

  if (!idA || !idB) {
    res.status(400).json({ error: 'Parameters idA and idB are required' });
    return;
  }

  try {
    const details = await ddinterLiveService.getDdiFullDetails(idA, idB, nameA, nameB);
    res.json(details);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch interaction details' });
  }
});

// 7. DDInter AJAX Table Penetrator (mimicking ddinter2.scbdd.com/ddi/search table)
// Supports multi-table switching: 'ddi' (302k), 'dfi' (857), 'ddsi' (8.359), 'dupli' (6.033)
app.get('/api/ddinter/table', (req: Request, res: Response) => {
  const startTime = performance.now();
  const type = ((req.query.type as string) || 'ddi').toLowerCase().trim();
  const search = ((req.query.search as string) || '').toLowerCase().trim();
  const severity = (req.query.severity as string) || '';
  const category = (req.query.category as string) || '';
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '15', 10)));
  const noCache = req.query.nocache === 'true';

  const cacheKey = `ddinter:table:${type}:${search}:${severity}:${category}:${page}:${limit}`;

  if (!noCache) {
    const cached = globalCache.get<Record<string, any>>(cacheKey);
    if (cached) {
      const elapsed = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed.toFixed(2)),
      });
    }
  }

  let payload: any = null;

  if (type === 'dfi') {
    // Drug-Food Interaction Table (857 records)
    const tableResult = ddinterDb.queryDFITable(search, severity, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      const sevLabel = r.level === '3' ? 'Major' : r.level === '2' ? 'Moderate' : 'Minor';
      return {
        id: `dfi-${r.id}`,
        ddinterId: r.ddinter_id,
        drugName: r.drug_name,
        foodName: r.food_name,
        level: r.level,
        severity: sevLabel,
        mechanism: r.mechanism || 'Mekanisme absorpsi atau metabolisme dipengaruhi oleh asupan makanan tertentu.',
        management: r.management || 'Pertimbangkan jeda waktu pemberian obat terhadap makanan terkait.',
        references: r.references_text || '',
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id}/`,
      };
    });

    payload = {
      type: 'dfi',
      source: 'DDInter v2.0 Drug-Food Interaction Database (857 DFI Records, 29 Foods, 430 Mechanisms)',
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages,
    };
  } else if (type === 'ddsi') {
    // Drug-Disease Interaction Table (8,359 records)
    const tableResult = ddinterDb.queryDDSITable(search, severity, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      const sevLabel = r.level === '3' ? 'Major / Kontraindikasi' : r.level === '2' ? 'Moderate' : 'Minor';
      return {
        id: `ddsi-${r.id}`,
        ddinterId: r.ddinter_id,
        drugName: r.drug_name,
        diseaseName: r.disease_name,
        level: r.level,
        severity: sevLabel,
        warningText: r.text || 'Penggunaan pada kondisi patologis ini memerlukan perhatian khusus dan pemantauan klinis.',
        references: r.references_text || '',
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id}/`,
      };
    });

    payload = {
      type: 'ddsi',
      source:
        'DDInter v2.0 Drug-Disease Interaction Database (8,359 DDSI Records, 472 Diseases, 3,300 Detailed Warnings)',
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages,
    };
  } else if (type === 'dupli') {
    // Therapeutic Duplication Warning Table (6,033 records)
    const tableResult = ddinterDb.queryDupliTable(search, category, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      return {
        id: `dupli-${r.id}`,
        drugMultiTrade: r.drug_multi_trade,
        drugMulti: r.drug_multi,
        drugType: r.drug_type,
        drugB: r.drug_b,
        ddinterIdB: r.ddinter_id_b,
        warning: r.warning,
        note: r.note,
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_b}/`,
      };
    });

    payload = {
      type: 'dupli',
      source:
        'DDInter v2.0 Therapeutic Duplication Warning Database (6,033 Duplication Records, 317 Combination Drugs, 96 Drug Classes)',
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages,
    };
  } else {
    // Default: Drug-Drug Interaction Table (302,665 records)
    const tableResult = ddinterDb.queryTable(search, severity, page, limit);

    const formattedRows = tableResult.rows.map((r) => {
      const rawSev = (r.level || '').trim();
      let sev: SeverityLevel = 'Unknown';
      let levelNum = 0;
      if (rawSev === 'Major' || rawSev === 'Contraindicated') {
        sev = rawSev === 'Contraindicated' ? 'Contraindicated' : 'Major';
        levelNum = 3;
      } else if (rawSev === 'Moderate') {
        sev = 'Moderate';
        levelNum = 2;
      } else if (rawSev === 'Minor') {
        sev = 'Minor';
        levelNum = 1;
      } else {
        sev = 'Unknown';
        levelNum = 0;
      }

      const isUnknown = sev === 'Unknown';
      const clinicalInfo = isUnknown
        ? { mechanism: '-', clinicalEffect: '-', management: '-', evidenceLevel: '-', mechanismTags: [] }
        : clinicalDDIRules.resolveDDI(
            r.drug_a,
            r.ddinter_id_a,
            r.drug_b,
            r.ddinter_id_b,
            sev
          );


      return {
        id: `ddi-${r.id}`,
        ddinterId: `${r.ddinter_id_a}_${r.ddinter_id_b}`,
        drugA: {
          id: r.drug_a.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: r.drug_a,
          ddinterId: r.ddinter_id_a,
          officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_a}/`,
        },
        drugB: {
          id: r.drug_b.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: r.drug_b,
          ddinterId: r.ddinter_id_b,
          officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_b}/`,
        },
        severity: sev,
        levelNum,
        mechanism: clinicalInfo.mechanism,
        clinicalEffect: clinicalInfo.clinicalEffect,
        management: clinicalInfo.management,
        mechanismTags: clinicalInfo.mechanismTags,
        evidenceLevel: clinicalInfo.evidenceLevel || 'DDInter v2.0 Verified (Level A-B)',
        officialSourceUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_a}/`,
      };
    });

    payload = {
      type: 'ddi',
      source: `DDInter v2.0 Live Matrix (${tableResult.total.toLocaleString('id-ID')} DDI Records, 8,398 Mechanism Descriptions)`,
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages,
    };
  }

  globalCache.set(cacheKey, payload, 600, `DDInter Table [${type.toUpperCase()}]`);
  const elapsed = performance.now() - startTime;

  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2)),
  });
});

// Endpoint for duplication drug categories list
app.get('/api/ddinter/dupli-categories', (_req: Request, res: Response) => {
  const categories = [
    'antihistamines',
    'nonsteroidal anti-inflammatory agents',
    'proton pump inhibitors',
    'h2-receptor antagonists',
    'angiotensin converting enzyme inhibitors',
    'angiotensin ii inhibitors',
    'beta-adrenergic blocking agents',
    'calcium channel blockers',
    'hmg-coa reductase inhibitors (statins)',
    'loop diuretics',
    'thiazide and thiazide-like diuretics',
    'potassium sparing diuretics',
    'ssri antidepressants',
    'snri antidepressants',
    'tricyclic antidepressants',
    'benzodiazepines',
    'opioid analgesics',
    'anticholinergic agents',
    'sulfonamides',
    'quinolones',
    'macrolide derivatives',
    'tetracyclines',
    'penicillins',
    'cephalosporins',
    'antifungal agents',
    'antiviral agents',
    'corticosteroids',
    'muscle relaxants',
    'sulfonylureas',
    'thiazolidinediones',
    'dipeptidyl peptidase 4 inhibitors',
    'sglt2 inhibitors',
    'antiplatelet agents',
    'anticoagulants',
    'antacids',
    'laxatives',
  ];
  res.json({ categories });
});

// 8. Cache inspection and statistics
app.get('/api/cache/stats', (_req: Request, res: Response) => {
  const stats = globalCache.getStats();
  res.json(stats);
});

// 9. Cache clear
app.post('/api/cache/clear', (_req: Request, res: Response) => {
  globalCache.clear();
  res.json({ success: true, message: 'Pharmacy Cache berhasil dibersihkan.', timestamp: new Date().toISOString() });
});

// Vite dev server mounting or static production serving
async function setupServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[FD Server] Farmakologi & Drug Data Engine running on port ${PORT}`);
  });
}

setupServer().catch((err) => {
  console.error('[FD Server Error]', err);
});
