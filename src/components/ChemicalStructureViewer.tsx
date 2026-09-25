import React, { useState } from 'react';
import { Atom, ExternalLink, Hash, Copy, Check, CheckCircle2, Eye } from 'lucide-react';

interface ChemicalStructureViewerProps {
  ddinterId?: string;
  smiles: string;
  formula: string;
  molecularWeight: number;
  name: string;
  structureSvg?: string;
  casNumber?: string;
  iupacName?: string;
  inchi?: string;
  drugType?: string;
  proteinSequence?: string;
  usefulLinks?: Record<string, string>;
  officialUrl?: string;
}

export const ChemicalStructureViewer: React.FC<ChemicalStructureViewerProps> = ({
  ddinterId = 'DDInter',
  smiles,
  formula,
  molecularWeight,
  name,
  structureSvg,
  casNumber,
  iupacName,
  inchi,
  drugType,
  proteinSequence,
  usefulLinks,
  officialUrl,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {
      // Fallback
    });
  };

  // Parse elements from molecular formula only if valid chemical formula (e.g. C19H16O4 or C174H300N56O49)
  const parseFormulaElements = (f: string) => {
    if (!f || f.includes(' ') || f.includes('Tersedia') || f.length > 60) return [];
    if (!/^[A-Z][A-Za-z0-9]*$/.test(f)) return [];
    const validAtoms = ['C', 'H', 'O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'Na', 'K', 'Ca', 'Mg', 'Fe', 'Li', 'Zn', 'Pt'];
    const matches = f.match(/([A-Z][a-z]*)(\d*)/g) || [];
    const result: { el: string; count: number }[] = [];
    for (const m of matches) {
      const el = m.replace(/\d+/g, '');
      const count = parseInt(m.replace(/[A-Za-z]+/g, '') || '1', 10);
      if (validAtoms.includes(el)) {
        result.push({ el, count });
      }
    }
    return result;
  };

  const elements = parseFormulaElements(formula);
  const isBiotech = drugType === 'biotech' || Boolean(proteinSequence);

  // Helper color for CPK standard
  const getAtomColor = (el: string) => {
    switch (el) {
      case 'O':
        return 'text-rose-600 bg-rose-50 border-rose-200';
      case 'N':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'S':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'F':
      case 'Cl':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'C':
      default:
        return 'text-slate-800 bg-slate-100 border-slate-300';
    }
  };

  const ddinterLink = officialUrl || `https://ddinter2.scbdd.com/server/drug-detail/${ddinterId}/`;
  const cleanedSmiles = smiles?.trim();
  const isValidSmiles = Boolean(
    cleanedSmiles &&
    !['unknown', 'none', 'null', 'n/a', '-'].includes(cleanedSmiles.toLowerCase()) &&
    cleanedSmiles !== ddinterId &&
    cleanedSmiles.length > 3 &&
    !cleanedSmiles.startsWith('DDInter')
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col items-center shadow-2xs w-full">
      <div className="w-full flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
        <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
          <Atom className="w-3.5 h-3.5 text-teal-700" />
          Struktur Kimia 2D
        </span>
        <span className="text-[11px] font-mono text-slate-400">
          {ddinterId}
        </span>
      </div>

      {/* Vector 2D Chemical Diagram Canvas / Official SVG */}
      <div className="w-full min-h-[180px] bg-slate-50/80 rounded-lg border border-slate-200 flex flex-col items-center justify-center p-3 relative overflow-hidden">
        {structureSvg ? (
          <div
            className="w-full max-h-48 flex items-center justify-center overflow-hidden [&_svg]:max-h-44 [&_svg]:w-auto [&_svg]:max-w-full [&_svg]:mx-auto select-none"
            dangerouslySetInnerHTML={{ __html: structureSvg }}
          />
        ) : (
          <>
            {/* Subtle coordinate grid pattern */}
            <div
              className="absolute inset-0 opacity-[0.04] pointer-events-none"
              style={{
                backgroundImage: `radial-gradient(circle, #0f172a 1px, transparent 1px)`,
                backgroundSize: '16px 16px',
              }}
            />

            {/* Chemical Diagram Graphic */}
            <div className="relative z-10 flex flex-col items-center text-center max-w-full px-2">
              <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-800 mb-2 shadow-2xs">
                <Atom className="w-6 h-6" />
              </div>
              {isBiotech ? (
                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wide">
                    Biotech / Polipeptida
                  </span>
                  <div className="text-xs font-mono font-bold text-slate-900 mt-1">
                    {formula || 'Makromolekul Peptida'}
                  </div>
                </div>
              ) : (
                <span className="text-sm font-mono font-bold text-slate-900 tracking-wide">
                  {formula && formula !== 'None' ? formula : name}
                </span>
              )}
              {formula && formula !== 'None' && (
                <span className="text-xs text-slate-600 font-medium mt-1">
                  {name}
                </span>
              )}
            </div>

            {/* Atomic Composition Chips - Only shown if real elements parsed */}
            {elements.length > 0 && (
              <div className="relative z-10 flex flex-wrap gap-1 justify-center mt-2.5">
                {elements.map((item, idx) => (
                  <span
                    key={idx}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getAtomColor(
                      item.el
                    )}`}
                  >
                    {item.el}: {item.count}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Molecular Metrics */}
      <div className="w-full grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-100 text-xs">
        <div>
          <span className="text-slate-500 block text-[11px]">Rumus Kimia:</span>
          <span className="font-mono font-bold text-slate-900">
            {formula && formula !== 'None' ? formula : (isBiotech ? 'Polipeptida Biologis' : '-')}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block text-[11px]">Bobot Molekul:</span>
          <span className="font-mono font-bold text-slate-900 tabular-nums">
            {molecularWeight > 0 ? `${molecularWeight} g/mol` : (isBiotech ? 'Makromolekul (Biotech)' : '-')}
          </span>
        </div>
        {casNumber && casNumber !== '-' && casNumber !== 'None' && (
          <div className="col-span-2 pt-1.5 border-t border-slate-50 flex items-center justify-between">
            <div>
              <span className="text-slate-500 block text-[11px]">CAS Number:</span>
              <span className="font-mono text-slate-800 font-medium">{casNumber}</span>
            </div>
            <button
              onClick={() => handleCopy(casNumber, 'cas')}
              className="text-[10px] text-slate-500 hover:text-teal-800 font-mono px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors flex items-center gap-1"
            >
              {copiedField === 'cas' ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" /> Salin CAS
                </>
              )}
            </button>
          </div>
        )}
        {iupacName && (
          <div className="col-span-2 pt-1.5 border-t border-slate-50">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-slate-500 text-[11px]">Nama Kimia IUPAC:</span>
              <button
                onClick={() => handleCopy(iupacName, 'iupac')}
                className="text-[10px] text-slate-500 hover:text-teal-800 font-mono px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                {copiedField === 'iupac' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700 font-semibold">Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Salin IUPAC
                  </>
                )}
              </button>
            </div>
            <div className="font-mono text-[10px] text-slate-700 break-all bg-slate-50/80 p-1.5 rounded border border-slate-200 select-all leading-relaxed">
              {iupacName}
            </div>
          </div>
        )}
        {inchi && (
          <div className="col-span-2 pt-1.5 border-t border-slate-50">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-slate-500 text-[11px]">InChI:</span>
              <button
                onClick={() => handleCopy(inchi, 'inchi')}
                className="text-[10px] text-slate-500 hover:text-teal-800 font-mono px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                {copiedField === 'inchi' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700 font-semibold">Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Salin InChI
                  </>
                )}
              </button>
            </div>
            <div className="font-mono text-[10px] text-slate-700 break-all bg-slate-50/80 p-1.5 rounded border border-slate-200 select-all leading-relaxed" title={inchi}>
              {inchi}
            </div>
          </div>
        )}
      </div>

      {/* Protein Amino Acid Sequences if biotech/peptide */}
      {proteinSequence && (() => {
        const decoded = proteinSequence
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();

        const isFasta = decoded.startsWith('>');
        let fastaHeader = '';
        let fastaSeq = decoded;

        if (isFasta) {
          const firstNewline = decoded.indexOf('\n');
          if (firstNewline !== -1) {
            fastaHeader = decoded.substring(0, firstNewline).trim();
            fastaSeq = decoded.substring(firstNewline + 1).replace(/\s+/g, '');
          } else {
            const match = decoded.match(/^(>[^A-Z]*[a-z\s_-]+)\s+([A-Z]{10,})$/);
            if (match) {
              fastaHeader = match[1].trim();
              fastaSeq = match[2].trim();
            } else {
              fastaHeader = decoded.split(' ')[0];
              fastaSeq = decoded.substring(fastaHeader.length).trim();
            }
          }
        }

        const aaCount = fastaSeq.replace(/[^A-Za-z]/g, '').length;

        return (
          <div className="w-full mt-2.5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-500 font-medium">
                Urutan Peptida / Sekuens Asam Amino (DDInter):
              </span>
              {aaCount > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                  {aaCount} Residu AA
                </span>
              )}
            </div>
            {fastaHeader && (
              <div className="text-[10px] font-mono text-slate-500 font-semibold mb-1 truncate px-1" title={fastaHeader}>
                {fastaHeader}
              </div>
            )}
            <div className="p-2 bg-slate-50 border border-slate-200 rounded font-mono text-[10px] text-slate-800 break-all leading-relaxed select-all tracking-wider">
              {fastaSeq || decoded}
            </div>
          </div>
        );
      })()}

      {/* Useful Links Badges (DrugBank, ChEBI, PubChem, etc.) */}
      {usefulLinks && Object.keys(usefulLinks).length > 0 && (
        <div className="w-full mt-2.5 pt-2 border-t border-slate-100">
          <span className="text-[11px] text-slate-500 block mb-1 font-medium">
            Tautan Basis Data Eksternal (DDInter):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(usefulLinks).map(([dbName, link]) => (
              <a
                key={dbName}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 inline-flex items-center gap-0.5 transition-colors"
              >
                {dbName} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Canonical SMILES - Fully Unwrapped & Verifiably Displayed (No Truncation) */}
      {isValidSmiles && (
        <div className="w-full mt-3 pt-2.5 border-t border-slate-200">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-700 font-mono">
                Canonical SMILES:
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-teal-50 text-teal-800 border border-teal-200 font-semibold flex items-center gap-0.5">
                <CheckCircle2 className="w-2.5 h-2.5 text-teal-800" />
                {smiles.length} Karakter
              </span>
            </div>
            <button
              onClick={() => handleCopy(smiles, 'smiles')}
              className="text-[10px] font-medium text-slate-600 hover:text-teal-900 bg-slate-100 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 px-2 py-0.5 rounded transition-all flex items-center gap-1 cursor-pointer active:scale-95"
              title="Salin Canonical SMILES lengkap ke papan klip"
            >
              {copiedField === 'smiles' ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">Tersalin!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Salin SMILES</span>
                </>
              )}
            </button>
          </div>

          {/* Fully untruncated box with break-all word-break */}
          <div
            className="p-2 bg-slate-50/90 border border-slate-300/80 rounded-lg text-[11px] font-mono text-slate-800 break-all select-all leading-relaxed shadow-2xs tracking-tight"
            title="Klik dua kali atau pilih teks untuk menyalin struktur SMILES lengkap"
          >
            {smiles}
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-600 mt-1 px-0.5">
            <span>Standar DDInter v2.0 / RDKit Stereo</span>
            <span className="text-teal-800 font-medium">Struktur Utuh 100%</span>
          </div>
        </div>
      )}
    </div>
  );
};
