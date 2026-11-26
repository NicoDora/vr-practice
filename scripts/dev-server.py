"""로컬 개발 서버 (캐시 끔)

Quest 브라우저가 이전 파일을 캐시해 두면 수정한 내용이 바로 안 보이므로,
모든 응답에 캐시 금지 헤더를 붙여서 새로고침만 하면 최신 파일을 받게 한다.

사용법 (저장소 루트에서)
    python3 scripts/dev-server.py          # http://localhost:8000
    python3 scripts/dev-server.py 9000     # 포트 지정
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("", port), handler) as server:
        print(f"Serving {ROOT} at http://localhost:{port} (no-cache)", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
