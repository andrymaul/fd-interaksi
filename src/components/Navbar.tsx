import React from 'react';
import { Lock, ShieldCheck } from 'lucide-react';

export type ActiveTab = 'drugs' | 'diseases' | 'interactions' | 'ddinter-table';

interface NavbarProps {
  activeTab: ActiveTab;
  onNavigate: (path: string) => void;
  isAdmin: boolean;
  onOpenAdminModal: () => void;
  onLockAdmin: () => void;
  onOpenCacheStats?: () => void;
  cacheHitCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
  isAdmin,
  onOpenAdminModal,
  onLockAdmin,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-1.5">
          {isAdmin && (
            <>
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
            </>
          )}

          {/* Uji Interaksi - Visible to everyone */}
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

          {isAdmin && (
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
          )}
        </nav>

        {/* Admin Status / Unlock Button */}
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <button
              onClick={onLockAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-rose-50 border border-emerald-200 hover:border-rose-200 text-emerald-800 hover:text-rose-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer group shadow-2xs"
              title="Klik untuk kembali ke Mode Visitor (Kunci Akses)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 group-hover:hidden" />
              <Lock className="w-3.5 h-3.5 text-rose-500 hidden group-hover:inline" />
              <span className="hidden sm:inline group-hover:hidden">Mode Admin</span>
              <span className="hidden sm:group-hover:inline">Kunci Akses</span>
            </button>
          ) : (
            <button
              onClick={onOpenAdminModal}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Akses Internal / Masukkan PIN"
            >
              <Lock className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
