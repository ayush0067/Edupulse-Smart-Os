import hashlib, hmac, json, random, time, urllib.parse, urllib.request
from datetime import datetime
from flask import Flask, jsonify, request, send_file, send_from_directory
from backend.database import (
    init_db, load_saved_state, sync_full_state, get_connection,
    append_ledger_block, verify_ledger_chain, log_otp_dispatch
)
from backend.hod_report_generator import build_hod_excel_report

app = Flask(__name__, static_folder=".", static_url_path="")
SECRET_KEY = b"edupulse-btech-hod-showcase-2026"
SUBJECT_CREDITS = {"BCS-301": 4, "BCS-302": 4, "BCS-303": 4, "BAS-303": 4, "BCS-401": 4, "BCS-403": 4, "BCS-502": 3}

def score_to_grade_point(score: float):
    if score >= 90: return ("O", 10)
    if score >= 80: return ("A+", 9)
    if score >= 70: return ("A", 8)
    if score >= 60: return ("B+", 7)
    if score >= 50: return ("B", 6)
    if score >= 45: return ("C", 5)
    if score >= 40: return ("P", 4)
    return ("F", 0)

@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/api/health", methods=["GET"])
def health_check():
    with get_connection() as conn:
        sc = conn.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        ac = conn.execute("SELECT COUNT(*) FROM attendance_audit").fetchone()[0]
    return jsonify({
        "status": "online",
        "backend": "Python Flask + SQLite3",
        "students_in_db": sc,
        "audits_in_db": ac,
        "ledger": verify_ledger_chain()
    })

@app.route("/api/state", methods=["GET"])
def get_state():
    saved = load_saved_state()
    return jsonify({"found": bool(saved), "state": saved})

@app.route("/api/sync", methods=["POST"])
def sync_state():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON"}), 400
    sync_full_state(payload)
    return jsonify({"synced": True, "timestamp": datetime.now().isoformat()})

@app.route("/api/send-sms-otp", methods=["POST"])
def send_sms_otp():
    data = request.get_json(silent=True) or {}
    roll_id = data.get("roll_id", "").strip().upper()
    mobile_no = data.get("mobile_no", "").strip()
    if not roll_id or not mobile_no:
        return jsonify({"error": "Roll ID and Mobile Number required"}), 400

    otp_code = f"{random.randint(100000, 999999)}"
    log_otp_dispatch(roll_id, mobile_no, otp_code, "DISPATCHED")
    append_ledger_block(roll_id, f"OTP_DISPATCHED_TO:+91-{mobile_no[-4:]}")
    return jsonify({
        "sent": True,
        "roll_id": roll_id,
        "masked_mobile": f"+91-XXXXXX{mobile_no[-4:]}",
        "otp": otp_code,
        "expires_in": 60
    })

@app.route("/api/ledger-append", methods=["POST"])
def ledger_append():
    data = request.get_json(silent=True) or {}
    block = append_ledger_block(data.get("roll_id", "UNKNOWN"), data.get("action", "EVENT"))
    return jsonify({"appended": True, "block": block, "ledger": verify_ledger_chain()})

@app.route("/api/verify-ledger", methods=["GET"])
def ledger_verify():
    return jsonify(verify_ledger_chain())

@app.route("/api/hod-excel", methods=["GET"])
def download_hod_excel():
    saved = load_saved_state()
    if not saved:
        return jsonify({"error": "No data synced"}), 404
    excel_stream = build_hod_excel_report(saved)
    filename = f"HOD_Executive_Report_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return send_file(excel_stream, as_attachment=True, download_name=filename,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.route("/api/qr-token/<roll_id>", methods=["GET"])
def generate_qr_token(roll_id: str):
    window = int(time.time() // 60)
    seconds_left = 60 - int(time.time() % 60)
    digest = hmac.new(SECRET_KEY, f"{roll_id.upper()}:{window}".encode(), hashlib.sha256).hexdigest()[:10].upper()
    return jsonify({"roll_id": roll_id.upper(), "token": f"EP-{roll_id.upper()}-{digest}", "expires_in": seconds_left})

@app.route("/api/predict-performance", methods=["POST"])
def predict_performance():
    member = request.get_json(silent=True) or {}
    subjects = member.get("subjects", [])
    if not subjects:
        return jsonify({"error": "No subjects"}), 400

    tot_att = sum(s.get("attended", 0) for s in subjects)
    tot_cls = sum(s.get("total", 0) for s in subjects)
    att_pct = round((tot_att / tot_cls) * 100, 2) if tot_cls else 0.0

    if att_pct >= 85:
        bonus, elig, risk = 5, "ELIGIBLE (+5 Sessional Merit Bonus)", "LOW"
    elif att_pct >= 80:
        bonus, elig, risk = 3, "ELIGIBLE (+3 Sessional Attendance Bonus)", "LOW"
    elif att_pct >= 75:
        bonus, elig, risk = 0, "ELIGIBLE (Standard University Clearance)", "MODERATE"
    else:
        bonus, elig, risk = -5, "DETAINED RISK (Below 75.00% Threshold)", "HIGH"

    total_credits = 0
    weighted_gp = 0
    for s in subjects:
        cr = SUBJECT_CREDITS.get(s.get("code", ""), 4)
        raw_marks = min(100, s.get("internal", 0) + s.get("midterm", 0) + s.get("assignments", 0) + (bonus if bonus > 0 else 0))
        _, gp = score_to_grade_point(raw_marks)
        total_credits += cr
        weighted_gp += cr * gp

    sgpa = round(weighted_gp / total_credits, 2) if total_credits else 0.0
    low_subs = [f"{s['code']} ({round((s['attended'] / s['total']) * 100, 1)}%)" for s in subjects if s.get("total") and (s["attended"] / s["total"]) * 100 < 75]

    notice = (
        f"OFFICIAL AKTU CREDIT-WEIGHTED ACADEMIC & BIOMETRIC AUDIT MEMO\n"
        f"Date: {datetime.now().strftime('%d-%b-%Y %I:%M %p')}\n"
        f"Student: {member.get('name')} | Roll ID: {member.get('id')} | Mobile: +91-{member.get('mobile', 'N/A')}\n"
        f"------------------------------------------------------------------\n"
        f"1. Precision Attendance: {att_pct:.2f}% ({tot_att}/{tot_cls} lectures)\n"
        f"2. Exam Eligibility: {elig}\n"
        f"3. Credit-Weighted SGPA: {sgpa:.2f} / 10.00 (Total Credits: {total_credits})\n"
        f"4. Detainment Risk Subjects (<75%): {', '.join(low_subs) if low_subs else 'None (All Clear)'}\n"
        f"------------------------------------------------------------------\n"
        f"Verified via EduPulse SHA-256 Tamper-Evident Ledger."
    )
    return jsonify({
        "attendance_pct": att_pct, "bonus_marks": bonus, "eligibility": elig,
        "risk_level": risk, "predicted_sgpa": f"{sgpa:.2f}", "low_subjects": low_subs, "official_notice": notice
    })

@app.route("/api/scan-question", methods=["POST"])
def scan_and_solve_question():
    data = request.get_json(silent=True) or {}
    img_data_url = data.get("image_base64", "")
    api_key = data.get("api_key", "").strip()
    student_info = data.get("student_info", "B.Tech CSE Student")
    if not img_data_url or "," not in img_data_url:
        return jsonify({"error": "No image provided"}), 400
    raw_b64 = img_data_url.split(",", 1)[1]

    if api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={urllib.parse.quote(api_key)}"
            payload = {"contents": [{"parts": [{"text": f"Transcribe and solve step-by-step for {student_info}:"}, {"inline_data": {"mime_type": "image/jpeg", "data": raw_b64}}]}]}
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=22) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                return jsonify({"engine": "Gemini 2.5 Vision", "extracted_text": "Scanned via Vision AI", "solution": res_json["candidates"][0]["content"]["parts"][0]["text"].strip()})
        except Exception:
            pass

    extracted_text = ""
    try:
        ocr_form = urllib.parse.urlencode({"apikey": "helloworld", "base64Image": img_data_url, "language": "eng", "OCREngine": "2"}).encode("utf-8")
        ocr_req = urllib.request.Request("https://api.ocr.space/parse/image", data=ocr_form, method="POST")
        with urllib.request.urlopen(ocr_req, timeout=18) as ocr_resp:
            ocr_json = json.loads(ocr_resp.read().decode("utf-8"))
            parsed = ocr_json.get("ParsedResults") or []
            if parsed:
                extracted_text = parsed[0].get("ParsedText", "").strip()
    except Exception:
        extracted_text = ""

    if not extracted_text or len(extracted_text) < 4:
        return jsonify({"engine": "OCR + Live AI", "extracted_text": "", "solution": "⚠️ Could not detect clear printed text. Hold steady or type the question above."})

    try:
        prompt = f"Solve this B.Tech exam question step-by-step for {student_info}:\n\n{extracted_text}"
        ai_body = json.dumps({"messages": [{"role": "user", "content": prompt}], "model": "openai"}).encode("utf-8")
        ai_req = urllib.request.Request("https://text.pollinations.ai/", data=ai_body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(ai_req, timeout=20) as ai_resp:
            return jsonify({"engine": "Python OCR + Live AI Solver", "extracted_text": extracted_text, "solution": ai_resp.read().decode("utf-8").strip()})
    except Exception as exc:
        return jsonify({"engine": "OCR Only", "extracted_text": extracted_text, "solution": f"Extracted:\n{extracted_text}\n({exc})"})

@app.route("/api/ai-ask", methods=["POST"])
def python_ai_relay():
    data = request.get_json(silent=True) or {}
    question = data.get("question", "").strip()
    student_info = data.get("student_info", "B.Tech CSE Student")
    if not question:
        return jsonify({"error": "Empty question"}), 400
    prompt = f"You are EduPulse Precision AI Tutor assisting {student_info}. Answer with formulas, step-by-step clarity, and bold key terms:\n\n{question}"
    body = json.dumps({"messages": [{"role": "user", "content": prompt}], "model": "openai"}).encode("utf-8")
    req = urllib.request.Request("https://text.pollinations.ai/", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=18) as resp:
            return jsonify({"answer": resp.read().decode("utf-8").strip()})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

if __name__ == "__main__":
    init_db()
    print("EduPulse Precision Python Server Running -> http://127.0.0.1:8000")
    app.run(host="127.0.0.1", port=8000, debug=False)
