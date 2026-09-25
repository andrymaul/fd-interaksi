import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Info,
} from 'lucide-react';
import { DiseaseInfo } from '../types/pharmacy.ts';
import { getDiseaseClinicalMonograph } from '../data/diseaseClinicalData.ts';
import { PaginationControls } from './PaginationControls.tsx';

interface DiseaseInfoViewProps {
  onSelectForInteraction?: (diseaseId: string) => void;
  selectedDiseaseIds?: string[];
  onViewDiseaseDetail?: (diseaseName: string) => void;
}

export const DiseaseInfoView: React.FC<DiseaseInfoViewProps> = ({
  onViewDiseaseDetail,
}) => {
  const [diseases, setDiseases] = useState<DiseaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOrgan, setSelectedOrgan] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDiseases, setTotalDiseases] = useState(0);

  const scrollPosRef = useRef<number | null>(null);

  const fetchDiseases = async (targetPage = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: search.trim(),
        page: targetPage.toString(),
        limit: '48',
        organ: selectedOrgan,
      });
      const res = await fetch(`/api/diseases?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDiseases(data.data || []);
        setTotalPages(data.totalPages || 1);
        setTotalDiseases(data.total || data.totalUniqueDiseases || 472);
      }
    } catch (e) {
      console.error('[DiseaseInfoView] Fetch error:', e);
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
    fetchDiseases(page);
  }, [search, page, selectedOrgan]);

  const handlePageChange = (newPage: number) => {
    scrollPosRef.current = window.scrollY;
    setPage(newPage);
  };

  const handleCardClick = (d: DiseaseInfo) => {
    if (onViewDiseaseDetail) {
      onViewDiseaseDetail(d.name);
    }
  };

  const organSystems = [
    'Semua Sistem Organ',
    'Sistem Ginjal & Urologi (Renal)',
    'Sistem Hati & Hepatobilier',
    'Sistem Kardiovaskular',
    'Sistem Endokrin & Metabolik',
    'Sistem Respirasi & Paru',
    'Sistem Saraf & Neuropsikiatri',
    'Sistem Gastrointestinal',
    'Sistem Hematologi & Darah',
    'Sistem Imunologi & Infeksi',
    'Sistem Oftalmologi & Indra',
    'Onkologi & Neoplasma',
  ];

  const filteredDiseases = diseases;

  return (
    <div className="space-y-6">
      {/* Top Banner & Header - Identical visual style to Monografi Obat */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Informasi Penyakit
          </h1>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg text-xs">
            <span className="text-slate-500">Basis Data:</span>
            <span className="font-semibold text-teal-900 font-mono">
              {totalDiseases > 0 ? totalDiseases.toLocaleString('id-ID') : '472'} Kondisi Klinis
            </span>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari entitas penyakit resmi DDInter (contoh: Kidney Diseases, Liver Diseases, Diabetes Mellitus, Asthma)..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all"
            />
          </div>

          <div className="sm:col-span-4 relative">
            <select
              value={selectedOrgan || 'Semua Sistem Organ'}
              onChange={(e) => {
                const val = e.target.value === 'Semua Sistem Organ' ? '' : e.target.value;
                setSelectedOrgan(val);
                setPage(1);
              }}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all cursor-pointer font-medium"
            >
              {organSystems.map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Disease Card Grid with Stable Height to Prevent Scroll Jumps */}
      {loading && diseases.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 min-h-[460px]">
          {[...Array(48)].map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-h-[48px] flex items-center animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/5" />
            </div>
          ))}
        </div>
      ) : filteredDiseases.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center min-h-[300px]">
          <Info className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800">Kondisi Klinis Tidak Ditemukan</h3>
          <p className="text-xs text-slate-500 mt-1">
            Tidak ada entitas penyakit yang cocok dengan kriteria pencarian "{search}". Coba kata kunci lain atau bersihkan filter.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setSelectedOrgan('');
              setPage(1);
            }}
            className="mt-4 px-3 py-1.5 text-xs text-teal-800 font-medium bg-teal-50 hover:bg-teal-100 rounded-md transition-colors cursor-pointer"
          >
            Reset Filter
          </button>
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 min-h-[460px] transition-opacity duration-150 ${
            loading ? 'opacity-50 pointer-events-none' : 'opacity-100'
          }`}
        >
          {filteredDiseases.map((d) => (
            <div
              key={d.id}
              onClick={() => handleCardClick(d)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-h-[48px] hover:border-teal-700 hover:shadow-xs hover:bg-teal-50/40 transition-all cursor-pointer group flex items-center justify-between gap-2"
              title={`Klik untuk membuka halaman klinis lengkap ${d.name}`}
            >
              <span className="text-sm sm:text-[14.5px] font-bold text-slate-900 group-hover:text-teal-900 transition-colors truncate">
                {d.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Standardized Pagination Controls */}
      <PaginationControls
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalDiseases}
        itemLabel="kondisi klinis"
        onPageChange={handlePageChange}
        disabled={loading}
      />
    </div>
  );
};
