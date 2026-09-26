/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar.tsx';
import { DrugMonographView } from './components/DrugMonographView.tsx';
import { DrugDetailPage } from './components/DrugDetailPage.tsx';
import { DiseaseInfoView } from './components/DiseaseInfoView.tsx';
import { DiseaseDetailPage } from './components/DiseaseDetailPage.tsx';
import { InteractionCheckerView } from './components/InteractionCheckerView.tsx';
import { DDInterTableView } from './components/DDInterTableView.tsx';
import { CacheStatsModal } from './components/CacheStatsModal.tsx';
import { AdminPinModal } from './components/AdminPinModal.tsx';

export default function App() {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem('fd_admin_access') === 'true';
  });
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  const [currentPath, setCurrentPath] = useState<string>(() => {
    const p = window.location.pathname || '/';
    // If not admin and visiting restricted paths, default to /interaksi
    const storedAdmin = localStorage.getItem('fd_admin_access') === 'true';
    if (!storedAdmin && (p === '/' || p === '/obat' || p.startsWith('/penyakit') || p.startsWith('/tabel'))) {
      return '/interaksi';
    }
    return p;
  });

  const [selectedDrugIds, setSelectedDrugIds] = useState<string[]>([]);
  const [selectedDiseaseIds, setSelectedDiseaseIds] = useState<string[]>([]);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [cacheHitCount, setCacheHitCount] = useState(0);

  // Check URL query parameters for instant unlock (e.g. ?pin=Sukses@321 or ?admin=Sukses@321)
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const pinParam = searchParams.get('pin') || searchParams.get('admin');
      if (pinParam === 'Sukses@321') {
        localStorage.setItem('fd_admin_access', 'true');
        setIsAdmin(true);
        // Clean URL
        searchParams.delete('pin');
        searchParams.delete('admin');
        const newSearch = searchParams.toString() ? `?${searchParams.toString()}` : '';
        window.history.replaceState({}, '', `${window.location.pathname}${newSearch}`);
      }
    } catch {}
  }, []);

  // Sync state with browser navigation and enforce visitor redirect
  useEffect(() => {
    const handlePopState = () => {
      const p = window.location.pathname || '/';
      if (!isAdmin && (p === '/' || p === '/obat' || p.startsWith('/penyakit') || p.startsWith('/tabel') || p.startsWith('/obat/'))) {
        navigate('/interaksi');
      } else {
        setCurrentPath(p);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAdmin]);

  // If visitor is on restricted path, automatically push to /interaksi
  useEffect(() => {
    if (!isAdmin && (currentPath === '/' || currentPath === '/obat' || currentPath.startsWith('/penyakit') || currentPath.startsWith('/tabel') || currentPath.startsWith('/obat/'))) {
      navigate('/interaksi');
    }
  }, [isAdmin, currentPath]);

  const navigate = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
  };

  const handleUnlockAdmin = () => {
    localStorage.setItem('fd_admin_access', 'true');
    setIsAdmin(true);
    setIsAdminModalOpen(false);
  };

  const handleLockAdmin = () => {
    if (window.confirm('Kunci kembali ke Mode Visitor? (Menu internal akan disembunyikan)')) {
      localStorage.removeItem('fd_admin_access');
      setIsAdmin(false);
      navigate('/interaksi');
    }
  };

  const fetchCacheStats = async () => {
    try {
      const res = await fetch('/api/cache/stats');
      if (res.ok) {
        const data = await res.json();
        setCacheHitCount(data.hitCount || 0);
      }
    } catch (e) {
      // Ignore
    }
  };

  useEffect(() => {
    fetchCacheStats();
    const interval = setInterval(fetchCacheStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectDrugForInteraction = (drugOrId: any) => {
    const drugId = typeof drugOrId === 'object' && drugOrId ? (drugOrId.id || drugOrId.name) : String(drugOrId || '');
    if (drugId && !selectedDrugIds.includes(drugId)) {
      setSelectedDrugIds((prev) => [...prev, drugId]);
    }
    navigate('/interaksi');
  };

  const handleSelectDiseaseForInteraction = (diseaseOrId: any) => {
    const diseaseId = typeof diseaseOrId === 'object' && diseaseOrId ? (diseaseOrId.id || diseaseOrId.name) : String(diseaseOrId || '');
    if (diseaseId && !selectedDiseaseIds.includes(diseaseId)) {
      setSelectedDiseaseIds((prev) => [...prev, diseaseId]);
    }
    navigate('/interaksi');
  };

  // Route matching logic
  let activeTab: ActiveTab = 'interactions';
  let drugDetailId: string | null = null;
  let diseaseDetailName: string | null = null;

  if (isAdmin) {
    if (currentPath.startsWith('/obat/') && currentPath.length > 6) {
      activeTab = 'drugs';
      drugDetailId = decodeURIComponent(currentPath.slice(6));
    } else if (currentPath === '/obat' || currentPath === '/') {
      activeTab = 'drugs';
    } else if (currentPath.startsWith('/penyakit/') && currentPath.length > 10) {
      activeTab = 'diseases';
      diseaseDetailName = decodeURIComponent(currentPath.slice(10));
    } else if (currentPath.startsWith('/penyakit')) {
      activeTab = 'diseases';
    } else if (currentPath.startsWith('/interaksi') || currentPath.startsWith('/uji-interaksi')) {
      activeTab = 'interactions';
    } else if (currentPath.startsWith('/tabel') || currentPath.startsWith('/tabel-interaksi')) {
      activeTab = 'ddinter-table';
    } else {
      activeTab = 'drugs';
    }
  } else {
    // Visitor Mode: strictly 'interactions'
    activeTab = 'interactions';
    drugDetailId = null;
    diseaseDetailName = null;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-teal-100 selection:text-teal-900">
      {/* Top Navbar with Role-based tabs and URL navigation */}
      <Navbar
        activeTab={activeTab}
        onNavigate={navigate}
        isAdmin={isAdmin}
        onOpenAdminModal={() => setIsAdminModalOpen(true)}
        onLockAdmin={handleLockAdmin}
        onOpenCacheStats={() => setIsCacheModalOpen(true)}
        cacheHitCount={cacheHitCount}
      />

      {/* Main Content Viewport */}
      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 ${activeTab === 'ddinter-table' ? 'max-w-[1440px]' : 'max-w-7xl'}`}>
        {/* Route: /obat/:id -> Dedicated Drug Detail Page (Admin only) */}
        {isAdmin && drugDetailId ? (
          <DrugDetailPage
            drugId={drugDetailId}
            onBack={() => navigate('/obat')}
            onSelectForInteraction={handleSelectDrugForInteraction}
          />
        ) : isAdmin && diseaseDetailName ? (
          <DiseaseDetailPage
            diseaseName={diseaseDetailName}
            onBack={() => navigate('/penyakit')}
            onSelectForInteraction={handleSelectDiseaseForInteraction}
            onOpenDrugMonograph={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
          />
        ) : (
          <>
            {isAdmin && activeTab === 'drugs' && (
              <DrugMonographView
                onSelectForInteraction={handleSelectDrugForInteraction}
                selectedDrugIds={selectedDrugIds}
                onViewDrugDetail={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
              />
            )}

            {isAdmin && activeTab === 'diseases' && (
              <DiseaseInfoView
                onSelectForInteraction={handleSelectDiseaseForInteraction}
                selectedDiseaseIds={selectedDiseaseIds}
                onViewDiseaseDetail={(name) => navigate(`/penyakit/${encodeURIComponent(name)}`)}
              />
            )}

            {activeTab === 'interactions' && (
              <InteractionCheckerView
                selectedDrugIds={selectedDrugIds}
                setSelectedDrugIds={setSelectedDrugIds}
                selectedDiseaseIds={selectedDiseaseIds}
                setSelectedDiseaseIds={setSelectedDiseaseIds}
              />
            )}

            {isAdmin && activeTab === 'ddinter-table' && (
              <DDInterTableView
                onSelectForInteraction={handleSelectDrugForInteraction}
                onOpenDrugMonograph={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
              />
            )}
          </>
        )}
      </main>

      {/* Admin PIN Unlock Modal */}
      <AdminPinModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleUnlockAdmin}
      />

      {/* Cache Telemetry Modal */}
      <CacheStatsModal
        isOpen={isCacheModalOpen}
        onClose={() => setIsCacheModalOpen(false)}
        onCacheCleared={() => {
          setCacheHitCount(0);
        }}
      />
    </div>
  );
}
