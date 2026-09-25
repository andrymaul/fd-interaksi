import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import { resolvePharmacotherapyClass } from '../src/data/atcClassifier.ts';

const DB_PATH = path.join(process.cwd(), 'src/data/ddinter_complete.db');
const db = new DatabaseSync(DB_PATH);

console.log('--- Enriching Essential Clinical Drugs with WHO ATC and Classes ---');

const ATC_MAP: Record<string, string> = {
  // Alcohol / Addiction
  'Acamprosate': 'N07BB03',
  'Disulfiram': 'N07BB01',
  'Naltrexone': 'N07BB04',
  'Varenicline': 'N07BA03',
  'Methadone': 'N07BC02',
  'Buprenorphine': 'N02AE01',

  // CNS / Psych
  'Chlorpromazine': 'N05AA01',
  'Haloperidol': 'N05AD01',
  'Clozapine': 'N05AH02',
  'Olanzapine': 'N05AH03',
  'Quetiapine': 'N05AH04',
  'Risperidone': 'N05AX08',
  'Aripiprazole': 'N05AX12',
  'Diazepam': 'N05BA01',
  'Lorazepam': 'N05BA06',
  'Alprazolam': 'N05BA12',
  'Midazolam': 'N05CD08',
  'Zolpidem': 'N05CF01',
  'Amitriptyline': 'N06AA09',
  'Fluoxetine': 'N06AB03',
  'Sertraline': 'N06AB06',
  'Paroxetine': 'N06AB05',
  'Citalopram': 'N06AB04',
  'Escitalopram': 'N06AB10',
  'Venlafaxine': 'N06AX16',
  'Duloxetine': 'N06AX21',
  'Mirtazapine': 'N06AX11',
  'Bupropion': 'N06AX12',
  'Donepezil': 'N06DA02',
  'Memantine': 'N06DX01',
  'Levodopa': 'N04BA01',
  'Pramipexole': 'N04BC05',
  'Ropinirole': 'N04BC04',
  'Phenytoin': 'N03AB02',
  'Carbamazepine': 'N03AF01',
  'Valproic acid': 'N03AG01',
  'Lamotrigine': 'N03AX09',
  'Levetiracetam': 'N03AX14',
  'Topiramate': 'N03AX11',
  'Gabapentin': 'N02BF01',
  'Pregabalin': 'N02BF02',
  'Morphine': 'N02AA01',
  'Fentanyl': 'N02AB03',
  'Tramadol': 'N02AJ13',
  'Sumatriptan': 'N02CC01',

  // Cardiovascular
  'Aspirin': 'B01AC06',
  'Acetylsalicylic acid': 'B01AC06',
  'Clopidogrel': 'B01AC04',
  'Ticagrelor': 'B01AC24',
  'Warfarin': 'B01AA03',
  'Rivaroxaban': 'B01AF01',
  'Apixaban': 'B01AF02',
  'Dabigatran': 'B01AE07',
  'Heparin': 'B01AB01',
  'Enoxaparin': 'B01AB05',
  'Digoxin': 'C01AA05',
  'Amiodarone': 'C01BD01',
  'Furosemide': 'C03CA01',
  'Spironolactone': 'C03DA01',
  'Hydrochlorothiazide': 'C03AA03',
  'Bisoprolol': 'C07AB07',
  'Metoprolol': 'C07AB02',
  'Atenolol': 'C07AB03',
  'Carvedilol': 'C07AG02',
  'Propranolol': 'C07AA05',
  'Amlodipine': 'C08CA01',
  'Nifedipine': 'C08CA05',
  'Verapamil': 'C08DA01',
  'Diltiazem': 'C08DB01',
  'Captopril': 'C09AA01',
  'Enalapril': 'C09AA02',
  'Lisinopril': 'C09AA03',
  'Ramipril': 'C09AA05',
  'Losartan': 'C09CA01',
  'Valsartan': 'C09CA03',
  'Candesartan': 'C09CA06',
  'Telmisartan': 'C09CA07',
  'Atorvastatin': 'C10AA05',
  'Simvastatin': 'C10AA01',
  'Rosuvastatin': 'C10AA07',
  'Pravastatin': 'C10AA03',
  'Fenofibrate': 'C10AB05',
  'Gemfibrozil': 'C10AB02',
  'Ezetimibe': 'C10AX09',

  // Gastrointestinal & Endocrine
  'Omeprazole': 'A02BC01',
  'Pantoprazole': 'A02BC02',
  'Lansoprazole': 'A02BC03',
  'Rabeprazole': 'A02BC04',
  'Esomeprazole': 'A02BC05',
  'Ranitidine': 'A02BA02',
  'Famotidine': 'A02BA03',
  'Metformin': 'A10BA02',
  'Glimepiride': 'A10BB12',
  'Glibenclamide': 'A10BB01',
  'Sitagliptin': 'A10BH01',
  'Linagliptin': 'A10BH05',
  'Empagliflozin': 'A10BK03',
  'Dapagliflozin': 'A10BK01',
  'Ondansetron': 'A04AA01',
  'Dexamethasone': 'H02AB02',
  'Prednisone': 'H02AB07',
  'Methylprednisolone': 'H02AB04',
  'Hydrocortisone': 'H02AB09',
  'Levothyroxine': 'H03AA01',

  // Anti-infective
  'Amoxicillin': 'J01CA04',
  'Ampicillin': 'J01CA01',
  'Cefotaxime': 'J01DD01',
  'Ceftriaxone': 'J01DD04',
  'Cefixime': 'J01DD08',
  'Cefazolin': 'J01DB04',
  'Cefuroxime': 'J01DC02',
  'Cefepime': 'J01DE01',
  'Meropenem': 'J01DH02',
  'Imipenem': 'J01DH51',
  'Azithromycin': 'J01FA10',
  'Clarithromycin': 'J01FA09',
  'Erythromycin': 'J01FA01',
  'Ciprofloxacin': 'J01MA02',
  'Levofloxacin': 'J01MA12',
  'Moxifloxacin': 'J01MA14',
  'Doxycycline': 'J01AA02',
  'Vancomycin': 'J01XA01',
  'Metronidazole': 'J01XD01',
  'Linezolid': 'J01XX08',
  'Fluconazole': 'J02AC01',
  'Itraconazole': 'J02AC02',
  'Voriconazole': 'J02AC03',
  'Acyclovir': 'J05AB01',
  'Valacyclovir': 'J05AB11',
  'Oseltamivir': 'J05AH02',

  // Musculoskeletal / Antiinflammatory
  'Acetaminophen': 'N02BE01',
  'Paracetamol': 'N02BE01',
  'Ibuprofen': 'M01AE01',
  'Ketoprofen': 'M01AE03',
  'Naproxen': 'M01AE02',
  'Diclofenac': 'M01AB05',
  'Ketorolac': 'M01AB15',
  'Meloxicam': 'M01AC06',
  'Piroxicam': 'M01AC01',
  'Celecoxib': 'M01AH01',
  'Etoricoxib': 'M01AH05',
  'Allopurinol': 'M04AA01',
  'Colchicine': 'M04AC01',

  // Respiratory / Allergy
  'Salbutamol': 'R03AC02',
  'Formoterol': 'R03AC13',
  'Salmeterol': 'R03AC12',
  'Budesonide': 'R03BA02',
  'Fluticasone': 'R03BA05',
  'Ipratropium': 'R03BB01',
  'Tiotropium': 'R03BB04',
  'Montelukast': 'R03DC03',
  'Cetirizine': 'R06AE07',
  'Levocetirizine': 'R06AE09',
  'Loratadine': 'R06AX13',
  'Fexofenadine': 'R06AX26',
};

const updateStmt = db.prepare(`
  UPDATE drugs 
  SET atc_code = ?,
      atc_category = ?,
      therapeutic_class = ?
  WHERE LOWER(name) = LOWER(?) OR ddinter_id = ?
`);

let mappedCount = 0;
for (const [name, atc] of Object.entries(ATC_MAP)) {
  const row = db.prepare('SELECT ddinter_id, name, drug_type, mechanism FROM drugs WHERE LOWER(name) = LOWER(?)').get(name) as any;
  if (row) {
    const resolved = resolvePharmacotherapyClass(atc, row.name, row.drug_type, row.mechanism);
    updateStmt.run(atc, resolved.atcCategory, resolved.therapeuticClass, name, row.ddinter_id);
    mappedCount++;
  }
}

console.log(`[Success] Enriched ${mappedCount} essential clinical drugs with official WHO ATC codes and classes.`);

// Final audit
const totalWithClass = db.prepare("SELECT count(*) as c FROM drugs WHERE therapeutic_class IS NOT NULL AND therapeutic_class != 'Senyawa Farmakoterapi Terdaftar DDInter v2.0'").get() as any;
console.log(`[Audit] Total drugs with verified specific pharmacotherapy class: ${totalWithClass.c}`);
