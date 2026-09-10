import React, { useState } from "react";
import { createPortal } from "react-dom";

// ── RATE TABLES (PDF: Áp dụng từ 27/04/2026) ──────────────
const RATE_KG = [
  { min:0,    taiKho:6.5, taiNha:9   },   // tối thiểu 25kg
  { min:100,  taiKho:6.0, taiNha:8.5 },
  { min:300,  taiKho:4.5, taiNha:7   },
  { min:500,  taiKho:4,   taiNha:6   },
  { min:700,  taiKho:3.5, taiNha:5.5 },
  { min:1000, taiKho:3,   taiNha:4.8 },
  { min:1500, taiKho:null, taiNha:null }, // ≥1500kg: liên hệ báo giá
];
const RATE_CBM = [
  { min:1, taiKho:700, taiNha:950 },      // 1–<3 CBM
  { min:3, taiKho:600, taiNha:850 },      // ≥3 CBM
];
// Nệm Kim Đan (bao size): phí cố định / kiện, KHÔNG phải rate CBM
const NEM_KIMDAN_RATE = { taiKho:700, taiNha:950 };
const WOODEN_CRATE_RATE = 55; // $/m³ — PDF 27/04/2026

// Mức tối thiểu theo PDF: hàng lẻ "Tối thiểu từ 25kg", bảng CBM bắt đầu từ 1 CBM
const MIN_LE_KG  = 25;
const MIN_PAL_CBM = 1;
// PDF: đơn giá trị trên $2000 mới áp thuế nhập khẩu (nếu có)
const DUTY_THRESHOLD_CAD = 2000;

// ── THÔNG TIN THANH TOÁN ──
// Đọc từ biến môi trường (xem .env.example) để số tài khoản không nằm trong repo.
// Vite nhúng giá trị vào bundle lúc build, nên phải khai báo trên Railway TRƯỚC khi deploy.
// Thiếu biến nào sẽ hiện "(chưa cấu hình …)" để nhân viên phát hiện ngay thay vì in báo giá trống.
const envOr = (val, label) => (val && String(val).trim()) || `(chưa cấu hình ${label})`;
const PAY = {
  email:   envOr(import.meta.env.VITE_PAY_EMAIL,    "email CAD"),
  bank:    envOr(import.meta.env.VITE_BANK_NAME,    "tên ngân hàng"),
  holder:  envOr(import.meta.env.VITE_BANK_HOLDER,  "chủ tài khoản"),
  account: envOr(import.meta.env.VITE_BANK_ACCOUNT, "số tài khoản"),
};

// ── QR CHUYỂN KHOẢN (VietQR) ──
// Giống app Air: ảnh QR lấy từ img.vietqr.io. Cần mã ngân hàng riêng (vd "MB")
// vì VITE_BANK_NAME là tên hiển thị cho người đọc, không phải mã VietQR.
const BANK_CODE = (import.meta.env.VITE_BANK_CODE || "").trim();
const RAW_ACCOUNT = (import.meta.env.VITE_BANK_ACCOUNT || "").trim();
// VietQR cần tên chủ TK không dấu; "đ/Đ" không tách được bằng NFD nên xử lý riêng
const noAccent = (s) => (s || "")
  .replace(/đ/g, "d").replace(/Đ/g, "D")
  .normalize("NFD").replace(/\p{Diacritic}/gu, "");
const QR_SRC = BANK_CODE && RAW_ACCOUNT
  ? `https://img.vietqr.io/image/${encodeURIComponent(BANK_CODE)}-${encodeURIComponent(RAW_ACCOUNT)}-compact2.png`
    + `?accountName=${encodeURIComponent(noAccent(import.meta.env.VITE_BANK_HOLDER))}`
  : null;
// Số dòng tối đa nhập được (thùng hàng lẻ / pallet), dùng cho cả nút "+ Thêm" và dán từ Excel
const MAX_ROWS = 50;
// Trọng lượng pallet trừ ra khi tính theo KG (quy ước nội bộ, không có trong PDF)
const PALLET_TARE_KG = 20;

// Cân tính phí làm tròn LÊN theo bước 0.5kg (18.23 → 18.5, không phải 18).
// Epsilon để số chia chẵn không bị đẩy lên bậc trên do sai số dấu phẩy động.
const roundUp05 = (v) => Math.ceil(v * 2 - 1e-9) / 2;
// Số khối làm tròn LÊN 2 chữ số thập phân, cùng nguyên tắc với cân tính phí
const roundUp2 = (v) => Math.ceil(v * 100 - 1e-9) / 100;
// Cộng các số đã tròn 2 chữ số: chỉ để khử sai số dấu phẩy động (0.84×3 = 2.5199…)
const round2 = (v) => Math.round(v * 100) / 100;

// Định dạng tiền tệ: CAD làm tròn đến đơn vị ($), VNĐ làm tròn đến hàng nghìn
const fmtCAD = (v) => Math.round(v || 0).toLocaleString("en-US");
const fmtVND = (v) => (Math.round((v || 0) / 1000) * 1000).toLocaleString("vi-VN");

function lookupRate(table, value, delivery) {
  if (!value && value !== 0) return null;
  const col = delivery === "Tại kho" ? "taiKho" : "taiNha";
  let result = null;
  for (const t of table) {
    if (value >= t.min) result = t[col];
  }
  return result;
}

const G = {
  primary:"#16a34a", dark:"#15803d", mid:"#22c55e",
  light:"#dcfce7", xlight:"#f0fdf4", border:"#bbf7d0",
  muted:"#6b7280", mutedLight:"#9ca3af",
  bg:"#f8fafc", bgcard:"#ffffff", bgborder:"#e2e8f0",
  text:"#111827", textSub:"#374151", textMuted:"#6b7280",
};

const mkLe  = (id) => ({ id, l:"", w:"", h:"", actual:"" });
const mkPal = (id) => ({ id, l:"", w:"", h:"", actual:"" });

// ── PRINT VIEW ───────────────────────────────────────────
function PrintView({ data, onClose }) {
  const { mode, delivery, r1, r3, avgRate,
    leBoxes, totalLeKG, leBillKG, leMinApplied, leQuoteOnly,
    leRate, leShipCAD, leTotalCAD, leTotalVND,
    palBoxes, totalCBM, palBillCBM, palMinCBMApplied, palKGQuoteOnly,
    totalPalKG, palRateCBM, palRateKG,
    palShipCBM_CAD, palShipKG_CAD,
    palTotalCBM_CAD, palTotalKG_CAD, woodenFee,
    palTotalCBM_wood_CAD, palTotalKG_wood_CAD,
    palTotalCBM_VND, palTotalKG_VND,
    palTotalCBM_wood_VND, palTotalKG_wood_VND,
    includeWooden, palPrintMethod,
    surcharges = [],
    taxPctNum = 0, dutyCAD = 0,
    discountAmt = 0, discountNote = "",
  } = data;
  const surchargeRows = surcharges.filter(s => parseFloat(s.amount) > 0);

  const isPrintCBM = palPrintMethod === "cbm";
  const palPrintCAD = isPrintCBM
    ? (includeWooden ? palTotalCBM_wood_CAD : palTotalCBM_CAD)
    : (includeWooden ? palTotalKG_wood_CAD  : palTotalKG_CAD);
  const palPrintVND = isPrintCBM
    ? (includeWooden ? palTotalCBM_wood_VND : palTotalCBM_VND)
    : (includeWooden ? palTotalKG_wood_VND  : palTotalKG_VND);
  const palPrintShipCAD = isPrintCBM ? palShipCBM_CAD : palShipKG_CAD;
  const palPrintQty  = isPrintCBM ? `${palBillCBM.toFixed(2)} CBM` : `${totalPalKG.toFixed(1)} kg`;
  const palPrintRate = isPrintCBM ? palRateCBM : palRateKG;
  const palPrintRateLabel = palPrintRate
    ? (isPrintCBM ? `$${palPrintRate}/CBM` : `$${palPrintRate}/kg`)
    : "Liên hệ báo giá";
  // Bản in gửi khách: ≥1500kg thì phải ghi "Liên hệ báo giá", không được in $0
  const palPrintQuoteOnly = !isPrintCBM && palKGQuoteOnly;

  // Có dữ liệu thật để hiển thị bảng kích thước?
  const leDataRows = leBoxes.filter(b => b.chargeable !== null);
  const palDataRows = palBoxes.filter(b => b.cbm > 0 || b.act > 0);
  const hasLeData = leDataRows.length > 0;
  const hasPalData = palDataRows.length > 0;

  // Đánh số section động (ẩn bảng kích thước thì các section sau dồn lại)
  const showDimsSection = mode==="le" ? hasLeData : hasPalData;
  const N_DIMS = showDimsSection ? 1 : 0;
  const N_COST = showDimsSection ? 2 : 1;
  const N_PAY  = showDimsSection ? 3 : 2;

  const today = new Date().toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit",year:"numeric"});
  const th = {background:"#16a34a",color:"#fff",padding:"5px 8px",fontWeight:600,fontSize:10,textAlign:"center",border:"1px solid #15803d",fontFamily:"Arial,sans-serif"};
  const td = {padding:"4px 8px",border:"1px solid #d0d0d0",fontSize:10.5,fontFamily:"Arial,sans-serif",color:"#222"};
  const tdR = {...td,textAlign:"right"};
  const tdC = {...td,textAlign:"center"};

  return createPortal(
    <div id="print-root" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:1000,overflowY:"auto",padding:"24px 0"}}>
      <style>{`
        @media print {
          html,body{background:#fff!important;margin:0!important;height:auto!important;max-height:none!important;overflow:visible!important}
          body>*{display:none!important}
          /* PHẢI là static: phần tử position:fixed bị kẹp trong 1 trang khi in,
             đơn nhiều thùng sẽ bị cắt mất phần thừa thay vì ngắt sang trang sau */
          #print-root{display:block!important;position:static!important;
            inset:auto!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important;
            width:auto!important;height:auto!important;max-height:none!important;
            overflow:visible!important;z-index:auto!important;background:#fff!important;padding:0!important}
          #print-area{display:block!important;position:static!important;width:100%!important;max-width:100%!important;padding:14px 24px!important;background:#fff!important;color:#111!important;font-family:Arial,sans-serif!important}
          #print-area *{font-family:Arial,sans-serif!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
          .no-print{display:none!important}
          /* Đơn nhiều thùng tràn sang trang sau: giữ dòng không bị cắt ngang,
             lặp header bảng ở mỗi trang, không để tiêu đề mục trơ cuối trang */
          #print-area table{page-break-inside:auto}
          #print-area thead{display:table-header-group}
          #print-area tr{page-break-inside:avoid;break-inside:avoid}
          #print-area h1,#print-area h2{page-break-after:avoid}
          @page{margin:12mm 10mm}
        }
      `}</style>
      <div className="no-print" style={{maxWidth:760,margin:"0 auto 12px",display:"flex",justifyContent:"space-between",padding:"0 4px"}}>
        <button onClick={onClose} style={{padding:"8px 20px",borderRadius:8,border:"1px solid rgba(255,255,255,.3)",background:"rgba(255,255,255,.1)",color:"#fff",fontSize:13,cursor:"pointer",fontFamily:"Arial,sans-serif"}}>← Quay lại</button>
        <button onClick={()=>window.print()} style={{padding:"8px 24px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#22c55e,#15803d)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"Arial,sans-serif"}}>🖨️ In / Lưu PDF</button>
      </div>

      <div id="print-area" style={{fontFamily:"Arial,sans-serif",background:"#fff",color:"#111",padding:"22px 30px",maxWidth:760,margin:"0 auto",fontSize:11,lineHeight:1.5}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,paddingBottom:12,borderBottom:"3px solid #16a34a"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:54,height:54,background:"linear-gradient(135deg,#16a34a,#15803d)",borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:22,letterSpacing:-1,boxShadow:"0 2px 4px rgba(22,163,74,.25)",fontFamily:"Arial,sans-serif"}}>KD</div>
            <div>
              <div style={{fontSize:18,fontWeight:900,color:"#16a34a",letterSpacing:.5,lineHeight:1,fontFamily:"Arial,sans-serif"}}>KDEXPRESS</div>
              <div style={{fontSize:9,color:"#6b7280",letterSpacing:1.2,marginTop:3,fontWeight:600}}>VIỆT NAM → CANADA · VẬN CHUYỂN ĐƯỜNG BIỂN</div>
              <div style={{fontSize:9.5,color:"#555",marginTop:2}}>4450 Juneau St, Burnaby BC V5C 4C8 · Tel: 604-830-6360</div>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11.5,fontWeight:700,color:"#16a34a",letterSpacing:.5,textTransform:"uppercase"}}>Phụ lục tính phí</div>
            <div style={{fontSize:11,fontWeight:600,color:"#15803d",marginTop:2}}>{mode==="le"?"Hàng lẻ (LCL)":"Pallet (FCL/LCL)"}</div>
            <div style={{fontSize:10,color:"#666",marginTop:2}}>Giao: {delivery} · Ngày: {today}</div>
          </div>
        </div>

        {/* Hàng lẻ */}
        {mode==="le"&&(
          <>
            {hasLeData&&(
              <div style={{marginBottom:12}}>
                <PHead n={N_DIMS} title="Kích thước & Trọng lượng"/>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Thùng","Dài","Rộng","Cao","Cân thể tích (kg)","Cân thực tế (kg)","Cân tính phí (kg)"].map((h,i)=><th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {leDataRows.map((b,i)=>(
                      <tr key={b.id} style={{background:i%2===0?"#f0fdf4":"#fff"}}>
                        <td style={tdC}>T.{b.id}</td>
                        <td style={tdC}>{b.l||"—"}</td><td style={tdC}>{b.w||"—"}</td><td style={tdC}>{b.h||"—"}</td>
                        <td style={tdC}>{b.vol>0?b.vol.toFixed(2):"—"}</td>
                        <td style={tdC}>{b.act>0?b.act.toFixed(1):"—"}</td>
                        <td style={{...tdC,fontWeight:700,color:"#15803d"}}>{b.chargeable.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={{background:"#dcfce7"}}>
                      <td colSpan={6} style={{...td,fontWeight:700,textAlign:"right",color:"#15803d"}}>Tổng cân tính phí</td>
                      <td style={{...tdC,fontWeight:700,color:"#15803d"}}>{totalLeKG.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div style={{marginBottom:12}}>
              <PHead n={N_COST} title="Tổng hợp chi phí"/>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <tbody>
                  {totalLeKG>0&&<tr><td style={{...td,color:"#555"}}>Tổng cân tính phí</td><td style={tdR}>{totalLeKG.toFixed(2)} kg</td></tr>}
                  {leMinApplied&&<tr><td style={{...td,color:"#555"}}>Áp mức tối thiểu {MIN_LE_KG}kg</td><td style={tdR}>{leBillKG.toFixed(2)} kg</td></tr>}
                  {totalLeKG>0&&<tr><td style={{...td,color:"#555"}}>Rate ({delivery})</td><td style={tdR}>{leRate?`$${leRate}/kg`:"Liên hệ báo giá"}</td></tr>}
                  {leShipCAD>0&&<tr><td style={{...td,color:"#555"}}>Phí vận chuyển</td><td style={tdR}>${fmtCAD(leShipCAD)}</td></tr>}
                  {surchargeRows.map((s,i)=>(
                    <tr key={i}><td style={{...td,color:"#555"}}>+ {s.desc||"Phụ phí"}</td><td style={tdR}>${fmtCAD(parseFloat(s.amount))}</td></tr>
                  ))}
                  {dutyCAD>0&&(
                    <tr><td style={{...td,color:"#555"}}>+ Thuế nhập khẩu ({taxPctNum}%)</td><td style={tdR}>${fmtCAD(dutyCAD)}</td></tr>
                  )}
                  {discountAmt>0&&<tr><td style={{...td,color:"#c0392b"}}>− Giảm giá{discountNote?` (${discountNote})`:""}</td><td style={{...tdR,color:"#c0392b"}}>−${fmtCAD(discountAmt)}</td></tr>}
                  <tr style={{background:"#16a34a"}}><td style={{...td,border:"1px solid #15803d",fontWeight:700,color:"#fff"}}>TỔNG PHÍ (CAD)</td><td style={{...tdR,border:"1px solid #15803d",fontWeight:700,fontSize:12,color:"#fff"}}>{leQuoteOnly?"Liên hệ báo giá":`$${fmtCAD(leTotalCAD)}`}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Pallet */}
        {mode==="pallet"&&(
          <>
            {hasPalData&&(
              <div style={{marginBottom:12}}>
                <PHead n={N_DIMS} title="Thông tin Pallet"/>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Pallet","Dài (cm)","Rộng (cm)","Cao (cm)","Số khối (CBM)","Cân thực tế (kg)","Cân trừ Pallet (kg)"].map((h,i)=><th key={i} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {palDataRows.map((b,i)=>(
                      <tr key={b.id} style={{background:i%2===0?"#f0fdf4":"#fff"}}>
                        <td style={tdC}>P.{b.id}</td>
                        <td style={tdC}>{b.l||"—"}</td><td style={tdC}>{b.w||"—"}</td><td style={tdC}>{b.h||"—"}</td>
                        <td style={{...tdC,fontWeight:600}}>{b.cbm>0?b.cbm.toFixed(2):"—"}</td>
                        <td style={tdC}>{b.act>0?b.act.toFixed(1):"—"}</td>
                        <td style={{...tdC,color:b.net!==null&&b.net<0?"#c0392b":"#15803d",fontWeight:700}}>{b.net!==null?b.net.toFixed(1):"—"}</td>
                      </tr>
                    ))}
                    <tr style={{background:"#dcfce7"}}>
                      <td colSpan={4} style={{...td,fontWeight:700,textAlign:"right",color:"#15803d"}}>Tổng</td>
                      <td style={{...tdC,fontWeight:700,color:"#15803d"}}>{totalCBM>0?totalCBM.toFixed(2):"—"}</td>
                      <td style={tdC}/>
                      <td style={{...tdC,fontWeight:700,color:"#15803d"}}>{totalPalKG>0?totalPalKG.toFixed(1):"—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div style={{marginBottom:12}}>
              <PHead n={N_COST} title={`Chi phí vận chuyển · Tính theo ${isPrintCBM?"Số khối (CBM)":"Trọng lượng (KG)"}`}/>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <tbody>
                  {((isPrintCBM&&totalCBM>0)||(!isPrintCBM&&totalPalKG>0))&&(
                    <tr><td style={{...td,color:"#555"}}>{isPrintCBM?"Tổng số khối":"Tổng cân trừ pallet"}</td><td style={tdR}>{palPrintQty}</td></tr>
                  )}
                  {isPrintCBM&&palMinCBMApplied&&(
                    <tr><td style={{...td,color:"#555"}}>Áp mức tối thiểu {MIN_PAL_CBM} CBM (thực tế {totalCBM.toFixed(2)})</td><td style={tdR}>{palBillCBM.toFixed(2)} CBM</td></tr>
                  )}
                  {((isPrintCBM&&totalCBM>0)||(!isPrintCBM&&totalPalKG>0))&&(
                    <tr><td style={{...td,color:"#555"}}>Rate {isPrintCBM?"CBM":"KG"} ({delivery})</td><td style={tdR}>{palPrintRateLabel}</td></tr>
                  )}
                  {palPrintShipCAD>0&&(
                    <tr><td style={{...td,color:"#555"}}>Phí vận chuyển</td><td style={tdR}>${fmtCAD(palPrintShipCAD)}</td></tr>
                  )}
                  {includeWooden&&woodenFee>0&&(
                    <tr><td style={{...td,color:"#555"}}>Phí đóng kiện gỗ ({WOODEN_CRATE_RATE}$/CBM)</td><td style={tdR}>${fmtCAD(woodenFee)}</td></tr>
                  )}
                  {surchargeRows.map((s,i)=>(
                    <tr key={i}><td style={{...td,color:"#555"}}>+ {s.desc||"Phụ phí"}</td><td style={tdR}>${fmtCAD(parseFloat(s.amount))}</td></tr>
                  ))}
                  {dutyCAD>0&&(
                    <tr><td style={{...td,color:"#555"}}>+ Thuế nhập khẩu ({taxPctNum}%)</td><td style={tdR}>${fmtCAD(dutyCAD)}</td></tr>
                  )}
                  {discountAmt>0&&<tr><td style={{...td,color:"#c0392b"}}>− Giảm giá{discountNote?` (${discountNote})`:""}</td><td style={{...tdR,color:"#c0392b"}}>−${fmtCAD(discountAmt)}</td></tr>}
                  <tr style={{background:"#16a34a"}}>
                    <td style={{...td,border:"1px solid #15803d",fontWeight:700,color:"#fff"}}>TỔNG PHÍ (CAD)</td>
                    <td style={{...tdR,border:"1px solid #15803d",fontWeight:700,fontSize:12,color:"#fff"}}>{palPrintQuoteOnly?"Liên hệ báo giá":`$${fmtCAD(palPrintCAD)}`}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Payment — gộp Số tiền + Thông tin TT, 2 cột bằng nhau */}
        {(() => {
          const payCAD = mode==="le" ? leTotalCAD : palPrintCAD;
          const payVND = mode==="le" ? leTotalVND : palPrintVND;
          const payQuoteOnly = mode==="le" ? leQuoteOnly : palPrintQuoteOnly;
          return (
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                <PHead n={N_PAY} title="Thanh toán"/>
                <div style={{fontSize:9.5,color:"#888"}}>Tỷ giá: ({(parseFloat(r1)||0).toLocaleString("en-US")} + {(parseFloat(r3)||0).toLocaleString("en-US")}) ÷ 2 × 101.5% = <strong style={{color:"#15803d"}}>{avgRate.toFixed(0)}</strong></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {/* Cột CAD */}
                <div style={{border:"1.5px solid #bbf7d0",borderRadius:6,overflow:"hidden",background:"#fff",display:"flex",flexDirection:"column"}}>
                  <div style={{background:"#f0fdf4",padding:"6px 12px",borderBottom:"1px solid #bbf7d0",fontSize:10,fontWeight:700,color:"#15803d",letterSpacing:1,textTransform:"uppercase"}}>Thanh toán CAD</div>
                  <div style={{padding:"12px 14px",textAlign:"center",borderBottom:"1px solid #f0fdf4"}}>
                    <div style={{fontSize:payQuoteOnly?14:22,fontWeight:900,color:"#16a34a",letterSpacing:-.5,lineHeight:1.1}}>{payQuoteOnly?"Liên hệ báo giá":`$${fmtCAD(payCAD)}`}</div>
                  </div>
                  <div style={{padding:"10px 14px",fontSize:10.5,color:"#444",lineHeight:1.6,flex:1}}>
                    <div style={{color:"#888",marginBottom:3,fontSize:9.5,letterSpacing:.4,textTransform:"uppercase",fontWeight:600}}>Chuyển khoản NH Canada</div>
                    <div><strong style={{color:"#15803d"}}>{PAY.email}</strong></div>
                  </div>
                </div>
                {/* Cột VNĐ */}
                <div style={{border:"1.5px solid #bbf7d0",borderRadius:6,overflow:"hidden",background:"#fff",display:"flex",flexDirection:"column"}}>
                  <div style={{background:"#f0fdf4",padding:"6px 12px",borderBottom:"1px solid #bbf7d0",fontSize:10,fontWeight:700,color:"#15803d",letterSpacing:1,textTransform:"uppercase"}}>Thanh toán VNĐ</div>
                  <div style={{padding:"12px 14px",textAlign:"center",borderBottom:"1px solid #f0fdf4"}}>
                    <div style={{fontSize:payQuoteOnly?14:22,fontWeight:900,color:"#16a34a",letterSpacing:-.5,lineHeight:1.1}}>{payQuoteOnly?"Liên hệ báo giá":<>{fmtVND(payVND)} <span style={{fontSize:14,opacity:.7,color:"#16a34a"}}>₫</span></>}</div>
                  </div>
                  <div style={{padding:"10px 14px",fontSize:10.5,color:"#444",lineHeight:1.6,flex:1,display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:"#888",marginBottom:3,fontSize:9.5,letterSpacing:.4,textTransform:"uppercase",fontWeight:600}}>{PAY.bank}</div>
                      <div>Chủ TK: <strong style={{color:"#15803d"}}>{PAY.holder}</strong></div>
                      <div>Số TK: <strong style={{color:"#15803d"}}>{PAY.account}</strong></div>
                      {QR_SRC&&<div style={{fontSize:9.5,color:"#16a34a",marginTop:2}}>← Quét QR để chuyển khoản nhanh</div>}
                    </div>
                    {QR_SRC&&(
                      <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                        <div style={{background:"#fff",border:"2px solid #16a34a",borderRadius:7,padding:3,lineHeight:0}}>
                          {/* Ảnh VietQR là 540×640 (chân dung). Để height:auto giữ nguyên tỉ lệ —
                              ép vào ô vuông với object-fit:cover sẽ cắt mất đầu/chân ảnh
                              và thu nhỏ vùng mã quét được. */}
                          <img src={QR_SRC} alt={`QR chuyển khoản ${PAY.account}`} style={{width:86,height:"auto",display:"block",borderRadius:4}}/>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        <div style={{paddingTop:7,borderTop:"1px dashed #bbf7d0",display:"flex",justifyContent:"space-between",fontSize:9.5,color:"#aaa"}}>
          <div>KDEXPRESS · kdexpress.ca</div><div>Bảng giá Sea áp dụng từ 27/04/2026 · Đơn vị: CAD</div>
        </div>
      </div>
    </div>
  , document.body);
}
function PHead({n,title}){return<div style={{fontSize:11.5,fontWeight:700,color:"#16a34a",marginBottom:5,borderLeft:"3px solid #16a34a",paddingLeft:7,fontFamily:"Arial,sans-serif"}}>{n}. {title.toUpperCase()}</div>;}

// ── MAIN ─────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState("le");
  const [delivery, setDelivery] = useState("Tại nhà");
  const [includeWooden, setIncludeWooden] = useState(false);
  const [palPrintMethod, setPalPrintMethod] = useState("cbm");
  const [r1, setR1] = useState("18646");
  const [r3, setR3] = useState("18834");
  const [showPrint, setShowPrint] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteStatus, setPasteStatus] = useState(null);
  const [surcharges, setSurcharges] = useState([]);
  const [discount, setDiscount] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [invoices, setInvoices] = useState([{ value:"", cur:"CAD" }]);
  const [taxPct, setTaxPct] = useState("");
  const [overrideRate, setOverrideRate] = useState(false);
  const [ovLeKG, setOvLeKG] = useState("");
  const [ovPalCBM, setOvPalCBM] = useState("");
  const [ovPalKG, setOvPalKG] = useState("");

  const [leBoxes, setLeBoxes] = useState(()=>Array.from({length:5},(_,i)=>mkLe(i+1)));
  const [palBoxes, setPalBoxes] = useState(()=>Array.from({length:4},(_,i)=>mkPal(i+1)));

  const updateLeBox = (idx,field,val)=>{const n=[...leBoxes];n[idx]={...n[idx],[field]:val};setLeBoxes(n);};
  const updatePalBox = (idx,field,val)=>{const n=[...palBoxes];n[idx]={...n[idx],[field]:val};setPalBoxes(n);};

  const totalSurcharge = surcharges.reduce((s,x)=>s+(parseFloat(x.amount)||0),0);
  const discountAmt = Math.max(0, parseFloat(discount)||0);

  // ── TỶ GIÁ (PDF: chỉ × 1.015 một lần) ──
  // Tính trước vì hóa đơn nhập bằng VNĐ cần quy đổi sang CAD để ra tiền thuế
  const rr1=parseFloat(r1)||0, rr3=parseFloat(r3)||0;
  const avgRate = ((rr1+rr3)/2)*1.015;

  // ── THUẾ NHẬP KHẨU ──
  const invoiceCalcs = invoices.map(iv=>{
    const val=parseFloat(iv.value)||0;
    const cad=iv.cur==="CAD" ? val : (avgRate>0 ? val/avgRate : 0);
    return {...iv,val,cad};
  });
  const totalInvoiceCAD = invoiceCalcs.reduce((s,x)=>s+x.cad,0);
  const taxPctNum = Math.max(0, parseFloat(taxPct)||0);
  const dutyCAD = totalInvoiceCAD * taxPctNum / 100;
  // Hóa đơn VNĐ không quy đổi được nếu chưa nhập tỷ giá
  const invoiceNeedsRate = avgRate<=0 && invoiceCalcs.some(x=>x.cur==="VND" && x.val>0);
  // PDF: "Tổng đơn hàng giá trị trên $2000 sẽ áp dụng thu thuế nhập khẩu (nếu có)"
  const overDutyThreshold = totalInvoiceCAD > DUTY_THRESHOLD_CAD;

  // ── HÀNG LẺ CALCS ──
  const leCalcs = leBoxes.map(b=>{
    const l=parseFloat(b.l)||0, w=parseFloat(b.w)||0, h=parseFloat(b.h)||0, act=parseFloat(b.actual)||0;
    const vol=l*w*h/6000;
    const hasData=l>0||act>0;
    // PDF: cân lớn hơn giữa cân thực tế và cân thể tích, làm tròn lên bước 0.5kg
    const chargeable=hasData?roundUp05(Math.max(vol,act)):null;
    return {...b,vol,act,chargeable};
  });
  const totalLeKG = leCalcs.reduce((s,b)=>s+(b.chargeable||0),0);
  const totalLeActual = leCalcs.reduce((s,b)=>s+b.act,0);
  // Rate ghi đè đặc biệt: nếu bật & nhập số hợp lệ thì dùng, không thì tra bảng
  const ovRate = (raw) => { const n = parseFloat(raw); return overrideRate && raw!=="" && !isNaN(n) ? n : null; };
  // PDF: "Tối thiểu từ 25kg" — đơn nhẹ hơn vẫn tính tiền theo 25kg
  const leBillKG = totalLeKG > 0 ? Math.max(totalLeKG, MIN_LE_KG) : 0;
  const leMinApplied = totalLeKG > 0 && totalLeKG < MIN_LE_KG;
  const leRate = ovRate(ovLeKG) ?? lookupRate(RATE_KG, leBillKG, delivery); // có thể null nếu ≥1500kg
  const leShipCAD = leRate ? leBillKG * leRate : 0;
  const leTotalCAD = Math.max(0, leShipCAD + totalSurcharge + dutyCAD - discountAmt);
  // ≥1500kg: PDF yêu cầu liên hệ báo giá → không được hiển thị tổng bằng tiền
  const leQuoteOnly = totalLeKG > 0 && !leRate;

  // ── PALLET CALCS ──
  const palCalcs = palBoxes.map(b=>{
    const l=parseFloat(b.l)||0, w=parseFloat(b.w)||0, h=parseFloat(b.h)||0, act=parseFloat(b.actual)||0;
    const cbm=roundUp2(l*w*h/1000000);
    // Pallet nhẹ hơn tare không được trừ ngược vào tổng cân của các pallet khác
    const net=act>0?Math.max(0,act-PALLET_TARE_KG):null;
    return {...b,cbm,act,net};
  });
  const totalCBM = round2(palCalcs.reduce((s,b)=>s+b.cbm,0));
  const totalPalKG = palCalcs.reduce((s,b)=>s+(b.net||0),0);
  // Bảng CBM bắt đầu từ 1 CBM → dưới 1 CBM vẫn tính tiền theo 1 CBM
  const palBillCBM = totalCBM > 0 ? Math.max(totalCBM, MIN_PAL_CBM) : 0;
  const palMinCBMApplied = totalCBM > 0 && totalCBM < MIN_PAL_CBM;
  const palRateCBM = ovRate(ovPalCBM) ?? lookupRate(RATE_CBM, palBillCBM, delivery);
  const palRateKG  = ovRate(ovPalKG)  ?? lookupRate(RATE_KG, totalPalKG, delivery); // null nếu ≥1500kg
  const palShipCBM_CAD = palRateCBM ? palRateCBM * palBillCBM : 0;
  const palShipKG_CAD  = palRateKG  ? palRateKG  * totalPalKG : 0;
  // ≥1500kg khi tính theo KG: phải liên hệ báo giá, không ra số tiền
  const palKGQuoteOnly = totalPalKG > 0 && !palRateKG;
  const woodenFee = WOODEN_CRATE_RATE * totalCBM;
  // Tổng (CAD) = phí ship + phụ phí + thuế nhập khẩu − giảm giá (+ kiện gỗ nếu có)
  const palTotalCBM_CAD = Math.max(0, palShipCBM_CAD + totalSurcharge + dutyCAD - discountAmt);
  const palTotalKG_CAD  = Math.max(0, palShipKG_CAD  + totalSurcharge + dutyCAD - discountAmt);
  const palTotalCBM_wood_CAD = Math.max(0, palShipCBM_CAD + totalSurcharge + dutyCAD + woodenFee - discountAmt);
  const palTotalKG_wood_CAD  = Math.max(0, palShipKG_CAD  + totalSurcharge + dutyCAD + woodenFee - discountAmt);

  // ── QUY ĐỔI VNĐ ──
  const leTotalVND = leTotalCAD * avgRate;
  const palTotalCBM_VND = palTotalCBM_CAD * avgRate;
  const palTotalKG_VND  = palTotalKG_CAD  * avgRate;
  const palTotalCBM_wood_VND = palTotalCBM_wood_CAD * avgRate;
  const palTotalKG_wood_VND  = palTotalKG_wood_CAD  * avgRate;

  // ── PASTE IMPORT ──
  // Unified format for BOTH modes: Dài · Rộng · Cao · Cân thực tế
  const handlePaste = (raw) => {
    const rows = raw.trim().split(/\r?\n/).filter(r=>r.trim());
    if(!rows.length){setPasteStatus({ok:false,err:"Không có dữ liệu"});return;}
    const parsed=[];
    for(const row of rows){
      const cols=row.split(/\t|,|;/).map(c=>c.trim().replace(",","."));
      const toNum=v=>{const n=parseFloat((v||"").replace(",","."));return isNaN(n)?"":String(n);};
      // Both modes: Dài | Rộng | Cao | Cân thực tế
      const [l,w,h,actual]=cols;
      parsed.push({l:toNum(l),w:toNum(w),h:toNum(h),actual:toNum(actual)});
    }
    const max = MAX_ROWS;
    const needed=Math.min(parsed.length,max);
    if(mode==="le"){
      setLeBoxes(prev=>{
        const next=prev.length>=needed?[...prev]:[...prev,...Array.from({length:needed-prev.length},(_,i)=>mkLe(prev.length+i+1))];
        parsed.slice(0,needed).forEach((p,i)=>{next[i]={...next[i],...p};});
        return next;
      });
    } else {
      setPalBoxes(prev=>{
        const next=prev.length>=needed?[...prev]:[...prev,...Array.from({length:needed-prev.length},(_,i)=>mkPal(prev.length+i+1))];
        parsed.slice(0,needed).forEach((p,i)=>{next[i]={...next[i],...p};});
        return next;
      });
    }
    setPasteStatus({ok:true,count:needed,skipped:parsed.length>max?parsed.length-max:0});
    setPasteText("");
  };

  const printData={
    mode,delivery,r1,r3,avgRate,
    leBoxes:leCalcs,totalLeKG,leBillKG,leMinApplied,leQuoteOnly,leRate,leShipCAD,leTotalCAD,leTotalVND,
    palBoxes:palCalcs,totalCBM,palBillCBM,palMinCBMApplied,palKGQuoteOnly,totalPalKG,palRateCBM,palRateKG,
    palShipCBM_CAD,palShipKG_CAD,
    palTotalCBM_CAD,palTotalKG_CAD,woodenFee,
    palTotalCBM_wood_CAD,palTotalKG_wood_CAD,
    palTotalCBM_VND,palTotalKG_VND,
    palTotalCBM_wood_VND,palTotalKG_wood_VND,
    includeWooden, palPrintMethod,
    surcharges, totalSurcharge,
    taxPctNum, dutyCAD,
    discountAmt, discountNote,
  };

  const activeTotal = mode==="le" ? leTotalCAD : Math.max(palTotalCBM_CAD,palTotalKG_CAD);
  // Đơn ≥1500kg có tổng $0 nhưng vẫn cần in được bản "Liên hệ báo giá"
  const canPrint = activeTotal>0 || (mode==="le" ? leQuoteOnly : palKGQuoteOnly);

  return (
    <>
      {showPrint&&<PrintView data={printData} onClose={()=>setShowPrint(false)}/>}
      <div style={{minHeight:"100vh",background:G.bg,fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",color:G.text}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
          *{box-sizing:border-box;margin:0;padding:0}
          input,select,textarea{outline:none;font-family:inherit}
          input:focus,select:focus,textarea:focus{border-color:#16a34a!important;box-shadow:0 0 0 3px rgba(22,163,74,.12)!important}
          ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}
          .ri:hover{background:#f8fafc!important}
          .nb{transition:all .15s;cursor:pointer}.nb:hover{opacity:.9;transform:translateY(-1px)}
          .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
          .tab-btn{transition:all .15s;cursor:pointer;border:none}
          .method-card{transition:all .2s;cursor:pointer;border-radius:12px;border:2px solid #e2e8f0;padding:14px 18px;background:#fff;}
          .method-card:hover{border-color:#86efac;background:#f0fdf4;}
          .method-card.active{border-color:#16a34a;background:#f0fdf4;box-shadow:0 0 0 3px rgba(22,163,74,.12);}
        `}</style>

        {/* Header */}
        <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",boxShadow:"0 1px 3px rgba(0,0,0,0.05)",padding:"0 24px",position:"sticky",top:0,zIndex:100}}>
          <div style={{maxWidth:1060,margin:"0 auto",display:"flex",alignItems:"center",gap:14,height:60}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,background:"linear-gradient(135deg,#16a34a,#15803d)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🚢</div>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:G.text,letterSpacing:-.3}}>KDEXPRESS</div>
                <div style={{fontSize:10,color:G.muted,letterSpacing:.3}}>Việt Nam → Canada · Vận chuyển đường biển</div>
              </div>
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
              {canPrint&&<button className="nb" onClick={()=>setShowPrint(true)}
                style={{padding:"7px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#16a34a,#15803d)",color:"#fff",fontSize:12,fontWeight:600}}>
                🖨️ Xem bản in
              </button>}
            </div>
          </div>
        </div>

        <div style={{maxWidth:1060,margin:"0 auto",padding:"20px 24px 44px"}}>

          {/* Mode + Delivery row */}
          <div className="card" style={{padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:6}}>
              {[{k:"le",label:"📦 Hàng lẻ (LCL)"},{k:"pallet",label:"🪵 Pallet (FCL/LCL)"}].map(({k,label})=>(
                <button key={k} className="tab-btn" onClick={()=>{setMode(k);setPasteStatus(null);setPasteText("");}}
                  style={{padding:"8px 18px",borderRadius:9,
                    background:mode===k?"#f0fdf4":"#f8fafc",
                    border:mode===k?"2px solid #16a34a":"2px solid #e2e8f0",
                    color:mode===k?G.primary:G.muted,fontSize:12,fontWeight:mode===k?700:500}}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.8}}>Hình thức giao</span>
              {["Tại nhà","Tại kho"].map(d=>(
                <button key={d} className="tab-btn" onClick={()=>setDelivery(d)}
                  style={{padding:"6px 14px",borderRadius:20,border:"none",
                    background:delivery===d?"linear-gradient(135deg,#16a34a,#15803d)":"#f1f5f9",
                    color:delivery===d?"#fff":G.muted,fontSize:11,fontWeight:600}}>
                  {d}
                </button>
              ))}
            </div>
            {mode==="pallet"&&(
              <div style={{display:"flex",alignItems:"center",gap:8,borderLeft:"1px solid #e2e8f0",paddingLeft:16}}>
                <span style={{fontSize:11,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.8}}>Đóng kiện gỗ</span>
                <button onClick={()=>setIncludeWooden(v=>!v)}
                  style={{padding:"4px 14px",borderRadius:20,border:"none",
                    background:includeWooden?"linear-gradient(135deg,#16a34a,#15803d)":"#f1f5f9",
                    color:includeWooden?"#fff":G.muted,fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .2s"}}>
                  {includeWooden?"✓ Có":"Không"}
                </button>
                {includeWooden&&<span style={{fontSize:11,color:G.primary}}>Rate: <strong>${WOODEN_CRATE_RATE}/CBM</strong></span>}
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",gap:8,borderLeft:"1px solid #e2e8f0",paddingLeft:16}}>
              <span style={{fontSize:11,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.8}}>Rate đặc biệt</span>
              <button onClick={()=>setOverrideRate(v=>!v)}
                style={{padding:"4px 14px",borderRadius:20,border:"none",
                  background:overrideRate?"linear-gradient(135deg,#ea580c,#c2410c)":"#f1f5f9",
                  color:overrideRate?"#fff":G.muted,fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .2s"}}>
                {overrideRate?"✓ Bật ghi đè":"Tắt"}
              </button>
            </div>
          </div>

          {/* Ghi đè rate đặc biệt */}
          {overrideRate&&(
            <div className="card" style={{padding:"14px 18px",marginBottom:14,border:"2px solid #fdba74",background:"linear-gradient(135deg,#fff7ed,#fff)"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:700,color:"#c2410c"}}>⚡ Ghi đè rate đặc biệt</span>
                <span style={{fontSize:10.5,color:G.muted}}>— nhập rate thủ công, sẽ thay cho rate tra bảng. Bỏ trống ô nào thì ô đó vẫn dùng rate bảng.</span>
              </div>
              {mode==="le"?(
                <div style={{display:"grid",gridTemplateColumns:"220px",gap:8}}>
                  <div>
                    <LLabel G={G}>Rate hàng lẻ ($/kg)</LLabel>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#c2410c",pointerEvents:"none"}}>$</span>
                      <input value={ovLeKG} onChange={e=>setOvLeKG(e.target.value)} placeholder="vd: 5.5"
                        style={{width:"100%",padding:"9px 12px 9px 24px",background:"#fff",border:"1.5px solid #fdba74",borderRadius:9,fontSize:14,fontWeight:600,color:"#c2410c"}}/>
                    </div>
                  </div>
                </div>
              ):(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,maxWidth:460}}>
                  <div>
                    <LLabel G={G}>Rate theo CBM ($/CBM)</LLabel>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#c2410c",pointerEvents:"none"}}>$</span>
                      <input value={ovPalCBM} onChange={e=>setOvPalCBM(e.target.value)} placeholder="vd: 650"
                        style={{width:"100%",padding:"9px 12px 9px 24px",background:"#fff",border:"1.5px solid #fdba74",borderRadius:9,fontSize:14,fontWeight:600,color:"#c2410c"}}/>
                    </div>
                  </div>
                  <div>
                    <LLabel G={G}>Rate theo KG ($/kg)</LLabel>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#c2410c",pointerEvents:"none"}}>$</span>
                      <input value={ovPalKG} onChange={e=>setOvPalKG(e.target.value)} placeholder="vd: 4.5"
                        style={{width:"100%",padding:"9px 12px 9px 24px",background:"#fff",border:"1.5px solid #fdba74",borderRadius:9,fontSize:14,fontWeight:600,color:"#c2410c"}}/>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rate table display */}
          <div className="card" style={{padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>
              Bảng giá đường biển · {delivery}
            </div>
            {mode==="le"&&(
              <div>
                <div style={{fontSize:10,color:G.primary,fontWeight:700,marginBottom:6}}>Hàng lẻ — theo KG <span style={{color:G.mutedLight,fontWeight:500,marginLeft:4}}>(tối thiểu 25kg)</span></div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {RATE_KG.map((t,i)=>{
                    const nextMin=RATE_KG[i+1]?.min;
                    const active=leBillKG>=t.min&&(nextMin===undefined||leBillKG<nextMin);
                    const rate=delivery==="Tại kho"?t.taiKho:t.taiNha;
                    return(
                      <div key={t.min} style={{padding:"6px 12px",borderRadius:8,background:active?"#f0fdf4":"#f8fafc",border:active?"1.5px solid #86efac":"1.5px solid #e2e8f0",transition:"all .15s"}}>
                        <div style={{fontSize:9.5,color:G.muted}}>{Math.max(t.min,MIN_LE_KG)}{nextMin?`–${nextMin}`:"+"} kg</div>
                        <div style={{fontSize:14,fontWeight:800,color:active?G.primary:G.mutedLight}}>{rate?`$${rate}/kg`:"Liên hệ"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {mode==="pallet"&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div>
                  <div style={{fontSize:10,color:G.primary,fontWeight:700,marginBottom:6}}>Theo CBM</div>
                  <div style={{display:"flex",gap:6}}>
                    {RATE_CBM.map((t,i)=>{
                      const nextMin=RATE_CBM[i+1]?.min;
                      const active=palBillCBM>=t.min&&(nextMin===undefined||palBillCBM<nextMin);
                      const rate=delivery==="Tại kho"?t.taiKho:t.taiNha;
                      return(
                        <div key={t.min} style={{padding:"6px 12px",borderRadius:8,background:active?"#f0fdf4":"#f8fafc",border:active?"1.5px solid #86efac":"1.5px solid #e2e8f0",transition:"all .15s"}}>
                          <div style={{fontSize:9.5,color:G.muted}}>{t.min}{nextMin?`–${nextMin}`:"+"} CBM</div>
                          <div style={{fontSize:14,fontWeight:800,color:active?G.primary:G.mutedLight}}>{rate?`$${rate}/CBM`:"Liên hệ"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:G.primary,fontWeight:700,marginBottom:6}}>Theo KG (cân trừ pallet)</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {RATE_KG.map((t,i)=>{
                      const nextMin=RATE_KG[i+1]?.min;
                      const active=totalPalKG>=t.min&&(nextMin===undefined||totalPalKG<nextMin);
                      const rate=delivery==="Tại kho"?t.taiKho:t.taiNha;
                      return(
                        <div key={t.min} style={{padding:"5px 9px",borderRadius:8,background:active?"#f0fdf4":"#f8fafc",border:active?"1.5px solid #86efac":"1.5px solid #e2e8f0",transition:"all .15s"}}>
                          <div style={{fontSize:9,color:G.muted}}>{t.min}{nextMin?`–${nextMin}`:"+"}</div>
                          <div style={{fontSize:13,fontWeight:800,color:active?G.primary:G.mutedLight}}>{rate?`$${rate}`:"Liên hệ"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── HÀNG LẺ ── */}
          {mode==="le"&&(
            <div>
              <div className="card" style={{padding:"14px 16px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.8}}>📋 Dán nhanh từ Excel</span>
                  <span style={{fontSize:11,color:G.mutedLight}}>— 4 cột: <strong style={{color:G.primary}}>Dài · Rộng · Cao · Cân thực tế</strong></span>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <textarea value={pasteText} onChange={e=>{setPasteText(e.target.value);setPasteStatus(null);}}
                    onPaste={e=>{const txt=e.clipboardData.getData("text");e.preventDefault();setPasteText(txt);setTimeout(()=>handlePaste(txt),0);}}
                    placeholder={"Ctrl+V để dán từ Excel\nVí dụ: 42\t55\t40\t21"}
                    rows={3} style={{flex:1,padding:"8px 10px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,color:G.text,fontSize:12,fontFamily:"monospace",resize:"vertical",lineHeight:1.6}}/>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <button onClick={()=>handlePaste(pasteText)} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#16a34a,#15803d)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>✓ Nhập</button>
                    <button onClick={()=>{setPasteText("");setPasteStatus(null);}} style={{padding:"7px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:12,cursor:"pointer"}}>Xóa</button>
                  </div>
                </div>
                {pasteStatus&&<div style={{marginTop:8,padding:"7px 12px",borderRadius:7,fontSize:11.5,fontWeight:500,background:pasteStatus.ok?"#f0fdf4":"#fff7ed",border:`1px solid ${pasteStatus.ok?"#86efac":"#fed7aa"}`,color:pasteStatus.ok?"#15803d":"#c2410c"}}>{pasteStatus.ok?`✓ Đã nhập ${pasteStatus.count} thùng${pasteStatus.skipped>0?` (bỏ qua ${pasteStatus.skipped} dòng)`:""}`:`⚠ ${pasteStatus.err}`}</div>}
              </div>

              <div className="card" style={{overflow:"hidden",marginBottom:14}}>
                <div style={{display:"grid",gridTemplateColumns:"44px 72px 72px 72px 100px 100px 110px",padding:"9px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                  {[null,"Dài (cm)","Rộng (cm)","Cao (cm)","Cân thể tích","Cân thực tế","Cân tính phí"].map((h,i)=>(
                    <div key={i} style={{fontSize:8.5,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.3,textAlign:"center",lineHeight:1.3}}>{h||""}</div>
                  ))}
                </div>
                {leCalcs.map((box,idx)=>(
                  <div key={box.id} className="ri" style={{display:"grid",gridTemplateColumns:"44px 72px 72px 72px 100px 100px 110px",padding:"7px 14px",borderBottom:idx<leBoxes.length-1?"1px solid #f8fafc":"none",alignItems:"center",background:"#fff"}}>
                    <div style={{fontSize:11.5,fontWeight:600,color:G.muted,textAlign:"center"}}>T.{box.id}</div>
                    {["l","w","h"].map(dim=>(
                      <div key={dim} style={{display:"flex",justifyContent:"center"}}>
                        <LTI value={leBoxes[idx][dim]} onChange={v=>updateLeBox(idx,dim,v)} placeholder="0" w={60} G={G}/>
                      </div>
                    ))}
                    <LTC val={box.vol>0?box.vol.toFixed(2)+" kg":null} G={G}/>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <LTI value={leBoxes[idx].actual} onChange={v=>updateLeBox(idx,"actual",v)} placeholder="0.0" w={80} G={G}/>
                    </div>
                    <LTC val={box.chargeable>0?box.chargeable.toFixed(2)+" kg":null} hi G={G}/>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"44px 72px 72px 72px 100px 100px 110px",padding:"10px 14px",background:"#f0fdf4",borderTop:"1px solid #bbf7d0"}}>
                  <div style={{fontSize:11,fontWeight:700,color:G.primary,gridColumn:"1/6"}}>TỔNG</div>
                  <LTC val={totalLeActual>0?totalLeActual.toFixed(2)+" kg":null} G={G}/>
                  <LTC val={totalLeKG>0?totalLeKG.toFixed(2)+" kg":null} hi G={G}/>
                </div>
              </div>

              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <button onClick={()=>{if(leBoxes.length<MAX_ROWS)setLeBoxes(b=>[...b,mkLe(b.length+1)]);}} disabled={leBoxes.length>=MAX_ROWS}
                  style={{padding:"8px 18px",borderRadius:9,border:"1.5px solid #86efac",background:leBoxes.length>=MAX_ROWS?"#f8fafc":"#f0fdf4",color:leBoxes.length>=MAX_ROWS?G.mutedLight:G.primary,fontSize:12,fontWeight:600,cursor:leBoxes.length>=MAX_ROWS?"not-allowed":"pointer"}}>
                  + Thêm thùng{leBoxes.length>=MAX_ROWS&&` (tối đa ${MAX_ROWS})`}
                </button>
                {leBoxes.length>1&&<button onClick={()=>setLeBoxes(b=>b.slice(0,-1))}
                  style={{padding:"8px 18px",borderRadius:9,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  − Xóa thùng cuối
                </button>}
                <div style={{marginLeft:"auto",fontSize:11,color:G.muted,alignSelf:"center"}}>{leBoxes.length} thùng · tối đa {MAX_ROWS}</div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:14}}>
                <LIC label="Tổng cân thực tế" value={totalLeActual>0?`${totalLeActual.toFixed(2)} kg`:"—"} G={G}/>
                <LIC label="Tổng cân tính phí" value={totalLeKG>0?`${totalLeKG.toFixed(2)} kg`:"—"} hi G={G}/>
                <LIC label={`Rate · ${delivery}`} value={leRate?`$${leRate}/kg`:totalLeKG>0?"Liên hệ":"—"} hi G={G}/>
                <LIC label={totalSurcharge>0||dutyCAD>0?`Tổng (CAD, gồm ${[totalSurcharge>0&&"phụ phí",dutyCAD>0&&"thuế"].filter(Boolean).join(" + ")})`:"Phí vận chuyển (CAD)"} value={leQuoteOnly?"Liên hệ báo giá":leTotalCAD>0?`$${fmtCAD(leTotalCAD)}`:"—"} hi G={G}/>
              </div>
              {leMinApplied&&(
                <div style={{marginTop:-6,marginBottom:14,padding:"8px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:11.5,color:"#c2410c"}}>
                  Tổng cân {totalLeKG.toFixed(2)}kg thấp hơn mức tối thiểu — tính phí theo <strong>{MIN_LE_KG}kg</strong> theo bảng giá.
                </div>
              )}
              {leQuoteOnly&&(
                <div style={{marginTop:-6,marginBottom:14,padding:"8px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:11.5,color:"#c2410c"}}>
                  Đơn từ 1500kg — bảng giá yêu cầu <strong>liên hệ để được báo giá</strong>. Nhập rate ở phần "Rate ghi đè" nếu đã có giá riêng.
                </div>
              )}
            </div>
          )}

          {/* ── PALLET ── */}
          {mode==="pallet"&&(
            <div>
              <div className="card" style={{padding:"14px 16px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.8}}>📋 Dán nhanh từ Excel</span>
                  <span style={{fontSize:11,color:G.mutedLight}}>— 4 cột: <strong style={{color:G.primary}}>Dài · Rộng · Cao · Cân thực tế</strong></span>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <textarea value={pasteText} onChange={e=>{setPasteText(e.target.value);setPasteStatus(null);}}
                    onPaste={e=>{const txt=e.clipboardData.getData("text");e.preventDefault();setPasteText(txt);setTimeout(()=>handlePaste(txt),0);}}
                    placeholder={"Ctrl+V để dán từ Excel\nVí dụ: 100\t100\t100\t250"}
                    rows={3} style={{flex:1,padding:"8px 10px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,color:G.text,fontSize:12,fontFamily:"monospace",resize:"vertical",lineHeight:1.6}}/>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <button onClick={()=>handlePaste(pasteText)} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#16a34a,#15803d)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>✓ Nhập</button>
                    <button onClick={()=>{setPasteText("");setPasteStatus(null);}} style={{padding:"7px 16px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:12,cursor:"pointer"}}>Xóa</button>
                  </div>
                </div>
                {pasteStatus&&<div style={{marginTop:8,padding:"7px 12px",borderRadius:7,fontSize:11.5,fontWeight:500,background:pasteStatus.ok?"#f0fdf4":"#fff7ed",border:`1px solid ${pasteStatus.ok?"#86efac":"#fed7aa"}`,color:pasteStatus.ok?"#15803d":"#c2410c"}}>{pasteStatus.ok?`✓ Đã nhập ${pasteStatus.count} pallet${pasteStatus.skipped>0?` (bỏ qua ${pasteStatus.skipped} dòng)`:""}`:`⚠ ${pasteStatus.err}`}</div>}
              </div>

              <div className="card" style={{overflow:"hidden",marginBottom:14}}>
                <div style={{display:"grid",gridTemplateColumns:"50px 80px 80px 80px 100px 110px 120px",padding:"9px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                  {[null,"Dài (cm)","Rộng (cm)","Cao (cm)","Số khối (CBM)","Cân thực tế (kg)","Cân trừ Pallet (kg)"].map((h,i)=>(
                    <div key={i} style={{fontSize:8.5,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:.3,textAlign:"center",lineHeight:1.3}}>{h||""}</div>
                  ))}
                </div>
                {palCalcs.map((box,idx)=>(
                  <div key={box.id} className="ri" style={{display:"grid",gridTemplateColumns:"50px 80px 80px 80px 100px 110px 120px",padding:"7px 14px",borderBottom:idx<palBoxes.length-1?"1px solid #f8fafc":"none",alignItems:"center",background:"#fff"}}>
                    <div style={{fontSize:11.5,fontWeight:600,color:G.muted,textAlign:"center"}}>P.{box.id}</div>
                    {["l","w","h"].map(dim=>(
                      <div key={dim} style={{display:"flex",justifyContent:"center"}}>
                        <LTI value={palBoxes[idx][dim]} onChange={v=>updatePalBox(idx,dim,v)} placeholder="0" w={68} G={G}/>
                      </div>
                    ))}
                    <LTC val={box.cbm>0?box.cbm.toFixed(2)+" m³":null} hi G={G}/>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <LTI value={palBoxes[idx].actual} onChange={v=>updatePalBox(idx,"actual",v)} placeholder="0" w={80} G={G}/>
                    </div>
                    <LTC val={box.net!==null?(box.net<0?`${box.net.toFixed(1)} kg (âm)`:box.net.toFixed(1)+" kg"):null} hi={box.net!==null&&box.net>=0} warn={box.net!==null&&box.net<0} G={G}/>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"50px 80px 80px 80px 100px 110px 120px",padding:"10px 14px",background:"#f0fdf4",borderTop:"1px solid #bbf7d0"}}>
                  <div style={{fontSize:11,fontWeight:700,color:G.primary,gridColumn:"1/5"}}>TỔNG</div>
                  <LTC val={totalCBM>0?totalCBM.toFixed(2)+" m³":null} hi G={G}/>
                  <div/>
                  <LTC val={totalPalKG>0?totalPalKG.toFixed(1)+" kg":null} hi G={G}/>
                </div>
              </div>

              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <button onClick={()=>{if(palBoxes.length<MAX_ROWS)setPalBoxes(b=>[...b,mkPal(b.length+1)]);}} disabled={palBoxes.length>=MAX_ROWS}
                  style={{padding:"8px 18px",borderRadius:9,border:"1.5px solid #86efac",background:palBoxes.length>=MAX_ROWS?"#f8fafc":"#f0fdf4",color:palBoxes.length>=MAX_ROWS?G.mutedLight:G.primary,fontSize:12,fontWeight:600,cursor:palBoxes.length>=MAX_ROWS?"not-allowed":"pointer",transition:"all .15s"}}>
                  + Thêm pallet{palBoxes.length>=MAX_ROWS&&` (tối đa ${MAX_ROWS})`}
                </button>
                {palBoxes.length>1&&<button onClick={()=>setPalBoxes(b=>b.slice(0,-1))}
                  style={{padding:"8px 18px",borderRadius:9,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .15s"}}>
                  − Xóa pallet cuối
                </button>}
                <div style={{marginLeft:"auto",fontSize:11,color:G.muted,alignSelf:"center"}}>{palBoxes.length} pallet · tối đa {MAX_ROWS}</div>
              </div>

              {/* Internal summary: both methods side by side */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
                {/* CBM */}
                <div style={{background:"linear-gradient(135deg,#f0fdf4,#dcfce7)",borderRadius:16,border:"1.5px solid #86efac",padding:18}}>
                  <div style={{fontSize:11,fontWeight:700,color:G.primary,textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Tính theo CBM</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <LIC label="Tổng CBM" value={totalCBM>0?`${totalCBM.toFixed(2)} m³`:"—"} G={G}/>
                    <LIC label={`Rate (${delivery})`} value={palRateCBM?`$${palRateCBM}/CBM`:"—"} hi G={G}/>
                  </div>
                  {palMinCBMApplied&&<div style={{marginBottom:8,padding:"8px 12px",background:"#fff7ed",borderRadius:8,border:"1px solid #fed7aa",fontSize:11.5,color:"#c2410c"}}>
                    Dưới mức tối thiểu — tính phí theo <strong>{MIN_PAL_CBM} CBM</strong> (thực tế {totalCBM.toFixed(2)})
                  </div>}
                  {includeWooden&&<div style={{marginBottom:8,padding:"8px 12px",background:"#fff7ed",borderRadius:8,border:"1px solid #fed7aa",fontSize:11.5,color:"#c2410c"}}>
                    + Kiện gỗ: ${fmtCAD(woodenFee)} ({WOODEN_CRATE_RATE}$/CBM × {totalCBM.toFixed(2)})
                  </div>}
                  <div style={{borderTop:"1px solid #86efac",paddingTop:10,textAlign:"center"}}>
                    <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:4}}>Tổng (CAD)</div>
                    <div style={{fontSize:32,fontWeight:900,color:G.primary}}>${fmtCAD(includeWooden?palTotalCBM_wood_CAD:palTotalCBM_CAD)}</div>
                    <div style={{fontSize:13,fontWeight:600,color:G.muted,marginTop:4}}>{fmtVND(includeWooden?palTotalCBM_wood_VND:palTotalCBM_VND)} ₫</div>
                  </div>
                </div>
                {/* KG */}
                <div style={{background:"linear-gradient(135deg,#f0fdf4,#dcfce7)",borderRadius:16,border:"1.5px solid #86efac",padding:18}}>
                  <div style={{fontSize:11,fontWeight:700,color:G.primary,textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Tính theo KG</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <LIC label="Cân trừ Pallet" value={totalPalKG>0?`${totalPalKG.toFixed(1)} kg`:"—"} G={G}/>
                    <LIC label={`Rate (${delivery})`} value={palRateKG?`$${palRateKG}/kg`:totalPalKG>0?"Liên hệ":"—"} hi G={G}/>
                  </div>
                  {palKGQuoteOnly&&<div style={{marginBottom:8,padding:"8px 12px",background:"#fff7ed",borderRadius:8,border:"1px solid #fed7aa",fontSize:11.5,color:"#c2410c"}}>
                    Từ 1500kg — bảng giá yêu cầu <strong>liên hệ để được báo giá</strong>
                  </div>}
                  {includeWooden&&<div style={{marginBottom:8,padding:"8px 12px",background:"#fff7ed",borderRadius:8,border:"1px solid #fed7aa",fontSize:11.5,color:"#c2410c"}}>
                    + Kiện gỗ: ${fmtCAD(woodenFee)} ({WOODEN_CRATE_RATE}$/CBM × {totalCBM.toFixed(2)})
                  </div>}
                  <div style={{borderTop:"1px solid #86efac",paddingTop:10,textAlign:"center"}}>
                    <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:2,marginBottom:4}}>Tổng (CAD)</div>
                    <div style={{fontSize:palKGQuoteOnly?18:32,fontWeight:900,color:G.primary}}>{palKGQuoteOnly?"Liên hệ báo giá":`$${fmtCAD(includeWooden?palTotalKG_wood_CAD:palTotalKG_CAD)}`}</div>
                    <div style={{fontSize:13,fontWeight:600,color:G.muted,marginTop:4}}>{palKGQuoteOnly?"—":`${fmtVND(includeWooden?palTotalKG_wood_VND:palTotalKG_VND)} ₫`}</div>
                  </div>
                </div>
              </div>

              {/* ── PRINT METHOD SELECTOR ── */}
              <div className="card" style={{padding:"18px 20px",marginBottom:14,border:"2px solid #86efac",background:"linear-gradient(135deg,#f0fdf4,#fff)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                  <div style={{width:28,height:28,background:"linear-gradient(135deg,#16a34a,#15803d)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>🖨️</div>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:G.text}}>Chọn cách tính để in báo giá gửi khách</div>
                    <div style={{fontSize:10.5,color:G.muted,marginTop:1}}>Bản in chỉ hiển thị 1 cách tính đã chọn — nội bộ vẫn xem được cả hai</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {/* CBM option */}
                  <div
                    className={`method-card ${palPrintMethod==="cbm"?"active":""}`}
                    onClick={()=>setPalPrintMethod("cbm")}
                    style={{position:"relative",border:palPrintMethod==="cbm"?"2px solid #16a34a":"2px solid #e2e8f0",background:palPrintMethod==="cbm"?"#f0fdf4":"#fff",boxShadow:palPrintMethod==="cbm"?"0 0 0 3px rgba(22,163,74,.1)":"none"}}>
                    {palPrintMethod==="cbm"&&(
                      <div style={{position:"absolute",top:10,right:10,width:20,height:20,background:"#16a34a",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700}}>✓</div>
                    )}
                    <div style={{fontSize:11,fontWeight:700,color:palPrintMethod==="cbm"?G.primary:G.muted,textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>📦 Theo CBM</div>
                    <div style={{fontSize:10.5,color:G.textMuted,marginBottom:10,lineHeight:1.5}}>Tính phí dựa trên thể tích<br/>(số khối m³)</div>
                    <div style={{borderTop:"1px solid",borderColor:palPrintMethod==="cbm"?"#86efac":"#e2e8f0",paddingTop:8}}>
                      <div style={{fontSize:10,color:G.muted,marginBottom:2}}>Sẽ in trên báo giá</div>
                      <div style={{fontSize:18,fontWeight:800,color:palPrintMethod==="cbm"?G.primary:G.mutedLight}}>${fmtCAD(includeWooden?palTotalCBM_wood_CAD:palTotalCBM_CAD)}</div>
                      <div style={{fontSize:11,color:G.muted,marginTop:1}}>{totalCBM>0&&palRateCBM?`${palBillCBM.toFixed(2)} CBM × ${palRateCBM}`:"—"}</div>
                    </div>
                  </div>
                  {/* KG option */}
                  <div
                    className={`method-card ${palPrintMethod==="kg"?"active":""}`}
                    onClick={()=>setPalPrintMethod("kg")}
                    style={{position:"relative",border:palPrintMethod==="kg"?"2px solid #16a34a":"2px solid #e2e8f0",background:palPrintMethod==="kg"?"#f0fdf4":"#fff",boxShadow:palPrintMethod==="kg"?"0 0 0 3px rgba(22,163,74,.1)":"none"}}>
                    {palPrintMethod==="kg"&&(
                      <div style={{position:"absolute",top:10,right:10,width:20,height:20,background:"#16a34a",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700}}>✓</div>
                    )}
                    <div style={{fontSize:11,fontWeight:700,color:palPrintMethod==="kg"?G.primary:G.muted,textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>⚖️ Theo KG</div>
                    <div style={{fontSize:10.5,color:G.textMuted,marginBottom:10,lineHeight:1.5}}>Tính phí dựa trên trọng lượng<br/>(cân trừ pallet)</div>
                    <div style={{borderTop:"1px solid",borderColor:palPrintMethod==="kg"?"#86efac":"#e2e8f0",paddingTop:8}}>
                      <div style={{fontSize:10,color:G.muted,marginBottom:2}}>Sẽ in trên báo giá</div>
                      <div style={{fontSize:palKGQuoteOnly?13:18,fontWeight:800,color:palPrintMethod==="kg"?G.primary:G.mutedLight}}>{palKGQuoteOnly?"Liên hệ báo giá":`${fmtCAD(includeWooden?palTotalKG_wood_CAD:palTotalKG_CAD)}`}</div>
                      <div style={{fontSize:11,color:G.muted,marginTop:1}}>{totalPalKG>0&&palRateKG?`${totalPalKG.toFixed(1)} kg × ${palRateKG}`:"—"}</div>
                    </div>
                  </div>
                </div>
                {canPrint&&(
                  <div style={{marginTop:12,padding:"10px 14px",background:"#fff",border:"1px solid #86efac",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{fontSize:11,color:G.muted}}>
                      Bản in gửi khách sẽ hiển thị:
                      <strong style={{color:G.primary,marginLeft:4}}>Tính theo {palPrintMethod==="cbm"?"CBM (Số khối)":"KG (Trọng lượng)"}</strong>
                    </div>
                    <button onClick={()=>setShowPrint(true)}
                      style={{padding:"7px 18px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#16a34a,#15803d)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                      🖨️ Xem trước bản in →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phụ phí thủ công */}
          <div className="card" style={{padding:"16px 20px",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:G.textSub}}>Phụ phí thủ công <span style={{fontSize:10.5,color:G.mutedLight,fontWeight:400,marginLeft:4}}>(CAD)</span></div>
                <div style={{fontSize:10.5,color:G.muted,marginTop:2}}>Theo PDF: Nệm Kim Đan, oversize, ≥22kg/≥32kg, vùng sâu xa, pallet nhựa/gỗ, vận chuyển nội thành, v.v.</div>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <button onClick={()=>{
                  const rate = delivery==="Tại kho"?NEM_KIMDAN_RATE.taiKho:NEM_KIMDAN_RATE.taiNha;
                  setSurcharges(s=>[...s,{desc:`Nệm Kim Đan (bao size) · ${delivery}`,amount:String(rate)}]);
                }}
                  style={{padding:"7px 12px",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:G.textSub,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>
                  + Nệm Kim Đan
                </button>
                <button onClick={()=>setSurcharges(s=>[...s,{desc:"",amount:""}])}
                  style={{padding:"7px 14px",borderRadius:8,border:"1.5px solid #86efac",background:"#f0fdf4",color:G.primary,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>
                  + Thêm phụ phí
                </button>
              </div>
            </div>
            {surcharges.length===0?(
              <div style={{padding:"10px 12px",background:"#f8fafc",border:"1px dashed #e2e8f0",borderRadius:8,fontSize:11,color:G.mutedLight,textAlign:"center"}}>
                Chưa có phụ phí — bấm <strong>+ Thêm phụ phí</strong> để nhập tay
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {surcharges.map((sc,idx)=>(
                  <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 140px 36px",gap:8,alignItems:"center"}}>
                    <input value={sc.desc} onChange={e=>{
                      const n=[...surcharges];n[idx]={...n[idx],desc:e.target.value};setSurcharges(n);
                    }} placeholder="Mô tả (vd: Oversize ≥122cm, Vùng Yukon, Pallet nhựa…)"
                      style={{padding:"8px 12px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,color:G.text}}/>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:G.muted,pointerEvents:"none"}}>$</span>
                      <input value={sc.amount} onChange={e=>{
                        const n=[...surcharges];n[idx]={...n[idx],amount:e.target.value};setSurcharges(n);
                      }} placeholder="0.00"
                        style={{width:"100%",padding:"8px 12px 8px 22px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,color:G.text,textAlign:"right"}}/>
                    </div>
                    <button onClick={()=>setSurcharges(s=>s.filter((_,i)=>i!==idx))} title="Xóa dòng"
                      style={{padding:"6px 0",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:14,cursor:"pointer"}}>×</button>
                  </div>
                ))}
              </div>
            )}
            {totalSurcharge>0&&(
              <div style={{marginTop:10,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:11,color:G.muted,textTransform:"uppercase",letterSpacing:.8,fontWeight:600}}>Tổng phụ phí</div>
                <div style={{fontSize:15,fontWeight:800,color:G.primary}}>${fmtCAD(totalSurcharge)} CAD</div>
              </div>
            )}
          </div>

          {/* Thuế nhập khẩu — giá trị hóa đơn × % thuế */}
          <div className="card" style={{padding:"16px 20px",marginBottom:14}}>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:600,color:G.textSub}}>Thuế nhập khẩu <span style={{fontSize:10.5,color:G.mutedLight,fontWeight:400,marginLeft:4}}>(Import duty)</span></div>
              <div style={{fontSize:10.5,color:G.muted,marginTop:2}}>Nhập giá trị từng hóa đơn, chọn đơn vị CAD hoặc VNĐ. Theo PDF: đơn trên ${DUTY_THRESHOLD_CAD} mới áp thuế nhập khẩu (nếu có).</div>
            </div>

            {/* Danh sách hóa đơn */}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {invoiceCalcs.map((iv,idx)=>(
                <div key={idx} style={{display:"grid",gridTemplateColumns:"22px 1fr 132px 150px 36px",gap:8,alignItems:"center"}}>
                  <div style={{fontSize:11,fontWeight:600,color:G.mutedLight,textAlign:"center"}}>{idx+1}</div>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:G.muted,pointerEvents:"none"}}>{iv.cur==="CAD"?"$":"₫"}</span>
                    <input value={iv.value} onChange={e=>{
                      const n=[...invoices];n[idx]={...n[idx],value:e.target.value};setInvoices(n);
                    }} placeholder={iv.cur==="CAD"?"0.00":"0"}
                      style={{width:"100%",padding:"8px 12px 8px 24px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,color:G.text,textAlign:"right"}}/>
                  </div>
                  {/* Chọn đơn vị — đơn vị đang chọn phát sáng */}
                  <div style={{display:"flex",gap:0,border:"1.5px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                    {["CAD","VND"].map(c=>{
                      const on=iv.cur===c;
                      return (
                        <button key={c} onClick={()=>{
                          const n=[...invoices];n[idx]={...n[idx],cur:c};setInvoices(n);
                        }} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",fontSize:11.5,fontWeight:on?800:500,
                          background:on?"linear-gradient(135deg,#16a34a,#15803d)":"#fff",
                          color:on?"#fff":G.mutedLight,
                          boxShadow:on?"0 0 8px rgba(22,163,74,.45)":"none",transition:"all .15s"}}>
                          {c==="CAD"?"CAD":"VNĐ"}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{fontSize:11,color:iv.cur==="VND"&&iv.val>0?G.primary:"#e2e8f0",textAlign:"right",fontWeight:600}}>
                    {iv.cur==="VND"&&iv.val>0?`≈ ${fmtCAD(iv.cad)}`:""}
                  </div>
                  {invoices.length>1?(
                    <button onClick={()=>setInvoices(v=>v.filter((_,i)=>i!==idx))} title="Xóa hóa đơn"
                      style={{padding:"6px 0",borderRadius:8,border:"1.5px solid #e2e8f0",background:"#fff",color:G.muted,fontSize:14,cursor:"pointer"}}>×</button>
                  ):<div/>}
                </div>
              ))}
            </div>

            {/* Thêm hóa đơn */}
            <button onClick={()=>setInvoices(v=>[...v,{value:"",cur:"CAD"}])}
              style={{marginTop:8,padding:"7px 14px",borderRadius:8,border:"1.5px solid #86efac",background:"#f0fdf4",color:G.primary,fontSize:11.5,fontWeight:600,cursor:"pointer"}}>
              + Thêm hóa đơn
            </button>

            {invoiceNeedsRate&&(
              <div style={{marginTop:8,padding:"8px 12px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:11.5,color:"#c2410c"}}>
                Có hóa đơn nhập bằng VNĐ nhưng chưa có tỷ giá — nhập tỷ giá VCB ở phần dưới để quy đổi.
              </div>
            )}

            {/* Tổng giá trị hóa đơn + % thuế */}
            <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #e2e8f0",display:"grid",gridTemplateColumns:"1fr 160px",gap:10,alignItems:"end"}}>
              <div>
                <LLabel G={G}>Tổng giá trị hóa đơn (CAD)</LLabel>
                <div style={{padding:"9px 13px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:14,fontWeight:700,color:totalInvoiceCAD>0?G.text:"#cbd5e1"}}>
                  {totalInvoiceCAD>0?`${fmtCAD(totalInvoiceCAD)}`:"—"}
                </div>
              </div>
              <div>
                <LLabel G={G}>Phần trăm thuế</LLabel>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:13,color:G.muted,pointerEvents:"none"}}>%</span>
                  <input value={taxPct} onChange={e=>setTaxPct(e.target.value)} placeholder="0"
                    style={{width:"100%",padding:"9px 28px 9px 13px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:9,fontSize:14,fontWeight:600,color:G.text,textAlign:"right"}}/>
                </div>
              </div>
            </div>

            {totalInvoiceCAD>0&&!overDutyThreshold&&(
              <div style={{marginTop:8,padding:"8px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,fontSize:11,color:G.muted}}>
                Giá trị hóa đơn chưa vượt ${DUTY_THRESHOLD_CAD} — theo PDF thường chưa bị thu thuế nhập khẩu. Vẫn tính nếu điền % thuế.
              </div>
            )}

            {/* Kết quả: giá trị thuế nhập khẩu */}
            <div style={{marginTop:10,padding:"12px 16px",background:dutyCAD>0?"linear-gradient(135deg,#f0fdf4,#dcfce7)":"#f8fafc",border:`1.5px solid ${dutyCAD>0?"#86efac":"#e2e8f0"}`,borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:11,color:G.muted,textTransform:"uppercase",letterSpacing:.8,fontWeight:600}}>Giá trị thuế nhập khẩu</div>
                {dutyCAD>0&&<div style={{fontSize:10.5,color:G.muted,marginTop:2}}>${fmtCAD(totalInvoiceCAD)} × {taxPctNum}% · đã cộng vào tổng chi phí</div>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:20,fontWeight:900,color:dutyCAD>0?G.primary:"#cbd5e1"}}>{dutyCAD>0?`${fmtCAD(dutyCAD)}`:"—"}</div>
                {dutyCAD>0&&avgRate>0&&<div style={{fontSize:11,fontWeight:600,color:G.muted}}>{fmtVND(dutyCAD*avgRate)} ₫</div>}
              </div>
            </div>
          </div>

          {/* Giảm giá (Discount) */}
          <div className="card" style={{padding:"16px 20px",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:G.textSub}}>Giảm giá <span style={{fontSize:10.5,color:G.mutedLight,fontWeight:400,marginLeft:4}}>(Discount · CAD)</span></div>
                <div style={{fontSize:10.5,color:G.muted,marginTop:2}}>Sale nhập số tiền giảm trực tiếp vào tổng phí (CAD). Tổng sẽ không xuống dưới $0.</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 160px",gap:8,alignItems:"center"}}>
              <input value={discountNote} onChange={e=>setDiscountNote(e.target.value)}
                placeholder="Lý do (vd: Khách quen, Combo, Khuyến mãi…)"
                style={{padding:"9px 12px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:8,fontSize:12,color:G.text}}/>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#c0392b",pointerEvents:"none"}}>−$</span>
                <input value={discount} onChange={e=>setDiscount(e.target.value)} placeholder="0"
                  style={{width:"100%",padding:"9px 12px 9px 28px",background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:8,fontSize:13,fontWeight:600,color:"#c0392b",textAlign:"right"}}/>
              </div>
            </div>
            {discountAmt>0&&(
              <div style={{marginTop:10,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:11,color:"#c0392b",textTransform:"uppercase",letterSpacing:.8,fontWeight:600}}>Đang giảm{discountNote?` · ${discountNote}`:""}</div>
                <div style={{fontSize:15,fontWeight:800,color:"#c0392b"}}>−${fmtCAD(discountAmt)} CAD</div>
              </div>
            )}
          </div>

          {/* Exchange rate */}
          <div className="card" style={{padding:20,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:G.textSub,marginBottom:12}}>Tỷ giá VCB & Quy đổi VNĐ</div>
            <div style={{fontSize:11,color:G.muted,marginBottom:12,padding:"7px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
              Công thức: <span style={{color:G.primary,fontWeight:600}}>$ CAD × (Cột 1 + Cột 3) ÷ 2 × 101.5%</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <div><LLabel G={G}>Tỷ giá VCB Cột 1</LLabel><LFI value={r1} onChange={setR1} placeholder="18646" G={G}/></div>
              <div><LLabel G={G}>Tỷ giá VCB Cột 3</LLabel><LFI value={r3} onChange={setR3} placeholder="18834" G={G}/></div>
              <div><LLabel G={G}>Tỷ giá thanh toán</LLabel>
                <div style={{padding:"10px 14px",background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:10,fontSize:15,fontWeight:800,color:G.primary}}>{avgRate>0?avgRate.toFixed(0):"—"}</div>
              </div>
            </div>
            {mode==="le"&&leTotalCAD>0&&!leQuoteOnly&&(
              <div style={{marginTop:14,padding:"20px 24px",background:"linear-gradient(135deg,#16a34a,#15803d)",borderRadius:14,textAlign:"center",boxShadow:"0 4px 12px rgba(22,163,74,0.25)"}}>
                <div style={{fontSize:11,color:"rgba(255,255,255,.8)",textTransform:"uppercase",letterSpacing:2,marginBottom:8}}>Số tiền thanh toán VNĐ</div>
                <div style={{fontSize:36,fontWeight:900,color:"#fff",letterSpacing:-1}}>{fmtVND(leTotalVND)}<span style={{fontSize:16,color:"rgba(255,255,255,.7)",marginLeft:6}}>₫</span></div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.6)",marginTop:6}}>${fmtCAD(leTotalCAD)} × {avgRate.toFixed(0)}</div>
              </div>
            )}
            <div style={{marginTop:12,padding:"11px 14px",background:"#f8fafc",borderRadius:9,border:"1px solid #e2e8f0",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,color:G.muted}}>
              <div><span style={{color:G.primary,fontWeight:600}}>CAD:</span> {PAY.email}</div>
              <div><span style={{color:G.primary,fontWeight:600}}>VNĐ ({PAY.bank}):</span> {PAY.account} · {PAY.holder}</div>
            </div>
          </div>

          {/* Print CTA */}
          {canPrint&&(
            <div onClick={()=>setShowPrint(true)}
              style={{padding:"16px 24px",background:"#fff",border:"2px dashed #86efac",borderRadius:14,cursor:"pointer",textAlign:"center",transition:"all .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#f0fdf4"}
              onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
              <div style={{fontSize:15}}>🖨️</div>
              <div style={{fontSize:13,fontWeight:700,color:G.primary,marginTop:3}}>Xem & In bản tính phí</div>
              <div style={{fontSize:11,color:G.muted,marginTop:2}}>
                Khổ A4 · Font Arial · Theme xanh KDEXPRESS{QR_SRC&&" · Có QR thanh toán"}
                {mode==="pallet"&&<span style={{marginLeft:4,color:G.primary,fontWeight:600}}>· In theo {palPrintMethod==="cbm"?"CBM":"KG"}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const LTI=({value,onChange,placeholder,w=66,G,hi})=>(<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:w,padding:"6px 8px",background:hi?"#f0fdf4":"#f8fafc",border:`1.5px solid ${hi?"#86efac":"#e2e8f0"}`,borderRadius:7,color:G.text,fontSize:12.5,textAlign:"center",transition:"all .15s"}}/>);
const LFI=({value,onChange,placeholder,G})=>(<input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",padding:"10px 13px",background:"#f8fafc",border:"1.5px solid #e2e8f0",borderRadius:10,color:G.text,fontSize:14,transition:"all .15s"}}/>);
const LLabel=({children,G})=><div style={{fontSize:10.5,fontWeight:600,color:G.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>{children}</div>;
const LTC=({val,hi,warn,G})=>{const c=hi?G.primary:warn?"#f59e0b":val?G.muted:"#e2e8f0";return<div style={{fontSize:12,fontWeight:val?600:400,color:c,textAlign:"center"}}>{val||"—"}</div>;};
const LIC=({label,value,hi,G})=>{const c=hi?G.primary:G.textSub;return(<div style={{padding:"11px 14px",background:hi?"#f0fdf4":"#fff",border:`1.5px solid ${hi?"#86efac":"#e2e8f0"}`,borderRadius:12}}><div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{label}</div><div style={{fontSize:16,fontWeight:800,color:c}}>{value}</div></div>);};