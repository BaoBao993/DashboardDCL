import os
import subprocess
import datetime
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

print("==========================================================")
print("     HỆ THỐNG CẬP NHẬT TỰ ĐỘNG DASHBOARD LÊN GITHUB      ")
print("==========================================================\n")

# Đường dẫn dự án
script_update = r"LDN PA\Vitality Compass\update_dashboard_data.py"
git_exe = r"C:\Program Files\Git\cmd\git.exe"

# 1. Cập nhật dữ liệu từ Google Sheets
print(">>> BƯỚC 1: Đang tải và tổng hợp dữ liệu mới từ Google Sheets...")
try:
    args_to_pass = sys.argv[1:]
    subprocess.run(["python", "-u", script_update] + args_to_pass, check=True)
    print("✓ Tổng hợp dữ liệu thành công!")
except subprocess.CalledProcessError as e:
    print("\n[LỖI] Không thể tổng hợp dữ liệu từ Google Sheets.")
    sys.exit(1)

# 2. Đẩy lên GitHub
print("\n>>> BƯỚC 2: Đang tải dữ liệu mới lên trang web GitHub...")
files_to_push = [
    r"LDN PA/Vitality Compass/operations_data.json",
    r"LDN PA/Operations_Insights.md",
    r"app.js",
    r"LDN PA/Vitality Compass/app.js",
    r"LDN PA/Vitality Compass/update_dashboard_data.py",
    r"index.html",
    r"LDN PA/Vitality Compass/index.html",
    r"styles.css",
    r"LDN PA/Vitality Compass/styles.css",
    r"operations_data.json"
]

try:
    # Git add
    print("  * Đang chuẩn bị tệp tin...")
    for file in files_to_push:
        if os.path.exists(file):
            # Dùng -f (force) để thêm các file đã được chỉ định rõ ràng, kể cả khi bị .gitignore chặn
            subprocess.run([git_exe, "add", "-f", file], check=True)

    # Git commit & push
    # Check if there are staged changes
    staged_check = subprocess.run([git_exe, "diff", "--cached", "--quiet"])
    if staged_check.returncode == 1:
        now_str = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        commit_msg = f"Auto-update data: {now_str}"
        print(f"  * Đang tạo bản ghi commit: '{commit_msg}'...")
        subprocess.run([git_exe, "commit", "-m", commit_msg], check=True)
    else:
        print("  * Không có thay đổi mới nào để tạo commit.")

    # Git push
    print("  * Đang truyền dữ liệu lên GitHub...")
    subprocess.run([git_exe, "push", "origin", "main"], check=True)

    print("\n==========================================================")
    print("🎉 CẬP NHẬT TRANG WEB THÀNH CÔNG!")
    print("👉 Chị hãy mở link web bên dưới và bấm F5 (Làm mới) để xem:")
    print("   https://BaoBao993.github.io/DashboardDCL/")
    print("==========================================================")
except Exception as e:
    print(f"\n[LỖI] Thất bại khi đẩy lên GitHub: {e}")
    sys.exit(1)
