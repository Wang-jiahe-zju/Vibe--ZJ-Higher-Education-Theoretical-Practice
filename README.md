# 浙江省高等学校教师教育理论刷题 APP

本地运行的刷题小应用：读取项目目录下的 Excel 题库，在浏览器中练习、统计错题，并可选使用 DeepSeek 生成错题解析（解析与编辑内容保存在本机浏览器）。题库来源：https://zhuanlan.zhihu.com/p/339958603

## 功能概览
<img width="866" height="903" alt="image" src="https://github.com/user-attachments/assets/a7c4f91d-3bb9-439e-9cca-6256b1d0dcf6" />

- **多题库**：自动扫描同目录下所有 `.xlsx` 文件作为题库。
- **题型**：单选题、多选题、判断题（由表格中的题型与答案列自动识别）。
- **刷题模式**：整库随机顺序；可「只练错题」；可限制「本轮最多几题」；可随时「结束」本轮。
- **熟悉度热图**：在「题库熟悉度」中按题目顺序展示色块；灰色表示尚未在本应用提交过答案，蓝→红表示已做过且按错题次数归一化。
- **错题本**：独立页面，记录每题错题次数与时间；支持 DeepSeek 解析（Markdown 渲染）、本地缓存、手动编辑与保存。
- **数据不落服务器**：错题、做题痕迹、API 配置、AI 解析等均保存在浏览器 `localStorage`，Python 服务只负责读 xlsx 与提供静态页。

## 环境要求

- Python 3.9+（建议 3.10+）
- 依赖见 `requirements.txt`（FastAPI、uvicorn、pandas、openpyxl）

## 快速开始

在项目根目录（与 `server.py`、题库 `.xlsx` 同级）执行：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

浏览器访问：**http://127.0.0.1:8000**

也可使用：

```bash
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000
```

## 题库文件约定

- 将题库 Excel 放在与 `server.py` **同一目录**。
- 默认读取每个文件的第一个工作表，**至少两列**：第一列为题干（含编号、题型与选项文本），第二列为答案（单选为 `A`–`D`，多选为字母组合，判断为 `对` / `错`）。
- 文件名（不含扩展名）即题库在界面中的显示名。

## 前端依赖（CDN）

页面通过 jsDelivr 加载 **marked** 与 **DOMPurify**，用于安全渲染 AI 返回的 Markdown。离线或内网环境需自行改成本地脚本或镜像地址。

## 浏览器本地存储键（便于备份或清理）

| 键名 | 用途 |
|------|------|
| `quiz_bank_stats_v1` | 各题库错题次数与时间 |
| `quiz_question_seen_v1` | 各题是否已在应用内提交过答案（用于热图灰色） |
| `quiz_ai_analysis_v1` | 各题 AI 解析正文（可编辑后覆盖保存） |
| `quiz_deepseek_cfg_v1` | DeepSeek API Key、Base URL、模型名 |

更换浏览器、清除站点数据或使用不同端口访问时，上述数据不会自动迁移。

## DeepSeek 说明

- 在「API 设置」中填写 Key 等并保存后，请求从**浏览器直连** `https://api.deepseek.com`（或你填写的 Base URL），**不会经过本仓库的 Python 服务**。
- 已生成并保存的解析默认不再请求接口，可节省调用次数。

## 项目结构（简要）

```
题库/
├── server.py          # FastAPI：读 xlsx、API、静态资源
├── requirements.txt
├── README.md
├── static/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── *.xlsx             # 题库文件（按需自行放置）
```

## 许可证与题库版权

代码以你仓库中的约定为准。题库 Excel 的版权与是否适合公开传播请自行确认。
