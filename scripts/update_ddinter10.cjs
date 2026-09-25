const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const db = new DatabaseSync('./src/data/ddinter_complete.db');

// Update DDInter10 in SQLite
db.prepare(`
  UPDATE drugs 
  SET pubchem_id = '1564',
      drugbank_id = 'DB00659',
      chembl_id = 'CHEMBL1200688',
      brand_names = json_array('Campral', 'Aotal'),
      therapeutic_class = 'Obat Ketergantungan Alkohol (Drugs Used in Alcohol Dependence)'
  WHERE ddinter_id = 'DDInter10'
`).run();

console.log('Updated DDInter10 in SQLite:');
const d10 = db.prepare('SELECT ddinter_id, name, pubchem_id, drugbank_id, atc_code, molecular_formula, molecular_weight FROM drugs WHERE ddinter_id = ?').get('DDInter10');
console.log(d10);

// Update curated_ddinter_details.json
const curPath = './src/data/curated_ddinter_details.json';
const cur = JSON.parse(fs.readFileSync(curPath, 'utf-8'));
cur['DDInter10'] = {
  ...cur['DDInter10'],
  name: 'Acamprosate',
  pubchemId: '1564',
  drugbankId: 'DB00659',
  chemblId: 'CHEMBL1200688',
  brandNames: ['Campral', 'Aotal'],
  therapeuticClass: 'Obat Ketergantungan Alkohol (Drugs Used in Alcohol Dependence)',
  usefulLinks: {
    'DrugBank': 'https://go.drugbank.com/drugs/DB00659',
    'PubChem': 'https://pubchem.ncbi.nlm.nih.gov/compound/1564',
    'ChEBI': 'http://www.ebi.ac.uk/chebi/searchId.do?chebiId=51041',
    'ChEMBL': 'https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL1200688/'
  }
};
fs.writeFileSync(curPath, JSON.stringify(cur, null, 2), 'utf-8');
console.log('Updated curated_ddinter_details.json for DDInter10');
