# Sea KDE Calculator

Máy tính giá vận chuyển đường biển **Việt Nam → Canada** cho KDExpress. React + Vite, chạy hoàn toàn phía client, xuất bản in báo giá A4.

Hai chế độ tính:

- **Hàng lẻ** — theo KG. Cân tính phí lấy số lớn hơn giữa cân thực tế và cân thể tích (`D×R×C/6000`), làm tròn **lên** theo bước 0.5kg. Áp mức tối thiểu 25kg.
- **Pallet** — theo CBM hoặc theo KG (cân đã trừ pallet), xem song song cả hai rồi chọn cách nào để in cho khách. Áp mức tối thiểu 1 CBM.

Đơn từ 1500kg hiển thị "Liên hệ báo giá" thay vì ra số tiền, theo đúng bảng giá.

Cộng thêm vào tổng: phụ phí nhập tay, phí đóng kiện gỗ ($55/m³), thuế nhập khẩu (nhiều hóa đơn CAD/VNĐ × phần trăm thuế), trừ giảm giá. Quy đổi VNĐ theo `(Cột 1 + Cột 3)/2 × 1.015`.

## Chạy local

```bash
npm install
cp .env.example .env    # rồi điền thông tin thanh toán thật
npm run dev
```

## Biến môi trường

Thông tin thanh toán không lưu trong repo. Xem [.env.example](.env.example) để biết danh sách biến.

> [!IMPORTANT]
> Vite nhúng biến `VITE_*` vào bundle **lúc build**, không đọc lúc chạy. Phải khai báo đủ trên Railway (Service → Variables) **trước khi deploy**, và **build lại** sau mỗi lần đổi giá trị. Thiếu biến nào thì bản in hiện `(chưa cấu hình …)` ở chỗ đó.

## Triển khai (Railway)

Đã cấu hình sẵn trong [railway.json](railway.json): Nixpacks, build `npm run build`, start `npm run start`.

Railway chạy container nên site tĩnh cần một process nghe cổng — `npm run start` gọi `serve -s dist`, tự đọc biến `PORT` do Railway cấp. Cờ `-s` cho SPA fallback.

Push lên `main` là Railway tự build lại. Nhớ **Generate Domain** trong Settings → Networking, không có bước này thì service chạy nhưng không có URL truy cập.

## Bảng giá

Rate hardcode trong [src/App.jsx](src/App.jsx) (`RATE_KG`, `RATE_CBM`, `NEM_KIMDAN_RATE`, `WOODEN_CRATE_RATE`), theo bảng giá áp dụng từ **27/04/2026**. Bảng giá gốc dạng PDF **không nằm trong repo** — xem thư mục `file tính giá/` trên máy local.

Khi có bảng giá mới, sửa các hằng số ở đầu `src/App.jsx` và cập nhật ngày ở chân bản in.
