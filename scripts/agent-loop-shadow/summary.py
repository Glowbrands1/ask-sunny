"""The shadow replay's numbers (QA, 14 Nov 2026; dev only, never CI; see run.sh).

    python3 scripts/agent-loop-shadow/summary.py SHADOW_OUT [RECORDS]

SHADOW_OUT is the JSON-lines file the replay wrote (one line per conversation: its turns, replies, the final card, the
manager's truth); RECORDS is the replay pack's REPLAY_RECORD files for the same run (the loop's calls and tokens), a
directory of run-*.jsonl, default the one run.sh writes beside SHADOW_OUT ("<SHADOW_OUT without .jsonl>.records"). It prints:
  - per field, the % of conversations with a truth whose final card matches it;
  - for conversations with no truth, how many got a card;
  - the guard flags (a level or payroll answer never typed, a past form brought up unasked, a person not on the roster
    carded without "use <name>");
  - model calls and cost per turn;
  - the worst 20 conversations by score, with the fields they missed (ids only: no manager words are printed).
`--json` prints the per-conversation rows as JSON lines instead, for a closer look on the private machine.
"""
import glob
import json
import os
import re
import sys

# Opus prices per million tokens: input, output, cache read, cache write (as costcap.py; src/lib/ai/model-prices.ts).
PRICES = (5, 25, 0.5, 6.25)
FIELDS = ("template", "employee", "date", "level", "policy")
LEVELS = {"verbal", "written"}
WORD = re.compile(r"[a-z0-9]{3,}")
STOP = {"the", "and", "for", "her", "his", "she", "was", "with", "that", "this", "they", "their", "from", "had", "has", "not", "but", "about"}


def norm(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def heading(policy):
    """The manual heading a card's Policy line names: before "—", "(", ", JBA" or "read from"."""
    text = norm(policy)
    text = re.split(r"\s+—\s+|\s+-\s+|\s*\(|,\s*jba|\s+read from|\s+p\.\d", text)[0]
    return text.strip(" .")


def tokens(text):
    return {word for word in WORD.findall(norm(text)) if word not in STOP}


def overlap(card_text, truth_text):
    """The share of the truth's words the card's Observation has (0-1); None when the truth has none."""
    truth = tokens(truth_text)
    if not truth:
        return None
    return len(truth & tokens(card_text)) / len(truth)


# truth.values (QA, 14 Nov 2026): the saved form's {field_key: value}; read when "policy" / "warning_type" are absent.
POLICY_KEYS = ("policy_violated", "policy", "policy_references", "policy_ref", "direct_policy")


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [part for part in re.split(r"[,;/]\s*|\s+and\s+", str(value)) if part.strip()]


def truth_policy(truth):
    if truth.get("policy") is not None:
        return truth.get("policy")
    values = truth.get("values") or {}
    return next((values[key] for key in POLICY_KEYS if values.get(key)), None)


def truth_levels(truth):
    if truth.get("warning_type") is not None:
        return as_list(truth.get("warning_type"))
    return as_list((truth.get("values") or {}).get("warning_type"))


def compare(final, truth):
    """Field -> True/False for a conversation with a truth (a missing card misses every field)."""
    card = final or {}
    want_levels = {str(level).strip().lower() for level in truth_levels(truth)} & LEVELS
    have_levels = {str(card.get("level")).lower()} & LEVELS if card.get("level") else set()
    truth_heading, card_heading = heading(truth_policy(truth)), heading(card.get("policy"))
    return {
        "template": bool(card) and card.get("template") == truth.get("template"),
        "employee": bool(card) and norm(card.get("employee")) == norm(truth.get("employee")),
        "date": bool(card) and (card.get("date") or None) == (truth.get("form_date") or None),
        "level": bool(card) and have_levels == want_levels,
        "policy": bool(card)
        and (
            (not truth_heading and not card_heading)
            or (bool(truth_heading) and bool(card_heading) and (truth_heading in card_heading or card_heading in truth_heading))
        ),
    }


ASKED_PAST = re.compile(r"\b(?:on file|past|previous|prior|before|history|last (?:ca|form|warning|coaching)|already (?:had|got))\b", re.I)
PAST_IN_REPLY = re.compile(r"On file in Form Monitoring|already on file|forms? on file|past forms?", re.I)
USE_NAME = re.compile(r"\buse\s+[a-z]", re.I)


def guards(record):
    said = "\n".join(turn["question"] for turn in record["turns"])
    flags = []
    final = record.get("final") or {}
    for turn in record["turns"]:
        card = turn.get("card") or {}
        if card.get("level") and not re.search(r"written|write" if card["level"] == "written" else card["level"], said, re.I):
            flags.append("level not typed")
        if card.get("payroll") and not re.search(r"payroll|deduct", said, re.I):
            flags.append("payroll not typed")
        if PAST_IN_REPLY.search(turn["reply"]) and not ASKED_PAST.search(said):
            flags.append("past form unasked")
    roster = {norm(name) for name in record.get("roster", [])}
    if final.get("employee") and norm(final["employee"]) not in roster and not USE_NAME.search(said):
        flags.append("off-roster carded")
    return sorted(set(flags))


def load(path):
    return [json.loads(line) for line in open(path) if line.strip()]


def main():
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(2)
    out = args[0]
    records_path = args[1] if len(args) > 1 else re.sub(r"\.jsonl$", "", out) + ".records"
    shadow = load(out)
    paths = sorted(glob.glob(os.path.join(records_path, "run-*.jsonl"))) if os.path.isdir(records_path) else [records_path] if os.path.exists(records_path) else []
    loop = {row["id"]: row.get("loop") for path in paths for row in load(path)}

    rows = []
    for record in shadow:
        truth = record.get("truth")
        fields = compare(record.get("final"), truth) if truth else None
        lap = overlap((record.get("final") or {}).get("observation"), truth.get("observation")) if truth else None
        parts = [1.0 if ok else 0.0 for ok in fields.values()] + ([lap] if lap is not None else []) if fields else []
        rows.append({
            "conv": record["conv"],
            "error": record.get("error"),
            "card": bool(record.get("final")),
            "fields": fields,
            "overlap": lap,
            "score": sum(parts) / len(parts) if parts else None,
            "guards": guards(record),
            "rating": record.get("rating"),
            "loop": loop.get(record["id"]),
        })

    if "--json" in sys.argv:
        for row in rows:
            print(json.dumps(row))
        return

    with_truth = [row for row in rows if row["fields"] is not None]
    without = [row for row in rows if row["fields"] is None]
    print(f"conversations {len(rows)}; with a truth {len(with_truth)}; without {len(without)}; turn errors {sum(bool(row['error']) for row in rows)}")
    if with_truth:
        print("match over the conversations with a truth:")
        for field in FIELDS:
            hits = sum(row["fields"][field] for row in with_truth)
            print(f"  {field:<9} {hits}/{len(with_truth)} ({hits / len(with_truth):.0%})")
        laps = [row["overlap"] for row in with_truth if row["overlap"] is not None]
        if laps:
            print(f"  observation word overlap: mean {sum(laps) / len(laps):.2f} over {len(laps)}")
    if without:
        carded = sum(row["card"] for row in without)
        print(f"without a truth: card proposed {carded}, none {len(without) - carded}")
    flagged = {}
    for row in rows:
        for flag in row["guards"]:
            flagged.setdefault(flag, []).append(row["conv"])
    print("guard flags:" + ("" if flagged else " none"))
    for flag, convs in sorted(flagged.items()):
        print(f"  {flag}: {len(convs)} ({', '.join(convs[:10])}{' …' if len(convs) > 10 else ''})")

    loops = [row["loop"] for row in rows if row["loop"]]
    turns = sum(entry["turns"] for entry in loops)
    calls = sum(entry["model_calls"] for entry in loops)
    tokens = [sum(entry["tokens"][index] for entry in loops) for index in range(4)]
    cost = sum(a * b for a, b in zip(tokens, PRICES)) / 1e6
    if turns:
        print(f"loop turns {turns}; model calls per turn {calls / turns:.2f}; cost per turn ${cost / turns:.4f}; total ${cost:.2f}")
    else:
        print("no loop records (pass the records directory or REPLAY_RECORD file as the second argument)")

    worst = sorted((row for row in with_truth), key=lambda row: (row["score"], row["conv"]))[:20]
    if worst:
        print("worst 20 (score, missed fields, overlap, guards):")
        for row in worst:
            missed = [field for field, ok in row["fields"].items() if not ok]
            lap = "-" if row["overlap"] is None else f"{row['overlap']:.2f}"
            print(f"  {row['conv']}: {row['score']:.2f} missed={','.join(missed) or '-'} overlap={lap} guards={','.join(row['guards']) or '-'}{' ERROR' if row['error'] else ''}")


if __name__ == "__main__":
    main()
