import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  X,
  Plus,
  Zap,
  Globe,
  Sparkles,
  ArrowRight,
  Info,
  Layers,
  Utensils,
  Stethoscope,
  CopyX,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Search,
} from 'lucide-react';
import { RegimenAnalysisResult, DrugMonograph, DiseaseInfo } from '../types/pharmacy.ts';
import { DrugPreviewModal } from './DrugPreviewModal.tsx';

interface InteractionCheckerViewProps {
  selectedDrugIds: string[];
  setSelectedDrugIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedDiseaseIds: string[];
  setSelectedDiseaseIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export const InteractionCheckerView: React.FC<InteractionCheckerViewProps> = ({
  selectedDrugIds,
  setSelectedDrugIds,
  selectedDiseaseIds,
  setSelectedDiseaseIds,
}) => {
  const [analysis, setAnalysis] = useState<RegimenAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [languageMode, setLanguageMode] = useState<'id' | 'en'>('id');
  const [activeTab, setActiveTab] = useState<'ddi' | 'food' | 'disease' | 'duplication' | 'matrix'>('ddi');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<string>('');

  // Drug preview modal & substitution state
  const [previewDrugId, setPreviewDrugId] = useState<string | null>(null);
  const [replacingDrugName, setReplacingDrugName] = useState<string | null>(null);

  // DDInter Reference & Alternative expansion state
  const [expandedRefs, setExpandedRefs] = useState<Record<string, boolean>>({});
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [expandedAlts, setExpandedAlts] = useState<Record<string, boolean>>({});
  const [expandedCyp, setExpandedCyp] = useState<Record<string, boolean>>({});

  const toggleRefs = (id: string) => {
    setExpandedRefs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAlts = (id: string) => {
    setExpandedAlts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCyp = (id: string) => {
    setExpandedCyp((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyCitation = (text: string, refKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(refKey);
    setTimeout(() => setCopiedRef(null), 2500);
  };

  const handleSwapDrug = (oldDrugName: string, newDrug: DrugMonograph) => {
    const newId = newDrug.name;
    setSelectedDrugIds((prev) => {
      const lowerOld = oldDrugName.toLowerCase();
      const filtered = prev.filter((id) => {
        const mappedName = drugNameMap[id.toLowerCase()] || id;
        return mappedName.toLowerCase() !== lowerOld && id.toLowerCase() !== lowerOld;
      });
      return [...filtered, newId];
    });
  };

  const handleOpenDrugPreview = (targetDrugId: string, currentInteractingDrug?: string) => {
    setPreviewDrugId(targetDrugId);
    setReplacingDrugName(currentInteractingDrug || null);
  };

  // Drug selector input & dynamic options from DDInter
  const [drugSearch, setDrugSearch] = useState('');
  const [isDrugDropdownOpen, setIsDrugDropdownOpen] = useState(false);
  const [drugOptions, setDrugOptions] = useState<Array<{ id: string; name: string; ddinterId: string; therapeuticClass: string }>>([]);
  const [drugNameMap, setDrugNameMap] = useState<Record<string, string>>({});

  // Disease selector input & dynamic options from DDInter
  const [diseaseSearch, setDiseaseSearch] = useState('');
  const [isDiseaseDropdownOpen, setIsDiseaseDropdownOpen] = useState(false);
  const [diseaseOptions, setDiseaseOptions] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [diseaseNameMap, setDiseaseNameMap] = useState<Record<string, string>>({});

  // Fetch drug suggestions dynamically from DDInter 2.0 API
  useEffect(() => {
    let active = true;
    const fetchDrugs = async () => {
      try {
        const res = await fetch(`/api/drugs?search=${encodeURIComponent(drugSearch)}&limit=25`);
        if (res.ok) {
          const json = await res.json();
          if (active) {
            setDrugOptions(json.data || []);
            const map: Record<string, string> = {};
            (json.data || []).forEach((d: any) => {
              map[d.id.toLowerCase()] = d.name;
              map[d.name.toLowerCase()] = d.name;
              if (d.ddinterId) map[d.ddinterId.toLowerCase()] = d.name;
            });
            setDrugNameMap((prev) => ({ ...prev, ...map }));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchDrugs();
    return () => {
      active = false;
    };
  }, [drugSearch]);

  // Fetch disease suggestions dynamically from DDInter 2.0 API
  useEffect(() => {
    let active = true;
    const fetchDiseases = async () => {
      try {
        const res = await fetch(`/api/diseases?search=${encodeURIComponent(diseaseSearch)}&limit=25`);
        if (res.ok) {
          const json = await res.json();
          if (active) {
            setDiseaseOptions(json.data || []);
            const map: Record<string, string> = {};
            (json.data || []).forEach((d: any) => {
              map[d.id.toLowerCase()] = d.name;
              map[d.name.toLowerCase()] = d.name;
            });
            setDiseaseNameMap((prev) => ({ ...prev, ...map }));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchDiseases();
    return () => {
      active = false;
    };
  }, [diseaseSearch]);

  // Preset Regimens for quick 1-click clinical testing (100% DDInter 2.0 Entities)
  const presets = [
    {
      name: 'Pendarahan Fatal (Warfarin + Metronidazole + Aspirin)',
      drugIds: ['warfarin', 'metronidazole', 'aspirin'],
      diseaseIds: ['peptic ulcer', 'kidney diseases'],
    },
    {
      name: 'Resistensi Stent & Trombosis (Clopidogrel + Omeprazole + Atorvastatin)',
      drugIds: ['clopidogrel', 'omeprazole', 'atorvastatin'],
      diseaseIds: [],
    },
    {
      name: 'Rabdomiolisis Berat & Gagal Ginjal Akut (Simvastatin + Clarithromycin)',
      drugIds: ['simvastatin', 'clarithromycin'],
      diseaseIds: ['liver diseases', 'kidney diseases'],
    },
    {
      name: 'Sindrom Serotonin Kritis (Fluoxetine + Tramadol)',
      drugIds: ['fluoxetine', 'tramadol'],
      diseaseIds: ['depressive disorder'],
    },
    {
      name: 'Toksisitas Fatal Digoxin & Aritmia (Digoxin + Clarithromycin + Furosemide)',
      drugIds: ['digoxin', 'clarithromycin', 'furosemide'],
      diseaseIds: ['heart failure'],
    },
    {
      name: 'Triple Whammy / Syok Ginjal Akut (Lisinopril + Candesartan + Ibuprofen + Spironolactone)',
      drugIds: ['lisinopril', 'candesartan', 'ibuprofen', 'spironolactone'],
      diseaseIds: ['kidney diseases', 'hypertension'],
    },
    {
      name: 'Duplikasi Ganda NSAID & Perdarahan Lambung (Ibuprofen + Meloxicam)',
      drugIds: ['ibuprofen', 'meloxicam'],
      diseaseIds: ['peptic ulcer'],
    },
    {
      name: 'Pemanjangan Interval QT Ekstrem & Aritmia (Amiodarone + Ciprofloxacin + Haloperidol)',
      drugIds: ['amiodarone', 'ciprofloxacin', 'haloperidol'],
      diseaseIds: ['heart failure'],
    },
    {
      name: 'Hiperkalemia Mengancam Jiwa (Spironolactone + Lisinopril + Potassium Chloride)',
      drugIds: ['spironolactone', 'lisinopril', 'potassium chloride'],
      diseaseIds: ['kidney diseases', 'hypertension'],
    },
    {
      name: 'Sedasi Berat & Depresi Pernapasan (Diazepam + Tramadol + Gabapentin)',
      drugIds: ['diazepam', 'tramadol', 'gabapentin'],
      diseaseIds: ['respiratory tract diseases'],
    },
    {
      name: 'Hipoglikemia Berat Tak Terdeteksi (Glibenclamide + Propranolol + Ciprofloxacin)',
      drugIds: ['glibenclamide', 'propranolol', 'ciprofloxacin'],
      diseaseIds: ['diabetes mellitus'],
    },
    {
      name: 'Krisis Hipertensi Simpatomimetik (Selegiline + Pseudoephedrine)',
      drugIds: ['selegiline', 'pseudoephedrine'],
      diseaseIds: ['hypertension', 'cardiovascular diseases'],
    },
    {
      name: 'Toksisitas Metotreksat & Pansitopenia (Methotrexate + Amoxicillin + Ibuprofen)',
      drugIds: ['methotrexate', 'amoxicillin', 'ibuprofen'],
      diseaseIds: ['kidney diseases'],
    },
    {
      name: 'Nefrotoksisitas & Ototoksisitas Akut (Gentamicin + Furosemide + Vancomycin)',
      drugIds: ['gentamicin', 'furosemide', 'vancomycin'],
      diseaseIds: ['kidney diseases'],
    },
    {
      name: 'Antagonisme Dopaminergik & Parkinsonisme Sekunder (Levodopa + Haloperidol + Metoclopramide)',
      drugIds: ['levodopa', 'haloperidol', 'metoclopramide'],
      diseaseIds: ['parkinson disease'],
    },
    {
      name: 'Toksisitas Litium Berat & Tremor (Lithium + Hydrochlorothiazide + Ibuprofen)',
      drugIds: ['lithium', 'hydrochlorothiazide', 'ibuprofen'],
      diseaseIds: ['bipolar disorder', 'kidney diseases'],
    },
    {
      name: 'Kegagalan Antikoagulan & Risiko Stroke (Warfarin + Rifampin + Carbamazepine)',
      drugIds: ['warfarin', 'rifampin', 'carbamazepine'],
      diseaseIds: [],
    },
    {
      name: 'Bradikardia Berat & Henti Jantung (Verapamil + Metoprolol + Digoxin)',
      drugIds: ['verapamil', 'metoprolol', 'digoxin'],
      diseaseIds: ['heart failure', 'hypertension'],
    },
    {
      name: 'Duplikasi Benzodiazepin & Depresi SSP (Alprazolam + Diazepam)',
      drugIds: ['alprazolam', 'diazepam'],
      diseaseIds: ['anxiety disorders'],
    },
    {
      name: 'Duplikasi Penghambat Pompa Proton / PPI (Omeprazole + Lansoprazole)',
      drugIds: ['omeprazole', 'lansoprazole'],
      diseaseIds: ['peptic ulcer'],
    },
  ];

  const runCheck = async (forceNoCache = false) => {
    if (selectedDrugIds.length === 0) {
      setAnalysis(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/interactions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drugIds: selectedDrugIds,
          diseaseIds: selectedDiseaseIds,
          noCache: forceNoCache,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck();
  }, [selectedDrugIds, selectedDiseaseIds]);

  const addDrug = (id: string) => {
    if (!selectedDrugIds.includes(id)) {
      setSelectedDrugIds([...selectedDrugIds, id]);
    }
    setDrugSearch('');
    setIsDrugDropdownOpen(false);
  };

  const removeDrug = (id: string) => {
    setSelectedDrugIds(selectedDrugIds.filter((d) => d !== id));
  };

  const addDisease = (id: string) => {
    if (!selectedDiseaseIds.includes(id)) {
      setSelectedDiseaseIds([...selectedDiseaseIds, id]);
    }
    setDiseaseSearch('');
    setIsDiseaseDropdownOpen(false);
  };

  const removeDisease = (id: string) => {
    setSelectedDiseaseIds(selectedDiseaseIds.filter((d) => d !== id));
  };

  const applyPreset = (preset: (typeof presets)[0]) => {
    setSelectedDrugIds(preset.drugIds);
    setSelectedDiseaseIds(preset.diseaseIds);
  };

  const handlePresetChange = (idxStr: string) => {
    setSelectedPresetIndex(idxStr);
    if (!idxStr) {
      clearAll();
      return;
    }
    const idx = parseInt(idxStr, 10);
    const p = presets[idx];
    if (p) {
      setSelectedDrugIds(p.drugIds);
      setSelectedDiseaseIds(p.diseaseIds);
    }
  };

  const clearAll = () => {
    setSelectedDrugIds([]);
    setSelectedDiseaseIds([]);
    setAnalysis(null);
    setSelectedPresetIndex('');
  };

  // Severity style helper with bilingual localization
  const getSeverityBadge = (severity: string) => {
    const isEn = languageMode === 'en';
    switch (severity.toLowerCase()) {
      case 'contraindicated':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-700 text-white">
            {isEn ? 'CONTRAINDICATED' : 'KONTRAINDIKASI MUTLAK'}
          </span>
        );
      case 'major':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300">
            {isEn ? 'MAJOR / SEVERE' : 'PARAH / MAYOR'}
          </span>
        );
      case 'moderate':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
            {isEn ? 'MODERATE' : 'SEDANG / MODERAT'}
          </span>
        );
      case 'minor':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
            {isEn ? 'MINOR' : 'RINGAN / MINOR'}
          </span>
        );
      case 'unknown':
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#b6b2b2]/20 text-slate-700 border border-[#b6b2b2]">
            {isEn ? 'UNKNOWN / SAFE' : 'BELUM TERDATA'}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700">
            {severity}
          </span>
        );
    }
  };


  const filteredDrugOptions = drugOptions.filter(
    (d) =>
      !selectedDrugIds.some(
        (id) => id.toLowerCase() === d.id.toLowerCase() || id.toLowerCase() === d.name.toLowerCase()
      )
  );

  const filteredDiseaseOptions = diseaseOptions.filter(
    (d) =>
      !selectedDiseaseIds.some(
        (id) => id.toLowerCase() === d.id.toLowerCase() || id.toLowerCase() === d.name.toLowerCase()
      )
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Uji Interaksi &amp; Duplikasi
            </h1>
          </div>

          {analysis && (
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                onClick={() => runCheck(true)}
                disabled={loading}
                title="Perbarui data analisis"
                className="px-3.5 py-2 bg-white hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-slate-700 hover:text-teal-900 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-teal-700' : ''}`} />
                <span>Analisis Ulang</span>
              </button>
            </div>
          )}
        </div>

        {/* Quick-test Presets Dropdown */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <label htmlFor="sample-test-select" className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Sample Kasus Uji Interaksi Klinis Populer ({presets.length} Skenario):</span>
            </label>
            {selectedPresetIndex && (
              <span className="text-[11px] font-mono text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 self-start sm:self-auto">
                Sample #{parseInt(selectedPresetIndex, 10) + 1} Terpilih
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <select
              id="sample-test-select"
              value={selectedPresetIndex}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full sm:flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700 transition-all cursor-pointer shadow-2xs"
            >
              <option value="">-- Pilih Sample Kasus Uji Interaksi Klinis DDInter --</option>
              {presets.map((preset, idx) => (
                <option key={idx} value={String(idx)}>
                  {idx + 1}. {preset.name}
                </option>
              ))}
            </select>
            {selectedPresetIndex && (
              <button
                type="button"
                onClick={clearAll}
                className="w-full sm:w-auto px-3.5 py-2.5 text-xs font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                Reset / Kosongkan
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Regimen Builder Panel: Selected Drugs & Comorbidities */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Daftar Regimen Obat & Kondisi Pasien</span>
            <span className="text-xs font-mono font-normal text-slate-500">
              ({selectedDrugIds.length} Obat · {selectedDiseaseIds.length} Komorbid)
            </span>
          </h2>
          {(selectedDrugIds.length > 0 || selectedDiseaseIds.length > 0) && (
            <button
              onClick={clearAll}
              className="text-xs text-rose-600 hover:text-rose-800 font-medium"
            >
              Kosongkan Semua
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Section A: Drugs In Prescription */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide block">
              A. Tambahkan Obat ke Resep (Minimal 2 untuk DDI):
            </label>

            <div className="relative">
              <input
                type="text"
                value={drugSearch}
                onFocus={() => setIsDrugDropdownOpen(true)}
                onChange={(e) => {
                  setDrugSearch(e.target.value);
                  setIsDrugDropdownOpen(true);
                }}
                placeholder="Ketik nama obat (Warfarin, Lisinopril, Amlodipine)..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />

              {isDrugDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto z-20 divide-y divide-slate-100">
                  {filteredDrugOptions.length > 0 ? (
                    filteredDrugOptions.map((drug, dIdx) => (
                      <button
                        key={`${drug.id}-${dIdx}`}
                        type="button"
                        onClick={() => addDrug(drug.id)}
                        className="w-full text-left p-2.5 hover:bg-teal-50 text-xs flex items-center justify-between group transition-colors"
                      >
                        <div>
                          <span className="font-bold text-slate-900 group-hover:text-teal-900 block">
                            {drug.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {drug.therapeuticClass} ({drug.ddinterId})
                          </span>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-teal-700 shrink-0" />
                      </button>
                    ))
                  ) : (
                    <div className="p-3 text-xs text-slate-400 text-center">
                      Obat tidak ditemukan atau sudah ditambahkan.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drug Chips */}
            <div className="flex flex-wrap gap-2 pt-1 min-h-[42px]">
              {selectedDrugIds.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Belum ada obat yang dipilih. Pilih dari preset di atas atau ketik obat.
                </span>
              ) : (
                selectedDrugIds.map((item, sIdx) => {
                  const id = typeof item === 'object' ? (item as any)?.id || (item as any)?.name || '' : String(item);
                  const drug = analysis?.analyzedDrugs?.find(
                    (d) =>
                      d.id.toLowerCase() === id.toLowerCase() ||
                      d.name.toLowerCase() === id.toLowerCase() ||
                      d.ddinterId?.toLowerCase() === id.toLowerCase()
                  );
                  const displayName =
                    drug?.name ||
                    drugNameMap[id.toLowerCase()] ||
                    (typeof item === 'object' ? (item as any)?.name || id : id);
                  return (
                    <span
                      key={`${id}-${sIdx}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 text-teal-950 text-xs font-semibold rounded-lg"
                    >
                      <span>{displayName}</span>
                      <button
                        type="button"
                        onClick={() => removeDrug(id)}
                        className="text-teal-700 hover:text-rose-700 hover:bg-teal-100 p-0.5 rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Section B: Diseases / Comorbidities */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide block">
              B. Tambahkan Penyakit Komorbid Pasien (Opsional):
            </label>

            <div className="relative">
              <input
                type="text"
                value={diseaseSearch}
                onFocus={() => setIsDiseaseDropdownOpen(true)}
                onChange={(e) => {
                  setDiseaseSearch(e.target.value);
                  setIsDiseaseDropdownOpen(true);
                }}
                placeholder="Ketik penyakit (Hipertensi, CKD, Ulkus Peptikum, Asma)..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />

              {isDiseaseDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto z-20 divide-y divide-slate-100">
                  {filteredDiseaseOptions.length > 0 ? (
                    filteredDiseaseOptions.map((disease, dIdx) => (
                      <button
                        key={`${disease.id}-${dIdx}`}
                        type="button"
                        onClick={() => addDisease(disease.name)}
                        className="w-full text-left p-2.5 hover:bg-teal-50 text-xs flex items-center justify-between group transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 group-hover:text-teal-900">
                              {disease.name}
                            </span>
                            {(disease as any).icdCode && (
                              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">
                                {(disease as any).icdCode}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500">
                            DDInter v2.0 · {disease.count || 0} Kontraindikasi DDSI
                          </span>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-teal-700 shrink-0" />
                      </button>
                    ))
                  ) : (
                    <div className="p-3 text-xs text-slate-400 text-center">
                      Penyakit tidak ditemukan atau sudah dipilih.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Disease Chips */}
            <div className="flex flex-wrap gap-2 pt-1 min-h-[42px]">
              {selectedDiseaseIds.length === 0 ? (
                <span className="text-xs text-slate-400 italic">
                  Tidak ada komorbiditas yang dipilih (opsional).
                </span>
              ) : (
                selectedDiseaseIds.map((item, sIdx) => {
                  const id = typeof item === 'object' ? (item as any)?.id || (item as any)?.name || '' : String(item);
                  const dis = analysis?.analyzedDiseases?.find(
                    (d) => d.id.toLowerCase() === id.toLowerCase() || d.name.toLowerCase() === id.toLowerCase()
                  );
                  const displayName =
                    dis?.name ||
                    diseaseNameMap[id.toLowerCase()] ||
                    (typeof item === 'object' ? (item as any)?.name || id : id);
                  return (
                    <span
                      key={`${id}-${sIdx}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 border border-blue-200 text-blue-950 text-xs font-semibold rounded-lg"
                    >
                      <span>{displayName}</span>
                      <button
                        type="button"
                        onClick={() => removeDisease(id)}
                        className="text-blue-700 hover:text-rose-700 hover:bg-blue-100 p-0.5 rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Analyze trigger action button */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <button
            onClick={() => runCheck(true)}
            disabled={selectedDrugIds.length === 0 || loading}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg inline-flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Menganalisis Regimen...' : 'Jalankan Penapisan Interaksi'}</span>
          </button>
        </div>
      </div>

      {/* Analysis Results Dossier */}
      {analysis && (
        <div className="space-y-6">
          {/* Executive Risk Score Banner */}
          <div
            className={`rounded-xl p-6 border shadow-xs transition-all ${
              analysis.riskLevel === 'Risiko Tinggi / Kritis'
                ? 'bg-rose-50/70 border-rose-300'
                : analysis.riskLevel === 'Perhatian Sedang'
                ? 'bg-amber-50/70 border-amber-300'
                : 'bg-emerald-50/70 border-emerald-300'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {analysis.riskLevel === 'Risiko Tinggi / Kritis' ? (
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                  ) : analysis.riskLevel === 'Perhatian Sedang' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  )}
                  <span className="font-bold text-sm sm:text-base text-slate-900 uppercase tracking-wide">
                    Tingkat Risiko: {analysis.riskLevel}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-700 max-w-3xl leading-relaxed">
                  {analysis.summary}
                </p>
              </div>

              {/* Gauge Score */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shrink-0 flex items-center gap-4 shadow-2xs">
                <div>
                  <span className="text-[11px] text-slate-400 font-mono block">SKOR BAHAYA</span>
                  <div className="text-3xl font-mono font-bold tabular-nums text-slate-900">
                    {analysis.riskScore}
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>
                <div className="text-xs text-slate-500 font-mono space-y-0.5 border-l border-slate-100 pl-3">
                  <div>DDI: {analysis.drugInteractions.length}</div>
                  <div>Makanan: {analysis.foodInteractions.length}</div>
                  <div>Penyakit: {analysis.diseaseInteractions.length}</div>
                  <div>Duplikasi: {analysis.therapeuticDuplications.length}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Language Selection & Translation Control Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <Globe className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="font-bold">Bahasa Hasil Penapisan:</span>
              <span className="text-slate-500 text-[11px] hidden md:inline">
                {languageMode === 'id'
                  ? 'Mekanisme & rekomendasi otomatis disesuaikan ke Bahasa Indonesia klinis'
                  : 'Displaying original source text from DDInter 2.0 / DrugBank'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setLanguageMode('id')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                  languageMode === 'id'
                    ? 'bg-teal-800 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>🇮🇩 Bahasa Indonesia</span>
                {languageMode === 'id' && <Check className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => setLanguageMode('en')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                  languageMode === 'en'
                    ? 'bg-teal-800 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>🌐 English (Sumber Asli)</span>
                {languageMode === 'en' && <Check className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* 5-Dimensional Segmented Navigation Tabs */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="flex border-b border-slate-200 bg-slate-50/60 overflow-x-auto">
              <button
                onClick={() => setActiveTab('ddi')}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-colors ${
                  activeTab === 'ddi'
                    ? 'border-teal-800 text-teal-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>{languageMode === 'en' ? '1. Drug-Drug Interactions' : '1. Interaksi Obat-Obat'}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    analysis.drugInteractions.length > 0
                      ? analysis.drugInteractions.some((d) => d.severity.toLowerCase() !== 'unknown')
                        ? 'bg-rose-100 text-rose-800 font-bold'
                        : 'bg-slate-200 text-slate-700 font-bold'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {analysis.drugInteractions.length}
                </span>

              </button>

              <button
                onClick={() => setActiveTab('food')}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-colors ${
                  activeTab === 'food'
                    ? 'border-teal-800 text-teal-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Utensils className="w-3.5 h-3.5" />
                <span>{languageMode === 'en' ? '2. Drug-Food Interactions' : '2. Interaksi Obat-Makanan'}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-200 text-slate-600">
                  {analysis.foodInteractions.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('disease')}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-colors ${
                  activeTab === 'disease'
                    ? 'border-teal-800 text-teal-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Stethoscope className="w-3.5 h-3.5" />
                <span>{languageMode === 'en' ? '3. Drug-Disease Contraindications' : '3. Interaksi Obat-Penyakit'}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    analysis.diseaseInteractions.length > 0
                      ? 'bg-rose-100 text-rose-800 font-bold'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {analysis.diseaseInteractions.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('duplication')}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-colors ${
                  activeTab === 'duplication'
                    ? 'border-teal-800 text-teal-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <CopyX className="w-3.5 h-3.5" />
                <span>{languageMode === 'en' ? '4. Therapeutic Duplications' : '4. Duplikasi Terapi'}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    analysis.therapeuticDuplications.length > 0
                      ? 'bg-amber-100 text-amber-900 font-bold'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {analysis.therapeuticDuplications.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab('matrix')}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-colors ${
                  activeTab === 'matrix'
                    ? 'border-teal-800 text-teal-900 bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{languageMode === 'en' ? '5. Interaction Matrix (N×N)' : '5. Matriks Interaksi (N×N)'}</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-6">
              {/* TAB 1: DRUG-DRUG INTERACTIONS */}
              {activeTab === 'ddi' && (
                <div className="space-y-4">
                  {analysis.drugInteractions.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                      Tidak ditemukan interaksi obat-obat (DDI) berbahaya di antara pasangan obat yang dipilih.
                    </div>
                  ) : (
                    analysis.drugInteractions.map((inter) => {
                      const activeMech = (languageMode === 'en' && inter.originalMechanism) ? inter.originalMechanism : inter.mechanism;
                      const activeMgmt = (languageMode === 'en' && inter.originalManagement) ? inter.originalManagement : inter.management;

                      return (
                      <div
                        key={inter.id}
                        className="border border-slate-200 rounded-xl p-5 bg-white space-y-3 shadow-2xs hover:border-slate-300 transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-slate-900">
                              <button
                                type="button"
                                onClick={() => handleOpenDrugPreview(inter.drugA.ddinterId || inter.drugA.name)}
                                className="hover:text-indigo-600 hover:underline cursor-pointer text-left"
                                title={`Lihat monografi internal ${inter.drugA.name}`}
                              >
                                {inter.drugA.name}
                              </button>{' '}
                              <span className="text-rose-600 font-mono">⟷</span>{' '}
                              <button
                                type="button"
                                onClick={() => handleOpenDrugPreview(inter.drugB.ddinterId || inter.drugB.name)}
                                className="hover:text-indigo-600 hover:underline cursor-pointer text-left"
                                title={`Lihat monografi internal ${inter.drugB.name}`}
                              >
                                {inter.drugB.name}
                              </button>
                            </h3>
                            {inter.ddinterId && (
                              <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                {inter.ddinterId}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(inter.severity)}
                            {inter.evidenceLevel && inter.evidenceLevel !== '-' && inter.severity.toLowerCase() !== 'unknown' && (
                              <span className="text-[11px] font-mono text-slate-500">
                                {languageMode === 'en' ? 'Evidence: Level ' : 'Bukti: Level '}{inter.evidenceLevel}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Mechanism Category Tags */}
                        {inter.mechanismTags && inter.mechanismTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {inter.mechanismTags.map((tag, tIdx) => (
                              <span
                                key={tIdx}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-50 border border-sky-200 text-sky-800"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2 text-xs">
                          <div>
                            <strong className="text-slate-800 block mb-0.5">
                              {languageMode === 'en' ? 'Pharmacological Mechanism:' : 'Mekanisme Farmakologi:'}
                            </strong>
                            <p className="text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-100">
                              {activeMech}
                            </p>
                          </div>

                          <div>
                            <strong className={activeMgmt && activeMgmt !== '-' ? "text-teal-950 block mb-0.5 font-semibold" : "text-slate-800 block mb-0.5"}>
                              {languageMode === 'en' ? 'Clinical Management Guidance:' : 'Rekomendasi Manajemen Klinis:'}
                            </strong>
                            <p className={`leading-relaxed p-2.5 rounded border ${
                              activeMgmt && activeMgmt !== '-'
                                ? 'text-teal-950 font-medium bg-teal-50/60 border-teal-200'
                                : 'text-slate-500 bg-slate-50 border-slate-100'
                            }`}>
                              {activeMgmt}
                            </p>
                          </div>
                        </div>

                        {/* SECTION 1: SCIENTIFIC REFERENCES (RUJUKAN LITERATUR ILMIAH DDINTER) */}
                        {inter.references && inter.references.length > 0 && (
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/70">
                            <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Rujukan Literatur Ilmiah (References)
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 font-bold border border-teal-300">
                                  {inter.references.length} Publikasi Ilmiah Terverifikasi
                                </span>
                              </div>
                              <button
                                onClick={() => toggleRefs(inter.id)}
                                className="text-xs text-teal-800 hover:text-teal-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedRefs[inter.id] ? 'Ciutkan Rujukan' : `Tampilkan Semua (${inter.references.length})`}</span>
                                {expandedRefs[inter.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <div className="p-3 space-y-2">
                              {/* Display preview or full list depending on expanded state */}
                              <div
                                className={`space-y-2 text-[11px] divide-y divide-slate-200 ${
                                  expandedRefs[inter.id] ? 'max-h-80 overflow-y-auto pr-1' : ''
                                }`}
                              >
                                {(expandedRefs[inter.id] ? inter.references : inter.references.slice(0, 2)).map((ref, rIdx) => {
                                  const refKey = `${inter.id}-ref-${rIdx}`;
                                  const isCopied = copiedRef === refKey;
                                  const cleanSearch = ref.replace(/^\[\d+\]\s*/, '').slice(0, 100);

                                  return (
                                    <div
                                      key={rIdx}
                                      className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-slate-700 leading-relaxed font-serif"
                                    >
                                      <div className="flex-1">
                                        {!ref.startsWith('[') && (
                                          <span className="font-mono font-bold text-teal-800 mr-1.5 not-italic">
                                            [{rIdx + 1}]
                                          </span>
                                        )}
                                        <span className="italic">{ref}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 font-sans not-italic pt-0.5">
                                        <button
                                          onClick={() => handleCopyCitation(ref, refKey)}
                                          title="Salin Sitasi Literatur"
                                          className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer transition-colors"
                                        >
                                          {isCopied ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                                          ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                        <a
                                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari Jurnal di PubMed"
                                          className="p-1 rounded text-slate-400 hover:text-teal-700 hover:bg-teal-50 cursor-pointer transition-colors inline-flex items-center"
                                        >
                                          <Search className="w-3.5 h-3.5" />
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {!expandedRefs[inter.id] && inter.references.length > 2 && (
                                <div className="pt-2 border-t border-slate-200/60 text-center">
                                  <button
                                    onClick={() => toggleRefs(inter.id)}
                                    className="text-xs text-teal-800 hover:text-teal-950 font-semibold inline-flex items-center gap-1 cursor-pointer bg-white px-3 py-1 rounded-md border border-slate-200 shadow-2xs hover:bg-slate-50"
                                  >
                                    <span>Buka {inter.references.length - 2} Rujukan Ilmiah Lainnya</span>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* SECTION 2: ALTERNATIVE DRUGS (OBAT ALTERNATIF TERAPI DDINTER ATC SUBGROUP) */}
                        {inter.alternatives && Object.keys(inter.alternatives).length > 0 && (
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Obat Alternatif Rekomendasi DDInter (ATC Subgroup)
                                </span>
                              </div>
                              <button
                                onClick={() => toggleAlts(inter.id)}
                                className="text-xs text-indigo-700 hover:text-indigo-900 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedAlts[inter.id] ? 'Tutup' : 'Lihat Alternatif'}</span>
                                {expandedAlts[inter.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            {expandedAlts[inter.id] && (
                              <div className="p-3 space-y-3">
                                {Object.entries(inter.alternatives).map(([drugName, alts]) => (
                                  <div key={drugName} className="space-y-1.5">
                                    <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                                      <span>Alternatif Terapi untuk:</span>
                                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-900 font-mono">
                                        {drugName}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {alts.map((alt, aIdx) => (
                                        <button
                                          key={aIdx}
                                          type="button"
                                          onClick={() => handleOpenDrugPreview(alt.ddinterId || alt.name, drugName)}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-white border border-slate-200 text-slate-800 hover:border-indigo-400 hover:text-indigo-800 hover:bg-indigo-50/50 shadow-2xs transition-all cursor-pointer group"
                                          title={`Klik untuk melihat monografi internal ${alt.name} & opsi substitusi terapi`}
                                        >
                                          {alt.atc && (
                                            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-100 group-hover:bg-indigo-100 group-hover:text-indigo-800 text-slate-600 font-semibold transition-colors">
                                              {alt.atc}
                                            </span>
                                          )}
                                          <span className="font-medium">{alt.name}</span>
                                          <Info className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* SECTION 3: POTENTIAL CYP METABOLISM INTERACTIONS */}
                        {inter.cypMetabolism && Object.keys(inter.cypMetabolism).length > 0 && (
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Profil Potensi Metabolisme Enzim Sitokrom P450 (CYP450)
                                </span>
                              </div>
                              <button
                                onClick={() => toggleCyp(inter.id)}
                                className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedCyp[inter.id] ? 'Tutup Profil' : 'Lihat Profil CYP'}</span>
                                {expandedCyp[inter.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            {expandedCyp[inter.id] && (
                              <div className="p-3.5 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {Object.entries(inter.cypMetabolism).map(([dName, cypValues]) => (
                                    <div key={dName} className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                                      <div className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5 flex items-center justify-between">
                                        <span>{dName}</span>
                                        <span className="text-[10px] font-mono text-slate-500 font-normal">Probabilitas Enzimatik</span>
                                      </div>
                                      <div className="space-y-1.5 text-[11px] font-mono">
                                        {['CYP1A2', 'CYP2C19', 'CYP2C9', 'CYP2D6', 'CYP3A4'].map((enzyme) => {
                                          const inh = (cypValues as any)[`${enzyme}-inh`] || 0;
                                          const sub = (cypValues as any)[`${enzyme}-sub`] || 0;
                                          return (
                                            <div key={enzyme} className="space-y-0.5">
                                              <div className="flex justify-between text-[10px] text-slate-600 font-sans">
                                                <span className="font-bold text-slate-800">{enzyme}</span>
                                                <span>Inh: {(inh * 100).toFixed(0)}% | Sub: {(sub * 100).toFixed(0)}%</span>
                                              </div>
                                              <div className="grid grid-cols-2 gap-1 h-2 bg-slate-100 rounded overflow-hidden">
                                                <div
                                                  className="bg-amber-500 h-full rounded-l"
                                                  style={{ width: `${Math.min(100, inh * 100)}%` }}
                                                  title={`Inhibitor: ${(inh * 100).toFixed(1)}%`}
                                                />
                                                <div
                                                  className="bg-teal-500 h-full rounded-r"
                                                  style={{ width: `${Math.min(100, sub * 100)}%` }}
                                                  title={`Substrat: ${(sub * 100).toFixed(1)}%`}
                                                />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="flex items-center gap-3 pt-1 text-[10px] text-slate-500 font-sans">
                                        <div className="flex items-center gap-1">
                                          <span className="w-2 h-2 rounded bg-amber-500 inline-block" />
                                          <span>Inhibitor (Penghambat)</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className="w-2 h-2 rounded bg-teal-500 inline-block" />
                                          <span>Substrat (Target Enzim)</span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* DDInter Official Guidelines for Metabolism Interaction */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-700">
                                  <div className="p-2.5 rounded bg-amber-50/70 border border-amber-200">
                                    <strong className="text-amber-900 block font-bold mb-1">⚡ Substrate-Substrate:</strong>
                                    <p className="leading-relaxed">Jika kedua obat dimetabolisme oleh isoenzim CYP yang sama, kompetisi degradasi dapat meningkatkan kadar plasma.</p>
                                  </div>
                                  <div className="p-2.5 rounded bg-rose-50/70 border border-rose-200">
                                    <strong className="text-rose-900 block font-bold mb-1">🛡️ Inhibitor-Inhibitor:</strong>
                                    <p className="leading-relaxed">Kombinasi dua inhibitor enzim yang sama dapat melipatgandakan hambatan clearance dan memicu akumulasi toksik.</p>
                                  </div>
                                  <div className="p-2.5 rounded bg-emerald-50/70 border border-emerald-200">
                                    <strong className="text-emerald-900 block font-bold mb-1">⚠️ Inhibitor-Substrate:</strong>
                                    <p className="leading-relaxed">Obat inhibitor memperlambat metabolisme obat substrat, memperpanjang waktu retensi dalam tubuh.</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                    })
                  )}
                </div>
              )}

              {/* TAB 2: FOOD INTERACTIONS */}
              {activeTab === 'food' && (
                <div className="space-y-4">
                  {analysis.foodInteractions.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      Tidak ada interaksi makanan/minuman signifikan yang terdaftar untuk obat-obat yang dipilih.
                    </div>
                  ) : (
                    analysis.foodInteractions.map((food) => {
                      const activeFoodName = (languageMode === 'en' && food.originalFoodItem) ? food.originalFoodItem : (typeof food.foodItem === 'object' ? (food.foodItem as any)?.name : food.foodItem);
                      const activeMech = (languageMode === 'en' && food.originalMechanism) ? food.originalMechanism : food.mechanism;
                      const activeEffect = (languageMode === 'en' && food.originalEffect) ? food.originalEffect : food.effect;
                      const activeRec = (languageMode === 'en' && food.originalRecommendation) ? food.originalRecommendation : food.recommendation;

                      return (
                      <div
                        key={food.id}
                        className="border border-slate-200 rounded-xl p-5 bg-white space-y-3 shadow-2xs hover:border-slate-300 transition-colors"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">
                              {typeof food.drugName === 'object' ? (food.drugName as any)?.name : food.drugName}
                            </span>
                            <span className="text-slate-400 font-mono">⟷</span>
                            <span className="font-bold text-amber-900 text-sm">
                              {activeFoodName}
                            </span>
                          </div>
                          {getSeverityBadge(food.severity)}
                        </div>

                        <div className="space-y-2 text-xs">
                          <div>
                            <strong className="text-slate-800 block mb-0.5">
                              {languageMode === 'en' ? 'Nutritional Interaction Mechanism:' : 'Mekanisme Interaksi Nutrisi:'}
                            </strong>
                            <p className="text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100 leading-relaxed">
                              {activeMech}
                            </p>
                          </div>

                          <div>
                            <strong className="text-rose-900 block mb-0.5">
                              {languageMode === 'en' ? 'Clinical Effect:' : 'Efek Klinis:'}
                            </strong>
                            <p className="text-rose-950 bg-rose-50/50 p-2.5 rounded border border-rose-100 leading-relaxed">
                              {activeEffect}
                            </p>
                          </div>

                          <div>
                            <strong className="text-teal-950 block mb-0.5">
                              {languageMode === 'en' ? 'Patient Counseling / Dietary Advice:' : 'Konseling Pasien / Edukasi Diet:'}
                            </strong>
                            <p className="text-teal-950 font-medium bg-teal-50/60 p-2.5 rounded border border-teal-200 leading-relaxed">
                              {activeRec}
                            </p>
                          </div>
                        </div>

                        {/* RUJUKAN LITERATUR ILMIAH INTERAKSI OBAT-MAKANAN */}
                        {food.references && food.references.length > 0 && (
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/70">
                            <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Rujukan Literatur &amp; Sitasi Ilmiah (References)
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 font-bold border border-teal-300">
                                  {food.references.length} Publikasi Ilmiah Terverifikasi
                                </span>
                              </div>
                              <button
                                onClick={() => toggleRefs(food.id)}
                                className="text-xs text-teal-800 hover:text-teal-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedRefs[food.id] ? 'Ciutkan Rujukan' : `Tampilkan Semua (${food.references.length})`}</span>
                                {expandedRefs[food.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <div className="p-3 space-y-2">
                              <div
                                className={`space-y-2 text-[11px] divide-y divide-slate-200 ${
                                  expandedRefs[food.id] ? 'max-h-80 overflow-y-auto pr-1' : ''
                                }`}
                              >
                                {(expandedRefs[food.id] ? food.references : food.references.slice(0, 2)).map((ref, rIdx) => {
                                  const refKey = `${food.id}-ref-${rIdx}`;
                                  const isCopied = copiedRef === refKey;
                                  const cleanSearch = ref.replace(/^\[\d+\]\s*/, '').slice(0, 100);

                                  return (
                                    <div
                                      key={rIdx}
                                      className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-slate-700 leading-relaxed font-serif"
                                    >
                                      <div className="flex-1">
                                        {!ref.startsWith('[') && (
                                          <span className="font-mono font-bold text-teal-800 mr-1.5 not-italic">
                                            [{rIdx + 1}]
                                          </span>
                                        )}
                                        <span className="italic">{ref}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 font-sans not-italic pt-0.5">
                                        <button
                                          onClick={() => handleCopyCitation(ref, refKey)}
                                          title="Salin Sitasi Literatur"
                                          className={`p-1 rounded text-[10px] border flex items-center gap-1 transition-colors ${
                                            isCopied
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                          }`}
                                        >
                                          {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                          <span>{isCopied ? 'Tersalin' : 'Sitasi'}</span>
                                        </button>
                                        <a
                                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari di PubMed NLM"
                                          className="p-1 rounded text-[10px] border border-slate-200 bg-white text-slate-500 hover:text-teal-800 hover:border-teal-300 transition-colors inline-flex items-center gap-0.5"
                                        >
                                          <Search className="w-3 h-3" />
                                          <span>PubMed</span>
                                        </a>
                                        <a
                                          href={`https://scholar.google.com/scholar?q=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari di Google Cendekia (Scholar)"
                                          className="p-1 rounded text-[10px] border border-slate-200 bg-white text-slate-500 hover:text-indigo-800 hover:border-indigo-300 transition-colors inline-flex items-center gap-0.5"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          <span>Scholar</span>
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })
                  )}
                </div>
              )}

              {/* TAB 3: DISEASE INTERACTIONS */}
              {activeTab === 'disease' && (
                <div className="space-y-4">
                  {analysis.diseaseInteractions.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      {selectedDiseaseIds.length === 0 ? (
                        <div>
                          <Info className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                          <span>Pilih penyakit komorbid pasien pada panel di atas untuk menguji kontraindikasi obat-penyakit.</span>
                        </div>
                      ) : (
                        <div>
                          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                          <span>Tidak ditemukan kontraindikasi langsung antara obat yang diresepkan dengan riwayat penyakit pasien.</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    analysis.diseaseInteractions.map((item) => {
                      const activeDisName = (languageMode === 'en' && item.originalDiseaseName) ? item.originalDiseaseName : (typeof item.diseaseName === 'object' ? (item.diseaseName as any)?.name : item.diseaseName);
                      const activeRisk = (languageMode === 'en' && item.originalRisk) ? item.originalRisk : item.risk;
                      const activeMgmt = (languageMode === 'en' && item.originalManagement) ? item.originalManagement : item.management;

                      return (
                      <div
                        key={item.id}
                        className="border-2 border-rose-200 bg-rose-50/20 rounded-xl p-5 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">
                              {typeof item.drugName === 'object' ? (item.drugName as any)?.name : item.drugName}
                            </span>
                            <span className="text-rose-600 font-mono">⟷</span>
                            <span className="font-bold text-rose-900 text-sm">
                              {activeDisName}
                            </span>
                          </div>
                          {getSeverityBadge(item.severity)}
                        </div>

                        <div className="space-y-2 text-xs">
                          <div>
                            <strong className="text-rose-900 block mb-0.5">
                              {languageMode === 'en' ? 'Pathophysiological Hazard:' : 'Bahaya Patofisiologis:'}
                            </strong>
                            <p className="text-rose-950 font-medium bg-rose-100/50 p-2.5 rounded border border-rose-200 leading-relaxed">
                              {activeRisk}
                            </p>
                          </div>

                          <div>
                            <strong className="text-slate-800 block mb-0.5">
                              {languageMode === 'en' ? 'Clinical Action / Management:' : 'Tindakan Klinis:'}
                            </strong>
                            <p className="text-slate-700 bg-white p-2.5 rounded border border-slate-200 leading-relaxed">
                              {activeMgmt}
                            </p>
                          </div>
                        </div>

                        {/* RUJUKAN LITERATUR ILMIAH KONTRAINDIKASI OBAT-PENYAKIT */}
                        {item.references && item.references.length > 0 && (
                          <div className="border border-rose-200 rounded-lg overflow-hidden bg-rose-50/50">
                            <div className="p-3 bg-rose-100/70 border-b border-rose-200 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Rujukan Literatur &amp; Sitasi Ilmiah DDSI (References)
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 font-bold border border-rose-300">
                                  {item.references.length} Publikasi Ilmiah Terverifikasi
                                </span>
                              </div>
                              <button
                                onClick={() => toggleRefs(item.id)}
                                className="text-xs text-rose-800 hover:text-rose-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedRefs[item.id] ? 'Ciutkan Rujukan' : `Tampilkan Semua (${item.references.length})`}</span>
                                {expandedRefs[item.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <div className="p-3 space-y-2">
                              <div
                                className={`space-y-2 text-[11px] divide-y divide-rose-200/60 ${
                                  expandedRefs[item.id] ? 'max-h-80 overflow-y-auto pr-1' : ''
                                }`}
                              >
                                {(expandedRefs[item.id] ? item.references : item.references.slice(0, 2)).map((ref, rIdx) => {
                                  const refKey = `${item.id}-ref-${rIdx}`;
                                  const isCopied = copiedRef === refKey;
                                  const cleanSearch = ref.replace(/^\[\d+\]\s*/, '').slice(0, 100);

                                  return (
                                    <div
                                      key={rIdx}
                                      className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-slate-700 leading-relaxed font-serif"
                                    >
                                      <div className="flex-1">
                                        {!ref.startsWith('[') && (
                                          <span className="font-mono font-bold text-rose-800 mr-1.5 not-italic">
                                            [{rIdx + 1}]
                                          </span>
                                        )}
                                        <span className="italic">{ref}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 font-sans not-italic pt-0.5">
                                        <button
                                          onClick={() => handleCopyCitation(ref, refKey)}
                                          title="Salin Sitasi Literatur"
                                          className={`p-1 rounded text-[10px] border flex items-center gap-1 transition-colors ${
                                            isCopied
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                          }`}
                                        >
                                          {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                          <span>{isCopied ? 'Tersalin' : 'Sitasi'}</span>
                                        </button>
                                        <a
                                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari di PubMed NLM"
                                          className="p-1 rounded text-[10px] border border-slate-200 bg-white text-slate-500 hover:text-teal-800 hover:border-teal-300 transition-colors inline-flex items-center gap-0.5"
                                        >
                                          <Search className="w-3 h-3" />
                                          <span>PubMed</span>
                                        </a>
                                        <a
                                          href={`https://scholar.google.com/scholar?q=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari di Google Cendekia (Scholar)"
                                          className="p-1 rounded text-[10px] border border-slate-200 bg-white text-slate-500 hover:text-indigo-800 hover:border-indigo-300 transition-colors inline-flex items-center gap-0.5"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          <span>Scholar</span>
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })
                  )}
                </div>
              )}

              {/* TAB 4: THERAPEUTIC DUPLICATIONS */}
              {activeTab === 'duplication' && (
                <div className="space-y-4">
                  {analysis.therapeuticDuplications.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                      Tidak ditemukan duplikasi terapi atau peresepan ganda kelas obat yang sama (misal 2 NSAID atau 2 ARB).
                    </div>
                  ) : (
                    analysis.therapeuticDuplications.map((dup) => {
                      const activeConcern = (languageMode === 'en' && dup.originalConcern) ? dup.originalConcern : dup.concern;
                      const activeRec = (languageMode === 'en' && dup.originalRecommendation) ? dup.originalRecommendation : dup.recommendation;

                      return (
                      <div
                        key={dup.id}
                        className="border-2 border-amber-300 bg-amber-50/30 rounded-xl p-5 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                          <div>
                            <span className="font-bold text-slate-900 text-sm">
                              {typeof dup.drugA === 'object' ? (dup.drugA as any)?.name : dup.drugA} + {typeof dup.drugB === 'object' ? (dup.drugB as any)?.name : dup.drugB}
                            </span>
                            <div className="text-[11px] font-mono text-amber-900 mt-0.5">
                              {languageMode === 'en' ? 'Class: ' : 'Kelas: '}{dup.therapeuticClass} ({dup.atcGroup})
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-500 text-white">
                            {languageMode === 'en' ? 'THERAPEUTIC DUPLICATION' : 'DUPLIKASI KELAS TERAPI'}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div>
                            <strong className="text-amber-950 block mb-0.5">
                              {languageMode === 'en' ? 'Clinical Concern (Redundant Polypharmacy):' : 'Masalah Klinis (Polifarmasi Redundan):'}
                            </strong>
                            <p className="text-slate-800 leading-relaxed bg-white p-3 rounded-lg border border-amber-200">
                              {activeConcern}
                            </p>
                          </div>

                          <div>
                            <strong className="text-teal-950 block mb-0.5">
                              {languageMode === 'en' ? 'Pharmacist / Clinician Recommendation:' : 'Rekomendasi Apoteker / Dokter:'}
                            </strong>
                            <p className="text-teal-950 font-medium leading-relaxed bg-teal-50/70 p-3 rounded-lg border border-teal-200">
                              {activeRec}
                            </p>
                          </div>
                        </div>

                        {/* RUJUKAN LITERATUR ILMIAH DUPLIKASI TERAPI */}
                        {dup.references && dup.references.length > 0 && (
                          <div className="border border-amber-300 rounded-lg overflow-hidden bg-amber-50/50">
                            <div className="p-3 bg-amber-100/70 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 text-xs">
                                  Pedoman &amp; Rujukan Ilmiah Duplikasi Terapi (References)
                                </span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold border border-amber-300">
                                  {dup.references.length} Pedoman Terverifikasi
                                </span>
                              </div>
                              <button
                                onClick={() => toggleRefs(dup.id)}
                                className="text-xs text-amber-900 hover:text-amber-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{expandedRefs[dup.id] ? 'Ciutkan Rujukan' : `Tampilkan Semua (${dup.references.length})`}</span>
                                {expandedRefs[dup.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <div className="p-3 space-y-2">
                              <div
                                className={`space-y-2 text-[11px] divide-y divide-amber-200/60 ${
                                  expandedRefs[dup.id] ? 'max-h-80 overflow-y-auto pr-1' : ''
                                }`}
                              >
                                {(expandedRefs[dup.id] ? dup.references : dup.references.slice(0, 2)).map((ref, rIdx) => {
                                  const refKey = `${dup.id}-ref-${rIdx}`;
                                  const isCopied = copiedRef === refKey;
                                  const cleanSearch = ref.replace(/^\[\d+\]\s*/, '').slice(0, 100);

                                  return (
                                    <div
                                      key={rIdx}
                                      className="pt-2 first:pt-0 flex items-start justify-between gap-2 text-slate-700 leading-relaxed font-serif"
                                    >
                                      <div className="flex-1">
                                        {!ref.startsWith('[') && (
                                          <span className="font-mono font-bold text-amber-900 mr-1.5 not-italic">
                                            [{rIdx + 1}]
                                          </span>
                                        )}
                                        <span className="italic">{ref}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 font-sans not-italic pt-0.5">
                                        <button
                                          onClick={() => handleCopyCitation(ref, refKey)}
                                          title="Salin Sitasi Pedoman"
                                          className={`p-1 rounded text-[10px] border flex items-center gap-1 transition-colors ${
                                            isCopied
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                                          }`}
                                        >
                                          {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                          <span>{isCopied ? 'Tersalin' : 'Sitasi'}</span>
                                        </button>
                                        <a
                                          href={`https://scholar.google.com/scholar?q=${encodeURIComponent(cleanSearch)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          title="Cari di Google Cendekia (Scholar)"
                                          className="p-1 rounded text-[10px] border border-slate-200 bg-white text-slate-500 hover:text-indigo-800 hover:border-indigo-300 transition-colors inline-flex items-center gap-0.5"
                                        >
                                          <ExternalLink className="w-3 h-3" />
                                          <span>Scholar</span>
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })
                  )}
                </div>
              )}

              {/* TAB 5: PERMUTATION MATRIX */}
              {activeTab === 'matrix' && (
                <div className="space-y-4">
                  <div className="text-xs text-slate-600">
                    Matriks permutasi silang NxN menampilkan tingkat keparahan interaksi untuk setiap pasangan obat dalam resep.
                  </div>

                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-center text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="p-3 text-left font-mono">Obat \ Interaksi</th>
                          {analysis.analyzedDrugs.map((d) => (
                            <th key={d.id} className="p-3 font-mono font-bold truncate max-w-[120px]" title={d.name}>
                              {d.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {analysis.analyzedDrugs.map((rowDrug) => (
                          <tr key={rowDrug.id} className="hover:bg-slate-50/80">
                            <td className="p-3 text-left font-bold text-slate-900 bg-slate-50">
                              {rowDrug.name}
                            </td>
                            {analysis.analyzedDrugs.map((colDrug) => {
                              if (rowDrug.id === colDrug.id) {
                                return (
                                  <td key={colDrug.id} className="p-3 bg-slate-100/60 text-slate-400">
                                    —
                                  </td>
                                );
                              }

                              const interaction = analysis.drugInteractions.find(
                                (i) =>
                                  (i.drugA.id.toLowerCase() === rowDrug.id.toLowerCase() &&
                                    i.drugB.id.toLowerCase() === colDrug.id.toLowerCase()) ||
                                  (i.drugA.id.toLowerCase() === colDrug.id.toLowerCase() &&
                                    i.drugB.id.toLowerCase() === rowDrug.id.toLowerCase())
                              );

                              if (!interaction) {
                                return (
                                  <td key={colDrug.id} className="p-3 text-emerald-700 font-medium">
                                    Aman
                                  </td>
                                );
                              }

                              const isContra = interaction.severity === 'Contraindicated';
                              const isMajor = interaction.severity === 'Major';

                              return (
                                <td
                                  key={colDrug.id}
                                  className={`p-3 font-bold cursor-pointer transition-colors ${
                                    isContra
                                      ? 'bg-rose-600 text-white'
                                      : isMajor
                                      ? 'bg-rose-100 text-rose-900 border border-rose-200'
                                      : 'bg-amber-100 text-amber-900 border border-amber-200'
                                  }`}
                                  onClick={() => setActiveTab('ddi')}
                                  title={`${rowDrug.name} + ${colDrug.name}: ${interaction.severity} - ${interaction.mechanism}`}
                                >
                                  {interaction.severity}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State Banner when no analysis yet */}
      {!analysis && !loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center shadow-2xs space-y-3">
          <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-800 flex items-center justify-center mx-auto">
            <Stethoscope className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">Daftar Obat &amp; Penyakit Sedang Kosong</h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
            Pilih salah satu <strong>Sample Kasus Uji</strong> pada dropdown di atas atau cari dan tambahkan obat serta komorbiditas secara manual untuk menjalankan penapisan interaksi klinis otomatis.
          </p>
        </div>
      )}

      {/* Internal Drug Monograph Preview & Substitution Modal */}
      <DrugPreviewModal
        drugId={previewDrugId}
        replacingDrugName={replacingDrugName}
        isOpen={Boolean(previewDrugId)}
        onClose={() => {
          setPreviewDrugId(null);
          setReplacingDrugName(null);
        }}
        onSwapDrug={handleSwapDrug}
      />
    </div>
  );
};
