// 河南科技学院（青果 / KINGOSOFT 教务系统） 空闲教室查询 辅助工具
//
// 该功能依赖学校教务“空闲教室 / 教室使用情况”报表（需登录后访问）。
//   1) 若已知报表 URL，粘贴后抓取解析；
//   2) 已在教务页面打开该报表，可留空，脚本自动扫描当前页面及其 iframe。
//
// 适配者：@星河欲转 社区贡献（河南科技学院）
// 提示：请在真机/开发者模式实测；若列项与预期不符，请根据日志更新识别规则。

const HOST = 'http://jwgl.hist.edu.cn';
// 若已知空闲教室报表地址，请填写（否则留空，脚本会扫描当前页面）
const DEFAULT_FREE_URL = '';

const DAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const DAY_SHORT = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function decodeText(buf) {
    try {
        const t = new TextDecoder('utf-8').decode(buf);
        if (!t.includes('\uFFFD')) return t;
    } catch (e) {}
    try {
        return new TextDecoder('gbk').decode(buf);
    } catch (e) {}
    return '';
}

function isLoginPage() {
    const url = window.location.href;
    if (url.indexOf('/cas/') !== -1) return true;
    if (url.indexOf('jwgl.hist.edu.cn') !== -1 && /login\.action|login\.jsp|\/cas\//i.test(url)) return true;
    return false;
}

function looksLikeFreeTable(table) {
    const text = (table.innerText || table.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const hasDay = DAY_NAMES.some(d => text.indexOf(d) !== -1) || DAY_SHORT.some(d => text.indexOf(d) !== -1);
    const hasSection = /节|\d{1,2}[-—～]\d{1,2}|\d{1,2}:\d{2}/.test(text);
    const hasRoom = /室|楼|教|馆|房|阶|场/.test(text);
    return hasDay && hasSection;
}

function searchFrames(root, depth) {
    depth = depth || 0;
    if (depth > 4) return [];
    const results = [];
    for (const t of Array.from(root.document.querySelectorAll('table'))) {
        if (looksLikeFreeTable(t)) results.push(t);
    }
    for (const fr of Array.from(root.frames || [])) {
        try {
            if (!fr.document) continue;
            results.push(...searchFrames(fr, depth + 1));
        } catch (e) { /* 跨域忽略 */ }
    }
    return results;
}

function findFreeClassroomTable(root) {
    return searchFrames(root)[0] || null;
}

// 找出包含“星期”列头的那一行（表头行），返回 星期 -> 列下标
function dayColumnIndex(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (const row of rows) {
        const cells = Array.from(row.children).map(c => (c.innerText || c.textContent || '').trim());
        const map = {};
        for (let i = 0; i < cells.length; i++) {
            for (const d of DAY_NAMES) {
                if (cells[i].indexOf(d) !== -1) { map[d] = i; }
            }
            for (const d of DAY_SHORT) {
                if (cells[i].indexOf(d) !== -1 && !map[('星期' + d[1])]) { map['星期' + d[1]] = i; }
            }
        }
        if (Object.keys(map).length >= 2) {
            map.__headerRow = rows.indexOf(row);
            return map;
        }
    }
    return null;
}

function sectionRows(table, headerRowIndex) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const map = [];
    for (let i = (headerRowIndex != null ? headerRowIndex + 1 : 1); i < rows.length; i++) {
        const first = rows[i].querySelector('td,th');
        if (!first) continue;
        const label = (first.innerText || '').trim();
        if (label.indexOf('节') !== -1 || /^\d{1,2}/.test(label) || /\d{1,2}:\d{2}/.test(label)) {
            map.push({ rowIndex: i, label });
        }
    }
    return map;
}

function parseFreeClassrooms(table, dayName) {
    const colMap = dayColumnIndex(table);
    const col = colMap ? colMap[dayName] : null;
    if (col === null) return null;
    const rows = sectionRows(table, colMap.__headerRow);
    const out = [];
    for (const r of rows) {
        const row = table.querySelectorAll('tr')[r.rowIndex];
        const cells = Array.from(row.children).map(td => (td.innerText || '').trim());
        const cellText = cells[col] || '';
        const classrooms = cellText.split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean);
        out.push({ section: r.label, classrooms });
    }
    return out;
}

async function fetchFreePage(url) {
    if (!url) return { text: null, mode: 'current' };
    const resp = await fetch(url, { method: 'GET', credentials: 'include' });
    const buf = await resp.arrayBuffer();
    return { text: decodeText(buf), mode: 'url' };
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast('请先登录教务系统，再打开空闲教室页面！');
        return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        '空闲教室查询',
        DEFAULT_FREE_URL
            ? '请先登录教务系统，然后点击开始查询（将抓取已配置报表）。'
            : '请先在教务页面打开“空闲教室/教室使用情况”报表，确认表格已加载，然后点“开始查询”。',
        '开始查询'
    );
    if (!confirmed) return;

    const urlInput = await window.shiguangBridgePromise.showPrompt(
        '空闲教室报表地址（可留空）',
        '若已知报表 URL 请粘贴（留空则扫描当前页面/iframe）：',
        DEFAULT_FREE_URL, ''
    );
    const url = (urlInput || '').trim();

    const page = await fetchFreePage(url);
    const holder = document.createElement('div');
    if (page.mode === 'url') {
        holder.innerHTML = page.text;
    }

    const table = page.mode === 'url'
        ? findFreeClassroomTable(holder)
        : findFreeClassroomTable(window);

    if (!table) {
        const cur = window.location.href;
        window.shiguangBridge.showToast('未识别到空闲教室表格。若当前已打开报表，把地址栏 URL 复制后重试。');
        console.log('HIST: 当前页 URL =', cur);
        return;
    }

    // 如果是在当前页找到的，把 URL 提示用户（便于固定 DEFAULT_FREE_URL）
    if (page.mode === 'current') {
        window.shiguangBridge.showToast('已在当前页面找到报表，建议将地址保存为 DEFAULT_FREE_URL');
        console.log('HIST: 报表 URL 候选 =', window.location.href);
    }

    const colMap = dayColumnIndex(table);
    if (!colMap || Object.keys(colMap).filter(k => k !== '__headerRow').length === 0) {
        window.shiguangBridge.showToast('未能识别星期表头，请确认报表格式。');
        return;
    }
    const days = DAY_NAMES.filter(d => colMap[d] !== undefined);

    const dayIdx = await window.shiguangBridgePromise.showSingleSelection('选择星期', JSON.stringify(days), 0);
    if (dayIdx === null || dayIdx === -1) return;
    const dayName = days[dayIdx];

    const parsed = parseFreeClassrooms(table, dayName) || [];
    if (parsed.length === 0) {
        window.shiguangBridge.showToast('该星期没有可解析的空闲教室数据。');
        return;
    }

    let text = `【${dayName}】空闲教室\n\n`;
    for (const p of parsed) {
        const rooms = p.classrooms.length ? p.classrooms.join('  ') : '（无）';
        text += `${p.section}：${rooms}\n`;
    }

    window.shiguangBridge.showToast('查询完成（来源：' + (page.mode === 'url' ? 'URL 报表' : '当前页面') + '）');
    await window.shiguangBridgePromise.showAlert('空闲教室查询结果', text, '好的');
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
