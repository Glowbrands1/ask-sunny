"""Stops the live sample's shards when its model cost reaches the cap (dev only; see run.sh)."""
import glob
import json
import subprocess
import sys
import time

# Opus prices per million tokens: input, output, cache read, cache write (src/lib/ai/model-prices.ts).
PRICES = (5, 25, 0.5, 6.25)


def cost(out: str) -> float:
    total = 0.0
    for path in glob.glob(f"{out}/run-*.jsonl"):
        for line in open(path):
            loop = json.loads(line).get("loop")
            if loop:
                total += sum(a * b for a, b in zip(loop["tokens"], PRICES)) / 1e6
    return total


def running() -> bool:
    return subprocess.run(["pgrep", "-f", "replay-pack-e2e.test.ts -t \\("], capture_output=True).returncode == 0


def main() -> None:
    out, cap = sys.argv[1], float(sys.argv[2])
    time.sleep(30)
    while running():
        spent = cost(out)
        if spent >= cap:
            subprocess.run(["pkill", "-f", "replay-pack-e2e.test.ts -t \\("])
            print(f"STOPPED at the cap: ${spent:.2f}")
            break
        time.sleep(20)
    print(f"model cost ${cost(out):.2f}")


main()
