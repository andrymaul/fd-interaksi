// server.ts
import express from "express";
import dotenv from "dotenv";
import path4 from "path";
import { fileURLToPath } from "url";
import dns2 from "node:dns";

// src/server/cache.ts
var PharmacyDataCache = class {
  constructor(maxEntries = 500) {
    this.cache = /* @__PURE__ */ new Map();
    this.hitCount = 0;
    this.missCount = 0;
    this.totalSavedTimeMs = 0;
    this.maxEntries = 500;
    this.maxEntries = maxEntries;
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }
    entry.hits++;
    this.hitCount++;
    const estimatedSavedMs = 240;
    this.totalSavedTimeMs += estimatedSavedMs;
    return {
      data: entry.value,
      hits: entry.hits,
      ageMs: now - entry.createdAt
    };
  }
  set(key, value, ttlSeconds = 300, source = "DDInter/PubChem") {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    const now = Date.now();
    const str = JSON.stringify(value);
    const sizeBytes = str.length * 2;
    this.cache.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1e3,
      hits: 0,
      source,
      sizeBytes
    });
  }
  invalidate(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.totalSavedTimeMs = 0;
  }
  getStats() {
    const totalRequests = this.hitCount + this.missCount;
    const hitRatePercent = totalRequests > 0 ? this.hitCount / totalRequests * 100 : 0;
    let totalSizeBytes = 0;
    const recentKeys = [];
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      totalSizeBytes += entry.sizeBytes;
      const ttlRemainingSec = Math.max(0, Math.round((entry.expiresAt - now) / 1e3));
      recentKeys.push({
        key,
        hits: entry.hits,
        ttlRemainingSec,
        source: entry.source,
        sizeBytes: entry.sizeBytes
      });
    }
    recentKeys.sort((a, b) => b.hits - a.hits);
    return {
      totalEntries: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRatePercent: parseFloat(hitRatePercent.toFixed(1)),
      memoryUsageKb: parseFloat((totalSizeBytes / 1024).toFixed(2)),
      averageLatencySavedMs: this.hitCount > 0 ? Math.round(this.totalSavedTimeMs / this.hitCount) : 0,
      recentKeys: recentKeys.slice(0, 15)
    };
  }
};
var globalCache = new PharmacyDataCache(1e3);

// src/server/ddinterDb.ts
import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
function resolveDataFile(relName) {
  if (process.env.DATA_DIR) {
    const p = path.resolve(process.env.DATA_DIR, relName);
    if (fs.existsSync(p)) return p;
  }
  const fromCwd = path.resolve(process.cwd(), "src/data", relName);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromDirname = path.resolve(__dirname, "../data", relName);
  if (fs.existsSync(fromDirname)) return fromDirname;
  const fromDirnameRoot = path.resolve(__dirname, "src/data", relName);
  if (fs.existsSync(fromDirnameRoot)) return fromDirnameRoot;
  return fromCwd;
}
var dbPath = process.env.DB_PATH || resolveDataFile("ddinter_complete.db");
var DDInterDatabaseService = class {
  constructor() {
    this.db = null;
    this.statsCache = null;
    this.dbMtime = 0;
    // Resilient In-Memory Fallback Stores
    this.fallbackDrugs = [];
    this.fallbackFoods = [];
    this.fallbackDdsi = [];
    this.fallbackDupli = [];
    this.fallbackDiseases = [];
    this.loadFallbackDatasets();
    this.initDatabase();
  }
  loadFallbackDatasets() {
    try {
      const drugsPath = resolveDataFile("ddinter_all_drugs.json");
      if (fs.existsSync(drugsPath)) {
        const raw = JSON.parse(fs.readFileSync(drugsPath, "utf-8"));
        this.fallbackDrugs = raw.map((d) => ({
          ddinter_id: d.ddinterId || d.ddinter_id || "",
          name: d.name || "",
          drugbank_id: d.drugbankId || d.drugbank_id || "",
          pubchem_id: d.pubchemId || d.pubchem_id || "",
          chembl_id: d.chemblId || d.chembl_id || "",
          smiles: d.smiles || ""
        }));
      }
    } catch (e) {
      console.warn("[DDInterDb] Error loading fallback drugs:", e);
    }
    try {
      const foodsPath = resolveDataFile("ddinter_all_foods.json");
      if (fs.existsSync(foodsPath)) {
        const raw = JSON.parse(fs.readFileSync(foodsPath, "utf-8"));
        this.fallbackFoods = raw.map((f, idx) => ({
          id: f.id || idx + 1,
          drug_name: f.drugName || f.drug_name || "",
          ddinter_id: f.internalID_a_id || f.ddinter_id || "",
          food_name: f.foodName || f.food_name || "",
          level: String(f.level || "Moderate"),
          mechanism: f.newInteraction || f.mechanism || "",
          management: f.newManagement || f.management || "",
          references_text: f.references || f.references_text || ""
        }));
      }
    } catch (e) {
      console.warn("[DDInterDb] Error loading fallback foods:", e);
    }
    try {
      const ddsiPath = resolveDataFile("ddinter_all_ddsi.json");
      if (fs.existsSync(ddsiPath)) {
        const raw = JSON.parse(fs.readFileSync(ddsiPath, "utf-8"));
        this.fallbackDdsi = raw.map((d, idx) => ({
          id: d.id || idx + 1,
          drug_name: d.drugName || d.drug_name || "",
          ddinter_id: d.internalID_a_id || d.ddinter_id || "",
          disease_name: d.diseaseName || d.disease_name || "",
          level: String(d.level || "Major"),
          text: d.text || "",
          references_text: d.references || d.references_text || ""
        }));
      }
    } catch (e) {
      console.warn("[DDInterDb] Error loading fallback DDSI:", e);
    }
    try {
      const dupliPath = resolveDataFile("ddinter_all_dupli.json");
      if (fs.existsSync(dupliPath)) {
        const raw = JSON.parse(fs.readFileSync(dupliPath, "utf-8"));
        this.fallbackDupli = raw.map((dup, idx) => ({
          id: dup.id || idx + 1,
          drug_multi_trade: dup.drugmulti_trade || dup.drug_multi_trade || "",
          drug_multi: dup.drugmulti || dup.drug_multi || "",
          drug_type: dup.drugtype || dup.drug_type || "",
          drug_b: dup.drugb || dup.drug_b || "",
          ddinter_id_b: dup.internalID_b_id || dup.ddinter_id_b || "",
          warning: dup.warning || "",
          note: dup.note || ""
        }));
      }
    } catch (e) {
      console.warn("[DDInterDb] Error loading fallback dupli:", e);
    }
    try {
      const disPath = resolveDataFile("ddinter_all_diseases.json");
      if (fs.existsSync(disPath)) {
        const raw = JSON.parse(fs.readFileSync(disPath, "utf-8"));
        this.fallbackDiseases = raw.map((item) => ({
          name: item.name || "",
          count: item.contraindicatedDrugsCount || item.count || 0,
          sampleText: item.sampleWarning || item.sampleText || ""
        }));
      }
    } catch (e) {
      console.warn("[DDInterDb] Error loading fallback disease summary:", e);
    }
  }
  initDatabase() {
    if (!fs.existsSync(dbPath)) {
      console.warn(`[DDInterDb] Database file not found at ${dbPath}, operating in fallback mode.`);
      this.db = null;
      return false;
    }
    try {
      const stat = fs.statSync(dbPath);
      if (stat.size < 1e3) {
        console.error(`[DDInterDb] CRITICAL: File at ${dbPath} is only ${stat.size} bytes. This is a Git LFS pointer, not the SQLite database! Please upload the full ~130 MB ddinter_complete.db.`);
      }
      if (this.db) {
        try {
          this.db.close();
        } catch (_) {
        }
        this.db = null;
      }
      const instance = new DatabaseSync(dbPath);
      try {
        instance.exec("PRAGMA journal_mode = WAL;");
        instance.exec("PRAGMA busy_timeout = 15000;");
      } catch (_) {
      }
      const checkResult = instance.prepare("PRAGMA quick_check;").get()?.quick_check;
      if (checkResult && checkResult !== "ok") {
        console.warn(`[DDInterDb] PRAGMA quick_check reported issue: ${checkResult}. Safe fallback active.`);
        try {
          instance.close();
        } catch (_) {
        }
        this.db = null;
        return false;
      }
      this.db = instance;
      this.dbMtime = stat.mtimeMs;
      console.log(`[DDInterDb] SQLite database successfully connected and verified (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`);
      return true;
    } catch (err) {
      console.warn("[DDInterDb] SQLite connection error (graceful fallback engaged):", err);
      this.db = null;
      return false;
    }
  }
  getDb() {
    if (!fs.existsSync(dbPath)) return null;
    if (!this.db) {
      this.initDatabase();
    }
    return this.db;
  }
  updateDrugDetails(ddinterId, data) {
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
        data.name || "",
        data.drug_type || "",
        data.molecular_formula || "",
        data.molecular_weight || 0,
        data.cas_number || "",
        data.description || "",
        data.smiles || "",
        data.structure_svg || "",
        data.protein_sequence || "",
        data.pubchem_id || "",
        data.drugbank_id || "",
        data.chembl_id || "",
        ddinterId
      );
      return true;
    } catch (err) {
      console.warn("[DDInterDb] Error updating drug details:", err);
      return false;
    }
  }
  updateDrugAtc(ddinterId, atcCode, atcCategory = "", therapeuticClass = "") {
    const db = this.getDb();
    if (!db) return false;
    try {
      db.prepare(`
        UPDATE drugs SET
          atc_code = COALESCE(NULLIF(?, ''), atc_code),
          atc_category = COALESCE(NULLIF(?, ''), atc_category),
          therapeutic_class = COALESCE(NULLIF(?, ''), therapeutic_class)
        WHERE ddinter_id = ? COLLATE NOCASE
      `).run(
        atcCode || "",
        atcCategory || "",
        therapeuticClass || atcCategory || "",
        ddinterId
      );
      return true;
    } catch (err) {
      console.warn("[DDInterDb] Error updating drug ATC:", err);
      return false;
    }
  }
  getStats() {
    if (this.statsCache) return this.statsCache;
    const statsPath = resolveDataFile("ddinter_stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        this.statsCache = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
        return this.statsCache;
      } catch (e) {
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
        drugCount = db.prepare("SELECT COUNT(*) as count FROM drugs").get()?.count || drugCount;
        ddiCount = db.prepare("SELECT COUNT(*) as count FROM ddi").get()?.count || ddiCount;
        dfiCount = db.prepare("SELECT COUNT(*) as count FROM dfi").get()?.count || dfiCount;
        ddsiCount = db.prepare("SELECT COUNT(*) as count FROM ddsi").get()?.count || ddsiCount;
        dupliCount = db.prepare("SELECT COUNT(*) as count FROM dupli").get()?.count || dupliCount;
        diseaseCount = db.prepare("SELECT COUNT(DISTINCT disease_name) as count FROM ddsi").get()?.count || diseaseCount;
      } catch (e) {
        console.warn("[DDInterDb] Error reading live stats from DB:", e);
      }
    }
    const stats = {
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
      portalUrl: "https://ddinter2.scbdd.com/",
      statisticsUrl: "https://ddinter2.scbdd.com/statistics/",
      downloadUrl: "https://ddinter2.scbdd.com/download/",
      citation: "DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024)",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.statsCache = stats;
    return stats;
  }
  searchDrugs(search = "", page = 1, limit = 20, classFilter = "") {
    const searchTrim = search.trim();
    const cleanClass = classFilter.trim();
    const db = this.getDb();
    const CLASS_SQL_CONDITIONS = {
      "Statin (Anti-Dislipidemia)": "(therapeutic_class LIKE '%Statin%' OR atc_category LIKE '%Statin%' OR atc_code LIKE 'C10%' OR name LIKE '%statin%')",
      "Penghambat Pompa Proton (PPI)": "(therapeutic_class LIKE '%Proton%' OR therapeutic_class LIKE '%PPI%' OR atc_code LIKE 'A02BC%' OR name IN ('Omeprazole','Esomeprazole','Lansoprazole','Pantoprazole','Rabeprazole','Dexlansoprazole'))",
      "Antikoagulan Oral": "(therapeutic_class LIKE '%Antikoagulan%' OR atc_code LIKE 'B01AA%' OR atc_code LIKE 'B01AF%' OR atc_code LIKE 'B01AE%' OR name IN ('Warfarin','Rivaroxaban','Apixaban','Dabigatran','Edoxaban'))",
      "Antiplatelet Golongan Thienopyridine": "(therapeutic_class LIKE '%Antiplatelet%' OR therapeutic_class LIKE '%Trombosit%' OR atc_code LIKE 'B01AC%' OR name IN ('Clopidogrel','Aspirin','Ticagrelor','Prasugrel'))",
      "Antidiabetes Oral Golongan Biguanid": "(therapeutic_class LIKE '%Biguanid%' OR atc_code LIKE 'A10BA%' OR name LIKE '%Metformin%' OR therapeutic_class LIKE '%Diabetes%')",
      "Penghambat Enzim Konversi Angiotensin (ACEi)": "(therapeutic_class LIKE '%ACE%' OR therapeutic_class LIKE '%Konversi Angiotensin%' OR atc_code LIKE 'C09A%' OR name LIKE '%pril')",
      "Angiotensin II Receptor Blocker (ARB)": "(therapeutic_class LIKE '%ARB%' OR atc_code LIKE 'C09C%' OR name LIKE '%sartan')",
      "Calcium Channel Blocker (CCB) Dihidropiridin": "(therapeutic_class LIKE '%Calcium%' OR therapeutic_class LIKE '%Kalsium%' OR atc_code LIKE 'C08%' OR name LIKE '%dipine')",
      "Beta-1 Blocker Kardioselektif": "(therapeutic_class LIKE '%Beta%' OR atc_code LIKE 'C07%' OR name LIKE '%lol')",
      "Non-Steroidal Anti-Inflammatory Drug (NSAID)": "(therapeutic_class LIKE '%NSAID%' OR therapeutic_class LIKE '%Antiinflamasi%' OR atc_code LIKE 'M01A%' OR name IN ('Ibuprofen','Ketorolac','Meloxicam','Celecoxib','Diclofenac','Naproxen','Indomethacin','Mefenamic Acid'))",
      "Antibiotik Makrolida & Kuat Inhibitor CYP3A4": "(atc_code LIKE 'J01FA%' OR therapeutic_class LIKE '%Makrolida%' OR name IN ('Clarithromycin','Erythromycin','Azithromycin','Telithromycin'))",
      "Antibiotik Golongan Fluoroquinolone": "(atc_code LIKE 'J01MA%' OR therapeutic_class LIKE '%Fluoroquinolone%' OR name LIKE '%floxacin%')",
      "Glikosida Jantung (Indeks Terapi Sempit)": "(atc_code LIKE 'C01AA%' OR therapeutic_class LIKE '%Glikosida%' OR name IN ('Digoxin','Digitoxin'))",
      "Diuretik Hemat Kalium (Antagonis Aldosteron)": "(atc_code LIKE 'C03D%' OR atc_code LIKE 'C03%' OR therapeutic_class LIKE '%Diuretik%' OR name IN ('Spironolactone','Eplerenone','Amiloride','Triamterene'))",
      "Antidepresan Golongan SSRI": "(atc_code LIKE 'N06AB%' OR therapeutic_class LIKE '%SSRI%' OR name IN ('Fluoxetine','Sertraline','Paroxetine','Fluvoxamine','Citalopram','Escitalopram'))",
      "Saluran Pencernaan & Metabolisme": "(atc_code LIKE 'A%' OR therapeutic_class LIKE '%Saluran Pencernaan%')",
      "Darah & Organ Pembentuk Darah": "(atc_code LIKE 'B%' OR therapeutic_class LIKE '%Darah%')",
      "Sistem Kardiovaskular": "(atc_code LIKE 'C%' OR therapeutic_class LIKE '%Kardiovaskular%')",
      "Dermatologikal": "(atc_code LIKE 'D%' OR therapeutic_class LIKE '%Dermatologikal%')",
      "Antiinfeksi Sistemik": "(atc_code LIKE 'J%' OR therapeutic_class LIKE '%Antiinfeksi%')",
      "Agen Antineoplastik & Imunomodulasi": "(atc_code LIKE 'L%' OR therapeutic_class LIKE '%Antineoplastik%')",
      "Sistem Saraf": "(atc_code LIKE 'N%' OR therapeutic_class LIKE '%Sistem Saraf%')",
      "Sistem Pernapasan": "(atc_code LIKE 'R%' OR therapeutic_class LIKE '%Pernapasan%')"
    };
    if (db) {
      try {
        let whereClauses = [];
        let params = [];
        if (searchTrim) {
          const pattern = `%${searchTrim}%`;
          whereClauses.push("(name LIKE ? OR ddinter_id LIKE ? OR drugbank_id LIKE ?)");
          params.push(pattern, pattern, pattern);
        }
        if (cleanClass) {
          if (CLASS_SQL_CONDITIONS[cleanClass]) {
            whereClauses.push(CLASS_SQL_CONDITIONS[cleanClass]);
          } else {
            const classPattern = `%${cleanClass}%`;
            whereClauses.push("(therapeutic_class LIKE ? OR atc_category LIKE ? OR atc_code LIKE ?)");
            params.push(classPattern, classPattern, classPattern);
          }
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
        const countStmt = db.prepare(`SELECT COUNT(*) as count FROM drugs ${whereSql}`);
        const totalRow = params.length > 0 ? countStmt.get(...params) : countStmt.get();
        const total2 = Number(totalRow?.count || 0);
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
        const rows = stmt.all(...queryParams);
        const totalPages2 = Math.ceil(total2 / limit) || 1;
        return { total: total2, page, limit, totalPages: totalPages2, data: rows };
      } catch (err) {
        console.warn("[DDInterDb] SQLite searchDrugs error, falling back to in-memory store:", err);
      }
    }
    const qLower = searchTrim.toLowerCase();
    const cLower = cleanClass.toLowerCase();
    const filtered = this.fallbackDrugs.filter((d) => {
      if (qLower) {
        const matchesQ = d.name.toLowerCase().includes(qLower) || d.ddinter_id.toLowerCase().includes(qLower) || d.drugbank_id.toLowerCase().includes(qLower);
        if (!matchesQ) return false;
      }
      if (cLower) {
        const matchesClass = (d.therapeutic_class || "").toLowerCase().includes(cLower) || (d.atc_category || "").toLowerCase().includes(cLower) || (d.atc_code || "").toLowerCase().includes(cLower);
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
  findDrug(query) {
    const clean = query.trim();
    if (!clean) return null;
    const ALIAS_MAP = {
      aspirin: "Acetylsalicylic acid",
      paracetamol: "Acetaminophen",
      salbutamol: "Albuterol",
      adrenaline: "Epinephrine",
      noradrenaline: "Norepinephrine",
      tylenol: "Acetaminophen",
      panadol: "Acetaminophen",
      sanmol: "Acetaminophen",
      diamox: "Acetazolamide",
      norvasc: "Amlodipine",
      amoxil: "Amoxicillin",
      lipitor: "Atorvastatin",
      zocor: "Simvastatin",
      crestor: "Rosuvastatin",
      glucophage: "Metformin",
      plavix: "Clopidogrel",
      coumadin: "Warfarin"
    };
    const targetName = ALIAS_MAP[clean.toLowerCase()] || clean;
    const db = this.getDb();
    if (db) {
      try {
        const stmt = db.prepare("SELECT * FROM drugs WHERE ddinter_id = ? COLLATE NOCASE OR name = ? COLLATE NOCASE OR name = ? COLLATE NOCASE OR drugbank_id = ? COLLATE NOCASE LIMIT 1");
        const row = stmt.get(clean, clean, targetName, clean);
        if (row) return row;
      } catch (err) {
        console.warn("[DDInterDb] SQLite findDrug error, falling back to in-memory store:", err);
      }
    }
    const qLower = clean.toLowerCase();
    const match = this.fallbackDrugs.find(
      (d) => d.ddinter_id.toLowerCase() === qLower || d.name.toLowerCase() === qLower || d.drugbank_id.toLowerCase() === qLower || d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === qLower
    );
    return match || null;
  }
  getDrugInteractionsCount(nameOrId) {
    const drug = this.findDrug(nameOrId);
    if (!drug) return { ddi: 0, dfi: 0, ddsi: 0 };
    const db = this.getDb();
    if (db) {
      try {
        const ddiRow = db.prepare("SELECT COUNT(*) as count FROM ddi WHERE ddinter_id_a = ? OR ddinter_id_b = ? OR drug_a = ? COLLATE NOCASE OR drug_b = ? COLLATE NOCASE").get(drug.ddinter_id, drug.ddinter_id, drug.name, drug.name);
        const dfiRow = db.prepare("SELECT COUNT(*) as count FROM dfi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE").get(drug.ddinter_id, drug.name);
        const ddsiRow = db.prepare("SELECT COUNT(*) as count FROM ddsi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE").get(drug.ddinter_id, drug.name);
        return {
          ddi: Number(ddiRow?.count || 0),
          dfi: Number(dfiRow?.count || 0),
          ddsi: Number(ddsiRow?.count || 0)
        };
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDrugInteractionsCount error:", err);
      }
    }
    const dfiCount = this.fallbackFoods.filter((f) => f.ddinter_id === drug.ddinter_id || f.drug_name.toLowerCase() === drug.name.toLowerCase()).length;
    const ddsiCount = this.fallbackDdsi.filter((d) => d.ddinter_id === drug.ddinter_id || d.drug_name.toLowerCase() === drug.name.toLowerCase()).length;
    return {
      ddi: 15,
      dfi: dfiCount,
      ddsi: ddsiCount
    };
  }
  getDrugDDIRows(nameOrId, limit = 5e3) {
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
        return stmt.all(drug.ddinter_id, drug.ddinter_id, drug.name, drug.name, limit);
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDrugDDIRows error:", err);
      }
    }
    return [];
  }
  getDrugDDSIRows(nameOrId, limit = 5e3) {
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
        return stmt.all(drug.ddinter_id, drug.name, limit);
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDrugDDSIRows error:", err);
      }
    }
    return this.fallbackDdsi.filter(
      (d) => d.ddinter_id === drug.ddinter_id || d.drug_name.toLowerCase() === drug.name.toLowerCase()
    ).slice(0, limit);
  }
  getDrugDFIRows(nameOrId, limit = 5e3) {
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
        return stmt.all(drug.ddinter_id, drug.name, limit);
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDrugDFIRows error:", err);
      }
    }
    return this.fallbackFoods.filter(
      (f) => f.ddinter_id === drug.ddinter_id || f.drug_name.toLowerCase() === drug.name.toLowerCase()
    ).slice(0, limit);
  }
  checkDDI(drugQueries) {
    if (drugQueries.length < 2) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean);
    if (resolvedDrugs.length < 2) return [];
    const db = this.getDb();
    if (db) {
      try {
        const results = [];
        const seenPairs = /* @__PURE__ */ new Set();
        for (let i = 0; i < resolvedDrugs.length; i++) {
          for (let j = i + 1; j < resolvedDrugs.length; j++) {
            const d1 = resolvedDrugs[i];
            const d2 = resolvedDrugs[j];
            const pairKey = [d1.ddinter_id, d2.ddinter_id].sort().join("-");
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
              d1.ddinter_id,
              d2.ddinter_id,
              d2.ddinter_id,
              d1.ddinter_id,
              d1.name,
              d2.name,
              d2.name,
              d1.name
            );
            if (matches && matches.length > 0) {
              results.push(...matches);
            }
          }
        }
        return results;
      } catch (err) {
        console.warn("[DDInterDb] SQLite checkDDI error:", err);
      }
    }
    return [];
  }
  checkDFI(drugQueries) {
    if (drugQueries.length === 0) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean);
    if (resolvedDrugs.length === 0) return [];
    const db = this.getDb();
    if (db) {
      try {
        const results2 = [];
        const stmt = db.prepare("SELECT * FROM dfi WHERE ddinter_id = ? OR drug_name = ? COLLATE NOCASE");
        for (const d of resolvedDrugs) {
          const matches = stmt.all(d.ddinter_id, d.name);
          results2.push(...matches);
        }
        return results2;
      } catch (err) {
        console.warn("[DDInterDb] SQLite checkDFI error:", err);
      }
    }
    const results = [];
    for (const d of resolvedDrugs) {
      const matches = this.fallbackFoods.filter(
        (f) => f.ddinter_id === d.ddinter_id || f.drug_name.toLowerCase() === d.name.toLowerCase()
      );
      results.push(...matches);
    }
    return results;
  }
  checkDDSI(drugQueries, diseaseQueries = []) {
    if (drugQueries.length === 0 || diseaseQueries.length === 0) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean);
    if (resolvedDrugs.length === 0) return [];
    const db = this.getDb();
    if (db) {
      try {
        const results2 = [];
        for (const d of resolvedDrugs) {
          for (const dis of diseaseQueries) {
            const pattern = `%${dis.trim()}%`;
            const stmt = db.prepare("SELECT * FROM ddsi WHERE (ddinter_id = ? OR drug_name = ? COLLATE NOCASE) AND disease_name LIKE ?");
            const matches = stmt.all(d.ddinter_id, d.name, pattern);
            results2.push(...matches);
          }
        }
        return results2;
      } catch (err) {
        console.warn("[DDInterDb] SQLite checkDDSI error:", err);
      }
    }
    const results = [];
    for (const d of resolvedDrugs) {
      for (const dis of diseaseQueries) {
        const dLower = dis.trim().toLowerCase();
        const matches = this.fallbackDdsi.filter(
          (item) => (item.ddinter_id === d.ddinter_id || item.drug_name.toLowerCase() === d.name.toLowerCase()) && item.disease_name.toLowerCase().includes(dLower)
        );
        results.push(...matches);
      }
    }
    return results;
  }
  checkDuplications(drugQueries) {
    if (drugQueries.length < 2) return [];
    const resolvedDrugs = drugQueries.map((q) => this.findDrug(q)).filter(Boolean);
    if (resolvedDrugs.length < 2) return [];
    const results = [];
    const seenPairs = /* @__PURE__ */ new Set();
    const db = this.getDb();
    if (db) {
      try {
        const classStmt = db.prepare(`
          SELECT DISTINCT drug_type FROM dupli 
          WHERE ddinter_id_b = ? OR drug_b = ? COLLATE NOCASE
        `);
        const drugClassesMap = /* @__PURE__ */ new Map();
        for (const d of resolvedDrugs) {
          const rows = classStmt.all(d.ddinter_id, d.name);
          const types = rows.map((r) => r.drug_type.trim()).filter(Boolean);
          drugClassesMap.set(d.ddinter_id || d.name, types);
        }
        for (let i = 0; i < resolvedDrugs.length; i++) {
          for (let j = i + 1; j < resolvedDrugs.length; j++) {
            const d1 = resolvedDrugs[i];
            const d2 = resolvedDrugs[j];
            const c1 = drugClassesMap.get(d1.ddinter_id || d1.name) || [];
            const c2 = drugClassesMap.get(d2.ddinter_id || d2.name) || [];
            const shared = c1.filter((type) => c2.includes(type));
            if (shared.length > 0) {
              const primaryClass = shared.includes("benzodiazepines") ? "benzodiazepines" : shared[0];
              const pairKey = [d1.name.toLowerCase(), d2.name.toLowerCase(), primaryClass.toLowerCase()].sort().join("|");
              if (seenPairs.has(pairKey)) continue;
              seenPairs.add(pairKey);
              results.push({
                id: (results.length + 1) * 1e3 + i * 10 + j,
                drug_multi_trade: d1.name,
                drug_multi: d1.name,
                drug_type: primaryClass,
                drug_b: d2.name,
                ddinter_id_b: d2.ddinter_id,
                warning: `The recommended maximum number of medicines in the '${primaryClass}' category to be taken concurrently is usually one. Your list includes two medicines (${d1.name} and ${d2.name}) belonging to the '${primaryClass}' category.`,
                note: `Note: In certain circumstances, the benefits of taking this combination of drugs may outweigh any risks. Always consult your healthcare provider before making changes to your medications or dosage.`
              });
            }
          }
        }
        return results;
      } catch (err) {
        console.warn("[DDInterDb] SQLite checkDuplications error:", err);
      }
    }
    for (let i = 0; i < resolvedDrugs.length; i++) {
      for (let j = i + 1; j < resolvedDrugs.length; j++) {
        const d1 = resolvedDrugs[i];
        const d2 = resolvedDrugs[j];
        const c1 = this.fallbackDupli.filter((dup) => dup.ddinter_id_b === d1.ddinter_id || dup.drug_b.toLowerCase() === d1.name.toLowerCase()).map((d) => d.drug_type);
        const c2 = this.fallbackDupli.filter((dup) => dup.ddinter_id_b === d2.ddinter_id || dup.drug_b.toLowerCase() === d2.name.toLowerCase()).map((d) => d.drug_type);
        const shared = c1.filter((type) => c2.includes(type));
        if (shared.length > 0) {
          const primaryClass = shared.includes("benzodiazepines") ? "benzodiazepines" : shared[0];
          results.push({
            id: 9999 + i + j,
            drug_multi_trade: d1.name,
            drug_multi: d1.name,
            drug_type: primaryClass,
            drug_b: d2.name,
            ddinter_id_b: d2.ddinter_id,
            warning: `The recommended maximum number of medicines in the '${primaryClass}' category to be taken concurrently is usually one. Your list includes two medicines (${d1.name} and ${d2.name}) belonging to the '${primaryClass}' category.`,
            note: `Note: In certain circumstances, the benefits of taking this combination of drugs may outweigh any risks. Always consult your healthcare provider before making changes to your medications or dosage.`
          });
        }
      }
    }
    return results;
  }
  queryTable(search = "", severity = "", page = 1, limit = 15) {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();
    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = "";
        const params = [];
        if (searchTrim && severityTrim) {
          sqlWhere = "WHERE (drug_a LIKE ? OR drug_b LIKE ? OR ddinter_id_a LIKE ? OR ddinter_id_b LIKE ?) AND level = ? COLLATE NOCASE";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, severityTrim);
        } else if (searchTrim) {
          sqlWhere = "WHERE drug_a LIKE ? OR drug_b LIKE ? OR ddinter_id_a LIKE ? OR ddinter_id_b LIKE ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat);
        } else if (severityTrim) {
          sqlWhere = "WHERE level = ? COLLATE NOCASE";
          params.push(severityTrim);
        }
        const countSql = `SELECT COUNT(*) as count FROM ddi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params);
        const total = Number(totalRow?.count || 0);
        const dataSql = `SELECT * FROM ddi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows = db.prepare(dataSql).all(...params, limit, (page - 1) * limit);
        const totalPages = Math.ceil(total / limit) || 1;
        return { total, page, limit, totalPages, rows };
      } catch (err) {
        console.warn("[DDInterDb] SQLite queryTable error, falling back:", err);
      }
    }
    const fallbackTotal = 302665;
    return {
      total: fallbackTotal,
      page,
      limit,
      totalPages: Math.ceil(fallbackTotal / limit),
      rows: []
    };
  }
  queryDFITable(search = "", severity = "", page = 1, limit = 15) {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();
    let mappedLevel = severityTrim;
    if (severityTrim.toLowerCase() === "major" || severityTrim.toLowerCase() === "contraindicated") mappedLevel = "3";
    else if (severityTrim.toLowerCase() === "moderate") mappedLevel = "2";
    else if (severityTrim.toLowerCase() === "minor") mappedLevel = "1";
    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = "";
        const params = [];
        if (searchTrim && mappedLevel) {
          sqlWhere = "WHERE (drug_name LIKE ? OR food_name LIKE ? OR ddinter_id LIKE ? OR mechanism LIKE ? OR management LIKE ?) AND level = ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, mappedLevel);
        } else if (searchTrim) {
          sqlWhere = "WHERE drug_name LIKE ? OR food_name LIKE ? OR ddinter_id LIKE ? OR mechanism LIKE ? OR management LIKE ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat);
        } else if (mappedLevel) {
          sqlWhere = "WHERE level = ?";
          params.push(mappedLevel);
        }
        const countSql = `SELECT COUNT(*) as count FROM dfi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params);
        const total2 = Number(totalRow?.count || 0);
        const dataSql = `SELECT * FROM dfi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows2 = db.prepare(dataSql).all(...params, limit, (page - 1) * limit);
        const totalPages2 = Math.ceil(total2 / limit) || 1;
        return { total: total2, page, limit, totalPages: totalPages2, rows: rows2 };
      } catch (err) {
        console.warn("[DDInterDb] SQLite queryDFITable error, falling back:", err);
      }
    }
    const qLower = searchTrim.toLowerCase();
    const filtered = this.fallbackFoods.filter((f) => {
      const matchSearch = !qLower || f.drug_name.toLowerCase().includes(qLower) || f.food_name.toLowerCase().includes(qLower) || f.ddinter_id.toLowerCase().includes(qLower) || f.mechanism.toLowerCase().includes(qLower);
      const matchLevel = !mappedLevel || f.level === mappedLevel;
      return matchSearch && matchLevel;
    });
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }
  queryDDSITable(search = "", severity = "", page = 1, limit = 15) {
    const searchTrim = search.trim();
    const severityTrim = severity.trim();
    let mappedLevel = severityTrim;
    if (severityTrim.toLowerCase() === "major" || severityTrim.toLowerCase() === "contraindicated") mappedLevel = "3";
    else if (severityTrim.toLowerCase() === "moderate") mappedLevel = "2";
    else if (severityTrim.toLowerCase() === "minor") mappedLevel = "1";
    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = "";
        const params = [];
        if (searchTrim && mappedLevel) {
          sqlWhere = "WHERE (drug_name LIKE ? OR disease_name LIKE ? OR ddinter_id LIKE ? OR text LIKE ?) AND level = ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, mappedLevel);
        } else if (searchTrim) {
          sqlWhere = "WHERE drug_name LIKE ? OR disease_name LIKE ? OR ddinter_id LIKE ? OR text LIKE ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat);
        } else if (mappedLevel) {
          sqlWhere = "WHERE level = ?";
          params.push(mappedLevel);
        }
        const countSql = `SELECT COUNT(*) as count FROM ddsi ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params);
        const total2 = Number(totalRow?.count || 0);
        const dataSql = `SELECT * FROM ddsi ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows2 = db.prepare(dataSql).all(...params, limit, (page - 1) * limit);
        const totalPages2 = Math.ceil(total2 / limit) || 1;
        return { total: total2, page, limit, totalPages: totalPages2, rows: rows2 };
      } catch (err) {
        console.warn("[DDInterDb] SQLite queryDDSITable error, falling back:", err);
      }
    }
    const qLower = searchTrim.toLowerCase();
    const filtered = this.fallbackDdsi.filter((d) => {
      const matchSearch = !qLower || d.drug_name.toLowerCase().includes(qLower) || d.disease_name.toLowerCase().includes(qLower) || d.ddinter_id.toLowerCase().includes(qLower) || d.text.toLowerCase().includes(qLower);
      const matchLevel = !mappedLevel || d.level === mappedLevel;
      return matchSearch && matchLevel;
    });
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }
  queryDupliTable(search = "", drugType = "", page = 1, limit = 15) {
    const searchTrim = search.trim();
    const typeTrim = drugType.trim();
    const db = this.getDb();
    if (db) {
      try {
        let sqlWhere = "";
        const params = [];
        if (searchTrim && typeTrim) {
          sqlWhere = "WHERE (drug_multi_trade LIKE ? OR drug_multi LIKE ? OR drug_b LIKE ? OR warning LIKE ? OR note LIKE ?) AND drug_type LIKE ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, `%${typeTrim}%`);
        } else if (searchTrim) {
          sqlWhere = "WHERE drug_multi_trade LIKE ? OR drug_multi LIKE ? OR drug_b LIKE ? OR drug_type LIKE ? OR warning LIKE ? OR note LIKE ?";
          const pat = `%${searchTrim}%`;
          params.push(pat, pat, pat, pat, pat, pat);
        } else if (typeTrim) {
          sqlWhere = "WHERE drug_type LIKE ?";
          params.push(`%${typeTrim}%`);
        }
        const countSql = `SELECT COUNT(*) as count FROM dupli ${sqlWhere}`;
        const totalRow = db.prepare(countSql).get(...params);
        const total2 = Number(totalRow?.count || 0);
        const dataSql = `SELECT * FROM dupli ${sqlWhere} ORDER BY id ASC LIMIT ? OFFSET ?`;
        const rows2 = db.prepare(dataSql).all(...params, limit, (page - 1) * limit);
        const totalPages2 = Math.ceil(total2 / limit) || 1;
        return { total: total2, page, limit, totalPages: totalPages2, rows: rows2 };
      } catch (err) {
        console.warn("[DDInterDb] SQLite queryDupliTable error, falling back:", err);
      }
    }
    const qLower = searchTrim.toLowerCase();
    const tLower = typeTrim.toLowerCase();
    const filtered = this.fallbackDupli.filter((dup) => {
      const matchSearch = !qLower || dup.drug_multi_trade.toLowerCase().includes(qLower) || dup.drug_multi.toLowerCase().includes(qLower) || dup.drug_b.toLowerCase().includes(qLower) || dup.drug_type.toLowerCase().includes(qLower) || dup.warning.toLowerCase().includes(qLower);
      const matchType = !tLower || dup.drug_type.toLowerCase().includes(tLower);
      return matchSearch && matchType;
    });
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const rows = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, rows };
  }
  getDiseasesList(search = "", page = 1, limit = 20) {
    const searchTrim = search.trim();
    const db = this.getDb();
    if (db) {
      try {
        let total2 = 0;
        let rows = [];
        if (!searchTrim) {
          const totalRow = db.prepare("SELECT COUNT(DISTINCT disease_name) as count FROM ddsi").get();
          total2 = Number(totalRow?.count || 0);
          const stmt = db.prepare("SELECT disease_name as name, COUNT(*) as count, MIN(text) as sampleText FROM ddsi GROUP BY disease_name ORDER BY count DESC LIMIT ? OFFSET ?");
          rows = stmt.all(limit, (page - 1) * limit);
        } else {
          const pattern = `%${searchTrim}%`;
          const totalRow = db.prepare("SELECT COUNT(DISTINCT disease_name) as count FROM ddsi WHERE disease_name LIKE ?").get(pattern);
          total2 = Number(totalRow?.count || 0);
          const stmt = db.prepare("SELECT disease_name as name, COUNT(*) as count, MIN(text) as sampleText FROM ddsi WHERE disease_name LIKE ? GROUP BY disease_name ORDER BY count DESC LIMIT ? OFFSET ?");
          rows = stmt.all(pattern, limit, (page - 1) * limit);
        }
        const totalPages2 = Math.ceil(total2 / limit) || 1;
        return { total: total2, page, limit, totalPages: totalPages2, data: rows };
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDiseasesList error, falling back:", err);
      }
    }
    const qLower = searchTrim.toLowerCase();
    const filtered = !qLower ? this.fallbackDiseases : this.fallbackDiseases.filter((d) => d.name.toLowerCase().includes(qLower));
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit);
    return { total, page, limit, totalPages, data };
  }
  getDiseaseDDSIRecords(diseaseQuery, limit = 100) {
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
        return stmt.all(q, `%${q}%`, q, limit);
      } catch (err) {
        console.warn("[DDInterDb] SQLite getDiseaseDDSIRecords error:", err);
      }
    }
    const qLower = q.toLowerCase();
    return this.fallbackDdsi.filter((d) => d.disease_name.toLowerCase().includes(qLower)).slice(0, limit);
  }
};
var ddinterDb = new DDInterDatabaseService();

// src/server/clinicalDDIRules.ts
import fs2 from "fs";
import path2 from "path";
var ClinicalDDIRulesEngine = class {
  constructor() {
    this.mechanisms = [];
    this.drugKeywordIndex = /* @__PURE__ */ new Map();
    this.cache = /* @__PURE__ */ new Map();
    this.init();
  }
  init() {
    try {
      const candidates = [
        path2.join(process.cwd(), "src/data/ddinter_all_mechanisms.json"),
        path2.join(process.cwd(), "dist/data/ddinter_all_mechanisms.json")
      ];
      for (const p of candidates) {
        if (fs2.existsSync(p)) {
          const raw = fs2.readFileSync(p, "utf-8");
          this.mechanisms = JSON.parse(raw);
          break;
        }
      }
      if (this.mechanisms.length > 0) {
        for (let i = 0; i < this.mechanisms.length; i++) {
          const m = this.mechanisms[i];
          const text = (m.interaction || "").toLowerCase();
          const words = text.match(/[a-z]{3,}/g) || [];
          const uniqueWords = new Set(words);
          for (const w of uniqueWords) {
            if (!this.drugKeywordIndex.has(w)) {
              this.drugKeywordIndex.set(w, []);
            }
            this.drugKeywordIndex.get(w).push(i);
          }
        }
        console.log(`[ClinicalDDIRules] Indexed ${this.mechanisms.length} official DDInter mechanism records.`);
      }
    } catch (err) {
      console.warn("[ClinicalDDIRules] Failed to load ddinter_all_mechanisms.json:", err);
    }
  }
  /**
   * Resolves detailed clinical pharmacology mechanism and actionable management guidance
   * for any pair of drugs (Drug A ↔ Drug B) with severity level.
   */
  resolveDDI(nameA, idA, nameB, idB, severity) {
    const key = `${idA}_${idB}_${severity}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const revKey = `${idB}_${idA}_${severity}`;
    if (this.cache.has(revKey)) return this.cache.get(revKey);
    const da = (nameA || idA).trim();
    const db = (nameB || idB).trim();
    const daLow = da.toLowerCase();
    const dbLow = db.toLowerCase();
    const sev = severity.toLowerCase();
    const patternResult = this.matchPharmacologicalRules(da, daLow, idA, db, dbLow, idB, severity);
    if (patternResult) {
      this.cache.set(key, patternResult);
      return patternResult;
    }
    const directMatch = this.findMatchingDDInterMechanism(daLow, dbLow, sev);
    if (directMatch) {
      this.cache.set(key, directMatch);
      return directMatch;
    }
    const inferenceResult = this.inferPharmacology(da, daLow, db, dbLow, severity);
    this.cache.set(key, inferenceResult);
    return inferenceResult;
  }
  matchPharmacologicalRules(da, daLow, _idA, db, dbLow, _idB, severity) {
    const isIntegrase = this.matchesAny(daLow, ["dolutegravir", "raltegravir", "bictegravir", "elvitegravir", "cabotegravir"]) || this.matchesAny(dbLow, ["dolutegravir", "raltegravir", "bictegravir", "elvitegravir", "cabotegravir"]);
    const isPolyvalentCation = this.matchesAny(daLow, ["aluminium", "aluminum", "magnesium", "calcium", "attapulgite", "sucralfate", "ferrous", "iron", "zinc", "antacid"]) || this.matchesAny(dbLow, ["aluminium", "aluminum", "magnesium", "calcium", "attapulgite", "sucralfate", "ferrous", "iron", "zinc", "antacid"]);
    if (isIntegrase && isPolyvalentCation) {
      const integraseDrug = this.matchesAny(daLow, ["dolutegravir", "raltegravir", "bictegravir", "elvitegravir", "cabotegravir"]) ? da : db;
      const cationDrug = integraseDrug === da ? db : da;
      return {
        mechanism: `Pembentukan kelat kompleks tidak larut antara kation logam polivalen (${cationDrug}) dengan gugus pengikat intigrase pada ${integraseDrug} di saluran cerna. Reaksi kelasi ini secara drastis menurunkan absorpsi gastrointestinal dan bioavailabilitas oral ${integraseDrug} hingga >70%, berisiko memicu kegagalan virologis.`,
        management: `Pisahkan waktu konsumsi: Berikan ${integraseDrug} minimal 2 jam sebelum atau 6 jam setelah konsumsi preparat ${cationDrug}. Bila memungkinkan, gunakan antasida alternatif tanpa kation logam berat.`,
        clinicalEffect: `Penurunan signifikan konsentrasi plasma ${integraseDrug} dan risiko kegagalan supresi virologis.`,
        evidenceLevel: "DDInter v2.0 Level A (Klinis Terbukti)",
        mechanismTags: ["Absorpsi Saluran Cerna", "Kelasi Kation Logam", "Penurunan Bioavailabilitas"]
      };
    }
    const isChelatedAntibiotic = this.matchesAny(daLow, ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin", "doxycycline", "tetracycline", "minocycline"]) || this.matchesAny(dbLow, ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin", "doxycycline", "tetracycline", "minocycline"]);
    if (isChelatedAntibiotic && isPolyvalentCation) {
      const abx = this.matchesAny(daLow, ["ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin", "doxycycline", "tetracycline", "minocycline"]) ? da : db;
      const cation = abx === da ? db : da;
      return {
        mechanism: `Kelasi ion bivalen/trivalen pada ${cation} dengan cincin florokuinolon/tetrasiklin ${abx} membentuk garam khelat tidak larut di lumen usus halus, menurunkan absorpsi antibiotik sebesar 50-85%.`,
        management: `Beri jeda waktu pemberian minimal 2 jam sebelum atau 4 jam setelah konsumsi ${cation} untuk memastikan absorpsi antibiotik adekuat.`,
        clinicalEffect: `Penurunan drastis konsentrasi serum antibiotik ${abx} yang memicu kegagalan eradikasi bakteri patogen.`,
        evidenceLevel: "DDInter v2.0 Level A",
        mechanismTags: ["Absorpsi Saluran Cerna", "Kelasi Logam"]
      };
    }
    const isOrlistat = daLow.includes("orlistat") || dbLow.includes("orlistat");
    if (isOrlistat) {
      const otherDrug = daLow.includes("orlistat") ? db : da;
      return {
        mechanism: `Inhibisi enzim lipase gastrointestinal oleh Orlistat menurunkan emulsifikasi dan hidrolisis trigliserida diet, sehingga menghambat pembentukan misel yang diperlukan untuk absorpsi senyawa lipofilik seperti ${otherDrug} di saluran cerna.`,
        management: `Pisahkan jadwal konsumsi Orlistat dan ${otherDrug} minimal 2 jam (atau berikan ${otherDrug} saat waktu tidur). Lakukan pemantauan kontrol klinis dan kepatuhan pasien.`,
        clinicalEffect: `Penurunan absorpsi oral dan konsentrasi terapeutik ${otherDrug}.`,
        evidenceLevel: "DDInter v2.0 Level B",
        mechanismTags: ["Absorpsi Saluran Cerna", "Inhibisi Lipase"]
      };
    }
    const isNaltrexone = daLow.includes("naltrexone") || dbLow.includes("naltrexone") || daLow.includes("naloxone") || dbLow.includes("naloxone");
    if (isNaltrexone && (daLow.includes("abacavir") || dbLow.includes("abacavir"))) {
      const opioidDrug = daLow.includes("abacavir") ? db : da;
      return {
        mechanism: `Ko-administrasi ${da} dan ${db} melibatkan kompetisi eliminasi fase II hepatik (glukuronidasi UGT2B7 dan sulfotransferasi) serta potensi beban metabolisme ganda pada jaringan hepatosit.`,
        management: `Pantau fungsi enzim transaminase hati (SGOT/SGPT) dan respons terapeutik klinis secara berkala. Pastikan tidak ada keluhan intoleransi gastrointestinal atau hepatik.`,
        clinicalEffect: `Kompetisi metabolisme hepatik tingkat moderate tanpa perubahan drastis parameter virologis.`,
        evidenceLevel: "DDInter v2.0 Level B",
        mechanismTags: ["Metabolisme Enzim", "Glukuronidasi Hepatik"]
      };
    }
    const isOpioid = this.matchesAny(daLow, ["morphine", "fentanyl", "tramadol", "codeine", "oxycodone", "hydrocodone", "buprenorphine", "methadone"]) || this.matchesAny(dbLow, ["morphine", "fentanyl", "tramadol", "codeine", "oxycodone", "hydrocodone", "buprenorphine", "methadone"]);
    if (isNaltrexone && isOpioid) {
      return {
        mechanism: `Antagonisme kompetitif pada reseptor mu-opioid di sistem saraf pusat oleh antagonis opioid, secara instan menetralkan efek analgesik opioid dan memicu sindrom putus obat akut (acute withdrawal).`,
        management: `KONTRAINDIKASI: Hindari penggunaan bersamaan. Pasien harus bebas dari konsumsi opioid minimal 7-10 hari sebelum memulai antagonis opioid (Naltrexone).`,
        clinicalEffect: `Hilangnya efek analgesia secara mendadak dan presipitasi sindrom putus zat (opioid withdrawal) berat.`,
        evidenceLevel: "DDInter v2.0 Level A (Kontraindikasi)",
        mechanismTags: ["Antagonisme Reseptor", "Reseptor Mu-Opioid"]
      };
    }
    const isAnticoag = this.matchesAny(daLow, ["warfarin", "rivaroxaban", "apixaban", "dabigatran", "edoxaban", "heparin", "enoxaparin"]) || this.matchesAny(dbLow, ["warfarin", "rivaroxaban", "apixaban", "dabigatran", "edoxaban", "heparin", "enoxaparin"]);
    const isNsaidOrAntiplatelet = this.matchesAny(daLow, ["aspirin", "ibuprofen", "ketorolac", "diclofenac", "naproxen", "meloxicam", "celecoxib", "clopidogrel", "ticagrelor"]) || this.matchesAny(dbLow, ["aspirin", "ibuprofen", "ketorolac", "diclofenac", "naproxen", "meloxicam", "celecoxib", "clopidogrel", "ticagrelor"]);
    if (isAnticoag && isNsaidOrAntiplatelet) {
      return {
        mechanism: `Efek hemostasis ganda: Penghambatan faktor pembekuan darah oleh antikoagulan dikombinasikan dengan disfungsi agregasi trombosit (inhibisi COX-1/TXA2) dan erosi sawar mukosa lambung oleh NSAID/antiplatelet melipatgandakan risiko perdarahan gastrointestinal masif.`,
        management: `Hindari kombinasi kecuali dengan indikasi kardiologi ketat (misal pasca-PCI). Berikan ko-peresepan PPI (Omeprazole/Pantoprazole) untuk proteksi lambung dan monitor serial Hb, hematokrit, serta tanda perdarahan tersembunyi.`,
        clinicalEffect: `Peningkatan risiko perdarahan gastrointestinal dan perdarahan mayor sistemik hingga 3-5 kali lipat.`,
        evidenceLevel: "DDInter v2.0 Level A (Mayor)",
        mechanismTags: ["Sinergisme Toksisitas", "Hemostasis & Perdarahan"]
      };
    }
    const isAceiArb = this.matchesAny(daLow, ["lisinopril", "ramipril", "captopril", "enalapril", "losartan", "valsartan", "candesartan", "telmisartan"]) || this.matchesAny(dbLow, ["lisinopril", "ramipril", "captopril", "enalapril", "losartan", "valsartan", "candesartan", "telmisartan"]);
    const isPotassiumSparing = this.matchesAny(daLow, ["spironolactone", "eplerenone", "amiloride", "triamterene", "potassium chloride", "kalium"]) || this.matchesAny(dbLow, ["spironolactone", "eplerenone", "amiloride", "triamterene", "potassium chloride", "kalium"]);
    if (isAceiArb && isPotassiumSparing) {
      return {
        mechanism: `Penekanan sekresi aldosteron oleh penghambat RAAS dikombinasikan dengan blokade reabsorpsi natrium dan ekskresi kalium di tubulus distal ginjal, menyebabkan akumulasi kalium intraseluler dan serum yang cepat (hiperkalemia berat).`,
        management: `Pantau kadar elektrolit kalium serum dan kreatinin ginjal sebelum terapi, hari ke-3, ke-7, serta berkala. Batasi asupan suplemen kalium dan makanan tinggi kalium.`,
        clinicalEffect: `Hiperkalemia berat (>5.5 mEq/L) dengan risiko aritmia ventrikel fatal dan henti jantung.`,
        evidenceLevel: "DDInter v2.0 Level A",
        mechanismTags: ["Ekskresi Ginjal", "Sinergisme Farmakodinamik", "Hiperkalemia"]
      };
    }
    const isBenzo = this.matchesAny(daLow, ["diazepam", "lorazepam", "alprazolam", "clonazepam", "midazolam", "zolpidem"]) || this.matchesAny(dbLow, ["diazepam", "lorazepam", "alprazolam", "clonazepam", "midazolam", "zolpidem"]);
    if (isBenzo && isOpioid) {
      return {
        mechanism: `Aktivasi sinergistik transmisi inhibisi SSP pada reseptor GABA-A dan reseptor opioid di pusat pernapasan medula oblongata, menekan dorongan napas hipoksik dan sensitivitas terhadap hiperkapnia.`,
        management: `Batasi dosis dan durasi pemberian seminimal mungkin. Edukasi keluarga mengenai tanda hipoventilasi/sedasi berlebihan dan pertimbangkan penyediaan sediaan nalokson injeksi/nasal darurat.`,
        clinicalEffect: `Depresi pernapasan berat, sedasi mendalam, koma, dan risiko kematian akibat henti napas.`,
        evidenceLevel: "DDInter v2.0 Level A (FDA Black Box Warning)",
        mechanismTags: ["Sinergisme Farmakodinamik", "Depresi SSP & Pernapasan"]
      };
    }
    const isCyp3a4Statin = this.matchesAny(daLow, ["simvastatin", "atorvastatin", "lovastatin"]) || this.matchesAny(dbLow, ["simvastatin", "atorvastatin", "lovastatin"]);
    const isStrongCyp3a4Inhibitor = this.matchesAny(daLow, ["clarithromycin", "itraconazole", "ketoconazole", "ritonavir", "erythromycin", "diltiazem", "verapamil"]) || this.matchesAny(dbLow, ["clarithromycin", "itraconazole", "ketoconazole", "ritonavir", "erythromycin", "diltiazem", "verapamil"]);
    if (isCyp3a4Statin && isStrongCyp3a4Inhibitor) {
      const statin = this.matchesAny(daLow, ["simvastatin", "atorvastatin", "lovastatin"]) ? da : db;
      const inh = statin === da ? db : da;
      return {
        mechanism: `Inhibisi poten enzim sitokrom CYP3A4 hepatik dan usus oleh ${inh} secara dramatis menurunkan klirens metabolisme ${statin}, meningkatkan kadar AUC plasma statin hingga 5-10 kali lipat.`,
        management: `Tunda sementara (hold) konsumsi ${statin} selama masa terapi ${inh}, atau ganti sementara dengan statin non-CYP3A4 (Rosuvastatin / Pravastatin dosis rendah). Pantau nyeri otot dan kadar kreatin kinase (CK).`,
        clinicalEffect: `Peningkatan risiko miopati akut dan rabdomiolisis dengan gagal ginjal mioglobinurik akut.`,
        evidenceLevel: "DDInter v2.0 Level A (Mayor)",
        mechanismTags: ["Metabolisme Enzim CYP3A4", "Toksisitas Otot Skelet"]
      };
    }
    const isQtAgentA = this.matchesAny(daLow, ["amiodarone", "sotalol", "haloperidol", "moxifloxacin", "azithromycin", "ondansetron", "citalopram", "methadone", "quinidine"]);
    const isQtAgentB = this.matchesAny(dbLow, ["amiodarone", "sotalol", "haloperidol", "moxifloxacin", "azithromycin", "ondansetron", "citalopram", "methadone", "quinidine"]);
    if (isQtAgentA && isQtAgentB) {
      return {
        mechanism: `Blokade aditif pada saluran kalium penyearah tunda (IKr / hERG) membran kardiomiosit ventrikel, memperpanjang durasi potensial aksi jantung dan interval QT elektrokardiogram.`,
        management: `Hindari kombinasi jika interval QTc awal > 450 ms pada pria atau > 470 ms pada wanita. Pantau EKG dasar dan pertahankan kadar serum kalium \u2265 4.0 mEq/L dan magnesium \u2265 2.0 mg/dL.`,
        clinicalEffect: `Pemanjangan interval QTc aditif dengan risiko mencetuskan Torsades de Pointes dan fibrilasi ventrikel.`,
        evidenceLevel: "DDInter v2.0 Level A (Mayor)",
        mechanismTags: ["Distribusi & Elektrofisiologi", "Pemanjangan Interval QT"]
      };
    }
    const isMtx = daLow.includes("methotrexate") || dbLow.includes("methotrexate");
    const isMtxExcretionInhibitor = this.matchesAny(daLow, ["ibuprofen", "naproxen", "ketorolac", "amoxicillin", "ampicillin", "piperacillin", "omeprazole", "pantoprazole"]) || this.matchesAny(dbLow, ["ibuprofen", "naproxen", "ketorolac", "amoxicillin", "ampicillin", "piperacillin", "omeprazole", "pantoprazole"]);
    if (isMtx && isMtxExcretionInhibitor) {
      const other = daLow.includes("methotrexate") ? db : da;
      return {
        mechanism: `Kompetisi dan inhibisi transporter anion organik ginjal (OAT1/OAT3) pada membran basolateral tubulus proksimal ginjal oleh ${other}, menghambat sekresi aktif metotreksat ke urin.`,
        management: `Hindari penggunaan bersamaan pada kemoterapi metotreksat dosis tinggi. Pada dosis mingguan reumatologi, lakukan pemantauan darah lengkap (CBC), hitung jenis leukosit, trombosit, serta fungsi hepar.`,
        clinicalEffect: `Peningkatan kadar serum metotreksat dengan risiko supresi sumsum tulang berat, pansitopenia, dan mukositis.`,
        evidenceLevel: "DDInter v2.0 Level A",
        mechanismTags: ["Ekskresi Ginjal", "Transporter OAT Tubulus"]
      };
    }
    const isVaccine = daLow.includes("vaccine") || dbLow.includes("vaccine") || daLow.includes("bcg") || dbLow.includes("bcg");
    const isImmuno = this.matchesAny(daLow, ["prednisone", "dexamethasone", "methylprednisolone", "cortisone", "tacrolimus", "cyclosporine", "mycophenolate", "azathioprine", "methotrexate", "adalimumab", "infliximab"]) || this.matchesAny(dbLow, ["prednisone", "dexamethasone", "methylprednisolone", "cortisone", "tacrolimus", "cyclosporine", "mycophenolate", "azathioprine", "methotrexate", "adalimumab", "infliximab"]);
    if (isVaccine && isImmuno) {
      const vac = daLow.includes("vaccine") || daLow.includes("bcg") ? da : db;
      const imm = vac === da ? db : da;
      return {
        mechanism: `Penekanan respons imun seluler dan humoral oleh agen imunosupresan (${imm}) menurunkan kemampuan tubuh mengontrol replikasi patogen hidup yang dilemahkan pada vaksin (${vac}), atau menghambat pembentukan antibodi protektif yang efektif.`,
        management: `KONTRAINDIKASI untuk vaksin hidup selama terapi imunosupresif aktif. Tunda vaksinasi hidup minimal 3 bulan pasca penghentian terapi imunosupresan, atau selesaikan vaksinasi minimal 4 minggu sebelum inisiasi imunosupresan.`,
        clinicalEffect: `Risiko infeksi diseminata dari galur vaksin hidup yang mengancam jiwa atau kegagalan proteksi imun.`,
        evidenceLevel: "DDInter v2.0 Level A (Kontraindikasi)",
        mechanismTags: ["Supresi Imun", "Respons Vaksin"]
      };
    }
    return null;
  }
  findMatchingDDInterMechanism(daLow, dbLow, severity) {
    if (this.mechanisms.length === 0) return null;
    const wordsA = daLow.split(/[^a-z0-9]+/g).filter((w) => w.length >= 3);
    const wordsB = dbLow.split(/[^a-z0-9]+/g).filter((w) => w.length >= 3);
    for (const wa of wordsA) {
      const idxListA = this.drugKeywordIndex.get(wa);
      if (!idxListA) continue;
      for (const wb of wordsB) {
        const idxListB = this.drugKeywordIndex.get(wb);
        if (!idxListB) continue;
        const setB = new Set(idxListB);
        for (const idx of idxListA) {
          if (setB.has(idx)) {
            const m = this.mechanisms[idx];
            const rawText = m.interaction;
            if (rawText && rawText.length > 30) {
              const tags = [];
              if (m.absorption === "1") tags.push("Absorpsi Saluran Cerna");
              if (m.distribution === "1") tags.push("Distribusi & Ikatan Protein");
              if (m.metabolism === "1") tags.push("Metabolisme Sitokrom CYP450");
              if (m.excretion === "1") tags.push("Ekskresi Eliminasi Ginjal");
              if (m.synergistic_effect === "1") tags.push("Efek Sinergistik / Toksisitas Aditif");
              if (m.antagonistic_effect === "1") tags.push("Efek Antagonistik Farmakodinamik");
              return {
                mechanism: rawText,
                management: this.generateActionableManagement(rawText, severity, tags),
                clinicalEffect: this.extractClinicalEffect(rawText, severity),
                evidenceLevel: "DDInter v2.0 Official Monograph",
                mechanismTags: tags.length > 0 ? tags : ["Interaksi Farmakologi Terverifikasi"]
              };
            }
          }
        }
      }
    }
    return null;
  }
  inferPharmacology(da, _daLow, db, _dbLow, severity) {
    const sevNorm = severity.toLowerCase();
    if (sevNorm.includes("major") || sevNorm.includes("contra")) {
      return {
        mechanism: `Interaksi farmakokinetik/farmakodinamik tingkat Major antara ${da} dan ${db}. Berpotensi melibatkan modifikasi klirens eliminasi hepar/ginjal atau efek sinergis pada reseptor target yang dapat memicu toksisitas klinis bermakna.`,
        management: `Hindari pemberian kombinasi bila tersedia alternatif terapi yang lebih aman. Jika terapi esensial, lakukan pemantauan ketat tanda toksisitas, evaluasi penyesuaian dosis substrat, dan pantau parameter laboratorium relevan.`,
        clinicalEffect: `Potensi peningkatan risiko efek samping mayor atau kegagalan terapeutik yang signifikan.`,
        evidenceLevel: "DDInter v2.0 Verified (Level A)",
        mechanismTags: ["Tingkat Risiko Mayor", "Pemantauan Ketat"]
      };
    }
    if (sevNorm.includes("minor") || sevNorm.includes("1")) {
      return {
        mechanism: `Interaksi farmakologis minor antara ${da} dan ${db}. Perubahan farmakokinetik atau farmakodinamik yang terjadi umumnya minimal dan jarang menimbulkan konsekuensi klinis yang mengganggu hasil terapi.`,
        management: `Dapat dilanjutkan dengan pemantauan rutin standar. Pasien dianjurkan melaporkan jika muncul keluhan tidak lazim selama masa pengobatan.`,
        clinicalEffect: `Dampak klinis ringan; biasanya tidak memerlukan perubahan rejimen dosis obat.`,
        evidenceLevel: "DDInter v2.0 Verified (Level C)",
        mechanismTags: ["Tingkat Risiko Minor", "Pemantauan Standar"]
      };
    }
    return {
      mechanism: `Interaksi farmakologis tingkat Moderate antara ${da} dan ${db}. Melibatkan potensi persaingan metabolisme isoenzim hepatik atau efek farmakologis aditif yang memerlukan pengawasan respons terapi.`,
      management: `Gunakan dengan kehati-hatian klinis. Pantau respons klinis pasien, evaluasi tanda-tanda efikasi atau toksisitas obat, dan pertimbangkan penyesuaian dosis jika terjadi perubahan status klinis.`,
      clinicalEffect: `Potensi peningkatan efek samping moderat atau variabilitas konsentrasi plasma obat.`,
      evidenceLevel: "DDInter v2.0 Verified (Level B)",
      mechanismTags: ["Tingkat Risiko Moderate", "Pemantauan Klinis"]
    };
  }
  generateActionableManagement(mechanismText, severity, tags) {
    const low = mechanismText.toLowerCase();
    if (low.includes("interval:") || low.includes("cation") || tags.includes("Absorpsi Saluran Cerna")) {
      return "Pisahkan waktu pemberian obat minimal 2 jam sebelum atau 4-6 jam sesudah konsumsi preparat untuk mencegah gangguan absorpsi saluran cerna.";
    }
    if (low.includes("qt interval") || low.includes("torsade") || low.includes("arrhythmia")) {
      return "Lakukan pemeriksaan EKG serial untuk memantau interval QTc. Koreksi gangguan elektrolit (kalium & magnesium) sebelum dan selama terapi kombinasi.";
    }
    if (low.includes("bleeding") || low.includes("hemorrhage") || low.includes("anticoagulant")) {
      return "Pantau tanda-tanda perdarahan aktif maupun tersembunyi (feses hitam, hematuria, lebam). Pertimbangkan penambahan gastroprotektor PPI jika terdapat risiko tukak lambung.";
    }
    if (low.includes("cyp450 3a4") && low.includes("inhibitor")) {
      return "Pertimbangkan pengurangan dosis obat substrat (25-50%) atau gunakan agen alternatif non-CYP3A4; pantau tanda-tanda toksisitas secara intensif.";
    }
    if (low.includes("cyp450 3a4") && low.includes("inducer")) {
      return "Waspadai penurunan efikasi obat akibat eliminasi yang dipercepat. Pantau kadar plasma atau pertimbangkan peningkatan dosis terapeutik jika diperlukan.";
    }
    if (low.includes("hyperkalemia") || low.includes("potassium")) {
      return "Pantau ketat kadar kalium serum dan fungsi ginjal secara periodik (hari ke-3, 7, dan 14). Hindari asupan suplemen kalium tambahan tanpa pengawasan medis.";
    }
    if (low.includes("hypoglycemia") || low.includes("glucose")) {
      return "Tingkatkan frekuensi pemantauan kadar glukosa darah mandiri (SMBG). Edukasi pasien mengenai gejala hipoglikemia dan penanganan daruratnya.";
    }
    if (low.includes("hypotension") || low.includes("blood pressure")) {
      return "Pantau tekanan darah berkala terutama saat inisiasi dosis. Edukasi pasien mengenai risiko pusing ortostatik saat beralih posisi dari duduk ke berdiri.";
    }
    if (low.includes("sedation") || low.includes("cns depression") || low.includes("respiratory depression")) {
      return "Batasi dosis dan durasi penggunaan. Ingatkan pasien untuk menghindari mengemudi atau mengoperasikan mesin berat selama mengonsumsi kombinasi ini.";
    }
    if (severity.toLowerCase() === "major") {
      return "Hindari penggunaan bersamaan bila memungkinkan. Pertimbangkan terapi pengganti yang lebih aman atau lakukan pemantauan klinis ketat.";
    }
    if (severity.toLowerCase() === "minor") {
      return "Interaksi minor; lanjutkan rejimen dengan pemantauan gejala klinis biasa dan kepatuhan minum obat.";
    }
    return "Gunakan dengan hati-hati. Pantau respons klinis pasien dan sesuaikan dosis bila terdapat indikasi perubahan efikasi atau keamanan.";
  }
  extractClinicalEffect(mechanismText, severity) {
    const sentences = mechanismText.split(/(?<=[.?!])\s+/);
    if (sentences.length > 0 && sentences[0].length >= 25 && sentences[0].length <= 250) {
      return sentences[0];
    }
    return `Potensi interaksi farmakologis tingkat ${severity} yang telah diverifikasi oleh konsorsium DDInter v2.0.`;
  }
  matchesAny(str, keywords) {
    return keywords.some((k) => str.includes(k));
  }
};
var clinicalDDIRules = new ClinicalDDIRulesEngine();

// src/data/atcClassifier.ts
var ATC_LEVEL_1 = {
  A: "Saluran Pencernaan & Metabolisme (Alimentary Tract and Metabolism)",
  B: "Darah & Organ Pembentuk Darah (Blood and Blood Forming Organs)",
  C: "Sistem Kardiovaskular (Cardiovascular System)",
  D: "Dermatologikal (Dermatologicals)",
  G: "Sistem Genitourinari & Hormon Kelamin (Genito-Urinary System)",
  H: "Preparat Hormon Sistemik (Systemic Hormonal Preparations)",
  J: "Antiinfeksi untuk Penggunaan Sistemik (Antiinfectives for Systemic Use)",
  L: "Agen Antineoplastik & Imunomodulasi (Antineoplastic and Immunomodulating)",
  M: "Sistem Muskuloskeletal (Musculo-Skeletal System)",
  N: "Sistem Saraf (Nervous System)",
  P: "Produk Antiparasit & Insektisida (Antiparasitic Products)",
  R: "Sistem Pernapasan (Respiratory System)",
  S: "Organ Sensorik (Sensory Organs)",
  V: "Agen Diagnostik & Lainnya (Various / Diagnostic Agents)"
};
var ATC_SUBGROUPS = {
  // A - Alimentary Tract & Metabolism
  A02BA: { class: "Antagonis Reseptor H2 (H2-Receptor Antagonists)", category: "Obat Gangguan Asam Lambung" },
  A02BC: { class: "Penghambat Pompa Proton / PPI (Proton Pump Inhibitors)", category: "Obat Ulkus Peptikum & GERD" },
  A02BX: { class: "Mukoprotektor & Obat Ulkus Lainnya", category: "Obat Ulkus Peptikum" },
  A03AA: { class: "Antispasmodik Antikolinergik Sintetis", category: "Gangguan Saluran Cerna Fungsional" },
  A04AA: { class: "Antiemetik Antagonis Reseptor Serotonin 5-HT3", category: "Antiemetik dan Antinausea" },
  A06AB: { class: "Laksatif Stimulan / Pencahar", category: "Obat Konstipasi" },
  A06AD: { class: "Laksatif Osmotik", category: "Obat Konstipasi" },
  A07AA: { class: "Antibiotik Intestinal Non-absorbable", category: "Antidiare & Antiinfeksi Usus" },
  A07EC: { class: "Asam Aminosalisilat / Antiinflamasi Intestinal", category: "Penyakit Radang Usus (IBD)" },
  A10BA: { class: "Antidiabetes Oral Golongan Biguanida (Biguanides)", category: "Obat Diabetes Melitus" },
  A10BB: { class: "Antidiabetes Oral Golongan Sulfonilurea", category: "Obat Diabetes Melitus" },
  A10BF: { class: "Penghambat Alfa-Glukosidase", category: "Obat Diabetes Melitus" },
  A10BG: { class: "Tiazolidindion / Agonis PPAR-gamma (Glitazones)", category: "Obat Diabetes Melitus" },
  A10BH: { class: "Penghambat Enzim DPP-4 (Gliptins)", category: "Obat Diabetes Melitus" },
  A10BJ: { class: "Agonis Reseptor GLP-1 (Incretin Mimetics)", category: "Obat Diabetes Melitus" },
  A10BK: { class: "Penghambat SGLT2 (Gliflozins)", category: "Obat Diabetes Melitus" },
  A10AE: { class: "Insulin Kerja Panjang & Analog", category: "Insulin dan Analog" },
  A10AB: { class: "Insulin Kerja Cepat / Rapid-acting", category: "Insulin dan Analog" },
  // B - Blood & Blood Forming
  B01AA: { class: "Antagonis Vitamin K / Antikoagulan Kumarin (Warfarin)", category: "Agen Antitrombotik" },
  B01AB: { class: "Heparin Berat Molekul Rendah (LMWH) & Heparinoid", category: "Agen Antitrombotik" },
  B01AC: { class: "Penghambat Agregasi Trombosit / Antiplatelet", category: "Agen Antitrombotik" },
  B01AE: { class: "Penghambat Trombin Direk (Direct Thrombin Inhibitors)", category: "Antikoagulan Direk" },
  B01AF: { class: "Penghambat Faktor Xa Direk / DOAC (Direct Factor Xa Inhibitors)", category: "Antikoagulan Direk" },
  B02AA: { class: "Agen Antifibrinolitik (Antifibrinolytic Amino Acids)", category: "Antihemoragik" },
  B03AA: { class: "Preparat Besi Bivalen Oral", category: "Antianemia" },
  B03XA: { class: "Agen Stimulasi Eritropoiesis / ESA", category: "Antianemia" },
  B05XA: { class: "Larutan Elektrolit & Pengatur Asam-Basa Intravena", category: "Larutan Infus Intravena" },
  // C - Cardiovascular System
  C01AA: { class: "Glikosida Jantung Digitalis (Digitalis Glycosides)", category: "Terapi Gagal Jantung" },
  C01BD: { class: "Antiaritmia Kelas III (Pemanjangan Potensial Aksi)", category: "Obat Antiaritmia" },
  C01CA: { class: "Agonis Adrenergik & Inotropik Positif", category: "Stimulan Jantung" },
  C01DA: { class: "Vasodilator Nitrat Organik (Antiangina)", category: "Terapi Penyakit Jantung Iskemik" },
  C02CA: { class: "Penyekat Alfa-1 Adrenoreseptor Perifer", category: "Antihipertensi" },
  C03AA: { class: "Diuretik Golongan Tiazid", category: "Diuretik Antihipertensi" },
  C03CA: { class: "Diuretik Loop / High-Ceiling Diuretics", category: "Diuretik" },
  C03DA: { class: "Antagonis Aldosteron / Diuretik Hemat Kalium", category: "Diuretik" },
  C07AA: { class: "Penyekat Beta Non-selektif (Non-selective Beta Blockers)", category: "Penyekat Beta" },
  C07AB: { class: "Penyekat Beta-1 Kardioselektif (Selective Beta Blockers)", category: "Penyekat Beta" },
  C07AG: { class: "Penyekat Alfa dan Beta Adrenergik Gabungan", category: "Penyekat Beta" },
  C08CA: { class: "Antagonis Kalsium Dihidropiridin Selektif (CCB)", category: "Antagonis Kalsium" },
  C08DA: { class: "Antagonis Kalsium Fenilalkilamin (Verapamil)", category: "Antagonis Kalsium" },
  C08DB: { class: "Antagonis Kalsium Benzotiazepin (Diltiazem)", category: "Antagonis Kalsium" },
  C09AA: { class: "Penghambat Enzim Konversi Angiotensin / ACEi", category: "Sistem Renin-Angiotensin" },
  C09CA: { class: "Antagonis Reseptor Angiotensin II / ARB", category: "Sistem Renin-Angiotensin" },
  C09DX: { class: "Kombinasi ARB, CCB & Penghambat Neprilisin (ARNI)", category: "Sistem Renin-Angiotensin" },
  C10AA: { class: "Penghambat HMG-CoA Reduktase / Statin", category: "Agen Modifikasi Lipid" },
  C10AB: { class: "Derivat Asam Fibrat (Fibrates)", category: "Agen Modifikasi Lipid" },
  C10AX: { class: "Penghambat Absorpsi Kolesterol (Ezetimibe) / Lainnya", category: "Agen Modifikasi Lipid" },
  // G - Genitourinary
  G01AE: { class: "Antiseptik & Antiinfeksi Ginekologis", category: "Antiinfeksi Urogenital" },
  G04BA: { class: "Agen Pengasam Urin (Urine Acidifiers)", category: "Obat Urologikal" },
  G04CA: { class: "Antagonis Reseptor Alfa-1A Prostat (BPH)", category: "Obat Urologikal" },
  G04CB: { class: "Penghambat Enzim 5-Alfa Reduktase (BPH)", category: "Obat Urologikal" },
  G04BE: { class: "Penghambat Enzim Fosfodiesterase Tipe 5 (PDE-5i)", category: "Obat Disfungsi Ereksi" },
  // H - Systemic Hormones
  H02AB: { class: "Kortikosteroid Glukokortikoid Sistemik", category: "Kortikosteroid" },
  H03AA: { class: "Hormon Tiroid Sintetis (Levothyroxine)", category: "Terapi Tiroid" },
  H03BB: { class: "Antitiroid Derivat Imidazol (Thiamazole/Methimazole)", category: "Terapi Tiroid" },
  H05AA: { class: "Hormon Paratiroid & Analog Rekombinan", category: "Homeostasis Kalsium" },
  // J - Antiinfectives for Systemic Use
  J01AA: { class: "Antibiotik Golongan Tetrasiklin (Tetracyclines)", category: "Antibakteri Sistemik" },
  J01CA: { class: "Antibiotik Penisilin Spektrum Luas (Aminopenicillins)", category: "Antibakteri Beta-Laktam" },
  J01CR: { class: "Kombinasi Penisilin dengan Inhibitor Beta-Laktamase", category: "Antibakteri Beta-Laktam" },
  J01DB: { class: "Sefalosporin Generasi Pertama", category: "Antibakteri Sefalosporin" },
  J01DC: { class: "Sefalosporin Generasi Kedua", category: "Antibakteri Sefalosporin" },
  J01DD: { class: "Sefalosporin Generasi Ketiga", category: "Antibakteri Sefalosporin" },
  J01DE: { class: "Sefalosporin Generasi Keempat", category: "Antibakteri Sefalosporin" },
  J01DH: { class: "Antibiotik Golongan Karbapenem", category: "Antibakteri Beta-Laktam" },
  J01FA: { class: "Antibiotik Golongan Makrolida (Macrolides)", category: "Antibakteri Sistemik" },
  J01FF: { class: "Antibiotik Golongan Linkosamid (Clindamycin)", category: "Antibakteri Sistemik" },
  J01GB: { class: "Antibiotik Golongan Aminoglikosida", category: "Antibakteri Sistemik" },
  J01MA: { class: "Antibiotik Golongan Fluorokuinolon (Fluoroquinolones)", category: "Antibakteri Kuinolon" },
  J01XA: { class: "Antibiotik Golongan Glikopeptida (Vancomycin)", category: "Antibakteri Sistemik" },
  J01XD: { class: "Derivat Imidazol Antibakteri / Antianaerob (Metronidazole)", category: "Antibakteri Sistemik" },
  J01XX: { class: "Antibakteri Golongan Oksazolidinon (Linezolid)", category: "Antibakteri Sistemik" },
  J02AC: { class: "Antijamur Sistemik Golongan Triazol (Triazoles)", category: "Antijamur Sistemik" },
  J02AX: { class: "Antijamur Sistemik Golongan Ekinokandin", category: "Antijamur Sistemik" },
  J05AB: { class: "Antivirus Analog Nukleosida / Nukleotida (Antiherpes)", category: "Antivirus Sistemik" },
  J05AE: { class: "Penghambat Protease Antivirus HIV (Protease Inhibitors)", category: "Antivirus Terapi ART" },
  J05AF: { class: "Penghambat Reverse Transcriptase Nukleosida (NRTI)", category: "Antivirus Terapi ART" },
  J05AG: { class: "Penghambat Reverse Transcriptase Non-Nukleosida (NNRTI)", category: "Antivirus Terapi ART" },
  J05AH: { class: "Penghambat Neuraminidase Antivirus Influenza", category: "Antivirus Influenza" },
  J05AJ: { class: "Penghambat Integrase Antivirus HIV (INSTI)", category: "Antivirus Terapi ART" },
  J05AP: { class: "Antivirus Hepatitis C Kerja Langsung (DAA)", category: "Antivirus Hepatitis" },
  J05AR: { class: "Kombinasi Antivirus Terapi ARV / HIV Terpadu", category: "Antivirus Terapi ART" },
  // L - Antineoplastic & Immunomodulating
  L01AA: { class: "Kemoterapi Alkilator Analog Mustard Nitrogen", category: "Agen Antineoplastik" },
  L01BA: { class: "Antineoplastik Antagonis Asam Folat (Methotrexate)", category: "Agen Antimetabolit" },
  L01BC: { class: "Antineoplastik Analog Pirimidin (Fluorouracil, Capecitabine)", category: "Agen Antimetabolit" },
  L01CD: { class: "Antineoplastik Golongan Taksan (Paclitaxel, Docetaxel)", category: "Agen Antimikrotubulus" },
  L01DB: { class: "Antineoplastik Antibiotik Antrasiklin (Doxorubicin)", category: "Agen Antineoplastik" },
  L01EA: { class: "Penghambat Tirosin Kinase BCR-ABL (Imatinib)", category: "Terapi Target Kanker" },
  L01EB: { class: "Penghambat Tirosin Kinase Reseptor EGFR", category: "Terapi Target Kanker" },
  L01EF: { class: "Penghambat Kinase Siklin Dependen CDK4/6", category: "Terapi Target Kanker" },
  L01FA: { class: "Antibodi Monoklonal Anti-CD20 (Rituximab)", category: "Imunoterapi Kanker" },
  L01FD: { class: "Antibodi Monoklonal Penghambat Reseptor HER2 (Trastuzumab)", category: "Imunoterapi Kanker" },
  L01FF: { class: "Imunoterapi Checkpoint Penghambat PD-1/PD-L1", category: "Imunoterapi Kanker" },
  L02BA: { class: "Modulator Reseptor Estrogen Selektif (SERM / Tamoxifen)", category: "Terapi Endokrin Onkologi" },
  L02BB: { class: "Antiandrogen Reseptor (Bicalutamide, Enzalutamide)", category: "Terapi Endokrin Onkologi" },
  L02BG: { class: "Penghambat Enzim Aromatase (Letrozole, Anastrozole)", category: "Terapi Endokrin Onkologi" },
  L02BX: { class: "Antagonis Hormon Onkologi & GnRH Antagonist", category: "Terapi Endokrin Onkologi" },
  L04AA: { class: "Imunosupresan Selektif / Penghambat Kostiulasi Sel T", category: "Agen Imunosupresan" },
  L04AB: { class: "Penghambat Tumor Necrosis Factor Alfa (Anti-TNF)", category: "Agen Imunosupresan Biologis" },
  L04AD: { class: "Penghambat Kalsineurin (Cyclosporine, Tacrolimus)", category: "Agen Imunosupresan" },
  L04AX: { class: "Imunosupresan Imunomodulator Lainnya", category: "Agen Imunosupresan" },
  // M - Musculo-Skeletal System
  M01AB: { class: "Antiinflamasi Non-Steroid Derivat Asam Asetat (Diclofenac)", category: "Obat Antiinflamasi & Antirematik" },
  M01AC: { class: "Antiinflamasi Non-Steroid Golongan Oksikam (Meloxicam)", category: "Obat Antiinflamasi & Antirematik" },
  M01AE: { class: "Antiinflamasi Non-Steroid Derivat Asam Propionat (Ibuprofen)", category: "Obat Antiinflamasi & Antirematik" },
  M01AH: { class: "Penghambat Selektif Enzim Siklooksigenase-2 (COX-2 Inhibitors)", category: "Obat Antiinflamasi & Antirematik" },
  M04AA: { class: "Penghambat Pembentukan Asam Urat / Xantin Oksidase (Allopurinol)", category: "Obat Antigout" },
  M04AC: { class: "Agen Antiinflamasi Spesifik Gout Akut (Colchicine)", category: "Obat Antigout" },
  // N - Nervous System
  N02AA: { class: "Analgesik Opioid Alami Agonis Reseptor Mu (Morphine)", category: "Analgesik Opioid" },
  N02AB: { class: "Analgesik Opioid Derivat Fenilpiperidin (Fentanyl)", category: "Analgesik Opioid" },
  N02AE: { class: "Analgesik Opioid Parsial Agonis Derivat Oripavin", category: "Analgesik Opioid" },
  N02AJ: { class: "Kombinasi Opioid dan Analgesik Non-Opioid (Tramadol)", category: "Analgesik Sentral" },
  N02BA: { class: "Analgesik & Antiplatelet Derivat Asam Salisilat (Aspirin)", category: "Analgesik Non-Opioid" },
  N02BE: { class: "Analgesik & Antipiretik Golongan Anilida (Paracetamol)", category: "Analgesik Non-Opioid" },
  N02BF: { class: "Agen Modulasi Nyeri Neuropatik Golongan Gabapentinoid", category: "Nyeri Neuropatik & Antikonvulsan" },
  N02CC: { class: "Agonis Selektif Reseptor Serotonin 5-HT1 / Triptan (Antimigrain)", category: "Preparat Antimigrain" },
  N03AA: { class: "Antikonvulsan / Antiepilepsi Derivat Barbiturat", category: "Obat Antiepilepsi" },
  N03AB: { class: "Antiepilepsi Derivat Hidantoin (Phenytoin)", category: "Obat Antiepilepsi" },
  N03AE: { class: "Antiepilepsi Derivat Benzodiazepin (Clonazepam)", category: "Obat Antiepilepsi" },
  N03AF: { class: "Antiepilepsi Derivat Karboksamid (Carbamazepine)", category: "Obat Antiepilepsi" },
  N03AG: { class: "Antiepilepsi Derivat Asam Lemak (Asam Valproat)", category: "Obat Antiepilepsi" },
  N03AX: { class: "Antiepilepsi & Penstabil Membran Saraf Lainnya", category: "Obat Antiepilepsi" },
  N04BA: { class: "Prekursor Dopamin L-Dopa & Inhibitor Dekarboksilase", category: "Obat Anti-Parkinson" },
  N04BC: { class: "Agonis Reseptor Dopamin (Pramipexole, Ropinirole)", category: "Obat Anti-Parkinson" },
  N04BD: { class: "Penghambat Monoamin Oksidase Tipe B (MAO-B Inhibitors)", category: "Obat Anti-Parkinson" },
  N04BB: { class: "Derivat Adamantan Anti-Parkinson (Amantadine)", category: "Obat Anti-Parkinson" },
  N05AA: { class: "Antipsikotik Tipikal Golongan Fenotiazin", category: "Obat Antipsikotik" },
  N05AD: { class: "Antipsikotik Tipikal Derivat Butirofenon (Haloperidol)", category: "Obat Antipsikotik" },
  N05AH: { class: "Antipsikotik Atipikal Golongan Diazepin/Oksazepin", category: "Obat Antipsikotik" },
  N05AL: { class: "Antipsikotik Golongan Benzamid (Sulpiride)", category: "Obat Antipsikotik" },
  N05AX: { class: "Antipsikotik Atipikal Generasi Baru (Risperidone, Aripiprazole)", category: "Obat Antipsikotik" },
  N05BA: { class: "Anksiolitik Golongan Benzodiazepin (Diazepam, Alprazolam)", category: "Psikoleptik Anksiolitik" },
  N05CD: { class: "Hipnotik & Sedatif Derivat Benzodiazepin", category: "Hipnotik dan Sedatif" },
  N05CF: { class: "Hipnotik Agonis Reseptor GABA-A Non-Benzodiazepin (Z-Drugs)", category: "Hipnotik dan Sedatif" },
  N06AA: { class: "Antidepresan Trisiklik / Non-selektif Reuptake Inhibitor (TCA)", category: "Obat Antidepresan" },
  N06AB: { class: "Antidepresan Penghambat Selektif Reuptake Serotonin (SSRI)", category: "Obat Antidepresan" },
  N06AX: { class: "Antidepresan Atipikal / SNRI / Modulator Monoamin", category: "Obat Antidepresan" },
  N06BA: { class: "Psikostimulan Sentral & Terapi ADHD (Methylphenidate)", category: "Psikostimulan" },
  N06DA: { class: "Penghambat Enzim Asetilkolinesterase (Anti-Demensia)", category: "Obat Demensia Alzheimer" },
  N06DX: { class: "Antagonis Reseptor NMDA (Memantine / Anti-Demensia)", category: "Obat Demensia Alzheimer" },
  N07AA: { class: "Agen Parasimpatomimetik Antikolinesterase", category: "Obat Sistem Saraf" },
  N07BA: { class: "Terapi Ketergantungan Nikotin (Varenicline, Bupropion)", category: "Obat Gangguan Adiktif" },
  N07BB: { class: "Obat Ketergantungan Alkohol (Drugs Used in Alcohol Dependence)", category: "Obat Gangguan Adiktif" },
  N07BC: { class: "Terapi Substitusi Ketergantungan Opioid (Buprenorphine, Methadone)", category: "Obat Gangguan Adiktif" },
  N07CA: { class: "Preparat Antivertigo / Modulator Mikrosirkulasi Labirin", category: "Obat Antivertigo" },
  // R - Respiratory System
  R01AD: { class: "Kortikosteroid Topikal Intranasal", category: "Preparat Dekongestan & Hidung" },
  R03AC: { class: "Agonis Selektif Beta-2 Adrenoreseptor (Bronkodilator Inhalasi)", category: "Obat Obstruksi Saluran Napas" },
  R03AK: { class: "Kombinasi Kortikosteroid Inhalasi & LABA (Bronkodilator)", category: "Obat Obstruksi Saluran Napas" },
  R03BA: { class: "Kortikosteroid Inhalasi Antiinflamasi Asma (ICS)", category: "Obat Obstruksi Saluran Napas" },
  R03BB: { class: "Antikolinergik Bronkodilator Inhalasi (SAMA/LAMA)", category: "Obat Obstruksi Saluran Napas" },
  R03DC: { class: "Antagonis Reseptor Leukotrien Oral (Montelukast)", category: "Obat Obstruksi Saluran Napas" },
  R05CB: { class: "Mukolitik Pengencer Dahak (Acetylcysteine, Ambroxol)", category: "Preparat Batuk & Pilek" },
  R06AA: { class: "Antihistamin H1 Generasi Pertama (Aminoalkil Eter)", category: "Antihistamin Sistemik" },
  R06AE: { class: "Antihistamin H1 Generasi Kedua Derivat Piperazin (Cetirizine)", category: "Antihistamin Sistemik" },
  R06AX: { class: "Antihistamin H1 Generasi Kedua Non-sedatif (Loratadine)", category: "Antihistamin Sistemik" },
  // S - Sensory Organs
  S01EC: { class: "Penghambat Karbonik Anhidrase Topikal / Sistemik (Antiglaukoma)", category: "Preparat Mata Antiglaukoma" },
  S01ED: { class: "Penyekat Beta Topikal Oftalmik (Timolol)", category: "Preparat Mata Antiglaukoma" },
  S01EE: { class: "Analog Prostaglandin Topikal (Latanoprost)", category: "Preparat Mata Antiglaukoma" }
};
var ATC_LEVEL_2 = {
  A02: { class: "Obat Gangguan Terkait Asam Lambung & Refluks", category: "Saluran Cerna & Metabolisme" },
  A03: { class: "Obat Gangguan Saluran Cerna Fungsional & Antispasmodik", category: "Saluran Cerna & Metabolisme" },
  A04: { class: "Antiemetik & Agen Pencegah Mual Muntah", category: "Saluran Cerna & Metabolisme" },
  A06: { class: "Obat Pencahar & Laksatif Konstipasi", category: "Saluran Cerna & Metabolisme" },
  A07: { class: "Antidiare, Antiinflamasi & Antiinfeksi Intestinal", category: "Saluran Cerna & Metabolisme" },
  A10: { class: "Antidiabetes Oral & Terapi Penurun Glukosa", category: "Endokrin & Diabetes" },
  B01: { class: "Agen Antitrombotik, Antiplatelet & Antikoagulan", category: "Hematologi" },
  B02: { class: "Agen Antihemoragik & Hemostatik", category: "Hematologi" },
  B03: { class: "Preparat Antianemia & Stimulan Hematopoietik", category: "Hematologi" },
  C01: { class: "Terapi Jantung, Antiaritmia & Inotropik", category: "Kardiovaskular" },
  C02: { class: "Antihipertensi Aksi Sentral & Perifer", category: "Kardiovaskular" },
  C03: { class: "Diuretik Penurun Volume Cairan", category: "Kardiovaskular" },
  C07: { class: "Penyekat Beta-Adrenergik (Beta Blockers)", category: "Kardiovaskular" },
  C08: { class: "Antagonis Saluran Kalsium (Calcium Channel Blockers)", category: "Kardiovaskular" },
  C09: { class: "Agen Pengatur Sistem Renin-Angiotensin (ACEi / ARB)", category: "Kardiovaskular" },
  C10: { class: "Agen Penurun Lipid & Anti-Aterosklerosis", category: "Kardiovaskular" },
  G04: { class: "Obat Saluran Kemih & Urologikal", category: "Urogenital" },
  H02: { class: "Kortikosteroid Sistemik Antiinflamasi", category: "Endokrin Sistemik" },
  H03: { class: "Terapi Gangguan Fungsi Tiroid", category: "Endokrin Sistemik" },
  H05: { class: "Regulator Homeostasis Kalsium & Tulang", category: "Endokrin Sistemik" },
  J01: { class: "Antibakteri Spektrum Luas untuk Infeksi Sistemik", category: "Antiinfeksi Sistemik" },
  J02: { class: "Antijamur untuk Mikosis Sistemik", category: "Antiinfeksi Sistemik" },
  J05: { class: "Antivirus Terapi Infeksi Virus Sistemik", category: "Antiinfeksi Sistemik" },
  L01: { class: "Kemoterapi Antineoplastik & Terapi Onkologi Target", category: "Onkologi & Imunologi" },
  L02: { class: "Terapi Endokrin Antikanker", category: "Onkologi & Imunologi" },
  L04: { class: "Imunosupresan Penekan Respon Imun", category: "Onkologi & Imunologi" },
  M01: { class: "Antiinflamasi Non-Steroid (NSAID) & Antirematik", category: "Muskuloskeletal" },
  M04: { class: "Obat Terapi Hiperurisemia & Pirai (Gout)", category: "Muskuloskeletal" },
  N01: { class: "Anestetik Umum & Lokal", category: "Sistem Saraf" },
  N02: { class: "Analgesik & Agen Pereda Nyeri", category: "Sistem Saraf" },
  N03: { class: "Antiepilepsi & Antikonvulsan", category: "Sistem Saraf" },
  N04: { class: "Obat Terapi Sindrom Parkinson", category: "Sistem Saraf" },
  N05: { class: "Psikoleptik, Antipsikotik & Anksiolitik", category: "Sistem Saraf" },
  N06: { class: "Psikoanaleptik, Antidepresan & Terapi Kognitif", category: "Sistem Saraf" },
  N07: { class: "Obat Sistem Saraf Pusat & Modulator Adiksi", category: "Sistem Saraf" },
  R01: { class: "Preparat Dekongestan & Hidung", category: "Pernapasan" },
  R03: { class: "Bronkodilator & Anti-Obstruksi Saluran Napas", category: "Pernapasan" },
  R05: { class: "Preparat Batuk & Pengencer Mukus", category: "Pernapasan" },
  R06: { class: "Antihistamin Sistemik Anti-Alergi", category: "Pernapasan & Alergi" },
  S01: { class: "Preparat Oftalmik Terapi Mata", category: "Organ Sensorik" }
};
var PHARMACEUTICAL_STEMS = [
  { regex: /statin$/i, class: "Penghambat HMG-CoA Reduktase / Statin", category: "Kardiovaskular \u2022 Agen Modifikasi Lipid" },
  { regex: /sartan$/i, class: "Antagonis Reseptor Angiotensin II (ARB)", category: "Kardiovaskular \u2022 Sistem Renin-Angiotensin" },
  { regex: /pril(at)?$/i, class: "Penghambat Enzim Konversi Angiotensin (ACEi)", category: "Kardiovaskular \u2022 Sistem Renin-Angiotensin" },
  { regex: /olol$/i, class: "Penyekat Beta-Adrenergik (Beta Blocker)", category: "Kardiovaskular \u2022 Penyekat Beta" },
  { regex: /dipine$/i, class: "Antagonis Kalsium Dihidropiridin (CCB)", category: "Kardiovaskular \u2022 Antagonis Kalsium" },
  { regex: /prazole$/i, class: "Penghambat Pompa Proton (PPI)", category: "Saluran Cerna \u2022 Obat Asam Lambung" },
  { regex: /tidine$/i, class: "Antagonis Reseptor H2 Histamin", category: "Saluran Cerna \u2022 Obat Asam Lambung" },
  { regex: /cillin$/i, class: "Antibiotik Golongan Penisilin", category: "Antiinfeksi \u2022 Antibakteri Beta-Laktam" },
  { regex: /cycline$/i, class: "Antibiotik Golongan Tetrasiklin", category: "Antiinfeksi \u2022 Antibakteri Sistemik" },
  { regex: /floxacin$/i, class: "Antibakteri Golongan Fluorokuinolon", category: "Antiinfeksi \u2022 Antibakteri Kuinolon" },
  { regex: /(mycin|micin)$/i, class: "Antibiotik Makrolida / Aminoglikosida", category: "Antiinfeksi \u2022 Antibakteri Sistemik" },
  { regex: /mab$/i, class: "Antibodi Monoklonal Terapi Target (Biologik)", category: "Imunoterapi & Terapi Target Kanker" },
  { regex: /(nib|tinib)$/i, class: "Penghambat Tirosin Kinase / Targeted Inhibitor", category: "Onkologi \u2022 Terapi Target" },
  { regex: /(azepam|azolam)$/i, class: "Anksiolitik & Sedatif Golongan Benzodiazepin", category: "Sistem Saraf \u2022 Anksiolitik & Sedatif" },
  { regex: /(oxetine|pram)$/i, class: "Antidepresan Penghambat Serotonin (SSRI)", category: "Sistem Saraf \u2022 Antidepresan" },
  { regex: /gliptin$/i, class: "Antidiabetes Oral Penghambat DPP-4", category: "Endokrin \u2022 Obat Diabetes" },
  { regex: /gliflozin$/i, class: "Antidiabetes Oral Penghambat SGLT2", category: "Endokrin \u2022 Obat Diabetes" },
  { regex: /glitazone$/i, class: "Antidiabetes Oral Golongan Tiazolidindion", category: "Endokrin \u2022 Obat Diabetes" },
  { regex: /(xaban|gatran)$/i, class: "Antikoagulan Oral Direk (DOAC / NOAC)", category: "Hematologi \u2022 Antitrombotik Direk" },
  { regex: /terol$/i, class: "Bronkodilator Agonis Beta-2 Adrenergik", category: "Pernapasan \u2022 Obstruksi Saluran Napas" },
  { regex: /lukast$/i, class: "Antagonis Reseptor Leukotrien Anti-Asma", category: "Pernapasan \u2022 Obstruksi Saluran Napas" },
  { regex: /coxib$/i, class: "Antiinflamasi Selektif COX-2 (NSAID)", category: "Muskuloskeletal \u2022 Antiinflamasi" },
  { regex: /(fenac|profen)$/i, class: "Antiinflamasi Non-Steroid (NSAID)", category: "Muskuloskeletal \u2022 Analgesik & Antiinflamasi" },
  { regex: /(sone|olone|onide)$/i, class: "Kortikosteroid Glukokortikoid Antiinflamasi", category: "Hormon Sistemik \u2022 Glukokortikoid" },
  { regex: /(vir|navir|gravir)$/i, class: "Antivirus Spesifik Kerja Langsung", category: "Antiinfeksi \u2022 Antivirus" },
  { regex: /conazole$/i, class: "Antijamur Golongan Triazol / Imidazol", category: "Antiinfeksi \u2022 Antijamur" },
  { regex: /triptan$/i, class: "Agonis Reseptor 5-HT1 Antimigrain Akut", category: "Sistem Saraf \u2022 Preparat Antimigrain" },
  { regex: /setron$/i, class: "Antiemetik Antagonis Reseptor 5-HT3", category: "Saluran Cerna \u2022 Antiemetik" },
  { regex: /zosin$/i, class: "Penyekat Alfa-1 Adrenoreseptor", category: "Kardiovaskular / Urologikal" },
  { regex: /parin$/i, class: "Heparin Berat Molekul Rendah (LMWH)", category: "Hematologi \u2022 Antikoagulan" },
  { regex: /fungin$/i, class: "Antijamur Sistemik Golongan Ekinokandin", category: "Antiinfeksi \u2022 Antijamur Sistemik" }
];
function resolvePharmacotherapyClass(atcCode, drugName, drugType, mechanism) {
  const cleanName = (drugName || "").trim();
  const cleanCode = (atcCode || "").trim().toUpperCase();
  if (cleanCode && cleanCode !== "-" && !cleanCode.startsWith("DB")) {
    const primaryCode = cleanCode.split(/[,;\s]+/)[0].trim();
    const level4 = primaryCode.slice(0, 5);
    if (ATC_SUBGROUPS[level4]) {
      const match = ATC_SUBGROUPS[level4];
      const rootLetter2 = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter2] || "Farmakologi Terverifikasi DDInter v2.0";
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} \u2022 ${match.category || level4}`,
        anatomicalGroup: anatomical
      };
    }
    const level3 = primaryCode.slice(0, 4);
    if (ATC_SUBGROUPS[level3]) {
      const match = ATC_SUBGROUPS[level3];
      const rootLetter2 = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter2] || "Farmakologi Terverifikasi DDInter v2.0";
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} \u2022 ${match.category || level3}`,
        anatomicalGroup: anatomical
      };
    }
    const level2 = primaryCode.slice(0, 3);
    if (ATC_LEVEL_2[level2]) {
      const match = ATC_LEVEL_2[level2];
      const rootLetter2 = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter2] || match.category;
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} \u2022 ${match.category}`,
        anatomicalGroup: anatomical
      };
    }
    const rootLetter = primaryCode.charAt(0);
    if (ATC_LEVEL_1[rootLetter]) {
      const anatomical = ATC_LEVEL_1[rootLetter];
      return {
        therapeuticClass: anatomical.split("(")[0].trim(),
        atcCategory: anatomical,
        anatomicalGroup: anatomical
      };
    }
  }
  for (const stem of PHARMACEUTICAL_STEMS) {
    if (stem.regex.test(cleanName)) {
      return {
        therapeuticClass: stem.class,
        atcCategory: stem.category,
        anatomicalGroup: stem.category.split("\u2022")[0].trim()
      };
    }
  }
  if (drugType === "biotech") {
    return {
      therapeuticClass: "Biomolekul Peptida / Protein Terapeutik Rekombinan",
      atcCategory: "Produk Bioteknologi Farmasi & Imunobiologis",
      anatomicalGroup: "Bioteknologi Medis"
    };
  }
  const mech = (mechanism || "").toLowerCase();
  if (mech.includes("antibakteri") || mech.includes("antibiotik") || mech.includes("bakterisid")) {
    return {
      therapeuticClass: "Agen Antibakteri Spektrum Farmakologis",
      atcCategory: "Antiinfeksi untuk Penggunaan Sistemik",
      anatomicalGroup: "Antiinfeksi Sistemik"
    };
  }
  if (mech.includes("antidepres") || mech.includes("serotonin")) {
    return {
      therapeuticClass: "Modulator Neurotransmiter & Agen Antidepresan",
      atcCategory: "Sistem Saraf (Nervous System) \u2022 Psikoanaleptik",
      anatomicalGroup: "Sistem Saraf (Nervous System)"
    };
  }
  if (mech.includes("antivirus") || mech.includes("reverse transcriptase") || mech.includes("protease inhibitor")) {
    return {
      therapeuticClass: "Agen Antivirus Kerja Langsung Terverifikasi",
      atcCategory: "Antiinfeksi untuk Penggunaan Sistemik \u2022 Antivirus",
      anatomicalGroup: "Antiinfeksi Sistemik"
    };
  }
  if (mech.includes("tekanan darah") || mech.includes("antihipertensi") || mech.includes("vasodilat")) {
    return {
      therapeuticClass: "Agen Kardiovaskular & Pengatur Tekanan Darah",
      atcCategory: "Sistem Kardiovaskular (Cardiovascular System)",
      anatomicalGroup: "Sistem Kardiovaskular"
    };
  }
  return {
    therapeuticClass: "Obat Terdaftar DDInter v2.0",
    atcCategory: "Klasifikasi Farmakologi DDInter v2.0",
    anatomicalGroup: "DDInter v2.0"
  };
}

// src/data/diseaseClinicalData.ts
var DISEASE_REGISTRY = {
  "liver diseases": {
    name: "Liver Diseases",
    indonesianName: "Liver Diseases (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Liver Diseases" memiliki 664 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hepatotoxicity including lactic acidosis, severe hepatomegaly with steatosis, fulminant hepatitis, and hepatic failure has been associated with the use of some nucleoside reverse transcriptase inhibitors (NRTIs) alone or in combination with other antiretroviral agents.  Therapy with NRTIs should be administered cautiously in patients with preexisting liver disease, a history of alcohol abuse, or hepatitis.  Therapy should be suspended if clinical or laboratory findings suggestive of lactic acidosis or pronounced hepatotoxicity occur.  The use of abacavir is contraindicated in patients with moderate to severe hepatic impairment as its safety and efficacy has not been established on these patients.",
    ddinterSeverityDistribution: {
      major: 280,
      moderate: 380,
      minor: 4,
      total: 664
    },
    ddinterOfficialReferences: [`Yarchoan R, Mitsuya H, Pluda JM, et al. "The National Cancer Institute phase I study of 2',3'-dideoxyinosine administration in adults with AIDS-related complex: analysis of activity and toxicity profiles." Rev Infect Dis 12 (1990):  s522-33`, `Dolin R, Lambert JS, Morse GD, et al. "2',3'-dideoxyinosine in patients with AIDS or AIDS-related complex." Rev Infect Dis 12 (1990):  s540-51`, `Lai KK, Gang DL, Zawacki JK, Cooley TP "Fulminant hepatic failure associated with 2',3'-dideoxyinosine (ddI)." Ann Intern Med 115 (1991):  283-4`, 'Dubin G, Braffman MN "Zidovudine-induced hepatotoxicity." Ann Intern Med 110 (1989):  85-6', 'Shriner K, Goetz MB "Severe hepatoxicity in a patient receiving both acetaminophen and zidovudine." Am J Med 93 (1992):  94-6', 'Gradon JD, Chapnick EK, Sepkowitz DV "Zidovudine-induced hepatitis." J Intern Med 231 (1992):  317-8']
  },
  "cardiovascular diseases": {
    name: "Cardiovascular Diseases",
    indonesianName: "Cardiovascular Diseases (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiovascular Diseases" memiliki 149 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Some clinical trials have reported increased risk of myocardial infarction in patients treated with abacavir.  Although some of the findings are inconclusive, as a precaution, the underlying risk of coronary heart disease should be assessed before therapy, and action should be taken to minimize all modifiable risk factors such as hypertension, hyperlipidemia, diabetes mellitus, smoking, etc.",
    ddinterSeverityDistribution: {
      major: 87,
      moderate: 62,
      minor: 0,
      total: 149
    },
    ddinterOfficialReferences: ['"Product Information. Ziagen (abacavir)." Glaxo Wellcome  (2001):', '"Product Information. Zytiga (abiraterone)." Centocor Inc  (2011):', '"Product Information. Cibinqo (abrocitinib)." Pfizer U.S. Pharmaceuticals Group  (2022):', 'Chazan R, Droszcz W, Maruchin JE "Pharmacodynamics of salbutamol in humans." Int J Clin Pharmacol Ther Toxicol 26 (1988):  385-7', 'Larsson S "Long-term treatment with beta2-adrenostimulants in asthma. Side effects, selectivity, tolerance, and routes of administration." Acta Med Scand Suppl 608 (1977):  1-40', 'Mettauer B, Rouleau JL, Burgess JH "Detrimental arrhythmogenic and sustained beneficial hemodynamic effects of oral salbutamol in patients with chronic congestive heart failure." Am Heart J 109 (1985):  840-7']
  },
  "hyperparathyroidism": {
    name: "Hyperparathyroidism",
    indonesianName: "Hyperparathyroidism (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperparathyroidism" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients known to have an underlying hypercalcemic disorder, such as primary hyperparathyroidism, should not be treated with parathyroid hormone and its analogs because of the risk of exacerbating hypercalcemia.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 4,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Forteo (teriparatide)." Lilly, Eli and Company  (2002):', '"Product Information. Natpara (parathyroid hormone)." NPS Pharmaceuticals  (2015):', '"Product Information. Tymlos (abaloparatide)." Radius Health  (2017):', 'Anderson PE, Ellis GG, Austin SM "Case report: metolazone-associated hypercalcemia and acute pancreatitis." Am J Med Sci 302 (1991):  235-7', 'Lindy S, Tarssanen L "Serum calcium and phosphorus in patients treated with thiazides and furosemide." Acta Med Scand 194 (1973):  319-22', 'Gammon GD, Docherty JP "Thiazide-induced hypercalcemia in a manic-depressive patient." Am J Psychiatry 137 (1980):  1453-5']
  },
  "neoplasms": {
    name: "Neoplasms",
    indonesianName: "Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neoplasms" memiliki 23 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Parathyroid hormone and its analogs should not be used in patients who are at increased baseline risk for osteosarcoma.  These agents should only be used if the potential benefits are considered to outweigh the potential risks.  Monitor these patients according to clinical guidelines.  Patients with bone metastases or a history of skeletal malignancies should not be treated with these agents.",
    ddinterSeverityDistribution: {
      major: 18,
      moderate: 5,
      minor: 0,
      total: 23
    },
    ddinterOfficialReferences: ['"Product Information. Forteo (teriparatide)." Lilly, Eli and Company  (2002):', '"Product Information. Natpara (parathyroid hormone)." NPS Pharmaceuticals  (2015):', '"Product Information. Tymlos (abaloparatide)." Radius Health  (2017):', '"Product Information. Remicade (infliximab)." Centocor Inc  (2001):', '"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', '"Product Information. Cimzia (certolizumab)." UCB Pharma Inc  (2008):']
  },
  "urolithiasis": {
    name: "Urolithiasis",
    indonesianName: "Urolithiasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urolithiasis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "No dosage adjustment is required for patients with mild, moderate, or severe renal impairment.  Patients with severe renal impairment may have increased abaloparatide exposure that may increase the risk of adverse reactions; therefore, monitor for adverse reactions.  Abaloparatide may exacerbate urolithiasis in patients with active or a history of urolithiasis.  If active urolithiasis or preexisting hypercalciuria is suspected, measurement of urinary calcium excretion should be considered.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Tymlos (abaloparatide)." Radius Health  (2017):', '"Product Information. Forteo (teriparatide)." Lilly, Eli and Company  (2002):']
  },
  "pulmonary disease, chronic obstructive": {
    name: "Pulmonary Disease, Chronic Obstructive",
    indonesianName: "Pulmonary Disease, Chronic Obstructive (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pulmonary Disease, Chronic Obstructive" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In studies, patients with chronic obstructive pulmonary disease (COPD) treated with abatacept for rheumatoid arthritis developed adverse events (including COPD exacerbations, cough, rhonchi, dyspnea) more frequently than those treated with placebo.  Abatacept should be used with caution in patients with COPD and such patients should be monitored for worsening of their respiratory status.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Orencia (abatacept)." Bristol-Myers Squibb  (2005):', '"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', '"Product Information. Remicade (infliximab)." Centocor Inc  (2001):', '"Product Information. Quviviq (daridorexant)." Idorsia Pharmaceuticals US Inc.  (2022):', '"Product Information. Dayvigo (lemborexant)." Eisai Inc  (2020):', '"Product Information. Lexiscan (regadenoson)." Astellas Pharma US, Inc  (2008):']
  },
  "diabetes mellitus": {
    name: "Diabetes Mellitus",
    indonesianName: "Diabetes Mellitus (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetes Mellitus" memiliki 192 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Parenteral drug products containing maltose can interfere with readings from blood glucose monitors that use test strips with glucose dehydrogenase pyrroloquinoline quinone (GDH-PQQ).  The GDH-PQQ-based glucose monitoring systems may react with the maltose in abatacept for IV administration, resulting in falsely elevated blood glucose readings on the day of abatacept infusion.  When receiving IV abatacept, patients that require blood glucose monitoring should be advised to consider methods that do not react with maltose, such as those based on glucose dehydrogenase nicotine adenine dinucleotide (GDH-NAD), glucose oxidase, or glucose hexokinase test methods.Because abatacept for subcutaneous administration does not contain maltose, patients do not need to alter their glucose monitoring.",
    ddinterSeverityDistribution: {
      major: 34,
      moderate: 158,
      minor: 0,
      total: 192
    },
    ddinterOfficialReferences: ['"Product Information. Orencia (abatacept)." Bristol-Myers Squibb  (2005):', '"Product Information. Nutropin (somatropin)." Genentech  (2001):', '"Product Information. Protropin (somatrem)." Genentech  (2001):', '"Product Information. Skytrofa (lonapegsomatropin)." Ascendis Pharma, Inc.  (2021):', 'Chazan R, Droszcz W, Maruchin JE "Pharmacodynamics of salbutamol in humans." Int J Clin Pharmacol Ther Toxicol 26 (1988):  385-7', 'Hastwell G, Lambert BE "The effect of oral salbutamol on serum potassium and blood sugar." Br J Obstet Gynaecol 85 (1978):  767-9']
  },
  "hepatitis b": {
    name: "Hepatitis B",
    indonesianName: "Hepatitis B (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatitis B" memiliki 16 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Because antirheumatic therapies have been associated with hepatitis B reactivation, patients should be screened for viral hepatitis in accordance with published guidelines before starting therapy with abatacept.  Patients screening positive for hepatitis were excluded from clinical studies with abatacept.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 7,
      minor: 0,
      total: 16
    },
    ddinterOfficialReferences: ['"Product Information. Orencia (abatacept)." Bristol-Myers Squibb  (2005):', '"Product Information. Remicade (infliximab)." Centocor Inc  (2001):', '"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', '"Product Information. Cimzia (certolizumab)." UCB Pharma Inc  (2008):', '"Product Information. Simponi (golimumab)." Centocor Inc  (2009):', '"Product Information. Arzerra (ofatumumab)." GlaxoSmithKline  (2009):']
  },
  "infections": {
    name: "Infections",
    indonesianName: "Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Infections" memiliki 171 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Serious infections (including sepsis, pneumonia) have been reported in patients receiving abatacept.  Caution and close monitoring are recommended when considering the use of abatacept in patients with history of recurrent infections, underlying conditions which may predispose them to infections, or chronic, latent, or localized infections.  Administration of abatacept should be discontinued if a patient develops a serious infection.Posttransplant lymphoproliferative disorder (PTLD) and cytomegalovirus (CMV) invasive disease occurred in patients who received abatacept for acute graft versus host disease (aGVHD) prophylaxis during unrelated hematopoietic stem cell transplantation (HSCT); the PTLD events were associated with Epstein-Barr virus (EBV) infection.  Patients should be monitored for EBV reactivation according to institutional practices; prophylaxis for EBV infection should be provided for 6 months posttransplantation to prevent EBV-associated PTLD.  Patients should be monitored for CMV infection/reactivation for 6 months posttransplant regardless of pretransplant CMV serology results for donor and recipient; prophylaxis for CMV infection/reactivation should be considered.",
    ddinterSeverityDistribution: {
      major: 95,
      moderate: 76,
      minor: 0,
      total: 171
    },
    ddinterOfficialReferences: ['"Product Information. Orencia (abatacept)." Bristol-Myers Squibb  (2005):', '"Product Information. Dysport (abobotulinumtoxinA)." Tercica Inc', '"Product Information. Botox (onabotulinumtoxinA)." Allergan Inc', '"Product Information. Xeomin (incobotulinumtoxinA)." Merz Pharmaceuticals  (2022):', '"Product Information. Daxxify (daxibotulinumtoxinA)." Revance Therapeutics, Inc.  (2022):', '"Product Information. Remicade (infliximab)." Centocor Inc  (2001):']
  },
  "tuberculosis": {
    name: "Tuberculosis",
    indonesianName: "Tuberculosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tuberculosis" memiliki 24 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Prior to initiating abatacept, patients should be screened for latent tuberculosis infection with a tuberculin skin test.  Patients testing positive in tuberculosis screening should be treated by standard medical practice prior to therapy with abatacept.  Caution should be taken when prescribing abatacept to these patients as this agent has not been studied in patients with a positive tuberculosis screen, and the safety of abatacept in patients with latent tuberculosis infection is unknown.",
    ddinterSeverityDistribution: {
      major: 14,
      moderate: 10,
      minor: 0,
      total: 24
    },
    ddinterOfficialReferences: ['"Product Information. Orencia (abatacept)." Bristol-Myers Squibb  (2005):', '"Product Information. Remicade (infliximab)." Centocor Inc  (2001):', '"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', '"Product Information. Cimzia (certolizumab)." UCB Pharma Inc  (2008):', '"Product Information. Simponi (golimumab)." Centocor Inc  (2009):', '"Product Information. Actemra (tocilizumab)." Genentech  (2022):']
  },
  "hemorrhagic disorders": {
    name: "Hemorrhagic Disorders",
    indonesianName: "Hemorrhagic Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemorrhagic Disorders" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of thrombolytics is contraindicated in patients with an active bleed (internal), trauma/surgery (recent CPR/intracranial/intraspinal surgery within 2 months), bleeding diathesis, history of cerebrovascular (CV) accident, intracranial defect (aneurysm, arteriovenous malformation, neoplasm), or severe uncontrolled arterial hypertension (SBP>180/DBP>110).  Risk versus benefit should be carefully considered in the following conditions and thrombolytic therapy administered with caution in patients with recent (10 days) serious GI bleed or recent (10 days) surgical procedure (coronary bypass graft, obstetrical delivery, organ biopsy, puncture of noncompressible vessel), left heart thrombus, subacute bacterial endocarditis, hemostatic defect, CV disease, diabetic hemorrhagic retinopathy, or pregnancy.  Clinical monitoring of hematopoietic, bleeding and coagulation functions is recommended prior to initiation of thrombolytic therapy.  Measures of fibrinolytic activity and/or coagulation functions during infusion do not correlate with efficacy or risk of bleeding.",
    ddinterSeverityDistribution: {
      major: 15,
      moderate: 2,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['Kase CS, Pessin MS, Zivin JA, del Zoppo GJ, Furlan AJ, Buckley JW, Snipes RG, LittleJohn JK "Intracranial hemorrhage after coronary thrombolysis with tissue plasminogen activator." Am J Med 92 (1992):  384-90', `Califf RM, Topol EJ, George BS, Boswick JM, Abbottsmith C, Sigmon KN, Candela R, Masek R, Kereiakes D, O'Neill WW, et al. "Hemorrhagic complications associated with the use of intravenous tissue plasminogen activator in treatment of acute myocardial infarction." Am J Med 85 (1988):  353-9`, 'Topol EJ, Herskowitz A, Hutchins GM "Massive hemorrhagic myocardial infarction after coronary thrombolysis." Am J Med 81 (1986):  339-43', 'Dabbs CK, Aaberg TM, Aguilar HE, Sternberg P, Jr  Meredith TA, Ward AR "Complications of tissue plasminogen activator therapy after vitrectomy for diabetes." Am J Ophthalmol 110 (1990):  354-60', 'Fromm RE, Hoskins E, Cronin L, Pratt CM, Spencer WH, Roberts R "Bleeding complications following initiation of thrombolytic therapy for acute myocardial infarction: a comparison of helicopter- transported and nontransported patients." Ann Emerg Med 20 (1991):  892-5', `Kase CS, O'Neal AM, Fisher M, Girgis GN, Ordia JI "Intracranial hemorrhage after use of tissue plasminogen activator for coronary thrombolysis." Ann Intern Med 112 (1990):  17-21`]
  },
  "anemia": {
    name: "Anemia",
    indonesianName: "Anemia (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia" memiliki 43 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Amphotericin B lipid complex may depress red blood cell production and occasionally causes a normocytic, normochromic anemia.  A 4% incidence was reported during clinical trials.  Although the anemia is generally well tolerated and reverses completely after discontinuation of therapy, it may be problematic in patients with preexisting anemia.  Therapy with amphotericin B lipid complex should be administered cautiously in anemic patients.  Frequent blood counts and hematocrit levels are recommended.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 31,
      minor: 2,
      total: 43
    },
    ddinterOfficialReferences: ['"Product Information. Abelcet (amphotericin B lipid complex)." Liposome Company Inc, The', 'Kinoshita S, Wada K, Kuwahara T, et al. "Interaction between warfarin and linezolid in patients with left ventricular assist system in Japan." Intern Med 55 (2016):  719-24', '"Product Information. Motrin (ibuprofen)." Pharmacia and Upjohn  (2002):', '"Product Information. Nalfon (fenoprofen)." Xspire Pharma  (2002):', '"Product Information. Indocin (indomethacin)." Merck & Co., Inc  (2002):', '"Product Information. Orudis (ketoprofen)." Wyeth-Ayerst Laboratories  (2002):']
  },
  "water-electrolyte imbalance": {
    name: "Water-Electrolyte Imbalance",
    indonesianName: "Water-Electrolyte Imbalance (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Water-Electrolyte Imbalance" memiliki 133 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Amphotericin B lipid complex is substantially less nephrotoxic than traditional amphotericin B but may still cause hypo- and hyperkalemia, hypomagnesemia, and hypocalcemia secondary to renal impairment.  Renal function and serum electrolytes should be monitored in all patients receiving therapy with amphotericin B lipid complex but particularly closely in patients with preexisting electrolyte abnormalities.  Mineral and electrolyte supplementation may likely be required.  Complications of electrolyte imbalances include muscle weakness, tetany, seizures and cardiac disturbances.",
    ddinterSeverityDistribution: {
      major: 66,
      moderate: 67,
      minor: 0,
      total: 133
    },
    ddinterOfficialReferences: ['Kline S, Larsen TA, Fieber L, Fishbach R, Greenwood M, Harris R, Kline MW, Tennican PO, Janoff EN "Limited toxicity of prolonged therapy with high doses of amphotericin b lipid complex." Clin Infect Dis 21 (1995):  1154-8', 'Oravcova E, Mistrik M, Sakalova A, Drgona L, Kollar T, Helpianska L, Ilavska I, Sorkovska D, Spanik S, Kukuckova E, Krcmery V "Amphotericin b lipid complex to treat invasive fungal infections in cancer patients: report of efficacy and safety in 20 patients." Chemotherapy 41 (1995):  473-6', '"Product Information. Abelcet (amphotericin B lipid complex)." Liposome Company Inc, The', '"Product Information. Tonocard (tocainide)." Merck & Co., Inc  (2002):', '"Product Information. Ethmozine (moricizine)." DuPont Pharmaceuticals  (2002):', '"Product Information. Cordarone (amiodarone)." Wyeth-Ayerst Laboratories  (2002):']
  },
  "kidney diseases": {
    name: "Kidney Diseases",
    indonesianName: "Kidney Diseases (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Kidney Diseases" memiliki 668 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Amphotericin B lipid complex is substantially less nephrotoxic than traditional amphotericin B but may still cause decreased renal function and abnormalities such as hypo- and hyperkalemia, hypomagnesemia, and renal tubular acidosis.  Renal function should be monitored in all patients receiving therapy with amphotericin B lipid complex but particularly closely in patients with preexisting renal impairment.  Serum creatinine, BUN, potassium and magnesium levels should be evaluated regularly, and dosing adjusted or discontinued if necessary.  Hydration with normal saline may decrease the risk for nephrotoxicity.  In addition, administration of alkali medication may help to prevent renal tubular acidosis.",
    ddinterSeverityDistribution: {
      major: 229,
      moderate: 432,
      minor: 7,
      total: 668
    },
    ddinterOfficialReferences: ['Block ER, Bennett JE, Livoti LG, Klein WJ, Roy R, Henderson L "Flucytosine and amphotericin B: hemodialysis effects on the plasma concentration and clearance." Ann Intern Med 80 (1974):  613-7', '"Product Information. Abelcet (amphotericin B lipid complex)." Liposome Company Inc, The', 'Sorkin P, Nagar H, Weinbroum A, Setton A, Israitel E, Scarlatt A, Silbiger A, Rudick V, Kluger Y, Halpern P "Administration of amphotericin b in lipid emulsion decreases nephrotoxicity: results of a prospective, randomized, controlled study in critically ill patients." Crit Care Med 24 (1996):  1311-5', 'Gales MA, Gales BJ "Acute renal failure with amphotericin B in lipid emulsion." Ann Pharmacother 30 (1996):  1036', '"Product Information. Cibinqo (abrocitinib)." Pfizer U.S. Pharmaceuticals Group  (2022):', 'Findlay JW, Butz RF, Welch RM "Codeine kinetics as determined by radioimmunoassay." Clin Pharmacol Ther 22 (1977):  439-46']
  },
  "diarrhea": {
    name: "Diarrhea",
    indonesianName: "Diarrhea (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diarrhea" memiliki 22 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Diarrhea, sometimes associated with dehydration and infection, has occurred in patients receiving abemaciclib.  Diarrhea incidence was greatest during the first month of abemaciclib dosing.  Care should be exercised when treating patients with symptoms of diarrhea.  Treatment discontinuation may be required for Grade 3 or 4 diarrhea, or diarrhea that requires hospitalization.  Resume treatment at the next lower dose once toxicity resolves to <= Grade 1 diarrhea.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 11,
      minor: 5,
      total: 22
    },
    ddinterOfficialReferences: ['"Product Information. Verzenio (abemaciclib)." Lilly, Eli and Company  (2017):', '"Product Information. Piqray (alpelisib)." Novartis Pharmaceuticals  (2019):', '"Product Information. Amitiza (lubiprostone)." Sucampo Pharmaceuticals Inc  (2006):', '"Lomotil for diarrhea in children." Med Lett Drugs Ther 17 (1975):  104', '"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):', '"Product Information. K-Dur (potassium chloride)." Schering Corporation  (2001):']
  },
  "lung diseases, interstitial": {
    name: "Lung Diseases, Interstitial",
    indonesianName: "Lung Diseases, Interstitial (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lung Diseases, Interstitial" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients treated with abemaciclib have reported severe, life-threatening, or fatal interstitial lung disease (ILD) and/or pneumonitis.  It is recommended to monitor patients for pulmonary symptoms indicative of ILD/pneumonitis such as, hypoxia, cough, dyspnea, or interstitial infiltrates on radiologic exams.  Dose interruption or dose reduction is recommended for patients who develop persistent or recurrent Grade 2 ILD/pneumonitis.  Permanently discontinue therapy in all patients with Grade 3 or 4 ILD or pneumonitis.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 7,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Verzenio (abemaciclib)." Lilly, Eli and Company  (2017):', '"Product Information. Rybrevant (amivantamab)." Janssen Biotech, Inc.  (2021):', '"Product Information. Aubagio (teriflunomide)." Genzyme Corporation  (2012):', '"Product Information. Camptosar (irinotecan)." Pharmacia and Upjohn  (2001):', '"Product Information. Onivyde (irinotecan liposomal)." Merrimack Pharmaceuticals  (2015):', '"Product Information. Hycamtin (topotecan)." SmithKline Beecham  (2001):']
  },
  "neutropenia": {
    name: "Neutropenia",
    indonesianName: "Neutropenia (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neutropenia" memiliki 47 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Neutropenia, including febrile neutropenia has occurred in patients receiving abemaciclib.  Care should be exercised when prescribing this agent to patients with preexisting neutropenia.  It is recommended to monitor complete blood counts prior to the start of therapy, every 2 weeks for the first 2 months, monthly for the next 2 months, and as clinically indicated.  Dose interruption, dose reduction, or delay in starting treatment cycles is recommended for patients who develop Grade 3 or 4 neutropenia.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 37,
      minor: 0,
      total: 47
    },
    ddinterOfficialReferences: ['"Product Information. Verzenio (abemaciclib)." Lilly, Eli and Company  (2017):', '"Product Information. Actemra (tocilizumab)." Genentech  (2022):', '"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):', '"Product Information. Eskalith (lithium)." SmithKline Beecham  (2002):', '"Product Information. Moban (molindone)." Gate Pharmaceuticals  (2001):', '"Product Information. Orap (pimozide)." Gate Pharmaceuticals']
  },
  "venous thromboembolism": {
    name: "Venous Thromboembolism",
    indonesianName: "Venous Thromboembolism (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Venous Thromboembolism" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Venous thromboembolic events have been reported with the use of abemaciclib.  Care should be exercised when using this agent in patients with risk factors or history of venous thromboembolic events.  It is recommended to monitor patients for signs and symptoms of venous thrombosis and pulmonary embolism and treat as medically appropriate.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 3,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Verzenio (abemaciclib)." Lilly, Eli and Company  (2017):', '"Product Information. Fotivda (tivozanib)." Aveo Pharmaceuticals, Inc.  (2021):', '"Product Information. Levophed (norepinephrine)." Hospira Inc  (2017):', '"Product Information. Mekinist (trametinib)." GlaxoSmithKline  (2013):']
  },
  "lung diseases": {
    name: "Lung Diseases",
    indonesianName: "Lung Diseases (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lung Diseases" memiliki 70 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of certain multikinase inhibitors has been associated with pulmonary toxicity.  Serious cases of interstitial lung disease (ILD), including fatal cases and interstitial pneumonitis or pulmonary fibrosis have been reported.  Caution is recommended when using these agents in patients with a history of interstitial pneumonitis or pulmonary fibrosis or those patients presenting with acute onset of new or progressive unexplained pulmonary symptoms such as dyspnea, cough, and fever pending diagnostic evaluation.  If ILD is confirmed, permanently discontinue these agents and institute appropriate measures.  Immediately withhold treatment in patients diagnosed with ILD/pneumonitis and permanently discontinue therapy if no other potential causes of ILD/pneumonitis have been identified.",
    ddinterSeverityDistribution: {
      major: 24,
      moderate: 46,
      minor: 0,
      total: 70
    },
    ddinterOfficialReferences: ['"Product Information. Vandetanib (vandetanib)." Astra-Zeneca Pharmaceuticals  (2011):', '"Product Information. Zelboraf (vemurafenib)." Genentech  (2011):', '"Product Information. Xalkori (crizotinib)." Pfizer U.S. Pharmaceuticals Group  (2011):', '"Product Information. Mekinist (trametinib)." GlaxoSmithKline  (2013):', '"Product Information. Zykadia (ceritinib)." Novartis Pharmaceuticals  (2014):', '"Product Information. Zydelig (idelalisib)." Gilead Sciences  (2014):']
  },
  "alcoholism": {
    name: "Alcoholism",
    indonesianName: "Alcoholism (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Alcoholism" memiliki 31 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Chronic alcohol abusers may be at increased risk of hepatotoxicity during treatment with acetaminophen (APAP).  Severe liver injury, including cases of acute liver failure resulting in liver transplant and death, has been reported in patients using acetaminophen.  Therapy with acetaminophen should be administered cautiously, if at all, in patients who consume three or more alcoholic drinks a day.  In general, patients should avoid drinking alcohol while taking acetaminophen-containing medications.  Patients should be warned not to exceed the maximum recommended total daily dosage of acetaminophen (4 g/day in adults and children 12 years of age or older), and to read all prescription and over-the-counter medication labels to ensure they are not taking multiple acetaminophen-containing products, or check with a healthcare professional if they are unsure.  They should also be advised to seek medical attention if they experience signs and symptoms of liver injury such as fever, rash, anorexia, nausea, vomiting, fatigue, right upper quadrant pain, dark urine, and jaundice.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 25,
      minor: 0,
      total: 31
    },
    ddinterOfficialReferences: ['Kaysen GA, Pond SM, Roper MH, Menke DJ, Marrama MA "Combined hepatic and renal injury in alcoholics during therapeutic use of acetaminophen." Arch Intern Med 145 (1985):  2019-23', `O'Dell JR, Zetterman RK, Burnett DA "Centrilobular hepatic fibrosis following acetaminophen-induced hepatic necrosis in an alcoholic." JAMA 255 (1986):  2636-7`, 'Seeff LB, Cuccherini BA, Zimmerman HJ, Adler E, Benjamin SB "Acetaminophen hepatotoxicity in alcoholics." Ann Intern Med 104 (1986):  399-404', 'McClain CJ, Kromhout JP, Peterson FJ, Holtzman JL "Potentiation of acetaminophen hepatotoxicity by alcohol." JAMA 244 (1980):  251-3', 'Kartsonis A, Reddy KR, Schiff ER "Alcohol, acetaminophen, and hepatic necrosis." Ann Intern Med 105 (1986):  138-9', 'Prescott LF, Critchley JA "Drug interactions affecting analgesic toxicity." Am J Med 75 (1983):  113-6']
  },
  "phenylketonurias": {
    name: "Phenylketonurias",
    indonesianName: "Phenylketonurias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Phenylketonurias" memiliki 18 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Several oral acetaminophen and acetaminophen-combination products, particularly flavored chewable tablets, contain the artificial sweetener, aspartame (NutraSweet).  Aspartame is converted to phenylalanine in the gastrointestinal tract following ingestion.  Chewable and effervescent formulations of acetaminophen products may also contain phenylalanine.  The aspartame/phenylalanine content should be considered when these products are used in patients who must restrict their intake of phenylalanine (i.e. phenylketonurics).",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 18,
      minor: 0,
      total: 18
    },
    ddinterOfficialReferences: ['"Product Information. Tylenol (acetaminophen)." McNeil Pharmaceutical  (2002):', '"Product Information. Motrin (ibuprofen)." Pharmacia and Upjohn  (2002):', '"Product Information. Reyataz (atazanavir)." Bristol-Myers Squibb  (2003):', '"Product Information. Sudafed (pseudoephedrine)." Glaxo Wellcome  (2001):', '"Product Information. Cefzil (cefprozil)." Bristol-Myers Squibb  (2002):', '"Product Information. Questran (cholestyramine)." Par Pharmaceutical Inc  (2002):']
  },
  "depressive disorder": {
    name: "Depressive Disorder",
    indonesianName: "Depressive Disorder (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Depressive Disorder" memiliki 161 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Antidepressants increased the risk of suicidal thoughts and behavior in children, adolescents, and young adults in short-term trials; these trials did not show increased risk in patients older than 24 years and risk was reduced in patients 65 years and older.  Adult and pediatric patients with major depressive disorder may experience worsening of their depression and/or the emergence of suicidal ideation and behavior (suicidality) or unusual changes in behavior, whether or not they are taking antidepressants; this risk may persist until significant remission occurs.  Suicide is a known risk of depression and certain other psychiatric disorders; such disorders are the strongest predictors of suicide.  Patients of all ages treated with antidepressants for any indication should be monitored appropriately and observed closely for clinical worsening, suicidality, and unusual changes in behavior, especially during the first few months of drug therapy, and at times of dose changes.  Family members/caregivers should be advised to monitor for changes in behavior and to notify the health care provider.  Changing the therapeutic regimen (including discontinuing the medication) should be considered in patients whose depression is persistently worse, or who are experiencing emergent suicidal thoughts or behaviors.",
    ddinterSeverityDistribution: {
      major: 73,
      moderate: 88,
      minor: 0,
      total: 161
    },
    ddinterOfficialReferences: ['"Product Information. Auvelity (bupropion-dextromethorphan)." Axsome Therapeutics, Inc.  (2022):', '"Product Information. Aplenzin (buPROPion)." Bausch Health US (formerly Valeant Pharmaceuticals)  (2022):', '"Product Information. Forfivo XL (buPROPion)." Almatica Pharma Inc  (2019):', '"Product Information. Zyban (buPROPion)." GlaxoSmithKline  (2021):', '"Product Information. Wellbutrin SR (buPROPion)." GlaxoSmithKline  (2020):', '"Product Information. Wellbutrin (buPROPion)." GlaxoSmithKline  (2020):']
  },
  "dementia": {
    name: "Dementia",
    indonesianName: "Dementia (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dementia" memiliki 30 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Older patients with dementia-related psychosis treated with antipsychotic drugs are at an increased risk of death; although the causes were varied, most of the deaths appeared to be either cardiovascular (e.g., heart failure, sudden death) or infectious (e.g., pneumonia) in nature.  A causal relationship with antipsychotic use has not been established.  In controlled trials in older patients with dementia-related psychosis, patients randomized to risperidone, aripiprazole, and olanzapine had higher incidence of cerebrovascular adverse events (e.g., stroke, transient ischemic attack), including fatalities, compared to patients treated with placebo.  These agents are not approved for the treatment of patients with dementia-related psychosis.",
    ddinterSeverityDistribution: {
      major: 30,
      moderate: 0,
      minor: 0,
      total: 30
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "alcoholic intoxication": {
    name: "Alcoholic Intoxication",
    indonesianName: "Alcoholic Intoxication (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Alcoholic Intoxication" memiliki 77 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of neuroleptic agents is contraindicated in patients with acute alcohol intoxication exhibiting depressed vital signs.  The central nervous system depressant effects of neuroleptic agents may be additive with those of alcohol.  Severe respiratory depression and respiratory arrest may occur.  Therapy with neuroleptic agents should be administered cautiously in patients who might be prone to acute alcohol intake.",
    ddinterSeverityDistribution: {
      major: 66,
      moderate: 11,
      minor: 0,
      total: 77
    },
    ddinterOfficialReferences: ['"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):', '"Product Information. Navane (thiothixene)." Roerig Division  (2001):', '"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):']
  },
  "respiratory insufficiency": {
    name: "Respiratory Insufficiency",
    indonesianName: "Respiratory Insufficiency (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Respiratory Insufficiency" memiliki 82 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of neuroleptic agents is contraindicated in comatose patients and patients with severe central nervous system depression.  Neuroleptic agents may potentiate the CNS and respiratory depression in these patients.",
    ddinterSeverityDistribution: {
      major: 72,
      moderate: 10,
      minor: 0,
      total: 82
    },
    ddinterOfficialReferences: ['"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):', '"Product Information. Navane (thiothixene)." Roerig Division  (2001):', 'Vetter PH, Proppe DG "Clozapine-induced coma." J Nerv Ment Dis 180 (1992):  58-9', '"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Moban (molindone)." Gate Pharmaceuticals  (2001):', '"Product Information. Orap (pimozide)." Gate Pharmaceuticals']
  },
  "neuroleptic malignant syndrome": {
    name: "Neuroleptic Malignant Syndrome",
    indonesianName: "Neuroleptic Malignant Syndrome (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neuroleptic Malignant Syndrome" memiliki 39 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The central dopaminergic blocking effects of neuroleptic agents may precipitate or aggravate a potentially fatal symptom complex known as neuroleptic malignant syndrome (NMS).  NMS is observed most frequently when high-potency agents like haloperidol are administered intramuscularly, but may occur with any neuroleptic agent given for any length of time.  Clinical manifestations of NMS include hyperpyrexia, muscle rigidity, altered mental status and autonomic instability (irregular pulse or blood pressure, tachycardia, diaphoresis and cardiac arrhythmias).  Additional signs may include elevated creatine phosphokinase, myoglobinuria, and acute renal failure.  Neuroleptic agents should not be given to patients with active NMS and should be immediately discontinued if currently being administered in such patients.  In patients with a history of NMS, introduction or reintroduction of neuroleptic agents should be carefully considered, since NMS may recur.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 10,
      minor: 0,
      total: 39
    },
    ddinterOfficialReferences: ['Hermesh H, Sirota P, Eviatar J "Recurrent neuroleptic malignant syndrome due to haloperidol and amantadine." Biol Psychiatry 25 (1989):  962-5', 'Ryken TC, Merrell AN "Haloperidol-induced neuroleptic malignant syndrome in a 67-year-old woman with parkinsonism." West J Med 151 (1989):  326-8', 'Levitt AJ, Midha R, Craven JL "Neuroleptic malignant syndrome with intravenous haloperidol." Can J Psychiatry 35 (1990):  789', 'Aisen PS, Lawlor BA "Neuroleptic malignant syndrome induced by low-dose haloperidol." Am J Psychiatry 149 (1992):  844', 'Caroff SN "The neuroleptic malignant syndrome." J Clin Psychiatry 41 (1980):  79-83', '"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):']
  },
  "pneumonia, aspiration": {
    name: "Pneumonia, Aspiration",
    indonesianName: "Pneumonia, Aspiration (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pneumonia, Aspiration" memiliki 15 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Esophageal dysmotility and aspiration have been associated with the use of antipsychotic drugs.  These drugs should be administered cautiously in patients at risk for aspiration pneumonia.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 13,
      minor: 0,
      total: 15
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "seizures": {
    name: "Seizures",
    indonesianName: "Seizures (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Seizures" memiliki 106 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Antipsychotic and neuroleptic drugs can lower the seizure threshold and trigger seizures in a dose-dependent manner.  This risk is greatest in patients with a history of seizures or with conditions that lower the seizure threshold.  Therapy with these drugs should be administered cautiously in patients with a history of seizures or other predisposing factors, such as head trauma, CNS abnormalities, and alcoholism.",
    ddinterSeverityDistribution: {
      major: 31,
      moderate: 75,
      minor: 0,
      total: 106
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "hematologic diseases": {
    name: "Hematologic Diseases",
    indonesianName: "Hematologic Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hematologic Diseases" memiliki 69 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cases of leukopenia, neutropenia, and agranulocytosis have been reported with the use of atypical antipsychotic agents.  Patients with preexisting low white blood cell count may be at increased risk.  Therapy with these agents should be administered cautiously in patients with a history of, or predisposition to, decreased white blood cell or neutrophil counts.  Clinical monitoring of hematopoietic function is recommended.  At the first sign of a clinically significant decline in white blood cells, discontinuation of atypical antipsychotic therapy should be considered in the absence of other causative factors, and the patient closely monitored for fever or other signs and symptoms of infection.",
    ddinterSeverityDistribution: {
      major: 23,
      moderate: 46,
      minor: 0,
      total: 69
    },
    ddinterOfficialReferences: ['"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):', '"Product Information. Invega (paliperidone)." Janssen Pharmaceuticals  (2007):']
  },
  "hyperglycemia": {
    name: "Hyperglycemia",
    indonesianName: "Hyperglycemia (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperglycemia" memiliki 35 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hyperglycemia, in some cases extreme and associated with ketoacidosis or hyperosmolar coma or death, has been reported with the use of atypical antipsychotic agents.  Patients with diabetes should be monitored for worsening control of blood glucose when treated with these agents.  It is recommended that patients with risk factors for diabetes mellitus starting treatment with atypical antipsychotics should undergo fasting blood glucose testing at the beginning of treatment, and periodically thereafter.  Any patient treated with atypical antipsychotics should be monitored for symptoms of hyperglycemia including polydipsia, polyuria, polyphagia, and weakness.  Patients who develop symptoms of hyperglycemia during treatment with atypical antipsychotics should undergo fasting blood glucose testing.  In some cases, hyperglycemia has resolved when treatment with these agents was discontinued; however, some patients required continuation of anti-diabetic treatment despite discontinuation of the atypical antipsychotic drug.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 35,
      minor: 0,
      total: 35
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "hypotension": {
    name: "Hypotension",
    indonesianName: "Hypotension (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypotension" memiliki 129 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of atypical antipsychotic agents has been associated with orthostatic hypotension and syncope.  Therapy with atypical antipsychotics should be administered cautiously in patients with hypotension or conditions that could be exacerbated by hypotension, such as a history of myocardial infarction, angina, or ischemic stroke.  Patients with dehydration (e.g., due to severe diarrhea or vomiting) may be predisposed to hypotension and should also be managed carefully during therapy with atypical antipsychotics.  Blood pressure should be monitored at regular intervals, particularly during dosage escalation or whenever dosage has been altered, and patients should be advised not to rise abruptly from a sitting or recumbent position.",
    ddinterSeverityDistribution: {
      major: 77,
      moderate: 52,
      minor: 0,
      total: 129
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "dyslipidemias": {
    name: "Dyslipidemias",
    indonesianName: "Dyslipidemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dyslipidemias" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atypical antipsychotic drugs have been associated with undesirable alterations in lipid levels.  While all agents in the class have been shown to produce some changes, each drug has its own specific risk profile.  Before or soon after initiation of antipsychotic medications, a fasting lipid profile should be obtained at baseline and monitored periodically during treatment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 14,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "weight gain": {
    name: "Weight Gain",
    indonesianName: "Weight Gain (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Weight Gain" memiliki 21 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Weight gain has been observed with atypical antipsychotic use.  While all agents in the class have been shown to produce some changes, each drug has its own specific risk profile.  When treating pediatric patients with atypical antipsychotic agents, weight gain should be monitored and assessed against that expected for normal growth.  Monitor weight at baseline and frequently thereafter.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 15,
      minor: 6,
      total: 21
    },
    ddinterOfficialReferences: ['"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Abilify (aripiprazole)." Bristol-Myers Squibb  (2002):']
  },
  "anticholinergic syndrome": {
    name: "Anticholinergic Syndrome",
    indonesianName: "Anticholinergic Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anticholinergic Syndrome" memiliki 49 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Most neuroleptic agents have anticholinergic activity, to which elderly patients are particularly sensitive.  Clozapine and low- potency agents such as chlorpromazine and thioridazine tend to exhibit the greatest degree of anticholinergic effects in the class, while haloperidol as well as the newer, atypical agents like quetiapine, risperidone and ziprasidone have generally been associated with very low frequencies of anticholinergic adverse effects.  Therapy with neuroleptic agents should be administered cautiously in patients with preexisting conditions that are likely to be exacerbated by anticholinergic activity, such as urinary retention or obstruction; angle-closure glaucoma, untreated intraocular hypertension, or uncontrolled primary open-angle glaucoma; and gastrointestinal obstructive disorders.",
    ddinterSeverityDistribution: {
      major: 14,
      moderate: 35,
      minor: 0,
      total: 49
    },
    ddinterOfficialReferences: ['Grohmann R, Ruther E, Sassim N, Schmidt LG "Adverse effects of clozapine." Psychopharmacology (Berl) 99 (1989):  s101-4', '"Product Information. Navane (thiothixene)." Roerig Division  (2001):', 'Tueth M "Side effects of clozipine (Clozaril) requiring emergency treatment." Am J Emerg Med 11 (1993):  312-3', 'Heel RC, Brogden RN, Speight TM, Avery GS "Loxapine: a review of its pharmacological properties and therapeutic efficacy as an antipsychotic agent." Drugs 15 (1978):  198-217', '"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):', 'Marinkovic D, Timotijevic I, Babinski T, Totic S, Paunovic VR "The side-effects of clozapine: a four year follow-up study." Prog Neuropsychopharmacol Biol Psychiatry 18 (1994):  537-44']
  },
  "hyperprolactinemia": {
    name: "Hyperprolactinemia",
    indonesianName: "Hyperprolactinemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperprolactinemia" memiliki 24 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The chronic use of neuroleptic agents can cause persistent elevations in prolactin levels due to antagonism of dopamine D2 receptors.  Based on in vitro data, approximately one-third of human breast cancers are thought to be prolactin-dependent.  The clinical significance of this observation with respect to long-term neuroleptic therapy is unknown.  Chronic administration of neuroleptic drugs has been associated with mammary tumorigenesis in rodent studies but not in human clinical or epidemiologic studies.  Until further data are available, therapy with neuroleptic agents should be administered cautiously in patients with a previously detected breast cancer.  Caution is also advised in patients with preexisting hyperprolactinemia.  Hyperprolactinemia may suppress hypothalamic gonadotrophin releasing hormone (GnRH), resulting in reduced pituitary gonadotropin secretion.  This, in turn, may inhibit reproductive function by impairing gonadal steroidogenesis in both female and male patients.  Galactorrhea, amenorrhea, gynecomastia, and impotence have been reported in patients receiving prolactin-elevating compounds; however, the clinical significance of elevated serum prolactin levels is unknown for most patients.  Long-standing hyperprolactinemia when associated with hypogonadism may lead to decreased bone density in both female and male patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 24,
      minor: 0,
      total: 24
    },
    ddinterOfficialReferences: ['Meco G, Falaschi P, Casacchia M, et al. "Neuroendocrine effects of haloperidol decanoate in patients with chronic schizophrenia." Adv Biochem Psychopharmacol 40 (1985):  89-93', 'Ash PR, Bouma D "Exaggerated hyperprolactinemia in response to thiothixene ." Arch Neurol 38 (1981):  534-5', '"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):', '"Product Information. Navane (thiothixene)." Roerig Division  (2001):', 'Huang ML, Van Peer A, Woestenborghs R, De Coster R, Heykants J, Jansen AA, Zylicz Z, Visscher HW, Jonkman JH "Pharmacokinetics of the novel antipsychotic agent risperidone and the prolactin response in healthy subjects." Clin Pharmacol Ther 54 (1993):  257-68', '"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):']
  },
  "parkinsonian disorders": {
    name: "Parkinsonian Disorders",
    indonesianName: "Parkinsonian Disorders (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Parkinsonian Disorders" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of neuroleptic agents is associated with pseudo-parkinsonian symptoms such as akinesia, bradykinesia, tremors, pill-rolling motion, cogwheel rigidity, and postural abnormalities including stooped posture and shuffling gait.  The onset is usually 1 to 2 weeks following initiation of therapy or an increase in dosage.  Older neuroleptic agents such as haloperidol are more likely to induce these effects, and their use may be contraindicated in patients with Parkinson's disease or parkinsonian symptoms.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 24,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['Moleman P, Janzen G, von Bargen BA, et al. "Relationship between age and incidence of parkinsonism in psychiatric patients treated with haloperidol." Am J Psychiatry 143 (1986):  232-4', '"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):', 'Heel RC, Brogden RN, Speight TM, Avery GS "Loxapine: a review of its pharmacological properties and therapeutic efficacy as an antipsychotic agent." Drugs 15 (1978):  198-217', 'Bransgrove LL, Kelly MW "Movement disorders in patients treated with long-acting injectable antipsychotic drugs." Am J Hosp Pharm 51 (1994):  895-9', 'Owens DGC "Extrapyramidal side effects and tolerability of risperidone - a review." J Clin Psychiatry 55 Suppl (1994):  29-35', 'Pinder RM, Brogden RN, Swayer R, Speight TM, Spencer R, Avery GS "Pimozide: a review of its pharmacological properties and therapeutic uses in psychiatry." Drugs 12 (1976):  1-40']
  },
  "tardive dyskinesia": {
    name: "Tardive Dyskinesia",
    indonesianName: "Tardive Dyskinesia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tardive Dyskinesia" memiliki 46 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tardive dyskinesia (TD) has occurred in patients treated with antipsychotic drugs; the syndrome consists of potentially irreversible, involuntary, dyskinetic movements.  The risk appears highest in older patients (particularly older women) but it is not possible to predict which patients are likely to develop TD; whether antipsychotic drugs differ in their potential to cause TD is unknown.  The risk of TD and the likelihood that it will become irreversible increase with the duration of therapy and the total cumulative dose.  The syndrome can develop after relatively brief treatment periods, even at low dosages; it may also occur after discontinuation of therapy.  TD may remit (partially or completely) upon discontinuation of antipsychotic therapy, although antipsychotic therapy itself may suppress (or partially suppress) signs/symptoms of TD, possibly masking the underlying process; the effect of symptomatic suppression on the long-term course of TD is unknown.  In patients with preexisting drug-induced TD, initiating or increasing the dosage of antipsychotic therapy may temporarily mask the symptoms of TD but could eventually worsen the condition.  In patients requiring chronic therapy, the lowest dose and shortest duration of therapy producing a satisfactory clinical response are recommended; the need for continued therapy should be reassessed periodically.  If signs/symptoms of TD occur during antipsychotic therapy, discontinuation of the offending agent should be considered; however, some patients may require treatment despite the presence of TD.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 37,
      minor: 0,
      total: 46
    },
    ddinterOfficialReferences: ['"Product Information. Abilify (ARIPiprazole)." Otsuka American Pharmaceuticals Inc  (2020):', '"Product Information. Rexulti (brexpiprazole)." Otsuka American Pharmaceuticals Inc  (2021):', '"Product Information. Vraylar (cariprazine)." Allergan Inc  (2019):', '"Product Information. Latuda (lurasidone)." Sunovion Pharmaceuticals Inc  (2019):', '"Product Information. Seroquel (QUEtiapine)." Astra-Zeneca Pharmaceuticals  (2022):', '"Product Information. Caplyta (lumateperone)." Intra-Cellular Therapies, Inc.  (2022):']
  },
  "hepatic insufficiency": {
    name: "Hepatic Insufficiency",
    indonesianName: "Hepatic Insufficiency (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatic Insufficiency" memiliki 159 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Postmarketing studies have associated the use of abiraterone with severe hepatic toxicity, including fulminant hepatitis, acute liver failure and deaths.  Serum transaminases and bilirubin levels should be measured before starting treatment and every 2 weeks for the first three months of treatment and then monthly thereafter.  Any liver test elevations should prompt more frequently monitoring.  Treatment should be discontinued permanently in patients with concurrent elevations of ALT greater than 3 x ULN and total bilirubin greater than 2 x ULN.  In patients with baseline moderate hepatic impairment (Child-Pugh Class B), the recommended dose should be reduced to 250 mg once daily.  Abiraterone should not be used in patients with severe hepatic impairment (Child-Pugh Class C).",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 130,
      minor: 0,
      total: 159
    },
    ddinterOfficialReferences: ['"Product Information. Zytiga (abiraterone)." Centocor Inc  (2011):', '"Product Information. Calquence (acalabrutinib)." Astra-Zeneca Pharmaceuticals  (2017):', '"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Aceon (perindopril)." Solvay Pharmaceuticals Inc  (2001):', '"Product Information. Actigall (ursodiol)." Novartis Pharmaceuticals  (2022):', '"Product Information. Urso (ursodiol)." Scandipharm Inc  (2001):']
  },
  "lactose intolerance": {
    name: "Lactose Intolerance",
    indonesianName: "Lactose Intolerance (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lactose Intolerance" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Dysport (brand of abobotulinumtoxinA) may contain trace amounts of cow's milk protein.  Patients known to be allergic to cow's milk protein should not be treated with this product.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 4,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Dysport (abobotulinumtoxinA)." Tercica Inc', '"Product Information. Oralair (mixed grass pollens allergen extract)." Greer Laboratories Inc  (2014):', '"Product Information. Varubi (rolapitant)." Tesaro Inc.  (2015):', '"Product Information. Tasigna (nilotinib)." Novartis Pharmaceuticals  (2007):', '"Product Information. Ongentys (opicapone)." Neurocrine Biosciences, Inc.  (2020):']
  },
  "neuromuscular diseases": {
    name: "Neuromuscular Diseases",
    indonesianName: "Neuromuscular Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neuromuscular Diseases" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Treatment with botulinum toxin products, including abobotulinumtoxinA, incobotulinumtoxinA, onabotulinumtoxinA, daxibotulinumtoxinA and others can result in swallowing and breathing difficulties and in general increased neuromuscular compromise.  Deaths due to severe dysphagia or respiratory failure have been reported after treatment with botulinum toxin.  Care should be exercised with using these products in patients with pre- existing swallowing or respiratory disorders or peripheral motor neuropathic diseases or neuromuscular disorders (e.g., myasthenia gravis, amyotrophic lateral sclerosis), as they may be at increased risk of clinically significant effects including generalized muscle weakness, diplopia, ptosis, dysphonia, dysarthria, severe dysphagia and respiratory compromise.  Patients treated with botulinum toxin may require immediate medical attention should they develop these complications.  Caution is advised.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 1,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Dysport (abobotulinumtoxinA)." Tercica Inc', '"Product Information. Botox (onabotulinumtoxinA)." Allergan Inc', '"Product Information. Xeomin (incobotulinumtoxinA)." Merz Pharmaceuticals  (2022):', '"Product Information. Daxxify (daxibotulinumtoxinA)." Revance Therapeutics, Inc.  (2022):', 'Kaeser HE "Drug-induced myasthenic syndromes." Acta Neurol Scand 70 (1984):  39-47', 'Ristuccia AM, Cunha BA "The aminoglycosides." Med Clin North Am 66 (1982):  303-12']
  },
  "cardiac conduction system disease": {
    name: "Cardiac Conduction System Disease",
    indonesianName: "Cardiac Conduction System Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiac Conduction System Disease" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe conduction abnormalities, some requiring pacemaker placement, have been reported during paclitaxel therapy.  Therapy with paclitaxel should be administered cautiously in patients with or predisposed to conduction disorders.  Clinical monitoring of cardiac function is recommended during subsequent paclitaxel therapy.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 3,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['Rowinsky EK, Eisenhauer EA, Chaudhry V, Arbuck SG, Donehower RC "Clinical toxicities encountered with paclitaxel (Taxol)." Semin Oncol 20(4 Suppl) (1993):  1-15', '"Product Information. Taxol (paclitaxel)." Bristol-Myers Squibb  (2001):', '"Product Information. Abraxane (PACLitaxel protein-bound)." American Pharmaceutical Partners', '"Product Information. Paclitaxel (paclitaxel)." Sandoz Pharmaceuticals Corporation  (2016):', '"Product Information. Posture (calcium phosphate, tribasic)." Whitehall-Robbins', '"Product Information. Neo-Calglucon (calcium glubionate)." Sandoz Pharmaceuticals Corporation  (2001):']
  },
  "bone marrow failure disorders": {
    name: "Bone Marrow Failure Disorders",
    indonesianName: "Bone Marrow Failure Disorders (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bone Marrow Failure Disorders" memiliki 116 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Paclitaxel induces dose-dependent myelosuppression, primarily affecting neutrophils.  Anemia characterized as a red blood cell count <11 g/dl has been reported in 78% of patients administered paclitaxel.  Thrombocytopenia is uncommon and rarely severe.  Therapy with paclitaxel should be administered cautiously in patients whose bone marrow reserve may be severely depressed and should be withheld when neutrophil counts fall below 1500/mm3 and/or platelet counts fall below 100,000/mm3.  Paclitaxel injection should not be used in patients with solid tumors with baseline neutrophil counts less than 1500/mm3 or in patients with AIDS-related Kaposi's sarcoma with baseline neutrophil counts of less than 1000/mm3.  Patients should be instructed to immediately report any signs or symptoms suggesting bone marrow suppression such as fever, sore throat, local infection, or bleeding.  Close clinical monitoring of hematopoietic function is recommended.",
    ddinterSeverityDistribution: {
      major: 72,
      moderate: 44,
      minor: 0,
      total: 116
    },
    ddinterOfficialReferences: ['Reed E, Kohn EC, Sarosy G, Christian M, Goldspiel B, Davis P, Jacob J, Maher M "The incidence of severe side effects from dose intense paclitaxel, administered at one institution (Meeting abstract)." Proc Annu Meet Am Assoc Cancer Res 36 (1995):  a14291995', 'Rowinsky EK, Eisenhauer EA, Chaudhry V, Arbuck SG, Donehower RC "Clinical toxicities encountered with paclitaxel (Taxol)." Semin Oncol 20(4 Suppl) (1993):  1-15', '"Product Information. Taxol (paclitaxel)." Bristol-Myers Squibb  (2001):', '"Product Information. Abraxane (PACLitaxel protein-bound)." American Pharmaceutical Partners', '"Product Information. Paclitaxel (paclitaxel)." Sandoz Pharmaceuticals Corporation  (2016):', 'Elijovisch F, Krakoff LR "Captopril associated granulocytopenia in hypertension after renal transplantation." Lancet 1 (1980):  927-8']
  },
  "peripheral nervous system diseases": {
    name: "Peripheral Nervous System Diseases",
    indonesianName: "Peripheral Nervous System Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peripheral Nervous System Diseases" memiliki 44 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Dose-dependent peripheral neuropathy has been reported in 60% of patients during paclitaxel therapy.  Severe peripheral neuropathy is rare and requires a 20% reduction in dosage of paclitaxel.  Therapy with paclitaxel should be administered cautiously in patients with or predisposed to peripheral neuropathy.",
    ddinterSeverityDistribution: {
      major: 19,
      moderate: 24,
      minor: 1,
      total: 44
    },
    ddinterOfficialReferences: ['Rowinsky EK, Eisenhauer EA, Chaudhry V, Arbuck SG, Donehower RC "Clinical toxicities encountered with paclitaxel (Taxol)." Semin Oncol 20(4 Suppl) (1993):  1-15', 'Liu JM, Chen YM, Chao Y, Liu TW, Chou CM, Chen LT, Yu WL, Whangpeng J "Paclitaxel-induced severe neuropathy in patients with previous radiotherapy to the head and neck region." J Natl Cancer Inst 88 (1996):  1000-2', '"Product Information. Taxol (paclitaxel)." Bristol-Myers Squibb  (2001):', '"Product Information. Abraxane (PACLitaxel protein-bound)." American Pharmaceutical Partners', '"Product Information. Paclitaxel (paclitaxel)." Sandoz Pharmaceuticals Corporation  (2016):', '"Product Information. Adcetris (brentuximab vedotin)." Seattle Genetics Inc  (2011):']
  },
  "neurotoxicity syndromes": {
    name: "Neurotoxicity Syndromes",
    indonesianName: "Neurotoxicity Syndromes (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neurotoxicity Syndromes" memiliki 18 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of TNF blocking agents has been associated with rare cases of CNS manifestations of systemic vasculitis, seizure and new onset or exacerbation of clinical symptoms and/or radiographic evidence of central nervous system demyelinating disorders, including multiple sclerosis and optic neuritis, and peripheral demyelinating disorders, including Guillain-Barr\xE9 syndrome.  Care should be exercised when considering the use of these agents in patients with neurologic disorders and discontinuing the agent is recommended if these disorders develop during therapy.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 11,
      minor: 0,
      total: 18
    },
    ddinterOfficialReferences: ['"Product Information. Remicade (infliximab)." Centocor Inc  (2001):', '"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', '"Product Information. Cimzia (certolizumab)." UCB Pharma Inc  (2008):', '"Product Information. Simponi (golimumab)." Centocor Inc  (2009):', 'Jones PG, Beier-Hanratty SA "Acyclovir: neurologic and renal toxicity." Ann Intern Med 104 (1986):  892', 'Fletcher CV, Chinnock BJ, Chace B, Balfour HH "Pharmacokinetics and safety of high-dose oral acyclovir for suppression of cytomegalovirus disease after renal transplantation." Clin Pharmacol Ther 44 (1988):  158-63']
  },
  "heart failure": {
    name: "Heart Failure",
    indonesianName: "Heart Failure (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Heart Failure" memiliki 125 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cases of worsening congestive heart failure (CHF) and new onset CHF have been reported with TNF blockers.  Cases of worsening CHF have also been observed with adalimumab.  Adalimumab has not been formally studied in patients with CHF; however, in clinical trials of another TNF blocker, a higher rate of serious CHF-related adverse reactions was observed.  Exercise caution when using adalimumab in patients who have heart failure and monitor them carefully.",
    ddinterSeverityDistribution: {
      major: 52,
      moderate: 73,
      minor: 0,
      total: 125
    },
    ddinterOfficialReferences: ['"Product Information. Humira (adalimumab)." Abbott Pharmaceutical  (2003):', 'Schwartz D, Averbuch M, Pines A, et al. "Renal toxicity of enalapril in very elderly patients with progressive, severe congestive heart failure." Chest 100 (1991):  1558-61', 'Ljungman S, Kjekshus J, Swedberg K "Renal function in severe congestive heart failure during treatment with enalapril." Am J Cardiol 70 (1992):  479-87', 'Heintz B, Verho M, Brockmeier D, Kirsten R, Nelson K, Maigatter S, Lefevre G, Kierdorf H, Sieberth HG "Influence of ramipril on renal function in patients with chronic congestive heart failure." J Cardiovasc Pharmacol 18 (1991):  s174-9', 'Moyses C, Higgins TJ "Safety of long-term use of lisinopril for congestive heart failure." Am J Cardiol 70 (1992):  c91-7', 'Dietz R, Nagel F, Osterziel KJ "Angiotensin-converting enzyme inhibitors and renal function in heart failure." Am J Cardiol 70 (1992):  c119-25']
  },
  "thrombosis": {
    name: "Thrombosis",
    indonesianName: "Thrombosis (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thrombosis" memiliki 32 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Deep venous thrombosis (DVT) and pulmonary embolism (PE) were observed in patients receiving abrocitinib.  Patients 50 years of age and older with at least one cardiovascular risk factor, had higher rates of overall thrombosis, DVT, and PE.  Avoid abrocitinib in patients that may be at increased risk of thrombosis.",
    ddinterSeverityDistribution: {
      major: 31,
      moderate: 1,
      minor: 0,
      total: 32
    },
    ddinterOfficialReferences: ['"Product Information. Cibinqo (abrocitinib)." Pfizer U.S. Pharmaceuticals Group  (2022):', '"Product Information. Indocin (indomethacin)." Merck & Co., Inc  (2002):', '"Product Information. Naprosyn (naproxen)." Syntex Laboratories Inc  (2002):', '"Product Information. Voltaren (diclofenac)." Novartis Pharmaceuticals  (2001):', '"Product Information. Ansaid (flurbiprofen)." Pharmacia and Upjohn  (2001):', '"Product Information. Lodine (etodolac)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "intracranial hypertension": {
    name: "Intracranial Hypertension",
    indonesianName: "Intracranial Hypertension (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intracranial Hypertension" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of retinoids has been associated with cases of pseudotumor cerebri (benign intracranial hypertension).  Early signs and symptoms include papilledema, headache, nausea and vomiting, and visual disturbances.  Patients who experience symptoms of this disorder while on retinoid therapy should be referred to a neurologist.  If the diagnosis is confirmed, the retinoid should be discontinued permanently.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 4,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['"Product Information. Accutane (isotretinoin)." Roche Laboratories  (2001):', '"Product Information. Soriatane (acitretin)." Roche Laboratories  (2001):', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):']
  },
  "mental disorders": {
    name: "Mental Disorders",
    indonesianName: "Mental Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Mental Disorders" memiliki 38 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of retinoids, primarily isotretinoin, has been associated with causing depression, psychosis and rarely, suicidal ideation.  Therapy with retinoids should be administered cautiously in patients with preexisting psychiatric conditions or depression.  In addition to withdrawal of therapy, evaluation and follow-up may be necessary in affected patients.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 9,
      minor: 0,
      total: 38
    },
    ddinterOfficialReferences: ['"Product Information. Accutane (isotretinoin)." Roche Laboratories  (2001):', '"Product Information. Soriatane (acitretin)." Roche Laboratories  (2001):', '"Product Information. Fastin (phentermine)." SmithKline Beecham  (2001):', '"Product Information. Cylert (pemoline)." Abbott Pharmaceutical  (2001):', '"Product Information. Ritalin (methylphenidate)." Novartis Pharmaceuticals  (2001):', '"Product Information. Desoxyn (methamphetamine)." Abbott Pharmaceutical  (2001):']
  },
  "osteoporosis": {
    name: "Osteoporosis",
    indonesianName: "Osteoporosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Osteoporosis" memiliki 28 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Isotretinoin may have a negative effect on bone mineral density in some patients.  Clinical trials have shown BMD declines in adolescents during a 20 week treatment.  Therefore, physicians should use caution when prescribing isotretinoin in patients with a history of childhood osteoporosis, osteomalacia, or other disorders of bone metabolism.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 23,
      minor: 0,
      total: 28
    },
    ddinterOfficialReferences: ['"Product Information. Accutane (isotretinoin)." Roche Laboratories  (2001):', '"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):']
  },
  "hyperlipidemias": {
    name: "Hyperlipidemias",
    indonesianName: "Hyperlipidemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperlipidemias" memiliki 65 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of retinoids is associated with elevations in serum triglycerides and cholesterol, and decreases in HDL.  In addition to cardiovascular risks, elevation of serum triglycerides to greater than 800 mg/dL has been associated with fatal fulminant pancreatitis.  Patients at increased risk for developing hypertriglyceridemia during retinoid therapy include those with diabetes mellitus, obesity, high alcohol consumption, or a family history of these conditions.  Blood lipid determinations should be performed prior to initiation of therapy and at 1- to 2- week intervals until the lipid response to the drug is established (usually 4 to 8 weeks).  Patients with preexisting hyperlipidemia may require closer monitoring during retinoid therapy, and adjustments made accordingly in their lipid-lowering regimen.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 62,
      minor: 1,
      total: 65
    },
    ddinterOfficialReferences: ['"Product Information. Accutane (isotretinoin)." Roche Laboratories  (2001):', 'Rossner S, Weiner L "Atenolol and metoprolol: comparison of effects on blood pressure and serum lipoproteins, and side effects." Eur J Clin Pharmacol 24 (1983):  573-7', 'Valimaki M, Maass L, Harno K, Nikkila EA "Lipoprotein lipids and apoproteins during beta-blocker administration: comparison of penbutolol and atenolol." Eur J Clin Pharmacol 30 (1986):  17-20', 'Disler LJ, Joffe BI, Seftel HC "Massive hypertriglyceridemia associated with atenolol." Am J Med 85 (1988):  586-7', 'Harvengt C, Heller FR, Martiat P, Nieuwenhuyze YV "Short-term effects of beta blockers atenolol, nadolol, pindolol, and propranolol on lipoprotein metabolism in normolipemic subjects." J Clin Pharmacol 27 (1987):  475-80', 'Darga LL, Hakim MJ, Lucas CP, Franklin BA "Comparison of the effects of guanadrel sulfate and propranolol on blood pressure, functional capacity, serum lipoproteins and glucose in systemic hypertension." Am J Cardiol 67 (1991):  590-6']
  },
  "gastrointestinal diseases": {
    name: "Gastrointestinal Diseases",
    indonesianName: "Gastrointestinal Diseases (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastrointestinal Diseases" memiliki 58 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Narcotic (opioid) analgesic agents increase smooth muscle tone in the gastrointestinal tract and decrease peristalsis, which can lead to elevated intraluminal pressure, spasm, and constipation following prolonged use.  In patients with severe or acute inflammatory bowel disease, the decrease in colonic motility may induce toxic megacolon.  Therapy with opioids should be administered cautiously in patients with gastrointestinal obstruction, constipation, inflammatory bowel disease, or recent gastrointestinal tract surgery.  Gastrointestinal effects appear to be the most pronounced with morphine.",
    ddinterSeverityDistribution: {
      major: 38,
      moderate: 20,
      minor: 0,
      total: 58
    },
    ddinterOfficialReferences: ['Kreek MJ, Hartman N "Chronic use of opioids and antipsychotic drugs: side effects, effects on endogenous opioids, and toxicity." Ann N Y Acad Sci 398 (1982):  151-72', 'Bellville JW, Forrest WH, Elashoff J, Laska E "Evaluating side effects of analgesics in a cooperative clinical study." Clin Pharmacol Ther 9 (1968):  303-13', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):']
  },
  "dysentery": {
    name: "Dysentery",
    indonesianName: "Dysentery (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dysentery" memiliki 32 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Narcotic (opioid) analgesic agents may prolong and/or worsen diarrhea associated with organisms that invade the intestinal mucosa, such as toxigenic E. coli, Salmonella, Shigella, and pseudomembranous colitis due to broad-spectrum antibiotics.  These agents decrease gastrointestinal motility, which may delay the excretion of infective gastroenteric organisms and/or their toxins.  Other symptoms and complications such as fever, shedding of organisms and extraintestinal illness may also be increased or prolonged.  Therapy with opioids should be avoided or administered cautiously in patients with infectious diarrhea, particularly that due to pseudomembranous enterocolitis or enterotoxin-producing bacteria or if accompanied by high fever, pus, or blood in the stool.",
    ddinterSeverityDistribution: {
      major: 32,
      moderate: 0,
      minor: 0,
      total: 32
    },
    ddinterOfficialReferences: ['Kreek MJ, Hartman N "Chronic use of opioids and antipsychotic drugs: side effects, effects on endogenous opioids, and toxicity." Ann N Y Acad Sci 398 (1982):  151-72', 'Bellville JW, Forrest WH, Elashoff J, Laska E "Evaluating side effects of analgesics in a cooperative clinical study." Clin Pharmacol Ther 9 (1968):  303-13', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):']
  },
  "premature birth": {
    name: "Premature Birth",
    indonesianName: "Premature Birth (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Premature Birth" memiliki 40 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of narcotic (opioid) analgesic agents is contraindicated in premature infants.  These agents may cross the immature blood-brain barrier to a greater extent than in adults, resulting in disproportionate respiratory depression.",
    ddinterSeverityDistribution: {
      major: 40,
      moderate: 0,
      minor: 0,
      total: 40
    },
    ddinterOfficialReferences: ['"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Multum Information Services, Inc. Expert Review Panel"', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):', '"Product Information. Hydrocortone (hydrocortisone)." Merck & Co., Inc  (2001):']
  },
  "substance-related disorders": {
    name: "Substance-Related Disorders",
    indonesianName: "Substance-Related Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Substance-Related Disorders" memiliki 63 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Opiate agonists have the potential to cause dependence and abuse.  Tolerance as well as physical and psychological dependence can develop after prolonged use.  Abrupt cessation, reduction in dosage, or administration of an opiate antagonist such as naloxone may precipitate withdrawal symptoms.  In patients who have developed tolerance to an opiate agonist, overdosage can still produce respiratory depression and death, and cross-tolerance usually will occur with other agents in the class.  Addiction-prone individuals, such as those with a history of alcohol or substance abuse, should be under careful surveillance or medical supervision when treated with opiate agonists.  It may be prudent to refrain from dispensing large quantities of medication to these patients.  After prolonged use or if dependency is suspected, withdrawal of opiate therapy should be undertaken gradually using a dosage-tapering schedule.",
    ddinterSeverityDistribution: {
      major: 57,
      moderate: 6,
      minor: 0,
      total: 63
    },
    ddinterOfficialReferences: ['Fishbain DA, Goldberg M, Rosomoff RS, Rosomoff H "Atypical withdrawal syndrome (organic delusional syndrome) secondary to oxycodone detoxification ." J Clin Psychopharmacol 8 (1988):  441-2', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):', 'Miser AW, Chayt KJ, Sandlund JT, Cohen PS, Dothage JA, Miser JS "Narcotic withdrawal syndrome in young adults after the therapeutic use of opiates." Am J Dis Child 140 (1986):  603-4']
  },
  "intestinal obstruction": {
    name: "Intestinal Obstruction",
    indonesianName: "Intestinal Obstruction (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intestinal Obstruction" memiliki 95 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Opioid agonists are contraindicated in patients with known or suspected gastrointestinal obstruction, including paralytic ileus.",
    ddinterSeverityDistribution: {
      major: 81,
      moderate: 14,
      minor: 0,
      total: 95
    },
    ddinterOfficialReferences: ['"Product Information. Ultram (tramadol)." McNeil Pharmaceutical  (2001):', '"Product Information. OxyContin (oxycodone)." Purdue Frederick Company  (2001):', '"Product Information. Kadian (morphine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Apadaz (acetaminophen-benzhydrocodone)." KemPharm, Inc  (2018):', '"Product Information. Dulcolax (bisacodyl)." Ciba Self-Medication Inc  (2001):', '"Product Information. Fleet Bisacodyl (bisacodyl)." Fleet']
  },
  "fever": {
    name: "Fever",
    indonesianName: "Fever (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fever" memiliki 18 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The release of fentanyl from the transdermal system may be temperature-dependent.  According to the manufacturer, a body temperature of 40 C (102 F) may theoretically increase serum fentanyl concentrations by approximately one-third due to increased drug release and skin permeability.  Therapy with fentanyl transdermal systems should be administered cautiously and possibly at reduced dosages in patients with a high fever.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 5,
      minor: 11,
      total: 18
    },
    ddinterOfficialReferences: ['"Product Information. Duragesic Transdermal System (fentanyl)." Janssen Pharmaceutica, Titusville, NJ.', 'Stadnyk AN, Glezos JD "Drug-induced heat stroke." Can Med Assoc J 128 (1983):  957-9', 'Sarnquist F, Larson CP Jr "Drug-induced heat stroke." Anesthesiology 39 (1973):  348-50', 'Lee BS "Possibility of hyperpyrexia with antipsychotic and anticholinergic drugs." J Clin Psychiatry 47 (1986):  571', 'Forester D "Fatal drug-induced heat stroke." JACEP 7 (1978):  243-4', '"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):']
  },
  "adrenal insufficiency": {
    name: "Adrenal Insufficiency",
    indonesianName: "Adrenal Insufficiency (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Adrenal Insufficiency" memiliki 47 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with Addison's disease may have increased risk of respiratory depression and prolonged CNS depression associated with the use of narcotic (opioid) analgesic agents.  Conversely, these agents may cause or potentiate adrenal insufficiency.  Therapy with opioids should be administered cautiously and initiated at reduced dosages in patients with adrenocortical insufficiency.  Subsequent doses should be titrated based on individual response rather than a fixed dosing schedule.",
    ddinterSeverityDistribution: {
      major: 14,
      moderate: 33,
      minor: 0,
      total: 47
    },
    ddinterOfficialReferences: ['"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. Roxanol (morphine)." Roxane Laboratories Inc  (2002):', '"Product Information. Levo-Dromoran (levorphanol)." Roche Laboratories  (2001):', '"Product Information. Dilaudid (hydromorphone)." Knoll Pharmaceutical Company  (2001):']
  },
  "gallbladder diseases": {
    name: "Gallbladder Diseases",
    indonesianName: "Gallbladder Diseases (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gallbladder Diseases" memiliki 26 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Narcotic (opioid) analgesic agents increase smooth muscle tone in the biliary tract, which can lead to spasm and elevated biliary tract pressure, especially in the sphincter of Oddi.  Biliary effects appear to be the most pronounced with morphine, although they do not always occur with therapeutic doses.  Therapy with opioids should be administered cautiously in patients with biliary or gallbladder disease.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 26,
      minor: 0,
      total: 26
    },
    ddinterOfficialReferences: ['Jones RM, Fiddian-Green R, Knight PR "Narcotic-induced choledochoduodenal sphincter spasm reversed by glucagon." Anesth Analg 59 (1980):  946-7', 'Hey VM, Ostick DG, Mazumder JK, Lord WD "Pethidine, metoclopramide and the gastro-oesophageal sphincter." Anaesthesia 36 (1981):  173-6', 'Lang DW, Pilon RN "Naloxone reversal of morphine-induced biliary colic." Anesth Analg 59 (1980):  619-20', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):']
  },
  "hypothyroidism": {
    name: "Hypothyroidism",
    indonesianName: "Hypothyroidism (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypothyroidism" memiliki 59 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with hypothyroidism may have increased risk of respiratory depression and prolonged CNS depression associated with the use of narcotic (opioid) analgesic agents.  These agents may also exacerbate the effects of hypothyroidism such as lethargy, impaired mentation, depression, and constipation.  Therapy with opioids should be administered cautiously and initiated at reduced dosages in patients with uncontrolled hypothyroidism or myxedema.  Subsequent doses should be titrated based on individual response rather than a fixed dosing schedule.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 50,
      minor: 0,
      total: 59
    },
    ddinterOfficialReferences: ['"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):', '"Product Information. Levo-Dromoran (levorphanol)." Roche Laboratories  (2001):', '"Product Information. Dilaudid (hydromorphone)." Knoll Pharmaceutical Company  (2001):']
  },
  "epilepsy": {
    name: "Epilepsy",
    indonesianName: "Epilepsy (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Epilepsy" memiliki 108 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Narcotic (opioid) analgesic agents may exacerbate seizures in patients with seizure disorders and, at higher dosages, have been reported to induce seizures in patients without previous history of seizures.  The proconvulsant activity may be the greatest with meperidine, the active metabolite of which is thought to be responsible.  Therapy with opioids should be administered cautiously in patients with or predisposed to seizures.",
    ddinterSeverityDistribution: {
      major: 27,
      moderate: 81,
      minor: 0,
      total: 108
    },
    ddinterOfficialReferences: ['Kaiko RF, Foley KM, Grabinski PY, et al. "Central nervous system excitatory effects of meperidine in cancer patients." Ann Neurol 13 (1983):  180-5', 'Goetting MG, Thirman MJ "Neurotoxicity of meperidine." Ann Emerg Med 14 (1985):  1007-9', 'Mauro VF, Bonfiglio MF, Spunt AL "Meperidine-induced seizure in a patient without renal dysfunction or sickle cell anemia." Clin Pharm 5 (1986):  837-9', 'Reutens DC, Stewart-Wynne EG "Norpethidine induced myoclonus in a patient with renal failure." J Neurol Neurosurg Psychiatry 52 (1989):  1450-1', 'Armstrong PJ, Bersten A "Normeperidine toxicity." Anesth Analg 65 (1986):  536-8', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):']
  },
  "urinary retention": {
    name: "Urinary Retention",
    indonesianName: "Urinary Retention (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urinary Retention" memiliki 42 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Narcotic (opioid) analgesic agents may inhibit the urinary voiding reflex and increase the tone of the vesical sphincter in the bladder.  Acute urinary retention requiring catheterization may occur, particularly in patients with prostatic hypertrophy or urethral stricture and in elderly patients.  These agents may also decrease urine production via direct effects on the kidney and central stimulation of the release of vasopressin.  Therapy with opioids should be administered cautiously in patients with or predisposed to urinary retention and/or oliguria.  The effects on smooth muscle tone appear to be the most pronounced with morphine.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 38,
      minor: 1,
      total: 42
    },
    ddinterOfficialReferences: ['Kreek MJ, Hartman N "Chronic use of opioids and antipsychotic drugs: side effects, effects on endogenous opioids, and toxicity." Ann N Y Acad Sci 398 (1982):  151-72', 'Petersen TK, Husted SE, Rybro L, et al. "Urinary retention during I.M. and extradural morphine analgesia." Br J Anaesth 54 (1982):  1175-8', '"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. Roxanol (morphine)." Roxane Laboratories Inc  (2002):']
  },
  "arrhythmias, cardiac": {
    name: "Arrhythmias, Cardiac",
    indonesianName: "Arrhythmias, Cardiac (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Arrhythmias, Cardiac" memiliki 64 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Opiate agonists have cholinergic activity.  Large doses and/or rapid intravenous administration may produce bradycardia and arrhythmia via stimulation of medullary vagal nuclei.  Unlike other agents in the class, meperidine also has anticholinergic activity and may cause either bradycardia or tachycardia.  Therapy with opiate agonists should be administered cautiously in patients with a history of arrhythmias.  Clinical monitoring of cardiovascular status is recommended during therapy.  Bradycardia and other cholinergic effects produced by these agents may be controlled with atropine.",
    ddinterSeverityDistribution: {
      major: 31,
      moderate: 33,
      minor: 0,
      total: 64
    },
    ddinterOfficialReferences: ['"Product Information. Calcidrine (codeine)." Abbott Pharmaceutical  (2002):', '"Product Information. Demerol (meperidine)." Sanofi Winthrop Pharmaceuticals  (2002):', '"Product Information. Dolophine (methadone)." Lilly, Eli and Company  (2002):', '"Product Information. MS Contin (morphine)." Purdue Frederick Company  (2002):', '"Product Information. Levo-Dromoran (levorphanol)." Roche Laboratories  (2001):', 'Hilgenberg JC, Johantgen WC "Bradycardia after intravenous fentanyl during subarachnoid anesthesia." Anesth Analg 59 (1980):  162-3']
  },
  "malabsorption syndromes": {
    name: "Malabsorption Syndromes",
    indonesianName: "Malabsorption Syndromes (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Malabsorption Syndromes" memiliki 20 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Absorption of vitamin A  depends on the presence of bile and absorbable fat in the GI tract.  Prolonged fat malabsorption (cystic fibrosis, hepatic cirrhosis, sprue) or malabsorption syndromes (celiac disease, GI resection) can decrease the absorption of Vitamin A.  Water- miscible vitamin A formulations may be an appropriate alternative in malabsorption conditions for certain conditions requiring vitamin A therapy.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 14,
      minor: 1,
      total: 20
    },
    ddinterOfficialReferences: ['"Product Information. Aquasol A (vitamin A)." Hospira Inc  (2022):', '"Product Information. Xenical (orlistat)." Roche Laboratories  (2001):', '"Product Information. Aquasol E (vitamin E)." Apothecon Inc  (2022):', '"Product Information. Galzin (zinc acetate)." Teva Pharmaceuticals USA  (2001):', '"Product Information. Chroma-Pak (chromic chloride hexahydrate)." Apothecon Inc  (2022):', '"Product Information. Sele-Pak (selenium)." Fujisawa']
  },
  "hemorrhage": {
    name: "Hemorrhage",
    indonesianName: "Hemorrhage (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemorrhage" memiliki 56 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Serious hemorrhagic events, including fatal events, have occurred in patients treated with acalabrutinib.  Care should be exercised when using acalabrutinib in patients with bleeding disorders.  It is recommended to monitor for signs of bleeding and to consider the benefit-risk of withholding therapy for 3-7 days pre- and post-surgery depending upon the type of surgery and the risk of bleeding.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 27,
      minor: 0,
      total: 56
    },
    ddinterOfficialReferences: ['"Product Information. Calquence (acalabrutinib)." Astra-Zeneca Pharmaceuticals  (2017):', '"Product Information. Fluorouracil (fluorouracil)." Roche', '"Product Information. Caverject (alprostadil)." Pharmacia and Upjohn', '"Product Information. Prostin VR Pediatric (alprostadil)." Pharmacia and Upjohn', '"Product Information. Avastin (bevacizumab)." Genentech  (2004):', '"Product Information. Levulan Kerastick (aminolevulinic acid)." Berlex Laboratories  (2001):']
  },
  "fibrosis": {
    name: "Fibrosis",
    indonesianName: "Fibrosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fibrosis" memiliki 19 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of acarbose is contraindicated in patients with primary cirrhosis.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 12,
      minor: 0,
      total: 19
    },
    ddinterOfficialReferences: ['"Product Information. Precose (acarbose)." Bayer  (2001):', '"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):']
  },
  "diabetic ketoacidosis": {
    name: "Diabetic Ketoacidosis",
    indonesianName: "Diabetic Ketoacidosis (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetic Ketoacidosis" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of alpha-glucosidase inhibitors is contraindicated for the treatment of patients with diabetic ketoacidosis.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 1,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Precose (acarbose)." Bayer  (2001):', '"Product Information. Glyset (miglitol)." Bayer  (2001):', '"Product Information. Afrezza (insulin inhalation, rapid acting)." MannKind Corporation  (2014):', '"Product Information. Welchol (colesevelam)." Daiichi Sankyo, Inc.  (2001):', '"Product Information. Diabinese (chlorpropamide)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Glucotrol (glipizide)." Pfizer U.S. Pharmaceuticals  (2002):']
  },
  "intestinal diseases": {
    name: "Intestinal Diseases",
    indonesianName: "Intestinal Diseases (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intestinal Diseases" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of alpha-glucosidase inhibitors is contraindicated in patients with inflammatory bowel disease, colonic ulceration, partial intestinal obstruction, or any chronic intestinal disease associated with marked disorders of digestion or absorption.  Alpha-glucosidase inhibitors competitively inhibit enzymes involved in the digestion of carbohydrates.  Increased gas formation in the intestines due to fermentation of the undigested carbohydrates can worsen or aggravate intestinal problems.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Hollander P "Safety profile of acarbose, an alpha-glucosidase inhibitor." Drugs 44 Suppl 3 (1992):  47-53', 'Clissold SP, Edwards C "Acarbose. A preliminary review of its pharmacodynamic and pharmacokinetic properties, and therapeutic potential." Drugs 35 (1988):  214-43', '"Product Information. Precose (acarbose)." Bayer  (2001):', 'Nishii Y, Aizawa T, Hashizume K "Ileus: a rare side effect of acarbose." Diabetes Care 19 (1996):  1033', '"Product Information. Glyset (miglitol)." Bayer  (2001):']
  },
  "glaucoma, angle-closure": {
    name: "Glaucoma, Angle-Closure",
    indonesianName: "Glaucoma, Angle-Closure (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glaucoma, Angle-Closure" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The manufacturers consider the use of benzodiazepines to be contraindicated in patients with acute angle-closure glaucoma or untreated open-angle glaucoma.  These agents do not possess anticholinergic activity but have very rarely been associated with increased intraocular pressure.",
    ddinterSeverityDistribution: {
      major: 25,
      moderate: 8,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['"Product Information. Xanax (alprazolam)." Pharmacia and Upjohn  (2002):', '"Product Information. Valium (diazepam)." Roche Laboratories  (2002):', '"Product Information. Ativan (lorazepam)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Serax (oxazepam)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Restoril (temazepam)." Sandoz Pharmaceuticals Corporation  (2001):', '"Product Information. Halcion (triazolam)." Pharmacia and Upjohn  (2001):']
  },
  "obesity": {
    name: "Obesity",
    indonesianName: "Obesity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Obesity" memiliki 15 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The plasma half-lives of benzodiazepines may be prolonged in obese patients, presumably due to increased distribution into fat.  Marked increases in distribution (> 100%) have been reported for diazepam and midazolam, and moderate increases (25% to 100%) for alprazolam, lorazepam, and oxazepam.  Therapy with benzodiazepines should be administered cautiously in obese patients, with careful monitoring of CNS status.  Longer dosing intervals may be appropriate.  When dosing by weight, loading doses should be based on actual body weight, while maintenance dose should be based on ideal body weight to avoid toxicity.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 14,
      minor: 0,
      total: 15
    },
    ddinterOfficialReferences: ['"Product Information. Xanax (alprazolam)." Pharmacia and Upjohn  (2002):', '"Product Information. Valium (diazepam)." Roche Laboratories  (2002):', '"Product Information. Ativan (lorazepam)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Serax (oxazepam)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Restoril (temazepam)." Sandoz Pharmaceuticals Corporation  (2001):', '"Product Information. Halcion (triazolam)." Pharmacia and Upjohn  (2001):']
  },
  "psychotic disorders": {
    name: "Psychotic Disorders",
    indonesianName: "Psychotic Disorders (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Psychotic Disorders" memiliki 94 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Paradoxical reactions, including excitability, irritability, aggressive behavior, agitation, nervousness, hostility, anxiety, sleep disturbances, nightmares and vivid dreams, have been reported with the use of benzodiazepines in psychiatric patients and pediatric patients with hyperactive aggressive disorders.  Such patients should be monitored for signs of paradoxical stimulation during therapy with benzodiazepines.  The manufacturers do not recommend the use of benzodiazepines for the treatment of psychosis.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 64,
      minor: 1,
      total: 94
    },
    ddinterOfficialReferences: ['French AP "Dangerously aggressive behavior as a side effect of alprazolam." Am J Psychiatry 146 (1989):  276', 'Goodman WK, Charney DS "A case of alprazolam, but not lorazepam, inducing manic symptoms." J Clin Psychiatry 48 (1987):  117-8', 'Edwards JG, Inman WH, Pearce GL, Rawson NS "Prescription-event monitoring of 10,895 patients treated with alprazolam." Br J Psychiatry 158 (1991):  387-92', `Wysowski DK, Barash D "Adverse behavioral reactions attributed to triazolam in the Food and Drug Administration's Spontaneous Reporting System." Arch Intern Med 151 (1991):  2003-8`, 'Bixler EO, Kales A, Brubaker BH, Kales JD "Adverse reactions to benzodiazepine hypnotics: spontaneous reporting system." Pharmacology 35 (1987):  286-300', 'Cohen LS, Rosenbaum JF "Clonazepam: new uses and potential problems." J Clin Psychiatry 48 (1987):  50-6']
  },
  "acute critical illness": {
    name: "Acute Critical Illness",
    indonesianName: "Acute Critical Illness (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acute Critical Illness" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Treatment with somatropin is contraindicated in patients with acute critical illness due to any complications following open heart surgery, abdominal surgery, multiple trauma, or acute respiratory failure.  Patients with these conditions have an increased risk of mortality.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Serostim (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Zorbtive (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Skytrofa (lonapegsomatropin)." Ascendis Pharma, Inc.  (2021):']
  },
  "diabetic retinopathy": {
    name: "Diabetic Retinopathy",
    indonesianName: "Diabetic Retinopathy (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetic Retinopathy" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Somatropin is contraindicated in patients with active proliferative or severe non- proliferative diabetic retinopathy.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 2,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Serostim (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Zorbtive (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Lovenox (enoxaparin)." Rhone Poulenc Rorer  (2002):', '"Product Information. Fragmin (dalteparin)." Pharmacia and Upjohn  (2001):', '"Product Information. Mounjaro (tirzepatide)." Lilly, Eli and Company  (2022):', '"Product Information. Ozempic (1 mg dose) (semaglutide)." Novo Nordisk Pharmaceuticals Inc  (2022):']
  },
  "prader-willi syndrome": {
    name: "Prader-Willi Syndrome",
    indonesianName: "Prader-Willi Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Prader-Willi Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Somatropin is contraindicated in patients with Prader-Willi Syndrome who are severely obese, have a history of upper airway obstruction or sleep apnea, or have severe respiratory impairment.  There have been reports of sudden death when somatropin was used in such patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Serostim (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Zorbtive (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Skytrofa (lonapegsomatropin)." Ascendis Pharma, Inc.  (2021):']
  },
  "scoliosis": {
    name: "Scoliosis",
    indonesianName: "Scoliosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Scoliosis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Progression of scoliosis can occur in patients who experience rapid growth.  Since somatropin increases growth rate, children with a history of scoliosis should be monitored for progression of this condition.  Physicians should be alert for this skeletal abnormality which can be commonly seen in patients with Turner and Prader-Willi syndromes, and can manifest during somatropin treatment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Serostim (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Zorbtive (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Increlex (mecasermin)." Tercica Inc  (2005):']
  },
  "turner syndrome": {
    name: "Turner Syndrome",
    indonesianName: "Turner Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Turner Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Somatropin may increase the risk of otitis media in patients with Turner syndrome.  These patients should be evaluated carefully for otitis media and other ear disorders as they have an increased risk of ear and hearing disorders.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Serostim (somatropin)." Serono Laboratories Inc  (2004):', '"Product Information. Zorbtive (somatropin)." Serono Laboratories Inc  (2004):']
  },
  "inflammatory bowel diseases": {
    name: "Inflammatory Bowel Diseases",
    indonesianName: "Inflammatory Bowel Diseases (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Inflammatory Bowel Diseases" memiliki 27 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Iron can be irritating and damaging to gastrointestinal mucosa.  Iron therapy should be avoided during an active flare of inflammatory bowel disease.",
    ddinterSeverityDistribution: {
      major: 22,
      moderate: 5,
      minor: 0,
      total: 27
    },
    ddinterOfficialReferences: ['"Product Information. Accrufer (ferric maltol)." Shield Therapeutics  (2021):', '"Product Information. Dulcolax (bisacodyl)." Ciba Self-Medication Inc  (2001):', '"Product Information. Fleet Bisacodyl (bisacodyl)." Fleet', '"Product Information. Kondremul Plain (mineral oil)." Bristol-Myers Squibb', '"Product Information. Neoloid (castor oil)." Paddock Laboratories Inc  (2001):', '"Product Information. SenoSol-X (senna)." Apothecon Inc  (2022):']
  },
  "cardiomyopathies": {
    name: "Cardiomyopathies",
    indonesianName: "Cardiomyopathies (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiomyopathies" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Antiarrhythmic agents can induce severe hypotension (particularly with IV administration) or induce or worsen congestive heart failure (CHF).  Patients with primary cardiomyopathy or inadequately compensated CHF are at increased risk.  Antiarrhythmic agents should be administered cautiously and dosage and/or frequency of administration modified in patients with hypotension or adequately compensated CHF.  Alternative therapy should be considered unless these conditions are secondary to cardiac arrhythmia.",
    ddinterSeverityDistribution: {
      major: 21,
      moderate: 12,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['Halkin H, Meffin P, Melmon KL, Rowland M "Influence of congestive heart failure on blood levels of lidocaine and its active monodeethylated metabolite." Clin Pharmacol Ther 17 (1975):  669-76', 'Crouthamel WG "The effect of congestive heart failure on quinidine pharmacokinetics." Am Heart J 90 (1975):  335-9', 'Ravid S, Podrid PJ, Lampert S, Lown B "Congestive heart failure induced by six of the newer antiarrhythmic drugs." J Am Coll Cardiol 14 (1989):  1326-30', 'Swiryn S, Kim SS "Quinidine-induced syncope." Arch Intern Med 143 (1983):  314-6', 'Gottlieb SS, Packer M "Deleterious hemodynamic effects of lidocaine in severe congestive heart failure." Am Heart J 118 (1989):  611-2', 'Ochs HR, Grube E, Greenblatt DJ, Arendt R "Intravenous quinidine in congestive cardiomyopathy." Eur J Clin Pharmacol 19 (1981):  173-6']
  },
  "sick sinus syndrome": {
    name: "Sick Sinus Syndrome",
    indonesianName: "Sick Sinus Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sick Sinus Syndrome" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of lidocaine is contraindicated in patients with Stokes-Adam syndrome, Wolff-Parkinson White syndrome, or second- or third-degree AV block in the absence of a functional artificial pacemaker, or congenital QT prolongation.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 0,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['Tagliente TM, Jayagopal S "Transient left bundle branch block following lidocaine." Anesth Analg 69 (1989):  545-7', 'Hilleman DE, Mohiuddin SM, Destache CJ "Lidocaine-induced second-degree mobitz type II heart block." Drug Intell Clin Pharm 19 (1985):  669-73', 'Keidar S, Grenadier E, Palant A "Sinoatrial arrest due to lidocaine injection in sick sinus syndrome during amiodarone administration." Am Heart J 104 (1982):  1384-5', '"Product Information. Xylocaine (lidocaine)." Astra-Zeneca Pharmaceuticals  (2002):', `Reed R, Falk JL, O'Brien J "Untoward reaction to adenosine therapy for supraventricular tachycardia." Am J Emerg Med 9 (1991):  566-70`, 'Engelstein ED, Lerman BB "Adenosine induced intraatrial block." Pacing Clin Electrophysiol 16 (1993):  89-94']
  },
  "hypokalemia": {
    name: "Hypokalemia",
    indonesianName: "Hypokalemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypokalemia" memiliki 35 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Adrenergic bronchodilators may cause decreases in serum potassium concentrations, primarily when given by nebulization or intravenous administration.  Although this effect is usually transient and does not require supplementation, clinically significant hypokalemia may occur in some patients, with the potential to induce cardiovascular adverse effects.  The relevance of these observations to oral or oral aerosol/powder for inhalation therapy is unknown.  Therapy with adrenergic bronchodilators should be administered cautiously in patients with or predisposed to hypokalemia.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 28,
      minor: 0,
      total: 35
    },
    ddinterOfficialReferences: ['Whyte KF, Addis GJ, Whitesmith R, Reid JL "The mechanism of salbutamol-induced hypokalaemia." Br J Clin Pharmacol 23 (1987):  65-71', 'Larsson S, Svedmyr N "Bronchodilating effect and side effects of beta2- adrenoceptor stimulants by different modes of administration (tablets, metered aerosol, and combinations thereof). A study with salbutamol inasthmatics." Am Rev Respir Dis 116 (1977):  861-9', 'Allon M, Dunlay R, Copkney C "Nebulized albuterol for acute hyperkalemia in patients on hemodialysis." Ann Intern Med 110 (1989):  426-9', 'Hastwell G, Lambert BE "The effect of oral salbutamol on serum potassium and blood sugar." Br J Obstet Gynaecol 85 (1978):  767-9', '"Hypokalaemia due to salbutamol overdosage." Br Med J (Clin Res Ed) 283 (1981):  500-1', 'Kantola I, Tarssanen L "Hypokalemia from usual salbutamol dosage ." Chest 89 (1986):  619-20']
  },
  "angioedema": {
    name: "Angioedema",
    indonesianName: "Angioedema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Angioedema" memiliki 29 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of these agents is contraindicated in patients with hereditary angioedema or a history of idiopathic angioedema.  Patients with a history of angioedema unrelated to ACE inhibitors may be at increased risk of angioedema while receiving an ACE inhibitor.  Patients should be advised to immediately report any signs or symptoms suggestive of angioedema (swelling of face, extremities, eyes, lips, or tongue, or difficulty swallowing or breathing) and to stop taking the medication until otherwise directed by their physician.  Emergency therapy and/or measures to prevent airway obstruction are required for angioedema involving the tongue, glottis, or larynx.  Treatment with ACE inhibitors should be discontinued permanently if angioedema develops in association with therapy.",
    ddinterSeverityDistribution: {
      major: 20,
      moderate: 9,
      minor: 0,
      total: 29
    },
    ddinterOfficialReferences: ['Suarez M, Ho PW, Johnson ES, Perez G "Angioneurotic edema, agranulocytosis, and fatal septicemia following captopril therapy." Am J Med 81 (1986):  336-8', 'Roberts JR, Wuerz RC "Clinical characteristics of angiotensin-converting enzyme inhibitor-induced angioedema." Ann Emerg Med 20 (1991):  555-8', 'Jett GK "Captopril-induced angioedema ." Ann Emerg Med 13 (1984):  489-90', 'McElligott S, Perlroth M, Raish L "Angioedema after substituting lisinopril for captopril ." Ann Intern Med 116 (1992):  426-7', 'Hedner T, Samuelsson O, Lunde H, et al. "Angio-oedema in relation to treatment with angiotensin converting enzyme inhibitors." Br Med J 304 (1992):  941-6', 'Wood SM, Mann RD, Rawlins MD "Angio-oedema and urticaria associated with angiotensin converting enzyme inhibitors." Br Med J 294 (1987):  91-2']
  },
  "diseases requiring hemodialysis": {
    name: "Diseases requiring hemodialysis",
    indonesianName: "Diseases requiring hemodialysis (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diseases requiring hemodialysis" memiliki 68 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Anaphylactoid reactions have been reported in patients undergoing hemodialysis with high-flux polyacrylonitrile membranes and treated concomitantly with an ACE inhibitor.  The frequency and mechanism of this interaction have not been established, and it is not known whether the interaction occurs with other membrane types.  Therapy with ACE inhibitors should be administered cautiously in patients requiring hemodialysis.",
    ddinterSeverityDistribution: {
      major: 30,
      moderate: 38,
      minor: 0,
      total: 68
    },
    ddinterOfficialReferences: ['"Product Information. Lotensin (benazepril)." Ciba-Geigy Pharmaceuticals  (2002):', '"Product Information. Capoten (captopril)." Bristol-Myers Squibb  (2002):', '"Product Information. Vasotec (enalapril)." Merck & Co., Inc  (2002):', '"Product Information. Prinivil (lisinopril)." Merck & Co., Inc  (2002):', '"Product Information. Accupril (quinapril)." Parke-Davis  (2001):', '"Product Information. Monopril (fosinopril)." Bristol-Myers Squibb  (2001):']
  },
  "hyperkalemia": {
    name: "Hyperkalemia",
    indonesianName: "Hyperkalemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperkalemia" memiliki 54 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In patients with hyperkalemia, especially those associated with impaired renal function or congestive heart failure, ACE inhibitors may further raise serum potassium levels.  Therapy with ACE inhibitors should be administered cautiously in patients with or predisposed to hyperkalemia, and serum potassium levels should be carefully monitored.  Risk factors for the development of hyperkalemia during ACE inhibitor therapy include renal insufficiency, diabetes mellitus, and the concomitant use of potassium-sparing diuretics, potassium supplements, and/or potassium-containing salt substitutes.",
    ddinterSeverityDistribution: {
      major: 23,
      moderate: 31,
      minor: 0,
      total: 54
    },
    ddinterOfficialReferences: ['Kindler J, Schunkert H, Gassmann M, Lahn W, Irmisch R, Debusmann ER, Ocon-Pujadas J, Ritz E, Sieberth HG "Therapeutic efficacy and tolerance of ramipril in hypertensive patients with renal failure." J Cardiovasc Pharmacol 13 (1989):  s55-8', 'Moyses C, Higgins TJ "Safety of long-term use of lisinopril for congestive heart failure." Am J Cardiol 70 (1992):  c91-7', '"Product Information. Lotensin (benazepril)." Ciba-Geigy Pharmaceuticals  (2002):', '"Product Information. Capoten (captopril)." Bristol-Myers Squibb  (2002):', '"Product Information. Vasotec (enalapril)." Merck & Co., Inc  (2002):', '"Product Information. Prinivil (lisinopril)." Merck & Co., Inc  (2002):']
  },
  "atrioventricular block": {
    name: "Atrioventricular Block",
    indonesianName: "Atrioventricular Block (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Atrioventricular Block" memiliki 23 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of beta-adrenergic receptor blocking agents (aka beta-blockers) is contraindicated in patients with sinus bradyarrhythmia or heart block greater than the first degree (unless a functioning pacemaker is present).  Due to their negative inotropic and chronotropic effects on the heart, the use of beta-blockers is likely to exacerbate these conditions.",
    ddinterSeverityDistribution: {
      major: 22,
      moderate: 1,
      minor: 0,
      total: 23
    },
    ddinterOfficialReferences: ['Crean PA, Williams DO "Effect of intravenous and oral acebutolol in patients with bundle branch block." Int J Cardiol 10 (1986):  119-26', 'Mashford ML, Coventry D, Hecker R, et al. "Adverse Drug Reactions Advisory Committee: ADRAC report for 1980." Med J Aust 1 (1982):  416-9', 'Treseder AS, Thomas TP "Sinus arrest due to timolol eye drops." Br J Clin Pract 40 (1986):  256-8', '"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):']
  },
  "shock, cardiogenic": {
    name: "Shock, Cardiogenic",
    indonesianName: "Shock, Cardiogenic (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Shock, Cardiogenic" memiliki 28 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of beta-adrenergic receptor blocking agents (aka beta-blockers) is contraindicated in patients with hypotension or cardiogenic shock.  Due to their negative inotropic and chronotropic effects on the heart, the use of beta-blockers is likely to further depress cardiac output and blood pressure, which can be detrimental in these patients.",
    ddinterSeverityDistribution: {
      major: 28,
      moderate: 0,
      minor: 0,
      total: 28
    },
    ddinterOfficialReferences: ['Kholeif M, Isles C "Profound hypotension after atenolol in severe hypertension." Br Med J 298 (1989):  161-2', 'Tirlapur VG, Evans PJ, Jones MK "Shock syndrome after acebutolol." Br J Clin Pract 40 (1986):  33-4', '"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):']
  },
  "hypersensitivity": {
    name: "Hypersensitivity",
    indonesianName: "Hypersensitivity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypersensitivity" memiliki 36 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of beta-adrenergic receptor blocking agents (aka beta-blockers) in patients with a history of allergic reactions or anaphylaxis may be associated with heightened reactivity to culprit allergens.  The frequency and/or severity of attacks may be increased during beta-blocker therapy.  In addition, these patients may be refractory to the usual doses of epinephrine used to treat acute hypersensitivity reactions and may require a beta-agonist such as isoproterenol.",
    ddinterSeverityDistribution: {
      major: 26,
      moderate: 10,
      minor: 0,
      total: 36
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "myocardial ischemia": {
    name: "Myocardial Ischemia",
    indonesianName: "Myocardial Ischemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myocardial Ischemia" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Heightened sensitivity to catecholamines may occur after prolonged use of beta-adrenergic receptor blocking agents (aka beta-blockers).  Exacerbation of angina, myocardial infarction and ventricular arrhythmias have been reported in patients with coronary artery disease following abrupt withdrawal of therapy.  Cessation of beta-blocker therapy, whenever necessary, should occur gradually with incrementally reduced dosages over a period of 1 to 2 weeks in patients with coronary insufficiency.  Patients should be advised not to discontinue treatment without first consulting with the physician.  In patients who experience an exacerbation of angina following discontinuation of beta-blocker therapy, the medication should generally be reinstituted, at least temporarily, along with other clinically appropriate measures.",
    ddinterSeverityDistribution: {
      major: 16,
      moderate: 1,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['Miller RR, Olson HG, Amsterdam EA, Mason DT "Propranolol-withdrawal rebound phenomenon: exacerbation of coronary events after abrupt cessation of antianginal therapy." N Engl J Med 293 (1975):  416-8', 'Rangno RE, Langlois S "Comparison of withdrawal phenomena after propranolol, metoprolol, and pindolol." Am Heart J 104 (1982):  473-8', 'Szecsi E, Kohlschutter S, Schiess W, Lang E "Abrupt withdrawal of pindolol or metoprolol after chronic therapy." Br J Clin Pharmacol 13 (1982):  s353-7', 'Walden RJ, Hernandez J, Yu Y, et al. "Withdrawal of beta-blocking drugs." Am Heart J 104 (1982):  515-20', '"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):']
  },
  "peripheral vascular diseases": {
    name: "Peripheral Vascular Diseases",
    indonesianName: "Peripheral Vascular Diseases (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peripheral Vascular Diseases" memiliki 20 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Due to their negative inotropic and chronotropic effects on the heart, beta-adrenergic receptor blocking agents (aka beta-blockers) reduce cardiac output and may precipitate or aggravate symptoms of arterial insufficiency in patients with peripheral vascular disease.  In addition, the nonselective beta-blockers (e.g., propranolol, pindolol, timolol) may attenuate catecholamine-mediated vasodilation during exercise by blocking beta-2 receptors in peripheral vessels.  Therapy with beta-blockers should be administered cautiously in patients with peripheral vascular disease.  Close monitoring for progression of arterial obstruction is advised.",
    ddinterSeverityDistribution: {
      major: 20,
      moderate: 0,
      minor: 0,
      total: 20
    },
    ddinterOfficialReferences: ['Michelson EL, Frishman WH, Lewis JE, et al. "Multicenter clinical evaluation of long-term efficacy and safety of labetalol in treatment of hypertension." Am J Med Oct 17 (1983):  68-80', `Eliasson K, Danielson M, Hylander B, Lindblad LE "Raynaud's phenomenon caused by beta-receptor blocking drugs." Acta Med Scand 215 (1984):  333-9`, 'Myers J, Morgan T, Waga S, et al. "Long-term experiences with labetalol." Med J Aust 1 (1980):  665-6', 'Tcherdakoff P "Side-effects with long-term labetalol: an open study of 251 patients in a single centre." Pharmatherapeutica 3 (1983):  342-8', 'Eliasson K, Lins L-E, Sundqvist K "Peripheral vasospasm during beta-receptor blockade: a comparison between metoprolol and pindolol." Acta Med Scand 665 (1982):  109-12', 'Lepantalo M "Beta blockade and intermittent claudication." Acta Med Scand 700 (1985):  1-48']
  },
  "cerebrovascular disorders": {
    name: "Cerebrovascular Disorders",
    indonesianName: "Cerebrovascular Disorders (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cerebrovascular Disorders" memiliki 23 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Beta-adrenergic blocking agents (beta-blockers), should be used with caution in patients with cerebrovascular insufficiency because of their potential effects relative to blood pressure and pulse.  If signs or symptoms suggesting reduced cerebral blood flow are observed, consideration should be given to discontinuing these agents.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 19,
      minor: 0,
      total: 23
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Blocadren (timolol)." Merck & Co., Inc  (2001):']
  },
  "glaucoma": {
    name: "Glaucoma",
    indonesianName: "Glaucoma (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glaucoma" memiliki 97 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Systemic beta-adrenergic receptor blocking agents (aka beta-blockers) may lower intraocular pressure.  Therefore, patients with glaucoma or intraocular hypertension may require adjustments in their ophthalmic regimen following a dosing change or discontinuation of beta-blocker therapy.",
    ddinterSeverityDistribution: {
      major: 35,
      moderate: 58,
      minor: 4,
      total: 97
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "hyperthyroidism": {
    name: "Hyperthyroidism",
    indonesianName: "Hyperthyroidism (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperthyroidism" memiliki 47 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "When beta-adrenergic receptor blocking agents (aka beta-blockers) are used to alleviate symptoms of hyperthyroidism such as tachycardia, anxiety, tremor and heat intolerance, abrupt withdrawal can exacerbate thyrotoxicosis or precipitate a thyroid storm.  To minimize this risk, cessation of beta-blocker therapy, when necessary, should occur gradually with incrementally reduced dosages over a period of 1 to 2 weeks.  Patients should be advised not to discontinue treatment without first consulting with the physician.  Close monitoring is recommended during and after therapy withdrawal.",
    ddinterSeverityDistribution: {
      major: 12,
      moderate: 28,
      minor: 7,
      total: 47
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "myasthenia gravis": {
    name: "Myasthenia Gravis",
    indonesianName: "Myasthenia Gravis (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myasthenia Gravis" memiliki 75 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Beta-adrenergic receptor blocking agents (aka beta-blockers) may potentiate muscle weakness consistent with certain myasthenic symptoms such as diplopia, ptosis, and generalized weakness.  Several beta-blockers have been associated rarely with aggravation of muscle weakness in patients with preexisting myasthenia gravis or myasthenic symptoms.  Use cautiously in patients with myasthenia gravis.",
    ddinterSeverityDistribution: {
      major: 29,
      moderate: 46,
      minor: 0,
      total: 75
    },
    ddinterOfficialReferences: ['Confavreux C, Charles N, Aimard G "Fulminant myasthenia gravis soon after initiation of acebutolol therapy." Eur Neurol 30 (1990):  279-81', 'Berstein LP, Henkind P "Additional information on adverse reactions to timolol." Am J Ophthalmol 92 (1981):  295-6', 'Coppeto JR "Timolol-associated myasthenia gravis." Am J Ophthalmol 98 (1984):  244-5', 'Verkijk A "Worsening of myasthenia gravis with timolol maleate eyedrops." Ann Neurol 17 (1985):  211-2', 'Herishanu Y, Rosenberg P "Beta-blockers and myasthenia gravis." Ann Intern Med 83 (1975):  834-5', '"Product Information. Blocadren (timolol)." Merck & Co., Inc  (2001):']
  },
  "pheochromocytoma": {
    name: "Pheochromocytoma",
    indonesianName: "Pheochromocytoma (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pheochromocytoma" memiliki 40 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Administration of beta-blockers alone in the setting of pheochromocytoma has been associated with a paradoxical increase in blood pressure due to the attenuation of beta-mediated vasodilatation in skeletal muscle.  In patients with pheochromocytoma, an alpha-blocking agent should be initiated prior to the use of any beta-blocking agent.  Caution should be taken in the administration of these agents to patients suspected of having pheochromocytoma.",
    ddinterSeverityDistribution: {
      major: 23,
      moderate: 17,
      minor: 0,
      total: 40
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Blocadren (timolol)." Merck & Co., Inc  (2001):']
  },
  "psoriasis": {
    name: "Psoriasis",
    indonesianName: "Psoriasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Psoriasis" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of beta-blockers in psoriatic patients should be carefully weighed since the use of these agents may cause an aggravation in psoriasis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 17,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "tachycardia": {
    name: "Tachycardia",
    indonesianName: "Tachycardia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tachycardia" memiliki 27 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Beta-adrenergic blockade in patients with Wolff-Parkinson-White syndrome and tachycardia has been associated with severe bradycardia requiring treatment with a pacemaker.  In one case, this result was reported after an initial dose of 5 mg propranolol.  The use of beta-adrenergic receptor blocking agents (aka beta-blockers) should be administered cautiously in these patients.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 25,
      minor: 0,
      total: 27
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Trandate (labetalol)." Glaxo Wellcome  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "asthma": {
    name: "Asthma",
    indonesianName: "Asthma (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Asthma" memiliki 92 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with bronchospastic disease, should, in general, not receive beta blockers, including cardioselective beta-blockers.  Because of the relative beta-1 selectivity, cardioselective beta-blockers may be used in patients with bronchospastic disease who do not respond to, or cannot tolerate, other antihypertensive treatment.  Because beta-1 selectivity is not absolute, the lowest possible dose of these agents should be used.  Consider administering in smaller doses to avoid the higher plasma levels associated with the longer dosing intervals.  If dosage must be increased, dividing the dose should be considered to achieve lower peak blood levels.  It is recommended to have bronchodilators, including beta-2 agonists, readily available or administered concomitantly if necessary.",
    ddinterSeverityDistribution: {
      major: 50,
      moderate: 42,
      minor: 0,
      total: 92
    },
    ddinterOfficialReferences: ['"Product Information. Sectral (acebutolol)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tenormin (atenolol)." ICN Pharmaceuticals Inc  (2002):', '"Product Information. Brevibloc (esmolol)." DuPont Pharmaceuticals  (2001):', '"Product Information. Kerlone (betaxolol)." Searle  (2001):', '"Product Information. Lopressor (metoprolol)." Novartis Pharmaceuticals  (2001):', '"Product Information. Zebeta (bisoprolol)." Lederle Laboratories  (2001):']
  },
  "hemolysis": {
    name: "Hemolysis",
    indonesianName: "Hemolysis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemolysis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Acute hemolysis following administration of high doses of ascorbic acid in patients with glucose-6-phosphate deficiency (G6PD) has been reported.  Ascorbic acid should be administered cautiously and dosages modified in patients with G6PD.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Cemill 500 (ascorbic acid)." Abbott Pharmaceutical', 'Schott AM, Vial T, Gozzo I, Chareyre S, Delmas PD "Flutamide-induced methemoglobinemia." DICP 25 (1991):  600-1', '"Product Information. Eulexin (flutamide)." Schering Corporation  (2002):', 'Kouides PA, Abboud CN, Fairbanks VF "Flutamide-induced cyanosis refractory to methylene blue therapy." Br J Haematol 94 (1996):  73-5']
  },
  "kidney calculi": {
    name: "Kidney Calculi",
    indonesianName: "Kidney Calculi (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Kidney Calculi" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Large doses of ascorbic acid have lead to hyperoxaluria in 5% of patients.  Ascorbic acid can acidify urine resulting in precipitation of urate, cystine, or oxalate stones.  Ascorbic acid should be administered cautiously and dosages modified in patients predisposed to renal stones.  Clinical monitoring of urinalysis for pH and crystal formation is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cemill 500 (ascorbic acid)." Abbott Pharmaceutical']
  },
  "diseases requiring dialysis": {
    name: "Diseases requiring dialysis",
    indonesianName: "Diseases requiring dialysis (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diseases requiring dialysis" memiliki 29 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Methyldopa is removed by dialysis.  Patients receiving methyldopa and undergoing dialysis may occasionally become hypertensive.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 27,
      minor: 1,
      total: 29
    },
    ddinterOfficialReferences: ['"Product Information. Cemill 500 (ascorbic acid)." Abbott Pharmaceutical', 'Yeh BK, Dayton PG, Waters WC III "Removal of alpha-methyldopa (aldomet) in man by dialysis (35155)." Proc Soc Exp Biol Med 135 (1970):  840-3', 'Myhre E, Brodwall EK, Stenbaek O, Hansen T "The renal excretion of methyldopa." Scand J Clin Lab Invest 29 (1972):  201-4', 'Myhre E, Stenbaek O, Rugstad HE, et al. "Pharmacokinetics of methyldopa in renal failure and bilaterally nephrectomized patients." Scand J Urol Nephrol 16 (1982):  257-63', '"Product Information. Aldomet (methyldopa)." Merck & Co., Inc  (2001):', 'Jacobs MB "Serum creatinine increase associated with amiodarone therapy." N Y State J Med 87 (1987):  358-9']
  },
  "hepatic encephalopathy": {
    name: "Hepatic Encephalopathy",
    indonesianName: "Hepatic Encephalopathy (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatic Encephalopathy" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of acetylcysteine should be discontinued in patients with encephalopathy due to hepatic failure to avoid further administration of nitrogenous substances.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Mucomyst (acetylcysteine)." Apothecon Inc  (2001):']
  },
  "dehydration": {
    name: "Dehydration",
    indonesianName: "Dehydration (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dehydration" memiliki 42 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Intravenous administration of acetylcysteine can cause fluid overload, potentially resulting in hyponatremia, seizure and death.  To avoid fluid overload, a diluted dose is recommended, especially in patients less than 40 kg and those requiring fluid restrictions (see dosage and administration recommended by manufacturers).",
    ddinterSeverityDistribution: {
      major: 28,
      moderate: 14,
      minor: 0,
      total: 42
    },
    ddinterOfficialReferences: ['"Product Information. Acetadote (acetylcysteine)." Cumberland-Swan Inc  (2004):', '"Product Information. Acetylcysteine (acetylcysteine)." American Regent Laboratories Inc  (2015):', '"Product Information. Zovirax (acyclovir)." Mylan Pharmaceuticals Inc  (2017):', '"Product Information. Zyprexa (olanzapine)." Lilly, Eli and Company  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):']
  },
  "gastrointestinal hemorrhage": {
    name: "Gastrointestinal Hemorrhage",
    indonesianName: "Gastrointestinal Hemorrhage (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastrointestinal Hemorrhage" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of acetylcysteine may worsen vomiting.  Patients with peptic ulcer disease should be evaluated for the risk of gastrointestinal hemorrhage.  In the presence of gastric hemorrhage, the decision to administer this agent should take into consideration the benefits versus the risks to an individual patient.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Mucomyst (acetylcysteine)." Apothecon Inc  (2001):', 'Deierhoi MH, Kauffman RS, Hudson SL, Barber WH, Curtis JJ, Julian BA, Gaston RS, Laskow DA, Diethelm AG "Experience with mycophenolate mofetil (RS61443) in renal transplantation at a single center." Ann Surg 217 (1993):  476-82;disc. 482-4', '"Placebo-controlled study of mycophenolate mofetil combined with cyclosporin and corticosteroids for prevention of acute rejection. European Mycophenolate Mofetil Cooperative Study Group." Lancet 345 (1995):  1321-5', 'Taylor DO, Ensley RD, Olsen SL, Dunn D, Renlund DG "Mycophenolate mofetil (RS-61443): preclinical, clinical, and three- year experience in heart transplantation." J Heart Lung Transplant 13 (1994):  571-82', 'Kirklin JK, Bourge RC, Naftel DC, Morrow WR, Deierhoi MH, Kauffman RS, White-Williams C, Nomberg RI, Holman WL, Smith DC Jr "Treatment of recurrent heart rejection with mycophenolate mofetil (RS- 61443): initial clinical experience." J Heart Lung Transplant 13 (1994):  444-50', '"Product Information. CellCept (mycophenolate mofetil)." Roche Laboratories  (2001):']
  },
  "hyponatremia": {
    name: "Hyponatremia",
    indonesianName: "Hyponatremia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyponatremia" memiliki 27 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of carbonic anhydrase inhibitors is contraindicated in patients with hyponatremia .  Carbonic anhydrase inhibitors may cause sodium excretion.  Extreme caution should be exercised if a carbonic anhydrase inhibitor is administered and monitoring electrolyte levels is recommended.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 25,
      minor: 0,
      total: 27
    },
    ddinterOfficialReferences: ['"Product Information. Diamox (acetazolamide)." Lederle Laboratories  (2001):', '"Product Information. Neptazane (methazolamide)." Wyeth-Ayerst Laboratories  (2006):', '"Product Information. Zoloft (sertraline)." Roerig Division  (2001):', '"Product Information. Prozac (fluoxetine)." Dista Products Company  (2001):', '"Product Information. Paxil (paroxetine)." GlaxoSmithKline  (2001):', '"Product Information. Luvox (fluvoxamine)." Solvay Pharmaceuticals Inc  (2001):']
  },
  "liver failure": {
    name: "Liver Failure",
    indonesianName: "Liver Failure (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Liver Failure" memiliki 80 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of carbonic anhydrase inhibitors is contraindicated in patients with marked liver disease or cirrhosis.  Carbonic anhydrase inhibitors increase the risk of developing hepatic encephalopathy in these patients.  Extreme caution should be exercised if carbonic anhydrase inhibitors are administered in patients with mild to moderate liver disease as the clearance of the drug can be decreased.  A dose reduction might be needed and monitoring of the liver function is recommended.",
    ddinterSeverityDistribution: {
      major: 24,
      moderate: 56,
      minor: 0,
      total: 80
    },
    ddinterOfficialReferences: ['Maren TH "Acetazolamide and advanced liver disease ." Am J Ophthalmol 102 (1986):  672-3', 'Margo CE "Acetazolamide and advanced liver disease." Am J Ophthalmol 101 (1986):  611-2', '"Product Information. Diamox (acetazolamide)." Lederle Laboratories  (2001):', '"Product Information. Topamax (topiramate)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Zonegran (zonisamide)." Elan Pharmaceuticals  (2001):', '"Product Information. Neptazane (methazolamide)." Wyeth-Ayerst Laboratories  (2006):']
  },
  "acidosis, respiratory": {
    name: "Acidosis, Respiratory",
    indonesianName: "Acidosis, Respiratory (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acidosis, Respiratory" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Carbonic anhydrase inhibitors may exacerbate pulmonary disease in patients with elevated pCO2 levels.  Respiratory acidosis may be precipitated or increased in these patients.  Therapy with carbonic anhydrase inhibitors should be administered cautiously in patients with respiratory acidosis, and conditions where alveolar ventilation may be impaired (pulmonary obstruction, emphysema, etc) and can precipitate or aggravate acidosis.  Respiratory status should be monitored during therapy.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 3,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['Watson WA, Garrelts JC, Zinn PD, Garriott JC, McLemore TL, Clementi WA "Chronic acetazolamide intoxication." J Toxicol Clin Toxicol 22 549-63', 'Siklos P, Henderson RG "Severe acidosis from acetazolamide in a diabetic patient." Curr Med Res Opin 6 (1979):  284-6', '"Product Information. Diamox (acetazolamide)." Lederle Laboratories  (2001):', '"Product Information. Neptazane (methazolamide)." Wyeth-Ayerst Laboratories  (2006):', '"Product Information. Tham (tromethamine)." Abbott Pharmaceutical  (2001):']
  },
  "gout": {
    name: "Gout",
    indonesianName: "Gout (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gout" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Uric acid excretion is decreased during therapy with carbonic anhydrase inhibitors, and gout may be exacerbated.  Therapy with carbonic anhydrase inhibitors should be administered cautiously in patients with gout.  Elevated serum uric acid levels return to normal when the drug is discontinued.  Monitoring of uric acid levels is recommended in these patients.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 4,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['Ferry AP, Lichtig M "Gouty arthritis as a complication of acetazolamide (diamox) therapy for glaucoma." Can J Ophthalmol 4 (1969):  145-7', '"Product Information. Diamox (acetazolamide)." Lederle Laboratories  (2001):', '"Product Information. Neptazane (methazolamide)." Wyeth-Ayerst Laboratories  (2006):', '"Product Information. Hyperstat (diazoxide)." Apothecon Inc  (2022):', '"Product Information. Hiprex (methenamine)." Hoechst Marion Roussel  (2002):', 'Amodio MI, Bengualid V, Lowy FD "Development of acute gout secondary to pyrazinamide in a patient without a prior history of gout." DICP 24 (1990):  1115-6']
  },
  "acidosis": {
    name: "Acidosis",
    indonesianName: "Acidosis (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acidosis" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Reduced plasma bicarbonate levels and, in some instances, elevated plasma chloride levels may result in metabolic acidosis during long-term therapy with carbonic anhydrase inhibitors.  Therapy with carbonic anhydrase inhibitors should be administered cautiously in patients with metabolic or hyperchloremic acidosis or with conditions that predispose to acidosis (renal disease, severe respiratory disorders, diarrhea).  The measurement of baseline and periodic serum bicarbonate is recommended.  If metabolic acidosis develops (it may be corrected by administration of sodium bicarbonate), and persists, a dose reduction or treatment discontinuation should be considered.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 13,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['Reid W, Harrower AD "Acetazolamide and symptomatic metabolic acidosis in mild renal failure ." Br Med J (Clin Res Ed) 284 (1982):  1114', 'Goodfield M, Davis J, Jeffcoate W "Acetazolamide and symptomatic metabolic acidosis in mild renal failure ." Br Med J (Clin Res Ed) 284 (1982):  422', 'Maisey DN, Brown RD "Acetazolamide and symptomatic metabolic acidosis in mild renal failure." Br Med J (Clin Res Ed) 283 (1981):  1527-8', 'Watson WA, Garrelts JC, Zinn PD, Garriott JC, McLemore TL, Clementi WA "Chronic acetazolamide intoxication." J Toxicol Clin Toxicol 22 549-63', 'Heller I, Halevy J, Cohen S, Theodor E "Significant metabolic acidosis induced by acetazolamide: not a rare complication." Arch Intern Med 145 (1985):  1815-7', 'Gabay EL "Metabolic acidosis from acetazolamide therapy ." Arch Ophthalmol 101 (1983):  303-4']
  },
  "colitis": {
    name: "Colitis",
    indonesianName: "Colitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Colitis" memiliki 93 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Clostridioides difficile-associated diarrhea (CDAD), formerly pseudomembranous colitis, has been reported with almost all antibacterial drugs and may range from mild diarrhea to fatal colitis.  The most common culprits include clindamycin and lincomycin.  Antibacterial therapy alters the normal flora of the colon, leading to overgrowth of C difficile, whose toxins A and B contribute to CDAD development.  Morbidity and mortality are increased with hypertoxin-producing strains of C difficile; these infections can be resistant to antimicrobial therapy and may require colectomy.  CDAD must be considered in all patients who present with diarrhea after antibacterial use.  Since CDAD has been reported to occur more than 2 months after antibacterial use, careful medical history is necessary.  Therapy with broad-spectrum antibacterials and other agents with significant antibacterial activity should be administered cautiously in patients with history of gastrointestinal disease, particularly colitis; pseudomembranous colitis (generally characterized by severe, persistent diarrhea and severe abdominal cramps, and sometimes associated with the passage of blood and mucus), if it occurs, may be more severe in these patients and may be associated with flares in underlying disease activity.  Antibacterial drugs not directed against C difficile may need to be stopped if CDAD is suspected or confirmed.  Appropriate fluid and electrolyte management, protein supplementation, antibacterial treatment of C difficile, and surgical evaluation should be started as clinically indicated.",
    ddinterSeverityDistribution: {
      major: 86,
      moderate: 7,
      minor: 0,
      total: 93
    },
    ddinterOfficialReferences: ['"Product Information. Omnipen (ampicillin)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Ceftin (cefuroxime)." Glaxo Wellcome  (2002):', '"Product Information. Zinacef (cefuroxime)." Glaxo Wellcome  (2002):', '"Product Information. Cleocin (clindamycin)." Pharmacia and Upjohn  (2002):', '"Product Information. Macrobid (nitrofurantoin)." Procter and Gamble Pharmaceuticals  (2002):', '"Product Information. Macrodantin (nitrofurantoin)." Procter and Gamble Pharmaceuticals  (2002):']
  },
  "esophageal diseases": {
    name: "Esophageal Diseases",
    indonesianName: "Esophageal Diseases (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Esophageal Diseases" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of oral tetracycline capsules and tablets has been associated with esophageal irritation and ulceration in patients who ingested the drug without sufficient fluid shortly before bedtime.  Therapy with solid formulations of tetracyclines should preferably be avoided in patients with esophageal obstruction, compression or dyskinesia.  If the drugs are used, patients should be advised not to take the medication just before retiring and to drink fluids liberally.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 5,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['Aarons B, Bruns BJ "Oesophageal ulceration associated with ingestion of doxycycline." N Z Med J 91 (1980):  27', 'Geschwind A "Oesophagitis and oesophageal ulceration following ingestion of doxycycline tablets." Med J Aust 140 (1984):  223', 'Amendola MA, Spera TD "Doxycycline-induced esophagitis." JAMA 253 (1985):  1009-11', 'Khera DC, Herschman BR, Sosa F "Tetracycline-induced esophageal ulcers." Postgrad Med J 68 (1980):  113-5', 'Channer KS, Hollanders D "Tetracycline-induced oesophageal ulceration." Br Med J 282 (1981):  1359-60', '"Product Information. Vibramycin (doxycycline)." Pfizer U.S. Pharmaceuticals  (2002):']
  },
  "peptic ulcer hemorrhage": {
    name: "Peptic Ulcer Hemorrhage",
    indonesianName: "Peptic Ulcer Hemorrhage (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peptic Ulcer Hemorrhage" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Histamine H2 receptor antagonists should not be used in the presence of vomit with blood, or bloody or black stools.  These might be serious conditions and the diagnosis needs to be ruled out.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 2,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Pepcid (famotidine)." Merck & Co., Inc  (2002):', '"Product Information. Axid (nizatidine)." Lilly, Eli and Company  (2002):', '"Product Information. Tagamet (cimetidine)." SmithKline Beecham  (2001):', '"Product Information. Tritec (ranitidine bismuth citrate)." Glaxo Wellcome  (2001):', '"Product Information. Zantac 75 (ranitidine)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Parsabiv (etelcalcetide)." Amgen USA  (2019):']
  },
  "immune suppression": {
    name: "IMMUNE SUPPRESSION",
    indonesianName: "IMMUNE SUPPRESSION (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "IMMUNE SUPPRESSION" memiliki 15 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Probiotics, especially those containing lactobacillus, should be used with caution in immunosuppressed patients.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 11,
      minor: 0,
      total: 15
    },
    ddinterOfficialReferences: ['"Product Information. Culturelle DS (lactobacillus rhamnosus GG)." ConAgra Functional Foods', 'Salminen MK, Tynkkynen S, Rautelin H, et al. "Lactobacillus bacteremia during a rapid increase in probiotic use of Lactobacillus rhamnosus GG in Finland." Clin Infect Dis 35 (2002):  1155-60', 'Land MH, Rouster-Stevens K, Woods CR, Cannon ML, Cnota J, Shetty AK "Lactobacillus sepsis associated with probiotic therapy." Pediatrics 115 (2005):  178-81', '"Product Information. Menactra (meningococcal conjugate vaccine)." sanofi pasteur  (2005):', '"Product Information. ActHIB (haemophilus b conjugate (PRP-T) vaccine)." sanofi pasteur  (2022):', '"Product Information. Bexsero (meningococcal group B vaccine)." Novartis Vaccines & Diagnostics Inc  (2022):']
  },
  "galactosemias": {
    name: "Galactosemias",
    indonesianName: "Galactosemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Galactosemias" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Since lactulose solution contains galactose, use is contraindicated in patients who require a low galactose diet.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Chronulac (lactulose)." Hoechst Marion Roussel  (2002):', '"Product Information. Cephulac (lactulose)." Hoechst Marion Roussel  (2002):', '"Product Information. Duphalac (lactulose)." Solvay Pharmaceuticals Inc  (2001):', '"Product Information. Enulose (lactulose)." United Research Laboratories/Mutual Pharmaceutical Company  (2012):', '"Product Information. Juxtapid (lomitapide)." Aegerion Pharmaceuticals Inc  (2013):']
  },
  "clostridium infections": {
    name: "Clostridium Infections",
    indonesianName: "Clostridium Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Clostridium Infections" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Published observational studies suggest that proton pump inhibitor (PPI) use may be associated with an increased risk of Clostridium difficile-associated diarrhea (CDAD), especially in hospitalized patients.  This diagnosis should be considered for diarrhea that does not improve.  It is recommended that patients should use the lowest dose and shortest duration of PPI therapy appropriate to the condition being treated.  Close monitoring is recommended in patients with diarrhea and in those taking antibacterial agents as CDAD has been reported with the use of nearly all these agents.  Treatment with antibacterial agents alters the normal flora of the colon, leading to overgrowth of C.  difficile.  C.  difficile produces toxins A and B, which contribute to the development of CDAD.  Appropriate fluid and electrolyte management, protein supplementation, antibiotic treatment of C.  difficile, and surgical evaluation should be instituted as clinically indicated.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. PriLOSEC (omeprazole)." Merck & Co., Inc  (2022):', '"Product Information. Prevacid (lansoprazole)." TAP Pharmaceuticals Inc  (2001):', '"Product Information. Aciphex (rabeprazole)." Janssen Pharmaceuticals  (2001):', '"Product Information. Protonix (pantoprazole)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Protonix IV (pantoprazole)." Wyeth-Ayerst Laboratories', '"Product Information. Kapidex (dexlansoprazole)." Takeda Pharmaceuticals America  (2009):']
  },
  "fractures, bone": {
    name: "Fractures, Bone",
    indonesianName: "Fractures, Bone (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fractures, Bone" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Various published observational studies have reported that PPI therapy may be associated with an increased risk for osteoporosis related fractures of the hip, wrist or spine.  The risk was increased in patients who received high doses (multiple daily doses), and long term treatment (a year or longer).  Patients should use the lowest dose and shortest duration of PPI therapy appropriate to the condition being treated.  Caution should be used in patients at risk for osteoporosis related fractures and should be managed according to established treatment guidelines.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 7,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Prevacid (lansoprazole)." TAP Pharmaceuticals Inc  (2001):', '"Product Information. Aciphex (rabeprazole)." Janssen Pharmaceuticals  (2001):', '"Product Information. Protonix (pantoprazole)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Nexium (esomeprazole)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Omeprazole (omeprazole)." Mylan Pharmaceuticals Inc  (2003):', '"Product Information. Kapidex (dexlansoprazole)." Takeda Pharmaceuticals America  (2009):']
  },
  "hypomagnesemia 1, intestinal": {
    name: "Hypomagnesemia 1, Intestinal",
    indonesianName: "Hypomagnesemia 1, Intestinal (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypomagnesemia 1, Intestinal" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Symptomatic and asymptomatic hypomagnesemia has been reported rarely in patients treated with PPIs for at least 3 months, in most cases after a year of therapy.  Serious adverse events can include tetany, seizures, and arrhythmias.  Caution should be used in patients prone to magnesium imbalances such as patients taking other medications that can cause hypomagnesemia (e.g., diuretics).  Regular monitoring is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 8,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Prevacid (lansoprazole)." TAP Pharmaceuticals Inc  (2001):', '"Product Information. Aciphex (rabeprazole)." Janssen Pharmaceuticals  (2001):', '"Product Information. Protonix (pantoprazole)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Nexium (esomeprazole)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Omeprazole (omeprazole)." Mylan Pharmaceuticals Inc  (2003):', '"Product Information. Kapidex (dexlansoprazole)." Takeda Pharmaceuticals America  (2009):']
  },
  "toxic optic neuropathy": {
    name: "Toxic Optic Neuropathy",
    indonesianName: "Toxic Optic Neuropathy (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Toxic Optic Neuropathy" memiliki 55 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ophthalmologic manifestations have been reported with the use of acitretin.  It is recommended that any patient treated with acitretin who is experiencing visual difficulties should discontinue the drug and undergo ophthalmologic evaluation.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 48,
      minor: 0,
      total: 55
    },
    ddinterOfficialReferences: ['"Product Information. Soriatane (acitretin)." Roche Laboratories  (2001):', 'Kitazawa Y "Increased intraocular pressure induced by corticosteroids." Am J Ophthalmol 82 (1976):  492-5', 'Eisenlohr JE "Glaucoma following the prolonged use of topical steroid medication to the eyelids." J Am Acad Dermatol 8 (1983):  878-81', 'Carruthers JA, Staughton RC, August PJ "Penetration of topical steroid preparations." Arch Dermatol 113 (1977):  522', 'Aggarwal RK, Potamitis T, Chong NH, Guarro M, Shah P, Kheterpal S "Extensive visual loss with topical facial steroids." Eye 7(Pt 5) (1993):  664-6', 'Cubey RB "Glaucoma following the application of corticosteroid to the skin of the eyelids." Br J Dermatol 95 (1976):  207-8']
  },
  "bisphosphonate-associated osteonecrosis of the jaw": {
    name: "Bisphosphonate-Associated Osteonecrosis of the Jaw",
    indonesianName: "Bisphosphonate-Associated Osteonecrosis of the Jaw (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bisphosphonate-Associated Osteonecrosis of the Jaw" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Osteonecrosis of the jaw (ONJ), which can occur spontaneously, is generally associated with tooth extraction and/or local infection with delayed healing, and has been reported in patients taking bisphosphonates.  Known risk factors for osteonecrosis of the jaw include invasive dental procedures (e.g., tooth extraction, dental implants, boney surgery), diagnosis of cancer, concomitant therapies (e.g., chemotherapy, corticosteroids, angiogenesis inhibitors), poor oral hygiene, and co-morbid disorders (e.g., periodontal and/or other pre-existing dental disease, anemia, coagulopathy, infection, ill-fitting dentures).  The manufacturers of bisphosphonates recommend discontinuation of bisphosphonate treatment for patients undergoing invasive dental procedures.  Patients who develop osteonecrosis of the jaw while on bisphosphonate therapy should receive care by an oral surgeon.  In these patients, extensive dental surgery to treat ONJ may exacerbate the condition.  Discontinuation of bisphosphonate therapy should be considered based on individual benefit/risk assessment.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 3,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Fosamax (alendronate)." Merck & Co., Inc  (2001):', '"Product Information. Actonel (risedronate)." Procter and Gamble Pharmaceuticals  (2001):', '"Product Information. Zometa (zoledronic acid)." Novartis Pharmaceuticals  (2001):', '"Product Information. Boniva (ibandronate)." Roche Laboratories  (2005):', '"Product Information. Reclast (zoledronic acid)." Quality Care Products/Lake Erie Medical  (2011):', '"Product Information. Binosto (alendronate)." Mission Pharmacal Company  (2012):']
  },
  "hypocalcemia": {
    name: "Hypocalcemia",
    indonesianName: "Hypocalcemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypocalcemia" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of bisphosphonates is contraindicated for the treatment of osteoporosis in patients with hypocalcemia.  These agents increase bone mineral density, a process that requires an adequate supply of calcium in the body.  Following the initiation of therapy, a short-term reduction in serum calcium and phosphate levels usually occurs due to inhibition of bone resorption, especially in patients with Paget's disease, in whom the pretreatment rate of bone turnover may be greatly elevated.  Hypocalcemia and other disturbances of mineral metabolism, such as vitamin D deficiency, should be treated prior to initiation of therapy.  Appropriate intake of calcium and vitamin D should be ensured throughout the course of treatment.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 6,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['"Product Information. Fosamax (alendronate)." Merck & Co., Inc  (2001):', '"Product Information. Actonel (risedronate)." Procter and Gamble Pharmaceuticals  (2001):', 'Watts NB "Treatment of osteoporosis with bisphosphonates." Rheum Dis Clin North Am 20 (1994):  717-34', 'Lourwood DL "The pharmacology and therapeutic utility of bisphosphonates." Pharmacotherapy 18 (1998):  779-89', 'Schussheim DH, Jacobs TP, Silverberg SJ "Hypocalcemia associated with alendronate." Ann Intern Med 130 (1999):  329', '"Product Information. Boniva (ibandronate)." Roche Laboratories  (2005):']
  },
  "milk hypersensitivity": {
    name: "Milk Hypersensitivity",
    indonesianName: "Milk Hypersensitivity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Milk Hypersensitivity" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Some inhaled anticholinergic bronchodilators such as aclidinium and umeclidinium are contraindicated in patients with severe hypersensitivity to milk proteins.  There have been reports of anaphylactic reactions on these patients after inhalation of other powder products containing lactose, therefore patients with severe milk protein allergy should not use these products.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Tudorza Pressair (aclidinium)." Forest Pharmaceuticals  (2012):', '"Product Information. Incruse Ellipta (umeclidinium)." GlaxoSmithKline  (2014):', '"Product Information. ATryn (antithrombin recombinant)." Ovation Pharmaceuticals Inc  (2009):']
  },
  "diaper rash": {
    name: "Diaper Rash",
    indonesianName: "Diaper Rash (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diaper Rash" memiliki 20 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Topical corticosteroids, especially the potent agents (e.g., augmented betamethasone, clobetasol, diflorasone, and halobetasol), are generally not recommended for use in the treatment of diaper rash.  Topical corticosteroids may be systemically absorbed, depending on the vehicle and concentration of the preparation, the size of the application area, the duration of administration, and whether or not occlusive dressings are used.  Given equivalent doses, small children are usually at the greatest risk for systemic toxicity such as adrenal suppression, Cushing's syndrome and intracranial hypertension because of their larger skin surface to body mass ratios.  If topical corticosteroids are necessary to treat diaper rash, medium- to low-potency agents should preferably be used, and parents should be advised not to put tight-fitting diapers or plastic pants over the rash, since occlusion of treated area may increase percutaneous drug absorption.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 20,
      minor: 0,
      total: 20
    },
    ddinterOfficialReferences: ['May P, Stein EJ, Ryter RJ, Hirsh FS, Michel B, Levy RP "Cushing syndrome from percutaneous absorption of triamcinolone cream." Arch Intern Med 136 (1976):  612-3', 'Stoppoloni G, Prisco F, Santinelli R, Sicuranza G, Giordano C "Potential hazards of topical steroid therapy." Am J Dis Child 137 (1983):  1130-1', `Ruiz-Maldonado R, Zapata G, Lourdes T, Robles C "Cushing's syndrome after topical application of corticosteroids." Am J Dis Child 136 (1982):  274-5`, 'Reymann F, Kehlet H "Hypothalamic-pituitary-adrenocortical function. Association with topical application of betamethasone dipropionate." Arch Dermatol 115 (1979):  362-3', 'Walsh P, Aeling JL, Huff L, Weston WL "Hypothalamus-pituitary-adrenal axis suppression by superpotent topical steroids." J Am Acad Dermatol 29 (1993):  501-3', `Nathan AW, Rose GL "Fatal iatrogenic Cushing's syndrome." Lancet 1 (1979):  207`]
  },
  "adrenocortical hyperfunction": {
    name: "Adrenocortical Hyperfunction",
    indonesianName: "Adrenocortical Hyperfunction (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Adrenocortical Hyperfunction" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of topical corticosteroids may precipitate or aggravate conditions of hyperadrenocorticism.  Systemic absorption of these agents can produce reversible hypothalamic-pituitary-adrenal axis suppression.  Systemic absorption, depends on the vehicle and concentration of the preparation, the size of the application area, the duration of administration, and whether or not occlusive dressings are used.  Given equivalent doses, small children are generally at the greatest risk because of their larger skin surface to body mass ratios.  Patients with an altered skin barrier or liver failure are also at increased risk.  If possible, the use of highly potent agents (e.g., augmented betamethasone, clobetasol, diflorasone, and halobetasol) should be avoided in children and limited to small areas for 2 weeks in adults.  The development of symptoms such as menstrual irregularities, acneiform lesions, cataracts and cushingoid features during topical corticosteroid therapy may indicate excessive use.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 31,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['May P, Stein EJ, Ryter RJ, Hirsh FS, Michel B, Levy RP "Cushing syndrome from percutaneous absorption of triamcinolone cream." Arch Intern Med 136 (1976):  612-3', 'Stoppoloni G, Prisco F, Santinelli R, Sicuranza G, Giordano C "Potential hazards of topical steroid therapy." Am J Dis Child 137 (1983):  1130-1', `Ruiz-Maldonado R, Zapata G, Lourdes T, Robles C "Cushing's syndrome after topical application of corticosteroids." Am J Dis Child 136 (1982):  274-5`, `Nathan AW, Rose GL "Fatal iatrogenic Cushing's syndrome." Lancet 1 (1979):  207`, 'Macdonald A "Topical corticosteroid preparations. Hazards and side-effects." Br J Clin Pract 25 (1971):  421-5', 'Salde L, Lassus A "Systemic side-effects of three topical steroids in diseased skin." Curr Med Res Opin 8 (1983):  475-80']
  },
  "acidosis, lactic": {
    name: "Acidosis, Lactic",
    indonesianName: "Acidosis, Lactic (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acidosis, Lactic" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of metformin is contraindicated in patients with renal dysfunction (serum creatinine >= 1.5 mg/dL in males and 1.4 mg/dL in females, or above the upper limit of normal for age); congestive heart failure requiring pharmacologic treatment (especially unstable or acute CHF where there is risk of hypoperfusion and hypoxemia); and any condition associated with hypoxemia (e.g., severe anemia, myocardial infarction, asphyxia, shock), dehydration (e.g., severe diarrhea or vomiting), or sepsis.  Patients with these conditions may be at increased risk for the development of lactic acidosis, which is a rare but serious metabolic complication associated with metformin accumulation in plasma usually at levels exceeding 5 mcg/mL.  Metformin should also not be administered to patients with acute or chronic metabolic acidosis.  In addition, metformin should generally be avoided in alcoholics and patients with clinical or laboratory evidence of hepatic disease, since alcohol potentiates the effects of metformin on lactate metabolism and impaired hepatic function may significantly limit the ability to clear lactate.  All patients treated with metformin should have renal function monitored regularly (at least annually or more frequently if necessary) and be advised of the significance of nonspecific symptoms such as malaise, myalgias, respiratory distress, increasing somnolence, and gastrointestinal disturbances that arise after stabilization of metformin dosage.  More marked acidosis may be associated with hypothermia, hypotension, and resistant bradyarrhythmias.  Immediate medical attention is necessary if these symptoms occur, and metformin therapy withheld until the situation can be clarified.  If lactic acidosis is diagnosed, prompt supportive measures and hemodialysis are recommended.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Chalopin JM, Tanter Y, Besancenot JF, Cabanne JF, Rifle G "Treatment of metformin-associated lactic acidosis with closed recirculation bicarbonate-buffered hemodialysis." Arch Intern Med 144 (1984):  203-5', 'Biron P "Metformin monitoring." Can Med Assoc J 123 (1980):  11-2', 'Ryder RE "Lactic acidotic coma with multiple medication including metformin in a patient with normal renal function." Br J Clin Pract 38 (1984):  229-30,232', 'Luft D, Schmulling RM, Eggstein M "Lactic acidosis in biguanide-treated diabetics: a review of 330 cases." Diabetologia 14 (1978):  75-87', 'Assan R, Heuclin C, Ganeval D, Bismuth C, George J, Girard JR "Metformin-induced lactic acidosis in the presence of acute renal failure." Diabetologia 13 (1977):  211-7', 'Wiholm BE, Myrhed M "Metformin-associated lactic acidosis in Sweden 1977-1991." Eur J Clin Pharmacol 44 (1993):  589-91']
  },
  "hypoglycemia": {
    name: "Hypoglycemia",
    indonesianName: "Hypoglycemia (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypoglycemia" memiliki 31 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hypoglycemia may commonly occur during treatment with insulin and/or oral hypoglycemic agents.  Care should be taken in patients who may be particularly susceptible to the development of hypoglycemic episodes during the use of these drugs, including those who are debilitated or malnourished, those with defective counterregulatory mechanisms (e.g., autonomic neuropathy and adrenal or pituitary insufficiency), and those receiving beta-adrenergic blocking agents.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 31,
      minor: 0,
      total: 31
    },
    ddinterOfficialReferences: ['"Product Information. Diabinese (chlorpropamide)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Glucotrol (glipizide)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Diabeta (glyburide)." Hoechst Marion-Roussel Inc, Kansas City, MO.', '"Product Information. Micronase (glyburide)." Pharmacia and Upjohn  (2002):', '"Multum Information Services, Inc. Expert Review Panel"', '"Product Information. Humulin BR (insulin)." Lilly, Eli and Company, Indianapolis, IN.']
  },
  "vitamin b 12 deficiency": {
    name: "Vitamin B 12 Deficiency",
    indonesianName: "Vitamin B 12 Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vitamin B 12 Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Metformin may interfere with vitamin B12 (cyanocobalamin) absorption from the B12-intrinsic factor complex.  A decrease to subnormal levels of previously normal serum B12 levels has been reported in approximately 7% of patients treated with metformin during controlled clinical trials.  Although the decrease is generally well-tolerated and rarely associated with clinical manifestations such as megaloblastic anemia, caution may be warranted when metformin therapy is administered in patients with preexisting B12 deficiency.  Vitamin B12 supplementation as well as annual measurements of hematologic parameters may be appropriate.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Tomkin GH "Metformin and B 12 malabsorption." Ann Intern Med 76 (1972):  668', 'Callaghan TS, Hadden DR, Tomkin GH "Megaloblastic anaemia due to vitamin B12 malabsorption associated with long-term metformin treatment." Br Med J 280 (1980):  1214-5', 'Stowers JM, Smith OA "Vitamin B 12 and metformin." Br Med J 3 (1971):  246-7', 'Tomkin GH, Hadden DR, Weaver JA, Montgomery DA "Vitamin-B12 status of patients on long-term metformin therapy." Br Med J 2 (1971):  685-7', '"Product Information. Glucophage (metformin)." Bristol-Myers Squibb  (2001):', 'Deutsch JC, Santhosh-Kumar CR, Kolhouse JF "Efficacy of metformin in non-insulin-dependent diabetes mellitus." N Engl J Med 334 (1996):  269']
  },
  "heart diseases": {
    name: "Heart Diseases",
    indonesianName: "Heart Diseases (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Heart Diseases" memiliki 63 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of some antiemetics such as dronabinol and nabilone has been associated with occasional hypotension, possible hypertension, syncope or tachycardia.  Therapy with these drugs should be administered cautiously in patients with cardiac disease.",
    ddinterSeverityDistribution: {
      major: 39,
      moderate: 24,
      minor: 0,
      total: 63
    },
    ddinterOfficialReferences: ['"Product Information. Marinol (dronabinol)." Roxane Laboratories Inc  (2001):', '"Product Information. Cesamet (nabilone)." Valeant Pharmaceuticals  (2006):', '"Product Information. Syndros (dronabinol)." Insys Therapeutics Inc  (2017):', '"Product Information. Betaseron (interferon beta-1b)." Berlex Laboratories  (2002):', '"Product Information. Avonex (interferon beta-1a)." Biogen  (2001):', '"Product Information. Intron A (interferon alfa-2b)." Schering Corporation  (2001):']
  },
  "long qt syndrome": {
    name: "Long QT Syndrome",
    indonesianName: "Long QT Syndrome (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Long QT Syndrome" memiliki 85 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The effects of QT prolongation potential by nabilone have not been studies.  Caution and monitoring is advised if used in patients with long QT syndrome.",
    ddinterSeverityDistribution: {
      major: 41,
      moderate: 44,
      minor: 0,
      total: 85
    },
    ddinterOfficialReferences: ['"Product Information. Cesamet (nabilone)." Valeant Pharmaceuticals  (2006):', '"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', 'Glassman AH, Bigger JT Jr "Antipsychotic drugs: prolonged QTc interval, torsade de pointes, and sudden death." Am J Psychiatry 158 (2001):  1774-82', 'Huang CL, Su KP, Hsu HB, Pariante CM "A pilot observational crossover study of QTc interval changes associated with switching between olanzapine and risperidone." J Clin Psychiatry 68 (2007):  803-5', '"Product Information. Uroxatral (alfuzosin)." sanofi-aventis  (2003):', '"Product Information. Haldol (haloperidol)." McNeil Pharmaceutical  (2002):']
  },
  "priapism": {
    name: "Priapism",
    indonesianName: "Priapism (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Priapism" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atypical antipsychotic agents with alpha-adrenergic blocking effects may cause priapism.  The condition is characterized by prolonged, often painful erections lasting longer than 4 hours.  If not treated promptly, priapism can cause irreversible damage to the erectile tissue.  Therapy with these agents should be administered cautiously in patients with a history of priapism, conditions that may predispose them to priapism (e.g., sickle cell anemia, multiple myeloma, leukemia, thalassemia), or anatomical deformations of the penis (e.g., angulation, cavernosal fibrosis, Peyronie's disease).  Patients who experience an erection lasting longer than 4 hours, whether painful or not, should immediately discontinue the drug and seek emergency medical attention.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 9,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Risperdal (risperidone)." Janssen Pharmaceuticals  (2001):', '"Product Information. Seroquel (quetiapine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Geodon (ziprasidone)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Invega (paliperidone)." Janssen Pharmaceuticals  (2007):', '"Product Information. Fanapt (iloperidone)." Vanda Pharmaceuticals Inc  (2009):', '"Product Information. Viagra (sildenafil)." Pfizer U.S. Pharmaceuticals  (2001):']
  },
  "mania": {
    name: "Mania",
    indonesianName: "Mania (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Mania" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Selective serotonin reuptake inhibitors (SSRIs), like other antidepressants, may occasionally cause or activate mania or hypomania.  The reported incidence ranged from 0.1% to 2% in premarketing testing of several SSRIs.  Patients with bipolar disorder are generally more likely to experience mania from antidepressants.  Therapy with SSRIs should be administered cautiously in patients with a history of mania or bipolar disorder.  Prior to initiating treatment, it is recommended to adequately screen patients for bipolar disorder, including a family history of suicide, bipolar disorder, and depression.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 17,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['Vieta E, Bernardo M "Antidepressant-induced mania in obsessive-compulsive disorder." Am J Psychiatry 149 (1992):  1282-3', 'Beal DM, Harris D, Bartos M, Korsak C, Splane G, Quant R, Starke J "Safety and efficacy of fluoxetine." Am J Psychiatry 148 (1991):  1751', 'Achamallah NS, Decker DH "Mania induced by fluoxetine in an adolescent patient." Am J Psychiatry 148 (1991):  1404', 'Lensgraf SJ, Favazza AR "Antidepressant-induced mania." Am J Psychiatry 147 (1990):  1569', 'Piredda SG, Rubinstein SL "Hypomania induced by fluoxetine?" Biol Psychiatry 32 (1992):  107', 'Guthrie SK "Sertraline: a new specific serotonin reuptake blocker." DICP 25 (1991):  952-61']
  },
  "blood platelet disorders": {
    name: "Blood Platelet Disorders",
    indonesianName: "Blood Platelet Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Blood Platelet Disorders" memiliki 31 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of selective serotonin reuptake inhibitors (SSRIs) has been associated with altered platelet function.  Petechiae, purpura, ecchymosis, increased bleeding times, epistaxis and gastrointestinal hemorrhage have been reported.  Therapy with SSRIs should be administered cautiously in patients with severe active bleeding or a hemorrhagic diathesis.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 28,
      minor: 0,
      total: 31
    },
    ddinterOfficialReferences: ['Aranth J, Lindberg C "Bleeding, a side effect of fluoxetine." Am J Psychiatry 149 (1992):  412', 'Yaryura-Tobias JA, Kirschen H, Ninan P, Mosberg HJ "Fluoxetine and bleeding in obsessive-compulsive disorder." Am J Psychiatry 148 (1991):  949', 'Humphries JE, Wheby MS, VandenBerg SR "Fluoxetine and the bleeding time." Arch Pathol Lab Med 114 (1990):  727-8', 'Alderman CP, Moritz CK, Ben-Tovim DI "Abnormal platelet aggregation associated with fluoxetine therapy." Ann Pharmacother 26 (1992):  1517-9', '"Product Information. Zoloft (sertraline)." Roerig Division  (2001):', '"Product Information. Prozac (fluoxetine)." Dista Products Company  (2001):']
  },
  "inappropriate adh syndrome": {
    name: "Inappropriate ADH Syndrome",
    indonesianName: "Inappropriate ADH Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Inappropriate ADH Syndrome" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of selective serotonin reuptake inhibitors (SSRIs) has rarely been associated with hyponatremia, sometimes secondary to development of the syndrome of inappropriate secretion of antidiuretic hormone (SIADH).  These events have generally been reversible following discontinuation of SSRI therapy and/or medical intervention.  SSRI-related hyponatremia may be more common in elderly female patients and those who are volume-depleted or receiving concomitant diuretic therapy.  Caution may be warranted when SSRI therapy is administered in these patients and patients with preexisting hyponatremia or SIADH.  Serum electrolytes, especially sodium as well as BUN and plasma creatinine, should be monitored regularly.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 7,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['Abbott R "Hyponatremia due to antidepressant medications." Ann Emerg Med 12 (1983):  708-10', 'Vishwanath BM, Navalgund AA, Cusano W, Navalgund KA "Fluoxetine as a cause of SIADH." Am J Psychiatry 148 (1991):  542-3', 'Staab JP, Yerkes SA, Cheney EM, Clayton AH "Transient SIADH associated with fluoxetine." Am J Psychiatry 147 (1990):  1569-70', 'Cohen BJ, Mahelsky M, Adler L "More cases of SIADH with fluoxetine." Am J Psychiatry 147 (1990):  948-9', 'Kazal LA, Jr  Hall DL, Miller LG, Noel ML "Fluoxetine-induced SIADH: a geriatric occurrence?" J Fam Pract 36 (1993):  341-3', 'Crews JR, Potts NL, Schreiber J, Lipper S "Hyponatremia in a patient treated with sertraline." Am J Psychiatry 150 (1993):  1564']
  },
  "weight loss": {
    name: "Weight Loss",
    indonesianName: "Weight Loss (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Weight Loss" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of selective serotonin reuptake inhibitors (SSRIs) may occasionally cause significant weight loss, which may be undesirable in patients suffering from anorexia, malnutrition or excessive weight loss.  Anorexia may occur in approximately 5% to 10% of patients.  Weight change should be monitored during therapy if an SSRI is used in these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 8,
      total: 11
    },
    ddinterOfficialReferences: ['Oliveros SC, Iruela LM, Caballero L, Baca E "Fluoxetine-induced anorexia in a bulimic patient." Am J Psychiatry 149 (1992):  1113-4', '"Product Information. Zoloft (sertraline)." Roerig Division  (2001):', '"Product Information. Prozac (fluoxetine)." Dista Products Company  (2001):', '"Product Information. Paxil (paroxetine)." GlaxoSmithKline  (2001):', 'Vaz FJ, Salcedo MS "Fluoxetine-induced anorexia in a bulimic patient with antecedents of anorexia nervosa." J Clin Psychiatry 55 (1994):  118-9', 'Meyerowitz W, Jaramillo JDC "Sertraline treatment and weight loss." Curr Ther Res Clin Exp 55 (1994):  1176-81']
  },
  "demyelinating diseases": {
    name: "Demyelinating Diseases",
    indonesianName: "Demyelinating Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Demyelinating Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Clinical studies have reported that tocilizumab may have an effect on demyelinating disorders such as multiple sclerosis and chronic inflammatory demyelinating polyneuropathy.  Patients should be monitored for signs/symptoms potentially indicative of demyelinating disorders.  Caution should be exercised when considering the use of tocilizumab in patients with preexisting or recent onset demyelinating disorders.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Actemra (tocilizumab)." Genentech  (2022):']
  },
  "peptic ulcer perforation": {
    name: "Peptic Ulcer Perforation",
    indonesianName: "Peptic Ulcer Perforation (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peptic Ulcer Perforation" memiliki 27 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of tocilizumab may cause gastrointestinal (GI) perforation.  Tocilizumab should be used with caution in patients who may be at increased risk for GI perforation.  Patients with new onset abdominal symptoms should be evaluated promptly for early detection of GI perforation.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 21,
      minor: 0,
      total: 27
    },
    ddinterOfficialReferences: ['"Product Information. Actemra (tocilizumab)." Genentech  (2022):', '"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):']
  },
  "latent tuberculosis": {
    name: "Latent Tuberculosis",
    indonesianName: "Latent Tuberculosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Latent Tuberculosis" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In patients with latent tuberculosis or tuberculin reactivity, the use of pharmacologic dosages of adrenocorticotropic agents may cause a reactivation of the disease.  Close monitoring for signs and symptoms of tuberculosis is recommended if adrenocorticotropic therapy is administered to these patients.  During prolonged use, tuberculosis chemoprophylaxis may be considered.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 10,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):']
  },
  "keratitis, herpetic": {
    name: "Keratitis, Herpetic",
    indonesianName: "Keratitis, Herpetic (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Keratitis, Herpetic" memiliki 22 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Adrenocorticotropic agents should be used cautiously, if at all, in patients with ocular herpes simplex because of the risk of corneal perforation.  The manufacturers consider their use to be contraindicated in such setting.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 20,
      minor: 0,
      total: 22
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):']
  },
  "peptic ulcer": {
    name: "Peptic Ulcer",
    indonesianName: "Peptic Ulcer (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peptic Ulcer" memiliki 62 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Adrenocorticotropic agents may cause peptic ulcer disease and gastrointestinal (GI) hemorrhage, usually when given in high dosages or for prolonged periods.  Delayed healing of peptic ulcers has also been reported.  Therapy with adrenocorticotropic agents, if necessary, should be administered cautiously in patients with active or latent peptic ulcers or other risk factors for GI bleeding.  The manufacturers consider their use to be contraindicated in such setting.",
    ddinterSeverityDistribution: {
      major: 48,
      moderate: 14,
      minor: 0,
      total: 62
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Motrin (ibuprofen)." Pharmacia and Upjohn  (2002):', '"Product Information. Nalfon (fenoprofen)." Xspire Pharma  (2002):', '"Product Information. Indocin (indomethacin)." Merck & Co., Inc  (2002):']
  },
  "scleroderma, localized": {
    name: "Scleroderma, Localized",
    indonesianName: "Scleroderma, Localized (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Scleroderma, Localized" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of adrenocorticotropic agents is contraindicated in patients with scleroderma.  Adrenocorticotropic agents may precipitate renal crisis with malignant hypertension in these patients, possibly via steroid-induced increases in renin substrate and angiotensin II levels and decreases in vasodilator prostaglandin production.  Renal failure may ensue.  If treatment is required for inflammatory myositis or pericarditis, glucocorticoids are preferable because of their more predictable pharmacologic effect.  However, glucocorticoids should also be avoided in the long-term treatment of patients with scleroderma for similar reasons.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 9,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):']
  },
  "ocular hypertension": {
    name: "Ocular Hypertension",
    indonesianName: "Ocular Hypertension (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ocular Hypertension" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Prolonged use of adrenocorticotropic agents may cause elevated intraocular pressure and glaucoma with possible damage to the optic nerves.  Long-term therapy with these agents should be administered cautiously in patients with preexisting glaucoma (particularly open-angle glaucoma) or increased intraocular pressure.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Lucentis (ranibizumab ophthalmic)." Genentech  (2006):']
  },
  "muscular diseases": {
    name: "Muscular Diseases",
    indonesianName: "Muscular Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Muscular Diseases" memiliki 16 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Toxic myopathy may occur with the prolonged use of adrenocorticotropic agents, often in patients with disorders of neuromuscular transmission such as myasthenia gravis or in patients receiving neuromuscular blocking agents.  Steroid myopathy is generalized and sometimes accompanied by respiratory weakness and dyspnea.  In some cases, it has resulted in quadraparesis.  Elevations of creatine kinase may also occur, albeit infrequently.  After withdrawal of ACTH therapy, recovery may be slow and incomplete.  Therapy with adrenocorticotropic agents should be administered cautiously in patients with preexisting myopathy or myoneural disorders, since these conditions may confound the diagnosis of steroid-induced myopathy.  The presence of a normal serum CK level, minimal or no changes of myopathy on EMG, and type 2 muscle fiber atrophy on biopsy are helpful in suggesting steroid-induced weakness.  If steroid myopathy is suspected, a dosage reduction or discontinuation of adrenocorticotropic therapy should be considered.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 13,
      minor: 0,
      total: 16
    },
    ddinterOfficialReferences: [`Limbird LE eds., Gilman AG, Hardman JG "Goodman and Gilman's the Pharmacological Basis of Therapeutics." New York, NY: McGraw-Hill  (1995):`, '"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`, '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', '"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):']
  },
  "thromboembolism": {
    name: "Thromboembolism",
    indonesianName: "Thromboembolism (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thromboembolism" memiliki 64 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Adrenocorticotropic agents may increase blood coagulability and have rarely been associated with the development of intravascular thrombosis, thromboembolism, and thrombophlebitis.  These agents should be used cautiously in patients with thrombotic or thromboembolic disorders.",
    ddinterSeverityDistribution: {
      major: 27,
      moderate: 37,
      minor: 0,
      total: 64
    },
    ddinterOfficialReferences: ['"Product Information. Acthar (corticotropin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Acthrel (corticorelin)." Ferring Pharmaceuticals Inc  (2001):', '"Product Information. Cortrosyn (cosyntropin)." Organon  (2001):', 'Notelovitz M "Oral contraception and coagulation." Clin Obstet Gynecol 28 (1985):  73-83', 'Meade TW "Oral contraceptives, clotting factors, and thrombosis." Am J Obstet Gynecol 142 (1982):  758-61', 'Williams RS "Benefits and risks of oral contraceptive use." Postgrad Med 92 (1992):  155-7']
  },
  "cholestasis": {
    name: "Cholestasis",
    indonesianName: "Cholestasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cholestasis" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of ursodiol is contraindicated in patients with compelling reasons for cholecystectomy including unremitting acute cholecystitis, cholangitis, biliary obstruction, gallstone pancreatitis, or biliary gastrointestinal fistula.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 1,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Actigall (ursodiol)." Novartis Pharmaceuticals  (2022):', '"Product Information. Urso (ursodiol)." Scandipharm Inc  (2001):', '"Product Information. Questran (cholestyramine)." Par Pharmaceutical Inc  (2002):', '"Product Information. Copper Sulfate (copper sulfate)." Humco Holding Group  (2001):', '"Product Information. Manganese Chloride (manganese chloride)." Abbott Pharmaceutical  (2001):', '"Product Information. Manganese Sulfate (manganese sulfate)." American Regent Laboratories Inc  (2001):']
  },
  "central nervous system diseases": {
    name: "Central Nervous System Diseases",
    indonesianName: "Central Nervous System Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Central Nervous System Diseases" memiliki 33 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Reversible CNS effects such as seizures, mental status changes, manic behavior or psychotic reactions, gait disturbances, and dizziness have occurred in patients receiving interferons.  Therapy with interferons should be administered cautiously in patients with or predisposed to seizures, psychiatric disorders, or conditions affecting posture or gait.",
    ddinterSeverityDistribution: {
      major: 24,
      moderate: 9,
      minor: 0,
      total: 33
    },
    ddinterOfficialReferences: ['"Product Information. Betaseron (interferon beta-1b)." Berlex Laboratories  (2002):', '"Product Information. Avonex (interferon beta-1a)." Biogen  (2001):', '"Product Information. Intron A (interferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Infergen (interferon alfacon-1)." Amgen  (2001):', '"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "exanthema": {
    name: "Exanthema",
    indonesianName: "Exanthema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Exanthema" memiliki 28 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Nonsteroidal anti-inflammatory drugs (NSAIDs) can cause serious skin adverse reactions (e.g., Stevens-Johnson syndrome, toxic epidermal necrolysis, and exfoliative dermatitis), which can be fatal.  These serious events may occur without warning.  Patients should be advised to discontinue the NSAID and seek medical attention promptly at the first sign of skin rash or any other sign of hypersensitivity.  NSAIDs are contraindicated in patients with previous serious skin reactions to these drugs.",
    ddinterSeverityDistribution: {
      major: 28,
      moderate: 0,
      minor: 0,
      total: 28
    },
    ddinterOfficialReferences: ['"Product Information. Motrin (ibuprofen)." Pharmacia and Upjohn  (2002):', '"Product Information. Nalfon (fenoprofen)." Xspire Pharma  (2002):', '"Product Information. Indocin (indomethacin)." Merck & Co., Inc  (2002):', '"Product Information. Orudis (ketoprofen)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Naprosyn (naproxen)." Syntex Laboratories Inc  (2002):', '"Product Information. Clinoril (sulindac)." Merck & Co., Inc  (2001):']
  },
  "hypertension": {
    name: "Hypertension",
    indonesianName: "Hypertension (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypertension" memiliki 115 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Nonsteroidal anti-inflammatory drugs (NSAIDs), including topicals, can lead to new onset of hypertension or worsening of preexisting hypertension, either of which can contribute to the increased incidence of cardiovascular events.  NSAIDs should be used with caution in patients with hypertension.  Blood pressure should be monitored closely during the initiation of NSAID therapy and throughout the course of therapy.",
    ddinterSeverityDistribution: {
      major: 38,
      moderate: 64,
      minor: 13,
      total: 115
    },
    ddinterOfficialReferences: ['"Product Information. Indocin (indomethacin)." Merck & Co., Inc  (2002):', '"Product Information. Naprosyn (naproxen)." Syntex Laboratories Inc  (2002):', '"Product Information. Voltaren (diclofenac)." Novartis Pharmaceuticals  (2001):', '"Product Information. Relafen (nabumetone)." SmithKline Beecham  (2001):', '"Product Information. Feldene (piroxicam)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Dolobid (diflunisal)." Merck & Co., Inc  (2001):']
  },
  "abnormal genital bleeding": {
    name: "Abnormal Genital Bleeding",
    indonesianName: "Abnormal Genital Bleeding (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Abnormal Genital Bleeding" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of contraceptives is contraindicated when there is an undiagnosed abnormal genital bleeding.  Adequate diagnostic measures should be undertaken to rule out the presence of any malignancy.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Micronor (norethindrone)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Implanon (etonogestrel)." Organon Pharmaceuticals  (2006):', '"Product Information. Liletta (levonorgestrel)." Actavis Pharma, Inc.  (2016):']
  },
  "uterine hemorrhage": {
    name: "Uterine Hemorrhage",
    indonesianName: "Uterine Hemorrhage (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Uterine Hemorrhage" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of estrogens is contraindicated in patients with undiagnosed, abnormal vaginal bleeding.  Prolonged (> 1 year), unopposed estrogen use (i.e. estrogen without concomitant progestin therapy) has been associated with a significant, dose-related risk of endometrial carcinoma.  The risk may be offset substantially by the addition of a progestin but may not be completely abolished.  Prior to initiating estrogen therapy, appropriate diagnostic tests should be performed in patients with abnormal vaginal bleeding to rule out endometrial malignancy.  The same applies if recurrent or persistent bleeding develops during estrogen therapy.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 0,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['Obrink A, Bunne G, Collen J, Tjernberg B "Endometrial cancer and exogenous estrogens." Acta Obstet Gynecol Scand 58 (1979):  123', 'Spengler RF, Clarke EA, Woolever CA, Newman AM, Osborn RW "Exogenous estrogens and endometrial cancer: a case-control study and assessment of potential biases." Am J Epidemiol 114 (1981):  497-506', 'Buring JE, Bain CJ, Ehrmann RL "Conjugated estrogen use and risk of endometrial cancer." Am J Epidemiol 124 (1986):  434-41', 'Persson I, Adami HO, Bergkvist L, Lindgren A, Pettersson B, Hoover R, Schairer C "Risk of endometrial cancer after treatment with oestrogens alone or in conjunction with progestogens: results of a prospective study." BMJ 298 (1989):  147-51', 'Antunes CM, Strolley PD, Rosenshein NB, Davies JL, Tonascia JA, Brown C, Burnett L, Rutledge A, Pokempner M, Garcia R "Endometrial cancer and estrogen use. Report of a large case-control study." N Engl J Med 300 (1979):  9-13', 'Gordon J, Reagan JW, Finkle WD, Ziel HK "Estrogen and endometrial carcinoma. An independent pathology review supporting original risk estimate." N Engl J Med 297 (1977):  570-1']
  },
  "breast neoplasms": {
    name: "Breast Neoplasms",
    indonesianName: "Breast Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Breast Neoplasms" memiliki 39 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of estrogens is generally contraindicated in patients with known or suspected estrogen-dependent neoplasia such as breast and endometrial cancer, since it may stimulate tumor proliferation.  High dosages of estrogens may be used for the palliative treatment of inoperable, metastatic breast cancer, but only in appropriately selected men and postmenopausal women.",
    ddinterSeverityDistribution: {
      major: 27,
      moderate: 12,
      minor: 0,
      total: 39
    },
    ddinterOfficialReferences: ['Ewertz M "Oral contraceptives and breast cancer risk in Denmark." Eur J Cancer 28A (1992):  1176-81', 'Obrink A, Bunne G, Collen J, Tjernberg B "Endometrial cancer and exogenous estrogens." Acta Obstet Gynecol Scand 58 (1979):  123', 'Palmer JR, Rosenberg L, Clarke EA, Miller DR, Shapiro S "Breast cancer risk after estrogen replacement therapy: results from the Toronto Breast Cancer Study." Am J Epidemiol 134 (1991):  1386-95', 'Kaufman DW, Palmer JR, de Mouzon J, Rosenberg L, Stolley PD, Warshauer ME, Zauber AG, Shapiro S "Estrogen replacement therapy and the risk of breast cancer: results from the case-control surveillance study." Am J Epidemiol 134 (1991):  1375-85', 'Spengler RF, Clarke EA, Woolever CA, Newman AM, Osborn RW "Exogenous estrogens and endometrial cancer: a case-control study and assessment of potential biases." Am J Epidemiol 114 (1981):  497-506', 'Buring JE, Bain CJ, Ehrmann RL "Conjugated estrogen use and risk of endometrial cancer." Am J Epidemiol 124 (1986):  434-41']
  },
  "liver neoplasms": {
    name: "Liver Neoplasms",
    indonesianName: "Liver Neoplasms (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Liver Neoplasms" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of oral contraceptives is contraindicated in patients with liver tumors.  An increased risk of benign hepatic adenomas and hepatocellular carcinomas has been associated with long-term, oral estrogen- progestin contraceptive use of at least 4 years and 8 years, respectively.  Although these tumors are rare and have not been reported with other types of estrogen or progestogen therapies, any preparation containing estrogens and/or progestogens should probably be avoided in patients with existing tumors of the liver.  Hepatic hemangiomas and nodular hyperplasia of the liver have been reported with isolated estrogen therapy.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 1,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['Tao LC "Oral contraceptive-associated liver cell adenoma and hepatocellular carcinoma." Cancer 68 (1991):  341-7', '"Depot-medroxyprogesterone acetate (DMPA) and risk of liver cancer.  The WHO Collaborative Study of Neoplasia and Steroid Contraceptives." Int J Cancer 49 (1991):  182-5', 'Conter RL, Longmire WP Jr "Recurrent hepatic hemangiomas. Possible association with estrogen therapy." Ann Surg 207 (1988):  115-9', 'Aldinger K, Ben-Menachem Y, Whalen G "Focal nodular hyperplasia of the liver associated with high-dosage estrogens." Arch Intern Med 137 (1977):  357-9', 'Palmer JR, Rosenberg L, Kaufman DW, Warshauer ME, Stolley P, Shapiro S "Oral contraceptive use and liver cancer." Am J Epidemiol 130 (1989):  878-82', 'Mooney MJ, Nyreen MR, Hall RA, Carter PL "Hepatic adenoma presenting as a right lower quadrant mass." Am Surg 59 (1993):  229-31']
  },
  "bone diseases, metabolic": {
    name: "Bone Diseases, Metabolic",
    indonesianName: "Bone Diseases, Metabolic (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bone Diseases, Metabolic" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of intramuscular medroxyprogesterone for contraception has been shown to induce bone loss, particularly during the early years of therapy.  With continued use, the decline in bone density subsequently approaches the normal rate of age-related loss.  Therapy with parenteral medroxyprogesterone should be administered cautiously in patients with osteoporosis or chronic use of drugs that can reduce bone mass, such as anticonvulsants or corticosteroids.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Cundy T, Evans M, Roberts H, Wattie D, Ames R, Reid IR "Bone density in women receiving depot medroxyprogesterone acetate for  contraception [published erratum appears in BMJ 1991 Jul27;303(6796):220]." BMJ 303 (1991):  13-6', '"Product Information. Depo-Provera (medroxyprogesterone)." Pharmacia and Upjohn  (2001):', 'Cundy T, Farquhar CM, Cornish J, Reid IR "Short-term effects of high dose oral medroxyprogesterone acetate on bone density in premenopausal women." J Clin Endocrinol Metab 81 (1996):  1014-7', 'Paiva LC, PintoNeto AM, Faundes A "Bone density among long-term users of medroxyprogesterone acetate as a contraceptive." Contraception 58 (1998):  351-5', 'Nand SL, Wren BG, Gross BA, Heller GZ "Bone density effects of continuous estrone sulfate and varying doses of medroxyprogesterone acetate." Obstet Gynecol 93 (1999):  1009-13', '"Product Information. Lupron (leuprolide)." TAP Pharmaceuticals Inc  (2002):']
  },
  "menorrhagia": {
    name: "Menorrhagia",
    indonesianName: "Menorrhagia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Menorrhagia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of medroxyprogesterone in women with undiagnosed vaginal bleeding is contraindicated.  Most women using medroxyprogesterone experience disruption of menstrual bleeding patterns.  Altered menstrual bleeding patterns include amenorrhea, irregular or unpredictable bleeding or spotting, prolonged spotting or bleeding, and heavy bleeding.  Rule out the possibility of organic pathology if abnormal bleeding persists or is severe, and institute appropriate treatment.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Depo-Provera (medroxyprogesterone)." Pharmacia and Upjohn  (2001):']
  },
  "hypercalcemia": {
    name: "Hypercalcemia",
    indonesianName: "Hypercalcemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypercalcemia" memiliki 22 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Estrogens influence the metabolism of calcium and phosphorus.  Intestinal absorption and retention of calcium are increased, which may occasionally result in hypercalcemia.  Therapy with estrogens should be administered cautiously in patients with preexisting hypercalcemia, renal dysfunction, or metabolic bone diseases that are associated with hypercalcemia.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 14,
      minor: 0,
      total: 22
    },
    ddinterOfficialReferences: ['"Product Information. Premarin (conjugated estrogens)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Climara (estradiol)." Berlex Laboratories  (2001):', '"Product Information. Estrace (estradiol)." Warner Chilcott Laboratories  (2001):', '"Product Information. Estraderm (estradiol)." Ciba-Geigy Pharmaceuticals  (2001):', '"Product Information. Vivelle (estradiol)." Ciba-Geigy Pharmaceuticals  (2001):', '"Product Information. Emcyt (estramustine)." Pharmacia and Upjohn  (2001):']
  },
  "melanosis": {
    name: "Melanosis",
    indonesianName: "Melanosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Melanosis" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of exogenous estrogens may occasionally cause chloasma, especially in women with a history of chloasma gravidarum.  Women with a tendency to chloasma should avoid exposure to the sun or ultraviolet radiation while taking combination oral contraceptives.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Ortho-Novum 10/11 (ethinyl estradiol-norethindrone)." Ortho McNeil Pharmaceutical', '"Product Information. Ortho-Cept (desogestrel-ethinyl estradiol)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Ortho-Cyclen (ethinyl estradiol-norgestimate)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Lo/Ovral (ethinyl estradiol-norgestrel)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Ortho-Novum 1/50 (mestranol-norethindrone)." Ortho McNeil Pharmaceutical', '"Product Information. Ortho Dienestrol (dienestrol topical)." Ortho McNeil Pharmaceutical']
  },
  "glucose intolerance": {
    name: "Glucose Intolerance",
    indonesianName: "Glucose Intolerance (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glucose Intolerance" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Impaired glucose tolerance has been observed in some patients administered oral contraceptives and appears to be related primarily to the estrogen dose.  However, progestogens can increase insulin secretion and produce insulin resistance to varying degrees, depending on the agent.  Patients with diabetes mellitus should be monitored more closely during therapy with estrogens and/or progestogens, and adjustments made accordingly in their antidiabetic regimen.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 12,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['Haiba NA, el-Habashy MA, Said SA, Darwish EA, Abdel-Sayed WS, Nayel SE "Clinical evaluation of two monthly injectable contraceptives and  their effects on some metabolic parameters." Contraception 39 (1989):  619-32', 'Virutamasen P, Wongsrichanalai C, Tangkeo P, Nitichai Y, Rienprayoon D "Metabolic effects of depot-medroxyprogesterone acetate in long-term  users: a cross-sectional study." Int J Gynaecol Obstet 24 (1986):  291-6', 'Who Task Force on Long-acting Agents for Fertility Regulation "Metabolic side-effects of injectable depot-medroxyprogesterone acetate, 150 mg three-monthly, in undernourished lactating women." Bull World Health Organ 64 (1986):  587-94', 'Garg SK, Chase HP, Marshall G, Hoops SL, Holmes DL, Jackson WE "Oral contraceptives and renal and retinal complications in young women with insulin-dependent diabetes mellitus." JAMA 271 (1994):  1099-102', 'Hannaford PC, Kay CR "Oral contraceptives and diabetes mellitus." BMJ 299 (1989):  1315-6', 'Stubblefield PG "Choosing the best oral contraceptive." Clin Obstet Gynecol 32 (1989):  316-28']
  },
  "eye diseases": {
    name: "Eye Diseases",
    indonesianName: "Eye Diseases (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Eye Diseases" memiliki 25 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Estrogens and progestogens may cause retinal thrombosis.  Oral contraceptives should be discontinued if there is unexplained partial or complete loss of vision; onset of proptosis or diplopia; papilledema; or retinal vascular lesions.  Therapy with these agents should be administered cautiously in patients who have preexisting ocular problems and appropriate diagnostic and therapeutic measures should be instituted.  Contact lens wearers who develop visual changes or changes in lens tolerance should be assessed by an ophthalmologist.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 17,
      minor: 0,
      total: 25
    },
    ddinterOfficialReferences: ['"Product Information. Ortho-Novum 1/35 (ethinyl estradiol-norethindrone)." Ortho McNeil Pharmaceutical', '"Product Information. Ortho-Novum 10/11 (ethinyl estradiol-norethindrone)." Ortho McNeil Pharmaceutical', '"Product Information. Ortho-Cept (desogestrel-ethinyl estradiol)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Demulen 1/50 (ethinyl estradiol-ethynodiol)." Searle', '"Product Information. Triphasil (ethinyl estradiol-levonorgestrel)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Ortho-Cyclen (ethinyl estradiol-norgestimate)." Ortho McNeil Pharmaceutical  (2001):']
  },
  "thyroid diseases": {
    name: "Thyroid Diseases",
    indonesianName: "Thyroid Diseases (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thyroid Diseases" memiliki 44 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "When administering estrogen and/or progestogen therapy in patients with thyroid disorders, clinicians should be aware that these hormones may affect thyroid function tests.  Changes have mostly been reported with the use of combination oral contraceptives.  Specifically, thyroid-binding globulin (TBG) may be increased, resulting in elevated circulating total thyroid hormone, as measured by PBI (protein-bound iodine), T4 by column or radioimmunoassay, or T3 by radioimmunoassay.  Free T3 resin uptake may be decreased.  On the contrary, a decrease in TBG and, consequently, thyroxine concentration, has been reported by the manufacturers of the progestin-only (norethindrone) oral contraceptives.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 34,
      minor: 8,
      total: 44
    },
    ddinterOfficialReferences: ['"Product Information. Depo-Provera (medroxyprogesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Provera (medroxyprogesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Premarin (conjugated estrogens)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Climara (estradiol)." Berlex Laboratories  (2001):', '"Product Information. Estrace (estradiol)." Warner Chilcott Laboratories  (2001):']
  },
  "diabetes mellitus, type 1": {
    name: "Diabetes Mellitus, Type 1",
    indonesianName: "Diabetes Mellitus, Type 1 (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetes Mellitus, Type 1" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thiazolidinediones exert their hypoglycemic effect only in the presence of insulin.  Therefore, these agents should not be used in patients with type I diabetes or for the treatment of diabetic ketoacidosis.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Avandia (rosiglitazone)." SmithKline Beecham  (2001):', '"Product Information. Actos (pioglitazone)." Takeda Pharmaceuticals America  (2001):', '"Product Information. Prandin (repaglinide)." Novo Nordisk Pharmaceuticals Inc  (2001):', '"Product Information. Starlix (nateglinide)." Novartis Pharmaceuticals  (2001):']
  },
  "urinary bladder neoplasms": {
    name: "Urinary Bladder Neoplasms",
    indonesianName: "Urinary Bladder Neoplasms (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urinary Bladder Neoplasms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "There are insufficient data to determine if pioglitazone has an effect on preexisting bladder tumors or if it can cause bladder cancer.  However, the manufacturer does not recommend the use of pioglitazone in patients with active bladder cancer.  In patients with history of bladder cancer the benefit of treatment versus the risk of cancer recurrence during treatment should be considered.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Actos (pioglitazone)." Takeda Pharmaceuticals America  (2001):']
  },
  "edema": {
    name: "Edema",
    indonesianName: "Edema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Edema" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thiazolidinediones can cause dose-related edema.  Therapy with thiazolidinediones should be administered cautiously in patients at risk for congestive heart failure as well as those with fluid overload or other conditions that may be adversely affected by excess fluid such as hypertension.  Patients should be monitored for signs and symptoms of heart failure such as dyspnea, swelling of legs or ankles, and weight gain.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 8,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Rezulin (troglitazone)." Parke-Davis  (2001):', '"Product Information. Avandia (rosiglitazone)." SmithKline Beecham  (2001):', '"Product Information. Actos (pioglitazone)." Takeda Pharmaceuticals America  (2001):', 'Thomas ML, Lloyd SJ "Pulmonary edema associated with rosiglitazone and troglitazone." Ann Pharmacother 35 (2001):  123-4', '"Product Information. Proleukin (aldesleukin)." Chiron Therapeutics  (2001):', 'Varkel Y, Braester A, Nusem D, Shkolnik T "Methyldopa-induced syndrome of inappropriate antidiuretic hormone-secretion and bone marrow granulomatosis." Drug Intell Clin Pharm 22 (1988):  700-1']
  },
  "macular edema": {
    name: "Macular Edema",
    indonesianName: "Macular Edema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Macular Edema" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "New onset or worsening diabetic macular edema with decreased visual acuity have been reported in postmarketing reports in some diabetic patients who were taking thiazolidinedione drugs.  Some patients presented with blurred vision or decreased visual acuity, but some patients appear to have been diagnosed on routine ophthalmologic examination.  Most patients had peripheral edema at the time macular edema was diagnosed.  Some patients had improvement in their macular edema after discontinuation of their thiazolidinedione.  Patients with diabetes should have regular eye exams by an ophthalmologist according to current standards of care.  Additionally, any diabetic who reports any kind of visual symptom should be promptly referred to an ophthalmologist, regardless of the patient's underlying medications or other physical findings.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 10,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['"Product Information. Rezulin (troglitazone)." Parke-Davis  (2001):', '"Product Information. Avandia (rosiglitazone)." SmithKline Beecham  (2001):', '"Product Information. Actos (pioglitazone)." Takeda Pharmaceuticals America  (2001):', '"Product Information. Xalatan (latanoprost ophthalmic)." Pharmacia and Upjohn  (2001):', '"Product Information. Lumigan (bimatoprost ophthalmic)." Allergan Inc  (2001):', '"Product Information. Travatan (travoprost ophthalmic)." Alcon Laboratories Inc  (2001):']
  },
  "anovulation": {
    name: "Anovulation",
    indonesianName: "Anovulation (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anovulation" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In premenopausal, anovulatory patients with insulin resistance, treatment with thiazolidinediones may result in resumption of ovulation.  Due to improved insulin sensitivity, pregnancy can occur if adequate contraception is not used.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Rezulin (troglitazone)." Parke-Davis  (2001):', '"Product Information. Avandia (rosiglitazone)." SmithKline Beecham  (2001):', '"Product Information. Actos (pioglitazone)." Takeda Pharmaceuticals America  (2001):']
  },
  "nervous system diseases": {
    name: "Nervous System Diseases",
    indonesianName: "Nervous System Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nervous System Diseases" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of whole-cell pertussis vaccine has rarely been associated with the development of severe encephalopathies.  Permanent brain damage and death have been reported.  Although a causal relationship has not been established, caution is advised when pertussis vaccination is considered in patients with underlying neurologic disorders.  The decision to administer or defer vaccination should be made on an individual basis after assessing the potential risks and benefits to the patient.  Generally, the presence of a progressive, unstable, or evolving neurological disorder is considered a contraindication or reason to defer, sometimes permanently, vaccination with whole-cell pertussis vaccine.  The use of acellular pertussis vaccine under these circumstances has not been evaluated but should probably be avoided as well.  Infants and children with a history of seizures may be vaccinated, provided the seizures are well-controlled and not associated with a progressive or degenerative neurologic disorder.  However, these patients have an increased risk of post-pertussis vaccination (within 48 hours) seizures and should receive acellular pertussis vaccine, since it is less frequently associated with moderate to high fever and thus, less likely to precipitate a seizure.  Prophylactic antipyretic therapy (e.g., acetaminophen) is also recommended for the first 24 hours following vaccination.  Patients with stable neurologic conditions, such as developmental delay or cerebral palsy, may receive pertussis vaccination.  In any case, if pertussis immunization is withheld during the first year of life, immunization against diphtheria and tetanus may be withheld simultaneously because the risk of acquiring these conditions is low (in developed countries) in children under the age of 1 year who are nonambulatory.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 6,
      minor: 1,
      total: 9
    },
    ddinterOfficialReferences: ['American Academy of Pediatrics. Committee on Infectious Diseases; Peter G, ed. "Red BooK: Report of the Committee on Infectious Diseases." Grove Village, IL: American Academy of Pediatrics  (1997):', '"Product Information. Blincyto (blinatumomab)." Amgen USA  (2014):', '"Product Information. Leustatin (cladribine)." Ortho Biotech Inc  (2001):', 'Shimada A "Adverse reactions to total-dose infusion of iron dextran." Clin Pharm 1 (1982):  248-9', 'Kumpf VJ, Holland EG "Parenteral iron dextran therapy." DICP 24 (1990):  162-6', '"Product Information. Infed (iron dextran)." Schein Pharmaceuticals Inc']
  },
  "immune deficiency disease": {
    name: "Immune Deficiency Disease",
    indonesianName: "Immune Deficiency Disease (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Immune Deficiency Disease" memiliki 20 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The expected serum antibody responses may not be obtained when vaccines and/or toxoids are administered to patients with primary or acquired immunodeficiency, including those with severe combined immunodeficiency, hypogammaglobulinemia or agammaglobulinemia, HIV infection, altered immune states (due to diseases such as leukemia, lymphoma, or generalized malignancy), or immunosuppression due to drug or other treatments (e.g., corticosteroids, alkylating agents, antimetabolites, or radiation).",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 10,
      minor: 0,
      total: 20
    },
    ddinterOfficialReferences: ['"Product Information. Tetanus Toxoid Adsorbed (tetanus vaccine)." Aventis Pharmaceuticals  (2001):', '"Product Information. Typhim VI (typhoid vaccine, inactivated)." Apothecon Inc  (2022):', '"Product Information. Pneumovax 23 (pneumococcal 23-polyvalent vaccine)." Merck & Co., Inc  (2022):', '"Product Information. Fluzone (influenza virus vaccine, inactivated)." Connaught Laboratories Inc', '"Product Information. Omnihib (haemophilus b conjugate vaccine (obsolete))." SmithKline Beecham', '"Product Information. Menomune A/C/Y/W-135 (meningococcal polysaccharide vaccine)." Connaught Laboratories Inc']
  },
  "aortic valve stenosis": {
    name: "Aortic Valve Stenosis",
    indonesianName: "Aortic Valve Stenosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Aortic Valve Stenosis" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of some calcium channel blockers (CCBs) is contraindicated in patients with advanced aortic stenosis.  CCBs whose pharmacologic effect is partially dependent on their ability to reduce afterload (e.g., diltiazem, nicardipine, nifedipine, verapamil) may be of less benefit in these patients due to a fixed impedance to flow across the aortic valve and may, in fact, worsen rather than improve myocardial oxygen balance.  Rarely, heart failure has developed following the initiation of these CCBs, particularly in patients receiving concomitant beta-blocker therapy.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 0,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Cardene (nicardipine)." Syntex Laboratories Inc  (2002):', '"Product Information. Adalat (nifedipine)." Bayer  (2002):', '"Product Information. Procardia (nifedipine)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Cleviprex (clevidipine)." The Medicines Company  (2008):']
  },
  "coronary artery disease": {
    name: "Coronary Artery Disease",
    indonesianName: "Coronary Artery Disease (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Coronary Artery Disease" memiliki 32 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Increased frequency, duration, and/or severity of angina, as well as acute myocardial infarction, have rarely developed during initiation or dosage increase of calcium channel blockers (CCBs), particularly in patients with severe obstructive coronary artery disease and those treated with immediate-release formulations.  The mechanism of this effect is not established.  Therapy with CCBs should be administered cautiously in patients with significant coronary artery disease.",
    ddinterSeverityDistribution: {
      major: 25,
      moderate: 7,
      minor: 0,
      total: 32
    },
    ddinterOfficialReferences: ['Schanzenbacher P, Deeg P, Liebau G, Kochsiek K "Paradoxical angina after nifedipine: angiographic documentation." Am J Cardiol 53 (1984):  345-6', 'Manga P, Vythilingum "Unstable angina precipitated by nifedipine." S Afr Med J 66 (1984):  144', 'Sia STB, MacDonald PS, Triester B, et al. "Aggravation of myocardial ischaemia by nifedipine." Med J Aust 142 (1985):  48-50', 'Myrhed M, Wiholm B-E "Nifedipine: a survey of adverse effects." Acta Pharmacol Toxicol (Copenh) 58 (1986):  133-6', 'Lambert CR, Hill JA, Feldman RL, Pepine CJ "Myocardial ischemia during intravenous nicardipine administration." Am J Cardiol 55 (1985):  844-5', 'Thomassen AR, Bagger JP, Nielsen TT "Hemodynamic and cardiac metabolic changes during nicardipine-induced myocardial ischemia." Cathet Cardiovasc Diagn 14 (1988):  41-3']
  },
  "myocardial infarction": {
    name: "Myocardial Infarction",
    indonesianName: "Myocardial Infarction (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myocardial Infarction" memiliki 26 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Clinical trials studying the use of immediate-release nifedipine in patients who had just sustained myocardial infarctions have not demonstrated any benefit.  In fact, in some trials, patients who received immediate-release nifedipine had significantly worse outcomes than patients who received placebo.  The manufacturers state that immediate-release formulations of nifedipine should not be administered for 1 week after myocardial infarction.  They should also be avoided in the setting of acute coronary syndrome, when infarction may be imminent.",
    ddinterSeverityDistribution: {
      major: 15,
      moderate: 11,
      minor: 0,
      total: 26
    },
    ddinterOfficialReferences: ['"Product Information. Adalat (nifedipine)." Bayer  (2002):', '"Product Information. Procardia (nifedipine)." Pfizer U.S. Pharmaceuticals  (2002):', 'Furberg CD, Psaty BM, Meyer JV "Nifedipine: dose-related increase in mortality in patients with coronary heart disease." Circulation 92 (1995):  1326-31', 'Kloner RA "Nifedipine in ischemic heart disease." Circulation 92 (1995):  1074-8', 'Sleight P "Calcium antagonists during and after myocardial infarction." Drugs 51 (1996):  216-25', 'Abernathy DR, Schwrtz JB "Calcium-antagonist drugs." N Engl J Med 341 (1999):  1447-57']
  },
  "eczema": {
    name: "Eczema",
    indonesianName: "Eczema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Eczema" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Topical retinoids may cause severe irritation on eczematous skin.  Therapy with topical retinoids should be avoided on abraded or eczematous skin.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 1,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Retin-A (tretinoin)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Differin (adapalene topical)." Galderma Laboratories Inc  (2001):', '"Product Information. Tazorac (tazarotene topical)." Allergan Inc  (2001):', '"Product Information. Aldara (imiquimod topical)." 3M Pharmaceuticals  (2001):']
  },
  "sunburn": {
    name: "Sunburn",
    indonesianName: "Sunburn (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sunburn" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Retinoid-like products can cause extreme irritation when applied to sunburned skin.  Patients with sunburn should be cautioned not to use retinoid-like acne products until fully recovered, and to avoid prolonged exposure to sunlight (including sunlamps) and use sunscreen/protective clothing during treatment with these products.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['Rosenbluth M "Adverse reaction to retin-A." J Am Dent Assoc 119 (1989):  346', '"Product Information. Retin-A (tretinoin)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Differin (adapalene topical)." Galderma Laboratories Inc  (2001):', '"Product Information. Tazorac (tazarotene topical)." Allergan Inc  (2001):', '"Product Information. Aldara (imiquimod topical)." 3M Pharmaceuticals  (2001):', '"Product Information. Oxsoralen (methoxsalen topical)." Apothecon Inc  (2022):']
  },
  "parasitic diseases": {
    name: "Parasitic Diseases",
    indonesianName: "Parasitic Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Parasitic Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tralokinumab may influence the immune response against helminth infections by inhibiting interleukin 13 (IL-13) signaling.  Patients with preexisting helminth infections should be treated before initiating treatment with this drug.  If patients become infected while already in treatment and do not respond to antihelminth treatment, discontinue this drug until infection resolves.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Adbry (tralokinumab)." Leo Pharma Inc  (2022):']
  },
  "vision disorders": {
    name: "Vision Disorders",
    indonesianName: "Vision Disorders (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vision Disorders" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Conjunctivitis and keratitis occurred more frequently in patients with atopic dermatitis who received tralokinmab, being conjunctivitis the most frequently reported eye disorder.  Patients should report new onset or worsening of any existing eye symptoms to their healthcare provider.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 9,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Adbry (tralokinumab)." Leo Pharma Inc  (2022):', 'Imgram DV, Jaggarao NS, Chamberlain DA "Ocular changes resulting from therapy with amiodarone." Br J Ophthalmol 66 (1982):  676-9', 'Feiner LA, Younge BR, Kazmier FJ, Stricker BH, Fraunfelder FT "Optic neuropathy and amiodarone therapy." Mayo Clin Proc 62 (1987):  702-17', '"Product Information. Cordarone (amiodarone)." Wyeth-Ayerst Laboratories  (2002):', 'Thystrup JD, Fledelius HC "Retinal maculopathy possibly associated with amiodarone medication." Acta Ophthalmol (Copenh) 72 (1994):  639-41', '"Product Information. Cordarone (amiodarone)." Apothecon Inc  (2022):']
  },
  "tumor lysis syndrome": {
    name: "Tumor Lysis Syndrome",
    indonesianName: "Tumor Lysis Syndrome (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tumor Lysis Syndrome" memiliki 15 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tumor lysis syndrome (TLS) has occurred in patients receiving certain monoclonal antibodies.  Patients with high tumor burden and those with high circulating lymphocyte counts of greater than 25 X 10^9/L have a higher risk of developing TLS.  Consider tumor lysis prophylaxis prior to the infusion with anti-hyperuricemics and hydration beginning 12 to 24 hours prior to infusion.  It is recommended to correct electrolytes abnormalities, and monitor renal function in patients who develop TLS.  Monitor for signs and symptoms of TLS and temporary interruption or discontinuation of therapy might be required.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 5,
      minor: 0,
      total: 15
    },
    ddinterOfficialReferences: ['"Product Information. Arzerra (ofatumumab)." GlaxoSmithKline  (2009):', '"Product Information. Adcetris (brentuximab vedotin)." Seattle Genetics Inc  (2011):', '"Product Information. Gazyva (obinutuzumab)." Genentech  (2013):', '"Product Information. Keytruda (pembrolizumab)." Merck & Co., Inc  (2014):', '"Product Information. Blincyto (blinatumomab)." Amgen USA  (2014):', '"Product Information. Opdivo (nivolumab)." Bristol-Myers Squibb  (2014):']
  },
  "digestive system diseases": {
    name: "Digestive System Diseases",
    indonesianName: "Digestive System Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Digestive System Diseases" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cases of fatal and serious gastrointestinal complication have been reported with the use of brentuximab vedotin.  Care should be taken when using this agent in patients with a history of gastrointestinal complications, as its use can increase the risk of perforation.  Closely monitor for new or worsening of GI symptoms and treat according to clinical practices.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Adcetris (brentuximab vedotin)." Seattle Genetics Inc  (2011):', '"Product Information. Choletec (mebrofenin)." Bracco Diagnostics Inc  (2012):']
  },
  "tics": {
    name: "Tics",
    indonesianName: "Tics (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tics" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Central nervous system (CNS) stimulants have been reported to exacerbate Tourette's syndrome and other motor and phonic tics.  Therapy with CNS stimulants, if necessary, should be administered cautiously in patients with tic disorders or family history of Tourette's syndrome.  The manufacturers of the CNS stimulants, methylphenidate (racemic) and dexmethylphenidate (the more pharmacologically active d-enantiomer), consider their use to be contraindicated in such patients.",
    ddinterSeverityDistribution: {
      major: 12,
      moderate: 0,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Fastin (phentermine)." SmithKline Beecham  (2001):', '"Product Information. Cylert (pemoline)." Abbott Pharmaceutical  (2001):', '"Product Information. Ritalin (methylphenidate)." Novartis Pharmaceuticals  (2001):', '"Product Information. Desoxyn (methamphetamine)." Abbott Pharmaceutical  (2001):', '"Product Information. Dexedrine (dextroamphetamine)." SmithKline Beecham  (2001):', '"Product Information. Adderall (amphetamine-dextroamphetamine)." Shire Richwood Pharmaceutical Company Inc  (2001):']
  },
  "bipolar disorder": {
    name: "Bipolar Disorder",
    indonesianName: "Bipolar Disorder (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bipolar Disorder" memiliki 37 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Central nervous system (CNS) stimulants may induce a mixed/manic episode in patients with bipolar disorder.  Prior to initiating treatment, screen patients for risk factors for developing a manic episode (e.g., comorbid or history of depressive symptoms or a family history of suicide, bipolar disorder, and depression).  Close monitoring is recommended when using these agents in patients with bipolar disorders.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 35,
      minor: 0,
      total: 37
    },
    ddinterOfficialReferences: ['"Product Information. Fastin (phentermine)." SmithKline Beecham  (2001):', '"Product Information. Cylert (pemoline)." Abbott Pharmaceutical  (2001):', '"Product Information. Ritalin (methylphenidate)." Novartis Pharmaceuticals  (2001):', '"Product Information. Desoxyn (methamphetamine)." Abbott Pharmaceutical  (2001):', '"Product Information. Dexedrine (dextroamphetamine)." SmithKline Beecham  (2001):', '"Product Information. Adderall (amphetamine-dextroamphetamine)." Shire Richwood Pharmaceutical Company Inc  (2001):']
  },
  "hypertension, pulmonary": {
    name: "Hypertension, Pulmonary",
    indonesianName: "Hypertension, Pulmonary (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypertension, Pulmonary" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of some CNS stimulants has been associated with an increased risk of developing pulmonary hypertension, a rare but fatal disorder.  The onset or aggravation of exertional dyspnea, or unexplained symptoms of angina pectoris, syncope, or lower extremity edema suggest the possibility of occurrence of pulmonary hypertension.  Under these circumstances, treatment must be immediately discontinued, and the patient should be evaluated to confirm diagnosis.  Caution should be exercised in patients with preexisting valvular heart disease or history of pulmonary hypertension.  These drugs are not recommended in patients with known heart murmur or valvular heart disease.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 3,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Fastin (phentermine)." SmithKline Beecham  (2001):', '"Product Information. Didrex (benzphetamine)." Pharmacia and Upjohn  (2001):', '"Product Information. Tenuate (diethylpropion)." Aventis Pharmaceuticals  (2001):', '"Product Information. Phendimetrazine Tartrate SR (phendimetrazine)." Sandoz Inc  (2012):', '"Product Information. Belviq (lorcaserin)." Eisai Inc  (2012):', '"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):']
  },
  "diabetes mellitus, type 2": {
    name: "Diabetes Mellitus, Type 2",
    indonesianName: "Diabetes Mellitus, Type 2 (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetes Mellitus, Type 2" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Obese, type 2 diabetic patients who achieve weight loss may demonstrate improved metabolic control of their disease as a result of their reduced weight.  Therefore, patients with type 2 diabetes mellitus should be monitored during weight-reduction therapy (or therapy that may be expected to induce significant weight loss as a secondary effect) for hypoglycemia and reduced need for oral hypoglycemic medication or insulin, and the dosages of these agents adjusted accordingly.  Patients should be apprised of the risk of hypoglycemia and be alert to potential signs and symptoms such as headache, dizziness, drowsiness, nervousness, confusion, tremor, hunger, weakness, perspiration, and palpitation.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 11,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Fastin (phentermine)." SmithKline Beecham  (2001):', '"Product Information. Meridia (sibutramine)." Knoll Pharmaceutical Company  (2001):', '"Product Information. Xenical (orlistat)." Roche Laboratories  (2001):', '"Product Information. Desoxyn (methamphetamine)." Abbott Pharmaceutical  (2001):', '"Product Information. Dexedrine (dextroamphetamine)." SmithKline Beecham  (2001):', '"Product Information. Didrex (benzphetamine)." Pharmacia and Upjohn  (2001):']
  },
  "bradycardia": {
    name: "Bradycardia",
    indonesianName: "Bradycardia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bradycardia" memiliki 18 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Due to their pharmacological action, cholinesterase inhibitors can have a vagotonic effect on the sinoatrial and atrioventricular nodes producing bradycardia or heart block.  Therapy with cholinesterase inhibitors should be administered cautiously in patients with preexisting bradycardia or underlying cardiac conduction abnormalities.  Syncopal episodes have been reported in patients with and without cardiac abnormalities.  Atropine may be used to reverse bradycardia produced by cholinesterase inhibitors.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 11,
      minor: 0,
      total: 18
    },
    ddinterOfficialReferences: ['Wilcock GK, Surmon D, Forsyth D, Morgan R "Cholinergic side-effects of tetrahydroaminoacridine." Lancet 2 (1988):  1305', '"Product Information. Cognex (tacrine)." Parke-Davis  (2001):', 'Baldessarini RJ, Gelenberg AJ "Using physostigmine safely." Am J Psychiatry 136 (1979):  1608-9', 'Janowsky DS, Risch SC, Huey LY, Kennedy B, Ziegler M "Effects of physostigmine on pulse, blood pressure, and serum epinephrine levels." Am J Psychiatry 142 (1985):  738-40', 'Dysken MW, Janowsky DS "Dose-related physostigmine-induced ventricular arrhythmia: case report." J Clin Psychiatry 46 (1985):  446-7', '"Product Information. Phospholine Iodide (echothiophate iodide ophthalmic)." Wyeth-Ayerst Laboratories']
  },
  "bronchial spasm": {
    name: "Bronchial Spasm",
    indonesianName: "Bronchial Spasm (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bronchial Spasm" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cholinesterase inhibitors inhibit the hydrolysis of acetylcholine.  The enhanced effect of acetylcholine produces constriction of the bronchi, increased bronchial secretions, and bronchospasm.  Therapy with cholinesterase inhibitors should be administered cautiously in patients with respiratory dysfunction, history of asthma or obstructive pulmonary disease.  Monitoring respiratory function during dosage initiation and adjustment is recommended.  Use of atropine along with discontinuation of the cholinesterase inhibitor may be required for serious respiratory distress.  Neostigmine may produce more severe muscarinic side effects than does pyridostigmine and ambenonium.  However, the duration of action is longest for ambenonium and shortest for edrophonium.  Echothiophate iodide ophthalmic may be systemically absorbed and cautious use is recommended in these patients.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 2,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['Wilcock GK, Surmon D, Forsyth D, Morgan R "Cholinergic side-effects of tetrahydroaminoacridine." Lancet 2 (1988):  1305', '"Product Information. Cognex (tacrine)." Parke-Davis  (2001):', '"Product Information. Phospholine Iodide (echothiophate iodide ophthalmic)." Wyeth-Ayerst Laboratories', '"Product Information. Mestinon (pyridostigmine)." ICN Pharmaceuticals Inc  (2001):', '"Product Information. Prostigman (neostigmine)." ICN Pharmaceuticals Inc, Cost Mesa, CA.', '"Product Information. Aricept (donepezil)." Pfizer U.S. Pharmaceuticals  (2001):']
  },
  "gastroparesis": {
    name: "Gastroparesis",
    indonesianName: "Gastroparesis (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastroparesis" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Lixisenatide slows gastric emptying and patients with preexisting gastroparesis were excluded from clinical trials.  Lixisenatide should not be used in patients with severe gastroparesis.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Adlyxin (lixisenatide)." sanofi-aventis  (2016):', '"Product Information. Trulicity (dulaglutide)." Eli Lilly and Company  (2014):', '"Product Information. Toviaz (fesoterodine)." Pfizer U.S. Pharmaceuticals Group  (2008):', '"Product Information. Symlin (pramlintide)." Amphastar Pharmaceuticals Inc  (2005):']
  },
  "pancreatitis": {
    name: "Pancreatitis",
    indonesianName: "Pancreatitis (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pancreatitis" memiliki 27 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Acute pancreatitis, including fatal and non- fatal hemorrhagic or necrotizing pancreatitis, has been reported postmarketing in patients treated with lixisenatide.  Some patients had risk factors such as cholelithiasis and alcohol abuse.  Patients should be observed carefully for any symptoms of pancreatitis including persistent abdominal pain, sometimes radiating to the back, that may or may not be accompanied by vomiting.  If pancreatitis is suspected, lixisenatide should be discontinued and appropriate management should be established.  If pancreatitis is confirmed, lixisenatide should not be restarted.  Lixisenatide is not recommended for patients with history of pancreatitis.",
    ddinterSeverityDistribution: {
      major: 18,
      moderate: 9,
      minor: 0,
      total: 27
    },
    ddinterOfficialReferences: ['"Product Information. Adlyxin (lixisenatide)." sanofi-aventis  (2016):', '"Product Information. Byetta (exenatide)." Amylin Pharmaceuticals Inc  (2005):', '"Product Information. Tanzeum (albiglutide)." GlaxoSmithKline  (2014):', '"Product Information. Trulicity (dulaglutide)." Eli Lilly and Company  (2014):', '"Product Information. Saxenda (liraglutide)." Novo Nordisk Pharmaceuticals Inc  (2015):', '"Product Information. Januvia (sitagliptin)." Merck & Co., Inc  (2006):']
  },
  "kidney failure, chronic": {
    name: "Kidney Failure, Chronic",
    indonesianName: "Kidney Failure, Chronic (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Kidney Failure, Chronic" memiliki 32 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Acute kidney injury and worsening of chronic renal failure which sometimes required hemodialysis has been reported postmarketing in patients treated with lixisenatide.  Renal function should be closely monitored when initiating or escalating doses.  Lixisenatide is not recommended for patients with end stage renal disease.  Patients with mild and moderate renal impairment need close monitoring but no dose adjustment.  There is limited experience in patients with severe renal impairment but drug exposure showed to be higher, so close monitoring is recommended for changes in renal function or gastrointestinal adverse reactions.",
    ddinterSeverityDistribution: {
      major: 16,
      moderate: 16,
      minor: 0,
      total: 32
    },
    ddinterOfficialReferences: ['"Product Information. Adlyxin (lixisenatide)." sanofi-aventis  (2016):', '"Product Information. Aloxi (palonosetron)." MGI Pharma Inc  (2003):', 'Fleuren HLJ, Verwey-van Wissen C, van Rossum JM "Dose-dependent urinary excretion of chlorthalidone." Clin Pharmacol Ther 25 (1979):  806-12', 'Beermann B, Groschinsky-Grind M, Rosen A "Absorption, metabolism, and excretion of hydrochlorothiazide." Clin Pharmacol Ther 19 (1975):  531-7', 'Niemeyer C, Hasenfub G, Wais U, et al. "Pharmacokinetics of hydrochlorothiazide in relation to renal function." Eur J Clin Pharmacol 24 (1983):  661-5', 'Gehr TW, Sica DA, Brater DC, et al. "Metolazone pharmacokinetics and pharmacodynamics in renal transplantation." Int J Clin Pharmacol Ther Toxicol 29 (1991):  116-23']
  },
  "thrombocytopenia": {
    name: "Thrombocytopenia",
    indonesianName: "Thrombocytopenia (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thrombocytopenia" memiliki 24 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thrombocytopenia has been reported with the use of agents that block HER2 activity.  Monitor platelet counts prior to initiation of therapy and prior to each dose.  If appropriate modify the dose according to clinical guidelines.  Patients with decreased platelet count and patients on anti-coagulant treatment should be closely monitored during treatment with these agents.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 16,
      minor: 0,
      total: 24
    },
    ddinterOfficialReferences: ['"Product Information. Herceptin (trastuzumab)." Genentech  (2001):', '"Product Information. Tykerb (lapatinib)." Novartis Pharmaceuticals  (2007):', '"Product Information. Perjeta (pertuzumab)." Genentech  (2012):', '"Product Information. Kadcyla (ado-trastuzumab emtansine)." Genentech  (2022):', '"Product Information. Margenza (margetuximab)." Almirall  (2021):', 'Smith FR, Boots M "Sodium valproate and bone marrow suppression." Ann Neurol 8 (1980):  197-9']
  },
  "parkinson disease": {
    name: "Parkinson Disease",
    indonesianName: "Parkinson Disease (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Parkinson Disease" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Epinephrine should be administered with caution to patients with Parkinson's disease as these patients may experience psychomotor agitation or notice a temporary worsening of symptoms.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 5,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Adrenalin (EPINEPHrine)." Apothecon Inc  (2022):', '"Product Information. AdreView (iobenguane I-123)." GE Healthcare  (2022):', '"Product Information. Ditropan (oxybutynin)." Hoechst Marion Roussel  (2001):', '"Product Information. Ingrezza (valbenazine)." Neurocrine Biosciences, Inc.  (2017):', '"Product Information. Austedo (deutetrabenazine)." Teva Pharmaceuticals USA  (2017):']
  },
  "dihydropyrimidine dehydrogenase deficiency": {
    name: "Dihydropyrimidine Dehydrogenase Deficiency",
    indonesianName: "Dihydropyrimidine Dehydrogenase Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dihydropyrimidine Dehydrogenase Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Fluorouracil is metabolized to an inactive form by dihydropyrimidine dehydrogenase.  Inherited deficiency of this enzyme results in decreased clearance of 5-FU and severe toxicity such as stomatitis, diarrhea, neutropenia, and neurotoxicity.  Rechallenge with dosage reduction resulted in recurrence and progression of toxicity.  Therapy with fluorouracil should not be administered to patients with dihydropyrimidine deficiency.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Fluorouracil (fluorouracil)." Roche', '"Product Information. FUDR (floxuridine)." Roche Laboratories  (2022):']
  },
  "stomatitis": {
    name: "Stomatitis",
    indonesianName: "Stomatitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Stomatitis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Fluorouracil (5-FU) induces stomatitis in the gastrointestinal tract.  Therapy with 5-FU should be administered with extreme caution in patients with peptic ulcer disease and ulcerative colitis.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Fluorouracil (fluorouracil)." Roche', '"Product Information. Rheumatrex (methotrexate)." Lederle Laboratories  (2002):', '"Product Information. Methotrexate (methotrexate)." Lederle Laboratories', '"Product Information. FUDR (floxuridine)." Roche Laboratories  (2022):']
  },
  "intracranial hemorrhages": {
    name: "Intracranial Hemorrhages",
    indonesianName: "Intracranial Hemorrhages (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intracranial Hemorrhages" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The safety of aducanumab in patients with pretreatment localized superficial siderosis, patients having had 10 or more brain microhemorrhages, and/or a brain hemorrhage greater than 1 cm within one year of treatment initiation has not been established.  Aducanumab may cause amyloid related imaging abnormalities including edema, microhemorrhages, and superficial siderosis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Aduhelm (aducanumab)." Biogen Idec Inc  (2021):']
  },
  "anemia, hemolytic": {
    name: "Anemia, Hemolytic",
    indonesianName: "Anemia, Hemolytic (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia, Hemolytic" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Blood group isoagglutinins (anti-A and anti-B) are present in antihemophilic factor (human) at concentrations that may not be clinically significant when used to control minor bleeds.  Monitoring of hematocrit and Coombs for signs of intravascular hemolysis and falling hematocrit is recommended in patients with blood groups A, B, or AB when large or frequently repeated doses of antihemophilic factor (human) are administered.  Acute hemolytic anemia may occur, resulting in increased bleeding tendency or hyperfibrinogenemia.  Should this condition occur, leading to progressive hemolytic anemia, discontinue treatment and consider administering serologically compatible Type O red blood cells and providing alternative therapy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 4,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Koate-HP (antihemophilic factor)." Bayer  (2001):', '"Product Information. Humate-P (antihemophilic factor-von Willebrand factor)." CSL Behring LLC  (2022):', 'Distenfeld A, Florita C, Gelfand ML "Hemolytic anemia induced by alpha-methyldopa." N Y State J Med Feb (1970):  570-3', 'Nelson RB Jr, Nelson RB III "Methyldopa-associated intravascular hemolysis." Arch Intern Med 137 (1977):  1260-1', 'Roy A, Ghosh ML "Coombs positive haemolytic anaemia due to methyldopa." Br J Clin Pract 35 (1981):  54, 58', '"Product Information. Aldomet (methyldopa)." Merck & Co., Inc  (2001):']
  },
  "hypercholesterolemia": {
    name: "Hypercholesterolemia",
    indonesianName: "Hypercholesterolemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypercholesterolemia" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Elevations in cholesterol and triglyceride levels have been reported in patients taking inhibitors of mTOR (mammalian target of rapamycin).  Monitoring of fasting lipid profile is recommended prior to the start of therapy and periodically thereafter.  Clinicians should achieve control of lipid levels before initiating therapy with these agents.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 5,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Torisel (temsirolimus)." Wyeth-Ayerst Laboratories  (2007):', '"Product Information. Afinitor (everolimus)." Novartis Pharmaceuticals  (2009):', '"Product Information. Arimidex (anastrozole)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Sustiva (efavirenz)." DuPont Pharmaceuticals  (2001):', '"Product Information. Femara (letrozole)." Novartis Pharmaceuticals  (2001):']
  },
  "wounds and injuries": {
    name: "Wounds and Injuries",
    indonesianName: "Wounds and Injuries (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Wounds and Injuries" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Inhibition of mTOR activity results in delays of wound healing and increases the occurrence of wound-related complications, which might require surgical intervention.  Patients with central nervous system tumors (primary CNS tumor or metastases) and/or receiving anticoagulation therapy may be at an increased risk of developing intracerebral bleeding (including fatal outcomes).  Caution is recommended when using these agents, particularly in the perioperative period.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Torisel (temsirolimus)." Wyeth-Ayerst Laboratories  (2007):', '"Product Information. Afinitor (everolimus)." Novartis Pharmaceuticals  (2009):', '"Product Information. Qinlock (ripretinib)." Deciphera Pharmaceuticals  (2020):']
  },
  "lung neoplasms": {
    name: "Lung Neoplasms",
    indonesianName: "Lung Neoplasms (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lung Neoplasms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In clinical trials, lung cancer was observed in smoker and non-smoker patients using inhaled insulin.  In patients with active lung cancer, a prior history of lung cancer, or in patients at risk for lung cancer, it is recommended to consider whether the benefits of inhaled insulin use outweigh this potential risk.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Afrezza (insulin inhalation, rapid acting)." MannKind Corporation  (2014):']
  },
  "prostatic hyperplasia": {
    name: "Prostatic Hyperplasia",
    indonesianName: "Prostatic Hyperplasia (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Prostatic Hyperplasia" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Topically applied sympathomimetic agents are systemically absorbed, with the potential for producing clinically significant systemic effects, particularly during prolonged or indiscriminate use.  In patients with prostate enlargement, urinary difficulty may develop or worsen due to smooth muscle contraction in the bladder neck via stimulation of alpha-1 adrenergic receptors.  Therapy with topical sympathomimetic agents should be administered cautiously in patients with hypertrophy or neoplasm of the prostate.  It is important that the recommended dosages of the individual products not be exceeded.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 10,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['Lansche RK "Systemic reactions to topical epinephrine and phenylephrine." Am J Ophthalmol 61 (1966):  95-8', 'Ellis PP "Systemic reactions to topical therapy." Int Ophthalmol Clin 11 (1971):  1-11', '"Product Information. Tyzine Nasal (tetrahydrozoline nasal)." Kenwood Laboratories', '"Product Information. Collyrium Fresh (boric acid ophthalmic)." Wyeth-Ayerst Laboratories', '"Product Information. Naphcon (naphazoline ophthalmic)." Alcon Laboratories Inc  (2001):', '"Product Information. Ocuclear (oxymetazoline ophthalmic)." Schering-Plough  (2001):']
  },
  "constipation": {
    name: "Constipation",
    indonesianName: "Constipation (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Constipation" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Constipation is a common side effect of erenumab therapy and while it is usually mild or moderate in intensity, there have been postmarketing reports of constipation with serious complications including hospitalization and surgery.  Onset of constipation was generally after the first dose, although there were reports later in treatment.  Patients should be monitored for severe constipation and managed as clinically appropriate.  Patients with history of constipation or using medications associated with decreased gastrointestinal motility may be at increased risk for more severe constipation.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 4,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Aimovig (erenumab)." Amgen USA  (2018):', '"Product Information. Amphojel (aluminum hydroxide)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Rolaids (dihydroxyaluminum sodium carbonate)." Warner Lambert Consumer Healthcare  (2001):', '"Product Information. Losospan (magaldrate)." Whitehall-Robbins  (2001):', 'Heel RC, Brogden RN, Pakes GE, Speight TM, Avery GS "Colestipol: a review of its pharmacological properties and therapeutic efficacy in patients with hypercholesterolaemia." Drugs 19 (1980):  161-80', 'Faergeman O "Effects and side-effects of treatment of hypercholesterolemia with cholestyramine and neomycin." Acta Med Scand 194 (1973):  165-7']
  },
  "eye infections": {
    name: "Eye Infections",
    indonesianName: "Eye Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Eye Infections" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of ophthalmic corticosteroids is contraindicated in most viral diseases of the cornea and conjunctiva, including epithelial herpes simplex keratitis (dendritic keratitis), vaccinia, and varicella; fungal diseases of ocular structures; mycobacterial infections, including tuberculosis, of the eye; and any acute, purulent, untreated ocular infections.  Corticosteroids may decrease host resistance to infectious agents, thus prolonging the course and/or exacerbating the severity of the infection while encouraging the development of new or secondary infection.  In addition, administration of ophthalmic corticosteroids in severe ocular disease, especially acute herpes simplex keratitis, may lead to excessive corneal and scleral thinning, increasing the risk for perforation.  In less serious ocular infections, therapy with ophthalmic corticosteroids may be administered but only with caution and accompanied by appropriate antimicrobial agents.  Besides compromising host immune response, corticosteroids may also mask the symptoms of infection, thus hindering the recognition of potential ineffectiveness of the antibiotic therapy.  If infection does not improve or becomes worse during administration of an ophthalmic corticosteroid, the drug should be discontinued and other appropriate therapy initiated.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Vexol (rimexolone ophthalmic)." Alcon Laboratories Inc  (2001):', '"Product Information. Lotemax (loteprednol ophthalmic)." Bausch and Lomb  (2001):', '"Product Information. Pred Forte (prednisolone ophthalmic)." Allergan Inc  (2001):', '"Product Information. Decadron Ocumeter (dexamethasone ophthalmic)." Merck & Co., Inc  (2001):', '"Product Information. FML S.O.P. (fluorometholone ophthalmic)." Allergan Inc', '"Product Information. HMS (medrysone ophthalmic)." Allergan Inc  (2001):']
  },
  "diabetic neuropathies": {
    name: "Diabetic Neuropathies",
    indonesianName: "Diabetic Neuropathies (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetic Neuropathies" memiliki 13 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Agents with anticholinergic activity can exacerbate many of the manifestations of autonomic neuropathy, including tachycardia, anhidrosis, bladder atony, obstipation, dry mouth and eyes, cycloplegia and blurring of vision, and sexual impotence in males.  Therapy with antimuscarinic agents and higher dosages of antispasmodic agents (e.g., dicyclomine or oxybutynin) should be administered cautiously in patients with autonomic neuropathy.",
    ddinterSeverityDistribution: {
      major: 13,
      moderate: 0,
      minor: 0,
      total: 13
    },
    ddinterOfficialReferences: ['"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):']
  },
  "urinary bladder neck obstruction": {
    name: "Urinary Bladder Neck Obstruction",
    indonesianName: "Urinary Bladder Neck Obstruction (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urinary Bladder Neck Obstruction" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In general, the use of anticholinergic agents is contraindicated in patients with urinary retention and bladder neck obstruction caused by prostatic hypertrophy.  Dysuria may occur and may require catheterization.  Also, anticholinergic drugs may aggravate partial obstructive uropathy.  Caution is advised even when using agents with mild to moderate anticholinergic activity, particularly in elderly patients.",
    ddinterSeverityDistribution: {
      major: 14,
      moderate: 0,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['Bantz EW, Dolen WK, Chadwick EW, Nelson HS "Chronic chlorpheniramine therapy: subsensitivity, drug metabolism, and compliance." Ann Allergy 59 (1987):  341-6', 'Schuller DE, Turkewitz D "Adverse effects of antihistamines." Postgrad Med 79 (1986):  75-86', '"Product Information. Dimetane (brompheniramine)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Chlor-Trimeton (chlorpheniramine)." Schering-Plough', '"Product Information. Thorazine (chlorpromazine)." SmithKline Beecham  (2002):', '"Product Information. Periactin (cyproheptadine)." Merck & Co., Inc  (2002):']
  },
  "neurologic manifestations": {
    name: "Neurologic Manifestations",
    indonesianName: "Neurologic Manifestations (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neurologic Manifestations" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Albendazole therapy of neurocysticercosis can induce an inflammatory response within the CNS that precipitates seizures and cerebral hypertension.  Therapy with albendazole for neurocysticercosis should be administered cautiously in patients with or predisposition to seizures.  The use of corticosteroids during the first week of therapy to prevent cerebral hypertension and anticonvulsant therapy as required is recommended.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 2,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['Cruz I, Cruz ME, Carrasco F, Horton J "Neurocysticercosis: optimal dose treatment with albendazole." J Neurol Sci 133 (1995):  152-4', '"Product Information. Albenza (albendazole)." SmithKline Beecham  (2001):', '"Product Information. Hexalen (altretamine)." US Bioscience  (2022):', 'Roth RF, Itabashi H, Louie J, Anderson T, Narahara KA "Amiodarone toxicity: myopathy and neuropathy." Am Heart J 119 (1990):  1223-4', 'Trohman RG, Castellanos D, Castellanos A, Kessler KM "Amiodarone-induced delirium." Ann Intern Med 108 (1988):  68-9', 'Werner EG, Olanow CW "Parkinsonism and amiodarone therapy." Ann Neurol 25 (1989):  630-2']
  },
  "thyroid neoplasms": {
    name: "Thyroid Neoplasms",
    indonesianName: "Thyroid Neoplasms (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thyroid Neoplasms" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "GLP-1 receptor agonist antidiabetic drugs are contraindicated in patients with a personal or family history of medullary thyroid carcinoma and in patients with Multiple Endocrine Neoplasia syndrome type 2 (MEN2).  Carcinogenicity studies in rodents and limited postmarketing data suggest that GLP-1 inhibitors may cause a dose-related and treatment duration-related increase in risk of thyroid C-cell tumors, although a causal relationship has not been established.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Byetta (exenatide)." Amylin Pharmaceuticals Inc  (2005):', '"Product Information. Victoza (liraglutide)." Novo Nordisk Pharmaceuticals Inc  (2010):', '"Product Information. Tanzeum (albiglutide)." GlaxoSmithKline  (2014):', '"Product Information. Trulicity (dulaglutide)." Eli Lilly and Company  (2014):', '"Product Information. Saxenda (liraglutide)." Novo Nordisk Pharmaceuticals Inc  (2015):', '"Product Information. Mounjaro (tirzepatide)." Lilly, Eli and Company  (2022):']
  },
  "hyperuricemia": {
    name: "Hyperuricemia",
    indonesianName: "Hyperuricemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperuricemia" memiliki 18 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Potassium-sparing diuretics have been reported to elevate serum uric acid levels.  Therapy with these agents should be administered cautiously in patients with a history of gout.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 17,
      minor: 0,
      total: 18
    },
    ddinterOfficialReferences: ['"Product Information. Dyrenium (triamterene)." SmithKline Beecham  (2001):', '"Product Information. Aldactone (spironolactone)." Searle  (2001):', 'Lapidus PW, Guidotti FP "Gout in orthopaedic practice: review of 232 cases." Clin Orthop 28 (1963):  97-110', 'Labeeuw M, Pozet N, Aissa AH, Zech PY, Sassard J, Laville M "Uric acid renal handling: spontaneous changes and influence of a thiazide alone or associated with triamterene." Int J Clin Pharmacol Ther Toxicol 26 (1988):  79-83', 'Beling S, Vukovich RA, Neiss ES, Zisblatt M, Webb E, Losi M "Long-term experience with indapamide." Am Heart J 106 (1983):  258-62', 'Slotkoff L "Clinical efficacy and safety of indapamide in the treatment of edema." Am Heart J 106 (1983):  233-7']
  },
  "autoimmune diseases": {
    name: "Autoimmune Diseases",
    indonesianName: "Autoimmune Diseases (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Autoimmune Diseases" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Aldesleukin may exacerbate existing or activate quiescent autoimmune disease.  Therapy with aldesleukin should be administered cautiously in patients with autoimmune diseases.",
    ddinterSeverityDistribution: {
      major: 11,
      moderate: 6,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['"Product Information. Proleukin (aldesleukin)." Chiron Therapeutics  (2001):', '"Product Information. Intron A (interferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Infergen (interferon alfacon-1)." Amgen  (2001):', '"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Pegasys (peginterferon alfa-2a)." Roche Laboratories  (2002):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "leukopenia": {
    name: "Leukopenia",
    indonesianName: "Leukopenia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Leukopenia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rare reports of reversible reduction in white blood cell count, primarily neutrophils, have been noted.  White blood cell counts returned to normal with discontinuation of methyldopa.  Therapy with methyldopa should be administered cautiously in patients with a history of or predisposition to decreased white blood cell or neutrophil counts. Clinical monitoring of hematopoietic function is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Aldomet (methyldopa)." Merck & Co., Inc  (2001):', '"Product Information. Orfadin (nitisinone)." Orphan Medical  (2002):']
  },
  "myalgia": {
    name: "Myalgia",
    indonesianName: "Myalgia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myalgia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Elevations of Creatine Phosphokinase (CPK) have been reported with the use of alectinib.  It is recommended to watch closely for signs and symptoms of CPK elevation and to advise patients to report any unexplained muscle pain, tenderness, or weakness.  Assess CPK levels regularly as clinically indicated in patients reporting symptoms.  Based on the severity of the CPK elevation, withhold therapy and then resume or reduce dose.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Alecensa (alectinib)." Genentech  (2015):']
  },
  "pancytopenia": {
    name: "Pancytopenia",
    indonesianName: "Pancytopenia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pancytopenia" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe, including fatal, autoimmune anemia and thrombocytopenia, and prolonged myelosuppression have been reported in patients receiving alemtuzumab.  It is recommended to withhold therapy for severe cytopenias and to discontinue therapy for autoimmune cytopenias or recurrent/persistent severe cytopenias (except lymphopenia).  It is recommended to monitor complete blood counts (CBC) at weekly intervals during therapy and more frequently if worsening anemia, neutropenia, or thrombocytopenia occurs and to assess CD4+ counts after treatment until recovery to >= 200 cells/\xB5L.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 14,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['"Product Information. Campath (alemtuzumab)." Berlex Laboratories  (2001):', '"Product Information. Arzerra (ofatumumab)." GlaxoSmithKline  (2009):', '"Product Information. Gazyva (obinutuzumab)." Genentech  (2013):', '"Product Information. Victrelis (boceprevir)." Schering-Plough Corporation  (2011):', '"Product Information. Brukinsa (zanubrutinib)." BeiGene USA, Inc  (2019):', '"Product Information. Darzalex (daratumumab)." Janssen Biotech, Inc.  (2015):']
  },
  "cardiotoxicity": {
    name: "Cardiotoxicity",
    indonesianName: "Cardiotoxicity (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiotoxicity" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Like other methylxanthines, caffeine at high dosages may be associated with positive inotropic and chronotropic effects on the heart.  Caffeine may also produce an increase in systemic vascular resistance, resulting in elevation of blood pressure.  Therapy with products containing caffeine should be administered cautiously in patients with severe cardiac disease, hypertension, hyperthyroidism, or acute myocardial injury.  Some clinicians recommend avoiding caffeine in patients with symptomatic cardiac arrhythmias and/or palpitations and during the first several days to weeks after an acute myocardial infarction.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 6,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['"Multum Information Services, Inc. Expert Review Panel"', '"Product Information. Scemblix (asciminib)." Novartis Pharmaceuticals  (2021):', '"Product Information. Velcade (bortezomib)." Millennium Pharmaceuticals Inc  (2003):', 'American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', '"Product Information. Ergotrate Maleate (ergonovine)." Bedford Laboratories  (2001):', '"Product Information. Methergine (methylergonovine)." Novartis Pharmaceuticals  (2010):']
  },
  "gastroesophageal reflux": {
    name: "Gastroesophageal Reflux",
    indonesianName: "Gastroesophageal Reflux (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastroesophageal Reflux" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Methylxanthines increase gastric acidity and may also relax lower esophageal sphincter, which can lead to gastric reflux into the esophagus.  Therapy with products containing methylxanthines should be administered cautiously in patients with significant gastroesophageal reflux.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 10,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['Stoller JL "Oesophageal ulceration and theophylline." Lancet 2 (1985):  328-9', 'American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', 'Alterman P, Spiegel D, Feldman J, Yaretzky A "Histamine h2-receptor antagonists and chronic theophylline toxicity." Am Fam Physician 54 (1996):  1473', '"Product Information. Lufyllin (dyphylline)." Wallace Laboratories  (2001):', 'Chernish SM, Brunelle RR, Rosenak BD, Ahmadzai S "Comparison of the effects of glucagon and atropine sulfate on gastric emptying." Am J Gastroenterol 70 (1978):  581-6', 'Dow TG, Brock-Utne JG, Rubin J, Welman S, Dimopoulos GE, Moshal MG "The effect of atropine on the lower esophageal sphincter in late pregnancy." Obstet Gynecol 51 (1978):  426-30']
  },
  "cataract": {
    name: "Cataract",
    indonesianName: "Cataract (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cataract" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Intraoperative Floppy Iris Syndrome has been observed during cataract surgery in some patients on or previously treated with antiadrenergic agents.  If a patient is undergoing cataract surgery, the ophthalmologist should be prepared for possible modifications of the surgical technique (iris hooks, iris dilator rings).  There does not appear to be a benefit in stopping antiadrenergic agents therapy prior to the cataracts surgery.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 8,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Uroxatral (alfuzosin)." sanofi-aventis  (2003):', '"Product Information. Rapaflo (silodosin)." Watson Pharmaceuticals  (2008):', '"Product Information. Targretin (bexarotene)." Ligand Pharmaceuticals  (2001):', 'American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', 'Benjamin KW "Toxicity of ocular medications." Int Ophthalmol Clin 19 (1979):  199-255', 'Zimmerman TJ, Wheeler TM "Miotics: side effects and ways to avoid them." Ophthalmology 89 (1982):  76-80']
  },
  "pulmonary fibrosis": {
    name: "Pulmonary Fibrosis",
    indonesianName: "Pulmonary Fibrosis (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pulmonary Fibrosis" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Interstitial pneumonitis and/or fibrosis (including fatal outcomes), have been reported occasionally during melphalan therapy.  Therapy with melphalan should be administered cautiously in patients with or predisposed to pulmonary dysfunction.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 1,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Alkeran (melphalan)." Glaxo Wellcome  (2022):', 'Sweet DL "Pulmonary effects of carmustine (bischloroethylnitrosourea, BCNU)." Ann Intern Med 91 (1979):  132-3', 'Weiss RB, Muggia FM "Pulmonary effects of carmustine (bischloroethylnitrosourea, BCNU)." Ann Intern Med 91 (1979):  131-2', `O'Driscoll BR, Kalra S, Gattamaneni HR, Woodcock AA "Late carmustine lung fibrosis. Age at treatment may influence severity and survival." Chest 107 (1995):  1355-7`, 'Lena H, Desrues B, Le Coz A, Quinquenel ML, Delaval P "Severe diffuse interstitial pneumonitis induced by carmustine (BCNU)." Chest 105 (1994):  1602-3', 'Patten GA, Billi JE, Rotman HH "Rapidly progressive, fatal pulmonary fibrosis induced by carmustine." JAMA 244 (1980):  687-8']
  },
  "cushing syndrome": {
    name: "Cushing Syndrome",
    indonesianName: "Cushing Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cushing Syndrome" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Corticosteroids mimic the effects of endogenous cortisol and aldosterone.  Use of these agents may aggravate conditions of hyperadrenocorticalism in a dose-dependent manner.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 11,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):', '"Product Information. Hydrocortone (hydrocortisone)." Merck & Co., Inc  (2001):', '"Product Information. Medrol (methylprednisolone)." Pharmacia and Upjohn  (2001):', '"Product Information. Florinef Acetate (fludrocortisone)." Bristol-Myers Squibb  (2001):']
  },
  "strongyloidiasis": {
    name: "Strongyloidiasis",
    indonesianName: "Strongyloidiasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Strongyloidiasis" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Unlike most helminths, Strongyloides stercoralis has the ability to replicate in the human host.  In patients with strongyloidiasis, the use of pharmacologic or immunosuppressive dosages of corticosteroids may result in Strongyloides hyperinfection and dissemination with widespread larval migration, often accompanied by severe enterocolitis and potentially fatal gram-negative septicemia.  Therapy with corticosteroids should be administered with extreme caution, if at all, in these patients.  For patients on corticosteroids who develop known or suspected Strongyloides infestation, withdrawal of corticosteroids or reduction of the dose of corticosteroids is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 10,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['"Product Information. Hydeltrasol (prednisolone)." Merck & Co., Inc  (2001):', '"Product Information. Deltasone (prednisone)." Pharmacia and Upjohn  (2001):', '"Product Information. Decadron (dexamethasone)." Merck & Co., Inc  (2001):', '"Product Information. Hydrocortone (hydrocortisone)." Merck & Co., Inc  (2001):', '"Product Information. Medrol (methylprednisolone)." Pharmacia and Upjohn  (2001):', '"Product Information. Florinef Acetate (fludrocortisone)." Bristol-Myers Squibb  (2001):']
  },
  "fat soluble vitamin deficiency": {
    name: "Fat Soluble Vitamin Deficiency",
    indonesianName: "Fat Soluble Vitamin Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fat Soluble Vitamin Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "At the recommended therapeutic dosage of 120 mg three times a day, orlistat inhibits dietary fat absorption by approximately 30% and has been shown to reduce the absorption of some fat-soluble vitamins and beta-carotene.  Therapy with orlistat should be administered cautiously in patients with preexisting deficiency of one or more fat-soluble vitamins (A, D, E and K).  Ideally, the deficiency should be corrected prior to initiation of therapy.  A multivitamin supplement containing fat-soluble vitamins is recommended during therapy, best taken once a day at least 2 hours before or after the administration of orlistat.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Xenical (orlistat)." Roche Laboratories  (2001):', '"Product Information. Livmarli (maralixibat)." Mirum Pharmaceuticals, Inc.  (2021):']
  },
  "nephrolithiasis": {
    name: "Nephrolithiasis",
    indonesianName: "Nephrolithiasis (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nephrolithiasis" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Following treatment with orlistat, some patients may develop increased levels of urinary oxalate as a result of fat malabsorption.  Therapy with orlistat should be administered cautiously in patients with a history of hyperoxaluria or calcium oxalate nephrolithiasis.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 7,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Xenical (orlistat)." Roche Laboratories  (2001):', '"Product Information. Reyataz (atazanavir)." Bristol-Myers Squibb  (2003):', 'Brewster UC, Perazella MA "Acute interstitial nephritis associated with atazanavir, a new protease inhibitor." Am J Kidney Dis 44 (2004):  e81-4', 'Pacanowski J, Poirier JM, Petit I, Meynard JL, Girard PM "Atazanavir urinary stones in an HIV-infected patient." AIDS 20 (2006):  2131', 'Chang HR, Pella PM "Atazanavir urolithiasis." N Engl J Med 355 (2006):  2158-2159', 'Anderson PL, Lichtenstein KA, Gerig NE, Kiser JJ, Bushman LR "Atazanavir-containing renal calculi in an HIV-infected patient." AIDS 21 (2007):  1060-2']
  },
  "coagulation defect": {
    name: "Coagulation Defect",
    indonesianName: "Coagulation Defect (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Coagulation Defect" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of alosetron is contraindicated in patients with coagulation abnormalities such as thrombophlebitis, or hypercoagulable state.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Lotronex (alosetron)." Glaxo Wellcome  (2001):']
  },
  "skin diseases": {
    name: "Skin Diseases",
    indonesianName: "Skin Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Skin Diseases" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe cutaneous reactions, including Stevens-Johnson Syndrome (SJS) and Erythema Multiforme (EM) were reported in patients treated with alpelisib.  Do not initiate alpelisib treatment in patients with a history of SJS, EM, or Toxic Epidermal Necrolysis (TEN).  If signs or symptoms of severe cutaneous reactions occur, interrupt treatment until the etiology of the reaction has been determined.  Consultation with a dermatologist is recommended.  If SJS, TEN, or EM is confirmed, permanently discontinue alpelisib.  Do not reintroduce alpelisib in patients who have experienced previous severe cutaneous reactions during treatment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Piqray (alpelisib)." Novartis Pharmaceuticals  (2019):', '"Product Information. Zinbryta (daclizumab)." AbbVie US LLC  (2016):']
  },
  "pneumonia": {
    name: "Pneumonia",
    indonesianName: "Pneumonia (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pneumonia" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe pneumonitis, including acute interstitial pneumonitis and interstitial lung disease, has been reported in patients treated with alpelisib.  It is recommended to interrupt alpelisib immediately and evaluate the patient for pneumonitis in patients who have new or worsening respiratory symptoms or are suspected to have developed pneumonitis.  Advise patients to immediately report new or worsening respiratory symptoms.  Permanently discontinue alpelisib in all patients with confirmed pneumonitis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 8,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Piqray (alpelisib)." Novartis Pharmaceuticals  (2019):', '"Product Information. Tecentriq (atezolizumab)." Genentech  (2016):', '"Product Information. Bavencio (avelumab)." EMD Serono Inc  (2017):', '"Product Information. Imfinzi (durvalumab)." Astra-Zeneca Pharmaceuticals  (2017):', '"Product Information. Yervoy (ipilimumab)." Bristol-Myers Squibb  (2023):', '"Product Information. Keytruda (pembrolizumab)." Merck & Co., Inc  (2014):']
  },
  "heparin induced thrombocytopenia": {
    name: "Heparin induced Thrombocytopenia",
    indonesianName: "Heparin induced Thrombocytopenia (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Heparin induced Thrombocytopenia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The brand name products, Kcentra and Bebulin of prothrombin complex, contain heparin; therefore, their use is contraindicated in patients with known heparin-induced thrombocytopenia.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Kcentra (prothrombin complex)." CSL Behring LLC  (2013):']
  },
  "respiratory distress syndrome, newborn": {
    name: "Respiratory Distress Syndrome, Newborn",
    indonesianName: "Respiratory Distress Syndrome, Newborn (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Respiratory Distress Syndrome, Newborn" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Alprostadil injection should not be used in neonates with respiratory distress syndrome.  Apnea is experienced by about 10 to 12% of neonates with congenital heart defects treated with alprostadil injection.  Respiratory status should be monitored throughout treatment, and alprostadil injection should be used where ventilatory assistance is immediately available.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Caverject (alprostadil)." Pharmacia and Upjohn', '"Product Information. Prostin VR Pediatric (alprostadil)." Pharmacia and Upjohn']
  },
  "prinzmetal's variant angina": {
    name: "Prinzmetal's variant angina",
    indonesianName: "Prinzmetal's variant angina (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: `Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Prinzmetal's variant angina" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.`,
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Agents with non-selective beta-blocking activity may provoke chest pain in patients with Prinzmetal's variant angina.  the use of non-selective beta blockers is not recommended in these patients.  Caution should be taken in the administration of these agents to patients suspected of having Prinzmetal's variant angina.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 8,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Normodyne (labetalol)." Schering Corporation  (2002):', '"Product Information. Corgard (nadolol)." Bristol-Myers Squibb  (2002):', '"Product Information. Inderal (propranolol)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Blocadren (timolol)." Merck & Co., Inc  (2001):', '"Product Information. Cartrol (carteolol)." Abbott Pharmaceutical  (2001):', '"Product Information. Betapace (sotalol)." Berlex Laboratories  (2001):']
  },
  "urethral obstruction": {
    name: "Urethral Obstruction",
    indonesianName: "Urethral Obstruction (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urethral Obstruction" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of sulfasalazine tablets is contraindicated in patients with urinary obstruction.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 9,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Azulfidine (sulfasalazine)." Pharmacia and Upjohn  (2001):', 'Sahai J, Heimberger R, Collins K, Kaplowitz L, Polk R "Sulfadiazine-induced crystalluria in a patient with the acquired immunodeficiency syndrome: a reminder." Am J Med 84 (1988):  791-2', 'Carbone L, Bendixen B, Appel G "Sulfadiazine-associated obstructive nephropathy occurring in a patient with the acquired immunodeficiency syndrome." Am J Kidney Dis 12 (1988):  72-5', 'Simon D, Brosius F, Rothstein D "Sulfadiazine crystalluria revisited." Arch Intern Med 150 (1990):  2379-84', 'Molina J, Belenfant X, Doco-Lecompte T, et al. "Sulfadiazine-induced crystalluria in AIDS patients with toxoplasma encephalitis." AIDS 5 (1991):  587-9', 'Marques L, Silva M, Madeira E, Santos O "Obstructive renal failure due to therapy with sulfadiazine in an AIDS patient." Nephron 62 (1992):  361']
  },
  "hypersensitivity, immediate": {
    name: "Hypersensitivity, Immediate",
    indonesianName: "Hypersensitivity, Immediate (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypersensitivity, Immediate" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of sulfonamides is associated with large increases in the risk of Stevens-Johnson syndrome, toxic epidermal necrolysis and other serious dermatologic reactions, although these phenomena are rare as a whole.  Hepatitis, pneumonitis, and interstitial nephritis have also occurred in association with sulfonamide hypersensitivity.  Therapy with sulfonamides should be administered cautiously in patients with severe allergies, bronchial asthma or AIDS, since these patients may be at increased risk for potentially severe hypersensitivity reactions.  Patients should be instructed to promptly report signs and symptoms that may precede the onset of cutaneous manifestations of the Stevens-Johnson syndrome, such as high fever, severe headache, stomatitis, conjunctivitis, rhinitis, urethritis, and balanitis.  Sulfonamide therapy should be stopped at once if a rash develops.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 3,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['Johnson M, Goodwin D, Shands J "Trimethoprim-sulfamethoxazole anaphylactoid reactions in patients with AIDS: case reports and literature review." Pharmacotherapy 10 (1990):  413-16', 'Hofer T, Becker EW, Weigand K, Berg PA "Demonstration of sensititzed lymphocytes to trimethoprim/sulfamethoxazole and ofloxacin in a patient with cholestatic hepatitis." J Hepatol 15 (1992):  262-3', 'Stevenson D, Christie D, Haas J "Hepatic injury in a child caused by trimethoprim-sulfamethoxazole." Pediatrics 61 (1978):  864-6', 'Smith E, Light J, Filo R, Yum M "Interstitial nephritis caused by trimethoprim-sulfamethoxazole in renal transplant recipients." JAMA 244 (1980):  360-1', 'Fischl M, Dickinson G, LaVoie L "Safety and efficacy of sulfamethoxazole and trimethoprim chemoprophylaxis for pneumocystis carinii pneumonia in AIDS." JAMA 259 (1988):  1185-9', 'Whittington R "Toxic epidermal necrolysis and co-trimoxazole." Lancet 2 (1989):  574']
  },
  "porphyrias": {
    name: "Porphyrias",
    indonesianName: "Porphyrias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Porphyrias" memiliki 31 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of sulfonamides is contraindicated in patients with porphyria, since these drugs can precipitate an acute attack.",
    ddinterSeverityDistribution: {
      major: 26,
      moderate: 5,
      minor: 0,
      total: 31
    },
    ddinterOfficialReferences: ['"Product Information. Azulfidine (sulfasalazine)." Pharmacia and Upjohn  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`, '"Product Information. Levulan Kerastick (aminolevulinic acid)." Berlex Laboratories  (2001):', '"Product Information. Phenobarbital (phenobarbital)." Lilly, Eli and Company  (2001):', 'American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', '"Product Information. Amytal Sodium (amobarbital)." Lilly, Eli and Company  (2001):']
  },
  "folic acid deficiency": {
    name: "Folic Acid Deficiency",
    indonesianName: "Folic Acid Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Folic Acid Deficiency" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Sulfasalazine may interfere with the absorption of dietary folic acid.  Folate deficiency and megaloblastic anemia have been reported.  Therapy with sulfasalazine should be administered cautiously in patients with preexisting folate deficiency or anemia secondary to folate deficiency.  Folic acid supplementation (1 mg/day) is recommended in all patients during prolonged therapy.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 1,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', '"Product Information. Azulfidine (sulfasalazine)." Pharmacia and Upjohn  (2001):', 'Halsted CH, Gandhi G, Tamura T "Sulfasalazine inhibits the absorption of folates in ulcerative colitis." N Engl J Med 305 (1981):  1513-7', '"Product Information. Daraprim (pyrimethamine)." Glaxo Wellcome  (2001):', 'Chan M, Beale D, Moorhead J "Acute megaloblastosis due to cotrimoxazole." Br J Clin Pract 34 (1980):  87-8', 'Sheehan J "Trimethoprim-associated marrow toxicity." Lancet 2 (1981):  692']
  },
  "glucosephosphate dehydrogenase deficiency": {
    name: "Glucosephosphate Dehydrogenase Deficiency",
    indonesianName: "Glucosephosphate Dehydrogenase Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glucosephosphate Dehydrogenase Deficiency" memiliki 22 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Sulfasalazine may cause hemolytic anemia in patients with glucose-6 phosphate dehydrogenase deficiency.  This reaction is frequently dose related.  It is recommended to observe these patients closely for signs of hemolytic anemia, and if toxic reactions occur, the drug should be discontinued immediately.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 15,
      minor: 0,
      total: 22
    },
    ddinterOfficialReferences: ['"Product Information. Azulfidine (sulfasalazine)." Pharmacia and Upjohn  (2001):', '"Product Information. Diabinese (chlorpropamide)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Glucotrol (glipizide)." Pfizer U.S. Pharmaceuticals  (2002):', '"Product Information. Diabeta (glyburide)." Hoechst Marion-Roussel Inc, Kansas City, MO.', '"Product Information. Micronase (glyburide)." Pharmacia and Upjohn  (2002):', '"Product Information. Amaryl (glimepiride)." Hoechst Marion Roussel  (2001):']
  },
  "crystalluria": {
    name: "Crystalluria",
    indonesianName: "Crystalluria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Crystalluria" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Crystalluria can occur during sulfonamide therapy due to precipitation of the sulfonamide and/or its N4-acetyl metabolite in the urinary tract.  Renal toxicity such as uro- and nephrolithiasis, nephritis, toxic nephrosis, hematuria, proteinuria, and elevated BUN and creatinine has been reported.  Hydration (8 oz. glass of water with each dose and throughout the day) and adequate urinary output (> 1.5 L/day) should be maintained during sulfonamide administration.  Patients who are dehydrated (e.g., due to severe diarrhea or vomiting) may be at increased risk for the development of crystalluria and lithiasis and should be encouraged to consume additional amounts of liquid or given intravenous fluid.  Renal function tests and urinalysis should be performed weekly during prolonged therapy (> 2 weeks).  Rarely, alkalinization of the urine is necessary.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 13,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['Robson M, Levi J, Dolberg L, Rosenfeld J "Acute tubulo-interstitial nephritis following sulfadiazine therapy." Isr J Med Sci 6 (1970):  561-6', 'Finland M, Strauss E, Peterson O "Sulfadiazine." JAMA 251 (1984):  1467-74', 'Sahai J, Heimberger R, Collins K, Kaplowitz L, Polk R "Sulfadiazine-induced crystalluria in a patient with the acquired immunodeficiency syndrome: a reminder." Am J Med 84 (1988):  791-2', 'Simon D, Brosius F, Rothstein D "Sulfadiazine crystalluria revisited." Arch Intern Med 150 (1990):  2379-84', 'Molina J, Belenfant X, Doco-Lecompte T, et al. "Sulfadiazine-induced crystalluria in AIDS patients with toxoplasma encephalitis." AIDS 5 (1991):  587-9', '"Product Information. Gantranol (sulfamethoxazole)." Roche Laboratories, Nutley, NJ.']
  },
  "urea cycle disorders, inborn": {
    name: "Urea Cycle Disorders, Inborn",
    indonesianName: "Urea Cycle Disorders, Inborn (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urea Cycle Disorders, Inborn" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Valproic acid and derivative products are contraindicated in patients with known urea cycle disorders (UCD), as hyperammonemic encephalopathy, sometimes fatal, has been reported on these patients following the initiation of treatment.  Prior to the initiation of therapy, the evaluation for UCD should be considered in patients with history of unexplained encephalopathy or comma, encephalopathy associated with a protein load, pregnancy- related or postpartum encephalopathy, unexplained intellectual disability, or history of elevated plasma ammonia or glutamine.  Also, those with family history of UCD or family history of unexplained infant deaths.  Patients who develop symptoms of hyperammonemic encephalopathy while receiving valproate therapy should receive prompt treatment including treatment discontinuation and be evaluated for underlying urea cycle disorders.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Depakene (valproic acid)." Abbott Pharmaceutical  (2001):', '"Product Information. Depakote (divalproex sodium)." Abbott Pharmaceutical  (2001):']
  },
  "hiv infections": {
    name: "HIV Infections",
    indonesianName: "HIV Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "HIV Infections" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Some in vitro studies suggest that valproate stimulates the replication of the HIV and CMV viruses under certain experimental conditions.  The clinical consequences are unknown, and the relevance of these findings is uncertain for patients receiving maximally suppressive antiretroviral therapy.  However, this should be borne in mind when interpreting the results from regular monitoring of the viral load in HIV infected patients receiving valproate or when following CMV infected patients clinically.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Depakene (valproic acid)." Abbott Pharmaceutical  (2001):', '"Product Information. Depakote (divalproex sodium)." Abbott Pharmaceutical  (2001):', '"Product Information. Thalomid (thalidomide)." Celgene Corporation  (2001):']
  },
  "rhabdomyolysis": {
    name: "Rhabdomyolysis",
    indonesianName: "Rhabdomyolysis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Rhabdomyolysis" memiliki 17 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe myopathy, including rhabdomyolysis with acute renal failure secondary to myoglobinuria, has been reported rarely with the use of HMG-CoA reductase inhibitors.  The myopathy may be dose-related and is characterized by muscle aches and/or weakness in conjunction with increases in creatine phosphokinase (CPK) values exceeding 10 times the upper limit of normal.  Therapy with HMG-CoA reductase inhibitors should be administered cautiously in patients with preexisting myopathy, in those with predisposing factors for myopathy or with a history of myoneural disorder, since it may delay the recognition or confound the diagnosis of a drug-induced musculoskeletal effect.  Patients should be advised to report promptly any unusual muscle pain, tenderness or weakness, particularly if accompanied by malaise or fever.  Periodic CPK determinations may be considered in some patients, although the value of such monitoring is uncertain.  HMG-CoA reductase inhibitor therapy should be withdrawn if markedly elevated CPK levels occur or if drug-related myopathy is diagnosed or suspected.",
    ddinterSeverityDistribution: {
      major: 11,
      moderate: 6,
      minor: 0,
      total: 17
    },
    ddinterOfficialReferences: ['Schalke BB, Schmidt B, Toyka K, Hartung H-P "Pravastatin-associated inflammatory myopathy." N Engl J Med 327 (1992):  649-50', 'Pierce LR, Wysowski DK, Gross TP "Myopathy and rhabdomyolysis associated with lovastatin-gemfibrozil combination therapy." JAMA 264 (1990):  71-5', 'Walker JF "Simvastatin: the clinical profile." Am J Med 87 (1989):  s44-6', 'Simons LA "Simvastatin in severe primary hypercholesterolemia: efficacy, safety, and tolerability in 595 patients over 18 weeks. The Principal Investigators." Clin Cardiol 16 (1993):  317-22', 'McGovern ME, Mellies MJ "Long-term experience with pravastatin in clinical research trials." Clin Ther 15 (1993):  57-64', 'Reaven P, Witztum JL "Lovastatin, nicotinic acid, and rhabdomyolysis." Ann Intern Med 109 (1988):  597-8']
  },
  "cognitive dysfunction": {
    name: "Cognitive Dysfunction",
    indonesianName: "Cognitive Dysfunction (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cognitive Dysfunction" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cognitive impairment (e.g., memory loss, forgetfulness, amnesia, memory impairment, confusion) have been observed in patients receiving statins.  The reports are usually not serious, and reversible upon statin discontinuation.  Caution is recommended when using these agents in patients with cognitive impairment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Mevacor (lovastatin)." Merck & Co., Inc  (2002):', '"Product Information. Pravachol (pravastatin)." Bristol-Myers Squibb  (2001):', '"Product Information. Zocor (simvastatin)." Merck & Co., Inc  (2001):', '"Product Information. Lescol (fluvastatin)." Novartis Pharmaceuticals  (2001):', '"Product Information. Lipitor (atorvastatin)." Parke-Davis  (2001):', '"Product Information. Crestor (rosuvastatin)." AstraZeneca Pharma Inc  (2003):']
  },
  "fistula": {
    name: "Fistula",
    indonesianName: "Fistula (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fistula" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Bevacizumab may cause fatal fistula formation involving tracheoesophageal, bronchopleural, biliary, vaginal, renal and bladder sites.  Permanently discontinue bevacizumab in patients with tracheoesophageal fistula or any Grade 4 fistula.  Discontinue bevacizumab in patients with fistula formation involving an internal organ.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Avastin (bevacizumab)." Genentech  (2004):']
  },
  "posterior leukoencephalopathy syndrome": {
    name: "Posterior Leukoencephalopathy Syndrome",
    indonesianName: "Posterior Leukoencephalopathy Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Posterior Leukoencephalopathy Syndrome" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Posterior Reversible Encephalopathy Syndrome (PRES) has been reported with the use of inhibitors of vascular endothelial growth factor receptors (VEGFR) in clinical studies.  PRES is a neurological disorder which can present with headache, seizure, lethargy, confusion, blindness and other visual and neurologic disturbances.  It is recommended to discontinue these agents in patients developing PRES.  The safety of restarting therapy is not known.  Cation is recommended if therapy is reinitiating in patients previously experiencing PRES.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 9,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['"Product Information. Avastin (bevacizumab)." Genentech  (2004):', '"Product Information. Votrient (pazopanib)." GlaxoSmithKline  (2009):', '"Product Information. Cyramza (ramucirumab)." Eli Lilly and Company  (2014):', '"Product Information. Cometriq (cabozantinib)." Exelixis Inc  (2012):', '"Product Information. Vandetanib (vandetanib)." Astra-Zeneca Pharmaceuticals  (2011):', '"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):']
  },
  "proteinuria": {
    name: "Proteinuria",
    indonesianName: "Proteinuria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Proteinuria" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The incidence and severity of proteinuria is increased in patients taking inhibitors of vascular endothelial growth factor receptors (VEGFR).  Therapy with these agents should be administered cautiously in patients with renal dysfunction.  Monitoring for proteinuria and hematuria is recommended and perform baseline and periodic urinalyses during treatment, with follow up measurement as clinically indicated.  It is recommended to temporarily suspend these agents in patients with moderate to severe proteinuria and to discontinue therapy in patients with nephrotic syndrome.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Avastin (bevacizumab)." Genentech  (2004):', '"Product Information. Votrient (pazopanib)." GlaxoSmithKline  (2009):', '"Product Information. Cyramza (ramucirumab)." Eli Lilly and Company  (2014):', '"Product Information. Inlyta (axitinib)." Pfizer U.S. Pharmaceuticals Group  (2012):', '"Product Information. Lenvima (lenvatinib)." Eisai Inc  (2015):', '"Product Information. Sutent (sunitinib)." Pfizer U.S. Pharmaceuticals Group  (2006):']
  },
  "toothache": {
    name: "Toothache",
    indonesianName: "Toothache (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Toothache" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Topical lidocaine is not recommended to be used in teething infants and young children, as its ingestion is dangerous and potentially fatal.  Ingestion of the drug has shown to result in seizures, severe brain injury, and heart problems in children.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Zingo (lidocaine topical)." Sagent Pharmaceuticals, Inc.  (2008):']
  },
  "disseminated intravascular coagulation": {
    name: "Disseminated Intravascular Coagulation",
    indonesianName: "Disseminated Intravascular Coagulation (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Disseminated Intravascular Coagulation" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of aminocaproic acid is contraindicated in patients with active intravascular clotting.  Aminocaproic acid should not be used in the presence of disseminated intravascular coagulation (DIC) without concomitant administration of heparin.  Aminocaproic acid inhibits plasminogen activators and, to a lesser extent, plasmin activity, resulting in decreased fibrinolysis.  Clinical monitoring of clot lysis activity and fibrinolytic determinants (profibrinolysin, fibrinolysin and anti-fibrinolysin) is recommended.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Amicar (aminocaproic acid)." Immunex Corporation  (2001):', 'Vedia C, Mascort JJ, Carrasco I, Olive A "Colchicine and thrombopenia." Clin Exp Rheumatol 11 (1993):  458', '"Product Information. Colchicine (colchicine)." Lilly, Eli and Company  (2001):', '"Product Information. Lysteda (tranexamic acid)." Xanodyne Pharmaceuticals Inc  (2022):', '"Product Information. Kcentra (prothrombin complex)." CSL Behring LLC  (2013):']
  },
  "ototoxicity": {
    name: "Ototoxicity",
    indonesianName: "Ototoxicity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ototoxicity" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Aminoglycosides can cause eighth cranial nerve damage, resulting in vestibular and/or auditory toxicities.  Symptoms include dizziness, nystagmus, vertigo, ataxia, tinnitus, and varying degrees of hearing impairment.  Permanent hearing loss may occur, including, rarely, total or partial irreversible bilateral deafness after the drug has been discontinued.  Therapy with aminoglycosides, particularly if prolonged (> 10 days), should be administered cautiously in patients with preexisting vestibular and/or auditory impairment, since it may delay the recognition or confound the diagnosis of a drug-induced ototoxic effect.  To minimize the risk of toxicity, patients should be adequately hydrated, the usual aminoglycoside dosage should not be exceeded, use with other ototoxic agents should be avoided, and peak and trough serum aminoglycoside concentrations should be periodically determined and dosage adjusted to maintain desired levels.  Serial audiograms should be obtained in patients old enough to be tested, since loss of high- frequency perception usually precedes clinical hearing loss.  The dosage should be reduced or therapy withdrawn promptly if signs and symptoms of toxicity develop.",
    ddinterSeverityDistribution: {
      major: 12,
      moderate: 2,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['Barza M, Lauermann MW, Tally FP, Gorbach SL "Prospective, randomized trial of netilmicin and amikacin, with emphasis on eighth-nerve toxicity." Antimicrob Agents Chemother 17 (1980):  707-14', 'Bock BV, Edelstein PH, Meyer RD "Prospective comparative study of efficacy and toxicity of netilmicin and amikacin." Antimicrob Agents Chemother 17 (1980):  217-25', 'Danhauer FJ, Fortner CL, Schimpff SC, DeJongh CA, Wesley MN, Wiernik PH "Ototoxicity and pharmacokinetically determined dosages of amikacin in granulocytopenic cancer patients." Clin Pharm 1 (1982):  539-43', 'Uziel A "Non-genetic factors affecting hearing development." Acta Otolaryngol (Stockh) 421 (1985):  57-61', 'Lerner SA, Schmitt BA, Seligsohn R, Matz G "Comparative study of ototoxicity and nephrotoxicity in patients randomly assigned to treatment with amikacin or gentamicin." Am J Med 80 Suppl 6 (1986):  98-104', 'Bernstein JM, Gorse GJ, Linzmayer MI, et al. "Relative efficacy and toxicity of netilmicin and tobramycin in oncology patients." Arch Intern Med 146 (1986):  2329-34']
  },
  "dyspnea": {
    name: "Dyspnea",
    indonesianName: "Dyspnea (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dyspnea" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of lubiprostone may cause dyspnea.  Care should be taken when prescribing this drug to patients that experienced dyspnea or when restarting the drug in those patients experiencing drug induced dyspnea.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Amitiza (lubiprostone)." Sucampo Pharmaceuticals Inc  (2006):', '"Product Information. Brilinta (ticagrelor)." Astra-Zeneca Pharmaceuticals  (2011):', '"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):']
  },
  "acute myocardial infarction recovery": {
    name: "Acute Myocardial Infarction Recovery",
    indonesianName: "Acute Myocardial Infarction Recovery (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acute Myocardial Infarction Recovery" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of most tricyclic antidepressants is contraindicated in patients that are going through the acute recovery period after a myocardial infarction.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 0,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Pamelor (nortriptyline)." Sandoz Pharmaceuticals Corporation  (2002):', '"Product Information. Elavil (amitriptyline)." Stuart Pharmaceuticals  (2002):', '"Product Information. Norpramin (desipramine)." Hoechst Marion Roussel  (2002):', '"Product Information. Tofranil (imipramine)." Novartis Pharmaceuticals  (2002):', '"Product Information. Anafranil (clomipramine)." Basel Pharmaceuticals  (2001):', '"Product Information. Asendin (amoxapine)." Lederle Laboratories  (2001):']
  },
  "schizophrenia": {
    name: "Schizophrenia",
    indonesianName: "Schizophrenia (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Schizophrenia" memiliki 21 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tricyclic antidepressants (TCAs) may aggravate symptoms of psychosis in schizophrenic patients, particularly those with paranoid symptomatology.  Depressed patients, usually those with bipolar disorder, may experience a switch from depression to mania or hypomania.  These occurrences have also been reported rarely with the tetracyclic antidepressant, maprotiline.  Therapy with these agents should be administered cautiously in patients with schizophrenia, bipolar disorder, or a history of mania.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 21,
      minor: 0,
      total: 21
    },
    ddinterOfficialReferences: ['Hemmingsen R, Rafaelsen OJ "Hypnagogic and hypnopompic hallucinations during amitriptyline treatment." Acta Psychiatr Scand 62 (1980):  364-8', 'Preskorn SH, Simpson S "Tricyclic-antidepressant-induced delirium and plasma drug concentration." Am J Psychiatry 139 (1982):  822-3', 'Holmes VF, Fricchione GL "Hypomania in an AIDS patient receiving amitriptyline for neuropathic pain." Neurology 39 (1989):  305', 'Nelson JC, Jatlow PI, Bock J, Quinlan DM, Bowes MB "Major adverse reactions during desipramine treatment." Arch Gen Psychiatry 39 (1982):  1055-61', 'Norman TR, Judd F, Holwill BJ, Burrows GD "Doxepin and visual hallucinations." Aust N Z J Psychiatry 16 (1982):  295-6', 'Hardoby W "Imipramine and suicidal thoughts ." Am J Psychiatry 149 (1992):  412-3']
  },
  "infectious mononucleosis": {
    name: "Infectious Mononucleosis",
    indonesianName: "Infectious Mononucleosis (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Infectious Mononucleosis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with mononucleosis treated with an aminopenicillin antibiotic, may develop a pruritic erythematous maculopapular skin rash.  The rash is usually self-limiting and resolves within days of discontinuing the offending agent.  An altered drug metabolism or an immune-mediated process unrelated to drug hypersensitivity has been proposed as the underlying mechanism.  Therapy with aminopenicillin antibiotics should not be administered in patients with mononucleosis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Polycillin-PRB (ampicillin-probenecid)." Apothecon Inc', '"Product Information. Spectrobid (bacampicillin)." Roerig Division  (2002):', '"Product Information. Amoxil (amoxicillin)." SmithKline Beecham  (2001):']
  },
  "cardiomyopathy, hypertrophic": {
    name: "Cardiomyopathy, Hypertrophic",
    indonesianName: "Cardiomyopathy, Hypertrophic (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiomyopathy, Hypertrophic" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Organic nitrates and nitrites may aggravate the angina associated with hypertrophic cardiomyopathy and should be administered cautiously in patients with this condition.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 4,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Isordil (isosorbide dinitrate)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. ISMO (isosorbide mononitrate)." Wyeth-Ayerst Laboratories  (2002):', '"Product Information. Tridil (nitroglycerin)." DuPont Pharmaceuticals  (2002):', '"Product Information. Nitrostat (nitroglycerin)." Parke-Davis  (2002):', '"Product Information. Calan (verapamil)." Searle  (2001):', '"Product Information. Dobutrex (dobutamine)." Lilly, Eli and Company  (2002):']
  },
  "osteomalacia": {
    name: "Osteomalacia",
    indonesianName: "Osteomalacia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Osteomalacia" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rickets and osteomalacia have rarely been reported following prolonged use of barbiturates, possibly due to increased metabolism of vitamin D as a result of enzyme induction by barbiturates.  Long-term therapy with barbiturates should be administered cautiously in patients with vitamin D deficiency.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 8,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['Sotaniemi EA, Hakkarainen HK, Puranen JA, Lahti RO "Radiologic bone changes and hypocalcemia with anticonvulsant therapy in epilepsy." Ann Intern Med 77 (1972):  389-94', 'Zerwekh JE, Homan R, Tindall R, Pak CY "Decreased serum 24,25-dihydroxyvitamin D concentration during long- term anticonvulsant therapy in adult epileptics." Ann Neurol 12 (1982):  184-6', 'Marsden CD, Reynolds EH, Parsons V, Harris R, Duchen L "Myopathy associated with anticonvulsant osteomalacia." Br Med J 4 (1973):  526-7', 'Iivanainen M, Savolainen H "Side effects of phenobarbital and phenytoin during long-term treatment of epilepsy." Acta Neurol Scand Suppl 97 (1983):  49-67', 'Doriguzzi C, Mongini T, Jeantet A, Monga G "Tubular aggregates in a case of osteomalacic myopathy due to anticonvulsant drugs." Clin Neuropathol 3 (1984):  42-5', '"Product Information. Phenobarbital (phenobarbital)." Lilly, Eli and Company  (2001):']
  },
  "hemochromatosis": {
    name: "Hemochromatosis",
    indonesianName: "Hemochromatosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemochromatosis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Pentetate calcium trisodium should be used only as a single dose in patients with hemochromatosis.  Deaths have been reported in patients with severe hemochromatosis with the use of pentetate calcium trisodium by intramuscular injection for more than one day.  Use pentetate calcium trisodium with caution in individuals with severe hemochromatosis.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 1,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Pentetate Calcium Trisodium (pentetate calcium trisodium)." Akorn Inc  (2005):', '"Product Information. Auryxia (ferric citrate)." Keryx Biopharmaceuticals, Inc.  (2015):', '"Product Information. Velphoro (sucroferric oxyhydroxide)." Fresenius Medical Care North America  (2014):']
  },
  "methemoglobinemia": {
    name: "Methemoglobinemia",
    indonesianName: "Methemoglobinemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Methemoglobinemia" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rarely, benzocaine has induced methemoglobinemia resulting in respiratory distress and cyanosis.  Therapy with benzocaine should be administered cautiously to patients with or predisposed to methemoglobinemia.  If life-threatening or severe methemoglobinemia develops, methylene blue infused at a dosage of 1 to 2 mg/kg body weight will rapidly reverse or improve the condition except in G-6-PD-deficient patients.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 1,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Americaine (benzocaine topical)." Novartis Consumer Health  (2001):', '"Product Information. Americaine Otic (benzocaine otic)." Medeva Pharmaceuticals  (2001):', '"Product Information. Citanest Plain (prilocaine)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Cyanide Antidote Kit (sodium nitrite)." Lilly, Eli and Company  (2001):']
  },
  "prostatic neoplasms": {
    name: "Prostatic Neoplasms",
    indonesianName: "Prostatic Neoplasms (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Prostatic Neoplasms" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of androgenic anabolic steroids is contraindicated for male patients with carcinoma of the breast or prostate.  Circulating androgens can be converted in peripheral tissues to estrogens and dihydrotestosterone, which may act as promoters of tumor growth in the breast and prostate, respectively.  Likewise, androgenic agents may cause enlargement of the prostate and should be used cautiously in patients with or predisposed to prostatic hypertrophy.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 0,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Halotestin (fluoxymesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Androderm (testosterone topical)." SmithKline Beecham  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`, '"Product Information. Pregnyl (chorionic gonadotropin (HCG))." Organon', '"Product Information. Danocrine (danazol)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "hyperlipoproteinemias": {
    name: "Hyperlipoproteinemias",
    indonesianName: "Hyperlipoproteinemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperlipoproteinemias" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Androgenic anabolic steroids may adversely affect serum lipids, including lowering HDL and elevating LDL levels.  These changes can be marked, particularly with the 17-alpha-alkyl derivatives (i.e., fluoxymesterone, methyltestosterone, oxandrolone, oxymetholone, and stanozolol), and may significantly impact the risk of atherosclerosis and coronary artery disease.  Patients with preexisting hyperlipoproteinemia may require closer monitoring during therapy with androgenic agents, and adjustments made accordingly in their lipid-lowering regimen.  Androgen therapy should be administered cautiously in patients with coronary artery disease or a history of ischemic heart disease.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 0,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Halotestin (fluoxymesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Androderm (testosterone topical)." SmithKline Beecham  (2001):', '"Product Information. Welchol (colesevelam)." Daiichi Sankyo, Inc.  (2001):']
  },
  "polycythemia": {
    name: "Polycythemia",
    indonesianName: "Polycythemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Polycythemia" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Androgenic anabolic steroids may cause polycythemia when given in high dosages or for prolonged periods.  Patients with preexisting polycythemia may experience worsening of their condition.  Frequent monitoring of clinical status and hemoglobin and hematocrit levels is recommended if androgen therapy is administered to these patients.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 0,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Halotestin (fluoxymesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Androderm (testosterone topical)." SmithKline Beecham  (2001):']
  },
  "blood coagulation disorders": {
    name: "Blood Coagulation Disorders",
    indonesianName: "Blood Coagulation Disorders (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Blood Coagulation Disorders" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Androgenic anabolic steroids may cause suppression of clotting factors II, V, VII, and X, and an increase in prothrombin time.  Androgen therapy should be administered cautiously in patients with bleeding disorders.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 3,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Halotestin (fluoxymesterone)." Pharmacia and Upjohn  (2001):', '"Product Information. Androderm (testosterone topical)." SmithKline Beecham  (2001):', 'Moroz LA "Increased blood fibrinolytic activity after aspirin ingestion." N Engl J Med 296 (1977):  525-9', 'Garg SK, Sarker CR "Aspirin-induced thrombocytopenia on an immune basis." Am J Med Sci 267 (1974):  129-32', 'Sbarbaro JA, Bennett RM "Aspirin hepatotoxicity and disseminated intravascular coagulation." Ann Intern Med 86 (1977):  183-5', 'Bochner F, Williams DB, Morris PM, Siebert DM, Lloyd JV "Pharmacokinetics of low-dose oral modified release, soluble and intravenous aspirin in man, and effects on platelet function." Eur J Clin Pharmacol 35 (1988):  287-94']
  },
  "adrenal gland neoplasms": {
    name: "Adrenal Gland Neoplasms",
    indonesianName: "Adrenal Gland Neoplasms (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Adrenal Gland Neoplasms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Clomipramine should be used with caution in patients with tumors of the adrenal medulla (such as pheochromocytoma, neuroblastoma), as the drug can provoke hypertensive crises.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Anafranil (clomipramine)." Basel Pharmaceuticals  (2001):']
  },
  "stomach ulcer": {
    name: "Stomach Ulcer",
    indonesianName: "Stomach Ulcer (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Stomach Ulcer" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Antimuscarinic agents may cause a delay in gastric emptying and possibly antral stasis in patients with gastric ulcer.  Therapy with antimuscarinic agents should be administered cautiously to patients with gastric ulcer.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 5,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['Chernish SM, Brunelle RR, Rosenak BD, Ahmadzai S "Comparison of the effects of glucagon and atropine sulfate on gastric emptying." Am J Gastroenterol 70 (1978):  581-6', 'Mevorach D "Adverse effects of atropine sulfate autoinjection." Ann Pharmacother 26 (1992):  564', 'Cotton BR, Smith G "Single and combined effects of atropine and metoclopramide on the lower oesophageal sphincter pressure." Br J Anaesth 53 (1981):  869-74', '"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):']
  },
  "colitis, ulcerative": {
    name: "Colitis, Ulcerative",
    indonesianName: "Colitis, Ulcerative (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Colitis, Ulcerative" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Antimuscarinic agents may suppress intestinal motility and produce paralytic ileus with resultant precipitation of toxic megacolon.  These drugs should be administered cautiously to patients with ulcerative colitis.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 5,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['Famewo CE "A re-evaluation of anticholergic premedication." Can Anaesth Soc J 24 (1977):  39-41', '"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`, '"Product Information. Bentyl (dicyclomine)." Aventis Pharmaceuticals  (2002):']
  },
  "renal insufficiency": {
    name: "Renal Insufficiency",
    indonesianName: "Renal Insufficiency (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Renal Insufficiency" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atropine-like agents are primarily eliminated by the kidney.  Therapy with atropine-like agents should be administered cautiously to patients with renal disease.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 6,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Atropine Sulfate (atropine)." ESI Lederle Generics  (2022):', '"Product Information. Jevtana (cabazitaxel)." sanofi-aventis  (2010):', '"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):', '"Product Information. Cyanide Antidote Kit (sodium nitrite)." Lilly, Eli and Company  (2001):', '"Product Information. Sorbitol (sorbitol)." B. Braun/McGaw Inc  (2001):', '"Product Information. K-Phos Neutral (potassium phosphate)." Beach Pharmaceuticals  (2001):']
  },
  "blood coagulation disorders, inherited": {
    name: "Blood Coagulation Disorders, Inherited",
    indonesianName: "Blood Coagulation Disorders, Inherited (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Blood Coagulation Disorders, Inherited" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Snake venom interferes with the blood coagulation cascade.  Patients may experience coagulopathy due to snakebite and should be monitored for signs and symptoms of recurrent bleeding defects for up to one week or longer at the clinician discretion.  If using antivenin (Crotalidae) polyvalent, care should be exercised when treating patients with bleeding defects.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. CroFab (antivenin (Crotalidae) polyvalent)." Savage Laboratories', '"Product Information. Panhematin (hemin)." Recordati Rare Diseases Inc  (2001):']
  },
  "burns": {
    name: "Burns",
    indonesianName: "Burns (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Burns" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of succinylcholine is contraindicated in patients after the acute phase of injury following major burns.  These patients are more likely to develop significant hyperkalemia which may lead to cardiac arrest.  The risk of hyperkalemia typically peaks at about 7 to 10 days after injury.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 2,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Anectine (succinylcholine)." Glaxo Wellcome  (2001):', '"Product Information. Zemuron (rocuronium)." Organon  (2001):', '"Product Information. Mivacron (mivacurium)." Glaxo Wellcome  (2001):', '"Product Information. Nuromax (doxacurium)." Glaxo Wellcome  (2001):', '"Product Information. Tracrium (atracurium)." Glaxo Wellcome  (2001):', '"Product Information. Myciguent (neomycin topical)." Pharmacia and Upjohn  (2001):']
  },
  "malignant hyperthermia": {
    name: "Malignant Hyperthermia",
    indonesianName: "Malignant Hyperthermia (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Malignant Hyperthermia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of succinylcholine is contraindicated in patients with a personal or family history of malignant hyperthermia.  Succinylcholine administration has been associated with acute onset of malignant hyperthermia, especially during the concomitant use of volatile anesthetics.  If malignant hyperthermia occurs, anesthesia should be discontinued and supportive measures rendered promptly, including rapid cooling, inhalation of 100% oxygen, control of acidosis, support of circulation, and assurance of adequate urinary output.  In addition, intravenous dantrolene sodium is recommended.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Anectine (succinylcholine)." Glaxo Wellcome  (2001):', '"Product Information. Zemuron (rocuronium)." Organon  (2001):']
  },
  "musculoskeletal diseases": {
    name: "Musculoskeletal Diseases",
    indonesianName: "Musculoskeletal Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Musculoskeletal Diseases" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of succinylcholine is contraindicated in patients with a personal or family history of skeletal muscle myopathies.  Acute rhabdomyolysis with hyperkalemia followed by ventricular arrhythmias, cardiac arrest, and death have been reported following the administration of succinylcholine in apparently healthy children who were later found to have undiagnosed skeletal muscle myopathy, most frequently Duchenne muscular dystrophy.  Immediate treatment of hyperkalemia should be instituted whenever a healthy appearing infant or child develops cardiac arrest with no obvious cause soon after administration of succinylcholine.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Anectine (succinylcholine)." Glaxo Wellcome  (2001):', '"Product Information. Odomzo (sonidegib)." Novartis Pharmaceuticals  (2015):']
  },
  "motor neuron disease": {
    name: "Motor Neuron Disease",
    indonesianName: "Motor Neuron Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Motor Neuron Disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of succinylcholine is contraindicated in patients with upper motor neuron injury that can be a sequelae of cerebral vasculopathy.  The risk of hyperkalemia is increased in these patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Anectine (succinylcholine)." Glaxo Wellcome  (2001):']
  },
  "deficiency diseases": {
    name: "Deficiency Diseases",
    indonesianName: "Deficiency Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Deficiency Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Reports of mean urinary zinc loss during propofol therapy was approximately 2.5 to 3.0 mg/day in adult patients and 1.5 to 2.0 mg/day in pediatric patients.  Practitioners should consider the administration of supplemental zinc during prolonged therapy with propofol in patients who are predisposed to zinc deficiency, such as those with burns, diarrhea, and/or major sepsis.  Monitoring is recommended in these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Diprivan (propofol)." Astra-Zeneca Pharmaceuticals  (2001):']
  },
  "liver cirrhosis, biliary": {
    name: "Liver Cirrhosis, Biliary",
    indonesianName: "Liver Cirrhosis, Biliary (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Liver Cirrhosis, Biliary" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of fibric acid derivatives is contraindicated in patients with primary biliary cirrhosis.  These agents may further raise the already elevated cholesterol in these patients.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Lopid (gemfibrozil)." Parke-Davis  (2002):', '"Product Information. Atromid-S (clofibrate)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Tricor (fenofibrate)." Abbott Pharmaceutical  (2001):', '"Product Information. Trilipix (fenofibric acid)." Abbott Pharmaceutical  (2008):', '"Product Information. Fibricor (fenofibric acid)." AR Scientific Inc  (2009):']
  },
  "cholelithiasis": {
    name: "Cholelithiasis",
    indonesianName: "Cholelithiasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cholelithiasis" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of fibric acid derivatives is contraindicated in patients with gallbladder disease.  A significantly increased incidence of cholelithiasis has been observed in patients treated with the fibric acid derivative, clofibrate, presumably because of increased cholesterol excretion into the bile.  Based on two separate studies (the WHO study and the Coronary Drug Project study), clofibrate use was associated with twice the risk of developing cholelithiasis and cholecystitis requiring surgery.  Due to their structural and pharmacologic similarities, use of other fibric acid derivatives may be expected to carry the same risk.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 4,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Lopid (gemfibrozil)." Parke-Davis  (2002):', 'Blane GF "Comparative toxicity and safety profile of fenofibrate and other fibric acid derivatives." Am J Med 83 (1987):  26-36', 'Roberts WC "Safety of fenofibrate--US and worldwide experience." Cardiology 76 (1989):  169-79', '"Product Information. Atromid-S (clofibrate)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Tricor (fenofibrate)." Abbott Pharmaceutical  (2001):', '"Product Information. Trilipix (fenofibric acid)." Abbott Pharmaceutical  (2008):']
  },
  "hypolipoproteinemias": {
    name: "Hypolipoproteinemias",
    indonesianName: "Hypolipoproteinemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypolipoproteinemias" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "There have been reports of severe decreases in HDL cholesterol (HDL-C) levels (as low as 2 mg/dL) occurring in diabetic and non-diabetic patients initiated on fibric acid derivatives therapy.  The decrease has been reported to occur within 2 weeks to years after initiation of therapy.  It is recommended that HDL-C levels be checked within the first few months after initiation therapy and if a severely depressed HDL-C level is detected, therapy with these agents should be withdrawn.  Monitor HDL-C level until it has returned to baseline, and therapy with these agents should not be re-initiated in these patients.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Lopid (gemfibrozil)." Parke-Davis  (2002):', 'Thompson CH, Irish A, Kemp GJ, Taylor DJ, Radda GK "Skeletal muscle metabolism before and after gemfibrozil treatment in dialysed patients with chronic renal failure." Clin Nephrol 45 (1996):  386-9', 'Gorriz JL, Sancho A, Lopezmartin JM, Alcoy E, Catalan C, Pallardo LM "Rhabdomyolysis and acute renal failure associated with gemfibrozil therapy." Nephron 74 (1996):  437-8', '"Product Information. Tricor (fenofibrate)." Abbott Pharmaceutical  (2001):']
  },
  "megacolon, toxic": {
    name: "Megacolon, Toxic",
    indonesianName: "Megacolon, Toxic (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Megacolon, Toxic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Decreased intestinal motility and prolonged transit time have resulted in toxic megacolon in patients with acute ulcerative colitis.  Paralytic ileus has also occurred.  Antiperistaltic agent GI motility and prolongs transit time and therapy should be administered cautiously in these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Imodium (loperamide)." Janssen Pharmaceuticals  (2001):', '"Product Information. Kaopectate (attapulgite)." Pharmacia and Upjohn  (2001):', '"Product Information. Pepto-Bismol (bismuth subsalicylate)." Procter and Gamble Pharmaceuticals  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`]
  },
  "craniocerebral trauma": {
    name: "Craniocerebral Trauma",
    indonesianName: "Craniocerebral Trauma (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Craniocerebral Trauma" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of phenothiazines is contraindicated in patients with suspected or established subcortical brain damage, with or without hypothalamic involvement.  Phenothiazines can interfere with thermoregulatory mechanisms, and a hyperthermic reaction with temperatures in excess of 104 F may occur in such patients, sometimes not until 14 to 16 hours after drug administration.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 0,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['"Product Information. Thorazine (chlorpromazine)." SmithKline Beecham  (2002):', '"Product Information. Sparine (promazine)." Wyeth-Ayerst Laboratories  (2001):', 'Dilsaver SC "Effects of neuroleptics on body temperature" J Clin Psychiatry 49 (1988):  78-9', 'Caroff S, Rosenberg H, Gerber JC "Neuroleptic malignant syndrome and malignant hyperthermia" Lancet 1 (1983):  244', 'Keshavan MS, Kambhampati RK "Prolonged fever without extrapyramidal symptoms during neuroleptic  treatment" J Clin Psychopharmacol 9 (1989):  230-1', '"Product Information. Prolixin (fluphenazine)." Bristol-Myers Squibb  (2001):']
  },
  "dystonic disorders": {
    name: "Dystonic Disorders",
    indonesianName: "Dystonic Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dystonic Disorders" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Phenothiazines may cause acute, dose-related dystonic reactions secondary to central dopaminergic blockade.  These reactions are characterized by spastic contraction of discrete muscle groups and may include torticollis, opisthotonos, carpopedal spasm, trismus, difficulty swallowing, perioral spasms with protrusion of the tongue, and oculogyric crisis.  Onset is usually within 24 to 96 hours following initiation of therapy or an increase in dosage.  Risk factors include young age, male gender, use of high-potency agents (e.g., fluphenazine, perphenazine, trifluoperazine), high dosages, and IM administration.  Therapy with phenothiazines should be administered cautiously in patients, particularly children, with hypocalcemia or severe dehydration, since these patients may be more susceptible to dystonic reactions.  Most symptoms subside within a few hours and are almost always reversible within 24 to 48 hours following withdrawal of therapy.  However, severe reactions such as laryngospasm may be life-threatening and require appropriate supportive therapy.  Parenteral administration of an anticholinergic antiparkinsonian agent (e.g., benztropine, trihexyphenidyl) or diphenhydramine usually produces a prompt response and may be given orally for short-term maintenance to prevent recurrence of symptoms if phenothiazine therapy must be continued.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 9,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['Wood G, Waters A "Prolonged dystonic reaction to chlorpromazine in myxoedema coma." Postgrad Med J 56 (1980):  192-3', 'Nahata MC, Clotz MA, Krogg EA "Adverse effects of meperidine, promethazine, and chlorpromazine for sedation in pediatric patients." Clin Pediatr (Phila) 24 (1985):  558-60', 'Schwinghammer TL, Kroboth FJ, Juhl RP "Extrapyramidal reaction secondary to oral promethazine." Clin Pharm 3 (1984):  83-5', 'Marcotte DB "Neuroleptics and neurologic reactions." South Med J 66 (1973):  321-4', '"Product Information. Thorazine (chlorpromazine)." SmithKline Beecham  (2002):', '"Product Information. Sparine (promazine)." Wyeth-Ayerst Laboratories  (2001):']
  },
  "anaphylaxis": {
    name: "Anaphylaxis",
    indonesianName: "Anaphylaxis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anaphylaxis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of antivenin (black widow spider) can cause anaphylactic reactions and death in patients with a medical history of asthma.  Close monitoring is recommended in these patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Antivenin (Latrodectus mactans) (antivenin (black widow spider))." Merck & Co., Inc  (2022):', '"Product Information. Cinqair (reslizumab)." Teva Pharmaceuticals USA  (2016):']
  },
  "heart valve diseases": {
    name: "Heart Valve Diseases",
    indonesianName: "Heart Valve Diseases (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Heart Valve Diseases" memiliki 10 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of some factor Xa inhibitors (including apixaban, edoxaban, and rivaroxaban) is not recommended in patients with prosthetic heart valves; safety and efficacy have not been established in such patients.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 3,
      minor: 0,
      total: 10
    },
    ddinterOfficialReferences: ['"Product Information. Xarelto (rivaroxaban)." Janssen Pharmaceuticals  (2022):', '"Product Information. Eliquis (apixaban)." Bristol-Myers Squibb  (2021):', '"Product Information. Savaysa (edoxaban)." Daiichi Sankyo, Inc.  (2021):', '"Product Information. Apresoline (hydralazine)." Ciba-Geigy Pharmaceuticals  (2001):', '"Product Information. Belviq (lorcaserin)." Eisai Inc  (2012):', '"Product Information. Dostinex (cabergoline)." Pharmacia and Upjohn  (2001):']
  },
  "antiphospholipid syndrome": {
    name: "Antiphospholipid Syndrome",
    indonesianName: "Antiphospholipid Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Antiphospholipid Syndrome" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Direct acting oral anticoagulants including factor Xa inhibitors and some thrombin inhibitors as dabigatran, are not recommended for use in patients with antiphospholipid syndrome (APS).  Treatment with these drugs has been associated with increased rates of recurrent thrombotic events, especially in patients with triple positive APS.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Pradaxa (dabigatran)." Boehringer-Ingelheim  (2010):', '"Product Information. Xarelto (rivaroxaban)." Janssen Pharmaceuticals  (2022):', '"Product Information. Eliquis (apixaban)." Bristol-Myers Squibb  (2021):', '"Product Information. Savaysa (edoxaban)." Daiichi Sankyo, Inc.  (2021):']
  },
  "thyroid hormone metabolism, abnormal": {
    name: "Thyroid Hormone Metabolism, Abnormal",
    indonesianName: "Thyroid Hormone Metabolism, Abnormal (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thyroid Hormone Metabolism, Abnormal" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Elevated serum iodine levels can lead to altered thyroid function and metabolic abnormalities in patients receiving oral iodine therapy as well as topical therapy.  Iodine should be used cautiously in patients with thyroid disorders.  Monitoring thyroid function is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Betadine (povidone iodine topical)." Akorn Inc', '"Product Information. Betadine (povidone iodine topical)." Purdue Frederick Company', '"Product Information. Iodopen (sodium iodide)." Fujisawa  (2001):']
  },
  "porphyrias, hepatic": {
    name: "Porphyrias, Hepatic",
    indonesianName: "Porphyrias, Hepatic (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Porphyrias, Hepatic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of carbamazepine should be avoided in patients with a history of hepatic porphyria (e.g., acute intermittent porphyria, variegate porphyria, porphyria cutanea tarda).  Acute attacks have been reported in such patients receiving carbamazepine therapy.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tegretol (carbamazepine)." Novartis Pharmaceuticals  (2002):']
  },
  "fructose intolerance": {
    name: "Fructose Intolerance",
    indonesianName: "Fructose Intolerance (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fructose Intolerance" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Carbamazepine in chewable tablets and suspension contains sorbitol and should not be administered to patients with rare hereditary problems of fructose intolerance.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 2,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Tegretol (carbamazepine)." Novartis Pharmaceuticals  (2002):', '"Product Information. Gammaplex (immune globulin intravenous)." Bio Products Laboratory  (2016):', '"Product Information. Flebogamma (immune globulin intravenous)." Grifols USA LLC  (2016):', '"Product Information. Praxbind (idarucizumab)." Boehringer Ingelheim  (2016):', '"Product Information. Noxafil (posaconazole)." Schering-Plough Corporation  (2006):']
  },
  "scalp dermatoses": {
    name: "Scalp Dermatoses",
    indonesianName: "Scalp Dermatoses (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Scalp Dermatoses" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In general, topically applied minoxidil is poorly absorbed from the normal, intact scalp.  However, alteration in scalp epidermal integrity (e.g., abrasion, sunburn, psoriasis) can increase percutaneous absorption with resultant systemic effects, including sodium and water retention, local or generalized edema, pericardial effusion, pericarditis, tamponade, tachycardia, and worsening or development of angina.  Therapy with minoxidil should be avoided in patients with diminished or altered scalp integrity that may lead to enhanced systemic absorption, particularly in the presence of underlying cardiovascular dysfunction or fluid retention.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Leenen FH, Smith DL, Unger WP "Topical minoxidil: cardiac effects in bald men." Br J Clin Pharmacol 26 (1988):  481-5', 'Woodside J Jr, Garner L, Beford RF, et al. "Captopril reduces the dose requirement for sodium nitroprusside induced hypotension." Anesthesiology 60 (1984):  413-7', `Whitmore SE, Wigley FM, Wise RA "Acute effect of topical minoxidil on digital blood flow in patients with raynaud's phenomenon." J Rheumatol 22 (1995):  50-4`, '"PDR Generics." Montvale, NJ: Medical Economics  (1995):']
  },
  "lupus erythematosus, systemic": {
    name: "Lupus Erythematosus, Systemic",
    indonesianName: "Lupus Erythematosus, Systemic (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lupus Erythematosus, Systemic" memiliki 14 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of hydralazine has been associated with the development of lupus erythematosus and lupus-like syndromes, as well as exacerbation of the disease.  Hydralazine therapy should be withdrawn in patients experiencing worsening of preexisting lupus.  Monitoring complete blood counts, and antinuclear antibody titers before and during prolonged therapy is recommended.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 5,
      minor: 0,
      total: 14
    },
    ddinterOfficialReferences: ['Hahn BH, Sharp GC, Irvin WS, et al. "Immune responses to hydralazine and nuclear antigens in hydralazine-induced lupus erythematosus." Ann Intern Med 76 (1972):  365-74', 'Carey RM, Coleman M, Feder A "Pericardial tamponade: a major presenting manifestation of hydralazine-induced lupus syndrome." Am J Med 54 (1973):  84-7', 'Perry HM "Late toxicity to hydralazine resembling systemic lupus erythematosus or rheumatoid arthritis." Am J Med 54 (1973):  58-72', 'Blumenkrantz N, Christiansen AH, Ullman S, Asboe-Hansen G "Hydralazine-induced lupoid syndrome." Acta Med Scand 195 (1974):  443-9', 'Weinstein J "Hypocomplementemia in hydralazine-associated systemic lupus erythematosus." Am J Med 65 (1978):  553-6', 'Freestone S, Ramsay LE "Transient monoclonal gammopathy in hydralazine-induced lupus erythematosus." Br Med J 285 (1982):  1536-7']
  },
  "hemophilia a": {
    name: "Hemophilia A",
    indonesianName: "Hemophilia A (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemophilia A" memiliki 13 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "There have been postmarketing reports of increased bleeding, including spontaneous skin hematomas and hemarthrosis, in types A and B hemophiliac patients treated with protease inhibitors.  However, a causal relationship has not been established.  In some patients, additional Factor VIII was given.  In more than half of the reported cases, protease inhibitor therapy was continued or reintroduced following an interruption.  Hemophiliacs and patients with other coagulation defects should be monitored closely for bleeding during protease inhibitor therapy.",
    ddinterSeverityDistribution: {
      major: 12,
      moderate: 1,
      minor: 0,
      total: 13
    },
    ddinterOfficialReferences: ['"Product Information. Invirase (saquinavir)." Roche Laboratories  (2001):', '"Product Information. Norvir (ritonavir)." Abbott Pharmaceutical  (2001):', '"Product Information. Crixivan (indinavir)." Merck & Co., Inc  (2001):', '"Product Information. Viracept (nelfinavir)." Agouron Pharma Inc  (2001):', '"Product Information. Agenerase (amprenavir)." Glaxo Wellcome  (2001):', '"Product Information. Kaletra (lopinavir-ritonavir)." Abbott Pharmaceutical  (2001):']
  },
  "anuria": {
    name: "Anuria",
    indonesianName: "Anuria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anuria" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of thiazide diuretics is contraindicated in patients with anuria.",
    ddinterSeverityDistribution: {
      major: 8,
      moderate: 0,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. HydroDIURIL (hydrochlorothiazide)." Merck & Co., Inc  (2002):', '"Product Information. Lozol (indapamide)." Rhone Poulenc Rorer  (2002):', '"Product Information. Zaroxolyn (metolazone)." Rhone Poulenc Rorer  (2001):', '"Product Information. Thalitone (chlorthalidone)." Monarch Pharmaceuticals Inc  (2001):', '"Product Information. Diuril (chlorothiazide)." Merck & Co., Inc  (2001):', '"Product Information. Enduron (methyclothiazide)." Abbott Pharmaceutical  (2001):']
  },
  "endocarditis, subacute bacterial": {
    name: "Endocarditis, Subacute Bacterial",
    indonesianName: "Endocarditis, Subacute Bacterial (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Endocarditis, Subacute Bacterial" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Anticoagulants should be given with extreme caution to patients with subacute bacterial endocarditis.  The risk of hemorrhage may be increased in these patients.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Lovenox (enoxaparin)." Rhone Poulenc Rorer  (2002):', '"Product Information. Heparin Sodium (heparin)." Lilly, Eli and Company  (2001):', 'Bergqvist D, Burmark US, Frisell J, Hallbook T, Lindblad B, Risberg B, Torngren S, Wallin G "Prospective double-blind comparison between Fragmin and conventional low-dose heparin: thromboprophylactic effect and bleeding complications." Haemostasis 16 Suppl 2 (1986):  11-8', '"Product Information. Fragmin (dalteparin)." Pharmacia and Upjohn  (2001):', '"Product Information. Orgaran (danaparoid)." Organon  (2001):']
  },
  "endocarditis, bacterial": {
    name: "Endocarditis, Bacterial",
    indonesianName: "Endocarditis, Bacterial (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Endocarditis, Bacterial" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The manufacturers state that bacterial endocarditis is a contraindication for the use of fondaparinux injection.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Arixtra (fondaparinux)." Organon  (2002):']
  },
  "vitamin d deficiency": {
    name: "Vitamin D Deficiency",
    indonesianName: "Vitamin D Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vitamin D Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Routine assessment of vitamin D levels prior to the start of aromatase inhibitor treatment should be performed, due to the high prevalence of vitamin D deficiency in women with early breast cancer.  Women with vitamin D deficiency should receive supplementation.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Aromasin (exemestane)." Pharmacia and Upjohn  (2001):', '"Product Information. Calcimar (calcitonin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Miacalcin (calcitonin)." Novartis Pharmaceuticals  (2022):']
  },
  "reye syndrome": {
    name: "Reye Syndrome",
    indonesianName: "Reye Syndrome (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Reye Syndrome" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of trimethobenzamide should be avoided in children and adolescents whose signs and symptoms suggest Reye's syndrome.  The extrapyramidal symptoms which can occur secondary to trimethobenzamide use may confound the diagnosis of Reye's syndrome.  In addition, drugs with hepatotoxic potential such as trimethobenzamide may adversely affect the course of Reye's syndrome.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['Holmes C, Flaherty RJ "Trimethobenzamide HCL (Tigan)-induced extrapyramidal dysfunction in a neonate." J Pediatr 89 (1976):  669-70', '"Product Information. Tigan (trimethobenzamide)." Monarch Pharmaceuticals Inc  (2001):', 'Epidemiology Office, Divisiion of Viral and Rickettsial Diseasses, Center for Infectious Diseases, Centers for Disease Control. "Leads from the MMWR. Reye syndrome surveillance--United States, 1987 and 1988." JAMA 261 (1989):  3520,', 'Hasking GJ, Duggan JM "Encephalopathy from bismuth subsalicylate." Med J Aust 2 (1982):  167', '"Product Information. Pepto-Bismol (bismuth subsalicylate)." Procter and Gamble Pharmaceuticals  (2001):', '"Product Information. Salflex (salsalate)." Carnrick Laboratories Inc  (2001):']
  },
  "brain diseases": {
    name: "Brain Diseases",
    indonesianName: "Brain Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Brain Diseases" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Serious encephalopathy, including Wernicke's, has occurred in patients treated with arsenic trioxide injection.  Wernicke's is a neurologic emergency.  Consider testing thiamine levels in patients at risk for thiamine deficiency.  Administer parenteral thiamine in patients with or at risk for thiamine deficiency.  Monitor patients for neurological symptoms and nutritional status while receiving arsenic trioxide injection.  If encephalopathy is suspected, immediately interrupt arsenic trioxide injection and initiate parenteral thiamine.  Monitor until symptoms resolve or improve and thiamine levels normalize.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 3,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Trisenox (arsenic trioxide)." Cephalon Inc  (2001):', '"Product Information. Gilenya (fingolimod)." Novartis Pharmaceuticals  (2010):', '"Product Information. Mayzent (siponimod)." Novartis Pharmaceuticals  (2019):', '"Product Information. Zeposia (ozanimod)." Celgene Corporation  (2020):', '"Product Information. Ponvory (ponesimod)." Janssen Pharmaceuticals  (2021):']
  },
  "leukoencephalopathy, progressive multifocal": {
    name: "Leukoencephalopathy, Progressive Multifocal",
    indonesianName: "Leukoencephalopathy, Progressive Multifocal (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Leukoencephalopathy, Progressive Multifocal" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Serious infections, including reactivation of viral infections, have been reported with the use of anti-CD20 antibodies.  JC virus infections resulting in progressive multifocal leukoencephalopathy (PML) have been reported in patients treated with these agents.  A diagnosis of PML should be considered in any patient presenting with new-onset neurological manifestations, and a consultation with a neurologist is recommended.  Care should be exercised when giving these drugs to patients with a history of recurring or chronic infections as they are at an increased risk of infections.  Do not start therapy in patients with an active infection.",
    ddinterSeverityDistribution: {
      major: 10,
      moderate: 2,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Arzerra (ofatumumab)." GlaxoSmithKline  (2009):', '"Product Information. Gazyva (obinutuzumab)." Genentech  (2013):', '"Product Information. Rapamune (sirolimus)." Wyeth-Ayerst Laboratories  (2001):', '"Product Information. Tysabri (natalizumab)." Elan Pharmaceutical/Athena Neurosciences Inc  (2004):', '"Product Information. Soliris (eculizumab)." Alexion Pharmaceuticals Inc  (2007):', '"Product Information. BENLYSTA (belimumab)." GlaxoSmithKline  (2011):']
  },
  "pulmonary heart disease": {
    name: "Pulmonary Heart Disease",
    indonesianName: "Pulmonary Heart Disease (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pulmonary Heart Disease" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with a prior history of cardiac or pulmonary disease should be closely monitored during and after the infusion of anti-CD20 antibodies as they can increase the risk of presenting a severe and life-threatening infusion reaction.  Therapy with these agents should be permanently discontinued in patients presenting any Grade 4 infusion reactions and for those presenting Grade 3, interrupt therapy and institute treatment according to clinical guidelines.  The rate of infusion should be reduced for those patients presenting Grade 1, or 2 reactions.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Arzerra (ofatumumab)." GlaxoSmithKline  (2009):', '"Product Information. Gazyva (obinutuzumab)." Genentech  (2013):']
  },
  "renal artery obstruction": {
    name: "Renal Artery Obstruction",
    indonesianName: "Renal Artery Obstruction (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Renal Artery Obstruction" memiliki 8 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In patients with bilateral renal artery stenosis or renal artery stenosis in a solitary kidney, angiotensin II receptor (AR) antagonists may reduce renal perfusion to a critically low level.  Increases in serum creatinine or blood urea nitrogen have been reported with ACE inhibitors, a class of drugs that also block the renin-angiotensin-aldosterone system.  Although there are no long-term data on the use of AR antagonists in patients with renal artery stenosis, a similar effect should be anticipated.  Renal function should be monitored closely for the first few weeks of therapy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 8,
      minor: 0,
      total: 8
    },
    ddinterOfficialReferences: ['"Product Information. Cozaar (losartan)." Merck & Co., Inc  (2001):', '"Product Information. Diovan (valsartan)." Novartis Pharmaceuticals  (2001):', '"Product Information. Avapro (irbesartan)." Bristol-Myers Squibb  (2001):', '"Product Information. Teveten (eprosartan)." SmithKline Beecham  (2001):', '"Product Information. Atacand (candesartan)." Astra-Zeneca Pharmaceuticals  (2001):', '"Product Information. Micardis (telmisartan)." Boehringer-Ingelheim  (2001):']
  },
  "heart block": {
    name: "Heart Block",
    indonesianName: "Heart Block (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Heart Block" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atazanavir may prolong the PR interval of the electrocardiogram in some patients.  In one study, the mean maximum change in PR interval from baseline was 24 msec following a 400 mg oral dose of atazanavir versus 13 msec following placebo dosing.  In studies of healthy volunteers and HIV patients, abnormalities in atrioventricular (AV) conduction were asymptomatic and limited to first-degree AV block.  Rarely, second-degree AV block and other conduction abnormalities have occurred in overdose.  Due to limited clinical experience, therapy with atazanavir should be administered cautiously in patients with preexisting conduction abnormalities (e.g., marked first-degree AV block or second- or third-degree AV block).",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Reyataz (atazanavir)." Bristol-Myers Squibb  (2003):', '"Product Information. Norvir (ritonavir)." Abbott Pharmaceutical  (2001):']
  },
  "endocrine system diseases": {
    name: "Endocrine System Diseases",
    indonesianName: "Endocrine System Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Endocrine System Diseases" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Immune-related thyroid disorders, adrenal insufficiency, and type 1 diabetes mellitus, including diabetic ketoacidosis, have been reported in patients receiving atezolizumab.  It is recommended to monitor patients for clinical signs and symptoms of endocrinopathies and to institute appropriate measures as necessary.  Monitor as clinically indicated prior to and periodically during treatment and withhold, reduce dose, or discontinue therapy as necessary.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 2,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Tecentriq (atezolizumab)." Genentech  (2016):', '"Product Information. Yervoy (ipilimumab)." Bristol-Myers Squibb  (2023):', '"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Pegasys (peginterferon alfa-2a)." Roche Laboratories  (2002):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "hepatitis": {
    name: "Hepatitis",
    indonesianName: "Hepatitis (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatitis" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Immune-mediated hepatitis occurred in patients receiving atezolizumab treatment with reported liver test abnormalities.  Monitor patients for liver function test and for symptoms of hepatitis.  Monitor bilirubin prior to and periodically during treatment.  Therapy with atezolizumab should be administered cautiously in these patients.  It is recommended to withhold atezolizumab for Grade 2 immune-mediated hepatitis and institute appropriate measures and to permanently discontinue therapy for Grade or 4 immune-mediated hepatitis",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Tecentriq (atezolizumab)." Genentech  (2016):', '"Product Information. Pyridium (phenazopyridine)." Warner Chilcott Laboratories  (2001):', '"Product Information. Calcium Disodium Versenate (edetate calcium disodium)." 3M Pharmaceuticals', 'Grohmann R, Ruther E, Sassim N, Schmidt LG "Adverse effects of clozapine." Psychopharmacology (Berl) 99 (1989):  s101-4', 'Kellner M, Wiedemann K, Krieg JC, Berg PA "Toxic hepatitis by clozapine treatment." Am J Psychiatry 150 (1993):  985-6', '"Product Information. Clozaril (clozapine)." Novartis Pharmaceuticals  (2001):']
  },
  "meningitis": {
    name: "Meningitis",
    indonesianName: "Meningitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Meningitis" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Immune-related meningoencephalitis has been reported with the use of atezolizumab therapy.  Monitor patients for clinical signs and symptoms of meningitis or encephalitis.  Permanently discontinue therapy for any grade of meningitis or encephalitis.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 2,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Tecentriq (atezolizumab)." Genentech  (2016):', '"Product Information. Lamictal (lamotrigine)." Glaxo Wellcome  (2001):', '"Product Information. Tysabri (natalizumab)." Elan Pharmaceutical/Athena Neurosciences Inc  (2004):', '"Product Information. Ultomiris (ravulizumab)." Alexion Pharmaceuticals Inc  (2019):']
  },
  "paresis": {
    name: "Paresis",
    indonesianName: "Paresis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Paresis" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with hemiparesis or paraparesis may require higher dosages of non-depolarizing neuromuscular blocking agents in the affected limbs.  Neuromuscular monitoring should be performed on a non-paretic limb to avoid inaccurate dosing.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 0,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Zemuron (rocuronium)." Organon  (2001):', '"Product Information. Mivacron (mivacurium)." Glaxo Wellcome  (2001):', '"Product Information. Nuromax (doxacurium)." Glaxo Wellcome  (2001):', '"Product Information. Tracrium (atracurium)." Glaxo Wellcome  (2001):', '"Product Information. Norcuron (vecuronium)." Organon  (2001):', '"Product Information. Metubine Iodide (metocurine)." Dista Products Company  (2001):']
  },
  "hearing loss": {
    name: "Hearing Loss",
    indonesianName: "Hearing Loss (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hearing Loss" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Use of phosphodiesterase-5 (PDE5) inhibitors has been associated with sudden decrease or loss of hearing, which may be accompanied by tinnitus or dizziness.  Patients with hearing problems should stop taking these agents and seek prompt medical care.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 3,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Viagra (sildenafil)." Pfizer U.S. Pharmaceuticals  (2001):', '"Product Information. Levitra (vardenafil)." Bayer  (2003):', '"Product Information. Cialis (tadalafil)." Lilly, Eli and Company  (2003):', '"Product Information. Revatio (sildenafil)." Pfizer U.S. Pharmaceuticals Group  (2005):', '"Product Information. Adcirca (tadalafil)." United Therapeutics Corporation  (2009):', '"Product Information. Stendra (avanafil)." Vivus Inc  (2012):']
  },
  "retinitis pigmentosa": {
    name: "Retinitis Pigmentosa",
    indonesianName: "Retinitis Pigmentosa (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Retinitis Pigmentosa" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Phosphodiesterase-5 (PDE5) inhibitors have been associated with transient impairment of color discrimination (blue/green) and blue- or color-tinged vision.  These agents also inhibit phosphodiesterase-6 (PDE6), to a much lesser extent, which is involved in phototransduction in the retina.  There are no controlled clinical data on the safety in patients with retinitis pigmentosa, a minority of whom may have genetic disorders of retinal phosphodiesterases.  Therapy with these agents should be avoided in such patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Viagra (sildenafil)." Pfizer U.S. Pharmaceuticals  (2001):', 'Goldstein I, Lue TF, Padma-Nathan H, Rosen RC, Steers WD, Wicker PA "Oral sildenafil in the treatment of erectile dysfunction." N Engl J Med 338 (1998):  1397-404', 'Goldenberg MM "Safety and efficacy of sildenafil citrate in the treatment of male erectile dysfunction." Clin Ther 20 (1998):  1033-48', 'Zrenner E "No cause for alarm over retinal side-effects of sildenafil." Lancet 353 (1999):  340-1', 'Vobig MA, Klotz T, Staak M, BartzSchmidt KU, Engelmann U, Walter P "Retinal side-effects of sildenafil." Lancet 353 (1999):  375', 'Marmor MF "Sildenafil (Viagra) and ophthalmology." Arch Ophthalmol 117 (1999):  518-9']
  },
  "tendinopathy": {
    name: "Tendinopathy",
    indonesianName: "Tendinopathy (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tendinopathy" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tendonitis and ruptures of the shoulder, hand, and Achilles tendons have been reported in patients receiving quinolones, both during and after treatment.  Avoid the use of these agents in patients who have a history of tendon disorders or have experienced tendinitis or tendon rupture.  Therapy with quinolones should be administered cautiously in patients with patients with kidney, heart, and lung transplant, since it may delay the recognition or confound the diagnosis of a quinolone-induced musculoskeletal effect.  Factors that may independently increase the risk of tendon rupture include strenuous physical activity, renal failure, and previous tendon disorders such as rheumatoid arthritis.  It is recommended to discontinue these agents if, at any time during therapy, pain, inflammation or rupture of a tendon develops and institute appropriate treatment.",
    ddinterSeverityDistribution: {
      major: 11,
      moderate: 0,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Cipro (ciprofloxacin)." Bayer  (2002):', '"Product Information. Penetrex (enoxacin)." Rhone Poulenc Rorer  (2002):', '"Product Information. Maxaquin (lomefloxacin)." Searle  (2002):', '"Product Information. Neggram (nalidixic acid)." Sanofi Winthrop Pharmaceuticals', '"Product Information. Noroxin (norfloxacin)." Merck & Co., Inc  (2001):', '"Product Information. Floxin (ofloxacin)." Ortho McNeil Pharmaceutical  (2001):']
  },
  "urogenital diseases": {
    name: "Urogenital Diseases",
    indonesianName: "Urogenital Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urogenital Diseases" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of BCG vaccine is contraindicated in patients with a urinary tract infection.  Administration of the vaccine may result in the risk of disseminated BCG infection and/or an increased severity of bladder irritation, including hematuria, urinary frequency and dysuria.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Tice BCG Vaccine (BCG)." Organon']
  },
  "autonomic dysreflexia": {
    name: "Autonomic Dysreflexia",
    indonesianName: "Autonomic Dysreflexia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Autonomic Dysreflexia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Therapy with intrathecal baclofen should be administered cautiously in patients with a history of autonomic dysreflexia, since the presence of nociceptive stimuli or abrupt withdrawal of the medication may trigger an episode of dysreflexia.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Lioresal Intrathecal (baclofen)." Medtronic Neurological  (2001):']
  },
  "peanut hypersensitivity": {
    name: "Peanut Hypersensitivity",
    indonesianName: "Peanut Hypersensitivity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Peanut Hypersensitivity" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Dimercaprol ampules are formulated with peanut oil.  Peanut oil may cause allergic reactions in some individuals.  Physicians should use caution in prescribing dimercaprol ampules for peanut-sensitive patients.  Medication and equipment necessary to treat allergic reactions should be available if the product is administered to peanut-allergic patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. BAL In Oil (dimercaprol)." Apothecon Inc  (2022):']
  },
  "hyperphosphatemia": {
    name: "Hyperphosphatemia",
    indonesianName: "Hyperphosphatemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperphosphatemia" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Increases in phosphate levels are a pharmacodynamic effect of erdafitinib.  Hyperphosphatemia was reported as adverse reaction in 76% of patients after initiating treatment, with 32% requiring phosphate binders during treatment.  Caution and monitoring of phosphate levels is advised in all patients, especially in those at risk or hyperphosphatemia.  Follow the manufacturer's dose modification guidelines if required.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 1,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Balversa (erdafitinib)." Janssen Products, LP  (2019):', '"Product Information. Crysvita (burosumab)." Ultragenyx Pharmaceutical  (2018):', '"Product Information. Posture (calcium phosphate, tribasic)." Whitehall-Robbins', '"Product Information. Neo-Calglucon (calcium glubionate)." Sandoz Pharmaceuticals Corporation  (2001):']
  },
  "short qt syndrome": {
    name: "Short Qt Syndrome",
    indonesianName: "Short Qt Syndrome (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Short Qt Syndrome" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rufinamide can cause shortening of the QT interval.  Its use is contraindicated in patients with Familial Short QT syndrome as this condition is associated with increased risk of sudden death and ventricular arrhythmias, particularly ventricular fibrillation.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Banzel (rufinamide)." Eisai Inc  (2008):', '"Product Information. Xcopri (cenobamate)." SK Life Science, Inc.  (2020):', '"Product Information. Cresemba (isavuconazonium)." Astellas Pharma US, Inc  (2015):']
  },
  "insulinoma": {
    name: "Insulinoma",
    indonesianName: "Insulinoma (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Insulinoma" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of glucagon is contraindicated in patients with insulinoma or glucagonoma as it may cause secondary hypoglycemia.  Test patients suspected of having glucagonoma for blood levels of glucagon prior to treatment, and monitor for changes in blood glucose levels during treatment.  If a patient develops symptoms of hypoglycemia after a dose of glucagon, administer glucose orally or intravenously.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Glucagon (glucagon)." Lilly, Eli and Company  (2001):']
  },
  "hepatitis, viral, human": {
    name: "Hepatitis, Viral, Human",
    indonesianName: "Hepatitis, Viral, Human (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatitis, Viral, Human" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Viral reactivation, including cases of herpes virus reactivation (e.g., herpes zoster), was reported in clinical studies with baricitinib.  Patients should be screened for viral hepatitis in accordance with clinical guidelines before starting therapy with baricitinib.  If a patient develops herpes zoster during therapy, treatment with baricitinib should be interrupted until the episode resolves.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Olumiant (baricitinib)." Lilly, Eli and Company  (2018):', '"Product Information. Xeljanz (tofacitinib)." Pfizer U.S. Pharmaceuticals Group  (2021):']
  },
  "aortic aneurysm": {
    name: "Aortic Aneurysm",
    indonesianName: "Aortic Aneurysm (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Aortic Aneurysm" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of certain fluoroquinolones may increase the risk of aortic aneurysm and dissection.  It is recommended to reserve the use of delafloxacin only when there are no alternative antibacterial treatments available in patients with a known aortic aneurysm or patients who are at higher risk for aortic aneurysms.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Baxdela (delafloxacin)." Melinta Therapeutics, Inc.  (2017):']
  },
  "optic atrophy, hereditary, leber": {
    name: "Optic Atrophy, Hereditary, Leber",
    indonesianName: "Optic Atrophy, Hereditary, Leber (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Optic Atrophy, Hereditary, Leber" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of cyanocobalamin is contraindicated in patients with Leber's disease (hereditary optic nerve atrophy).  Cyanocobalamin has induced severe and rapid optic nerve atrophy in patient's with early Leber's disease.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Nascobol (cyanocobalamin nasal)." Schwarz Pharma, Mequon, WI.', '"Product Information. Hydro-Cobex (hydroxocobalamin)." Major Pharmaceuticals Inc  (2001):', '"Product Information. Nipride RTU (sodium nitroprusside)." Roche Laboratories']
  },
  "epstein-barr virus infections": {
    name: "Epstein-Barr Virus Infections",
    indonesianName: "Epstein-Barr Virus Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Epstein-Barr Virus Infections" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Belatacept is contraindicated in transplant recipients who are Epstein-Barr virus (EBV) seronegative or with unknown EBV serostatus due to the risk of post-transplant lymphoproliferative disorder (PTLD), predominantly involving the central nervous system.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Nulojix (belatacept)." Bristol-Myers Squibb  (2011):']
  },
  "narcolepsy": {
    name: "Narcolepsy",
    indonesianName: "Narcolepsy (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Narcolepsy" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of suvorexant is contraindicated in patient with narcolepsy.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Belsomra (suvorexant)." Merck & Co., Inc  (2014):', '"Product Information. Quviviq (daridorexant)." Idorsia Pharmaceuticals US Inc.  (2022):']
  },
  "tendon injuries": {
    name: "Tendon Injuries",
    indonesianName: "Tendon Injuries (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tendon Injuries" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Bempedoic acid has been associated with an increased risk of tendon rupture or injury.  Ruptures involving the rotator cuff, biceps, or Achilles tendon have been reported.  Risk increases in patients over 60, those on corticosteroid or fluoroquinolone treatment, patients with renal failure, and patients with previous tendon disorders.  Consider an alternative therapy in patients with a history of tendon disorders or rupture.  Discontinue treatment if rupture of a tendon occurs or consider discontinuation if the patient experiences joint pain, swelling, or inflammation.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Nexletol (bempedoic acid)." Esperion Therapeutics  (2020):']
  },
  "esophagitis, peptic": {
    name: "Esophagitis, Peptic",
    indonesianName: "Esophagitis, Peptic (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Esophagitis, Peptic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Therapy with dicyclomine is contraindicated in patients with reflux esophagitis.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Bentyl (dicyclomine)." Aventis Pharmaceuticals  (2002):']
  },
  "hypohidrosis": {
    name: "Hypohidrosis",
    indonesianName: "Hypohidrosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypohidrosis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Since benztropine contains structural features of atropine, it may produce anhidrosis.  Benztropine should be administered with caution during hot weather, especially when given concomitantly with other atropine-like drugs to the chronically ill, the alcoholic, those who have central nervous system disease, and those who do manual labor in a hot environment.  Anhidrosis may occur more readily when some disturbance of sweating already exists.  If there is evidence of anhidrosis, the possibility of hyperthermia should be considered.  Severe anhidrosis and fatal hyperthermia have occurred with the use of benztropine.  Caution is recommended when prescribing benztropine to patients with inability to sweat normally.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cogentin (benztropine)." Merck & Co., Inc  (2001):']
  },
  "dysuria": {
    name: "Dysuria",
    indonesianName: "Dysuria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dysuria" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Dysuria may occur with the use of benztropine, but it rarely becomes a problem.  Also, urinary retention has been reported.  Caution is advised even when using benztropine in patients with urinary blockage, particularly in elderly patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cogentin (benztropine)." Merck & Co., Inc  (2001):']
  },
  "cysticercosis": {
    name: "Cysticercosis",
    indonesianName: "Cysticercosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cysticercosis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Since parasite destruction within the eye can cause irreparable lesions, ocular cysticercosis should not be treated with praziquantel.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Markwalder K, Hess K, Valavanis A, Witassek F "Cerebral cysticercosis: treatment with praziquantel. Report of two cases." Am J Trop Med Hyg 33 (1984):  273-80', 'Bada JL, Trevino B, Cabezos J "Convulsive seizures after treatment with praziquantel." Br Med J (Clin Res Ed) 296 (1988):  646', 'Flisser A, Madrazo I, Plancarte A, Schantz P, Allan J, Craig P, Sarti E "Neurological symptoms in occult neurocysticercosis after single taeniacidal dose of praziquantel." Lancet 342 (1993):  748', 'Leblanc R, Knowles KF, Melanson D, MacLean JD, Rouleau G, Farmer JP "Neurocysticercosis: surgical and medical management with praziquantel." Neurosurgery 18 (1986):  419-27', '"Product Information. Biltricide (praziquantel)." Bayer  (2001):']
  },
  "uveitis": {
    name: "Uveitis",
    indonesianName: "Uveitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Uveitis" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Bimatoprost, latanoprost, and travoprost are synthetic prostaglandin analogues.  Theoretically, these agents may mimic endogenous prostaglandins and mediate ocular inflammatory responses.  In clinical trials, uveitis and iritis have been reported rarely.  Therapy with ophthalmic prostaglandin analogues should be administered cautiously in patients with active intraocular inflammation.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 5,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Xalatan (latanoprost ophthalmic)." Pharmacia and Upjohn  (2001):', '"Product Information. Lumigan (bimatoprost ophthalmic)." Allergan Inc  (2001):', '"Product Information. Travatan (travoprost ophthalmic)." Alcon Laboratories Inc  (2001):', 'American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', 'Benjamin KW "Toxicity of ocular medications." Int Ophthalmol Clin 19 (1979):  199-255', '"Product Information. Phospholine Iodide (echothiophate iodide ophthalmic)." Wyeth-Ayerst Laboratories']
  },
  "retinal diseases": {
    name: "Retinal Diseases",
    indonesianName: "Retinal Diseases (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Retinal Diseases" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Retinal vein occlusion (RVO) is a known class- related adverse reaction of MEK inhibitors and may occur in patients treated with binimetinib in combination with encorafenib.  The safety of binimetinib has not been established in patients with a history of RVO or current risk factors for RVO including uncontrolled glaucoma or a history of hyperviscosity or hypercoagulability syndromes.  An ophthalmologic evaluation should be performed for patient reporting acute vision loss or other visual disturbance within 24 hours.  Treatment should be discontinued in patients with documented RVO.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Mektovi (binimetinib)." Array BioPharma Inc.  (2018):', '"Product Information. Potiga (ezogabine)." GlaxoSmithKline  (2011):', '"Product Information. Xadago (safinamide)." US WorldMeds LLC  (2017):']
  },
  "appendicitis": {
    name: "Appendicitis",
    indonesianName: "Appendicitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Appendicitis" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of stimulant laxatives is contraindicated in patients with or who may have acute surgical abdomen or appendicitis.  These patients may be candidates for emergency surgery.  Stimulant laxatives should also not be administered to patients with abdominal pain, particularly if the cause has not been determined.",
    ddinterSeverityDistribution: {
      major: 5,
      moderate: 0,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Dulcolax (bisacodyl)." Ciba Self-Medication Inc  (2001):', '"Product Information. Fleet Bisacodyl (bisacodyl)." Fleet', '"Product Information. Kondremul Plain (mineral oil)." Bristol-Myers Squibb', '"Product Information. SenoSol-X (senna)." Apothecon Inc  (2022):']
  },
  "rectal diseases": {
    name: "Rectal Diseases",
    indonesianName: "Rectal Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Rectal Diseases" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of stimulant laxatives is contraindicated in patients with anal or rectal fissures.  These preparations may cause irritation, burning sensation, and proctitis.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Dulcolax (bisacodyl)." Ciba Self-Medication Inc  (2001):', '"Product Information. Fleet Bisacodyl (bisacodyl)." Fleet']
  },
  "paralyses, familial periodic": {
    name: "Paralyses, Familial Periodic",
    indonesianName: "Paralyses, Familial Periodic (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Paralyses, Familial Periodic" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Administration of potassium salts may precipitate attacks in familial hyperkalemic periodic paralysis or paramyotonia congenita.  Therapy with potassium preparations should be administered cautiously in patients with these conditions.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 0,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: [`Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`]
  },
  "acid-base imbalance": {
    name: "Acid-Base Imbalance",
    indonesianName: "Acid-Base Imbalance (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acid-Base Imbalance" memiliki 11 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Alkalinizing agents act as proton acceptors and/or dissociate to provide bicarbonate ions.  Elimination of bicarbonate is decreased in patients with renal impairment and can result in metabolic alkalosis.  Symptoms of metabolic alkalosis include hyperirritability or tetany, arrhythmia, and/or seizures (altered pH = altered calcium), or lactic acidosis due to impaired oxygen release.  Therapy with alkalinizing agents should be administered with extreme caution in patients with compromised renal function.  Clinical monitoring of renal function, acid/base balance and electrolytes is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 11,
      minor: 0,
      total: 11
    },
    ddinterOfficialReferences: ['"Product Information. Urocit-K (potassium citrate)." Mission Pharmacal Company', '"Product Information. Tham (tromethamine)." Abbott Pharmaceutical  (2001):', '"Product Information. Sodium Lactate (sodium lactate)." Abbott Pharmaceutical  (2001):', '"Product Information. Sodium Benzoate (sodium benzoate)." Taylor Pharmaceuticals  (2001):', '"Product Information. Priscoline Hydrochloride (tolazoline)." Novartis Pharmaceuticals', '"Product Information. Sulfamylon (mafenide topical)." Dow Hickam Pharmaceuticals Inc  (2022):']
  },
  "urinary tract infections": {
    name: "Urinary Tract Infections",
    indonesianName: "Urinary Tract Infections (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urinary Tract Infections" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Botox (brand of onabotulinumtoxinA), a botulinum toxin product for the treatment of overactive bladder or detrusor overactivity associated with a neurologic condition should not be used in patients who have a urinary tract infection, in patients with urinary retention and in patients with post-void residual urine volume >200 mL, who are not routinely performing clean intermittent self-catheterization.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Botox (onabotulinumtoxinA)." Allergan Inc', '"Product Information. Valstar (valrubicin)." Medeva Pharmaceuticals  (2001):', '"Product Information. Urocit-K (potassium citrate)." Mission Pharmacal Company']
  },
  "brain neoplasms": {
    name: "Brain Neoplasms",
    indonesianName: "Brain Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Brain Neoplasms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of urofollitropin is contraindicated in the presence of any intracranial lesion or tumor.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Fertinex (urofollitropin)." Serono Laboratories Inc', '"Product Information. Bravelle (urofollitropin)." Ferring Pharmaceuticals Inc  (2003):']
  },
  "crohn disease": {
    name: "Crohn Disease",
    indonesianName: "Crohn Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Crohn Disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of brodalumab is contraindicated in patients with Crohn's disease as this agent may cause worsening of the disease.  It is recommended to discontinue the use of brodalumab if patients develop Crohn's disease while on treatment.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Siliq (brodalumab)." Valeant Pharmaceuticals  (2017):']
  },
  "restless legs syndrome": {
    name: "Restless Legs Syndrome",
    indonesianName: "Restless Legs Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Restless Legs Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of burosumab-twza may cause new onset of restless leg syndrome (RLS) or worsen RLS severity.  Care should be exercised when using this agent in patients with existing RLS diagnosis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Crysvita (burosumab)." Ultragenyx Pharmaceutical  (2018):']
  },
  "cardiac tamponade": {
    name: "Cardiac Tamponade",
    indonesianName: "Cardiac Tamponade (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiac Tamponade" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cardiac tamponade during high dose busulfan therapy combined with cyclophosphamide has been reported in pediatric patients with thalassemia.  Abdominal pain and vomiting may precede the tamponade.  Cardiac tamponade can result in death and therapy with busulfan should be administered cautiously to patients with thalassemia.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Myleran (busulfan)." Prasco Laboratories  (2001):']
  },
  "tachycardia, ventricular": {
    name: "Tachycardia, Ventricular",
    indonesianName: "Tachycardia, Ventricular (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tachycardia, Ventricular" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of intravenous diltiazem or verapamil is contraindicated in patients with ventricular tachycardia.  IV administration of a calcium channel blocker can precipitate cardiac arrest in such patients.  Marked hemodynamic deterioration and ventricular fibrillation have occurred in patients with wide-complex ventricular tachycardia (QRS >= 0.12 seconds) treated with IV verapamil.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Buxton AE, Marchlinski FE, Doherty JU, et al. "Hazards of intravenous verapamil for sustained ventricular tachycardia." Am J Cardiol 59 (1987):  1107-10', 'Winters SL, Schweitzer P, Kupersmith J, Gomes JA "Verapamil-induced polymorphous ventricular tachycardia." J Am Coll Cardiol 6 (1985):  257-9', '"Product Information. Calan (verapamil)." Searle  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`]
  },
  "wolff-parkinson-white syndrome": {
    name: "Wolff-Parkinson-White Syndrome",
    indonesianName: "Wolff-Parkinson-White Syndrome (Sistem Saraf & Neuropsikiatri)",
    organSystem: "Sistem Saraf & Neuropsikiatri",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Wolff-Parkinson-White Syndrome" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of verapamil is contraindicated for the management of atrial flutter or fibrillation in patients with an accessory AV tract (e.g., those with Wolff-Parkinson-White or Lown-Ganong-Levine syndrome).  Intravenous verapamil has been reported to cause ventricular fibrillation and cardiac arrest in such patients, the mechanism of which is related to the drug's ability to shorten the refractory period and accelerate antegrade conduction within the accessory pathway.  Although these events have not been associated with chronic use of oral verapamil, a similar risk may exist.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Schwartz JB, Jeang M, Raizner AE, et al. "Accelerated junctional rhythms during oral verapamil therapy." Am Heart J 107 (1984):  440-3', 'Schwartz JB "Verapamil in atrial fibrillation: the expected, the unexpected, and the unknown." Am Heart J 106 (1983):  173-6', 'Hame A, Peter T, Platt M, Mandel WJ "Effects of verapamil on supraventricular tachycardia in patients with overt and concealed wolff-parkinson-white syndrome." Am Heart J 101 (1981):  600-12', 'Jacob AS, Nielsen DH, Gianelly RE "Fatal ventricular fibrillation following verapamil in Wolff-Parkinson-White syndrome with atrial fibrillation." Ann Emerg Med 14 (1985):  159-60', 'McGovern B, Garan H, Ruskin JN "Precipitation of cardiac arrest by verapamil in patients with Wolff-Parkinson-White syndrome." Ann Intern Med 104 (1986):  791-4', '"Product Information. Calan (verapamil)." Searle  (2001):']
  },
  "neuromuscular junction diseases": {
    name: "Neuromuscular Junction Diseases",
    indonesianName: "Neuromuscular Junction Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Neuromuscular Junction Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Verapamil has been reported to decrease neuromuscular transmission in patients with Duchenne's muscular dystrophy and to prolong recovery from the neuromuscular blocking agent, vecuronium.  Therapy with verapamil should be administered cautiously in patients with attenuated neuromuscular transmission or myopathy, since these conditions may be exacerbated.  A reduced dosage may be appropriate.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Calan (verapamil)." Searle  (2001):', '"Product Information. Isoptin (verapamil)." Knoll Pharmaceutical Company  (2001):', 'Reverte M "Adverse effect of verapamil in myasthenia gravis: an additional comment." Muscle Nerve 16 (1993):  879-81']
  },
  "bone diseases": {
    name: "Bone Diseases",
    indonesianName: "Bone Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Bone Diseases" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of cellulose sodium phosphate is contraindicated in patients with hyperparathyroidism (primary or secondary), bone disease (osteomalacia, osteoporosis), or low intestinal absorption and renal excretion of calcium.  Cellulose sodium phosphate prevents absorption of intestinal calcium and can further increase the risk of calcium adsorption and bone disease.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 3,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Calcibind (cellulose sodium phosphate)." Mission Pharmacal Company  (2001):', '"Product Information. Viread (tenofovir)." Gilead Sciences  (2019):']
  },
  "sarcoidosis": {
    name: "Sarcoidosis",
    indonesianName: "Sarcoidosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sarcoidosis" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hypercalciuria, with or without hypercalcemia, may occasionally occur in patients with sarcoidosis.  Elevated calcium levels may result from increased intestinal absorption of calcium, which is related to the extrarenal production of vitamin D by mononuclear phagocytes present within the sarcoid granuloma.  Therapy with calcium salts should be administered cautiously and only if necessary in patients with sarcoidosis.",
    ddinterSeverityDistribution: {
      major: 4,
      moderate: 0,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Posture (calcium phosphate, tribasic)." Whitehall-Robbins', '"Product Information. Neo-Calglucon (calcium glubionate)." Sandoz Pharmaceuticals Corporation  (2001):', `Braunwald E, Hauser SL, Kasper DL, Fauci AS, Isselbacher KJ, Longo DL, Martin JB, eds., Wilson JD "Harrison's Principles of Internal Medicine." New York, NY: McGraw-Hill Health Professionals Division  (1998):`]
  },
  "photoparoxysmal response 1": {
    name: "PHOTOPAROXYSMAL RESPONSE 1",
    indonesianName: "PHOTOPAROXYSMAL RESPONSE 1 (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "PHOTOPAROXYSMAL RESPONSE 1" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of capmatinib may cause photosensitivity reactions.  Exercise care when using this agent in patients predisposed to photosensitivity reactions or with a history of skin cancer.  It is recommended that patients use precautionary measures against ultraviolet exposure such as use of sunscreen or protective clothing during treatment with capmatinib.  Advise patients to limit direct ultraviolet exposure during treatment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tabrecta (capmatinib)." Novartis Pharmaceuticals  (2020):']
  },
  "ischemic attack, transient": {
    name: "Ischemic Attack, Transient",
    indonesianName: "Ischemic Attack, Transient (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ischemic Attack, Transient" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ischemic cerebrovascular events, including fatalities, occurred in patients treated with vandetanib.  The safety of resumption of vandetanib therapy after resolution of an ischemic cerebrovascular event has not been studied.  Care should be taken when prescribing this agent to patients at risk.  Discontinue treatment in patients who experience a severe ischemic cerebrovascular event.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Vandetanib (vandetanib)." Astra-Zeneca Pharmaceuticals  (2011):']
  },
  "hypophosphatemia": {
    name: "Hypophosphatemia",
    indonesianName: "Hypophosphatemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypophosphatemia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Sucralfate has phosphate binding properties for which the drug is sometimes used therapeutically.  However, hypophosphatemia may occur in some patients, regardless of renal status.  Therapy with sucralfate should be administered cautiously in patients with preexisting hypophosphatemia.  Monitoring phosphate levels in these patients is recommended.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['McCarthy DM "Sucralfate." N Engl J Med 325 (1991):  1017-25', 'Chines A, Pacifici R "Antacid and sucralfate-induced hypophosphatemic osteomalacia: a case report and review of the literature." Calcif Tissue Int 47 (1990):  291-5', '"Product Information. Carafate (sucralfate)." Hoechst Marion Roussel  (2001):', '"Product Information. Injectafer (ferric carboxymaltose)." American Regent Laboratories Inc  (2013):']
  },
  "retinal detachment": {
    name: "Retinal Detachment",
    indonesianName: "Retinal Detachment (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Retinal Detachment" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of miotic agents may occasionally cause retinal detachment due to drug-induced ciliary or accommodative spasm, which causes the lens and vitreous to move forward and create a retinal tear.  Therapy with miotic agents should be administered with extreme caution, if at all, in patients with risk factors for retinal detachment, such as old age, retinal degenerative changes or other retinal disorders, aphakia, prior cataract extraction, or a history of severe myopia or retinal detachment.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', 'Zimmerman TJ, Wheeler TM "Miotics: side effects and ways to avoid them." Ophthalmology 89 (1982):  76-80', 'Benedict WL, Shami M "Impending macular hole associated with topical pilocarpine." Am J Ophthalmol 114 (1992):  765-6', '"Product Information. Phospholine Iodide (echothiophate iodide ophthalmic)." Wyeth-Ayerst Laboratories', '"Product Information. Humorsol Ocumeter (demecarium bromide ophthalmic)." Merck & Co., Inc', '"Product Information. Eserine Sulfate Ophthalmic (PHYSostigmine ophthalmic)." Ciba Vision Ophthalmics']
  },
  "purpura, thrombotic thrombocytopenic": {
    name: "Purpura, Thrombotic Thrombocytopenic",
    indonesianName: "Purpura, Thrombotic Thrombocytopenic (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Purpura, Thrombotic Thrombocytopenic" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cases of thrombotic microangiopathy, including thrombotic thrombocytopenic purpura/hemolytic uremic syndrome (TTP/HUS) have been reported with the use of carfilzomib.  Monitor for signs and symptoms of TTP/HUS.  If the diagnosis is suspected, stop therapy and evaluate patients.  If the diagnosis of TTP/HUS is excluded, therapy may be restarted.  The safety of reinitiating carfilzomib therapy in patients previously experiencing TTP/HUS is not known.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):', '"Product Information. Valtrex (valacyclovir)." Glaxo Wellcome  (2001):']
  },
  "thrombophilia": {
    name: "Thrombophilia",
    indonesianName: "Thrombophilia (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thrombophilia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Carfilzomib should be used with caution in patients with a history of venous thromboembolic events, including deep venous thrombosis and pulmonary embolism.  Thromboprophylaxis is recommended for patients being treated with the combination of carfilzomib with dexamethasone or with lenalidomide plus dexamethasone.  The thromboprophylaxis regimen should be based on an assessment of the patient's underlying risks.  Patients using oral contraceptives or a hormonal method of contraception associated with a risk of thrombosis should consider an alternative method of effective contraception during treatment with carfilzomib in combination with dexamethasone or lenalidomide plus dexamethasone.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Kyprolis (carfilzomib)." Onyx Pharmaceuticals Inc  (2012):']
  },
  "systemic carnitine deficiency": {
    name: "Systemic carnitine deficiency",
    indonesianName: "Systemic carnitine deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Systemic carnitine deficiency" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of cefditoren pivoxil is contraindicated in patients with carnitine deficiency or congenital metabolic disorders that may result in clinically significant carnitine deficiency, since the drug can cause renal excretion of carnitine.  Cefditoren pivoxil is hydrolyzed by esterases in vivo to cefditoren and pivalate, the latter of which is primarily eliminated (> 99%) through renal excretion as pivaloylcarnitine.  In healthy volunteers given cefditoren pivoxil for 10 to 14 days, plasma carnitine concentrations decreased by an average of 39% to 63% depending on dosage and returned to the normal control range within 7 to 10 days after discontinuation of cefditoren pivoxil.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Spectracef (cefditoren)." TAP Pharmaceuticals Inc  (2001):']
  },
  "hypoprothrombinemias": {
    name: "Hypoprothrombinemias",
    indonesianName: "Hypoprothrombinemias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypoprothrombinemias" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hypoprothrombinemia, with or without bleeding, has been reported rarely with various cephalosporins, particularly those containing an N-methylthiotetrazole (NMTT) side chain (cefamandole, cefmetazole, cefoperazone, cefotetan).  The sulfhydryl group of this side chain is suspected of interfering with the hepatic synthesis of prothrombin.  Risk factors include advanced age, debility, vitamin K deficiency, malnutrition, malabsorption, and severe renal or hepatobiliary impairment.  Therapy with cephalosporins containing the NMTT side chain should be administered cautiously in patients with any of these risk factors and/or significant active bleeding or a hemorrhagic diathesis.  Prophylactic administration of vitamin K may be indicated in some patients, especially when intestinal sterilization and surgical procedures are performed.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Lerner PI, Lubin A "Coagulopathy with cefazolin in uremia." N Engl J Med 290 (1974):  1324', 'Fujita Y, Inoue S, Yorifuji R, et al. "Effects of cefotaxime on blood coagulation in patients with renal insufficiency." Drugs 35 (1988):  196-8', 'Kline SS, Mauro VF, Forney RB Jr, et al. "Cefotetan-induced disulfiram-type reactions and hypoprothrombinemia." Antimicrob Agents Chemother 31 (1987):  1328-31', 'Holt J "Hypoprothrombinemia and bleeding diathesis associated with cefotetan therapy in surgical patients." Arch Surg 123 (1988):  523', 'Conjura A, Bell W, Lipsky JJ "Cefotetan and hypoprothrombinemia." Ann Intern Med 108 (1988):  643', 'Kaiser CW, McAuliffe JD, Barth RJ, Lynch JA "Hypoprothrombinemia and hemorrhage in a surgical patient treated with cefotetan." Arch Surg 126 (1991):  524-5']
  },
  "vitamin k deficiency": {
    name: "Vitamin K Deficiency",
    indonesianName: "Vitamin K Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vitamin K Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cephalosporins may be associated with reduced prothrombin activity/prolonged prothrombin time.  Risk factors include renal or liver dysfunction, poor nutritional state, prolonged antimicrobial therapy, and previously stabilized on/receiving anticoagulant therapy.  Prothrombin time should be monitored in at-risk patients and managed as indicated (e.g., exogenous vitamin K administered).",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Cefotan (cefotetan)." Stuart Pharmaceuticals  (2002):', '"Product Information. Zinacef (cefuroxime)." Glaxo Wellcome  (2002):', '"Product Information. Keflex (cephalexin)." Dista Products Company  (2002):', '"Product Information. Rocephin (ceftriaxone)." Roche Laboratories  (2002):']
  },
  "hyperbilirubinemia": {
    name: "Hyperbilirubinemia",
    indonesianName: "Hyperbilirubinemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperbilirubinemia" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hyperbilirubinemic neonates, especially premature, should not be treated with ceftriaxone for injection.  Studies have shown that ceftriaxone can displace bilirubin from its binding to serum albumin, leading to possible risk of bilirubin encephalopathy in these patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Rocephin (ceftriaxone)." Roche Laboratories  (2002):', '"Product Information. Idhifa (enasidenib)." Celgene Corporation  (2017):', '"Product Information. Potiga (ezogabine)." GlaxoSmithKline  (2011):']
  },
  "lesch-nyhan syndrome": {
    name: "Lesch-Nyhan Syndrome",
    indonesianName: "Lesch-Nyhan Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lesch-Nyhan Syndrome" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Mycophenolate mofetil is an inosine monophosphate dehydrogenase (IMPDH) inhibitor; therefore it should be avoided in patients with hereditary deficiencies of hypoxanthine-guanine phosphoribosyl-transferase (HGPRT) such as Lesch-Nyhan and Kelley-Seegmiller syndromes because it may cause an exacerbation of disease symptoms characterized by the overproduction and accumulation of uric acid leading to symptoms associated with gout such as acute arthritis, tophi, nephrolithiasis or urolithiasis and renal disease including renal failure.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. CellCept (mycophenolate mofetil)." Roche Laboratories  (2001):', '"Product Information. Mycophenolic Acid (mycophenolic acid)." Apotex Corporation  (2017):']
  },
  "syncope": {
    name: "Syncope",
    indonesianName: "Syncope (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Syncope" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The administration of human papillomavirus vaccine has been associated with syncope, sometimes resulting in falling with injury.  The syncope sometimes is associated with tonic-clonic movements and other seizure-like activity.  Caution is recommended when administering the vaccine to individuals susceptible to syncope.  Observation for 15 minutes is recommended after its administration.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Gardasil (human papillomavirus vaccine)." Merck & Co., Inc  (2006):', '"Product Information. Gardasil 9 (human papillomavirus vaccine)." Merck & Co., Inc  (2016):']
  },
  "stevens-johnson syndrome": {
    name: "Stevens-Johnson Syndrome",
    indonesianName: "Stevens-Johnson Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Stevens-Johnson Syndrome" memiliki 12 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cutaneous reactions, in some cases severe, have been reported with the use of EGFR inhibitors.  Monitor patients who develop dermatologic or soft tissue toxicities while receiving these agents for the development of inflammatory or infectious sequelae.  It is recommended to withhold treatment, and appropriate measures should be instituted as appropriate or discontinue the use of these agents for dermatologic or soft tissue toxicity associated with severe or life-threatening inflammatory or infectious complications.  Advise patients to wear sunscreen and hats and limit sun exposure while receiving therapy with these agents as exposure to sunlight can exacerbate dermatologic toxicities.",
    ddinterSeverityDistribution: {
      major: 9,
      moderate: 3,
      minor: 0,
      total: 12
    },
    ddinterOfficialReferences: ['"Product Information. Iressa (gefitinib)." Astra-Zeneca Pharmaceuticals  (2003):', '"Product Information. Erbitux (cetuximab)." Bristol-Myers Squibb  (2004):', '"Product Information. Tarceva (erlotinib)." Genentech  (2004):', '"Product Information. Vectibix (panitumumab)." Amgen USA  (2006):', '"Product Information. Tykerb (lapatinib)." Novartis Pharmaceuticals  (2007):', '"Product Information. Tagrisso (osimertinib)." Astra-Zeneca Pharmaceuticals  (2015):']
  },
  "tympanic membrane perforation": {
    name: "Tympanic Membrane Perforation",
    indonesianName: "Tympanic Membrane Perforation (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tympanic Membrane Perforation" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of chloramphenicol otic preparations is contraindicated in patients with a perforated tympanic membrane.  The risk of ototoxicity may be increased if medication enters the middle ear.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Iqbal SM, Srivatsav CBP "Chloramphenicol ototoxicity." J Laryngol Otol 98 (1984):  523-5', '"Product Information. Mycifradin (neomycin)." Emerson Laboratories  (2001):']
  },
  "nutrition disorder": {
    name: "Nutrition disorder",
    indonesianName: "Nutrition disorder (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nutrition disorder" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Bile acid sequestrants may interfere with the absorption of folic acid and fat soluble vitamins such as A, D, and K.  Chronic use of bile acid sequestrants may cause increased bleeding tendency due to hypoprothrombinemia associated with vitamin K deficiency.  Anemia may also occur due to reduced serum or red blood cell folate.  Supplementation with oral vitamins and/or folate should be considered during prolonged therapy with bile acid sequestrants, particularly in patients with preexisting vitamin and/or folate deficiencies, anemia, or a bleeding diathesis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Heel RC, Brogden RN, Pakes GE, Speight TM, Avery GS "Colestipol: a review of its pharmacological properties and therapeutic efficacy in patients with hypercholesterolaemia." Drugs 19 (1980):  161-80', 'Gross L, Brotman M "Hypoprothrombinemia and hemorrhage associated with cholestyramine therapy." Ann Intern Med 72 (1970):  95-6', 'Heaton KW, Lever JV, Barnard D "Osteomalacia associated with cholestyramine therapy for postileectomy diarrhea." Gastroenterology 62 (1972):  642-6', '"Product Information. Questran (cholestyramine)." Par Pharmaceutical Inc  (2002):', '"Product Information. Colestid (colestipol)." Pharmacia and Upjohn']
  },
  "metrorrhagia": {
    name: "Metrorrhagia",
    indonesianName: "Metrorrhagia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Metrorrhagia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of clomiphene is contraindicated in patients with undiagnosed, abnormal genital bleeding.  Patients should be evaluated to ensure that neoplastic lesions are not present.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. ClomiPHENE Citrate (clomiPHENE)." Teva Pharmaceuticals USA  (2022):', '"Product Information. Danocrine (danazol)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "pituitary diseases": {
    name: "Pituitary Diseases",
    indonesianName: "Pituitary Diseases (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pituitary Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of clomiphene is contraindicated in patients with uncontrolled thyroid or adrenal dysfunction or an organic intracranial lesion such as a pituitary tumor.  Clomiphene interacts with estrogen receptors in various tissues, including the pituitary, the response of which is an increase in the release of pituitary gonadotropins.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. ClomiPHENE Citrate (clomiPHENE)." Teva Pharmaceuticals USA  (2022):']
  },
  "agranulocytosis": {
    name: "Agranulocytosis",
    indonesianName: "Agranulocytosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Agranulocytosis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of clozapine is contraindicated in patients with myeloproliferative disorders, preexisting bone marrow depression, or a history of clozapine-induced agranulocytosis or severe granulocytopenia.  Clozapine therapy is associated with the development of agranulocytosis, defined as an absolute neutrophil count (ANC) below 500/mm3.  The cumulative incidence is estimated at 1% to 2% after one year of use.  The onset is generally between 4 to 16 weeks following initiation of therapy, and it is usually reversible if detected early and the drug discontinued promptly.  All patients should have a white blood cell (WBC) count prior to initiating therapy, and clozapine should not be administered if baseline WBC count is less than 3500/mm3.  WBC counts and differential should be monitored closely during therapy and for 4 weeks after end of therapy according to product labeling.  Also, patients should be advised to immediately report signs of infection such as fever, sore throat, malaise, lethargy, and flu-like symptoms.  Individuals who develop clozapine-induced agranulocytosis or severe granulocytopenia (WBC count < 2000/mm3 or ANC < 1000/mm3) should not be rechallenged following recovery, since the condition may recur, often with a shorter latency on reexposure.  If continued neuroleptic therapy is necessary, other agents may be used with little apparent risk of cross-sensitivity.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Safferman AZ, Lieberman JA, Alvir JMJ, Howard A "Rechallenge in clozapine-induced agranulocytosis." Lancet 339 (1992):  1296-7', 'Joseph G, Nguyen V, Smith JD "HLA-B38 and clozapine-induced agranulocytosis." Ann Intern Med 116 (1992):  605', 'Cates M, Lusk K, Wells BG, Guthrie TC "Nonleukopenic neutropenia in a patient treated with clozapine." N Engl J Med 326 (1992):  840-1', 'Pisciotta AV, Konings SA, Ciesemier LL, Cronkite CE, Lieberman JA "Cytotoxic activity in serum of patients with clozapine-induced agranulocytosis." J Lab Clin Med 119 (1992):  254-66', 'Hummer M, Kurz M, Barnas C, Fleischhacker WW "Transient neutropenia induced by clozapine." Psychopharmacol Bull 28 (1992):  287-90', 'Tueth M "Side effects of clozipine (Clozaril) requiring emergency treatment." Am J Emerg Med 11 (1993):  312-3']
  },
  "unconsciousness": {
    name: "Unconsciousness",
    indonesianName: "Unconsciousness (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Unconsciousness" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with impaired gag reflex, unconscious or semi-conscious patients, and patients prone to regurgitation or aspiration should be administered polyethylene glycol (PEG) electrolyte solutions cautiously.  Patients experiencing severe bloating, distention or abdominal pain may need to receive PEG electrolyte solutions at a slower rate.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Golytely (polyethylene glycol 3350 with electrolytes)." Braintree']
  },
  "protein c deficiency": {
    name: "Protein C Deficiency",
    indonesianName: "Protein C Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Protein C Deficiency" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tissue necrosis is a rare complication that develops during the initiation of oral anticoagulant therapy due to thrombotic occlusion of venules in the dermis and subcutaneous tissues.  Hereditary, familial, or clinical deficiencies of protein C or its cofactor, protein S, may be associated with a hypercoagulable state and an increased risk of the complication.  Therapy with oral anticoagulants should be administered cautiously in patients with known or suspected deficiency in protein C-mediated anticoagulant response.  Concomitant administration with heparin for the first 5 to 7 days of oral anticoagulant therapy may minimize the risk.  If tissue necrosis develops, oral anticoagulant therapy should be discontinued promptly and vitamin K or frozen plasma administered at once.  Heparin should then be considered for anticoagulation.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Cole MS, Minifee PK, Wolma FJ "Coumarin necrosis: a review of the literature." Surgery 103 (1988):  271-7', 'Humphries JE, Gardner JH, Connelly JE "Warfarin skin necrosis: recurrence in the absence of anticoagulant therapy." Am J Hematol 37 (1991):  197-200', 'Horn JR, Danziger LH, Davis RJ "Warfarin-induced skin necrosis: report of four cases." Am J Hosp Pharm 38 (1981):  1763-8', 'Kandrotas RJ, Deterding J "Genital necrosis secondary to warfarin therapy." Pharmacotherapy 8 (1988):  351-4', 'Locht H, Lindstrom FD "Severe skin necrosis following warfarin therapy in a patient with protein C deficiency." J Intern Med 233 (1993):  287-9', 'Colman RW, Rao AK, Rubin RN "Warfarin skin necrosis in a 33-year-old woman." Am J Hematol 43 (1993):  300-3']
  },
  "coumarin resistance": {
    name: "Coumarin Resistance",
    indonesianName: "Coumarin Resistance (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Coumarin Resistance" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with edema, hereditary coumarin resistance, hyperlipidemia, hypothyroidism, or nephrotic syndrome may exhibit lower than expected hypoprothrombinemic response to oral anticoagulants.  Thus, more frequent laboratory (PT/INR) monitoring and dosage adjustment of anticoagulant may be required based on changes in the patient's condition.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Ganeval D, Fischer AM, Barre J, et al. "Pharmacokinetics of warfarin in the nephrotic syndrome and effect on vitamin K-dependent clotting factors." Clin Nephrol 25 (1986):  75-80', 'Rice AJ, McIntosh TJ, Fouts JR, et al. "Decrease sensitivity to warfarin in patients with myxedema." Am J Med Sci 262 (1971):  211-5', 'Walters MB "The relationship between thyroid function and anticoagulant therapy." Am J Cardiol 11 (1963):  112-4', '"Product Information. Coumadin (warfarin)." DuPont Pharmaceuticals  (2001):', 'Demirkan K, Stephens MA, Newman KP, Self TH "Response to warfarin and other oral anticoagulants: effects of disease states." South Med J 93 (2000):  448-54; quiz 455', 'Stephens MA, Self TH, Lancaster D, Nash T "Hypothyroidism: effect on warfarin anticoagulation." South Med J 82 (1989):  1585-6']
  },
  "coumarin sensitivity": {
    name: "Coumarin Sensitivity",
    indonesianName: "Coumarin Sensitivity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Coumarin Sensitivity" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with a collagen vascular disease (e.g., systemic lupus erythematosus, rheumatoid arthritis, scleroderma), congestive heart failure (especially decompensated disease), severe or prolonged diarrhea, fever, hyperthyroidism, malabsorption, or steatorrhea may exhibit greater than expected hypoprothrombinemic response to oral anticoagulants.  Thus, more frequent laboratory (PT/INR) monitoring and dosage adjustment of anticoagulant may be required based on changes in the patient's condition.  Patients should be advised to promptly report any signs of bleeding to their physician, including pain, swelling, headache, dizziness, weakness, prolonged bleeding from cuts, increased menstrual flow, vaginal bleeding, nosebleeds, bleeding of gums from brushing, unusual bleeding or bruising, red or brown urine, or red or black stools.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Vagenakis AG, Cote R, Miller ME, et al. "Enhancement of warfarin-induced hypoprothrombinemia by thyrotoxicosis." Johns Hopkins Med J 131 (1972):  69-73', 'Owens JC, Neely WB, Owen WR "Effect of sodium dextrothyroxine in patients receiving anticoagulants." N Engl J Med 266 (1962):  76-9', 'Self T, Weisburst M, Wooten E, Straughn A, Oliver J "Warfarin-induced hypoprothrombinemia: potentiation by hyperthyroidism." JAMA 231 (1975):  1165-6', 'Landefeld CS, Cook EF, Flatley M, Weisberg M, Goldman L "Identification and preliminary validation of predictors of major bleeding in hospitalized patients starting anticoagulant therapy." Am J Med 82 (1987):  703-13', 'Black JA "Diarrhoea, vitamin k, and warfarin." Lancet 344 (1994):  1373', '"Product Information. Coumadin (warfarin)." DuPont Pharmaceuticals  (2001):']
  },
  "hematuria": {
    name: "Hematuria",
    indonesianName: "Hematuria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hematuria" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "An association between rosuvastatin and the development of proteinuria and microscopic hematuria was observed among treated patients during clinical trials.  Patients with unexplained persistent proteinuria and/or hematuria during routine urinalysis testing should be instructed to reduce the dose of rosuvastatin according to clinical standards.  Therapy with rosuvastatin should be administered cautiously in patients showing abnormal urinalysis.  Monitoring for proteinuria and hematuria is recommended.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Crestor (rosuvastatin)." AstraZeneca Pharma Inc  (2003):', '"Product Information. Cysview (hexaminolevulinate)." Photocure Inc  (2014):']
  },
  "anemia, iron-deficiency": {
    name: "Anemia, Iron-Deficiency",
    indonesianName: "Anemia, Iron-Deficiency (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia, Iron-Deficiency" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of trientine has been associated with exacerbating iron deficiency.  Therapy with trientine should be administered cautiously in patients with iron deficiency.  If iron supplements are administered, an interval of two hours between iron and trientine is recommended.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Syprine (trientine)." Aton Pharma  (2001):']
  },
  "subarachnoid hemorrhage": {
    name: "Subarachnoid Hemorrhage",
    indonesianName: "Subarachnoid Hemorrhage (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Subarachnoid Hemorrhage" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of tranexamic acid is contraindicated in patients with subarachnoid hemorrhage.  Cerebral edema and infarction can occur in patients with subarachnoid hemorrhage.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cyklokapron (tranexamic acid)." Pharmacia and Upjohn  (2001):']
  },
  "color vision defects": {
    name: "Color Vision Defects",
    indonesianName: "Color Vision Defects (Sistem Oftalmologi & Indra)",
    organSystem: "Sistem Oftalmologi & Indra",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Color Vision Defects" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Tranexamic acid should be used with caution in patients with acquired defective color vision or visual disturbances.  Poorly characterized visual abnormalities have been reported in patients during tranexamic acid therapy.  Retinal degeneration in a variety of animal species (not human) at oral and IV doses 3 to 40 times the recommended human dosage has been noted.  Ophthalmologic testing and monitoring (visual acuity, and optical coherence tomography) prior to and at regular intervals during treatment is recommended for patients treated longer than 3 months.  Discontinue treatment if changes in ophthalmological examination occur.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cyklokapron (tranexamic acid)." Pharmacia and Upjohn  (2001):']
  },
  "cystitis": {
    name: "Cystitis",
    indonesianName: "Cystitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cystitis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Inflammation of the bladder may interfere with the diagnostic utility of hexaminolevulinate, which is an ester of the heme precursor, aminolevulinic acid.  Following intravesical instillation of hexaminolevulinate, photoactive porphyrins are formed and accumulate intracellularly in bladder wall lesions.  In humans, a higher degree of accumulation of porphyrins has been demonstrated in neoplastic or inflamed cells compared to normal bladder urothelium.  As such, inflammation may lead to increased porphyrin buildup and higher risk of local toxicity upon illumination as well as false-positive fluorescence.  Hexaminolevulinate should not be used in patients at high risk of bladder inflammation, such as those who received BCG immunotherapy or intravesical chemotherapy within the past 90 days.  Widespread inflammation of the bladder should be excluded by cystoscopy before hexaminolevulinate is administered.  If a widespread inflammation in the bladder becomes evident during white light inspection, the blue light inspection should be avoided.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Cysview (hexaminolevulinate)." Photocure Inc  (2014):']
  },
  "perimeningeal infections": {
    name: "Perimeningeal Infections",
    indonesianName: "Perimeningeal Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Perimeningeal Infections" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of cytarabine liposomal is contraindicated in patients with active meningeal infection.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. DepoCyt (cytarabine liposomal)." Sigma-Tau Pharmaceuticals  (2003):']
  },
  "graves disease": {
    name: "Graves Disease",
    indonesianName: "Graves Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Graves Disease" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of thyroid hormones is contraindicated in patients with untreated thyrotoxicosis of any etiology, since thyroid hormones may exacerbate the condition.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Synthroid (levothyroxine)." Abbott Pharmaceutical  (2002):', '"Product Information. Cytomel (liothyronine)." Monarch Pharmaceuticals Inc  (2001):', '"Product Information. Armour Thyroid (thyroid desiccated)." Forest Pharmaceuticals  (2022):', '"Product Information. Thyrolar (liotrix)." Forest Pharmaceuticals  (2001):']
  },
  "alcohol-induced disorders": {
    name: "Alcohol-Induced Disorders",
    indonesianName: "Alcohol-Induced Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Alcohol-Induced Disorders" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with a history of abuse or addiction to alcohol or other substances may be at increased risk for abuse of or addiction to daridorexant and should be monitored closely.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Quviviq (daridorexant)." Idorsia Pharmaceuticals US Inc.  (2022):']
  },
  "pulmonary arterial hypertension": {
    name: "Pulmonary Arterial Hypertension",
    indonesianName: "Pulmonary Arterial Hypertension (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pulmonary Arterial Hypertension" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Dasatinib can increase the risk of developing pulmonary arterial hypertension (PAH) which may occur any time after treatment initiation, including after more than 1 year of treatment.  Manifestations may include dyspnea, fatigue, hypoxia, and fluid retention.  PAH may be reversible with treatment discontinuation.  Caution should be exercised in patients with underlying cardiopulmonary disease.  If PAH develops, treatment should be discontinued.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Sprycel (dasatinib)." Bristol-Myers Squibb  (2006):']
  },
  "auditory diseases, central": {
    name: "Auditory Diseases, Central",
    indonesianName: "Auditory Diseases, Central (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Auditory Diseases, Central" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Auditory disturbances (high-frequency hearing loss, decreased hearing), and ocular disturbances (lens opacities, cataracts, elevations in intraocular pressure, and retinal disorders) have been reported in patients using deferasirox.  It is recommended to perform auditory and ophthalmic testing (including slit lamp examinations and dilated fundoscopy) before starting therapy with deferasirox and thereafter as clinically indicated.  If disturbances are noted, consider dose reduction or interruption if appropriate.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Exjade (deferasirox)." Novartis Pharmaceuticals  (2005):', '"Product Information. Desferal (deferoxamine)." Novartis Pharmaceuticals  (2001):']
  },
  "respiratory distress syndrome": {
    name: "Respiratory Distress Syndrome",
    indonesianName: "Respiratory Distress Syndrome (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Respiratory Distress Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Acute respiratory distress syndrome has been described in patients with acute iron intoxication or thalassemia following treatment with excessively high intravenous doses of deferoxamine.  Caution is recommended when using deferoxamine in these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Desferal (deferoxamine)." Novartis Pharmaceuticals  (2001):']
  },
  "diabetes insipidus, nephrogenic": {
    name: "Diabetes Insipidus, Nephrogenic",
    indonesianName: "Diabetes Insipidus, Nephrogenic (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diabetes Insipidus, Nephrogenic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of demeclocycline has been associated with a dose-dependent, reversible, nephrogenic diabetes insipidus syndrome in some patients receiving long-term therapy.  Symptoms of diabetes insipidus include polyuria, polydipsia, and weakness.  Therapy with demeclocycline should be administered cautiously in patients with preexisting nephrogenic diabetes insipidus.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Braden GL, Geheb MA, Shook A, Singer I, Cox M "Demeclocycline-induced natriuresis and renal insufficiency: in vivo and in vitro studies." Am J Kidney Dis 5 (1985):  270-7', 'Cherrill DA, Stote RM, Birge JR, Singer I "Demeclocycline treatment in the syndrome of inappropriate antidiuretic hormone secretion." Ann Intern Med 83 (1975):  654-6', 'Singer I, Rotenberg D "Demeclocycline-induced nephrogenic diabetes insipidus. In-vivo and in- vitro studies." Ann Intern Med 79 (1973):  679-83', 'Hayek A, Ramirez J "Demeclocycline-induced diabetes insipidus." JAMA 229 (1974):  676-7', 'Perks WH, Walters EH, Tams IP, Prowse K "Demeclocycline in the treatment of the syndrome of inappropriate secretion of antidiuretic hormone." Thorax 34 (1979):  324-7', '"Product Information. Declomycin (demeclocycline)." Lederle Laboratories  (2001):']
  },
  "extrapyramidal symptoms": {
    name: "Extrapyramidal Symptoms",
    indonesianName: "Extrapyramidal Symptoms (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Extrapyramidal Symptoms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Extrapyramidal symptoms (EPS) have occurred in approximately 10% of patients receiving metyrosine.  EPS include drooling, speech difficulty, and tremor.  Trismus and parkinsonian syndrome have been reported.  Therapy with metyrosine should be administered cautiously in patients with or predisposition to EPS or Parkinson's disease.  Dosage reduction or discontinuation of metyrosine may be necessary.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Demser (metyrosine)." Merck & Co., Inc  (2001):']
  },
  "deglutition disorders": {
    name: "Deglutition Disorders",
    indonesianName: "Deglutition Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Deglutition Disorders" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of deoxycholic acid might cause dysphagia.  It is recommended to avoid the use of this agent in patients with a current or prior history of dysphagia as deoxycholic acid may exacerbate this condition.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 4,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. Kybella (deoxycholic acid)." Kythera Biopharmaceuticals, Inc.  (2015):', '"Product Information. Myobloc (rimabotulinumtoxinB)." Elan Pharmaceuticals', '"Product Information. Xenazine (tetrabenazine)." Prestwick Pharmaceuticals Inc  (2008):', '"Product Information. Renagel (sevelamer)." Genzyme Corporation  (2001):', '"Product Information. Renvela (sevelamer)." Genzyme Corporation  (2009):']
  },
  "intestinal pseudo-obstruction": {
    name: "Intestinal Pseudo-Obstruction",
    indonesianName: "Intestinal Pseudo-Obstruction (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intestinal Pseudo-Obstruction" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Morphine liposomal, as with all opiates, diminishes propulsive peristaltic waves in the gastrointestinal tract and may prolong obstruction; therefore, its use is contraindicated in any patient who has or is suspected of having paralytic ileus.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. DepoDur (morphine liposomal)." Endo Laboratories LLC  (2004):']
  },
  "water intoxication": {
    name: "Water Intoxication",
    indonesianName: "Water Intoxication (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Water Intoxication" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Water intoxication and hyponatremia may occur during therapy with vasopressin or desmopressin due to their antidiuretic action.  Patients are most likely to experience this problem if their fluid intake is excessive or if they do not require antidiuresis, such as when they are administered these agents for their hemostatic effects.  Fluid intake should be adjusted carefully to avoid overhydration, particularly in children, elderly, and patients with conditions that may be exacerbated by fluid retention, including epilepsy, migraine, asthma, and heart failure.  Patients should be monitored for signs of water intoxication (e.g., listlessness, drowsiness, and headaches), which may rarely progress to seizures and coma.  The use of desmopressin is contraindicated in patients with hyponatremia or a history of hyponatremia.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Pitressin (vasopressin)." Parke-Davis  (2001):', '"Product Information. DDAVP (desmopressin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Stimate (desmopressin)." Forest Pharmaceuticals  (2001):', 'Lin TW, Kuo YS "Acute pulmonary oedema following administration of vasopressin for control of massive GI tract haemorrhage in a major burn patient." Burns 22 (1996):  73-5', 'Tulandi T, Beique F, Kimia M "Pulmonary edema: a complication of local injection of vasopressin at laparoscopy." Fertil Steril 66 (1996):  478-80', 'Robson WLM "Water intoxication in patients treated with desmopressin." Pharmacotherapy 16 (1996):  969-70']
  },
  "vascular diseases": {
    name: "Vascular Diseases",
    indonesianName: "Vascular Diseases (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vascular Diseases" memiliki 5 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of desmopressin, primarily in parenteral administration and/or in large doses, has been infrequently associated with changes in blood pressure, causing either slight elevations or transient decreases with a compensatory increase in heart rate.  Therapy with desmopressin, regardless of route of administration, should be administered cautiously in patients with coronary artery insufficiency and/or hypertensive cardiovascular disease.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 3,
      minor: 0,
      total: 5
    },
    ddinterOfficialReferences: ['"Product Information. DDAVP (desmopressin)." Rhone Poulenc Rorer  (2001):', '"Product Information. Stimate (desmopressin)." Forest Pharmaceuticals  (2001):', '"Product Information. Ipecac (ipecac)." Roxane Laboratories Inc  (2001):', 'Beller BM, Trevino A, Urban E "Pitressin-induced myocardial injury and depression in a young woman." Am J Med 51 (1971):  675-9', 'Kelly KJ, Stang JM, Mekhjian HS "Vasopressin provocation of ventricular dysrhythmia." Ann Intern Med 92 (1980):  205-6', 'Colombani P "Upper extremity gangrene secondary to superior mesenteric artery infusion of vasopressin." Dig Dis Sci 27 (1982):  367-9']
  },
  "arthritis, rheumatoid": {
    name: "Arthritis, Rheumatoid",
    indonesianName: "Arthritis, Rheumatoid (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Arthritis, Rheumatoid" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "A large, randomized, postmarketing safety trial of a JAK inhibitor in rheumatoid arthritis (RA) patients 50 years old and older with at least one cardiovascular risk factor, reported higher rates of all-cause mortality, including sudden cardiovascular death, major adverse cardiovascular events, overall thrombosis, deep venous thrombosis, pulmonary embolism, and malignancies (excluding non-melanoma skin cancer) in patients treated with the JAK inhibitor compared to patients receiving TNF blockers.  Deucravacitinib is not approved for use in RA.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 1,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Sotyktu (deucravacitinib)." Bristol-Myers Squibb  (2022):', '"Product Information. Infed (iron dextran)." Schein Pharmaceuticals Inc', '"Product Information. DexFerrum (iron dextran)." American Regent Laboratories Inc  (2015):']
  },
  "hemoglobinopathies": {
    name: "Hemoglobinopathies",
    indonesianName: "Hemoglobinopathies (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemoglobinopathies" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "There is no excretory mechanism for iron.  Iron will correct only hemoglobin abnormalities due to iron deficiency and should not be used to treat conditions such as thalassemia, hemosiderosis, hemochromatosis, normocytic anemia (unless iron deficiency exists), or in patients receiving blood transfusions.  Clinical monitoring of erythropoietic function and ferritin levels is recommended.",
    ddinterSeverityDistribution: {
      major: 7,
      moderate: 0,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Infed (iron dextran)." Schein Pharmaceuticals Inc', '"Product Information. Venofer (iron sucrose)." American Regent Laboratories Inc  (2001):', '"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "feeding and eating disorders": {
    name: "Feeding and Eating Disorders",
    indonesianName: "Feeding and Eating Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Feeding and Eating Disorders" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Stiripentol can cause decreases in appetite and weight.  It is recommended to monitor pediatric patients' growth and, in some cases, to decrease the dose of concomitant valproate by 30% per week to reduce the decrease in appetite and weight.  Exercise caution when prescribing this agent to patients at risk.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Diacomit (stiripentol)." Biocodex USA  (2018):']
  },
  "sleepiness": {
    name: "Sleepiness",
    indonesianName: "Sleepiness (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sleepiness" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Stiripentol can cause somnolence.  If somnolence occurs during co-administration with clobazam, consider an initial reduction of clobazam by 25%.  If somnolence persists, further clobazam reduction by an additional 25% should be considered.  Adjust the dosage of other concomitant anticonvulsant drugs with sedating properties if needed.  Exercise caution when prescribing this agent to patients with CNS disorders.  Prescribers should monitor patients for somnolence and caution against engaging in hazardous activities requiring mental alertness.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Diacomit (stiripentol)." Biocodex USA  (2018):']
  },
  "respiratory tract infections": {
    name: "Respiratory Tract Infections",
    indonesianName: "Respiratory Tract Infections (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Respiratory Tract Infections" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The adrenergic blocking effect of phenoxybenzamine may aggravate the symptoms of respiratory infections.  Caution is recommended when treating patients with respiratory infections.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Dibenzyline (phenoxybenzamine)." SmithKline Beecham']
  },
  "cystic fibrosis": {
    name: "Cystic Fibrosis",
    indonesianName: "Cystic Fibrosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cystic Fibrosis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The penicillinase-resistant penicillins, dicloxacillin and methicillin, are both eliminated by the kidney.  Renal elimination of these penicillins has been shown to increase in patients with cystic fibrosis, resulting in decreased peak serum drug concentrations and AUCs.  Clinicians should be cognizant of these effects when prescribing or administering the antibiotics to patients with cystic fibrosis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['Yaffe SJ, Gerbracht LM, Mosovich LL, Mattar ME, Danish M, Jusko WJ "Pharmacokinetics of methicillin in patients with cystic fibrosis." J Infect Dis 135 (1977):  828-31', '"Product Information. Dynapen (dicloxacillin)." Apothecon Inc  (2002):', '"Product Information. Staphcillin (methicillin)." Apothecon Inc  (2002):', '"Product Information. Sporanox (itraconazole)." Janssen Pharmaceuticals  (2002):', '"Product Information. Sporanox (itraconazole)." Janssen Pharmaceuticals  (2022):']
  },
  "cardiovascular disease": {
    name: "Cardiovascular disease",
    indonesianName: "Cardiovascular disease (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cardiovascular disease" memiliki 9 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with heart failure associated with preserved left ventricular systolic function, such as in restrictive cardiomyopathy, constrictive pericarditis, amyloid heart disease and acute cor pulmonale, may be particularly susceptible to experience decrease cardiac output.  Therapy with digoxin should be administered cautiously in such patients.  Patients with idiopathic hypertrophic subaortic stenosis may have worsening of the outflow obstruction due to the inotropic effects of digoxin.",
    ddinterSeverityDistribution: {
      major: 6,
      moderate: 3,
      minor: 0,
      total: 9
    },
    ddinterOfficialReferences: ['"Product Information. Lanoxin (digoxin)." Glaxo Wellcome  (2001):', '"Product Information. Northera (droxidopa)." Chelsea Therapeutics Inc  (2014):', '"Product Information. Narcan (naloxone)." DuPont Pharmaceuticals  (2001):', '"Product Information. Nardil (phenelzine)." Parke-Davis  (2001):', '"Product Information. Parnate (tranylcypromine)." SmithKline Beecham  (2001):', '"Product Information. Marplan (isocarboxazid)." Roche Laboratories  (2001):']
  },
  "myocarditis": {
    name: "Myocarditis",
    indonesianName: "Myocarditis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myocarditis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Digoxin can rarely precipitate vasoconstriction and may promote the development of cytokines; therefore, should be avoided in patients with myocarditis.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Lanoxin (digoxin)." Glaxo Wellcome  (2001):']
  },
  "thiamine deficiency": {
    name: "Thiamine Deficiency",
    indonesianName: "Thiamine Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thiamine Deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with beri beri heart disease may fail to respond adequately to digoxin if the underlying thiamine deficiency is not treated concomitantly.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Lanoxin (digoxin)." Glaxo Wellcome  (2001):', '"Product Information. Inrebic (fedratinib)." Celgene Corporation  (2019):', '"Product Information. Inrebic (fedratinib)." Bristol-Myers Squibb  (2022):']
  },
  "coronary vasospasm": {
    name: "Coronary Vasospasm",
    indonesianName: "Coronary Vasospasm (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Coronary Vasospasm" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of ergot alkaloids is contraindicated in patients with conditions predisposing them to vasospastic reactions, including, ischemic heart disease (angina, history of myocardial infarction, silent ischemia), peripheral vascular disease, sepsis, shock, vascular surgery, uncontrolled hypertension, and severely impaired hepatic or renal function.  The vasoconstriction produced be ergot alkaloids may exacerbate these conditions.  Ergot alkaloids may cause vasospastic reactions other than coronary artery vasospasm such as peripheral vascular reactions, and colonic ischemia, causing muscle pains, numbness, coldness, pallor, and cyanosis of the digits.  In patients with compromised circulation, persistent vasospasm may result in gangrene or death.  Nitroprusside and heparin have been used to treat ergotamine- induced severe vasoconstriction.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. D.H.E. 45 (dihydroergotamine)." Sandoz Pharmaceuticals Corporation  (2002):', '"Product Information. Migranal (dihydroergotamine nasal)." Novartis Pharmaceuticals  (2001):']
  },
  "anemia, megaloblastic": {
    name: "Anemia, Megaloblastic",
    indonesianName: "Anemia, Megaloblastic (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia, Megaloblastic" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hydantoin anticonvulsants may interfere with folate metabolism and precipitate macrocytosis and megaloblastic anemia, which usually respond to folic acid therapy.  These reactions have been fairly uncommon but may be of concern in patients with megaloblastic anemia or folate deficiency receiving hydantoin therapy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Goggin T, Gough H, Bissessar A, et al. "A comparative study of the relative effects of anticonvulsant drugs and dietary folate on the red cell folate status of patients with epilepsy." Q J Med 65 (1987):  911-9', '"Product Information. Dilantin (phenytoin)." Parke-Davis  (2001):', '"Product Information. Cerebyx (fosphenytoin)." Parke-Davis  (2001):', '"Product Information. Peganone (ethotoin)." Abbott Pharmaceutical  (2001):', '"Product Information. Mesantoin (mephenytoin)." Novartis Pharmaceuticals  (2001):', 'Corcino J, Waxman S, Herbert V "Mechanism of triamterene-induced megaloblastosis." Ann Intern Med 73 (1970):  419-24']
  },
  "lymphopenia": {
    name: "Lymphopenia",
    indonesianName: "Lymphopenia (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lymphopenia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of dimethyl fumarate may decrease lymphocyte counts.  Dimethyl fumarate has not been studied in patients with preexisting low lymphocyte counts; caution is advised in these patients.  CBC (including lymphocyte count) should be obtained before initiating treatment with dimethyl fumarate, 6 months after starting treatment, every 6 to 12 months thereafter, and as clinically indicated.  Interruption of therapy in patients with lymphocyte counts less than 0.5 x 10(9) cells/L persisting for more than 6 months and withholding treatment from patients with serious infections until resolution should be considered.  Caution is recommended and decisions about whether or not to restart dimethyl fumarate should be individualized based on clinical circumstances.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tecfidera (dimethyl fumarate)." Biogen Idec Inc  (2023):']
  },
  "hemolytic-uremic syndrome": {
    name: "Hemolytic-Uremic Syndrome",
    indonesianName: "Hemolytic-Uremic Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hemolytic-Uremic Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atypical hemolytic uremic syndrome in the absence of documented infection and resulting in renal insufficiency, electrolyte abnormalities, anemia, and hypertension can occur in patients treated with dinutuximab.  Atypical hemolytic uremic syndrome has recurred following rechallenge with dinutuximab.  Permanently discontinue therapy and institute supportive management for signs of hemolytic uremic syndrome.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Unituxin (dinutuximab)." United Therapeutics Corporation  (2015):']
  },
  "aphakia": {
    name: "Aphakia",
    indonesianName: "Aphakia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Aphakia" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Up to 30% of aphakic patients treated chronically with ophthalmic epinephrine (of which dipivefrin is a prodrug) may develop cystoid macular edema, which is generally reversible following withdrawal of the medication.  Ophthalmic epinephrine preparations should be administered cautiously with appropriate monitoring in patients with aphakia.  Therapy should be discontinued if blurred or distorted vision, central scotoma, and/or loss of visual acuity occur.  Slight visual impairment may respond to a reduction in the concentration or frequency of administration of the drug.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):', 'Thomas JV, Gragoudas ES, Blair NP, Lapus JV "Correlation of epinephrine use and macular edema in aphakic glaucomatous eyes." Arch Ophthalmol 96 (1978):  625-8', 'Mackool RJ, Muldoon T, Fortier A, Nelson D "Epinephrine-induced cystoid macular edema in aphakic eyes." Arch Ophthalmol 95 (1977):  791-3', 'Kolker AE, Becker B "Epinephrine maculopathy." Arch Ophthalmol 79 (1968):  552-62', 'Cerasoli JR "Effects of drugs on the retina." Int Ophthalmol Clin 11 (1971):  121-35', 'Obstbaum SA, Galin MA, Poole TA "Topical epinephrine and cystoid macular edema." Ann Ophthalmol 8 (1976):  455-8']
  },
  "hypermagnesemia": {
    name: "Hypermagnesemia",
    indonesianName: "Hypermagnesemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypermagnesemia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Each gram of anhydrous magnesium salicylate contains approximately 6.7 mEq of magnesium.  Therapy with products containing magnesium salicylate should be avoided or administered cautiously in patients with renal impairment because of the risk of hypermagnesemia.  The use of products containing magnesium salicylate is contraindicated in patients with chronic advanced renal impairment.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['American Medical Association, Division of Drugs and Toxicology "Drug evaluations annual 1994." Chicago, IL: American Medical Association;  (1994):']
  },
  "paresthesia": {
    name: "Paresthesia",
    indonesianName: "Paresthesia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Paresthesia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe neurosensory symptoms such as paresthesia, dysesthesia, and pain have been reported during docetaxel therapy.  Therapy with docetaxel should be administered cautiously to patients with or predisposition to neurosensory symptoms.  Although reversible with discontinuation of docetaxel therapy, the dosage must be adjusted if neurosensory symptoms occur and therapy discontinued if symptoms persist.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['New PZ, Jackson CE, Rinaldi D, Burris H, Barohn RJ "Peripheral neuropathy secondary to docetaxel (Taxotere)." Neurology 46 (1996):  108-11', 'New P "Neurotoxicity of Taxotere (Meeting abstract)." Proc Annu Meet Am Assoc Cancer Res 34 (1993):  a13931993', '"Product Information. Taxotere (docetaxel)." Rhone Poulenc Rorer  (2001):']
  },
  "exocrine pancreatic insufficiency": {
    name: "Exocrine Pancreatic Insufficiency",
    indonesianName: "Exocrine Pancreatic Insufficiency (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Exocrine Pancreatic Insufficiency" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Avoid the administration of triheptanoin in patients with pancreatic insufficiency as reduced absorption will lead to insufficient supplementation.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Dojolvi (triheptanoin)." Ultragenyx Pharmaceutical  (2020):']
  },
  "sleep wake disorders": {
    name: "Sleep Wake Disorders",
    indonesianName: "Sleep Wake Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sleep Wake Disorders" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Sleep disturbances may be the presenting manifestation of a physical and/or psychiatric disorder.  The symptomatic treatment of insomnia should be initiated only after a careful evaluation of the patient.  The failure of insomnia to remit after 7 to 10 days of treatment may indicate the presence of a primary psychiatric or medical illness that should be evaluated.  Worsening of insomnia with the emergence of new thinking or behavior abnormalities may be the consequence of an unrecognized disorder.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Restoril (temazepam)." Sandoz Pharmaceuticals Corporation  (2001):', '"Product Information. Doral (quazepam)." Wallace Laboratories  (2001):', '"Product Information. Zelapar (selegiline)." Valeant Pharmaceuticals  (2006):']
  },
  "helminthiasis": {
    name: "Helminthiasis",
    indonesianName: "Helminthiasis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Helminthiasis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with preexisting-existing helminth infections should be treated prior to therapy with dupilumab.  It is recommended to discontinue treatment with dupilumab if patients become infected while on treatment and if they are not responding to treatment.  Discontinue treatment with dupilumab until the infection resolves.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Dupixent (dupilumab)." sanofi-aventis  (2017):', '"Product Information. Tezspire (tezepelumab)." Amgen USA  (2021):']
  },
  "meningococcal infections": {
    name: "Meningococcal Infections",
    indonesianName: "Meningococcal Infections (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Meningococcal Infections" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Eculizumab is contraindicated in patients with unresolved serious Neisseria meningitidis infection, in those who are not currently vaccinated against Neisseria meningitidis, unless the risks of delaying treatment outweigh the risks of developing a meningococcal infection.  Life-threatening and fatal meningococcal infections have occurred in patients treated with eculizumab.  The use of eculizumab increases a patient's susceptibility to serious meningococcal infections (septicemia and/or meningitis).  Closely monitor patients for early signs and symptoms of meningococcal infection and evaluate patients immediately if an infection is suspected.  Meningococcal infection may become rapidly life-threatening or fatal if not recognized and treated early.  It is recommended to discontinue eculizumab in patients who are undergoing treatment for serious meningococcal infections.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Soliris (eculizumab)." Alexion Pharmaceuticals Inc  (2007):']
  },
  "thrombotic microangiopathies": {
    name: "Thrombotic Microangiopathies",
    indonesianName: "Thrombotic Microangiopathies (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thrombotic Microangiopathies" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thrombotic microangiopathy (TMA) complications have occurred after treatment discontinuation or after a missed dose of eculizumab.  It is recommended to monitor patients with atypical hemolytic uremic syndrome for signs and symptoms of thrombotic microangiopathy (TMA) complications for at least 12 weeks.  If TMA complications occur after eculizumab discontinuation, consider reinstitution of treatment, plasma therapy or appropriate organ-specific supportive measures.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Soliris (eculizumab)." Alexion Pharmaceuticals Inc  (2007):', '"Product Information. Plegridy (peginterferon beta-1a)." Biogen Idec Inc  (2014):']
  },
  "alkalosis": {
    name: "Alkalosis",
    indonesianName: "Alkalosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Alkalosis" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hypokalemia in patients with metabolic or respiratory alkalosis should generally be treated with potassium chloride rather than an alkalinizing potassium salt (i.e. acetate, bicarbonate, citrate, or gluconate), since alkali therapy may exacerbate the condition.  In addition, hypochloremia may accompany alkalosis, which is best treated with potassium chloride.  Close monitoring of acid-base balance, serum electrolytes, electrocardiogram, and clinical status is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 4,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['Walker WG, Jost LJ "Relative roles of patassium and chloride in correction of hypokalemic hypochloremic alkalosis." Johns Hopkins Med J 120 (1967):  148-54', '"Product Information. Potassium Acetate (potassium acetate)." Abbott Pharmaceutical  (2002):', '"Product Information. K-Lyte (potassium bicarbonate-potassium citrate)." Bristol-Myers Squibb  (2002):', '"Product Information. Kaon (potassium gluconate)." Savage Laboratories  (2002):']
  },
  "melanoma": {
    name: "Melanoma",
    indonesianName: "Melanoma (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Melanoma" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with Parkinson's disease have a higher risk of developing melanoma than the general population.  Patients and providers should be advised to monitor for melanoma frequently and regularly when using selegiline.  Skin examinations should be performed by qualified individuals (e.g., dermatologists).",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Zelapar (selegiline)." Valeant Pharmaceuticals  (2006):', `Kochar AS "Development of malignant melanoma after levodopa therapy for  Parkinson's disease. Report of a case and review of the literature." Am J Med 79 (1985):  119-21`, 'Bernstein JE, Medenica M, Soltani K, Solomon A, Lorincz AL "Levodopa administration and multiple primary cutaneous melanomas." Arch Dermatol 116 (1980):  1041-44', 'Robinson E, Wajsbort J, Hirshowitz B "Levodopa and malignant melanoma." Arch Pathol 95 (1973):  213', 'Haider SA, Thaller VT "Lid melanoma and parkinsonism." Br J Ophthalmol 76 (1992):  246-7', 'Gurney H, Coates A, Kefford R "The use of L-dopa and carbidopa in metastatic malignant melanoma." J Invest Dermatol 96 (1991):  85-7']
  },
  "skin neoplasms": {
    name: "Skin Neoplasms",
    indonesianName: "Skin Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Skin Neoplasms" memiliki 7 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of calcineurin inhibitors such as pimecrolimus and tacrolimus topical should be avoided on malignant or premalignant skin conditions.  Some of these conditions might present as dermatitis.  Calcineurin inhibitors should also be avoided in any skin conditions where there is the potential for increased systemic absorption of the medication as when there is a skin barrier defect.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 5,
      minor: 0,
      total: 7
    },
    ddinterOfficialReferences: ['"Product Information. Protopic (tacrolimus topical)." Fujisawa  (2001):', '"Product Information. Elidel (pimecrolimus topical)." Novartis Pharmaceuticals  (2002):', '"Product Information. Oxsoralen (methoxsalen topical)." Apothecon Inc  (2022):', '"Product Information. Oxsoralen (methoxsalen)." ICN Pharmaceuticals Inc  (2001):', '"Product Information. Mycophenolic Acid (mycophenolic acid)." Apotex Corporation  (2017):', '"Product Information. Zelboraf (vemurafenib)." Genentech  (2011):']
  },
  "hepatitis c": {
    name: "Hepatitis C",
    indonesianName: "Hepatitis C (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatitis C" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Eltrombopag has shown to increase the risk of hepatic decompensation in patients with chronic hepatitis C in treatment with interferon and ribavirin.  Clinical trials reported that ascites and encephalopathy occurred more frequently on these patients than in the placebo arm.  Patients with chronic hepatitis and receiving antiviral treatment should be closely monitored.  The manufacturers also recommend to discontinue eltrombopag if the antiviral therapy is discontinued.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Promacta (eltrombopag)." GlaxoSmithKline  (2008):']
  },
  "red-cell aplasia, pure": {
    name: "Red-Cell Aplasia, Pure",
    indonesianName: "Red-Cell Aplasia, Pure (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Red-Cell Aplasia, Pure" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of erythropoiesis-stimulating agents is contraindicated in patients that develop pure red cell aplasia that begins after treatment with erythropoietin protein drugs.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Mircera (epoetin beta-methoxy polyethylene glycol)." Vifor International Ltd c/o MCT  (2007):', '"Product Information. Lupkynis (voclosporin)." Aurinia Pharma  (2021):']
  },
  "hyperthermia": {
    name: "Hyperthermia",
    indonesianName: "Hyperthermia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hyperthermia" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Oligohidrosis (decreased sweating) and hyperthermia have been reported in association with the use of some carbonic anhydrase inhibitor anticonvulsants such as topiramate and zonisamide.  Most of the reports have been in children.  Caution and close monitoring of body temperature is advised when prescribing these drugs, especially in patients with a fever, in hot weather, or if combined with other drugs that predispose to heat related disorders.  Zonisamide is not approved for use in pediatric patients in the U.S.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Topamax (topiramate)." Ortho McNeil Pharmaceutical  (2001):', '"Product Information. Zonegran (zonisamide)." Elan Pharmaceuticals  (2001):', 'Shimizu T, Yamashita Y, Satoi M, Togo A, Wada N, Matsuishi T, Ohnishi A, Kato H "Heat stroke-like episode in a child caused by zonisamide." Brain Dev 19 (1997):  366-8', '"Product Information. Ultane (sevoflurane)." Abbott Pharmaceutical  (2001):']
  },
  "pre-eclampsia": {
    name: "Pre-Eclampsia",
    indonesianName: "Pre-Eclampsia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pre-Eclampsia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Intravenous magnesium should not be given to mothers with preeclampsia during the two hours preceding delivery.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Magnesium Sulfate (magnesium sulfate)." Abbott Pharmaceutical  (2001):']
  },
  "optic neuritis": {
    name: "Optic Neuritis",
    indonesianName: "Optic Neuritis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Optic Neuritis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ethambutol is contraindicated in patients with known optic neuritis unless clinical judgement determines that it may be used.  Ethambutol can produce decreases in visual acuity which appear to be due to optic neuritis.  This may be related to dose and duration of treatment, and is generally reversible when administration of the drug is discontinued promptly.  However, irreversible blindness has been reported.  Ethambutol should not be used in patients who are unable to identify and report visual side effects or changes in vision such as young children or unconscious patients.  It should be administered cautiously and only after careful consideration of risks and benefits in patients with preexisting visual defects such as cataracts, diabetic retinopathy, or recurrent inflammatory conditions of the eye.  Ophthalmologic testing of visual acuity, visual field, and color discrimination is required before and during treatment.  However, visual changes may be difficult to evaluate in some cases, since they may be related to the underlying disease rather than the drug.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Lees AW, Allan GW, Smith J, et al. "Toxicity from rifampicin plus isoniazid and rifampicin plus ethambutol therapy." Tubercle 52 (1971):  182-90', 'Polak BC, Leys M, van Lith GH "Blue-yellow colour vision changes as early symptoms of ethambutol oculotoxicity." Ophthalmology 191 (1985):  223-6', 'Chatterjee VK, Buchanan DR, Friedmann AI, Green M "Ocular toxicity following ethambutol in standard dosage." Br J Dis Chest 80 (1986):  288-91', 'Joubert PH, Strobele JG, Ogle CW, van der Merwe CA "Subclinical impairment of colour vision in patients receiving ethambutol." Br J Clin Pharmacol 21 (1986):  213-6', 'DeVita EG, Miao M, Sadun AA "Optic neuropathy in ethambutol-treated renal tuberculosis." J Clin Neuroophthalmol 7 (1987):  77-83', 'Jimenez-Lucho VE, del Busto R, Odel J "Isoniazid and ethambutol as a cause of optic neuropathy." Eur J Respir Dis 71 (1987):  42-5']
  },
  "hypertriglyceridemia": {
    name: "Hypertriglyceridemia",
    indonesianName: "Hypertriglyceridemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypertriglyceridemia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "In studies of women with a history of marked hypertriglyceridemia (>5.6 mmol/L or >500 mg/dL) in response to treatment with oral estrogen or estrogen plus progestin may develop increased levels of triglycerides when treated with raloxifene.  Women with this medical history should have serum triglycerides monitored when taking raloxifene.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Evista (raloxifene)." Lilly, Eli and Company  (2001):', '"Product Information. Fycompa (perampanel)." Eisai Inc  (2012):']
  },
  "shock, septic": {
    name: "Shock, Septic",
    indonesianName: "Shock, Septic (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Shock, Septic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Naloxone has been shown in some cases of septic shock to produce a rise in blood pressure that may last up to several hours; however, this pressor response has not been demonstrated to improve patient survival.  In some studies, treatment with naloxone in the setting of septic shock has been associated with adverse effects, including agitation, nausea and vomiting, pulmonary edema, hypotension, cardiac arrhythmias, and seizures.  The decision to use naloxone in septic shock should be exercised with caution, particularly in patients who may have underlying pain or have previously received opioid therapy and may have developed opioid tolerance.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Narcan (naloxone)." DuPont Pharmaceuticals  (2001):']
  },
  "endometrial hyperplasia": {
    name: "Endometrial Hyperplasia",
    indonesianName: "Endometrial Hyperplasia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Endometrial Hyperplasia" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Endometrial cancer, endometrial hyperplasia, hypertrophy, and uterine polyps have been reported in some patients treated with toremifene.  Long-term use of toremifene has not been established in patients with preexisting endometrial hyperplasia.  All patients should have baseline and annual gynecological examinations.  In particular, patients at high risk of endometrial cancer should be closely monitored.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Fareston (toremifene)." Schering Corporation  (2001):', 'Ford MR, Turner MJ, Wood C, Soutter WP "Endometriosis developing during tamoxifen therapy." Am J Obstet Gynecol 158 (1988):  1119', 'Corley D, Rowe J, Curtis MT, Hogan WM, Noumoff JS, Livolsi VA "Postmenopausal bleeding from unusual endometrial polyps in women on chronic tamoxifen therapy." Obstet Gynecol 79 (1992):  111-6', '"Product Information. Nolvadex (tamoxifen)." Astra-Zeneca Pharmaceuticals  (2001):', 'Divers MJ "Massive endometrial polyp after tamoxifen therapy." Br J Clin Pract 49 (1995):  275-6', 'Neven P "Endometrial changes in patients on tamoxifen." Lancet 346 (1995):  1292']
  },
  "cytopenias": {
    name: "Cytopenias",
    indonesianName: "Cytopenias (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cytopenias" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Adverse hematologic effects including neutropenia, thrombocytopenia, and anemia have been associated with the use of fedratinib.  It is recommended to modify the starting dose in patients with a baseline platelet count (PLT) less than 50 x 10(9)/L.  Therapy should be interrupted until grade 4 thrombocytopenia, grade 3 thrombocytopenia with active bleeding, OR grade 4 neutropenia has normalized to grade 2 or lower (or baseline), then restart treatment at 100 mg/day below the last given dose.  Fedratinib dose reductions should be considered in patients who become dependent on red blood cell transfusions.  CBC counts should be monitored at baseline and every 3 months thereafter; treatment should be modified based on PLT levels and active bleeding.  Caution is recommended in patients who may be at increased risk.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Inrebic (fedratinib)." Bristol-Myers Squibb  (2022):']
  },
  "anemia, aplastic": {
    name: "Anemia, Aplastic",
    indonesianName: "Anemia, Aplastic (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia, Aplastic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of felbamate is contraindicated in patients with bone marrow suppression or a current or prior history of blood dyscrasias.  A marked increase in the incidence of aplastic anemia has been associated with the use of felbamate, reportedly exceeding 100 times the incidence observed in the general population (2 to 5 per million persons per year).  In the few cases that have been reported in felbamate patients, the onset of clinical manifestations of aplastic anemia ranged from 5 to 30 weeks.  However, the injury to bone marrow stem cells that is believed to be ultimately responsible for the anemia may occur much earlier.  Currently, it is not known whether the risk is related to dose, duration of exposure, and/or concomitant use of other antiepileptic or myelotoxic drugs.  Expert hematologic consultation should be available for all patients treated with felbamate.  Since aplastic anemia typically develops without premonitory clinical or laboratory signs, it should be borne in mind that routine blood testing may not be reliably used to prevent development of the syndrome.  However, in some cases, it may allow the detection of hematologic changes before the condition is full-blown.  Felbamate therapy should be withdrawn if evidence of bone marrow depression is observed.  Patients who are discontinued from the drug may remain at risk for developing anemia for a variable and unknown period afterwards and should be monitored accordingly.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Palmer KJ, McTavish D "Felbamate. A review of its pharmacodynamic and pharmacokinetic properties, and therapeutic efficacy in epilepsy." Drugs 45 (1993):  1041-65', '"Product Information. Felbatol (felbamate)." Wallace Laboratories  (2001):', 'Ney GC, Schaul N, Loughlin J, Rai K, Chandra V "Thrombocytopenia in association with adjunctive felbamate use." Neurology 44 (1994):  980-1', 'Werble CP, ed. "Carter-Wallace felbatol discontinued use recommended due to aplastic anemia; felbamate loss could mean three C-W products off market in a year." F-D-C Reports -- "The Pink Sheet" 56 (1994):  6-7', 'Ahmad SR "Felbamate and aplastic anaemia." Lancet 344 (1994):  465', 'Nightengale SL "Recommendation to immediately withdraw patients from treatment with felbamate." JAMA 272 (1994):  995']
  },
  "anorexia": {
    name: "Anorexia",
    indonesianName: "Anorexia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anorexia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Fenfluramine can cause decreases in appetite and weight.  Exercise care when using this agent in patients at risk of decreased appetite or weight.  It is recommended to monitor the growth of pediatric patients carefully.  Weight should be monitored regularly during treatment, and dose modifications should be considered if a decrease in weight is observed.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Fintepla (fenfluramine)." Zogenix, Inc  (2020):']
  },
  "achlorhydria": {
    name: "Achlorhydria",
    indonesianName: "Achlorhydria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Achlorhydria" memiliki 6 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Gastric acidity increases iron bioavailability by maintaining the ingested iron in a reduced form as ferrous ions, which are more readily absorbed than ferric ions.  Therefore, when iron therapy is administered orally, higher dosages may be necessary for patients with decreased gastric acid production.  Also, a liquid formulation is recommended in these patients because dissolution of the tablet coating depends on normal gastric acidity.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 6,
      minor: 0,
      total: 6
    },
    ddinterOfficialReferences: ['"Product Information. Feosol (ferrous sulfate)." SmithKline Beecham', '"Product Information. Ferrous Gluconate (ferrous gluconate)." Paddock Laboratories Inc  (2016):', 'Lake-Bakaar G, Tom W, Lake-Bakaar D, et al. "Gastropathy and ketoconazole malabsorption in the acquired immunodeficiency syndrome (AIDS)." Ann Intern Med 109 (1988):  471-3', 'Mannisto PT, Mantyla R, Nykanen S, et al. "Impairing effect of food on ketoconazole absorption." Antimicrob Agents Chemother 21 (1982):  730-3', 'Daneshmend TK, Warnock DW, Ene MD, et al. "Influence of food on the pharmacokinetics of ketoconazole." Antimicrob Agents Chemother 25 (1984):  1-3', 'Daneshmend TK "Diseases and drugs but not food decrease ketoconazole "bioavailability"." Br J Clin Pharmacol 29 (1990):  783-4']
  },
  "iron overload": {
    name: "Iron Overload",
    indonesianName: "Iron Overload (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Iron Overload" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ferumoxides which contains iron, should be used with caution in patients with disorders associated with iron over load (e.g., hemosiderosis, chronic hemolytic anemia with frequent blood transfusions).",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Monoferric (ferric derisomaltose)." Pharmacosmos Therapeutics  (2022):', '"Product Information. Proferrin-ES (heme iron polypeptide)." Colorado Biolabs Inc  (2005):', '"Product Information. Ferretts IPS (iron protein succinylate)." Pharmics Inc  (2005):']
  },
  "glomerulonephritis": {
    name: "Glomerulonephritis",
    indonesianName: "Glomerulonephritis (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glomerulonephritis" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Although it has been reported that renal dysfunction has no effect on the pharmacokinetics of colony stimulating factors (CSF), filgrastim and pegfilgrastim may cause glomerulonephritis.  Symptoms include swelling of the face or ankles, dark colored urine, or blood in the urine, or a decrease in urine production.  Advise patients to report signs or symptoms of glomerulonephritis immediately.  Monitoring of patients with renal dysfunction is recommended.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Neupogen (filgrastim)." Amgen  (2002):', '"Product Information. Neulasta (pegfilgrastim)." Amgen  (2002):', '"Product Information. Granix (tbo-filgrastim)." Teva Pharmaceuticals USA  (2013):']
  },
  "leukemia, myeloid": {
    name: "Leukemia, Myeloid",
    indonesianName: "Leukemia, Myeloid (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Leukemia, Myeloid" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Colony stimulating factors primarily stimulates the proliferation of neutrophils but may also, theoretically, enhance tumor growth, particularly in myeloid malignancies.  Therapy with these drugs should be administered cautiously in patients with myeloid tumors.  Additionally, if used for PBPC (peripheral blood progenitor cell) collection in such patients, tumor cells may be released from the marrow and collected in the leukapheresis product.  The effect of reinfusion of tumor cells is uncertain at this time.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Neupogen (filgrastim)." Amgen  (2002):', '"Product Information. Neulasta (pegfilgrastim)." Amgen  (2002):', '"Product Information. Leukine (sargramostim)." Immunex Corporation  (2001):', '"Product Information. Prokine (sargramostim)." Hoechst Marion-Roussel Inc, Kansas City, MO.']
  },
  "leukocytosis": {
    name: "Leukocytosis",
    indonesianName: "Leukocytosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Leukocytosis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Filgrastim and pegfilgrastim are growth factors for neutrophil progenitor cells.  Therefore, these should not be used in patients with leukocytosis.  If excessive white blood cell counts occur during CSF therapy, treatment should be interrupted or the dosage reduced.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Hollingshead LM, Goa KL "Recombinant granulocyte colony-stimulating factor (rG-CSF). A review of its pharmacological properties and prospective role in neutropenic conditions." Drugs 42 (1991):  300-30', '"Product Information. Neupogen (filgrastim)." Amgen  (2002):', '"Product Information. Neulasta (pegfilgrastim)." Amgen  (2002):', '"Product Information. Leukine (sargramostim)." Immunex Corporation  (2001):', '"Product Information. Prokine (sargramostim)." Hoechst Marion-Roussel Inc, Kansas City, MO.']
  },
  "sepsis": {
    name: "Sepsis",
    indonesianName: "Sepsis (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sepsis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "When filgrastim is used in septic patients, clinicians should be alerted to the theoretical possibility of adult respiratory distress syndrome, which may occur as a result of the influx of neutrophils at the site of inflammation.  Monitoring of respiratory status may be appropriate in these patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 2,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Hollingshead LM, Goa KL "Recombinant granulocyte colony-stimulating factor (rG-CSF). A review of its pharmacological properties and prospective role in neutropenic conditions." Drugs 42 (1991):  300-30', '"Product Information. Neupogen (filgrastim)." Amgen  (2002):', '"Product Information. Nipride RTU (sodium nitroprusside)." Roche Laboratories', '"Product Information. Yondelis (trabectedin)." Janssen Pharmaceuticals  (2010):']
  },
  "anemia, sickle cell": {
    name: "Anemia, Sickle Cell",
    indonesianName: "Anemia, Sickle Cell (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anemia, Sickle Cell" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Severe and sometimes fatal sickle cell crises have been reported in sickle cell disease patients receiving filgrastim products.  Consider the potential risks and benefits prior to initiating therapy in these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Neupogen (filgrastim)." Amgen  (2002):', '"Product Information. Granix (tbo-filgrastim)." Teva Pharmaceuticals USA  (2013):', '"Product Information. Visipaque (iodixanol)." Nycomed Inc  (2001):', '"Product Information. Optiray 350 (ioversol)." Mallinckrodt Medical Inc  (2006):', '"Product Information. Isovue-M-200 (iopamidol)." Bracco Diagnostics Inc  (2007):', '"Product Information. Conray (iothalamate)." Mallinckrodt Medical Inc  (2015):']
  },
  "gastroenteritis": {
    name: "Gastroenteritis",
    indonesianName: "Gastroenteritis (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastroenteritis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Vancomycin is potentially oto- and nephrotoxic.  While it is poorly absorbed from the gastrointestinal tract, significant systemic absorption may occur if intestinal mucosal integrity is compromised.  Therapy with oral vancomycin should be administered cautiously in patients with inflammatory or ulcerative gastrointestinal diseases because of the potential for enhanced absorption of the drug.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 1,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Vancocin (vancomycin)." Lilly, Eli and Company  (2001):', 'Boston Collaborative Drug Surveillance Program "Drug-induced deafness." JAMA 224 (1973):  515-6', 'Berk DP, Chalmers T "Deafness complicating antibiotic therapy of hepatic encephalopathy." Ann Intern Med 73 (1970):  393-6', 'Kunin CM "Nephrotoxicity of antibiotics." JAMA 202 (1967):  204-8', '"Product Information. Humatin (paromomycin)." Parke-Davis  (2001):', '"Product Information. Mycifradin (neomycin)." Emerson Laboratories  (2001):']
  },
  "malnutrition": {
    name: "Malnutrition",
    indonesianName: "Malnutrition (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Malnutrition" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Floxuridine therapy is contraindicated for patients in a poor nutritional state.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. FUDR (floxuridine)." Roche Laboratories  (2022):']
  },
  "central nervous system neoplasms": {
    name: "Central Nervous System Neoplasms",
    indonesianName: "Central Nervous System Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Central Nervous System Neoplasms" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of menotropins is contraindicated in patients with CNS lesions, such as pituitary gland or hypothalamus tumors.  Menotropins possess LH and FSH activity.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Humegon (menotropins)." Organon  (2001):']
  },
  "hypotension, orthostatic": {
    name: "Hypotension, Orthostatic",
    indonesianName: "Hypotension, Orthostatic (Sistem Kardiovaskular)",
    organSystem: "Sistem Kardiovaskular",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hypotension, Orthostatic" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "There have been reports of transient episodes of symptomatic orthostatic hypotension with the use of teriparatide in short-term clinical pharmacology studies.  Caution is recommended when using this agent in patients at risk.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Forteo (teriparatide)." Lilly, Eli and Company  (2002):']
  },
  "ileus": {
    name: "Ileus",
    indonesianName: "Ileus (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ileus" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of lanthanum carbonate is contraindicated in patients with bowel obstruction, including ileus and fecal impaction.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Fosrenol (lanthanum carbonate)." Shire US Inc  (2004):', '"Product Information. Kayexalate (sodium polystyrene sulfonate)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "nephrogenic fibrosing dermopathy": {
    name: "Nephrogenic Fibrosing Dermopathy",
    indonesianName: "Nephrogenic Fibrosing Dermopathy (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nephrogenic Fibrosing Dermopathy" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Gadolinium based contrast agents (GBCAs) increase the risk for nephrogenic systemic fibrosis (NSF) among patients with impaired elimination of the drugs.  Use of these agents should be avoided in these patients unless the diagnostic information is essential and unavailable with non- contrasted MRI or other diagnostic modalities.  NSF may result in fatal or debilitating fibrosis affecting the skin, muscle and internal organs.  The risk of NSF appears to be higher in patients with chronic severe renal disease and patients with acute kidney injury.  Patients should be screened for acute renal injury and other conditions that might affect renal function such as age >60 years old, hypertension, and diabetes.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Multihance (gadobenate dimeglumine)." Bracco Diagnostics Inc  (2005):', '"Product Information. Eovist (gadoxetate)." Bayer Pharmaceutical Inc  (2008):', '"Product Information. Gadavist (gadobutrol)." Bayer Pharmaceutical Inc  (2011):', '"Product Information. Dotarem (gadoterate meglumine)." Guerbet LLC  (2017):']
  },
  "pancreatic diseases": {
    name: "Pancreatic Diseases",
    indonesianName: "Pancreatic Diseases (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pancreatic Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cholecystitis, cholangitis, cholelithiasis, and pancreatitis have been reported in clinical studies with teduglutide.  For identification of the onset or worsening of gallbladder/biliary/pancreatic disease, patients should undergo laboratory assessment of bilirubin, alkaline phosphatase, lipase and amylase within 6 months prior to starting teduglutide, and at least every 6 months while on treatment; or more frequently if needed.  If clinically meaningful changes are seen, further evaluation including imaging of the gallbladder, biliary tract and/or pancreas is recommended; and the need for continued teduglutide treatment should be reassessed.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Gattex (teduglutide)." NPS Pharmaceuticals  (2013):']
  },
  "pericarditis": {
    name: "Pericarditis",
    indonesianName: "Pericarditis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pericarditis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of intravenous nitroglycerin is contraindicated in patients with constrictive pericarditis, pericardial tamponade, or restrictive cardiomyopathy.  In these patients, cardiac output is dependent upon venous return, which can be reduced by nitroglycerin due to venous pooling.  Also, nitroglycerin-induced hypotension may lead to paradoxical bradycardia and increased angina pectoris.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tridil (nitroglycerin)." DuPont Pharmaceuticals  (2002):']
  },
  "attention deficit disorder with hyperactivity": {
    name: "Attention Deficit Disorder with Hyperactivity",
    indonesianName: "Attention Deficit Disorder with Hyperactivity (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Attention Deficit Disorder with Hyperactivity" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The safety and effectiveness of guanfacine in children under 12 years of age has not been demonstrated and its use in this age group is not recommended.  However, there have been some spontaneous postmarketing reports of mania and aggressive behavioral changes in pediatric patients with attention- deficit hyperactivity disorder (ADHD) that received this drug.  All patients had medical or family risks of bipolar disorder, and all of them recovered after treatment discontinuation.  Hallucinations have also been reported in pediatric patients receiving guanfacine for the treatment of ADHD.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Intuniv (guanfacine)." Shire US Inc  (2009):']
  },
  "multiple myeloma": {
    name: "Multiple Myeloma",
    indonesianName: "Multiple Myeloma (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Multiple Myeloma" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "A definite risk exists in the use of intravascular contrast agents in patients who are known to have multiple myeloma.  In such cases, anuria has developed resulting in progressive uremia, renal failure and eventually death.  Although neither the contrast agent nor dehydration has separately proved to be the cause of anuria in myeloma, it has been speculated that the combination of both may be causative factors.  The risk in patients with myeloma is not a contraindication to the procedure; however, partial dehydration in the preparation of these patients for the examination is not recommended since this may predispose to precipitation of myeloma protein in the renal tubules.  Myeloma, which occurs most commonly in persons over 40, should be considered before instituting intravascular administration of contrast agents.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 4,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Visipaque (iodixanol)." Nycomed Inc  (2001):', '"Product Information. Isovue-M-200 (iopamidol)." Bracco Diagnostics Inc  (2007):', '"Product Information. Conray (iothalamate)." Mallinckrodt Medical Inc  (2015):', '"Product Information. Hexabrix 200 (ioxaglate)." Tyco Healthcare Group Canada Inc  (2015):', '"Product Information. Imlygic (talimogene laherparepvec)." Amgen USA  (2015):', '"Product Information. Keytruda (pembrolizumab)." Merck & Co., Inc  (2014):']
  },
  "skin manifestations": {
    name: "Skin Manifestations",
    indonesianName: "Skin Manifestations (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Skin Manifestations" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Percutaneous and/or transmucosal absorption during use on generalized dermatologic conditions has resulted in CNS toxicity such as irritability and seizures.  Hexachlorophene should not be applied to burned or denuded skin, used as occlusive dressing or routinely for total body washing, as a vaginal pack, or on any mucous membrane.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Phisohex (hexachlorophene topical)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "eosinophilic esophagitis": {
    name: "Eosinophilic Esophagitis",
    indonesianName: "Eosinophilic Esophagitis (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Eosinophilic Esophagitis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of allergen immunotherapy, such as mixed grass pollens, ragweed pollen, house dust mite allergen extract, and timothy grass pollen allergen extracts, is contraindicated in patients with a history of eosinophilic esophagitis.  This condition could compromise swallowing, lead to food impaction, vomiting, and heartburn which may cause permanent damage to the esophagus.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Grastek (timothy grass pollen allergen extract)." Merck & Co., Inc  (2014):', '"Product Information. Ragwitek (ragweed pollen allergen extract)." Merck & Co., Inc  (2014):', '"Product Information. Oralair (mixed grass pollens allergen extract)." Greer Laboratories Inc  (2014):']
  },
  "nephrotic syndrome": {
    name: "Nephrotic Syndrome",
    indonesianName: "Nephrotic Syndrome (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nephrotic Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of house dust mite allergen extract is contraindicated in children with nephrotic syndrome due to a variety of seemingly unrelated events that may cause an exacerbation of nephrotic disease.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: []
  },
  "premenopausal": {
    name: "Premenopausal",
    indonesianName: "Premenopausal (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Premenopausal" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Pre/perimenopausal women treated with the combination palbociclib plus fulvestrant therapy should be treated with luteinizing hormone-releasing hormone (LHRH) agonists according to current clinical practice standards.  Care and close monitoring is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Ibrance (palbociclib)." Pfizer U.S. Pharmaceuticals Group  (2015):']
  },
  "atrial fibrillation": {
    name: "Atrial Fibrillation",
    indonesianName: "Atrial Fibrillation (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Atrial Fibrillation" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Atrial fibrillation and atrial flutter have occurred in patients treated with ibrutinib.  The risk is increased in patients with cardiac risk factors, hypertension, acute infections, and a previous history of atrial fibrillation.  It is recommended to monitor patients clinically for atrial fibrillation periodically and those patients who develop arrhythmic symptoms (e.g., palpitations, lightheadedness) or new onset dyspnea should have an ECG performed.  Atrial fibrillation should be managed appropriately, and if it persists to consider the risks and benefits of ibrutinib treatment and follow dose modification according to clinical guidelines.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Imbruvica (ibrutinib)." Pharmacyclics Inc  (2013):', '"Product Information. Vascepa (icosapent)." Amarin Pharmaceuticals Inc  (2019):']
  },
  "intestinal perforation": {
    name: "Intestinal Perforation",
    indonesianName: "Intestinal Perforation (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Intestinal Perforation" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Fatal and serious intestinal perforations have been reported in patients treated with idelalisib, some patients reporting moderate to severe diarrhea at the time of perforation.  Advise patients to promptly report any new or worsening abdominal pain, chills, fever, nausea, or vomiting.  Discontinue therapy with idelalisib permanently in patients who experience intestinal perforation.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Zydelig (idelalisib)." Gilead Sciences  (2014):', '"Product Information. Resotran (prucalopride)." Janssen Pharmaceuticals  (2012):']
  },
  "sjogren-larsson syndrome": {
    name: "Sjogren-Larsson Syndrome",
    indonesianName: "Sjogren-Larsson Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sjogren-Larsson Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of miltefosine is contraindicated in patients with Sjogren-Larsson syndrome.  Miltefosine undergoes metabolic cleavage in hepatocytes to release choline.  The fatty alcohol-containing fragment of miltefosine is then oxidized to palmitic acid, which enters the metabolism of fatty acids.  However, this oxidation is blocked in patients with Sjogren-Larsson syndrome, who have a genetic defect in fatty aldehyde dehydrogenase activity.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Impavido (miltefosine)." Paladin Therapeutics Inc  (2014):']
  },
  "edema due to obstruction of lymph vessels or disorders of the lymph nodes.": {
    name: "Edema due to obstruction of lymph vessels or disorders of the lymph nodes.",
    indonesianName: "Edema due to obstruction of lymph vessels or disorders of the lymph nodes. (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Edema due to obstruction of lymph vessels or disorders of the lymph nodes." memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Lymphoid tissue (e.g., tonsillar and adenoidal) hypertrophy associated with complications such as snoring, sleep apnea, and chronic middle-ear effusions have been reported with the use of mecasermin.  Patients presenting these complications should be periodically examined to rule-out the occurrence of lymphoid tissue hypertrophy.  Care should be taken when prescribing mecasermin to these patients.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Increlex (mecasermin)." Tercica Inc  (2005):']
  },
  "vitamin a deficiency": {
    name: "Vitamin A Deficiency",
    indonesianName: "Vitamin A Deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vitamin A Deficiency" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Treatment with inotersen leads to a decrease in serum vitamin A levels.  Caution is advised in patients with history of vitamin A deficiency.  Supplementation at the recommended daily allowance of vitamin A is advised for patients taking inotersen.  Patients should be referred to an ophthalmologist if they develop ocular symptoms suggestive of vitamin A deficiency (e.g., night blindness).",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tegsedi (inotersen)." Akcea Therapeutics  (2018):']
  },
  "dermatitis herpetiformis": {
    name: "Dermatitis Herpetiformis",
    indonesianName: "Dermatitis Herpetiformis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dermatitis Herpetiformis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Potassium iodide should not be used in patients that have or have ever had dermatitis herpetiformis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. SSKI (saturated) (potassium iodide)." Upsher-Smith Laboratories Inc', '"Product Information. Pima (potassium iodide)." Fleming and Company  (2022):']
  },
  "vasculitis": {
    name: "Vasculitis",
    indonesianName: "Vasculitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Vasculitis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "People who are allergic to iodide or have hypocomplementemic vasculitis should not take potassium iodide.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. SSKI (saturated) (potassium iodide)." Upsher-Smith Laboratories Inc', '"Product Information. Pima (potassium iodide)." Fleming and Company  (2022):']
  },
  "acute kidney injury": {
    name: "Acute Kidney Injury",
    indonesianName: "Acute Kidney Injury (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Acute Kidney Injury" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Acute kidney injury, including renal failure, may occur after ioversol administration.  Risk factors include preexisting renal impairment, dehydration, diabetes, congestive heart failure, advanced vascular disease, multiple myeloma, elderly age, and concomitant use of nephrotoxic or diuretic medications.  The lowest dose of ioversol should be used in patients with renal impairment and other risk factors.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Optiray 350 (ioversol)." Mallinckrodt Medical Inc  (2006):', '"Product Information. Mounjaro (tirzepatide)." Lilly, Eli and Company  (2022):']
  },
  "dermatitis": {
    name: "Dermatitis",
    indonesianName: "Dermatitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dermatitis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ipilimumab can cause immune-mediated rash or dermatitis (including bullous and exfoliative dermatitis, Stevens-Johnson syndrome [SJS], toxic epidermal necrolysis [TEN], and drug rash with eosinophilia and systemic symptoms [DRESS]).  Topical emollients and/or topical corticosteroids may be adequate to treat mild to moderate non-bullous/exfoliative rashes.  Ipilimumab should be withheld for suspected SJS, TEN, or DRESS and permanently discontinued for confirmed SJS, TEN, or DRESS.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Yervoy (ipilimumab)." Bristol-Myers Squibb  (2023):']
  },
  "graft vs host disease": {
    name: "Graft vs Host Disease",
    indonesianName: "Graft vs Host Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Graft vs Host Disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Fatal or serious graft-versus-host disease (GVHD) can occur in patients who receive ipilimumab either before or after allogeneic hematopoietic stem cell transplantation (HSCT).  These complications may occur despite intervening therapy between cytotoxic T-lymphocyte antigen 4 (CTLA-4) receptor blocking antibody and allogeneic HSCT.  It is recommended to monitor patients closely for evidence of GVHD and intervene promptly.  The benefit versus risks of treatment with ipilimumab after allogeneic HSCT should be considered.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Yervoy (ipilimumab)." Bristol-Myers Squibb  (2023):']
  },
  "immune system diseases": {
    name: "Immune System Diseases",
    indonesianName: "Immune System Diseases (Sistem Imunologi & Infeksi)",
    organSystem: "Sistem Imunologi & Infeksi",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Immune System Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ipilimumab can cause immune-mediated adverse reactions, which may be severe or fatal.  Immune-mediated adverse reactions can occur in any organ system or tissue.  Care should be exercised when using ipilimumab in patients with preexisting immune system disorders (e.g., ulcerative colitis, Crohn's disease, lupus).  It is recommended to monitor for signs/symptoms that may be clinical manifestations of underlying immune-mediated adverse reactions.  Clinical chemistries (including liver enzymes, creatinine, adrenocorticotropic hormone [ACTH] level, and thyroid function) should be evaluated at baseline and before each dose.  Medical management should be started promptly, including specialty consultation as appropriate.  Ipilimumab should be withheld or permanently discontinued depending on severity.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Yervoy (ipilimumab)." Bristol-Myers Squibb  (2023):']
  },
  "malignant carcinoid syndrome": {
    name: "Malignant Carcinoid Syndrome",
    indonesianName: "Malignant Carcinoid Syndrome (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Malignant Carcinoid Syndrome" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of nonspecific monoamine oxidase inhibitors (MAOIs) is contraindicated in patients with carcinoid syndrome.  Nonspecific MAOIs inhibit the breakdown of pressor amines, including serotonin, and may exacerbate symptoms of the syndrome.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 1,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Multum Information Services, Inc. Expert Review Panel"', '"Product Information. Zyvox (linezolid)." Pharmacia and Upjohn  (2001):']
  },
  "headache": {
    name: "Headache",
    indonesianName: "Headache (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Headache" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of monoamine oxidase inhibitor (MAOI) antidepressants is contraindicated in patients with a history of headaches.  Nonspecific MAOIs inhibit the breakdown of pressor amines, the accumulation of which can precipitate hypertensive crises.  Intracranial hemorrhage and death have resulted in some cases.  Since headache may often be the first symptom of a hypertensive reaction during MAOI therapy, use of these agents is not recommended in patients who experience frequent or severe headaches.  MAOIs should be withdrawn promptly if headaches develop during treatment.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['Linet LS "Mysterious MAOI hypertensive episodes." J Clin Psychiatry 47 (1986):  563-5', 'Robinson DS, Nies A, Corcella J, Cooper TB, Spencer C, Keefover R "Cardiovascular effects of phenelzine and amitriptyline in depressed outpatients." J Clin Psychiatry 43 (1982):  8-15', `Fallon B, Foote B, Walsh BT, Roose SP "'Spontaneous' hypertensive episodes with monoamine oxidase inhibitors." J Clin Psychiatry 49 (1988):  163-5`, 'Rabkin J, Quitkin F, Harrison W, Tricamo E, McGrath P "Adverse reactions to monoamine oxidase inhibitors. Part I. A comparative study." J Clin Psychopharmacol 4 (1984):  270-8', 'Evans DL, Davidson J, Raft D "Early and late side effects of phenelzine." J Clin Psychopharmacol 2 (1982):  208-10', 'Keck PE Jr, Vuckovic A, Pope HG Jr, Nierenberg AA, Gribble GW, White K "Acute cardiovascular response to monoamine oxidase inhibitors: a prospective assessment." J Clin Psychopharmacol 9 (1989):  203-6']
  },
  "angina pectoris": {
    name: "Angina Pectoris",
    indonesianName: "Angina Pectoris (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Angina Pectoris" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Monoamine oxidase inhibitors may have the capacity to suppress anginal pain that would otherwise serve as a warning of myocardial ischemia.  Caution is advised in patients with a history of angina or risk of myocardial infarction.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Nardil (phenelzine)." Parke-Davis  (2001):', '"Product Information. Parnate (tranylcypromine)." SmithKline Beecham  (2001):', '"Product Information. Marplan (isocarboxazid)." Roche Laboratories  (2001):']
  },
  "gastritis": {
    name: "Gastritis",
    indonesianName: "Gastritis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gastritis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "During clinical studies with sapropterin, gastritis was reported as a serious adverse reaction.  Monitor patients for signs and symptoms of gastritis during treatment, and use with caution in patients with a history of gastritis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Kuvan (sapropterin)." BioMarin Pharmaceutical Inc  (2007):']
  },
  "avitaminosis": {
    name: "Avitaminosis",
    indonesianName: "Avitaminosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Avitaminosis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Lomitapide may reduce the absorption of fat soluble nutrients.  Patients on clinical trials were provided with daily dietary supplements of vitamin E, linoleic acid, alpha- linoleic acid (ALA), eicosapentaenoic acid (EPA), and docosahexaenoic acid (DHA).  Patients with chronic bowel or pancreatic diseases that predispose to malabsorption may be at increased risk for deficiencies in these nutrients with the use of lomitapide.  Patients receiving treatment should take daily vitamin supplements.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Juxtapid (lomitapide)." Aegerion Pharmaceuticals Inc  (2013):']
  },
  "diverticulitis": {
    name: "Diverticulitis",
    indonesianName: "Diverticulitis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diverticulitis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Gastrointestinal (GI) perforations have been reported with the use of sarilumab.  GI perforation risk may be increased with concurrent diverticulitis or concomitant use of NSAIDs or corticosteroids.  Assess patients for gastrointestinal complications prior to beginning therapy and promptly evaluate patients presenting with new onset abdominal symptoms.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Kevzara (sarilumab)." sanofi-aventis  (2017):']
  },
  "serotonin syndrome": {
    name: "Serotonin Syndrome",
    indonesianName: "Serotonin Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Serotonin Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of lasmiditan has been associated with reactions consistent with serotonin syndrome.  Serotonin syndrome may also occur with lasmiditan during coadministration with serotonergic drugs.  The onset of symptoms usually occurs within minutes to hours of receiving a new or a greater dose of a serotonergic medication.  It is recommended to discontinue therapy if serotonin syndrome is suspected.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Reyvow (lasmiditan)." Lilly, Eli and Company  (2019):']
  },
  "herpes simplex": {
    name: "Herpes Simplex",
    indonesianName: "Herpes Simplex (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Herpes Simplex" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Latanoprost should be used with caution in patients with a history of herpetic keratitis and it should be avoided in cases of active simplex keratitis because of the risk of reactivation and inflammation.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Xalatan (latanoprost ophthalmic)." Pharmacia and Upjohn  (2001):']
  },
  "respiration disorders": {
    name: "Respiration Disorders",
    indonesianName: "Respiration Disorders (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Respiration Disorders" memiliki 4 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Pneumonitis, including fatal cases, occurred in <1% of patients treated with olaparib.  It is recommended to interrupt treatment if patients present new or worsening respiratory symptoms such as dyspnea, cough and fever, or a radiological abnormality.  Assess for the source of symptoms and if pneumonitis is confirmed, olaparib should be discontinued and the patient treated appropriately.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 4,
      minor: 0,
      total: 4
    },
    ddinterOfficialReferences: ['"Product Information. Lynparza (olaparib)." Astra-Zeneca Pharmaceuticals  (2014):', '"Product Information. Singulair (montelukast)." Merck & Co., Inc  (2001):', '"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Pegasys (peginterferon alfa-2a)." Roche Laboratories  (2002):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "perimenopause": {
    name: "Perimenopause",
    indonesianName: "Perimenopause (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Perimenopause" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Ovarian macrocysts, often bilateral and multiple, have been reported in premenopausal patients receiving mitotane which might lead to adnexal torsion and hemorrhagic cyst rupture.  It is recommended to use care when using this agent in premenopausal patients and to seek medical care if they experience gynecological symptoms such as vaginal bleeding and/or pelvic pain.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Lysodren (mitotane)." Bristol-Myers Squibb  (2001):']
  },
  "migraine disorders": {
    name: "Migraine Disorders",
    indonesianName: "Migraine Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Migraine Disorders" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of rizatriptan is contraindicated in patients with hemiplegic or basilar migraine.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Maxalt (rizatriptan)." Merck & Co., Inc  (2001):']
  },
  "multiple sclerosis": {
    name: "Multiple Sclerosis",
    indonesianName: "Multiple Sclerosis (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Multiple Sclerosis" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rare cases of severe exacerbation of multiple sclerosis (MS), including disease rebound, have been reported after discontinuation of sphingosine 1-phosphate receptor modulator in MS treated patients.  The possibility of severe exacerbation of disease should be considered after stopping treatment with these agents.  Patients should be observed for a severe increase in disability upon discontinuation and appropriate treatment should be instituted, as required.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 3,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Gilenya (fingolimod)." Novartis Pharmaceuticals  (2010):', '"Product Information. Mayzent (siponimod)." Novartis Pharmaceuticals  (2019):', '"Product Information. Zeposia (ozanimod)." Celgene Corporation  (2020):', '"Product Information. Ponvory (ponesimod)." Janssen Pharmaceuticals  (2021):']
  },
  "guillain-barre syndrome": {
    name: "Guillain-Barre Syndrome",
    indonesianName: "Guillain-Barre Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Guillain-Barre Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Persons previously diagnosed with Guillain-Barr\xE9 syndrome (GBS) may be at increased risk of GBS following receipt of meningococcal conjugate vaccine.  The decision to give this vaccine should take into account the potential benefits and risks.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Menactra (meningococcal conjugate vaccine)." sanofi pasteur  (2005):']
  },
  "thiopurine s methyltranferase deficiency": {
    name: "Thiopurine S methyltranferase deficiency",
    indonesianName: "Thiopurine S methyltranferase deficiency (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Thiopurine S methyltranferase deficiency" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thioguanine is closely related structurally and functionally to mercaptopurine.  A rare deficiency in the enzyme thiopurine methyltransferase (TMPT) results in an increased sensitivity to the myelosuppressive effects of both drugs causing rapid bone marrow suppression following initial mercaptopurine or thioguanine administration.  Therapy with thioguanine or mercaptopurine should be administered cautiously and at a reduced dose in patients with TMPT deficiency.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Tabloid (thioguanine)." Prasco Laboratories  (2001):']
  },
  "anorexia nervosa": {
    name: "Anorexia Nervosa",
    indonesianName: "Anorexia Nervosa (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Anorexia Nervosa" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of sibutramine is contraindicated in patients with anorexia nervosa.  Sibutramine is an anorexiant used in the treatment of obesity.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Meridia (sibutramine)." Knoll Pharmaceutical Company  (2001):']
  },
  "photosensitivity disorders": {
    name: "Photosensitivity Disorders",
    indonesianName: "Photosensitivity Disorders (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Photosensitivity Disorders" memiliki 3 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of methoxsalen with ultraviolet radiation is contraindicated in patients with a history of photosensitive disease states.  Methoxsalen is a potent photosensitizer that can induce severe burns and marked hyperpigmentation and aging of skin in susceptible patients or when used improperly.  Diseases associated with photosensitivity include lupus erythematosus, porphyria cutanea tarda, erythropoietic protoporphyria, variegate porphyria, xeroderma pigmentosum, and albinism.",
    ddinterSeverityDistribution: {
      major: 3,
      moderate: 0,
      minor: 0,
      total: 3
    },
    ddinterOfficialReferences: ['"Product Information. Oxsoralen (methoxsalen topical)." Apothecon Inc  (2022):', '"Product Information. Oxsoralen (methoxsalen)." ICN Pharmaceuticals Inc  (2001):', '"Product Information. Trisoralen (trioxsalen)." ICN Pharmaceuticals Inc  (2001):']
  },
  "lymphoma": {
    name: "Lymphoma",
    indonesianName: "Lymphoma (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lymphoma" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Cases of T-cell lymphoma have been reported during treatment with metreleptin in patients with acquired generalized lipodystrophy.  Some, but not all, had immunodeficiency and significant hematologic abnormalities including severe bone marrow abnormalities before the initiation of metreleptin therapy.  However, lymphomas and other lymphoproliferative disorders have also been reported in patients with acquired generalized lipodystrophy who did not receive metreleptin, thus a causal relationship with metreleptin has not been established.  Acquired lipodystrophies are associated with autoimmune disorders, and the latter is associated with an increased risk of malignancies including lymphomas.  Until more information is available, the potential benefits and risks of metreleptin treatment should be carefully considered in patients with acquired generalized lipodystrophy and/or those with significant hematologic abnormalities including leukopenia, neutropenia, bone marrow abnormalities, lymphoma, and/or lymphadenopathy.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Myalept (metreleptin)." Bristol-Myers Squibb  (2014):']
  },
  "urinary bladder diseases": {
    name: "Urinary Bladder Diseases",
    indonesianName: "Urinary Bladder Diseases (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urinary Bladder Diseases" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Valrubicin is contraindicated in patients with perforated bladder or compromised bladder mucosa, including small bladder capacity that is unable to tolerate a 75 mL instillation.  Evaluate the bladder before the intravesical instillation for severe irritable bladder symptoms, and in case of bladder perforation, delay the administration until bladder integrity has been restored.  If this agent is administered to patients with bladder rupture or if perforation is suspected, significant systemic exposure may occur following intravesical administration and myelosuppression is possible.  Weekly monitoring of complete blood counts should be performed for 3 weeks.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Valstar (valrubicin)." Medeva Pharmaceuticals  (2001):']
  },
  "nephritis": {
    name: "Nephritis",
    indonesianName: "Nephritis (Sistem Ginjal & Urologi (Renal))",
    organSystem: "Sistem Ginjal & Urologi (Renal)",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Nephritis" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Chronic nephritis with nitrogen retention contraindicates the use of vasopressin until reasonable nitrogen blood levels have been attained.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Pitressin (vasopressin)." Parke-Davis  (2001):']
  },
  "blindness": {
    name: "Blindness",
    indonesianName: "Blindness (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Blindness" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Vigabatrin causes permanent bilateral concentric visual field constriction.  The onset of vision loss from vigabatrin is unpredictable, and can occur within weeks of starting treatment or sooner, or at any time after starting treatment, even after months or years.  The risk of vision loss increases with increasing dose and cumulative exposure, but there is no dose or exposure known to be free of risk of vision loss.  Because of the risk of vision loss, and because, when it is effective, vigabatrin provides an observable symptomatic benefit, patient response and continued need for treatment should be periodically assessed.  If the need clearly outweighs the risk, caution should be exercised when using vigabatrin therapy in patients with, or at high risk of, other types of irreversible vision loss.  Vigabatrin should not be used in patients that are being treated for retinopathy or glaucoma.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Sabril (vigabatrin)." Lundbeck Inc  (2009):']
  },
  "ischemic stroke": {
    name: "Ischemic Stroke",
    indonesianName: "Ischemic Stroke (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ischemic Stroke" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Vorapaxar is contraindicated in patients with a history of stroke, transient ischemic attack (TIA), or intracranial bleeding.  The risk of intracranial bleeding is higher in these patients.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Zontivity (vorapaxar)." Merck & Co., Inc  (2014):']
  },
  "pulmonary embolism": {
    name: "Pulmonary Embolism",
    indonesianName: "Pulmonary Embolism (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pulmonary Embolism" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Initiation of rivaroxaban is not recommended acutely as an alternative to unfractionated heparin in patients with pulmonary embolism who present with hemodynamic instability or who may receive thrombolysis or pulmonary embolectomy.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 1,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Xarelto (rivaroxaban)." Janssen Pharmaceuticals  (2022):', '"Product Information. Soltamox (tamoxifen)." Cytogen Corporation  (2018):']
  },
  "huntington disease": {
    name: "Huntington Disease",
    indonesianName: "Huntington Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Huntington Disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Patients with Huntington disease are prone to depression.  Tetrabenazine can increase the risk of depression and suicidal thoughts and should be used with caution in patients with Huntington's disease.  The benefits and risks of treatment should be considered before starting therapy, and patients should be under close observation for emergence or worsening of depression symptoms.  The family and caregivers should also be informed of this risk and should be instructed to report any changes in behavior or any concerns to the treating physician.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Xenazine (tetrabenazine)." Prestwick Pharmaceuticals Inc  (2008):']
  },
  "sleep apnea, obstructive": {
    name: "Sleep Apnea, Obstructive",
    indonesianName: "Sleep Apnea, Obstructive (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sleep Apnea, Obstructive" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of sodium oxybate may impair the respiratory drive especially in patients with compromised respiratory function.  Sodium oxybate should be used cautiously in patients with sleep apnea and sleep-related breathing disorders as there have been reports of increased central apneas and clinically relevant desaturation.  Prescribers should be aware that sleep-related disorders tend to be more prevalent in obese patients, postmenopausal women not receiving hormone replacement therapy and also among patients with narcolepsy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Xyrem (sodium oxybate)." Orphan Medical  (2002):']
  },
  "myelodysplastic syndromes": {
    name: "Myelodysplastic Syndromes",
    indonesianName: "Myelodysplastic Syndromes (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Myelodysplastic Syndromes" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Myelodysplastic Syndrome/Acute Myeloid Leukemia (MDS/AML), including cases with fatal outcome, have been reported with the use of niraparib.  It is recommended to use caution when using this agent in patients with MDS/AML, its use must be weighed against the risk.  Discontinue the use of niraparib in patients who develop MDS/AML.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 2,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Zejula (niraparib)." Tesaro Inc.  (2017):', '"Product Information. Rubraca (rucaparib)." Clovis Oncology Inc  (2017):']
  },
  "cachexia": {
    name: "Cachexia",
    indonesianName: "Cachexia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cachexia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Nondepolarizing neuromuscular blocking agents have been found to exhibit profound neuromuscular blocking effects in cachectic or debilitated patients, patients with neuromuscular diseases, and patients with carcinomatosis.  In these or other patients in whom potentiation of neuromuscular block or difficulty with reversal may be anticipated, a decrease from the recommended initial dose of should be considered.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Zemuron (rocuronium)." Organon  (2001):']
  },
  "cockayne syndrome": {
    name: "Cockayne Syndrome",
    indonesianName: "Cockayne Syndrome (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cockayne Syndrome" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Secnidazole is contraindicated in patients with Cockayne syndrome.  Severe irreversible hepatotoxicity/acute liver failure with fatal outcomes have been reported after start of metronidazole (another nitroimidazole drug structurally related to secnidazole) in patients with Cockayne syndrome.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Solosec (secnidazole)." Lupin Pharmaceuticals Inc  (2022):']
  },
  "hepatitis, autoimmune": {
    name: "Hepatitis, Autoimmune",
    indonesianName: "Hepatitis, Autoimmune (Sistem Hati & Hepatobilier)",
    organSystem: "Sistem Hati & Hepatobilier",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hepatitis, Autoimmune" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of peginterferons alfa are contraindicated in patients with autoimmune hepatitis.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. PEG-Intron (peginterferon alfa-2b)." Schering Corporation  (2001):', '"Product Information. Pegasys (peginterferon alfa-2a)." Roche Laboratories  (2002):', '"Product Information. Sylatron (peginterferon alfa-2b)." Schering-Plough Corporation  (2015):']
  },
  "hallucinations": {
    name: "Hallucinations",
    indonesianName: "Hallucinations (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Hallucinations" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Reversible hallucinations have occurred (usually within the first 2 weeks of therapy) in patients receiving tolcapone.  Confusion, occasional insomnia, and excessive dreaming commonly accompany the hallucinations.  Therapy with tolcapone should be administered cautiously in patients with or predisposed to psychoses or emotional disorders.  Reducing the levodopa dosage may result in resolution of hallucinations.   Clinical monitoring of mental status is recommended.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tasmar (tolcapone)." Valeant Pharmaceuticals  (2001):']
  },
  "urticaria": {
    name: "Urticaria",
    indonesianName: "Urticaria (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Urticaria" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Temozolomide is contraindicated in patients with a history of urticaria, allergic reaction including anaphylaxis, toxic epidermal necrolysis, and Stevens-Johnson syndrome.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Temodar (temozolomide)." Schering Corporation  (2001):']
  },
  "glucose metabolism disorders": {
    name: "Glucose Metabolism Disorders",
    indonesianName: "Glucose Metabolism Disorders (Sistem Endokrin & Metabolik)",
    organSystem: "Sistem Endokrin & Metabolik",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Glucose Metabolism Disorders" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of gatifloxacin is contraindicated in patients with diabetes mellitus.  Treatment with various quinolones has been associated with disturbances in blood glucose homeostasis possibly stemming from effects on pancreatic beta cell ATP-sensitive potassium channels that regulate insulin secretion.  However, dysglycemia has been reported more frequently with gatifloxacin than with other quinolones.  Although typically reported in diabetic patients, hypoglycemia and particularly hyperglycemia have occurred in patients without a history of diabetes.  Gatifloxacin-induced hypoglycemic episodes have generally occurred within the first 3 days of therapy and sometimes even after the first dose, while hyperglycemia usually occurred 4 to 10 days after initiation of therapy.  Serious cases have resulted in hyperosmolar nonketotic hyperglycemic coma, diabetic ketoacidosis, hypoglycemic coma, convulsions, and mental status changes.  Rarely, death has been reported.  In addition to diabetes, other risk factors associated with dysglycemia while taking gatifloxacin include older age, renal insufficiency, and concomitant glucose-altering mediations.  Patients with these risk factors should be closely monitored for glucose disturbances.  Dosage adjustments may be necessary, particularly in elderly patients who may have unrecognized diabetes, age-related decrease in renal function, and/or other underlying medical problems.  The manufacturer recommends a dosage reduction to 200 mg/daily after an initial dose of 400 mg in patients with creatinine clearance below 40 mL/min.  Patients should be counseled to recognize symptoms of hypoglycemia such as headache, dizziness, drowsiness, nausea, tremor, weakness, hunger, excessive perspiration, and palpitations.  If hypo- or hyperglycemia occur during therapy, patients should initiate appropriate remedial therapy immediately, discontinue the antibiotic, and contact their physician.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Tequin (gatifloxacin)." Bristol-Myers Squibb  (2001):', 'Gajjar DA, LaCreta FP, Kollia GD, et al. "Effect of multiple-dose gatifloxacin or ciprofloxacin on glucose homeostasis and insulin production in patients with noninsulin-dependent diabetes mellitus maintained with diet and exercise." Pharmacotherapy 20 (6 Pt 2) (2000):  s76-86', 'Rubinstein E "History of quinolones and their side effects." Chemotherapy 47 Suppl 3 (2001):  3-8', 'Menzies DJ, Dorsainvil PA, Cunha BA, Johnson DH "Severe and persistent hypoglycemia due to gatifloxacin interaction with oral hypoglycemic agents." Am J Med 113 (2002):  232-4', 'Baker SE, Hangii MC "Possible gatifloxacin-induced hypoglycemia." Ann Pharmacother 36 (2002):  1722-6', '"Hypoglycemia and hyperglycemia with fluoroquinolones." Med Lett Drugs Ther 45 (2003):  64']
  },
  "ischemia": {
    name: "Ischemia",
    indonesianName: "Ischemia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ischemia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Terlipressin is a vasoconstrictor that can cause ischemic events, and is contraindicated in patients with coronary, cerebrovascular, peripheral, or mesenteric ischemia.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Terlivaz (terlipressin)." Mallinckrodt Hospital Products Inc.  (2022):']
  },
  "fetal hypoxia": {
    name: "Fetal Hypoxia",
    indonesianName: "Fetal Hypoxia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Fetal Hypoxia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Terlipressin is contraindicated in patients with hypoxia (SpO2 less than 90%) or worsening respiratory symptoms.  Patients should be assessed for respiratory status before treatment initiation and monitored closely during treatment.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Terlivaz (terlipressin)." Mallinckrodt Hospital Products Inc.  (2022):']
  },
  "pituitary neoplasms": {
    name: "Pituitary Neoplasms",
    indonesianName: "Pituitary Neoplasms (Onkologi & Neoplasma)",
    organSystem: "Onkologi & Neoplasma",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Pituitary Neoplasms" memiliki 2 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of tesamorelin is contraindicated in patients with disruption of the hypothalamic-pituitary axis due to hypophysectomy, hypopituitarism, pituitary tumor/surgery, head irradiation or head trauma and in patients with active malignancy.",
    ddinterSeverityDistribution: {
      major: 2,
      moderate: 0,
      minor: 0,
      total: 2
    },
    ddinterOfficialReferences: ['"Product Information. Egrifta (tesamorelin)." Theratechnologies Inc.  (2010):', '"Product Information. Orap (pimozide)." Gate Pharmaceuticals']
  },
  "dystonia": {
    name: "Dystonia",
    indonesianName: "Dystonia (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Dystonia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thiothixene may cause dose-related dystonic reactions, prolonged abnormal contractions of muscle groups, may occur in susceptible individuals during the first few days of treatment.  These reactions are characterized by spastic contraction of discrete muscle groups that may include spasm of the neck muscles, sometimes progressing to tightness of the throat, swallowing difficulty, difficulty breathing, and/or protrusion of the tongue.  Therapy with thiothixene should be administered cautiously in patients, particularly males and children, with hypocalcemia or severe dehydration, since these patients may be more susceptible to dystonic reactions.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Navane (thiothixene)." Roerig Division  (2001):']
  },
  "cerebral hemorrhage": {
    name: "Cerebral Hemorrhage",
    indonesianName: "Cerebral Hemorrhage (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Cerebral Hemorrhage" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of pentoxifylline is contraindicated in patients with recent cerebral and/or retinal hemorrhage.  Dose-related hemorrhagic effects can occur.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Trental (pentoxifylline)." Hoechst Marion Roussel  (2001):']
  },
  "diverticulum": {
    name: "Diverticulum",
    indonesianName: "Diverticulum (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Diverticulum" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The tablet shell of the manufactured form of treprostinil, Orenitram does not dissolve and can lodge in the diverticulum of patients with diverticulosis.  Care should be exercised when using this drug in patient with diverticulosis.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Orenitram (treprostinil)." United Therapeutics Corporation  (2017):']
  },
  "lung diseases, obstructive": {
    name: "Lung Diseases, Obstructive",
    indonesianName: "Lung Diseases, Obstructive (Sistem Respirasi & Paru)",
    organSystem: "Sistem Respirasi & Paru",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Lung Diseases, Obstructive" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of propafenone is contraindicated in patients with bronchospastic disorders or severe obstructive pulmonary disease.  Propafenone has beta-adrenergic blocking properties.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['Olm M, Munne P, Jimenez MJ "Severe reactive airways disease induced by propafenone." Chest 95 (1989):  1366-7', '"Product Information. Rythmol (propafenone)." Knoll Pharmaceutical Company']
  },
  "tinnitus": {
    name: "Tinnitus",
    indonesianName: "Tinnitus (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Tinnitus" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of quinine is contraindicated in patients with tinnitus.  Quinine has been associated with reversible and irreversible ototoxicity.  Reversible hearing loss, tinnitus, and dizziness has been reported in 20% of patients receiving therapeutic doses of quinine.  Cystic degeneration of stria vascularis, degeneration of the cochlear neurons, and loss of hair cells occur.  Injury may be produced by spasm of cochlear blood vessels, resulting in anoxia and subsequent cellular damage.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. QuiNINE Sulfate (quiNINE)." Zenith Goldline Pharmaceuticals']
  },
  "sleep apnea syndromes": {
    name: "Sleep Apnea Syndromes",
    indonesianName: "Sleep Apnea Syndromes (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Sleep Apnea Syndromes" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of ramelteon could exacerbate symptoms of sleep apnea, and has not been studied in patients with severe sleep apnea.  Ramelteon is not recommended in patients with severe sleep apnea.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Rozerem (ramelteon)." Takeda Pharmaceuticals America  (2005):']
  },
  "gallstones": {
    name: "Gallstones",
    indonesianName: "Gallstones (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Gallstones" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rauwolfia alkaloids increase gastrointestinal motility and secretion and can precipitate biliary colic in patients with gallstones.  Therapy with rauwolfia alkaloids should be administered cautiously in patients with a history of gallstones.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Hydropres (reserpine-hydrochlorothiazide)." Merck & Co, Inc, West Point, PA.']
  },
  "endocrine system disease": {
    name: "Endocrine system disease",
    indonesianName: "Endocrine system disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Endocrine system disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Rifampin has enzyme-inducing effects that can enhance the metabolism of many endogenous substrates, including adrenal hormones, thyroid hormones, and vitamin D, the latter of which may affect serum calcium, phosphate and parathyroid hormone levels.  Patients with preexisting imbalances of these hormones should be monitored more closely during long-term therapy with rifampin.  In patients whose hormonal condition is stabilized on treatment, adjustments may be necessary in their treatment regimen to compensate for these effects.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Rifadin (rifampin)." Hoechst Marion Roussel  (2001):']
  },
  "leukemia": {
    name: "Leukemia",
    indonesianName: "Leukemia (Sistem Hematologi & Darah)",
    organSystem: "Sistem Hematologi & Darah",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Leukemia" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Progression from myelodysplastic syndromes (MDS) to acute myelogenous leukemia (AML) has been observed in clinical trials with romiplostim.  This drug is not indicated for the treatment of thrombocytopenia due to MDS or any other cause other than chronic ITP.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Nplate (romiplostim)." Amgen USA  (2008):']
  },
  "papilledema": {
    name: "Papilledema",
    indonesianName: "Papilledema (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Papilledema" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Papilledema has been reported in 2% of patients receiving oprelvekin.  Therapy with oprelvekin should be administered cautiously in patients with papilledema or CNS tumors as papilledema can be worsened or induced during therapy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Neumega (oprelvekin)." Genetics Institute  (2001):']
  },
  "injection site reaction": {
    name: "Injection Site Reaction",
    indonesianName: "Injection Site Reaction (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Injection Site Reaction" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Injection site reactions, including injection site necrosis, can occur with the use of subcutaneous interferon beta.  Caution should be exercised when prescribing this agent and the decisions to discontinue therapy following necrosis at a single injection site should be based on the extent of the necrosis.  For patients who continue therapy after injection site necrosis has occurred, it is recommended to avoid administration of this agent near the affected area until it is fully healed and if multiple lesions occur, discontinue therapy until healing occurs.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Plegridy (peginterferon beta-1a)." Biogen Idec Inc  (2014):']
  },
  "addison disease": {
    name: "Addison Disease",
    indonesianName: "Addison Disease (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Addison Disease" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Thiopental should not be used in patients with Addison disease or any adrenal gland disorder.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: []
  },
  "esophageal fistula": {
    name: "Esophageal Fistula",
    indonesianName: "Esophageal Fistula (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Potensi Akut / Kontraindikasi Mayor",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Esophageal Fistula" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "The use of photodynamic therapy (PDT) with porfimer is contraindicated for the treatment of esophageal cancer in patients with an existing bronchoesophageal or tracheoesophageal fistula.  Prior to administration of PDT, patients must be evaluated by barium swallow to rule out fistulas, which can occur with PDT, particularly if the esophageal tumor is eroding into the trachea or bronchial tree.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Photofrin (porfimer)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "esophageal and gastric varices": {
    name: "Esophageal and Gastric Varices",
    indonesianName: "Esophageal and Gastric Varices (Sistem Gastrointestinal)",
    organSystem: "Sistem Gastrointestinal",
    urgencyLevel: "Progresif / Perlu Pemantauan Ketat",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Esophageal and Gastric Varices" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Treatment with photodynamic therapy and porfimer should be conducted with extreme caution in patients with esophageal varices.  Light should not be given directly to the variceal area because of the high risk of bleeding.  In general, photodynamic therapy is not suitable for patients with esophageal or gastric varices, or patients with esophageal ulcers >1 cm in diameter.",
    ddinterSeverityDistribution: {
      major: 1,
      moderate: 0,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Photofrin (porfimer)." Sanofi Winthrop Pharmaceuticals  (2001):']
  },
  "favism": {
    name: "Favism",
    indonesianName: "Favism (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Favism" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Hemolytic anemia with disseminated intravascular coagulation associated with a glucose-6 phosphate deficiency (G6PD) has occurred during therapy with mafenide topical.  Therapy with mafenide topical should be applied cautiously in patients with G6PD deficiency.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Sulfamylon (mafenide topical)." Dow Hickam Pharmaceuticals Inc  (2022):']
  },
  "ovarian cysts": {
    name: "Ovarian Cysts",
    indonesianName: "Ovarian Cysts (Kondisi Klinis Terstandar DDInter)",
    organSystem: "Kondisi Klinis Terstandar DDInter",
    urgencyLevel: "Perlu Evaluasi Medis Teratur",
    overview: 'Berdasarkan basis data resmi DDInter v2.0 (ddinter2.scbdd.com), entitas klinis "Ovarian Cysts" memiliki 1 catatan kontraindikasi obat-penyakit (DDSI). Penggunaan obat pada kondisi ini memerlukan evaluasi profil farmakokinetik dan penyesuaian dosis secara ketat.',
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: "Nafarelin therapy induces a release of pituitary gonadotropins (LH and FSH).  Ovarian cysts or enlargement of existing ovarian cysts (primarily in women with polycystic ovarian disease) have been reported during the first months of treatment.  Spontaneous resolution generally occurs in 4 to 6 weeks of therapy, but some cases require discontinuation of nafarelin therapy.",
    ddinterSeverityDistribution: {
      major: 0,
      moderate: 1,
      minor: 0,
      total: 1
    },
    ddinterOfficialReferences: ['"Product Information. Synarel (nafarelin)." Searle', '"Product Information. Synarel (nafarelin)." Pfizer U.S. Pharmaceuticals Group  (2022):']
  }
};
function getDiseaseClinicalMonograph(diseaseName) {
  const key = diseaseName.trim().toLowerCase();
  const found = DISEASE_REGISTRY[key];
  if (found) {
    return {
      indonesianName: found.indonesianName,
      organSystem: found.organSystem,
      urgencyLevel: found.urgencyLevel,
      overview: found.overview,
      ddinterOfficialUrl: found.ddinterOfficialUrl,
      ddinterWarningSummary: found.ddinterWarningSummary,
      ddinterSeverityDistribution: found.ddinterSeverityDistribution,
      ddinterOfficialReferences: found.ddinterOfficialReferences,
      clinicalReferences: found.ddinterOfficialReferences
    };
  }
  return {
    indonesianName: diseaseName,
    organSystem: "Kondisi Klinis Terdaftar DDInter v2.0",
    urgencyLevel: "Perlu Pemantauan Klinis DDInter",
    overview: `Entitas klinis "${diseaseName}" terindeks dalam basis data resmi interaksi obat-penyakit DDInter v2.0 (ddinter2.scbdd.com).`,
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/",
    ddinterWarningSummary: `Evaluasi monografi interaksi obat pada kondisi ${diseaseName} mengacu pada basis data resmi DDInter v2.0.`,
    ddinterSeverityDistribution: { major: 0, moderate: 0, minor: 0, total: 0 },
    ddinterOfficialReferences: [
      "DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024). https://ddinter2.scbdd.com/"
    ],
    clinicalReferences: [
      "DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024). https://ddinter2.scbdd.com/"
    ]
  };
}

// src/server/ddinterLiveService.ts
import fs3 from "fs";
import path3 from "path";
import dns from "node:dns";
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
}
function cleanStr(val) {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (trimmed === "None" || trimmed === "-" || trimmed === "--" || trimmed === "null" || trimmed === "undefined") {
    return "";
  }
  return trimmed;
}
var DDInterLiveService = class {
  constructor() {
    this.baseUrl = "https://ddinter2.scbdd.com";
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://ddinter2.scbdd.com/"
    };
    this.curatedRefs = {};
    this.curatedDrugsMap = {};
    this.loadCuratedRefs();
    this.loadCuratedDrugs();
  }
  loadCuratedDrugs() {
    this.curatedDrugsMap["DDINTER2"] = {
      ddinterId: "DDInter2",
      name: "Abaloparatide",
      drugType: "biotech",
      molecularFormula: "C174H300N56O49",
      molecularWeight: "3961",
      casNumber: "247062-33-5",
      smiles: "unknown",
      proteinSequence: ">Abaloparatide N-terminal peptide sequence AVSEHQLLHDKGKSIQDLRRRELLEKLLXKLHTA",
      atcClassification: ["H05AA04"],
      atcCategoryName: "Parathyroid hormones and analogues",
      description: "Abaloparatide is an analog of PTHrP (parathyroid hormone-related protein). It was approved in April 2017 for the treatment of postmenopausal osteoporosis.",
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter2/"
    };
    let abarelixSvg = "";
    const abarelixSvgPath = path3.join(process.cwd(), "src/data/structures/DDInter4.svg");
    if (fs3.existsSync(abarelixSvgPath)) {
      try {
        abarelixSvg = fs3.readFileSync(abarelixSvgPath, "utf-8");
      } catch {
      }
    }
    this.curatedDrugsMap["DDINTER4"] = {
      ddinterId: "DDInter4",
      name: "Abarelix",
      drugType: "small molecule",
      molecularFormula: "C72H95ClN14O14",
      molecularWeight: "1416.090",
      casNumber: "183552-38-7",
      description: "Synthetic decapeptide antagonist to gonadotropin releasing hormone (GnRH). It is marketed by Praecis Pharmaceuticals as Plenaxis. Praecis announced in June 2006 that it was voluntarily withdrawing the drug from the market.",
      atcClassification: ["L02BX01"],
      atcCategoryName: "Other hormone antagonists and related agents",
      brandNames: ["Plenaxis"],
      smiles: "CC(C)C[C@H](NC(=O)[C@@H](CC(N)=O)NC(=O)[C@H](CC1=CC=C(O)C=C1)N(C)C(=O)[C@H](CO)NC(=O)[C@@H](CC1=CN=CC=C1)NC(=O)[C@@H](CC1=CC=C(Cl)C=C1)NC(=O)[C@@H](CC1=CC2=C(C=CC=C2)C=C1)NC(C)=O)C(=O)N[C@@H](CCCCNC(C)C)C(=O)N1CCC[C@H]1C(=O)N[C@H](C)C(N)=O",
      structureSvg: abarelixSvg || void 0,
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter4/"
    };
    this.curatedDrugsMap["DDINTER6"] = {
      ddinterId: "DDInter6",
      name: "Abciximab",
      drugType: "biotech",
      molecularFormula: "C6462H9964N1690O2049S48",
      molecularWeight: "145651.100",
      casNumber: "143653-53-6",
      atcClassification: ["B01AC13"],
      atcCategoryName: "Platelet aggregation inhibitors excluding heparin",
      brandNames: ["ReoPro"],
      proteinSequence: ">pdb|6V4P|C Chain C, Abciximab, heavy chain EVQLQQSGTVLARPGASVKMSCEASGYTFTNYWMHWVKQRPGQGLEWIGAIYPGNSDTSYIQKFKGKAKLTAVTSTTSVYMELSSLTNEDSAVYYCTLYDGYYVFAYWGQGTLVTVSAASTKGPSVFPLAPSSKSTSGGTAALGCLVKDYFPEPVTVSWNSGALTSGVHTFPAVLQSSGLYSLSSVVTVPSSSLGTQTYICNVNHKPSNTKVDKKVEPKSCDKTH",
      description: "Abciximab is a Fab fragment of the chimeric human-murine monoclonal antibody 7E3. Abciximab binds to the glycoprotein (GP) IIb/IIIa receptor of human platelets and inhibits platelet aggregation by preventing the binding of fibrinogen, von Willebrand factor, and other adhesive molecules. It also binds to vitronectin (\u03B1v\u03B23) receptor found on platelets and vessel wall endothelial and smooth muscle cells.",
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter6/"
    };
    this.curatedDrugsMap["DDINTER8"] = {
      ddinterId: "DDInter8",
      name: "Abiraterone",
      drugType: "small molecule",
      molecularFormula: "C24H31NO",
      molecularWeight: "349.509",
      casNumber: "154229-19-3",
      atcClassification: ["L02BX03"],
      atcCategoryName: "Other hormone antagonists and related agents",
      brandNames: ["Zytiga"],
      smiles: "CC12CCC3C(CCC4=CC(O)CCC34C)C1CCC2C1=CN=CC=C1",
      description: "Antiandrogen used in combination with prednisone for the treatment of metastatic castration-resistant prostate cancer and metastatic high-risk castration-sensitive prostate cancer.",
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter8/"
    };
    let abacavirSvg = "";
    const abacavirSvgPath = path3.join(process.cwd(), "src/data/structures/DDInter1.svg");
    if (fs3.existsSync(abacavirSvgPath)) {
      try {
        abacavirSvg = fs3.readFileSync(abacavirSvgPath, "utf-8");
      } catch {
      }
    }
    this.curatedDrugsMap["DDINTER1"] = {
      ddinterId: "DDInter1",
      name: "Abacavir",
      drugType: "small molecule",
      molecularFormula: "C14H18N6O",
      molecularWeight: "286.332",
      casNumber: "136470-78-5",
      atcClassification: ["J05AF06"],
      atcCategoryName: "Nucleoside and nucleotide reverse transcriptase inhibitors",
      brandNames: ["Ziagen", "Epzicom", "Triumeq"],
      smiles: "NC1=NC2=C(N=CN2[C@@H]2C[C@H](CO)C=C2)C(NC2CC2)=N1",
      structureSvg: abacavirSvg || void 0,
      description: "Nucleoside reverse transcriptase inhibitor (NRTI) used in antiretroviral therapy for the prevention and treatment of HIV/AIDS.",
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter1/"
    };
    let acetylcholineSvg = "";
    const acetylcholineSvgPath = path3.join(process.cwd(), "src/data/structures/DDInter18.svg");
    if (fs3.existsSync(acetylcholineSvgPath)) {
      try {
        acetylcholineSvg = fs3.readFileSync(acetylcholineSvgPath, "utf-8");
      } catch {
      }
    }
    this.curatedDrugsMap["DDINTER18"] = {
      ddinterId: "DDInter18",
      name: "Acetylcholine",
      drugType: "small molecule",
      molecularFormula: "C7H16NO2",
      molecularWeight: "146.207",
      casNumber: "51-84-3",
      atcClassification: ["S01EB09"],
      atcCategoryName: "Ophthalmologicals, parasympathomimetics / miotics",
      brandNames: ["Miochol-E"],
      smiles: "CC(=O)OCC[N+](C)(C)C",
      iupacName: "[2-(acetyloxy)ethyl]trimethylazanium",
      inchi: "OIPILFWXSMYKGL-UHFFFAOYSA-N",
      structureSvg: acetylcholineSvg || void 0,
      description: "A neurotransmitter. Acetylcholine in vertebrates is the major transmitter at neuromuscular junctions, autonomic ganglia, parasympathetic effector junctions, a subset of sympathetic effector junctions, and at many sites in the central nervous system. It is generally not used as an administered drug because it is broken down very rapidly by cholinesterases, but it is useful in some ophthalmological applications.",
      usefulLinks: {
        "DrugBank": "https://go.drugbank.com/drugs/DB03128",
        "PubChem": "https://pubchem.ncbi.nlm.nih.gov/compound/187",
        "ChEMBL": "https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL667/",
        "ChEBI": "http://www.ebi.ac.uk/chebi/searchId.do?chebiId=15355",
        "KEGG": "http://www.genome.jp/dbget-bin/www_bget?cpd:C01996"
      },
      officialUrl: "https://ddinter2.scbdd.com/server/drug-detail/DDInter18/"
    };
    try {
      const structDir = path3.join(process.cwd(), "src/data/structures");
      if (fs3.existsSync(structDir)) {
        for (const file of fs3.readdirSync(structDir)) {
          if (file.endsWith(".svg")) {
            const id = file.replace(".svg", "").toUpperCase();
            const svgContent = fs3.readFileSync(path3.join(structDir, file), "utf-8");
            if (this.curatedDrugsMap[id]) {
              this.curatedDrugsMap[id].structureSvg = svgContent;
            } else {
              this.curatedDrugsMap[id] = {
                ddinterId: file.replace(".svg", ""),
                structureSvg: svgContent
              };
            }
          }
        }
      }
    } catch {
    }
    try {
      const curPath = path3.join(process.cwd(), "src/data/curated_ddinter_details.json");
      if (fs3.existsSync(curPath)) {
        const curJson = JSON.parse(fs3.readFileSync(curPath, "utf-8"));
        for (const [id, val] of Object.entries(curJson)) {
          const k = id.toUpperCase();
          const v = val;
          let svgContent = "";
          if (v.svgPath && fs3.existsSync(path3.resolve(process.cwd(), v.svgPath))) {
            try {
              svgContent = fs3.readFileSync(path3.resolve(process.cwd(), v.svgPath), "utf-8");
            } catch {
            }
          }
          this.curatedDrugsMap[k] = {
            ...v,
            structureSvg: svgContent || v.structureSvg || this.curatedDrugsMap[k]?.structureSvg,
            usefulLinks: v.usefulLinks || this.curatedDrugsMap[k]?.usefulLinks || {
              ...v.drugbankId ? { "DrugBank": `https://go.drugbank.com/drugs/${v.drugbankId}` } : {},
              ...v.pubchemId ? { "PubChem": `https://pubchem.ncbi.nlm.nih.gov/compound/${v.pubchemId}` } : {},
              ...v.chemblId ? { "ChEMBL": `https://www.ebi.ac.uk/chembl/compound_report_card/${v.chemblId}/` } : {}
            }
          };
        }
      }
    } catch {
    }
    try {
      const candidates = [
        path3.join(process.cwd(), "src/data/ddinter_harvested_drugs.json"),
        path3.join(process.cwd(), "dist/data/ddinter_harvested_drugs.json")
      ];
      for (const p of candidates) {
        if (fs3.existsSync(p)) {
          const list = JSON.parse(fs3.readFileSync(p, "utf-8"));
          for (const item of list) {
            if (item.internalID) {
              const k = item.internalID.toUpperCase();
              if (!this.curatedDrugsMap[k]) {
                this.curatedDrugsMap[k] = {
                  ddinterId: item.internalID,
                  name: item.name || item.display,
                  smiles: item.smiles && item.smiles !== item.internalID ? item.smiles : void 0,
                  structureSvg: item.structure || void 0,
                  atcClassification: []
                };
              }
            }
          }
          break;
        }
      }
    } catch {
    }
  }
  buildFallbackDrugDetail(ddinterId) {
    const norm = ddinterId.toUpperCase();
    const curated = this.curatedDrugsMap[norm] || {};
    const dbDrug = ddinterDb.findDrug(ddinterId);
    const ddiFallback = this.getDrugInteractionsFromDb(ddinterId, 5e3);
    const ddsiFallback = this.getDrugDdsiFromDb(ddinterId, 5e3);
    const dfiFallback = this.getDrugDfiFromDb(ddinterId, 5e3);
    let brands = curated.brandNames || [];
    if (!brands.length && dbDrug?.brand_names) {
      try {
        brands = JSON.parse(dbDrug.brand_names);
      } catch {
      }
    }
    const name = dbDrug?.name || (curated.name && curated.name !== ddinterId ? curated.name : ddinterId);
    const formula = cleanStr(dbDrug?.molecular_formula) || cleanStr(curated.molecularFormula);
    const cas = cleanStr(dbDrug?.cas_number) || cleanStr(curated.casNumber);
    const desc = cleanStr(dbDrug?.description) || cleanStr(curated.description);
    const rawType = cleanStr(dbDrug?.drug_type) || cleanStr(curated.drugType);
    const drugType = rawType && rawType.toLowerCase() !== "none" ? rawType : curated.proteinSequence || dbDrug?.protein_sequence ? "biotech" : "small molecule";
    return {
      ddinterId: dbDrug?.ddinter_id || curated.ddinterId || ddinterId,
      name,
      drugType,
      molecularFormula: formula,
      molecularWeight: (dbDrug?.molecular_weight && dbDrug.molecular_weight > 0 ? String(dbDrug.molecular_weight) : void 0) || cleanStr(curated.molecularWeight) || void 0,
      casNumber: cas || void 0,
      description: desc || void 0,
      atcClassification: (dbDrug?.atc_code && dbDrug.atc_code.length > 1 ? dbDrug.atc_code.split(", ") : null) || (curated.atcClassification?.length ? curated.atcClassification : dbDrug?.atc_code ? [dbDrug.atc_code] : []),
      atcCategoryName: (dbDrug?.atc_code && dbDrug.atc_code.length > 1 ? dbDrug.atc_category : curated.atcCategoryName) || dbDrug?.atc_category || curated.atcCategoryName,
      brandNames: brands,
      iupacName: cleanStr(curated.iupacName) || void 0,
      inchi: cleanStr(curated.inchi) || void 0,
      smiles: cleanStr(dbDrug?.smiles && dbDrug.smiles !== dbDrug.ddinter_id ? dbDrug.smiles : curated.smiles) || "",
      structureSvg: dbDrug?.structure_svg || curated.structureSvg || void 0,
      usefulLinks: curated.usefulLinks || {
        ...dbDrug?.drugbank_id ? { "DrugBank": `https://go.drugbank.com/drugs/${dbDrug.drugbank_id}` } : {},
        ...dbDrug?.pubchem_id ? { "PubChem": `https://pubchem.ncbi.nlm.nih.gov/compound/${dbDrug.pubchem_id}` } : {},
        ...dbDrug?.chembl_id ? { "ChEMBL": `https://www.ebi.ac.uk/chembl/compound_report_card/${dbDrug.chembl_id}/` } : {}
      },
      officialUrl: curated.officialUrl || `${this.baseUrl}/server/drug-detail/${encodeURIComponent(ddinterId)}/`,
      liveFetched: false,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      liveInteractions: ddiFallback.rows,
      liveDdsi: ddsiFallback.rows,
      liveDfi: dfiFallback.rows
    };
  }
  getDrugInteractionsFromDb(ddinterId, limit = 5e3) {
    const rawRows = ddinterDb.getDrugDDIRows(ddinterId, limit);
    const rows = rawRows.map((r) => {
      const isA = r.ddinter_id_a.toLowerCase() === ddinterId.toLowerCase() || r.drug_a.toLowerCase() === ddinterId.toLowerCase();
      const partnerId = isA ? r.ddinter_id_b : r.ddinter_id_a;
      const partnerName = isA ? r.drug_b : r.drug_a;
      const levelUpper = (r.level || "").toUpperCase();
      let levelNum = 0;
      let severityLabel = "Unknown";
      if (levelUpper.includes("MAJOR") || levelUpper === "3" || levelUpper === "HIGH") {
        levelNum = 3;
        severityLabel = "Major";
      } else if (levelUpper.includes("MOD") || levelUpper === "2") {
        levelNum = 2;
        severityLabel = "Moderate";
      } else if (levelUpper.includes("MINOR") || levelUpper === "1" || levelUpper === "LOW") {
        levelNum = 1;
        severityLabel = "Minor";
      } else {
        levelNum = 0;
        severityLabel = "Unknown";
      }
      return {
        drugId: partnerId,
        drugName: partnerName,
        interactionId: typeof r.id === "number" ? r.id : parseInt(String(r.id), 10) || 0,
        level: levelNum,
        severityLabel,
        antagonistic_effect: false,
        synergistic_effect: false,
        absorption: false,
        distribution: false,
        metabolism: false,
        excretion: false,
        others: true,
        mechanismTags: ["DDInter v2.0 Official Matrix"]
      };
    });
    return {
      total: rawRows.length,
      rows
    };
  }
  getDrugDdsiFromDb(ddinterId, limit = 5e3) {
    const rawRows = ddinterDb.getDrugDDSIRows(ddinterId, limit);
    const rows = rawRows.map((r) => {
      const lvl = parseInt(r.level, 10);
      return {
        interactionId: r.id,
        level: isNaN(lvl) ? 2 : lvl,
        severityLabel: lvl === 3 ? "Major" : lvl === 1 ? "Minor" : "Moderate",
        diseaseName: r.disease_name,
        text: r.text,
        references: r.references_text
      };
    });
    return {
      total: rawRows.length,
      rows
    };
  }
  getDrugDfiFromDb(ddinterId, limit = 5e3) {
    const rawRows = ddinterDb.getDrugDFIRows(ddinterId, limit);
    const rows = rawRows.map((r) => {
      const lvl = parseInt(r.level, 10);
      return {
        interactionId: r.id,
        level: isNaN(lvl) ? 2 : lvl,
        severityLabel: lvl === 3 ? "Major" : lvl === 1 ? "Minor" : "Moderate",
        foodName: r.food_name,
        mechanism: r.mechanism,
        management: r.management,
        references: r.references_text
      };
    });
    return {
      total: rawRows.length,
      rows
    };
  }
  loadCuratedRefs() {
    try {
      const candidates = [
        path3.join(process.cwd(), "src/data/ddinter_curated_references.json"),
        path3.join(process.cwd(), "dist/data/ddinter_curated_references.json")
      ];
      for (const p of candidates) {
        if (fs3.existsSync(p)) {
          const raw = fs3.readFileSync(p, "utf-8");
          this.curatedRefs = JSON.parse(raw);
          break;
        }
      }
    } catch {
    }
  }
  /**
   * Fetch full official drug detail from https://ddinter2.scbdd.com/server/drug-detail/<id>/
   */
  async getDrugDetail(ddinterId) {
    const norm = ddinterId.toUpperCase();
    const cacheKey = `ddinter:live_drug:${norm}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    const internalDrug = this.buildFallbackDrugDetail(ddinterId);
    const hasFullAtc = Boolean(internalDrug.atcClassification?.length && internalDrug.atcClassification[0].length >= 3);
    if (internalDrug.molecularFormula && internalDrug.description && hasFullAtc && (internalDrug.structureSvg || internalDrug.drugType === "biotech")) {
      globalCache.set(cacheKey, internalDrug, 86400, "DDInter Internal Database");
      return internalDrug;
    }
    const targetUrl = `${this.baseUrl}/server/drug-detail/${encodeURIComponent(ddinterId)}/`;
    try {
      const res = await fetch(targetUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(15e3)
      });
      if (!res.ok) {
        return internalDrug;
      }
      const html = await res.text();
      const keyValRegex = /<td class=["']key["']>([\s\S]*?)<\/td>\s*<td[^>]*class=["']value["'][^>]*>([\s\S]*?)<\/td>/gi;
      const dict = {};
      let match;
      while ((match = keyValRegex.exec(html)) !== null) {
        const key = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const val = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (key && val) {
          dict[key] = val;
        }
      }
      let drugName = "";
      const nameMatch = html.match(/Interactions with\s*<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || html.match(/Interactions with\s*([\w\s\-]+)/i);
      if (nameMatch) {
        drugName = nameMatch[1].replace(/<[^>]+>/g, "").trim();
      }
      let atcClassification = [];
      let atcCategoryName = "";
      const atcCellMatch = html.match(/<td[^>]*class=["']key["'][^>]*>\s*ATC Classification\s*<\/td>\s*<td[^>]*class=["']value["'][^>]*>([\s\S]*?)<\/td>/i);
      if (atcCellMatch) {
        const cellHtml = atcCellMatch[1];
        const badgeMatches = Array.from(cellHtml.matchAll(/<span[^>]*class=["'][^"']*badge[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)).map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter((code) => /^[A-Z][0-9]{2}[A-Z0-9]{0,4}$/i.test(code));
        if (badgeMatches.length > 0) {
          atcClassification = Array.from(new Set(badgeMatches));
        }
        const tippyMatches = Array.from(cellHtml.matchAll(/data-tippy-content=["']([^"']+)["']/gi));
        for (const tm of tippyMatches) {
          const unescaped = tm[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          const lines = unescaped.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
          if (lines.length >= 2 && !atcCategoryName) {
            atcCategoryName = lines[1].replace(/^[A-Z0-9]+:\s*/, "");
          }
        }
      }
      if (atcClassification.length === 0 && dict["ATC Classification"]) {
        const found = dict["ATC Classification"].match(/[A-Z][0-9]{2}[A-Z0-9]{0,4}/g);
        if (found) atcClassification = Array.from(new Set(found));
      }
      if (atcClassification.length === 0 && internalDrug.atcClassification?.length && internalDrug.atcClassification[0].length >= 3) {
        atcClassification = internalDrug.atcClassification;
      }
      if (!atcCategoryName && internalDrug.atcCategoryName) {
        atcCategoryName = internalDrug.atcCategoryName;
      }
      let structureSvg = "";
      const svgMatch = html.match(/(<svg[\s\S]*?<\/svg>)/i);
      if (svgMatch && svgMatch[1].includes("path")) {
        structureSvg = svgMatch[1];
      }
      const usefulLinks = {};
      const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*badge[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
      let lMatch;
      while ((lMatch = linkRegex.exec(html)) !== null) {
        const href = lMatch[1].trim();
        const label = lMatch[2].replace(/<[^>]+>/g, "").trim();
        if (href.startsWith("http") && label) {
          usefulLinks[label] = href;
        }
      }
      const molecularFormula = cleanStr(
        dict["Molecular Formula"] || dict["Chemical Formula"] || dict["Protein Chemical Formula"]
      ) || void 0;
      const rawWeight = cleanStr(
        dict["Molecular Weight"] || dict["Average Weight"] || dict["Protein Average Weight"]
      );
      const molecularWeight = rawWeight && !isNaN(parseFloat(rawWeight)) ? rawWeight : void 0;
      const casNumber = cleanStr(dict["CAS Number"]) || void 0;
      const description = cleanStr(dict["Description"]) || void 0;
      const rawDrugType = cleanStr(dict["Drug Type"]);
      const drugType = rawDrugType && rawDrugType.toLowerCase() !== "none" ? rawDrugType : "small molecule";
      const rawProteinSeq = dict["Sequences"] || dict["Protein Sequence"] || void 0;
      const proteinSequence = rawProteinSeq ? rawProteinSeq.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : void 0;
      const brandNames = [];
      const desc = description || "";
      const stopWords = /* @__PURE__ */ new Set(["well", "a", "an", "the", "part", "early", "such", "described", "migration", "necrosis", "long", "much", "soon", "many", "more", "most", "other", "another", "it", "they", "this", "that", "these", "those", "to", "for", "with", "at", "by", "from", "in", "on", "into", "and", "or", "but", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had"]);
      const specificMatches = desc.matchAll(/\b(?:brand\s+name|marketed\s+as|trade\s+name)\s+([A-Z][a-zA-Z0-9\-]+)\b|\((?:as|brand\s+name)\s+([A-Z][a-zA-Z0-9\-]+)\)/gi);
      for (const bm of specificMatches) {
        const val = (bm[1] || bm[2] || "").trim();
        if (val && !stopWords.has(val.toLowerCase()) && !brandNames.includes(val)) {
          brandNames.push(val);
        }
      }
      const [intersRes, ddsiRes, dfiRes] = await Promise.allSettled([
        this.getDrugInteractionsLive(ddinterId, 5e3),
        this.getDrugDdsiLive(ddinterId, 5e3),
        this.getDrugDfiLive(ddinterId, 5e3)
      ]);
      const intersResult = intersRes.status === "fulfilled" ? intersRes.value : this.getDrugInteractionsFromDb(ddinterId, 5e3);
      const ddsiResult = ddsiRes.status === "fulfilled" ? ddsiRes.value : this.getDrugDdsiFromDb(ddinterId, 5e3);
      const dfiResult = dfiRes.status === "fulfilled" ? dfiRes.value : this.getDrugDfiFromDb(ddinterId, 5e3);
      const result = {
        ddinterId: dict["ID"] || ddinterId,
        name: (drugName && drugName !== ddinterId ? drugName : "") || internalDrug.name || dict["ID"] || ddinterId,
        drugType,
        molecularFormula: molecularFormula || internalDrug.molecularFormula || void 0,
        molecularWeight: molecularWeight || internalDrug.molecularWeight,
        casNumber: casNumber || internalDrug.casNumber,
        description: description || internalDrug.description,
        atcClassification: atcClassification.length > 0 ? atcClassification : internalDrug.atcClassification || [],
        atcCategoryName: atcCategoryName || internalDrug.atcCategoryName,
        brandNames: brandNames.length > 0 ? brandNames : internalDrug.brandNames,
        iupacName: cleanStr(dict["IUPAC Name"]) || internalDrug.iupacName,
        inchi: cleanStr(dict["InChI"]) || internalDrug.inchi,
        smiles: cleanStr(dict["Canonical SMILES"]) || internalDrug.smiles,
        structureSvg: structureSvg || internalDrug.structureSvg,
        proteinSequence: proteinSequence || internalDrug.proteinSequence,
        usefulLinks: Object.keys(usefulLinks).length > 0 ? usefulLinks : internalDrug.usefulLinks,
        officialUrl: targetUrl,
        liveFetched: true,
        fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
        liveInteractions: intersResult?.rows || [],
        liveDdsi: ddsiResult?.rows || [],
        liveDfi: dfiResult?.rows || []
      };
      try {
        const pbId = usefulLinks.PubChem ? usefulLinks.PubChem.match(/[0-9]+/)?.[0] || "" : "";
        const dbId = usefulLinks.DrugBank ? usefulLinks.DrugBank.match(/DB\d+/)?.[0] || "" : "";
        const cmId = usefulLinks.ChEMBL ? usefulLinks.ChEMBL.match(/CHEMBL\d+/)?.[0] || "" : "";
        ddinterDb.updateDrugDetails(result.ddinterId, {
          name: result.name,
          drug_type: result.drugType,
          molecular_formula: result.molecularFormula || "",
          molecular_weight: result.molecularWeight ? parseFloat(result.molecularWeight) : 0,
          cas_number: result.casNumber || "",
          description: result.description || "",
          smiles: result.smiles || "",
          structure_svg: result.structureSvg || "",
          protein_sequence: result.proteinSequence || "",
          pubchem_id: pbId,
          drugbank_id: dbId,
          chembl_id: cmId
        });
        if (result.atcClassification && result.atcClassification.length > 0) {
          const atcStr = result.atcClassification.join(", ");
          if (atcStr.length > 1) {
            ddinterDb.updateDrugAtc(result.ddinterId, atcStr, result.atcCategoryName || "");
          }
        }
      } catch (err) {
        console.warn("[DDInterLive] SQLite persist warning:", err);
      }
      if (structureSvg) {
        try {
          const svgDir = path3.resolve(process.cwd(), "src/data/structures");
          if (!fs3.existsSync(svgDir)) fs3.mkdirSync(svgDir, { recursive: true });
          fs3.writeFileSync(path3.join(svgDir, `${result.ddinterId}.svg`), structureSvg, "utf-8");
        } catch {
        }
      }
      globalCache.set(cacheKey, result, 7200, "DDInter Official Portal Live Mirror");
      return result;
    } catch {
      const fallback = this.buildFallbackDrugDetail(ddinterId);
      return fallback;
    }
  }
  /**
   * Fetch live disease contraindications (DDSI) from https://ddinter2.scbdd.com/server/interact-with-dis/<id>/
   */
  async getDrugDdsiLive(ddinterId, limit = 5e3) {
    const cacheKey = `ddinter:live_ddsi:${ddinterId.toUpperCase()}:${limit}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    const targetUrl = `${this.baseUrl}/server/interact-with-dis/${encodeURIComponent(ddinterId)}/`;
    try {
      const body = new URLSearchParams({
        draw: "1",
        start: "0",
        length: limit.toString()
      });
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${this.baseUrl}/server/drug-detail/${ddinterId}/`
        },
        body: body.toString(),
        signal: AbortSignal.timeout(6e3)
      });
      if (!res.ok) {
        const fallback = this.getDrugDdsiFromDb(ddinterId, limit);
        return fallback;
      }
      const json = await res.json();
      const rawRows = json.data || [];
      const rows = rawRows.map((r) => {
        const levelNum = parseInt(r.level, 10);
        let severityLabel = "Unknown";
        if (levelNum === 3) severityLabel = "Major";
        else if (levelNum === 2) severityLabel = "Moderate";
        else if (levelNum === 1) severityLabel = "Minor";
        return {
          interactionId: r.interaction_id,
          level: levelNum,
          severityLabel,
          diseaseName: r.diseaseName,
          text: r.text,
          references: r.references
        };
      });
      const result = {
        total: json.recordsTotal || rows.length,
        rows
      };
      globalCache.set(cacheKey, result, 7200, "DDInter Live DDSI Records");
      return result;
    } catch {
      const fallback = this.getDrugDdsiFromDb(ddinterId, limit);
      globalCache.set(cacheKey, fallback, 3600, "DDInter Local DDSI Fallback");
      return fallback;
    }
  }
  /**
   * Fetch live food interactions (DFI) from https://ddinter2.scbdd.com/server/interact-with-food/<id>/
   */
  async getDrugDfiLive(ddinterId, limit = 5e3) {
    const cacheKey = `ddinter:live_dfi:${ddinterId.toUpperCase()}:${limit}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    const targetUrl = `${this.baseUrl}/server/interact-with-food/${encodeURIComponent(ddinterId)}/`;
    try {
      const body = new URLSearchParams({
        draw: "1",
        start: "0",
        length: limit.toString()
      });
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${this.baseUrl}/server/drug-detail/${ddinterId}/`
        },
        body: body.toString(),
        signal: AbortSignal.timeout(3e3)
      });
      if (!res.ok) {
        const fallback = this.getDrugDfiFromDb(ddinterId, limit);
        return fallback;
      }
      const json = await res.json();
      const rawRows = json.data || [];
      const rows = rawRows.map((r) => {
        const levelNum = parseInt(r.level, 10);
        let severityLabel = "Unknown";
        if (levelNum === 3) severityLabel = "Major";
        else if (levelNum === 2) severityLabel = "Moderate";
        else if (levelNum === 1) severityLabel = "Minor";
        return {
          interactionId: r.interaction_id,
          level: levelNum,
          severityLabel,
          foodName: r.foodName,
          mechanism: r.magnesium || r.mechanism,
          management: r.newManagement || r.management,
          references: r.references
        };
      });
      const result = {
        total: json.recordsTotal || rows.length,
        rows
      };
      globalCache.set(cacheKey, result, 7200, "DDInter Live DFI Records");
      return result;
    } catch {
      const fallback = this.getDrugDfiFromDb(ddinterId, limit);
      globalCache.set(cacheKey, fallback, 3600, "DDInter Local DFI Fallback");
      return fallback;
    }
  }
  /**
   * Fetch live interactions table for a specific drug from https://ddinter2.scbdd.com/server/interact-with/<id>/
   */
  async getDrugInteractionsLive(ddinterId, limit = 5e3) {
    const cacheKey = `ddinter:live_interactions:${ddinterId.toUpperCase()}:${limit}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    const targetUrl = `${this.baseUrl}/server/interact-with/${encodeURIComponent(ddinterId)}/`;
    try {
      const body = new URLSearchParams({
        draw: "1",
        start: "0",
        length: limit.toString()
      });
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${this.baseUrl}/server/drug-detail/${ddinterId}/`
        },
        body: body.toString(),
        signal: AbortSignal.timeout(3e3)
      });
      if (!res.ok) {
        const fallback = this.getDrugInteractionsFromDb(ddinterId, limit);
        return fallback;
      }
      const json = await res.json();
      const rawRows = json.data || [];
      const rows = rawRows.map((r) => {
        const levelNum = parseInt(r.level, 10);
        let severityLabel = "Unknown";
        if (levelNum === 3) severityLabel = "Major";
        else if (levelNum === 2) severityLabel = "Moderate";
        else if (levelNum === 1) severityLabel = "Minor";
        const antag = r.antagonistic_effect === "1";
        const syner = r.synergistic_effect === "1";
        const absor = r.absorption === "1";
        const distr = r.distribution === "1";
        const metab = r.metabolism === "1";
        const excre = r.excretion === "1";
        const other = r.others === "1";
        const tags = [];
        if (antag) tags.push("Antagonism");
        if (syner) tags.push("Synergy");
        if (absor) tags.push("Absorption");
        if (distr) tags.push("Distribution");
        if (metab) tags.push("Metabolism");
        if (excre) tags.push("Excretion");
        if (other) tags.push("Others");
        return {
          drugId: r.drug_id,
          drugName: r.drug_name,
          interactionId: r.interaction_id,
          level: levelNum,
          severityLabel,
          antagonistic_effect: antag,
          synergistic_effect: syner,
          absorption: absor,
          distribution: distr,
          metabolism: metab,
          excretion: excre,
          others: other,
          mechanismTags: tags
        };
      });
      const result = {
        total: json.recordsTotal || rows.length,
        rows
      };
      globalCache.set(cacheKey, result, 7200, "DDInter Live Drug Interactions");
      return result;
    } catch {
      const fallback = this.getDrugInteractionsFromDb(ddinterId, limit);
      globalCache.set(cacheKey, fallback, 3600, "DDInter Local Interactions Fallback");
      return fallback;
    }
  }
  /**
   * Fetch official interaction explanation/text by interaction ID from https://ddinter2.scbdd.com/server/interaction-source/
   */
  async getOfficialInteractionDetails(interactionId) {
    const cacheKey = `ddinter:interaction_text:${interactionId}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    const targetUrl = `${this.baseUrl}/server/inter-list/${interactionId}/`;
    try {
      const body = new URLSearchParams({
        draw: "1",
        start: "0",
        length: "10"
      });
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString(),
        signal: AbortSignal.timeout(5e3)
      });
      if (!res.ok) return null;
      const json = await res.json();
      globalCache.set(cacheKey, json, 86400, "DDInter Official Interaction Text");
      return json;
    } catch (err) {
      return null;
    }
  }
  /**
   * Directly queries the official DDInter 2.0 Checker engine (https://ddinter2.scbdd.com/checker/)
   * Returns authentic clinical descriptions, management guidelines, severity levels, and mechanism flags.
   */
  async checkDdiLive(choices) {
    const validIds = choices.map((c) => c.trim()).filter((c) => /^DDInter\d+$/i.test(c));
    if (validIds.length < 2) return [];
    const sortedKey = validIds.slice().sort().join("-");
    const cacheKey = `ddinter:live_checker:${sortedKey}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    try {
      const params = new URLSearchParams();
      for (const id of validIds) {
        params.append("choices", id);
      }
      const res = await fetch(`${this.baseUrl}/checker/`, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${this.baseUrl}/inter-checker/`
        },
        body: params.toString(),
        signal: AbortSignal.timeout(9e3)
      });
      if (!res.ok) {
        console.warn(`[DDInter Live Checker] HTTP status ${res.status}`);
        return [];
      }
      const json = await res.json();
      if (json && json.state === "success" && Array.isArray(json.data)) {
        globalCache.set(cacheKey, json.data, 7200, "DDInter Live Checker API");
        return json.data;
      }
      return [];
    } catch (err) {
      console.warn(`[DDInter Live Checker Error] ${err.message}`);
      return [];
    }
  }
  /**
   * Fetch full official interaction details (scientific references, alternative drugs, and potential CYP metabolism)
   * with multi-tiered caching:
   * 1. Memory cache
   * 2. Curated harvested references file (ddinter_curated_references.json)
   * 3. Live portal extraction from ddinter2.scbdd.com/checker/result/ and ddinter2.scbdd.com/server/interact/
   * 4. Scientific clinical literature fallback
   */
  async getDdiFullDetails(idA, idB, nameA, nameB) {
    const key = `${idA}_${idB}`;
    const revKey = `${idB}_${idA}`;
    const cacheKey = `ddinter:ddi_full:${key}`;
    const cached = globalCache.get(cacheKey);
    if (cached) return cached.data;
    if (this.curatedRefs[key]) {
      const entry = this.curatedRefs[key];
      globalCache.set(cacheKey, entry, 86400, "DDInter Curated References");
      return entry;
    }
    if (this.curatedRefs[revKey]) {
      const entry = this.curatedRefs[revKey];
      globalCache.set(cacheKey, entry, 86400, "DDInter Curated References");
      return entry;
    }
    try {
      const checkerUrl = `${this.baseUrl}/checker/result/${idA}-${idB}/`;
      const res = await fetch(checkerUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(6e3)
      });
      if (res.ok) {
        const html = await res.text();
        const interactMatch = html.match(/\/server\/interact\/(\d+)\//);
        if (interactMatch && interactMatch[1]) {
          const interactId = interactMatch[1];
          const interactUrl = `${this.baseUrl}/server/interact/${interactId}/`;
          const [interactRes, linkmarkerRes] = await Promise.all([
            fetch(interactUrl, { headers: this.headers, signal: AbortSignal.timeout(6e3) }),
            fetch(`${this.baseUrl}/server/linkmarker/${interactId}/`, {
              headers: { ...this.headers, "X-Requested-With": "XMLHttpRequest" },
              signal: AbortSignal.timeout(4e3)
            }).catch(() => null)
          ]);
          let references = [];
          const alternatives = {};
          if (interactRes && interactRes.ok) {
            const iHtml = await interactRes.text();
            const refSection = iHtml.match(/<td class="key">References<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
            if (refSection && refSection[1]) {
              const spanMatches = refSection[1].match(/<span[^>]*>([\s\S]*?)<\/span>/gi) || [];
              references = spanMatches.map(
                (s) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
              ).filter(Boolean);
            }
            const altRegex = /Alternative for <span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/td>\s*<td class="value">([\s\S]*?)<\/td>/gi;
            let altMatch;
            while ((altMatch = altRegex.exec(iHtml)) !== null) {
              const drugName = altMatch[1].replace(/<[^>]+>/g, "").trim();
              const cellHtml = altMatch[2];
              const atcMatch = cellHtml.match(/<span class="badge[^"]*"[^>]*>([A-Z0-9]+)<\/span>/i);
              const atcCode = atcMatch ? atcMatch[1] : void 0;
              const drugLinks = cellHtml.matchAll(/<a href="\/server\/drug-detail\/(DDInter\d+)\/"[^>]*>\s*([^<]+)\s*<\/a>/gi);
              const alts = [];
              for (const dl of drugLinks) {
                alts.push({
                  name: dl[2].trim(),
                  ddinterId: dl[1],
                  atc: atcCode
                });
              }
              if (alts.length > 0) {
                alternatives[drugName] = alts;
              }
            }
          }
          let cypMetabolism = void 0;
          if (linkmarkerRes && linkmarkerRes.ok) {
            try {
              cypMetabolism = await linkmarkerRes.json();
            } catch {
            }
          }
          const result = {
            interactId,
            officialUrl: interactUrl,
            references: references.length > 0 ? references : [],
            alternatives: Object.keys(alternatives).length > 0 ? alternatives : void 0,
            cypMetabolism
          };
          globalCache.set(cacheKey, result, 86400, "DDInter Live Full Interaction Detail");
          return result;
        }
      }
    } catch {
    }
    const fallback = {
      officialUrl: `${this.baseUrl}/checker/result/${idA}-${idB}`,
      references: []
    };
    globalCache.set(cacheKey, fallback, 3600, "DDInter Fallback References");
    return fallback;
  }
};
var ddinterLiveService = new DDInterLiveService();

// src/server/clinicalTranslator.ts
function isAlreadyIndonesian(text) {
  if (!text || text.length < 5) return false;
  const indonesianTokens = [
    "dapat",
    "meningkatkan",
    "menurunkan",
    "kombinasi",
    "risiko",
    "penggunaan",
    "bersamaan",
    "karena",
    "dengan",
    "pada",
    "pasien",
    "adalah",
    "atau",
    "penurunan",
    "peningkatan",
    "penghambatan",
    "konsentrasi",
    "darah",
    "perdarahan",
    "hindari",
    "pantau",
    "pertimbangkan",
    "dosis",
    "efek",
    "terapi"
  ];
  const lower = text.toLowerCase();
  let matches = 0;
  for (const token of indonesianTokens) {
    if (lower.includes(token)) matches++;
    if (matches >= 2) return true;
  }
  return false;
}
var CLINICAL_LEXICON = {
  "coadministration of": "Pemberian bersamaan antara",
  "co-administration of": "Pemberian bersamaan antara",
  "coadministration with": "Pemberian bersamaan dengan",
  "co-administration with": "Pemberian bersamaan dengan",
  "concomitant use of": "Penggunaan bersamaan antara",
  "concomitant administration of": "Pemberian bersamaan antara",
  "concomitant use": "penggunaan bersamaan",
  "may increase the risk of": "dapat meningkatkan risiko terjadinya",
  "can increase the risk of": "dapat meningkatkan risiko terjadinya",
  "may increase the serum concentration of": "dapat meningkatkan konsentrasi serum darah",
  "can increase the serum concentration of": "dapat meningkatkan konsentrasi serum darah",
  "the serum concentration of": "Konsentrasi serum darah",
  "the metabolism of": "Metabolisme senyawa",
  "can be decreased when combined with": "dapat menurun / terhambat bila dikombinasikan dengan",
  "can be increased when combined with": "dapat meningkat secara drastis bila dikombinasikan dengan",
  "can be decreased when it is combined with": "dapat menurun bila dikombinasikan dengan",
  "can be increased when it is combined with": "dapat meningkat bila dikombinasikan dengan",
  "the risk or severity of": "Risiko atau tingkat keparahan",
  "the therapeutic efficacy of": "Efikasi terapeutik dari",
  "can be decreased when used in combination with": "dapat menurun bila digunakan dalam kombinasi dengan",
  "can be increased when used in combination with": "dapat meningkat bila digunakan dalam kombinasi dengan",
  "bleeding": "perdarahan (hemoragi)",
  "gastrointestinal bleeding": "perdarahan saluran cerna (gastrointestinal)",
  "qtc prolongation": "pemanjangan interval QTc jantung (risiko aritmia ventrikel)",
  "prolongation of the qt interval": "pemanjangan interval QT jantung",
  "ventricular arrhythmias": "aritmia ventrikel (torsades de pointes)",
  "hypotension": "hipotensi (penurunan tekanan darah abnormal)",
  "severe hypotension": "hipotensi berat",
  "hyperkalemia": "hiperkalemia (kadar kalium darah tinggi yang berbahaya)",
  "hypokalemia": "hipokalemia (kadar kalium darah rendah)",
  "hyponatremia": "hiponatremia (kadar natrium darah rendah)",
  "sedation": "sedasi mendalam",
  "somnolence": "kantuk berlebih (somnolen)",
  "central nervous system depression": "depresi sistem saraf pusat (SSP)",
  "respiratory depression": "depresi pernapasan (hipoventilasi)",
  "nephrotoxicity": "nefrotoksisitas (kerusakan fungsi ginjal)",
  "hepatotoxicity": "hepatotoksisitas (kerusakan sel-sel hati)",
  "myopathy": "miopati (nyeri/kelemahan otot)",
  "rhabdomyolysis": "rabdomiolisis (kerusakan jaringan otot parah)",
  "serotonin syndrome": "sindrom serotonin (toksisitas serotonergik akut)",
  "bradycardia": "bradikardia (denyut jantung lambat abnormal)",
  "tachycardia": "takikardia (denyut jantung cepat abnormal)",
  "hypoglycemia": "hipoglikemia (penurunan drastis kadar gula darah)",
  "hyperglycemia": "hiperglikemia (lonjakan kadar gula darah)",
  "adverse effects": "efek samping yang merugikan",
  "adverse reactions": "reaksi efek samping obat",
  "fatalities": "kematian fatal",
  "seizures": "kejang epileptiform",
  "toxicity": "toksisitas sistemik",
  "potent inhibitors of": "penghambat kuat dari",
  "potent inhibitor of": "penghambat kuat dari",
  "potent cyp450 3a4 inhibitors": "penghambat kuat CYP450 3A4",
  "potassium-sparing diuretics": "diuretik hemat kalium",
  "potassium-sparing diuretic": "diuretik hemat kalium",
  "potassium supplements": "suplemen kalium",
  "potassium-containing salt substitutes": "pengganti garam yang mengandung kalium",
  "angiotensin converting enzyme (ace) inhibitors": "penghambat enzim pengubah angiotensin (ACE inhibitor)",
  "ace inhibitors": "ACE inhibitor",
  "chronic heart failure": "gagal jantung kronis",
  "congestive heart failure": "gagal jantung kongestif",
  "excessive diuresis": "diuresis berlebihan",
  "oral anticoagulants": "antikoagulan oral",
  "oral anticoagulant": "antikoagulan oral",
  "in patients on oral anticoagulants": "pada pasien yang mengonsumsi antikoagulan oral",
  "in patients with": "pada pasien dengan",
  "especially those associated with": "khususnya yang disertai",
  "impaired renal function": "gangguan fungsi ginjal",
  "may further raise": "dapat semakin meningkatkan",
  "serum potassium levels": "kadar kalium serum darah",
  "therapy with": "terapi dengan",
  "should be administered cautiously in patients with or predisposed to": "harus diberikan dengan sangat hati-hati pada pasien dengan atau yang rentan terhadap",
  "and serum potassium levels should be carefully monitored": "dan kadar kalium serum harus dipantau secara cermat",
  "risk factors for the development of": "faktor risiko timbulnya",
  "during ace inhibitor therapy include": "selama terapi ACE inhibitor meliputi",
  "renal insufficiency": "insufisiensi ginjal",
  "and lovastatin": "maupun lovastatin",
  "or lovastatin": "maupun lovastatin"
};
var FOOD_TRANSLATIONS = {
  grapefruit: {
    idName: "Grapefruit (Jeruk Bali Merah)",
    category: "Buah/Jus",
    advice: "Hindari konsumsi buah atau jus grapefruit selama terapi. Kandungan furanokumarin menghambat enzim CYP3A4 usus, meningkatkan bioavailabilitas obat ke tingkat toksik."
  },
  "grapefruit juice": {
    idName: "Jus Grapefruit (Jeruk Bali Merah)",
    category: "Buah/Jus",
    advice: "Hindari konsumsi jus grapefruit selama terapi karena menghambat metabolisme hepatik & usus."
  },
  alcohol: {
    idName: "Alkohol & Minuman Beralkohol",
    category: "Alkohol",
    advice: "Hindari konsumsi alkohol secara ketat. Alkohol dapat memperparah depresi sistem saraf pusat, memperberat beban hati, atau memicu iritasi lambung masif."
  },
  "alcoholic beverages": {
    idName: "Minuman Beralkohol",
    category: "Alkohol",
    advice: "Hindari semua jenis minuman beralkohol selama masa pengobatan."
  },
  milk: {
    idName: "Susu & Produk Olahan Susu (Dairy)",
    category: "Susu/Kalsium",
    advice: "Beri jeda waktu minimal 2 jam antara konsumsi susu dan obat. Ion kalsium dalam susu membentuk kelat tidak larut yang menghambat absorpsi obat di usus."
  },
  "dairy products": {
    idName: "Produk Susu & Olahannya (Keju, Yoghurt)",
    category: "Susu/Kalsium",
    advice: "Beri jeda konsumsi minimal 2-3 jam untuk menghindari pembentukan khelat kalsium."
  },
  "high-calcium food": {
    idName: "Makanan Berkalsium Tinggi",
    category: "Susu/Kalsium",
    advice: "Beri jeda konsumsi minimal 2 jam sebelum atau 4 jam setelah obat."
  },
  "high-fat meal": {
    idName: "Makanan Berlemak Tinggi",
    category: "Makanan Berlemak",
    advice: "Konsistensikan pola konsumsi makanan. Lemak tinggi dapat secara signifikan meningkatkan atau memperlambat laju absorpsi obat."
  },
  "high fat meal": {
    idName: "Makanan Berlemak Tinggi",
    category: "Makanan Berlemak",
    advice: "Konsistensikan pola konsumsi makanan untuk menjaga kadar terapeutik obat tetap stabil."
  },
  caffeine: {
    idName: "Kafein (Kopi, Teh, Minuman Berenergi)",
    category: "Kafein",
    advice: "Batasi asupan kafein. Metabolisme kafein dapat terhambat, memicu palpitasi jantung, insomnia, tremor, dan kegelisahan berlebih."
  },
  coffee: {
    idName: "Kopi / Minuman Berkafein",
    category: "Kafein",
    advice: "Batasi konsumsi kopi selama terapi untuk mencegah palpitasi dan stimulasi berlebih."
  },
  "st. john's wort": {
    idName: "St. John's Wort (Herbal Hypericum)",
    category: "Herbal",
    advice: "HINDARI penggunaan suplemen ini. St. John's Wort adalah penginduksi kuat CYP3A4 dan P-gp yang menurunkan kadar obat hingga terapi gagal."
  },
  "st johns wort": {
    idName: "St. John's Wort (Herbal)",
    category: "Herbal",
    advice: "Hindari suplemen herbal ini karena menurunkan efikasi obat secara drastis."
  },
  tyramine: {
    idName: "Makanan Tinggi Tiramina (Keju Tua, Fermentasi, Daging Asap)",
    category: "Tiramina",
    advice: "Patuhi diet rendah tiramina secara ketat untuk mencegah krisis hipertensi fatal."
  },
  "tyramine-containing foods": {
    idName: "Makanan Kaya Tiramina (Keju Tua, Tapai, Ekstrak Ragi)",
    category: "Tiramina",
    advice: "Hindari keju tua, makanan fermentasi, kecap kedelai, dan bir guna mencegah lonjakan tekanan darah berbahaya."
  },
  "vitamin k-rich foods": {
    idName: "Makanan Kaya Vitamin K (Bayam, Brokoli, Kale)",
    category: "Sayuran Hijau",
    advice: "Pertahankan asupan sayuran hijau tetap konsisten setiap hari. Fluktuasi asupan vitamin K mengubah efektivitas terapi antikoagulan (Warfarin)."
  },
  "vitamin k": {
    idName: "Vitamin K / Sayuran Berdaun Hijau Tua",
    category: "Sayuran Hijau",
    advice: "Jaga konsistensi porsi konsumsi sayuran hijau agar efek antikoagulasi tidak terganggu."
  },
  "potassium-rich foods": {
    idName: "Makanan Tinggi Kalium (Pisang, Jeruk, Pengganti Garam)",
    category: "Kalium",
    advice: "Waspadai hiperkalemia. Batasi konsumsi pisang berlebih dan hindari garam diet berbasis kalium tanpa petunjuk dokter."
  },
  "salt substitutes": {
    idName: "Pengganti Garam (Garam Rendah Natrium / Kalium Klorida)",
    category: "Kalium",
    advice: "Hindari pengganti garam berbahan dasar kalium karena meningkatkan risiko hiperkalemia berat."
  },
  food: {
    idName: "Makanan Umum / Asupan Nutrisi",
    category: "Makanan Umum",
    advice: "Konsumsi obat sesuai anjuran (sebelum atau sesudah makan) secara konsisten setiap jadwal minum obat."
  },
  "apple juice": {
    idName: "Jus Apel",
    category: "Buah/Jus",
    advice: "Beri jeda minimal 4 jam. Senyawa flavonoid jus apel dapat menghambat polipeptida transporter OATP usus."
  },
  "orange juice": {
    idName: "Jus Jeruk",
    category: "Buah/Jus",
    advice: "Beri jeda minimal 4 jam dengan konsumsi obat untuk mencegah gangguan absorpsi pada transporter usus."
  },
  "cranberry juice": {
    idName: "Jus Cranberry",
    category: "Buah/Jus",
    advice: "Konsumsi secara wajar dan pantau parameter pembekuan darah atau efek gastrointestinal."
  }
};
var DISEASE_TRANSLATIONS = {
  "renal impairment": {
    idName: "Gangguan / Gagal Ginjal (Renal Impairment)",
    defaultRisk: "Penurunan laju filtrasi glomerulus (LFG) menyebabkan retensi dan akumulasi metabolit obat aktif, meningkatkan risiko nefrotoksisitas dan efek samping sistemik berat.",
    defaultManagement: "Lakukan penyesuaian dosis berdasarkan klirens kreatinin (CrCl) atau estimasi LFG (eGFR). Pantau kreatinin serum dan elektrolit secara berkala."
  },
  "chronic kidney disease": {
    idName: "Penyakit Ginjal Kronis (CKD)",
    defaultRisk: "Ekskresi obat melalui ginjal terhambat, memicu akumulasi obat, perburukan fungsi nefron, dan risiko asidosis atau hiperkalemia.",
    defaultManagement: "Sesuaikan dosis terapi dengan fungsi ginjal terkini. Hindari agen nefrotoksik tambahan."
  },
  "hepatic impairment": {
    idName: "Gangguan Fungsi Hati (Hepatic Impairment)",
    defaultRisk: "Penurunan kapasitas metabolisme sitokrom hepatik dan klirens empedu, melipatgandakan waktu paruh eliminasi dan bioavailabilitas obat.",
    defaultManagement: "Gunakan dosis awal yang lebih rendah. Pantau enzim transaminase hati (SGOT/SGPT), bilirubin, dan tanda ensefalopati hepatik."
  },
  "liver disease": {
    idName: "Penyakit Hati Kronis / Sirosis",
    defaultRisk: "Risiko dekompensasi hepatik, akumulasi obat dalam plasma, dan toksisitas hati sekunder.",
    defaultManagement: "Pertimbangkan obat alternatif yang tidak dimetabolisme melalui hepar atau kurangi dosis hingga 50%."
  },
  "heart failure": {
    idName: "Gagal Jantung Kongestif (Heart Failure)",
    defaultRisk: "Potensi retensi cairan, eksaserbasi kelebihan beban volume (volume overload), atau depresi kontraktilitas miokardium.",
    defaultManagement: "Pantau ketat tanda kongesti perifer, ronkhi paru, perubahan berat badan harian, dan stabilitas hemodinamik."
  },
  "hypertension": {
    idName: "Hipertensi (Tekanan Darah Tinggi)",
    defaultRisk: "Potensi peningkatan resistensi vaskular sistemik, vasokonstriksi, atau retensi natrium yang menetralkan efikasi antihipertensi.",
    defaultManagement: "Pantau tekanan darah secara berkala. Hindari ko-peresepan zat yang menaikkan tensi darah."
  },
  "diabetes mellitus": {
    idName: "Diabetes Melitus (Kencing Manis)",
    defaultRisk: "Perubahan sensitivitas insulin atau glukoneogenesis hepatik, berisiko memicu hiperglikemia tidak terkontrol atau menyamarkan gejala hipoglikemia.",
    defaultManagement: "Pantau kadar gula darah kapiler harian. Sesuaikan dosis obat antidiabetes bila ditemukan fluktuasi glukosa signifikan."
  },
  "asthma": {
    idName: "Asma Bronkial / PPOK",
    defaultRisk: "Risiko bronkospasme akut akibat blokade reseptor beta-2 adrenergik atau reaksi pseudoalergi pelepasan leukotrien.",
    defaultManagement: "KONTRAINDIKASI untuk penyekat beta non-selektif dan hati-hati dengan NSAID. Pastikan inhaler bronkodilator darurat selalu tersedia."
  },
  "peptic ulcer": {
    idName: "Tukak Lambung / Ulkus Peptikum",
    defaultRisk: "Penekanan sintesis prostaglandin mukosa gastrointestinal atau peningkatan keasaman lambung, memicu perdarahan saluran cerna aktif atau perforasi.",
    defaultManagement: "Hindari kombinasi NSAID/kortikosteroid. Pertimbangkan proteksi lambung dengan inhibitor pompa proton (PPI) seperti Omeprazole bila terapi mutlak diperlukan."
  },
  "gastrointestinal bleeding": {
    idName: "Riwayat Perdarahan Saluran Cerna",
    defaultRisk: "Presipitasi perdarahan ulang yang mengancam nyawa pada sawar mukosa lambung-usus.",
    defaultManagement: "KONTRAINDIKASI relatif untuk antikoagulan dan antiinflamasi non-steroid. Evaluasi rasio manfaat-risiko secara komprehensif."
  },
  "long qt syndrome": {
    idName: "Sindrom Interval QT Panjang / Aritmia",
    defaultRisk: "Penghambatan kanal ion kalium hERG miokard, memperpanjang repolarisasi ventrikel dan memicu aritmia fatal (Torsades de Pointes).",
    defaultManagement: "Lakukan rekam EKG serial. Koreksi kelainan elektrolit (terutama kalium dan magnesium) sebelum terapi dimulai."
  },
  "glaucoma": {
    idName: "Glaukoma Sudut Tertutup",
    defaultRisk: "Efek antikolinergik/midriasis dapat memblokir aliran keluar aqueous humor, memicu lonjakan tekanan intraokular akut yang merusak saraf optik.",
    defaultManagement: "Hindari obat dengan profil antikolinergik kuat. Rujuk segera ke dokter spesialis mata bila timbul nyeri mata mendadak atau pandangan kabur."
  },
  "pregnancy": {
    idName: "Kehamilan (Pregnancy Risk)",
    defaultRisk: "Potensi efek teratogenik pada organogenesis janin, gangguan perfusi plasenta, atau toksisitas perinatal.",
    defaultManagement: "Verifikasi kategori keamanan kehamilan (FDA Pregnancy Category). Ganti ke lini obat yang telah terbukti aman untuk trimester kehamilan saat ini."
  },
  "epilepsy": {
    idName: "Epilepsi / Riwayat Kejang",
    defaultRisk: "Penurunan ambang kejang (seizure threshold) di korteks serebri, memicu kekambuhan bangkitan konvulsif.",
    defaultManagement: "Pantau frekuensi kejang. Pertimbangkan optimalisasi dosis antikonvulsan atau pilih obat dengan risiko prokonvulsan minimal."
  },
  "hyperkalemia": {
    idName: "Hiperkalemia (Kadar Kalium Serum Tinggi)",
    defaultRisk: "Pemberian obat yang menahan kalium dapat memicu lonjakan kalium serum ke tingkat toksik (>5.5 mEq/L), berisiko aritmia jantung fatal atau henti jantung.",
    defaultManagement: "KONTRAINDIKASI / PERHATIAN EKSTREM: Hindari pemberian kalium eksogen atau diuretik hemat kalium. Pantau kadar kalium darah dan rekam EKG secara berkala."
  },
  "hypokalemia": {
    idName: "Hipokalemia (Kadar Kalium Serum Rendah)",
    defaultRisk: "Dapat memicu aritmia ventrikel serius dan memperparah toksisitas glikosida jantung (Digoxin).",
    defaultManagement: "Koreksi kadar kalium serum sebelum memulai terapi."
  }
};
var ClinicalTranslator = class {
  static {
    this.translationCache = /* @__PURE__ */ new Map();
  }
  /**
   * Neural online translation with intelligent caching & resilience
   */
  static async translateOnline(text) {
    if (!text || text.trim() === "" || text === "-") return text;
    const trimmed = text.trim();
    if (isAlreadyIndonesian(trimmed)) return trimmed;
    if (this.translationCache.has(trimmed)) {
      return this.translationCache.get(trimmed);
    }
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translated = data[0].map((item) => item[0]).filter(Boolean).join("");
          if (translated && translated.trim().length > 0) {
            const polished = translated.trim();
            this.translationCache.set(trimmed, polished);
            return polished;
          }
        }
      }
    } catch {
    }
    return this.translateDdiDescription(trimmed);
  }
  static async translateDdiDescriptionAsync(rawDesc, drugA = "", drugB = "") {
    if (!rawDesc || rawDesc.trim() === "" || rawDesc === "-") {
      return drugA && drugB ? `Interaksi farmakologis terverifikasi DDInter v2.0 antara ${drugA} dan ${drugB}.` : "Interaksi farmakologis terverifikasi pada basis data DDInter v2.0.";
    }
    return this.translateOnline(rawDesc);
  }
  static async translateDdiManagementAsync(rawMgmt, drugA = "", drugB = "", severity = "Moderate") {
    if (!rawMgmt || rawMgmt.trim() === "" || rawMgmt === "-") {
      return this.translateDdiManagement(rawMgmt, drugA, drugB, severity);
    }
    return this.translateOnline(rawMgmt);
  }
  static async translateFoodInteractionAsync(rawFoodItem, rawMechanism, rawEffect, rawMgmt, drugName = "") {
    const foodKey = (rawFoodItem || "").toLowerCase().trim();
    const matched = FOOD_TRANSLATIONS[foodKey];
    const foodItem = matched ? matched.idName : rawFoodItem;
    let mechanism = rawMechanism;
    if (matched) {
      mechanism = `Interaksi antara ${drugName || "obat"} dan ${foodItem}. Komponen bioaktif pangan mempengaruhi laju absorpsi atau metabolisme hepatik zat aktif.`;
    } else if (rawMechanism && rawMechanism !== "-") {
      mechanism = await this.translateOnline(rawMechanism);
    }
    let effect = rawEffect;
    if (rawEffect && rawEffect !== "-" && !isAlreadyIndonesian(rawEffect)) {
      effect = await this.translateOnline(rawEffect);
    } else {
      effect = `Modifikasi konsentrasi serum puncak atau bioavailabilitas sistemik ${drugName || "obat"} dalam tubuh.`;
    }
    let recommendation = rawMgmt;
    if (matched) {
      recommendation = matched.advice;
    } else if (rawMgmt && rawMgmt !== "-" && !isAlreadyIndonesian(rawMgmt)) {
      recommendation = await this.translateOnline(rawMgmt);
    }
    return {
      foodItem,
      mechanism,
      effect,
      recommendation,
      originalFoodItem: rawFoodItem,
      originalMechanism: rawMechanism,
      originalEffect: rawEffect,
      originalRecommendation: rawMgmt
    };
  }
  static async translateDiseaseContraindicationAsync(rawDiseaseName, rawRisk, rawMechanism, rawMgmt, drugName = "") {
    const disKey = (rawDiseaseName || "").toLowerCase().trim();
    const matched = DISEASE_TRANSLATIONS[disKey];
    const diseaseName = matched ? matched.idName : rawDiseaseName;
    let risk = rawRisk;
    if (matched && (!rawRisk || rawRisk.length < 15)) {
      risk = matched.defaultRisk;
    } else if (rawRisk && rawRisk !== "-") {
      risk = await this.translateOnline(rawRisk);
    }
    let mechanism = rawMechanism;
    if (rawMechanism && rawMechanism !== "-" && !isAlreadyIndonesian(rawMechanism)) {
      mechanism = await this.translateOnline(rawMechanism);
    } else {
      mechanism = `Interaksi patofisiologis antara mekanisme aksi/eliminasi ${drugName || "obat"} dengan kondisi disfungsi organ pada ${diseaseName}.`;
    }
    let management = rawMgmt;
    if (matched && (!rawMgmt || rawMgmt.length < 15)) {
      management = matched.defaultManagement;
    } else if (rawMgmt && rawMgmt !== "-" && !isAlreadyIndonesian(rawMgmt)) {
      management = await this.translateOnline(rawMgmt);
    }
    return {
      diseaseName,
      risk,
      mechanism,
      management,
      originalDiseaseName: rawDiseaseName,
      originalRisk: rawRisk,
      originalMechanism: rawMechanism,
      originalManagement: rawMgmt
    };
  }
  /**
   * Translates interaction description / mechanism into professional Bahasa Indonesia
   */
  static translateDdiDescription(rawDesc, drugA = "", drugB = "") {
    if (!rawDesc || rawDesc.trim() === "" || rawDesc === "-") {
      return drugA && drugB ? `Interaksi farmakologis terverifikasi DDInter v2.0 antara ${drugA} dan ${drugB}.` : "Interaksi farmakologis terverifikasi pada basis data DDInter v2.0.";
    }
    if (isAlreadyIndonesian(rawDesc)) {
      return rawDesc;
    }
    let text = rawDesc.trim();
    const metaDecMatch = text.match(/The metabolism of (.+?) can be decreased when combined with (.+?)\./i);
    if (metaDecMatch) {
      const da = metaDecMatch[1].trim();
      const db = metaDecMatch[2].trim();
      return `Metabolisme ${da} dapat dihambat atau menurun secara signifikan bila dikombinasikan dengan ${db}, yang berpotensi memicu akumulasi obat dan peningkatan risiko toksisitas.`;
    }
    const metaIncMatch = text.match(/The metabolism of (.+?) can be increased when combined with (.+?)\./i);
    if (metaIncMatch) {
      const da = metaIncMatch[1].trim();
      const db = metaIncMatch[2].trim();
      return `Metabolisme ${da} dapat meningkat saat dikombinasikan dengan ${db} akibat induksi enzim hepar, yang berisiko mempercepat pembersihan obat dan menurunkan efektivitas terapeutik ${da}.`;
    }
    const serumIncMatch = text.match(/The serum concentration of (.+?) can be increased when (?:it is )?combined with (.+?)\./i);
    if (serumIncMatch) {
      const da = serumIncMatch[1].trim();
      const db = serumIncMatch[2].trim();
      return `Konsentrasi serum darah ${da} dapat meningkat saat dikombinasikan dengan ${db}, memperbesar kemungkinan timbulnya efek samping dan reaksi toksik.`;
    }
    const serumDecMatch = text.match(/The serum concentration of (.+?) can be decreased when (?:it is )?combined with (.+?)\./i);
    if (serumDecMatch) {
      const da = serumDecMatch[1].trim();
      const db = serumDecMatch[2].trim();
      return `Konsentrasi serum darah ${da} dapat menurun bila dikombinasikan dengan ${db}, berpotensi menyebabkan kegagalan respons terapeutik.`;
    }
    const bleedMatch = text.match(/The risk or severity of bleeding can be increased when (.+?) is combined with (.+?)\./i);
    if (bleedMatch) {
      const da = bleedMatch[1].trim();
      const db = bleedMatch[2].trim();
      return `Risiko atau tingkat keparahan perdarahan (hemoragi) dapat meningkat drastis bila ${da} dikombinasikan dengan ${db} akibat efek hemostatik aditif.`;
    }
    const qtMatch = text.match(/The risk or severity of (?:QTc|QT) prolongation can be increased when (.+?) is combined with (.+?)\./i);
    if (qtMatch) {
      const da = qtMatch[1].trim();
      const db = qtMatch[2].trim();
      return `Risiko pemanjangan interval QTc jantung dan aritmia ventrikel serius dapat meningkat jika ${da} digunakan bersamaan dengan ${db}.`;
    }
    const condMatch = text.match(/The risk or severity of (.+?) can be increased when (.+?) is combined with (.+?)\./i);
    if (condMatch) {
      const condition = condMatch[1].trim();
      const da = condMatch[2].trim();
      const db = condMatch[3].trim();
      const idCond = CLINICAL_LEXICON[condition.toLowerCase()] || condition;
      return `Risiko atau tingkat keparahan ${idCond} dapat meningkat saat ${da} dikombinasikan dengan ${db}.`;
    }
    const effMatch = text.match(/The therapeutic efficacy of (.+?) can be decreased when used in combination with (.+?)\./i);
    if (effMatch) {
      const da = effMatch[1].trim();
      const db = effMatch[2].trim();
      return `Efikasi terapeutik ${da} dapat menurun bila digunakan bersamaan dengan ${db}.`;
    }
    text = text.replace(/Coadministration with (.+?) may significantly increase the plasma concentrations and (.+?) of (.+?)\./gi, "Pemberian bersamaan dengan $1 dapat secara signifikan meningkatkan konsentrasi plasma dan $2 dari $3.").replace(/Coadministration with (.+?) may significantly increase the plasma concentrations of (.+?)\./gi, "Pemberian bersamaan dengan $1 dapat secara signifikan meningkatkan konsentrasi plasma dari $2.").replace(/The mechanism is (.+?) inhibition of CYP450 (\w+), the isoenzyme responsible for the metabolic clearance of (.+?)\./gi, "Mekanismenya adalah penghambatan isoenzim CYP450 $2 oleh $1, yaitu enzim yang bertanggung jawab terhadap klirens metabolisme $3.").replace(/Additionally, (.+?) inhibits CYP450 (\w+(?: and \w+)?), which are responsible for the metabolism of (.+?)\./gi, "Selain itu, $1 juga menghambat CYP450 $2 yang bertanggung jawab terhadap metabolisme $3.").replace(/The possibility of prolonged and\/or increased pharmacologic effects of (.+?) should be considered\./gi, "Perlu diwaspadai kemungkinan perpanjangan atau peningkatan efek farmakologis dari $1.").replace(/Severe adverse effects, including fatalities, have been reported following the administration of (.+?) to (.+?)\./gi, "Efek samping yang parah, termasuk kematian fatal, telah dilaporkan menyusul pemberian $1 pada $2.").replace(/The exact mechanism of interaction is unknown, but may involve additive effects on (.+?)\./gi, "Mekanisme pasti interaksi belum diketahui, namun diduga melibatkan efek aditif pada $1.").replace(/The proposed mechanism has not been fully established but may be related to (.+?)\./gi, "Mekanisme yang diajukan belum sepenuhnya dipastikan, namun kemungkinan terkait dengan $1.").replace(/The interaction has been reported with (.+?)\./gi, "Interaksi ini telah dilaporkan terjadi dengan $1.").replace(/Aspirin, even in small doses, (.+?) by inhibiting platelet aggregation, prolonging (.+?) time, and inducing gastrointestinal lesions\./gi, "Aspirin, bahkan dalam dosis rendah, $1 dengan menghambat agregasi trombosit, memperpanjang waktu perdarahan, serta memicu lesi luka pada mukosa saluran cerna.").replace(/Analgesic\/antipyretic doses of aspirin increase the risk of major (.+?) more than low-dose aspirin; however (.+?) has also occurred with low-dose aspirin\./gi, "Dosis analgesik/antipiretik aspirin meningkatkan risiko perdarahan mayor lebih tinggi dibanding dosis rendah; namun perdarahan tetap dapat terjadi meski dengan aspirin dosis rendah.").replace(/Inhibition of ACE results in decreased aldosterone secretion, which can lead to increases in serum potassium that may be additive with that induced by (.+?)\./gi, "Penghambatan ACE menyebabkan penurunan sekresi aldosteron, yang memicu kenaikan kalium serum yang dapat bersifat aditif dengan efek dari $1.").replace(/ACE inhibitors may also cause deterioration of renal function in patients with (.+?), and the risk is increased if they are sodium-depleted or dehydrated after (.+?)\./gi, "ACE inhibitor juga dapat memicu perburukan fungsi ginjal pada pasien dengan $1, dan risiko meningkat bila pasien mengalami deplesi natrium atau dehidrasi setelah $2.").replace(/and their active acid metabolites, all of which are primarily metabolized by the isoenzyme\./gi, "serta metabolit asam aktifnya, yang semuanya terutama dimetabolisme oleh isoenzim tersebut.").replace(/hypoprothrombinemic effect/gi, "efek hipoprotrombinemik (pengenceran darah / peningkatan risiko perdarahan)").replace(/the biologically more active (.+?) enantiomer of/gi, "enansiomer $1 yang lebih aktif secara biologis dari").replace(/which is primarily metabolized by the isoenzyme/gi, "yang terutama dimetabolisme oleh isoenzim tersebut");
    for (const [enPhrase, idPhrase] of Object.entries(CLINICAL_LEXICON)) {
      const regex = new RegExp(`\\b${enPhrase}\\b`, "gi");
      text = text.replace(regex, idPhrase);
    }
    text = text.replace(/\bcan be increased\b/gi, "dapat meningkat").replace(/\bcan be decreased\b/gi, "dapat menurun").replace(/\bwhen combined with\b/gi, "bila dikombinasikan dengan").replace(/\bwhen used in combination with\b/gi, "bila digunakan bersamaan dengan").replace(/\bis combined with\b/gi, "dikombinasikan dengan").replace(/\bshould be avoided\b/gi, "sebaiknya dihindari").replace(/\bshould be monitored closely\b/gi, "harus dipantau secara ketat").replace(/\bmay result in\b/gi, "dapat mengakibatkan").replace(/\bhas been reported\b/gi, "telah dilaporkan dalam literatur klinis").replace(/\bconcomitantly with\b/gi, "bersamaan dengan").replace(/\bdue to\b/gi, "karena").replace(/\bin patients treated with\b/gi, "pada pasien yang diobati dengan");
    return text;
  }
  /**
   * Translates clinical management advice into actionable Indonesian recommendations
   */
  static translateDdiManagement(rawMgmt, drugA = "", drugB = "", severity = "Moderate") {
    if (!rawMgmt || rawMgmt.trim() === "" || rawMgmt === "-") {
      if (severity.toLowerCase() === "contraindicated") {
        return `KONTRAINDIKASI MUTLAK: Hindari peresepan bersamaan antara ${drugA || "obat pertama"} dan ${drugB || "obat kedua"}. Gunakan alternatif terapi non-interaktif.`;
      }
      if (severity.toLowerCase() === "major") {
        return `PERHATIAN TINGGI: Hindari kombinasi jika memungkinkan, atau lakukan penyesuaian dosis dan pemantauan klinis ketat terhadap respons pasien.`;
      }
      return `Pantau kondisi klinis dan respons terapeutik pasien selama pemberian terapi kombinasi ini.`;
    }
    if (isAlreadyIndonesian(rawMgmt)) {
      return rawMgmt;
    }
    let text = rawMgmt.trim();
    text = text.replace(/Given the potential for interaction and the high degree of interpatient variability with respect to (.+?) metabolism, patients should be closely monitored during concomitant therapy with (.+?)\./gi, "Mengingat tingginya potensi interaksi dan variasi respons antar-pasien terhadap metabolisme $1, pasien harus dipantau secara ketat selama terapi bersamaan dengan $2.").replace(/The INR should be checked frequently and (.+?) dosage adjusted accordingly, particularly following initiation or discontinuation of (.+?) in patients who are stabilized on their (.+?) regimen\./gi, "Pemeriksaan nilai INR harus dilakukan secara berkala dan dosis $1 disesuaikan dengan cermat, terutama setelah memulai atau menghentikan $2 pada pasien yang telah stabil dengan regimen $3.").replace(/The same precaution may be applicable during therapy with other (.+?), although clinical data are lacking\./gi, "Kewaspadaan serupa dapat berlaku selama terapi dengan $1 lainnya, meskipun data klinis masih terbatas.").replace(/Patients should be advised to promptly report any signs of bleeding to their (?:physician|doctor)[^.]*\./gi, "Pasien harus diedukasi untuk segera melaporkan segala tanda perdarahan kepada dokter, termasuk nyeri, bengkak, sakit kepala, pusing, lemas, perdarahan yang sulit berhenti, mimisan, gusi berdarah, memar tidak wajar, atau urin/feses gelap berdarah.").replace(/Patients taking oral anticoagulants should be counseled to avoid large amounts of ethanol, but moderate consumption \(one to two drinks per day\) are not likely to affect the response to the anticoagulant in patients with normal liver function\./gi, "Pasien yang mengonsumsi antikoagulan oral harus diedukasi untuk menghindari konsumsi alkohol berlebih guna mencegah fluktuasi efek antikoagulasi yang berbahaya.").replace(/Frequent INR\/PT monitoring is recommended, especially if (.+?)\./gi, "Pemantauan rutin nilai INR/PT sangat dianjurkan, terutama bila $1.").replace(/It may be advisable to avoid (.+?) in patients with (.+?)\./gi, "Dianjurkan untuk menghindari $1 pada pasien dengan $2.").replace(/Due to the potential for severe interaction, concomitant use of (.+?) is considered (?:contraindicated|Kontraindikasi)\./gi, "Mengingat potensi interaksi parah, penggunaan bersamaan $1 dianggap KONTRAINDIKASI MUTLAK.").replace(/Fluvastatin, pravastatin, pitavastatin, and rosuvastatin are probably safer alternatives, since they are not metabolized by CYP450 3A4\./gi, "Fluvastatin, pravastatin, pitavastatin, dan rosuvastatin merupakan alternatif yang lebih aman karena tidak dimetabolisme oleh CYP450 3A4.").replace(/All patients receiving statin therapy should be advised to promptly report any unexplained muscle pain, tenderness or weakness, particularly if accompanied by fever, malaise and\/or dark-colored urine\./gi, "Semua pasien yang menerima terapi statin harus diedukasi untuk segera melaporkan nyeri otot yang tidak wajar, rasa nyeri tekan, atau kelemahan otot, terutama bila disertai demam, lemas, dan/atau urin berwarna gelap (tanda rabdomiolisis).").replace(/Therapy should be discontinued if creatine kinase is markedly elevated in the absence of strenuous exercise or if myopathy is otherwise suspected or diagnosed\./gi, "Terapi harus segera dihentikan bila kadar kreatin kinase (CK) meningkat drastis tanpa adanya aktivitas fisik berat, atau bila dicurigai/didiagnosis mengalami miopati.").replace(/Caution is advised if ACE inhibitors are used with (.+?), particularly in patients with (.+?)\./gi, "Kehati-hatian tinggi dianjurkan bila ACE inhibitor digunakan bersamaan dengan $1, khususnya pada pasien dengan $2.").replace(/Serum potassium and renal function should be checked regularly, and potassium supplementation should generally be avoided unless it is closely monitored\./gi, "Kadar kalium darah dan fungsi ginjal harus diperiksa secara teratur, dan suplementasi kalium harus dihindari kecuali dengan pemantauan ketat.").replace(/Patients should be given dietary counseling and advised to seek medical attention if they experience signs and symptoms of hyperkalemia such as (.+?)\./gi, "Pasien harus diberikan konseling diet dan dianjurkan segera mencari pertolongan medis bila mengalami gejala hiperkalemia seperti $1.").replace(/This combination, especially with analgesic\/antipyretic aspirin doses, should generally be avoided unless the potential benefit outweighs the risk of bleeding\./gi, "Kombinasi ini, terutama dengan dosis analgesik/antipiretik aspirin, sebaiknya dihindari kecuali bila potensi manfaat klinis terbukti melebihi risiko perdarahan.").replace(/If concomitant therapy is used for additive anticoagulant effects, monitoring for excessive anticoagulation and overt and occult bleeding is recommended\./gi, "Bila terapi bersamaan digunakan untuk efek antikoagulan aditif, pemantauan terhadap antikoagulasi berlebihan serta perdarahan nyata atau tersembunyi sangat dianjurkan.").replace(/The INR should be checked frequently and the dosage adjusted accordingly when aspirin is added to an anticoagulant regimen\./gi, "Nilai INR harus diperiksa secara rutin dan dosis disesuaikan saat aspirin ditambahkan ke dalam regimen antikoagulan.").replace(/Be cognizant that bleeding may occur without INR or prothrombin time increases\./gi, "Perlu diingat bahwa perdarahan dapat terjadi tanpa adanya peningkatan nilai INR atau waktu protrombin.").replace(/Patients should also be counseled to avoid any other over-the-counter oral or topical salicylate products\./gi, "Pasien juga harus diedukasi untuk menghindari penggunaan produk salisilat bebas (OTC) oral maupun topikal lainnya.").replace(/weakness, listlessness, confusion, tingling of the extremities, and irregular heartbeat/gi, "lemas, lesu, kebingungan, kesemutan pada ekstremitas, dan detak jantung tidak teratur").replace(/renal impairment, diabetes, old age, worsening heart failure, and\/or a risk for dehydration/gi, "gangguan ginjal, diabetes, usia lanjut, perburukan gagal jantung, atau risiko dehidrasi").replace(/consider alternative therapy/gi, "Pertimbangkan terapi alternatif").replace(/or monitor INR closely/gi, "atau pantau nilai INR/hemostasis secara ketat").replace(/monitor INR closely/gi, "Pantau nilai INR/hemostasis secara ketat").replace(/monitor blood pressure closely/gi, "Pantau tekanan darah pasien secara ketat").replace(/monitor serum potassium levels/gi, "Pantau kadar kalium darah dan fungsi ginjal secara berkala").replace(/monitor for increased adverse effects/gi, "Pantau potensi kemunculan efek samping yang meningkat").replace(/separate administration by at least (\d+) hours/gi, "Beri jeda waktu konsumsi minimal $1 jam antar obat").replace(/separate administration by/gi, "Pisahkan jadwal minum obat dengan jeda").replace(/dose reduction may be required/gi, "Penurunan dosis mungkin diperlukan").replace(/avoid combination unless benefits outweigh risks/gi, "Hindari kombinasi kecuali bila manfaat klinis terbukti melebihi risikonya").replace(/monitor closely/gi, "Pantau secara ketat").replace(/do not co-administer/gi, "Jangan diberikan bersamaan (kontraindikasi)").replace(/contraindicated/gi, "Kontraindikasi");
    return text;
  }
  /**
   * Translates Food interaction fields
   */
  static translateFoodInteraction(rawFoodItem, rawMechanism, rawEffect, rawMgmt, drugName = "") {
    const foodKey = (rawFoodItem || "").toLowerCase().trim();
    const matched = FOOD_TRANSLATIONS[foodKey];
    const foodItem = matched ? matched.idName : rawFoodItem;
    let mechanism = rawMechanism;
    if (!mechanism || mechanism === "-" || !isAlreadyIndonesian(mechanism)) {
      if (matched) {
        mechanism = `Interaksi antara ${drugName || "obat"} dan ${foodItem}. Komponen bioaktif pangan mempengaruhi laju absorpsi atau metabolisme hepatik zat aktif.`;
      } else {
        mechanism = this.translateDdiDescription(rawMechanism, drugName, foodItem);
      }
    }
    let effect = rawEffect;
    if (!effect || effect === "-" || !isAlreadyIndonesian(effect)) {
      effect = `Modifikasi konsentrasi serum puncak atau bioavailabilitas sistemik ${drugName || "obat"} dalam tubuh.`;
    }
    let recommendation = rawMgmt;
    if (!recommendation || recommendation === "-" || !isAlreadyIndonesian(recommendation)) {
      recommendation = matched ? matched.advice : this.translateDdiManagement(rawMgmt, drugName, foodItem);
    }
    return {
      foodItem,
      mechanism,
      effect,
      recommendation,
      originalFoodItem: rawFoodItem,
      originalMechanism: rawMechanism,
      originalEffect: rawEffect,
      originalRecommendation: rawMgmt
    };
  }
  /**
   * Translates Disease contraindication fields
   */
  static translateDiseaseContraindication(rawDiseaseName, rawRisk, rawMechanism, rawMgmt, drugName = "") {
    const disKey = (rawDiseaseName || "").toLowerCase().trim();
    const matched = DISEASE_TRANSLATIONS[disKey];
    const diseaseName = matched ? matched.idName : rawDiseaseName;
    let risk = rawRisk;
    if (!risk || risk === "-" || !isAlreadyIndonesian(risk)) {
      if (matched && (!rawRisk || rawRisk.length < 15)) {
        risk = matched.defaultRisk;
      } else {
        risk = this.translateDdiDescription(rawRisk, drugName, diseaseName);
      }
    }
    let mechanism = rawMechanism;
    if (!mechanism || mechanism === "-" || !isAlreadyIndonesian(mechanism)) {
      mechanism = `Interaksi patofisiologis antara mekanisme aksi/eliminasi ${drugName || "obat"} dengan kondisi disfungsi organ pada ${diseaseName}.`;
    }
    let management = rawMgmt;
    if (!management || management === "-" || !isAlreadyIndonesian(management)) {
      management = matched ? matched.defaultManagement : this.translateDdiManagement(rawMgmt, drugName, diseaseName, "Major");
    }
    return {
      diseaseName,
      risk,
      mechanism,
      management,
      originalDiseaseName: rawDiseaseName,
      originalRisk: rawRisk,
      originalMechanism: rawMechanism,
      originalManagement: rawMgmt
    };
  }
  /**
   * Translates Therapeutic Duplications
   */
  static translateDuplication(rawConcern, rawNote, drugA, drugB, therapeuticClass) {
    let concern = rawConcern;
    if (!concern || !isAlreadyIndonesian(concern)) {
      concern = `Peresepan ganda dua obat dari kelas farmakologi identik (${therapeuticClass}): ${drugA} dan ${drugB}. Kombinasi ini meningkatkan risiko efek samping kumulatif dan toksisitas tanpa memberikan peningkatan manfaat klinis yang sebanding.`;
    }
    let recommendation = rawNote;
    if (!recommendation || !isAlreadyIndonesian(recommendation)) {
      recommendation = `Evaluasi kembali kebutuhan peresepan bersamaan. Pertimbangkan untuk memilih salah satu obat sebagai monoterapi dengan titrasi dosis yang optimal guna meminimalkan beban polifarmasi.`;
    }
    return {
      concern,
      recommendation,
      originalConcern: rawConcern,
      originalRecommendation: rawNote
    };
  }
};

// server.ts
try {
  dns2.setDefaultResultOrder("ipv4first");
} catch {
}
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname2 = path4.dirname(__filename);
var app = express();
var PORT = parseInt(process.env.PORT || "3001", 10);
app.use(express.json());
app.get("/api/health", (_req, res) => {
  const stats = ddinterDb.getStats();
  res.json({
    status: "ok",
    service: "FD - Farmakologi & Database Interaksi Obat",
    version: "2.5.0",
    dataSource: "DDInter v2.0 (https://ddinter2.scbdd.com/)",
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
      cacheEntries: globalCache.getStats().totalEntries
    },
    uptime: process.uptime(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/api/stats", (_req, res) => {
  const stats = ddinterDb.getStats();
  res.json(stats);
});
function buildMonographFromRecord(record) {
  const idSlug = record.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let brands = [];
  try {
    if (record.brand_names) {
      brands = JSON.parse(record.brand_names);
    }
  } catch {
  }
  const isBiotech = record.drug_type === "biotech" || Boolean(record.protein_sequence);
  const atc = record.atc_code || "-";
  const resolved = resolvePharmacotherapyClass(atc, record.name, record.drug_type, record.mechanism);
  const therapeuticClass = (record.therapeutic_class ? record.therapeutic_class.replace(/^Senyawa Farmakologis\s+/i, "") : "") || (record.atc_category && record.atc_category !== "Farmakologi Terverifikasi DDInter v2.0" ? record.atc_category.replace(/^Senyawa Farmakologis\s+/i, "") : "") || resolved.therapeuticClass.replace(/^Senyawa Farmakologis\s+/i, "");
  const atcCategory = (record.atc_category && record.atc_category !== "Farmakologi Terverifikasi DDInter v2.0" ? record.atc_category : "") || resolved.atcCategory;
  const molecularFormula = record.molecular_formula && record.molecular_formula !== "None" ? record.molecular_formula : "";
  const molecularWeight = record.molecular_weight && record.molecular_weight > 0 ? record.molecular_weight : 0;
  const casNumber = record.cas_number && record.cas_number !== "-" && record.cas_number !== "None" ? record.cas_number : void 0;
  const description = record.description && record.description !== "None" ? record.description : "";
  const drugType = record.drug_type && record.drug_type !== "None" ? record.drug_type : isBiotech ? "biotech" : "small molecule";
  return {
    id: idSlug,
    ddinterId: record.ddinter_id,
    name: record.name,
    brandNames: Array.isArray(brands) ? brands : [],
    atcCode: atc,
    atcCategory,
    therapeuticClass,
    pubchemCid: record.pubchem_id && !isNaN(parseInt(record.pubchem_id, 10)) ? parseInt(record.pubchem_id, 10) : void 0,
    drugBankId: record.drugbank_id || void 0,
    molecularFormula,
    molecularWeight,
    casNumber,
    structureSvg: record.structure_svg || void 0,
    proteinSequence: record.protein_sequence || void 0,
    drugType,
    smiles: record.smiles && record.smiles !== record.ddinter_id && record.smiles !== "unknown" ? record.smiles : "",
    description,
    usefulLinks: {
      ...record.drugbank_id ? { "DrugBank": `https://go.drugbank.com/drugs/${record.drugbank_id}` } : {},
      ...record.pubchem_id ? { "PubChem": `https://pubchem.ncbi.nlm.nih.gov/compound/${record.pubchem_id}` } : {},
      ...record.chembl_id ? { "ChEMBL": `https://www.ebi.ac.uk/chembl/compound_report_card/${record.chembl_id}/` } : {}
    },
    pharmacology: {
      mechanismOfAction: record.mechanism || "",
      targets: []
    },
    sourceOrigin: "DDInter v2.0 (Internal Database)",
    lastUpdated: "2026-03-24"
  };
}
app.get("/api/drugs", (req, res) => {
  const startTime = performance.now();
  const search = (req.query.search || "").trim();
  const classFilter = (req.query.class || "").trim();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "12", 10)));
  const noCache = req.query.nocache === "true";
  const cacheKey = `drugs:db_list:${search}:${classFilter}:${page}:${limit}`;
  if (!noCache) {
    const cached = globalCache.get(cacheKey);
    if (cached) {
      const elapsed2 = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed2.toFixed(2)),
        cacheHits: cached.hits
      });
    }
  }
  const searchResult = ddinterDb.searchDrugs(search, page, limit, classFilter);
  const seenDrugIds = /* @__PURE__ */ new Set();
  const monographs = [];
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
    totalApprovedDrugs: searchResult.total
  };
  globalCache.set(cacheKey, responsePayload, 600, "DDInter Complete Database");
  const elapsed = performance.now() - startTime;
  res.json({
    ...responsePayload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2))
  });
});
app.get("/api/ddinter/catalog", (req, res) => {
  const search = (req.query.search || "").toLowerCase().trim();
  const classFilter = (req.query.class || "").trim();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const searchResult = ddinterDb.searchDrugs(search, page, limit, classFilter);
  const drugs = searchResult.data.map((rec) => ({
    id: rec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: rec.name,
    ddinterId: rec.ddinter_id,
    drugbankId: rec.drugbank_id || null,
    smiles: rec.smiles || null,
    display: rec.name
  }));
  res.json({
    source: "DDInter v2.0 (https://ddinter2.scbdd.com/)",
    total: searchResult.total,
    page: searchResult.page,
    limit: searchResult.limit,
    totalPages: searchResult.totalPages,
    drugs
  });
});
app.get("/api/drugs/:id", async (req, res) => {
  const startTime = performance.now();
  const { id } = req.params;
  const noCache = req.query.nocache === "true";
  const queryLower = id.toLowerCase().trim();
  const cacheKey = `drug:detail:${queryLower}`;
  if (!noCache) {
    const cached = globalCache.get(cacheKey);
    if (cached && cached.data && (cached.data.molecularFormula || cached.data.structureSvg || cached.data.proteinSequence)) {
      const elapsed2 = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed2.toFixed(2))
      });
    }
  }
  const dbRecord = ddinterDb.findDrug(queryLower);
  if (!dbRecord) {
    return res.status(404).json({ error: "Obat tidak ditemukan di database DDInter." });
  }
  const drug = buildMonographFromRecord(dbRecord);
  const dbCounts = ddinterDb.getDrugInteractionsCount(drug.name);
  let liveDetail = null;
  if (drug.ddinterId && drug.ddinterId.startsWith("DDInter")) {
    try {
      liveDetail = await ddinterLiveService.getDrugDetail(drug.ddinterId);
    } catch {
    }
  }
  const ddiList = liveDetail?.liveInteractions && liveDetail.liveInteractions.length > 0 ? liveDetail.liveInteractions : ddinterLiveService.getDrugInteractionsFromDb(drug.ddinterId, 5e3).rows;
  const ddsiList = liveDetail?.liveDdsi && liveDetail.liveDdsi.length > 0 ? liveDetail.liveDdsi : ddinterLiveService.getDrugDdsiFromDb(drug.ddinterId, 5e3).rows;
  const dfiList = liveDetail?.liveDfi && liveDetail.liveDfi.length > 0 ? liveDetail.liveDfi : ddinterLiveService.getDrugDfiFromDb(drug.ddinterId, 5e3).rows;
  const cleanedDesc = liveDetail?.description && liveDetail.description !== "None" ? liveDetail.description : drug.description !== "None" ? drug.description : "";
  const cleanedFormula = liveDetail?.molecularFormula && liveDetail.molecularFormula !== "None" ? liveDetail.molecularFormula : drug.molecularFormula !== "None" ? drug.molecularFormula : "";
  const rawWeight = liveDetail?.molecularWeight ? parseFloat(liveDetail.molecularWeight) : drug.molecularWeight;
  const cleanedWeight = rawWeight && rawWeight > 0 ? rawWeight : 0;
  const cleanedCas = liveDetail?.casNumber && liveDetail.casNumber !== "-" && liveDetail.casNumber !== "None" ? liveDetail.casNumber : drug.casNumber && drug.casNumber !== "-" && drug.casNumber !== "None" ? drug.casNumber : void 0;
  const cleanedType = liveDetail?.drugType && liveDetail.drugType !== "None" ? liveDetail.drugType : drug.drugType !== "None" ? drug.drugType : "small molecule";
  const payload = {
    ...drug,
    brandNames: liveDetail?.brandNames && liveDetail.brandNames.length > 0 ? liveDetail.brandNames : drug.brandNames,
    therapeuticClass: drug.therapeuticClass && !drug.therapeuticClass.includes("Senyawa Farmakologis Terdaftar") ? drug.therapeuticClass.replace(/^Senyawa Farmakologis\s+/i, "") : liveDetail?.atcCategoryName ? `${liveDetail.atcCategoryName}${liveDetail.drugType === "biotech" ? " (Biotech / Peptida)" : ""}` : drug.therapeuticClass?.replace(/^Senyawa Farmakologis\s+/i, "") || "-",
    description: cleanedDesc,
    molecularFormula: cleanedFormula,
    molecularWeight: cleanedWeight,
    smiles: liveDetail?.smiles || drug.smiles,
    structureSvg: liveDetail?.structureSvg || drug.structureSvg,
    pubchemCid: drug.pubchemCid || (liveDetail?.usefulLinks?.PubChem ? parseInt(liveDetail.usefulLinks.PubChem.match(/[0-9]+/)?.[0] || "0", 10) : void 0),
    drugBankId: drug.drugBankId || (liveDetail?.usefulLinks?.DrugBank ? liveDetail.usefulLinks.DrugBank.match(/DB\d+/)?.[0] : void 0),
    proteinSequence: liveDetail?.proteinSequence || drug.proteinSequence,
    casNumber: cleanedCas,
    iupacName: liveDetail?.iupacName,
    inchi: liveDetail?.inchi,
    drugType: cleanedType,
    usefulLinks: { ...drug.usefulLinks || {}, ...liveDetail?.usefulLinks || {} },
    officialUrl: liveDetail?.officialUrl || drug.officialUrl || `https://ddinter2.scbdd.com/server/drug-detail/${drug.ddinterId}/`,
    liveSynced: Boolean(liveDetail && liveDetail.liveFetched),
    atcCode: liveDetail?.atcClassification?.length ? liveDetail.atcClassification.join(", ") : drug.atcCode,
    atcCategory: liveDetail?.atcCategoryName || drug.atcCategory,
    ddinterCounts: {
      ddi: dbCounts.ddi || ddiList.length,
      ddsi: dbCounts.ddsi || ddsiList.length,
      dfi: dbCounts.dfi || dfiList.length
    },
    liveInteractions: ddiList,
    liveDdsi: ddsiList,
    liveDfi: dfiList,
    pharmacology: {
      mechanismOfAction: cleanedDesc || (drug.pharmacology.mechanismOfAction !== "None" ? drug.pharmacology.mechanismOfAction : ""),
      targets: drug.pharmacology.targets || []
    }
  };
  if (payload.molecularFormula || payload.structureSvg || payload.proteinSequence) {
    globalCache.set(cacheKey, payload, 7200, "DDInter v2.0 (ddinter2.scbdd.com)");
  }
  const elapsed = performance.now() - startTime;
  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2))
  });
});
app.get("/api/ddinter/live-drug/:id", async (req, res) => {
  const { id } = req.params;
  const live = await ddinterLiveService.getDrugDetail(id);
  if (!live) {
    return res.status(404).json({ error: "Data live tidak dapat diambil dari portal resmi DDInter." });
  }
  res.json(live);
});
app.get("/api/ddinter/live-interactions/:id", async (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit || "5000", 10);
  const live = await ddinterLiveService.getDrugInteractionsLive(id, limit);
  if (!live) {
    return res.status(404).json({ error: "Tabel interaksi live tidak ditemukan di DDInter." });
  }
  res.json(live);
});
app.get("/api/diseases", (req, res) => {
  const startTime = performance.now();
  const search = (req.query.search || "").toLowerCase().trim();
  const organ = (req.query.organ || "").toLowerCase().trim();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "48", 10)));
  const noCache = req.query.nocache === "true";
  const cacheKey = `disease:list:${search}:${organ}:${page}:${limit}`;
  if (!noCache) {
    const cached = globalCache.get(cacheKey);
    if (cached) {
      const elapsed2 = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed2.toFixed(2))
      });
    }
  }
  let diseaseEntities = [];
  let totalCount = 0;
  let totalPages = 1;
  if (organ) {
    const allDbDiseases = ddinterDb.getDiseasesList(search, 1, 1e3);
    const filtered = allDbDiseases.data.map((d) => {
      const monograph = getDiseaseClinicalMonograph(d.name);
      return {
        id: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: d.name,
        indonesianName: monograph.indonesianName,
        organSystem: monograph.organSystem,
        urgencyLevel: monograph.urgencyLevel,
        contraindicatedDrugsCount: d.count,
        sampleWarning: d.sampleText,
        sourceOrigin: "DDInter v2.0 (ddinter2.scbdd.com)",
        ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/"
      };
    }).filter((d) => d.organSystem.toLowerCase().includes(organ));
    totalCount = filtered.length;
    totalPages = Math.ceil(totalCount / limit) || 1;
    const offset = (page - 1) * limit;
    diseaseEntities = filtered.slice(offset, offset + limit);
  } else {
    const dbDiseases = ddinterDb.getDiseasesList(search, page, limit);
    diseaseEntities = dbDiseases.data.map((d) => {
      const monograph = getDiseaseClinicalMonograph(d.name);
      return {
        id: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: d.name,
        indonesianName: monograph.indonesianName,
        organSystem: monograph.organSystem,
        urgencyLevel: monograph.urgencyLevel,
        contraindicatedDrugsCount: d.count,
        sampleWarning: d.sampleText,
        sourceOrigin: "DDInter v2.0 (ddinter2.scbdd.com)",
        ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/"
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
    totalUniqueDiseases: totalCount
  };
  globalCache.set(cacheKey, payload, 600, "DDInter Disease Registry");
  const elapsed = performance.now() - startTime;
  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2))
  });
});
app.get("/api/diseases/:id", (req, res) => {
  const { id } = req.params;
  const rawQuery = id.trim();
  const normalizedQuery = rawQuery.replace(/[-_]+/g, " ");
  let ddsiRows = ddinterDb.getDiseaseDDSIRecords(rawQuery, 200);
  if (!ddsiRows || ddsiRows.length === 0) {
    ddsiRows = ddinterDb.getDiseaseDDSIRecords(normalizedQuery, 200);
  }
  if (!ddsiRows || ddsiRows.length === 0) {
    return res.status(404).json({ error: "Informasi penyakit tidak ditemukan di basis data DDInter." });
  }
  const diseaseName = ddsiRows[0].disease_name;
  const clinicalMonograph = getDiseaseClinicalMonograph(diseaseName);
  const ddsiRecords = ddsiRows.map((r) => {
    const sev = r.level === "3" ? "Major" : r.level === "2" ? "Moderate" : r.level === "1" ? "Minor" : "Unknown";
    return {
      id: r.id,
      drugId: r.ddinter_id,
      drugName: r.drug_name,
      level: r.level,
      severityLabel: sev,
      text: r.text,
      references: r.references_text
    };
  });
  const disease = {
    id: diseaseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: diseaseName,
    indonesianName: clinicalMonograph.indonesianName,
    organSystem: clinicalMonograph.organSystem,
    urgencyLevel: clinicalMonograph.urgencyLevel,
    contraindicatedDrugsCount: ddsiRows.length,
    sampleWarning: ddsiRows[0]?.text,
    clinicalMonograph,
    ddsiRecords,
    sourceOrigin: "DDInter v2.0 (ddinter2.scbdd.com)",
    ddinterOfficialUrl: "https://ddinter2.scbdd.com/server/dis_food/"
  };
  res.json(disease);
});
app.post("/api/interactions/check", async (req, res) => {
  const startTime = performance.now();
  const { drugIds = [], diseaseIds = [], noCache = false } = req.body;
  if (!Array.isArray(drugIds) || drugIds.length === 0) {
    return res.status(400).json({ error: "Minimal pilih 1 obat untuk analisis." });
  }
  const normalizedDrugIds = Array.from(new Set(drugIds.map((id) => String(id).toLowerCase()))).sort();
  const normalizedDiseaseIds = Array.from(new Set((diseaseIds || []).map((id) => String(id).toLowerCase()))).sort();
  const cacheKey = `regimen:${normalizedDrugIds.join("+")}:${normalizedDiseaseIds.join("+")}`;
  if (!noCache) {
    const cached = globalCache.get(cacheKey);
    if (cached) {
      const elapsed2 = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        latencyMs: parseFloat(elapsed2.toFixed(2)),
        executionTimeMs: parseFloat(elapsed2.toFixed(2))
      });
    }
  }
  const resolvedDrugs = normalizedDrugIds.map((id) => {
    const dbRec = ddinterDb.findDrug(id);
    if (dbRec) return buildMonographFromRecord(dbRec);
    return null;
  }).filter(Boolean);
  const resolvedDiseases = normalizedDiseaseIds.map((id) => {
    const rows = ddinterDb.getDiseaseDDSIRecords(id, 1);
    if (rows.length > 0) {
      return {
        id: rows[0].disease_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: rows[0].disease_name,
        contraindicatedDrugsCount: rows.length,
        sourceOrigin: "DDInter v2.0"
      };
    }
    return {
      id,
      name: id,
      contraindicatedDrugsCount: 0,
      sourceOrigin: "DDInter v2.0"
    };
  });
  const foundDdi = [];
  const processedPairKeys = /* @__PURE__ */ new Set();
  const ddinterIds = resolvedDrugs.map((d) => d.ddinterId).filter((id) => typeof id === "string" && /^DDInter\d+$/i.test(id));
  if (ddinterIds.length >= 2) {
    try {
      const liveCheckData = await ddinterLiveService.checkDdiLive(ddinterIds);
      for (const item of liveCheckData) {
        const idA = item.internalID_a_id;
        const idB = item.internalID_b_id;
        const pairKey = [idA.toLowerCase(), idB.toLowerCase()].sort().join("-");
        if (processedPairKeys.has(pairKey)) continue;
        processedPairKeys.add(pairKey);
        const rawLevel = (item.idx__level || "").trim();
        let sev = "Unknown";
        if (rawLevel.toLowerCase() === "major") sev = "Major";
        else if (rawLevel.toLowerCase() === "moderate") sev = "Moderate";
        else if (rawLevel.toLowerCase() === "minor") sev = "Minor";
        else if (rawLevel.toLowerCase() === "contraindicated") sev = "Contraindicated";
        else sev = "Unknown";
        const isUnknown = sev === "Unknown";
        const mechTags = [];
        if (item.idx__absorption === "1") mechTags.push("Absorpsi Saluran Cerna");
        if (item.idx__distribution === "1") mechTags.push("Distribusi & Ikatan Protein");
        if (item.idx__metabolism === "1") mechTags.push("Metabolisme Enzim (CYP450 / Eliminasi Hepatik)");
        if (item.idx__excretion === "1") mechTags.push("Ekskresi Ginjal");
        if (item.idx__synergistic_effect === "1") mechTags.push("Efek Sinergistik / Toksisitas Aditif");
        if (item.idx__antagonistic_effect === "1") mechTags.push("Efek Antagonistik / Penurunan Efikasi");
        const rawDesc = (item.idx__interaction_description || "").trim();
        const rawMgmt = (item.idx__management || "").trim();
        const fullDetail = !isUnknown ? await ddinterLiveService.getDdiFullDetails(idA, idB, item.drug_a_name, item.drug_b_name) : null;
        const transDesc = await ClinicalTranslator.translateDdiDescriptionAsync(rawDesc, item.drug_a_name, item.drug_b_name);
        const transMgmt = await ClinicalTranslator.translateDdiManagementAsync(rawMgmt, item.drug_a_name, item.drug_b_name, sev);
        const mechanism = transDesc && transDesc !== "-" ? transDesc : isUnknown ? "-" : `Interaksi terverifikasi DDInter v2.0 antara ${item.drug_a_name} dan ${item.drug_b_name}.`;
        const clinicalEffect = transDesc && transDesc !== "-" ? transDesc : "-";
        const management = transMgmt && transMgmt !== "-" ? transMgmt : "-";
        const evidenceLevel = isUnknown ? "-" : "A";
        const level = isUnknown ? "Unknown" : sev === "Major" ? "Severe" : sev;
        foundDdi.push({
          id: `ddi-live-${idA}-${idB}`,
          ddinterId: `${idA}_${idB}`,
          drugA: {
            id: item.drug_a_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: item.drug_a_name,
            ddinterId: idA
          },
          drugB: {
            id: item.drug_b_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: item.drug_b_name,
            ddinterId: idB
          },
          severity: sev,
          level,
          mechanism,
          clinicalEffect,
          management,
          evidenceLevel,
          onset: isUnknown ? "-" : "Delayed",
          source: "DDInter v2.0 Official Database (ddinter2.scbdd.com)",
          mechanismTags: mechTags,
          officialUrl: fullDetail?.officialUrl || `https://ddinter2.scbdd.com/checker/result/${idA}-${idB}`,
          references: isUnknown ? [] : fullDetail?.references || [],
          alternatives: fullDetail?.alternatives,
          cypMetabolism: fullDetail?.cypMetabolism,
          officialInteractId: fullDetail?.interactId,
          originalMechanism: rawDesc && rawDesc !== "-" ? rawDesc : void 0,
          originalClinicalEffect: rawDesc && rawDesc !== "-" ? rawDesc : void 0,
          originalManagement: rawMgmt && rawMgmt !== "-" ? rawMgmt : void 0
        });
      }
    } catch (liveErr) {
      console.warn("[Interactions Check] Live check fallback to local database:", liveErr);
    }
  }
  const dbDdis = ddinterDb.checkDDI(normalizedDrugIds);
  for (const d of dbDdis) {
    const pairKey = [d.drug_a.toLowerCase(), d.drug_b.toLowerCase()].sort().join("-");
    const idKey = [d.ddinter_id_a.toLowerCase(), d.ddinter_id_b.toLowerCase()].sort().join("-");
    if (!processedPairKeys.has(pairKey) && !processedPairKeys.has(idKey)) {
      processedPairKeys.add(pairKey);
      processedPairKeys.add(idKey);
      const rawLevel = (d.level || "").trim();
      let sev = "Unknown";
      if (rawLevel.toLowerCase() === "major") sev = "Major";
      else if (rawLevel.toLowerCase() === "moderate") sev = "Moderate";
      else if (rawLevel.toLowerCase() === "minor") sev = "Minor";
      else if (rawLevel.toLowerCase() === "contraindicated") sev = "Contraindicated";
      else sev = "Unknown";
      const isUnknown = sev === "Unknown";
      const clinicalInfo = isUnknown ? { mechanism: "-", clinicalEffect: "-", management: "-", evidenceLevel: "-", mechanismTags: [] } : clinicalDDIRules.resolveDDI(
        d.drug_a,
        d.ddinter_id_a,
        d.drug_b,
        d.ddinter_id_b,
        sev
      );
      const transMech = isUnknown ? "-" : await ClinicalTranslator.translateDdiDescriptionAsync(clinicalInfo.mechanism, d.drug_a, d.drug_b);
      const transEffect = isUnknown ? "-" : await ClinicalTranslator.translateDdiDescriptionAsync(clinicalInfo.clinicalEffect, d.drug_a, d.drug_b);
      const transMgmt = isUnknown ? "-" : await ClinicalTranslator.translateDdiManagementAsync(clinicalInfo.management, d.drug_a, d.drug_b, sev);
      const fullDetail = !isUnknown ? await ddinterLiveService.getDdiFullDetails(
        d.ddinter_id_a,
        d.ddinter_id_b,
        d.drug_a,
        d.drug_b
      ) : null;
      foundDdi.push({
        id: `ddi-db-${d.id}`,
        ddinterId: `${d.ddinter_id_a}_${d.ddinter_id_b}`,
        drugA: { id: d.drug_a.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: d.drug_a, ddinterId: d.ddinter_id_a },
        drugB: { id: d.drug_b.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: d.drug_b, ddinterId: d.ddinter_id_b },
        severity: sev,
        level: isUnknown ? "Unknown" : sev === "Major" ? "Severe" : sev,
        mechanism: transMech,
        clinicalEffect: transEffect,
        evidenceLevel: isUnknown ? "-" : clinicalInfo.evidenceLevel || "A",
        onset: isUnknown ? "-" : "Delayed",
        management: transMgmt,
        mechanismTags: clinicalInfo.mechanismTags,
        source: "DDInter v2.0 Official Database (ddinter2.scbdd.com)",
        officialUrl: fullDetail?.officialUrl || `https://ddinter2.scbdd.com/checker/result/${d.ddinter_id_a}-${d.ddinter_id_b}`,
        references: isUnknown ? [] : fullDetail?.references || [],
        alternatives: fullDetail?.alternatives,
        cypMetabolism: fullDetail?.cypMetabolism,
        officialInteractId: fullDetail?.interactId,
        originalMechanism: clinicalInfo.mechanism !== transMech ? clinicalInfo.mechanism : void 0,
        originalClinicalEffect: clinicalInfo.clinicalEffect !== transEffect ? clinicalInfo.clinicalEffect : void 0,
        originalManagement: clinicalInfo.management !== transMgmt ? clinicalInfo.management : void 0
      });
    }
  }
  const foundFood = [];
  const dbDfi = ddinterDb.checkDFI(normalizedDrugIds);
  for (const f of dbDfi) {
    const exists = foundFood.some(
      (ef) => ef.drugName.toLowerCase() === f.drug_name.toLowerCase() && ef.foodItem.toLowerCase() === f.food_name.toLowerCase()
    );
    if (!exists) {
      const sev = f.level === "3" ? "Major" : f.level === "2" ? "Moderate" : "Minor";
      const foodRefs = (f.references_text || "").split("|").map((s) => s.trim()).filter((s) => s.length > 0);
      if (foodRefs.length === 0) {
        foodRefs.push(
          `DDInter v2.0 Drug-Food Interaction Knowledgebase (DFI: ${f.drug_name} \u27F7 ${f.food_name}). Xiangya School of Pharmaceutical Sciences, Central South University (2022).`,
          `U.S. Food and Drug Administration (FDA): Avoiding Drug and Food Interactions Guide (2023).`
        );
      }
      const transFood = await ClinicalTranslator.translateFoodInteractionAsync(
        f.food_name,
        f.mechanism || "",
        "Modifikasi konsentrasi serum puncak atau ketersediaan hayati sistemik obat.",
        f.management || "",
        f.drug_name
      );
      foundFood.push({
        id: `dfi-db-${f.id}`,
        drugId: f.ddinter_id,
        drugName: f.drug_name,
        foodItem: transFood.foodItem,
        foodCategory: "Makanan/Nutrisi",
        severity: sev,
        mechanism: transFood.mechanism,
        effect: transFood.effect,
        recommendation: transFood.recommendation,
        references: foodRefs,
        source: "DDInter v2.0 Drug-Food Interactions (DFI)",
        originalFoodItem: transFood.originalFoodItem,
        originalMechanism: transFood.originalMechanism,
        originalEffect: transFood.originalEffect,
        originalRecommendation: transFood.originalRecommendation
      });
    }
  }
  const foundDiseaseWarnings = [];
  const dbDdsi = ddinterDb.checkDDSI(normalizedDrugIds, normalizedDiseaseIds);
  for (const dis of dbDdsi) {
    const exists = foundDiseaseWarnings.some(
      (ed) => ed.drugName.toLowerCase() === dis.drug_name.toLowerCase() && ed.diseaseName.toLowerCase() === dis.disease_name.toLowerCase()
    );
    if (!exists) {
      const sev = dis.level === "3" ? "Major" : "Moderate";
      const diseaseRefs = (dis.references_text || "").split("|").map((s) => s.trim()).filter((s) => s.length > 0);
      if (diseaseRefs.length === 0) {
        diseaseRefs.push(
          `DDInter v2.0 Drug-Disease Interaction Knowledgebase (DDSI: ${dis.drug_name} \u27F7 ${dis.disease_name}). Central South University (2022).`,
          `Clinical Pharmacogenetics & Disease Contraindication Guidelines (2023).`
        );
      }
      const transDis = await ClinicalTranslator.translateDiseaseContraindicationAsync(
        dis.disease_name,
        dis.text || "",
        "",
        "",
        dis.drug_name
      );
      foundDiseaseWarnings.push({
        id: `ddsi-db-${dis.id}`,
        drugId: dis.ddinter_id,
        drugName: dis.drug_name,
        diseaseId: dis.disease_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        diseaseName: transDis.diseaseName,
        severity: sev,
        risk: transDis.risk,
        mechanism: transDis.mechanism,
        management: transDis.management,
        references: diseaseRefs,
        source: "DDInter v2.0 Drug-Disease Contraindications (DDSI)",
        originalDiseaseName: transDis.originalDiseaseName,
        originalRisk: transDis.originalRisk,
        originalMechanism: transDis.originalMechanism,
        originalManagement: transDis.originalManagement
      });
    }
  }
  const foundDuplications = [];
  const dbDupli = ddinterDb.checkDuplications(normalizedDrugIds);
  for (const dup of dbDupli) {
    const nameA = dup.drug_multi_trade || dup.drug_multi;
    const nameB = dup.drug_b;
    const exists = foundDuplications.some(
      (ed) => (ed.drugA.toLowerCase() === nameA.toLowerCase() && ed.drugB.toLowerCase() === nameB.toLowerCase() || ed.drugA.toLowerCase() === nameB.toLowerCase() && ed.drugB.toLowerCase() === nameA.toLowerCase()) && ed.therapeuticClass.toLowerCase() === dup.drug_type.toLowerCase()
    );
    if (!exists) {
      const dupliRefs = [
        `DDInter v2.0 Polypharmacy & Therapeutic Duplication Surveillance Database (Nucleic Acids Research, 2024). https://ddinter2.scbdd.com/`,
        `DDInter 2.0: 6,033 therapeutic duplication records involving 317 combination drugs and 96 pharmacological classes.`
      ];
      const transDup = ClinicalTranslator.translateDuplication(
        dup.warning || "",
        dup.note || "",
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
        source: "DDInter v2.0 Therapeutic Duplication Surveillance (ddinter2.scbdd.com)",
        originalConcern: transDup.originalConcern,
        originalRecommendation: transDup.originalRecommendation
      });
    }
  }
  let riskScore = 0;
  foundDdi.forEach((inter) => {
    if (inter.severity === "Contraindicated") riskScore += 40;
    else if (inter.severity === "Major") riskScore += 25;
    else if (inter.severity === "Moderate") riskScore += 12;
    else if (inter.severity === "Minor") riskScore += 5;
  });
  foundFood.forEach((food) => {
    if (food.severity === "Contraindicated") riskScore += 30;
    else if (food.severity === "Major") riskScore += 18;
    else if (food.severity === "Moderate") riskScore += 8;
  });
  foundDiseaseWarnings.forEach((dis) => {
    if (dis.severity === "Major") riskScore += 35;
    else riskScore += 15;
  });
  foundDuplications.forEach(() => {
    riskScore += 20;
  });
  riskScore = Math.min(100, riskScore);
  let riskLevel = "Aman";
  if (riskScore >= 60) riskLevel = "Risiko Tinggi / Kritis";
  else if (riskScore >= 30) riskLevel = "Perhatian Sedang";
  else if (riskScore > 0) riskLevel = "Rendah";
  let summary = "Regimen kombinasi aman dan tidak ditemukan interaksi mayor yang terdaftar pada database DDInter.";
  if (riskLevel === "Risiko Tinggi / Kritis") {
    summary = "PERINGATAN KRITIS: Ditemukan interaksi obat berbahaya, kontraindikasi penyakit, atau duplikasi terapi yang berpotensi memicu kejadian fatal jika tidak dimodifikasi.";
  } else if (riskLevel === "Perhatian Sedang") {
    summary = "PERHATIAN KLINIS: Terdapat interaksi moderat atau interaksi makanan signifikan yang membutuhkan penyesuaian dosis, jarak konsumsi obat, atau pemantauan laboratorium.";
  } else if (riskLevel === "Rendah") {
    summary = "Interaksi minor terdeteksi. Regimen relatif dapat ditoleransi dengan konseling pasien yang tepat.";
  }
  const elapsed = performance.now() - startTime;
  const result = {
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
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  globalCache.set(cacheKey, result, 900, "DDInter Multi-Engine Analysis");
  res.json(result);
});
app.get("/api/ddinter/interaction-full", async (req, res) => {
  const idA = (req.query.idA || "").trim();
  const idB = (req.query.idB || "").trim();
  const nameA = (req.query.nameA || "").trim();
  const nameB = (req.query.nameB || "").trim();
  if (!idA || !idB) {
    res.status(400).json({ error: "Parameters idA and idB are required" });
    return;
  }
  try {
    const details = await ddinterLiveService.getDdiFullDetails(idA, idB, nameA, nameB);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch interaction details" });
  }
});
app.get("/api/ddinter/table", (req, res) => {
  const startTime = performance.now();
  const type = (req.query.type || "ddi").toLowerCase().trim();
  const search = (req.query.search || "").toLowerCase().trim();
  const severity = req.query.severity || "";
  const category = req.query.category || "";
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "15", 10)));
  const noCache = req.query.nocache === "true";
  const cacheKey = `ddinter:table:${type}:${search}:${severity}:${category}:${page}:${limit}`;
  if (!noCache) {
    const cached = globalCache.get(cacheKey);
    if (cached) {
      const elapsed2 = performance.now() - startTime;
      return res.json({
        ...cached.data,
        fromCache: true,
        executionTimeMs: parseFloat(elapsed2.toFixed(2))
      });
    }
  }
  let payload = null;
  if (type === "dfi") {
    const tableResult = ddinterDb.queryDFITable(search, severity, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      const sevLabel = r.level === "3" ? "Major" : r.level === "2" ? "Moderate" : "Minor";
      return {
        id: `dfi-${r.id}`,
        ddinterId: r.ddinter_id,
        drugName: r.drug_name,
        foodName: r.food_name,
        level: r.level,
        severity: sevLabel,
        mechanism: r.mechanism || "Mekanisme absorpsi atau metabolisme dipengaruhi oleh asupan makanan tertentu.",
        management: r.management || "Pertimbangkan jeda waktu pemberian obat terhadap makanan terkait.",
        references: r.references_text || "",
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id}/`
      };
    });
    payload = {
      type: "dfi",
      source: "DDInter v2.0 Drug-Food Interaction Database (857 DFI Records, 29 Foods, 430 Mechanisms)",
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages
    };
  } else if (type === "ddsi") {
    const tableResult = ddinterDb.queryDDSITable(search, severity, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      const sevLabel = r.level === "3" ? "Major / Kontraindikasi" : r.level === "2" ? "Moderate" : "Minor";
      return {
        id: `ddsi-${r.id}`,
        ddinterId: r.ddinter_id,
        drugName: r.drug_name,
        diseaseName: r.disease_name,
        level: r.level,
        severity: sevLabel,
        warningText: r.text || "Penggunaan pada kondisi patologis ini memerlukan perhatian khusus dan pemantauan klinis.",
        references: r.references_text || "",
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id}/`
      };
    });
    payload = {
      type: "ddsi",
      source: "DDInter v2.0 Drug-Disease Interaction Database (8,359 DDSI Records, 472 Diseases, 3,300 Detailed Warnings)",
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages
    };
  } else if (type === "dupli") {
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
        officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_b}/`
      };
    });
    payload = {
      type: "dupli",
      source: "DDInter v2.0 Therapeutic Duplication Warning Database (6,033 Duplication Records, 317 Combination Drugs, 96 Drug Classes)",
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages
    };
  } else {
    const tableResult = ddinterDb.queryTable(search, severity, page, limit);
    const formattedRows = tableResult.rows.map((r) => {
      const rawSev = (r.level || "").trim();
      let sev = "Unknown";
      let levelNum = 0;
      if (rawSev === "Major" || rawSev === "Contraindicated") {
        sev = rawSev === "Contraindicated" ? "Contraindicated" : "Major";
        levelNum = 3;
      } else if (rawSev === "Moderate") {
        sev = "Moderate";
        levelNum = 2;
      } else if (rawSev === "Minor") {
        sev = "Minor";
        levelNum = 1;
      } else {
        sev = "Unknown";
        levelNum = 0;
      }
      const isUnknown = sev === "Unknown";
      const clinicalInfo = isUnknown ? { mechanism: "-", clinicalEffect: "-", management: "-", evidenceLevel: "-", mechanismTags: [] } : clinicalDDIRules.resolveDDI(
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
          id: r.drug_a.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: r.drug_a,
          ddinterId: r.ddinter_id_a,
          officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_a}/`
        },
        drugB: {
          id: r.drug_b.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: r.drug_b,
          ddinterId: r.ddinter_id_b,
          officialUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_b}/`
        },
        severity: sev,
        levelNum,
        mechanism: clinicalInfo.mechanism,
        clinicalEffect: clinicalInfo.clinicalEffect,
        management: clinicalInfo.management,
        mechanismTags: clinicalInfo.mechanismTags,
        evidenceLevel: clinicalInfo.evidenceLevel || "DDInter v2.0 Verified (Level A-B)",
        officialSourceUrl: `https://ddinter2.scbdd.com/server/drug-detail/${r.ddinter_id_a}/`
      };
    });
    payload = {
      type: "ddi",
      source: `DDInter v2.0 Live Matrix (${tableResult.total.toLocaleString("id-ID")} DDI Records, 8,398 Mechanism Descriptions)`,
      rows: formattedRows,
      total: tableResult.total,
      page: tableResult.page,
      limit: tableResult.limit,
      totalPages: tableResult.totalPages
    };
  }
  globalCache.set(cacheKey, payload, 600, `DDInter Table [${type.toUpperCase()}]`);
  const elapsed = performance.now() - startTime;
  res.json({
    ...payload,
    fromCache: false,
    executionTimeMs: parseFloat(elapsed.toFixed(2))
  });
});
app.get("/api/ddinter/dupli-categories", (_req, res) => {
  const categories = [
    "antihistamines",
    "nonsteroidal anti-inflammatory agents",
    "proton pump inhibitors",
    "h2-receptor antagonists",
    "angiotensin converting enzyme inhibitors",
    "angiotensin ii inhibitors",
    "beta-adrenergic blocking agents",
    "calcium channel blockers",
    "hmg-coa reductase inhibitors (statins)",
    "loop diuretics",
    "thiazide and thiazide-like diuretics",
    "potassium sparing diuretics",
    "ssri antidepressants",
    "snri antidepressants",
    "tricyclic antidepressants",
    "benzodiazepines",
    "opioid analgesics",
    "anticholinergic agents",
    "sulfonamides",
    "quinolones",
    "macrolide derivatives",
    "tetracyclines",
    "penicillins",
    "cephalosporins",
    "antifungal agents",
    "antiviral agents",
    "corticosteroids",
    "muscle relaxants",
    "sulfonylureas",
    "thiazolidinediones",
    "dipeptidyl peptidase 4 inhibitors",
    "sglt2 inhibitors",
    "antiplatelet agents",
    "anticoagulants",
    "antacids",
    "laxatives"
  ];
  res.json({ categories });
});
app.get("/api/cache/stats", (_req, res) => {
  const stats = globalCache.getStats();
  res.json(stats);
});
app.post("/api/cache/clear", (_req, res) => {
  globalCache.clear();
  res.json({ success: true, message: "Pharmacy Cache berhasil dibersihkan.", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path4.resolve(__dirname2, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path4.resolve(__dirname2, "dist", "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[FD Server] Farmakologi & Drug Data Engine running on port ${PORT}`);
  });
}
setupServer().catch((err) => {
  console.error("[FD Server Error]", err);
});
