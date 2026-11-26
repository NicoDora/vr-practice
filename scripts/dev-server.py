"""로컬 개발 서버 (캐시 끔)

Quest 브라우저가 이전 파일을 캐시해 두면 수정한 내용이 바로 안 보이므로,
모든 응답에 캐시 금지 헤더를 붙여서 새로고침만 하면 최신 파일을 받게 한다.

사용법 (저장소 루트에서)
    python3 scripts/dev-server.py          # http://localhost:8000
    python3 scripts/dev-server.py 9000     # 포트 지정

ngrok은 localhost 대신 127.0.0.1로 연결한다. (localhost는 IPv6로도 연결을 시도하는데 이 서버는 IPv4만 받는다)
    ngrok http 127.0.0.1:8000
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


class DevServer(http.server.ThreadingHTTPServer):
    # 기본 대기열(5개)은 A-Painter처럼 파일 수십 개를 한꺼번에 요청하면 넘쳐서,
    # 넘친 연결이 거부되고 ngrok이 502/503을 돌려준다.
    request_queue_size = 128
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with DevServer(("", port), handler) as server:
        print(f"Serving {ROOT} at http://localhost:{port} (no-cache)", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
