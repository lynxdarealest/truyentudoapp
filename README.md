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

## Cấu hình Supabase
- App hiện dùng Supabase cho đăng nhập và lưu trữ workspace tài khoản thay cho Firestore/Google.
- Khai báo biến môi trường trong `.env`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_WORKSPACES_TABLE` mặc định `user_workspaces`
  - `VITE_SUPABASE_QA_REPORTS_TABLE` mặc định `qa_reports`
  - `VITE_RAPHAEL_API_KEY` để bật tạo ảnh bìa Raphael/Evolink ngay trong app
  - `VITE_RAPHAEL_MODEL` mặc định `z-image-turbo`
  - `VITE_RAPHAEL_SIZE` mặc định `2:3`
- Chạy SQL khởi tạo ở [supabase/schema.sql](/Users/phand/Downloads/ai/truyentudoapp/supabase/schema.sql) trong Supabase SQL Editor trước khi test autosync.
- Workspace tài khoản sẽ lưu chung các mục: truyện, nhân vật, AI Rules, từ điển dịch, văn mẫu, prompt library, hồ sơ giao diện và cấu hình budget AI.

## Chế độ demo theo phase (route query)
- Phase 0 demo: `/?phase0=1`
- Phase 1 Translator MVP: `/?phase1=1`
- Phase 2 QA & hậu kỳ: `/?phase2=1`
- Phase 3 Writer Pro: `/?phase3=1`
- Phase 4 Scale & PWA: `/?phase4=1`
- Phase 5 Release checks: `/?phase5=1`

## Cấu hình relay (Cloudflare Worker)
- `VITE_RELAY_WS_BASE=wss://proxymid.<your-subdomain>.workers.dev/?code=`
- `VITE_RELAY_WEB_BASE=https://proxymid.<your-subdomain>.workers.dev/`
Nhập mã phòng trong tab Relay, app sẽ tự ghép WebSocket endpoint từ 2 biến trên.

Repo worker dùng sẵn:
- [ductruonglynx-netizen/proxymid](https://github.com/ductruonglynx-netizen/proxymid)

Hướng dẫn deploy + kết nối:
- [CLOUDFLARE_RELAY_SETUP.md](/Users/phand/Downloads/ai/truyentudoapp/docs/CLOUDFLARE_RELAY_SETUP.md)

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

## Lịch sử cập nhật
### v0.1b
- Dọn lại toàn bộ khu `Sao lưu & khôi phục` theo hướng tự nhiên và dễ hiểu hơn: đổi tên các nút, các trạng thái Google Drive và phần mô tả để bớt cảm giác “mùi dev”.
- Giữ đúng một file sao lưu hiện hành trên Google Drive cho mỗi tài khoản đã liên kết, không tiếp tục tạo thêm file mới mỗi lần sao lưu.
- Làm rõ luồng `Liên kết Google Drive` để một tài khoản TruyenForge chỉ đi với đúng một Gmail, giảm nguy cơ lưu nhầm dữ liệu sang tài khoản khác.
- Sửa phần lịch sử sao lưu để các cảnh báo cũ không còn làm người dùng tưởng rằng app vẫn thiếu cấu hình sau khi đã thêm biến môi trường và redeploy.
- Nâng phiên bản hiển thị lên `0.1b`.

### v0.1a
- Chuyển hệ lưu trữ tài khoản từ Firestore/Google sang Supabase để truyện, nhân vật, AI Rules, từ điển dịch và cấu hình làm việc được đồng bộ về một backend thống nhất hơn.
- Thêm file khởi tạo [supabase/schema.sql](/Users/phand/Downloads/ai/truyentudoapp/supabase/schema.sql) cho `user_workspaces` và `qa_reports`, giúp dựng server lưu trữ mới nhanh hơn.
- Nâng khả năng quan sát khi AI chạy: overlay giờ hiển thị rõ giai đoạn, phần việc hiện tại và tiến độ thực thay vì chỉ có spinner + số giây.
- Làm thông báo trong app bớt ồn hơn bằng cách gom nhóm các toast trùng lặp, giới hạn số lượng hiển thị và cho phép đóng tay khi cần.
- Cải thiện `Kho Prompt`: có trạng thái `Chưa lưu` / `Đã đồng bộ`, tự động lưu khi đổi mục hoặc đóng, và nút `Lưu thay đổi` chỉ bật khi thật sự có chỉnh sửa.
- Làm rõ `Công cụ` là bộ trợ giúp cục bộ: gắn nhãn không gọi AI, đổi các mô tả dễ gây hiểu nhầm và thêm lối mở sang AI nâng cao.
- Rút gọn cảm giác quá tải ở form tạo chương bằng checklist các trường quan trọng và tách phần `Tùy chỉnh nâng cao` để người dùng biết nên điền gì trước.
- Đổi `Lịch sử cập nhật` sang kiểu accordion theo phiên bản: mặc định chỉ hiện tên version, bấm vào mới mở nội dung và chỉ mở một phiên bản tại một thời điểm.
- Tự động lưu các cấu hình cục bộ quan trọng vào tài khoản đã đăng nhập, gồm hồ sơ giao diện, từ điển dịch, văn mẫu, kho prompt và budget AI.
- Thêm translation memory theo từng bộ truyện để tên riêng/thuật ngữ đã khóa ở truyện này không làm ảnh hưởng truyện khác nhưng vẫn giữ consistency cho các chương sau của chính truyện đó.
- Tích hợp tạo ảnh bìa qua Raphael/Evolink API để app gửi task tạo ảnh trong nền và nhận kết quả ngay tại giao diện hiện tại, không mở popup hoặc tab ngoài.

### v0.0a
- Nâng prompt và context pack của Writer Pro để AI bám objective, timeline, glossary và Universe Wiki chắc hơn.
- Tự động khóa glossary sau khi AI sinh nội dung, giảm hiện tượng lệch tên riêng hoặc thuật ngữ.
- Bổ sung chỉ số `Context Readiness` để báo khi dữ liệu đầu vào còn thiếu, giúp người dùng biết lúc nào AI sẽ hoạt động tốt nhất.
- Cải thiện tạo ảnh bìa bằng cách dựng prompt thông minh hơn và tăng chất lượng bìa fallback khi dịch vụ ảnh AI lỗi.
- Cải thiện dịch truyện bằng cơ chế dịch theo lô nhiều đoạn, giữ ngữ cảnh giữa các lô và chỉ nạp các mục từ điển thật sự xuất hiện để tăng tốc rõ rệt.
- Thêm khả năng hủy tác vụ AI đang chạy và chuyển các thông báo chính sang kiểu toast để thao tác bớt bị chặn bởi popup.
- Sửa Kho Prompt để nút `Lưu thay đổi` lưu bền vào local storage; đồng thời các nút trong trang `Công cụ` giờ đã có hành vi thực tế.
- Siết backup/import theo hướng an toàn hơn: không đưa API key vào file backup, có validate đầu vào và giữ lại một bản sao an toàn trước khi khôi phục.
- Khắc phục 2 mục Writer Pro: `Tone` và `Context` nay cập nhật đúng context/runtime và hỗ trợ đưa kết quả ngược về workspace.
- Thêm mục `Lịch sử cập nhật` nhỏ ngay trong giao diện Writer Pro để theo dõi thay đổi của phiên bản.

> Lưu ý: Đây là playground mô phỏng sản phẩm; kết nối model thật cần đặt API key ở Phase 1/3 và cân nhắc chính sách data retention của nhà cung cấp.
