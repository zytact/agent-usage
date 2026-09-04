#!/usr/bin/env python3
import os
import pty
import select
import subprocess
import sys
import time

if len(sys.argv) < 3:
    sys.stderr.write("Usage: run-pty.py <output-file> <command> [args...]\n")
    raise SystemExit(2)

output_path = sys.argv[1]
master, slave = pty.openpty()
process = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = bytearray()
exit_sent = False
deadline = time.monotonic() + 30

while time.monotonic() < deadline:
    ready, _, _ = select.select([master], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            chunk = b""
        output.extend(chunk)
        if not exit_sent and b"Choose an action" in output:
            os.write(master, b"\x1b[B\x1b[B\x1b[B\x1b[B\r")
            exit_sent = True
    if process.poll() is not None:
        break
else:
    process.terminate()
    process.wait(timeout=5)
    sys.stderr.write("Timed out waiting for the CLI to exit.\n")

os.close(master)
with open(output_path, "wb") as output_file:
    output_file.write(output)

raise SystemExit(process.returncode)
