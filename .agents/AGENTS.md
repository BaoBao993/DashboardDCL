# Project-Scoped Rules & Knowledge

## 1. Danh Mục Nguồn Dữ Liệu & Quy Tắc Trích Xuất (Data Sources Registry)

### 📌 Nguồn 1: Volume + %Gán + %GTC (Looker Studio)
* **Link báo cáo**: `https://datastudio.google.com/u/0/reporting/ad3903e1-3825-4b16-812e-e92def710c27/page/p_wr6wgaugwd`
* **Cách lấy**: Tự động scrape qua Playwright Chromium (bảng 3.1 So sánh %GTC ALL, bảng 1.1 So sánh Volume ALL) hoặc đọc overrides từ `overrides.json`.
* **Dữ liệu**: Sản lượng (Volume) và Tỷ lệ giao thành công (GTC) toàn vùng và từng AM.

### 📌 Nguồn 2: Tồn Đọng Lastmile (Looker Studio)
* **Link báo cáo**: `https://datastudio.google.com/u/0/reporting/c15bb190-272c-4a03-83a0-f323f867cdf7/page/iqRWF`

### 📌 Nguồn 3: Tỷ lệ Chuyển Trả %FD (Google Sheets & Excel)
* **Link Google Sheets**: `https://docs.google.com/spreadsheets/d/1eJo3_M35Q-Qb3t9AzZkF22gZUCG5oETj-ZIew1DaFgA/edit?gid=0#gid=0`
* **File fallback offline**: `Mentor/fd_live.xlsx` hoặc `ĐCL - %Chuyển trả.xlsx`
* **Sheet chính & Cột**: Sheet `%FD TTS` (hoặc `%FD_TTS`), trích xuất chuẩn **Cột J đến U** (AM, Bưu cục, 8 ngày theo dõi chi tiết từ L đến S, D/D-1, D/D-7).
* **Hiển thị trên Web**: Mặc định hiển thị tab `%FD TikTok Shop (Sheet %FD TTS, Cột J-U)`.

### 📌 Nguồn 4: Đơn LẤY Rớt Luân Chuyển (Google Sheets & Excel)
* **Link Google Sheets**: `https://docs.google.com/spreadsheets/d/1kYBjz-xrD8IsEo-PVC3a1Qi8etVGN9j-xWdZyrPo36M/edit?gid=698882533#gid=698882533`
* **File fallback offline**: `Mentor/DCL - Đơn LẤY rớt luân chuyển.xlsx` (hoặc trong thư mục `C:\Users\Administrator\Downloads\`)
* **Sheet chính & Cột**: Sheet `Đơn LẤY rớt luân chuyển ALL`, trích xuất toàn bộ **12 cột từ A đến L** (`vunglay`, `tinhlay`, `bc_lay`, `shift`, `loai_khach_hang`, `loai_hang`, `order_code`, `from_name`, `tenbcxuat`, `gio_ltc`, `gio_dk`, `AM`).
* **Tính năng trên Web**: Tự động tạo Bảng Pivot đa chiều (Bưu cục, Tỉnh, AM, Shop, Raw data) và Hộp chẩn đoán chuyên gia vận hành & Ma trận SOP hành động.

### 📌 Nguồn 5: Backlog Vùng / Đơn Aging >15 ngày (Google Sheets & Excel)
* **Link Google Sheets**: `https://docs.google.com/spreadsheets/d/1czdUAW8M9hJZ_OBk5fUgwJupOmahM6QW5AlufN36jaU/edit?gid=392250472#gid=392250472` (gid=392250472)
* **File fallback offline**: `Mentor/DCL - Đơn aging _5 ngày.xlsx` hoặc `Mentor/link2_live.xlsx`
* **Sheet chính**: Tìm sheet chứa từ khóa `aging` hoặc `aging>5`.

### 📌 Nguồn 6: Báo Cáo Nhân Sự & Tuyển Dụng Data (Google Sheets & Excel)
* **Link Google Sheets**: `https://docs.google.com/spreadsheets/d/1si4PWd97eJhQDQUBXvEErjmNHGO8W1NrQVFnzzMIkDI/edit?gid=1377259937#gid=1377259937`
* **File fallback offline**: `Mentor/recruitment_live.xlsx`
* **Sheet chính**: Tự động nhận diện tuần mới nhất (ví dụ: `Tổng hợp (T41)`).
* **Quy tắc chống Double-counting**: Chỉ parse duy nhất **Bảng Master bên trái (Subtable 0)** gồm 67 bưu cục. Tuyệt đối không gộp 5 bảng tỉnh bên phải để tránh nhân đôi số liệu thiếu hụt và tuyển mới.
* **Sheet Cơ cấu Intern**: Đọc trực tiếp danh sách Intern phụ trách các tỉnh.

---

## 2. Hệ Thống Xuất Bản & Link Truy Cập
* **Link xem Online**: `https://BaoBao993.github.io/DashboardDCL/`
* **Link xem Nội bộ**: `http://localhost:8000` (Chạy qua `Mo_Dashboard.bat`)
* **Cập nhật dữ liệu tự động**: Chạy file `Cap_Nhat_Web.bat` hoặc script `python Cap_Nhat_Web.py` (tự động tổng hợp số liệu, cập nhật file JSON và đẩy lên GitHub Pages).
