"""
Local quiz server: reads *.xlsx from this directory and serves JSON to the web UI.
"""

from __future__ import annotations

import re
import json
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
CATEGORY_ARCHIVE = ROOT / "question_categories.json"

CATEGORY_RULES: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "大学心理学": [
        ("职业规划与教师发展", ("职业生涯", "教师生涯", "教师成长", "教师发展", "职业发展", "职业倦怠", "教学效能")),
        ("心理发展与认知", ("认知", "发展阶段", "艾里克森", "皮亚杰", "维果茨基", "记忆", "思维", "想象", "注意")),
        ("学习心理与动机", ("学习", "动机", "归因", "迁移", "强化", "建构主义", "行为主义", "认知主义", "自我效能")),
        ("品德人格与价值观", ("道德", "品德", "人格", "价值观", "态度", "信念", "意志", "情感")),
        ("心理健康与咨询", ("心理健康", "咨询", "辅导", "危机", "焦虑", "抑郁", "压力", "适应", "挫折")),
        ("人际关系与校园文化", ("人际", "群体", "班级", "社团", "校园文化", "学校文化", "社会文化", "交往", "师生关系")),
    ],
    "教师伦理学": [
        ("师德基础与道德品质", ("师德", "教师道德", "道德品质", "道德认识", "道德情感", "道德意志", "良心", "公正", "荣誉", "幸福")),
        ("职业责任与敬业精神", ("敬业", "责任", "职责", "使命", "奉献", "教书育人", "为人师表", "育人意识")),
        ("师生关系与学生关怀", ("学生", "师生", "关爱", "尊重", "平等", "沟通", "交流", "体罚", "侮辱")),
        ("教学伦理与学术规范", ("教学", "课堂", "学术", "科研", "论文", "剽窃", "诚信", "学风", "学术道德")),
        ("社会服务与价值引导", ("社会服务", "社会责任", "社会思潮", "价值引导", "服务社会", "科技创新", "区域化服务")),
        ("师德制度与规范建设", ("规范", "制度", "准则", "评价", "建设", "管理", "监督", "考核", "惩处")),
    ],
    "高等教育学": [
        ("高等教育理念与发展史", ("高等教育", "大学理念", "洪堡", "柏林大学", "纽曼", "教育史", "发展阶段", "大众化", "普及化")),
        ("高校职能与管理制度", ("职能", "管理", "制度", "办学", "院校", "校长", "体制", "治理", "组织")),
        ("教育方针与培养目标", ("教育方针", "教育目的", "培养目标", "全面发展", "社会主义", "人才培养", "德智体")),
        ("课程专业与教学设计", ("课程", "专业", "教案", "教学目的", "重点难点", "教学设计", "教材", "选课", "学分")),
        ("学习理论与教学方法", ("学习理论", "教学方法", "讲授", "讨论", "实验", "建构主义", "行为主义", "人本主义", "认知主义")),
        ("科研评价与教师发展", ("科研", "研究", "教师素质", "教师发展", "行动研究", "评价", "质量", "评估")),
        ("学生发展与德育工作", ("学生", "德育", "思想政治", "学生管理", "就业", "心理", "社团", "辅导员")),
        ("改革政策与质量保障", ("改革", "质量", "政策", "创新", "评估", "保障", "双一流", "现代化")),
    ],
    "高等教育法规": [
        ("法律基础与依法治教", ("法律", "法规", "法治", "依法治教", "法律规范", "法律关系", "法律原则", "权利义务")),
        ("教师资格与教师权益", ("教师资格", "教师法", "教师", "资格认定", "聘任", "职务", "权利", "义务")),
        ("学生权利学籍与处分", ("学生", "学籍", "退学", "处分", "申诉", "奖励", "纪律", "管理规定")),
        ("高校设立与办学管理", ("设立", "高等学校", "办学", "章程", "校长", "审批", "举办", "管理体制")),
        ("经费资产与学生资助", ("经费", "资产", "贷学金", "奖学金", "助学", "收费", "财政", "捐赠")),
        ("招生考试与学历证书", ("招生", "考试", "学历", "学位", "毕业证书", "结业证书", "肄业证书", "证书")),
        ("法律责任与救济", ("法律责任", "行政责任", "民事责任", "刑事责任", "赔偿", "救济", "诉讼", "复议")),
        ("国家政策与发展战略", ("十九大", "乡村振兴", "绿色", "三农", "现代化", "政策", "战略", "创新驱动")),
    ],
}

DEFAULT_CATEGORY = "其他综合题"

app = FastAPI(title="浙江省高等学校教师教育理论刷题APP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache_for_local_app(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


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


def load_category_archive() -> dict[str, dict[str, str]]:
    if not CATEGORY_ARCHIVE.is_file():
        return {}
    try:
        data = json.loads(CATEGORY_ARCHIVE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for bank_name, items in data.items():
        if isinstance(items, dict):
            out[str(bank_name)] = {str(qid): str(category) for qid, category in items.items()}
    return out


def categorize_question(bank_name: str, q: dict, archive: dict[str, dict[str, str]] | None = None) -> str:
    """Assign a study category using bank-specific, editable keyword rules."""
    if archive:
        archived = archive.get(bank_name, {}).get(str(q.get("id", "")))
        if archived:
            return archived
    if q.get("kind") == "multi" and len(q.get("options", {})) > 0 and len(q.get("answer", "")) == len(q.get("options", {})):
        return "多选全选题"
    subject = bank_name.removesuffix("2026").replace("高等教育法规与政策", "高等教育法规")
    rules = CATEGORY_RULES.get(subject, [])
    haystack = " ".join(
        [
            str(q.get("type", "")),
            str(q.get("stem", "")),
            " ".join(str(v) for v in q.get("options", {}).values()),
        ]
    )
    best_name = DEFAULT_CATEGORY
    best_score = 0
    for name, keywords in rules:
        score = sum(haystack.count(kw) for kw in keywords)
        if score > best_score:
            best_name = name
            best_score = score
    return best_name


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
    archive = load_category_archive()
    for _, row in df.iterrows():
        q = parse_cell_to_question(row.iloc[0], row.iloc[1])
        if _question_ok(q):
            q["category"] = categorize_question(path.stem, q, archive)
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
