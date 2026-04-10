import React from 'react';
import { motion } from 'motion/react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
}

export function ConfirmModal({ isOpen, onClose, onConfirm, title, message }: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] tf-modal-overlay flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="tf-modal-panel relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl overflow-hidden p-6 md:p-8"
      >
        <h3 className="text-xl font-serif font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-500 mb-8 tf-break-long">{message}</p>
        <div className="flex gap-3 tf-modal-actions">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
          >
            Hủy
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-900/20"
          >
            Xóa
          </button>
        </div>
      </motion.div>
    </div>
  );
}
