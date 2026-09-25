/**
 * WHO ATC (Anatomical Therapeutic Chemical) Classification Engine
 * Maps official WHO ATC codes (Levels 1-4) and pharmaceutical stem rules
 * to precise pharmacotherapeutic classes (Kelas Farmakoterapi) and anatomical categories.
 */

export interface AtcClassResult {
  therapeuticClass: string;
  atcCategory: string;
  anatomicalGroup: string;
}

// 1. Level 1: Anatomical Main Groups
const ATC_LEVEL_1: Record<string, string> = {
  A: 'Saluran Pencernaan & Metabolisme (Alimentary Tract and Metabolism)',
  B: 'Darah & Organ Pembentuk Darah (Blood and Blood Forming Organs)',
  C: 'Sistem Kardiovaskular (Cardiovascular System)',
  D: 'Dermatologikal (Dermatologicals)',
  G: 'Sistem Genitourinari & Hormon Kelamin (Genito-Urinary System)',
  H: 'Preparat Hormon Sistemik (Systemic Hormonal Preparations)',
  J: 'Antiinfeksi untuk Penggunaan Sistemik (Antiinfectives for Systemic Use)',
  L: 'Agen Antineoplastik & Imunomodulasi (Antineoplastic and Immunomodulating)',
  M: 'Sistem Muskuloskeletal (Musculo-Skeletal System)',
  N: 'Sistem Saraf (Nervous System)',
  P: 'Produk Antiparasit & Insektisida (Antiparasitic Products)',
  R: 'Sistem Pernapasan (Respiratory System)',
  S: 'Organ Sensorik (Sensory Organs)',
  V: 'Agen Diagnostik & Lainnya (Various / Diagnostic Agents)',
};

// 2. Specific Level 3 & Level 4 Codes (Chemical & Therapeutic Subgroups)
const ATC_SUBGROUPS: Record<string, { class: string; category?: string }> = {
  // A - Alimentary Tract & Metabolism
  A02BA: { class: 'Antagonis Reseptor H2 (H2-Receptor Antagonists)', category: 'Obat Gangguan Asam Lambung' },
  A02BC: { class: 'Penghambat Pompa Proton / PPI (Proton Pump Inhibitors)', category: 'Obat Ulkus Peptikum & GERD' },
  A02BX: { class: 'Mukoprotektor & Obat Ulkus Lainnya', category: 'Obat Ulkus Peptikum' },
  A03AA: { class: 'Antispasmodik Antikolinergik Sintetis', category: 'Gangguan Saluran Cerna Fungsional' },
  A04AA: { class: 'Antiemetik Antagonis Reseptor Serotonin 5-HT3', category: 'Antiemetik dan Antinausea' },
  A06AB: { class: 'Laksatif Stimulan / Pencahar', category: 'Obat Konstipasi' },
  A06AD: { class: 'Laksatif Osmotik', category: 'Obat Konstipasi' },
  A07AA: { class: 'Antibiotik Intestinal Non-absorbable', category: 'Antidiare & Antiinfeksi Usus' },
  A07EC: { class: 'Asam Aminosalisilat / Antiinflamasi Intestinal', category: 'Penyakit Radang Usus (IBD)' },
  A10BA: { class: 'Antidiabetes Oral Golongan Biguanida (Biguanides)', category: 'Obat Diabetes Melitus' },
  A10BB: { class: 'Antidiabetes Oral Golongan Sulfonilurea', category: 'Obat Diabetes Melitus' },
  A10BF: { class: 'Penghambat Alfa-Glukosidase', category: 'Obat Diabetes Melitus' },
  A10BG: { class: 'Tiazolidindion / Agonis PPAR-gamma (Glitazones)', category: 'Obat Diabetes Melitus' },
  A10BH: { class: 'Penghambat Enzim DPP-4 (Gliptins)', category: 'Obat Diabetes Melitus' },
  A10BJ: { class: 'Agonis Reseptor GLP-1 (Incretin Mimetics)', category: 'Obat Diabetes Melitus' },
  A10BK: { class: 'Penghambat SGLT2 (Gliflozins)', category: 'Obat Diabetes Melitus' },
  A10AE: { class: 'Insulin Kerja Panjang & Analog', category: 'Insulin dan Analog' },
  A10AB: { class: 'Insulin Kerja Cepat / Rapid-acting', category: 'Insulin dan Analog' },

  // B - Blood & Blood Forming
  B01AA: { class: 'Antagonis Vitamin K / Antikoagulan Kumarin (Warfarin)', category: 'Agen Antitrombotik' },
  B01AB: { class: 'Heparin Berat Molekul Rendah (LMWH) & Heparinoid', category: 'Agen Antitrombotik' },
  B01AC: { class: 'Penghambat Agregasi Trombosit / Antiplatelet', category: 'Agen Antitrombotik' },
  B01AE: { class: 'Penghambat Trombin Direk (Direct Thrombin Inhibitors)', category: 'Antikoagulan Direk' },
  B01AF: { class: 'Penghambat Faktor Xa Direk / DOAC (Direct Factor Xa Inhibitors)', category: 'Antikoagulan Direk' },
  B02AA: { class: 'Agen Antifibrinolitik (Antifibrinolytic Amino Acids)', category: 'Antihemoragik' },
  B03AA: { class: 'Preparat Besi Bivalen Oral', category: 'Antianemia' },
  B03XA: { class: 'Agen Stimulasi Eritropoiesis / ESA', category: 'Antianemia' },
  B05XA: { class: 'Larutan Elektrolit & Pengatur Asam-Basa Intravena', category: 'Larutan Infus Intravena' },

  // C - Cardiovascular System
  C01AA: { class: 'Glikosida Jantung Digitalis (Digitalis Glycosides)', category: 'Terapi Gagal Jantung' },
  C01BD: { class: 'Antiaritmia Kelas III (Pemanjangan Potensial Aksi)', category: 'Obat Antiaritmia' },
  C01CA: { class: 'Agonis Adrenergik & Inotropik Positif', category: 'Stimulan Jantung' },
  C01DA: { class: 'Vasodilator Nitrat Organik (Antiangina)', category: 'Terapi Penyakit Jantung Iskemik' },
  C02CA: { class: 'Penyekat Alfa-1 Adrenoreseptor Perifer', category: 'Antihipertensi' },
  C03AA: { class: 'Diuretik Golongan Tiazid', category: 'Diuretik Antihipertensi' },
  C03CA: { class: 'Diuretik Loop / High-Ceiling Diuretics', category: 'Diuretik' },
  C03DA: { class: 'Antagonis Aldosteron / Diuretik Hemat Kalium', category: 'Diuretik' },
  C07AA: { class: 'Penyekat Beta Non-selektif (Non-selective Beta Blockers)', category: 'Penyekat Beta' },
  C07AB: { class: 'Penyekat Beta-1 Kardioselektif (Selective Beta Blockers)', category: 'Penyekat Beta' },
  C07AG: { class: 'Penyekat Alfa dan Beta Adrenergik Gabungan', category: 'Penyekat Beta' },
  C08CA: { class: 'Antagonis Kalsium Dihidropiridin Selektif (CCB)', category: 'Antagonis Kalsium' },
  C08DA: { class: 'Antagonis Kalsium Fenilalkilamin (Verapamil)', category: 'Antagonis Kalsium' },
  C08DB: { class: 'Antagonis Kalsium Benzotiazepin (Diltiazem)', category: 'Antagonis Kalsium' },
  C09AA: { class: 'Penghambat Enzim Konversi Angiotensin / ACEi', category: 'Sistem Renin-Angiotensin' },
  C09CA: { class: 'Antagonis Reseptor Angiotensin II / ARB', category: 'Sistem Renin-Angiotensin' },
  C09DX: { class: 'Kombinasi ARB, CCB & Penghambat Neprilisin (ARNI)', category: 'Sistem Renin-Angiotensin' },
  C10AA: { class: 'Penghambat HMG-CoA Reduktase / Statin', category: 'Agen Modifikasi Lipid' },
  C10AB: { class: 'Derivat Asam Fibrat (Fibrates)', category: 'Agen Modifikasi Lipid' },
  C10AX: { class: 'Penghambat Absorpsi Kolesterol (Ezetimibe) / Lainnya', category: 'Agen Modifikasi Lipid' },

  // G - Genitourinary
  G01AE: { class: 'Antiseptik & Antiinfeksi Ginekologis', category: 'Antiinfeksi Urogenital' },
  G04BA: { class: 'Agen Pengasam Urin (Urine Acidifiers)', category: 'Obat Urologikal' },
  G04CA: { class: 'Antagonis Reseptor Alfa-1A Prostat (BPH)', category: 'Obat Urologikal' },
  G04CB: { class: 'Penghambat Enzim 5-Alfa Reduktase (BPH)', category: 'Obat Urologikal' },
  G04BE: { class: 'Penghambat Enzim Fosfodiesterase Tipe 5 (PDE-5i)', category: 'Obat Disfungsi Ereksi' },

  // H - Systemic Hormones
  H02AB: { class: 'Kortikosteroid Glukokortikoid Sistemik', category: 'Kortikosteroid' },
  H03AA: { class: 'Hormon Tiroid Sintetis (Levothyroxine)', category: 'Terapi Tiroid' },
  H03BB: { class: 'Antitiroid Derivat Imidazol (Thiamazole/Methimazole)', category: 'Terapi Tiroid' },
  H05AA: { class: 'Hormon Paratiroid & Analog Rekombinan', category: 'Homeostasis Kalsium' },

  // J - Antiinfectives for Systemic Use
  J01AA: { class: 'Antibiotik Golongan Tetrasiklin (Tetracyclines)', category: 'Antibakteri Sistemik' },
  J01CA: { class: 'Antibiotik Penisilin Spektrum Luas (Aminopenicillins)', category: 'Antibakteri Beta-Laktam' },
  J01CR: { class: 'Kombinasi Penisilin dengan Inhibitor Beta-Laktamase', category: 'Antibakteri Beta-Laktam' },
  J01DB: { class: 'Sefalosporin Generasi Pertama', category: 'Antibakteri Sefalosporin' },
  J01DC: { class: 'Sefalosporin Generasi Kedua', category: 'Antibakteri Sefalosporin' },
  J01DD: { class: 'Sefalosporin Generasi Ketiga', category: 'Antibakteri Sefalosporin' },
  J01DE: { class: 'Sefalosporin Generasi Keempat', category: 'Antibakteri Sefalosporin' },
  J01DH: { class: 'Antibiotik Golongan Karbapenem', category: 'Antibakteri Beta-Laktam' },
  J01FA: { class: 'Antibiotik Golongan Makrolida (Macrolides)', category: 'Antibakteri Sistemik' },
  J01FF: { class: 'Antibiotik Golongan Linkosamid (Clindamycin)', category: 'Antibakteri Sistemik' },
  J01GB: { class: 'Antibiotik Golongan Aminoglikosida', category: 'Antibakteri Sistemik' },
  J01MA: { class: 'Antibiotik Golongan Fluorokuinolon (Fluoroquinolones)', category: 'Antibakteri Kuinolon' },
  J01XA: { class: 'Antibiotik Golongan Glikopeptida (Vancomycin)', category: 'Antibakteri Sistemik' },
  J01XD: { class: 'Derivat Imidazol Antibakteri / Antianaerob (Metronidazole)', category: 'Antibakteri Sistemik' },
  J01XX: { class: 'Antibakteri Golongan Oksazolidinon (Linezolid)', category: 'Antibakteri Sistemik' },
  J02AC: { class: 'Antijamur Sistemik Golongan Triazol (Triazoles)', category: 'Antijamur Sistemik' },
  J02AX: { class: 'Antijamur Sistemik Golongan Ekinokandin', category: 'Antijamur Sistemik' },
  J05AB: { class: 'Antivirus Analog Nukleosida / Nukleotida (Antiherpes)', category: 'Antivirus Sistemik' },
  J05AE: { class: 'Penghambat Protease Antivirus HIV (Protease Inhibitors)', category: 'Antivirus Terapi ART' },
  J05AF: { class: 'Penghambat Reverse Transcriptase Nukleosida (NRTI)', category: 'Antivirus Terapi ART' },
  J05AG: { class: 'Penghambat Reverse Transcriptase Non-Nukleosida (NNRTI)', category: 'Antivirus Terapi ART' },
  J05AH: { class: 'Penghambat Neuraminidase Antivirus Influenza', category: 'Antivirus Influenza' },
  J05AJ: { class: 'Penghambat Integrase Antivirus HIV (INSTI)', category: 'Antivirus Terapi ART' },
  J05AP: { class: 'Antivirus Hepatitis C Kerja Langsung (DAA)', category: 'Antivirus Hepatitis' },
  J05AR: { class: 'Kombinasi Antivirus Terapi ARV / HIV Terpadu', category: 'Antivirus Terapi ART' },

  // L - Antineoplastic & Immunomodulating
  L01AA: { class: 'Kemoterapi Alkilator Analog Mustard Nitrogen', category: 'Agen Antineoplastik' },
  L01BA: { class: 'Antineoplastik Antagonis Asam Folat (Methotrexate)', category: 'Agen Antimetabolit' },
  L01BC: { class: 'Antineoplastik Analog Pirimidin (Fluorouracil, Capecitabine)', category: 'Agen Antimetabolit' },
  L01CD: { class: 'Antineoplastik Golongan Taksan (Paclitaxel, Docetaxel)', category: 'Agen Antimikrotubulus' },
  L01DB: { class: 'Antineoplastik Antibiotik Antrasiklin (Doxorubicin)', category: 'Agen Antineoplastik' },
  L01EA: { class: 'Penghambat Tirosin Kinase BCR-ABL (Imatinib)', category: 'Terapi Target Kanker' },
  L01EB: { class: 'Penghambat Tirosin Kinase Reseptor EGFR', category: 'Terapi Target Kanker' },
  L01EF: { class: 'Penghambat Kinase Siklin Dependen CDK4/6', category: 'Terapi Target Kanker' },
  L01FA: { class: 'Antibodi Monoklonal Anti-CD20 (Rituximab)', category: 'Imunoterapi Kanker' },
  L01FD: { class: 'Antibodi Monoklonal Penghambat Reseptor HER2 (Trastuzumab)', category: 'Imunoterapi Kanker' },
  L01FF: { class: 'Imunoterapi Checkpoint Penghambat PD-1/PD-L1', category: 'Imunoterapi Kanker' },
  L02BA: { class: 'Modulator Reseptor Estrogen Selektif (SERM / Tamoxifen)', category: 'Terapi Endokrin Onkologi' },
  L02BB: { class: 'Antiandrogen Reseptor (Bicalutamide, Enzalutamide)', category: 'Terapi Endokrin Onkologi' },
  L02BG: { class: 'Penghambat Enzim Aromatase (Letrozole, Anastrozole)', category: 'Terapi Endokrin Onkologi' },
  L02BX: { class: 'Antagonis Hormon Onkologi & GnRH Antagonist', category: 'Terapi Endokrin Onkologi' },
  L04AA: { class: 'Imunosupresan Selektif / Penghambat Kostiulasi Sel T', category: 'Agen Imunosupresan' },
  L04AB: { class: 'Penghambat Tumor Necrosis Factor Alfa (Anti-TNF)', category: 'Agen Imunosupresan Biologis' },
  L04AD: { class: 'Penghambat Kalsineurin (Cyclosporine, Tacrolimus)', category: 'Agen Imunosupresan' },
  L04AX: { class: 'Imunosupresan Imunomodulator Lainnya', category: 'Agen Imunosupresan' },

  // M - Musculo-Skeletal System
  M01AB: { class: 'Antiinflamasi Non-Steroid Derivat Asam Asetat (Diclofenac)', category: 'Obat Antiinflamasi & Antirematik' },
  M01AC: { class: 'Antiinflamasi Non-Steroid Golongan Oksikam (Meloxicam)', category: 'Obat Antiinflamasi & Antirematik' },
  M01AE: { class: 'Antiinflamasi Non-Steroid Derivat Asam Propionat (Ibuprofen)', category: 'Obat Antiinflamasi & Antirematik' },
  M01AH: { class: 'Penghambat Selektif Enzim Siklooksigenase-2 (COX-2 Inhibitors)', category: 'Obat Antiinflamasi & Antirematik' },
  M04AA: { class: 'Penghambat Pembentukan Asam Urat / Xantin Oksidase (Allopurinol)', category: 'Obat Antigout' },
  M04AC: { class: 'Agen Antiinflamasi Spesifik Gout Akut (Colchicine)', category: 'Obat Antigout' },

  // N - Nervous System
  N02AA: { class: 'Analgesik Opioid Alami Agonis Reseptor Mu (Morphine)', category: 'Analgesik Opioid' },
  N02AB: { class: 'Analgesik Opioid Derivat Fenilpiperidin (Fentanyl)', category: 'Analgesik Opioid' },
  N02AE: { class: 'Analgesik Opioid Parsial Agonis Derivat Oripavin', category: 'Analgesik Opioid' },
  N02AJ: { class: 'Kombinasi Opioid dan Analgesik Non-Opioid (Tramadol)', category: 'Analgesik Sentral' },
  N02BA: { class: 'Analgesik & Antiplatelet Derivat Asam Salisilat (Aspirin)', category: 'Analgesik Non-Opioid' },
  N02BE: { class: 'Analgesik & Antipiretik Golongan Anilida (Paracetamol)', category: 'Analgesik Non-Opioid' },
  N02BF: { class: 'Agen Modulasi Nyeri Neuropatik Golongan Gabapentinoid', category: 'Nyeri Neuropatik & Antikonvulsan' },
  N02CC: { class: 'Agonis Selektif Reseptor Serotonin 5-HT1 / Triptan (Antimigrain)', category: 'Preparat Antimigrain' },
  N03AA: { class: 'Antikonvulsan / Antiepilepsi Derivat Barbiturat', category: 'Obat Antiepilepsi' },
  N03AB: { class: 'Antiepilepsi Derivat Hidantoin (Phenytoin)', category: 'Obat Antiepilepsi' },
  N03AE: { class: 'Antiepilepsi Derivat Benzodiazepin (Clonazepam)', category: 'Obat Antiepilepsi' },
  N03AF: { class: 'Antiepilepsi Derivat Karboksamid (Carbamazepine)', category: 'Obat Antiepilepsi' },
  N03AG: { class: 'Antiepilepsi Derivat Asam Lemak (Asam Valproat)', category: 'Obat Antiepilepsi' },
  N03AX: { class: 'Antiepilepsi & Penstabil Membran Saraf Lainnya', category: 'Obat Antiepilepsi' },
  N04BA: { class: 'Prekursor Dopamin L-Dopa & Inhibitor Dekarboksilase', category: 'Obat Anti-Parkinson' },
  N04BC: { class: 'Agonis Reseptor Dopamin (Pramipexole, Ropinirole)', category: 'Obat Anti-Parkinson' },
  N04BD: { class: 'Penghambat Monoamin Oksidase Tipe B (MAO-B Inhibitors)', category: 'Obat Anti-Parkinson' },
  N04BB: { class: 'Derivat Adamantan Anti-Parkinson (Amantadine)', category: 'Obat Anti-Parkinson' },
  N05AA: { class: 'Antipsikotik Tipikal Golongan Fenotiazin', category: 'Obat Antipsikotik' },
  N05AD: { class: 'Antipsikotik Tipikal Derivat Butirofenon (Haloperidol)', category: 'Obat Antipsikotik' },
  N05AH: { class: 'Antipsikotik Atipikal Golongan Diazepin/Oksazepin', category: 'Obat Antipsikotik' },
  N05AL: { class: 'Antipsikotik Golongan Benzamid (Sulpiride)', category: 'Obat Antipsikotik' },
  N05AX: { class: 'Antipsikotik Atipikal Generasi Baru (Risperidone, Aripiprazole)', category: 'Obat Antipsikotik' },
  N05BA: { class: 'Anksiolitik Golongan Benzodiazepin (Diazepam, Alprazolam)', category: 'Psikoleptik Anksiolitik' },
  N05CD: { class: 'Hipnotik & Sedatif Derivat Benzodiazepin', category: 'Hipnotik dan Sedatif' },
  N05CF: { class: 'Hipnotik Agonis Reseptor GABA-A Non-Benzodiazepin (Z-Drugs)', category: 'Hipnotik dan Sedatif' },
  N06AA: { class: 'Antidepresan Trisiklik / Non-selektif Reuptake Inhibitor (TCA)', category: 'Obat Antidepresan' },
  N06AB: { class: 'Antidepresan Penghambat Selektif Reuptake Serotonin (SSRI)', category: 'Obat Antidepresan' },
  N06AX: { class: 'Antidepresan Atipikal / SNRI / Modulator Monoamin', category: 'Obat Antidepresan' },
  N06BA: { class: 'Psikostimulan Sentral & Terapi ADHD (Methylphenidate)', category: 'Psikostimulan' },
  N06DA: { class: 'Penghambat Enzim Asetilkolinesterase (Anti-Demensia)', category: 'Obat Demensia Alzheimer' },
  N06DX: { class: 'Antagonis Reseptor NMDA (Memantine / Anti-Demensia)', category: 'Obat Demensia Alzheimer' },
  N07AA: { class: 'Agen Parasimpatomimetik Antikolinesterase', category: 'Obat Sistem Saraf' },
  N07BA: { class: 'Terapi Ketergantungan Nikotin (Varenicline, Bupropion)', category: 'Obat Gangguan Adiktif' },
  N07BB: { class: 'Obat Ketergantungan Alkohol (Drugs Used in Alcohol Dependence)', category: 'Obat Gangguan Adiktif' },
  N07BC: { class: 'Terapi Substitusi Ketergantungan Opioid (Buprenorphine, Methadone)', category: 'Obat Gangguan Adiktif' },
  N07CA: { class: 'Preparat Antivertigo / Modulator Mikrosirkulasi Labirin', category: 'Obat Antivertigo' },

  // R - Respiratory System
  R01AD: { class: 'Kortikosteroid Topikal Intranasal', category: 'Preparat Dekongestan & Hidung' },
  R03AC: { class: 'Agonis Selektif Beta-2 Adrenoreseptor (Bronkodilator Inhalasi)', category: 'Obat Obstruksi Saluran Napas' },
  R03AK: { class: 'Kombinasi Kortikosteroid Inhalasi & LABA (Bronkodilator)', category: 'Obat Obstruksi Saluran Napas' },
  R03BA: { class: 'Kortikosteroid Inhalasi Antiinflamasi Asma (ICS)', category: 'Obat Obstruksi Saluran Napas' },
  R03BB: { class: 'Antikolinergik Bronkodilator Inhalasi (SAMA/LAMA)', category: 'Obat Obstruksi Saluran Napas' },
  R03DC: { class: 'Antagonis Reseptor Leukotrien Oral (Montelukast)', category: 'Obat Obstruksi Saluran Napas' },
  R05CB: { class: 'Mukolitik Pengencer Dahak (Acetylcysteine, Ambroxol)', category: 'Preparat Batuk & Pilek' },
  R06AA: { class: 'Antihistamin H1 Generasi Pertama (Aminoalkil Eter)', category: 'Antihistamin Sistemik' },
  R06AE: { class: 'Antihistamin H1 Generasi Kedua Derivat Piperazin (Cetirizine)', category: 'Antihistamin Sistemik' },
  R06AX: { class: 'Antihistamin H1 Generasi Kedua Non-sedatif (Loratadine)', category: 'Antihistamin Sistemik' },

  // S - Sensory Organs
  S01EC: { class: 'Penghambat Karbonik Anhidrase Topikal / Sistemik (Antiglaukoma)', category: 'Preparat Mata Antiglaukoma' },
  S01ED: { class: 'Penyekat Beta Topikal Oftalmik (Timolol)', category: 'Preparat Mata Antiglaukoma' },
  S01EE: { class: 'Analog Prostaglandin Topikal (Latanoprost)', category: 'Preparat Mata Antiglaukoma' },
};

// 3. Fallback: Level 3 generic map (3-character code e.g. 'N07', 'A10', 'B01')
const ATC_LEVEL_2: Record<string, { class: string; category: string }> = {
  A02: { class: 'Obat Gangguan Terkait Asam Lambung & Refluks', category: 'Saluran Cerna & Metabolisme' },
  A03: { class: 'Obat Gangguan Saluran Cerna Fungsional & Antispasmodik', category: 'Saluran Cerna & Metabolisme' },
  A04: { class: 'Antiemetik & Agen Pencegah Mual Muntah', category: 'Saluran Cerna & Metabolisme' },
  A06: { class: 'Obat Pencahar & Laksatif Konstipasi', category: 'Saluran Cerna & Metabolisme' },
  A07: { class: 'Antidiare, Antiinflamasi & Antiinfeksi Intestinal', category: 'Saluran Cerna & Metabolisme' },
  A10: { class: 'Antidiabetes Oral & Terapi Penurun Glukosa', category: 'Endokrin & Diabetes' },
  B01: { class: 'Agen Antitrombotik, Antiplatelet & Antikoagulan', category: 'Hematologi' },
  B02: { class: 'Agen Antihemoragik & Hemostatik', category: 'Hematologi' },
  B03: { class: 'Preparat Antianemia & Stimulan Hematopoietik', category: 'Hematologi' },
  C01: { class: 'Terapi Jantung, Antiaritmia & Inotropik', category: 'Kardiovaskular' },
  C02: { class: 'Antihipertensi Aksi Sentral & Perifer', category: 'Kardiovaskular' },
  C03: { class: 'Diuretik Penurun Volume Cairan', category: 'Kardiovaskular' },
  C07: { class: 'Penyekat Beta-Adrenergik (Beta Blockers)', category: 'Kardiovaskular' },
  C08: { class: 'Antagonis Saluran Kalsium (Calcium Channel Blockers)', category: 'Kardiovaskular' },
  C09: { class: 'Agen Pengatur Sistem Renin-Angiotensin (ACEi / ARB)', category: 'Kardiovaskular' },
  C10: { class: 'Agen Penurun Lipid & Anti-Aterosklerosis', category: 'Kardiovaskular' },
  G04: { class: 'Obat Saluran Kemih & Urologikal', category: 'Urogenital' },
  H02: { class: 'Kortikosteroid Sistemik Antiinflamasi', category: 'Endokrin Sistemik' },
  H03: { class: 'Terapi Gangguan Fungsi Tiroid', category: 'Endokrin Sistemik' },
  H05: { class: 'Regulator Homeostasis Kalsium & Tulang', category: 'Endokrin Sistemik' },
  J01: { class: 'Antibakteri Spektrum Luas untuk Infeksi Sistemik', category: 'Antiinfeksi Sistemik' },
  J02: { class: 'Antijamur untuk Mikosis Sistemik', category: 'Antiinfeksi Sistemik' },
  J05: { class: 'Antivirus Terapi Infeksi Virus Sistemik', category: 'Antiinfeksi Sistemik' },
  L01: { class: 'Kemoterapi Antineoplastik & Terapi Onkologi Target', category: 'Onkologi & Imunologi' },
  L02: { class: 'Terapi Endokrin Antikanker', category: 'Onkologi & Imunologi' },
  L04: { class: 'Imunosupresan Penekan Respon Imun', category: 'Onkologi & Imunologi' },
  M01: { class: 'Antiinflamasi Non-Steroid (NSAID) & Antirematik', category: 'Muskuloskeletal' },
  M04: { class: 'Obat Terapi Hiperurisemia & Pirai (Gout)', category: 'Muskuloskeletal' },
  N01: { class: 'Anestetik Umum & Lokal', category: 'Sistem Saraf' },
  N02: { class: 'Analgesik & Agen Pereda Nyeri', category: 'Sistem Saraf' },
  N03: { class: 'Antiepilepsi & Antikonvulsan', category: 'Sistem Saraf' },
  N04: { class: 'Obat Terapi Sindrom Parkinson', category: 'Sistem Saraf' },
  N05: { class: 'Psikoleptik, Antipsikotik & Anksiolitik', category: 'Sistem Saraf' },
  N06: { class: 'Psikoanaleptik, Antidepresan & Terapi Kognitif', category: 'Sistem Saraf' },
  N07: { class: 'Obat Sistem Saraf Pusat & Modulator Adiksi', category: 'Sistem Saraf' },
  R01: { class: 'Preparat Dekongestan & Hidung', category: 'Pernapasan' },
  R03: { class: 'Bronkodilator & Anti-Obstruksi Saluran Napas', category: 'Pernapasan' },
  R05: { class: 'Preparat Batuk & Pengencer Mukus', category: 'Pernapasan' },
  R06: { class: 'Antihistamin Sistemik Anti-Alergi', category: 'Pernapasan & Alergi' },
  S01: { class: 'Preparat Oftalmik Terapi Mata', category: 'Organ Sensorik' },
};

// 4. Pharmaceutical USAN/INN Stem Rules for drugs without ATC code
const PHARMACEUTICAL_STEMS: Array<{
  regex: RegExp;
  class: string;
  category: string;
}> = [
  { regex: /statin$/i, class: 'Penghambat HMG-CoA Reduktase / Statin', category: 'Kardiovaskular • Agen Modifikasi Lipid' },
  { regex: /sartan$/i, class: 'Antagonis Reseptor Angiotensin II (ARB)', category: 'Kardiovaskular • Sistem Renin-Angiotensin' },
  { regex: /pril(at)?$/i, class: 'Penghambat Enzim Konversi Angiotensin (ACEi)', category: 'Kardiovaskular • Sistem Renin-Angiotensin' },
  { regex: /olol$/i, class: 'Penyekat Beta-Adrenergik (Beta Blocker)', category: 'Kardiovaskular • Penyekat Beta' },
  { regex: /dipine$/i, class: 'Antagonis Kalsium Dihidropiridin (CCB)', category: 'Kardiovaskular • Antagonis Kalsium' },
  { regex: /prazole$/i, class: 'Penghambat Pompa Proton (PPI)', category: 'Saluran Cerna • Obat Asam Lambung' },
  { regex: /tidine$/i, class: 'Antagonis Reseptor H2 Histamin', category: 'Saluran Cerna • Obat Asam Lambung' },
  { regex: /cillin$/i, class: 'Antibiotik Golongan Penisilin', category: 'Antiinfeksi • Antibakteri Beta-Laktam' },
  { regex: /cycline$/i, class: 'Antibiotik Golongan Tetrasiklin', category: 'Antiinfeksi • Antibakteri Sistemik' },
  { regex: /floxacin$/i, class: 'Antibakteri Golongan Fluorokuinolon', category: 'Antiinfeksi • Antibakteri Kuinolon' },
  { regex: /(mycin|micin)$/i, class: 'Antibiotik Makrolida / Aminoglikosida', category: 'Antiinfeksi • Antibakteri Sistemik' },
  { regex: /mab$/i, class: 'Antibodi Monoklonal Terapi Target (Biologik)', category: 'Imunoterapi & Terapi Target Kanker' },
  { regex: /(nib|tinib)$/i, class: 'Penghambat Tirosin Kinase / Targeted Inhibitor', category: 'Onkologi • Terapi Target' },
  { regex: /(azepam|azolam)$/i, class: 'Anksiolitik & Sedatif Golongan Benzodiazepin', category: 'Sistem Saraf • Anksiolitik & Sedatif' },
  { regex: /(oxetine|pram)$/i, class: 'Antidepresan Penghambat Serotonin (SSRI)', category: 'Sistem Saraf • Antidepresan' },
  { regex: /gliptin$/i, class: 'Antidiabetes Oral Penghambat DPP-4', category: 'Endokrin • Obat Diabetes' },
  { regex: /gliflozin$/i, class: 'Antidiabetes Oral Penghambat SGLT2', category: 'Endokrin • Obat Diabetes' },
  { regex: /glitazone$/i, class: 'Antidiabetes Oral Golongan Tiazolidindion', category: 'Endokrin • Obat Diabetes' },
  { regex: /(xaban|gatran)$/i, class: 'Antikoagulan Oral Direk (DOAC / NOAC)', category: 'Hematologi • Antitrombotik Direk' },
  { regex: /terol$/i, class: 'Bronkodilator Agonis Beta-2 Adrenergik', category: 'Pernapasan • Obstruksi Saluran Napas' },
  { regex: /lukast$/i, class: 'Antagonis Reseptor Leukotrien Anti-Asma', category: 'Pernapasan • Obstruksi Saluran Napas' },
  { regex: /coxib$/i, class: 'Antiinflamasi Selektif COX-2 (NSAID)', category: 'Muskuloskeletal • Antiinflamasi' },
  { regex: /(fenac|profen)$/i, class: 'Antiinflamasi Non-Steroid (NSAID)', category: 'Muskuloskeletal • Analgesik & Antiinflamasi' },
  { regex: /(sone|olone|onide)$/i, class: 'Kortikosteroid Glukokortikoid Antiinflamasi', category: 'Hormon Sistemik • Glukokortikoid' },
  { regex: /(vir|navir|gravir)$/i, class: 'Antivirus Spesifik Kerja Langsung', category: 'Antiinfeksi • Antivirus' },
  { regex: /conazole$/i, class: 'Antijamur Golongan Triazol / Imidazol', category: 'Antiinfeksi • Antijamur' },
  { regex: /triptan$/i, class: 'Agonis Reseptor 5-HT1 Antimigrain Akut', category: 'Sistem Saraf • Preparat Antimigrain' },
  { regex: /setron$/i, class: 'Antiemetik Antagonis Reseptor 5-HT3', category: 'Saluran Cerna • Antiemetik' },
  { regex: /zosin$/i, class: 'Penyekat Alfa-1 Adrenoreseptor', category: 'Kardiovaskular / Urologikal' },
  { regex: /parin$/i, class: 'Heparin Berat Molekul Rendah (LMWH)', category: 'Hematologi • Antikoagulan' },
  { regex: /fungin$/i, class: 'Antijamur Sistemik Golongan Ekinokandin', category: 'Antiinfeksi • Antijamur Sistemik' },
];

/**
 * Main Classifier Function: Resolves full pharmacotherapeutic class and categories
 */
export function resolvePharmacotherapyClass(
  atcCode?: string | null,
  drugName?: string | null,
  drugType?: string | null,
  mechanism?: string | null
): AtcClassResult {
  const cleanName = (drugName || '').trim();
  const cleanCode = (atcCode || '').trim().toUpperCase();

  // 1. Check direct ATC Code parsing if valid ATC code is present
  if (cleanCode && cleanCode !== '-' && !cleanCode.startsWith('DB')) {
    // Primary code (in case of comma-separated list like "N07BB03, N07BB01")
    const primaryCode = cleanCode.split(/[,;\s]+/)[0].trim();

    // Try 5-character Level 4 code match (e.g. N07BB)
    const level4 = primaryCode.slice(0, 5);
    if (ATC_SUBGROUPS[level4]) {
      const match = ATC_SUBGROUPS[level4];
      const rootLetter = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter] || 'Farmakologi Terverifikasi DDInter v2.0';
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} • ${match.category || level4}`,
        anatomicalGroup: anatomical,
      };
    }

    // Try 4-character Level 3 code match (e.g. N07B)
    const level3 = primaryCode.slice(0, 4);
    if (ATC_SUBGROUPS[level3]) {
      const match = ATC_SUBGROUPS[level3];
      const rootLetter = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter] || 'Farmakologi Terverifikasi DDInter v2.0';
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} • ${match.category || level3}`,
        anatomicalGroup: anatomical,
      };
    }

    // Try 3-character Level 2 code match (e.g. N07)
    const level2 = primaryCode.slice(0, 3);
    if (ATC_LEVEL_2[level2]) {
      const match = ATC_LEVEL_2[level2];
      const rootLetter = primaryCode.charAt(0);
      const anatomical = ATC_LEVEL_1[rootLetter] || match.category;
      return {
        therapeuticClass: match.class,
        atcCategory: `${anatomical} • ${match.category}`,
        anatomicalGroup: anatomical,
      };
    }

    // Root letter Anatomical Group (e.g. N -> Nervous system)
    const rootLetter = primaryCode.charAt(0);
    if (ATC_LEVEL_1[rootLetter]) {
      const anatomical = ATC_LEVEL_1[rootLetter];
      return {
        therapeuticClass: anatomical.split('(')[0].trim(),
        atcCategory: anatomical,
        anatomicalGroup: anatomical,
      };
    }
  }

  // 2. Check Pharmaceutical INN / USAN stem rules
  for (const stem of PHARMACEUTICAL_STEMS) {
    if (stem.regex.test(cleanName)) {
      return {
        therapeuticClass: stem.class,
        atcCategory: stem.category,
        anatomicalGroup: stem.category.split('•')[0].trim(),
      };
    }
  }

  // 3. Check Biotech / Macromolecule heuristics
  if (drugType === 'biotech') {
    return {
      therapeuticClass: 'Biomolekul Peptida / Protein Terapeutik Rekombinan',
      atcCategory: 'Produk Bioteknologi Farmasi & Imunobiologis',
      anatomicalGroup: 'Bioteknologi Medis',
    };
  }

  // 4. Mechanism-based inference if available
  const mech = (mechanism || '').toLowerCase();
  if (mech.includes('antibakteri') || mech.includes('antibiotik') || mech.includes('bakterisid')) {
    return {
      therapeuticClass: 'Agen Antibakteri Spektrum Farmakologis',
      atcCategory: 'Antiinfeksi untuk Penggunaan Sistemik',
      anatomicalGroup: 'Antiinfeksi Sistemik',
    };
  }
  if (mech.includes('antidepres') || mech.includes('serotonin')) {
    return {
      therapeuticClass: 'Modulator Neurotransmiter & Agen Antidepresan',
      atcCategory: 'Sistem Saraf (Nervous System) • Psikoanaleptik',
      anatomicalGroup: 'Sistem Saraf (Nervous System)',
    };
  }
  if (mech.includes('antivirus') || mech.includes('reverse transcriptase') || mech.includes('protease inhibitor')) {
    return {
      therapeuticClass: 'Agen Antivirus Kerja Langsung Terverifikasi',
      atcCategory: 'Antiinfeksi untuk Penggunaan Sistemik • Antivirus',
      anatomicalGroup: 'Antiinfeksi Sistemik',
    };
  }
  if (mech.includes('tekanan darah') || mech.includes('antihipertensi') || mech.includes('vasodilat')) {
    return {
      therapeuticClass: 'Agen Kardiovaskular & Pengatur Tekanan Darah',
      atcCategory: 'Sistem Kardiovaskular (Cardiovascular System)',
      anatomicalGroup: 'Sistem Kardiovaskular',
    };
  }

  return {
    therapeuticClass: 'Obat Terdaftar DDInter v2.0',
    atcCategory: 'Klasifikasi Farmakologi DDInter v2.0',
    anatomicalGroup: 'DDInter v2.0',
  };
}
