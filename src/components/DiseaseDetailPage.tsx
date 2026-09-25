import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  PlusCircle,
  ShieldAlert,
  Layers,
  FileText,
  AlertCircle,
  Copy,
  Check,
  CheckCircle2,
  Loader2,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { DiseaseInfo } from '../types/pharmacy.ts';
import {
  getDiseaseClinicalMonograph,
} from '../data/diseaseClinicalData.ts';

interface DiseaseDetailPageProps {
  diseaseName: string;
  onBack: () => void;
  onSelectForInteraction?: (diseaseName: string) => void;
  onOpenDrugMonograph?: (drugId: string) => void;
}

export const DiseaseDetailPage: React.FC<DiseaseDetailPageProps> = ({
  diseaseName,
  onBack,
  onSelectForInteraction,
  onOpenDrugMonograph,
}) => {
  const [disease, setDisease] = useState<DiseaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'all' | 'warnings' | 'contraindicated' | 'references'>('all');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | '3' | '2' | '1'>('ALL');
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/diseases/${encodeURIComponent(diseaseName)}`);
        if (!res.ok) {
          throw new Error(`Data kondisi klinis "${diseaseName}" tidak ditemukan.`);
        }
        const data = await res.json();
        if (!data.clinicalMonograph) {
          data.clinicalMonograph = getDiseaseClinicalMonograph(data.name || diseaseName);
        }
        if (isMounted) {
          setDisease(data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Gagal memuat rincian penyakit.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [diseaseName]);

  const handleCopyCitation = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(id);
    setTimeout(() => setCopiedRef(null), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Kembali ke Informasi Penyakit</span>
        </button>
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-teal-700 animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-700">Memuat data klinis interaksi penyakit...</p>
          <p className="text-xs text-slate-400 font-mono mt-1">Mengambil data dari DDInter v2.0</p>
        </div>
      </div>
    );
  }

  if (error || !disease) {
    return (
      <div className="space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Kembali ke Informasi Penyakit</span>
        </button>
        <div className="bg-white border border-rose-200 rounded-xl p-12 text-center">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-900">Data Penyakit Tidak Ditemukan</h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
            {error || `Entitas klinis "${diseaseName}" tidak ditemukan di database DDInter.`}
          </p>
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors cursor-pointer"
          >
            Lihat Semua Penyakit
          </button>
        </div>
      </div>
    );
  }

  const monograph = disease.clinicalMonograph || getDiseaseClinicalMonograph(disease.name);
  const officialRefs = monograph.ddinterOfficialReferences || monograph.clinicalReferences || [];

  const getUrgencyBadge = (urgency?: string) => {
    const text = urgency || 'Perlu Pemantauan Medis';
    if (text.includes('Emergensi') || text.includes('Akut') || text.includes('Mayor')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
          <AlertCircle className="w-3 h-3 text-rose-600" />
          {text}
        </span>
      );
    }
    if (text.includes('Progresif') || text.includes('Ketat') || text.includes('Pemantauan')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          <ShieldAlert className="w-3 h-3 text-amber-600" />
          {text}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
        <CheckCircle2 className="w-3 h-3 text-teal-600" />
        {text}
      </span>
    );
  };

  const ddsiRecords = disease.ddsiRecords || [];
  const filteredDdsiRecords = ddsiRecords.filter((rec) => {
    if (severityFilter === 'ALL') return true;
    return String(rec.level) === severityFilter;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Breadcrumb Bar */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500" />
          <span>Kembali ke Informasi Penyakit</span>
        </button>
      </div>

      {/* Main Disease Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 mb-2">
              <span className="font-mono bg-teal-100/80 text-teal-900 px-2.5 py-0.5 rounded font-bold">
                {monograph.organSystem}
              </span>
              {getUrgencyBadge(monograph.urgencyLevel)}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {disease.name}
            </h1>

            <div className="text-xs text-slate-500 font-mono mt-2 flex flex-wrap items-center gap-2">
              <span>Klasifikasi Organ: <strong className="text-slate-800">{monograph.organSystem}</strong></span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveSection('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
              activeSection === 'all'
                ? 'bg-teal-800 text-white border-teal-800 shadow-xs ring-2 ring-teal-700/20'
                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Semua Informasi
          </button>
          <button
            onClick={() => setActiveSection('warnings')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1.5 ${
              activeSection === 'warnings'
                ? 'bg-teal-800 text-white border-teal-800 shadow-xs ring-2 ring-teal-700/20'
                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Peringatan Klinis &amp; Distribusi</span>
          </button>
          <button
            onClick={() => setActiveSection('contraindicated')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1.5 ${
              activeSection === 'contraindicated'
                ? 'bg-teal-800 text-white border-teal-800 shadow-xs ring-2 ring-teal-700/20'
                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Daftar Obat Terkontraindikasi ({monograph.ddinterSeverityDistribution.total || disease.contraindicatedDrugsCount})</span>
          </button>
          <button
            onClick={() => setActiveSection('references')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1.5 ${
              activeSection === 'references'
                ? 'bg-teal-800 text-white border-teal-800 shadow-xs ring-2 ring-teal-700/20'
                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Rujukan Ilmiah DDInter</span>
          </button>
        </div>
      </div>

      {/* Section 1: Clinical Warnings & Severity Metrics */}
      {(activeSection === 'all' || activeSection === 'warnings') && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-teal-700" />
              <span>Ringkasan Keamanan &amp; Distribusi Keparahan DDInter v2.0</span>
            </h3>
          </div>

          {/* Severity Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[10px] font-mono text-slate-500 block uppercase">Total Interaksi Obat</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
                {monograph.ddinterSeverityDistribution.total || disease.contraindicatedDrugsCount}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">Obat Terindeks DDInter</span>
            </div>
            <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[10px] font-mono text-rose-800 block uppercase font-bold">Major (Level 3)</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-rose-900">
                {monograph.ddinterSeverityDistribution.major}
              </span>
              <span className="text-[10px] text-rose-700 block mt-0.5">Kontraindikasi Kuat</span>
            </div>
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[10px] font-mono text-amber-800 block uppercase font-bold">Moderate (Level 2)</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-amber-900">
                {monograph.ddinterSeverityDistribution.moderate}
              </span>
              <span className="text-[10px] text-amber-700 block mt-0.5">Pemantauan Klinis</span>
            </div>
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[10px] font-mono text-emerald-800 block uppercase font-bold">Minor (Level 1)</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-900">
                {monograph.ddinterSeverityDistribution.minor}
              </span>
              <span className="text-[10px] text-emerald-700 block mt-0.5">Penyesuaian Ringan</span>
            </div>
          </div>

          {/* Official DDInter Warning */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Peringatan Klinis Resmi DDInter v2.0:
            </h4>
            <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">
              {monograph.ddinterWarningSummary}
            </p>
          </div>
        </div>
      )}

      {/* Section 2: Contraindicated Drugs Table */}
      {(activeSection === 'all' || activeSection === 'contraindicated') && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-teal-700" />
                <span>Daftar Obat Terkontraindikasi Resmi DDInter ({filteredDdsiRecords.length} Obat)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Data pasangan obat-penyakit yang diekstrak dari basis data relasional DDInter v2.0
              </p>
            </div>

            {/* Severity Filter Dropdown */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as any)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-hidden font-medium cursor-pointer"
              >
                <option value="ALL">Semua Tingkat Keparahan</option>
                <option value="3">Hanya Mayor (Level 3)</option>
                <option value="2">Hanya Moderat (Level 2)</option>
                <option value="1">Hanya Minor (Level 1)</option>
              </select>
            </div>
          </div>

          {filteredDdsiRecords.length > 0 ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3 w-28 text-center">Tingkat</th>
                      <th className="p-3 w-44">Nama Obat Terkontraindikasi</th>
                      <th className="p-3 w-28 font-mono">ID DDInter</th>
                      <th className="p-3">Peringatan Klinis DDInter</th>
                      <th className="p-3 w-28 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDdsiRecords.map((item, idx) => {
                      const sevBadge =
                        String(item.level) === '3' ? (
                          <span className="px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-[#c45a65] text-white">
                            Mayor (L3)
                          </span>
                        ) : String(item.level) === '2' ? (
                          <span className="px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-[#f4a261] text-slate-900">
                            Moderat (L2)
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-[#e9c46a] text-slate-900">
                            Minor (L1)
                          </span>
                        );

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 text-center">{sevBadge}</td>
                          <td className="p-3 font-bold text-slate-900">{item.drugName}</td>
                          <td className="p-3 font-mono text-slate-600">{item.drugId || '-'}</td>
                          <td className="p-3 text-slate-700 leading-relaxed">{item.text}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {onOpenDrugMonograph && (
                                <button
                                  type="button"
                                  onClick={() => onOpenDrugMonograph(item.drugId || item.drugName)}
                                  title={`Buka monografi lengkap ${item.drugName}`}
                                  className="px-2 py-1 text-[11px] font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded inline-flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <span>Obat</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                              <a
                                href={`https://ddinter2.scbdd.com/server/dis_food/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                                title="Lihat di DDInter"
                              >
                                <ExternalLink className="w-3 h-3" />
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
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl">
              Tidak ada obat yang cocok dengan filter keparahan yang dipilih.
            </div>
          )}
        </div>
      )}

      {/* Section 3: Official DDInter References */}
      {(activeSection === 'all' || activeSection === 'references') && officialRefs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-700" />
              <span>Rujukan Ilmiah Resmi DDInter ({officialRefs.length} Literatur)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Literatur klinis resmi yang mendasari korelasi obat-penyakit ini pada DDInter v2.0
            </p>
          </div>

          <div className="space-y-2.5">
            {officialRefs.map((ref, idx) => (
              <div
                key={idx}
                className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-start justify-between gap-3 group hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="font-mono text-slate-400 text-[11px] shrink-0">[{idx + 1}]</span>
                  <p className="text-slate-800 leading-relaxed font-serif text-[11.5px]">{ref}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyCitation(ref, `ref-${idx}`)}
                  className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-teal-900 bg-white border border-slate-200 rounded-md transition-colors shrink-0 inline-flex items-center gap-1 cursor-pointer"
                  title="Salin rujukan sitasi"
                >
                  {copiedRef === `ref-${idx}` ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span className="text-emerald-700 font-semibold">Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Salin</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
