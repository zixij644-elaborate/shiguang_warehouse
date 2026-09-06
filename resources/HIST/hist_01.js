// 河南科技学院（青果 / KINGOSOFT 教务系统） 拾光课程表适配脚本
//
// 教务系统入口：http://jwgl.hist.edu.cn/cas/login.action
// 课程表数据接口：/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=<base64(xn=..&xq=..)>
//   说明：params 为 Base64，内容是 "xn=2025&xq=0"；xh(学号/uid) 可省略，服务端用会话即可。
//   xn = 学年（如 2025 表示 2025-2026 学年）；xq = 0 第一学期(秋季) / 1 第二学期(春季)。
//
// 适配者：@星河欲转 社区贡献（河南科技学院）
// 说明：本脚本按青果课表接口进行解析，若学校变更菜单编号(10319)或表格结构，
//       请参照文档在“更多→开发者功能”中打开源码调试。

const HOST = 'http://jwgl.hist.edu.cn';
const KB_DATA_URL = HOST + '/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp';

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

function base64Encode(str) {
    return btoa(str);
}

function isLoginPage() {
    const url = window.location.href;
    if (url.indexOf('/cas/') !== -1) return true;
    if (url.indexOf('jwgl.hist.edu.cn') !== -1 && /login\.action|login\.jsp|\/cas\//i.test(url)) return true;
    return false;
}

// ---------- token 解析 ----------

function matchDay(text) {
    const m = text.match(/(?:星期|周)([一二三四五六日天])/);
    if (!m) return null;
    return { day: DAY_MAP[m[1]] || 7, str: m[0] };
}

function matchSection(text) {
    // 找出“节次”：优先选“不是周次”的那组 [N-M] 或 N-M节。
    // 通过全局匹配 + 后一个字符是否为“周”来排除形如 [1-8周] 的周次区间。
    const re = /(?:\[|第)?\s*(\d{1,2})\s*[-—～]\s*(\d{1,2})\s*节?\s*\]?/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
        if (s >= 1 && e >= s && e <= 30) {
            const after = text.slice(re.lastIndex).match(/^\s*/)[0].length;
            if (text[re.lastIndex + after] === '周') continue; // 这是周次，跳过
            return { start: s, end: e, str: m[0] };
        }
    }
    const m2 = text.match(/(?:第)?\s*(\d{1,2})\s*节/);
    if (m2) {
        const s = parseInt(m2[1], 10);
        if (s >= 1 && s <= 30) return { start: s, end: s, str: m2[0] };
    }
    return null;
}

function matchWeeks(text) {
    let flag = 0;
    if (text.includes('单')) flag = 1;
    else if (text.includes('双')) flag = 2;
    let clean = text.replace(/单/g, '').replace(/双/g, '').replace(/[()（）]/g, '');
    const m = clean.match(/([\d,，\-—～]+)\s*周/);
    if (!m) return [];
    const weeks = [];
    for (const part of m[1].split(/[,，]/)) {
        const p = part.trim();
        if (!p) continue;
        const range = p.match(/^(\d{1,3})[\-—～](\d{1,3})$/);
        if (range) {
            const s = parseInt(range[1], 10), e = parseInt(range[2], 10);
            for (let i = s; i <= e; i++) {
                if (flag === 1 && i % 2 !== 0) weeks.push(i);
                else if (flag === 2 && i % 2 === 0) weeks.push(i);
                else if (flag === 0) weeks.push(i);
            }
        } else if (/^\d{1,3}$/.test(p)) {
            const i = parseInt(p, 10);
            if (flag === 1 && i % 2 !== 0) weeks.push(i);
            else if (flag === 2 && i % 2 === 0) weeks.push(i);
            else if (flag === 0) weeks.push(i);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseTimePlaceCell(text) {
    const items = [];
    if (!text) return items;
    const normalized = text
        .replace(/／/g, '/').replace(/，/g, ',').replace(/；/g, ';')
        .replace(/\u3000/g, ' ').replace(/<[^>]+>/g, '');

    const candidates = normalized.split(/[,\n;，；]/).map(s => s.trim()).filter(Boolean);
    for (const cand of candidates) {
        const dayTok = matchDay(cand);
        const secTok = matchSection(cand);
        if (!dayTok || !secTok) continue;
        const weeks = matchWeeks(cand);
        if (weeks.length === 0) continue;

        // 逐个剔除 星期/周次/节次 标记，剩下的就是地点
        let rest = cand;
        rest = rest.replace(dayTok.str, ' ');
        rest = rest.replace(secTok.str, ' ');
        const wkM = rest.match(/[\d,，\-—～]+[()（）单双]*\s*周/);
        if (wkM) rest = rest.replace(wkM[0], ' ');
        rest = rest.replace(/[\[\]()（）]/g, ' ')
            .replace(/[,，;；\/]/g, ' ')
            .replace(/\s+/g, ' ').trim();
        const position = (rest === '' || /^\d+$/.test(rest)) ? '' : rest;

        items.push({ day: dayTok.day, startSection: secTok.start, endSection: secTok.end, weeks, position });
    }
    return items;
}

// ---------- HTML 解析 ----------

function parseScheduleHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');
    const courses = [];

    for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length < 3) continue;

        let dataCell = null;
        for (let i = cells.length - 1; i >= 0; i--) {
            const t = cells[i].textContent || '';
            if (/\d+\s*[-—～]\s*\d+\s*(节|周)/.test(t) || (/节/.test(t) && /周/.test(t))) {
                dataCell = t;
                break;
            }
        }
        if (dataCell === null) continue;

        let name = (cells[1]?.textContent || '').trim() || (cells[0]?.textContent || '').trim();
        name = name.replace(/^\s*\[[^\]]*\]\s*/g, '').trim();
        if (!name) continue;

        let teacher = '';
        for (const idx of [5, 4, 3]) {
            const t = (cells[idx]?.textContent || '').trim();
            if (t && !/\d+\s*[-—～]\s*\d+\s*(节|周)/.test(t)) {
                teacher = t.replace(/^\[[^\]]*\]\s*/g, '').trim();
                if (teacher) break;
            }
        }

        const items = parseTimePlaceCell(String(dataCell));
        for (const it of items) {
            courses.push({
                name: name, teacher: teacher, position: it.position,
                day: it.day, startSection: it.startSection, endSection: it.endSection, weeks: it.weeks
            });
        }
    }
    return mergeCourses(courses);
}

function mergeCourses(courses) {
    const map = new Map();
    for (const c of courses) {
        const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
        if (!map.has(key)) map.set(key, { ...c, weeks: [] });
        const entry = map.get(key);
        entry.weeks = [...new Set([...entry.weeks, ...c.weeks])].sort((a, b) => a - b);
    }
    return Array.from(map.values());
}

// ---------- 流程 ----------

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return '请输入四位数字的学年！';
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '教务系统课表导入',
        '导入前请确认已在本页面登录教务系统（登录成功后无需再点登录）。',
        '好的，开始导入'
    );
}

async function selectYear() {
    const now = new Date();
    const month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (month < 7) year -= 1;
    const input = await window.shiguangBridgePromise.showPrompt(
        '选择学年',
        '请输入要导入课程的起始学年（例如 2025-2026 学年输入 2025）：',
        String(year), 'validateYearInput'
    );
    if (input === null) return null;
    return parseInt(input, 10);
}

async function selectSemester() {
    const semesters = ['第一学期（秋季）', '第二学期（春季）'];
    return await window.shiguangBridgePromise.showSingleSelection('选择学期', JSON.stringify(semesters), 0);
}

async function fetchScheduleHtml(academicYear, semesterIndex) {
    const xq = semesterIndex === 0 ? 0 : 1;
    const params = base64Encode(`xn=${academicYear}&xq=${xq}`);
    const url = `${KB_DATA_URL}?params=${encodeURIComponent(params)}`;
    window.shiguangBridge.showToast('正在请求课表数据…');
    console.log('HIST: fetch ->', url);

    const resp = await fetch(url, { method: 'GET', credentials: 'include' });
    const buf = await resp.arrayBuffer();
    let text = null;
    try { text = new TextDecoder('utf-8').decode(buf); } catch (e) {}
    const hasReplacement = text && text.includes('\uFFFD');
    const hasLoginMarker = text && (text.includes('凭证已失效') || text.includes('请重新登录'));
    if (hasReplacement || !text || hasLoginMarker) {
        try {
            const gbk = new TextDecoder('gbk').decode(buf);
            if (gbk && /星期[一二三四五六日]/.test(gbk)) text = gbk;
        } catch (e) {}
    }
    if (hasLoginMarker) {
        window.shiguangBridge.showToast('请先登录教务系统！');
        return null;
    }
    return text;
}

async function importTimeSlots() {
    const summer = [
        { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:00', endTime: '10:45' }, { number: 4, startTime: '10:55', endTime: '11:40' },
        { number: 5, startTime: '15:00', endTime: '15:45' }, { number: 6, startTime: '15:55', endTime: '16:40' },
        { number: 7, startTime: '17:10', endTime: '17:55' }, { number: 8, startTime: '18:05', endTime: '18:50' },
        { number: 9, startTime: '20:00', endTime: '20:45' }, { number: 10, startTime: '20:55', endTime: '21:40' }
    ];
    const winter = [
        { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:10', endTime: '10:55' }, { number: 4, startTime: '11:05', endTime: '11:50' },
        { number: 5, startTime: '14:30', endTime: '15:15' }, { number: 6, startTime: '15:25', endTime: '16:10' },
        { number: 7, startTime: '16:40', endTime: '17:25' }, { number: 8, startTime: '17:35', endTime: '18:20' },
        { number: 9, startTime: '19:30', endTime: '20:15' }, { number: 10, startTime: '20:25', endTime: '21:10' }
    ];
    const options = ['夏季作息', '冬季作息'];
    const idx = await window.shiguangBridgePromise.showSingleSelection('选择作息时间', JSON.stringify(options), 0);
    const slots = idx === 1 ? winter : summer;
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    return slots;
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast('请先登录教务系统，再点击导入！');
        return;
    }
    const confirmed = await promptUserToStart();
    if (!confirmed) return;
    const year = await selectYear();
    if (year === null) return;
    const semIdx = await selectSemester();
    if (semIdx === null || semIdx === -1) return;

    const html = await fetchScheduleHtml(year, semIdx);
    if (!html) return;
    if (html.includes('凭证已失效') || html.includes('请重新登录')) {
        window.shiguangBridge.showToast('登录已失效，请重新登录后重试。');
        return;
    }

    const courses = parseScheduleHtml(html);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast('未解析到课程，可能是表格结构已变更或本学期无课。');
        console.log('HIST: raw html head ->', html.slice(0, 800));
        return;
    }

    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
    window.shiguangBridge.showToast(`课程解析成功：${courses.length} 条`);
    await importTimeSlots();
    window.shiguangBridge.showToast(`导入完成，共 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
