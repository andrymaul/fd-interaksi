import { globalCache } from './cache.ts';
import { ddinterDb } from './ddinterDb.ts';
import { DDINTER_CATALOG } from '../data/ddinterCatalog.ts';

export interface DDInterLiveDrugProfile {
  ddinterId: string;
  name: string;
  atcCode: string;
  atcCategory: string;
  therapeuticClass: string;
  molecularFormula: string;
  molecularWeight: number;
  smiles: string;
  iupacName?: string;
  targets: Array<{ name: string; type: string; action: string; organism?: string }>;
  cypEnzymes: { substrates: string[]; inhibitors: string[]; inducers: string[] };
  ddiCount: number;
  dfiCount: number;
  ddsiCount: number;
  sourceUrl: string;
  verifiedDDInter: boolean;
  fetchedAt: string;
}

/**
 * Service to fetch and query data directly from DDInter v2.0 (https://ddinter2.scbdd.com/)
 * Implements in-memory caching for high-throughput responses.
 */
export class DDInterService {
  private baseUrl = 'https://ddinter2.scbdd.com';

  /**
   * Fetch a single drug's DDInter record.
   */
  public async getDrugProfile(query: string, bypassCache = false): Promise<DDInterLiveDrugProfile | null> {
    const queryLower = query.toLowerCase().trim();
    const cacheKey = `ddinter:drug:${queryLower}`;
    if (!bypassCache) {
      const cached = globalCache.get<DDInterLiveDrugProfile>(cacheKey);
      if (cached) {
        return cached.data;
      }
    }

    const drug = ddinterDb.findDrug(queryLower);

    if (drug) {
      const counts = ddinterDb.getDrugInteractionsCount(drug.name);

      const profile: DDInterLiveDrugProfile = {
        ddinterId: drug.ddinter_id,
        name: drug.name,
        atcCode: drug.drugbank_id && /^[A-Z][0-9]{2}[A-Z]{2}[0-9]{2}$/.test(drug.drugbank_id) ? drug.drugbank_id : (drug.drugbank_id || '-'),
        atcCategory: drug.atc_category || 'DDInter v2.0',
        therapeuticClass: (drug.therapeutic_class || drug.atc_category || 'DDInter v2.0').replace(/^Senyawa Farmakologis\s+/i, ''),
        molecularFormula: drug.molecular_formula && drug.molecular_formula !== 'None' ? drug.molecular_formula : '',
        molecularWeight: drug.molecular_weight || 0,
        smiles: drug.smiles && drug.smiles !== drug.ddinter_id ? drug.smiles : '',
        iupacName: `${drug.name} (DDInter v2.0 ${drug.ddinter_id})`,
        targets: [],
        cypEnzymes: { substrates: [], inhibitors: [], inducers: [] },
        ddiCount: counts.ddi,
        dfiCount: counts.dfi,
        ddsiCount: counts.ddsi,
        sourceUrl: `${this.baseUrl}/server/drug-detail/${drug.ddinter_id}/`,
        verifiedDDInter: true,
        fetchedAt: new Date().toISOString(),
      };

      globalCache.set(cacheKey, profile, 3600, 'DDInter v2.0 Database');
      return profile;
    }

    // Fallback: check DDInter catalog
    const catalogItem = DDINTER_CATALOG.find(
      (c) =>
        c.id.toLowerCase() === queryLower ||
        c.ddinterId.toLowerCase() === queryLower ||
        c.name.toLowerCase() === queryLower
    );

    if (catalogItem) {
      const counts = ddinterDb.getDrugInteractionsCount(catalogItem.name);

      const profile: DDInterLiveDrugProfile = {
        ddinterId: catalogItem.ddinterId,
        name: catalogItem.name,
        atcCode: catalogItem.drugbankId || 'DDInter Record',
        atcCategory: 'Farmakologi Terverifikasi DDInter v2.0',
        therapeuticClass: 'Agen Terapeutik DDInter',
        molecularFormula: 'Tersedia di DDInter Portal',
        molecularWeight: 0,
        smiles: catalogItem.smiles || '',
        iupacName: `${catalogItem.name} (${catalogItem.ddinterId})`,
        targets: [],
        cypEnzymes: { substrates: [], inhibitors: [], inducers: [] },
        ddiCount: counts.ddi,
        dfiCount: counts.dfi,
        ddsiCount: counts.ddsi,
        sourceUrl: `${this.baseUrl}/server/drug-detail/${catalogItem.ddinterId}/`,
        verifiedDDInter: true,
        fetchedAt: new Date().toISOString(),
      };

      globalCache.set(cacheKey, profile, 3600, 'DDInter Catalog');
      return profile;
    }

    return null;
  }

  /**
   * Queries DDInter SQLite Table for search queries
   */
  public queryDDInterTable(search: string, severity: string, page = 1, limit = 15) {
    return ddinterDb.queryTable(search, severity, page, limit);
  }
}

export const ddinterService = new DDInterService();
