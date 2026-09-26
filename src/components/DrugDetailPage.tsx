import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  PlusCircle,
  FlaskConical,
  Pill,
  HeartPulse,
  Utensils,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { DrugMonograph } from '../types/pharmacy.ts';
import { ChemicalStructureViewer } from './ChemicalStructureViewer.tsx';
import { resolvePharmacotherapyClass } from '../data/atcClassifier.ts';

interface DrugDetailPageProps {
  drugId: string;
  onBack: () => void;
  onSelectForInteraction?: (drugId: string) => void;
}

export const DrugDetailPage: React.FC<DrugDetailPageProps> = ({
  drugId,
  onBack,
  onSelectForInteraction,
}) => {
  const [drug, setDrug] = useState<DrugMonograph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'moa' | 'ddi' | 'ddsi' | 'dfi'>('moa');

  useEffect(() => {
    let isMounted = true;
    const fetchDrug = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/drugs/${encodeURIComponent(drugId)}`);
        if (!res.ok) {
          throw new Error(`Obat "${drugId}" tidak ditemukan (Status ${res.status})`);
        }
        const data = await res.json();
        if (isMounted) {
          setDrug(data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Gagal memuat detail obat');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDrug();
    return () => {
      isMounted = false;
    };
  }, [drugId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Monografi Obat</span>
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-700">Memuat data monografi obat...</p>
          <p className="text-xs text-slate-400 font-mono mt-1">Mengambil data dari DDInter v2.0</p>
        </div>
      </div>
    );
  }

  if (error || !drug) {
    return (
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Monografi Obat</span>
        </button>
        <div className="bg-white border border-rose-200 rounded-xl p-12 text-center">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Data Tidak Ditemukan</h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
            {error || `Monografi untuk entri "${drugId}" tidak tersedia di basis data.`}
          </p>
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors"
          >
            Lihat Semua Obat
          </button>
        </div>
      </div>
    );
  }

  const activeDrugResolution = resolvePharmacotherapyClass(
    drug.atcCode,
    drug.name,
    drug.drugType,
    drug.pharmacology?.mechanismOfAction
  );

  const activeTherapeuticClass =
    drug.therapeuticClass && !drug.therapeuticClass.includes('Senyawa Farmakologis Terdaftar')
      ? drug.therapeuticClass.replace(/^Senyawa Farmakologis\s+/i, '')
      : activeDrugResolution?.therapeuticClass?.replace(/^Senyawa Farmakologis\s+/i, '') || '-';

  const activeAtcCategory =
    drug.atcCategory && drug.atcCategory !== 'Farmakologi Terverifikasi DDInter v2.0'
      ? drug.atcCategory.replace(/^Senyawa Farmakologis\s+/i, '')
      : activeDrugResolution?.atcCategory?.replace(/^Senyawa Farmakologis\s+/i, '') || '-';

  const ddiCount = drug.ddinterCounts?.ddi ?? drug.liveInteractions?.length ?? 0;
  const ddsiCount = drug.ddinterCounts?.ddsi ?? drug.liveDdsi?.length ?? 0;
  const dfiCount = drug.ddinterCounts?.dfi ?? drug.liveDfi?.length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Breadcrumb Bar */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Kembali ke Monografi Obat</span>
        </button>

        <div className="flex items-center gap-2">
          <a
            href={drug.officialUrl || `https://ddinter2.scbdd.com/server/drug-detail/${drug.ddinterId}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Buka pada portal resmi DDInter v2.0"
          >
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Portal DDInter</span>
          </a>
          {onSelectForInteraction && (
            <button
              onClick={() => onSelectForInteraction(drug.id)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Uji Interaksi</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Drug Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 mb-1.5">
              <span className="text-teal-800 font-bold bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                {drug.ddinterId}
              </span>
              {drug.atcCode && drug.atcCode !== '-' && drug.atcCode.length > 1 && (
                <>
                  <span>·</span>
                  <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-semibold">ATC: {drug.atcCode}</span>
                </>
              )}
              {drug.pubchemCid ? (
                <>
                  <span>·</span>
                  <span>PubChem CID: {drug.pubchemCid}</span>
                </>
              ) : null}
              {drug.drugBankId ? (
                <>
                  <span>·</span>
                  <span>DrugBank: {drug.drugBankId}</span>
                </>
              ) : null}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {drug.name}
            </h1>

            <div className="text-xs text-slate-600 mt-2 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-teal-900 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                {activeTherapeuticClass}
              </span>
              {drug.brandNames && drug.brandNames.length > 0 && (
                <span className="text-slate-600">
                  Nama Dagang:{' '}
                  <span className="text-slate-800 font-medium">
                    {drug.brandNames.join(', ')}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="mt-6 pt-4 border-t border-slate-200 flex items-center overflow-x-auto gap-2 scrollbar-none">
          {[
            {
              key: 'moa',
              label: 'Profil Kimia & Sasaran Target (MoA)',
              icon: FlaskConical,
              count: null,
            },
            {
              key: 'ddi',
              label: 'Interaksi Obat-Obat',
              icon: Pill,
              count: `${ddiCount} DDI`,
            },
            {
              key: 'ddsi',
              label: 'Interaksi Penyakit',
              icon: HeartPulse,
              count: `${ddsiCount} DDSI`,
            },
            {
              key: 'dfi',
              label: 'Interaksi Makanan',
              icon: Utensils,
              count: `${dfiCount} DFI`,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`shrink-0 flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                  isActive
                    ? 'bg-teal-800 text-white border-teal-800 shadow-xs ring-2 ring-teal-700/20'
                    : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-teal-200' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold transition-colors ${
                      isActive
                        ? 'bg-teal-900 text-teal-100 border border-teal-700'
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: Mechanism of Action, Biomolecular Targets & Chemical Structure */}
      {activeTab === 'moa' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Deskripsi &amp; Mekanisme Kerja
                </h4>
                {drug.description && drug.description !== 'None' ? (
                  <p className="text-sm text-slate-800 leading-relaxed">
                    {drug.description}
                  </p>
                ) : drug.pharmacology?.mechanismOfAction && drug.pharmacology.mechanismOfAction !== 'None' ? (
                  <p className="text-sm text-slate-800 leading-relaxed">
                    {drug.pharmacology.mechanismOfAction}
                  </p>
                ) : (
                  <div className="text-sm text-slate-600 space-y-1">
                    <p className="font-medium text-slate-700">
                      Deskripsi teks monografi tidak dicantumkan oleh portal DDInter v2.0 untuk entri ini.
                    </p>
                    <p className="text-xs text-slate-500">
                      Seluruh interaksi klinis ({ddiCount} DDI) terdokumentasi lengkap dari basis data resmi DDInter v2.0.
                    </p>
                  </div>
                )}
              </div>

              {/* DDInter Therapeutic Classification & Registry IDs */}
              <div className="border border-slate-200 rounded-2xl p-5 bg-white space-y-4 shadow-2xs">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  Klasifikasi Anatomis, Terapeutik &amp; Registri
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px] font-mono">Kode Klasifikasi ATC:</span>
                    <span className="text-slate-800 font-bold font-mono text-sm">
                      {drug.atcCode && drug.atcCode.length > 1 ? drug.atcCode : (drug.atcCode && drug.atcCode.length === 1 ? `Grup ${drug.atcCode}` : '-')}
                    </span>
                    <span className="text-teal-700 text-[11px] font-medium block mt-0.5">{activeAtcCategory}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] font-mono">Kelas Farmakoterapi:</span>
                    <span className="text-slate-900 font-bold text-xs leading-snug">{activeTherapeuticClass}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] font-mono">Kategori Molekuler:</span>
                    <span className="text-slate-800 font-medium">
                      {drug.drugType === 'biotech'
                        ? 'Biomolekul / Peptida (Biotech)'
                        : 'Molekul Kecil (Small Molecule)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] font-mono">ID Registri PubChem:</span>
                    <span className="text-slate-800 font-mono font-medium">
                      {drug.pubchemCid ? `CID ${drug.pubchemCid}` : '-'}
                    </span>
                  </div>
                </div>

                {drug.brandNames && drug.brandNames.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-400 block text-[11px] font-mono mb-1.5">
                      Contoh Nama Dagang / Merek Terdaftar:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {drug.brandNames.map((brand, bIdx) => (
                        <span
                          key={bIdx}
                          className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-medium border border-slate-200"
                        >
                          {brand}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-5">
              <ChemicalStructureViewer
                ddinterId={drug.ddinterId}
                formula={drug.molecularFormula}
                molecularWeight={drug.molecularWeight}
                smiles={drug.smiles}
                name={drug.name}
                structureSvg={drug.structureSvg}
                casNumber={drug.casNumber}
                iupacName={drug.iupacName}
                inchi={drug.inchi}
                drugType={drug.drugType}
                proteinSequence={drug.proteinSequence}
                usefulLinks={drug.usefulLinks}
                officialUrl={drug.officialUrl}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: DDInter Drug-Drug Interactions (DDI) */}
      {activeTab === 'ddi' && (
        <div className="space-y-4">
          {drug.liveInteractions && drug.liveInteractions.length > 0 ? (
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3 text-center w-28">Tingkat Keparahan</th>
                      <th className="p-3 w-32">ID DDInter</th>
                      <th className="p-3">Obat Berinteraksi</th>
                      <th className="p-3">Mekanisme Farmakologi Resmi DDInter</th>
                      <th className="p-3 text-center w-28">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {drug.liveInteractions.map((item, idx) => {
                      const sevBg =
                        item.severityLabel === 'Major'
                          ? 'bg-[#a8456b] text-white'
                          : item.severityLabel === 'Moderate'
                          ? 'bg-[#ddc871] text-slate-900'
                          : item.severityLabel === 'Minor'
                          ? 'bg-[#83a78d] text-white'
                          : 'bg-[#b6b2b2] text-white';

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 text-center">
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] shadow-2xs ${sevBg}`}>
                              {item.severityLabel}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-medium text-slate-600">
                            {item.drugId}
                          </td>
                          <td className="p-3 font-semibold text-slate-900">
                            {item.drugName}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {item.antagonistic_effect && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#61649f] text-white">
                                  Antagonism
                                </span>
                              )}
                              {item.synergistic_effect && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#cf7543] text-white">
                                  Synergy
                                </span>
                              )}
                              {item.absorption && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#579572] text-white">
                                  Absorption
                                </span>
                              )}
                              {item.distribution && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#c45a65] text-white">
                                  Distribution
                                </span>
                              )}
                              {item.metabolism && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#1491a8] text-white">
                                  Metabolism
                                </span>
                              )}
                              {item.excretion && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#8a988e] text-white">
                                  Excretion
                                </span>
                              )}
                              {item.others && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#f9d27d] text-slate-900">
                                  Others
                                </span>
                              )}
                              {!item.antagonistic_effect &&
                                !item.synergistic_effect &&
                                !item.absorption &&
                                !item.distribution &&
                                !item.metabolism &&
                                !item.excretion &&
                                !item.others && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#b5aa90] text-white">
                                    Unknown
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {onSelectForInteraction && (
                                <button
                                  onClick={() => onSelectForInteraction(item.drugId)}
                                  title={`Tambahkan ${item.drugName} ke uji interaksi`}
                                  className="p-1 text-teal-800 bg-teal-50 hover:bg-teal-100 rounded transition-colors cursor-pointer"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <a
                                href={`https://ddinter2.scbdd.com/server/drug-detail/${item.drugId}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 text-[11px] font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded inline-flex items-center gap-0.5 transition-colors"
                              >
                                <span>Lihat</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500 shadow-2xs">
              Tidak ada data pasangan interaksi obat (DDI) untuk obat ini di basis data DDInter.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: DDInter Drug-Disease Interactions (DDSI) */}
      {activeTab === 'ddsi' && (
        <div className="space-y-4">
          {drug.liveDdsi && drug.liveDdsi.length > 0 ? (
            <div className="space-y-3">
              {drug.liveDdsi.map((item, idx) => (
                <div key={idx} className="p-5 bg-white border border-rose-200/80 rounded-2xl text-xs space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                    <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                        item.level === 3 ? 'bg-[#c45a65] text-white' : item.level === 2 ? 'bg-[#f4a261] text-slate-900' : 'bg-[#e9c46a] text-slate-900'
                      }`}>
                        Level {item.level} ({item.severityLabel})
                      </span>
                      {item.diseaseName}
                    </span>
                  </div>
                  <p className="text-slate-800 leading-relaxed text-xs">
                    {item.text}
                  </p>
                  {item.references && (
                    <span className="text-[10px] text-slate-500 block pt-1.5 border-t border-slate-100 italic">
                      Referensi DDInter: {item.references}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500 shadow-2xs">
              Tidak ada catatan kontraindikasi obat-penyakit (DDSI) untuk obat ini di basis data DDInter.
            </div>
          )}
        </div>
      )}

      {/* Tab 4: DDInter Drug-Food Interactions (DFI) */}
      {activeTab === 'dfi' && (
        <div className="space-y-4">
          {drug.liveDfi && drug.liveDfi.length > 0 ? (
            <div className="space-y-3">
              {drug.liveDfi.map((item, idx) => (
                <div key={idx} className="p-5 bg-white border border-amber-200/80 rounded-2xl text-xs space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                    <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                        item.level === 3 ? 'bg-[#c45a65] text-white' : item.level === 2 ? 'bg-[#f4a261] text-slate-900' : 'bg-[#e9c46a] text-slate-900'
                      }`}>
                        Level {item.level} ({item.severityLabel})
                      </span>
                      {item.foodName}
                    </span>
                  </div>
                  {item.management && (
                    <p className="text-slate-800 leading-relaxed text-xs">
                      <strong className="text-amber-900">Manajemen Klinis: </strong>{item.management}
                    </p>
                  )}
                  {item.mechanism && (
                    <p className="text-slate-700 leading-relaxed text-xs">
                      <strong className="text-slate-600">Mekanisme: </strong>{item.mechanism}
                    </p>
                  )}
                  {item.references && (
                    <span className="text-[10px] text-slate-500 block pt-1.5 border-t border-slate-100 italic">
                      Referensi DDInter: {item.references}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-xs text-slate-500 shadow-2xs">
              Tidak ada catatan interaksi obat-makanan (DFI) untuk obat ini di basis data DDInter.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
