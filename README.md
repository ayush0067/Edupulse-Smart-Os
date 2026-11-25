                                       <!--README.md--> 


# EduPulse Smart OS — Biometric Attendance, Predictive SGPA & AI Learning System

## 1. System Architecture
- **Frontend Layer**: HTML5, Glassmorphic CSS3, Chart.js, WebRTC MediaDevices API, Web Crypto SHA-256.
- **Backend Layer**: Python 3 Flask REST API (`server.py`), OpenPyXL Excel Engine (`backend/hod_report_generator.py`), Multimodal OCR & AI Vision Solver (`/api/scan-question`).
- **Database & Security Layer**: SQLite3 Relational Database (`edupulse.db`) with a SHA-256 Tamper-Evident Hash Chain (`audit_ledger`), 392-Dimensional 3-Pose Biometric Face ID with motion liveness detection, 60-second rotating HMAC-SHA256 QR tokens, and GPS Campus Geofencing.

## 2. Key Innovations Over Basic Attendance Systems
1. **Triple-Factor Anti-Proxy Attendance**: 3-Pose 392-D Face Recognition + Liveness Motion Detection + 60s HMAC-SHA256 QR Pass + GPS Campus Geofence.
2. **Irreversible Tamper-Proof Records**: Daily attendance and practice quiz answers lock permanently upon submission and are hashed into `audit_ledger`.
3. **Coordinator Approval Governance**: Students self-register (`status = pending`) and require Coordinator sign-off (`HOD-ADMIN`) before automatic sign-in is unlocked.
4. **Camera Question Scanner & Live AI Tutor**: Point the camera at any printed/written exam question to extract text via OCR/Vision and generate step-by-step solutions (+20 XP).
5. **AKTU Credit-Weighted SGPA & Excel Audit Export**: Automatically computes credit-weighted SGPA across 27 credits, models sessional attendance bonuses, and exports a 3-sheet styled `.xlsx` report.
