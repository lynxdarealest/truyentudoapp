# TruyenForge AI – Web + PWA cho tác giả và dịch giả

TruyenForge AI là playground web/PWA giúp tác giả, dịch giả và biên tập viên cộng tác với AI: dịch chương, gợi ý cốt truyện, đổi giọng văn, quét chất lượng, và quản lý thế giới hư cấu (wiki/timeline/graph). Kiến trúc mô phỏng đa nhà cung cấp model, FinOps quota, cache, fallback, và chế độ offline/sync cơ bản.

## Chức năng nổi bật
- Translator (Phase 1): split-view, 3 gợi ý/segment, glossary lock + retry cưỡng bức, Translation Memory exact + fuzzy, KPI vi phạm glossary.
- QA & hậu kỳ (Phase 2): proofread + consistency scan (glossary/xưng hô/timeline), Quality Center assign/resolve, pipeline DRAFT → PUBLISHED, đo thời gian post-edit.
- Writer Pro (Phase 3): auto-complete 3 biến thể 50/100/200 từ, plot generator, tone shift preset, context Q&A, wiki extraction. Hierarchical context + GraphRAG node/edge (characters/locations/items/timeline) được tiêm vào prompt. FinOps control ngay trên header.
- Scale & PWA (Phase 4): offline drafting (IndexedDB), sync queue mô phỏng, service worker cache shell, quota/observability dashboard.
- Release checks (Phase 5): gate glossary pass-rate, latency, queue health, crash-free; xuất báo cáo JSON.

## An toàn, bảo mật & độ tin cậy
- **FinOps & quota:** Mọi call AI đi qua FinOps check (ước tính chi phí theo provider/model). Hết quota sẽ tự fallback mock thay vì chặn cứng. Có nút chỉnh hạn mức và reset chu kỳ 28 ngày (Phase 1 & 3).
- **Data privacy:** Gọi AI qua gateway server-side (mô phỏng multi-provider) với tùy chọn Zero Data Retention. Prompt được lọc PII ở gateway (khung sẵn). Không lưu API key trên server, chỉ localStorage trong môi trường demo.
- **Consistency guard:** Glossary lock + regex post-processing; Context Q&A bắt buộc dẫn chứng (references). Autocomplete/plot sử dụng hierarchical summary + GraphRAG để giảm drift.
- **Caching & fallback:** Cache fingerprint theo task; session cache cho dịch/viết; fallback heuristic khi provider lỗi hoặc hết quota.
- **Collaboration safety:** Editor đã gắn nền CRDT (Yjs) cho mở rộng real-time; debounce & requestIdle cho preview để tránh nghẽn UI.
- **Offline-first:** Khi offline, draft lưu IndexedDB; hàng đợi đồng bộ khi lên mạng lại. Export nặng (PDF/EPUB) mô phỏng chạy nền để không khóa UI.

## Kiến trúc & kỹ thuật nổi bật
- AI Gateway + FinOps: router đa nhà cung cấp (OpenAI/Anthropic/Gemini) với budget check, cost estimation, cache session, failover và fallback mock khi hết quota.
- Context tăng tốc: Hierarchical summarization + GraphRAG node/edge; semantic/cache theo fingerprint; background job cho tác vụ nặng (mô phỏng).
- Collaboration nền tảng: CRDT (Yjs) hook sẵn trong editor, sẵn sàng mở multiplayer; debounce, requestIdle cho preview.
- PWA/offline: IndexedDB lưu nháp, hàng đợi đồng bộ, service worker cache shell, export queue mô phỏng.

## Chạy nhanh (local)
```bash
npm install
npm run dev
# mở http://localhost:3000
```

## Chế độ demo theo phase (route query)
- Phase 0 demo: `/?phase0=1`
- Phase 1 Translator MVP: `/?phase1=1`
- Phase 2 QA & hậu kỳ: `/?phase2=1`
- Phase 3 Writer Pro: `/?phase3=1`
- Phase 4 Scale & PWA: `/?phase4=1`
- Phase 5 Release checks: `/?phase5=1`

## Cấu hình relay (tùy chọn, giống bản gốc)
- `VITE_RELAY_WS_BASE=wss://relay2026.up.railway.app/?code=`
- `VITE_RELAY_WEB_BASE=https://relay2026.vercel.app/`
Nhập URL WebSocket trong tab Relay: ví dụ `wss://relay2026.up.railway.app/?code=1810`. Relay health: https://relay2026.up.railway.app/health.

## FinOps nhanh (mock, client-side)
- Budget mặc định 20 USD/chu kỳ 28 ngày, lưu localStorage.
- Kiểm tra trước mỗi call; hết quota sẽ fallback model mock.
- Có nút chỉnh hạn mức và reset chu kỳ tại Phase 1 (Translator) và Phase 3 header.

## Thư mục chính
- `src/phase0` Gateway/API config, model router.
- `src/phase1` Translator workspace + TM + glossary.
- `src/phase2` QA engine + Quality Center.
- `src/phase3` Writer engine (autocomplete/plot/tone/context/wiki) + GraphRAG.
- `src/phase4` Offline/PWA sync queue.
- `src/phase5` Release checks.
- `src/finops.ts` Budget/cost helper; `docs/MASTER_TECH_SPEC_ROADMAP.md` bản master spec/roadmap.

## Build
```bash
npm run lint -- --noEmit
npm run build
```

> Lưu ý: Đây là playground mô phỏng sản phẩm; kết nối model thật cần đặt API key ở Phase 1/3 và cân nhắc chính sách data retention của nhà cung cấp.
