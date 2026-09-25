import React, { useState, useEffect } from 'react';
import {
  Search,
  Zap,
  Globe,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Layers,
  HeartPulse,
  Utensils,
  Copy,
  AlertTriangle,
  BookOpen,
  Info,
  X,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { DrugInteraction } from '../types/pharmacy.ts';
import { PaginationControls } from './PaginationControls.tsx';

export type TableType = 'ddi' | 'ddsi' | 'dfi' | 'dupli';

interface DDInterTableViewProps {
  onSelectForInteraction?: (drugId: string) => void;
  onOpenDrugMonograph?: (drugId: string) => void;
}

export const DDInterTableView: React.FC<DDInterTableViewProps> = ({
  onSelectForInteraction,
  onOpenDrugMonograph,
}) => {
  const [activeTable, setActiveTable] = useState<TableType>('ddi');
  const [loadedTableType, setLoadedTableType] = useState<TableType>('ddi');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [categoriesList, setCategoriesList] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [executionTimeMs, setExecutionTimeMs] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);

  // Fetch duplication categories list
  useEffect(() => {
    fetch('/api/ddinter/dupli-categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.categories) setCategoriesList(data.categories);
      })
      .catch(() => {});
  }, []);

  const scrollPosRef = React.useRef<number | null>(null);

  const fetchTable = async (currentPage = 1, forceNoCache = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: activeTable,
        page: currentPage.toString(),
        limit: '15',
        search: search.trim(),
        severity: severity,
        category: category,
        nocache: forceNoCache ? 'true' : 'false',
      });
      const res = await fetch(`/api/ddinter/table?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setRows(json.rows || []);
        setLoadedTableType(activeTable);
        setTotalPages(json.totalPages || 1);
        setTotalCount(json.total || 0);
        setExecutionTimeMs(json.executionTimeMs || 0);
        setFromCache(Boolean(json.fromCache));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      if (scrollPosRef.current !== null) {
        const targetY = scrollPosRef.current;
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, behavior: 'instant' });
        });
      }
    }
  };

  useEffect(() => {
    fetchTable(page);
  }, [page, search, severity, category, activeTable]);

  const handleTabChange = (type: TableType) => {
    setActiveTable(type);
    setRows([]);
    setPage(1);
    setSearch('');
    setSeverity('');
    setCategory('');
  };

  const getSeverityBadge = (level: string | number, sevText: string) => {
    const isMajor = String(level) === '3' || sevText.toLowerCase().includes('major') || sevText.toLowerCase().includes('contraindicated');
    const isModerate = String(level) === '2' || sevText.toLowerCase().includes('moderate');
    const isMinor = String(level) === '1' || sevText.toLowerCase().includes('minor');
    const isUnknown = String(level) === '0' || sevText.toLowerCase().includes('unknown');

    if (isMajor) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-[#a8456b] text-white shadow-2xs whitespace-nowrap">
          {sevText || 'Major'}
        </span>
      );
    }
    if (isModerate) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-[#ddc871] text-slate-900 shadow-2xs whitespace-nowrap">
          {sevText || 'Moderate'}
        </span>
      );
    }
    if (isMinor) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-[#83a78d] text-white shadow-2xs whitespace-nowrap">
          {sevText || 'Minor'}
        </span>
      );
    }
    if (isUnknown) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-[#b6b2b2]/30 text-slate-700 shadow-2xs whitespace-nowrap border border-[#b6b2b2]">
          {sevText || 'Unknown'}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-slate-200 text-slate-800 whitespace-nowrap">
        {sevText || 'Informasi'}
      </span>
    );
  };

  const severityOptions = [
    { value: '', label: 'Semua Tingkat Keparahan' },
    { value: 'Major', label: 'Tingkat Mayor / Kontraindikasi' },
    { value: 'Moderate', label: 'Tingkat Moderat' },
    { value: 'Minor', label: 'Tingkat Minor' },
    { value: 'Unknown', label: 'Tingkat Tidak Diketahui (Unknown)' },
  ];


  const handlePageChange = (newPage: number) => {
    scrollPosRef.current = window.scrollY;
    setPage(newPage);
  };

  const isTableLoading = (loading && rows.length === 0) || loadedTableType !== activeTable;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Tabel Interaksi
            </h1>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg text-xs">
            <span className="text-slate-500">Total Baris:</span>
            <span className="font-semibold text-teal-900 font-mono">
              {totalCount > 0 ? totalCount.toLocaleString('id-ID') : '302.655'}
            </span>
          </div>
        </div>

        {/* 4 Interactive Sub-Navigation Tabs - Harmonized 4-Column Grid */}
        <div className="mt-6 border-b border-slate-200">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <button
              onClick={() => handleTabChange('ddi')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer text-center ${
                activeTable === 'ddi'
                  ? 'border-teal-800 text-teal-900 font-bold bg-teal-50/70'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-4 h-4 text-teal-700 shrink-0" />
              <span>Drug-Drug Interaction (DDI)</span>
            </button>

            <button
              onClick={() => handleTabChange('ddsi')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer text-center ${
                activeTable === 'ddsi'
                  ? 'border-teal-800 text-teal-900 font-bold bg-teal-50/70'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <HeartPulse className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Drug-Disease Interaction (DDSI)</span>
            </button>

            <button
              onClick={() => handleTabChange('dfi')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer text-center ${
                activeTable === 'dfi'
                  ? 'border-teal-800 text-teal-900 font-bold bg-teal-50/70'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Utensils className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Drug-Food Interaction (DFI)</span>
            </button>

            <button
              onClick={() => handleTabChange('dupli')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg border-b-2 transition-all cursor-pointer text-center ${
                activeTable === 'dupli'
                  ? 'border-teal-800 text-teal-900 font-bold bg-teal-50/70'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Copy className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>Therapeutic Duplication Warning</span>
            </button>
          </div>
        </div>

        {/* Dynamic Filter Bar */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className={`${activeTable === 'dupli' ? 'sm:col-span-7' : 'sm:col-span-8'} relative`}>
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={
                activeTable === 'ddi'
                  ? 'Cari Drug A, Drug B, DDInter ID (misal DDInter1), atau mekanisme...'
                  : activeTable === 'ddsi'
                  ? 'Cari nama obat (misal Abacavir), nama penyakit (misal Liver Diseases, Renal...), atau teks peringatan...'
                  : activeTable === 'dfi'
                  ? 'Cari nama obat (misal Calcium, Warfarin), makanan (misal spinach, milk, alcohol), atau mekanisme...'
                  : 'Cari obat kombinasi dagang, komposisi zat aktif, obat tunggal, atau kategori farmakologi...'
              }
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all placeholder:text-slate-400"
            />
          </div>

          {activeTable !== 'dupli' ? (
            <div className="sm:col-span-4">
              <select
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all cursor-pointer"
              >
                {severityOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="sm:col-span-5">
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all cursor-pointer"
              >
                <option value="">Semua Kelas Farmakologi (96 Kategori)</option>
                {categoriesList.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          {/* 1. DDI TABLE */}
          {activeTable === 'ddi' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 font-mono w-[130px] shrink-0">DDInter ID</th>
                  <th className="py-3 px-3 w-[150px]">Drug A</th>
                  <th className="py-3 px-3 w-[150px]">Drug B</th>
                  <th className="py-3 px-3 w-[100px] text-center">Keparahan</th>
                  <th className="py-3 px-3 min-w-[200px]">Mekanisme Kerja Farmakologi</th>
                  <th className="py-3 px-3 min-w-[200px]">Tindakan Klinis</th>
                  <th className="py-3 px-3 w-[100px] text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isTableLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={7} className="py-4 px-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Tidak ada baris data DDI yang cocok dengan kriteria pencarian.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const ddinterA = row.drugA?.ddinterId || (row.ddinterId ? row.ddinterId.split('_')[0] : '');
                    const ddinterB = row.drugB?.ddinterId || (row.ddinterId ? row.ddinterId.split('_')[1] : '');
                    const drugAName = typeof row.drugA === 'object' ? row.drugA?.name || '' : String(row.drugA || '');
                    const drugBName = typeof row.drugB === 'object' ? row.drugB?.name || '' : String(row.drugB || '');
                    const drugAId = typeof row.drugA === 'object' ? row.drugA?.id || '' : String(row.drugA || '');
                    const drugBId = typeof row.drugB === 'object' ? row.drugB?.id || '' : String(row.drugB || '');

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 font-mono font-semibold text-teal-800 text-[11px] whitespace-nowrap">
                          {row.ddinterId || '-'}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="leading-snug">{drugAName}</span>
                            {ddinterA && (
                              <a
                                href={`https://ddinter2.scbdd.com/server/drug-detail/${ddinterA}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1 py-0.5 rounded hover:bg-teal-100 transition-colors shrink-0"
                                title="Buka monografi resmi DDInter"
                              >
                                {ddinterA}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="leading-snug">{drugBName}</span>
                            {ddinterB && (
                              <a
                                href={`https://ddinter2.scbdd.com/server/drug-detail/${ddinterB}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1 py-0.5 rounded hover:bg-teal-100 transition-colors shrink-0"
                                title="Buka monografi resmi DDInter"
                              >
                                {ddinterB}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {getSeverityBadge(row.levelNum, row.severity)}
                        </td>
                        <td className="py-3 px-3 text-slate-700 leading-relaxed text-[11.5px]">
                          {row.mechanismTags && row.mechanismTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {row.mechanismTags.map((tag: string, tIdx: number) => (
                                <span
                                  key={tIdx}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium bg-slate-100 text-slate-700 border border-slate-200"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="text-slate-800 font-normal leading-relaxed">{row.mechanism}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700 leading-relaxed text-[11.5px]">
                          <div className="p-2 rounded-lg bg-amber-50/70 border border-amber-200/70 text-slate-900 font-medium leading-relaxed">
                            {row.management}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {onSelectForInteraction && (
                            <button
                              onClick={() => {
                                onSelectForInteraction(drugAId);
                                onSelectForInteraction(drugBId);
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded border border-teal-200 transition-colors cursor-pointer"
                            >
                              Uji Pasangan
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {/* 2. DDSI TABLE (Drug-Disease Interaction) */}
          {activeTable === 'ddsi' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 font-mono w-[100px] shrink-0">DDInter ID</th>
                  <th className="py-3 px-3 w-[150px]">Nama Obat (Drug)</th>
                  <th className="py-3 px-3 w-[180px]">Kondisi Penyakit (Disease)</th>
                  <th className="py-3 px-3 w-[120px] text-center">Tingkat Risiko</th>
                  <th className="py-3 px-3 min-w-[220px]">Peringatan Klinis &amp; Patofisiologi</th>
                  <th className="py-3 px-3 w-[100px] text-center">Referensi</th>
                  <th className="py-3 px-3 w-[90px] text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isTableLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={7} className="py-4 px-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Tidak ada interaksi obat-penyakit (DDSI) yang cocok dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const refList = row.references ? String(row.references).split('|').filter(Boolean) : [];
                    const drugName = typeof row.drugName === 'object' ? row.drugName?.name || '' : String(row.drugName || '');
                    const diseaseName = typeof row.diseaseName === 'object' ? row.diseaseName?.name || '' : String(row.diseaseName || '');

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 font-mono font-semibold text-teal-800 text-[11px] whitespace-nowrap">
                          {row.ddinterId || '-'}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="leading-snug">{drugName}</span>
                            {row.officialUrl && (
                              <a
                                href={row.officialUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1 py-0.5 rounded hover:bg-teal-100 transition-colors shrink-0"
                                title="Buka profil obat DDInter"
                              >
                                {row.ddinterId}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-900 font-medium text-[11px] leading-snug">
                            <HeartPulse className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>{diseaseName}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {getSeverityBadge(row.level, row.severity)}
                        </td>
                        <td className="py-3 px-3 text-slate-700 leading-relaxed text-[11px]">
                          <p className="line-clamp-2">{row.warningText}</p>
                          {row.warningText && row.warningText.length > 120 && (
                            <button
                              onClick={() => setSelectedDetail(row)}
                              className="text-[10px] text-teal-800 hover:text-teal-950 font-bold hover:underline mt-0.5 cursor-pointer block"
                            >
                              Baca Selengkapnya »
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {refList.length > 0 ? (
                            <button
                              onClick={() => setSelectedDetail(row)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[10px] font-mono font-medium transition-colors cursor-pointer"
                            >
                              <BookOpen className="w-3 h-3 text-slate-500" />
                              {refList.length} Ref
                            </button>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button
                            onClick={() => setSelectedDetail(row)}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 rounded border border-slate-200 transition-colors cursor-pointer"
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {/* 3. DFI TABLE (Drug-Food Interaction) */}
          {activeTable === 'dfi' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 font-mono w-[100px] shrink-0">DDInter ID</th>
                  <th className="py-3 px-3 w-[150px]">Nama Obat (Drug)</th>
                  <th className="py-3 px-3 w-[140px]">Makanan / Nutrien</th>
                  <th className="py-3 px-3 w-[100px] text-center">Keparahan</th>
                  <th className="py-3 px-3 min-w-[200px]">Mekanisme Interaksi Nutrisi</th>
                  <th className="py-3 px-3 min-w-[200px]">Panduan Pasien</th>
                  <th className="py-3 px-3 w-[90px] text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isTableLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={7} className="py-4 px-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Tidak ada data interaksi obat-makanan (DFI) yang cocok dengan pencarian.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const drugName = typeof row.drugName === 'object' ? row.drugName?.name || '' : String(row.drugName || '');
                    const foodName = typeof row.foodName === 'object' ? row.foodName?.name || '' : String(row.foodName || '');

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 font-mono font-semibold text-teal-800 text-[11px] whitespace-nowrap">
                          {row.ddinterId || '-'}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="leading-snug">{drugName}</span>
                            {row.officialUrl && (
                              <a
                                href={row.officialUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1 py-0.5 rounded hover:bg-teal-100 transition-colors shrink-0"
                                title="Buka profil obat DDInter"
                              >
                                {row.ddinterId}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-semibold uppercase tracking-wider text-[10px]">
                            <Utensils className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>{foodName}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {getSeverityBadge(row.level, row.severity)}
                        </td>
                        <td className="py-3 px-3 text-slate-700 leading-relaxed text-[11px]">
                          {row.mechanism}
                        </td>
                        <td className="py-3 px-3 text-slate-800 leading-relaxed text-[11px] font-medium">
                          {row.management}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button
                            onClick={() => setSelectedDetail(row)}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 rounded border border-slate-200 transition-colors cursor-pointer"
                          >
                            Detail
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {/* 4. DUPLICATION TABLE (Therapeutic Duplication Warning) */}
          {activeTable === 'dupli' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 w-[150px]">Produk Kombinasi</th>
                  <th className="py-3 px-3 w-[180px]">Komposisi Zat Aktif</th>
                  <th className="py-3 px-3 w-[130px] text-center">Kelas Terapi</th>
                  <th className="py-3 px-3 w-[150px]">Obat Terduplikasi</th>
                  <th className="py-3 px-3 min-w-[220px]">Peringatan Duplikasi DDInter</th>
                  <th className="py-3 px-3 min-w-[220px]">Catatan Klinis Farmasis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isTableLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={6} className="py-4 px-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Tidak ada catatan duplikasi terapi yang cocok dengan kriteria pencarian.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const drugMultiTrade = typeof row.drugMultiTrade === 'object' ? row.drugMultiTrade?.name || '' : String(row.drugMultiTrade || '');
                    const drugMulti = typeof row.drugMulti === 'object' ? row.drugMulti?.name || '' : String(row.drugMulti || '');
                    const drugType = typeof row.drugType === 'object' ? row.drugType?.name || '' : String(row.drugType || '');
                    const drugB = typeof row.drugB === 'object' ? row.drugB?.name || '' : String(row.drugB || '');
                    const ddinterIdB = row.ddinterIdB || (typeof row.drugB === 'object' ? row.drugB?.ddinterId || '' : '');
                    const officialUrl = row.officialUrl || (typeof row.drugB === 'object' ? row.drugB?.officialUrl || '' : '');

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <Copy className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="leading-snug">{drugMultiTrade}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-800 text-[11px] leading-snug">
                          {drugMulti}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 border border-indigo-200 text-indigo-800 uppercase tracking-wide">
                            {drugType}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="leading-snug">{drugB}</span>
                            {ddinterIdB && (
                              <a
                                href={officialUrl || `https://ddinter2.scbdd.com/server/drug-detail/${ddinterIdB}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1 py-0.5 rounded hover:bg-teal-100 transition-colors shrink-0"
                                title="Buka profil obat DDInter"
                              >
                                {ddinterIdB}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-800 leading-relaxed text-[11px] font-medium">
                          <div className="flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <span>{row.warning}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 leading-relaxed text-[11px]">
                          {row.note}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer with Pagination */}
        <div className="p-3 bg-slate-50 border-t border-slate-200">
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalCount}
            itemLabel="catatan terindeks"
            onPageChange={handlePageChange}
            disabled={loading}
          />
        </div>
      </div>

      {/* Detail Modal for DDSI, DFI, or DDI deep inspection */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-teal-50 border border-teal-200 rounded-lg text-teal-800">
                  <BookOpen className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {typeof selectedDetail.drugName === 'object'
                      ? selectedDetail.drugName?.name
                      : selectedDetail.drugName ||
                        (typeof selectedDetail.drugA === 'object' ? selectedDetail.drugA?.name : selectedDetail.drugA) ||
                        'Rincian Interaksi DDInter'}
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    DDInter ID: {selectedDetail.ddinterId || '-'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1 min-h-0">
              {/* Disease or Food badge */}
              {selectedDetail.diseaseName && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HeartPulse className="w-5 h-5 text-rose-600" />
                    <div>
                      <span className="text-[10px] text-rose-500 uppercase tracking-wider block font-bold">
                        Kondisi Penyakit Patologis
                      </span>
                      <span className="text-sm font-bold text-rose-900">
                        {typeof selectedDetail.diseaseName === 'object' ? selectedDetail.diseaseName?.name : selectedDetail.diseaseName}
                      </span>
                    </div>
                  </div>
                  {getSeverityBadge(selectedDetail.level, selectedDetail.severity)}
                </div>
              )}

              {selectedDetail.foodName && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Utensils className="w-5 h-5 text-amber-600" />
                    <div>
                      <span className="text-[10px] text-amber-600 uppercase tracking-wider block font-bold">
                        Bahan Pangan / Makanan Terkait
                      </span>
                      <span className="text-sm font-bold text-amber-900 uppercase">
                        {typeof selectedDetail.foodName === 'object' ? selectedDetail.foodName?.name : selectedDetail.foodName}
                      </span>
                    </div>
                  </div>
                  {getSeverityBadge(selectedDetail.level, selectedDetail.severity)}
                </div>
              )}

              {/* Warning text or Mechanism */}
              <div>
                <h4 className="font-bold text-slate-900 mb-1 text-xs uppercase tracking-wide text-slate-500">
                  Ulasan Patofisiologi &amp; Peringatan Klinis
                </h4>
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl leading-relaxed text-slate-800 text-xs">
                  {selectedDetail.warningText || selectedDetail.mechanism || 'Tidak ada uraian teks.'}
                </div>
              </div>

              {/* Management */}
              {selectedDetail.management && (
                <div>
                  <h4 className="font-bold text-slate-900 mb-1 text-xs uppercase tracking-wide text-slate-500">
                    Rekomendasi Manajemen Klinis Farmasi
                  </h4>
                  <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl leading-relaxed text-emerald-950 text-xs font-medium">
                    {selectedDetail.management}
                  </div>
                </div>
              )}

              {/* References */}
              {selectedDetail.references && (
                <div>
                  {(() => {
                    const refList: string[] = Array.isArray(selectedDetail.references)
                      ? selectedDetail.references
                      : typeof selectedDetail.references === 'string'
                      ? selectedDetail.references.split('|').filter(Boolean)
                      : [];
                    if (refList.length === 0) return null;
                    return (
                      <>
                        <h4 className="font-bold text-slate-900 mb-1 text-xs uppercase tracking-wide text-slate-500 flex items-center justify-between">
                          <span>Daftar Literatur Ilmiah Terkurasi DDInter v2.0 ({refList.length} Publikasi)</span>
                        </h4>
                        <ul className="space-y-1.5 max-h-56 overflow-y-auto p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono divide-y divide-slate-100">
                          {refList.map((ref: string, idx: number) => (
                            <li key={idx} className="pt-1.5 first:pt-0 leading-relaxed text-slate-700 flex items-start justify-between gap-2">
                              <div>
                                {!ref.startsWith('[') && (
                                  <span className="text-teal-800 font-bold mr-1.5">[{idx + 1}]</span>
                                )}
                                <span className="italic">{ref}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="shrink-0 pt-3 border-t border-slate-100 flex items-center justify-between">
              {selectedDetail.officialUrl && (
                <a
                  href={selectedDetail.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-800 hover:underline font-mono inline-flex items-center gap-1"
                >
                  Buka Entri Resmi di DDInter v2.0 <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => setSelectedDetail(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
