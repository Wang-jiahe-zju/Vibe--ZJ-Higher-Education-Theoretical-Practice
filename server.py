"""
Local quiz server: reads *.xlsx from this directory and serves JSON to the web UI.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

app = FastAPI(title="题库刷题")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _split_options_block(block: str) -> dict[str, str]:
    """Parse options A/B/C/D from text that may use newlines or Chinese semicolons."""
    opts: dict[str, str] = {}
    if not block or not block.strip():
        return opts
    # Normalize full-width punctuation
    t = block.replace("．", ".").replace("；", ";")
    # Insert delimiter before each option letter at line start or after ;
    parts = re.split(r"(?=(?:^|[;\n])\s*[ABCD][\.．、]|\n\s*[ABCD][\.．、])", t, flags=re.MULTILINE)
    for part in parts:
        part = part.strip().strip(";").strip()
        if not part:
            continue
        m = re.match(r"^([ABCD])[\.．、]\s*(.+)$", part, re.DOTALL)
        if not m:
            m = re.match(r"^([ABCD])\s+(.+)$", part, re.DOTALL)
        if m:
            letter, rest = m.group(1), m.group(2).strip()
            rest = re.sub(r"\s+", " ", rest)
            opts[letter] = rest.rstrip(";").strip()
    if len(opts) >= 2:
        return opts
    # Fallback: split by A./B./ pattern in one line
    chunks = re.split(r"(?=[ABCD][\.．、])", t)
    for ch in chunks:
        ch = ch.strip()
        m = re.match(r"^([ABCD])[\.．、]\s*(.+)$", ch, re.DOTALL)
        if m:
            opts[m.group(1)] = m.group(2).strip().rstrip(";").strip()
    return opts


def _infer_kind(qtype_label: str, answer_raw: str) -> str:
    if "判断" in qtype_label:
        return "judge"
    letters = "".join(sorted(set(re.findall(r"[ABCD]", str(answer_raw).upper()))))
    if len(letters) >= 2:
        return "multi"
    if len(letters) == 1:
        return "single"
    ar = str(answer_raw).strip()
    if ar in ("对", "错"):
        return "judge"
    return ""


def _canonical_answer(kind: str, answer_raw: str) -> str:
    s = str(answer_raw).strip()
    if kind == "judge":
        if s in ("对", "正确", "√", "是"):
            return "A"
        if s in ("错", "错误", "×", "否"):
            return "B"
        su = s.upper()
        if su in ("A", "B"):
            return su
        return ""
    if kind == "multi":
        letters = sorted(set(re.findall(r"[ABCD]", s.upper())))
        return "".join(letters)
    su = re.sub(r"[^ABCD]", "", s.upper())
    return su[:1] if su else ""


def parse_cell_to_question(raw: str, answer_cell: str) -> dict:
    raw = str(raw).strip()
    raw_ans = str(answer_cell).strip()
    lines = [ln.strip() for ln in raw.split("\n") if ln.strip()]
    qid = None
    qtype = "单选题"
    if lines:
        m0 = re.match(r"^(\d+)_(.+)$", lines[0])
        if m0:
            qid = m0.group(1)
            qtype = m0.group(2)
            lines = lines[1:]
    stem_lines: list[str] = []
    option_lines: list[str] = []
    seen_option = False
    for line in lines:
        if re.match(r"^[ABCD][\.．、]", line) or re.match(r"^[ABCD]\s+\S", line):
            seen_option = True
        if seen_option:
            option_lines.append(line)
        else:
            stem_lines.append(line)
    stem = "\n".join(stem_lines).strip()
    opt_block = "\n".join(option_lines)
    options = _split_options_block(opt_block)
    if not options and stem:
        combined = stem
        m = re.search(r"[ABCD][\.．、]", combined)
        if m:
            idx = m.start()
            real_stem = combined[:idx].strip()
            real_opts = combined[idx:]
            options = _split_options_block(real_opts)
            stem = real_stem

    kind = _infer_kind(qtype, raw_ans)
    if kind == "judge" and len(options) < 2:
        options = {"A": "对", "B": "错"}
    answer = _canonical_answer(kind, raw_ans)
    hid = qid or str(abs(hash(stem)) % (10**9))
    return {
        "id": hid,
        "type": qtype,
        "kind": kind,
        "stem": stem,
        "options": options,
        "answer": answer,
    }


def _question_ok(q: dict) -> bool:
    if not q["stem"] or not q["kind"]:
        return False
    if q["kind"] == "judge":
        return q["answer"] in ("A", "B")
    if q["kind"] == "single":
        return len(q["answer"]) == 1 and q["answer"] in "ABCD" and len(q["options"]) >= 2
    if q["kind"] == "multi":
        if len(q["answer"]) < 2:
            return False
        return all(ch in "ABCD" for ch in q["answer"]) and len(q["options"]) >= 2
    return False


def load_bank(path: Path) -> list[dict]:
    df = pd.read_excel(path, sheet_name=0, header=None)
    if df.shape[1] < 2:
        raise ValueError("need at least 2 columns")
    out: list[dict] = []
    for _, row in df.iterrows():
        q = parse_cell_to_question(row.iloc[0], row.iloc[1])
        if _question_ok(q):
            out.append(q)
    return out


@app.get("/api/banks")
def list_banks():
    files = sorted(ROOT.glob("*.xlsx"))
    rows = []
    for p in files:
        df = pd.read_excel(p, sheet_name=0, header=None)
        rows.append({"id": p.stem, "name": p.stem, "filename": p.name, "count": int(len(df))})
    return rows


@app.get("/api/banks/{bank_id}/questions")
def bank_questions(bank_id: str):
    path = ROOT / f"{bank_id}.xlsx"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="bank not found")
    return load_bank(path)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


if STATIC.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
