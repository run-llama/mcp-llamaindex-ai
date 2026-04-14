#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
import base64
import os
import sys


def chunk_base64_file(file_path: str):
    with open(file_path, "rb") as f:
        content = f.read()
    encoded = base64.b64encode(content).decode("utf-8")
    root = f"base64/{os.path.basename(file_path)}/"
    os.makedirs(
        root,
        exist_ok=False,  # fail if the directory already exists
    )
    idx = 0
    counter = 0
    while idx < len(encoded):
        chunked = encoded[idx : idx + 5000]
        idx += 5000
        counter += 1
        with open(os.path.join(root, f"chunk_{counter}.txt"), "w") as f:
            f.write(chunked)
    print(f"Created {counter} total chunks at {root}")


def main() -> None:
    if len(sys.argv) < 2:
        print("The path of a file should be passed for this script to be used")
        sys.exit(1)
    chunk_base64_file(sys.argv[1])
    sys.exit(0)


if __name__ == "__main__":
    main()
