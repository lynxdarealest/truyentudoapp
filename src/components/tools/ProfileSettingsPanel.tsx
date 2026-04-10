import type { ChangeEvent, RefObject } from 'react';
import { ImagePlus } from 'lucide-react';

interface ProfileSettingsPanelProps {
  profileName: string;
  profileAvatar: string;
  onProfileNameChange: (value: string) => void;
  onProfileAvatarChange: (value: string) => void;
  onSave: () => void;
  onPickAvatarFile: () => void;
  onAvatarFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  avatarInputRef: RefObject<HTMLInputElement | null>;
}

export function ProfileSettingsPanel({
  profileName,
  profileAvatar,
  onProfileNameChange,
  onProfileAvatarChange,
  onSave,
  onPickAvatarFile,
  onAvatarFileChange,
  avatarInputRef,
}: ProfileSettingsPanelProps) {
  return (
    <div className="mb-8 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-violet-50 rounded-2xl">
          <ImagePlus className="w-6 h-6 text-violet-600" />
        </div>
        <div>
          <h3 className="text-xl font-serif font-bold">Hồ sơ hiển thị</h3>
          <p className="text-sm text-slate-500">Đổi tên và ảnh đại diện hiển thị trên thanh điều hướng.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
        <input
          value={profileName}
          onChange={(e) => onProfileNameChange(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-violet-500"
          placeholder="Tên hiển thị"
        />
        <input
          value={profileAvatar}
          onChange={(e) => onProfileAvatarChange(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-violet-500"
          placeholder="Link ảnh đại diện (https://...)"
        />
        <button
          onClick={onSave}
          className="px-6 py-3 rounded-2xl bg-violet-600 text-white font-bold hover:bg-violet-700"
        >
          Lưu hồ sơ
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={onAvatarFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={onPickAvatarFile}
          className="px-4 py-2 rounded-xl border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 text-sm font-semibold"
        >
          Tải ảnh từ thiết bị
        </button>
        <p className="text-xs text-slate-500">
          Dán URL hoặc tải ảnh từ máy (khuyến nghị dưới 2MB).
        </p>
      </div>
    </div>
  );
}
