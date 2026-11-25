from io import BytesIO
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

def build_hod_excel_report(state: dict) -> BytesIO:
    wb = Workbook()
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    sub_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    green_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    amber_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

    title_font = Font(name="Calibri", size=14, bold=True, color="22D3EE")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    green_font = Font(name="Calibri", size=10, bold=True, color="166534")
    red_font = Font(name="Calibri", size=10, bold=True, color="991B1B")
    amber_font = Font(name="Calibri", size=10, bold=True, color="92400E")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"), right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"), bottom=Side(style="thin", color="CBD5E1")
    )

    ws1 = wb.active
    ws1.title = "Batch Attendance Summary"
    ws1.merge_cells("A1:H1")
    ws1["A1"] = f"EDUPULSE — HOD EXECUTIVE ATTENDANCE & PERFORMANCE REPORT ({datetime.now().strftime('%d %b %Y, %I:%M %p')})"
    ws1["A1"].font = title_font
    ws1["A1"].fill = header_fill
    ws1["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws1.row_dimensions[1].height = 30

    headers_1 = ["Roll ID", "Student Name", "Program / Year", "Approval Status", "Face ID", "Overall Att %", "CGPA", "XP Points"]
    ws1.append(headers_1)
    for col_idx in range(1, len(headers_1) + 1):
        cell = ws1.cell(row=2, column=col_idx)
        cell.font = header_font
        cell.fill = sub_fill
        cell.alignment = Alignment(horizontal="center")

    for m in state.get("members", []):
        subjects = m.get("subjects", [])
        tot_att = sum(s.get("attended", 0) for s in subjects)
        tot_cls = sum(s.get("total", 0) for s in subjects)
        att_pct = round((tot_att / tot_cls) * 100, 1) if tot_cls else 0.0
        avg_score = sum(s.get("internal", 0) + s.get("midterm", 0) + s.get("assignments", 0) for s in subjects) / len(subjects) if subjects else 0.0
        cgpa = round(min(10.0, avg_score / 9.5), 2)

        ws1.append([m.get("id", ""), m.get("name", ""), m.get("year", ""), m.get("status", "pending").upper(),
                    "REGISTERED" if m.get("faceRegistered") else "PENDING", att_pct, cgpa, m.get("xp", 0)])
        r = ws1.max_row
        for c in range(1, 9):
            ws1.cell(row=r, column=c).border = thin_border
            if c != 2:
                ws1.cell(row=r, column=c).alignment = Alignment(horizontal="center")

        att_cell = ws1.cell(row=r, column=6)
        att_cell.number_format = '0.0"%"'
        att_cell.fill = red_fill if att_pct < 75.0 else green_fill
        att_cell.font = red_font if att_pct < 75.0 else green_font

        status_cell = ws1.cell(row=r, column=4)
        status_cell.fill = green_fill if m.get("status") == "approved" else amber_fill
        status_cell.font = green_font if m.get("status") == "approved" else amber_font

    ws2 = wb.create_sheet(title="Biometric Audit Log")
    ws2.append(["Date", "Timestamp", "Roll ID", "Student Name", "Subject", "Verification Result"])
    for c in range(1, 7):
        ws2.cell(row=1, column=c).font = header_font
        ws2.cell(row=1, column=c).fill = sub_fill

    for log in state.get("liveLogs", []) or [{"date": "-", "time": "-", "studentId": "-", "studentName": "No live scans yet", "subject": "-", "confidence": "-"}]:
        ws2.append([log.get("date", ""), log.get("time", ""), log.get("studentId", ""), log.get("studentName", ""), log.get("subject", ""), log.get("confidence", "")])

    ws3 = wb.create_sheet(title="Subject Breakdown")
    ws3.append(["Roll ID", "Student Name", "Code", "Subject", "Attended", "Total", "Att %", "Marks %"])
    for c in range(1, 9):
        ws3.cell(row=1, column=c).font = header_font
        ws3.cell(row=1, column=c).fill = sub_fill

    for m in state.get("members", []):
        for s in m.get("subjects", []):
            att_p = round((s["attended"] / s["total"]) * 100, 1) if s.get("total") else 0.0
            marks = s.get("internal", 0) + s.get("midterm", 0) + s.get("assignments", 0)
            ws3.append([m["id"], m["name"], s["code"], s["name"], s["attended"], s["total"], att_p, marks])

    for ws in [ws1, ws2, ws3]:
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=12)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 5, 38)

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output
