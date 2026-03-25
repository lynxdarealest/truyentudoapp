# Technical Specification & Development Roadmap (Phiên bản Nâng cấp)

## 0) Product Definition
* Product name: **TruyenForge AI** (có thể đổi tên theo brand của bạn).
* Product type: Web App + PWA cho tác giả và dịch giả chuyên nghiệp.
* Personas chính: Author, Translator, Proofreader/Editor, Admin.
* Product mission: tăng tốc độ sáng tác/dịch thuật, giảm lỗi logic và lỗi thuật ngữ, nâng chất lượng bản thảo ở quy mô chuyên nghiệp.

## 1) Vai trò AI trong sản phẩm
* AI là **Co-writer** cho tác giả: viết tiếp, gợi ý cốt truyện, đổi giọng điệu, hỏi đáp bối cảnh.
* AI là **Context-aware Translator** cho dịch giả: dịch theo chương, buộc glossary, đề xuất nhiều phương án.
* AI là **Quality Gate** cho proofreader: quét nhất quán xưng hô, lặp từ, sai thuật ngữ, sai timeline.
* AI là **Knowledge Extractor** cho worldbuilding: tự động tạo wiki, timeline, graph quan hệ.

## 2) Mục tiêu hiệu năng và chất lượng
* Latency mục tiêu:
    * Auto-complete 50-200 chữ: P95 <= 4s (streaming bắt đầu <= 1.2s).
    * Dịch 1 đoạn 120-250 từ: P95 <= 5s.
    * Consistency scan 1 chương 3k-5k từ: <= 35s.
* Tỷ lệ chấp nhận gợi ý AI (accept rate): >= 45% sau 8 tuần (Đo lường tự động qua bảng `ai_suggestion_events`).
* Tỷ lệ vi phạm glossary trên bản dịch đã duyệt: <= 1%.

## 3) Cải thiện tốc độ xử lý AI và Kiến trúc Hệ thống
### 3.1 AI Gateway + Model Router & FinOps
* Tạo service `ai-gateway` dùng API key server-side, không gọi trực tiếp từ client.
* **Data Privacy (Bảo mật IP):** Sử dụng API cấp doanh nghiệp (Enterprise APIs) với cam kết Zero Data Retention (không lưu data để train AI). Thêm cờ `opt_out_training` trong cài đặt dự án. Lọc PII (Data Sanitization) tại gateway trước khi gửi đi.
* Điều phối model theo task:
    * Fast draft: model nhẹ (Llama 3 8B/70B-hosted hoặc GPT mini).
    * Chất lượng cao: GPT-4 class / Claude 3.5 Sonnet class.
    * Consistency check: model nhanh + rule engine.
* **Hard Quota & Fallback:** Gateway kiểm tra budget dự án trong `project_quotas`. Nếu hết tiền, tự động fallback về model miễn phí (như Llama 3 self-hosted) thay vì khóa tính năng.

### 3.2 Context Retrieval tối ưu (Hierarchical & GraphRAG)
* Tách chương thành chunks 600-900 tokens + embedding.
* Retrieval 3 lớp:
    * Lớp 1: BM25/keyword cho tên riêng, vật phẩm, sự kiện.
    * Lớp 2: Vector similarity cho bối cảnh ý nghĩa.
    * **Lớp 3 (GraphRAG):** Truy xuất các Node và Edge xung quanh nhân vật từ bảng `entity_relations` để model hiểu các mối quan hệ gián tiếp.
* **Hierarchical Summarization cho Auto-complete:** Thay vì nạp raw text của 5 chương, chỉ nạp: Chương 1-3 (tóm tắt siêu ngắn), Chương 4 (tóm tắt sự kiện chính), Chương 5 (full text). Kết hợp hồ sơ phong cách tác giả và Glossary.

### 3.3 Caching
* Prompt fingerprint cache theo hash: `task + storyId + chapterId + glossaryVersion + model`.
* Semantic cache cho câu/segment đã dịch.
* Cache kết quả context query 5-15 phút.

### 3.4 Streaming + Job Queue
* Streaming token ngay khi model trả về.
* Tác vụ nặng (scan toàn chương, vẽ graph timeline, export PDF/EPUB) đưa vào background queue (tránh dùng client render export).
* Frontend poll/websocket trạng thái job theo `job_id`.

### 3.5 Quick Wins cho codebase & Nền tảng Collaboration
* Tích hợp CRDT (Conflict-free Replicated Data Type - Yjs hoặc Automerge) cho component Editor ngay từ Phase 0 để làm nền tảng cho Real-time Collaboration sau này.
* Tách `src/App.tsx` thành module (editor, translator, glossary, ai-jobs) để giảm re-render và dễ profile.
* Chuyển parse PDF/EPUB sang Web Worker để UI không bị block.
* Debounce các onChange lớn (300-500ms) ở editor.
* Chỉ render markdown preview khi idling (requestIdleCallback).

## 4) IA + sắp xếp chức năng theo vị trí
* Thanh điều hướng chính (left rail desktop / bottom nav mobile): Dashboard, Projects, Writing Studio, Translation Studio, Universe Wiki, Quality Center, Settings.
* Bên trong Project: Tab 1: Chapters, Tab 2: Glossary, Tab 3: Timeline, Tab 4: Relationship Graph, Tab 5: Translation Memory, Tab 6: Exports.
* Context panel bên phải (collapsible): Character cards, Thuật ngữ bắt buộc, Recent AI suggestions, Consistency alerts.

## 5) Visual redesign (màu sắc + giao diện)
* Theme: editorial + cinematic, ưu tiên đọc lâu, giảm mệt mắt.
* Typography: Heading: `Merriweather`, Body/UI: `Be Vietnam Pro`, Code/term: `JetBrains Mono`.
* Bố cục chức năng:
    * Writing Studio: Editor ở giữa, AI command bar sát dưới editor, context panel bên phải.
    * Translation Studio: split-screen 55/45, source bên trái, target bên phải, AI options dock dưới target.

## 6) Core feature spec cho Writer (AI-assisted)
* **Auto-complete Story:** Dùng Hierarchical Summarization + GraphRAG để cung cấp ngữ cảnh sâu nhưng nhẹ. Trả về 3 variants, score confidence.
* **Plot Generator:** Trả về 3 hướng tiếp theo + list plot twist + rủi ro logic.
* **Tone Shift & Rephrase:** Chỉnh preset (u ám, lãng mạn, gay cấn...) mà không đổi fact.
* **Context Query:** Hỏi đáp trên `Universe + Chapters + Timeline`. Trả về câu trả lời + references (chapter/line).
* **Worldbuilding Database:** AI extract nhân vật, quan hệ, tạo timeline tự động và cảnh báo mâu thuẫn.

## 7) Core feature spec cho Translator (AI-assisted)
* **Advanced Translation Workspace:** Split-screen + 3 phương án dịch cho mỗi segment. Nút Apply, Merge, Retry.
* **Glossary-aware translation (Bắt buộc & Deterministic Fallback):** Engine lock term mapping. Nếu AI dịch sai thuật ngữ, dùng script Regex Post-processing cưỡng ép thay thế thuật ngữ đúng từ điển và highlight trên UI để dịch giả duyệt lại ngữ pháp, thay vì chặn (hard fail).
* **Translation Memory (TM):** Lưu source-target đã duyệt. Phase 1 chạy Exact Match qua hash, Phase 2 chạy Vector similarity/Fuzzy match 80-90%.
* **Post-Editing Assistance:** AI Proofreader kiểm tra lỗi chính tả/ngữ pháp/văn phong. AI Consistency Check dùng GraphRAG quét xưng hô/từ vựng xuyên suốt.

## 8) Database Schema (Đã cập nhật)

*(Giữ nguyên toàn bộ schema từ 10.1 đến 10.8 của bạn, bổ sung phần 10.9 và 10.10 dưới đây)*

### 10.9 FinOps & Quota Schema (Quản lý chi phí AI)
* **`model_pricing`:**
    * `id` UUID PK
    * `provider` VARCHAR(50) NOT NULL
    * `model_name` VARCHAR(80) NOT NULL
    * `input_price_per_1m` NUMERIC(10,4) NOT NULL
    * `output_price_per_1m` NUMERIC(10,4) NOT NULL
    * `effective_from` TIMESTAMPTZ NOT NULL
    * `is_active` BOOLEAN DEFAULT true
    * `created_at`, `updated_at` TIMESTAMPTZ
    * Index: `(is_active, model_name)`
* **`project_quotas`:**
    * `id` UUID PK
    * `project_id` UUID FK `projects.id` UNIQUE NOT NULL
    * `monthly_budget_usd` NUMERIC(10,4) DEFAULT 0.0000
    * `current_spend_usd` NUMERIC(10,4) DEFAULT 0.0000
    * `billing_cycle_start` TIMESTAMPTZ NOT NULL
    * `billing_cycle_end` TIMESTAMPTZ NOT NULL
    * `is_exhausted` BOOLEAN DEFAULT false
    * `last_calculated_at` TIMESTAMPTZ
    * `created_at`, `updated_at` TIMESTAMPTZ

### 10.10 Telemetry & KPI Schema (Đo lường AI)
* **`ai_suggestion_events`:**
    * `id` UUID PK
    * `project_id` UUID FK `projects.id` NOT NULL
    * `chapter_id` UUID FK `chapters.id` NOT NULL
    * `ai_job_id` UUID FK `ai_jobs.id` NULL
    * `user_id` UUID FK `users.id` NOT NULL
    * `suggestion_type` VARCHAR(50) CHECK (`translation_segment`, `autocomplete_block`, `qa_fix`)
    * `action_taken` VARCHAR(30) CHECK (`accepted`, `rejected`, `edited`, `ignored`)
    * `original_ai_text` TEXT
    * `final_user_text` TEXT
    * `edit_distance` INT DEFAULT 0
    * `created_at` TIMESTAMPTZ NOT NULL
    * Index: `(project_id, action_taken)`, `(suggestion_type, created_at DESC)`

## 9) UI/UX PWA Offline & Export Strategy
* **Offline State:** Ranh giới Online/Offline được quy định rõ. Khi mất mạng, Editor tự lưu nháp nội bộ vào IndexedDB. Các nút gọi AI (Translate, QA) bị mờ (Disabled) hoặc đẩy task vào `Local Job Queue` đợi đồng bộ.
* **Export Formats:** Việc parse Markdown sang EPUB 3/PDF được xử lý hoàn toàn qua backend worker (ví dụ Pandoc), trả về file tải qua `Export Queue` để tránh crash trình duyệt.

## 10) Roadmap phát triển (Đã tinh chỉnh ưu tiên)

### Phase 0 (Tuần 1-2): Foundation
* AI Gateway đa provider + Enterprise auth (Zero Data Retention) + FinOps pricing tracker.
* Schema dữ liệu core (project/story/chapter/user/member).
* UI shell mới + design tokens + responsive layout.
* **Tích hợp Yjs/CRDT cho Text Editor làm nền tảng từ sớm.**

### Phase 1 (Tuần 3-5): Translator MVP (must-have)
* Split-screen translation workspace.
* Glossary CRUD + term lock validator (Dùng Deterministic Fallback Regex).
* AI translate segment (3 suggestions) + apply flow.
* Translation Memory commit/search (Chỉ thực hiện Exact Match qua hash).
* Event tracking cơ bản (bảng `ai_suggestion_events`).
* KPI gate: vi phạm glossary <= 3% trong UAT.

### Phase 2 (Tuần 6-8): QA, TM Nâng cao và Hậu kỳ
* Nâng cấp Translation Memory: Vector similarity & Fuzzy match.
* AI Proofreader + Consistency Check (kết hợp GraphRAG).
* Quality Center workflow (assign/resolve issues).
* Chapter review status và approval pipeline.
* KPI gate: giảm 30-40% thời gian post-edit.

### Phase 3 (Tuần 9-12): Writer Pro features
* Co-writer editor: autocomplete (với Hierarchical Summarization), plot generator, tone shift.
* Context Query từ universe + timeline.
* Auto wiki extraction (character/location/item).

### Phase 4 (Tuần 13-16): Scale & PWA
* Offline drafting + sync queue (PWA với IndexedDB chặn call API).
* Team collaboration real-time + comment threads (Bật chế độ Multiplayer cho Yjs).
* Background Worker API để xuất bản EPUB/PDF qua máy chủ.
* Billing/quotas + observability dashboards.
