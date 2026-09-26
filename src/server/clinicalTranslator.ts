/**
 * Clinical Pharmacology Translation & Localization Engine
 * Specialized for DDInter 2.0 & DrugBank Interaction Screening
 *
 * Converts interaction descriptions, mechanisms, clinical effects, and
 * actionable management guidelines into accurate, professional Bahasa Indonesia.
 */

export interface TranslatedDDI {
  mechanism: string;
  clinicalEffect: string;
  management: string;
  originalMechanism?: string;
  originalClinicalEffect?: string;
  originalManagement?: string;
}

export interface TranslatedDFI {
  foodItem: string;
  mechanism: string;
  effect: string;
  recommendation: string;
  originalFoodItem?: string;
  originalMechanism?: string;
  originalEffect?: string;
  originalRecommendation?: string;
}

export interface TranslatedDDSI {
  diseaseName: string;
  risk: string;
  mechanism: string;
  management: string;
  originalDiseaseName?: string;
  originalRisk?: string;
  originalMechanism?: string;
  originalManagement?: string;
}

export interface TranslatedDuplication {
  concern: string;
  recommendation: string;
  originalConcern?: string;
  originalRecommendation?: string;
}

// Check if string contains predominantly Indonesian words
function isAlreadyIndonesian(text: string): boolean {
  if (!text || text.length < 5) return false;
  const indonesianTokens = [
    'dapat', 'meningkatkan', 'menurunkan', 'kombinasi', 'risiko', 'penggunaan',
    'bersamaan', 'karena', 'dengan', 'pada', 'pasien', 'adalah', 'atau',
    'penurunan', 'peningkatan', 'penghambatan', 'konsentrasi', 'darah', 'perdarahan',
    'hindari', 'pantau', 'pertimbangkan', 'dosis', 'efek', 'terapi'
  ];
  const lower = text.toLowerCase();
  let matches = 0;
  for (const token of indonesianTokens) {
    if (lower.includes(token)) matches++;
    if (matches >= 2) return true;
  }
  return false;
}

// Lexicon for specific clinical terms
const CLINICAL_LEXICON: Record<string, string> = {
  'coadministration of': 'Pemberian bersamaan antara',
  'co-administration of': 'Pemberian bersamaan antara',
  'coadministration with': 'Pemberian bersamaan dengan',
  'co-administration with': 'Pemberian bersamaan dengan',
  'concomitant use of': 'Penggunaan bersamaan antara',
  'concomitant administration of': 'Pemberian bersamaan antara',
  'concomitant use': 'penggunaan bersamaan',
  'may increase the risk of': 'dapat meningkatkan risiko terjadinya',
  'can increase the risk of': 'dapat meningkatkan risiko terjadinya',
  'may increase the serum concentration of': 'dapat meningkatkan konsentrasi serum darah',
  'can increase the serum concentration of': 'dapat meningkatkan konsentrasi serum darah',
  'the serum concentration of': 'Konsentrasi serum darah',
  'the metabolism of': 'Metabolisme senyawa',
  'can be decreased when combined with': 'dapat menurun / terhambat bila dikombinasikan dengan',
  'can be increased when combined with': 'dapat meningkat secara drastis bila dikombinasikan dengan',
  'can be decreased when it is combined with': 'dapat menurun bila dikombinasikan dengan',
  'can be increased when it is combined with': 'dapat meningkat bila dikombinasikan dengan',
  'the risk or severity of': 'Risiko atau tingkat keparahan',
  'the therapeutic efficacy of': 'Efikasi terapeutik dari',
  'can be decreased when used in combination with': 'dapat menurun bila digunakan dalam kombinasi dengan',
  'can be increased when used in combination with': 'dapat meningkat bila digunakan dalam kombinasi dengan',
  'bleeding': 'perdarahan (hemoragi)',
  'gastrointestinal bleeding': 'perdarahan saluran cerna (gastrointestinal)',
  'qtc prolongation': 'pemanjangan interval QTc jantung (risiko aritmia ventrikel)',
  'prolongation of the qt interval': 'pemanjangan interval QT jantung',
  'ventricular arrhythmias': 'aritmia ventrikel (torsades de pointes)',
  'hypotension': 'hipotensi (penurunan tekanan darah abnormal)',
  'severe hypotension': 'hipotensi berat',
  'hyperkalemia': 'hiperkalemia (kadar kalium darah tinggi yang berbahaya)',
  'hypokalemia': 'hipokalemia (kadar kalium darah rendah)',
  'hyponatremia': 'hiponatremia (kadar natrium darah rendah)',
  'sedation': 'sedasi mendalam',
  'somnolence': 'kantuk berlebih (somnolen)',
  'central nervous system depression': 'depresi sistem saraf pusat (SSP)',
  'respiratory depression': 'depresi pernapasan (hipoventilasi)',
  'nephrotoxicity': 'nefrotoksisitas (kerusakan fungsi ginjal)',
  'hepatotoxicity': 'hepatotoksisitas (kerusakan sel-sel hati)',
  'myopathy': 'miopati (nyeri/kelemahan otot)',
  'rhabdomyolysis': 'rabdomiolisis (kerusakan jaringan otot parah)',
  'serotonin syndrome': 'sindrom serotonin (toksisitas serotonergik akut)',
  'bradycardia': 'bradikardia (denyut jantung lambat abnormal)',
  'tachycardia': 'takikardia (denyut jantung cepat abnormal)',
  'hypoglycemia': 'hipoglikemia (penurunan drastis kadar gula darah)',
  'hyperglycemia': 'hiperglikemia (lonjakan kadar gula darah)',
  'adverse effects': 'efek samping yang merugikan',
  'adverse reactions': 'reaksi efek samping obat',
  'fatalities': 'kematian fatal',
  'seizures': 'kejang epileptiform',
  'toxicity': 'toksisitas sistemik',
  'potent inhibitors of': 'penghambat kuat dari',
  'potent inhibitor of': 'penghambat kuat dari',
  'potent cyp450 3a4 inhibitors': 'penghambat kuat CYP450 3A4',
  'potassium-sparing diuretics': 'diuretik hemat kalium',
  'potassium-sparing diuretic': 'diuretik hemat kalium',
  'potassium supplements': 'suplemen kalium',
  'potassium-containing salt substitutes': 'pengganti garam yang mengandung kalium',
  'angiotensin converting enzyme (ace) inhibitors': 'penghambat enzim pengubah angiotensin (ACE inhibitor)',
  'ace inhibitors': 'ACE inhibitor',
  'chronic heart failure': 'gagal jantung kronis',
  'congestive heart failure': 'gagal jantung kongestif',
  'excessive diuresis': 'diuresis berlebihan',
  'oral anticoagulants': 'antikoagulan oral',
  'oral anticoagulant': 'antikoagulan oral',
  'in patients on oral anticoagulants': 'pada pasien yang mengonsumsi antikoagulan oral',
  'in patients with': 'pada pasien dengan',
  'especially those associated with': 'khususnya yang disertai',
  'impaired renal function': 'gangguan fungsi ginjal',
  'may further raise': 'dapat semakin meningkatkan',
  'serum potassium levels': 'kadar kalium serum darah',
  'therapy with': 'terapi dengan',
  'should be administered cautiously in patients with or predisposed to': 'harus diberikan dengan sangat hati-hati pada pasien dengan atau yang rentan terhadap',
  'and serum potassium levels should be carefully monitored': 'dan kadar kalium serum harus dipantau secara cermat',
  'risk factors for the development of': 'faktor risiko timbulnya',
  'during ace inhibitor therapy include': 'selama terapi ACE inhibitor meliputi',
  'renal insufficiency': 'insufisiensi ginjal',
  'and lovastatin': 'maupun lovastatin',
  'or lovastatin': 'maupun lovastatin',
};

// Food item translation dictionary
const FOOD_TRANSLATIONS: Record<string, { idName: string; category: string; advice: string }> = {
  grapefruit: {
    idName: 'Grapefruit (Jeruk Bali Merah)',
    category: 'Buah/Jus',
    advice: 'Hindari konsumsi buah atau jus grapefruit selama terapi. Kandungan furanokumarin menghambat enzim CYP3A4 usus, meningkatkan bioavailabilitas obat ke tingkat toksik.',
  },
  'grapefruit juice': {
    idName: 'Jus Grapefruit (Jeruk Bali Merah)',
    category: 'Buah/Jus',
    advice: 'Hindari konsumsi jus grapefruit selama terapi karena menghambat metabolisme hepatik & usus.',
  },
  alcohol: {
    idName: 'Alkohol & Minuman Beralkohol',
    category: 'Alkohol',
    advice: 'Hindari konsumsi alkohol secara ketat. Alkohol dapat memperparah depresi sistem saraf pusat, memperberat beban hati, atau memicu iritasi lambung masif.',
  },
  'alcoholic beverages': {
    idName: 'Minuman Beralkohol',
    category: 'Alkohol',
    advice: 'Hindari semua jenis minuman beralkohol selama masa pengobatan.',
  },
  milk: {
    idName: 'Susu & Produk Olahan Susu (Dairy)',
    category: 'Susu/Kalsium',
    advice: 'Beri jeda waktu minimal 2 jam antara konsumsi susu dan obat. Ion kalsium dalam susu membentuk kelat tidak larut yang menghambat absorpsi obat di usus.',
  },
  'dairy products': {
    idName: 'Produk Susu & Olahannya (Keju, Yoghurt)',
    category: 'Susu/Kalsium',
    advice: 'Beri jeda konsumsi minimal 2-3 jam untuk menghindari pembentukan khelat kalsium.',
  },
  'high-calcium food': {
    idName: 'Makanan Berkalsium Tinggi',
    category: 'Susu/Kalsium',
    advice: 'Beri jeda konsumsi minimal 2 jam sebelum atau 4 jam setelah obat.',
  },
  'high-fat meal': {
    idName: 'Makanan Berlemak Tinggi',
    category: 'Makanan Berlemak',
    advice: 'Konsistensikan pola konsumsi makanan. Lemak tinggi dapat secara signifikan meningkatkan atau memperlambat laju absorpsi obat.',
  },
  'high fat meal': {
    idName: 'Makanan Berlemak Tinggi',
    category: 'Makanan Berlemak',
    advice: 'Konsistensikan pola konsumsi makanan untuk menjaga kadar terapeutik obat tetap stabil.',
  },
  caffeine: {
    idName: 'Kafein (Kopi, Teh, Minuman Berenergi)',
    category: 'Kafein',
    advice: 'Batasi asupan kafein. Metabolisme kafein dapat terhambat, memicu palpitasi jantung, insomnia, tremor, dan kegelisahan berlebih.',
  },
  coffee: {
    idName: 'Kopi / Minuman Berkafein',
    category: 'Kafein',
    advice: 'Batasi konsumsi kopi selama terapi untuk mencegah palpitasi dan stimulasi berlebih.',
  },
  'st. john\'s wort': {
    idName: 'St. John\'s Wort (Herbal Hypericum)',
    category: 'Herbal',
    advice: 'HINDARI penggunaan suplemen ini. St. John\'s Wort adalah penginduksi kuat CYP3A4 dan P-gp yang menurunkan kadar obat hingga terapi gagal.',
  },
  'st johns wort': {
    idName: 'St. John\'s Wort (Herbal)',
    category: 'Herbal',
    advice: 'Hindari suplemen herbal ini karena menurunkan efikasi obat secara drastis.',
  },
  tyramine: {
    idName: 'Makanan Tinggi Tiramina (Keju Tua, Fermentasi, Daging Asap)',
    category: 'Tiramina',
    advice: 'Patuhi diet rendah tiramina secara ketat untuk mencegah krisis hipertensi fatal.',
  },
  'tyramine-containing foods': {
    idName: 'Makanan Kaya Tiramina (Keju Tua, Tapai, Ekstrak Ragi)',
    category: 'Tiramina',
    advice: 'Hindari keju tua, makanan fermentasi, kecap kedelai, dan bir guna mencegah lonjakan tekanan darah berbahaya.',
  },
  'vitamin k-rich foods': {
    idName: 'Makanan Kaya Vitamin K (Bayam, Brokoli, Kale)',
    category: 'Sayuran Hijau',
    advice: 'Pertahankan asupan sayuran hijau tetap konsisten setiap hari. Fluktuasi asupan vitamin K mengubah efektivitas terapi antikoagulan (Warfarin).',
  },
  'vitamin k': {
    idName: 'Vitamin K / Sayuran Berdaun Hijau Tua',
    category: 'Sayuran Hijau',
    advice: 'Jaga konsistensi porsi konsumsi sayuran hijau agar efek antikoagulasi tidak terganggu.',
  },
  'potassium-rich foods': {
    idName: 'Makanan Tinggi Kalium (Pisang, Jeruk, Pengganti Garam)',
    category: 'Kalium',
    advice: 'Waspadai hiperkalemia. Batasi konsumsi pisang berlebih dan hindari garam diet berbasis kalium tanpa petunjuk dokter.',
  },
  'salt substitutes': {
    idName: 'Pengganti Garam (Garam Rendah Natrium / Kalium Klorida)',
    category: 'Kalium',
    advice: 'Hindari pengganti garam berbahan dasar kalium karena meningkatkan risiko hiperkalemia berat.',
  },
  food: {
    idName: 'Makanan Umum / Asupan Nutrisi',
    category: 'Makanan Umum',
    advice: 'Konsumsi obat sesuai anjuran (sebelum atau sesudah makan) secara konsisten setiap jadwal minum obat.',
  },
  'apple juice': {
    idName: 'Jus Apel',
    category: 'Buah/Jus',
    advice: 'Beri jeda minimal 4 jam. Senyawa flavonoid jus apel dapat menghambat polipeptida transporter OATP usus.',
  },
  'orange juice': {
    idName: 'Jus Jeruk',
    category: 'Buah/Jus',
    advice: 'Beri jeda minimal 4 jam dengan konsumsi obat untuk mencegah gangguan absorpsi pada transporter usus.',
  },
  'cranberry juice': {
    idName: 'Jus Cranberry',
    category: 'Buah/Jus',
    advice: 'Konsumsi secara wajar dan pantau parameter pembekuan darah atau efek gastrointestinal.',
  }
};

// Common Disease Translations
const DISEASE_TRANSLATIONS: Record<string, { idName: string; defaultRisk: string; defaultManagement: string }> = {
  'renal impairment': {
    idName: 'Gangguan / Gagal Ginjal (Renal Impairment)',
    defaultRisk: 'Penurunan laju filtrasi glomerulus (LFG) menyebabkan retensi dan akumulasi metabolit obat aktif, meningkatkan risiko nefrotoksisitas dan efek samping sistemik berat.',
    defaultManagement: 'Lakukan penyesuaian dosis berdasarkan klirens kreatinin (CrCl) atau estimasi LFG (eGFR). Pantau kreatinin serum dan elektrolit secara berkala.',
  },
  'chronic kidney disease': {
    idName: 'Penyakit Ginjal Kronis (CKD)',
    defaultRisk: 'Ekskresi obat melalui ginjal terhambat, memicu akumulasi obat, perburukan fungsi nefron, dan risiko asidosis atau hiperkalemia.',
    defaultManagement: 'Sesuaikan dosis terapi dengan fungsi ginjal terkini. Hindari agen nefrotoksik tambahan.',
  },
  'hepatic impairment': {
    idName: 'Gangguan Fungsi Hati (Hepatic Impairment)',
    defaultRisk: 'Penurunan kapasitas metabolisme sitokrom hepatik dan klirens empedu, melipatgandakan waktu paruh eliminasi dan bioavailabilitas obat.',
    defaultManagement: 'Gunakan dosis awal yang lebih rendah. Pantau enzim transaminase hati (SGOT/SGPT), bilirubin, dan tanda ensefalopati hepatik.',
  },
  'liver disease': {
    idName: 'Penyakit Hati Kronis / Sirosis',
    defaultRisk: 'Risiko dekompensasi hepatik, akumulasi obat dalam plasma, dan toksisitas hati sekunder.',
    defaultManagement: 'Pertimbangkan obat alternatif yang tidak dimetabolisme melalui hepar atau kurangi dosis hingga 50%.',
  },
  'heart failure': {
    idName: 'Gagal Jantung Kongestif (Heart Failure)',
    defaultRisk: 'Potensi retensi cairan, eksaserbasi kelebihan beban volume (volume overload), atau depresi kontraktilitas miokardium.',
    defaultManagement: 'Pantau ketat tanda kongesti perifer, ronkhi paru, perubahan berat badan harian, dan stabilitas hemodinamik.',
  },
  'hypertension': {
    idName: 'Hipertensi (Tekanan Darah Tinggi)',
    defaultRisk: 'Potensi peningkatan resistensi vaskular sistemik, vasokonstriksi, atau retensi natrium yang menetralkan efikasi antihipertensi.',
    defaultManagement: 'Pantau tekanan darah secara berkala. Hindari ko-peresepan zat yang menaikkan tensi darah.',
  },
  'diabetes mellitus': {
    idName: 'Diabetes Melitus (Kencing Manis)',
    defaultRisk: 'Perubahan sensitivitas insulin atau glukoneogenesis hepatik, berisiko memicu hiperglikemia tidak terkontrol atau menyamarkan gejala hipoglikemia.',
    defaultManagement: 'Pantau kadar gula darah kapiler harian. Sesuaikan dosis obat antidiabetes bila ditemukan fluktuasi glukosa signifikan.',
  },
  'asthma': {
    idName: 'Asma Bronkial / PPOK',
    defaultRisk: 'Risiko bronkospasme akut akibat blokade reseptor beta-2 adrenergik atau reaksi pseudoalergi pelepasan leukotrien.',
    defaultManagement: 'KONTRAINDIKASI untuk penyekat beta non-selektif dan hati-hati dengan NSAID. Pastikan inhaler bronkodilator darurat selalu tersedia.',
  },
  'peptic ulcer': {
    idName: 'Tukak Lambung / Ulkus Peptikum',
    defaultRisk: 'Penekanan sintesis prostaglandin mukosa gastrointestinal atau peningkatan keasaman lambung, memicu perdarahan saluran cerna aktif atau perforasi.',
    defaultManagement: 'Hindari kombinasi NSAID/kortikosteroid. Pertimbangkan proteksi lambung dengan inhibitor pompa proton (PPI) seperti Omeprazole bila terapi mutlak diperlukan.',
  },
  'gastrointestinal bleeding': {
    idName: 'Riwayat Perdarahan Saluran Cerna',
    defaultRisk: 'Presipitasi perdarahan ulang yang mengancam nyawa pada sawar mukosa lambung-usus.',
    defaultManagement: 'KONTRAINDIKASI relatif untuk antikoagulan dan antiinflamasi non-steroid. Evaluasi rasio manfaat-risiko secara komprehensif.',
  },
  'long qt syndrome': {
    idName: 'Sindrom Interval QT Panjang / Aritmia',
    defaultRisk: 'Penghambatan kanal ion kalium hERG miokard, memperpanjang repolarisasi ventrikel dan memicu aritmia fatal (Torsades de Pointes).',
    defaultManagement: 'Lakukan rekam EKG serial. Koreksi kelainan elektrolit (terutama kalium dan magnesium) sebelum terapi dimulai.',
  },
  'glaucoma': {
    idName: 'Glaukoma Sudut Tertutup',
    defaultRisk: 'Efek antikolinergik/midriasis dapat memblokir aliran keluar aqueous humor, memicu lonjakan tekanan intraokular akut yang merusak saraf optik.',
    defaultManagement: 'Hindari obat dengan profil antikolinergik kuat. Rujuk segera ke dokter spesialis mata bila timbul nyeri mata mendadak atau pandangan kabur.',
  },
  'pregnancy': {
    idName: 'Kehamilan (Pregnancy Risk)',
    defaultRisk: 'Potensi efek teratogenik pada organogenesis janin, gangguan perfusi plasenta, atau toksisitas perinatal.',
    defaultManagement: 'Verifikasi kategori keamanan kehamilan (FDA Pregnancy Category). Ganti ke lini obat yang telah terbukti aman untuk trimester kehamilan saat ini.',
  },
  'epilepsy': {
    idName: 'Epilepsi / Riwayat Kejang',
    defaultRisk: 'Penurunan ambang kejang (seizure threshold) di korteks serebri, memicu kekambuhan bangkitan konvulsif.',
    defaultManagement: 'Pantau frekuensi kejang. Pertimbangkan optimalisasi dosis antikonvulsan atau pilih obat dengan risiko prokonvulsan minimal.',
  },
  'hyperkalemia': {
    idName: 'Hiperkalemia (Kadar Kalium Serum Tinggi)',
    defaultRisk: 'Pemberian obat yang menahan kalium dapat memicu lonjakan kalium serum ke tingkat toksik (>5.5 mEq/L), berisiko aritmia jantung fatal atau henti jantung.',
    defaultManagement: 'KONTRAINDIKASI / PERHATIAN EKSTREM: Hindari pemberian kalium eksogen atau diuretik hemat kalium. Pantau kadar kalium darah dan rekam EKG secara berkala.',
  },
  'hypokalemia': {
    idName: 'Hipokalemia (Kadar Kalium Serum Rendah)',
    defaultRisk: 'Dapat memicu aritmia ventrikel serius dan memperparah toksisitas glikosida jantung (Digoxin).',
    defaultManagement: 'Koreksi kadar kalium serum sebelum memulai terapi.',
  },
};

export class ClinicalTranslator {
  private static translationCache: Map<string, string> = new Map();

  /**
   * Neural online translation with intelligent caching & resilience
   */
  public static async translateOnline(text: string): Promise<string> {
    if (!text || text.trim() === '' || text === '-') return text;
    const trimmed = text.trim();
    if (isAlreadyIndonesian(trimmed)) return trimmed;

    if (this.translationCache.has(trimmed)) {
      return this.translationCache.get(trimmed)!;
    }

    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translated = data[0].map((item: any) => item[0]).filter(Boolean).join('');
          if (translated && translated.trim().length > 0) {
            const polished = translated.trim();
            this.translationCache.set(trimmed, polished);
            return polished;
          }
        }
      }
    } catch {
      // Network timeout or offline - seamlessly falls back to offline engine
    }

    // Fallback to offline regex translator
    return this.translateDdiDescription(trimmed);
  }

  public static async translateDdiDescriptionAsync(rawDesc: string, drugA = '', drugB = ''): Promise<string> {
    if (!rawDesc || rawDesc.trim() === '' || rawDesc === '-') {
      return drugA && drugB
        ? `Interaksi farmakologis terverifikasi DDInter v2.0 antara ${drugA} dan ${drugB}.`
        : 'Interaksi farmakologis terverifikasi pada basis data DDInter v2.0.';
    }
    return this.translateOnline(rawDesc);
  }

  public static async translateDdiManagementAsync(rawMgmt: string, drugA = '', drugB = '', severity = 'Moderate'): Promise<string> {
    if (!rawMgmt || rawMgmt.trim() === '' || rawMgmt === '-') {
      return this.translateDdiManagement(rawMgmt, drugA, drugB, severity);
    }
    return this.translateOnline(rawMgmt);
  }

  public static async translateFoodInteractionAsync(
    rawFoodItem: string,
    rawMechanism: string,
    rawEffect: string,
    rawMgmt: string,
    drugName = ''
  ): Promise<TranslatedDFI> {
    const foodKey = (rawFoodItem || '').toLowerCase().trim();
    const matched = FOOD_TRANSLATIONS[foodKey];
    const foodItem = matched ? matched.idName : rawFoodItem;

    let mechanism = rawMechanism;
    if (matched) {
      mechanism = `Interaksi antara ${drugName || 'obat'} dan ${foodItem}. Komponen bioaktif pangan mempengaruhi laju absorpsi atau metabolisme hepatik zat aktif.`;
    } else if (rawMechanism && rawMechanism !== '-') {
      mechanism = await this.translateOnline(rawMechanism);
    }

    let effect = rawEffect;
    if (rawEffect && rawEffect !== '-' && !isAlreadyIndonesian(rawEffect)) {
      effect = await this.translateOnline(rawEffect);
    } else {
      effect = `Modifikasi konsentrasi serum puncak atau bioavailabilitas sistemik ${drugName || 'obat'} dalam tubuh.`;
    }

    let recommendation = rawMgmt;
    if (matched) {
      recommendation = matched.advice;
    } else if (rawMgmt && rawMgmt !== '-' && !isAlreadyIndonesian(rawMgmt)) {
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
      originalRecommendation: rawMgmt,
    };
  }

  public static async translateDiseaseContraindicationAsync(
    rawDiseaseName: string,
    rawRisk: string,
    rawMechanism: string,
    rawMgmt: string,
    drugName = ''
  ): Promise<TranslatedDDSI> {
    const disKey = (rawDiseaseName || '').toLowerCase().trim();
    const matched = DISEASE_TRANSLATIONS[disKey];
    const diseaseName = matched ? matched.idName : rawDiseaseName;

    let risk = rawRisk;
    if (matched && (!rawRisk || rawRisk.length < 15)) {
      risk = matched.defaultRisk;
    } else if (rawRisk && rawRisk !== '-') {
      risk = await this.translateOnline(rawRisk);
    }

    let mechanism = rawMechanism;
    if (rawMechanism && rawMechanism !== '-' && !isAlreadyIndonesian(rawMechanism)) {
      mechanism = await this.translateOnline(rawMechanism);
    } else {
      mechanism = `Interaksi patofisiologis antara mekanisme aksi/eliminasi ${drugName || 'obat'} dengan kondisi disfungsi organ pada ${diseaseName}.`;
    }

    let management = rawMgmt;
    if (matched && (!rawMgmt || rawMgmt.length < 15)) {
      management = matched.defaultManagement;
    } else if (rawMgmt && rawMgmt !== '-' && !isAlreadyIndonesian(rawMgmt)) {
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
      originalManagement: rawMgmt,
    };
  }

  /**
   * Translates interaction description / mechanism into professional Bahasa Indonesia
   */
  public static translateDdiDescription(rawDesc: string, drugA = '', drugB = ''): string {
    if (!rawDesc || rawDesc.trim() === '' || rawDesc === '-') {
      return drugA && drugB
        ? `Interaksi farmakologis terverifikasi DDInter v2.0 antara ${drugA} dan ${drugB}.`
        : 'Interaksi farmakologis terverifikasi pada basis data DDInter v2.0.';
    }

    if (isAlreadyIndonesian(rawDesc)) {
      return rawDesc;
    }

    let text = rawDesc.trim();

    // Pattern 1: The metabolism of [Drug] can be decreased when combined with [Drug].
    const metaDecMatch = text.match(/The metabolism of (.+?) can be decreased when combined with (.+?)\./i);
    if (metaDecMatch) {
      const da = metaDecMatch[1].trim();
      const db = metaDecMatch[2].trim();
      return `Metabolisme ${da} dapat dihambat atau menurun secara signifikan bila dikombinasikan dengan ${db}, yang berpotensi memicu akumulasi obat dan peningkatan risiko toksisitas.`;
    }

    // Pattern 2: The metabolism of [Drug] can be increased when combined with [Drug].
    const metaIncMatch = text.match(/The metabolism of (.+?) can be increased when combined with (.+?)\./i);
    if (metaIncMatch) {
      const da = metaIncMatch[1].trim();
      const db = metaIncMatch[2].trim();
      return `Metabolisme ${da} dapat meningkat saat dikombinasikan dengan ${db} akibat induksi enzim hepar, yang berisiko mempercepat pembersihan obat dan menurunkan efektivitas terapeutik ${da}.`;
    }

    // Pattern 3: The serum concentration of [Drug] can be increased when it is combined with [Drug].
    const serumIncMatch = text.match(/The serum concentration of (.+?) can be increased when (?:it is )?combined with (.+?)\./i);
    if (serumIncMatch) {
      const da = serumIncMatch[1].trim();
      const db = serumIncMatch[2].trim();
      return `Konsentrasi serum darah ${da} dapat meningkat saat dikombinasikan dengan ${db}, memperbesar kemungkinan timbulnya efek samping dan reaksi toksik.`;
    }

    // Pattern 4: The serum concentration of [Drug] can be decreased when it is combined with [Drug].
    const serumDecMatch = text.match(/The serum concentration of (.+?) can be decreased when (?:it is )?combined with (.+?)\./i);
    if (serumDecMatch) {
      const da = serumDecMatch[1].trim();
      const db = serumDecMatch[2].trim();
      return `Konsentrasi serum darah ${da} dapat menurun bila dikombinasikan dengan ${db}, berpotensi menyebabkan kegagalan respons terapeutik.`;
    }

    // Pattern 5: The risk or severity of bleeding can be increased when [Drug] is combined with [Drug].
    const bleedMatch = text.match(/The risk or severity of bleeding can be increased when (.+?) is combined with (.+?)\./i);
    if (bleedMatch) {
      const da = bleedMatch[1].trim();
      const db = bleedMatch[2].trim();
      return `Risiko atau tingkat keparahan perdarahan (hemoragi) dapat meningkat drastis bila ${da} dikombinasikan dengan ${db} akibat efek hemostatik aditif.`;
    }

    // Pattern 6: The risk or severity of QTc prolongation can be increased when [Drug] is combined with [Drug].
    const qtMatch = text.match(/The risk or severity of (?:QTc|QT) prolongation can be increased when (.+?) is combined with (.+?)\./i);
    if (qtMatch) {
      const da = qtMatch[1].trim();
      const db = qtMatch[2].trim();
      return `Risiko pemanjangan interval QTc jantung dan aritmia ventrikel serius dapat meningkat jika ${da} digunakan bersamaan dengan ${db}.`;
    }

    // Pattern 7: The risk or severity of [Condition] can be increased when [Drug] is combined with [Drug].
    const condMatch = text.match(/The risk or severity of (.+?) can be increased when (.+?) is combined with (.+?)\./i);
    if (condMatch) {
      const condition = condMatch[1].trim();
      const da = condMatch[2].trim();
      const db = condMatch[3].trim();
      const idCond = CLINICAL_LEXICON[condition.toLowerCase()] || condition;
      return `Risiko atau tingkat keparahan ${idCond} dapat meningkat saat ${da} dikombinasikan dengan ${db}.`;
    }

    // Pattern 8: The therapeutic efficacy of [Drug] can be decreased when used in combination with [Drug].
    const effMatch = text.match(/The therapeutic efficacy of (.+?) can be decreased when used in combination with (.+?)\./i);
    if (effMatch) {
      const da = effMatch[1].trim();
      const db = effMatch[2].trim();
      return `Efikasi terapeutik ${da} dapat menurun bila digunakan bersamaan dengan ${db}.`;
    }

    // Pattern 9: Complex paragraph sentence replacements
    text = text
      .replace(/Coadministration with (.+?) may significantly increase the plasma concentrations and (.+?) of (.+?)\./gi, 'Pemberian bersamaan dengan $1 dapat secara signifikan meningkatkan konsentrasi plasma dan $2 dari $3.')
      .replace(/Coadministration with (.+?) may significantly increase the plasma concentrations of (.+?)\./gi, 'Pemberian bersamaan dengan $1 dapat secara signifikan meningkatkan konsentrasi plasma dari $2.')
      .replace(/The mechanism is (.+?) inhibition of CYP450 (\w+), the isoenzyme responsible for the metabolic clearance of (.+?)\./gi, 'Mekanismenya adalah penghambatan isoenzim CYP450 $2 oleh $1, yaitu enzim yang bertanggung jawab terhadap klirens metabolisme $3.')
      .replace(/Additionally, (.+?) inhibits CYP450 (\w+(?: and \w+)?), which are responsible for the metabolism of (.+?)\./gi, 'Selain itu, $1 juga menghambat CYP450 $2 yang bertanggung jawab terhadap metabolisme $3.')
      .replace(/The possibility of prolonged and\/or increased pharmacologic effects of (.+?) should be considered\./gi, 'Perlu diwaspadai kemungkinan perpanjangan atau peningkatan efek farmakologis dari $1.')
      .replace(/Severe adverse effects, including fatalities, have been reported following the administration of (.+?) to (.+?)\./gi, 'Efek samping yang parah, termasuk kematian fatal, telah dilaporkan menyusul pemberian $1 pada $2.')
      .replace(/The exact mechanism of interaction is unknown, but may involve additive effects on (.+?)\./gi, 'Mekanisme pasti interaksi belum diketahui, namun diduga melibatkan efek aditif pada $1.')
      .replace(/The proposed mechanism has not been fully established but may be related to (.+?)\./gi, 'Mekanisme yang diajukan belum sepenuhnya dipastikan, namun kemungkinan terkait dengan $1.')
      .replace(/The interaction has been reported with (.+?)\./gi, 'Interaksi ini telah dilaporkan terjadi dengan $1.')
      .replace(/Aspirin, even in small doses, (.+?) by inhibiting platelet aggregation, prolonging (.+?) time, and inducing gastrointestinal lesions\./gi, 'Aspirin, bahkan dalam dosis rendah, $1 dengan menghambat agregasi trombosit, memperpanjang waktu perdarahan, serta memicu lesi luka pada mukosa saluran cerna.')
      .replace(/Analgesic\/antipyretic doses of aspirin increase the risk of major (.+?) more than low-dose aspirin; however (.+?) has also occurred with low-dose aspirin\./gi, 'Dosis analgesik/antipiretik aspirin meningkatkan risiko perdarahan mayor lebih tinggi dibanding dosis rendah; namun perdarahan tetap dapat terjadi meski dengan aspirin dosis rendah.')
      .replace(/Inhibition of ACE results in decreased aldosterone secretion, which can lead to increases in serum potassium that may be additive with that induced by (.+?)\./gi, 'Penghambatan ACE menyebabkan penurunan sekresi aldosteron, yang memicu kenaikan kalium serum yang dapat bersifat aditif dengan efek dari $1.')
      .replace(/ACE inhibitors may also cause deterioration of renal function in patients with (.+?), and the risk is increased if they are sodium-depleted or dehydrated after (.+?)\./gi, 'ACE inhibitor juga dapat memicu perburukan fungsi ginjal pada pasien dengan $1, dan risiko meningkat bila pasien mengalami deplesi natrium atau dehidrasi setelah $2.')
      .replace(/and their active acid metabolites, all of which are primarily metabolized by the isoenzyme\./gi, 'serta metabolit asam aktifnya, yang semuanya terutama dimetabolisme oleh isoenzim tersebut.')
      .replace(/hypoprothrombinemic effect/gi, 'efek hipoprotrombinemik (pengenceran darah / peningkatan risiko perdarahan)')
      .replace(/the biologically more active (.+?) enantiomer of/gi, 'enansiomer $1 yang lebih aktif secara biologis dari')
      .replace(/which is primarily metabolized by the isoenzyme/gi, 'yang terutama dimetabolisme oleh isoenzim tersebut');

    // General phrase replacement with clinical lexicon
    for (const [enPhrase, idPhrase] of Object.entries(CLINICAL_LEXICON)) {
      const regex = new RegExp(`\\b${enPhrase}\\b`, 'gi');
      text = text.replace(regex, idPhrase);
    }

    // Replace lingering English sentence structures
    text = text
      .replace(/\bcan be increased\b/gi, 'dapat meningkat')
      .replace(/\bcan be decreased\b/gi, 'dapat menurun')
      .replace(/\bwhen combined with\b/gi, 'bila dikombinasikan dengan')
      .replace(/\bwhen used in combination with\b/gi, 'bila digunakan bersamaan dengan')
      .replace(/\bis combined with\b/gi, 'dikombinasikan dengan')
      .replace(/\bshould be avoided\b/gi, 'sebaiknya dihindari')
      .replace(/\bshould be monitored closely\b/gi, 'harus dipantau secara ketat')
      .replace(/\bmay result in\b/gi, 'dapat mengakibatkan')
      .replace(/\bhas been reported\b/gi, 'telah dilaporkan dalam literatur klinis')
      .replace(/\bconcomitantly with\b/gi, 'bersamaan dengan')
      .replace(/\bdue to\b/gi, 'karena')
      .replace(/\bin patients treated with\b/gi, 'pada pasien yang diobati dengan');

    return text;
  }

  /**
   * Translates clinical management advice into actionable Indonesian recommendations
   */
  public static translateDdiManagement(rawMgmt: string, drugA = '', drugB = '', severity = 'Moderate'): string {
    if (!rawMgmt || rawMgmt.trim() === '' || rawMgmt === '-') {
      if (severity.toLowerCase() === 'contraindicated') {
        return `KONTRAINDIKASI MUTLAK: Hindari peresepan bersamaan antara ${drugA || 'obat pertama'} dan ${drugB || 'obat kedua'}. Gunakan alternatif terapi non-interaktif.`;
      }
      if (severity.toLowerCase() === 'major') {
        return `PERHATIAN TINGGI: Hindari kombinasi jika memungkinkan, atau lakukan penyesuaian dosis dan pemantauan klinis ketat terhadap respons pasien.`;
      }
      return `Pantau kondisi klinis dan respons terapeutik pasien selama pemberian terapi kombinasi ini.`;
    }

    if (isAlreadyIndonesian(rawMgmt)) {
      return rawMgmt;
    }

    let text = rawMgmt.trim();

    // Specific management paragraph sentence patterns
    text = text
      .replace(/Given the potential for interaction and the high degree of interpatient variability with respect to (.+?) metabolism, patients should be closely monitored during concomitant therapy with (.+?)\./gi, 'Mengingat tingginya potensi interaksi dan variasi respons antar-pasien terhadap metabolisme $1, pasien harus dipantau secara ketat selama terapi bersamaan dengan $2.')
      .replace(/The INR should be checked frequently and (.+?) dosage adjusted accordingly, particularly following initiation or discontinuation of (.+?) in patients who are stabilized on their (.+?) regimen\./gi, 'Pemeriksaan nilai INR harus dilakukan secara berkala dan dosis $1 disesuaikan dengan cermat, terutama setelah memulai atau menghentikan $2 pada pasien yang telah stabil dengan regimen $3.')
      .replace(/The same precaution may be applicable during therapy with other (.+?), although clinical data are lacking\./gi, 'Kewaspadaan serupa dapat berlaku selama terapi dengan $1 lainnya, meskipun data klinis masih terbatas.')
      .replace(/Patients should be advised to promptly report any signs of bleeding to their (?:physician|doctor)[^.]*\./gi, 'Pasien harus diedukasi untuk segera melaporkan segala tanda perdarahan kepada dokter, termasuk nyeri, bengkak, sakit kepala, pusing, lemas, perdarahan yang sulit berhenti, mimisan, gusi berdarah, memar tidak wajar, atau urin/feses gelap berdarah.')
      .replace(/Patients taking oral anticoagulants should be counseled to avoid large amounts of ethanol, but moderate consumption \(one to two drinks per day\) are not likely to affect the response to the anticoagulant in patients with normal liver function\./gi, 'Pasien yang mengonsumsi antikoagulan oral harus diedukasi untuk menghindari konsumsi alkohol berlebih guna mencegah fluktuasi efek antikoagulasi yang berbahaya.')
      .replace(/Frequent INR\/PT monitoring is recommended, especially if (.+?)\./gi, 'Pemantauan rutin nilai INR/PT sangat dianjurkan, terutama bila $1.')
      .replace(/It may be advisable to avoid (.+?) in patients with (.+?)\./gi, 'Dianjurkan untuk menghindari $1 pada pasien dengan $2.')
      .replace(/Due to the potential for severe interaction, concomitant use of (.+?) is considered (?:contraindicated|Kontraindikasi)\./gi, 'Mengingat potensi interaksi parah, penggunaan bersamaan $1 dianggap KONTRAINDIKASI MUTLAK.')
      .replace(/Fluvastatin, pravastatin, pitavastatin, and rosuvastatin are probably safer alternatives, since they are not metabolized by CYP450 3A4\./gi, 'Fluvastatin, pravastatin, pitavastatin, dan rosuvastatin merupakan alternatif yang lebih aman karena tidak dimetabolisme oleh CYP450 3A4.')
      .replace(/All patients receiving statin therapy should be advised to promptly report any unexplained muscle pain, tenderness or weakness, particularly if accompanied by fever, malaise and\/or dark-colored urine\./gi, 'Semua pasien yang menerima terapi statin harus diedukasi untuk segera melaporkan nyeri otot yang tidak wajar, rasa nyeri tekan, atau kelemahan otot, terutama bila disertai demam, lemas, dan/atau urin berwarna gelap (tanda rabdomiolisis).')
      .replace(/Therapy should be discontinued if creatine kinase is markedly elevated in the absence of strenuous exercise or if myopathy is otherwise suspected or diagnosed\./gi, 'Terapi harus segera dihentikan bila kadar kreatin kinase (CK) meningkat drastis tanpa adanya aktivitas fisik berat, atau bila dicurigai/didiagnosis mengalami miopati.')
      .replace(/Caution is advised if ACE inhibitors are used with (.+?), particularly in patients with (.+?)\./gi, 'Kehati-hatian tinggi dianjurkan bila ACE inhibitor digunakan bersamaan dengan $1, khususnya pada pasien dengan $2.')
      .replace(/Serum potassium and renal function should be checked regularly, and potassium supplementation should generally be avoided unless it is closely monitored\./gi, 'Kadar kalium darah dan fungsi ginjal harus diperiksa secara teratur, dan suplementasi kalium harus dihindari kecuali dengan pemantauan ketat.')
      .replace(/Patients should be given dietary counseling and advised to seek medical attention if they experience signs and symptoms of hyperkalemia such as (.+?)\./gi, 'Pasien harus diberikan konseling diet dan dianjurkan segera mencari pertolongan medis bila mengalami gejala hiperkalemia seperti $1.')
      .replace(/This combination, especially with analgesic\/antipyretic aspirin doses, should generally be avoided unless the potential benefit outweighs the risk of bleeding\./gi, 'Kombinasi ini, terutama dengan dosis analgesik/antipiretik aspirin, sebaiknya dihindari kecuali bila potensi manfaat klinis terbukti melebihi risiko perdarahan.')
      .replace(/If concomitant therapy is used for additive anticoagulant effects, monitoring for excessive anticoagulation and overt and occult bleeding is recommended\./gi, 'Bila terapi bersamaan digunakan untuk efek antikoagulan aditif, pemantauan terhadap antikoagulasi berlebihan serta perdarahan nyata atau tersembunyi sangat dianjurkan.')
      .replace(/The INR should be checked frequently and the dosage adjusted accordingly when aspirin is added to an anticoagulant regimen\./gi, 'Nilai INR harus diperiksa secara rutin dan dosis disesuaikan saat aspirin ditambahkan ke dalam regimen antikoagulan.')
      .replace(/Be cognizant that bleeding may occur without INR or prothrombin time increases\./gi, 'Perlu diingat bahwa perdarahan dapat terjadi tanpa adanya peningkatan nilai INR atau waktu protrombin.')
      .replace(/Patients should also be counseled to avoid any other over-the-counter oral or topical salicylate products\./gi, 'Pasien juga harus diedukasi untuk menghindari penggunaan produk salisilat bebas (OTC) oral maupun topikal lainnya.')
      .replace(/weakness, listlessness, confusion, tingling of the extremities, and irregular heartbeat/gi, 'lemas, lesu, kebingungan, kesemutan pada ekstremitas, dan detak jantung tidak teratur')
      .replace(/renal impairment, diabetes, old age, worsening heart failure, and\/or a risk for dehydration/gi, 'gangguan ginjal, diabetes, usia lanjut, perburukan gagal jantung, atau risiko dehidrasi')
      .replace(/consider alternative therapy/gi, 'Pertimbangkan terapi alternatif')
      .replace(/or monitor INR closely/gi, 'atau pantau nilai INR/hemostasis secara ketat')
      .replace(/monitor INR closely/gi, 'Pantau nilai INR/hemostasis secara ketat')
      .replace(/monitor blood pressure closely/gi, 'Pantau tekanan darah pasien secara ketat')
      .replace(/monitor serum potassium levels/gi, 'Pantau kadar kalium darah dan fungsi ginjal secara berkala')
      .replace(/monitor for increased adverse effects/gi, 'Pantau potensi kemunculan efek samping yang meningkat')
      .replace(/separate administration by at least (\d+) hours/gi, 'Beri jeda waktu konsumsi minimal $1 jam antar obat')
      .replace(/separate administration by/gi, 'Pisahkan jadwal minum obat dengan jeda')
      .replace(/dose reduction may be required/gi, 'Penurunan dosis mungkin diperlukan')
      .replace(/avoid combination unless benefits outweigh risks/gi, 'Hindari kombinasi kecuali bila manfaat klinis terbukti melebihi risikonya')
      .replace(/monitor closely/gi, 'Pantau secara ketat')
      .replace(/do not co-administer/gi, 'Jangan diberikan bersamaan (kontraindikasi)')
      .replace(/contraindicated/gi, 'Kontraindikasi');

    return text;
  }

  /**
   * Translates Food interaction fields
   */
  public static translateFoodInteraction(
    rawFoodItem: string,
    rawMechanism: string,
    rawEffect: string,
    rawMgmt: string,
    drugName = ''
  ): TranslatedDFI {
    const foodKey = (rawFoodItem || '').toLowerCase().trim();
    const matched = FOOD_TRANSLATIONS[foodKey];

    const foodItem = matched ? matched.idName : rawFoodItem;

    let mechanism = rawMechanism;
    if (!mechanism || mechanism === '-' || !isAlreadyIndonesian(mechanism)) {
      if (matched) {
        mechanism = `Interaksi antara ${drugName || 'obat'} dan ${foodItem}. Komponen bioaktif pangan mempengaruhi laju absorpsi atau metabolisme hepatik zat aktif.`;
      } else {
        mechanism = this.translateDdiDescription(rawMechanism, drugName, foodItem);
      }
    }

    let effect = rawEffect;
    if (!effect || effect === '-' || !isAlreadyIndonesian(effect)) {
      effect = `Modifikasi konsentrasi serum puncak atau bioavailabilitas sistemik ${drugName || 'obat'} dalam tubuh.`;
    }

    let recommendation = rawMgmt;
    if (!recommendation || recommendation === '-' || !isAlreadyIndonesian(recommendation)) {
      recommendation = matched
        ? matched.advice
        : this.translateDdiManagement(rawMgmt, drugName, foodItem);
    }

    return {
      foodItem,
      mechanism,
      effect,
      recommendation,
      originalFoodItem: rawFoodItem,
      originalMechanism: rawMechanism,
      originalEffect: rawEffect,
      originalRecommendation: rawMgmt,
    };
  }

  /**
   * Translates Disease contraindication fields
   */
  public static translateDiseaseContraindication(
    rawDiseaseName: string,
    rawRisk: string,
    rawMechanism: string,
    rawMgmt: string,
    drugName = ''
  ): TranslatedDDSI {
    const disKey = (rawDiseaseName || '').toLowerCase().trim();
    const matched = DISEASE_TRANSLATIONS[disKey];

    const diseaseName = matched ? matched.idName : rawDiseaseName;

    let risk = rawRisk;
    if (!risk || risk === '-' || !isAlreadyIndonesian(risk)) {
      if (matched && (!rawRisk || rawRisk.length < 15)) {
        risk = matched.defaultRisk;
      } else {
        risk = this.translateDdiDescription(rawRisk, drugName, diseaseName);
      }
    }

    let mechanism = rawMechanism;
    if (!mechanism || mechanism === '-' || !isAlreadyIndonesian(mechanism)) {
      mechanism = `Interaksi patofisiologis antara mekanisme aksi/eliminasi ${drugName || 'obat'} dengan kondisi disfungsi organ pada ${diseaseName}.`;
    }

    let management = rawMgmt;
    if (!management || management === '-' || !isAlreadyIndonesian(management)) {
      management = matched
        ? matched.defaultManagement
        : this.translateDdiManagement(rawMgmt, drugName, diseaseName, 'Major');
    }

    return {
      diseaseName,
      risk,
      mechanism,
      management,
      originalDiseaseName: rawDiseaseName,
      originalRisk: rawRisk,
      originalMechanism: rawMechanism,
      originalManagement: rawMgmt,
    };
  }

  /**
   * Translates Therapeutic Duplications
   */
  public static translateDuplication(
    rawConcern: string,
    rawNote: string,
    drugA: string,
    drugB: string,
    therapeuticClass: string
  ): TranslatedDuplication {
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
      originalRecommendation: rawNote,
    };
  }
}
