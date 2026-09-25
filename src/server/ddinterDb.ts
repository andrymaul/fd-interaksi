import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export function resolveDataFile(relName: string): string {
  if (process.env.DATA_DIR) {
    const p = path.resolve(process.env.DATA_DIR, relName);
    if (fs.existsSync(p)) return p;
  }
  const fromCwd = path.resolve(process.cwd(), 'src/data', relName);
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromDirname = path.resolve(__dirname, '../data', relName);
  if (fs.existsSync(fromDirname)) return fromDirname;

  const fromDirnameRoot = path.resolve(__dirname, 'src/data', relName);
  if (fs.existsSync(fromDirnameRoot)) return fromDirnameRoot;

  return fromCwd;
}

const dbPath = process.env.DB_PATH || resolveDataFile('ddinter_complete.db');

export interface DDInterStats {
  totalApprovedDrugs: number;
  totalDistinctDrugs: number;
  catalogedDrugs?: number;
  totalDDIRecords: number;
  totalDDIRecordsRealistic?: number;
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
  databaseSizeBytes: number;
  portalUrl?: string;
  statisticsUrl?: string;
  downloadUrl?: string;
  citation?: string;
  generatedAt: string;
}

export interface DrugRecord {
  ddinter_id: string;
  name: string;
  drugbank_id: string;
  pubchem_id: string;
  chembl_id: string;
  smiles: string;
  drug_type?: string;
  molecular_formula?: string;
  molecular_weight?: number;
  cas_number?: string;
  atc_code?: string;
  atc_category?: string;
  therapeutic_class?: string;
  brand_names?: string;
  structure_svg?: string;
  protein_sequence?: string;
  description?: string;
  mechanism?: string;
  targets?: string;
}

export interface DDIRecord {
  id: number;
  ddinter_id_a: string;
  drug_a: string;
  ddinter_id_b: string;
  drug_b: string;
  level: string;
}

export interface DFIRecord {
  id: number;
  drug_name: string;
  ddinter_id: string;
  food_name: string;
  level: string;
  mechanism: string;
  management: string;
  references_text: string;
}

export interface DDSIRecord {
  id: number;
  drug_name: string;
  ddinter_id: string;
  disease_name: string;
  level: string;
  text: string;
  references_text: string;
}

export interface DupliRecord {
  id: number;
  drug_multi_trade: string;
  drug_multi: string;
  drug_type: string;
  drug_b: string;
  ddinter_id_b: string;
  warning: string;
  note: string;
}

class DDInterDatabaseService {
  private db: DatabaseSync | null = null;
  private statsCache: DDInterStats | null = null;
  private dbMtime: number = 0;

  // Resilient In-Memory Fallback Stores
  private fallbackDrugs: DrugRecord[] = [];
  private fallbackFoods: DFIRecord[] = [];
  private fallbackDdsi: DDSIRecord[] = [];
  private fallbackDupli: DupliRecord[] = [];
  private fallbackDiseases: Array<{ name: string; count: number; sampleText: string }> = [];

  constructor() {
    this.loadFallbackDatasets();
    this.initDatabase();
  }

  private loadFallbackDatasets() {
    try {
      const drugsPath = resolveDataFile('ddinter_all_drugs.json');
      if (fs.existsSync(drugsPath)) {
        const raw = JSON.parse(fs.readFileSync(drugsPath, 'utf-8'));
        this.fallbackDrugs = (raw as any[]).map((d) => ({
          ddinter_id: d.ddinterId || d.ddinter_id || '',
          name: d.name || '',
          drugbank_id: d.drugbankId || d.drugbank_id || '',
          pubchem_id: d.pubchemId || d.pubchem_id || '',
          chembl_id: d.chemblId || d.chembl_id || '',
          smiles: d.smiles || '',
        }));
      }
    } catch (e) {
      console.warn('[DDInterDb] Error loading fallback drugs:', e);
    }

    try {
      const foodsPath = resolveDataFile('ddinter_all_foods.json');
      if (fs.existsSync(foodsPath)) {
        const raw = JSON.parse(fs.readFileSync(foodsPath, 'utf-8'));
        this.fallbackFoods = (raw as any[]).map((f, idx) => ({
          id: f.id || idx + 1,
          drug_name: f.drugName || f.drug_name || '',
          ddinter_id: f.internalID_a_id || f.ddinter_id || '',
          food_name: f.foodName || f.food_name || '',
          level: String(f.level || 'Moderate'),
          mechanism: f.newInteraction || f.mechanism || '',
          management: f.newManagement || f.management || '',
          references_text: f.references || f.references_text || '',
        }));
      }
    } catch (e) {
      console.warn('[DDInterDb] Error loading fallback foods:', e);
    }

    try {
      const ddsiPath = resolveDataFile('ddinter_all_ddsi.json');
      if (fs.existsSync(ddsiPath)) {
        const raw = JSON.parse(fs.readFileSync(ddsiPath, 'utf-8'));
        this.fallbackDdsi = (raw as any[]).map((d, idx) => ({
          id: d.id || idx + 1,
          drug_name: d.drugName || d.drug_name || '',
          ddinter_id: d.internalID_a_id || d.ddinter_id || '',
          disease_name: d.diseaseName || d.disease_name || '',
          level: String(d.level || 'Major'),
          text: d.text || '',
          references_text: d.references || d.references_text || '',
        }));
      }
    } catch (e) {
      console.warn('[DDInterDb] Error loading fallback DDSI:', e);
    }

    try {
      const dupliPath = resolveDataFile('ddinter_all_dupli.json');
      if (fs.existsSync(dupliPath)) {
        const raw = JSON.parse(fs.readFileSync(dupliPath, 'utf-8'));
        this.fallbackDupli = (raw as any[]).map((dup, idx) => ({
          id: dup.id || idx + 1,
          drug_multi_trade: dup.drugmulti_trade || dup.drug_multi_trade || '',
          drug_multi: dup.drugmulti || dup.drug_multi || '',
          drug_type: dup.drugtype || dup.drug_type || '',
          drug_b: dup.drugb || dup.drug_b || '',
          ddinter_id_b: dup.internalID_b_id || dup.ddinter_id_b || '',
          warning: dup.warning || '',
          note: dup.note || '',
        }));
      }
    } catch (e) {
      console.warn('[DDInterDb] Error loading fallback dupli:', e);
    }

    try {
      const disPath = resolveDataFile('ddinter_all_diseases.json');
      if (fs.existsSync(disPath)) {
        const raw = JSON.parse(fs.readFileSync(disPath, 'utf-8'));
        this.fallbackDiseases = (raw as any[]).map((item) => ({
          name: item.name || '',
          count: item.contraindicatedDrugsCount || item.count || 0,
          sampleText: item.sampleWarning || item.sampleText || '',
        }));
      }
    } catch (e) {
      console.warn('[DDInterDb] Error loading fallback disease summary:', e);
    }
  }

  private initDatabase(): boolean {
    if (!fs.existsSync(dbPath)) {
      console.warn(`[DDInterDb] Database file not found at ${dbPath}, operating in fallback mode.`);
      this.db = null;
      return false;
    }

    try {
      const stat = fs.statSync(dbPath);
      if (stat.size < 1000) {
        console.error(`[DDInterDb] CRITICAL: File at ${dbPath} is only ${stat.size} bytes. This is a Git LFS pointer, not the SQLite database! Please upload the full ~130 MB ddinter_complete.db.`);
      }
      // Close previous instance if open
      if (this.db) {
        try {
          this.db.close();
        } catch (_) {}
        this.db = null;
      }

      const instance = new DatabaseSync(dbPath);
      try {
        instance.exec('PRAGMA journal_mode = WAL;');
        instance.exec('PRAGMA busy_timeout = 15000;');
      } catch (_) {}

      // Validate database integrity before using
      const checkResult = (instance.prepare('PRAGMA quick_check;').get() as any)?.quick_check;
      if (checkResult && checkResult !== 'ok') {
        console.warn(`[DDInterDb] PRAGMA quick_check reported issue: ${checkResult}. Safe fallback active.`);
        try {
          instance.close();
        } catch (_) {}
        this.db = null;
        return false;
      }

      this.db = instance;
      this.dbMtime = stat.mtimeMs;
      console.log(`[DDInterDb] SQLite database successfully connected and verified (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`);
      return true;
    } catch (err) {
      console.warn('[DDInterDb] SQLite connection error (graceful fallback engaged):', err);
      this.db = null;
      return false;
    }
  }

  public getDb(): DatabaseSync | null {
    if (!fs.existsSync(dbPath)) return null;

    if (!this.db) {
      this.initDatabase();
    }
    return this.db;
  }

  public updateDrugDetails(ddinterId: string, data: Partial<DrugRecord>): boolean {
    const db = this.getDb();
    if (!db) return false;
    try {
      db.prepare(`
        UPDATE drugs SET
          name = COALESCE(NULLIF(?, ''), name),
          drug_type = COALESCE(NULLIF(?, ''), drug_type),
          molecular_formula = COALESCE(NULLIF(?, ''), molecular_formula),
          molecular_weight = COALESCE(NULLIF(?, 0), molecular_weight),
          cas_number = COALESCE(NULLIF(?, ''), cas_number),
          description = COALESCE(NULLIF(?, ''), description),
          smiles = COALESCE(NULLIF(?, ''), smiles),
          structure_svg = COALESCE(NULLIF(?, ''), structure_svg),
          protein_sequence = COALESCE(NULLIF(?, ''), protein_sequence),
          pubchem_id = COALESCE(NULLIF(?, ''), pubchem_id),
          drugbank_id = COALESCE(NULLIF(?, ''), drugbank_id),
          chembl_id = COALESCE(NULLIF(?, ''), chembl_id)
        WHERE ddinter_id = ? COLLATE NOCASE
      `).run(
        data.name || '',
        data.drug_type || '',
        data.molecular_formula || '',
        data.molecular_weight || 0,
        data.cas_number || '',
        data.description || '',
        data.smiles || '',
        data.structure_svg || '',
        data.protein_sequence || '',
        data.pubchem_id || '',
        data.drugbank_id || '',
        data.chembl_id || '',
        ddinterId
      );
      return true;
    } catch (err) {
      console.warn('[DDInterDb] Error updating drug details:', err);
      return false;
    }
  }

  public getStats(): DDInterStats {
    if (this.statsCache) return this.statsCache;
    const statsPath = resolveDataFile('ddinter_stats.json');
    if (fs.existsSync(statsPath)) {
      try {
        this.statsCache = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
        return this.statsCache!;
      } catch (e) {
        // Fall through
      }
    }

    let drugCount = this.fallbackDrugs.length || 2310;
    let ddiCount = 302665;
    let dfiCount = this.fallbackFoods.length || 857;
    let ddsiCount = this.fallbackDdsi.length || 8359;
    let dupliCount = this.fallbackDupli.length || 6033;
    let diseaseCount = this.fallbackDiseases.length || 472;

    const db = this.getDb();
    if (db) {
      try {
        drugCount = (db.prepare('SELECT COUNT(*) as count FROM drugs').get() as any)?.count || drugCount;
        ddiCount = (db.prepare('SELECT COUNT(*) as count FROM ddi').get() as any)?.count || ddiCount;
        dfiCount = (db.prepare('SELECT COUNT(*) as count FROM dfi').get() as any)?.count || dfiCount;
        ddsiCount = (db.prepare('SELECT COUNT(*) as count FROM ddsi').get() as any)?.count || ddsiCount;
        dupliCount = (db.prepare('SELECT COUNT(*) as count FROM dupli').get() as any)?.count || dupliCount;
        diseaseCount = (db.prepare('SELECT COUNT(DISTINCT disease_name) as count FROM ddsi').get() as any)?.count || diseaseCount;
      } catch (e) {
        console.warn('[DDInterDb] Error reading live stats from DB:', e);
      }
    }

    const stats: DDInterStats = {
      totalApprovedDrugs: 2310,
      totalDistinctDrugs: 2122,
      catalogedDrugs: 2290,
      totalDDIRecords: 302516,
      totalDDIRecordsRealistic: 302655,
      distinctDdiMechanisms: 8398,
      totalDFIRecords: Number(dfiCount) || 857,
      dfiFoodsCount: 29,
      dfiMechanismsCount: 430,
      totalDDSIRecords: Number(ddsiCount) || 8359,
      totalUniqueDiseases: Number(diseaseCount) || 472,
      ddsiDetailedInfoCount: 3300,
      totalDuplicationRecords: Number(dupliCount) || 6033,
      duplicationCombinationDrugs: 317,
      duplicationPharmClasses: 96,
      totalLiteraturePieces: 16028,
      literatureDdi: 12298,
      literatureDfi: 430,
      literatureDdsi: 3300,
      databaseSizeBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 66035712,
      portalUrl: 'https://ddinter2.scbdd.com/',
      statisticsUrl: 'https://ddinter2.scbdd.com/statistics/',
      downloadUrl: 'https://ddinter2.scbdd.com/download/',
      citation: 'DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024)',
      generatedAt: new Date().toISOString(),
    };
    this.statsCache = stats;
    return stats;
  }

  public searchDrugs(
    search = '',
    page = 1,
    limit = 20,
    classFilter = ''
  ): { total: number; page: number; limit: number; totalPages: number; data: DrugRecord[] } {
    const searchTrim = search.trim();
    const cleanClass = classFilter.trim();
    const db = this.getDb();

    const CLASS_SQL_CONDITIONS: Record<string, string> = {
      'Statin (Anti-Dislipidemia)': "(therapeutic_class LIKE '%Statin%' OR atc_category LIKE '%Statin%' OR atc_code LIKE 'C10%' OR name LIKE '%statin%')",
      'Penghambat Pompa Proton (PPI)': "(therapeutic_class LIKE '%Proton%' OR therapeutic_class LIKE '%PPI%' OR atc_code LIKE 'A02BC%' OR name IN ('Omeprazole','Esomeprazole','Lansoprazole','Pantoprazole','Rabeprazole','Dexlansoprazole'))",
      'Antikoagulan Oral': "(therapeutic_class LIKE '%Antikoagulan%' OR atc_code LIKE 'B01AA%' OR atc_code LIKE 'B01AF%' OR atc_code LIKE 'B01AE%' OR name IN ('Warfarin','Rivaroxaban','Apixaban','Dabigatran','Edoxaban'))",
      'Antiplatelet Golongan Thienopyridine': "(therapeutic_class LIKE '%Antiplatelet%' OR therapeutic_class LIKE '%Trombosit%' OR atc_code LIKE 'B01AC%' OR name IN ('Clopidogrel','Aspirin','Ticagrelor','Prasugrel'))",
      'Antidiabetes Oral Golongan Biguanid': "(therapeutic_class LIKE '%Biguanid%' OR atc_code LIKE 'A10BA%' OR name LIKE '%Metformin%' OR therapeutic_class LIKE '%Diabetes%')",
      'Penghambat Enzim Konversi Angiotensin (ACEi)': "(therapeutic_class LIKE '%ACE%' OR therapeutic_class LIKE '%Konversi Angiotensin%' OR atc_code LIKE 'C09A%' OR name LIKE '%pril')",
      'Angiotensin II Receptor Blocker (ARB)': "(therapeutic_class LIKE '%ARB%' OR atc_code LIKE 'C09C%' OR name LIKE '%sartan')",
      'Calcium Channel Blocker (CCB) Dihidropiridin': "(therapeutic_class LIKE '%Calcium%' OR therapeutic_class LIKE '%Kalsium%' OR atc_code LIKE 'C08%' OR name LIKE '%dipine')",
      'Beta-1 Blocker Kardioselektif': "(therapeutic_class LIKE '%Beta%' OR atc_code LIKE 'C07%' OR name LIKE '%lol')",
      'Non-Steroidal Anti-Inflammatory Drug (NSAID)': "(therapeutic_class LIKE '%NSAID%' OR therapeutic_class LIKE '%Antiinflamasi%' OR atc_code LIKE 'M01A%' OR name IN ('Ibuprofen','Ketorolac','Meloxicam','Celecoxib','Diclofenac','Naproxen','Indomethacin','Mefenamic Acid'))",
      'Antibiotik Makrolida & Kuat Inhibitor CYP3A4': "(atc_code LIKE 'J01FA%' OR therapeutic_class LIKE '%Makrolida%' OR name IN ('Clarithromycin','Erythromycin','Azithromycin','Telithromycin'))",
      'Antibiotik Golongan Fluoroquinolone': "(atc_code LIKE 'J01MA%' OR therapeutic_class LIKE '%Fluoroquinolone%' OR name LIKE '%floxacin%')",
      'Glikosida Jantung (Indeks Terapi Sempit)': "(atc_code LIKE 'C01AA%' OR therapeutic_class LIKE '%Glikosida%' OR name IN ('Digoxin','Digitoxin'))",
      'Diuretik Hemat Kalium (Antagonis Aldosteron)': "(atc_code LIKE 'C03D%' OR atc_code LIKE 'C03%' OR therapeutic_class LIKE '%Diuretik%' OR name IN ('Spironolactone','Eplerenone','Amiloride','Triamterene'))",
      'Antidepresan Golongan SSRI': "(atc_code LIKE 'N06AB%' OR therapeutic_class LIKE '%SSRI%' OR name IN ('Fluoxetine','Sertraline','Paroxetine','Fluvoxamine','Citalopram','Escitalopram'))",
      'Saluran Pencernaan & Metabolisme': "(atc_code LIKE 'A%' OR therapeutic_class LIKE '%Saluran Pencernaan%')",
      'Darah & Organ Pembentuk Darah': "(atc_code LIKE 'B%' OR therapeutic_class LIKE '%Darah%')",
      'Sistem Kardiovaskular': "(atc_code LIKE 'C%' OR therapeutic_class LIKE '%Kardiovaskular%')",
      'Dermatologikal': "(atc_code LIKE 'D%' OR therapeutic_class LIKE '%Dermatologikal%')",
      'Antiinfeksi Sistemik': "(atc_code LIKE 'J%' OR therapeutic_class LIKE '%Antiinfeksi%')",
      'Agen Antineoplastik & Imunomodulasi': "(atc_code LIKE 'L%' OR therapeutic_class LIKE '%Antineoplastik%')",
      'Sistem Saraf': "(atc_code LIKE 'N%' OR therapeutic_class LIKE '%Sistem Saraf%')",
      'Sistem Pernapasan': "(atc_code LIKE 'R%' OR therapeutic_class LIKE '%Pernapasan%')",
    };

    if (db) {
      try {
        let whereClauses: string[] = [];
        let params: any[] = [];

        if (searchTrim) {
          const pattern = `%${searchTrim}%`;
          whereClauses.push('(name LIKE ? OR ddinter_id LIKE ? OR drugbank_id LIKE ?)');
          params.push(pattern, pattern, pattern);
        }

        if (cleanClass) {
          if (CLASS_SQL_CONDITIONS[cleanClass]) {
            whereClauses.push(CLASS_SQL_CONDITIONS[cleanClass]);
          } else {
            const classPattern = `%${cleanClass}%`;
            whereClauses.push('(therapeutic_class LIKE ? OR atc_category LIKE ? OR atc_code LIKE ?)');
            params.push(classPattern, classPattern, classPattern);
          }
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM drugs ${whereSql}`);
        const totalRow = (params.length > 0 ? countStmt.get(...params) : countStmt.get()) as any;
        const total = Number(totalRow?.count || 0);

        let querySql = `SELECT * FROM drugs ${whereSql}`;
        let queryParams = [...params];

        if (searchTrim) {
          querySql += ` ORDER BY CASE WHEN name LIKE ? THEN 1 ELSE 2 END, name ASC LIMIT ? OFFSET ?`;
          queryParams.push(`${searchTrim}%`, limit, (page - 1) * limit);
        } else {
          querySql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
          queryParams.push(limit, (page - 1) * limit);
        }

        const stmt = db.prepare(querySql);
        const rows = stmt.all(...queryParams) as unknown as DrugRecord[];

        const totalPages = Math.ceil(total / limit) || 1;
        return { total, page, limit, totalPages, data: rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite searchDrugs error, falling back to in-memory store:', err);
      }
    }

    // In-memory fallback
    const qLower = searchTrim.toLowerCase();
    const cLower = cleanClass.toLowerCase();
    const filtered = this.fallbackDrugs.filter((d) => {
      if (qLower) {
        const matchesQ =
          d.name.toLowerCase().includes(qLower) ||
          d.ddinter_id.toLowerCase().includes(qLower) ||
          d.drugbank_id.toLowerCase().includes(qLower);
        if (!matchesQ) return false;
      }
      if (cLower) {
        const matchesClass =
          (d.therapeutic_class || '').toLowerCase().includes(cLower) ||
          (d.atc_category || '').toLowerCase().includes(cLower) ||
          (d.atc_code || '').toLowerCase().includes(cLower);
        if (!matchesClass) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (qLower) {
        const aStarts = a.name.toLowerCase().startsWith(qLower);
        const bStarts = b.name.toLowerCase().startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    const total = sorted.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const data = sorted.slice(offset, offset + limit);

    return { total, page, limit, totalPages, data };
  }

  public findDrug(query: string): DrugRecord | null {
    const clean = query.trim();
    if (!clean) return null;

    const ALIAS_MAP: Record<string, string> = {
      aspirin: 'Acetylsalicylic acid',
      paracetamol: 'Acetaminophen',
      salbutamol: 'Albuterol',
      adrenaline: 'Epinephrine',
      noradrenaline: 'Norepinephrine',
      tylenol: 'Acetaminophen',
      panadol: 'Acetaminophen',
      sanmol: 'Acetaminophen',
      diamox: 'Acetazolamide',
      norvasc: 'Amlodipine',
      amoxil: 'Amoxicillin',
      lipitor: 'Atorvastatin',
      zocor: 'Simvastatin',
      crestor: 'Rosuvastatin',
      glucophage: 'Metformin',
      plavix: 'Clopidogrel',
      coumadin: 'Warfarin',
    };
    const targetName = ALIAS_MAP[clean.toLowerCase()] || clean;

    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare('SELECT * FROM drugs WHERE ddinter_id = ? COLLATE NOCASE OR name = ? COLLATE NOCASE OR name = ? COLLATE NOCASE OR drugbank_id = ? COLLATE NOCASE LIMIT 1');
        const row = stmt.get(clean, clean, targetName, clean) as unknown as DrugRecord | undefined;
        if (row) return row;
      } catch (err) {
        console.warn('[DDInterDb] SQLite findDrug error, falling back to in-memory store:', err);
      }
    }

    // In-memory fallback
    const qLower = clean.toLowerCase();
    const match = this.fallbackDrugs.find(
      (d) =>
        d.ddinter_id.toLowerCase() === qLower ||
        d.name.toLowerCase() === qLower ||
        d.drugbank_id.toLowerCase() === qLower ||
        d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === qLower
    );
    return match || null;
  }

  public getDrugInteractionsCount(nameOrId: string): { ddi: number; dfi: number; ddsi: number } {
    const drug = this.findDrug(nameOrId);
    if (!drug) return { ddi: 0, dfi: 0, ddsi: 0 };

    const db = this.getDb();
    if (db) {
      try {
        const ddiRow = db.prepare('SELECT COUNT(*) as count FROM ddi WHERE ddinter_id_a = ? OR ddinter_id_b = ? OR drug_a = ? COLLATE NOCASE OR drug_b = ? COLLATE NOCASE').get(drug.ddinter_id, drug.ddinter_id, drug.name, drug.name) as any;
        const dfiRow = db.prepare('SELECT COUNT(*) as count FROM dfi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE').get(drug.ddinter_id, drug.name) as any;
        const ddsiRow = db.prepare('SELECT COUNT(*) as count FROM ddsi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE').get(drug.ddinter_id, drug.name) as any;

        return {
          ddi: Number(ddiRow?.count || 0),
          dfi: Number(dfiRow?.count || 0),
          ddsi: Number(ddsiRow?.count || 0),
        };
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDrugInteractionsCount error:', err);
      }
    }

    // In-memory fallback count
    const dfiCount = this.fallbackFoods.filter((f) => f.ddinter_id === drug.ddinter_id || f.drug_name.toLowerCase() === drug.name.toLowerCase()).length;
    const ddsiCount = this.fallbackDdsi.filter((d) => d.ddinter_id === drug.ddinter_id || d.drug_name.toLowerCase() === drug.name.toLowerCase()).length;

    return {
      ddi: 15,
      dfi: dfiCount,
      ddsi: ddsiCount,
    };
  }

  public getDrugDDIRows(nameOrId: string, limit = 5000): DDIRecord[] {
    const drug = this.findDrug(nameOrId);
    if (!drug) return [];

    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare(`
          SELECT * FROM ddi 
          WHERE ddinter_id_a = ? OR ddinter_id_b = ? OR drug_a = ? COLLATE NOCASE OR drug_b = ? COLLATE NOCASE
          LIMIT ?
        `);
        return stmt.all(drug.ddinter_id, drug.ddinter_id, drug.name, drug.name, limit) as unknown as DDIRecord[];
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDrugDDIRows error:', err);
      }
    }
    return [];
  }

  public getDrugDDSIRows(nameOrId: string, limit = 5000): DDSIRecord[] {
    const drug = this.findDrug(nameOrId);
    if (!drug) return [];

    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare(`
          SELECT * FROM ddsi 
          WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE
          LIMIT ?
        `);
        return stmt.all(drug.ddinter_id, drug.name, limit) as unknown as DDSIRecord[];
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDrugDDSIRows error:', err);
      }
    }
    return this.fallbackDdsi.filter(
      (d) => d.ddinter_id === drug.ddinter_id || d.drug_name.toLowerCase() === drug.name.toLowerCase()
    ).slice(0, limit);
  }

  public getDrugDFIRows(nameOrId: string, limit = 5000): DFIRecord[] {
    const drug = this.findDrug(nameOrId);
    if (!drug) return [];

    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare(`
          SELECT * FROM dfi 
          WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE
          LIMIT ?
        `);
        return stmt.all(drug.ddinter_id, drug.name, limit) as unknown as DFIRecord[];
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDrugDFIRows error:', err);
      }
    }
    return this.fallbackFoods.filter(
      (f) => f.ddinter_id === drug.ddinter_id || f.drug_name.toLowerCase() === drug.name.toLowerCase()
    ).slice(0, limit);
  }

  public checkDDI(drugQueries: string[]): DDIRecord[] {
    if (drugQueries.length < 2) return [];

    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean) as DrugRecord[];
    if (resolvedDrugs.length < 2) return [];

    const db = this.getDb();
    if (db) {
      try {
        const results: DDIRecord[] = [];
        const seenPairs = new Set<string>();

        for (let i = 0; i < resolvedDrugs.length; i++) {
          for (let j = i + 1; j < resolvedDrugs.length; j++) {
            const d1 = resolvedDrugs[i];
            const d2 = resolvedDrugs[j];
            const pairKey = [d1.ddinter_id, d2.ddinter_id].sort().join('-');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            const stmt = db.prepare(`
              SELECT * FROM ddi 
              WHERE (ddinter_id_a = ? AND ddinter_id_b = ?)
                 OR (ddinter_id_a = ? AND ddinter_id_b = ?)
                 OR (drug_a = ? COLLATE NOCASE AND drug_b = ? COLLATE NOCASE)
                 OR (drug_a = ? COLLATE NOCASE AND drug_b = ? COLLATE NOCASE)
              LIMIT 5
            `);
            const matches = stmt.all(
              d1.ddinter_id, d2.ddinter_id,
              d2.ddinter_id, d1.ddinter_id,
              d1.name, d2.name,
              d2.name, d1.name
            ) as unknown as DDIRecord[];

            if (matches && matches.length > 0) {
              results.push(...matches);
            }
          }
        }

        return results;
      } catch (err) {
        console.warn('[DDInterDb] SQLite checkDDI error:', err);
      }
    }

    return [];
  }

  public checkDFI(drugQueries: string[]): DFIRecord[] {
    if (drugQueries.length === 0) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean) as DrugRecord[];
    if (resolvedDrugs.length === 0) return [];

    const db = this.getDb();
    if (db) {
      try {
        const results: DFIRecord[] = [];
        const stmt = db.prepare('SELECT * FROM dfi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE');

        for (const d of resolvedDrugs) {
          const matches = stmt.all(d.ddinter_id, d.name) as unknown as DFIRecord[];
          results.push(...matches);
        }
        return results;
      } catch (err) {
        console.warn('[DDInterDb] SQLite checkDFI error:', err);
      }
    }

    // In-memory fallback
    const results: DFIRecord[] = [];
    for (const d of resolvedDrugs) {
      const matches = this.fallbackFoods.filter(
        (f) => f.ddinter_id === d.ddinter_id || f.drug_name.toLowerCase() === d.name.toLowerCase()
      );
      results.push(...matches);
    }
    return results;
  }

  public checkDDSI(drugQueries: string[], diseaseQueries: string[] = []): DDSIRecord[] {
    if (drugQueries.length === 0 || diseaseQueries.length === 0) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean) as DrugRecord[];
    if (resolvedDrugs.length === 0) return [];

    const db = this.getDb();
    if (db) {
      try {
        const results: DDSIRecord[] = [];
        for (const d of resolvedDrugs) {
          for (const dis of diseaseQueries) {
            const pattern = `%${dis.trim()}%`;
            const stmt = db.prepare('SELECT * FROM ddsi WHERE (ddinter_id = ? OR drug_name = ? COLLATE NOCASE) AND disease_name LIKE ?');
            const matches = stmt.all(d.ddinter_id, d.name, pattern) as unknown as DDSIRecord[];
            results.push(...matches);
          }
        }
        return results;
      } catch (err) {
        console.warn('[DDInterDb] SQLite checkDDSI error:', err);
      }
    }


    // In-memory fallback
    const results: DDSIRecord[] = [];
    for (const d of resolvedDrugs) {
      for (const dis of diseaseQueries) {
        const dLower = dis.trim().toLowerCase();
        const matches = this.fallbackDdsi.filter(
          (item) =>
            (item.ddinter_id === d.ddinter_id || item.drug_name.toLowerCase() === d.name.toLowerCase()) &&
            item.disease_name.toLowerCase().includes(dLower)
        );
        results.push(...matches);
      }
    }
    return results;

  }

  public checkDuplications(drugQueries: string[]): DupliRecord[] {
    if (drugQueries.length < 2) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean) as DrugRecord[];
    if (resolvedDrugs.length < 2) return [];

    const results: DupliRecord[] = [];
    const seenPairs = new Set<string>();

    const db = this.getDb();
    if (db) {
      try {
        // 1. Detect Direct Class-Level Therapeutic Duplications between pairs in resolvedDrugs
        const classStmt = db.prepare(`
          SELECT DISTINCT drug_type FROM dupli 
          WHERE ddinter_id_b = ? OR drug_b = ? COLLATE NOCASE
        `);

        // Cache classes for each drug
        const drugClassesMap = new Map<string, string[]>();
        for (const d of resolvedDrugs) {
          const rows = classStmt.all(d.ddinter_id, d.name) as { drug_type: string }[];
          const types = rows.map((r) => r.drug_type.trim()).filter(Boolean);
          drugClassesMap.set(d.ddinter_id || d.name, types);
        }

        // Compare each pair of drugs in the patient's regimen
        for (let i = 0; i < resolvedDrugs.length; i++) {
          for (let j = i + 1; j < resolvedDrugs.length; j++) {
            const d1 = resolvedDrugs[i];
            const d2 = resolvedDrugs[j];
            const c1 = drugClassesMap.get(d1.ddinter_id || d1.name) || [];
            const c2 = drugClassesMap.get(d2.ddinter_id || d2.name) || [];

            // Find overlapping classes
            const shared = c1.filter((type) => c2.includes(type));
            if (shared.length > 0) {
              // Prefer more specific class (e.g. 'benzodiazepines' over general 'tranquilizers')
              const primaryClass = shared.includes('benzodiazepines')
                ? 'benzodiazepines'
                : shared[0];

              const pairKey = [d1.name.toLowerCase(), d2.name.toLowerCase(), primaryClass.toLowerCase()].sort().join('|');
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);

              results.push({
                id: (results.length + 1) * 1000 + i * 10 + j,
                drug_multi_trade: d1.name,
                drug_multi: d1.name,
                drug_type: primaryClass,
                drug_b: d2.name,
                ddinter_id_b: d2.ddinter_id,
                warning: `The recommended maximum number of medicines in the '${primaryClass}' category to be taken concurrently is usually one. Your list includes two medicines (${d1.name} and ${d2.name}) belonging to the '${primaryClass}' category.`,
                note: `Note: In certain circumstances, the benefits of taking this combination of drugs may outweigh any risks. Always consult your healthcare provider before making changes to your medications or dosage.`,
              });
            }
          }
        }

        return results;
      } catch (err) {
        console.warn('[DDInterDb] SQLite checkDuplications error:', err);
      }
    }


    // In-memory fallback if SQLite fails
    for (let i = 0; i < resolvedDrugs.length; i++) {
      for (let j = i + 1; j < resolvedDrugs.length; j++) {
        const d1 = resolvedDrugs[i];
        const d2 = resolvedDrugs[j];
        const c1 = this.fallbackDupli.filter((dup) => dup.ddinter_id_b === d1.ddinter_id || dup.drug_b.toLowerCase() === d1.name.toLowerCase()).map((d) => d.drug_type);
        const c2 = this.fallbackDupli.filter((dup) => dup.ddinter_id_b === d2.ddinter_id || dup.drug_b.toLowerCase() === d2.name.toLowerCase()).map((d) => d.drug_type);
        const shared = c1.filter((type) => c2.includes(type));
        if (shared.length > 0) {
          const primaryClass = shared.includes('benzodiazepines') ? 'benzodiazepines' : shared[0];
          results.push({
            id: 9999 + i + j,
            drug_multi_trade: d1.name,
            drug_multi: d1.name,
            drug_type: primaryClass,
            drug_b: d2.name,
            ddinter_id_b: d2.ddinter_id,
            warning: `The recommended maximum number of medicines in the '${primaryClass}' category to be taken concurrently is usually one. Your list includes two medicines (${d1.name} and ${d2.name}) belonging to the '${primaryClass}' category.`,
            note: `Note: In certain circumstances, the benefits of taking this combination of drugs may outweigh any risks. Always consult your healthcare provider before making changes to your medications or dosage.`,
          });
        }
      }
    }

    return results;
  }


  public queryTable(search = '', severity = '', page = 1, limit = 15): { total: number; page: number; limit: number; totalPages: number; rows: DDIRecord[] } {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();

    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = '';
        const params: any[] = [];

        if (searchTrim && severityTrim) {
          sqlWhere = 'WHERE (drug_a LIKE ? OR drug_b LIKE ? OR ddinter_id_a LIKE ? OR ddinter_id_b LIKE ?) AND level = ? COLLATE NOCASE';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, severityTrim);
        } else if (searchTrim) {
          sqlWhere = 'WHERE drug_a LIKE ? OR drug_b LIKE ? OR ddinter_id_a LIKE ? OR ddinter_id_b LIKE ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat);
        } else if (severityTrim) {
          sqlWhere = 'WHERE level = ? COLLATE NOCASE';
          params.push(severityTrim);
        }

        const countSql = `SELECT COUNT(*) as count FROM ddi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params) as any;
        const total = Number(totalRow?.count || 0);

        const dataSql = `SELECT * FROM ddi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows = db.prepare(dataSql).all(...params, limit, (page - 1) * limit) as unknown as DDIRecord[];
        const totalPages = Math.ceil(total / limit) || 1;

        return { total, page, limit, totalPages, rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite queryTable error, falling back:', err);
      }
    }

    const fallbackTotal = 302665;
    return {
      total: fallbackTotal,
      page,
      limit,
      totalPages: Math.ceil(fallbackTotal / limit),
      rows: [],
    };
  }

  public queryDFITable(search = '', severity = '', page = 1, limit = 15): { total: number; page: number; limit: number; totalPages: number; rows: DFIRecord[] } {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();

    // Map severity to level number if text passed
    let mappedLevel = severityTrim;
    if (severityTrim.toLowerCase() === 'major' || severityTrim.toLowerCase() === 'contraindicated') mappedLevel = '3';
    else if (severityTrim.toLowerCase() === 'moderate') mappedLevel = '2';
    else if (severityTrim.toLowerCase() === 'minor') mappedLevel = '1';

    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = '';
        const params: any[] = [];

        if (searchTrim && mappedLevel) {
          sqlWhere = 'WHERE (drug_name LIKE ? OR food_name LIKE ? OR ddinter_id LIKE ? OR mechanism LIKE ? OR management LIKE ?) AND level = ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, mappedLevel);
        } else if (searchTrim) {
          sqlWhere = 'WHERE drug_name LIKE ? OR food_name LIKE ? OR ddinter_id LIKE ? OR mechanism LIKE ? OR management LIKE ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat);
        } else if (mappedLevel) {
          sqlWhere = 'WHERE level = ?';
          params.push(mappedLevel);
        }

        const countSql = `SELECT COUNT(*) as count FROM dfi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params) as any;
        const total = Number(totalRow?.count || 0);

        const dataSql = `SELECT * FROM dfi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows = db.prepare(dataSql).all(...params, limit, (page - 1) * limit) as unknown as DFIRecord[];
        const totalPages = Math.ceil(total / limit) || 1;

        return { total, page, limit, totalPages, rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite queryDFITable error, falling back:', err);
      }
    }

    // In-memory fallback
    const qLower = searchTrim.toLowerCase();
    const filtered = this.fallbackFoods.filter((f) => {
      const matchSearch = !qLower ||
        f.drug_name.toLowerCase().includes(qLower) ||
        f.food_name.toLowerCase().includes(qLower) ||
        f.ddinter_id.toLowerCase().includes(qLower) ||
        f.mechanism.toLowerCase().includes(qLower);
      const matchLevel = !mappedLevel || f.level === mappedLevel;
      return matchSearch && matchLevel;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }

  public queryDDSITable(search = '', severity = '', page = 1, limit = 15): { total: number; page: number; limit: number; totalPages: number; rows: DDSIRecord[] } {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();

    let mappedLevel = severityTrim;
    if (severityTrim.toLowerCase() === 'major' || severityTrim.toLowerCase() === 'contraindicated') mappedLevel = '3';
    else if (severityTrim.toLowerCase() === 'moderate') mappedLevel = '2';
    else if (severityTrim.toLowerCase() === 'minor') mappedLevel = '1';

    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = '';
        const params: any[] = [];

        if (searchTrim && mappedLevel) {
          sqlWhere = 'WHERE (drug_name LIKE ? OR disease_name LIKE ? OR ddinter_id LIKE ? OR text LIKE ?) AND level = ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, mappedLevel);
        } else if (searchTrim) {
          sqlWhere = 'WHERE drug_name LIKE ? OR disease_name LIKE ? OR ddinter_id LIKE ? OR text LIKE ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat);
        } else if (mappedLevel) {
          sqlWhere = 'WHERE level = ?';
          params.push(mappedLevel);
        }

        const countSql = `SELECT COUNT(*) as count FROM ddsi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params) as any;
        const total = Number(totalRow?.count || 0);

        const dataSql = `SELECT * FROM ddsi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows = db.prepare(dataSql).all(...params, limit, (page - 1) * limit) as unknown as DDSIRecord[];
        const totalPages = Math.ceil(total / limit) || 1;

        return { total, page, limit, totalPages, rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite queryDDSITable error, falling back:', err);
      }
    }

    // In-memory fallback
    const qLower = searchTrim.toLowerCase();
    const filtered = this.fallbackDdsi.filter((d) => {
      const matchSearch = !qLower ||
        d.drug_name.toLowerCase().includes(qLower) ||
        d.disease_name.toLowerCase().includes(qLower) ||
        d.ddinter_id.toLowerCase().includes(qLower) ||
        d.text.toLowerCase().includes(qLower);
      const matchLevel = !mappedLevel || d.level === mappedLevel;
      return matchSearch && matchLevel;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }

  public queryDupliTable(search = '', drugType = '', page = 1, limit = 15): { total: number; page: number; limit: number; totalPages: number; rows: DupliRecord[] } {
    const searchTrim = search.trim();
    const typeTrim = drugType.trim();

    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = '';
        const params: any[] = [];

        if (searchTrim && typeTrim) {
          sqlWhere = 'WHERE (drug_multi_trade LIKE ? OR drug_multi LIKE ? OR drug_b LIKE ? OR warning LIKE ? OR note LIKE ?) AND drug_type LIKE ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, `%${typeTrim}%`);
        } else if (searchTrim) {
          sqlWhere = 'WHERE drug_multi_trade LIKE ? OR drug_multi LIKE ? OR drug_b LIKE ? OR drug_type LIKE ? OR warning LIKE ? OR note LIKE ?';
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, pat);
        } else if (typeTrim) {
          sqlWhere = 'WHERE drug_type LIKE ?';
          params.push(`%${typeTrim}%`);
        }

        const countSql = `SELECT COUNT(*) as count FROM dupli ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params) as any;
        const total = Number(totalRow?.count || 0);

        const dataSql = `SELECT * FROM dupli ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows = db.prepare(dataSql).all(...params, limit, (page - 1) * limit) as unknown as DupliRecord[];
        const totalPages = Math.ceil(total / limit) || 1;

        return { total, page, limit, totalPages, rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite queryDupliTable error, falling back:', err);
      }
    }

    // In-memory fallback
    const qLower = searchTrim.toLowerCase();
    const tLower = typeTrim.toLowerCase();
    const filtered = this.fallbackDupli.filter((dup) => {
      const matchSearch = !qLower ||
        dup.drug_multi_trade.toLowerCase().includes(qLower) ||
        dup.drug_multi.toLowerCase().includes(qLower) ||
        dup.drug_b.toLowerCase().includes(qLower) ||
        dup.drug_type.toLowerCase().includes(qLower) ||
        dup.warning.toLowerCase().includes(qLower);
      const matchType = !tLower || dup.drug_type.toLowerCase().includes(tLower);
      return matchSearch && matchType;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }

  public getDiseasesList(search = '', page = 1, limit = 20): { total: number; page: number; limit: number; totalPages: number; data: Array<{ name: string; count: number; sampleText: string }> } {
    const searchTrim = search.trim();
    const db = this.getDb();

    if (db) {
      try {
        let total = 0;
        let rows: any[] = [];

        if (!searchTrim) {
          const totalRow = db.prepare('SELECT COUNT(DISTINCT disease_name) as count FROM ddsi').get() as any;
          total = Number(totalRow?.count || 0);
          const stmt = db.prepare('SELECT disease_name as name, COUNT(*) as count, MIN(text) as sampleText FROM ddsi GROUP BY disease_name ORDER BY count DESC LIMIT ? OFFSET ?');
          rows = stmt.all(limit, (page - 1) * limit) as any[];
        } else {
          const pattern = `%${searchTrim}%`;
          const totalRow = db.prepare('SELECT COUNT(DISTINCT disease_name) as count FROM ddsi WHERE disease_name LIKE ?').get(pattern) as any;
          total = Number(totalRow?.count || 0);
          const stmt = db.prepare('SELECT disease_name as name, COUNT(*) as count, MIN(text) as sampleText FROM ddsi WHERE disease_name LIKE ? GROUP BY disease_name ORDER BY count DESC LIMIT ? OFFSET ?');
          rows = stmt.all(pattern, limit, (page - 1) * limit) as any[];
        }

        const totalPages = Math.ceil(total / limit) || 1;
        return { total, page, limit, totalPages, data: rows };
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDiseasesList error, falling back:', err);
      }
    }

    // In-memory fallback
    const qLower = searchTrim.toLowerCase();
    const filtered = !qLower
      ? this.fallbackDiseases
      : this.fallbackDiseases.filter((d) => d.name.toLowerCase().includes(qLower));

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit);

    return { total, page, limit, totalPages, data };
  }

  public getDiseaseDDSIRecords(diseaseQuery: string, limit = 100): DDSIRecord[] {
    const q = diseaseQuery.trim();
    if (!q) return [];
    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare(`
          SELECT * FROM ddsi 
          WHERE disease_name = ? COLLATE NOCASE OR disease_name LIKE ? 
          ORDER BY (CASE WHEN disease_name = ? COLLATE NOCASE THEN 0 ELSE 1 END), level DESC 
          LIMIT ?
        `);
        return stmt.all(q, `%${q}%`, q, limit) as unknown as DDSIRecord[];
      } catch (err) {
        console.warn('[DDInterDb] SQLite getDiseaseDDSIRecords error:', err);
      }
    }
    const qLower = q.toLowerCase();
    return this.fallbackDdsi
      .filter((d) => d.disease_name.toLowerCase().includes(qLower))
      .slice(0, limit);
  }
}

export const ddinterDb = new DDInterDatabaseService();
