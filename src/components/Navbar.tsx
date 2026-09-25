import React from 'react';

export type ActiveTab = 'drugs' | 'diseases' | 'interactions' | 'ddinter-table';

interface NavbarProps {
  activeTab: ActiveTab;
  onNavigate: (path: string) => void;
  onOpenCacheStats?: () => void;
  cacheHitCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Zone 1: Brand Logo */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('/obat')}
            className="flex items-center gap-2.5 text-left focus:outline-hidden group cursor-pointer"
            title="Ke Beranda Monografi Obat"
          >
            <div className="w-9 h-9 rounded-lg bg-teal-800 text-white flex items-center justify-center font-bold tracking-tight text-base shadow-xs group-hover:bg-teal-900 transition-colors">
              FD
            </div>
          </button>
        </div>

        {/* Zone 2: Navigation Links with URLs */}
        <nav className="hidden md:flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={() => onNavigate('/obat')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'drugs'
                ? 'text-teal-900 bg-teal-50 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            Monografi Obat
          </button>
          <button
            onClick={() => onNavigate('/penyakit')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'diseases'
                ? 'text-teal-900 bg-teal-50 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            Informasi Penyakit
          </button>
          <button
            onClick={() => onNavigate('/interaksi')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'interactions'
                ? 'text-teal-900 bg-teal-50 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            Uji Interaksi
          </button>
          <button
            onClick={() => onNavigate('/tabel')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'ddinter-table'
                ? 'text-teal-900 bg-teal-50 font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            Tabel Interaksi
          </button>
        </nav>

        {/* Empty placeholder to balance flex layout */}
        <div className="w-9 hidden md:block" />
      </div>

      {/* Mobile nav bar row */}
      <div className="md:hidden flex border-t border-slate-100 px-2 py-1.5 overflow-x-auto gap-1 bg-slate-50">
        <button
          onClick={() => onNavigate('/obat')}
          className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md ${
            activeTab === 'drugs' ? 'bg-white shadow-xs font-semibold text-teal-900' : 'text-slate-600'
          }`}
        >
          Monografi Obat
        </button>
        <button
          onClick={() => onNavigate('/penyakit')}
          className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md ${
            activeTab === 'diseases' ? 'bg-white shadow-xs font-semibold text-teal-900' : 'text-slate-600'
          }`}
        >
          Informasi Penyakit
        </button>
        <button
          onClick={() => onNavigate('/interaksi')}
          className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md ${
            activeTab === 'interactions' ? 'bg-white shadow-xs font-semibold text-teal-900' : 'text-slate-600'
          }`}
        >
          Uji Interaksi
        </button>
        <button
          onClick={() => onNavigate('/tabel')}
          className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-md ${
            activeTab === 'ddinter-table' ? 'bg-white shadow-xs font-semibold text-teal-900' : 'text-slate-600'
          }`}
        >
          Tabel Interaksi
        </button>
      </div>
    </header>
  );
};
