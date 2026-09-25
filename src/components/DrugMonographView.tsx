import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Info,
} from 'lucide-react';
import { DrugMonograph } from '../types/pharmacy.ts';
import { PaginationControls } from './PaginationControls.tsx';

interface DrugMonographViewProps {
  onSelectForInteraction?: (drugId: string) => void;
  selectedDrugIds?: string[];
  onViewDrugDetail?: (drugId: string) => void;
}

export const DrugMonographView: React.FC<DrugMonographViewProps> = ({
  onViewDrugDetail,
}) => {
  const [drugs, setDrugs] = useState<DrugMonograph[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const scrollPosRef = useRef<number | null>(null);

  const fetchDrugs = async (currentPage = 1, forceNoCache = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '48',
        search: search.trim(),
        class: selectedClass,
        nocache: forceNoCache ? 'true' : 'false',
      });
      const res = await fetch(`/api/drugs?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setDrugs(json.data || []);
        setTotalPages(json.totalPages || 1);
        setTotalCount(json.total || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      // Ensure scroll position is preserved without jumping
      if (scrollPosRef.current !== null) {
        const targetY = scrollPosRef.current;
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, behavior: 'instant' });
        });
      }
    }
  };

  useEffect(() => {
    fetchDrugs(page);
  }, [page, search, selectedClass]);

  const handlePageChange = (newPage: number) => {
    scrollPosRef.current = window.scrollY;
    setPage(newPage);
  };

  const handleCardClick = (drug: DrugMonograph) => {
    if (onViewDrugDetail) {
      onViewDrugDetail(drug.ddinterId || drug.id);
    }
  };

  const therapeuticClasses = [
    'Semua Golongan',
    'Statin (Anti-Dislipidemia)',
    'Penghambat Pompa Proton (PPI)',
    'Antikoagulan Oral',
    'Antiplatelet Golongan Thienopyridine',
    'Antidiabetes Oral Golongan Biguanid',
    'Penghambat Enzim Konversi Angiotensin (ACEi)',
    'Angiotensin II Receptor Blocker (ARB)',
    'Calcium Channel Blocker (CCB) Dihidropiridin',
    'Beta-1 Blocker Kardioselektif',
    'Non-Steroidal Anti-Inflammatory Drug (NSAID)',
    'Antibiotik Makrolida & Kuat Inhibitor CYP3A4',
    'Antibiotik Golongan Fluoroquinolone',
    'Glikosida Jantung (Indeks Terapi Sempit)',
    'Diuretik Hemat Kalium (Antagonis Aldosteron)',
    'Antidepresan Golongan SSRI',
    'Saluran Pencernaan & Metabolisme',
    'Sistem Kardiovaskular',
    'Darah & Organ Pembentuk Darah',
    'Antiinfeksi Sistemik',
    'Agen Antineoplastik & Imunomodulasi',
    'Dermatologikal',
    'Sistem Saraf',
    'Sistem Pernapasan',
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Monografi Obat
          </h1>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg text-xs">
            <span className="text-slate-500">Basis Data:</span>
            <span className="font-semibold text-teal-900 font-mono">
              {totalCount > 0 ? totalCount.toLocaleString('id-ID') : '2.290'} Obat Terdaftar
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
              placeholder="Cari nama generik, merek (Coumadin, Lipitor), ID DDInter (DDInter1), atau kode ATC..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all"
            />
          </div>

          <div className="sm:col-span-4 relative">
            <select
              value={selectedClass || 'Semua Golongan'}
              onChange={(e) => {
                const val = e.target.value === 'Semua Golongan' ? '' : e.target.value;
                setSelectedClass(val);
                setPage(1);
              }}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all cursor-pointer font-medium"
            >
              {therapeuticClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Drug Card Grid with Stable Height to Prevent Scroll Jumps */}
      {loading && drugs.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3 min-h-[460px]">
          {[...Array(48)].map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-h-[48px] flex items-center animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/5" />
            </div>
          ))}
        </div>
      ) : drugs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center min-h-[300px]">
          <Info className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800">Obat Tidak Ditemukan</h3>
          <p className="text-xs text-slate-500 mt-1">
            Tidak ada monografi obat yang cocok dengan kriteria pencarian "{search}". Coba kata kunci lain atau bersihkan filter.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setSelectedClass('');
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
          {drugs.map((drug) => (
            <div
              key={drug.id}
              onClick={() => handleCardClick(drug)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-h-[48px] hover:border-teal-700 hover:shadow-xs hover:bg-teal-50/40 transition-all cursor-pointer group flex items-center justify-between gap-2"
              title={`Klik untuk membuka halaman monografi lengkap ${drug.name}`}
            >
              <span className="text-sm sm:text-[14.5px] font-bold text-slate-900 group-hover:text-teal-900 transition-colors truncate">
                {drug.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Standardized Pagination Controls */}
      <PaginationControls
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalCount}
        itemLabel="obat"
        onPageChange={handlePageChange}
        disabled={loading}
      />
    </div>
  );
};
