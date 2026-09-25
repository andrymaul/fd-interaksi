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

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');
  const [selectedDrugIds, setSelectedDrugIds] = useState<string[]>([]);
  const [selectedDiseaseIds, setSelectedDiseaseIds] = useState<string[]>([]);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [cacheHitCount, setCacheHitCount] = useState(0);

  // Sync state with browser navigation
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
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
  let activeTab: ActiveTab = 'drugs';
  let drugDetailId: string | null = null;
  let diseaseDetailName: string | null = null;

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-teal-100 selection:text-teal-900">
      {/* Top Navbar with URL navigation */}
      <Navbar
        activeTab={activeTab}
        onNavigate={navigate}
        onOpenCacheStats={() => setIsCacheModalOpen(true)}
        cacheHitCount={cacheHitCount}
      />

      {/* Main Content Viewport */}
      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 ${activeTab === 'ddinter-table' ? 'max-w-[1440px]' : 'max-w-7xl'}`}>
        {/* Route: /obat/:id -> Dedicated Drug Detail Page */}
        {drugDetailId ? (
          <DrugDetailPage
            drugId={drugDetailId}
            onBack={() => navigate('/obat')}
            onSelectForInteraction={handleSelectDrugForInteraction}
          />
        ) : diseaseDetailName ? (
          <DiseaseDetailPage
            diseaseName={diseaseDetailName}
            onBack={() => navigate('/penyakit')}
            onSelectForInteraction={handleSelectDiseaseForInteraction}
            onOpenDrugMonograph={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
          />
        ) : (
          <>
            {activeTab === 'drugs' && (
              <DrugMonographView
                onSelectForInteraction={handleSelectDrugForInteraction}
                selectedDrugIds={selectedDrugIds}
                onViewDrugDetail={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
              />
            )}

            {activeTab === 'diseases' && (
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

            {activeTab === 'ddinter-table' && (
              <DDInterTableView
                onSelectForInteraction={handleSelectDrugForInteraction}
                onOpenDrugMonograph={(id) => navigate(`/obat/${encodeURIComponent(id)}`)}
              />
            )}
          </>
        )}
      </main>

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
