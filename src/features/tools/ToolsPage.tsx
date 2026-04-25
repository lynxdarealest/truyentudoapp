import React from "react";
import { TFTabs } from "../../ui/tabs";
import { TFButton } from "../../ui/buttons";
import { TFInput, TFTextarea } from "../../ui/inputs";
import { PromptLibraryModal } from "../prompt/PromptLibrary";
import { TFAlert } from "./common/TFAlert";
import { storage } from "../../storage";
import { notifyApp } from "../../notifications";
import { VietphraseWorkbench } from "./VietphraseWorkbench";
import {
  applyWebGpuCapabilityResult,
  applyWebGpuStabilityResult,
  countWebGpuWeekOneCompletedTasks,
  loadWebGpuWeekOneState,
  runWebGpuCapabilityCheck,
  runWebGpuStabilityCheck,
  saveWebGpuWeekOneState,
  updateWebGpuWeekOneTaskStatus,
  type WebGpuWeekOneTaskStatus,
} from "../../webgpu/weekOne";

const toolsTabs = [
  { key: "translate", label: "Hỗ trợ Dịch" },
  { key: "write", label: "Hỗ trợ Viết (Writer Pro)" },
  { key: "upload-convert", label: "Tải truyện & Convert" },
  { key: "prompt", label: "Kho Prompt" },
  { key: "webgpu-week1", label: "WebGPU Tuần 1" },
];

const toolModeBadges = [
  "Phản hồi tức thì",
  "Chạy cục bộ",
  "Không gọi model AI",
];

const webGpuTaskStatuses: Array<{ value: WebGpuWeekOneTaskStatus; label: string }> = [
  { value: "todo", label: "Chưa làm" },
  { value: "in_progress", label: "Đang làm" },
  { value: "done", label: "Hoàn thành" },
];

type ToolsPageProps = {
  onBack: () => void;
  onRequireAuth: () => void;
};

function buildConsistencyNotes(source: string, dictionary: Array<{ original?: string; translation?: string }>): string[] {
  const notes: string[] = [];
  const text = String(source || "").trim();
  if (!text) return ["Chưa có nội dung để kiểm tra."];
  dictionary.forEach((entry) => {
    const original = String(entry.original || "").trim();
    const translation = String(entry.translation || "").trim();
    if (!original || !translation) return;
    const hasOriginal = text.includes(original);
    const hasTranslation = text.includes(translation);
    if (hasOriginal && !hasTranslation) {
      notes.push(`Phát hiện "${original}" nhưng chưa thấy bản dịch "${translation}".`);
    }
    if (hasOriginal && hasTranslation) {
      notes.push(`Đoạn văn đang lẫn cả "${original}" và "${translation}", nên rà lại consistency.`);
    }
  });
  return notes.length ? notes : ["Không phát hiện lỗi consistency rõ ràng theo từ điển hiện có."];
}

function buildStoryIdeas(brief: string): string {
  const clean = String(brief || "").trim();
  if (!clean) return "";
  const fragments = clean
    .split(/[\n,.!?;:]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const seeds = fragments.length ? fragments : [clean.slice(0, 120)];
  return [
    "1. Mở truyện:",
    `Nhân vật chính bị đẩy vào tình thế không thể lùi sau khi ${seeds[0].toLowerCase()}.`,
    "",
    "2. Bước ngoặt:",
    `Một bí mật liên quan đến ${seeds[1] || seeds[0]} khiến toàn bộ mục tiêu ban đầu bị đảo chiều.`,
    "",
    "3. Cao trào:",
    `Nhân vật phải chọn giữa ${seeds[2] || "lý trí"} và ${seeds[3] || "điều mình thật sự muốn bảo vệ"}.`,
    "",
    "4. Hook chương tiếp:",
    "Kết mỗi chương bằng một thông tin mới, một lời thú nhận hoặc một hậu quả không thể rút lại.",
  ].join("\n");
}

export const ToolsPage: React.FC<ToolsPageProps> = ({ onBack, onRequireAuth }) => {
  const [tab, setTab] = React.useState("translate");
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [newOriginal, setNewOriginal] = React.useState("");
  const [newTranslation, setNewTranslation] = React.useState("");
  const [dictionaryRows, setDictionaryRows] = React.useState(() => storage.getTranslationNames());
  const [consistencyInput, setConsistencyInput] = React.useState("");
  const [consistencyResult, setConsistencyResult] = React.useState<string[]>([]);
  const [ideaBrief, setIdeaBrief] = React.useState("");
  const [ideaResult, setIdeaResult] = React.useState("");
  const [styleDraft, setStyleDraft] = React.useState("");
  const [webGpuWeekOneState, setWebGpuWeekOneState] = React.useState(() => loadWebGpuWeekOneState());
  const [isCheckingCapability, setIsCheckingCapability] = React.useState(false);
  const [isCheckingStability, setIsCheckingStability] = React.useState(false);

  const refreshDictionary = React.useCallback(() => {
    setDictionaryRows(storage.getTranslationNames());
  }, []);

  React.useEffect(() => {
    saveWebGpuWeekOneState(webGpuWeekOneState);
  }, [webGpuWeekOneState]);

  const completedWeekOneTasks = countWebGpuWeekOneCompletedTasks(webGpuWeekOneState);
  const totalWeekOneTasks = Math.max(1, webGpuWeekOneState.tasks.length);
  const weekOneProgress = Math.round((completedWeekOneTasks * 100) / totalWeekOneTasks);

  const updateWebGpuTask = React.useCallback((taskId: string, status: WebGpuWeekOneTaskStatus) => {
    setWebGpuWeekOneState((prev) => updateWebGpuWeekOneTaskStatus(prev, taskId, status));
  }, []);

  return (
    <div className="space-y-6 pt-24 pb-12 px-2 md:px-0">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-serif font-bold text-slate-100">Công cụ</h2>
        <TFButton variant="ghost" onClick={onBack}>Quay lại</TFButton>
      </div>

      <section className="tf-card p-4 md:p-5 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-300/80">AI Trust Center</p>
            <h3 className="text-xl font-semibold text-slate-100">Trang này ưu tiên công cụ cục bộ, rõ ràng và phản hồi nhanh</h3>
            <p className="tf-body max-w-3xl">
              Các tác vụ ở đây giúp khóa thuật ngữ, rà consistency, lưu văn mẫu và quản lý prompt.
              Chúng không giả vờ là AI tạo sinh. Khi cần luồng AI đầy đủ, hãy mở workspace chính hoặc đăng nhập để dùng tính năng nâng cao.
            </p>
          </div>
          <TFButton variant="primary" onClick={onRequireAuth}>
            Mở AI nâng cao
          </TFButton>
        </div>
        <div className="flex flex-wrap gap-2">
          {toolModeBadges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
            >
              {badge}
            </span>
          ))}
        </div>
      </section>

      <TFTabs tabs={toolsTabs} active={tab} onChange={setTab} variant="pill" />

      {tab === "translate" && (
        <section className="grid md:grid-cols-2 gap-4">
          <div className="tf-card p-4 space-y-3">
            <h3 className="text-lg font-semibold">Từ điển tên riêng</h3>
            <p className="tf-body">Khóa tên và thuật ngữ bắt buộc trước khi đưa truyện vào AI dịch.</p>
            <TFInput value={newOriginal} onChange={(e) => setNewOriginal(e.target.value)} placeholder="Tên gốc" />
            <TFInput value={newTranslation} onChange={(e) => setNewTranslation(e.target.value)} placeholder="Tên dịch" />
            {dictionaryRows.length ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300 space-y-2 max-h-48 overflow-y-auto">
                {dictionaryRows.slice(0, 8).map((row: any, index: number) => (
                  <div key={`${row.original}-${row.translation}-${index}`} className="flex items-center justify-between gap-3">
                    <span className="truncate">{row.original} {'->'} {row.translation}</span>
                    <button
                      onClick={() => {
                        const next = dictionaryRows.filter((_: unknown, idx: number) => idx !== index);
                        storage.saveTranslationNames(next);
                        refreshDictionary();
                        notifyApp({ tone: "success", message: "Đã xóa mục khỏi từ điển." });
                      }}
                      className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end">
              <TFButton
                variant="primary"
                onClick={() => {
                  const original = newOriginal.trim();
                  const translation = newTranslation.trim();
                  if (!original || !translation) {
                    notifyApp({ tone: "warn", message: "Điền đủ tên gốc và tên dịch trước khi thêm." });
                    return;
                  }
                  const next = [
                    { original, translation },
                    ...dictionaryRows.filter((row: any) => String(row.original || "").trim().toLowerCase() !== original.toLowerCase()),
                  ];
                  storage.saveTranslationNames(next);
                  setNewOriginal("");
                  setNewTranslation("");
                  refreshDictionary();
                  notifyApp({ tone: "success", message: "Đã thêm mục mới vào từ điển tên riêng." });
                }}
              >
                Thêm
              </TFButton>
            </div>
          </div>
          <div className="tf-card p-4 space-y-3">
            <h3 className="text-lg font-semibold">QA consistency cục bộ</h3>
            <p className="tf-body">Quét nhanh xưng hô và thuật ngữ theo từ điển local, không gọi AI.</p>
            <TFTextarea value={consistencyInput} onChange={(e) => setConsistencyInput(e.target.value)} placeholder="Dán đoạn cần quét..." />
            {consistencyResult.length ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-300 space-y-2">
                {consistencyResult.map((item, index) => (
                  <p key={`${item}-${index}`}>{item}</p>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end">
              <TFButton
                variant="primary"
                onClick={() => {
                  const notes = buildConsistencyNotes(consistencyInput, storage.getTranslationNames());
                  setConsistencyResult(notes);
                  notifyApp({ tone: "info", message: "Đã chạy kiểm tra consistency cho đoạn văn." });
                }}
              >
                Chạy QA local
              </TFButton>
            </div>
          </div>
        </section>
      )}

      {tab === "write" && (
        <section className="grid md:grid-cols-2 gap-4">
          <div className="tf-card p-4 space-y-3">
            <h3 className="text-lg font-semibold">Khung ý tưởng nhanh</h3>
            <TFAlert tone="warn">Đây là bộ khung cục bộ để brainstorm nhanh, không phải AI sinh cốt truyện hoàn chỉnh.</TFAlert>
            <TFTextarea value={ideaBrief} onChange={(e) => setIdeaBrief(e.target.value)} placeholder="Tóm tắt/brief..." />
            {ideaResult ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm whitespace-pre-wrap text-slate-300">
                {ideaResult}
              </div>
            ) : null}
            <div className="flex justify-end">
              <TFButton
                variant="primary"
                onClick={() => {
                  const result = buildStoryIdeas(ideaBrief);
                  if (!result) {
                    notifyApp({ tone: "warn", message: "Nhập brief trước khi sinh ý tưởng." });
                    return;
                  }
                  setIdeaResult(result);
                  notifyApp({ tone: "success", message: "Đã tạo khung ý tưởng nhanh bằng công cụ local." });
                }}
              >
                Tạo khung nhanh
              </TFButton>
            </div>
          </div>
          <div className="tf-card p-4 space-y-3">
            <h3 className="text-lg font-semibold">Kho văn phong nhanh</h3>
            <TFTextarea value={styleDraft} onChange={(e) => setStyleDraft(e.target.value)} placeholder="Dán văn mẫu thủ công để lưu nhanh..." />
            <div className="flex justify-end">
              <TFButton
                variant="primary"
                onClick={() => {
                  const content = styleDraft.trim();
                  if (!content) {
                    notifyApp({ tone: "warn", message: "Dán văn mẫu trước khi lưu." });
                    return;
                  }
                  const next = [
                    {
                      id: `style-${Date.now()}`,
                      name: `Văn mẫu ${new Date().toLocaleTimeString('vi-VN')}`,
                      content,
                      kind: "manual",
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    },
                    ...storage.getStyleReferences(),
                  ];
                  storage.saveStyleReferences(next);
                  notifyApp({ tone: "success", message: "Đã lưu văn mẫu để dùng lại sau." });
                }}
              >
                Lưu văn mẫu
              </TFButton>
            </div>
            <TFAlert tone="success">DNA văn phong học từ file nằm trong luồng AI viết truyện. Mục này dùng để lưu nhanh các đoạn văn mẫu thủ công.</TFAlert>
          </div>
        </section>
      )}

      {tab === "upload-convert" && <VietphraseWorkbench />}

      {tab === "prompt" && (
        <section className="tf-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Kho Prompt</h3>
              <p className="tf-body">Quản lý quy tắc cốt lõi và theo thể loại.</p>
            </div>
            <TFButton
              variant="primary"
              onClick={() => {
                if (typeof onRequireAuth === "function") {
                  // Kho prompt hiện dùng local storage, không cần đăng nhập nhưng vẫn giữ hook nếu sản phẩm cần mở rộng sau.
                }
                setShowPrompt(true);
              }}
            >
              Mở kho prompt
            </TFButton>
          </div>
          <TFAlert tone="success">Kho Prompt ở đây là bộ nhớ cục bộ của thiết bị. Prompt đã lưu sẽ được giữ lại kể cả khi đóng/mở lại modal.</TFAlert>
        </section>
      )}

      {tab === "webgpu-week1" && (
        <section className="space-y-4">
          <div className="tf-card p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Kiến trúc Tuần 1</h3>
                <p className="tf-body">
                  Theo dõi 4 mốc bắt buộc trước khi bật WebGPU rộng rãi: scope, KPI, flag, stability.
                </p>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                {completedWeekOneTasks}/{totalWeekOneTasks} mốc
              </span>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                  style={{ width: `${weekOneProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-300">Tiến trình hiện tại: {weekOneProgress}%</p>
            </div>
            <div className="space-y-3">
              {webGpuWeekOneState.tasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold text-slate-100">{task.title}</h4>
                    <span className="text-[11px] text-slate-400">
                      Cập nhật {new Date(task.updatedAt).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{task.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {webGpuTaskStatuses.map((option) => (
                      <button
                        key={`${task.id}-${option.value}`}
                        onClick={() => updateWebGpuTask(task.id, option.value)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          task.status === option.value
                            ? "bg-cyan-500 text-slate-950"
                            : "border border-white/15 bg-slate-900/50 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="tf-card p-4 space-y-3">
              <h3 className="text-lg font-semibold">Kiểm tra khả năng WebGPU</h3>
              <p className="tf-body">
                Kiểm tra secure context, feature flag, adapter và giới hạn bộ đệm trước khi chạy thật.
              </p>
              {webGpuWeekOneState.capability ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-200 space-y-1">
                  <p><strong>Trạng thái:</strong> {webGpuWeekOneState.capability.status}</p>
                  <p>{webGpuWeekOneState.capability.summary}</p>
                  {webGpuWeekOneState.capability.adapterName ? (
                    <p><strong>Adapter:</strong> {webGpuWeekOneState.capability.adapterName}</p>
                  ) : null}
                  {webGpuWeekOneState.capability.maxBufferSize ? (
                    <p><strong>maxBufferSize:</strong> {webGpuWeekOneState.capability.maxBufferSize}</p>
                  ) : null}
                  {webGpuWeekOneState.capability.errorMessage ? (
                    <p className="text-rose-300"><strong>Lỗi:</strong> {webGpuWeekOneState.capability.errorMessage}</p>
                  ) : null}
                </div>
              ) : (
                <TFAlert tone="warn">Chưa có dữ liệu kiểm tra capability.</TFAlert>
              )}
              <div className="flex justify-end">
                <TFButton
                  variant="primary"
                  disabled={isCheckingCapability}
                  onClick={async () => {
                    setIsCheckingCapability(true);
                    try {
                      const report = await runWebGpuCapabilityCheck();
                      setWebGpuWeekOneState((prev) => applyWebGpuCapabilityResult(prev, report));
                      notifyApp({ tone: report.status === "ready" ? "success" : "info", message: report.summary });
                    } catch (error) {
                      notifyApp({
                        tone: "error",
                        message: error instanceof Error ? error.message : "Kiểm tra capability thất bại.",
                      });
                    } finally {
                      setIsCheckingCapability(false);
                    }
                  }}
                >
                  {isCheckingCapability ? "Đang kiểm tra..." : "Chạy capability check"}
                </TFButton>
              </div>
            </div>

            <div className="tf-card p-4 space-y-3">
              <h3 className="text-lg font-semibold">Kiểm tra ổn định (smoke)</h3>
              <p className="tf-body">
                Chạy nhiều vòng copy buffer trên queue GPU để phát hiện fail sớm khi rollout.
              </p>
              {webGpuWeekOneState.stability ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-200 space-y-1">
                  <p><strong>Kết quả:</strong> {webGpuWeekOneState.stability.success ? "PASS" : "FAIL"}</p>
                  <p>{webGpuWeekOneState.stability.message}</p>
                  <p>
                    <strong>Vòng chạy:</strong> {webGpuWeekOneState.stability.iterationsCompleted}/
                    {webGpuWeekOneState.stability.iterationsRequested}
                  </p>
                  <p><strong>Trung bình:</strong> {webGpuWeekOneState.stability.avgIterationMs} ms/vòng</p>
                  <p><strong>Thông lượng:</strong> {webGpuWeekOneState.stability.throughputOpsPerSecond} ops/s</p>
                  {webGpuWeekOneState.stability.errorMessage ? (
                    <p className="text-rose-300"><strong>Lỗi:</strong> {webGpuWeekOneState.stability.errorMessage}</p>
                  ) : null}
                </div>
              ) : (
                <TFAlert tone="warn">Chưa có dữ liệu kiểm tra stability.</TFAlert>
              )}
              <div className="flex justify-end">
                <TFButton
                  variant="primary"
                  disabled={isCheckingStability}
                  onClick={async () => {
                    setIsCheckingStability(true);
                    try {
                      const report = await runWebGpuStabilityCheck();
                      setWebGpuWeekOneState((prev) => applyWebGpuStabilityResult(prev, report));
                      notifyApp({
                        tone: report.success ? "success" : "warn",
                        message: report.message,
                      });
                    } catch (error) {
                      notifyApp({
                        tone: "error",
                        message: error instanceof Error ? error.message : "Stability check thất bại.",
                      });
                    } finally {
                      setIsCheckingStability(false);
                    }
                  }}
                >
                  {isCheckingStability ? "Đang kiểm tra..." : "Chạy stability smoke"}
                </TFButton>
              </div>
            </div>
          </div>
        </section>
      )}

      <PromptLibraryModal
        isOpen={showPrompt}
        onClose={() => setShowPrompt(false)}
        onSelect={(prompt) => {
          setShowPrompt(false);
          setIdeaBrief((prev) => prev || prompt);
          notifyApp({ tone: "success", message: "Đã lấy prompt từ kho mẫu." });
        }}
      />
    </div>
  );
};
