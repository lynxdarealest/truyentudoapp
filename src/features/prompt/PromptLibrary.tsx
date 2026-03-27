import React from "react";
import { motion } from "motion/react";
import { Library } from "lucide-react";
import clsx from "clsx";
import { TFTabs } from "../../ui/tabs";
import { TFButton } from "../../ui/buttons";
import { TFTextarea } from "../../ui/inputs";
import {
  loadPromptLibraryState,
  resetPromptLibraryState,
  savePromptLibraryState,
  type PromptLibraryItem,
  type PromptLibraryState,
  type PromptLibraryTabKey,
} from "../../promptLibraryStore";
import { notifyApp } from "../../notifications";

type PromptLibraryProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (prompt: string) => void;
};

function updatePromptLibraryList(
  state: PromptLibraryState,
  group: PromptLibraryTabKey,
  nextList: PromptLibraryItem[],
): PromptLibraryState {
  return {
    ...state,
    [group]: nextList,
  };
}

export const PromptLibraryModal: React.FC<PromptLibraryProps> = ({ isOpen, onClose, onSelect }) => {
  const [selectedGroup, setSelectedGroup] = React.useState<PromptLibraryTabKey>("core");
  const [libraryState, setLibraryState] = React.useState<PromptLibraryState>(() => loadPromptLibraryState());
  const currentList = libraryState[selectedGroup];
  const [selectedId, setSelectedId] = React.useState(currentList[0]?.id || "");
  const [draftTitle, setDraftTitle] = React.useState(currentList[0]?.title || "");
  const [draftContent, setDraftContent] = React.useState(currentList[0]?.content || "");
  const [notice, setNotice] = React.useState("");
  const selectedItem = currentList.find((i) => i.id === selectedId) || currentList[0];

  const commitLibraryState = React.useCallback((nextState: PromptLibraryState) => {
    setLibraryState(nextState);
    savePromptLibraryState(nextState);
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    const nextState = loadPromptLibraryState();
    setLibraryState(nextState);
  }, [isOpen]);

  React.useEffect(() => {
    const list = libraryState[selectedGroup];
    const fallbackItem = list.find((item) => item.id === selectedId) || list[0];
    if (!fallbackItem) {
      setSelectedId("");
      setDraftTitle("");
      setDraftContent("");
      return;
    }
    setSelectedId(fallbackItem.id);
    setDraftTitle(fallbackItem.title);
    setDraftContent(fallbackItem.content);
  }, [selectedGroup, libraryState, selectedId]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const isDirty = Boolean(selectedItem) && (
    draftTitle !== String(selectedItem?.title || "") ||
    draftContent !== String(selectedItem?.content || "")
  );

  const applyDraftToState = React.useCallback((baseState: PromptLibraryState): PromptLibraryState => {
    if (!selectedId) return baseState;
    const normalizedTitle = draftTitle.trim() || (selectedGroup === "core" ? "Quy tắc chưa đặt tên" : "Nhóm chưa đặt tên");
    const nextList = baseState[selectedGroup].map((item) => (
      item.id === selectedId
        ? { ...item, title: normalizedTitle, content: draftContent }
        : item
    ));
    return updatePromptLibraryList(baseState, selectedGroup, nextList);
  }, [draftContent, draftTitle, selectedGroup, selectedId]);

  const persistDraft = React.useCallback((nextNotice?: string) => {
    const nextState = applyDraftToState(libraryState);
    commitLibraryState(nextState);
    if (nextNotice) setNotice(nextNotice);
    return nextState;
  }, [applyDraftToState, commitLibraryState, libraryState]);

  const handleSwitchGroup = (nextGroup: PromptLibraryTabKey) => {
    if (nextGroup === selectedGroup) return;
    if (isDirty) {
      persistDraft("Đã tự động lưu mục trước khi đổi nhóm.");
    }
    setSelectedGroup(nextGroup);
  };

  const handleSelectItem = (nextId: string) => {
    if (nextId === selectedId) return;
    if (isDirty) {
      persistDraft("Đã tự động lưu mục trước khi đổi prompt.");
    }
    setSelectedId(nextId);
  };

  const handleClose = () => {
    if (isDirty) {
      persistDraft("Đã tự động lưu trước khi đóng Kho Prompt.");
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] tf-modal-overlay flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="tf-modal-panel bg-slate-950 w-full max-w-5xl rounded-[32px] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-4 md:p-6 border-b border-white/10 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 text-white min-w-0">
            <div className="p-2 bg-indigo-600/20 rounded-xl border border-indigo-500/40">
              <Library className="w-5 h-5 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Kho Prompt</p>
              <h3 className="text-xl font-bold tf-break-long">Quy tắc & Prompt</h3>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TFButton
              variant="ghost"
              onClick={() => {
                const resetState = resetPromptLibraryState();
                setLibraryState(resetState);
                setSelectedGroup("core");
                setSelectedId(resetState.core[0]?.id || "");
                setDraftTitle(resetState.core[0]?.title || "");
                setDraftContent(resetState.core[0]?.content || "");
                setNotice("Đã khôi phục prompt mặc định.");
              }}
            >
              Khôi phục mặc định
            </TFButton>
            <button onClick={handleClose} className="tf-btn tf-btn-ghost px-3 py-2 shrink-0">Đóng</button>
          </div>
        </div>

        <div className="px-4 md:px-6 pt-4">
          <TFTabs
            tabs={[
              { key: "core", label: "Quy tắc Cốt lõi" },
              { key: "genre", label: "Theo Thể loại" },
              { key: "adult", label: "Prompt 18+" },
            ]}
            active={selectedGroup}
            onChange={(k) => handleSwitchGroup(k as PromptLibraryTabKey)}
            variant="pill"
            className="w-full"
          />
        </div>

        <div className="tf-modal-content flex flex-col md:flex-row flex-1 overflow-hidden min-h-[420px] bg-slate-950">
          <div className="w-full md:w-[34%] border-b md:border-b-0 md:border-r border-white/10 bg-slate-900/80 overflow-y-auto p-4 space-y-2">
            {currentList.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectItem(item.id)}
                className={clsx(
                  "w-full text-left px-4 py-3 rounded-md font-semibold transition-colors border tf-break-long",
                  selectedId === item.id
                    ? "bg-indigo-600 text-white border-indigo-400 shadow"
                    : "bg-slate-900/60 text-slate-200 border-white/5 hover:bg-slate-800"
                )}
              >
                {item.title}
              </button>
            ))}
            <button
              onClick={() => {
                const baseState = isDirty ? persistDraft() : libraryState;
                const baseList = baseState[selectedGroup];
                const id = `new-${Date.now()}`;
                const newItem = {
                  id,
                  title:
                    selectedGroup === "core"
                      ? "Quy tắc mới"
                      : selectedGroup === "adult"
                        ? "Prompt 18+ mới"
                        : "Nhóm mới",
                  content: "",
                };
                const nextList = [...baseList, newItem];
                commitLibraryState(updatePromptLibraryList(baseState, selectedGroup, nextList));
                setSelectedId(id);
                setDraftTitle(newItem.title);
                setDraftContent("");
                setNotice("Đã thêm mục prompt mới.");
              }}
              className="w-full mt-3 tf-btn tf-btn-ghost justify-center"
            >
              + Thêm {selectedGroup === "core" ? "quy tắc" : selectedGroup === "adult" ? "prompt 18+" : "nhóm"}
            </button>
          </div>

          <div className="w-full md:w-[66%] p-4 md:p-6 overflow-y-auto relative space-y-4">
            {notice ? (
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200">
                {notice}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="tf-input text-lg font-bold tf-break-long"
              />
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span
                  className={clsx(
                    "rounded-full px-3 py-1",
                    isDirty ? "bg-amber-500/15 text-amber-200 border border-amber-400/20" : "bg-emerald-500/15 text-emerald-200 border border-emerald-400/20"
                  )}
                >
                  {isDirty ? "Chưa lưu" : "Đã đồng bộ"}
                </span>
                <span className="text-slate-400">Tự động lưu khi đổi mục hoặc đóng.</span>
              </div>
            </div>
            <TFTextarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="- Giọng văn: ...\n- Xưng hô: ...\n- Từ vựng: ...\n- Cấm: ..."
            />
            <div className="flex flex-col sm:flex-row justify-end gap-3 tf-actions-mobile">
              <TFButton
                variant="ghost"
                onClick={async () => {
                  const prompt = draftContent.trim();
                  if (!prompt) {
                    setNotice("Chưa có nội dung để sao chép.");
                    return;
                  }
                  if (isDirty) {
                    persistDraft("Đã lưu prompt hiện tại trước khi sao chép.");
                  }
                  onSelect(prompt);
                  try {
                    await navigator.clipboard.writeText(prompt);
                    notifyApp({ tone: 'success', message: 'Đã sao chép prompt vào clipboard.' });
                  } catch {
                    notifyApp({ tone: 'warn', message: 'Không thể ghi clipboard, nhưng prompt vẫn được chuyển vào ô đích.' });
                  }
                  onClose();
                }}
              >
                Sao chép & đóng
              </TFButton>
              <TFButton
                variant="primary"
                disabled={!isDirty}
                onClick={() => {
                  persistDraft("Đã lưu thay đổi vào Kho prompt.");
                }}
              >
                Lưu thay đổi
              </TFButton>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
