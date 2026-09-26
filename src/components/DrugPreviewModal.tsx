import React, { useState, useEffect } from 'react';
import {
  X,
  Pill,
  ArrowLeftRight,
  Loader2,
  AlertCircle,
  FlaskConical,
  ShieldCheck,
  Activity,
  Layers,
  Sparkles,
} from 'lucide-react';
import { DrugMonograph } from '../types/pharmacy.ts';
import { ChemicalStructureViewer } from './ChemicalStructureViewer.tsx';

interface DrugPreviewModalProps {
  drugId: string | null;
  replacingDrugName?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSwapDrug?: (oldDrugName: string, newDrug: DrugMonograph) => void;
  onAddDrug?: (drug: DrugMonograph) => void;
}

export const DrugPreviewModal: React.FC<DrugPreviewModalProps> = ({
  drugId,
  replacingDrugName,
  isOpen,
  onClose,
  onSwapDrug,
}) => {
  const [drug, setDrug] = useState<DrugMonograph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'structure'>('overview');

  useEffect(() => {
    if (!isOpen || !drugId) {
      setDrug(null);
      return;
    }

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
  }, [isOpen, drugId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !drugId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-start justify-between gap-3 border-b border-slate-800">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 mt-0.5 shadow-2xs">
              <Pill className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-500/25 border border-indigo-400/30 text-indigo-200 font-mono">
                  {drug?.ddinterId || drugId}
                </span>
                {drug?.atcCode && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 font-mono">
                    ATC: {drug.atcCode}
                  </span>
                )}
                {drug?.atcCategory && (
                  <span className="text-[11px] text-slate-300 font-medium">
                    {drug.atcCategory}
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                {drug?.name || drugId}
              </h2>
              {drug?.brandNames && drug.brandNames.length > 0 && (
                <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                  Merek dagang: {drug.brandNames.join(', ')}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Tutup modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Clean Substitution Banner */}
        {replacingDrugName && drug && onSwapDrug && (
          <div className="bg-emerald-50/80 border-b border-emerald-100/90 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-emerald-950 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Obat alternatif terverifikasi DDInter untuk menggantikan{' '}
                <strong className="font-bold underline decoration-emerald-500 text-emerald-900">{replacingDrugName}</strong>.
              </span>
            </div>
            <button
              onClick={() => {
                onSwapDrug(replacingDrugName, drug);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white shadow-xs transition-all cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Gunakan {drug.name} sebagai Pengganti</span>
            </button>
          </div>
        )}

        {/* Clean Segmented Tab Bar */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between">
          <div className="inline-flex p-1 bg-slate-200/70 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              Monografi &amp; Farmakologi
            </button>
            <button
              onClick={() => setActiveTab('structure')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'structure'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              Struktur Molekul &amp; Kimia
            </button>
          </div>
          <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
            Monografi Internal
          </span>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading && (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600" />
              <p className="text-xs font-medium">Memuat monografi obat dari database internal DDInter...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Gagal memuat data monografi</p>
                <p className="mt-0.5 text-rose-700">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && drug && (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-4 text-xs">
                  {/* Clean Metric Tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] uppercase text-slate-500 font-semibold block">Interaksi DDI</span>
                      <span className="text-base font-bold text-slate-900">{drug.ddinterCounts?.ddi || 0} Pasangan</span>
                    </div>
                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] uppercase text-slate-500 font-semibold block">Interaksi Makanan</span>
                      <span className="text-base font-bold text-slate-900">{drug.ddinterCounts?.dfi || 0} Terdata</span>
                    </div>
                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] uppercase text-slate-500 font-semibold block">Kontraindikasi Penyakit</span>
                      <span className="text-base font-bold text-slate-900">{drug.ddinterCounts?.ddsi || 0} Kondisi</span>
                    </div>
                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/80">
                      <span className="text-[10px] uppercase text-slate-500 font-semibold block">Tipe Senyawa</span>
                      <span className="text-base font-bold text-slate-900 capitalize">{drug.drugType || 'Small Molecule'}</span>
                    </div>
                  </div>

                  {/* Description & Clinical Profile */}
                  {drug.description && drug.description !== '-' && (
                    <div className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2 shadow-2xs">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2 text-xs sm:text-sm">
                        <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                          <Activity className="w-3.5 h-3.5" />
                        </div>
                        Ringkasan Klinis &amp; Indikasi Farmakoterapi
                      </h3>
                      <p className="text-slate-700 leading-relaxed pl-8">
                        {drug.description}
                      </p>
                    </div>
                  )}

                  {/* Mechanism of Action */}
                  {drug.pharmacology?.mechanismOfAction && drug.pharmacology.mechanismOfAction !== '-' && (
                    <div className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2 shadow-2xs">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2 text-xs sm:text-sm">
                        <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <FlaskConical className="w-3.5 h-3.5" />
                        </div>
                        Mekanisme Aksi (Mechanism of Action)
                      </h3>
                      <p className="text-slate-700 leading-relaxed pl-8">
                        {drug.pharmacology.mechanismOfAction}
                      </p>
                    </div>
                  )}

                  {/* Pharmacological Targets */}
                  {drug.pharmacology?.targets && drug.pharmacology.targets.length > 0 && (
                    <div className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2.5 shadow-2xs">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2 text-xs sm:text-sm">
                        <div className="w-6 h-6 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        Target Biologis &amp; Reseptor
                      </h3>
                      <div className="flex flex-wrap gap-1.5 pl-8">
                        {drug.pharmacology.targets.map((tgt, idx) => {
                          const targetName = typeof tgt === 'string' ? tgt : tgt.name;
                          const targetMeta = typeof tgt === 'object' && tgt ? `${tgt.action || ''} ${tgt.type || ''}`.trim() : '';
                          return (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200/80 text-sky-900 font-medium inline-flex items-center gap-1.5"
                            >
                              <span>{targetName}</span>
                              {targetMeta && (
                                <span className="text-[10px] text-sky-600 bg-sky-100/70 px-1.5 py-0.5 rounded font-mono">
                                  {targetMeta}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'structure' && (
                <div className="space-y-4">
                  <ChemicalStructureViewer
                    ddinterId={drug.ddinterId}
                    name={drug.name}
                    formula={drug.molecularFormula || '-'}
                    molecularWeight={drug.molecularWeight || 0}
                    smiles={drug.smiles || ''}
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
              )}
            </>
          )}
        </div>

        {/* Clean, Minimal Footer (No redundant external link clutter) */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Basis Data Monografi Internal DDInter v2.0</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
            >
              Tutup
            </button>
            {replacingDrugName && drug && onSwapDrug && (
              <button
                onClick={() => {
                  onSwapDrug(replacingDrugName, drug);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white shadow-xs transition-all cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Gunakan {drug.name}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
