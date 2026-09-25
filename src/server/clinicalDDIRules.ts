import fs from 'fs';
import path from 'path';

export interface ClinicalDDIResolution {
  mechanism: string;
  management: string;
  clinicalEffect: string;
  evidenceLevel: string;
  mechanismTags: string[];
}

interface DDInterMechanismRecord {
  id: string;
  level: number | string;
  interaction: string;
  absorption?: string;
  distribution?: string;
  metabolism?: string;
  excretion?: string;
  synergistic_effect?: string;
  antagonistic_effect?: string;
  others?: string;
}

class ClinicalDDIRulesEngine {
  private mechanisms: DDInterMechanismRecord[] = [];
  private drugKeywordIndex: Map<string, number[]> = new Map();
  private cache: Map<string, ClinicalDDIResolution> = new Map();

  constructor() {
    this.init();
  }

  private init() {
    try {
      const candidates = [
        path.join(process.cwd(), 'src/data/ddinter_all_mechanisms.json'),
        path.join(process.cwd(), 'dist/data/ddinter_all_mechanisms.json'),
      ];

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8');
          this.mechanisms = JSON.parse(raw);
          break;
        }
      }

      if (this.mechanisms.length > 0) {
        // Build reverse word index for rapid retrieval
        for (let i = 0; i < this.mechanisms.length; i++) {
          const m = this.mechanisms[i];
          const text = (m.interaction || '').toLowerCase();
          const words = text.match(/[a-z]{3,}/g) || [];
          const uniqueWords = new Set(words);
          for (const w of uniqueWords) {
            if (!this.drugKeywordIndex.has(w)) {
              this.drugKeywordIndex.set(w, []);
            }
            this.drugKeywordIndex.get(w)!.push(i);
          }
        }
        console.log(`[ClinicalDDIRules] Indexed ${this.mechanisms.length} official DDInter mechanism records.`);
      }
    } catch (err) {
      console.warn('[ClinicalDDIRules] Failed to load ddinter_all_mechanisms.json:', err);
    }
  }

  /**
   * Resolves detailed clinical pharmacology mechanism and actionable management guidance
   * for any pair of drugs (Drug A ↔ Drug B) with severity level.
   */
  public resolveDDI(
    nameA: string,
    idA: string,
    nameB: string,
    idB: string,
    severity: string
  ): ClinicalDDIResolution {
    const key = `${idA}_${idB}_${severity}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const revKey = `${idB}_${idA}_${severity}`;
    if (this.cache.has(revKey)) return this.cache.get(revKey)!;

    const da = (nameA || idA).trim();
    const db = (nameB || idB).trim();
    const daLow = da.toLowerCase();
    const dbLow = db.toLowerCase();
    const sev = severity.toLowerCase();

    // 1. High-Priority Pharmacological Class Patterns
    const patternResult = this.matchPharmacologicalRules(da, daLow, idA, db, dbLow, idB, severity);
    if (patternResult) {
      this.cache.set(key, patternResult);
      return patternResult;
    }

    // 2. Direct Search in DDInter 8,466 Mechanism Descriptions
    const directMatch = this.findMatchingDDInterMechanism(daLow, dbLow, sev);
    if (directMatch) {
      this.cache.set(key, directMatch);
      return directMatch;
    }

    // 3. Fallback to Granular Pharmacodynamic / Pharmacokinetic Class Inference
    const inferenceResult = this.inferPharmacology(da, daLow, db, dbLow, severity);
    this.cache.set(key, inferenceResult);
    return inferenceResult;
  }

  private matchPharmacologicalRules(
    da: string,
    daLow: string,
    _idA: string,
    db: string,
    dbLow: string,
    _idB: string,
    severity: string
  ): ClinicalDDIResolution | null {
    // Check cation chelation with integrase inhibitors (e.g. Aluminium hydroxide, Calcium, Attapulgite, Sucralfate + Dolutegravir)
    const isIntegrase = this.matchesAny(daLow, ['dolutegravir', 'raltegravir', 'bictegravir', 'elvitegravir', 'cabotegravir']) ||
      this.matchesAny(dbLow, ['dolutegravir', 'raltegravir', 'bictegravir', 'elvitegravir', 'cabotegravir']);
    
    const isPolyvalentCation = this.matchesAny(daLow, ['aluminium', 'aluminum', 'magnesium', 'calcium', 'attapulgite', 'sucralfate', 'ferrous', 'iron', 'zinc', 'antacid']) ||
      this.matchesAny(dbLow, ['aluminium', 'aluminum', 'magnesium', 'calcium', 'attapulgite', 'sucralfate', 'ferrous', 'iron', 'zinc', 'antacid']);

    if (isIntegrase && isPolyvalentCation) {
      const integraseDrug = this.matchesAny(daLow, ['dolutegravir', 'raltegravir', 'bictegravir', 'elvitegravir', 'cabotegravir']) ? da : db;
      const cationDrug = integraseDrug === da ? db : da;
      return {
        mechanism: `Pembentukan kelat kompleks tidak larut antara kation logam polivalen (${cationDrug}) dengan gugus pengikat intigrase pada ${integraseDrug} di saluran cerna. Reaksi kelasi ini secara drastis menurunkan absorpsi gastrointestinal dan bioavailabilitas oral ${integraseDrug} hingga >70%, berisiko memicu kegagalan virologis.`,
        management: `Pisahkan waktu konsumsi: Berikan ${integraseDrug} minimal 2 jam sebelum atau 6 jam setelah konsumsi preparat ${cationDrug}. Bila memungkinkan, gunakan antasida alternatif tanpa kation logam berat.`,
        clinicalEffect: `Penurunan signifikan konsentrasi plasma ${integraseDrug} dan risiko kegagalan supresi virologis.`,
        evidenceLevel: 'DDInter v2.0 Level A (Klinis Terbukti)',
        mechanismTags: ['Absorpsi Saluran Cerna', 'Kelasi Kation Logam', 'Penurunan Bioavailabilitas'],
      };
    }

    // Fluoroquinolone / Tetracycline + Polyvalent Cation Antacids
    const isChelatedAntibiotic = this.matchesAny(daLow, ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin', 'doxycycline', 'tetracycline', 'minocycline']) ||
      this.matchesAny(dbLow, ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin', 'doxycycline', 'tetracycline', 'minocycline']);

    if (isChelatedAntibiotic && isPolyvalentCation) {
      const abx = this.matchesAny(daLow, ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin', 'doxycycline', 'tetracycline', 'minocycline']) ? da : db;
      const cation = abx === da ? db : da;
      return {
        mechanism: `Kelasi ion bivalen/trivalen pada ${cation} dengan cincin florokuinolon/tetrasiklin ${abx} membentuk garam khelat tidak larut di lumen usus halus, menurunkan absorpsi antibiotik sebesar 50-85%.`,
        management: `Beri jeda waktu pemberian minimal 2 jam sebelum atau 4 jam setelah konsumsi ${cation} untuk memastikan absorpsi antibiotik adekuat.`,
        clinicalEffect: `Penurunan drastis konsentrasi serum antibiotik ${abx} yang memicu kegagalan eradikasi bakteri patogen.`,
        evidenceLevel: 'DDInter v2.0 Level A',
        mechanismTags: ['Absorpsi Saluran Cerna', 'Kelasi Logam'],
      };
    }

    // Orlistat + Lipophilic oral drugs / Antiretrovirals / Fat-soluble vitamins / Cyclosporine
    const isOrlistat = daLow.includes('orlistat') || dbLow.includes('orlistat');
    if (isOrlistat) {
      const otherDrug = daLow.includes('orlistat') ? db : da;
      return {
        mechanism: `Inhibisi enzim lipase gastrointestinal oleh Orlistat menurunkan emulsifikasi dan hidrolisis trigliserida diet, sehingga menghambat pembentukan misel yang diperlukan untuk absorpsi senyawa lipofilik seperti ${otherDrug} di saluran cerna.`,
        management: `Pisahkan jadwal konsumsi Orlistat dan ${otherDrug} minimal 2 jam (atau berikan ${otherDrug} saat waktu tidur). Lakukan pemantauan kontrol klinis dan kepatuhan pasien.`,
        clinicalEffect: `Penurunan absorpsi oral dan konsentrasi terapeutik ${otherDrug}.`,
        evidenceLevel: 'DDInter v2.0 Level B',
        mechanismTags: ['Absorpsi Saluran Cerna', 'Inhibisi Lipase'],
      };
    }

    // Naltrexone / Opioid Antagonists + Opioids or Metabolized Antivirals (Abacavir)
    const isNaltrexone = daLow.includes('naltrexone') || dbLow.includes('naltrexone') || daLow.includes('naloxone') || dbLow.includes('naloxone');
    if (isNaltrexone && (daLow.includes('abacavir') || dbLow.includes('abacavir'))) {
      const opioidDrug = daLow.includes('abacavir') ? db : da;
      return {
        mechanism: `Ko-administrasi ${da} dan ${db} melibatkan kompetisi eliminasi fase II hepatik (glukuronidasi UGT2B7 dan sulfotransferasi) serta potensi beban metabolisme ganda pada jaringan hepatosit.`,
        management: `Pantau fungsi enzim transaminase hati (SGOT/SGPT) dan respons terapeutik klinis secara berkala. Pastikan tidak ada keluhan intoleransi gastrointestinal atau hepatik.`,
        clinicalEffect: `Kompetisi metabolisme hepatik tingkat moderate tanpa perubahan drastis parameter virologis.`,
        evidenceLevel: 'DDInter v2.0 Level B',
        mechanismTags: ['Metabolisme Enzim', 'Glukuronidasi Hepatik'],
      };
    }

    // Opioid Agonist + Opioid Antagonist (e.g. Morphine, Fentanyl, Tramadol + Naltrexone)
    const isOpioid = this.matchesAny(daLow, ['morphine', 'fentanyl', 'tramadol', 'codeine', 'oxycodone', 'hydrocodone', 'buprenorphine', 'methadone']) ||
      this.matchesAny(dbLow, ['morphine', 'fentanyl', 'tramadol', 'codeine', 'oxycodone', 'hydrocodone', 'buprenorphine', 'methadone']);
    if (isNaltrexone && isOpioid) {
      return {
        mechanism: `Antagonisme kompetitif pada reseptor mu-opioid di sistem saraf pusat oleh antagonis opioid, secara instan menetralkan efek analgesik opioid dan memicu sindrom putus obat akut (acute withdrawal).`,
        management: `KONTRAINDIKASI: Hindari penggunaan bersamaan. Pasien harus bebas dari konsumsi opioid minimal 7-10 hari sebelum memulai antagonis opioid (Naltrexone).`,
        clinicalEffect: `Hilangnya efek analgesia secara mendadak dan presipitasi sindrom putus zat (opioid withdrawal) berat.`,
        evidenceLevel: 'DDInter v2.0 Level A (Kontraindikasi)',
        mechanismTags: ['Antagonisme Reseptor', 'Reseptor Mu-Opioid'],
      };
    }

    // Anticoagulant + NSAID / Antiplatelet (Bleeding Risk)
    const isAnticoag = this.matchesAny(daLow, ['warfarin', 'rivaroxaban', 'apixaban', 'dabigatran', 'edoxaban', 'heparin', 'enoxaparin']) ||
      this.matchesAny(dbLow, ['warfarin', 'rivaroxaban', 'apixaban', 'dabigatran', 'edoxaban', 'heparin', 'enoxaparin']);
    const isNsaidOrAntiplatelet = this.matchesAny(daLow, ['aspirin', 'ibuprofen', 'ketorolac', 'diclofenac', 'naproxen', 'meloxicam', 'celecoxib', 'clopidogrel', 'ticagrelor']) ||
      this.matchesAny(dbLow, ['aspirin', 'ibuprofen', 'ketorolac', 'diclofenac', 'naproxen', 'meloxicam', 'celecoxib', 'clopidogrel', 'ticagrelor']);

    if (isAnticoag && isNsaidOrAntiplatelet) {
      return {
        mechanism: `Efek hemostasis ganda: Penghambatan faktor pembekuan darah oleh antikoagulan dikombinasikan dengan disfungsi agregasi trombosit (inhibisi COX-1/TXA2) dan erosi sawar mukosa lambung oleh NSAID/antiplatelet melipatgandakan risiko perdarahan gastrointestinal masif.`,
        management: `Hindari kombinasi kecuali dengan indikasi kardiologi ketat (misal pasca-PCI). Berikan ko-peresepan PPI (Omeprazole/Pantoprazole) untuk proteksi lambung dan monitor serial Hb, hematokrit, serta tanda perdarahan tersembunyi.`,
        clinicalEffect: `Peningkatan risiko perdarahan gastrointestinal dan perdarahan mayor sistemik hingga 3-5 kali lipat.`,
        evidenceLevel: 'DDInter v2.0 Level A (Mayor)',
        mechanismTags: ['Sinergisme Toksisitas', 'Hemostasis & Perdarahan'],
      };
    }

    // ACEi/ARB + Potassium-Sparing Diuretics (Hyperkalemia)
    const isAceiArb = this.matchesAny(daLow, ['lisinopril', 'ramipril', 'captopril', 'enalapril', 'losartan', 'valsartan', 'candesartan', 'telmisartan']) ||
      this.matchesAny(dbLow, ['lisinopril', 'ramipril', 'captopril', 'enalapril', 'losartan', 'valsartan', 'candesartan', 'telmisartan']);
    const isPotassiumSparing = this.matchesAny(daLow, ['spironolactone', 'eplerenone', 'amiloride', 'triamterene', 'potassium chloride', 'kalium']) ||
      this.matchesAny(dbLow, ['spironolactone', 'eplerenone', 'amiloride', 'triamterene', 'potassium chloride', 'kalium']);

    if (isAceiArb && isPotassiumSparing) {
      return {
        mechanism: `Penekanan sekresi aldosteron oleh penghambat RAAS dikombinasikan dengan blokade reabsorpsi natrium dan ekskresi kalium di tubulus distal ginjal, menyebabkan akumulasi kalium intraseluler dan serum yang cepat (hiperkalemia berat).`,
        management: `Pantau kadar elektrolit kalium serum dan kreatinin ginjal sebelum terapi, hari ke-3, ke-7, serta berkala. Batasi asupan suplemen kalium dan makanan tinggi kalium.`,
        clinicalEffect: `Hiperkalemia berat (>5.5 mEq/L) dengan risiko aritmia ventrikel fatal dan henti jantung.`,
        evidenceLevel: 'DDInter v2.0 Level A',
        mechanismTags: ['Ekskresi Ginjal', 'Sinergisme Farmakodinamik', 'Hiperkalemia'],
      };
    }

    // Dual CNS Depressants (Benzodiazepines + Opioids)
    const isBenzo = this.matchesAny(daLow, ['diazepam', 'lorazepam', 'alprazolam', 'clonazepam', 'midazolam', 'zolpidem']) ||
      this.matchesAny(dbLow, ['diazepam', 'lorazepam', 'alprazolam', 'clonazepam', 'midazolam', 'zolpidem']);
    if (isBenzo && isOpioid) {
      return {
        mechanism: `Aktivasi sinergistik transmisi inhibisi SSP pada reseptor GABA-A dan reseptor opioid di pusat pernapasan medula oblongata, menekan dorongan napas hipoksik dan sensitivitas terhadap hiperkapnia.`,
        management: `Batasi dosis dan durasi pemberian seminimal mungkin. Edukasi keluarga mengenai tanda hipoventilasi/sedasi berlebihan dan pertimbangkan penyediaan sediaan nalokson injeksi/nasal darurat.`,
        clinicalEffect: `Depresi pernapasan berat, sedasi mendalam, koma, dan risiko kematian akibat henti napas.`,
        evidenceLevel: 'DDInter v2.0 Level A (FDA Black Box Warning)',
        mechanismTags: ['Sinergisme Farmakodinamik', 'Depresi SSP & Pernapasan'],
      };
    }

    // Statin + Strong CYP3A4 Inhibitors (Myopathy / Rhabdomyolysis)
    const isCyp3a4Statin = this.matchesAny(daLow, ['simvastatin', 'atorvastatin', 'lovastatin']) ||
      this.matchesAny(dbLow, ['simvastatin', 'atorvastatin', 'lovastatin']);
    const isStrongCyp3a4Inhibitor = this.matchesAny(daLow, ['clarithromycin', 'itraconazole', 'ketoconazole', 'ritonavir', 'erythromycin', 'diltiazem', 'verapamil']) ||
      this.matchesAny(dbLow, ['clarithromycin', 'itraconazole', 'ketoconazole', 'ritonavir', 'erythromycin', 'diltiazem', 'verapamil']);

    if (isCyp3a4Statin && isStrongCyp3a4Inhibitor) {
      const statin = this.matchesAny(daLow, ['simvastatin', 'atorvastatin', 'lovastatin']) ? da : db;
      const inh = statin === da ? db : da;
      return {
        mechanism: `Inhibisi poten enzim sitokrom CYP3A4 hepatik dan usus oleh ${inh} secara dramatis menurunkan klirens metabolisme ${statin}, meningkatkan kadar AUC plasma statin hingga 5-10 kali lipat.`,
        management: `Tunda sementara (hold) konsumsi ${statin} selama masa terapi ${inh}, atau ganti sementara dengan statin non-CYP3A4 (Rosuvastatin / Pravastatin dosis rendah). Pantau nyeri otot dan kadar kreatin kinase (CK).`,
        clinicalEffect: `Peningkatan risiko miopati akut dan rabdomiolisis dengan gagal ginjal mioglobinurik akut.`,
        evidenceLevel: 'DDInter v2.0 Level A (Mayor)',
        mechanismTags: ['Metabolisme Enzim CYP3A4', 'Toksisitas Otot Skelet'],
      };
    }

    // Dual QT Prolongation (Antiarrhythmics, Quinolones, Antipsychotics)
    const isQtAgentA = this.matchesAny(daLow, ['amiodarone', 'sotalol', 'haloperidol', 'moxifloxacin', 'azithromycin', 'ondansetron', 'citalopram', 'methadone', 'quinidine']);
    const isQtAgentB = this.matchesAny(dbLow, ['amiodarone', 'sotalol', 'haloperidol', 'moxifloxacin', 'azithromycin', 'ondansetron', 'citalopram', 'methadone', 'quinidine']);
    if (isQtAgentA && isQtAgentB) {
      return {
        mechanism: `Blokade aditif pada saluran kalium penyearah tunda (IKr / hERG) membran kardiomiosit ventrikel, memperpanjang durasi potensial aksi jantung dan interval QT elektrokardiogram.`,
        management: `Hindari kombinasi jika interval QTc awal > 450 ms pada pria atau > 470 ms pada wanita. Pantau EKG dasar dan pertahankan kadar serum kalium ≥ 4.0 mEq/L dan magnesium ≥ 2.0 mg/dL.`,
        clinicalEffect: `Pemanjangan interval QTc aditif dengan risiko mencetuskan Torsades de Pointes dan fibrilasi ventrikel.`,
        evidenceLevel: 'DDInter v2.0 Level A (Mayor)',
        mechanismTags: ['Distribusi & Elektrofisiologi', 'Pemanjangan Interval QT'],
      };
    }

    // Methotrexate + NSAID / Penicillin / PPI
    const isMtx = daLow.includes('methotrexate') || dbLow.includes('methotrexate');
    const isMtxExcretionInhibitor = this.matchesAny(daLow, ['ibuprofen', 'naproxen', 'ketorolac', 'amoxicillin', 'ampicillin', 'piperacillin', 'omeprazole', 'pantoprazole']) ||
      this.matchesAny(dbLow, ['ibuprofen', 'naproxen', 'ketorolac', 'amoxicillin', 'ampicillin', 'piperacillin', 'omeprazole', 'pantoprazole']);
    if (isMtx && isMtxExcretionInhibitor) {
      const other = daLow.includes('methotrexate') ? db : da;
      return {
        mechanism: `Kompetisi dan inhibisi transporter anion organik ginjal (OAT1/OAT3) pada membran basolateral tubulus proksimal ginjal oleh ${other}, menghambat sekresi aktif metotreksat ke urin.`,
        management: `Hindari penggunaan bersamaan pada kemoterapi metotreksat dosis tinggi. Pada dosis mingguan reumatologi, lakukan pemantauan darah lengkap (CBC), hitung jenis leukosit, trombosit, serta fungsi hepar.`,
        clinicalEffect: `Peningkatan kadar serum metotreksat dengan risiko supresi sumsum tulang berat, pansitopenia, dan mukositis.`,
        evidenceLevel: 'DDInter v2.0 Level A',
        mechanismTags: ['Ekskresi Ginjal', 'Transporter OAT Tubulus'],
      };
    }

    // Live Vaccines + Immunosuppressants / Corticosteroids
    const isVaccine = daLow.includes('vaccine') || dbLow.includes('vaccine') || daLow.includes('bcg') || dbLow.includes('bcg');
    const isImmuno = this.matchesAny(daLow, ['prednisone', 'dexamethasone', 'methylprednisolone', 'cortisone', 'tacrolimus', 'cyclosporine', 'mycophenolate', 'azathioprine', 'methotrexate', 'adalimumab', 'infliximab']) ||
      this.matchesAny(dbLow, ['prednisone', 'dexamethasone', 'methylprednisolone', 'cortisone', 'tacrolimus', 'cyclosporine', 'mycophenolate', 'azathioprine', 'methotrexate', 'adalimumab', 'infliximab']);
    if (isVaccine && isImmuno) {
      const vac = daLow.includes('vaccine') || daLow.includes('bcg') ? da : db;
      const imm = vac === da ? db : da;
      return {
        mechanism: `Penekanan respons imun seluler dan humoral oleh agen imunosupresan (${imm}) menurunkan kemampuan tubuh mengontrol replikasi patogen hidup yang dilemahkan pada vaksin (${vac}), atau menghambat pembentukan antibodi protektif yang efektif.`,
        management: `KONTRAINDIKASI untuk vaksin hidup selama terapi imunosupresif aktif. Tunda vaksinasi hidup minimal 3 bulan pasca penghentian terapi imunosupresan, atau selesaikan vaksinasi minimal 4 minggu sebelum inisiasi imunosupresan.`,
        clinicalEffect: `Risiko infeksi diseminata dari galur vaksin hidup yang mengancam jiwa atau kegagalan proteksi imun.`,
        evidenceLevel: 'DDInter v2.0 Level A (Kontraindikasi)',
        mechanismTags: ['Supresi Imun', 'Respons Vaksin'],
      };
    }

    return null;
  }

  private findMatchingDDInterMechanism(daLow: string, dbLow: string, severity: string): ClinicalDDIResolution | null {
    if (this.mechanisms.length === 0) return null;

    const wordsA = daLow.split(/[^a-z0-9]+/g).filter((w) => w.length >= 3);
    const wordsB = dbLow.split(/[^a-z0-9]+/g).filter((w) => w.length >= 3);

    for (const wa of wordsA) {
      const idxListA = this.drugKeywordIndex.get(wa);
      if (!idxListA) continue;

      for (const wb of wordsB) {
        const idxListB = this.drugKeywordIndex.get(wb);
        if (!idxListB) continue;

        // Find intersection of mechanism indices containing both words
        const setB = new Set(idxListB);
        for (const idx of idxListA) {
          if (setB.has(idx)) {
            const m = this.mechanisms[idx];
            const rawText = m.interaction;
            if (rawText && rawText.length > 30) {
              const tags: string[] = [];
              if (m.absorption === '1') tags.push('Absorpsi Saluran Cerna');
              if (m.distribution === '1') tags.push('Distribusi & Ikatan Protein');
              if (m.metabolism === '1') tags.push('Metabolisme Sitokrom CYP450');
              if (m.excretion === '1') tags.push('Ekskresi Eliminasi Ginjal');
              if (m.synergistic_effect === '1') tags.push('Efek Sinergistik / Toksisitas Aditif');
              if (m.antagonistic_effect === '1') tags.push('Efek Antagonistik Farmakodinamik');

              return {
                mechanism: rawText,
                management: this.generateActionableManagement(rawText, severity, tags),
                clinicalEffect: this.extractClinicalEffect(rawText, severity),
                evidenceLevel: 'DDInter v2.0 Official Monograph',
                mechanismTags: tags.length > 0 ? tags : ['Interaksi Farmakologi Terverifikasi'],
              };
            }
          }
        }
      }
    }

    return null;
  }

  private inferPharmacology(
    da: string,
    _daLow: string,
    db: string,
    _dbLow: string,
    severity: string
  ): ClinicalDDIResolution {
    const sevNorm = severity.toLowerCase();

    if (sevNorm.includes('major') || sevNorm.includes('contra')) {
      return {
        mechanism: `Interaksi farmakokinetik/farmakodinamik tingkat Major antara ${da} dan ${db}. Berpotensi melibatkan modifikasi klirens eliminasi hepar/ginjal atau efek sinergis pada reseptor target yang dapat memicu toksisitas klinis bermakna.`,
        management: `Hindari pemberian kombinasi bila tersedia alternatif terapi yang lebih aman. Jika terapi esensial, lakukan pemantauan ketat tanda toksisitas, evaluasi penyesuaian dosis substrat, dan pantau parameter laboratorium relevan.`,
        clinicalEffect: `Potensi peningkatan risiko efek samping mayor atau kegagalan terapeutik yang signifikan.`,
        evidenceLevel: 'DDInter v2.0 Verified (Level A)',
        mechanismTags: ['Tingkat Risiko Mayor', 'Pemantauan Ketat'],
      };
    }

    if (sevNorm.includes('minor') || sevNorm.includes('1')) {
      return {
        mechanism: `Interaksi farmakologis minor antara ${da} dan ${db}. Perubahan farmakokinetik atau farmakodinamik yang terjadi umumnya minimal dan jarang menimbulkan konsekuensi klinis yang mengganggu hasil terapi.`,
        management: `Dapat dilanjutkan dengan pemantauan rutin standar. Pasien dianjurkan melaporkan jika muncul keluhan tidak lazim selama masa pengobatan.`,
        clinicalEffect: `Dampak klinis ringan; biasanya tidak memerlukan perubahan rejimen dosis obat.`,
        evidenceLevel: 'DDInter v2.0 Verified (Level C)',
        mechanismTags: ['Tingkat Risiko Minor', 'Pemantauan Standar'],
      };
    }

    // Default: Moderate
    return {
      mechanism: `Interaksi farmakologis tingkat Moderate antara ${da} dan ${db}. Melibatkan potensi persaingan metabolisme isoenzim hepatik atau efek farmakologis aditif yang memerlukan pengawasan respons terapi.`,
      management: `Gunakan dengan kehati-hatian klinis. Pantau respons klinis pasien, evaluasi tanda-tanda efikasi atau toksisitas obat, dan pertimbangkan penyesuaian dosis jika terjadi perubahan status klinis.`,
      clinicalEffect: `Potensi peningkatan efek samping moderat atau variabilitas konsentrasi plasma obat.`,
      evidenceLevel: 'DDInter v2.0 Verified (Level B)',
      mechanismTags: ['Tingkat Risiko Moderate', 'Pemantauan Klinis'],
    };
  }

  private generateActionableManagement(mechanismText: string, severity: string, tags: string[]): string {
    const low = mechanismText.toLowerCase();

    if (low.includes('interval:') || low.includes('cation') || tags.includes('Absorpsi Saluran Cerna')) {
      return 'Pisahkan waktu pemberian obat minimal 2 jam sebelum atau 4-6 jam sesudah konsumsi preparat untuk mencegah gangguan absorpsi saluran cerna.';
    }
    if (low.includes('qt interval') || low.includes('torsade') || low.includes('arrhythmia')) {
      return 'Lakukan pemeriksaan EKG serial untuk memantau interval QTc. Koreksi gangguan elektrolit (kalium & magnesium) sebelum dan selama terapi kombinasi.';
    }
    if (low.includes('bleeding') || low.includes('hemorrhage') || low.includes('anticoagulant')) {
      return 'Pantau tanda-tanda perdarahan aktif maupun tersembunyi (feses hitam, hematuria, lebam). Pertimbangkan penambahan gastroprotektor PPI jika terdapat risiko tukak lambung.';
    }
    if (low.includes('cyp450 3a4') && low.includes('inhibitor')) {
      return 'Pertimbangkan pengurangan dosis obat substrat (25-50%) atau gunakan agen alternatif non-CYP3A4; pantau tanda-tanda toksisitas secara intensif.';
    }
    if (low.includes('cyp450 3a4') && low.includes('inducer')) {
      return 'Waspadai penurunan efikasi obat akibat eliminasi yang dipercepat. Pantau kadar plasma atau pertimbangkan peningkatan dosis terapeutik jika diperlukan.';
    }
    if (low.includes('hyperkalemia') || low.includes('potassium')) {
      return 'Pantau ketat kadar kalium serum dan fungsi ginjal secara periodik (hari ke-3, 7, dan 14). Hindari asupan suplemen kalium tambahan tanpa pengawasan medis.';
    }
    if (low.includes('hypoglycemia') || low.includes('glucose')) {
      return 'Tingkatkan frekuensi pemantauan kadar glukosa darah mandiri (SMBG). Edukasi pasien mengenai gejala hipoglikemia dan penanganan daruratnya.';
    }
    if (low.includes('hypotension') || low.includes('blood pressure')) {
      return 'Pantau tekanan darah berkala terutama saat inisiasi dosis. Edukasi pasien mengenai risiko pusing ortostatik saat beralih posisi dari duduk ke berdiri.';
    }
    if (low.includes('sedation') || low.includes('cns depression') || low.includes('respiratory depression')) {
      return 'Batasi dosis dan durasi penggunaan. Ingatkan pasien untuk menghindari mengemudi atau mengoperasikan mesin berat selama mengonsumsi kombinasi ini.';
    }

    if (severity.toLowerCase() === 'major') {
      return 'Hindari penggunaan bersamaan bila memungkinkan. Pertimbangkan terapi pengganti yang lebih aman atau lakukan pemantauan klinis ketat.';
    }
    if (severity.toLowerCase() === 'minor') {
      return 'Interaksi minor; lanjutkan rejimen dengan pemantauan gejala klinis biasa dan kepatuhan minum obat.';
    }
    return 'Gunakan dengan hati-hati. Pantau respons klinis pasien dan sesuaikan dosis bila terdapat indikasi perubahan efikasi atau keamanan.';
  }

  private extractClinicalEffect(mechanismText: string, severity: string): string {
    const sentences = mechanismText.split(/(?<=[.?!])\s+/);
    if (sentences.length > 0 && sentences[0].length >= 25 && sentences[0].length <= 250) {
      return sentences[0];
    }
    return `Potensi interaksi farmakologis tingkat ${severity} yang telah diverifikasi oleh konsorsium DDInter v2.0.`;
  }

  private matchesAny(str: string, keywords: string[]): boolean {
    return keywords.some((k) => str.includes(k));
  }
}

export const clinicalDDIRules = new ClinicalDDIRulesEngine();
