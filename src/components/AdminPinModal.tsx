import React, { useState } from 'react';
import { Lock, Unlock, Eye, EyeOff, X, AlertCircle, ShieldCheck } from 'lucide-react';

interface AdminPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CORRECT_PIN = 'Sukses@321';

export const AdminPinModal: React.FC<AdminPinModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim() === CORRECT_PIN) {
      setError(null);
      setPin('');
      onSuccess();
    } else {
      setError('PIN tidak valid. Akses ditolak.');
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setError(null);
      setPin('');
      onClose();
    }
  };

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 relative">
        <button
          onClick={() => {
            setError(null);
            setPin('');
            onClose();
          }}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
          title="Tutup"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-teal-700" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Akses Internal / Admin</h3>
            <p className="text-xs text-slate-500">Buka akses lengkap seluruh modul data</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Masukkan PIN Admin:
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="PIN Rahasia..."
                autoFocus
                className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-teal-700 focus:bg-white transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title={showPassword ? 'Sembunyikan' : 'Tampilkan'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-rose-600 mt-2 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPin('');
                onClose();
              }}
              className="flex-1 py-2.5 px-3 border border-slate-200 text-xs font-semibold text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-3 bg-teal-800 hover:bg-teal-900 text-white text-xs font-semibold rounded-xl transition-colors shadow-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Buka Akses</span>
            </button>
          </div>
        </form>

        <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 text-center flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
          <span>Status admin tersimpan otomatis di perangkat ini</span>
        </div>
      </div>
    </div>
  );
};
