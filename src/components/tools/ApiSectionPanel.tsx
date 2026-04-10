import React, { memo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { TextAiConfigPanel } from './TextAiConfigPanel';
import { GenerationConfigPanel } from './GenerationConfigPanel';
import { ImageAiConfigPanel } from './ImageAiConfigPanel';

interface ApiSectionPanelProps {
  onBack: () => void;
}

export const ApiSectionPanel = memo(function ApiSectionPanel({ onBack }: ApiSectionPanelProps) {
  return (
    <div className="max-w-5xl mx-auto pt-28 pb-12 px-4 md:px-6 space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-slate-100 transition-colors shrink-0"><ChevronLeft /></button>
        <div>
          <h2 className="text-2xl font-serif font-bold">AI Văn bản</h2>
        </div>
      </div>

      <TextAiConfigPanel />
      <GenerationConfigPanel />
      <ImageAiConfigPanel />
    </div>
  );
});

